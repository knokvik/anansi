/**
 * Renders the Anansi dashboard from the feed written by `anansi report`.
 *
 * The feed is a plain snapshot of the append-only ledger, so this page is a view
 * over decisions that already happened — it never re-derives health itself.
 */

import { CLOUD_PALETTES, initCloudShader } from "./cloud-shader.js";

/**
 * Set once the local interactive server answers /api/health. Declared up here
 * because the landing's Launch button reads it to decide whether to show the
 * composer, and that listener is wired before the probe resolves.
 */
let interactive = null;

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

/* ---------- cloud shader hero ---------- */
const cloud = initCloudShader(document.getElementById("cloud-canvas"));

/* ---------- theme ---------- */
const isDarkTheme = () => {
  const forced = document.documentElement.getAttribute("data-theme");
  if (forced) return forced === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

function initTheme() {
  const root = document.documentElement;
  const sun = document.getElementById("theme-icon-sun");
  const moon = document.getElementById("theme-icon-moon");
  const toggle = document.getElementById("theme-toggle");

  const sync = () => {
    const dark = isDarkTheme();
    sun.hidden = dark;
    moon.hidden = !dark;
    cloud?.setPalette(dark ? CLOUD_PALETTES.dark : CLOUD_PALETTES.light);
  };

  toggle.addEventListener("click", () => {
    const next = isDarkTheme() ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("anansi-theme", next);
    } catch {
      // Private browsing or similar — theme just won't persist across reloads.
    }
    sync();
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", sync);
  sync();
}

initTheme();

/* ---------- landing <-> dashboard ---------- */
function showDashboard() {
  document.getElementById("landing").hidden = true;
  document.getElementById("features").hidden = true;
  document.getElementById("dashboard").hidden = false;
  // The composer is the dashboard's input; it stays hidden unless the local
  // interactive server answered the /api/health probe further down.
  document.getElementById("composer-dock").hidden = !interactive;
  window.scrollTo(0, 0);
  history.replaceState(null, "", "#dashboard");
}

function showLanding() {
  document.getElementById("landing").hidden = false;
  document.getElementById("features").hidden = false;
  document.getElementById("dashboard").hidden = true;
  document.getElementById("composer-dock").hidden = true;
  window.scrollTo(0, 0);
  history.replaceState(null, "", "#");
}

document.getElementById("launch-dashboard").addEventListener("click", showDashboard);
document.getElementById("launch-dashboard-hero").addEventListener("click", showDashboard);
document.getElementById("back-home").addEventListener("click", showLanding);

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
  host.innerHTML = "";
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
  host.innerHTML = "";
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

function renderTopicCard(topic, novelty = null) {
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
    const identity = String(row[topic.identityField] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const change = novelty?.changes.find((c) => c.identity === identity);
    const item = el("div", `row-item ${change?.kind ?? ""}`);
    if (change) item.append(el("span", "rowbadge", change.kind.toUpperCase()));
    item.append(document.createTextNode(`${identity} — ${JSON.stringify(row).slice(0, 140)}`));
    if (change?.deltas) {
      for (const delta of change.deltas) {
        item.append(el("span", "row-delta", `${delta.field}: ${JSON.stringify(delta.from)} → ${JSON.stringify(delta.to)}`));
      }
    }
    rowList.append(item);
  }
  body.append(rowList);

  if (novelty && !novelty.isBaseline) {
    body.append(
      el(
        "div",
        "novelty-summary",
        `${novelty.newCount} new · ${novelty.changedCount} changed · ${novelty.unchangedCount} unchanged`,
      ),
    );
  }

  card.append(head, body);
  return card;
}

/* ---------- live metrics ---------- */
function metricTile(label, value, sub, live) {
  const tile = el("div", `metric-tile${live ? " live" : ""}`);
  tile.append(el("div", "m-label", label), el("div", "m-value", value));
  if (sub) tile.append(el("div", "m-sub", sub));
  return tile;
}

/** Rebuilds the metrics row. `session` is the /api/status payload when the interactive server is present, or null on the static deployment. */
function renderMetrics({ reports, topics, session }) {
  const host = document.getElementById("metrics-grid");
  host.innerHTML = "";
  const live = session !== null;

  const allScores = [...reports.values()].map((r) => r.score).concat(topics.map((t) => t.lastScore));
  const meanScore = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
  const standing = topics.filter((t) => t.standing).length;

  host.append(metricTile("Tracked", String(reports.size + topics.length), `${reports.size} scheduled · ${topics.length} radar`, live));
  host.append(metricTile("Avg score", meanScore.toFixed(2), meanScore >= 0.8 ? "healthy" : meanScore >= 0.5 ? "degraded" : "broken", live));
  host.append(metricTile("Standing topics", String(standing), "earned a place in the nightly sweep", live));

  if (session) {
    const { stats } = session;
    const hitRate = stats.askCount > 0 ? Math.round((stats.cacheHits / stats.askCount) * 100) : 0;
    host.append(metricTile("This session", String(stats.askCount), `${stats.askCount} ask${stats.askCount === 1 ? "" : "s"} since server start`, true));
    host.append(metricTile("Cache hit rate", `${hitRate}%`, `${stats.cacheHits} free · ${stats.liveResolves} live scrapes`, true));
  }
}

/* ---------- scraper activity feed ---------- */
const ACTIVITY_TEXT = {
  run: (e) => ["→", `Scraped <b>${e.contractId}</b> — ${e.rowCount} rows`, ""],
  health: (e) => [e.report.status === "healthy" ? "✓" : "!", `<b>${e.contractId}</b> scored ${e.report.status} (${e.report.score.toFixed(2)})`, e.report.status === "healthy" ? "ok" : "bad"],
  heal_proposed: (e) => ["✎", `Proposed a heal for <b>${e.contractId}</b>`, "act"],
  heal_gated: (e) => [e.verdict.decision === "approve" ? "✓" : "✗", `Gate <b>${e.verdict.decision}d</b> the fix for ${e.contractId}`, e.verdict.decision === "approve" ? "ok" : "bad"],
  heal_settled: (e) => ["⇢", `Sent <b>${e.decision}</b> to Scraper Studio`, "act"],
  verified: (e) => [e.report.status === "healthy" ? "✓" : "!", `Verified <b>${e.contractId}</b> — ${e.report.status} (${e.report.score.toFixed(2)})`, e.report.status === "healthy" ? "ok" : "bad"],
  escalated: (e) => ["⚠", `Escalated <b>${e.contractId}</b> — ${e.reason.slice(0, 90)}`, "bad"],
  freshness_adjusted: (e) => ["↻", `<b>${e.contractId}</b> freshness → ${e.toTtlSeconds}s`, "act"],
};

function renderActivity(events) {
  const host = document.getElementById("activity-feed");
  host.innerHTML = "";
  const recent = [...events].reverse().slice(0, 8);

  if (recent.length === 0) {
    host.append(el("div", "empty", "No activity yet."));
    return;
  }

  for (const event of recent) {
    const describe = ACTIVITY_TEXT[event.kind];
    if (!describe) continue;
    const [icon, html, tone] = describe(event);
    const row = el("div", `activity-row ${tone}`);
    row.append(el("div", "a-icon", icon));
    const text = el("div", "a-text");
    text.innerHTML = html;
    row.append(text, el("div", "a-time", timeOf(event.at)));
    host.append(row);
  }
}

const PIPE_STAGES = ["cache", "scrape", "score", "heal", "done"];

function setPipeline(states) {
  const host = document.getElementById("pipeline");
  host.hidden = false;
  for (const stage of PIPE_STAGES) {
    const node = host.querySelector(`[data-stage="${stage}"]`);
    node.className = `pipe-stage ${states[stage] ?? ""}`;
  }
}

/** Coarse, honest stage summary derived from the real result — not simulated timing. */
function pipelineForResult(status) {
  switch (status) {
    case "cache_hit":
      return { cache: "done", scrape: "skip", score: "skip", heal: "skip", done: "done" };
    case "bootstrapped":
      return { cache: "done", scrape: "done", score: "done", heal: "skip", done: "done" };
    case "refreshed":
      return { cache: "done", scrape: "done", score: "done", heal: "done", done: "done" };
    case "refresh_failed":
      return { cache: "done", scrape: "done", score: "done", heal: "fail", done: "fail" };
    default:
      return { cache: "done", scrape: "done", score: "done", heal: "done", done: "done" };
  }
}

async function handleAsk(event) {
  event.preventDefault();
  const input = document.getElementById("ask-input");
  const submit = document.getElementById("ask-submit");
  const query = input.value.trim();
  if (!query) return;

  submit.disabled = true;
  document.getElementById("ask-result").innerHTML = "";
  setPipeline({ cache: "active" });

  try {
    const response = await fetch("./api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error ?? `request failed (${response.status})`);

    setPipeline(pipelineForResult(result.status));
    const host = document.getElementById("ask-result");
    host.append(renderTopicCard(result.entry, result.novelty));
    await refreshLive();
  } catch (cause) {
    setPipeline({ cache: "fail" });
    document.getElementById("ask-result").innerHTML = `<div class="empty">${cause.message}</div>`;
  } finally {
    submit.disabled = false;
  }
}

document.getElementById("ask-form").addEventListener("submit", handleAsk);

/**
 * Renders everything below the hero from a (contracts, events, topics) triple.
 * Called once on initial load with the full static feed, and again on every
 * live poll tick with the interactive server's fresher — but shorter — event
 * window, so the metrics, activity feed, and Radar cards stay current without
 * a page reload. Idempotent: every host is cleared before it's rebuilt.
 */
function renderAll({ contracts, events, topics, session = null }) {
  const contractMap = new Map(contracts.map((c) => [c.id, c]));
  const topicContractIds = new Set(topics.map((t) => t.contractId));

  // A Radar topic's run/health events land in the same ledger as the
  // scheduled fleet's — they share one audit trail by design. Keep them out
  // of the fleet grid (they get their own section) by contract id.
  const allReports = latestHealth(events);
  const reports = new Map([...allReports].filter(([contractId]) => !topicContractIds.has(contractId)));

  renderMetrics({ reports, topics, session });
  renderActivity(events);

  const collectorsHost = document.getElementById("collectors");
  collectorsHost.innerHTML = "";
  document.getElementById("fleet-stat").innerHTML = "";
  if (reports.size === 0 && topics.length === 0) {
    renderEmpty("Nothing recorded yet.");
    return;
  }

  if (reports.size > 0) {
    renderFleetStat(reports);
    for (const [contractId, report] of reports) {
      collectorsHost.append(renderCollectorCard(contractMap.get(contractId), report));
    }
  } else {
    collectorsHost.innerHTML = '<div class="empty">No scheduled collectors yet — every result below came from an ask.</div>';
  }

  const topicsHost = document.getElementById("topics");
  topicsHost.innerHTML = "";
  if (topics.length > 0) {
    document.getElementById("radar-section").hidden = false;
    for (const topic of topics) topicsHost.append(renderTopicCard(topic));
  }

  renderTimeline(events);
}

// The interactive backend (server.mjs) only ever runs locally — a public page
// that lets anyone trigger a real scrape would spend your Bright Data credits
// on strangers. Probe for it rather than assuming; on the static GitHub Pages
// deployment this request 404s and the composer simply stays hidden, and
// metrics/activity fall back to the static feed with no live polling.
let latestFeed = null;

/** Pulls a fresh snapshot from the interactive server and re-renders. No-op on the static deployment. */
async function refreshLive() {
  if (!interactive || !latestFeed) return;
  const session = await fetch("./api/status").then((r) => r.json());
  renderAll({ contracts: latestFeed.contracts, events: session.events, topics: session.topics, session });
}

try {
  const health = await fetch("./api/health").then((r) => (r.ok ? r.json() : null));
  if (health?.ok) {
    interactive = health;
    // Only reveal the dock if the dashboard is already the visible view;
    // otherwise showDashboard() handles it when the user launches.
    document.getElementById("composer-dock").hidden = document.getElementById("dashboard").hidden;
    const hint = document.getElementById("ask-hint");
    hint.hidden = false;
    hint.textContent =
      health.mode === "replay"
        ? "Replay mode: every query returns the Break Room dataset regardless of what you type — no credentials needed."
        : "Runs a real query against Bright Data using whatever credentials `bdata login` has stored locally. A brand-new topic bootstraps its own contract on the spot.";
  }
} catch {
  // No local server — this is the static deployment.
}

try {
  latestFeed = await loadFeed();

  renderAll({ contracts: latestFeed.contracts, events: latestFeed.events, topics: latestFeed.topics ?? [] });
  document.getElementById("generated").textContent = `feed generated ${timeOf(latestFeed.generatedAt)}`;

  if (interactive) {
    document.getElementById("activity-heading").prepend(el("span", "live-dot"));
    document.getElementById("timeline-heading").prepend(el("span", "live-dot"));
    setInterval(() => refreshLive().catch(() => {}), 4000);
  }

  // Reloading while on the dashboard should land back on the dashboard.
  if (location.hash === "#dashboard") showDashboard();
} catch (cause) {
  renderEmpty(`No feed found (${cause.message}).`);
}
