export const DOUBLE_HOUR_MULTIPLIER_MIN = 1;
export const DOUBLE_HOUR_MULTIPLIER_MAX = 5;

export function doubleHourMultiplierError(multiplier: number): string | null {
  if (!Number.isFinite(multiplier) || multiplier < DOUBLE_HOUR_MULTIPLIER_MIN || multiplier > DOUBLE_HOUR_MULTIPLIER_MAX) {
    return `El multiplicador debe estar entre ${DOUBLE_HOUR_MULTIPLIER_MIN} y ${DOUBLE_HOUR_MULTIPLIER_MAX}.`;
  }
  return null;
}
