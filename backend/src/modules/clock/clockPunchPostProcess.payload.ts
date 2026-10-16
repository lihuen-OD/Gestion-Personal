import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { periodFromInstant } from "../../shared/datetime/argentinaTime";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { clockPunchPostProcessRepository as repository } from "./clockPunchPostProcess.repository";

/**
 * PERF-5D (docs/decisions/F12_PERF_5.md): contrato del payload de cada job del
 * post-proceso de fichadas. Lo escribe la transacción de la fichada
 * (timeEntries.service) y lo valida el worker antes de usarlo. Sin
 * dependencias de los módulos que el worker ejecuta, así el servicio de
 * fichada lo importa sin ciclos.
 */
const auditSchema = z.object({ userId: z.string().nullish(), ipAddress: z.string().nullish(), userAgent: z.string().nullish() });
export const entryPayloadSchema = z.object({ actualAt: z.coerce.date() });
export const rolloverPayloadSchema = entryPayloadSchema.extend({ previousShift: z.object({ id: z.string().min(1), startAt: z.coerce.date() }) });
export const exitPayloadSchema = z.object({
  actualAt: z.coerce.date(),
  segments: z.array(z.object({
    startAt: z.coerce.date(),
    minutes: z.number(),
    conceptStatus: z.enum(["SUGERIDO", "MANUAL", "SIN_CONCEPTO_COMPATIBLE", "CONCEPTO_NO_HABILITADO"]),
  })),
  audit: auditSchema.optional(),
});

export type ClockPunchEntryPayload = z.input<typeof entryPayloadSchema>;
export type ClockPunchRolloverPayload = z.input<typeof rolloverPayloadSchema>;
export type ClockPunchExitPayload = z.input<typeof exitPayloadSchema>;

/** Lo que el servicio de fichada encola, por tipo (fechas como Date o ISO). */
export type ClockPunchPostProcessRequest =
  | { kind: "ENTRY"; payload: ClockPunchEntryPayload; periods: string[] }
  | { kind: "ROLLOVER_ENTRY"; payload: ClockPunchRolloverPayload; periods: string[] }
  | { kind: "EXIT"; payload: ClockPunchExitPayload; periods: string[] };

export function entryPostProcess(actualAt: Date): ClockPunchPostProcessRequest {
  return { kind: "ENTRY", payload: { actualAt }, periods: [periodFromInstant(actualAt)] };
}

export function rolloverPostProcess(actualAt: Date, previousShift: { id: string; startAt: Date }): ClockPunchPostProcessRequest {
  return { kind: "ROLLOVER_ENTRY", payload: { actualAt, previousShift: { id: previousShift.id, startAt: previousShift.startAt } }, periods: [periodFromInstant(actualAt)] };
}

/** `periods`: los de los tramos ya persistidos (los que Motor B recalcula). */
export function exitPostProcess(actualAt: Date, segments: ClockPunchExitPayload["segments"], periods: string[], audit?: AuditContext): ClockPunchPostProcessRequest {
  return {
    kind: "EXIT",
    payload: { actualAt, segments: segments.map(({ startAt, minutes, conceptStatus }) => ({ startAt, minutes, conceptStatus })), ...(audit ? { audit: { userId: audit.userId ?? null, ipAddress: audit.ipAddress ?? null, userAgent: audit.userAgent ?? null } } : {}) },
    periods: [...new Set(periods)],
  };
}

export function enqueueClockPunchPostProcess(tx: PrismaTransactionClient, created: { attendancePunchId: string; workShiftId: string; employeeId: string }, request: ClockPunchPostProcessRequest) {
  return repository.enqueue(tx, {
    ...created,
    kind: request.kind,
    periods: request.periods,
    payload: JSON.parse(JSON.stringify(request.payload)) as Prisma.InputJsonValue,
  });
}
