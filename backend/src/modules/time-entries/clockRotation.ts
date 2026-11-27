/**
 * Fichador ↔ rotaciones — R4.4 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md
 * §25.6). Piezas que usa `clockPhotoPunch` SÓLO para miembros de rotación o
 * jornadas con bloque congelado; los empleados legacy nunca pasan por acá.
 *
 * Motor único: bloques efectivos de R4.3b (`effectiveBlocksAround`) +
 * `classifyRotationEntry`/`classifyRotationExit` (R4.4, sobre
 * `assignInstantToBlock` de R4.2).
 */
import type { WorkShift } from "@prisma/client";
import { argentinaCalendarDate, argentinaDateKey, argentinaDateParts, scheduledInstantForShiftTime } from "../../shared/datetime/argentinaTime";
import { AppError } from "../../shared/errors/AppError";
import type { ClockGuidance } from "../../shared/errors/clockGuidance";
import { prisma } from "../../shared/prisma/client";
import { auditService, type AuditContext } from "../audit/audit.service";
import { effectiveBlocksAround, neighborDateKeys, type RotationObligation } from "../shifts/rotationObligation.service";
import { blockDiagnosis, ROTATION_DIAGNOSIS_VERSION, type OpenBlockShift, type RotationExitClassification } from "../shifts/rotationEntry";
import type { LoadedRotationTemplate } from "../shifts/rotationPlan.loader";
import type { ExpectedBlock } from "../shifts/rotationPlan";
import { buildTemplateRulesSnapshot, effectiveShiftTemplate } from "../shifts/templateRulesSnapshot";
import type { WorkShiftBlockAdoption } from "./timeEntries.repository";

type Block = ExpectedBlock<LoadedRotationTemplate>;

export type RotationPunchContext = { obligationsByDate: ReadonlyMap<string, RotationObligation> | undefined; blocks: Block[] };

/** Rango D−1..D+1 (fechas calendario) para el conteo de membresías del contexto de la fichada. */
export function rotationMembershipRange(now: Date) {
  const [from, , to] = neighborDateKeys(now);
  return { from: argentinaCalendarDate(from), to: argentinaCalendarDate(to) };
}

/** Bloques efectivos y obligaciones de D−1..D+1 de una persona (consultas en lote de R4.3b). */
export async function loadRotationPunchContext(employeeId: string, now: Date): Promise<RotationPunchContext> {
  const { obligations, blocksByEmployee } = await effectiveBlocksAround([employeeId], neighborDateKeys(now));
  return { obligationsByDate: obligations.get(employeeId), blocks: blocksByEmployee.get(employeeId) ?? [] };
}

export function adoptionFor(block: Block, capturedAt: Date = new Date()): WorkShiftBlockAdoption {
  return {
    shiftTemplateId: block.template.id,
    shiftTemplateSource: block.source === "HOLIDAY_CONVOCATION" ? "HOLIDAY_CONVOCATION" : "ROTATION",
    scheduledStartAt: block.scheduledStartAt,
    maxAllowedMinutes: block.template.absoluteOpenShiftLimitMinutes,
    // R4.6 (§25.9): las reglas del bloque quedan congeladas en la apertura.
    templateRulesSnapshot: buildTemplateRulesSnapshot(block.template, capturedAt),
  };
}

/**
 * La jornada abierta con bloque, con su plantilla congelada. R4.6 (§25.9): con
 * snapshot, sus reglas (sin lectura); sin él (jornadas anteriores), la
 * plantilla en vivo (una lectura, como antes).
 */
export async function openBlockShiftOf(shift: Pick<WorkShift, "id" | "startAt" | "maxAllowedMinutes" | "shiftTemplateId"> & { scheduledStartAt: Date; templateRulesSnapshot?: unknown }): Promise<OpenBlockShift | null> {
  if (!shift.shiftTemplateId) return null;
  const template = effectiveShiftTemplate(shift, null) ?? await prisma.shiftTemplate.findUnique({
    where: { id: shift.shiftTemplateId },
    select: { code: true, startTime: true, endTime: true, crossesMidnight: true, exitToleranceAfterMinutes: true },
  });
  if (!template) return null;
  return {
    id: shift.id,
    startAt: shift.startAt,
    scheduledStartAt: shift.scheduledStartAt,
    maxAllowedMinutes: shift.maxAllowedMinutes,
    template,
    scheduledEndAt: scheduledInstantForShiftTime(shift.scheduledStartAt, template.endTime, template.crossesMidnight),
  };
}

/** Bloque (forma del diagnóstico/payload) de una jornada abierta con bloque congelado. */
export function openShiftBlockDiagnosis(employeeId: string, open: OpenBlockShift) {
  return {
    obligationKey: `${employeeId}|${open.scheduledStartAt.toISOString()}`,
    operationalDate: argentinaDateKey(open.scheduledStartAt),
    templateCode: open.template.code,
    scheduledStartAt: open.scheduledStartAt.toISOString(),
    scheduledEndAt: open.scheduledEndAt.toISOString(),
  };
}

export function exitDiagnosis(classification: RotationExitClassification, open: OpenBlockShift, evaluatedAt: Date, confirmed: boolean) {
  const base = { version: ROTATION_DIAGNOSIS_VERSION, evaluatedAt: evaluatedAt.toISOString(), exit: classification.kind, openShiftId: open.id };
  if (classification.kind === "LIKELY_FORGOTTEN_EXIT") {
    return { ...base, confirmed, nextBlock: blockDiagnosis(classification.nextBlock), minutesAfterScheduledEnd: classification.minutesAfterScheduledEnd, exitDurationMinutes: classification.exitDurationMinutes };
  }
  if (classification.kind === "LIMIT_EXCEEDED") {
    return { ...base, minutesOpen: classification.minutesOpen, limitMinutes: classification.limitMinutes, nextBlock: classification.nextBlock ? blockDiagnosis(classification.nextBlock) : null };
  }
  return base;
}

const hhmm = (instant: Date) => {
  const { hour, minute } = argentinaDateParts(instant);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

function guidance(kind: ClockGuidance["kind"], open: OpenBlockShift, next: Block | null, now: Date): ClockGuidance {
  return {
    kind,
    openShiftId: open.id,
    openShiftStartAt: open.startAt.toISOString(),
    previousBlock: { startAt: open.scheduledStartAt.toISOString(), endAt: open.scheduledEndAt.toISOString() },
    nextBlock: next ? { key: next.obligationKey, startAt: next.scheduledStartAt.toISOString() } : null,
    exitAt: now.toISOString(),
    exitDurationMinutes: Math.max(0, Math.round((now.getTime() - open.startAt.getTime()) / 60_000)),
  };
}

/** Pregunta previa (nada persistido): el mensaje es el que ve la persona; la guía, lo que el fichador necesita. */
export function exitConfirmationRequired(open: OpenBlockShift, next: Block, now: Date) {
  return new AppError(
    `Tu turno anterior terminó a las ${hhmm(open.scheduledEndAt)} y ahora tenés otro turno programado a las ${hhmm(next.scheduledStartAt)}. ¿Estás ingresando al nuevo turno o querés registrar la salida anterior?`,
    409,
    "CLOCK_EXIT_CONFIRMATION_REQUIRED",
    undefined,
    { clockGuidance: guidance("EXIT_CONFIRMATION_REQUIRED", open, next, now) },
  );
}

export function shiftLimitExceeded(open: OpenBlockShift, next: Block | null, now: Date) {
  return new AppError(
    "No pudimos registrar la salida: tu jornada anterior superó el máximo permitido y quedó para revisión del encargado. Si estás ingresando a tu turno, registrá ENTRADA.",
    409,
    "CLOCK_SHIFT_LIMIT_EXCEEDED",
    undefined,
    { clockGuidance: guidance("SHIFT_LIMIT_EXCEEDED", open, next, now) },
  );
}

/**
 * Evidencia de un intento de SALIDA rechazado por límite: el intento queda
 * FAILED (ClockPunchAttempt) y además un AuditLog REJECT durable, sin foto ni
 * fichada — nunca se afirma que se registró una salida. Fuera de toda
 * transacción de fichada (no hay ninguna: se rechaza antes de escribir).
 */
export async function registerRejectedExitAttempt(input: { requestId: string; employeeId: string; legajo: string; open: OpenBlockShift; classification: RotationExitClassification; now: Date; audit?: AuditContext }) {
  await auditService.register({
    ...input.audit,
    action: "REJECT",
    entity: "ClockPunchAttempt",
    entityId: input.requestId,
    description: `Salida no registrada para legajo ${input.legajo}: la jornada abierta superó el máximo permitido.`,
    after: {
      employeeId: input.employeeId,
      workShiftId: input.open.id,
      rotationDiagnosis: exitDiagnosis(input.classification, input.open, input.now, false),
    },
  });
}
