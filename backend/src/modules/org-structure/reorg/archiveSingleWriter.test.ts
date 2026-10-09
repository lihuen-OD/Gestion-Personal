import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AT-3 (docs/decisions/A8_M2_PREPARATION.md §12.1 I1/I3): `archivedAt` tiene
 * un único escritor — la transacción de limpieza (`scripts/org-reorg-cleanup.ts`)
 * y su reversión controlada (`scripts/org-reorg-restore.ts`). No existe
 * endpoint ni servicio de archivar/desarchivar, y ningún código de la app
 * escribe la columna. Los schemas de entrada la rechazan (orgStructure/positions
 * schemas tests); esto cubre lo que un test unitario por endpoint no ve.
 */
const backend = join(__dirname, "..", "..", "..", "..");
const src = join(backend, "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

const sources = files(src).map((path) => ({ path: relative(backend, path), text: readFileSync(path, "utf8") }));

describe("AT-3 — archivo de un solo escritor", () => {
  it("ninguna ruta HTTP expone archivar/desarchivar", () => {
    const routes = sources.filter((file) => file.path.endsWith(".routes.ts"));
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) expect(route.text, route.path).not.toMatch(/["'`][^"'`]*archiv[^"'`]*["'`]/i);
  });

  it("ningún código de la app escribe archivedAt (sólo lo lee o filtra)", () => {
    // Escrituras posibles: valor fecha/now en un objeto o en SQL crudo, o la columna dentro de `data:`.
    const write = /archivedAt"?\s*:\s*(new Date|now\(\)|Date\.now)|"archivedAt"\s*=\s*(now\(\)|\$\d|'|NULL)|SET\s+"archivedAt"|data:\s*\{[^}]*\barchivedAt\b/i;
    expect(sources.filter((file) => write.test(file.text)).map((file) => file.path)).toEqual([]);
  });

  it("ningún servicio de catálogo o de sus consumidores expone archivar/desarchivar", () => {
    // `storage.service.archive` (archivos de documentos) es otro concepto y queda fuera.
    const catalogModules = /src\/modules\/(org-structure|positions|employees|users|workforce-management|clock-devices)\//;
    const services = sources.filter((file) => catalogModules.test(file.path) && /\.(service|repository|controller)\.ts$/.test(file.path));
    expect(services.length).toBeGreaterThan(5);
    for (const service of services) expect(service.text, service.path).not.toMatch(/\b(un)?archive(Node|Record|Position|Catalog)?\s*\(|desarchiv/i);
  });

  it("los únicos escritores son la limpieza (archiva) y la restauración (revierte) — scripts, no la app", () => {
    const cleanup = readFileSync(join(backend, "scripts", "org-reorg-cleanup.ts"), "utf8");
    const restore = readFileSync(join(backend, "scripts", "org-reorg-restore.ts"), "utf8");
    expect(cleanup).toMatch(/SET "archivedAt" = \$2 WHERE id = \$1 AND "archivedAt" IS NULL/);
    expect(restore).toMatch(/SET "archivedAt" = NULL WHERE id = \$1 AND "archivedAt" IS NOT NULL/);
  });
});
