import type { Employee, EmployeeStatus, LaborMovement } from "../types";

const today = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

export function resolveCurrentLaborPeriod(laborMovements: LaborMovement[] = []) {
  const movements = [...laborMovements].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const startMovement = movements.find((movement) => movement.type === "ALTA");
  const endMovement = startMovement
    ? movements.find((movement) => movement.type === "BAJA" && movement.effectiveFrom >= startMovement.effectiveFrom)
    : movements.find((movement) => movement.type === "BAJA");

  return {
    startDate: startMovement?.effectiveFrom || "",
    endDate: endMovement?.effectiveFrom,
    exitReason: endMovement?.reason,
  };
}

export function calculateLaborStatus(laborMovements: LaborMovement[] = []): {
  status: EmployeeStatus;
  currentMovement?: LaborMovement;
  scheduledMovement?: LaborMovement | null;
  scheduledTermination?: LaborMovement | null;
  message: string;
} {
  const currentDate = today();
  const sorted = [...laborMovements].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const effective = sorted.filter((movement) => new Date(`${movement.effectiveFrom}T00:00:00`) <= currentDate);
  const currentMovement = effective[effective.length - 1];
  const scheduledMovement = sorted.find((movement) => new Date(`${movement.effectiveFrom}T00:00:00`) > currentDate) || null;
  const scheduledTermination = sorted.find((movement) => movement.type === "BAJA" && new Date(`${movement.effectiveFrom}T00:00:00`) > currentDate) || null;
  if (currentMovement?.type === "BAJA") {
    const label = new Date(`${currentMovement.effectiveFrom}T00:00:00`).toLocaleDateString("es-AR");
    return { status: "Inactivo", currentMovement, scheduledMovement, scheduledTermination: null, message: `Colaborador inactivo desde el ${label}.` };
  }
  if (scheduledTermination) {
    const label = new Date(`${scheduledTermination.effectiveFrom}T00:00:00`).toLocaleDateString("es-AR");
    return { status: "Activo", currentMovement, scheduledMovement, scheduledTermination, message: `Baja programada para el ${label}.` };
  }
  if (!currentMovement && scheduledMovement?.type === "ALTA") {
    const label = new Date(`${scheduledMovement.effectiveFrom}T00:00:00`).toLocaleDateString("es-AR");
    return { status: "Inactivo", currentMovement, scheduledMovement, scheduledTermination: null, message: `Alta programada para el ${label}.` };
  }
  return {
    status: "Activo",
    currentMovement,
    scheduledMovement,
    scheduledTermination: null,
    message: currentMovement ? "Colaborador activo segun el ultimo movimiento laboral vigente." : "Sin movimientos laborales registrados. Se muestra activo por compatibilidad con datos existentes.",
  };
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
