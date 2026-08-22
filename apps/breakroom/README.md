# The Break Room

A target page we control, so a layout change can be triggered on demand instead of
waiting for a real site to redesign itself overnight.

`models.json` holds the data. `layouts/v1.mjs` and `layouts/v2.mjs` render that same
data into two completely different DOMs:

| | v1 | v2 |
| --- | --- | --- |
| Structure | `<table class="pricing-table">` | `<section class="tier-grid">` of `<article>` cards |
| Model name | `td.model-name` | `h2[data-test="tier-title"]` |
| Price | `td.price.input-price` — one node, `$15.00` | `dd[data-test="cost-in"]` — split into `.ccy` and `.amount` |
| Context | `td.context-window` — `200,000` | `dd[data-test="ctx"]` — `200,000 tokens` |

**The numbers are identical between layouts.** Only the markup moves. So when a
field stops extracting, there is exactly one possible cause, which is what makes
this a clean demonstration rather than a coincidence.

## Flipping the layout

```bash
node apps/breakroom/build.mjs v2   # the "overnight redesign"
node apps/breakroom/build.mjs v1   # put it back
```

Commit and push `apps/breakroom/public/` to redeploy GitHub Pages, then run
`pnpm anansi watch` and watch the loop notice, repair, and verify.

Serve it locally with `pnpm breakroom` (http://localhost:4321).

> Nimbus AI is fictional. This page exists only as a scraping target for the demo.
