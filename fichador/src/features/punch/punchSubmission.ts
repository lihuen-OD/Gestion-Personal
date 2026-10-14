import { ApiError, NetworkError, apiErrorFromStored } from "../../services/api/apiClient";
import { isClockDeviceAuthFailure } from "../../services/api/clockDeviceSession";
import type { ClockPhotoPunchInput, ClockPunchResult, timeClockApiService } from "../../services/api/timeClockApiService";

/**
 * F8 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §27): envío de una
 * fichada y recuperación de un resultado incierto, siempre con el MISMO
 * requestId. Fuera de React a propósito: la página sólo muestra etapas y
 * resultados.
 *
 * - Resultado cierto: 201 (éxito) o un error HTTP del backend (negocio,
 *   dispositivo, cooldown): se devuelve tal cual, sin reintentar.
 * - Resultado incierto: sin respuesta (red, timeout del cliente), un 5xx sin
 *   código propio (gateway/proxy) o CLOCK_ATTEMPT_PROCESSING. La fichada pudo
 *   haberse registrado: se consulta GET /clock/attempts/:requestId con
 *   backoff. COMPLETED = éxito; FAILED = el error guardado (con su
 *   retryAfterSeconds); PROCESSING = seguir consultando.
 * - 404 en la consulta = el backend todavía no tiene el intento. Tras
 *   RESEND_AFTER_CONSECUTIVE_404 respuestas 404 seguidas se reenvía EL MISMO
 *   POST (mismo requestId y payload, seguro por la idempotencia), como máximo
 *   MAX_RESENDS veces (§14.3 del plan). Nunca se genera otro requestId.
 * - Si al agotar el presupuesto sigue sin saberse: `unconfirmed`. La página
 *   descarta ese requestId, refresca el estado del legajo y libera el kiosco.
 */

export type PunchStage = "sending" | "verifying" | "confirming";

export type PunchOutcome =
  | { kind: "success"; result: ClockPunchResult }
  | { kind: "failed"; error: ApiError }
  | { kind: "unconfirmed" };

/** Esperas antes de cada consulta del intento (ms): ~44,5 s en total, ≤ 14 consultas. */
export const RECOVERY_POLL_DELAYS_MS: readonly number[] = [500, 1_000, 1_500, 2_000, 3_000, 3_000, 3_000, 4_000, 4_000, 4_000, 4_000, 4_500, 5_000, 5_000];
export const RESEND_AFTER_CONSECUTIVE_404 = 2;
export const MAX_RESENDS = 3;

export type PunchSubmissionDeps = {
  api: Pick<typeof timeClockApiService, "photoPunch" | "attemptStatus">;
  sleep: (ms: number) => Promise<void>;
  onStage?: (stage: PunchStage) => void;
  /** La página se desmontó (p. ej. RRHH revocó el equipo): no seguir consultando. */
  isCancelled?: () => boolean;
};

/** Sin respuesta confiable del backend: la fichada pudo haberse registrado. */
export function isUncertainPunchError(error: unknown) {
  if (error instanceof NetworkError) return true;
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) return true;
  if (!(error instanceof ApiError)) return true;
  // Un 5xx con código CLOCK_ (p. ej. CLOCK_TEMPORARY_FAILURE) es la respuesta
  // del backend y es definitiva; sin código propio viene de la infraestructura.
  if (error.status >= 500 && !error.code.startsWith("CLOCK_")) return true;
  return error.code === "CLOCK_ATTEMPT_PROCESSING";
}

async function post(input: ClockPhotoPunchInput, deps: PunchSubmissionDeps): Promise<PunchOutcome | "uncertain"> {
  try {
    return { kind: "success", result: await deps.api.photoPunch(input) };
  } catch (error) {
    if (error instanceof ApiError && !isUncertainPunchError(error)) return { kind: "failed", error };
    return "uncertain";
  }
}

export async function recoverPunch(input: ClockPhotoPunchInput, deps: PunchSubmissionDeps): Promise<PunchOutcome> {
  deps.onStage?.("verifying");
  let resends = 0;
  let consecutiveNotFound = 0;
  for (const delay of RECOVERY_POLL_DELAYS_MS) {
    await deps.sleep(delay);
    if (deps.isCancelled?.()) return { kind: "unconfirmed" };
    let state;
    try {
      state = await deps.api.attemptStatus(input.requestId, input.employeeId);
    } catch (error) {
      // 401/403 del dispositivo: la sesión ya se cerró y el Gate bloquea.
      if (isClockDeviceAuthFailure(error)) return { kind: "failed", error };
      if (error instanceof ApiError && error.status === 404) {
        consecutiveNotFound += 1;
        if (consecutiveNotFound >= RESEND_AFTER_CONSECUTIVE_404 && resends < MAX_RESENDS) {
          resends += 1;
          consecutiveNotFound = 0;
          const resent = await post(input, deps);
          if (resent !== "uncertain") return resent;
          deps.onStage?.("verifying");
        }
      }
      // Red, 5xx o 429 en la consulta: se sigue dentro del presupuesto.
      continue;
    }
    consecutiveNotFound = 0;
    if (state.status === "COMPLETED" && state.response) return { kind: "success", result: state.response };
    if (state.status === "FAILED" && state.error) return { kind: "failed", error: apiErrorFromStored(state.error) };
    deps.onStage?.("confirming");
  }
  return { kind: "unconfirmed" };
}

export async function submitPunch(input: ClockPhotoPunchInput, deps: PunchSubmissionDeps): Promise<PunchOutcome> {
  deps.onStage?.("sending");
  const first = await post(input, deps);
  if (first !== "uncertain") return first;
  if (deps.isCancelled?.()) return { kind: "unconfirmed" };
  return recoverPunch(input, deps);
}
