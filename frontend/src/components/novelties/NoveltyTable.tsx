import { CheckCircle2, X } from "lucide-react";
import { useState } from "react";
import { noveltyApiService } from "../../services/api/noveltyApiService";
import type { Employee, Novelty, User } from "../../types";
import { displayLegajo, fullName } from "../../utils/employee";
import { statusClass } from "../../utils/status";
import { Modal } from "../ui/Modal";
import { OverflowCell } from "../ui/OverflowCell";
import { TableShell } from "../ui/TableShell";
import { EmptyState } from "../ui/EmptyState";

export function NoveltyTable({
  rows,
  employees,
  currentUser,
  onChanged,
}: {
  rows: Novelty[];
  employees: Employee[];
  currentUser: User;
  onChanged: () => void;
}) {
  const [rejecting, setRejecting] = useState<Novelty | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState("");

  const approve = async (id: string) => {
    try {
      await noveltyApiService.approve(id);
      setActionError("");
      onChanged();
    } catch (error) {
      setActionError("No se pudo aprobar la novedad en backend.");
    }
  };

  const reject = async () => {
    if (!rejecting || !rejectReason.trim()) return;
    try {
      await noveltyApiService.reject(rejecting.id, rejectReason.trim());
      setActionError("");
      onChanged();
    } catch (error) {
      setActionError("No se pudo rechazar la novedad en backend.");
    }
    setRejecting(null);
    setRejectReason("");
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
                  <span className="badge neutral">{novelty.origin || "INTERNA"}</span>
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
                    value={`${novelty.timeImpact || "NO_AFECTA_HORAS"}${
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
                  <span className={statusClass(novelty.status)}>{novelty.status}</span>
                </td>
                <td>
                  {canApprove ? (
                    <div className="table-actions">
                      <button
                        className="table-link table-icon-action"
                        title="Aprobar"
                        aria-label="Aprobar"
                        onClick={() => approve(novelty.id)}
                      >
                        <CheckCircle2 size={14} />
                        <span>Aprobar</span>
                      </button>
                      <button
                        className="table-link table-icon-action danger-link"
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
                  ) : (
                    "-"
                  )}
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
              <button className="button subtle" onClick={() => setRejecting(null)}>
                Cancelar
              </button>
              <button className="button danger-button" disabled={!rejectReason.trim()} onClick={reject}>
                Rechazar novedad
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
