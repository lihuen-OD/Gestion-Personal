import type { Prisma } from "@prisma/client";

export type OrgScopeLevel = "COMPANY" | "BUSINESS_UNIT" | "SECTOR" | "AREA";
export type OrgScopeMode = "WITHIN" | "COVERS";

/**
 * Semántica de filtros por alcance organizacional
 * (docs/decisions/ORG_LOCATION_REORGANIZATION.md §3.4), única para Puestos y
 * Legajos:
 * - WITHIN ("Ubicado dentro de" N): algún alcance es N o un descendiente de N.
 * - COVERS ("Abarca" N): algún alcance es N o un ancestro de N.
 * Devuelve el filtro de UNA fila de PositionOrgScope; el llamador lo envuelve
 * en `some`, así un puesto/legajo con varios alcances aparece una sola vez.
 * El modo por defecto y la combinación de ambos siguen pendientes (D-7).
 */
export function orgScopeRowWhere(level: OrgScopeLevel, id: string, mode: OrgScopeMode): Prisma.PositionOrgScopeWhereInput {
  const direct = level === "COMPANY" ? { companyId: id } : level === "BUSINESS_UNIT" ? { businessUnitId: id } : level === "SECTOR" ? { sectorId: id } : { areaId: id };
  if (mode === "WITHIN") {
    const descendants = level === "COMPANY"
      ? [{ businessUnit: { companyId: id } }, { sector: { businessUnit: { companyId: id } } }, { area: { sector: { businessUnit: { companyId: id } } } }]
      : level === "BUSINESS_UNIT"
        ? [{ sector: { businessUnitId: id } }, { area: { sector: { businessUnitId: id } } }]
        : level === "SECTOR" ? [{ area: { sectorId: id } }] : [];
    return { OR: [direct, ...descendants] };
  }
  const ancestors = level === "AREA"
    ? [{ sector: { areas: { some: { id } } } }, { businessUnit: { sectors: { some: { areas: { some: { id } } } } } }, { company: { businessUnits: { some: { sectors: { some: { areas: { some: { id } } } } } } } }]
    : level === "SECTOR"
      ? [{ businessUnit: { sectors: { some: { id } } } }, { company: { businessUnits: { some: { sectors: { some: { id } } } } } }]
      : level === "BUSINESS_UNIT" ? [{ company: { businessUnits: { some: { id } } } }] : [];
  return { OR: [direct, ...ancestors] };
}
