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

## Proof, not a demo

Everything below actually happened, against a real Bright Data collector —
[`c_mt59mh6q1omairtns1`](https://brightdata.com/cp/scrapers/c_mt59mh6q1omairtns1),
created with `bdata scraper create` against
[the Break Room](https://knokvik.github.io/anansi/), a target page this
repository controls:

1. **It broke.** The Break Room's layout flipped from a table (`v1`) to a card
   grid (`v2`) — same data, different markup. The collector, built against
   `v1`, came back empty.
2. **A bad fix got rejected.** The auto-generated heal prompt — assembled from
   the contract's own field descriptions, no human involved — didn't specify
   what actually changed. `bdata scraper heal` proposed a fix; the gate
   re-scored the preview, found the targeted fields still empty, and called
   `bdata scraper approve --reject`. Nothing was saved.
3. **A specific fix got approved.** A prompt describing the real change (card
   grid, `data-test` attributes) produced a working fix. The gate re-scored
   it, confirmed every field recovered with no regressions, and approved it
   for real.
4. **It's verified, live, right now.** `anansi watch` scores the same
   contract against the same Collector ID at **1.00** — 5/5 fields, 5/5 rows —
   against the redesigned page. Nothing downstream was ever repointed.

Reproduce it yourself: `pnpm anansi watch --contract breakroom-pricing`
(needs `bdata login`) — or see it without any credentials at all via
`pnpm anansi watch --replay ./fixtures`.

Three real bugs surfaced only by doing this — not by unit testing alone — and
are documented, root-caused, and fixed in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#what-phase-1-actually-taught-us).

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

## Radar — ask on demand

The engine above runs on a schedule, against contracts someone wrote ahead of
time. Radar puts a question in front of it instead:

```bash
pnpm anansi ask "nimbus ai model pricing" --url <url> --collector <c_id>
```

- **Cache first, always.** A repeat ask inside its freshness window is served
  from disk — zero network calls, zero credits. Verified: the second identical
  `ask` above makes no `bdata` call at all.
- **A new topic bootstraps its own contract.** No YAML to write first: the
  first successful run infers field types and required-ness from what it
  actually returned, and that becomes the standard every later run is held to.
  Self-healing without anyone hand-authoring a schema.
- **What's new, not just what exists.** Every re-check diffs against the last
  known-good snapshot by identity key and reports new / changed / removed
  rows — `detectNovelty` in `packages/core`.
- **The re-check interval learns.** A topic that keeps coming back unchanged
  has its TTL widened; one that's moving fast gets narrowed — `adjustTtl`,
  driven by the same novelty signal, not a fixed schedule.
- **Not scheduled just for existing.** A bootstrapped topic shares the fleet's
  `contracts/` directory but stays out of the unattended nightly sweep until
  it's been asked more than once (`KnowledgeEntry.standing`).

Try it interactively: `pnpm dashboard:replay` (no credentials) or
`pnpm dashboard` (live) opens a real search bar at `localhost:4322` — type a
question, watch the pipeline (cache → scrape → score → heal → done), see the
result. This only ever runs locally; see [Quick start](#quick-start).

Full design, including the cost-tiered escalation logic that's built and
tested but not yet wired to a live second scraper tier: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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

Then open the dashboard — a live, queryable one, not just a static read of the feed:

```bash
pnpm dashboard:replay   # search bar works too; every query returns the Break Room dataset
```

Open http://localhost:4322 and type a question into the search bar — e.g. `nimbus ai model pricing`.
The interactive server only ever runs on your own machine: a public page with a button
that spends someone else's Bright Data credits on a stranger's query is a bad idea, so
this never gets deployed. `apps/dashboard/feed.json` (the static, pre-generated snapshot)
is what ships to GitHub Pages instead.

**Against live collectors**, once you have authenticated:

```bash
npx -p @brightdata/cli bdata login
pnpm anansi check     # detect and report; never spends credits on a heal
pnpm anansi watch     # detect, heal, gate, verify
pnpm dashboard        # same interactive dashboard, now against real Bright Data
pnpm anansi ask "nimbus ai model pricing" --url <url> --collector <c_id>  # a new topic, bootstrapped on the spot
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
                       the supervisor loop, the ledger, novelty diffing, Radar's
                       bootstrap/freshness/escalation logic - pure, no I/O, unit tested
apps/cli/              the `anansi` binary and the Bright Data CLI adapter
apps/dashboard/        the dashboard - a static feed on GitHub Pages, or interactive
                       (server.mjs) with a real search bar when run locally
apps/breakroom/        the controllable target page
contracts/             one *.contract.yaml per collector
fixtures/              a hand-authored illustrative example for credential-free replay
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
