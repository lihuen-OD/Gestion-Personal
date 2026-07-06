import { useEffect, useState } from "react";
import { Activity, Building2, Clock3, Users } from "lucide-react";
import { Alert, DashboardBars } from "./DashboardPage";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { dashboardMetricsApiService, type DashboardMetrics } from "../services/api/dashboardMetricsApiService";

export function ReportsPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    total: 0,
    active: 0,
    inactive: 0,
    absenceDays: 0,
    absenceRate: "0",
    turnoverRate: "0",
    exits: 0,
    upcomingBirthdays: [],
    averageAge: "0",
    averageTenure: "0",
    transported: 0,
    transportByCity: [],
    transportRoutes: [],
    loadedHours: 0,
    loadCoverage: 0,
    pendingLoads: 0,
    reviewLoads: 0,
    expiredDocuments: 0,
    expiringDocuments: 0,
    missingResponsible: 0,
    pendingNovelties: 0,
    headcountByCompany: [],
    headcountBySector: [],
  });
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus("loading");
      try {
        const apiMetrics = await dashboardMetricsApiService.getMetrics();
        if (cancelled) return;
        setMetrics(apiMetrics);
        setStatus("success");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [retry]);

  if (status === "error") {
    return <><PageHeader eyebrow="INDICADORES DE GESTIÓN" title="Reportes de gestión" description="No se pudieron cargar los indicadores." />
      <Section title="Indicadores"><ErrorState onRetry={() => setRetry((value) => value + 1)} /></Section>
    </>;
  }

  if (status === "loading") {
    return <><PageHeader eyebrow="INDICADORES DE GESTIÓN" title="Reportes de gestión" description="Cargando indicadores..." />
      <div className="stat-grid"><LoadingState variant="table" rows={2} columns={4} /></div>
    </>;
  }

  return <><PageHeader eyebrow="INDICADORES DE GESTIÓN" title="Reportes de gestión" description="Panel visual calculado desde legajos, novedades, transporte, documentación y carga horaria." /><div className="stat-grid"><StatCard label="Ausentismo mensual" value={`${metrics.absenceRate}%`} detail={`${metrics.absenceDays} días registrados`} icon={Activity} tone="orange" /><StatCard label="Rotación anual" value={`${metrics.turnoverRate}%`} detail={`${metrics.exits} egresos en 2026`} icon={Users} /><StatCard label="Cargas pendientes" value={metrics.pendingLoads} detail={`${metrics.reviewLoads} personas en revisión`} icon={Clock3} tone="red" /><StatCard label="Personas transportadas" value={metrics.transported} detail="Según legajos activos" icon={Building2} tone="green" /></div><div className="dashboard-grid"><Section title="Dotación por sector" subtitle="Distribución calculada desde legajos activos"><DashboardBars rows={metrics.headcountBySector} /></Section><Section title="Documentación crítica" subtitle="Alertas documentales vinculadas a legajos"><div className="alerts"><Alert label="Documentos vencidos" value={`${metrics.expiredDocuments} registros`} tone="red" /><Alert label="Documentos por vencer" value={`${metrics.expiringDocuments} registros`} tone="orange" /><Alert label="Novedades pendientes" value={`${metrics.pendingNovelties} registros`} tone="purple" /></div></Section></div><Section title="Transporte por localidad" subtitle="Personas con transporte de empresa en legajo"><DashboardBars rows={metrics.transportByCity} /></Section></>;
}
