import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { Contract } from "./schema.js";

export class ContractError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${basename(path)}: ${message}`);
    this.name = "ContractError";
  }
}

export async function loadContract(path: string): Promise<Contract> {
  let raw: unknown;
  try {
    raw = parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw new ContractError(path, `could not be parsed as YAML — ${(cause as Error).message}`);
  }

  const parsed = Contract.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new ContractError(path, detail);
  }
  return parsed.data;
}

/** Load every `*.contract.yaml` in a directory, sorted by id for stable output. */
export async function loadContracts(dir: string): Promise<Contract[]> {
  const entries = await readdir(dir);
  const files = entries.filter((name) => name.endsWith(".contract.yaml")).map((n) => join(dir, n));
  const contracts = await Promise.all(files.map(loadContract));
  return contracts.sort((a, b) => a.id.localeCompare(b.id));
}
