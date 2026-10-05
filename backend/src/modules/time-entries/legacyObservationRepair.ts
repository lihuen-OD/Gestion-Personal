import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { MERGED_INTO_CANONICAL_NOTE } from "./normalHoursReconciliation";

/**
 * Reparación puntual de observaciones legadas de TimeEntry escritas por la
 * reconciliación 15M.4 antes de que dejara de incluir ids: "... -- fusionada
 * en TimeEntry <uuid>." La grilla de horas lee la observación directo de la
 * tabla, así que el texto se corrige en el dato, con el mismo texto que hoy
 * escribe la reconciliación (MERGED_INTO_CANONICAL_NOTE).
 *
 * Sólo se propone un reemplazo cuando es inequívoco: único id en el texto,
 * patrón exacto, y el TimeEntry referenciado existe, es del mismo empleado,
 * de la misma fecha y es la carga de Horas normales (la canónica). Todo lo
 * demás se reporta y no se toca. No toca horas, minutos, estados ni fechas.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LEGACY_MERGE_NOTE = new RegExp(`fusionada en TimeEntry (${UUID})\\.`, "i");

export type ObservationRow = { id: string; employeeId: string; date: Date; observation: string | null };
export type ReferencedEntry = { id: string; employeeId: string; date: Date; isNormalBase: boolean };

export type ObservationRepairProposal =
  | { id: string; status: "repair"; before: string; after: string; reason: string }
  | { id: string; status: "skip"; before: string | null; reason: string };

export function referencedTechnicalIds(observation: string | null) {
  return observation?.match(new RegExp(UUID, "gi")) ?? [];
}

export function proposeObservationRepair(row: ObservationRow, referencesById: Map<string, ReferencedEntry>): ObservationRepairProposal {
  const skip = (reason: string): ObservationRepairProposal => ({ id: row.id, status: "skip", before: row.observation, reason });
  const ids = referencedTechnicalIds(row.observation);
  if (!row.observation || ids.length === 0) return skip("la observación no contiene ids técnicos");

  const match = row.observation.match(LEGACY_MERGE_NOTE);
  if (!match) return skip("no coincide con el patrón 'fusionada en TimeEntry <id>' (otro texto legado, no se reescribe automáticamente)");
  if (ids.length !== 1) return skip("la observación contiene más de un id técnico");

  const referencedId = match[1]!.toLowerCase();
  if (referencedId === row.id.toLowerCase()) return skip("la observación se referencia a sí misma");
  const reference = referencesById.get(referencedId);
  if (!reference) return skip("el TimeEntry referenciado no existe");
  if (reference.employeeId !== row.employeeId) return skip("el TimeEntry referenciado es de otro empleado");
  // TimeEntry.date es @db.Date (calendario puro): se compara tal cual.
  if (reference.date.getTime() !== row.date.getTime()) return skip("el TimeEntry referenciado es de otra fecha");
  if (!reference.isNormalBase) return skip("el TimeEntry referenciado no es la carga de Horas normales");

  const after = row.observation.replace(LEGACY_MERGE_NOTE, MERGED_INTO_CANONICAL_NOTE);
  if (referencedTechnicalIds(after).length) return skip("el texto propuesto todavía tendría un id técnico");
  return {
    id: row.id,
    status: "repair",
    before: row.observation,
    after,
    reason: "nota legada de la reconciliación 15M.4: el id referenciado es la carga de Horas normales del mismo empleado y día",
  };
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
