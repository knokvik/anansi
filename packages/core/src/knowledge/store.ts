import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeEntry } from "./types.js";

/**
 * The persisted answer for each topic Radar has ever resolved. This is the
 * cache the Value Gate checks before anything reaches the network — most of
 * "a ton of data on the web" is data already paid for once.
 */
export class KnowledgeStore {
  constructor(private readonly dir: string) {}

  private path(topicKey: string): string {
    return join(this.dir, `${topicKey}.json`);
  }

  async read(topicKey: string): Promise<KnowledgeEntry | null> {
    try {
      return JSON.parse(await readFile(this.path(topicKey), "utf8")) as KnowledgeEntry;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  }

  async write(entry: KnowledgeEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(entry.topicKey), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  }

  async list(): Promise<KnowledgeEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
    const entries = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => readFile(join(this.dir, name), "utf8").then((text) => JSON.parse(text) as KnowledgeEntry)),
    );
    return entries.sort((a, b) => a.topicKey.localeCompare(b.topicKey));
  }
}
