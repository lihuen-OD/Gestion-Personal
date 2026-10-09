// Alcance de una regla de horas especiales tal como lo construye el MOTOR
// (timeEntries.repository.ts) a partir de la fila de la regla: única fuente
// para el motor y para la población de R2 de la reorganización
// (reorg/rulePopulation.ts), así ninguna interpretación paralela diverge.
// Función pura.
import { AppError } from "../../shared/errors/AppError";
import type { RuleScope } from "../labor-history/laborHistory.scope";

/** Lo que el motor lee de una regla para decidir su alcance. */
export type RuleScopeSource = {
  id: string;
  name: string;
  companyId: string | null;
  sectorId: string | null;
  costCenterId: string | null;
  positionId: string | null;
  sector: null | { isLegacy: boolean };
};

/**
 * A8-3: si una regla referencia un sector pero su clasificación persistida
 * (Sector.isLegacy) no vino en la lectura, el servidor no puede decidir la ruta
 * de evaluación de esa regla. Éste es un error de INTEGRIDAD del dato (500),
 * de responsabilidad del servidor: NO es historia laboral faltante del legajo
 * (SPECIAL_HOUR_SCOPE_HISTORY_MISSING, 409) y no se corrige registrando
 * historia — se corrige leyendo/clasificando el sector. Se lanza antes de
 * resolver, de modo que ninguna escritura dependiente continúa.
 */
export class SpecialHourRuleSectorIntegrityError extends AppError {
  constructor(public readonly rule: { id: string; name: string; sectorId: string }) {
    super(
      `La regla “${rule.name}” referencia un sector cuya clasificación legado/nuevo (Sector.isLegacy) no se pudo leer. Éste es un error de integridad del dato del servidor, no historia laboral faltante: la operación se detiene hasta que la clasificación del sector esté disponible.`,
      500,
      "SPECIAL_HOUR_RULE_SECTOR_INTEGRITY",
      { ruleId: rule.id, sectorId: rule.sectorId },
    );
  }
}

export function ruleScopeOf(rule: RuleScopeSource): RuleScope {
  const base = { companyId: rule.companyId, costCenterId: rule.costCenterId, positionId: rule.positionId };
  // Sin sector: la regla no restringe la dimensión de sector (sin historia que
  // exigir ni clasificación que leer).
  if (!rule.sectorId) return { ...base, sectorId: null, sectorIsLegacy: false };
  // A8-3: la clasificación legado/nuevo es PERSISTIDA (Sector.isLegacy,
  // fijada en el alta); nunca se deriva de businessUnitId ni de ningún otro
  // padre actual. Tres y sólo tres estados válidos para una regla con sector:
  //   * sin sectorId → sin clasificación que aplicar (arriba);
  //   * con sectorId e isLegacy booleano → se usa tal cual;
  //   * con sectorId y relación o clasificación ausentes → integridad rota.
  // El último caso es un error del servidor, distinto de
  // SPECIAL_HOUR_SCOPE_HISTORY_MISSING: no se resuelve con historia del legajo.
  const sectorIsLegacy = rule.sector?.isLegacy;
  if (typeof sectorIsLegacy !== "boolean") throw new SpecialHourRuleSectorIntegrityError({ id: rule.id, name: rule.name, sectorId: rule.sectorId });
  return { ...base, sectorId: rule.sectorId, sectorIsLegacy };
}
