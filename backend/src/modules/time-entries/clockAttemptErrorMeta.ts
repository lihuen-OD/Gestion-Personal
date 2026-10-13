import type { Prisma } from "@prisma/client";
import { publicRetryAfterSeconds } from "../../shared/errors/AppError";

/**
 * F7.1 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §26.13): metadata
 * pública de un intento FAILED que no tiene columna propia en
 * ClockPunchAttempt (código, mensaje y status HTTP sí la tienen). Se guarda en
 * `response` —que fuera de eso sólo usa el resultado de un COMPLETED— bajo la
 * clave `error`, para que el reintento del mismo requestId y GET attempts
 * reproduzcan exactamente el error original.
 *
 * Allowlist explícita: hoy sólo `retryAfterSeconds`, y sólo si el AppError lo
 * traía. Nunca `AppError.details`, stack ni datos internos.
 */
export function failedAttemptResponse(error: { retryAfterSeconds?: number }): Prisma.InputJsonValue | undefined {
  const retryAfterSeconds = publicRetryAfterSeconds(error.retryAfterSeconds);
  return retryAfterSeconds === undefined ? undefined : { error: { retryAfterSeconds } };
}

/** Relee lo que guardó failedAttemptResponse; cualquier otra forma se ignora. */
export function failedAttemptRetryAfterSeconds(response: Prisma.JsonValue | null): number | undefined {
  if (!response || typeof response !== "object" || Array.isArray(response)) return undefined;
  const error = response.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  return publicRetryAfterSeconds(error.retryAfterSeconds);
}
