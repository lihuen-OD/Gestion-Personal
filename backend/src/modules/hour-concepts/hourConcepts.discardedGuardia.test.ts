import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// HC-GUARDIA (Guardia) fue descartado por negocio (misma idea que Sereno) y
// eliminado físicamente — docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §10.
// Regresión: el seed lo reactivaba en cada corrida (segunda baja lógica del
// 2026-08-25), y la migración de tratamiento lo mapeaba como concepto real.
describe("HC-GUARDIA descartado", () => {
  it("el seed ya no lo crea ni lo reactiva", () => {
    const seed = readFileSync("prisma/seed.ts", "utf8");
    expect(seed).not.toMatch(/code:\s*"HC-GUARDIA"/);
    expect(seed).not.toMatch(/name:\s*"Guardia"/);
  });

  it("el backfill de workTreatment no lo mapea y lo elimina antes del guard, sólo sin historial real", () => {
    const sql = readFileSync("prisma/migrations/20261002120000_add_hour_concept_work_treatment/migration.sql", "utf8");
    const backfill = sql.slice(sql.indexOf("-- Backfill de metadata"));
    expect(backfill).not.toContain("HC-GUARDIA");
    expect(sql.indexOf("DELETE FROM \"HourConcept\" WHERE \"id\" = guardia_id")).toBeLessThan(sql.indexOf("-- Backfill de metadata"));
    expect(sql).toContain("RAISE EXCEPTION 'HC-GUARDIA tiene historial real");
  });

  it("la migración de limpieza protege el historial (horas, segmentos, turnos, novedades, desgloses y referencias por regla)", () => {
    const sql = readFileSync("prisma/migrations/20261002130000_remove_discarded_hc_guardia/migration.sql", "utf8");
    for (const table of ["TimeEntry", "TimeSegment", "WorkShift", "Novelty", "HourConceptBreakdown"]) {
      expect(sql).toContain(`FROM "${table}"`);
    }
    expect(sql).toContain("\"hourConceptRuleId\"");
    expect(sql).toContain("RAISE EXCEPTION");
    // Nunca reinterpreta Guardia como Sereno.
    expect(sql).not.toMatch(/HOR-001|Sereno'|UPDATE\s+"HourConcept"/);
  });
});
