# Anansi — agent rules

## Pinned collectors

**Do not create a new scraper.** These already exist. Run and heal them by ID.

| Contract | Collector ID | Target |
| --- | --- | --- |
| `breakroom-pricing` | `c_pendingcreate` | https://knokvik.github.io/anansi/ |

## Working with Bright Data

Always go through npx so nothing is installed globally:

```bash
npx -p @brightdata/cli bdata scraper run <collector_id> <url> --pretty
npx -p @brightdata/cli bdata scraper heal <collector_id> "<what broke>" --url <url>
npx -p @brightdata/cli bdata scraper approve <collector_id>          # or --reject
```

Prefer the `anansi` CLI over raw `bdata` for anything involving a decision — it
scores the result against the contract and records the outcome in the ledger.

## Rules

- `packages/core` stays free of I/O. Network and filesystem work belongs in `apps/cli`.
- Never pass `--auto-approve` to `bdata scraper heal`. The gate in
  `packages/core/src/heal/gate.ts` decides, and it needs the preview to decide on.
- Field descriptions in `contracts/*.contract.yaml` are heal instructions. Edit
  them as carefully as code.
- Never commit `.env` or paste a Bright Data key into a file, a log, or a recording.
