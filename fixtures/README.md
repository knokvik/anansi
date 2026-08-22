# Fixtures

Recorded Bright Data envelopes, replayed by `anansi ... --replay ./fixtures` so the
full detect → heal → verify cycle can be demonstrated without an account or credits.

| File | What it represents |
| --- | --- |
| `run.1.json` | The first run, after the target page changed layout. Prices come back `null`. |
| `heal.json` | The approval-gate envelope from `bdata scraper heal`, carrying preview rows. |
| `run.2.json` | The verification run after the gate approved the fix. |

Regenerate from live runs with `node scripts/capture-fixtures.mjs <contract-id>`.
