import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ClipboardList, Clock3, RefreshCcw, Send, TimerReset } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { timeEntryApiService, type HomeSummary } from "../services/api/timeEntryApiService";
import { PageHeader } from "../components/ui/PageHeader";
import { StatCard } from "../components/ui/StatCard";
import { Section } from "../components/ui/Section";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";

function StatLink({ to, label, value, detail, icon, tone }: { to: string; label: string; value: number; detail: string; icon: LucideIcon; tone?: string }) {
  return (
    <Link to={to} className="stat-card-link">
      <StatCard label={label} value={value} detail={detail} icon={icon} tone={tone} />
    </Link>
  );
}

export function HourlyManagementHomePage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<HomeSummary>();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const firstName = user!.name.split(" ")[0];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus("loading");
      try {
        const result = await timeEntryApiService.getHomeSummary();
        if (cancelled) return;
        setSummary(result);
        setStatus("success");
      } catch {
        if (cancelled) return;
        setStatus("error");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [retry]);

  if (status === "loading") {
    return (
      <>
        <PageHeader eyebrow="CONTROL HORARIO" title={`Hola, ${firstName}`} description="Cargando tu resumen de gestión horaria..." />
        <div className="stat-grid"><LoadingState variant="table" rows={1} columns={3} /></div>
      </>
    );
  }

  if (status === "error" || !summary) {
    return (
      <>
        <PageHeader eyebrow="CONTROL HORARIO" title={`Hola, ${firstName}`} description="No se pudo cargar tu resumen de gestión horaria." />
        <Section title="Resumen"><ErrorState onRetry={() => setRetry((value) => value + 1)} /></Section>
      </>
    );
  }

  if (summary.role === "carga") {
    return (
      <>
        <PageHeader eyebrow="CONTROL HORARIO" title={`Hola, ${firstName}`} description="Esto es lo que tenés para hacer hoy en Gestión horaria." />
        <div className="stat-grid">
          <StatLink to="/horas" label="Para cargar" value={summary.paraCargar} detail="Personas sin horas cargadas este período" icon={Clock3} />
          <StatLink to="/horas" label="Devueltos para corregir" value={summary.devueltosParaCorregir} detail="Un supervisor pidió una corrección antes de reenviarlos" icon={RefreshCcw} tone="orange" />
          <StatLink to="/horas" label="Enviado, esperando revisión" value={summary.enviadoEsperandoRevision} detail="Ya lo enviaste, no hace falta que hagas nada más" icon={Send} tone="green" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="CONTROL HORARIO" title={`Hola, ${firstName}`} description="Esto es lo que tenés para revisar hoy." />
      <div className="stat-grid">
        <StatLink to="/pendientes" label="Para revisar hoy" value={summary.paraRevisarHoy} detail="Horas enviadas, esperando tu aprobación" icon={ClipboardList} tone="orange" />
        <StatLink to="/novedades" label="Novedades pendientes" value={summary.novedadesPendientes} detail="Licencias y otras novedades sin resolver" icon={CalendarDays} />
        <StatLink to="/asistencia" label="Fichadas observadas" value={summary.fichadasObservadas} detail="Marcaciones de hoy que necesitan revisión" icon={TimerReset} tone="red" />
      </div>
    </>
  );
}
