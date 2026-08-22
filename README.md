# Anansi

**A self-healing control plane for Bright Data Scraper Studio.**

Scraper Studio can repair a broken scraper from a plain-language prompt. It cannot
tell you that the scraper broke, write that prompt for you, or check whether the
repair actually worked. Today that is a person noticing `undefined` in a preview.

Anansi is the loop around it:

```
run -> score against a contract -> describe what broke -> heal -> gate the fix -> verify -> ledger
```

Same `c_*` Collector ID throughout. Nothing downstream is ever repointed.

---

## The problem

A scraper does not fail loudly. When a site renames a class or moves a field, the
collector keeps returning rows — the right number of them, with the right keys —
and every value inside is empty. Dashboards keep rendering. Pipelines keep
running. The data is gone and nothing raises a hand.

Every scraping tutorial ends when the scraper runs. This one starts when it breaks.

## What Anansi adds

| | Scraper Studio alone | With Anansi |
| --- | --- | --- |
| Noticing breakage | A human spots `undefined` in a preview | Every run is scored against a field contract |
| Writing the heal prompt | A human types it from memory | Generated from the contract plus the observed symptoms |
| Approving the fix | `--auto-approve`, or a human reads the diff | The proposal is re-scored against the same contract, and rejected if it does not hold |
| Knowing it worked | Assumed | A verification run must pass before the outcome is called healed |
| Audit trail | — | Append-only ledger of every run, prompt, gate decision and outcome |

### The contract is the load-bearing idea

One YAML file per collector describes each field in plain language, along with the
fill rate and types it must satisfy:

```yaml
- name: input_price_usd_per_mtok
  description: Price in US dollars to process one million input tokens, as a plain number
  type: number
  minFillRate: 1.0
  min: 0
```

That `description` does double duty. It documents the field for humans, and it is
the exact text handed to `bdata scraper heal` when the field stops extracting. A
healed scraper is therefore pulled back toward what the contract promised, rather
than toward whatever the model infers the page is about.

### The gate is the part people skip

`bdata scraper heal` parks at an approval gate. The tempting shortcut is
`--auto-approve`, which trades one silent failure for another: a fix that
confidently extracts the wrong thing gets saved and nothing notices.

Anansi re-scores the proposed output against the same contract that caught the
breakage and calls `bdata scraper approve --reject` when the fix:

- leaves a targeted field empty,
- repairs its target but breaks a field that was previously healthy, or
- does not improve the contract score at all.

## Quick start

```bash
pnpm install
pnpm build
```

**See the whole loop without a Bright Data account** — replays recorded envelopes,
spends nothing:

```bash
pnpm anansi watch --replay ./fixtures
pnpm anansi report
```

Then open the dashboard:

```bash
python3 -m http.server 4322 -d apps/dashboard
```

**Against live collectors**, once you have authenticated:

```bash
npx -p @brightdata/cli bdata login
pnpm anansi check     # detect and report; never spends credits on a heal
pnpm anansi watch     # detect, heal, gate, verify
```

## Commands

| Command | What it does | Exit code |
| --- | --- | --- |
| `anansi contracts` | Validate every contract and print the fleet | `0` valid, `2` invalid |
| `anansi check` | Run and score. Diagnoses, never heals. | `0` all healthy, `1` something is broken |
| `anansi watch` | The full detect -> heal -> gate -> verify cycle | `0` healthy or healed, `1` unresolved |
| `anansi report` | Summarise the ledger and write the dashboard feed | `0` |

Useful flags: `--contract <id>` to limit the sweep, `--replay <dir>` to use
fixtures, `--verbose` to echo every Bright Data CLI invocation.

## The Break Room

Healing is only convincing if you can watch it happen, and you cannot ask a real
site to redesign itself on demand. So the repository ships a target page it
controls — `apps/breakroom` — rendered from one dataset into two layouts:

- **v1** — a pricing table with class-based selectors.
- **v2** — the same numbers as a card grid behind `data-test` attributes.

The data is identical between them. Only the markup moves, so any field that stops
extracting stopped for exactly one reason. See [apps/breakroom/README.md](apps/breakroom/README.md).

## Layout

```
packages/core/         contracts, health scoring, heal-prompt synthesis, the gate,
                       the supervisor loop, the ledger - pure, no I/O, unit tested
apps/cli/              the `anansi` binary and the Bright Data CLI adapter
apps/dashboard/        static dashboard rendered from the ledger feed
apps/breakroom/        the controllable target page
contracts/             one *.contract.yaml per collector
fixtures/              recorded envelopes for credential-free replay
```

`packages/core` never touches the network. The supervisor talks to a `ScraperClient`
interface, which the CLI satisfies with the real `bdata` binary and the tests
satisfy with a scripted fake — so the decision logic is exercised without spending
a credit.

## Tests

```bash
pnpm test
```

## Collector IDs

Live Collector IDs are recorded in [docs/COLLECTORS.md](docs/COLLECTORS.md) and pinned in
[CLAUDE.md](CLAUDE.md) so a coding agent runs the existing scraper instead of rebuilding one.

## Credentials

Nothing in this repository reads a key from disk by default. `bdata login` stores
an OAuth session in the CLI's own config; `.env` is gitignored and only needed for
CI. Never commit a key, and mask it in any recording.

## License

MIT — see [LICENSE](LICENSE).
