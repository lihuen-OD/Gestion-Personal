import type { AssociatedEmployee, AssociatedEmployeeFilters, AssociatedEmployeeVigencyStatus } from "../../types/associatedEmployee.types";

export function vigencyLabel(status: AssociatedEmployeeVigencyStatus): string {
  if (status === "current") return "Vigente";
  if (status === "future") return "Futura";
  return "Histórica";
}

export function vigencyTone(status: AssociatedEmployeeVigencyStatus): "success" | "warning" | "neutral" {
  if (status === "current") return "success";
  if (status === "future") return "warning";
  return "neutral";
}

// effectiveFrom/effectiveTo llegan como fecha calendario ("YYYY-MM-DD..."),
// mismo criterio que EmployeeWorkRegimePanel.tsx (dateKey/formatDate): no se
// re-parsea como instante para evitar corrimientos de huso horario.
export function formatVigencyDate(value: string | null): string {
  if (!value) return "-";
  return value.slice(0, 10).split("-").reverse().join("/");
}

export function employeeStatusLabel(status: AssociatedEmployee["status"]): string {
  return status === "ACTIVO" ? "Activo" : "Inactivo";
}

export function employeeCompanyNames(employee: AssociatedEmployee): string {
  return employee.companies.length ? employee.companies.map((company) => company.name).join(", ") : "-";
}

// Traduce el estado de los filtros (nombres seleccionados + búsqueda +
// paginación) a la forma real que esperan getWorkRegimeEmployees /
// getHourConceptEmployees — separado del componente para poder testearlo sin
// renderizar nada.
export function buildAssociatedEmployeesRequest(filters: {
  search: string;
  sectorId?: string;
  costCenterId?: string;
  companyId?: string;
  page: number;
  take: number;
}): AssociatedEmployeeFilters {
  return {
    search: filters.search.trim() || undefined,
    sectorId: filters.sectorId || undefined,
    costCenterId: filters.costCenterId || undefined,
    companyId: filters.companyId || undefined,
    page: filters.page,
    take: filters.take,
  };
}
