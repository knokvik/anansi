#!/usr/bin/env node
/**
 * Local, interactive Anansi dashboard.
 *
 * Serves the static dashboard and one endpoint — POST /api/ask — that runs a
 * real query through `resolveQuery` and returns the result as JSON. This is
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

    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
  } catch (cause) {
    console.error(cause);
    res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: cause.message }));
  }
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, mode: replay ? "replay" : "live" }));
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
