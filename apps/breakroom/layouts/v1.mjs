/**
 * Layout v1 — a conventional pricing table.
 *
 * Every value lives in a semantic <td> with a stable class name, which is
 * exactly the shape a generated scraper will anchor its selectors on.
 */
export const description = "table layout, class-based selectors";

export function render({ vendor, models, note }) {
  const rows = models
    .map(
      (model) => `
        <tr class="pricing-row">
          <td class="model-name">${model.name}</td>
          <td class="price input-price">$${model.input.toFixed(2)}</td>
          <td class="price output-price">$${model.output.toFixed(2)}</td>
          <td class="context-window">${model.context.toLocaleString("en-US")}</td>
          <td class="lifecycle">${model.status}</td>
        </tr>`,
    )
    .join("");

  return `
    <main class="wrap">
      <h1>${vendor} — Model Pricing</h1>
      <p class="sub">Prices are per million tokens, in USD.</p>
      <table class="pricing-table">
        <thead>
          <tr><th>Model</th><th>Input</th><th>Output</th><th>Context</th><th>Status</th></tr>
        </thead>
        <tbody>${rows}
        </tbody>
      </table>
      <p class="note">${note}</p>
    </main>`;
}
