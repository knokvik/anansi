# Fixtures

Replayed by `anansi ... --replay ./fixtures` so the full detect → heal → verify
cycle can be demonstrated without a Bright Data account or spending a credit.

`fixtures/breakroom-pricing/` is a hand-authored illustrative example — five
rows, each field individually annotated as broken or fixed — chosen for how
clearly it teaches the loop, not copied byte-for-byte off the wire. The real
envelope shape is messier (see below) and makes for a worse first read.

| File | What it represents |
| --- | --- |
| `run.1.json` | The first run, after the target page changed layout. Prices come back `null`. |
| `heal.json` | The approval-gate envelope from `bdata scraper heal`, carrying preview rows. |
| `run.2.json` | The verification run after the gate approved the fix. |

Capture a real one with `node scripts/capture-fixtures.mjs <contract-id> run <collector_id> <url>`
(and the `heal` mode for `heal.json`) — this shells out to the live CLI and
writes back through the exact same envelope-parsing code path production uses,
so a captured fixture can't silently drift from what a real run actually
returns. Bright Data's Discovery-type envelope, for reference, is one row per
*page* with the real list nested inside an unpredictable field name —
`[{ "models": [...] }]`, not a flat array of items — which is exactly the
shape [payload.ts](../apps/cli/src/payload.ts) exists to unwrap.
