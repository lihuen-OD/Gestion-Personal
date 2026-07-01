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

  return (
    <div className="labor-status-card">
      <div>
        <p className="eyebrow">ESTADO LABORAL</p>
        <h3>
          <span className={statusClass(status.status)}>{status.status}</span>
        </h3>
        <p>{status.message}</p>
        <p>El estado laboral se calcula automáticamente según los movimientos de Alta / Baja laboral.</p>
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
