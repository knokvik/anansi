# Anansi — UI plan

What the interface shows, what it deliberately doesn't, and why.

## The problem this plan solves

The dashboard can currently *describe* the loop (the "How it works" section) and
show its *outcome* (scores, cards, ledger). What it cannot do is show the loop
**happening**. A heal takes minutes; today the page sits still through all of
it and then reveals a finished answer. The most interesting thing the system
does is the thing a viewer never sees.

That is the gap this plan is written against.

## Principles

1. **Show the decision, not just the result.** A score of `1.00` is not
   interesting. `0.60 → rejected → 1.00`, with the reasoning, is.
2. **Never fake progress.** No simulated timers, no spinners implying activity
   that isn't happening. If a stage's duration is unknown, say it's running —
   don't animate a fake percentage. A system whose whole premise is "verify
   against reality" cannot have a lying progress bar.
3. **Latest state up top, evidence below.** Someone glancing gets the verdict;
   someone auditing scrolls for the trail.
4. **Absence is information.** A skipped stage (cache hit → no scrape) should
   read as deliberately skipped, not as broken or missing.
5. **One design system.** A Radar topic and a scheduled collector use the same
   card, the same pills, the same timeline. They differ in origin, not kind.

## Screen structure

### Landing — one screen, no scroll
| Show | Don't show |
| --- | --- |
| Shader hero, headline, credit, single launch control | Feature lists, stats, marketing sections |

Rationale: the landing has one job — state the problem and get out of the way.
Everything explanatory lives behind the launch, where there's context for it.

### Dashboard — top to bottom

| # | Section | Shows | Deliberately omits |
| --- | --- | --- | --- |
| 1 | **Masthead** | Fleet count, meeting-contract ratio, fleet score, theme + home | Per-collector detail — that's below |
| 2 | **Live pipeline** | Which stage is running *now*, which completed, which were skipped | Fake percentages or ETAs |
| 3 | **Answer** | The result of the last ask, with novelty badges | Raw envelopes, internal IDs beyond the Collector ID |
| 4 | **Metrics** | Tracked count, avg score, standing topics, session asks, cache-hit rate | Vanity counts with no decision attached |
| 5 | **How it works** | The six stages as static explanation | — |
| 6 | **Reading this dashboard** | What each panel means | — |
| 7 | **What's built** | 12 capability cards | Roadmap items — built only |
| 8 | **Collector cards** | Score, per-field fill, symptoms | Fields that are healthy *and* unremarkable get no commentary |
| 9 | **Radar topics** | Query, freshness window, TTL, rows, novelty deltas | Topics never asked |
| 10 | **Scraper activity** | Last ~8 things the system did | Full history — that's the log |
| 11 | **Decision log** | Every event, verbatim heal prompt, gate reasoning | Nothing; this is the audit surface and stays complete |
| 12 | **Composer** | Docked input, mode hint | Hidden entirely without a local backend |

## Making the process visible (the actual gap)

Today the pipeline strip is set **once**, after `/api/ask` returns, from the
final status. It is a summary, not a live view.

**Planned:** stream stage transitions as they happen.

- `resolveQuery` already logs each step through its injected `log` callback and
  writes a ledger event per stage. Both are emitted *during* the run.
- The server would expose these over Server-Sent Events (`GET /api/ask/stream`)
  rather than only returning at the end.
- The pipeline strip subscribes and lights each stage as its event arrives.

**Per-stage display contract:**

| Stage | Live detail to surface | Terminal state |
| --- | --- | --- |
| Cache check | topic key, age vs TTL | `done` (miss) / `done` + skip rest (hit) |
| Scraping | collector ID, target URL, elapsed | `done` with row count |
| Scoring | score as computed, per-field verdicts | `done` healthy / `warn` degraded / `fail` broken |
| Diagnose | the generated prompt, verbatim, as it's built | `done` with targeted fields |
| Heal | that it's parked at the approval gate | `done` awaiting decision |
| Gate | the comparison driving the decision | `approve` / `reject` + reason |
| Verify | fresh run score vs before | `done` healed / `fail` unverified |

The heal stage is minutes long. It shows *elapsed time and current step*, never
a predicted completion — we don't know one.

## States every surface must handle

| State | Treatment |
| --- | --- |
| Empty (nothing run yet) | Explain the command that produces data, not a bare "no data" |
| Static deployment (no backend) | Composer hidden entirely; read-only feed; no live dots |
| Cache hit | Downstream stages marked `skip`, visibly distinct from `fail` |
| Gate rejected | Prominent, not buried — a refused fix is a *success* of the gate |
| Heal unverified | Strongest warning state: approved but still failing |
| Unknown topic, live mode | Explain the real constraint, not a generic error |

## What this UI will never do

- Show a Bright Data API key, or any credential, anywhere.
- Offer a public button that spends credits. The interactive server is
  local-only by design; the deployed page is read-only.
- Present replayed fixture data as live. Replay mode says so in the hint.
- Round a failing score up, or hide a symptom to keep a card looking green.

## Build order

1. ✅ Static structure, theme, cards, metrics, activity, decision log
2. ✅ Coarse pipeline summary derived from the real result
3. ✅ "How it works" + "Reading this dashboard" explanatory sections
4. ⬜ SSE stage streaming — the live pipeline described above
5. ⬜ Per-stage detail panel (prompt as it's written, gate comparison)
6. ⬜ Optional URL + collector inputs, so live mode can bootstrap new topics
