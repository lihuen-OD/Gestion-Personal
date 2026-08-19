import type { Prisma } from "@prisma/client";

// Forma compartida de "empleado asociado" para los listados de Régimen
// Laboral -> empleados y Concepto Horario -> empleados habilitados (Etapa
// 8G). Selección liviana a propósito: no reutiliza employeeListSelect de
// employees.repository.ts porque ese select trae mucho más de lo que estas
// dos vistas necesitan (laborMovements, etc.) y encarecería estas consultas
// sin motivo.
export const associatedEmployeeSelect = {
  id: true,
  legajo: true,
  cuil: true,
  firstName: true,
  lastName: true,
  status: true,
  sector: { select: { id: true, name: true } },
  costCenter: { select: { id: true, name: true } },
  companies: { select: { company: { select: { id: true, name: true } } } },
} satisfies Prisma.EmployeeSelect;

export type AssociatedEmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof associatedEmployeeSelect }>;

export type EmployeeAssociationFilters = {
  search?: string;
  sectorId?: string;
  costCenterId?: string;
  companyId?: string;
};

// Mismo idioma que buildWhere en employees.repository.ts (sectorId/costCenterId
// como columna directa, companyId vía EmployeeCompany porque Employee no tiene
// una columna companyId propia) — se reutiliza el criterio, no se reinventa.
export function buildEmployeeAssociationWhere(filters: EmployeeAssociationFilters): Prisma.EmployeeWhereInput {
  const search = filters.search?.trim();
  return {
    ...(filters.sectorId ? { sectorId: filters.sectorId } : {}),
    ...(filters.costCenterId ? { costCenterId: filters.costCenterId } : {}),
    ...(filters.companyId ? { companies: { some: { companyId: filters.companyId } } } : {}),
    ...(search
      ? {
          OR: [
            { legajo: { contains: search, mode: "insensitive" as const } },
            { cuil: { contains: search, mode: "insensitive" as const } },
            { firstName: { contains: search, mode: "insensitive" as const } },
            { lastName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}

export function mapAssociatedEmployee(employee: AssociatedEmployeeRow) {
  return {
    id: employee.id,
    legajo: employee.legajo,
    cuil: employee.cuil,
    firstName: employee.firstName,
    lastName: employee.lastName,
    status: employee.status,
    sector: employee.sector,
    costCenter: employee.costCenter,
    companies: employee.companies.map((item) => item.company),
  };
}
