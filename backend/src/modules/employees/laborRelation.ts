/**
 * Relación laboral vigente en una FECHA calendario, leída de la única fuente
 * de altas y bajas: `LaborMovement` (ALTA/BAJA con `effectiveFrom` @db.Date,
 * reingresos incluidos). Misma regla de vigencia que
 * `employees.repository.ts::resolveLaborStatus` (el estado de hoy): decide el
 * último movimiento con `effectiveFrom` <= fecha, y una BAJA rige desde su
 * propia fecha.
 *
 * Diferencia deliberada (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §5.1):
 * `resolveLaborStatus` completa con un default lo que no tiene evidencia
 * (sin movimientos → ACTIVO; antes de una primera BAJA → ACTIVO). Para fechas
 * históricas eso sería inventar, así que acá esos casos son UNKNOWN y quien
 * consume decide (la cobertura de Novedades los manda a revisión).
 */
import type { LaborMovementType } from "@prisma/client";
import { calendarDateKey } from "../../shared/datetime/argentinaTime";
import type { PrismaTransactionClient } from "../../shared/prisma/client";

export type LaborMovementRef = { type: LaborMovementType; effectiveFrom: Date };

export type LaborRelationOnDate =
  | { kind: "EMPLOYED" }
  | { kind: "NOT_EMPLOYED"; reason: "BEFORE_FIRST_ALTA" | "AFTER_BAJA" }
  | { kind: "UNKNOWN"; reason: "NO_LABOR_MOVEMENTS" | "BEFORE_FIRST_MOVEMENT_WITHOUT_ALTA" | "SAME_DAY_ALTA_AND_BAJA" };

export function laborRelationOnDate(movements: LaborMovementRef[], dateKey: string): LaborRelationOnDate {
  if (!movements.length) return { kind: "UNKNOWN", reason: "NO_LABOR_MOVEMENTS" };
  const byDate = new Map<string, Set<LaborMovementType>>();
  for (const movement of movements) {
    const key = calendarDateKey(movement.effectiveFrom);
    byDate.set(key, (byDate.get(key) ?? new Set()).add(movement.type));
  }
  const effectiveDates = [...byDate.keys()].filter((key) => key <= dateKey).sort();
  if (!effectiveDates.length) {
    const firstDate = [...byDate.keys()].sort()[0]!;
    const firstTypes = byDate.get(firstDate)!;
    // Antes del primer movimiento: si es un ALTA, todavía no había relación;
    // si es una BAJA (o ambos el mismo día) no se sabe desde cuándo trabajaba.
    if (firstTypes.size === 1 && firstTypes.has("ALTA")) return { kind: "NOT_EMPLOYED", reason: "BEFORE_FIRST_ALTA" };
    return { kind: "UNKNOWN", reason: "BEFORE_FIRST_MOVEMENT_WITHOUT_ALTA" };
  }
  const lastTypes = byDate.get(effectiveDates[effectiveDates.length - 1]!)!;
  // ALTA y BAJA con la misma fecha: el orden no está registrado.
  if (lastTypes.size > 1) return { kind: "UNKNOWN", reason: "SAME_DAY_ALTA_AND_BAJA" };
  return lastTypes.has("BAJA") ? { kind: "NOT_EMPLOYED", reason: "AFTER_BAJA" } : { kind: "EMPLOYED" };
}

/** Movimientos de varios legajos en una sola consulta. */
export async function loadLaborMovementsByEmployee(db: Pick<PrismaTransactionClient, "laborMovement">, employeeIds: string[]): Promise<Map<string, LaborMovementRef[]>> {
  const ids = [...new Set(employeeIds)];
  const result = new Map<string, LaborMovementRef[]>(ids.map((id) => [id, []]));
  if (!ids.length) return result;
  const rows = await db.laborMovement.findMany({ where: { employeeId: { in: ids } }, select: { employeeId: true, type: true, effectiveFrom: true } });
  for (const row of rows) result.get(row.employeeId)!.push({ type: row.type, effectiveFrom: row.effectiveFrom });
  return result;
}
