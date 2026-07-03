import { calculateLaborStatus } from "../../services/employeeStatusService";
import type { Employee } from "../../types";
import { statusClass } from "../../utils/status";

type LaborStatusCardProps = {
  employee: Employee;
};

export function LaborStatusCard({ employee }: LaborStatusCardProps) {
  const status = calculateLaborStatus(employee.laborMovements || []);
  const movement = status.currentMovement;
  const visibleMovement = movement || status.scheduledMovement;
  const movements = [...(employee.laborMovements || [])].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const latestStart = movements.find((item) => item.type === "ALTA")?.effectiveFrom || employee.startDate;
  const latestEnd = movements.find((item) => item.type === "BAJA")?.effectiveFrom || employee.endDate;
  const createdAt = employee.createdAt?.slice(0, 10);

  return (
    <div className="labor-status-card">
      <div>
        <p className="eyebrow">ESTADO LABORAL</p>
        <h3>
          <span className={statusClass(status.status)}>{status.status}</span>
        </h3>
        <p>{status.message}</p>
        {!latestStart ? (
          <p>Falta registrar el movimiento ALTA para guardar la fecha laboral de ingreso.</p>
        ) : null}
        <p>El estado laboral se calcula automáticamente según los movimientos de Alta / Baja laboral.</p>
      </div>
      <div>
        <small>Fecha de alta / ingreso</small>
        <b>{latestStart || "Alta no registrada"}</b>
      </div>
      <div>
        <small>Fecha de baja / egreso</small>
        <b>{latestEnd || "Sin baja registrada"}</b>
      </div>
      <div>
        <small>Fecha de creación del legajo</small>
        <b>{createdAt || "Sin dato"}</b>
      </div>
      <div>
        <small>{movement ? "Último movimiento vigente" : status.scheduledMovement ? "Próximo movimiento" : "Último movimiento vigente"}</small>
        <b>{visibleMovement ? `${visibleMovement.type} · ${visibleMovement.reason}` : "Sin movimiento"}</b>
      </div>
      <div>
        <small>Fecha desde</small>
        <b>{visibleMovement?.effectiveFrom || status.scheduledTermination?.effectiveFrom || "Sin cargar"}</b>
      </div>
    </div>
  );
}
