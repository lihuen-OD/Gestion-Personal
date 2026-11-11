import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Clock3 } from "lucide-react";
import { Brand } from "../../components/ui/Brand";
import { kioskActivity } from "../../pwa/kioskActivity";
import { MaintenanceAccessDialog, type GrantedMaintenance } from "./MaintenanceAccessDialog";
import { MaintenancePanel, type MaintenanceExitReason } from "./MaintenancePanel";
import { MaintenanceTriggerContext } from "./maintenanceTrigger";

/** Etapa 6B-4 (F6-05): cuánto queda a la vista el aviso de vencimiento antes de volver solo al fichador. */
export const MAINTENANCE_EXPIRED_NOTICE_MS = 8_000;
export const MAINTENANCE_EXPIRED_TITLE = "El acceso de mantenimiento venció";

type Mode = { kind: "closed" } | { kind: "access" } | { kind: "active"; access: GrantedMaintenance } | { kind: "expired" };

/**
 * Modo mantenimiento del dispositivo (docs/decisions/FICHADOR_MAINTENANCE_MODE.md).
 * Lo monta ClockDeviceGate sólo con el equipo ACTIVE: si RRHH lo revoca, el
 * Gate lo desmonta y el token en memoria se pierde con él.
 *
 * - Cerrado: el fichador normal, sin ningún control administrativo visible. El
 *   encabezado acepta el gesto oculto (useMaintenanceTrigger).
 * - Acceso: diálogo para el código de RRHH sobre el fichador.
 * - Activo: el panel reemplaza al fichador hasta salir o vencer.
 * - Vencido (6B-4, F6-05): el panel ya se desmontó (sin datos del equipo ni
 *   token); un aviso breve, sólo informativo, explica por qué se cerró y vuelve
 *   solo al fichador. La salida voluntaria no lo muestra.
 *
 * Mientras el acceso, el panel o el aviso están abiertos, una actualización de
 * la app no recarga la pantalla (kioskActivity.hold).
 */
export function ClockMaintenanceMode({ children, onReconfigure }: { children: ReactNode; onReconfigure: () => Promise<boolean> }) {
  const [mode, setMode] = useState<Mode>({ kind: "closed" });
  const open = mode.kind !== "closed";

  useEffect(() => (open ? kioskActivity.hold() : undefined), [open]);

  const requestAccess = useCallback(() => setMode((current) => (current.kind === "closed" ? { kind: "access" } : current)), []);
  const close = useCallback(() => setMode({ kind: "closed" }), []);
  const exitPanel = useCallback((reason?: MaintenanceExitReason) => setMode(reason === "expired" ? { kind: "expired" } : { kind: "closed" }), []);
  const grant = useCallback((access: GrantedMaintenance) => setMode({ kind: "active", access }), []);

  if (mode.kind === "active") return <MaintenancePanel access={mode.access} onExit={exitPanel} onReconfigure={onReconfigure} />;
  if (mode.kind === "expired") return <MaintenanceExpiredNotice onDone={close} />;
  return (
    <MaintenanceTriggerContext.Provider value={requestAccess}>
      {children}
      {mode.kind === "access" ? <MaintenanceAccessDialog onCancel={close} onGranted={grant} /> : null}
    </MaintenanceTriggerContext.Provider>
  );
}

/**
 * Aviso de vencimiento: sin datos del equipo ni acciones de mantenimiento,
 * sólo el motivo y la vuelta al fichador (con el mismo lenguaje visual de las
 * pantallas de estado del Gate). Se anuncia como alerta y el foco va a su
 * única acción.
 */
function MaintenanceExpiredNotice({ onDone }: { onDone: () => void }) {
  const action = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    action.current?.focus();
    const timer = window.setTimeout(onDone, MAINTENANCE_EXPIRED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="device-gate">
      <header className="device-gate-top"><Brand /></header>
      <main className="device-gate-body" aria-labelledby="maintenance-expired-title">
        <div className="device-gate-lead" role="alert">
          <span className="device-gate-tile is-neutral" aria-hidden="true"><Clock3 strokeWidth={1.75} /></span>
          <h1 id="maintenance-expired-title">{MAINTENANCE_EXPIRED_TITLE}</h1>
          <p className="device-gate-desc">Para volver a entrar, RRHH tiene que generar un código nuevo. El fichador vuelve a estar disponible.</p>
        </div>
        <div className="device-gate-main">
          <div className="device-gate-stack">
            <button ref={action} type="button" className="button primary device-gate-action" onClick={onDone}>Volver al fichador</button>
          </div>
        </div>
      </main>
    </div>
  );
}
