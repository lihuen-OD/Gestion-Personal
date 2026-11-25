import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeOpenShiftRisk } from "./openShiftMonitor.service";
import type { ShiftTemplateLike } from "./shiftTemplateRef.types";
import { buildTemplateRulesSnapshot, effectiveShiftTemplate, parseTemplateRulesSnapshot, TEMPLATE_RULES_SNAPSHOT_VERSION } from "./templateRulesSnapshot";

/**
 * R4.6 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9, garantía 1): las
 * reglas de la plantilla adoptada quedan congeladas en la jornada; una jornada
 * abierta conserva las reglas con las que empezó aunque la plantilla cambie.
 */
const NIGHT: ShiftTemplateLike = {
  id: "tpl-19-07",
  code: "PLANTA-19-07",
  startTime: "19:00",
  endTime: "07:00",
  crossesMidnight: true,
  entryToleranceBeforeMinutes: 10,
  entryToleranceAfterMinutes: 10,
  exitToleranceBeforeMinutes: 20,
  exitToleranceAfterMinutes: 20,
  minimumMinutesForCompliance: 420,
  maximumInformativeMinutes: 780,
  missingOutAlertAfterMinutes: 60,
  absoluteOpenShiftLimitMinutes: 1200,
};
const CAPTURED = new Date("2026-11-06T22:00:00.000Z");

afterEach(() => vi.restoreAllMocks());

describe("buildTemplateRulesSnapshot / parseTemplateRulesSnapshot", () => {
  it("congela horario, tolerancias y límites con versión e instante", () => {
    const snapshot = buildTemplateRulesSnapshot(NIGHT, CAPTURED);
    expect(snapshot).toEqual({ version: TEMPLATE_RULES_SNAPSHOT_VERSION, templateId: NIGHT.id, capturedAt: CAPTURED.toISOString(), ...Object.fromEntries(Object.entries(NIGHT).filter(([key]) => key !== "id")) });
  });

  it("ida y vuelta: el snapshot leído es exactamente la plantilla congelada", () => {
    expect(parseTemplateRulesSnapshot(JSON.parse(JSON.stringify(buildTemplateRulesSnapshot(NIGHT, CAPTURED))))).toEqual(NIGHT);
  });

  it("sin snapshot (jornadas anteriores a R4.6): null", () => {
    expect(parseTemplateRulesSnapshot(null)).toBeNull();
    expect(parseTemplateRulesSnapshot(undefined)).toBeNull();
  });

  it("versión desconocida o forma inválida: null con un log, nunca un error", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(parseTemplateRulesSnapshot({ ...buildTemplateRulesSnapshot(NIGHT, CAPTURED), version: 2 })).toBeNull();
    expect(parseTemplateRulesSnapshot({ version: 1, templateId: "x" })).toBeNull();
    expect(parseTemplateRulesSnapshot("texto")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[0]?.[0]).toBe("WORK_SHIFT_TEMPLATE_SNAPSHOT_UNREADABLE");
  });
});

describe("effectiveShiftTemplate", () => {
  const edited: ShiftTemplateLike = { ...NIGHT, exitToleranceAfterMinutes: 90, missingOutAlertAfterMinutes: 240, absoluteOpenShiftLimitMinutes: 1500 };
  const snapshot = buildTemplateRulesSnapshot(NIGHT, CAPTURED);

  it("con snapshot de la plantilla adoptada, gobiernan las reglas congeladas (no la edición posterior)", () => {
    expect(effectiveShiftTemplate({ shiftTemplateId: NIGHT.id, templateRulesSnapshot: snapshot }, edited)).toEqual(NIGHT);
  });

  it("sin snapshot: la plantilla en vivo, exactamente como antes", () => {
    expect(effectiveShiftTemplate({ shiftTemplateId: NIGHT.id, templateRulesSnapshot: null }, edited)).toBe(edited);
    expect(effectiveShiftTemplate({ shiftTemplateId: NIGHT.id }, edited)).toBe(edited);
  });

  it("snapshot de otra plantilla que la adoptada (dato inconsistente): la plantilla en vivo", () => {
    expect(effectiveShiftTemplate({ shiftTemplateId: "otra", templateRulesSnapshot: snapshot }, edited)).toBe(edited);
  });

  it("jornada sin plantilla: nunca inventa una", () => {
    expect(effectiveShiftTemplate({ shiftTemplateId: null, templateRulesSnapshot: snapshot }, null)).toBeNull();
  });
});

describe("computeOpenShiftRisk — olvido de salida de un nocturno abierto", () => {
  // Bloque 19:00 → 07:00 (ART), olvido de salida a 720 + 20 + 60 = 800 min.
  const startAt = new Date("2026-11-06T22:00:00.000Z");
  const scheduledStartAt = startAt;
  const at = (minutes: number) => new Date(startAt.getTime() + minutes * 60_000);
  const edited: ShiftTemplateLike = { ...NIGHT, missingOutAlertAfterMinutes: 240 };
  const frozen = { shiftTemplateId: NIGHT.id, templateRulesSnapshot: buildTemplateRulesSnapshot(NIGHT, CAPTURED) };

  it("con snapshot: el umbral original (800) aunque la plantilla se haya editado a 240", () => {
    expect(computeOpenShiftRisk(startAt, edited, at(799), scheduledStartAt, frozen).level).toBe("NORMAL");
    expect(computeOpenShiftRisk(startAt, edited, at(800), scheduledStartAt, frozen).level).toBe("MISSING_OUT");
  });

  it("sin snapshot (histórica): la plantilla en vivo, como antes de R4.6", () => {
    expect(computeOpenShiftRisk(startAt, edited, at(800), scheduledStartAt, { shiftTemplateId: NIGHT.id, templateRulesSnapshot: null }).level).toBe("NORMAL");
    expect(computeOpenShiftRisk(startAt, edited, at(980), scheduledStartAt).level).toBe("MISSING_OUT");
  });
});

describe("migración 20261125120000_work_shift_template_rules_snapshot", () => {
  const root = path.resolve(__dirname, "../../..");
  const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
  const statements = (sql: string) => sql.split("\n").filter((line) => line.trim() && !line.trim().startsWith("--")).join("\n");
  const migration = statements(read("prisma/migrations/20261125120000_work_shift_template_rules_snapshot/migration.sql"));
  const rollback = read("prisma/rollbacks/20261125120000_work_shift_template_rules_snapshot.down.sql");

  it("es aditiva: una sola columna JSONB nullable, sin default ni backfill", () => {
    expect(migration.trim()).toBe('ALTER TABLE "WorkShift" ADD COLUMN     "templateRulesSnapshot" JSONB;');
    expect(migration).not.toMatch(/\b(UPDATE|INSERT|DELETE|DROP|DEFAULT|NOT NULL)\b/i);
  });

  it("el schema la declara nullable", () => {
    expect(read("prisma/schema.prisma")).toMatch(/^\s*templateRulesSnapshot\s+Json\?\s*$/m);
  });

  it("rollback: transacción + lock, aborta con snapshots antes del DROP y borra su fila de _prisma_migrations", () => {
    const body = statements(rollback);
    const lock = body.indexOf('LOCK TABLE "WorkShift" IN ACCESS EXCLUSIVE MODE');
    const guard = body.indexOf('WHERE "templateRulesSnapshot" IS NOT NULL');
    const drop = body.indexOf('DROP COLUMN "templateRulesSnapshot"');
    expect(body.startsWith("BEGIN;")).toBe(true);
    expect(lock).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(lock);
    expect(drop).toBeGreaterThan(guard);
    expect(body).toMatch(/RAISE EXCEPTION/);
    expect(body).toContain("DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20261125120000_work_shift_template_rules_snapshot';");
    expect(body.trim().endsWith("COMMIT;")).toBe(true);
    expect(body).not.toMatch(/\bCASCADE\b/i);
  });
});
