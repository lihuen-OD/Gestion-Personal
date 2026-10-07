import type { Prisma } from "@prisma/client";
import { employeeStructureWhere, type EmployeeStructureFilters } from "./employeeStructureWhere";

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
  // Sector ANTERIOR (sólo consulta) y puesto con su cantidad de alcances (A7).
  sector: { select: { id: true, name: true } },
  position: { select: { id: true, name: true, _count: { select: { orgScopes: true } } } },
  costCenter: { select: { id: true, name: true } },
  companies: { select: { company: { select: { id: true, name: true } } } },
} satisfies Prisma.EmployeeSelect;

export type AssociatedEmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof associatedEmployeeSelect }>;

export type EmployeeAssociationFilters = EmployeeStructureFilters & {
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
  const structure = employeeStructureWhere(filters);
  const base: Prisma.EmployeeWhereInput = {
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
  return structure.length ? { AND: [base, ...structure] } : base;
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
    position: employee.position ? { id: employee.position.id, name: employee.position.name, scopeCount: employee.position._count.orgScopes } : null,
    costCenter: employee.costCenter,
    companies: employee.companies.map((item) => item.company),
  };
}
