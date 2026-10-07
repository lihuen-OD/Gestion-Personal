// Estructura organizacional y de ubicaciones: qué bloquea el borrado (o el
// cambio de padre) de cada entidad y cómo se le explica al usuario.
//
// Modelo objetivo (docs/decisions/ORG_LOCATION_REORGANIZATION.md §3.1):
//   Organización: Empresa → Unidad de negocio → Sector → Área
//   Ubicaciones:  Zona → Establecimiento
// Durante la transición (hasta M2) se cuentan también los vínculos del modelo
// anterior que siguen en la base (UN → Establecimiento, Establecimiento →
// Área, Área → Sector, sector de legajos/puestos/usuarios).
//
// La base no protege todos estos casos: varias FK del modelo anterior son
// ON DELETE SET NULL (Employee.sectorId/costCenterId, Position.sectorId,
// User.companyId/sectorId y los padres legados) y EmployeeCompany es CASCADE.
// Por eso cada dependencia se cuenta antes de borrar y, si hay alguna, el
// borrado se rechaza — nunca se deja que la base desvincule o borre en cadena.
// Las FKs nuevas (padres del modelo objetivo, alcances de puestos, ubicaciones
// de legajos, DoubleHourRule desde M1) son RESTRICT además del conteo.
//
// Excepción deliberada: los vínculos propios de un centro de costo
// (CostCenterCompany/BusinessUnit/Establishment/Area/Sector) son su propia
// configuración y se eliminan explícitamente con él. Del lado de la otra
// entidad sí bloquean: un sector con centros de costo asociados no se borra.

export type OrgEntityKind = "company" | "businessUnit" | "sector" | "area" | "zone" | "establishment" | "costCenter";

export type OrgDependencyKey =
  | "businessUnits"
  | "sectors"
  | "areas"
  | "establishments"
  | "employees"
  | "positions"
  | "users"
  | "costCenterLinks"
  | "doubleHourRules"
  | "positionScopes"
  | "workLocations"
  | "clockDevices";

export const orgEntityDependencies: Record<OrgEntityKind, readonly OrgDependencyKey[]> = {
  company: ["businessUnits", "establishments", "employees", "users", "costCenterLinks", "doubleHourRules", "positionScopes"],
  businessUnit: ["sectors", "establishments", "costCenterLinks", "positionScopes"],
  sector: ["areas", "employees", "positions", "users", "costCenterLinks", "doubleHourRules", "positionScopes"],
  area: ["sectors", "costCenterLinks", "positionScopes"],
  zone: ["establishments"],
  establishment: ["areas", "costCenterLinks", "workLocations", "clockDevices"],
  costCenter: ["employees", "doubleHourRules"],
};

const dependencyLabels: Record<OrgDependencyKey, [singular: string, plural: string]> = {
  businessUnits: ["unidad de negocio", "unidades de negocio"],
  sectors: ["sector", "sectores"],
  areas: ["área", "áreas"],
  establishments: ["establecimiento", "establecimientos"],
  employees: ["empleado", "empleados"],
  positions: ["puesto", "puestos"],
  users: ["usuario con alcance", "usuarios con alcance"],
  costCenterLinks: ["centro de costo", "centros de costo"],
  doubleHourRules: ["regla de horas especiales", "reglas de horas especiales"],
  positionScopes: ["alcance de puesto", "alcances de puestos"],
  workLocations: ["ubicación de trabajo de un legajo", "ubicaciones de trabajo de legajos"],
  clockDevices: ["dispositivo de fichada", "dispositivos de fichada"],
};

// Etiqueta de negocio (sin nombres de modelo) + pronombre para "Podés inactivarla/o".
export const orgEntityLabels: Record<OrgEntityKind, { article: string; noun: string; pronoun: "la" | "lo"; auditEntity: string }> = {
  company: { article: "la", noun: "empresa", pronoun: "la", auditEntity: "Company" },
  businessUnit: { article: "la", noun: "unidad de negocio", pronoun: "la", auditEntity: "BusinessUnit" },
  sector: { article: "el", noun: "sector", pronoun: "lo", auditEntity: "Sector" },
  area: { article: "el", noun: "área", pronoun: "la", auditEntity: "Area" },
  zone: { article: "la", noun: "zona", pronoun: "la", auditEntity: "Zone" },
  establishment: { article: "el", noun: "establecimiento", pronoun: "lo", auditEntity: "Establishment" },
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

// D-9 (ratificada 2026-10-07, ORG_LOCATION_REORGANIZATION.md §4): un nodo en
// uso no cambia de padre, porque movería en silencio el alcance de los puestos
// y reglas que lo referencian. Reorganizar nodos en uso requiere una operación
// explícita futura que contemple sus referencias; no existe todavía.
export function parentChangeBlockedMessage(kind: OrgEntityKind, name: string, dependencies: OrgDependencyCount[]) {
  const { article, noun } = orgEntityLabels[kind];
  return `No se puede cambiar la ubicación en la estructura de ${article} ${noun} “${name}” porque tiene elementos asociados: ${joinSpanish(dependencies.map((item) => item.label))}. Moverlo cambiaría su alcance para todos ellos.`;
}
