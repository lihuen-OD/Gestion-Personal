import { useEffect, useState } from "react";
import { Activity, Building2, Clock3, Users } from "lucide-react";
import { Alert, DashboardBars } from "./DashboardPage";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const apiMetrics = await dashboardMetricsApiService.getMetrics();
        if (!cancelled) setMetrics(apiMetrics);
      } catch {
        // error handled: initial empty state is already set
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return <><PageHeader eyebrow="INDICADORES DE GESTIÓN" title="Reportes de gestión" description="Panel visual calculado desde legajos, novedades, transporte, documentación y carga horaria." /><div className="stat-grid"><StatCard label="Ausentismo mensual" value={`${metrics.absenceRate}%`} detail={`${metrics.absenceDays} días registrados`} icon={Activity} tone="orange" /><StatCard label="Rotación anual" value={`${metrics.turnoverRate}%`} detail={`${metrics.exits} egresos en 2026`} icon={Users} /><StatCard label="Cargas pendientes" value={metrics.pendingLoads} detail={`${metrics.reviewLoads} personas en revisión`} icon={Clock3} tone="red" /><StatCard label="Personas transportadas" value={metrics.transported} detail="Según legajos activos" icon={Building2} tone="green" /></div><div className="dashboard-grid"><Section title="Dotación por sector" subtitle="Distribución calculada desde legajos activos"><DashboardBars rows={metrics.headcountBySector} /></Section><Section title="Documentación crítica" subtitle="Alertas documentales vinculadas a legajos"><div className="alerts"><Alert label="Documentos vencidos" value={`${metrics.expiredDocuments} registros`} tone="red" /><Alert label="Documentos por vencer" value={`${metrics.expiringDocuments} registros`} tone="orange" /><Alert label="Novedades pendientes" value={`${metrics.pendingNovelties} registros`} tone="purple" /></div></Section></div><Section title="Transporte por localidad" subtitle="Personas con transporte de empresa en legajo"><DashboardBars rows={metrics.transportByCity} /></Section></>;
}
