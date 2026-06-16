import type { Employee } from "../types";

export function fullName(employee: Employee) {
  return `${employee.lastName}, ${employee.firstName}`;
}

export function displayLegajo(employee?: Employee) {
  return employee ? (employee.legajoInterno || employee.legajoFinnegans || employee.legajo || "Sin cargar") : "Sin cargar";
}

export function employeeCompanies(employee: Employee) {
  return employee.companies?.length ? employee.companies : [employee.company].filter(Boolean);
}
