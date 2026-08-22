# Collectors

Every scraper Anansi supervises, its Bright Data Collector ID, and how it was created.

A Collector ID is a production endpoint: it is triggerable with `POST /dca/trigger`
from any language or scheduler, with no deployment step. Healing never changes it.

| Contract | Collector ID | Type | Target | Created |
| --- | --- | --- | --- | --- |
| `breakroom-pricing` | `c_pendingcreate` | Discovery | https://knokvik.github.io/anansi/ | pending |

## Creating a collector

```bash
npx -p @brightdata/cli bdata scraper create \
  https://knokvik.github.io/anansi/ \
  "For each model listed, extract model_name, input_price_usd_per_mtok, output_price_usd_per_mtok, context_window_tokens and lifecycle_status." \
  --name breakroom-pricing --pretty
```

Generation takes 5–15 minutes, up to 25 for a complex site. Record the returned
`c_*` id here, in `CLAUDE.md`, and in the matching `contracts/*.contract.yaml`.

## Running one by hand

```bash
npx -p @brightdata/cli bdata scraper run <collector_id> <url> --pretty
```

Prefer `pnpm anansi check` — it runs the same collector and scores the result
against its contract instead of leaving you to eyeball the JSON.
