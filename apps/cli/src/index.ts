#!/usr/bin/env node
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import {
  KnowledgeStore,
  Ledger,
  Snapshots,
  loadContracts,
  resolveQuery,
  superviseContract,
  type ScraperClient,
  type SupervisionOutcome,
} from "@anansi/core";
import { BdataClient } from "./bdata-client.js";
import { FixtureClient } from "./fixture-client.js";
import { renderAnswer, renderOutcome } from "./render.js";

const program = new Command();

program
  .name("anansi")
  .description("A self-healing control plane for Bright Data Scraper Studio collectors.")
  .version("0.1.0");

interface CommonOptions {
  contracts: string;
  ledger: string;
  contract?: string;
  replay?: string;
  verbose?: boolean;
}

function withCommonOptions(command: Command): Command {
  return command
    .option("-c, --contracts <dir>", "directory of *.contract.yaml files", "./contracts")
    .option("-l, --ledger <path>", "append-only event log", "./data/ledger.jsonl")
    .option("--contract <id>", "limit the sweep to a single contract id")
    .option("--replay <dir>", "replay recorded fixtures instead of calling Bright Data")
    .option("-v, --verbose", "echo every Bright Data CLI invocation");
}

function makeClient(options: CommonOptions, contractId: string): ScraperClient {
  const log = options.verbose ? (message: string) => console.log(pc.dim(`  ${message}`)) : undefined;
  if (options.replay) {
    return new FixtureClient(resolve(options.replay, contractId), log ?? (() => {}));
  }
  return new BdataClient(log ? { log } : {});
}

/** Exit codes are contractual: CI treats anything non-zero as a failed sweep. */
const EXIT = { ok: 0, unresolved: 1, error: 2 } as const;

async function sweep(options: CommonOptions, dryRun: boolean): Promise<number> {
  const all = await loadContracts(resolve(options.contracts));
  const contracts = options.contract ? all.filter((c) => c.id === options.contract) : all;

  if (contracts.length === 0) {
    console.error(pc.red(`No contracts found in ${options.contracts}.`));
    return EXIT.error;
  }

  const ledger = new Ledger(resolve(options.ledger));
  const outcomes: SupervisionOutcome[] = [];

  for (const contract of contracts) {
    const deps = {
      client: makeClient(options, contract.id),
      ledger,
      dryRun,
      ...(options.verbose ? { log: (m: string) => console.log(pc.dim(`  ${m}`)) } : {}),
    };
    const outcome = await superviseContract(contract, deps);
    outcomes.push(outcome);
    console.log(renderOutcome(outcome));
  }

  const unresolved = outcomes.filter(
    (o) => o.resolution !== "healthy" && o.resolution !== "healed",
  );

  console.log(`\n${pc.bold("Sweep complete.")}`);
  for (const outcome of outcomes) {
    console.log(`  ${outcome.resolution.padEnd(16)} ${outcome.contractId}`);
  }

  return unresolved.length === 0 ? EXIT.ok : EXIT.unresolved;
}

withCommonOptions(
  program
    .command("watch")
    .description("Run every collector, score it against its contract, and heal what is broken."),
).action(async (options: CommonOptions) => {
  process.exitCode = await sweep(options, false);
});

withCommonOptions(
  program
    .command("check")
    .description("Detect and report only. Never spends credits on a heal."),
).action(async (options: CommonOptions) => {
  process.exitCode = await sweep(options, true);
});

withCommonOptions(
  program.command("report").description("Summarise the ledger and export it for the dashboard."),
)
  .option("-o, --out <path>", "write the dashboard feed as JSON", "./apps/dashboard/feed.json")
  .action(async (options: CommonOptions & { out: string }) => {
    const ledger = new Ledger(resolve(options.ledger));
    const events = await ledger.read();
    const contracts = await loadContracts(resolve(options.contracts));

    if (events.length === 0) {
      console.log(pc.yellow("Ledger is empty — run `anansi check` or `anansi watch` first."));
      return;
    }

    const feed = { generatedAt: new Date().toISOString(), contracts, events };
    await mkdir(dirname(resolve(options.out)), { recursive: true });
    await writeFile(resolve(options.out), JSON.stringify(feed, null, 2), "utf8");

    const counts = new Map<string, number>();
    for (const event of events) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
    console.log(pc.bold(`${events.length} ledger events across ${contracts.length} contract(s):`));
    for (const [kind, count] of [...counts].sort()) {
      console.log(`  ${String(count).padStart(4)}  ${kind}`);
    }
    console.log(pc.dim(`\nDashboard feed written to ${options.out}`));
  });

program
  .command("contracts")
  .description("Validate every contract file and print the fleet.")
  .option("-c, --contracts <dir>", "directory of *.contract.yaml files", "./contracts")
  .action(async (options: { contracts: string }) => {
    try {
      const contracts = await loadContracts(resolve(options.contracts));
      for (const contract of contracts) {
        console.log(`${pc.green("✓")} ${pc.bold(contract.id.padEnd(18))} ${pc.dim(contract.collectorId)}`);
        console.log(
          pc.dim(`    ${contract.fields.length} fields, ${contract.canaries.length} canary URL(s)`),
        );
      }
      console.log(pc.dim(`\n${contracts.length} contract(s) valid.`));
    } catch (cause) {
      console.error(pc.red(`✗ ${(cause as Error).message}`));
      process.exitCode = EXIT.error;
    }
  });

program
  .command("ask <query...>")
  .description("Answer a free-text query: served from cache when fresh, scraped and scored when not.")
  .option("-c, --contracts <dir>", "directory of *.contract.yaml files", "./contracts")
  .option("-l, --ledger <path>", "append-only event log", "./data/ledger.jsonl")
  .option("-k, --knowledge <dir>", "Knowledge Store directory", "./data/knowledge")
  .option("-s, --snapshots <dir>", "novelty-diff snapshot directory", "./data/snapshots")
  .option("--url <url>", "target URL — required the first time a topic is asked")
  .option("--collector <id>", "c_* collector to bootstrap against — required alongside --url")
  .option("--replay <dir>", "replay recorded fixtures instead of calling Bright Data")
  .option("-v, --verbose", "echo every Bright Data CLI invocation")
  .action(
    async (
      queryParts: string[],
      options: {
        contracts: string;
        ledger: string;
        knowledge: string;
        snapshots: string;
        url?: string;
        collector?: string;
        replay?: string;
        verbose?: boolean;
      },
    ) => {
      const query = queryParts.join(" ");
      const log = options.verbose ? (message: string) => console.log(pc.dim(`  ${message}`)) : undefined;
      const client: ScraperClient = options.replay
        ? new FixtureClient(resolve(options.replay), log ?? (() => {}))
        : new BdataClient(log ? { log } : {});

      try {
        const result = await resolveQuery(
          query,
          { ...(options.url ? { url: options.url } : {}), ...(options.collector ? { collectorId: options.collector } : {}) },
          {
            client,
            store: new KnowledgeStore(resolve(options.knowledge)),
            snapshots: new Snapshots(resolve(options.snapshots)),
            ledger: new Ledger(resolve(options.ledger)),
            contractsDir: resolve(options.contracts),
            ...(log ? { log } : {}),
          },
        );
        console.log(renderAnswer(result));
        if (result.status === "refresh_failed") process.exitCode = EXIT.unresolved;
      } catch (cause) {
        console.error(pc.red((cause as Error).message));
        process.exitCode = EXIT.error;
      }
    },
  );

program.parseAsync().catch((cause: unknown) => {
  console.error(pc.red((cause as Error).message));
  process.exitCode = EXIT.error;
});
