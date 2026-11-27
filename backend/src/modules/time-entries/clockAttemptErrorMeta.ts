import type { Prisma } from "@prisma/client";
import { publicRetryAfterSeconds } from "../../shared/errors/AppError";
import { publicClockGuidance, type ClockGuidance } from "../../shared/errors/clockGuidance";

/**
 * F7.1 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §26.13): metadata
 * pública de un intento FAILED que no tiene columna propia en
 * ClockPunchAttempt (código, mensaje y status HTTP sí la tienen). Se guarda en
 * `response` —que fuera de eso sólo usa el resultado de un COMPLETED— bajo la
 * clave `error`, para que el reintento del mismo requestId y GET attempts
 * reproduzcan exactamente el error original.
 *
 * Allowlist explícita: `retryAfterSeconds` y, desde R4.4, `clockGuidance`
 * (forma pública validada por publicClockGuidance), sólo si el AppError los
 * traía. Nunca `AppError.details`, stack ni datos internos.
 */
export function failedAttemptResponse(error: { retryAfterSeconds?: number; clockGuidance?: ClockGuidance }): Prisma.InputJsonValue | undefined {
  const retryAfterSeconds = publicRetryAfterSeconds(error.retryAfterSeconds);
  const clockGuidance = publicClockGuidance(error.clockGuidance);
  if (retryAfterSeconds === undefined && clockGuidance === undefined) return undefined;
  return { error: { ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }), ...(clockGuidance === undefined ? {} : { clockGuidance }) } } as Prisma.InputJsonValue;
}

function storedError(response: Prisma.JsonValue | null): Record<string, unknown> | undefined {
  if (!response || typeof response !== "object" || Array.isArray(response)) return undefined;
  const error = response.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  return error as Record<string, unknown>;
}

/** Relee lo que guardó failedAttemptResponse; cualquier otra forma se ignora. */
export function failedAttemptRetryAfterSeconds(response: Prisma.JsonValue | null): number | undefined {
  return publicRetryAfterSeconds(storedError(response)?.retryAfterSeconds);
}

/** R4.4: relee la guía del fichador guardada (allowlist: sólo la forma pública validada). */
export function failedAttemptClockGuidance(response: Prisma.JsonValue | null): ClockGuidance | undefined {
  return publicClockGuidance(storedError(response)?.clockGuidance);
}
