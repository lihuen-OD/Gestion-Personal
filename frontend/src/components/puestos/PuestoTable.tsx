import { ChevronRight, Power, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { Position } from "../../types/position.types";

function badge(status: Position["status"]) {
  return status === "ACTIVO" ? "badge success" : "badge danger";
}

export function PuestoTable({ positions, assignedCount, canEdit, onRemove, onToggleStatus }: { positions: Position[]; assignedCount: (id: string) => number; canEdit: boolean; onRemove: (position: Position) => void; onToggleStatus: (position: Position) => void }) {
  if (!positions.length) return <div className="empty"><span>No hay puestos para los filtros seleccionados.</span></div>;
  return <table><thead><tr><th>Nombre del puesto</th><th>Area / Departamento</th><th>Sector</th><th>Categoria interna sugerida</th><th>Categoria recibo sugerida</th><th>Reporta a</th><th>Supervisa a</th><th>Personas</th><th>Estado</th><th>Accion</th></tr></thead><tbody>
    {positions.map((position) => <tr key={position.id}>
      <td><b>{position.name}</b><small className="table-sub">{position.code || "Sin codigo"}</small></td>
      <td>{position.areaDepartment}</td>
      <td>{position.sector}</td>
      <td>{position.suggestedInternalCategoryName || "-"}</td>
      <td>{position.suggestedReceiptCategoryName || "-"}</td>
      <td>{position.reportsTo || "-"}</td>
      <td>{position.supervises || "-"}</td>
      <td>{assignedCount(position.id)}</td>
      <td><span className={badge(position.status)}>{position.status}</span></td>
      <td><div className="table-actions">
        <Link className="table-link" to={`/puestos/${position.id}`}>Ver detalle <ChevronRight size={15} /></Link>
        {canEdit && <button className="table-link" onClick={() => onToggleStatus(position)}><Power size={14} /> {position.status === "ACTIVO" ? "Inactivar" : "Activar"}</button>}
        {canEdit && <button className="table-link danger-link" onClick={() => onRemove(position)}><Trash2 size={14} /> Eliminar</button>}
      </div></td>
    </tr>)}
  </tbody></table>;
}
