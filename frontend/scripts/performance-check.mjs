import { readFile, stat } from "node:fs/promises";

const distDir = new URL("../dist/", import.meta.url);
const html = await readFile(new URL("index.html", distDir), "utf8");
const assetPaths = [...html.matchAll(/(?:src|href)="\.?(\/assets\/[^"]+)"/g)].map((match) => match[1]);
const assets = await Promise.all(assetPaths.map(async (path) => ({
  path,
  bytes: (await stat(new URL(`.${path}`, distDir))).size,
  source: path.endsWith(".js") ? await readFile(new URL(`.${path}`, distDir), "utf8") : "",
})));
const totalBytes = Buffer.byteLength(html) + assets.reduce((total, asset) => total + asset.bytes, 0);
const forbidden = ["tasks-vision", "mockEmployees", "attendance-punches/", "xlsx", "leaflet"];
const violations = forbidden.filter((token) => assets.some((asset) => asset.source.includes(token)));

if (totalBytes > 400_000) throw new Error(`Initial bundle ${totalBytes} B exceeds the 400000 B budget.`);
if (violations.length) throw new Error(`Initial bundle contains deferred modules: ${violations.join(", ")}`);

console.log(`Performance budget OK: ${totalBytes} B in ${assets.length + 1} initial requests; heavy modules deferred.`);
