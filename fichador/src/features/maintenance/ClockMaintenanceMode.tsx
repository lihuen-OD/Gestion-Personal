import { useCallback, useEffect, useState, type ReactNode } from "react";
import { kioskActivity } from "../../pwa/kioskActivity";
import { MaintenanceAccessDialog, type GrantedMaintenance } from "./MaintenanceAccessDialog";
import { MaintenancePanel } from "./MaintenancePanel";
import { MaintenanceTriggerContext } from "./maintenanceTrigger";

type Mode = { kind: "closed" } | { kind: "access" } | { kind: "active"; access: GrantedMaintenance };

/**
 * Modo mantenimiento del dispositivo (docs/decisions/FICHADOR_MAINTENANCE_MODE.md).
 * Lo monta ClockDeviceGate sólo con el equipo ACTIVE: si RRHH lo revoca, el
 * Gate lo desmonta y el token en memoria se pierde con él.
 *
 * - Cerrado: el fichador normal, sin ningún control administrativo visible. El
 *   encabezado acepta el gesto oculto (useMaintenanceTrigger).
 * - Acceso: diálogo para el código de RRHH sobre el fichador.
 * - Activo: el panel reemplaza al fichador hasta salir o vencer.
 *
 * Mientras el acceso o el panel están abiertos, una actualización de la app
 * no recarga la pantalla (kioskActivity.hold).
 */
export function ClockMaintenanceMode({ children, onReconfigure }: { children: ReactNode; onReconfigure: () => Promise<boolean> }) {
  const [mode, setMode] = useState<Mode>({ kind: "closed" });
  const open = mode.kind !== "closed";

  useEffect(() => (open ? kioskActivity.hold() : undefined), [open]);

  const requestAccess = useCallback(() => setMode((current) => (current.kind === "closed" ? { kind: "access" } : current)), []);
  const close = useCallback(() => setMode({ kind: "closed" }), []);
  const grant = useCallback((access: GrantedMaintenance) => setMode({ kind: "active", access }), []);

  if (mode.kind === "active") return <MaintenancePanel access={mode.access} onExit={close} onReconfigure={onReconfigure} />;
  return (
    <MaintenanceTriggerContext.Provider value={requestAccess}>
      {children}
      {mode.kind === "access" ? <MaintenanceAccessDialog onCancel={close} onGranted={grant} /> : null}
    </MaintenanceTriggerContext.Provider>
  );
}
