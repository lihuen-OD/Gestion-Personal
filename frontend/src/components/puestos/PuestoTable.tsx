import { Eye, Power, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { OverflowCell } from "../ui/OverflowCell";
import { TableShell } from "../ui/TableShell";
import { CompactBadgeList } from "../ui/CompactBadgeList";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import type { Position } from "../../types/position.types";

/**
 * Ubicacion mostrada en la fila: siempre los derivados via sectorId
 * (limpieza final de Position, 2026-08-18) — no hay fallback a strings
 * legado, esas columnas ya no existen.
 */
export function positionLocationCells(position: Position) {
  return {
    businessUnit: position.derivedBusinessUnitName || null,
    establishment: position.derivedEstablishmentName || null,
    area: position.derivedAreaName || null,
    sector: position.derivedSectorName || null,
  };
}

function SalaryRangeCell({ categories }: { categories?: string[] }) {
  if (!categories?.length) return <span className="position-muted">Sin rango</span>;
  return <CompactBadgeList items={categories} />;
}

export function PuestoTable({ positions, assignedCount, canEdit, onRemove, onToggleStatus }: { positions: Position[]; assignedCount: (id: string) => number; canEdit: boolean; onRemove: (position: Position) => void; onToggleStatus: (position: Position) => void }) {
  if (!positions.length) return <EmptyState text="No hay puestos para los filtros seleccionados." />;
  return <TableShell className="position-table-wrap" minWidth={1120}><table className="position-table"><thead><tr><th>Nombre del puesto</th><th>Unidad de negocio</th><th>Establecimiento</th><th>Area / Departamento</th><th>Sector</th><th>Rango salarial</th><th>Personas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
    {positions.map((position) => { const location = positionLocationCells(position); return <tr key={position.id}>
      <td className="position-name-cell"><b>{position.name}</b><small className="table-sub">{position.code || "Sin codigo"}</small></td>
      <td className="position-text-cell">{location.businessUnit ? <OverflowCell value={location.businessUnit} /> : <span className="position-muted">Sin definir</span>}</td>
      <td className="position-text-cell">{location.establishment ? <OverflowCell value={location.establishment} /> : <span className="position-muted">Sin definir</span>}</td>
      <td className="position-text-cell">{location.area ? <OverflowCell value={location.area} /> : <span className="position-muted">Sin definir</span>}</td>
      <td className="position-text-cell">{location.sector ? <OverflowCell value={location.sector} /> : <span className="position-muted">Sin definir</span>}</td>
      <td className="position-range-cell"><SalaryRangeCell categories={position.salaryCategoryNames} /></td>
      <td><span className="position-count">{assignedCount(position.id)}</span></td>
      <td><Badge tone={position.status === "ACTIVO" ? "success" : "neutral"}>{position.status}</Badge></td>
      <td><div className="table-actions">
        <Link className="table-icon-action" title="Ver detalle" aria-label="Ver detalle" to={`/puestos/${position.id}`}><Eye size={14} /><span>Ver detalle</span></Link>
        {canEdit && <button className="table-icon-action" title={position.status === "ACTIVO" ? "Inactivar" : "Activar"} aria-label={position.status === "ACTIVO" ? "Inactivar" : "Activar"} onClick={() => onToggleStatus(position)}><Power size={14} /><span>{position.status === "ACTIVO" ? "Inactivar" : "Activar"}</span></button>}
        {canEdit && <button className="table-icon-action danger-link" title="Eliminar" aria-label="Eliminar" onClick={() => onRemove(position)}><Trash2 size={14} /><span>Eliminar</span></button>}
      </div></td>
    </tr>; })}
  </tbody></table></TableShell>;
}
