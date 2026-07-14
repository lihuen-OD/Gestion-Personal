import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const distDir = new URL("../dist/", import.meta.url);
const apiUrl = (process.env.PERF_API_URL || "http://127.0.0.1:4002/api").replace(/\/$/, "");
const period = process.env.PERF_PERIOD || new Date().toISOString().slice(0, 7);
const date = process.env.PERF_DATE || new Date().toISOString().slice(0, 10);

async function bundleReport() {
  const assetsDir = new URL("assets/", distDir);
  const names = await readdir(assetsDir);
  const assets = await Promise.all(names.map(async (name) => ({ name, bytes: (await stat(new URL(name, assetsDir))).size })));
  const indexHtml = await readFile(new URL("index.html", distDir), "utf8");
  const initialNames = [...indexHtml.matchAll(/(?:src|href)="\.?(\/assets\/[^"]+)"/g)].map((match) => match[1].split("/").pop());
  const initial = assets.filter((asset) => initialNames.includes(asset.name));
  return {
    initialBytes: initial.reduce((total, asset) => total + asset.bytes, Buffer.byteLength(indexHtml)),
    initialRequests: initial.length + 1,
    initial,
    largestChunks: assets.filter((asset) => asset.name.endsWith(".js")).sort((a, b) => b.bytes - a.bytes).slice(0, 12),
  };
}

async function timedFetch(path, token) {
  const startedAt = performance.now();
  const response = await fetch(`${apiUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const payload = await response.arrayBuffer();
  return { status: response.status, ms: Number((performance.now() - startedAt).toFixed(1)), bytes: payload.byteLength };
}

async function apiReport() {
  const email = process.env.PERF_EMAIL;
  const password = process.env.PERF_PASSWORD;
  if (!email || !password) return { skipped: "Set PERF_EMAIL and PERF_PASSWORD to measure authenticated API routes." };
  const login = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`Performance login failed with HTTP ${login.status}`);
  const { accessToken } = await login.json();
  const routes = [
    `/dashboard/metrics?period=${period}`,
    "/employees?page=1&take=25",
    "/employees/summary",
    `/time-entries/period-employees?period=${period}&page=1&take=25`,
    `/time-entries/summary?period=${period}`,
    `/time-entries/attendance?date=${date}`,
    "/novelties?page=1&take=25",
    "/documents?page=1&take=25",
    "/audit?page=1&take=25",
  ];
  const results = [];
  for (const route of routes) {
    const samples = [];
    for (let run = 0; run < 4; run += 1) samples.push(await timedFetch(route, accessToken));
    results.push({ route, cold: samples[0], warm: samples.slice(1) });
  }
  return results;
}

const report = {
  generatedAt: new Date().toISOString(),
  bundle: await bundleReport(),
  api: await apiReport(),
};

console.log(JSON.stringify(report, null, 2));
