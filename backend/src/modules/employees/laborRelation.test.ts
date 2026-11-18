import { describe, expect, it } from "vitest";
import { EmployeeStatus } from "@prisma/client";
import { laborMovementAffectedWindow, laborRelationOnDate, type LaborMovementRef } from "./laborRelation";
import { resolveLaborStatus } from "./employees.repository";

// Relación laboral por fecha para la cobertura de Novedades
// (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §5.1).
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const alta = (key: string): LaborMovementRef => ({ type: "ALTA", effectiveFrom: day(key) });
const baja = (key: string): LaborMovementRef => ({ type: "BAJA", effectiveFrom: day(key) });

describe("laborRelationOnDate", () => {
  it("sin movimientos → UNKNOWN (no se asume vigente por existir el legajo)", () => {
    expect(laborRelationOnDate([], "2026-11-16")).toEqual({ kind: "UNKNOWN", reason: "NO_LABOR_MOVEMENTS" });
  });

  it("antes del ALTA → NOT_EMPLOYED; desde el ALTA (inclusive) → EMPLOYED", () => {
    expect(laborRelationOnDate([alta("2026-11-10")], "2026-11-09")).toEqual({ kind: "NOT_EMPLOYED", reason: "BEFORE_FIRST_ALTA" });
    expect(laborRelationOnDate([alta("2026-11-10")], "2026-11-10")).toEqual({ kind: "EMPLOYED" });
  });

  it("la BAJA rige desde su fecha (mismo criterio que resolveLaborStatus)", () => {
    const movements = [alta("2026-01-01"), baja("2026-11-20")];
    expect(laborRelationOnDate(movements, "2026-11-19")).toEqual({ kind: "EMPLOYED" });
    expect(laborRelationOnDate(movements, "2026-11-20")).toEqual({ kind: "NOT_EMPLOYED", reason: "AFTER_BAJA" });
  });

  it("reingreso: alta, baja y nueva alta", () => {
    const movements = [alta("2025-01-01"), baja("2025-06-01"), alta("2026-03-01")];
    expect(laborRelationOnDate(movements, "2025-03-01").kind).toBe("EMPLOYED");
    expect(laborRelationOnDate(movements, "2025-12-01")).toEqual({ kind: "NOT_EMPLOYED", reason: "AFTER_BAJA" });
    expect(laborRelationOnDate(movements, "2026-03-01").kind).toBe("EMPLOYED");
  });

  it("antes de una primera BAJA sin ALTA previa → UNKNOWN (no se sabe desde cuándo trabajaba)", () => {
    expect(laborRelationOnDate([baja("2026-11-20")], "2026-11-01")).toEqual({ kind: "UNKNOWN", reason: "BEFORE_FIRST_MOVEMENT_WITHOUT_ALTA" });
  });

  it("ALTA y BAJA el mismo día → UNKNOWN (el orden no está registrado)", () => {
    expect(laborRelationOnDate([alta("2026-11-20"), baja("2026-11-20")], "2026-11-25")).toEqual({ kind: "UNKNOWN", reason: "SAME_DAY_ALTA_AND_BAJA" });
  });

  it("el orden en que llegan los movimientos no importa", () => {
    expect(laborRelationOnDate([baja("2026-11-20"), alta("2026-01-01")], "2026-11-21").kind).toBe("NOT_EMPLOYED");
  });

  // Coherencia con la fuente de hoy: en todo caso con evidencia, la lectura
  // por fecha coincide con resolveLaborStatus evaluado ese mismo día.
  it.each([
    [[alta("2026-01-01")], "2026-11-16"],
    [[alta("2026-12-01")], "2026-11-16"],
    [[alta("2026-01-01"), baja("2026-11-10")], "2026-11-16"],
    [[alta("2025-01-01"), baja("2025-06-01"), alta("2026-03-01")], "2026-11-16"],
  ])("coincide con resolveLaborStatus cuando hay evidencia (%#)", (movements, dateKey) => {
    const relation = laborRelationOnDate(movements, dateKey);
    const reference = new Date(`${dateKey}T15:00:00.000Z`); // mediodía en Argentina
    expect(relation.kind === "EMPLOYED" ? EmployeeStatus.ACTIVO : EmployeeStatus.INACTIVO).toBe(resolveLaborStatus(movements, reference));
  });
});

describe("laborMovementAffectedWindow (etapa 5)", () => {
  const at = (key: string) => new Date(`${key}T00:00:00.000Z`);
  const alta = (key: string) => ({ type: "ALTA" as const, effectiveFrom: at(key) });
  const baja = (key: string) => ({ type: "BAJA" as const, effectiveFrom: at(key) });

  it("primer movimiento del legajo: cambia todo (ventana abierta a ambos lados)", () => {
    expect(laborMovementAffectedWindow([], alta("2026-11-01"))).toEqual({ from: null, to: null });
  });

  it("BAJA después del ALTA: desde la BAJA en adelante", () => {
    expect(laborMovementAffectedWindow([alta("2026-01-01")], baja("2026-11-15"))).toEqual({ from: at("2026-11-15"), to: null });
  });

  it("movimiento intermedio: hasta el día anterior al siguiente movimiento ya registrado", () => {
    expect(laborMovementAffectedWindow([alta("2026-01-01"), alta("2026-12-01")], baja("2026-06-30"))).toEqual({ from: at("2026-06-30"), to: at("2026-11-30") });
  });

  it("si pasa a ser el primero, también cambian las fechas anteriores", () => {
    expect(laborMovementAffectedWindow([baja("2026-12-31")], alta("2026-03-01"))).toEqual({ from: null, to: at("2026-12-30") });
  });
});
