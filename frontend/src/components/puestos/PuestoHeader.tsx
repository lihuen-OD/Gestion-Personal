import { ArrowLeft, Power, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "../ui/Badge";
import type { Position } from "../../types/position.types";

export function PuestoHeader({ position, assignedCount, canEdit, onRemove, onToggleStatus }: { position: Position; assignedCount: number; canEdit: boolean; onRemove: () => void; onToggleStatus: () => void }) {
  return <div className="detail-hero puesto-hero">
    <Link to="/puestos" className="back-link"><ArrowLeft size={14} /> Volver a puestos</Link>
    <div><div className="avatar">{position.name.slice(0, 2).toUpperCase()}</div><div><p className="eyebrow">PUESTO {position.code || "SIN CODIGO"}</p><h1>{position.name}</h1><p>{position.derivedAreaName || "Sin area"} · {position.derivedSectorName || "Sin sector"} · Actualizado {position.lastUpdatedAt}</p></div></div>
    <div className="hero-actions"><Badge tone={position.status === "ACTIVO" ? "success" : "danger"}>{position.status}</Badge><Badge tone="neutral">{assignedCount} personas</Badge>{canEdit && <button className="table-icon-action" title={position.status === "ACTIVO" ? "Inactivar" : "Activar"} aria-label={position.status === "ACTIVO" ? "Inactivar" : "Activar"} onClick={onToggleStatus}><Power size={14} /><span>{position.status === "ACTIVO" ? "Inactivar" : "Activar"}</span></button>}{canEdit && <button className="table-icon-action danger-link" title="Eliminar" aria-label="Eliminar" onClick={onRemove}><Trash2 size={14} /><span>Eliminar</span></button>}</div>
  </div>;
}
