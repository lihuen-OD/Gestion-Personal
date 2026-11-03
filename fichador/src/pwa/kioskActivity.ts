// F3 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §21): el fichador
// avisa si está ocupado (hay un empleado elegido, una búsqueda en curso, la
// cámara abierta o una fichada enviándose) para que una actualización de la
// app nunca recargue la pantalla en medio de una fichada.
let busy = false;
// Modo mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md): retenciones
// independientes del estado del fichador, que no se pisan con setBusy.
const holds = new Set<symbol>();

export const kioskActivity = {
  setBusy(value: boolean) {
    busy = value;
  },
  /** Mantiene el kiosco ocupado hasta llamar a la función que devuelve. */
  hold() {
    const token = Symbol("kiosk-hold");
    holds.add(token);
    return () => {
      holds.delete(token);
    };
  },
  isIdle() {
    return !busy && holds.size === 0;
  },
};
