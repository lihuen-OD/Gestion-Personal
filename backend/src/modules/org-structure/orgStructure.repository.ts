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
    prisma.company.findMany({ take: 500, orderBy: { name: "asc" }, include: { businessUnits: true, establishments: true } }),
    prisma.businessUnit.findMany({ take: 500, orderBy: { name: "asc" }, include: { company: true, companies: true } }),
    prisma.establishment.findMany({ take: 500, orderBy: { name: "asc" }, include: { company: true, businessUnit: true, companies: true, businessUnits: true } }),
    prisma.area.findMany({ take: 500, orderBy: { name: "asc" }, include: { establishment: true, businessUnits: true, establishments: true } }),
    prisma.sector.findMany({ take: 500, orderBy: { name: "asc" }, include: { area: true, areas: true, establishments: true } }),
    prisma.costCenter.findMany({ take: 500, orderBy: { code: "asc" }, include: { companies: true, businessUnits: true, establishments: true, areas: true, sectors: true } }),
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

const compactIds = (values: Array<string | null | undefined>) => Array.from(new Set(values.filter(Boolean))) as string[];
const requireId = (value: string | undefined, message: string) => {
  if (!value) throw new Error(message);
  return value;
};

function businessUnitData(input: UpdateBusinessUnitInput) {
  const { companyIds: _companyIds, ...data } = input;
  return data;
}

function establishmentData(input: UpdateEstablishmentInput) {
  const { companyIds: _companyIds, businessUnitIds: _businessUnitIds, ...data } = input;
  return data;
}

function areaData(input: UpdateAreaInput) {
  const { businessUnitIds: _businessUnitIds, establishmentIds: _establishmentIds, ...data } = input;
  return data;
}

function sectorData(input: UpdateSectorInput) {
  const { areaIds: _areaIds, establishmentIds: _establishmentIds, ...data } = input;
  return data;
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
    const companyIds = compactIds([input.companyId, ...(input.companyIds || [])]);
    const companyId = requireId(companyIds[0], "Business unit requires at least one company.");
    return prisma.$transaction(async (tx) => {
      const item = await tx.businessUnit.create({
        data: { code: input.code, name: input.name, status: input.status, company: { connect: { id: companyId } } },
      });
      if (companyIds.length) {
        await tx.businessUnitCompany.createMany({ data: companyIds.map((companyId) => ({ businessUnitId: item.id, companyId })), skipDuplicates: true });
      }
      return item;
    });
  },

  updateBusinessUnit(id: string, input: UpdateBusinessUnitInput) {
    const shouldReplaceCompanies = input.companyId !== undefined || input.companyIds !== undefined;
    const companyIds = compactIds([input.companyId, ...(input.companyIds || [])]);
    return prisma.$transaction(async (tx) => {
      const item = await tx.businessUnit.update({
        where: { id },
        data: { ...businessUnitData(input), ...(shouldReplaceCompanies && companyIds[0] ? { companyId: companyIds[0] } : {}) },
      });
      if (shouldReplaceCompanies) {
        await tx.businessUnitCompany.deleteMany({ where: { businessUnitId: id } });
        if (companyIds.length) await tx.businessUnitCompany.createMany({ data: companyIds.map((companyId) => ({ businessUnitId: id, companyId })), skipDuplicates: true });
      }
      return item;
    });
  },

  createEstablishment(input: CreateEstablishmentInput) {
    const companyIds = compactIds([input.companyId, ...(input.companyIds || [])]);
    const businessUnitIds = compactIds([input.businessUnitId, ...(input.businessUnitIds || [])]);
    const companyId = requireId(companyIds[0], "Establishment requires at least one company.");
    return prisma.$transaction(async (tx) => {
      const item = await tx.establishment.create({
        data: {
          code: input.code,
          name: input.name,
          status: input.status,
          province: input.province,
          department: input.department,
          city: input.city,
          street: input.street,
          streetNumber: input.streetNumber,
          postalCode: input.postalCode,
          company: { connect: { id: companyId } },
          ...(businessUnitIds[0] ? { businessUnit: { connect: { id: businessUnitIds[0] } } } : {}),
        },
      });
      if (companyIds.length) await tx.establishmentCompany.createMany({ data: companyIds.map((companyId) => ({ establishmentId: item.id, companyId })), skipDuplicates: true });
      if (businessUnitIds.length) await tx.establishmentBusinessUnit.createMany({ data: businessUnitIds.map((businessUnitId) => ({ establishmentId: item.id, businessUnitId })), skipDuplicates: true });
      return item;
    });
  },

  updateEstablishment(id: string, input: UpdateEstablishmentInput) {
    const shouldReplaceCompanies = input.companyId !== undefined || input.companyIds !== undefined;
    const shouldReplaceUnits = input.businessUnitId !== undefined || input.businessUnitIds !== undefined;
    const companyIds = compactIds([input.companyId, ...(input.companyIds || [])]);
    const businessUnitIds = compactIds([input.businessUnitId, ...(input.businessUnitIds || [])]);
    return prisma.$transaction(async (tx) => {
      const item = await tx.establishment.update({
        where: { id },
        data: {
          ...establishmentData(input),
          ...(shouldReplaceCompanies && companyIds[0] ? { companyId: companyIds[0] } : {}),
          ...(shouldReplaceUnits ? { businessUnitId: businessUnitIds[0] || null } : {}),
        },
      });
      if (shouldReplaceCompanies) {
        await tx.establishmentCompany.deleteMany({ where: { establishmentId: id } });
        if (companyIds.length) await tx.establishmentCompany.createMany({ data: companyIds.map((companyId) => ({ establishmentId: id, companyId })), skipDuplicates: true });
      }
      if (shouldReplaceUnits) {
        await tx.establishmentBusinessUnit.deleteMany({ where: { establishmentId: id } });
        if (businessUnitIds.length) await tx.establishmentBusinessUnit.createMany({ data: businessUnitIds.map((businessUnitId) => ({ establishmentId: id, businessUnitId })), skipDuplicates: true });
      }
      return item;
    });
  },

  createArea(input: CreateAreaInput) {
    const businessUnitIds = compactIds(input.businessUnitIds || []);
    const establishmentIds = compactIds([input.establishmentId, ...(input.establishmentIds || [])]);
    return prisma.$transaction(async (tx) => {
      const item = await tx.area.create({
        data: { code: input.code, name: input.name, status: input.status, establishmentId: establishmentIds[0] || null },
      });
      if (businessUnitIds.length) await tx.areaBusinessUnit.createMany({ data: businessUnitIds.map((businessUnitId) => ({ areaId: item.id, businessUnitId })), skipDuplicates: true });
      if (establishmentIds.length) await tx.areaEstablishment.createMany({ data: establishmentIds.map((establishmentId) => ({ areaId: item.id, establishmentId })), skipDuplicates: true });
      return item;
    });
  },

  updateArea(id: string, input: UpdateAreaInput) {
    const shouldReplaceUnits = input.businessUnitIds !== undefined;
    const shouldReplaceEstablishments = input.establishmentId !== undefined || input.establishmentIds !== undefined;
    const businessUnitIds = compactIds(input.businessUnitIds || []);
    const establishmentIds = compactIds([input.establishmentId, ...(input.establishmentIds || [])]);
    return prisma.$transaction(async (tx) => {
      const item = await tx.area.update({
        where: { id },
        data: { ...areaData(input), ...(shouldReplaceEstablishments ? { establishmentId: establishmentIds[0] || null } : {}) },
      });
      if (shouldReplaceUnits) {
        await tx.areaBusinessUnit.deleteMany({ where: { areaId: id } });
        if (businessUnitIds.length) await tx.areaBusinessUnit.createMany({ data: businessUnitIds.map((businessUnitId) => ({ areaId: id, businessUnitId })), skipDuplicates: true });
      }
      if (shouldReplaceEstablishments) {
        await tx.areaEstablishment.deleteMany({ where: { areaId: id } });
        if (establishmentIds.length) await tx.areaEstablishment.createMany({ data: establishmentIds.map((establishmentId) => ({ areaId: id, establishmentId })), skipDuplicates: true });
      }
      return item;
    });
  },

  createSector(input: CreateSectorInput) {
    const areaIds = compactIds([input.areaId, ...(input.areaIds || [])]);
    const establishmentIds = compactIds(input.establishmentIds || []);
    return prisma.$transaction(async (tx) => {
      const item = await tx.sector.create({
        data: { code: input.code, name: input.name, status: input.status, areaId: areaIds[0] || null },
      });
      if (areaIds.length) await tx.sectorArea.createMany({ data: areaIds.map((areaId) => ({ sectorId: item.id, areaId })), skipDuplicates: true });
      if (establishmentIds.length) await tx.sectorEstablishment.createMany({ data: establishmentIds.map((establishmentId) => ({ sectorId: item.id, establishmentId })), skipDuplicates: true });
      return item;
    });
  },

  updateSector(id: string, input: UpdateSectorInput) {
    const shouldReplaceAreas = input.areaId !== undefined || input.areaIds !== undefined;
    const shouldReplaceEstablishments = input.establishmentIds !== undefined;
    const areaIds = compactIds([input.areaId, ...(input.areaIds || [])]);
    const establishmentIds = compactIds(input.establishmentIds || []);
    return prisma.$transaction(async (tx) => {
      const item = await tx.sector.update({
        where: { id },
        data: { ...sectorData(input), ...(shouldReplaceAreas ? { areaId: areaIds[0] || null } : {}) },
      });
      if (shouldReplaceAreas) {
        await tx.sectorArea.deleteMany({ where: { sectorId: id } });
        if (areaIds.length) await tx.sectorArea.createMany({ data: areaIds.map((areaId) => ({ sectorId: id, areaId })), skipDuplicates: true });
      }
      if (shouldReplaceEstablishments) {
        await tx.sectorEstablishment.deleteMany({ where: { sectorId: id } });
        if (establishmentIds.length) await tx.sectorEstablishment.createMany({ data: establishmentIds.map((establishmentId) => ({ sectorId: id, establishmentId })), skipDuplicates: true });
      }
      return item;
    });
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
