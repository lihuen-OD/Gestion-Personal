import type { AssociatedEmployee, AssociatedEmployeeFilters } from "../../types/associatedEmployee.types";

export type ApiAssociatedEmployee = {
  id: string;
  legajo: string;
  cuil: string;
  firstName: string;
  lastName: string;
  status: "ACTIVO" | "INACTIVO";
  sector: { id: string; name: string } | null;
  costCenter: { id: string; name: string } | null;
  companies: { id: string; name: string }[];
};

export function mapAssociatedEmployeeFromApi(item: ApiAssociatedEmployee): AssociatedEmployee {
  return {
    id: item.id,
    legajo: item.legajo,
    cuil: item.cuil,
    firstName: item.firstName,
    lastName: item.lastName,
    status: item.status,
    sector: item.sector,
    costCenter: item.costCenter,
    companies: item.companies,
  };
}

// Query string compartida por getWorkRegimeEmployees/getHourConceptEmployees
// (search/sectorId/costCenterId/companyId/page/take) — extraParams cubre lo
// que cada endpoint agrega por su cuenta (status de vigencia en régimen,
// status de empleado en concepto), sin duplicar el resto del armado.
export function associatedEmployeesQuery(filters?: AssociatedEmployeeFilters, extraParams?: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  params.set("page", String(filters?.page || 1));
  params.set("take", String(filters?.take || 50));
  if (filters?.search?.trim()) params.set("search", filters.search.trim());
  if (filters?.sectorId) params.set("sectorId", filters.sectorId);
  if (filters?.costCenterId) params.set("costCenterId", filters.costCenterId);
  if (filters?.companyId) params.set("companyId", filters.companyId);
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      if (value) params.set(key, value);
    }
  }
  return `?${params.toString()}`;
}
