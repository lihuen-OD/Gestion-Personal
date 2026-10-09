import { Prisma, type RecordStatus } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import type { OrgDependencyKey, OrgEntityKind } from "./orgStructure.dependencies";
import type {
  CreateAreaInput,
  CreateBusinessUnitInput,
  CreateCompanyInput,
  CreateCostCenterInput,
  CreateEstablishmentInput,
  CreateSectorInput,
  CreateZoneInput,
  UpdateAreaInput,
  UpdateBusinessUnitInput,
  UpdateCompanyInput,
  UpdateCostCenterInput,
  UpdateEstablishmentInput,
  UpdateSectorInput,
  UpdateZoneInput,
} from "./orgStructure.schemas";

// ---------------------------------------------------------------------------
// Overview cache
// ---------------------------------------------------------------------------

const OVERVIEW_CACHE_TTL_MS = 60_000; // 60 segundos

type OrgOverview = Awaited<ReturnType<typeof fetchOverview>>;

interface OverviewCache {
  data: OrgOverview;
  expiresAt: number;
}

let overviewCache: OverviewCache | null = null;

// Catálogo completo explícito (docs/PERFORMANCE_STANDARDS.md §6, "fetch-all
// permitido"): la estructura es un vocabulario administrado a mano por RRHH
// que no crece con headcount ni con el tiempo. Sin tope, la respuesta es
// siempre el catálogo completo; está cacheada (overviewCache) e invalidada en
// cada escritura.
//
// Transición (ORG_LOCATION_REORGANIZATION.md): cada nodo trae su padre del
// modelo objetivo (businessUnitId del sector, sectorId del área, zoneId del
// establecimiento) y, hasta M2, también los padres del modelo anterior
// (areaId, establishmentId, companyId/businessUnitId del establecimiento) sólo
// para lectura. Un nodo sin padre del modelo objetivo es un registro LEGADO;
// para sectores, áreas y establecimientos, la clasificación legado/nuevo es
// además PERSISTENTE (`*.isLegacy`, A8-3): no se deriva del padre actual.
function fetchOverview() {
  return Promise.all([
    prisma.company.findMany({
      // A8 §12.4: los listados/selectores del modelo nuevo excluyen archivados.
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, status: true },
    }),
    prisma.businessUnit.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, status: true, companyId: true },
    }),
    prisma.establishment.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        zoneId: true,
        companyId: true,
        businessUnitId: true,
        province: true,
        department: true,
        city: true,
        street: true,
        streetNumber: true,
        postalCode: true,
      },
    }),
    prisma.area.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, status: true, sectorId: true, establishmentId: true },
    }),
    prisma.sector.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, status: true, businessUnitId: true, areaId: true, isLegacy: true },
    }),
    prisma.costCenter.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        companies: { select: { companyId: true } },
        businessUnits: { select: { businessUnitId: true } },
        establishments: { select: { establishmentId: true } },
        areas: { select: { areaId: true } },
        sectors: { select: { sectorId: true } },
      },
    }),
    prisma.zone.findMany({
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, status: true },
    }),
  ]);
}

async function getCachedOverview(): Promise<OrgOverview> {
  if (overviewCache && Date.now() < overviewCache.expiresAt) {
    return overviewCache.data;
  }
  const data = await fetchOverview();
  overviewCache = { data, expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS };
  return data;
}

export function invalidateOverviewCache(): void {
  overviewCache = null;
}

// ---------------------------------------------------------------------------
// Nodos de los árboles
// ---------------------------------------------------------------------------

type Tx = PrismaTransactionClient;

export type NodeKind = Exclude<OrgEntityKind, "costCenter">;

/** Estado de un registro leído dentro de la transacción de escritura. */
export interface OrgRecord {
  id: string;
  code: string;
  name: string;
  status: RecordStatus;
  /** Padre del modelo objetivo (null para empresas y zonas, o registro legado). */
  parentId: string | null;
  /** Registro del modelo anterior: clasificación persistida (`Sector`/`Area`/`Establishment.isLegacy`, A8-3); para el resto (nodos sin columna propia), false. */
  isLegacy: boolean;
  /** A8-1 (§12.1): archivado ⇔ `archivedAt IS NOT NULL`. Sólo lo escribe la limpieza; `null` en los modelos sin la columna (centros de costo, zonas). */
  archivedAt: Date | null;
  counts: Partial<Record<OrgDependencyKey, number>>;
}

export type CatalogRow = { id: string; code: string; name: string; status: RecordStatus };

export interface NodeInputs {
  company: [CreateCompanyInput, UpdateCompanyInput];
  businessUnit: [CreateBusinessUnitInput, UpdateBusinessUnitInput];
  sector: [CreateSectorInput, UpdateSectorInput];
  area: [CreateAreaInput, UpdateAreaInput];
  zone: [CreateZoneInput, UpdateZoneInput];
  establishment: [CreateEstablishmentInput, UpdateEstablishmentInput];
}

interface NodeOps<K extends NodeKind> {
  find: (tx: Tx, id: string) => Promise<OrgRecord | null>;
  create: (tx: Tx, data: NodeInputs[K][0]) => Promise<CatalogRow>;
  update: (tx: Tx, id: string, data: NodeInputs[K][1]) => Promise<CatalogRow>;
  remove: (tx: Tx, id: string) => Promise<unknown>;
}

const nodes: { [K in NodeKind]: NodeOps<K> } = {
  company: {
    find: async (tx, id) => {
      const row = await tx.company.findUnique({ where: { id }, select: { id: true, code: true, name: true, status: true, archivedAt: true, _count: { select: { businessUnits: true, establishments: true, employees: true, users: true, costCenterLinks: true, doubleHourRules: true, positionScopes: true, employerPeriodLinks: true, scopeHistoryNodes: true } } } });
      return row && { id: row.id, code: row.code, name: row.name, status: row.status, parentId: null, isLegacy: false, archivedAt: row.archivedAt, counts: { ...row._count, laborHistory: row._count.employerPeriodLinks, scopeHistory: row._count.scopeHistoryNodes } };
    },
    create: (tx, data) => tx.company.create({ data }),
    update: (tx, id, data) => tx.company.update({ where: { id }, data }),
    remove: (tx, id) => tx.company.delete({ where: { id } }),
  },
  businessUnit: {
    find: async (tx, id) => {
      const row = await tx.businessUnit.findUnique({ where: { id }, select: { id: true, code: true, name: true, status: true, companyId: true, archivedAt: true, _count: { select: { sectors: true, establishments: true, costCenterLinks: true, positionScopes: true, scopeHistoryNodes: true } } } });
      return row && { id: row.id, code: row.code, name: row.name, status: row.status, parentId: row.companyId, isLegacy: false, archivedAt: row.archivedAt, counts: { ...row._count, scopeHistory: row._count.scopeHistoryNodes } };
    },
    create: (tx, data) => tx.businessUnit.create({ data }),
    update: (tx, id, data) => tx.businessUnit.update({ where: { id }, data }),
    remove: (tx, id) => tx.businessUnit.delete({ where: { id } }),
  },
  sector: {
    find: async (tx, id) => {
      const row = await tx.sector.findUnique({ where: { id }, select: { id: true, code: true, name: true, status: true, businessUnitId: true, isLegacy: true, archivedAt: true, _count: { select: { areas: true, positions: true, costCenterLinks: true, doubleHourRules: true, positionScopes: true, legacySectorPeriods: true, scopeHistoryNodes: true, scopeHistoryAreaParentOf: true } } } });
      return row && { id: row.id, code: row.code, name: row.name, status: row.status, parentId: row.businessUnitId, isLegacy: row.isLegacy, archivedAt: row.archivedAt, counts: { ...row._count, laborHistory: row._count.legacySectorPeriods, scopeHistory: row._count.scopeHistoryNodes + row._count.scopeHistoryAreaParentOf } };
    },
    // A8-3: el alta clasifica explícitamente con el criterio previo (sector sin
    // padre del modelo objetivo = legado); la clasificación no es un default y
    // tampoco es un campo de entrada: no puede cambiarla una edición común.
    create: (tx, data) => tx.sector.create({ data: { ...data, isLegacy: !data.businessUnitId } }),
    update: (tx, id, data) => tx.sector.update({ where: { id }, data: { ...data, isLegacy: undefined } }),
    remove: (tx, id) => tx.sector.delete({ where: { id } }),
  },
  area: {
    find: async (tx, id) => {
      const row = await tx.area.findUnique({ where: { id }, select: { id: true, code: true, name: true, status: true, sectorId: true, isLegacy: true, archivedAt: true, _count: { select: { sectors: true, costCenterLinks: true, positionScopes: true, scopeHistoryNodes: true } } } });
      return row && { id: row.id, code: row.code, name: row.name, status: row.status, parentId: row.sectorId, isLegacy: row.isLegacy, archivedAt: row.archivedAt, counts: { ...row._count, scopeHistory: row._count.scopeHistoryNodes } };
    },
    // A8-3 extensión: como en Sector, el alta clasifica con el criterio previo
    // (área sin sector del modelo objetivo = legado) y la edición no recibe el
    // campo: la clasificación no se cambia después del alta.
    create: (tx, data) => tx.area.create({ data: { ...data, isLegacy: !data.sectorId } }),
    update: (tx, id, data) => tx.area.update({ where: { id }, data: { ...data, isLegacy: undefined } }),
    remove: (tx, id) => tx.area.delete({ where: { id } }),
  },
  zone: {
    find: async (tx, id) => {
      const row = await tx.zone.findUnique({ where: { id }, select: { id: true, code: true, name: true, status: true, _count: { select: { establishments: true } } } });
      // La Zona no está en DELETE_ORDER: no tiene columna de archivo.
      return row && { id: row.id, code: row.code, name: row.name, status: row.status, parentId: null, isLegacy: false, archivedAt: null, counts: row._count };
    },
    create: (tx, data) => tx.zone.create({ data }),
    update: (tx, id, data) => tx.zone.update({ where: { id }, data }),
    remove: (tx, id) => tx.zone.delete({ where: { id } }),
  },
  establishment: {
    find: async (tx, id) => {
      const row = await tx.establishment.findUnique({ where: { id }, select: { id: true, code: true, name: true, status: true, zoneId: true, isLegacy: true, archivedAt: true, _count: { select: { areas: true, costCenterLinks: true, workLocations: true, clockDevices: true } } } });
      return row && { id: row.id, code: row.code, name: row.name, status: row.status, parentId: row.zoneId, isLegacy: row.isLegacy, archivedAt: row.archivedAt, counts: row._count };
    },
    // Ver comentario de `area.create`: alta con criterio previo (sin zona del
    // modelo objetivo = legado), edición sin el campo.
    create: (tx, data) => tx.establishment.create({ data: { ...data, isLegacy: !data.zoneId } }),
    update: (tx, id, data) => tx.establishment.update({ where: { id }, data: { ...data, isLegacy: undefined } }),
    remove: (tx, id) => tx.establishment.delete({ where: { id } }),
  },
};

const costCenterOps = {
  find: async (tx: Tx, id: string): Promise<OrgRecord | null> => {
    const row = await tx.costCenter.findUnique({ where: { id }, select: { id: true, code: true, name: true, status: true, _count: { select: { employees: true, doubleHourRules: true, employeePeriods: true } } } });
    return row && { id: row.id, code: row.code, name: row.name, status: row.status, parentId: null, isLegacy: false, archivedAt: null, counts: { ...row._count, laborHistory: row._count.employeePeriods } };
  },
  // Sus vínculos propios se borran explícitamente antes que él (no se depende
  // del ON DELETE CASCADE de la base) — ver orgStructure.dependencies.ts.
  remove: async (tx: Tx, id: string) => {
    await tx.costCenterCompany.deleteMany({ where: { costCenterId: id } });
    await tx.costCenterBusinessUnit.deleteMany({ where: { costCenterId: id } });
    await tx.costCenterEstablishment.deleteMany({ where: { costCenterId: id } });
    await tx.costCenterArea.deleteMany({ where: { costCenterId: id } });
    await tx.costCenterSector.deleteMany({ where: { costCenterId: id } });
    return tx.costCenter.delete({ where: { id } });
  },
};

function findAny(tx: Tx, kind: OrgEntityKind, id: string) {
  return kind === "costCenter" ? costCenterOps.find(tx, id) : nodes[kind].find(tx, id);
}

function removeAny(tx: Tx, kind: OrgEntityKind, id: string) {
  return kind === "costCenter" ? costCenterOps.remove(tx, id) : nodes[kind].remove(tx, id);
}

export interface CostCenterLinks {
  companyIds: string[];
  businessUnitIds: string[];
  establishmentIds: string[];
  areaIds: string[];
  sectorIds: string[];
}

function costCenterData(input: CreateCostCenterInput | UpdateCostCenterInput) {
  const { companyIds: _companyIds, businessUnitIds: _businessUnitIds, establishmentIds: _establishmentIds, areaIds: _areaIds, sectorIds: _sectorIds, ...data } = input;
  return data;
}

async function replaceCostCenterLinks(tx: Tx, id: string, input: Partial<CostCenterLinks>) {
  if (input.companyIds !== undefined) {
    await tx.costCenterCompany.deleteMany({ where: { costCenterId: id } });
    if (input.companyIds.length) await tx.costCenterCompany.createMany({ data: input.companyIds.map((companyId) => ({ costCenterId: id, companyId })), skipDuplicates: true });
  }
  if (input.businessUnitIds !== undefined) {
    await tx.costCenterBusinessUnit.deleteMany({ where: { costCenterId: id } });
    if (input.businessUnitIds.length) await tx.costCenterBusinessUnit.createMany({ data: input.businessUnitIds.map((businessUnitId) => ({ costCenterId: id, businessUnitId })), skipDuplicates: true });
  }
  if (input.establishmentIds !== undefined) {
    await tx.costCenterEstablishment.deleteMany({ where: { costCenterId: id } });
    if (input.establishmentIds.length) await tx.costCenterEstablishment.createMany({ data: input.establishmentIds.map((establishmentId) => ({ costCenterId: id, establishmentId })), skipDuplicates: true });
  }
  if (input.areaIds !== undefined) {
    await tx.costCenterArea.deleteMany({ where: { costCenterId: id } });
    if (input.areaIds.length) await tx.costCenterArea.createMany({ data: input.areaIds.map((areaId) => ({ costCenterId: id, areaId })), skipDuplicates: true });
  }
  if (input.sectorIds !== undefined) {
    await tx.costCenterSector.deleteMany({ where: { costCenterId: id } });
    if (input.sectorIds.length) await tx.costCenterSector.createMany({ data: input.sectorIds.map((sectorId) => ({ costCenterId: id, sectorId })), skipDuplicates: true });
  }
}

export type DeleteIfUnusedResult =
  | { status: "NOT_FOUND" }
  | { status: "BLOCKED"; record: OrgRecord }
  | { status: "DELETED"; record: OrgRecord };

const serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };

export const orgStructureRepository = {
  /**
   * Toda escritura de la estructura corre en una transacción Serializable que
   * incluye validaciones, cambio y auditoría (ORG_LOCATION_REORGANIZATION.md
   * §3.5): si otra transacción cambia el árbol en medio, una de las dos aborta
   * (P2034) en vez de dejar un estado inconsistente.
   */
  transaction<T>(operation: (tx: Tx) => Promise<T>): Promise<T> {
    return prisma.$transaction(operation, serializable);
  },

  findNode(tx: Tx, kind: NodeKind, id: string) {
    return nodes[kind].find(tx, id);
  },

  createNode<K extends NodeKind>(tx: Tx, kind: K, data: NodeInputs[K][0]) {
    return nodes[kind].create(tx, data);
  },

  updateNode<K extends NodeKind>(tx: Tx, kind: K, id: string, data: NodeInputs[K][1]) {
    return nodes[kind].update(tx, id, data);
  },

  /**
   * Hasta M2, `Establishment` conserva la unicidad legada `(companyId, code)`,
   * que no protege a los establecimientos nuevos (companyId NULL). En el
   * modelo objetivo el código es único entre establecimientos con zona.
   */
  // A8 §12.8: el lookup de unicidad de servicio recibe la ZONA, busca por
  // (zoneId, code) y excluye archivados — un archivado ocupa su código en su
  // población, pero no bloquea un alta nueva del modelo objetivo.
  findZonedEstablishmentByCode(tx: Tx, zoneId: string, code: string, excludeId?: string) {
    return tx.establishment.findFirst({
      where: { zoneId, code, archivedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
  },

  /**
   * Borra sólo si ninguna dependencia existe. Serializable: si otra
   * transacción agrega un hijo/empleado entre el conteo y el delete, una de
   * las dos aborta (P2034) en vez de dejar un registro huérfano. `onDeleted`
   * corre dentro de la misma transacción (auditoría).
   */
  deleteIfUnused(
    kind: OrgEntityKind,
    id: string,
    isBlocked: (record: OrgRecord) => boolean,
    onDeleted: (tx: Tx, record: OrgRecord) => Promise<unknown>,
  ): Promise<DeleteIfUnusedResult> {
    return prisma.$transaction(async (tx) => {
      const record = await findAny(tx, kind, id);
      if (!record) return { status: "NOT_FOUND" as const };
      if (isBlocked(record)) return { status: "BLOCKED" as const, record };
      await removeAny(tx, kind, id);
      await onDeleted(tx, record);
      return { status: "DELETED" as const, record };
    }, serializable);
  },

  getOverview() {
    return getCachedOverview();
  },

  async findCostCenterLinks(tx: Tx, id: string): Promise<CostCenterLinks | null> {
    const row = await tx.costCenter.findUnique({
      where: { id },
      select: {
        companies: { select: { companyId: true } },
        businessUnits: { select: { businessUnitId: true } },
        establishments: { select: { establishmentId: true } },
        areas: { select: { areaId: true } },
        sectors: { select: { sectorId: true } },
      },
    });
    return row && {
      companyIds: row.companies.map((link) => link.companyId),
      businessUnitIds: row.businessUnits.map((link) => link.businessUnitId),
      establishmentIds: row.establishments.map((link) => link.establishmentId),
      areaIds: row.areas.map((link) => link.areaId),
      sectorIds: row.sectors.map((link) => link.sectorId),
    };
  },

  /** Nombres de registros ARCHIVADOS entre los IDs dados (§12.4: toda familia con `archivedAt`). */
  async findArchivedNames(tx: Tx, ids: { companyIds: string[]; businessUnitIds: string[]; sectorIds: string[]; areaIds: string[]; establishmentIds: string[] }) {
    const [companies, businessUnits, sectors, areas, establishments] = await Promise.all([
      ids.companyIds.length ? tx.company.findMany({ where: { id: { in: ids.companyIds }, archivedAt: { not: null } }, select: { name: true } }) : [],
      ids.businessUnitIds.length ? tx.businessUnit.findMany({ where: { id: { in: ids.businessUnitIds }, archivedAt: { not: null } }, select: { name: true } }) : [],
      ids.sectorIds.length ? tx.sector.findMany({ where: { id: { in: ids.sectorIds }, archivedAt: { not: null } }, select: { name: true } }) : [],
      ids.areaIds.length ? tx.area.findMany({ where: { id: { in: ids.areaIds }, archivedAt: { not: null } }, select: { name: true } }) : [],
      ids.establishmentIds.length ? tx.establishment.findMany({ where: { id: { in: ids.establishmentIds }, archivedAt: { not: null } }, select: { name: true } }) : [],
    ]);
    return [...companies, ...businessUnits, ...sectors, ...areas, ...establishments].map((row) => row.name);
  },

  /** Nombres de sectores/áreas/establecimientos del modelo anterior entre los IDs dados. */
  async findLegacyNames(tx: Tx, ids: { sectorIds: string[]; areaIds: string[]; establishmentIds: string[] }) {
    const [sectors, areas, establishments] = await Promise.all([
      ids.sectorIds.length ? tx.sector.findMany({ where: { id: { in: ids.sectorIds }, isLegacy: true }, select: { name: true } }) : [],
      ids.areaIds.length ? tx.area.findMany({ where: { id: { in: ids.areaIds }, isLegacy: true }, select: { name: true } }) : [],
      ids.establishmentIds.length ? tx.establishment.findMany({ where: { id: { in: ids.establishmentIds }, isLegacy: true }, select: { name: true } }) : [],
    ]);
    return [...sectors, ...areas, ...establishments].map((row) => row.name);
  },

  async createCostCenter(tx: Tx, input: CreateCostCenterInput) {
    const item = await tx.costCenter.create({ data: { code: input.code, name: input.name, status: input.status } });
    await replaceCostCenterLinks(tx, item.id, input);
    return item;
  },

  async updateCostCenter(tx: Tx, id: string, input: UpdateCostCenterInput) {
    const item = await tx.costCenter.update({ where: { id }, data: costCenterData(input) });
    await replaceCostCenterLinks(tx, id, input);
    return item;
  },
};
