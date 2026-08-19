export type AssociatedEmployeeStatus = "ACTIVO" | "INACTIVO";

// Forma compartida por los dos listados de "empleados asociados" (Régimen
// Laboral y Concepto Horario, Etapa 8G) — mismo shape que
// associatedEmployeeSelect/mapAssociatedEmployee en el backend.
export type AssociatedEmployee = {
  id: string;
  legajo: string;
  cuil: string;
  firstName: string;
  lastName: string;
  status: AssociatedEmployeeStatus;
  sector: { id: string; name: string } | null;
  costCenter: { id: string; name: string } | null;
  companies: { id: string; name: string }[];
};

export type AssociatedEmployeeVigencyStatus = "current" | "historical" | "future";
export type WorkRegimeEmployeesStatusFilter = AssociatedEmployeeVigencyStatus | "all";

export type WorkRegimeEmployeeAssociation = {
  id: string;
  employeeId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  vigencyStatus: AssociatedEmployeeVigencyStatus;
  employee: AssociatedEmployee;
};

export type HourConceptEmployeeAssociation = {
  employeeId: string;
  employee: AssociatedEmployee;
};

export type AssociatedEmployeeFilters = {
  search?: string;
  sectorId?: string;
  costCenterId?: string;
  companyId?: string;
  page?: number;
  take?: number;
};

export type AssociatedEmployeesMeta = { total: number; page: number; pageSize: number; hasMore: boolean };
export type AssociatedEmployeesResult<T> = { items: T[]; meta: AssociatedEmployeesMeta };
