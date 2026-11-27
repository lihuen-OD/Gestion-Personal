import { Trash2 } from "lucide-react";
import { useState } from "react";
import { noveltyApiService } from "../../services/api/noveltyApiService";
import type { Employee, Novelty, User } from "../../types";
import { displayLegajo, fullName } from "../../utils/employee";
import { statusTone } from "../../utils/status";
import { formatCalendarDate } from "../../utils/date";
import { Badge } from "../ui/Badge";
import { OverflowCell } from "../ui/OverflowCell";
import { TableShell } from "../ui/TableShell";
import { SortableHeader } from "../ui/SortableHeader";
import type { NoveltyListSortKey } from "../../services/api/noveltyApiService";
import type { SortState } from "../../utils/sort";
import { EmptyState } from "../ui/EmptyState";
import { confirmAction } from "../../services/appDialog";
import { noveltyTimeEntryBehaviorLabel } from "../novelty-types/NoveltyTypeFields";
import { getUserErrorMessage } from "../../services/api/apiClient";

export function NoveltyTable({
  rows,
  employees,
  currentUser,
  onChanged,
  onDeleted,
  emptyText = "Todavía no hay novedades registradas.",
  sort,
  onSort,
}: {
  rows: Novelty[];
  employees: Employee[];
  currentUser: User;
  onChanged: (updated: Novelty) => void;
  onDeleted?: (id: string) => void;
  emptyText?: string;
  // Orden server-side (NoveltiesPage, paginada): sin `onSort` los headers son
  // estáticos — nunca se ordena localmente una página parcial.
  sort?: SortState<NoveltyListSortKey>;
  onSort?: (key: NoveltyListSortKey) => void;
}) {
  const header = (label: string, key: NoveltyListSortKey) => (onSort ? <SortableHeader label={label} sortKey={key} sort={sort ?? null} onSort={onSort} /> : <th>{label}</th>);
  const [actionError, setActionError] = useState("");

  const remove = async (novelty: Novelty) => {
    const confirmed = await confirmAction(
      `¿Querés eliminar la novedad “${novelty.type}” de ${novelty.employeeName || novelty.employeeLegajo || "este legajo"}? Esta acción quedará registrada en auditoría.`,
      { title: "Eliminar novedad", confirmLabel: "Eliminar", tone: "danger" },
    );
    if (!confirmed) return;
    try {
      await noveltyApiService.remove(novelty.id);
      setActionError("");
      onDeleted?.(novelty.id);
    } catch (error) {
      setActionError(getUserErrorMessage(error, "No pudimos eliminar la novedad. Intentá nuevamente."));
    }
  };

  if (!rows.length) {
    return <EmptyState text={emptyText} />;
  }

  return (
    <>
      <TableShell minWidth={1220}>
        <table>
        <thead>
          <tr>
            {header("Legajo", "legajo")}
            {header("Empleado", "employee")}
            {header("Novedad", "noveltyType")}
            {header("Vigencia", "fromDate")}
            <th>Cantidad</th>
            <th>Impacto horas</th>
            <th>Finnegans</th>
            <th>Documentación</th>
            {header("Estado", "status")}
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((novelty) => {
            const employee = employees.find((item) => item.id === novelty.employeeId);
            const employeeLegajo = employee ? displayLegajo(employee) : novelty.employeeLegajo || "-";
            const employeeName = employee ? fullName(employee) : novelty.employeeName || "-";
            const code = novelty.finnegansCode || "-";
            return (
              <tr key={novelty.id}>
                <td>{employeeLegajo}</td>
                <td>
                  <OverflowCell value={employeeName} />
                </td>
                <td>
                  <b>{novelty.type}</b>
                </td>
                <td>
                  {formatCalendarDate(novelty.from)}
                  {novelty.to && novelty.to !== novelty.from ? (
                    <span className="table-sub">Hasta {formatCalendarDate(novelty.to)}</span>
                  ) : null}
                </td>
                <td>{novelty.quantity}</td>
                <td>
                  <OverflowCell
                    value={`${noveltyTimeEntryBehaviorLabel(novelty.timeEntryBehavior)}${
                      novelty.targetHourConceptName
                        ? `\nAplica sobre ${novelty.targetHourConceptName}`
                        : ""
                    }`}
                  />
                </td>
                <td>
                  {novelty.exportsToFinnegans && novelty.status !== "Rechazado" ? (
                    <>
                      <b>{code}</b>
                      <span className="table-sub">Exporta</span>
                    </>
                  ) : (
                    "No exporta"
                  )}
                </td>
                <td>
                  <OverflowCell value={novelty.documentationFileName || "-"} />
                </td>
                <td>
                  <Badge tone={statusTone(novelty.status)}>{novelty.status}</Badge>
                </td>
                <td>
                  <button className="table-icon-action danger-link" title="Eliminar" aria-label="Eliminar novedad" onClick={() => void remove(novelty)}>
                    <Trash2 size={14} /><span>Eliminar</span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </TableShell>
      {actionError ? <p className="error">{actionError}</p> : null}
    </>
  );
}
