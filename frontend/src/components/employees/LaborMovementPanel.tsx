import { useState } from "react";
import { employeeApiService } from "../../services/api/employeeApiService";
import { getUserErrorMessage } from "../../services/api/apiClient";
import { calculateLaborStatus } from "../../services/employeeStatusService";
import type { Employee, LaborMovementType, User } from "../../types";
import { useAsyncAction } from "../../utils/useAsyncAction";
import { EmptyState } from "../ui/EmptyState";
import { Field, Select } from "../ui/FormControls";
import { Modal } from "../ui/Modal";
import { OverflowCell } from "../ui/OverflowCell";
import { Section } from "../ui/Section";
import { TableShell } from "../ui/TableShell";

const entryReasons = [
  "Alta inicial",
  "Reingreso",
  "Transferencia desde otra empresa",
  "Contratacion eventual",
  "Otro",
];

const exitReasons = ["Renuncia", "Despido", "Jubilación", "Fin de contrato", "Fallecimiento", "Otro"];

type LaborMovementPanelProps = {
  employee: Employee;
  user: User;
  canEdit: boolean;
  onSaved: (employee: Employee) => void;
};

export function LaborMovementPanel({
  employee,
  user,
  canEdit,
  onSaved,
}: LaborMovementPanelProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<LaborMovementType>(() => (
    calculateLaborStatus(employee.laborMovements || []).status === "Inactivo" ? "ALTA" : "BAJA"
  ));
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [observation, setObservation] = useState("");
  const [error, setError] = useState("");
  const status = calculateLaborStatus(employee.laborMovements || []);

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!type) return setError("El tipo de movimiento es obligatorio.");
    if (!effectiveFrom) return setError("La fecha desde es obligatoria.");
    if (!reason.trim()) return setError("El motivo del cambio es obligatorio.");
    try {
      const updated = await employeeApiService.createLaborMovement(employee.id, {
        type,
        effectiveFrom,
        reason: reason.trim(),
        observation: observation.trim() || null,
      });
      onSaved(updated);
    } catch (error) {
      setError(getUserErrorMessage(error, "No pudimos registrar el movimiento. Intentá nuevamente."));
      return;
    }
    setOpen(false);
    setReason("");
    setObservation("");
    setError("");
  });

  return (
    <Section
      title="Alta / Baja laboral"
      subtitle={`Movimientos laborales registrados solo para ${employee.firstName} ${employee.lastName}`}
      action={
        canEdit ? (
          <button
            type="button"
            className="button primary"
            onClick={() => {
              setType(status.status === "Inactivo" ? "ALTA" : "BAJA");
              setReason("");
              setOpen(true);
            }}
          >
            Registrar movimiento laboral
          </button>
        ) : undefined
      }
    >
      <div className="labor-movement-table">
        <TableShell minWidth={980}>
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Fecha desde</th>
                <th>Motivo</th>
                <th>Observación</th>
                <th>Registrado por</th>
                <th>Fecha de registro</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {(employee.laborMovements || []).map((movement) => {
                const isFuture = new Date(`${movement.effectiveFrom}T00:00:00`) > new Date();
                return (
                  <tr key={movement.id}>
                    <td>
                      <span className={movement.type === "ALTA" ? "badge success" : "badge danger"}>
                        {movement.type}
                      </span>
                    </td>
                    <td>{movement.effectiveFrom}</td>
                    <td>
                      <OverflowCell value={movement.reason} />
                    </td>
                    <td>
                      <OverflowCell value={movement.observation || "-"} />
                    </td>
                    <td>{movement.createdByUserName}</td>
                    <td>{new Date(movement.createdAt).toLocaleString("es-AR")}</td>
                    <td>{isFuture ? "Programado" : "Vigente / histórico"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
        {!(employee.laborMovements || []).length ? (
          <EmptyState text="No hay movimientos laborales registrados." />
        ) : null}
        {employee.status === "Inactivo" && !(employee.laborMovements || []).length ? (
          <p className="soft-alert">
            Este legajo figura como inactivo en datos anteriores, pero no tiene movimiento de baja
            registrado.
          </p>
        ) : null}
      </div>
      {open ? (
        <Modal title="Registrar movimiento laboral" close={() => setOpen(false)}>
          <div className="form-stack">
            <Select
              label="Tipo de movimiento"
              value={type}
              set={(next) => setType(next as LaborMovementType)}
              options={["ALTA", "BAJA"]}
            />
            <Field label="Fecha desde" type="date" value={effectiveFrom} set={setEffectiveFrom} />
            <Select
              label="Motivo"
              value={reason}
              set={setReason}
              options={type === "ALTA" ? entryReasons : exitReasons}
            />
            <Field label="Observación" value={observation} set={setObservation} />
            {error ? <p className="error">{error}</p> : null}
            <p className="info-note">
              Estado resultante actual: {status.status}. El estado laboral no se edita manualmente.
            </p>
            <div className="form-actions">
              <button className="button subtle" onClick={() => setOpen(false)}>
                Cancelar
              </button>
              <button className="button primary" onClick={save} disabled={isSaving}>
                {isSaving ? "Guardando..." : "Guardar movimiento"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </Section>
  );
}
