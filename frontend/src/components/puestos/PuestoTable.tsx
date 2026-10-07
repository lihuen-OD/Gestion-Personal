import { Eye, Power, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { OverflowCell } from "../ui/OverflowCell";
import { TableShell } from "../ui/TableShell";
import { SortableHeader } from "../ui/SortableHeader";
import type { PositionListSortKey } from "../../services/api/positionApiService";
import type { SortState } from "../../utils/sort";
import { CompactBadgeList } from "../ui/CompactBadgeList";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import type { Position } from "../../types/position.types";
import { activoInactivoLabel } from "../../utils/status";

/**
 * Ubicacion mostrada en la fila: siempre los derivados via sectorId
 * (limpieza final de Position, 2026-08-18) — no hay fallback a strings
 * legado, esas columnas ya no existen.
 */
const scopeLevelLabel = { COMPANY: "Empresa", BUSINESS_UNIT: "UN", SECTOR: "Sector", AREA: "Área" } as const;

function SalaryRangeCell({ categories }: { categories?: string[] }) {
  if (!categories?.length) return <span className="position-muted">Sin rango</span>;
  return <CompactBadgeList items={categories} />;
}

// Orden server-side (PuestosPage pagina): Nombre y Estado. Las columnas de
// ubicación son derivadas de una relación opcional (sector) y no se ordenan.
export function PuestoTable({ positions, assignedCount, canEdit, onRemove, onToggleStatus, sort, onSort }: { positions: Position[]; assignedCount: (id: string) => number; canEdit: boolean; onRemove: (position: Position) => void; onToggleStatus: (position: Position) => void; sort: SortState<PositionListSortKey>; onSort: (key: PositionListSortKey) => void }) {
  if (!positions.length) return <EmptyState text="No hay puestos para los filtros seleccionados." />;
  return <TableShell className="position-table-wrap" minWidth={980}><table className="position-table"><thead><tr><SortableHeader label="Nombre del puesto" sortKey="name" sort={sort} onSort={onSort} /><th>Alcance organizacional</th><th>Rango salarial</th><th>Personas</th><SortableHeader label="Estado" sortKey="status" sort={sort} onSort={onSort} /><th>Acciones</th></tr></thead><tbody>
    {positions.map((position) => <tr key={position.id}>
      <td className="position-name-cell"><b>{position.name}</b><small className="table-sub">{position.code || "Sin codigo"}</small></td>
      <td className="position-text-cell">{position.orgScopes?.length ? <div className="position-table-scopes">{position.orgScopes.map((scope) => <span key={`${scope.level}:${scope.nodeId}`}><small>{scopeLevelLabel[scope.level]}</small><OverflowCell value={scope.name} /></span>)}</div> : <Badge tone="warning">Pendiente de recarga</Badge>}</td>
      <td className="position-range-cell"><SalaryRangeCell categories={position.salaryCategoryNames} /></td>
      <td><span className="position-count">{assignedCount(position.id)}</span></td>
      <td><Badge tone={position.status === "ACTIVO" ? "success" : "neutral"}>{activoInactivoLabel(position.status)}</Badge></td>
      <td><div className="table-actions">
        <Link className="table-icon-action" title="Ver detalle" aria-label="Ver detalle" to={`/puestos/${position.id}`}><Eye size={14} /><span>Ver detalle</span></Link>
        {canEdit && <button className="table-icon-action" title={position.status === "ACTIVO" ? "Inactivar" : "Activar"} aria-label={position.status === "ACTIVO" ? "Inactivar" : "Activar"} onClick={() => onToggleStatus(position)}><Power size={14} /><span>{position.status === "ACTIVO" ? "Inactivar" : "Activar"}</span></button>}
        {canEdit && <button className="table-icon-action danger-link" title="Eliminar" aria-label="Eliminar" onClick={() => onRemove(position)}><Trash2 size={14} /><span>Eliminar</span></button>}
      </div></td>
    </tr>)}
  </tbody></table></TableShell>;
}
