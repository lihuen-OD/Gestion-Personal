import { MonitorSmartphone, ShieldCheck, TabletSmartphone } from "lucide-react";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";

// F6 de docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md: el backend ya no
// acepta el token compartido con el que fichaba esta app, así que /fichador
// deja de ser un fichador. Sólo informa dónde se ficha ahora; no carga
// cámara, no busca empleados y no llama a ningún endpoint de /clock. La ruta
// se conserva (marcadores y accesos directos viejos) hasta el retiro final
// de F12.
const MESSAGE = "Las fichadas se registran desde la app Fichador instalada en cada equipo habilitado por RRHH. Esta pantalla ya no registra ingresos ni salidas.";

export function TimeClockMovedPage({ variant, canManageDevices = false }: { variant: "public" | "app"; canManageDevices?: boolean }) {
  if (variant === "public") {
    return (
      <main className="login-page clock-moved-page">
        <section className="login-brand">
          <div className="brand-mark"><TabletSmartphone size={28} /></div>
          <p className="eyebrow">LOS O'DWYER · CONTROL HORARIO</p>
          <h1>
            El fichador
            <br />
            <span>tiene su propia app.</span>
          </h1>
          <div className="login-feature"><ShieldCheck /> Cada equipo autorizado individualmente por RRHH</div>
        </section>
        <section className="login-card">
          <p className="eyebrow">FICHADOR</p>
          <h2>Este fichador ya no está disponible</h2>
          <p className="muted">{MESSAGE}</p>
          <div className="form-stack">
            <Button to="/" variant="subtle">Ir a Gestión Personal</Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <>
      <PageHeader eyebrow="CONTROL HORARIO" title="Fichador" description="El fichador funciona como una app independiente en cada equipo autorizado." />
      <Section
        title="Este fichador ya no está disponible"
        subtitle={MESSAGE}
        action={canManageDevices ? <Button to="/configuracion/dispositivos-fichada" variant="primary" icon={MonitorSmartphone}>Dispositivos de fichada</Button> : undefined}
      >
        <p className="muted">
          {canManageDevices
            ? "Para habilitar un equipo nuevo, abrí la app Fichador en el equipo, tocá “Configurar dispositivo” y aprobá el código desde Dispositivos de fichada."
            : "Si un equipo de fichada no funciona, avisá a RRHH."}
        </p>
      </Section>
    </>
  );
}
