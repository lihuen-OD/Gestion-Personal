import { CheckCircle2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { noveltyApiService } from "../../services/api/noveltyApiService";
import type { Employee, Novelty, User } from "../../types";
import { displayLegajo, fullName } from "../../utils/employee";
import { statusTone } from "../../utils/status";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { OverflowCell } from "../ui/OverflowCell";
import { TableShell } from "../ui/TableShell";
import { EmptyState } from "../ui/EmptyState";
import { confirmAction } from "../../services/appDialog";
import { noveltyTimeImpactLabel } from "../novelty-types/NoveltyTypeFields";
import { getUserErrorMessage } from "../../services/api/apiClient";

export function NoveltyTable({
  rows,
  employees,
  currentUser,
  onChanged,
  onDeleted,
}: {
  rows: Novelty[];
  employees: Employee[];
  currentUser: User;
  onChanged: (updated: Novelty) => void;
  onDeleted?: (id: string) => void;
}) {
  const [rejecting, setRejecting] = useState<Novelty | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState("");

  const approve = async (id: string) => {
    try {
      const updated = await noveltyApiService.approve(id);
      setActionError("");
      onChanged(updated);
    } catch (error) {
      setActionError("No pudimos aprobar la novedad. Intentá nuevamente.");
    }
  };

  const reject = async () => {
    if (!rejecting || !rejectReason.trim()) return;
    try {
      const updated = await noveltyApiService.reject(rejecting.id, rejectReason.trim());
      setActionError("");
      onChanged(updated);
    } catch (error) {
      setActionError("No pudimos rechazar la novedad. Intentá nuevamente.");
    }
    setRejecting(null);
    setRejectReason("");
  };

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
    return <EmptyState text="Todavía no hay novedades registradas." />;
  }

  return (
    <>
      <TableShell minWidth={1220}>
        <table>
        <thead>
          <tr>
            <th>Legajo</th>
            <th>Empleado</th>
            <th>Novedad</th>
            <th>Origen</th>
            <th>Vigencia</th>
            <th>Cantidad</th>
            <th>Impacto horas</th>
            <th>Finnegans</th>
            <th>Documentación</th>
            <th>Estado</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((novelty) => {
            const employee = employees.find((item) => item.id === novelty.employeeId);
            const employeeLegajo = employee ? displayLegajo(employee) : novelty.employeeLegajo || "-";
            const employeeName = employee ? fullName(employee) : novelty.employeeName || "-";
            const code = novelty.finnegansCode || "-";
            const canApprove =
              novelty.status === "Pendiente" &&
              noveltyApiService.canApprove(novelty, currentUser);

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
                  <Badge tone="neutral">{novelty.origin || "INTERNA"}</Badge>
                </td>
                <td>
                  {novelty.from}
                  {novelty.to && novelty.to !== novelty.from ? (
                    <span className="table-sub">Hasta {novelty.to}</span>
                  ) : null}
                </td>
                <td>{novelty.quantity}</td>
                <td>
                  <OverflowCell
                    value={`${noveltyTimeImpactLabel(novelty.timeImpact)}${
                      novelty.targetHourConceptName
                        ? `\nAplica sobre ${novelty.targetHourConceptName}`
                        : ""
                    }${novelty.blocksTimeEntry ? "\nBloquea carga · 0 hs" : ""}`}
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
                  {canApprove ? (
                    <div className="table-actions">
                      <button
                        className="table-icon-action"
                        title="Aprobar"
                        aria-label="Aprobar"
                        onClick={() => approve(novelty.id)}
                      >
                        <CheckCircle2 size={14} />
                        <span>Aprobar</span>
                      </button>
                      <button
                        className="table-icon-action danger-link"
                        title="Rechazar"
                        aria-label="Rechazar"
                        onClick={() => {
                          setRejecting(novelty);
                          setRejectReason("");
                        }}
                      >
                        <X size={14} />
                        <span>Rechazar</span>
                      </button>
                    </div>
                  ) : null}
                  {currentUser.role === "Nivel 1 - RRHH" ? (
                    <button className="table-icon-action danger-link" title="Eliminar" aria-label="Eliminar novedad" onClick={() => void remove(novelty)}>
                      <Trash2 size={14} /><span>Eliminar</span>
                    </button>
                  ) : null}
                  {!canApprove && currentUser.role !== "Nivel 1 - RRHH" ? "-" : null}
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </TableShell>
      {actionError ? <p className="error">{actionError}</p> : null}
      {rejecting ? (
        <Modal title="Rechazar novedad" close={() => setRejecting(null)}>
          <div className="form-stack">
            <div className="info-note compact">
              <b>{rejecting.type}</b>
              <p>El registro queda rechazado y se conserva para historial, auditoria y trazabilidad.</p>
            </div>
            <label>
              Motivo del rechazo *
              <textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Indicá el motivo para dejar trazabilidad"
              />
            </label>
            {!rejectReason.trim() ? <p className="error">El motivo es obligatorio.</p> : null}
            <div className="form-actions">
              <Button variant="subtle" onClick={() => setRejecting(null)}>
                Cancelar
              </Button>
              <Button variant="danger" disabled={!rejectReason.trim()} onClick={reject}>
                Rechazar novedad
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
