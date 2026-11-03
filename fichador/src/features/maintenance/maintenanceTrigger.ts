import { createContext, useContext } from "react";
import { useLongPress } from "./useLongPress";

/** Cuánto hay que mantener presionado el encabezado del fichador. */
export const MAINTENANCE_LONG_PRESS_MS = 5_000;

/**
 * Lo provee ClockMaintenanceMode sólo con el dispositivo ACTIVE. Sin proveedor
 * (fichador sin Gate, tests de la página) el gesto no hace nada.
 */
export const MaintenanceTriggerContext = createContext<(() => void) | null>(null);

/** Handlers del gesto oculto para el encabezado del fichador. `enabled`: kiosco ocioso. */
export function useMaintenanceTrigger(enabled: boolean) {
  const requestAccess = useContext(MaintenanceTriggerContext);
  return useLongPress(() => requestAccess?.(), { durationMs: MAINTENANCE_LONG_PRESS_MS, enabled: enabled && requestAccess !== null });
}
