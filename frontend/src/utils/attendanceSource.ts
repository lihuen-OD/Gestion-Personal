// Origen de una jornada o de una fichada en Asistencia (columna "Origen").
const SOURCE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  PORTAL_DNI: "Fichador",
  PUBLIC_CLOCK_PHOTO: "Fichador con foto",
  KIOSK: "Kiosco",
  BIOTIME: "BioTime",
  FACIAL: "Facial",
};

/**
 * Etapa 15M.20: nunca el enum crudo; un valor nuevo del backend se muestra
 * como "Origen no identificado" hasta que tenga su texto.
 *
 * F9 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §28): una fichada de
 * kiosco muestra "Kiosco · <nombre del dispositivo>", con el nombre ACTUAL que
 * el backend trae en la misma consulta. No hay snapshot: si RRHH renombra el
 * equipo, sus fichadas anteriores también muestran el nombre nuevo. Una
 * fichada histórica sin dispositivo queda "Kiosco". PUBLIC_CLOCK_PHOTO (el
 * alias legacy) conserva su texto aunque desde F6 también tenga dispositivo.
 */
export function attendanceSourceLabel(source: string, deviceName?: string | null) {
  const label = SOURCE_LABELS[source] || "Origen no identificado";
  const device = deviceName?.trim();
  return source === "KIOSK" && device ? `${label} · ${device}` : label;
}
