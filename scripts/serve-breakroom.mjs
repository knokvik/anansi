#!/usr/bin/env node
/** Serves the rendered Break Room locally so you can eyeball a layout flip. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../apps/breakroom/public/", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 4321);

createServer(async (req, res) => {
  const path = req.url === "/" ? "index.html" : req.url.replace(/^\//, "").split("?")[0];
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { "content-type": path.endsWith(".json") ? "application/json" : "text/html" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`Break Room on http://localhost:${port}`));
