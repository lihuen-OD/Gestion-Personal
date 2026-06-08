import { AlertTriangle, Archive, CheckCircle2, Link2, Users } from "lucide-react";
import type { PositionSummary } from "../../types/position.types";

function Card({ label, value, detail, tone = "blue", icon: Icon }: { label: string; value: number; detail: string; tone?: string; icon: typeof Users }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={20} /></div><div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div></div>;
}

export function PuestoSummaryCards({ summary }: { summary: PositionSummary }) {
  return <div className="stat-grid puestos-summary">
    <Card label="Total de puestos" value={summary.total} detail="Descripciones creadas" icon={Archive} />
    <Card label="Puestos activos" value={summary.active} detail="Disponibles para vincular" tone="green" icon={CheckCircle2} />
    <Card label="Puestos inactivos" value={summary.inactive} detail="Conservan historial" tone="red" icon={Archive} />
    <Card label="Sin personas asignadas" value={summary.withoutPeople} detail="Calculado desde legajos" tone="orange" icon={AlertTriangle} />
    <Card label="Actualizacion pendiente" value={summary.pendingUpdate} detail="Mas de 12 meses" tone="purple" icon={AlertTriangle} />
    <Card label="Vinculados a legajos" value={summary.linkedToEmployees} detail="Con personas activas" tone="green" icon={Link2} />
  </div>;
}
