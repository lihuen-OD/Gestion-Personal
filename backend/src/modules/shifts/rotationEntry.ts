/**
 * Clasificación de fichadas reales de miembros de rotación — R4.4
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.6). Puro: sin I/O.
 *
 * Motor único: la asignación a bloque es SIEMPRE `assignInstantToBlock` (R4.2)
 * sobre los bloques EFECTIVOS de D−1..D+1 (`effectiveBlocksAround`, R4.3b).
 * Esto sólo agrega la clasificación de lo que no tiene bloque (D3) y la de la
 * salida de una jornada con bloque (posible olvido de salida, límite).
 * Asignación ≠ puntualidad ≠ evidencia: la puntualidad se informa aparte, con
 * las tolerancias de la plantilla del bloque.
 */
import { argentinaDateKey } from "../../shared/datetime/argentinaTime";
import { assignInstantToBlock } from "./blockAssignment";
import type { RotationObligation } from "./rotationObligation.service";
import type { LoadedRotationTemplate } from "./rotationPlan.loader";
import type { ExpectedBlock } from "./rotationPlan";

export const ROTATION_DIAGNOSIS_VERSION = 1;

/** ¿La jornada tiene un bloque de rotación congelado en su ingreso? (null en jornadas legacy). */
export function isRotationBlockShift<S extends { shiftTemplateSource?: string | null; scheduledStartAt?: Date | null; shiftTemplateId: string | null }>(shift: S): shift is S & { scheduledStartAt: Date; shiftTemplateId: string } {
  return (shift.shiftTemplateSource === "ROTATION" || shift.shiftTemplateSource === "HOLIDAY_CONVOCATION") && Boolean(shift.scheduledStartAt) && Boolean(shift.shiftTemplateId);
}

type Block = ExpectedBlock<LoadedRotationTemplate>;

const minutesBetween = (later: Date, earlier: Date) => Math.round((later.getTime() - earlier.getTime()) / 60_000);

export type RotationEntryClassification =
  | { kind: "ASSIGNED"; block: Block; differenceMinutes: number; punctuality: "ON_TIME" | "EARLY" | "LATE" }
  | { kind: "CONFIGURATION"; reason: "MISSING" | "CONFLICT"; planReason: string; detail: string[] }
  | { kind: "DAY_OFF" }
  | { kind: "OUTSIDE_WINDOW"; nearestBlock: Block; minutesBefore: number }
  | { kind: "UNSCHEDULED"; reason: "REST" | "HOLIDAY_NOT_CONVOKED" | "REGIME_SIN_TURNO" | "NO_BLOCKS" };

/**
 * Precedencia determinística: bloque asignado → configuración faltante o
 * contradictoria de la fecha de la fichada → franco → fuera de ventana de un
 * bloque de esa misma fecha operativa → no programado.
 */
export function classifyRotationEntry(instant: Date, obligationsByDate: ReadonlyMap<string, RotationObligation> | undefined, blocks: readonly Block[]): RotationEntryClassification {
  const assignment = assignInstantToBlock(instant, blocks);
  if (assignment.kind === "ASSIGNED") {
    const { block } = assignment;
    const differenceMinutes = minutesBetween(instant, block.scheduledStartAt);
    const punctuality = differenceMinutes > block.template.entryToleranceAfterMinutes ? "LATE" : differenceMinutes < -block.template.entryToleranceBeforeMinutes ? "EARLY" : "ON_TIME";
    return { kind: "ASSIGNED", block, differenceMinutes, punctuality };
  }
  const dateKey = argentinaDateKey(instant);
  const obligation = obligationsByDate?.get(dateKey);
  const plan = obligation?.plan;
  if (plan?.kind === "MISSING") return { kind: "CONFIGURATION", reason: "MISSING", planReason: plan.reason, detail: [] };
  if (plan?.kind === "CONFLICT") return { kind: "CONFIGURATION", reason: "CONFLICT", planReason: plan.reason, detail: plan.detail };
  if (obligation?.resolution.reason === "DAY_OFF") return { kind: "DAY_OFF" };
  const nextSameDay = blocks.find((block) => block.operationalDate === dateKey && block.scheduledStartAt > instant);
  if (nextSameDay) return { kind: "OUTSIDE_WINDOW", nearestBlock: nextSameDay, minutesBefore: minutesBetween(nextSameDay.scheduledStartAt, instant) };
  const reason = obligation?.resolution.reason;
  if (reason === "HOLIDAY_NOT_CONVOKED") return { kind: "UNSCHEDULED", reason: "HOLIDAY_NOT_CONVOKED" };
  if (reason === "REGIME_SIN_TURNO") return { kind: "UNSCHEDULED", reason: "REGIME_SIN_TURNO" };
  if (plan?.kind === "REST") return { kind: "UNSCHEDULED", reason: "REST" };
  return { kind: "UNSCHEDULED", reason: "NO_BLOCKS" };
}

/** La jornada abierta con bloque, tal como quedó congelada en su ingreso. */
export type OpenBlockShift = {
  id: string;
  startAt: Date;
  scheduledStartAt: Date;
  maxAllowedMinutes: number;
  template: Pick<LoadedRotationTemplate, "code" | "startTime" | "endTime" | "crossesMidnight" | "exitToleranceAfterMinutes">;
  scheduledEndAt: Date;
};

export type RotationExitClassification =
  | { kind: "NORMAL" }
  | { kind: "LIMIT_EXCEEDED"; minutesOpen: number; limitMinutes: number; nextBlock: Block | null }
  | { kind: "LIKELY_FORGOTTEN_EXIT"; nextBlock: Block; minutesAfterScheduledEnd: number; exitDurationMinutes: number };

/**
 * Salida de una jornada con bloque B1 (plan v4 §5):
 * 1. Límite absoluto (`maxAllowedMinutes`, congelado de la plantilla): nunca se
 *    cierra con horas, se confirme o no.
 * 2. Posible olvido de salida — SÓLO si se cumplen las tres condiciones:
 *    (a) el instante se asignaría como ENTRADA a un bloque B2 posterior a B1;
 *    (b) cae en el tramo de entrada de B2:
 *        [B2.inicio − B2.entryToleranceBefore, B2.fin);
 *    (c) B1 ya terminó con su tolerancia: instante > B1.fin + B1.exitToleranceAfter.
 *    Excepcional: no aparece en salidas normales, nocturnas ni tardías.
 * 3. Si no, cierre normal.
 */
export function classifyRotationExit(instant: Date, open: OpenBlockShift, blocks: readonly Block[]): RotationExitClassification {
  const assignment = assignInstantToBlock(instant, blocks);
  const later = assignment.kind === "ASSIGNED" && assignment.block.scheduledStartAt.getTime() > open.scheduledStartAt.getTime() ? assignment.block : null;
  const minutesOpen = minutesBetween(instant, open.startAt);
  if (minutesOpen > open.maxAllowedMinutes) return { kind: "LIMIT_EXCEEDED", minutesOpen, limitMinutes: open.maxAllowedMinutes, nextBlock: later };
  if (!later) return { kind: "NORMAL" };
  const entryStart = later.scheduledStartAt.getTime() - later.template.entryToleranceBeforeMinutes * 60_000;
  const inEntryStretch = instant.getTime() >= entryStart && instant.getTime() < later.scheduledEndAt.getTime();
  const previousEnded = instant.getTime() > open.scheduledEndAt.getTime() + open.template.exitToleranceAfterMinutes * 60_000;
  if (!inEntryStretch || !previousEnded) return { kind: "NORMAL" };
  return { kind: "LIKELY_FORGOTTEN_EXIT", nextBlock: later, minutesAfterScheduledEnd: minutesBetween(instant, open.scheduledEndAt), exitDurationMinutes: minutesOpen };
}

/** Datos públicos y acotados del diagnóstico de un bloque (D5): sin datos personales. */
export function blockDiagnosis(block: Block) {
  return {
    obligationKey: block.obligationKey,
    operationalDate: block.operationalDate,
    templateCode: block.template.code,
    scheduledStartAt: block.scheduledStartAt.toISOString(),
    scheduledEndAt: block.scheduledEndAt.toISOString(),
    source: block.source,
    origin: block.origin,
  };
}

export function entryDiagnosis(classification: RotationEntryClassification, evaluatedAt: Date) {
  const base = { version: ROTATION_DIAGNOSIS_VERSION, evaluatedAt: evaluatedAt.toISOString(), kind: classification.kind };
  switch (classification.kind) {
    case "ASSIGNED":
      return { ...base, block: blockDiagnosis(classification.block), differenceMinutes: classification.differenceMinutes, punctuality: classification.punctuality };
    case "CONFIGURATION":
      return { ...base, reason: classification.reason, planReason: classification.planReason, detail: classification.detail };
    case "OUTSIDE_WINDOW":
      return { ...base, nearestBlock: blockDiagnosis(classification.nearestBlock), minutesBefore: classification.minutesBefore };
    case "UNSCHEDULED":
      return { ...base, reason: classification.reason };
    default:
      return base;
  }
}
