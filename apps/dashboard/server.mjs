#!/usr/bin/env node
/**
 * Local, interactive Anansi dashboard.
 *
 * Serves the static dashboard plus three endpoints: POST /api/ask runs a real
 * query through `resolveQuery`; GET /api/status reports live metrics and the
 * ledger tail for polling; GET /api/health is what the page probes to decide
 * whether to show the search bar at all. This is
 * deliberately not what gets deployed to GitHub Pages: a public page with a
 * button that spends your Bright Data credits on anyone's request is a bad
 * idea. This server only ever runs on your own machine, against your own
 * credentials, which is exactly what "the terminal is the UI" already implies
 * — this just gives that same loop a page to render itself on, without
 * standing up a public backend.
 *
 * Usage:
 *   node apps/dashboard/server.mjs             # real Bright Data calls
 *   node apps/dashboard/server.mjs --replay    # replay ./fixtures, no credentials needed
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../..");
const port = Number(process.env.PORT ?? 4322);
const replay = process.argv.includes("--replay");

const { resolveQuery, KnowledgeStore, Snapshots, Ledger } = await import(
  join(root, "packages/core/dist/index.js")
);
const { BdataClient } = await import(join(root, "apps/cli/dist/src/bdata-client.js"));
const { FixtureClient } = await import(join(root, "apps/cli/dist/src/fixture-client.js"));

const store = new KnowledgeStore(join(root, "data/knowledge"));
const snapshots = new Snapshots(join(root, "data/snapshots"));
const ledger = new Ledger(join(root, "data/ledger.jsonl"));
const contractsDir = join(root, "contracts");

/** In-memory only, since restart: how this server session has actually been used. */
const stats = { askCount: 0, cacheHits: 0, liveResolves: 0, startedAt: new Date().toISOString() };

const CONTENT_TYPE = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function makeClient(collectorId) {
  const log = (message) => console.log(`  ${message}`);
  return replay ? new FixtureClient(join(root, "fixtures", collectorId), log) : new BdataClient({ log });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function serveStatic(req, res) {
  const path = req.url === "/" ? "index.html" : req.url.split("?")[0].replace(/^\//, "");
  const filePath = join(here, path);
  if (!filePath.startsWith(here)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": CONTENT_TYPE[extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}

async function handleAsk(req, res) {
  try {
    const { query, url, collectorId } = await readBody(req);
    if (!query || typeof query !== "string") {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "query is required" }));
      return;
    }

    const options = {};
    if (url) options.url = url;
    if (collectorId) options.collectorId = collectorId;

    const client = makeClient(replay ? "breakroom-pricing" : "live");
    const result = await resolveQuery(query, options, {
      client,
      store,
      snapshots,
      ledger,
      contractsDir,
      log: (message) => console.log(`  ${message}`),
    });

    stats.askCount += 1;
    if (result.status === "cache_hit") stats.cacheHits += 1;
    else stats.liveResolves += 1;

    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
  } catch (cause) {
    console.error(cause);
    res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: cause.message }));
  }
}

async function handleStatus(req, res) {
  try {
    // The full ledger, not a tail — the client computes each fleet contract's
    // *latest* health by scanning from the end, same as it does with the
    // static feed. Truncating here would silently drop a contract's most
    // recent health event once enough Radar activity pushed it out of a
    // short window, which reads as the fleet card vanishing mid-poll.
    const [topics, events] = await Promise.all([store.list(), ledger.read()]);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ stats, topics, events }));
  } catch (cause) {
    res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: cause.message }));
  }
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, mode: replay ? "replay" : "live" }));
    return;
  }
  if (req.method === "GET" && req.url === "/api/status") {
    handleStatus(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/ask") {
    handleAsk(req, res);
    return;
  }
  serveStatic(req, res);
}).listen(port, () => {
  console.log(`Anansi dashboard on http://localhost:${port} ${replay ? "(replay mode — no credentials needed)" : "(live Bright Data)"}`);
});
