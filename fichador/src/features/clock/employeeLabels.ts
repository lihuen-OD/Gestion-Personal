import type { ClockEmployee } from "../../services/api/timeClockApiService";

// Fichador §32 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md): la persona se
// identifica como "Apellido Nombre" + "DNI <completo>". El legajo nunca se
// muestra en el fichador (el backend tampoco lo envía).

/** "DNI 12345678"; vacío si el dato no llegó (intento guardado con un contrato anterior). */
export function employeeIdentity(employee: ClockEmployee) {
  return employee.dni ? `DNI ${employee.dni}` : "";
}

/** Como se lista en la búsqueda: "Gomez, Ana". */
export function employeeListName(employee: ClockEmployee) {
  return `${employee.lastName}, ${employee.firstName}`;
}

/** Como se muestra a la persona elegida: "Gomez Ana" (apellido primero, sin coma). */
export function employeeDisplayName(employee: ClockEmployee) {
  return `${employee.lastName} ${employee.firstName}`;
}

/** Iniciales para el avatar, en el mismo orden que el nombre visible: "GA". */
export function employeeInitials(employee: ClockEmployee) {
  return `${employee.lastName.trim().charAt(0)}${employee.firstName.trim().charAt(0)}`.toUpperCase();
}
