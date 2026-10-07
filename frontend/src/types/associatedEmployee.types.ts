import type { SortState } from "../utils/sort";
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
  /** Sector ANTERIOR (sólo consulta, A7). */
  sector: { id: string; name: string } | null;
  /** Puesto con su cantidad de alcances (A7); ausente en respuestas antiguas. */
  position?: { id: string; name: string; scopeCount: number } | null;
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
  /** A7: alcance/ubicación/recarga/sector anterior (structureFilterParams). */
  structure?: Record<string, string>;
  page?: number;
  take?: number;
  // Orden server-side (whitelist: legajo, employee) de /hour-concepts/:id/employees y /work-regimes/:id/employees.
  sort?: SortState<AssociatedEmployeeSortKey>;
};

export type AssociatedEmployeeSortKey = "legajo" | "employee";

export type AssociatedEmployeesMeta = { total: number; page: number; pageSize: number; hasMore: boolean };
export type AssociatedEmployeesResult<T> = { items: T[]; meta: AssociatedEmployeesMeta };
