import type { Employee, EmployeeStatus, LaborMovement } from "../types";

const today = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

export function calculateLaborStatus(laborMovements: LaborMovement[] = []): { status: EmployeeStatus; currentMovement?: LaborMovement; scheduledTermination?: LaborMovement | null; message: string } {
  const currentDate = today();
  const sorted = [...laborMovements].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const effective = sorted.filter((movement) => new Date(`${movement.effectiveFrom}T00:00:00`) <= currentDate);
  const currentMovement = effective[effective.length - 1];
  const scheduledTermination = sorted.find((movement) => movement.type === "BAJA" && new Date(`${movement.effectiveFrom}T00:00:00`) > currentDate) || null;
  if (currentMovement?.type === "BAJA") {
    const label = new Date(`${currentMovement.effectiveFrom}T00:00:00`).toLocaleDateString("es-AR");
    return { status: "Inactivo", currentMovement, scheduledTermination: null, message: `Colaborador inactivo desde el ${label}.` };
  }
  if (scheduledTermination) {
    const label = new Date(`${scheduledTermination.effectiveFrom}T00:00:00`).toLocaleDateString("es-AR");
    return { status: "Activo", currentMovement, scheduledTermination, message: `Baja programada para el ${label}.` };
  }
  return { status: "Activo", currentMovement, scheduledTermination: null, message: currentMovement ? "Colaborador activo segÃºn el Ãºltimo movimiento laboral vigente." : "Sin movimientos laborales registrados. Se muestra activo por compatibilidad con datos existentes." };
}

export function calculateEmployeeStatus(employee: Pick<Employee, "startDate" | "endDate"> & Partial<Pick<Employee, "laborMovements">>): EmployeeStatus {
  if (employee.laborMovements?.length) return calculateLaborStatus(employee.laborMovements).status;
  if (!employee.startDate) return "Inactivo";
  if (!employee.endDate) return "Activo";
  return new Date(`${employee.endDate}T00:00:00`) <= today() ? "Inactivo" : "Activo";
}

export function laborStatusMessage(employee: Pick<Employee, "startDate" | "endDate"> & Partial<Pick<Employee, "laborMovements">>) {
  if (employee.laborMovements?.length) return calculateLaborStatus(employee.laborMovements).message;
  if (!employee.startDate) return "Sin fecha de alta cargada.";
  if (!employee.endDate) return "El estado se calcula automáticamente según la fecha de alta y fecha de baja.";
  const endDate = new Date(`${employee.endDate}T00:00:00`);
  const label = endDate.toLocaleDateString("es-AR");
  return endDate <= today() ? `Colaborador inactivo desde el ${label}.` : `Baja programada para el ${label}. El colaborador continuará activo hasta esa fecha.`;
}
