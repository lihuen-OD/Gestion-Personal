import { Eye, Power } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { TableShell } from "../ui/TableShell";
import { SortableHeader } from "../ui/SortableHeader";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import type { ShiftTemplate } from "../../services/api/workforceApiService";
import { useSort, type SortAccessors } from "../../utils/sort";

export type ShiftAssignmentCounts = { enabled: number; disabled: number };
type ShiftSortKey = "code" | "name" | "category" | "startTime" | "enabled" | "disabled" | "status";

const emptyCount: ShiftAssignmentCounts = { enabled: 0, disabled: 0 };

export function ShiftTable({
  items,
  counts,
  canEdit,
  onToggleStatus,
  layout = "default",
}: {
  items: ShiftTemplate[];
  counts: Record<string, ShiftAssignmentCounts>;
  canEdit: boolean;
  onToggleStatus: (item: ShiftTemplate) => void;
  /**
   * "grouped" (R3.2): una tabla por grupo en Turnos. Columnas de ancho fijo
   * proporcional (todas las secciones quedan alineadas) y un mínimo menor,
   * para que en 1366/1440 entre completa sin scroll horizontal por grupo.
   */
  layout?: "default" | "grouped";
}) {
  // Depende de `counts`: las columnas de empleados ordenan por el conteo numérico real.
  const sortAccessors = useMemo<SortAccessors<ShiftTemplate, ShiftSortKey>>(() => ({
    code: (item) => item.code,
    name: (item) => item.name,
    category: (item) => item.categoryName,
    startTime: (item) => item.startTime,
    enabled: (item) => (counts[item.id] || emptyCount).enabled,
    disabled: (item) => (counts[item.id] || emptyCount).disabled,
    status: (item) => item.status === "ACTIVO" ? "Activo" : "Inactivo",
  }), [counts]);
  const { sorted, sort, toggleSort } = useSort(items, sortAccessors);
  if (!items.length) return <EmptyState text="Todavía no hay turnos configurados." />;

  return (
    <TableShell minWidth={layout === "grouped" ? 960 : 1180}>
      <table className={layout === "grouped" ? "shift-table-grouped" : undefined}>
        {layout === "grouped" ? (
          <colgroup>
            <col className="col-code" /><col className="col-name" /><col className="col-category" /><col className="col-schedule" /><col className="col-midnight" />
            <col className="col-enabled" /><col className="col-disabled" /><col className="col-status" /><col className="col-actions" />
          </colgroup>
        ) : null}
        <thead>
          <tr>
            <SortableHeader label="Código" sortKey="code" sort={sort} onSort={toggleSort} />
            <SortableHeader label="Turno" sortKey="name" sort={sort} onSort={toggleSort} />
            <SortableHeader label="Categoría" sortKey="category" sort={sort} onSort={toggleSort} />
            <SortableHeader label="Horario" sortKey="startTime" sort={sort} onSort={toggleSort} />
            <th>Cruza medianoche</th>
            <SortableHeader label="Empleados habilitados" sortKey="enabled" sort={sort} onSort={toggleSort} />
            <SortableHeader label="Empleados deshabilitados" sortKey="disabled" sort={sort} onSort={toggleSort} />
            <SortableHeader label="Estado" sortKey="status" sort={sort} onSort={toggleSort} />
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => {
            const count = counts[item.id] || emptyCount;
            return (
              <tr key={item.id}>
                <td className="cell-nowrap"><b>{item.code}</b></td>
                <td>{item.name}</td>
                <td className="shift-category-cell">{item.categoryName || <em>Sin categoría</em>}</td>
                <td className="cell-nowrap">{item.startTime}–{item.endTime}</td>
                <td>{item.crossesMidnight ? "Sí" : "No"}</td>
                <td>{count.enabled}</td>
                <td>{count.disabled}</td>
                <td><Badge tone={item.status === "ACTIVO" ? "success" : "neutral"}>{item.status === "ACTIVO" ? "Activo" : "Inactivo"}</Badge></td>
                <td>
                  <div className="table-actions">
                    <Link className="table-icon-action" title="Ver detalle" aria-label={`Ver detalle de ${item.name}`} to={`/configuracion/turnos/${item.id}`}>
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
