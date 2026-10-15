import { AlertTriangle, CheckCircle2, Download, Smartphone } from "lucide-react";
import { useInstallPrompt } from "../../pwa/installPrompt";
import { isIOSDevice, isStandaloneMode } from "../../pwa/platform";

/**
 * F10 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §29): ayuda breve para
 * dejar el equipo listo como fichador, en las pantallas de configuración y de
 * espera del Gate (nunca sobre el fichador operativo).
 *
 * Orden recomendado: instalar → abrir desde el ícono → configurar. En iPad y
 * iPhone lo que se configura en el navegador NO pasa al ícono instalado (son
 * almacenamientos distintos): la identidad nunca se copia entre contextos; se
 * evita con el orden correcto.
 */
export function DeviceInstallHint({ stage }: { stage: "setup" | "pending" }) {
  const standalone = isStandaloneMode();
  const ios = isIOSDevice();
  const install = useInstallPrompt();

  if (stage === "pending") {
    // Sólo en iOS la configuración del navegador se pierde al instalar.
    if (standalone || !ios) return null;
    return (
      <div className="setup-guide warning" role="note">
        <AlertTriangle size={17} aria-hidden="true" />
        <div>
          <b>Este equipo se está configurando desde el navegador</b>
          <p>Si después lo agregás a la pantalla de inicio, vas a tener que configurarlo de nuevo desde el ícono.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {standalone ? (
        <div className="setup-guide done" role="note">
          <CheckCircle2 size={17} aria-hidden="true" />
          <div><b>Fichador instalado en este equipo</b></div>
        </div>
      ) : (
        <div className="setup-guide" role="note">
          <Smartphone size={17} aria-hidden="true" />
          <div>
            <b>Instalá el fichador en este equipo</b>
            <p>Para usarlo como fichador, agregalo a la pantalla de inicio y configuralo desde el ícono instalado.</p>
            {ios ? (
              <>
                <ol>
                  <li>Tocá <b>Compartir</b> en la barra del navegador.</li>
                  <li>Elegí <b>“Agregar a pantalla de inicio”</b>.</li>
                  <li>Abrí el fichador desde el nuevo ícono.</li>
                </ol>
                <p className="setup-guide-note">Lo que se configura en el navegador no pasa al ícono instalado.</p>
              </>
            ) : install.available ? (
              <button type="button" className="button subtle setup-guide-install" onClick={() => void install.prompt()}>
                <Download size={16} aria-hidden="true" /> Instalar en este equipo
              </button>
            ) : (
              <p className="setup-guide-note">Desde el menú del navegador, elegí “Instalar” o “Agregar a pantalla de inicio”.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Pasos para dejar el equipo listo (plegado: no compite con la acción principal). */
export function DeviceSetupChecklist() {
  return (
    <>
      <details className="setup-checklist">
        <summary>Cómo dejar este equipo listo</summary>
        <ol>
          <li>Instalalo en la pantalla de inicio y abrilo siempre desde el ícono.</li>
          <li>Configurá el dispositivo y pedile a RRHH que lo apruebe con el código que aparece en pantalla.</li>
          <li>Permití el acceso a la cámara la primera vez que se ficha.</li>
          <li>En iPad podés activar <b>Acceso guiado</b> desde las funciones de accesibilidad del dispositivo, para que el equipo no salga del fichador. Es una ayuda de uso: no reemplaza la aprobación de RRHH ni el bloqueo del equipo.</li>
          <li>Si va a quedar encendido todo el día, dejalo conectado a la corriente. Mientras el fichador está abierto, la pantalla se mantiene encendida cuando el equipo lo permite.</li>
        </ol>
      </details>
    </>
  );
}
