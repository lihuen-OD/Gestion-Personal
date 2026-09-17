import type { ApprovalStatus, WorkShiftSource } from "@prisma/client";

/**
 * Etapa 15M.4 (docs/decisions/ATTENDANCE_NORMAL_HOURS_RECONCILIATION_15M4.md):
 * lógica pura de reconciliación de Hora normal histórica. La Etapa 13F
 * (commit d47dcdd, 2026-09-02) rompió la acumulación de minutos en
 * `closeOpenWorkShift` cuando una jornada se clasificaba en más de un
 * `TimeSegment` de la misma fecha calendario — corregido en la Etapa 15M.3,
 * pero los `TimeEntry` NORMAL_BASE ya escritos entre esa fecha y la
 * corrección quedaron con minutos perdidos o duplicados. Este módulo NO toca
 * la base — sólo clasifica y decide qué fila sobrevive, dados los datos ya
 * leídos por la capa de repositorio.
 */

export type NormalHoursDiscrepancyKind =
  | "OK"
  | "MISSING_TIME_ENTRY"
  | "UNDERCOUNT"
  | "OVERCOUNT"
  | "DUPLICATE"
  | "MIXED_STATUS"
  | "LEGACY_INCONSISTENT";

/** Fila de TimeEntry NORMAL_BASE ya vinculada a un WorkShift real (nunca una carga manual pura — ver `findNormalEntriesForEmployee`). */
export interface NormalEntryRow {
  id: string;
  totalMinutes: number;
  actualMinutes: number | null;
  hours: number;
  status: ApprovalStatus;
  workShiftId: string | null;
  timeSegmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NormalHoursDiscrepancy {
  kind: NormalHoursDiscrepancyKind;
  expectedMinutes: number;
  /** Minutos de la fila activa (no "retirada" por una reconciliación previa) — 0 si no hay ninguna. */
  currentTotalMinutes: number;
  differenceMinutes: number;
  /** Filas físicas totales encontradas (incluye retiradas de un repair anterior) — visibilidad operativa, no implica que todas requieran acción. */
  rowCount: number;
  statuses: ApprovalStatus[];
}

// Orden de "estado más avanzado" para elegir la fila canónica entre
// duplicados (Etapa 15M.4 §11 del pedido). CERRADO es el estado terminal más
// fuerte (cierre mensual ya lo trabó); RECHAZADO es el más débil porque una
// fila rechazada nunca debería tratarse como la fuente de verdad de horas
// reales. Documentado acá porque es una decisión de negocio, no técnica.
const STATUS_RANK: Record<ApprovalStatus, number> = {
  CERRADO: 6,
  APROBADO: 5,
  EN_REVISION: 4,
  DEVUELTO: 3,
  PENDIENTE: 2,
  BORRADOR: 1,
  RECHAZADO: 0,
};

export function rankApprovalStatus(status: ApprovalStatus): number {
  return STATUS_RANK[status];
}

/**
 * Fila "activa" = todavía representa minutos reales. Una fila con
 * `totalMinutes === 0` es, por convención de este módulo, una fila ya
 * retirada de cómputo por un repair anterior (Etapa 15M.4 §11, opción A) —
 * nunca una jornada real de 0 minutos (eso no genera TimeEntry).
 */
function isRetired(row: NormalEntryRow): boolean {
  return row.totalMinutes === 0;
}

function isRowLegacyInconsistent(row: NormalEntryRow): boolean {
  if (Math.round(row.hours * 60) !== row.totalMinutes) return true;
  if (row.actualMinutes !== null && row.actualMinutes !== row.totalMinutes) return true;
  if (row.totalMinutes < 0) return true;
  return false;
}

/**
 * Clasifica el estado de un employee+fecha. Diseñada para ser idempotente:
 * después de un repair, las filas "de más" quedan con `totalMinutes = 0`
 * (retiradas, nunca borradas) y por eso no vuelven a contar como
 * DUPLICATE/MIXED_STATUS en una segunda corrida — sólo la fila activa se
 * compara contra `expectedMinutes`.
 */
export function classifyNormalHoursDiscrepancy(expectedMinutes: number, rows: NormalEntryRow[]): NormalHoursDiscrepancy {
  const statuses = [...new Set(rows.map((row) => row.status))];
  const rowCount = rows.length;

  if (rowCount === 0) {
    return {
      kind: expectedMinutes > 0 ? "MISSING_TIME_ENTRY" : "OK",
      expectedMinutes,
      currentTotalMinutes: 0,
      differenceMinutes: 0 - expectedMinutes,
      rowCount,
      statuses,
    };
  }

  const activeRows = rows.filter((row) => !isRetired(row));

  if (activeRows.length > 1) {
    const activeStatuses = [...new Set(activeRows.map((row) => row.status))];
    const currentTotalMinutes = activeRows.reduce((sum, row) => sum + row.totalMinutes, 0);
    return {
      kind: activeStatuses.length > 1 ? "MIXED_STATUS" : "DUPLICATE",
      expectedMinutes,
      currentTotalMinutes,
      differenceMinutes: currentTotalMinutes - expectedMinutes,
      rowCount,
      statuses,
    };
  }

  if (activeRows.length === 0) {
    // Todas las filas físicas están retiradas (0 minutos) — mismo criterio
    // que "no hay ninguna fila real" para decidir si falta reconciliar.
    return {
      kind: expectedMinutes > 0 ? "MISSING_TIME_ENTRY" : "OK",
      expectedMinutes,
      currentTotalMinutes: 0,
      differenceMinutes: 0 - expectedMinutes,
      rowCount,
      statuses,
    };
  }

  const active = activeRows[0]!;
  if (isRowLegacyInconsistent(active)) {
    return {
      kind: "LEGACY_INCONSISTENT",
      expectedMinutes,
      currentTotalMinutes: active.totalMinutes,
      differenceMinutes: active.totalMinutes - expectedMinutes,
      rowCount,
      statuses,
    };
  }

  const differenceMinutes = active.totalMinutes - expectedMinutes;
  return {
    kind: differenceMinutes === 0 ? "OK" : differenceMinutes < 0 ? "UNDERCOUNT" : "OVERCOUNT",
    expectedMinutes,
    currentTotalMinutes: active.totalMinutes,
    differenceMinutes,
    rowCount,
    statuses,
  };
}

export function requiresRepair(kind: NormalHoursDiscrepancyKind): boolean {
  return kind !== "OK";
}

/**
 * Elige la fila canónica a conservar/actualizar entre las filas físicas de
 * un employee+fecha (Etapa 15M.4 §11): si ya hay exactamente una fila activa
 * (no retirada), esa sigue siendo la canónica (preserva continuidad entre
 * corridas de repair sucesivas — idempotencia). Si hay más de una activa (un
 * duplicado real, primera vez que se repara), se elige por estado más
 * avanzado y, en empate, por `createdAt` más antiguo — criterio documentado
 * en el pedido, no inventado acá.
 */
export function pickCanonicalEntry(rows: NormalEntryRow[]): { canonical: NormalEntryRow; duplicates: NormalEntryRow[] } {
  if (rows.length === 0) throw new Error("pickCanonicalEntry requires at least one row");
  const active = rows.filter((row) => !isRetired(row));
  const pool = active.length > 0 ? active : rows;
  const sorted = [...pool].sort((a, b) => {
    const rankDiff = rankApprovalStatus(b.status) - rankApprovalStatus(a.status);
    if (rankDiff !== 0) return rankDiff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const canonical = sorted[0]!;
  const duplicates = rows.filter((row) => row.id !== canonical.id);
  return { canonical, duplicates };
}

export interface ExpectedNormalMinutesForDate {
  minutes: number;
  lastSegmentId: string;
  lastWorkShiftId: string;
  lastSource: WorkShiftSource | null;
}
