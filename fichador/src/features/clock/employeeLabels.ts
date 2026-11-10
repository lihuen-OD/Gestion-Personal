import type { ClockEmployee } from "../../services/api/timeClockApiService";

/** "Legajo 100 · DNI terminado en 456" (F0: el DNI completo nunca llega al kiosco). */
export function employeeIdentity(employee: ClockEmployee) {
  return employee.dniSuffix ? `Legajo ${employee.legajo} · DNI terminado en ${employee.dniSuffix}` : `Legajo ${employee.legajo}`;
}

/** Como se lista en la búsqueda: "Gomez, Ana". */
export function employeeListName(employee: ClockEmployee) {
  return `${employee.lastName}, ${employee.firstName}`;
}

/** Como se saluda a la persona: "Ana Gomez". */
export function employeeFullName(employee: ClockEmployee) {
  return `${employee.firstName} ${employee.lastName}`;
}

/** Iniciales para el avatar: "AG". */
export function employeeInitials(employee: ClockEmployee) {
  return `${employee.firstName.trim().charAt(0)}${employee.lastName.trim().charAt(0)}`.toUpperCase();
}
