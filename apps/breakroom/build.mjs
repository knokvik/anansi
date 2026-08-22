#!/usr/bin/env node
/**
 * Renders the Break Room target page from one dataset into one of two layouts.
 *
 *   node apps/breakroom/build.mjs v1   # the layout the scraper was built against
 *   node apps/breakroom/build.mjs v2   # the "overnight redesign"
 *
 * The dataset never changes between layouts. That is the point of the demo: the
 * facts on the page are identical, so any field that stops extracting stopped
 * because of markup drift and nothing else.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const LAYOUTS = ["v1", "v2"];

const styles = `
  :root { color-scheme: light dark; --bg:#0d1117; --fg:#e6edf3; --muted:#8b949e; --line:#30363d; --accent:#7ee787; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.6 ui-sans-serif,-apple-system,"Segoe UI",sans-serif; }
  .wrap { max-width:900px; margin:0 auto; padding:48px 24px; }
  h1 { font-size:28px; margin:0 0 4px; letter-spacing:-0.02em; }
  .sub { color:var(--muted); margin:0 0 32px; }
  .note { color:var(--muted); font-size:13px; margin-top:40px; border-top:1px solid var(--line); padding-top:16px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); border-bottom:1px solid var(--line); padding:8px 12px; }
  td { padding:12px; border-bottom:1px solid var(--line); }
  .price { font-variant-numeric:tabular-nums; }
  .tier-grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); }
  .tier-card { border:1px solid var(--line); border-radius:12px; padding:20px; }
  .tier-card h2 { font-size:17px; margin:0 0 12px; }
  .tier-meta { display:grid; grid-template-columns:auto 1fr; gap:4px 16px; margin:0; font-size:14px; }
  .tier-meta dt { color:var(--muted); }
  .tier-meta dd { margin:0; text-align:right; font-variant-numeric:tabular-nums; }
  .badge { display:inline-block; margin-top:14px; font-size:12px; color:var(--accent); border:1px solid var(--line); border-radius:999px; padding:2px 10px; }
`;

async function main() {
  const layout = process.argv[2] ?? "v1";
  if (!LAYOUTS.includes(layout)) {
    console.error(`Unknown layout "${layout}". Expected one of: ${LAYOUTS.join(", ")}`);
    process.exit(1);
  }

  const data = JSON.parse(await readFile(join(here, "models.json"), "utf8"));
  const { render, description } = await import(join(here, "layouts", `${layout}.mjs`));

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${data.vendor} — Model Pricing</title>
<meta name="anansi-layout" content="${layout}">
<style>${styles}</style>
</head>
<body>
${render(data)}
</body>
</html>
`;

  const out = join(here, "public");
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "index.html"), html, "utf8");
  await writeFile(join(out, "layout.json"), JSON.stringify({ layout, description }, null, 2) + "\n", "utf8");
  console.log(`Break Room rendered with layout ${layout} (${description}).`);
}

await main();
