/**
 * Manifiesto por fila (SÓLO LECTURA) y verificación V2
 * (docs/decisions/ORG_LOCATION_REORGANIZATION.md §5.4).
 *
 *   Capturar (B0, B3 antes de aplicar, tras la limpieza, tras la recarga):
 *     npx tsx scripts/org-reorg-manifest.ts capture --env-file=<archivo> --expected-host=<host> --out=<archivo.json>
 *   Verificar V2 (tras la recarga) contra el manifiesto posterior a la limpieza:
 *     npx tsx scripts/org-reorg-manifest.ts verify-v2 --baseline=<manifiesto.json> --current=<manifiesto.json> --report=<archivo.json>
 *
 * V1 no se corre aparte: la limpieza la verifica dentro de su transacción,
 * antes del commit. El manifiesto guarda hashes y, en claro, sólo columnas
 * vigiladas (vínculos y datos laborales); nunca credenciales. Contiene IDs de
 * legajos: guardarlo fuera del repositorio.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { arg, captureRowManifest, connectTarget, readOnly } from "./org-reorg/lib";
import { verifyV2, type RowManifest } from "../src/modules/org-structure/reorg/manifest";

async function capture() {
  const out = arg("out");
  if (!out) throw new Error("Falta --out=<archivo.json> (fuera del repositorio).");
  const target = await connectTarget();
  try {
    const manifest = await readOnly(target.prisma, (tx) => captureRowManifest(tx, target.host));
    writeFileSync(out, JSON.stringify({ ...manifest, neonIdentity: target.identity }, null, 2));
    const rows = Object.values(manifest.tables).reduce((sum, table) => sum + Object.keys(table.rows).length, 0);
    console.log(JSON.stringify({ host: target.host, identidadNeon: target.identity.status, tablas: Object.keys(manifest.tables).length, filas: rows, out }, null, 2));
  } finally {
    await target.prisma.$disconnect();
  }
}

function verify() {
  const load = (name: string) => {
    const path = arg(name);
    if (!path) throw new Error(`Falta --${name}=<manifiesto.json>.`);
    return JSON.parse(readFileSync(path, "utf8")) as RowManifest;
  };
  const baseline = load("baseline");
  const current = load("current");
  if (baseline.host !== current.host) throw new Error(`Los manifiestos son de destinos distintos (${baseline.host} / ${current.host}).`);
  const summary = verifyV2(baseline, current);
  const reportPath = arg("report");
  if (reportPath) writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ violaciones: summary.violations.length, cambiosLaborales: summary.laborChanges, filasNuevas: summary.newRowsByTable }, null, 2));
  if (summary.violations.length) process.exitCode = 2;
}

const mode = process.argv[2];
(mode === "capture" ? capture() : mode === "verify-v2" ? Promise.resolve(verify()) : Promise.reject(new Error("Modo: capture | verify-v2"))).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
