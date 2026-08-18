import { prisma } from "../../shared/prisma/client";
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

function fetchOverview() {
  return Promise.all([
    prisma.company.findMany({
      take: 500,
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, status: true },
    }),
    prisma.businessUnit.findMany({
      take: 500,
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
      take: 500,
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
      take: 500,
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
      take: 500,
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
      take: 500,
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

export const orgStructureRepository = {
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
