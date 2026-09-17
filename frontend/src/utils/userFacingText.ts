import { formatDurationMinutes } from "./hours";

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

/**
 * Adapta observaciones históricas generadas por el motor de fichadas. Los
 * identificadores siguen disponibles en los datos/auditoría, pero nunca se
 * presentan como parte del texto operativo para RRHH.
 */
export function formatTimeEntryObservation(value: string | null | undefined): string {
  if (!value) return "";

  return value
    .replace(/Generado por fichada de ingreso\/salida\./gi, "Generado automáticamente a partir de la fichada.")
    .replace(
      /Fichada\s+[0-9a-f-]{36}:\s*generado por ingreso\/salida\./gi,
      "Generado automáticamente a partir de la fichada.",
    )
    .replace(/Multiplicador efectivo x([\d.,]+)\s*\((\d+) min reales\)\./gi, (_match, multiplier, minutes) =>
      `Multiplicador x${multiplier} · ${formatDurationMinutes(Number(minutes))} trabajadas.`,
    )
    .replace(UUID_PATTERN, "")
    .replace(/Fichada\s*:\s*/gi, "Generado automáticamente a partir de la fichada. ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
