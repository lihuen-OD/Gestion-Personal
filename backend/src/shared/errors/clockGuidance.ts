/**
 * R4.4 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.6): guía PÚBLICA y
 * acotada que el fichador necesita para resolver una salida dudosa sin
 * persistir nada: pedir confirmación (posible olvido de salida) u ofrecer la
 * entrada al bloque siguiente (límite superado). Igual que `retryAfterSeconds`,
 * se devuelve en todos los entornos y se guarda en el intento FAILED para que
 * un reintento del mismo requestId repita exactamente la misma respuesta.
 * Nunca lleva `details`, datos personales ni nombres internos.
 */
export type ClockGuidance = {
  kind: "EXIT_CONFIRMATION_REQUIRED" | "SHIFT_LIMIT_EXCEEDED";
  openShiftId: string;
  openShiftStartAt: string;
  previousBlock: { startAt: string; endAt: string };
  nextBlock: { key: string; startAt: string } | null;
  exitAt: string;
  exitDurationMinutes: number;
};

const isIso = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
const isShortString = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 120;

/** Único criterio de una guía válida; cualquier otra forma se descarta (nunca se publica). */
export function publicClockGuidance(value: unknown): ClockGuidance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "EXIT_CONFIRMATION_REQUIRED" && raw.kind !== "SHIFT_LIMIT_EXCEEDED") return undefined;
  const previous = raw.previousBlock as Record<string, unknown> | null | undefined;
  const next = raw.nextBlock as Record<string, unknown> | null | undefined;
  if (!isShortString(raw.openShiftId) || !isIso(raw.openShiftStartAt) || !isIso(raw.exitAt)) return undefined;
  if (!previous || typeof previous !== "object" || !isIso(previous.startAt) || !isIso(previous.endAt)) return undefined;
  if (next !== null && (!next || typeof next !== "object" || !isShortString(next.key) || !isIso(next.startAt))) return undefined;
  if (typeof raw.exitDurationMinutes !== "number" || !Number.isInteger(raw.exitDurationMinutes) || raw.exitDurationMinutes < 0) return undefined;
  if (raw.kind === "EXIT_CONFIRMATION_REQUIRED" && next === null) return undefined;
  return {
    kind: raw.kind,
    openShiftId: raw.openShiftId,
    openShiftStartAt: raw.openShiftStartAt,
    previousBlock: { startAt: previous.startAt as string, endAt: previous.endAt as string },
    nextBlock: next ? { key: next.key as string, startAt: next.startAt as string } : null,
    exitAt: raw.exitAt,
    exitDurationMinutes: raw.exitDurationMinutes,
  };
}
