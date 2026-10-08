// Alcance de una regla de horas especiales evaluado CON HISTORIA (D-4/D-5,
// docs/decisions/ORG_LOCATION_REORGANIZATION.md §18.2 y §19). Función pura:
// el motor (timeEntries.repository.ts) carga la historia y decide qué hacer
// con el resultado.
//
// Semántica de cada dimensión (sin cambios respecto de D-4):
// - empresa  = empresa EMPLEADORA vigente ese día (alcanza si alguna coincide);
// - centro de costo / puesto = el vigente ese día;
// - sector ANTERIOR (sin unidad de negocio) = sector anterior del legajo ese día;
// - sector NUEVO = "Ubicado dentro de": algún alcance del puesto vigente ese
//   día está en ese sector o en un área cuyo sector padre (registrado con la
//   vigencia, no leído de la estructura actual) es ese sector. Un alcance de
//   empresa o unidad de negocio no hereda reglas sectoriales.
// NULL en la regla = sin restricción en esa dimensión (no necesita historia).
import { periodAt, type DateKey, type Period } from "./laborHistory.periods";

export type ScopeNodeSnapshot = {
  level: "COMPANY" | "BUSINESS_UNIT" | "SECTOR" | "AREA";
  nodeId: string;
  /** Sólo AREA: sector padre del área cuando se registró la vigencia. */
  areaSectorId: string | null;
};

export type EngineScopeHistory = {
  position: Period<string | null>[];
  costCenter: Period<string | null>[];
  legacySector: Period<string | null>[];
  employer: Period<string[]>[];
  /** Vigencias de alcance por puesto (de los puestos que el legajo tuvo en el rango). */
  scopes: Map<string, Period<ScopeNodeSnapshot[]>[]>;
};

export type RuleScope = {
  companyId: string | null;
  sectorId: string | null;
  /** El sector de la regla pertenece al modelo anterior (sin unidad de negocio). */
  sectorIsLegacy: boolean;
  costCenterId: string | null;
  positionId: string | null;
};

export type ScopeDimension = "EMPLOYER" | "COST_CENTER" | "POSITION" | "LEGACY_SECTOR" | "POSITION_SCOPE";

export const scopeDimensionLabels: Record<ScopeDimension, string> = {
  EMPLOYER: "empresa empleadora",
  COST_CENTER: "centro de costo",
  POSITION: "puesto",
  LEGACY_SECTOR: "sector anterior",
  POSITION_SCOPE: "alcance del puesto",
};

export type RuleScopeEvaluation = { kind: "MATCH" } | { kind: "NO_MATCH" } | { kind: "MISSING"; dimensions: ScopeDimension[] };

type Tri = boolean | ScopeDimension;

function scalarAt(periods: Period<string | null>[], dateKey: DateKey, expected: string, dimension: ScopeDimension): Tri {
  const period = periodAt(periods, dateKey);
  return period ? period.value === expected : dimension;
}

function newSectorAt(history: EngineScopeHistory, dateKey: DateKey, sectorId: string): Tri {
  const position = periodAt(history.position, dateKey);
  if (!position) return "POSITION";
  if (!position.value) return false; // sin puesto ese día: dato conocido, no alcanza
  const scope = periodAt(history.scopes.get(position.value) ?? [], dateKey);
  if (!scope) return "POSITION_SCOPE";
  return scope.value.some((node) => (node.level === "SECTOR" && node.nodeId === sectorId) || (node.level === "AREA" && node.areaSectorId === sectorId));
}

/**
 * MATCH / NO_MATCH cuando la historia alcanza para decidir. MISSING sólo si
 * ninguna dimensión conocida ya excluye la regla y alguna restringida no tiene
 * vigencia ese día: ahí falta evidencia de verdad y el motor no la completa
 * con valores actuales.
 */
export function evaluateRuleScope(rule: RuleScope, history: EngineScopeHistory, dateKey: DateKey): RuleScopeEvaluation {
  const results: Tri[] = [];
  if (rule.companyId) {
    const employer = periodAt(history.employer, dateKey);
    results.push(employer ? employer.value.includes(rule.companyId) : "EMPLOYER");
  }
  if (rule.costCenterId) results.push(scalarAt(history.costCenter, dateKey, rule.costCenterId, "COST_CENTER"));
  if (rule.positionId) results.push(scalarAt(history.position, dateKey, rule.positionId, "POSITION"));
  if (rule.sectorId) {
    results.push(rule.sectorIsLegacy ? scalarAt(history.legacySector, dateKey, rule.sectorId, "LEGACY_SECTOR") : newSectorAt(history, dateKey, rule.sectorId));
  }
  if (results.includes(false)) return { kind: "NO_MATCH" };
  const missing = results.filter((result): result is ScopeDimension => typeof result === "string");
  return missing.length ? { kind: "MISSING", dimensions: [...new Set(missing)] } : { kind: "MATCH" };
}
