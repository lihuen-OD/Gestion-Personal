import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService, clearAuditDerivedCaches } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";
import { employeeReferenceSelect, formatEmployeeReference } from "../../shared/audit/employeeReference";
import { findProtectedClosurePeriods } from "../../shared/monthlyClosure/closurePeriodGuard";
import { adminRoles } from "../../shared/security/roles";
import {
  assertActorAuthorizedWithin,
  assertConfirmedPlan,
  DeletionPlanBuilder,
  type DeletionConfirmation,
  type DeletionItem,
  type DeletionPreview,
} from "../../shared/deletion/deletionPlan";
import { employeesService } from "../employees/employees.service";
import { employeeWorkLocationsService } from "../employees/employeeWorkLocations.service";
import { mapLaborHistoryPersistenceError } from "../labor-history/laborHistory.service";
import { positionsService } from "../positions/positions.service";
import { invalidatePositionsCache } from "../positions/positions.repository";
import { orgEntityLabels, type OrgEntityKind } from "./orgStructure.dependencies";
import { invalidateOverviewCache } from "./orgStructure.repository";

/**
 * Eliminación controlada de la estructura (Organización, Ubicaciones y
 * centros de costo) con el protocolo de shared/deletion.
 *
 * El registro elegido arrastra a sus hijos propios del modelo vigente
 * (Empresa → UN → Sector → Área; Provincia → Zona → Establecimiento → Unidad).
 * Cada nodo alcanzado se ELIMINA si nada lo referencia como historia, o se
 * ARCHIVA si la historia lo necesita (períodos laborales, alcances históricos
 * de puestos, ubicaciones pasadas de legajos, reglas de horas especiales,
 * filas archivadas del modelo anterior). Al archivar, sectores, áreas y
 * establecimientos se desprenden de su padre (CHECK de forma de M2); unidades
 * de negocio, zonas y unidades conservan su padre, que entonces también se
 * conserva. Las referencias vigentes se resuelven desde HOY con la misma
 * historia que un cambio manual: nada anterior a hoy cambia y nunca se borran
 * personas, horas, cierres, novedades, documentos ni fichadas.
 */

type Kind = OrgEntityKind;
type Node = { kind: Kind; id: string; code: string; name: string; archivedAt: Date | null };
type Fate = "DELETE" | "ARCHIVE" | "KEEP_ARCHIVED";
type Db = PrismaTransactionClient;

const ORG_LEVELS = ["company", "businessUnit", "sector", "area"] as const;
const LOCATION_LEVELS = ["province", "zone", "establishment", "establishmentUnit"] as const;
const scopeLevelOf: Partial<Record<Kind, string>> = { company: "COMPANY", businessUnit: "BUSINESS_UNIT", sector: "SECTOR", area: "AREA" };

const kindLabels: Record<Kind, [singular: string, plural: string]> = {
  company: ["Empresa", "Empresas"],
  businessUnit: ["Unidad de negocio", "Unidades de negocio"],
  sector: ["Sector", "Sectores"],
  area: ["Área", "Áreas"],
  province: ["Provincia", "Provincias"],
  zone: ["Zona", "Zonas"],
  establishment: ["Establecimiento", "Establecimientos"],
  establishmentUnit: ["Unidad del establecimiento", "Unidades del establecimiento"],
  costCenter: ["Centro de costo", "Centros de costo"],
};

const nodeSelect = { id: true, code: true, name: true, archivedAt: true } as const;
const asNodes = (kind: Kind, rows: Array<{ id: string; code: string; name: string; archivedAt: Date | null }>): Node[] => rows.map((row) => ({ kind, ...row }));
const item = (node: Node): DeletionItem => ({ id: node.id, name: `${node.code} · ${node.name}` });

/** Subárbol propio del registro elegido, por nivel (incluye hijos ya archivados que conservan su padre). */
async function collectSubtree(db: Db, kind: Kind, id: string) {
  const byKind = new Map<Kind, Node[]>();
  const put = (k: Kind, nodes: Node[]) => byKind.set(k, nodes);
  const ids = (k: Kind) => (byKind.get(k) ?? []).map((node) => node.id);
  if (kind === "costCenter") {
    put("costCenter", asNodes("costCenter", await db.costCenter.findMany({ where: { id }, select: nodeSelect })));
    return byKind;
  }
  const levels: readonly Kind[] = (ORG_LEVELS as readonly Kind[]).includes(kind) ? ORG_LEVELS : LOCATION_LEVELS;
  const start = levels.indexOf(kind);
  for (let index = start; index < levels.length; index += 1) {
    const level = levels[index]!;
    const parent = index === start ? null : levels[index - 1]!;
    const parentIds = parent ? ids(parent) : [];
    if (parent && !parentIds.length) break;
    const where = (field: string) => (parent ? { [field]: { in: parentIds } } : { id });
    if (level === "company") put(level, asNodes(level, await db.company.findMany({ where: { id }, select: nodeSelect })));
    if (level === "businessUnit") put(level, asNodes(level, await db.businessUnit.findMany({ where: where("companyId"), select: nodeSelect })));
    if (level === "sector") put(level, asNodes(level, await db.sector.findMany({ where: where("businessUnitId"), select: nodeSelect })));
    if (level === "area") put(level, asNodes(level, await db.area.findMany({ where: where("sectorId"), select: nodeSelect })));
    if (level === "province") put(level, asNodes(level, await db.province.findMany({ where: { id }, select: nodeSelect })));
    if (level === "zone") put(level, asNodes(level, await db.zone.findMany({ where: where("provinceId"), select: nodeSelect })));
    if (level === "establishment") put(level, asNodes(level, await db.establishment.findMany({ where: where("zoneId"), select: nodeSelect })));
    if (level === "establishmentUnit") put(level, asNodes(level, await db.establishmentUnit.findMany({ where: where("establishmentId"), select: nodeSelect })));
  }
  return byKind;
}

const distinct = (values: Array<string | null>) => new Set(values.filter((value): value is string => Boolean(value)));

/** Ids de cada nivel que la historia (o una fila archivada) sigue referenciando. */
async function findHistoryHolders(db: Db, ids: Record<Kind, string[]>) {
  const any = (values: string[]) => values.length > 0;
  const [employerLinks, scopeNodes, legacySectorPeriods, costCenterPeriods, rulesByScope, legacyEstablishments, legacyPositions, legacySectors, legacyAreas, workLocations, workLocationEstablishments, workLocationUnits, currentEmployers, currentCostCenters] = await Promise.all([
    any(ids.company) ? db.employeeEmployerPeriodCompany.findMany({ where: { companyId: { in: ids.company } }, select: { companyId: true }, distinct: ["companyId"] }) : [],
    any([...ids.company, ...ids.businessUnit, ...ids.sector, ...ids.area])
      ? db.positionOrgScopePeriodNode.findMany({
        where: { OR: [{ companyId: { in: ids.company } }, { businessUnitId: { in: ids.businessUnit } }, { sectorId: { in: ids.sector } }, { areaSectorId: { in: ids.sector } }, { areaId: { in: ids.area } }] },
        select: { companyId: true, businessUnitId: true, sectorId: true, areaSectorId: true, areaId: true },
      })
      : [],
    any(ids.sector) ? db.employeeLegacySectorPeriod.findMany({ where: { sectorId: { in: ids.sector } }, select: { sectorId: true }, distinct: ["sectorId"] }) : [],
    any(ids.costCenter) ? db.employeeCostCenterPeriod.findMany({ where: { costCenterId: { in: ids.costCenter } }, select: { costCenterId: true }, distinct: ["costCenterId"] }) : [],
    any([...ids.company, ...ids.sector, ...ids.costCenter])
      ? db.doubleHourRule.findMany({ where: { OR: [{ companyId: { in: ids.company } }, { sectorId: { in: ids.sector } }, { costCenterId: { in: ids.costCenter } }] }, select: { id: true, name: true, companyId: true, sectorId: true, costCenterId: true } })
      : [],
    any([...ids.company, ...ids.businessUnit]) ? db.establishment.findMany({ where: { OR: [{ companyId: { in: ids.company } }, { businessUnitId: { in: ids.businessUnit } }] }, select: { companyId: true, businessUnitId: true } }) : [],
    any(ids.sector) ? db.position.findMany({ where: { sectorId: { in: ids.sector } }, select: { sectorId: true } }) : [],
    any(ids.area) ? db.sector.findMany({ where: { areaId: { in: ids.area } }, select: { areaId: true } }) : [],
    any(ids.establishment) ? db.area.findMany({ where: { establishmentId: { in: ids.establishment } }, select: { establishmentId: true } }) : [],
    any(ids.zone) ? db.employeeWorkLocation.findMany({ where: { zoneId: { in: ids.zone } }, select: { zoneId: true }, distinct: ["zoneId"] }) : [],
    any(ids.establishment) ? db.employeeWorkLocationEstablishment.findMany({ where: { establishmentId: { in: ids.establishment } }, select: { establishmentId: true }, distinct: ["establishmentId"] }) : [],
    any(ids.establishmentUnit) ? db.employeeWorkLocationUnit.findMany({ where: { unitId: { in: ids.establishmentUnit } }, select: { unitId: true }, distinct: ["unitId"] }) : [],
    // Referencias vigentes de personas: al retirarlas desde hoy queda su historia hasta ayer.
    any(ids.company) ? db.employeeCompany.findMany({ where: { companyId: { in: ids.company } }, select: { companyId: true }, distinct: ["companyId"] }) : [],
    any(ids.costCenter) ? db.employee.findMany({ where: { costCenterId: { in: ids.costCenter } }, select: { costCenterId: true }, distinct: ["costCenterId"] }) : [],
  ]);
  return {
    holders: {
      company: new Set([...distinct(employerLinks.map((row) => row.companyId)), ...distinct(scopeNodes.map((row) => row.companyId)), ...distinct(rulesByScope.map((row) => row.companyId)), ...distinct(legacyEstablishments.map((row) => row.companyId)), ...distinct(currentEmployers.map((row) => row.companyId))]),
      businessUnit: new Set([...distinct(scopeNodes.map((row) => row.businessUnitId)), ...distinct(legacyEstablishments.map((row) => row.businessUnitId))]),
      sector: new Set([...distinct(scopeNodes.map((row) => row.sectorId)), ...distinct(scopeNodes.map((row) => row.areaSectorId)), ...distinct(legacySectorPeriods.map((row) => row.sectorId)), ...distinct(rulesByScope.map((row) => row.sectorId)), ...distinct(legacyPositions.map((row) => row.sectorId))]),
      area: new Set([...distinct(scopeNodes.map((row) => row.areaId)), ...distinct(legacySectors.map((row) => row.areaId))]),
      province: new Set<string>(),
      zone: distinct(workLocations.map((row) => row.zoneId)),
      establishment: new Set([...distinct(workLocationEstablishments.map((row) => row.establishmentId)), ...distinct(legacyAreas.map((row) => row.establishmentId))]),
      establishmentUnit: distinct(workLocationUnits.map((row) => row.unitId)),
      costCenter: new Set([...distinct(costCenterPeriods.map((row) => row.costCenterId)), ...distinct(rulesByScope.map((row) => row.costCenterId)), ...distinct(currentCostCenters.map((row) => row.costCenterId))]),
    } satisfies Record<Kind, Set<string>>,
    rules: rulesByScope,
  };
}

/**
 * Destino de cada nodo, de las hojas a la raíz. Un hijo archivado que conserva
 * su FK al padre (UN → empresa, zona → provincia, unidad → establecimiento)
 * obliga a conservar también al padre.
 */
function decideFates(byKind: Map<Kind, Node[]>, holders: Record<Kind, Set<string>>, parents: Map<string, string>) {
  const fates = new Map<string, Fate>();
  const keptParents = new Set<string>();
  const order: Kind[] = ["establishmentUnit", "establishment", "zone", "province", "area", "sector", "businessUnit", "company", "costCenter"];
  for (const kind of order) {
    for (const node of byKind.get(kind) ?? []) {
      const kept = Boolean(node.archivedAt) || holders[kind].has(node.id) || keptParents.has(node.id);
      fates.set(node.id, node.archivedAt ? "KEEP_ARCHIVED" : kept ? "ARCHIVE" : "DELETE");
      const parentId = parents.get(node.id);
      if (kept && parentId) keptParents.add(parentId);
    }
  }
  return fates;
}

async function parentLinks(db: Db, byKind: Map<Kind, Node[]>) {
  // Sólo las relaciones cuyo hijo archivado conserva la FK al padre.
  const ids = (kind: Kind) => (byKind.get(kind) ?? []).map((node) => node.id);
  const [units, zones, businessUnits] = await Promise.all([
    ids("establishmentUnit").length ? db.establishmentUnit.findMany({ where: { id: { in: ids("establishmentUnit") } }, select: { id: true, establishmentId: true } }) : [],
    ids("zone").length ? db.zone.findMany({ where: { id: { in: ids("zone") } }, select: { id: true, provinceId: true } }) : [],
    ids("businessUnit").length ? db.businessUnit.findMany({ where: { id: { in: ids("businessUnit") } }, select: { id: true, companyId: true } }) : [],
  ]);
  const map = new Map<string, string>();
  for (const row of units) map.set(row.id, row.establishmentId);
  for (const row of zones) if (row.provinceId) map.set(row.id, row.provinceId);
  for (const row of businessUnits) map.set(row.id, row.companyId);
  return map;
}

type Plan = Awaited<ReturnType<typeof buildPlan>>;

async function buildPlan(db: Db, kind: Kind, id: string, todayKey: string) {
  const byKind = await collectSubtree(db, kind, id);
  const root = byKind.get(kind)?.find((node) => node.id === id);
  if (!root) throw new AppError("No encontramos el registro solicitado.", 404, "RECORD_NOT_FOUND");
  const ids = Object.fromEntries((Object.keys(kindLabels) as Kind[]).map((k) => [k, (byKind.get(k) ?? []).map((node) => node.id)])) as Record<Kind, string[]>;
  const { holders, rules } = await findHistoryHolders(db, ids);
  const fates = decideFates(byKind, holders, await parentLinks(db, byKind));
  const removedScopeKeys = new Set(ORG_LEVELS.flatMap((level) => ids[level].map((nodeId) => `${scopeLevelOf[level]}:${nodeId}`)));

  const [workLocations, employers, costCenterEmployees, scopeRows, users, devices, costCenterLinks] = await Promise.all([
    employeeWorkLocationsService.previewNodeDetachmentWithin(db, { zoneIds: ids.zone, establishmentIds: ids.establishment, unitIds: ids.establishmentUnit }, todayKey),
    ids.company.length ? db.employeeCompany.findMany({ where: { companyId: { in: ids.company } }, select: { employeeId: true, employee: { select: { ...employeeReferenceSelect, companies: { select: { companyId: true } } } } } }) : [],
    ids.costCenter.length ? db.employee.findMany({ where: { costCenterId: { in: ids.costCenter } }, select: { id: true, ...employeeReferenceSelect } }) : [],
    removedScopeKeys.size
      ? db.positionOrgScope.findMany({
        where: { OR: [{ companyId: { in: ids.company } }, { businessUnitId: { in: ids.businessUnit } }, { sectorId: { in: ids.sector } }, { areaId: { in: ids.area } }] },
        select: { positionId: true, position: { select: { code: true, name: true, _count: { select: { orgScopes: true } } } } },
      })
      : [],
    ids.company.length ? db.user.findMany({ where: { companyId: { in: ids.company } }, select: { id: true, name: true, email: true } }) : [],
    ids.establishment.length ? db.clockDevice.findMany({ where: { establishmentId: { in: ids.establishment } }, select: { id: true, name: true } }) : [],
    findCostCenterLinks(db, ids),
  ]);

  const builder = new DeletionPlanBuilder();
  // Estructura: raíz y sus hijos propios, por destino.
  for (const level of [...ORG_LEVELS, ...LOCATION_LEVELS, "costCenter"] as Kind[]) {
    const nodes = byKind.get(level) ?? [];
    const [, plural] = kindLabels[level];
    builder.add(`${level}.delete`, "DELETE", `${plural} que se eliminan`, "Se borran definitivamente: no tienen historia que conservar.", nodes.filter((node) => fates.get(node.id) === "DELETE").map(item));
    builder.add(`${level}.archive`, "ARCHIVE", `${plural} que se archivan`, "Salen de catálogos, selectores y filtros, pero se conservan porque la historia los referencia (períodos laborales, ubicaciones pasadas, alcances históricos o reglas).", nodes.filter((node) => fates.get(node.id) === "ARCHIVE").map(item));
  }
  // Ubicaciones de trabajo de legajos.
  const locationItem = (entry: (typeof workLocations)[number]) => ({ id: entry.row.id, name: `${entry.employeeName} · ${entry.row.zone.name}` });
  builder.add("workLocation.end", "END", "Ubicaciones de trabajo que terminan ayer", "Regían antes de hoy y no les queda ningún establecimiento: se cierran el día anterior. La persona queda pendiente de recarga si no tiene otra ubicación.", workLocations.filter((entry) => entry.plan.kind === "CLOSE" && !entry.plan.next.length).map(locationItem), { affectsPeople: true });
  builder.add("workLocation.narrow", "UNLINK", "Ubicaciones de trabajo que siguen sin lo eliminado", "Se cierran ayer y continúan desde hoy (o se corrigen, si todavía no rigen) con los establecimientos y unidades que quedan. Nunca se amplían a un establecimiento completo.", workLocations.filter((entry) => entry.plan.kind === "NARROW" || (entry.plan.kind === "CLOSE" && entry.plan.next.length > 0)).map(locationItem), { affectsPeople: true });
  builder.add("workLocation.cancel", "DELETE", "Ubicaciones de trabajo futuras que se cancelan", "Todavía no rigen y no les queda ningún establecimiento: se cancelan con historial y auditoría.", workLocations.filter((entry) => entry.plan.kind === "CANCEL").map(locationItem), { affectsPeople: true });
  // Datos laborales de legajos.
  builder.add("employee.employer", "END", "Legajos que dejan de tener esta empresa empleadora desde hoy", "Se registra el cambio desde hoy en la historia laboral. Quien se queda sin empresa empleadora queda pendiente de recarga.", employers.map((row) => ({ id: row.employeeId, name: `${formatEmployeeReference(row.employee)}${row.employee.companies.length === 1 ? " (queda sin empresa: recargar)" : ""}` })), { affectsPeople: true });
  builder.add("employee.costCenter", "END", "Legajos que quedan sin centro de costo desde hoy", "Se registra el cambio desde hoy en la historia laboral; el centro de costo debe recargarse.", costCenterEmployees.map((row) => ({ id: row.id, name: formatEmployeeReference(row) })), { affectsPeople: true });
  // Puestos que pierden nodos de su alcance.
  const positions = new Map<string, { name: string; removed: number; total: number }>();
  for (const row of scopeRows) {
    const entry = positions.get(row.positionId) ?? { name: `${row.position.code} · ${row.position.name}`, removed: 0, total: row.position._count.orgScopes };
    entry.removed += 1;
    positions.set(row.positionId, entry);
  }
  builder.add("position.scope", "UNLINK", "Puestos que pierden parte de su alcance desde hoy", "Se retira del alcance sólo lo eliminado, con historia por fecha; el resto del alcance no cambia.", [...positions.entries()].filter(([, entry]) => entry.removed < entry.total).map(([positionId, entry]) => ({ id: positionId, name: entry.name })), { affectsPeople: true });
  builder.add("position.scopeEmpty", "REVIEW", "Puestos que quedan sin alcance (pendientes de recarga)", "No se amplían: quedan sin alcance organizacional hasta que se les cargue uno nuevo.", [...positions.entries()].filter(([, entry]) => entry.removed >= entry.total).map(([positionId, entry]) => ({ id: positionId, name: entry.name })), { affectsPeople: true });
  // Referencias opcionales y vínculos compartidos.
  builder.add("user.company", "UNLINK", "Usuarios que dejan de tener esta empresa asignada", "Es un dato administrativo (no define permisos): se desvincula.", users.map((row) => ({ id: row.id, name: `${row.name} (${row.email})` })), { affectsPeople: true });
  builder.add("clockDevice.establishment", "UNLINK", "Dispositivos de fichada que quedan sin establecimiento", "Siguen funcionando; conviene volver a ubicarlos.", devices.map((row) => ({ id: row.id, name: row.name || "Dispositivo sin nombre" })));
  builder.add("costCenter.links", kind === "costCenter" ? "DELETE" : "UNLINK", kind === "costCenter" ? "Vínculos propios del centro de costo" : "Vínculos con centros de costo que se retiran", kind === "costCenter" ? "Configuración exclusiva del centro de costo: se borra con él." : "Se retira sólo el vínculo con lo eliminado; los centros de costo se conservan aunque queden sin vínculos.", costCenterLinks.items);
  // Reglas de horas especiales: nunca se amplían ni se recalculan.
  const keptRuleTargets = new Set([...ids.company, ...ids.sector, ...ids.costCenter].filter((nodeId) => fates.get(nodeId) !== "DELETE"));
  builder.add("doubleHourRule.review", "REVIEW", "Reglas de horas especiales para revisar", "Conservan su alcance (ahora archivado): no se amplían ni cambian sus resultados históricos y dejan de alcanzar a quien ya no pertenece a lo eliminado. Revisalas.", rules.filter((rule) => [rule.companyId, rule.sectorId, rule.costCenterId].some((value) => value && keptRuleTargets.has(value))).map((rule) => ({ id: rule.id, name: rule.name })));

  // Cierres protegidos: un cambio desde hoy no puede alcanzar un período enviado/aprobado.
  const laborAffected = [...employers.map((row) => row.employeeId), ...costCenterEmployees.map((row) => row.id)];
  const occupants = positions.size ? await db.employee.findMany({ where: { positionId: { in: [...positions.keys()] } }, select: { id: true } }) : [];
  const period = todayKey.slice(0, 7);
  const protectedPeriods = await findProtectedClosurePeriods(db, [...new Set([...laborAffected, ...occupants.map((row) => row.id)])].map((employeeId) => ({ employeeId, period })));
  if (protectedPeriods.size) {
    builder.block("DELETION_CLOSURE_PROTECTED", `Hay ${protectedPeriods.size} ${protectedPeriods.size === 1 ? "legajo" : "legajos"} con el período ${period} ya enviado o aprobado: el cambio desde hoy no se puede registrar hasta que se pida su corrección.`);
  }
  if (root.archivedAt) builder.block("ORG_STRUCTURE_ARCHIVED_RECORD", `${kindLabels[kind][0]} “${root.name}” ya está archivado.`);

  const preview = builder.build({ kind, id, code: root.code, name: root.name, label: kindLabels[kind][0] });
  return { preview, byKind, fates, ids, removedScopeKeys, positions: [...positions.keys()], employers, costCenterEmployees, users, devices };
}

async function findCostCenterLinks(db: Db, ids: Record<Kind, string[]>) {
  const any = (values: string[]) => values.length > 0;
  const own = ids.costCenter;
  const [companies, businessUnits, sectors, areas, establishments] = await Promise.all([
    any(own) || any(ids.company) ? db.costCenterCompany.findMany({ where: { OR: [{ costCenterId: { in: own } }, { companyId: { in: ids.company } }] }, select: { costCenterId: true, companyId: true, costCenter: { select: { name: true } }, company: { select: { name: true } } } }) : [],
    any(own) || any(ids.businessUnit) ? db.costCenterBusinessUnit.findMany({ where: { OR: [{ costCenterId: { in: own } }, { businessUnitId: { in: ids.businessUnit } }] }, select: { costCenterId: true, businessUnitId: true, costCenter: { select: { name: true } }, businessUnit: { select: { name: true } } } }) : [],
    any(own) || any(ids.sector) ? db.costCenterSector.findMany({ where: { OR: [{ costCenterId: { in: own } }, { sectorId: { in: ids.sector } }] }, select: { costCenterId: true, sectorId: true, costCenter: { select: { name: true } }, sector: { select: { name: true } } } }) : [],
    any(own) || any(ids.area) ? db.costCenterArea.findMany({ where: { OR: [{ costCenterId: { in: own } }, { areaId: { in: ids.area } }] }, select: { costCenterId: true, areaId: true, costCenter: { select: { name: true } }, area: { select: { name: true } } } }) : [],
    any(own) || any(ids.establishment) ? db.costCenterEstablishment.findMany({ where: { OR: [{ costCenterId: { in: own } }, { establishmentId: { in: ids.establishment } }] }, select: { costCenterId: true, establishmentId: true, costCenter: { select: { name: true } }, establishment: { select: { name: true } } } }) : [],
  ]);
  const items = [
    ...companies.map((row) => ({ id: `company:${row.costCenterId}:${row.companyId}`, name: `${row.costCenter.name} ↔ ${row.company.name}` })),
    ...businessUnits.map((row) => ({ id: `businessUnit:${row.costCenterId}:${row.businessUnitId}`, name: `${row.costCenter.name} ↔ ${row.businessUnit.name}` })),
    ...sectors.map((row) => ({ id: `sector:${row.costCenterId}:${row.sectorId}`, name: `${row.costCenter.name} ↔ ${row.sector.name}` })),
    ...areas.map((row) => ({ id: `area:${row.costCenterId}:${row.areaId}`, name: `${row.costCenter.name} ↔ ${row.area.name}` })),
    ...establishments.map((row) => ({ id: `establishment:${row.costCenterId}:${row.establishmentId}`, name: `${row.costCenter.name} ↔ ${row.establishment.name}` })),
  ];
  return { items };
}

async function deleteCostCenterLinksWithin(tx: Db, ids: Record<Kind, string[]>) {
  const own = ids.costCenter;
  await tx.costCenterCompany.deleteMany({ where: { OR: [{ costCenterId: { in: own } }, { companyId: { in: ids.company } }] } });
  await tx.costCenterBusinessUnit.deleteMany({ where: { OR: [{ costCenterId: { in: own } }, { businessUnitId: { in: ids.businessUnit } }] } });
  await tx.costCenterSector.deleteMany({ where: { OR: [{ costCenterId: { in: own } }, { sectorId: { in: ids.sector } }] } });
  await tx.costCenterArea.deleteMany({ where: { OR: [{ costCenterId: { in: own } }, { areaId: { in: ids.area } }] } });
  await tx.costCenterEstablishment.deleteMany({ where: { OR: [{ costCenterId: { in: own } }, { establishmentId: { in: ids.establishment } }] } });
}

/** Borra o archiva cada nodo, de las hojas a la raíz (las FKs nunca quedan colgando). */
async function applyStructureWithin(tx: Db, plan: Plan, archivedAt: Date) {
  const order: Kind[] = ["establishmentUnit", "establishment", "zone", "province", "area", "sector", "businessUnit", "company", "costCenter"];
  for (const kind of order) {
    for (const node of plan.byKind.get(kind) ?? []) {
      const fate = plan.fates.get(node.id);
      if (fate === "KEEP_ARCHIVED") continue;
      const archive = fate === "ARCHIVE";
      const where = { id: node.id };
      if (kind === "establishmentUnit") await (archive ? tx.establishmentUnit.update({ where, data: { archivedAt } }) : tx.establishmentUnit.delete({ where }));
      // Forma de M2: un establecimiento, sector o área archivado no tiene padre nuevo.
      if (kind === "establishment") await (archive ? tx.establishment.update({ where, data: { archivedAt, zoneId: null } }) : tx.establishment.delete({ where }));
      if (kind === "zone") await (archive ? tx.zone.update({ where, data: { archivedAt } }) : tx.zone.delete({ where }));
      if (kind === "province") await (archive ? tx.province.update({ where, data: { archivedAt } }) : tx.province.delete({ where }));
      if (kind === "area") await (archive ? tx.area.update({ where, data: { archivedAt, sectorId: null } }) : tx.area.delete({ where }));
      if (kind === "sector") await (archive ? tx.sector.update({ where, data: { archivedAt, businessUnitId: null } }) : tx.sector.delete({ where }));
      if (kind === "businessUnit") await (archive ? tx.businessUnit.update({ where, data: { archivedAt } }) : tx.businessUnit.delete({ where }));
      if (kind === "company") await (archive ? tx.company.update({ where, data: { archivedAt } }) : tx.company.delete({ where }));
      if (kind === "costCenter") await (archive ? tx.costCenter.update({ where, data: { archivedAt } }) : tx.costCenter.delete({ where }));
    }
  }
}

const serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000, maxWait: 10_000 };

function mapExecutionError(error: unknown): never {
  mapLaborHistoryPersistenceError(error);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") throw new AppError("Otra operación modificó estos datos al mismo tiempo. Volvé a revisar la vista previa y confirmá de nuevo.", 409, "DELETION_CONCURRENT_CHANGE");
    if (error.code === "P2003") throw new AppError("Apareció una referencia nueva durante la eliminación. Volvé a revisar la vista previa.", 409, "DELETION_CONCURRENT_CHANGE");
  }
  throw error;
}

export const orgStructureDeletion = {
  async preview(kind: Kind, id: string): Promise<DeletionPreview> {
    const todayKey = todayArgentinaDateKey();
    return prisma.$transaction(async (tx) => (await buildPlan(tx, kind, id, todayKey)).preview, { timeout: 30_000, maxWait: 10_000 });
  },

  async execute(kind: Kind, id: string, confirmation: DeletionConfirmation, audit?: AuditContext) {
    const todayKey = todayArgentinaDateKey();
    const { article, noun, auditEntity } = orgEntityLabels[kind];
    let result: DeletionPreview;
    try {
      result = await prisma.$transaction(async (tx) => {
        await assertActorAuthorizedWithin(tx, audit?.userId, adminRoles);
        const plan = await buildPlan(tx, kind, id, todayKey);
        assertConfirmedPlan(plan.preview, confirmation);
        const context = { effectiveFrom: todayKey, todayKey, reason: `Eliminación ${article === "el" ? "del" : `de ${article}`} ${noun} “${plan.preview.target.name}”`, audit };
        // 1. Personas: desde hoy, con la historia de un cambio manual.
        await employeeWorkLocationsService.detachNodesWithin(tx, { zoneIds: plan.ids.zone, establishmentIds: plan.ids.establishment, unitIds: plan.ids.establishmentUnit }, context);
        for (const employeeId of new Set(plan.employers.map((row) => row.employeeId))) {
          await employeesService.detachLaborReferencesWithin(tx, employeeId, { companyIds: plan.ids.company }, context);
        }
        for (const row of plan.costCenterEmployees) {
          await employeesService.detachLaborReferencesWithin(tx, row.id, { costCenterId: id }, context);
        }
        for (const positionId of plan.positions) await positionsService.removeScopeNodesWithin(tx, positionId, plan.removedScopeKeys, context);
        // 2. Referencias opcionales y vínculos compartidos.
        if (plan.users.length) await tx.user.updateMany({ where: { id: { in: plan.users.map((row) => row.id) } }, data: { companyId: null } });
        if (plan.devices.length) await tx.clockDevice.updateMany({ where: { id: { in: plan.devices.map((row) => row.id) } }, data: { establishmentId: null } });
        await deleteCostCenterLinksWithin(tx, plan.ids);
        // 3. Estructura: eliminar o archivar, de las hojas a la raíz.
        await applyStructureWithin(tx, plan, new Date());
        const rootFate = plan.fates.get(id);
        await auditService.registerWithin(tx, {
          ...audit,
          action: rootFate === "DELETE" ? "DELETE" : "UPDATE",
          entity: auditEntity,
          entityId: id,
          description: `Se ${rootFate === "DELETE" ? "eliminó" : "archivó"} ${noun} ${plan.preview.target.code} - ${plan.preview.target.name} con sus dependencias: ${plan.preview.groups.map((group) => `${group.label}: ${group.count}`).join("; ")}.`,
          before: { target: plan.preview.target, groups: plan.preview.groups } as unknown as Prisma.InputJsonValue,
          after: { fate: rootFate, deletedAt: new Date().toISOString() } as Prisma.InputJsonValue,
        });
        return plan.preview;
      }, serializable);
    } catch (error) {
      mapExecutionError(error);
    }
    invalidateOverviewCache();
    invalidatePositionsCache();
    clearAuditDerivedCaches();
    return { done: true, target: result.target, groups: result.groups };
  },
};
