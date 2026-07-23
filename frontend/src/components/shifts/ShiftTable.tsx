import { Eye, Power } from "lucide-react";
import { Link } from "react-router-dom";
import { TableShell } from "../ui/TableShell";
import type { ShiftTemplate } from "../../services/api/workforceApiService";

export type ShiftAssignmentCounts = { enabled: number; disabled: number };

export function ShiftTable({
  items,
  counts,
  canEdit,
  onToggleStatus,
}: {
  items: ShiftTemplate[];
  counts: Record<string, ShiftAssignmentCounts>;
  canEdit: boolean;
  onToggleStatus: (item: ShiftTemplate) => void;
}) {
  if (!items.length) return <div className="empty">Todavía no hay turnos configurados.</div>;

  return (
    <TableShell minWidth={1180}>
      <table>
        <thead>
          <tr>
            <th>Código</th>
            <th>Turno</th>
            <th>Categoría</th>
            <th>Horario</th>
            <th>Cruza medianoche</th>
            <th>Empleados habilitados</th>
            <th>Empleados deshabilitados</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const count = counts[item.id] || { enabled: 0, disabled: 0 };
            return (
              <tr key={item.id}>
                <td><b>{item.code}</b></td>
                <td>{item.name}</td>
                <td>{item.categoryName || <em>Sin categoría</em>}</td>
                <td>{item.startTime}–{item.endTime}</td>
                <td>{item.crossesMidnight ? "Sí" : "No"}</td>
                <td>{count.enabled}</td>
                <td>{count.disabled}</td>
                <td><span className={`badge ${item.status === "ACTIVO" ? "success" : "neutral"}`}>{item.status === "ACTIVO" ? "Activo" : "Inactivo"}</span></td>
                <td>
                  <div className="table-actions">
                    <Link className="table-link table-icon-action" title="Ver detalle" aria-label={`Ver detalle de ${item.name}`} to={`/configuracion/turnos/${item.id}`}>
                      <Eye size={14} /><span>Ver detalle</span>
                    </Link>
                    {canEdit ? (
                      <button
                        type="button"
                        className="table-icon-action"
                        title={item.status === "ACTIVO" ? "Inactivar turno" : "Activar turno"}
                        aria-label={`${item.status === "ACTIVO" ? "Inactivar" : "Activar"} ${item.name}`}
                        onClick={() => onToggleStatus(item)}
                      >
                        <Power size={14} /><span>{item.status === "ACTIVO" ? "Inactivar" : "Activar"}</span>
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableShell>
  );
}
