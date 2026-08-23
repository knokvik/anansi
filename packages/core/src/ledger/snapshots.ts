import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Row } from "../health/evaluate.js";

/**
 * The last known-good set of rows for a contract, kept only for novelty diffing.
 *
 * Unlike the ledger this is overwritten, not appended — it is a snapshot, not a
 * history. The supervisor only ever writes to it after a run that is not
 * "broken", so a diff never compares real content against a wall of nulls from
 * a scraper that was mid-failure.
 */
export class Snapshots {
  constructor(private readonly dir: string) {}

  private path(contractId: string): string {
    return join(this.dir, `${contractId}.json`);
  }

  async read(contractId: string): Promise<Row[] | null> {
    try {
      return JSON.parse(await readFile(this.path(contractId), "utf8")) as Row[];
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  }

  async write(contractId: string, rows: Row[]): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(contractId), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  }
}
