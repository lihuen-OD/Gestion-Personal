import { Eye, Power, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { OverflowCell } from "../ui/OverflowCell";
import { TableShell } from "../ui/TableShell";
import type { Position } from "../../types/position.types";

function badge(status: Position["status"]) {
  return status === "ACTIVO" ? "badge success" : "badge danger";
}

function SalaryRangeCell({ categories }: { categories?: string[] }) {
  if (!categories?.length) return <span className="position-muted">Sin rango</span>;
  const visible = categories.slice(0, 4);
  const remaining = categories.length - visible.length;
  return <div className="salary-chip-list" title={categories.join(", ")}>
    {visible.map((category) => <span key={category}>{category}</span>)}
    {remaining > 0 && <span>+{remaining}</span>}
  </div>;
}

export function PuestoTable({ positions, assignedCount, canEdit, onRemove, onToggleStatus }: { positions: Position[]; assignedCount: (id: string) => number; canEdit: boolean; onRemove: (position: Position) => void; onToggleStatus: (position: Position) => void }) {
  if (!positions.length) return <div className="empty"><span>No hay puestos para los filtros seleccionados.</span></div>;
  return <TableShell className="position-table-wrap" minWidth={1120}><table className="position-table"><thead><tr><th>Nombre del puesto</th><th>Unidad de negocio</th><th>Establecimiento</th><th>Area / Departamento</th><th>Sector</th><th>Rango salarial</th><th>Personas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
    {positions.map((position) => <tr key={position.id}>
      <td className="position-name-cell"><b>{position.name}</b><small className="table-sub">{position.code || "Sin codigo"}</small></td>
      <td className="position-text-cell">{position.businessUnitName ? <OverflowCell value={position.businessUnitName} /> : <span className="position-muted">Sin definir</span>}</td>
      <td className="position-text-cell">{position.establishmentName ? <OverflowCell value={position.establishmentName} /> : <span className="position-muted">Sin definir</span>}</td>
      <td className="position-text-cell">{position.areaDepartment ? <OverflowCell value={position.areaDepartment} /> : <span className="position-muted">Sin definir</span>}</td>
      <td className="position-text-cell">{position.sector ? <OverflowCell value={position.sector} /> : <span className="position-muted">Sin definir</span>}</td>
      <td className="position-range-cell"><SalaryRangeCell categories={position.salaryRangeCategories} /></td>
      <td><span className="position-count">{assignedCount(position.id)}</span></td>
      <td><span className={badge(position.status)}>{position.status}</span></td>
      <td><div className="table-actions">
        <Link className="table-link table-icon-action" title="Ver detalle" aria-label="Ver detalle" to={`/puestos/${position.id}`}><Eye size={14} /><span>Ver detalle</span></Link>
        {canEdit && <button className="table-link table-icon-action" title={position.status === "ACTIVO" ? "Inactivar" : "Activar"} aria-label={position.status === "ACTIVO" ? "Inactivar" : "Activar"} onClick={() => onToggleStatus(position)}><Power size={14} /><span>{position.status === "ACTIVO" ? "Inactivar" : "Activar"}</span></button>}
        {canEdit && <button className="table-link table-icon-action danger-link" title="Eliminar" aria-label="Eliminar" onClick={() => onRemove(position)}><Trash2 size={14} /><span>Eliminar</span></button>}
      </div></td>
    </tr>)}
  </tbody></table></TableShell>;
}
