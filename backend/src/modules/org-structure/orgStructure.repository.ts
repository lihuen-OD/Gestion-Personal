import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { OrgDependencyKey, OrgEntityKind } from "./orgStructure.dependencies";
import type {
  CreateAreaInput,
  CreateBusinessUnitInput,
  CreateCompanyInput,
  CreateCostCenterInput,
  CreateEstablishmentInput,
  CreateSectorInput,
  UpdateAreaInput,
  UpdateBusinessUnitInput,
  UpdateCompanyInput,
  UpdateCostCenterInput,
  UpdateEstablishmentInput,
  UpdateSectorInput,
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
// permitido"): la estructura organizacional es un vocabulario administrado a
// mano por RRHH que no crece con headcount ni con el tiempo (volumen real
// confirmado: 6 empresas, 12 unidades, 16 establecimientos, 34 áreas, 15
// sectores, 2 centros de costo). Antes cada entidad tenía `take: 500` sin
// señal de corte: con la 501ª fila, selects, filtros, legajos y el
// organigrama la perdían en silencio. Sin tope, la respuesta es siempre el
// catálogo completo; está cacheada (overviewCache) e invalidada en cada
// escritura.
function fetchOverview() {
  return Promise.all([
    prisma.company.findMany({
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, status: true },
    }),
    prisma.businessUnit.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        companyId: true,
      },
    }),
    prisma.establishment.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
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
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        establishmentId: true,
      },
    }),
    prisma.sector.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        areaId: true,
      },
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

function costCenterData(input: CreateCostCenterInput | UpdateCostCenterInput) {
  const { companyIds: _companyIds, businessUnitIds: _businessUnitIds, establishmentIds: _establishmentIds, areaIds: _areaIds, sectorIds: _sectorIds, ...data } = input;
  return data;
}

// El cliente de este proyecto está extendido (métricas), así que su `tx` no es
// Prisma.TransactionClient: se deriva del callback real de `prisma.$transaction`.
type TransactionCallback = Extract<Parameters<typeof prisma.$transaction>[0], (...args: never[]) => unknown>;
type Tx = Parameters<TransactionCallback>[0];
type DeletableRecord = { id: string; code: string; name: string; counts: Partial<Record<OrgDependencyKey, number>> };

// Lectura del registro + conteo de cada dependencia (ver orgStructure.dependencies.ts),
// y borrado — ambos dentro de la misma transacción.
const deletableEntities: Record<OrgEntityKind, { find: (tx: Tx, id: string) => Promise<DeletableRecord | null>; remove: (tx: Tx, id: string) => Promise<unknown> }> = {
  company: {
    find: async (tx, id) => {
      const row = await tx.company.findUnique({ where: { id }, select: { id: true, code: true, name: true, _count: { select: { businessUnits: true, establishments: true, employees: true, users: true, costCenterLinks: true, doubleHourRules: true } } } });
      return row && { id: row.id, code: row.code, name: row.name, counts: row._count };
    },
    remove: (tx, id) => tx.company.delete({ where: { id } }),
  },
  businessUnit: {
    find: async (tx, id) => {
      const row = await tx.businessUnit.findUnique({ where: { id }, select: { id: true, code: true, name: true, _count: { select: { establishments: true, costCenterLinks: true } } } });
      return row && { id: row.id, code: row.code, name: row.name, counts: row._count };
    },
    remove: (tx, id) => tx.businessUnit.delete({ where: { id } }),
  },
  establishment: {
    find: async (tx, id) => {
      const row = await tx.establishment.findUnique({ where: { id }, select: { id: true, code: true, name: true, _count: { select: { areas: true, costCenterLinks: true } } } });
      return row && { id: row.id, code: row.code, name: row.name, counts: row._count };
    },
    remove: (tx, id) => tx.establishment.delete({ where: { id } }),
  },
  area: {
    find: async (tx, id) => {
      const row = await tx.area.findUnique({ where: { id }, select: { id: true, code: true, name: true, _count: { select: { sectors: true, costCenterLinks: true } } } });
      return row && { id: row.id, code: row.code, name: row.name, counts: row._count };
    },
    remove: (tx, id) => tx.area.delete({ where: { id } }),
  },
  sector: {
    find: async (tx, id) => {
      const row = await tx.sector.findUnique({ where: { id }, select: { id: true, code: true, name: true, _count: { select: { employees: true, positions: true, users: true, costCenterLinks: true, doubleHourRules: true } } } });
      return row && { id: row.id, code: row.code, name: row.name, counts: row._count };
    },
    remove: (tx, id) => tx.sector.delete({ where: { id } }),
  },
  costCenter: {
    find: async (tx, id) => {
      const row = await tx.costCenter.findUnique({ where: { id }, select: { id: true, code: true, name: true, _count: { select: { employees: true, doubleHourRules: true } } } });
      return row && { id: row.id, code: row.code, name: row.name, counts: row._count };
    },
    // Sus vínculos CostCenter* (su propia ubicación) caen con él por FK CASCADE — ver orgStructure.dependencies.ts.
    remove: (tx, id) => tx.costCenter.delete({ where: { id } }),
  },
};

export type DeleteIfUnusedResult =
  | { status: "NOT_FOUND" }
  | { status: "BLOCKED"; record: DeletableRecord }
  | { status: "DELETED"; record: DeletableRecord };

export const orgStructureRepository = {
  /**
   * Borra sólo si ninguna dependencia existe. Serializable: si otra
   * transacción agrega un hijo/empleado entre el conteo y el delete, una de
   * las dos aborta (P2034) en vez de dejar un registro huérfano por el
   * ON DELETE SET NULL de la base.
   */
  deleteIfUnused(kind: OrgEntityKind, id: string, isBlocked: (record: DeletableRecord) => boolean): Promise<DeleteIfUnusedResult> {
    const entity = deletableEntities[kind];
    return prisma.$transaction(async (tx) => {
      const record = await entity.find(tx, id);
      if (!record) return { status: "NOT_FOUND" as const };
      if (isBlocked(record)) return { status: "BLOCKED" as const, record };
      await entity.remove(tx, id);
      return { status: "DELETED" as const, record };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },

  getOverview() {
    return getCachedOverview();
  },

  createCompany(data: CreateCompanyInput) {
    return prisma.company.create({ data });
  },

  updateCompany(id: string, data: UpdateCompanyInput) {
    return prisma.company.update({ where: { id }, data });
  },

  createBusinessUnit(input: CreateBusinessUnitInput) {
    return prisma.businessUnit.create({ data: input });
  },

  updateBusinessUnit(id: string, input: UpdateBusinessUnitInput) {
    return prisma.businessUnit.update({ where: { id }, data: input });
  },

  createEstablishment(input: CreateEstablishmentInput) {
    return prisma.establishment.create({ data: input });
  },

  updateEstablishment(id: string, input: UpdateEstablishmentInput) {
    return prisma.establishment.update({ where: { id }, data: input });
  },

  createArea(input: CreateAreaInput) {
    return prisma.area.create({ data: input });
  },

  updateArea(id: string, input: UpdateAreaInput) {
    return prisma.area.update({ where: { id }, data: input });
  },

  createSector(input: CreateSectorInput) {
    return prisma.sector.create({ data: input });
  },

  updateSector(id: string, input: UpdateSectorInput) {
    return prisma.sector.update({ where: { id }, data: input });
  },

  createCostCenter(input: CreateCostCenterInput) {
    return prisma.$transaction(async (tx) => {
      const item = await tx.costCenter.create({ data: { code: input.code, name: input.name, status: input.status } });
      if (input.companyIds.length) await tx.costCenterCompany.createMany({ data: input.companyIds.map((companyId) => ({ costCenterId: item.id, companyId })), skipDuplicates: true });
      if (input.businessUnitIds.length) await tx.costCenterBusinessUnit.createMany({ data: input.businessUnitIds.map((businessUnitId) => ({ costCenterId: item.id, businessUnitId })), skipDuplicates: true });
      if (input.establishmentIds.length) await tx.costCenterEstablishment.createMany({ data: input.establishmentIds.map((establishmentId) => ({ costCenterId: item.id, establishmentId })), skipDuplicates: true });
      if (input.areaIds.length) await tx.costCenterArea.createMany({ data: input.areaIds.map((areaId) => ({ costCenterId: item.id, areaId })), skipDuplicates: true });
      if (input.sectorIds.length) await tx.costCenterSector.createMany({ data: input.sectorIds.map((sectorId) => ({ costCenterId: item.id, sectorId })), skipDuplicates: true });
      return item;
    });
  },

  updateCostCenter(id: string, input: UpdateCostCenterInput) {
    return prisma.$transaction(async (tx) => {
      const item = await tx.costCenter.update({ where: { id }, data: costCenterData(input) });
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
      return item;
    });
  },
};
