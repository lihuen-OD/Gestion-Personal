import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { MERGED_INTO_CANONICAL_NOTE } from "./normalHoursReconciliation";
import { FICHADA_ORIGIN_NOTE } from "./timeEntryObservationText";

/**
 * Reparación puntual de observaciones legadas de TimeEntry que embebían un id
 * técnico. La grilla de horas lee la observación directo de la tabla, así que
 * el texto se corrige en el dato, con la redacción que hoy escribe el código:
 *
 * - "... -- fusionada en TimeEntry <id>." (reconciliación 15M.4) ->
 *   MERGED_INTO_CANONICAL_NOTE. El id debe ser la carga de Horas normales
 *   del mismo empleado y día.
 * - "Fichada <id>: generado por ingreso/salida." (motor de fichadas viejo)
 *   -> FICHADA_ORIGIN_NOTE. El id debe ser una jornada (WorkShift) del mismo
 *   empleado que originó esta carga (es su workShiftId, o tiene tramos en la
 *   fecha de la carga).
 *
 * Sólo se propone un reemplazo cuando es inequívoco: un único id en el texto,
 * patrón exacto y relación verificada. Todo lo demás se reporta y no se toca.
 * Sólo cambia la observación: nunca horas, minutos, estado, fecha, empleado
 * ni concepto.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LEGACY_MERGE_NOTE = new RegExp(`fusionada en TimeEntry (${UUID})\\.`, "i");
const LEGACY_FICHADA_NOTE = new RegExp(`Fichada (${UUID}): generado por ingreso/salida\\.`, "i");

export type ObservationRow = { id: string; employeeId: string; date: Date; workShiftId: string | null; observation: string | null };
export type ReferencedEntry = { id: string; employeeId: string; date: Date; isNormalBase: boolean };
export type ReferencedWorkShift = { id: string; employeeId: string; segmentDates: Date[] };
export type ObservationLookups = { timeEntries: Map<string, ReferencedEntry>; workShifts: Map<string, ReferencedWorkShift> };

export type ObservationRepairProposal =
  | { id: string; status: "repair"; before: string; after: string; reason: string }
  | { id: string; status: "skip"; before: string | null; reason: string };

export function referencedTechnicalIds(observation: string | null) {
  return observation?.match(new RegExp(UUID, "gi")) ?? [];
}

// TimeEntry.date y TimeSegment.date son @db.Date (calendario puro): se comparan tal cual.
const sameCalendarDate = (left: Date, right: Date) => left.getTime() === right.getTime();

export function proposeObservationRepair(row: ObservationRow, lookups: ObservationLookups): ObservationRepairProposal {
  const skip = (reason: string): ObservationRepairProposal => ({ id: row.id, status: "skip", before: row.observation, reason });
  const repair = (after: string, reason: string): ObservationRepairProposal =>
    referencedTechnicalIds(after).length
      ? skip("el texto propuesto todavía tendría un id técnico")
      : { id: row.id, status: "repair", before: row.observation!, after, reason };
  const ids = referencedTechnicalIds(row.observation);
  if (!row.observation || ids.length === 0) return skip("la observación no contiene ids técnicos");

  const merge = row.observation.match(LEGACY_MERGE_NOTE);
  const fichada = row.observation.match(LEGACY_FICHADA_NOTE);
  if (!merge && !fichada) return skip("no coincide con ningún patrón legado conocido (no se reescribe automáticamente)");
  if (ids.length !== 1) return skip("la observación contiene más de un id técnico");

  if (merge) {
    const referencedId = merge[1]!.toLowerCase();
    if (referencedId === row.id.toLowerCase()) return skip("la observación se referencia a sí misma");
    const reference = lookups.timeEntries.get(referencedId);
    if (!reference) return skip("el TimeEntry referenciado no existe");
    if (reference.employeeId !== row.employeeId) return skip("el TimeEntry referenciado es de otro empleado");
    if (!sameCalendarDate(reference.date, row.date)) return skip("el TimeEntry referenciado es de otra fecha");
    if (!reference.isNormalBase) return skip("el TimeEntry referenciado no es la carga de Horas normales");
    return repair(
      row.observation.replace(LEGACY_MERGE_NOTE, MERGED_INTO_CANONICAL_NOTE),
      "nota legada de la reconciliación 15M.4: el id referenciado es la carga de Horas normales del mismo empleado y día",
    );
  }

  const workShiftId = fichada![1]!.toLowerCase();
  const workShift = lookups.workShifts.get(workShiftId);
  if (!workShift) return skip("la jornada (WorkShift) referenciada no existe");
  if (workShift.employeeId !== row.employeeId) return skip("la jornada referenciada es de otro empleado");
  const isEntryWorkShift = row.workShiftId?.toLowerCase() === workShiftId;
  const hasSegmentOnEntryDate = workShift.segmentDates.some((date) => sameCalendarDate(date, row.date));
  if (!isEntryWorkShift && !hasSegmentOnEntryDate) return skip("la jornada referenciada no originó esta carga (ni workShiftId ni tramos en la fecha)");
  return repair(
    row.observation.replace(LEGACY_FICHADA_NOTE, FICHADA_ORIGIN_NOTE),
    `nota legada del motor de fichadas: el id es la jornada del mismo empleado que originó la carga (${[
      isEntryWorkShift ? "es su workShiftId" : null,
      hasSegmentOnEntryDate ? "tiene tramos en la fecha" : null,
    ].filter(Boolean).join(" y ")})`,
  );
}

/** Aborta salvo que el destino sea explícitamente staging. Nunca production. */
export function assertStagingTarget(appEnv: string, nodeEnv: string) {
  if (appEnv === "production" || nodeEnv === "production") {
    throw new Error(`ABORT: entorno production detectado (APP_ENV=${appEnv}, NODE_ENV=${nodeEnv}). Esta reparación nunca corre en production.`);
  }
  if (appEnv !== "staging") throw new Error(`ABORT: esta reparación sólo corre con APP_ENV=staging (actual: ${appEnv}).`);
}

export class StaleObservationError extends Error {
  constructor(readonly timeEntryId: string) {
    super(`La observación del TimeEntry ${timeEntryId} cambió desde la lectura; no se aplicó ningún cambio.`);
  }
}

type ObservationWriter = { $transaction<T>(fn: (tx: Pick<PrismaTransactionClient, "timeEntry">) => Promise<T>): Promise<T> };

/**
 * Todo o nada: cada fila se actualiza sólo si su observación sigue siendo la
 * leída; si alguna cambió, la transacción se revierte entera (sin writes
 * parciales silenciosos).
 */
export async function applyObservationRepairs(db: ObservationWriter, repairs: Array<{ id: string; before: string; after: string }>) {
  return db.$transaction(async (tx) => {
    for (const repair of repairs) {
      const result = await tx.timeEntry.updateMany({ where: { id: repair.id, observation: repair.before }, data: { observation: repair.after } });
      if (result.count !== 1) throw new StaleObservationError(repair.id);
    }
    return repairs.length;
  });
}
