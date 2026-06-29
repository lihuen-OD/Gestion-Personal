import { calculateLaborStatus } from "../../services/employeeStatusService";
import type { Employee } from "../../types";
import { statusClass } from "../../utils/status";

type LaborStatusCardProps = {
  employee: Employee;
};

export function LaborStatusCard({ employee }: LaborStatusCardProps) {
  const status = calculateLaborStatus(employee.laborMovements || []);
  const movement = status.currentMovement;

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
        <small>Último movimiento vigente</small>
        <b>{movement ? `${movement.type} · ${movement.reason}` : "Sin movimiento"}</b>
      </div>
      <div>
        <small>Fecha desde</small>
        <b>{movement?.effectiveFrom || status.scheduledTermination?.effectiveFrom || "Sin cargar"}</b>
      </div>
    </div>
  );
}
