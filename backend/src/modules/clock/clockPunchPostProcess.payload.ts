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
// R4.4 (SHIFT_ROTATION_AUDIT_PLAN.md §25.6): diagnóstico de rotación CONGELADO
// en la fichada (mismo objeto que va al AuditLog). Opcional: sin él, el job es
// exactamente el legacy. El post-proceso nunca recalcula la rotación.
// Fechas del diagnóstico: ISO (como quedan en JSON) o Date; siempre Date al leer.
const isoDate = z.union([z.string(), z.date()]).pipe(z.coerce.date());
export const rotationBlockPayloadSchema = z.object({
  obligationKey: z.string().min(1),
  operationalDate: z.string().min(1),
  templateCode: z.string().min(1),
  scheduledStartAt: isoDate,
  scheduledEndAt: isoDate,
}).passthrough();
export const rotationEntryPayloadSchema = z.object({
  version: z.number().int(),
  // R4.5: + CONVOKED_WITHOUT_SCHEDULE y `planIssue` (versión 2). Los jobs v1 ya
  // encolados siguen siendo válidos con este mismo schema.
  kind: z.enum(["ASSIGNED", "CONFIGURATION", "DAY_OFF", "OUTSIDE_WINDOW", "UNSCHEDULED", "CONVOKED_WITHOUT_SCHEDULE"]),
  evaluatedAt: isoDate,
  block: rotationBlockPayloadSchema.optional(),
  differenceMinutes: z.number().optional(),
  punctuality: z.enum(["ON_TIME", "EARLY", "LATE"]).optional(),
  reason: z.string().optional(),
  planReason: z.string().optional(),
  detail: z.array(z.string()).optional(),
  nearestBlock: rotationBlockPayloadSchema.optional(),
  minutesBefore: z.number().optional(),
  planIssue: z.object({ kind: z.enum(["MISSING", "CONFLICT"]), planReason: z.string(), detail: z.array(z.string()) }).optional(),
}).passthrough();
export const entryPayloadSchema = z.object({ actualAt: z.coerce.date(), rotationEntry: rotationEntryPayloadSchema.optional() });
export const rolloverPayloadSchema = entryPayloadSchema.extend({
  previousShift: z.object({ id: z.string().min(1), startAt: z.coerce.date() }),
  // R4.4: el ingreso a un bloque posterior dejó la jornada anterior (con
  // bloque) sin salida. `alertOnly`: régimen ALERT_ONLY congelado en la fichada.
  // R4.5: sin `previousBlock` cuando la jornada anterior no tenía bloque.
  blockChange: z.object({ previousBlock: rotationBlockPayloadSchema.optional(), nextBlock: rotationBlockPayloadSchema, alertOnly: z.boolean() }).optional(),
});
export const exitPayloadSchema = z.object({
  actualAt: z.coerce.date(),
  segments: z.array(z.object({
    startAt: z.coerce.date(),
    minutes: z.number(),
    conceptStatus: z.enum(["SUGERIDO", "MANUAL", "SIN_CONCEPTO_COMPATIBLE", "CONCEPTO_NO_HABILITADO"]),
  })),
  audit: auditSchema.optional(),
  // R4.4: salida de una jornada con bloque señalada como posible olvido de
  // salida y confirmada por la persona en el fichador.
  rotationExit: z.object({
    kind: z.literal("LIKELY_FORGOTTEN_EXIT"),
    confirmed: z.boolean(),
    previousBlock: z.object({ templateCode: z.string(), scheduledStartAt: isoDate, scheduledEndAt: isoDate }),
    nextBlock: rotationBlockPayloadSchema,
    minutesAfterScheduledEnd: z.number(),
  }).optional(),
});

export type ClockPunchEntryPayload = z.input<typeof entryPayloadSchema>;
export type ClockPunchRolloverPayload = z.input<typeof rolloverPayloadSchema>;
export type ClockPunchExitPayload = z.input<typeof exitPayloadSchema>;

/** Lo que el servicio de fichada encola, por tipo (fechas como Date o ISO). */
export type ClockPunchPostProcessRequest =
  | { kind: "ENTRY"; payload: ClockPunchEntryPayload; periods: string[] }
  | { kind: "ROLLOVER_ENTRY"; payload: ClockPunchRolloverPayload; periods: string[] }
  | { kind: "EXIT"; payload: ClockPunchExitPayload; periods: string[] };

export function entryPostProcess(actualAt: Date, rotationEntry?: ClockPunchEntryPayload["rotationEntry"]): ClockPunchPostProcessRequest {
  return { kind: "ENTRY", payload: { actualAt, ...(rotationEntry ? { rotationEntry } : {}) }, periods: [periodFromInstant(actualAt)] };
}

export function rolloverPostProcess(
  actualAt: Date,
  previousShift: { id: string; startAt: Date },
  rotation: { rotationEntry?: ClockPunchEntryPayload["rotationEntry"]; blockChange?: ClockPunchRolloverPayload["blockChange"] } = {},
): ClockPunchPostProcessRequest {
  return {
    kind: "ROLLOVER_ENTRY",
    payload: {
      actualAt,
      previousShift: { id: previousShift.id, startAt: previousShift.startAt },
      ...(rotation.rotationEntry ? { rotationEntry: rotation.rotationEntry } : {}),
      ...(rotation.blockChange ? { blockChange: rotation.blockChange } : {}),
    },
    periods: [periodFromInstant(actualAt)],
  };
}

/** `periods`: los de los tramos ya persistidos (los que Motor B recalcula). */
export function exitPostProcess(actualAt: Date, segments: ClockPunchExitPayload["segments"], periods: string[], audit?: AuditContext, rotationExit?: ClockPunchExitPayload["rotationExit"]): ClockPunchPostProcessRequest {
  return {
    kind: "EXIT",
    payload: {
      actualAt,
      segments: segments.map(({ startAt, minutes, conceptStatus }) => ({ startAt, minutes, conceptStatus })),
      ...(audit ? { audit: { userId: audit.userId ?? null, ipAddress: audit.ipAddress ?? null, userAgent: audit.userAgent ?? null } } : {}),
      ...(rotationExit ? { rotationExit } : {}),
    },
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
