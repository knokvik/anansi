/**
 * Renders the Anansi dashboard from the feed written by `anansi report`.
 *
 * The feed is a plain snapshot of the append-only ledger, so this page is a view
 * over decisions that already happened — it never re-derives health itself.
 */

const VERDICT_MARK = { healthy: "✓", degraded: "~", broken: "✗", missing: "✗" };
const VERDICT_COLOR = {
  healthy: "var(--ok)",
  degraded: "var(--warn)",
  broken: "var(--bad)",
  missing: "var(--bad)",
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const scoreColor = (score) =>
  score >= 0.8 ? "var(--ok)" : score >= 0.5 ? "var(--warn)" : "var(--bad)";

const timeOf = (iso) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

async function loadFeed() {
  const response = await fetch("./feed.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`feed.json returned ${response.status}`);
  return response.json();
}

/** Latest health report per contract, plus whether a heal has since verified it. */
function latestHealth(events) {
  const byContract = new Map();
  for (const event of events) {
    if (event.kind === "health" || event.kind === "verified") {
      byContract.set(event.contractId, event.report);
    }
  }
  return byContract;
}

function renderFleetStat(reports) {
  const host = document.getElementById("fleet-stat");
  const all = [...reports.values()];
  const healthy = all.filter((r) => r.status === "healthy").length;
  const mean = all.length ? all.reduce((sum, r) => sum + r.score, 0) / all.length : 0;

  const stats = [
    { k: "collectors", n: String(all.length), color: "var(--fg)" },
    { k: "meeting contract", n: `${healthy}/${all.length}`, color: healthy === all.length ? "var(--ok)" : "var(--warn)" },
    { k: "fleet score", n: mean.toFixed(2), color: scoreColor(mean) },
  ];

  for (const stat of stats) {
    const box = el("div");
    const n = el("div", "n", stat.n);
    n.style.color = stat.color;
    box.append(n, el("div", "k", stat.k));
    host.append(box);
  }
}

function renderCollectorCard(contract, report) {
  const card = el("div", "card");

  const head = el("div", "card-head");
  head.append(
    el("h2", null, contract?.name ?? report.contractId),
    el("span", "cid", report.collectorId),
    el("span", `pill ${report.status}`, report.status),
  );

  const body = el("div", "card-body");

  const scoreRow = el("div", "score-row");
  const num = el("div", "score-num", report.score.toFixed(2));
  num.style.color = scoreColor(report.score);
  const track = el("div", "track");
  const fill = el("i");
  fill.style.width = `${report.score * 100}%`;
  fill.style.background = scoreColor(report.score);
  track.append(fill);
  scoreRow.append(num, track, el("div", "score-meta", `${report.rowCount} rows`));
  body.append(scoreRow);

  const fields = el("div", "fields");
  for (const field of report.fields) {
    const row = el("div", "field");
    const mark = el("div", "mark", VERDICT_MARK[field.verdict] ?? "?");
    mark.style.color = VERDICT_COLOR[field.verdict];
    const bar = el("div", "fillbar");
    const barFill = el("i");
    barFill.style.width = `${field.fillRate * 100}%`;
    barFill.style.background = VERDICT_COLOR[field.verdict];
    bar.append(barFill);
    row.append(mark, el("div", "name", field.field), bar, el("div", "pct", `${Math.round(field.fillRate * 100)}%`));
    fields.append(row);
  }
  body.append(fields);

  const symptoms = [...report.shapeSymptoms, ...report.fields.flatMap((f) => f.symptoms)];
  if (symptoms.length > 0) {
    const list = el("div", "symptoms");
    for (const symptom of symptoms) list.append(el("div", "symptom", symptom));
    body.append(list);
  }

  card.append(head, body);
  return card;
}

const EVENT_TEXT = {
  run: (e) => [`Ran <b>${e.contractId}</b> — ${e.rowCount} rows in ${(e.durationMs / 1000).toFixed(1)}s`, ""],
  health: (e) => [
    `Scored against contract: <b>${e.report.status}</b> (${e.report.score.toFixed(2)})`,
    e.report.status === "healthy" ? "ok" : "bad",
  ],
  heal_proposed: (e) => [`Proposed a repair for <b>${e.targetedFields.join(", ")}</b>`, "act"],
  heal_gated: (e) => [`Gate reviewed the proposed fix`, e.verdict.decision === "approve" ? "ok" : "bad"],
  heal_settled: (e) => [`Sent <b>${e.decision}</b> to Scraper Studio`, "act"],
  verified: (e) => [
    `Verification run scored <b>${e.report.score.toFixed(2)}</b> (${e.report.status})`,
    e.report.status === "healthy" ? "ok" : "bad",
  ],
  escalated: (e) => [`Escalated to a human — ${e.reason}`, "bad"],
  freshness_adjusted: (e) => [
    `Freshness interval ${e.fromTtlSeconds}s → <b>${e.toTtlSeconds}s</b> — ${e.reason}`,
    "act",
  ],
};

function renderTimeline(events) {
  const host = document.getElementById("timeline");
  for (const event of [...events].reverse()) {
    const describe = EVENT_TEXT[event.kind];
    if (!describe) continue;
    const [html, tone] = describe(event);

    const node = el("div", `event ${tone}`);
    node.append(el("div", "when", timeOf(event.at)));
    const what = el("div", "what");
    what.innerHTML = html;
    node.append(what);

    if (event.kind === "heal_proposed") {
      const prompt = el("div", "prompt");
      prompt.append(el("span", "label", `heal prompt · ${event.prompt.length}/1000 chars · generated from the contract`));
      prompt.append(document.createTextNode(event.prompt));
      node.append(prompt);
    }

    if (event.kind === "heal_gated") {
      const gate = el("div", `gate ${event.verdict.decision}`);
      gate.append(el("span", "verdict", event.verdict.decision.toUpperCase() + " · "));
      gate.append(document.createTextNode(event.verdict.reason));
      node.append(gate);
    }

    host.append(node);
  }
}

function renderEmpty(message) {
  document.getElementById("collectors").innerHTML =
    `<div class="empty">${message}<br><br>Run <code>pnpm anansi watch --replay ./fixtures</code> then <code>pnpm anansi report</code>.</div>`;
}

function relativeTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(ms);
  const unit = abs < 3600_000 ? [Math.round(abs / 60_000), "m"] : abs < 86_400_000 ? [Math.round(abs / 3600_000), "h"] : [Math.round(abs / 86_400_000), "d"];
  return ms >= 0 ? `${unit[0]}${unit[1]} ago` : `in ${unit[0]}${unit[1]}`;
}

function renderTopicCard(topic) {
  const card = el("div", "card");
  const status = topic.lastStatus ?? "healthy";

  const head = el("div", "card-head");
  head.append(
    el("h2", "topic-query", topic.query),
    el("span", "cid", topic.collectorId),
    el("span", `pill ${status}`, status),
  );

  const body = el("div", "card-body");

  const scoreRow = el("div", "score-row");
  const num = el("div", "score-num", topic.lastScore.toFixed(2));
  num.style.color = scoreColor(topic.lastScore);
  const track = el("div", "track");
  const fill = el("i");
  fill.style.width = `${topic.lastScore * 100}%`;
  fill.style.background = scoreColor(topic.lastScore);
  track.append(fill);
  scoreRow.append(num, track, el("div", "score-meta", `${topic.rows.length} rows · asked ${topic.askCount}×${topic.standing ? " · standing" : ""}`));
  body.append(scoreRow);

  const expiresAt = new Date(topic.lastConfirmedFresh).getTime() + topic.ttlSeconds * 1000;
  const stale = Date.now() > expiresAt;
  const freshness = el(
    "div",
    `freshness ${stale ? "stale" : ""}`,
    `${stale ? "due for a check" : "confirmed fresh"} ${relativeTime(topic.lastConfirmedFresh)} · TTL ${Math.round(topic.ttlSeconds / 3600)}h · ${topic.freshnessClass}`,
  );
  body.append(freshness);

  const rowList = el("div", "row-list");
  for (const row of topic.rows.slice(0, 8)) {
    const identity = String(row[topic.identityField] ?? "");
    rowList.append(el("div", "row-item", `${identity} — ${JSON.stringify(row).slice(0, 140)}`));
  }
  body.append(rowList);

  card.append(head, body);
  return card;
}

try {
  const feed = await loadFeed();
  const contracts = new Map(feed.contracts.map((c) => [c.id, c]));
  const topics = feed.topics ?? [];
  const topicContractIds = new Set(topics.map((t) => t.contractId));

  // A Radar topic's run/health events land in the same ledger as the scheduled
  // fleet's — they share one audit trail by design. Keep them out of the fleet
  // grid here (they get their own section below) by contract id.
  const allReports = latestHealth(feed.events);
  const reports = new Map([...allReports].filter(([contractId]) => !topicContractIds.has(contractId)));

  if (reports.size === 0 && topics.length === 0) {
    renderEmpty("Nothing recorded yet.");
  } else {
    if (reports.size > 0) {
      renderFleetStat(reports);
      const host = document.getElementById("collectors");
      for (const [contractId, report] of reports) {
        host.append(renderCollectorCard(contracts.get(contractId), report));
      }
    } else {
      document.getElementById("collectors").innerHTML =
        '<div class="empty">No scheduled collectors yet — every result below came from an ask.</div>';
    }

    if (topics.length > 0) {
      document.getElementById("radar-section").hidden = false;
      const topicsHost = document.getElementById("topics");
      for (const topic of topics) topicsHost.append(renderTopicCard(topic));
    }

    renderTimeline(feed.events);
  }
  document.getElementById("generated").textContent = `feed generated ${timeOf(feed.generatedAt)}`;
} catch (cause) {
  renderEmpty(`No feed found (${cause.message}).`);
}
