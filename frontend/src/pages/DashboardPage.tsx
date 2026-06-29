import { useEffect, useMemo, useState } from "react";
import { Activity, BriefcaseBusiness, Bus, Cake, Clock3, FileBarChart, FolderOpen, UserRoundMinus, Users } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { dashboardMetricsApiService, type DashboardMetrics } from "../services/api/dashboardMetricsApiService";
import { auditMockService } from "../services/auditMockService";
import { dashboardMetricsMockService } from "../services/dashboardMetricsMockService";
import type { AuditEntry, Employee } from "../types";
import { OverflowCell } from "../components/ui/OverflowCell";
import { TableShell } from "../components/ui/TableShell";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
import { formatPeriodLabel } from "../utils/period";
import { roleLevel } from "../utils/roles";

export function DashboardBars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return <div className="bars">{rows.map((row) => <div className="bar-row" key={row.label}><span>{row.label}</span><div><i style={{ width: `${Math.round(row.value / max * 100)}%` }} /></div><b>{row.value}</b></div>)}</div>;
}

export function Alert({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="alert-row"><span className={`alert-dot ${tone}`} /><b>{label}</b><span>{value}</span></div>;
}

export function DashboardPage() {
  const { user } = useAuth();
  const level = roleLevel(user!.role);
  const fallbackScope = useMemo(
    () => (level === 2 ? (employee: Employee) => employee.sector === user!.sector : undefined),
    [level, user],
  );
  const [metrics, setMetrics] = useState<DashboardMetrics>(() => dashboardMetricsMockService.getMetrics(fallbackScope));
  const [audit, setAudit] = useState<AuditEntry[]>(() => auditMockService.getAll());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [apiMetrics, apiAudit] = await Promise.all([
          dashboardMetricsApiService.getMetrics(level === 2 ? (employee: Employee) => employee.sector === user!.sector : undefined),
          dashboardMetricsApiService.getAudit(5),
        ]);
        if (cancelled) return;
        setMetrics(apiMetrics);
        setAudit(apiAudit);
      } catch (error) {
        if (cancelled) return;
        setMetrics(dashboardMetricsMockService.getMetrics(fallbackScope));
        setAudit(auditMockService.getAll());
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [fallbackScope, level, user]);
  return <><PageHeader eyebrow={level === 2 ? "PANEL DE GESTIÓN" : "DASHBOARD RRHH"} title={`Buen día, ${user!.name.split(" ")[0]}`} description={level === 2 ? `Indicadores calculados para tu área: ${user!.sector}.` : "Indicadores integrales de personas, novedades y control horario calculados desde los datos demo."} action={<button className="button subtle"><FileBarChart size={17} /> Exportar resumen</button>} />
    <div className="stat-grid kpi-grid">
      <StatCard label={level === 2 ? "Dotación de mi área" : "Dotación activa"} value={metrics.active} detail={`${metrics.inactive} inactivos · ${metrics.total} legajos`} icon={Users} />
      <StatCard label="Ausentismo mensual" value={`${metrics.absenceRate}%`} detail={`${metrics.absenceDays} días registrados`} icon={Activity} tone="red" />
      <StatCard label="Rotación anual" value={`${metrics.turnoverRate}%`} detail={`${metrics.exits} egresos en 2026`} icon={UserRoundMinus} tone="orange" />
      <StatCard label="Edad promedio" value={`${metrics.averageAge} años`} detail="Sobre dotación activa" icon={Cake} tone="purple" />
      <StatCard label="Antigüedad promedio" value={`${metrics.averageTenure} años`} detail="Desde fecha de ingreso" icon={BriefcaseBusiness} tone="green" />
      <StatCard label="Transporte empresa" value={metrics.transported} detail="Personas que usan colectivo" icon={Bus} />
      <StatCard label="Horas cargadas" value={`${metrics.loadedHours} h`} detail={`${metrics.loadCoverage}% de dotación con carga`} icon={Clock3} tone="green" />
      <StatCard label="Documentación crítica" value={metrics.expiredDocuments + metrics.expiringDocuments} detail={`${metrics.expiredDocuments} vencidos · ${metrics.expiringDocuments} por vencer`} icon={FolderOpen} tone="orange" />
    </div>
    <div className="dashboard-grid">
      <Section title={level === 2 ? "Dotación por sector" : "Dotación activa por empresa"} subtitle="Distribución calculada sobre legajos activos"><DashboardBars rows={level === 2 ? metrics.headcountBySector : metrics.headcountByCompany} /></Section>
      <Section title="Alertas que requieren atención" subtitle="Generadas desde el estado actual del sistema"><div className="alerts"><Alert label="Documentación vencida" value={`${metrics.expiredDocuments} documentos`} tone="red" /><Alert label="Documentación por vencer" value={`${metrics.expiringDocuments} documentos`} tone="orange" /><Alert label="Sin responsable de carga" value={`${metrics.missingResponsible} legajos`} tone="blue" /><Alert label="Cargas horarias pendientes" value={`${metrics.pendingLoads} personas`} tone="orange" /><Alert label="Novedades pendientes" value={`${metrics.pendingNovelties} registros`} tone="purple" /></div></Section>
    </div>
    <div className="dashboard-grid">
      <Section title="Transporte por localidad" subtitle={`${metrics.transported} personas utilizan transporte de la empresa`}><DashboardBars rows={metrics.transportByCity} /></Section>
      <Section title="Próximos cumpleaños" subtitle="Cumpleaños durante los próximos 30 días"><TableShell minWidth={720}><table><thead><tr><th>Empleado</th><th>Fecha</th><th>Sector</th></tr></thead><tbody>{metrics.upcomingBirthdays.map((employee) => <tr key={employee.id}><td><b>{employee.lastName}, {employee.firstName}</b></td><td>{new Date(`${employee.birthDate}T12:00:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "long" })}</td><td><OverflowCell value={employee.sector} /></td></tr>)}</tbody></table></TableShell></Section>
    </div>
    <div className="dashboard-grid">
      <Section title="Control de carga horaria" subtitle={`Periodo ${metrics.period ? formatPeriodLabel(metrics.period) : "actual"}`}><div className="compact-metrics"><div><b>{metrics.loadCoverage}%</b><span>Cobertura</span></div><div><b>{metrics.pendingLoads}</b><span>Pendientes</span></div><div><b>{metrics.reviewLoads}</b><span>En revisión</span></div><div><b>{metrics.loadedHours} h</b><span>Cargadas</span></div></div></Section>
    </div>
    {level === 1 && <Section title="Actividad reciente" subtitle="Últimos movimientos registrados en la plataforma"><TableShell minWidth={860}><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead><tbody>{audit.slice(0, 5).map((item) => <tr key={item.id}><td>{item.date} · {item.time}</td><td>{item.user}</td><td>{item.action}</td><td><OverflowCell value={item.entity} /></td><td><OverflowCell value={item.next} /></td></tr>)}</tbody></table></TableShell></Section>}
  </>;
}
