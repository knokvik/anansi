/**
 * Layout v2 — the redesign.
 *
 * The data is byte-for-byte the same as v1. Only the markup moved: the table
 * became a card grid, the class names were renamed, and the prices are now split
 * across a currency span and an amount span behind `data-test` attributes.
 * A selector-based scraper written against v1 returns nulls here and says nothing.
 */
export const description = "card grid, data-test attributes, split price nodes";

export function render({ vendor, models, note }) {
  const cards = models
    .map(
      (model) => `
        <article class="tier-card">
          <h2 data-test="tier-title">${model.name}</h2>
          <dl class="tier-meta">
            <dt>Input</dt>
            <dd data-test="cost-in"><span class="ccy">$</span><span class="amount">${model.input.toFixed(2)}</span></dd>
            <dt>Output</dt>
            <dd data-test="cost-out"><span class="ccy">$</span><span class="amount">${model.output.toFixed(2)}</span></dd>
            <dt>Context</dt>
            <dd data-test="ctx">${model.context.toLocaleString("en-US")} tokens</dd>
          </dl>
          <span class="badge" data-test="lifecycle">${model.status}</span>
        </article>`,
    )
    .join("");

  return `
    <main class="wrap">
      <h1>${vendor} — Model Pricing</h1>
      <p class="sub">Prices are per million tokens, in USD.</p>
      <section class="tier-grid">${cards}
      </section>
      <p class="note">${note}</p>
    </main>`;
}
