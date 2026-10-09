// Población de una regla de horas especiales para R2 (ADR §6: "lista
// explícita de los legajos que HOY la cumplen") con la MISMA semántica que el
// motor (A7, ORG_LOCATION_REORGANIZATION.md §18.2 y §19):
//
// - candidatos: la lista explícita de la regla si tiene; si no, todos los
//   legajos (el motor tampoco filtra por estado del legajo);
// - alcance: `ruleScopeOf` (clasificación PERSISTIDA del sector, Sector.isLegacy;
//   sin clasificación legible → error de integridad, nunca se deriva del
//   padre) + `evaluateRuleScope` sobre la historia que carga el motor
//   (`loadEngineScopeHistory`): sector ANTERIOR = sector anterior vigente
//   (LEGACY_SECTOR); sector NUEVO = "Ubicado dentro de" (WITHIN) sobre los
//   alcances vigentes del puesto vigente — un alcance de empresa o de unidad
//   de negocio no hereda reglas sectoriales; empresa/centro de costo/puesto
//   según su vigencia;
// - fecha: UNA fecha civil argentina explícita (la de la corrida, registrada
//   en el reporte y en la decisión);
// - historia faltante: el legajo queda en `missing` con sus dimensiones; NO se
//   asume pertenencia ni se completa con datos actuales (R2 bloquea).
//
// La convocatoria de un FERIADO no es población por alcance: el motor la
// resuelve aparte (con convocados, el FERIADO aplica a ellos sin mirar el
// alcance), y R2 no la toca. Por eso no se incluye y se marca explícitamente.

import type { DateKey } from "../../labor-history/laborHistory.periods";
import type { HistoryReader } from "../../labor-history/laborHistory.repository";
import { evaluateRuleScope, type EngineScopeHistory, type ScopeDimension } from "../../labor-history/laborHistory.scope";
import { laborHistoryService } from "../../labor-history/laborHistory.service";
import { ruleScopeOf, type RuleScopeSource } from "../../time-entries/specialHourRuleScope";

export type PopulationRule = RuleScopeSource & { kind: string; employees: Array<{ employeeId: string }> };

export interface RulePopulation {
  /** Fecha civil (America/Argentina) a la que se congeló la población. */
  date: DateKey;
  sectorSemantics: "NONE" | "LEGACY_SECTOR" | "WITHIN";
  candidates: "EXPLICIT_LIST" | "ALL_EMPLOYEES";
  /** Legajos cuyo alcance la regla cumple (MATCH), ordenados y sin duplicados. */
  employeeIds: string[];
  /** Legajos sin historia suficiente para decidir: bloquean R2. */
  missing: Array<{ employeeId: string; dimensions: ScopeDimension[] }>;
  /** Las convocatorias de feriado se resuelven aparte y R2 no las cambia. */
  holidayConvocations: "NOT_APPLICABLE" | "RESOLVED_SEPARATELY";
}

export type PopulationReader = HistoryReader & { employee: { findMany(args: { select: { id: true }; orderBy: { id: "asc" } }): Promise<Array<{ id: string }>> } };

type HistoryLoader = (db: HistoryReader, employeeId: string, range: { fromKey: DateKey; toKey: DateKey }) => Promise<EngineScopeHistory>;

export async function rulePopulationAt(db: PopulationReader, rule: PopulationRule, date: DateKey, loadHistory: HistoryLoader = (reader, employeeId, range) => laborHistoryService.loadEngineScopeHistory(reader, employeeId, range)): Promise<RulePopulation> {
  // Lanza SpecialHourRuleSectorIntegrityError si el sector no trae su clasificación: no se acepta una lectura incompleta.
  const scope = ruleScopeOf(rule);
  const explicit = [...new Set(rule.employees.map((item) => item.employeeId))].sort();
  const candidates = explicit.length ? explicit : (await db.employee.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((row) => row.id);
  const employeeIds: string[] = [];
  const missing: RulePopulation["missing"] = [];
  for (const employeeId of candidates) {
    const evaluation = evaluateRuleScope(scope, await loadHistory(db, employeeId, { fromKey: date, toKey: date }), date);
    if (evaluation.kind === "MATCH") employeeIds.push(employeeId);
    else if (evaluation.kind === "MISSING") missing.push({ employeeId, dimensions: evaluation.dimensions });
  }
  return {
    date,
    sectorSemantics: !scope.sectorId ? "NONE" : scope.sectorIsLegacy ? "LEGACY_SECTOR" : "WITHIN",
    candidates: explicit.length ? "EXPLICIT_LIST" : "ALL_EMPLOYEES",
    employeeIds: employeeIds.sort(),
    missing,
    holidayConvocations: rule.kind === "FERIADO" ? "RESOLVED_SEPARATELY" : "NOT_APPLICABLE",
  };
}
