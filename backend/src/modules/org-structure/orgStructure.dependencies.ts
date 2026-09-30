// Eliminación segura de la estructura organizacional: qué bloquea el borrado
// de cada entidad y cómo se le explica al usuario.
//
// Relaciones auditadas en prisma/schema.prisma + migraciones. La base NO
// protege estos borrados por sí sola: Employee.sectorId/costCenterId,
// Position.sectorId, User.companyId/sectorId, DoubleHourRule.* y los hijos
// opcionales de la cadena (Establishment.businessUnitId, Area.establishmentId,
// Sector.areaId) son ON DELETE SET NULL, y EmployeeCompany + las tablas
// CostCenter* son ON DELETE CASCADE. Por eso cada dependencia se cuenta antes
// de borrar y, si hay alguna, el borrado se rechaza — nunca se deja que la
// base desvincule o borre en cadena.
//
// Excepción deliberada: los vínculos propios de un centro de costo
// (CostCenterCompany/BusinessUnit/Establishment/Area/Sector) son su propia
// configuración de ubicación (los campos companyIds..sectorIds de su
// formulario) y se eliminan con él. Del lado de la otra entidad sí bloquean:
// un sector con centros de costo asociados no se puede borrar.

export type OrgEntityKind = "company" | "businessUnit" | "establishment" | "area" | "sector" | "costCenter";

export type OrgDependencyKey =
  | "businessUnits"
  | "establishments"
  | "areas"
  | "sectors"
  | "employees"
  | "positions"
  | "users"
  | "costCenterLinks"
  | "doubleHourRules";

export const orgEntityDependencies: Record<OrgEntityKind, readonly OrgDependencyKey[]> = {
  company: ["businessUnits", "establishments", "employees", "users", "costCenterLinks", "doubleHourRules"],
  businessUnit: ["establishments", "costCenterLinks"],
  establishment: ["areas", "costCenterLinks"],
  area: ["sectors", "costCenterLinks"],
  sector: ["employees", "positions", "users", "costCenterLinks", "doubleHourRules"],
  costCenter: ["employees", "doubleHourRules"],
};

const dependencyLabels: Record<OrgDependencyKey, [singular: string, plural: string]> = {
  businessUnits: ["unidad de negocio", "unidades de negocio"],
  establishments: ["establecimiento", "establecimientos"],
  areas: ["área", "áreas"],
  sectors: ["sector", "sectores"],
  employees: ["empleado", "empleados"],
  positions: ["puesto", "puestos"],
  users: ["usuario con alcance", "usuarios con alcance"],
  costCenterLinks: ["centro de costo", "centros de costo"],
  doubleHourRules: ["regla de horas dobles", "reglas de horas dobles"],
};

// Etiqueta de negocio (sin nombres de modelo) + pronombre para "Podés inactivarla/o".
export const orgEntityLabels: Record<OrgEntityKind, { article: string; noun: string; pronoun: "la" | "lo"; auditEntity: string }> = {
  company: { article: "la", noun: "empresa", pronoun: "la", auditEntity: "Company" },
  businessUnit: { article: "la", noun: "unidad de negocio", pronoun: "la", auditEntity: "BusinessUnit" },
  establishment: { article: "el", noun: "establecimiento", pronoun: "lo", auditEntity: "Establishment" },
  area: { article: "el", noun: "área", pronoun: "la", auditEntity: "Area" },
  sector: { article: "el", noun: "sector", pronoun: "lo", auditEntity: "Sector" },
  costCenter: { article: "el", noun: "centro de costo", pronoun: "lo", auditEntity: "CostCenter" },
};

export type OrgDependencyCount = { key: OrgDependencyKey; count: number; label: string };

export function describeDependencies(kind: OrgEntityKind, counts: Partial<Record<OrgDependencyKey, number>>): OrgDependencyCount[] {
  return orgEntityDependencies[kind]
    .map((key) => ({ key, count: counts[key] ?? 0 }))
    .filter((item) => item.count > 0)
    .map((item) => {
      const [singular, plural] = dependencyLabels[item.key];
      return { ...item, label: `${item.count} ${item.count === 1 ? singular : plural}` };
    });
}

function joinSpanish(parts: string[]) {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

export function dependencyBlockedMessage(kind: OrgEntityKind, name: string, dependencies: OrgDependencyCount[]) {
  const { article, noun, pronoun } = orgEntityLabels[kind];
  return `No se puede eliminar ${article} ${noun} “${name}” porque tiene elementos asociados: ${joinSpanish(dependencies.map((item) => item.label))}. Podés inactivar${pronoun} si ya no debe utilizarse.`;
}
