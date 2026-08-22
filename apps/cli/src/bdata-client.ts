import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ApproveResult, HealEnvelope, Row, ScraperClient } from "@anansi/core";
import { extractRows, isAwaitingApproval, findStatus, parseJsonLoose } from "./payload.js";

const run = promisify(execFile);

export class BdataError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "BdataError";
  }
}

export interface BdataOptions {
  /**
   * How to invoke the Bright Data CLI. Defaults to npx so nothing is installed
   * globally, matching the workflow the hackathon documents.
   */
  command?: string;
  args?: string[];
  /** Per-invocation ceiling. Scraper runs poll server-side and can be slow. */
  timeoutMs?: number;
  log?: (message: string) => void;
}

const DEFAULT_COMMAND = "npx";
const DEFAULT_ARGS = ["-y", "-p", "@brightdata/cli", "bdata"];

/**
 * A `ScraperClient` backed by the real `bdata` CLI.
 *
 * Everything goes through the same terminal workflow the platform is designed
 * around; Anansi adds the decisions, not a second integration path.
 */
export class BdataClient implements ScraperClient {
  private readonly command: string;
  private readonly baseArgs: string[];
  private readonly timeoutMs: number;
  private readonly log: (message: string) => void;

  constructor(options: BdataOptions = {}) {
    this.command = options.command ?? process.env["ANANSI_BDATA_COMMAND"] ?? DEFAULT_COMMAND;
    this.baseArgs = options.args ?? DEFAULT_ARGS;
    this.timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
    this.log = options.log ?? (() => {});
  }

  private async invoke(args: string[]): Promise<unknown> {
    const full = [...this.baseArgs, ...args];
    this.log(`$ ${this.command} ${full.map(quote).join(" ")}`);

    try {
      const { stdout } = await run(this.command, full, {
        timeout: this.timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        env: process.env,
      });
      return parseJsonLoose(stdout);
    } catch (cause) {
      const error = cause as { stdout?: string; stderr?: string; message: string };
      // A non-zero exit can still carry a usable JSON envelope (e.g. a heal that
      // finished but flagged a warning), so try to salvage it before giving up.
      const salvaged = parseJsonLoose(error.stdout ?? "");
      if (salvaged !== null) return salvaged;
      throw new BdataError(
        `bdata ${args[0] ?? ""} ${args[1] ?? ""} failed: ${error.message}`,
        error.stderr ?? "",
      );
    }
  }

  async run(collectorId: string, urls: string[]): Promise<Row[]> {
    const args = ["scraper", "run", collectorId, "--json"];
    if (urls.length === 1) {
      args.splice(3, 0, urls[0]!);
    } else {
      args.push("--urls", urls.join(","));
    }

    const payload = await this.invoke(args);
    const rows = extractRows(payload);
    if (rows === null) {
      throw new BdataError(
        `Could not find any rows in the run output for ${collectorId}. ` +
          `Envelope status was "${findStatus(payload) ?? "unknown"}".`,
        JSON.stringify(payload).slice(0, 600),
      );
    }
    return rows;
  }

  /**
   * Heal without `--auto-approve` on purpose: the job parks at the approval gate
   * so the contract can score the proposal before anything is saved.
   */
  async heal(collectorId: string, prompt: string, verifyUrl?: string): Promise<HealEnvelope> {
    const args = ["scraper", "heal", collectorId, prompt, "--json"];
    if (verifyUrl) args.push("--url", verifyUrl);

    const payload = await this.invoke(args);
    return {
      status: findStatus(payload) ?? "unknown",
      previewRows: extractRows(payload),
      awaitingApproval: isAwaitingApproval(payload),
      raw: payload,
    };
  }

  async approve(collectorId: string, decision: "approve" | "reject"): Promise<ApproveResult> {
    const args = ["scraper", "approve", collectorId, "--json"];
    if (decision === "reject") {
      args.push("--reject");
    } else {
      // Only a fix that cleared the gate is allowed to be persisted.
      args.push("--auto-save");
    }

    const payload = await this.invoke(args);
    const status = findStatus(payload) ?? "unknown";
    return {
      ok: !/fail|error|reject/i.test(status) || decision === "reject",
      detail: status,
      raw: payload,
    };
  }
}

function quote(arg: string): string {
  return /[\s"']/.test(arg) ? JSON.stringify(arg) : arg;
}
