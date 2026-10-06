// F3 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §21): el fichador
// avisa si está ocupado (hay un empleado elegido, una búsqueda en curso, la
// cámara abierta o una fichada enviándose) para que una actualización de la
// app nunca recargue la pantalla en medio de una fichada.
let busy = false;

export const kioskActivity = {
  setBusy(value: boolean) {
    busy = value;
  },
  isIdle() {
    return !busy;
  },
};
