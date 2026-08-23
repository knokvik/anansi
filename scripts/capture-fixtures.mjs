#!/usr/bin/env node
/**
 * Capture a real Bright Data envelope into the fixtures/ replay format.
 *
 *   node scripts/capture-fixtures.mjs <contract-id> run <collector_id> <url>
 *   node scripts/capture-fixtures.mjs <contract-id> heal <collector_id> "<prompt>" [url]
 *
 * `run` writes the next fixtures/<contract-id>/run.N.json (parsed rows, the same
 * shape `ScraperClient.run` returns — reuses the exact envelope-unwrapping logic
 * apps/cli uses against live traffic, via its built dist output, so a captured
 * fixture can never silently drift from what production parsing actually does).
 * `heal` writes fixtures/<contract-id>/heal.json.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const { extractRows, parseJsonLoose, findStatus } = await import(
  join(here, "../apps/cli/dist/src/payload.js")
);

async function invoke(args) {
  const { stdout } = await run("npx", ["-y", "-p", "@brightdata/cli", "bdata", ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseJsonLoose(stdout);
}

async function nextRunFile(dir) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    // directory doesn't exist yet — first capture
  }
  const existing = names.filter((n) => /^run\.\d+\.json$/.test(n)).length;
  return join(dir, `run.${existing + 1}.json`);
}

async function main() {
  const [contractId, mode, collectorId, ...rest] = process.argv.slice(2);
  if (!contractId || !mode || !collectorId) {
    console.error(
      "Usage:\n" +
        "  node scripts/capture-fixtures.mjs <contract-id> run <collector_id> <url>\n" +
        '  node scripts/capture-fixtures.mjs <contract-id> heal <collector_id> "<prompt>" [url]',
    );
    process.exit(1);
  }

  const dir = join(here, "..", "fixtures", contractId);
  await mkdir(dir, { recursive: true });

  if (mode === "run") {
    const [url] = rest;
    const payload = await invoke(["scraper", "run", collectorId, url, "--json"]);
    const rows = extractRows(payload);
    if (rows === null) throw new Error(`no rows found in run envelope (status: ${findStatus(payload)})`);
    const target = await nextRunFile(dir);
    await writeFile(target, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
    console.log(`Captured ${rows.length} row(s) -> ${target}`);
  } else if (mode === "heal") {
    const [prompt, url] = rest;
    const args = ["scraper", "heal", collectorId, prompt, "--json"];
    if (url) args.push("--url", url);
    const payload = await invoke(args);
    const target = join(dir, "heal.json");
    await writeFile(
      target,
      `${JSON.stringify({ status: findStatus(payload), preview_rows: extractRows(payload) }, null, 2)}\n`,
      "utf8",
    );
    console.log(`Captured heal envelope -> ${target}`);
  } else {
    throw new Error(`unknown mode "${mode}" — expected "run" or "heal"`);
  }
}

await main();
