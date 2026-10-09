import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AT-3 (docs/decisions/A8_M2_PREPARATION.md §12.1 I1/I3): `archivedAt` tiene
 * un único escritor — la transacción de limpieza (`reorg/cleanupTransaction.ts`,
 * invocada sólo por `scripts/org-reorg-cleanup.ts`) y su reversión controlada
 * (`reorg/restoreTransaction.ts`, invocada por `scripts/org-reorg-restore.ts`). No existe
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

  it("ningún código de la app escribe archivedAt salvo las dos transacciones de reorganización", () => {
    // Escrituras posibles: valor fecha/now en un objeto o en SQL crudo, o la columna dentro de `data:`.
    const write = /archivedAt"?\s*:\s*(new Date|now\(\)|Date\.now)|"archivedAt"\s*=\s*(now\(\)|\$\d|'|NULL)|SET\s+"archivedAt"|data:\s*\{[^}]*\barchivedAt\b/i;
    expect(sources.filter((file) => write.test(file.text)).map((file) => file.path).sort()).toEqual([
      "src/modules/org-structure/reorg/cleanupTransaction.ts",
      "src/modules/org-structure/reorg/restoreTransaction.ts",
    ]);
  });

  it("ningún servicio de catálogo o de sus consumidores expone archivar/desarchivar", () => {
    // `storage.service.archive` (archivos de documentos) es otro concepto y queda fuera.
    const catalogModules = /src\/modules\/(org-structure|positions|employees|users|workforce-management|clock-devices)\//;
    const services = sources.filter((file) => catalogModules.test(file.path) && /\.(service|repository|controller)\.ts$/.test(file.path));
    expect(services.length).toBeGreaterThan(5);
    for (const service of services) expect(service.text, service.path).not.toMatch(/\b(un)?archive(Node|Record|Position|Catalog)?\s*\(|desarchiv/i);
  });

  it("los únicos escritores son la limpieza (archiva) y la restauración (revierte), y sólo los invocan sus scripts con la compuerta D-0", () => {
    const reorg = join(src, "modules", "org-structure", "reorg");
    expect(readFileSync(join(reorg, "cleanupTransaction.ts"), "utf8")).toMatch(/SET "archivedAt" = \$2 WHERE id = \$1 AND "archivedAt" IS NULL/);
    expect(readFileSync(join(reorg, "restoreTransaction.ts"), "utf8")).toMatch(/SET "archivedAt" = NULL WHERE id = \$1 AND "archivedAt" IS NOT NULL/);
    // Ningún módulo de la app importa las transacciones (sólo los scripts y sus pruebas).
    const importers = sources.filter((file) => /reorg\/(cleanupTransaction|restoreTransaction)"/.test(file.text) && !/reorg\/(cleanupTransaction|restoreTransaction)\.ts$/.test(file.path));
    expect(importers.map((file) => file.path)).toEqual([]);
    for (const script of ["org-reorg-cleanup.ts", "org-reorg-restore.ts"]) {
      const text = readFileSync(join(backend, "scripts", script), "utf8");
      expect(text.indexOf("requireVerifiedIdentity(target.identity)"), script).toBeGreaterThan(-1);
      expect(text.indexOf("requireVerifiedIdentity(target.identity)"), script).toBeLessThan(text.indexOf("await import(\"../src/modules/org-structure/reorg/"));
    }
  });
});
