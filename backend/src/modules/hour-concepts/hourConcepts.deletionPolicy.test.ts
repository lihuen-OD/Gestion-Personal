import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §14: Deshabilitar = INACTIVO
// (conserva historia); Eliminar = borrado físico. HourConcept ya no tiene baja
// lógica, así que un código eliminado queda libre para reutilizarse.
describe("HourConcept sin baja lógica (migración 20261003100000)", () => {
  const sql = readFileSync("prisma/migrations/20261003100000_drop_hour_concept_deleted_at/migration.sql", "utf8");

  it("el schema ya no tiene deletedAt en HourConcept", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const model = schema.slice(schema.indexOf("model HourConcept {"), schema.indexOf("model EmployeeHourConcept {"));
    expect(model).not.toMatch(/^\s*deletedAt\s/m);
  });

  it("las filas dadas de baja con la política anterior quedan como Deshabilitadas: no se borra ni reinterpreta nada", () => {
    expect(sql).toMatch(/UPDATE "HourConcept"\s+SET "status" = 'INACTIVO'\s+WHERE "deletedAt" IS NOT NULL/);
    expect(sql).not.toMatch(/DELETE FROM/i);
    expect(sql).not.toMatch(/"HourConceptBreakdown"|"TimeEntry"|"TimeSegment"/);
  });

  it("recrea el CHECK del modelo oficial sin deletedAt antes de que Postgres lo descarte con la columna", () => {
    const dropCheck = sql.indexOf('DROP CONSTRAINT "HourConcept_official_model_check"');
    const dropColumn = sql.indexOf('DROP COLUMN "deletedAt"');
    const addCheck = sql.indexOf('ADD CONSTRAINT "HourConcept_official_model_check"');
    expect(dropCheck).toBeGreaterThan(-1);
    expect(dropCheck).toBeLessThan(dropColumn);
    expect(dropColumn).toBeLessThan(addCheck);
    const check = sql.slice(addCheck);
    expect(check).not.toContain("deletedAt");
    expect(check).toContain("\"systemRole\" = 'NORMAL_BASE'");
    expect(check).toContain("\"loadMode\" IS NOT NULL");
  });
});
