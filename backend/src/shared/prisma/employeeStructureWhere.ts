import type { Prisma } from "@prisma/client";
import { argentinaCalendarDate, todayArgentinaDateKey } from "../datetime/argentinaTime";
import { orgScopeRowWhere, type OrgScopeLevel, type OrgScopeMode } from "./orgScopeWhere";

/**
 * A7 (docs/decisions/ORG_LOCATION_REORGANIZATION.md §16): filtros de
 * estructura para listados de legajos. Separan tres conceptos:
 * - Organización: alcance del PUESTO asignado (nunca un dato copiado al legajo).
 * - Ubicación: EmployeeWorkLocation vigente a una fecha calendario.
 * - Empresa empleadora: EmployeeCompany (filtro `companyId` existente).
 * Todo se expresa con `some`/`none` sobre el legajo: una persona con varios
 * alcances o ubicaciones aparece una sola vez. Estos filtros se combinan
 * SIEMPRE con `employeeAccessWhere`; el alcance del puesto no concede acceso.
 */
export type EmployeeStructureFilters = {
  scopeLevel?: OrgScopeLevel;
  scopeNodeId?: string;
  scopeMode?: OrgScopeMode;
  locationZoneId?: string;
  locationEstablishmentId?: string;
  locationDate?: string;
  reloadStatus?: "PENDING" | "COMPLETE";
};

/** Ubicación cuya vigencia [desde, hasta] contiene el día `dateKey`. */
export function workLocationOnDateWhere(dateKey: string): Prisma.EmployeeWorkLocationWhereInput {
  const day = argentinaCalendarDate(dateKey);
  return { effectiveFrom: { lte: day }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }] };
}

/** Ubicación vigente hoy o futura (no finalizada). */
export function workLocationNotEndedWhere(todayKey: string): Prisma.EmployeeWorkLocationWhereInput {
  return { OR: [{ effectiveTo: null }, { effectiveTo: { gte: argentinaCalendarDate(todayKey) } }] };
}

/**
 * Legajo pendiente de recarga (mismo criterio que el aviso de Datos
 * Laborales, A6): sin puesto con alcance organizacional, o sin ninguna
 * ubicación vigente o futura. El sector anterior no cuenta: queda hasta M2.
 */
export function reloadPendingWhere(todayKey: string): Prisma.EmployeeWhereInput {
  return {
    OR: [
      { positionId: null },
      { position: { orgScopes: { none: {} } } },
      { workLocations: { none: workLocationNotEndedWhere(todayKey) } },
    ],
  };
}

export function employeeStructureWhere(filters: EmployeeStructureFilters, todayKey = todayArgentinaDateKey()): Prisma.EmployeeWhereInput[] {
  const clauses: Prisma.EmployeeWhereInput[] = [];
  if (filters.scopeLevel && filters.scopeNodeId && filters.scopeMode) {
    clauses.push({ position: { orgScopes: { some: orgScopeRowWhere(filters.scopeLevel, filters.scopeNodeId, filters.scopeMode) } } });
  }
  if (filters.locationZoneId || filters.locationEstablishmentId) {
    clauses.push({
      workLocations: {
        some: {
          AND: [
            workLocationOnDateWhere(filters.locationDate || todayKey),
            ...(filters.locationZoneId ? [{ zoneId: filters.locationZoneId }] : []),
            ...(filters.locationEstablishmentId ? [{ establishments: { some: { establishmentId: filters.locationEstablishmentId } } }] : []),
          ],
        },
      },
    });
  }
  if (filters.reloadStatus === "PENDING") clauses.push(reloadPendingWhere(todayKey));
  if (filters.reloadStatus === "COMPLETE") clauses.push({ NOT: reloadPendingWhere(todayKey) });
  return clauses;
}
