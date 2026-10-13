import { AppError } from "../../shared/errors/AppError";

/**
 * Cooldown del fichador (F7, docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md
 * §26): ventana mínima entre dos fichadas DISTINTAS (otro requestId) del
 * mismo empleado, desde cualquier dispositivo o canal, medida con el reloj
 * del servidor. No es la idempotencia (mismo requestId reintentado, que se
 * resuelve antes y nunca llega acá) ni un rate limit (cantidad de requests).
 *
 * Partes puras y la señal que cruza repositorio → servicio. La lectura y el
 * lock viven en timeEntries.repository.ts.
 */

export type ClockPunchCooldownGuard = { windowStart: Date };

/** Otra fichada del mismo empleado está dentro de la ventana o confirmándose ahora mismo. */
export class ClockPunchCooldownConflict extends Error {
  /** `null`: otra transacción de fichada del mismo empleado tiene el lock. */
  constructor(readonly lastPunchAt: Date | null) {
    super("CLOCK_PUNCH_COOLDOWN");
  }
}

/** Ventana para una fichada tomada en `now`; `undefined` si el cooldown está desactivado (0). */
export function clockPunchCooldownGuard(now: Date, seconds: number): ClockPunchCooldownGuard | undefined {
  return seconds > 0 ? { windowStart: new Date(now.getTime() - seconds * 1000) } : undefined;
}

export const CLOCK_PUNCH_COOLDOWN_MESSAGE = "Ya registraste una fichada hace instantes. Esperá unos segundos antes de volver a fichar.";

/**
 * 409 CLOCK_PUNCH_COOLDOWN. `retryAfterSeconds` es lo que falta para que la
 * última fichada salga de la ventana (la ventana entera si otra fichada del
 * mismo empleado se está confirmando ahora), acotado a [1, seconds]. El
 * mensaje no lleva segundos: el intento lo guarda y un reintento del mismo
 * requestId lo repite tal cual, sin `retryAfterSeconds`.
 */
export function clockPunchCooldownError(lastPunchAt: Date | null, now: Date, seconds: number) {
  const remaining = lastPunchAt ? Math.ceil((lastPunchAt.getTime() + seconds * 1000 - now.getTime()) / 1000) : seconds;
  return new AppError(CLOCK_PUNCH_COOLDOWN_MESSAGE, 409, "CLOCK_PUNCH_COOLDOWN", undefined, {
    retryAfterSeconds: Math.min(seconds, Math.max(1, remaining)),
  });
}
