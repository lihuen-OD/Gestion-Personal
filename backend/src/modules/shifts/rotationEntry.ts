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

/** 2 = R4.5: precedencia franco/feriado antes que configuración, `planIssue` y CONVOKED_WITHOUT_SCHEDULE. */
export const ROTATION_DIAGNOSIS_VERSION = 2;

/** ¿La jornada tiene un bloque de rotación congelado en su ingreso? (null en jornadas legacy). */
export function isRotationBlockShift<S extends { shiftTemplateSource?: string | null; scheduledStartAt?: Date | null; shiftTemplateId: string | null }>(shift: S): shift is S & { scheduledStartAt: Date; shiftTemplateId: string } {
  return (shift.shiftTemplateSource === "ROTATION" || shift.shiftTemplateSource === "HOLIDAY_CONVOCATION") && Boolean(shift.scheduledStartAt) && Boolean(shift.shiftTemplateId);
}

type Block = ExpectedBlock<LoadedRotationTemplate>;

const minutesBetween = (later: Date, earlier: Date) => Math.round((later.getTime() - earlier.getTime()) / 60_000);

/** Configuración faltante o contradictoria de la fecha, conservada aunque otra regla decida la clasificación (trazabilidad, R4.5). */
export type RotationPlanIssue = { kind: "MISSING" | "CONFLICT"; planReason: string; detail: string[] };

export type RotationEntryClassification =
  | { kind: "ASSIGNED"; block: Block; differenceMinutes: number; punctuality: "ON_TIME" | "EARLY" | "LATE" }
  | { kind: "CONFIGURATION"; reason: "MISSING" | "CONFLICT"; planReason: string; detail: string[] }
  | { kind: "DAY_OFF"; planIssue?: RotationPlanIssue }
  | { kind: "OUTSIDE_WINDOW"; nearestBlock: Block; minutesBefore: number }
  | { kind: "CONVOKED_WITHOUT_SCHEDULE" }
  | { kind: "UNSCHEDULED"; reason: "REST" | "HOLIDAY_NOT_CONVOKED" | "REGIME_SIN_TURNO" | "NO_BLOCKS"; planIssue?: RotationPlanIssue };

function planIssueOf(obligation: RotationObligation | undefined): RotationPlanIssue | undefined {
  const plan = obligation?.plan;
  if (plan?.kind === "MISSING") return { kind: "MISSING", planReason: plan.reason, detail: [] };
  if (plan?.kind === "CONFLICT") return { kind: "CONFLICT", planReason: plan.reason, detail: plan.detail };
  return undefined;
}

/**
 * Precedencia determinística (R4.5, SHIFT_ROTATION_AUDIT_PLAN.md §25.7):
 * bloque asignado → franco de la fecha → feriado no convocado → configuración
 * faltante o contradictoria → fuera de ventana de un bloque posterior de esa
 * misma fecha → convocado sin horario → no programado (régimen SIN_TURNO,
 * descanso de la rotación o fuera de los bloques del día).
 * Franco y feriado no convocado no tienen obligación: un problema de
 * configuración de esa fecha no se informa por la fichada, pero queda en
 * `planIssue` (diagnóstico). Un bloque asignado nunca oculta un franco: el
 * franco de D elimina los bloques de D; sólo se asignan bloques de D−1/D+1 cuya
 * fecha operativa no lo tiene.
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
  const reason = obligation?.resolution.reason;
  const planIssue = planIssueOf(obligation);
  const withIssue = planIssue ? { planIssue } : {};
  if (obligation?.dayOff || reason === "DAY_OFF") return { kind: "DAY_OFF", ...withIssue };
  if (reason === "HOLIDAY_NOT_CONVOKED") return { kind: "UNSCHEDULED", reason: "HOLIDAY_NOT_CONVOKED", ...withIssue };
  if (planIssue) return { kind: "CONFIGURATION", reason: planIssue.kind, planReason: planIssue.planReason, detail: planIssue.detail };
  const nextSameDay = blocks.find((block) => block.operationalDate === dateKey && block.scheduledStartAt > instant);
  if (nextSameDay) return { kind: "OUTSIDE_WINDOW", nearestBlock: nextSameDay, minutesBefore: minutesBetween(nextSameDay.scheduledStartAt, instant) };
  if (reason === "HOLIDAY_CONVOCATION_WITHOUT_SCHEDULE") return { kind: "CONVOKED_WITHOUT_SCHEDULE" };
  if (reason === "REGIME_SIN_TURNO") return { kind: "UNSCHEDULED", reason: "REGIME_SIN_TURNO" };
  if (obligation?.plan.kind === "REST") return { kind: "UNSCHEDULED", reason: "REST" };
  return { kind: "UNSCHEDULED", reason: "NO_BLOCKS" };
}

/**
 * R4.5 (SHIFT_ROTATION_AUDIT_PLAN.md §25.7): ¿una ENTRADA asignada a `block`
 * con una jornada abierta SIN bloque (abierta fuera de ventana, no programada,
 * en franco o sin configuración) es un cambio de bloque de R4.4? Sólo si la
 * jornada empezó antes que el bloque y su propio ingreso no se asignaría a ese
 * mismo bloque: así un reintento, un doble toque o la misma llegada nunca
 * cuentan como una entrada nueva (además del enfriamiento y la idempotencia
 * por requestId de siempre).
 */
export function isBlockChangeFromUnblockedShift(openShiftStartAt: Date, block: Block, blocks: readonly Block[]): boolean {
  if (openShiftStartAt.getTime() >= block.scheduledStartAt.getTime()) return false;
  const openAssignment = assignInstantToBlock(openShiftStartAt, blocks);
  return !(openAssignment.kind === "ASSIGNED" && openAssignment.block.obligationKey === block.obligationKey);
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
      return { ...base, reason: classification.reason, ...(classification.planIssue ? { planIssue: classification.planIssue } : {}) };
    case "DAY_OFF":
      return classification.planIssue ? { ...base, planIssue: classification.planIssue } : base;
    default:
      return base;
  }
}
