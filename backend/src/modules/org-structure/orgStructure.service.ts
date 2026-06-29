import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { orgStructureRepository } from "./orgStructure.repository";
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

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new AppError("A record with the same unique value already exists", 409, "UNIQUE_CONSTRAINT");
    }
    if (error.code === "P2025") {
      throw new AppError("Record not found", 404, "RECORD_NOT_FOUND");
    }
    if (error.code === "P2003") {
      throw new AppError("Related record not found or cannot be used", 400, "RELATION_CONSTRAINT");
    }
  }
  throw error;
}

async function execute<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    mapPrismaError(error);
    throw error;
  }
}

async function auditCatalogChange<T extends { id: string; code?: string; name?: string }>(
  action: "CREATE" | "UPDATE",
  entity: string,
  item: T,
  audit?: AuditContext,
) {
  await auditService.register({
    ...audit,
    action,
    entity,
    entityId: item.id,
    description: `${action === "CREATE" ? "Se creo" : "Se actualizo"} ${entity} ${item.code || item.name || item.id}.`,
    after: item as Prisma.InputJsonValue,
  });
}

export const orgStructureService = {
  async getOverview() {
    const [companies, businessUnits, establishments, areas, sectors, costCenters] =
      await orgStructureRepository.getOverview();

    return { companies, businessUnits, establishments, areas, sectors, costCenters };
  },

  async createCompany(data: CreateCompanyInput, audit?: AuditContext) {
    const item = await execute(() => orgStructureRepository.createCompany(data));
    await auditCatalogChange("CREATE", "Company", item, audit);
    return item;
  },
  async updateCompany(id: string, data: UpdateCompanyInput, audit?: AuditContext) {
    const item = await execute(() => orgStructureRepository.updateCompany(id, data));
    await auditCatalogChange("UPDATE", "Company", item, audit);
    return item;
  },

  async createBusinessUnit(data: CreateBusinessUnitInput, audit?: AuditContext) {
    const item = await execute(() => orgStructureRepository.createBusinessUnit(data));
    await auditCatalogChange("CREATE", "BusinessUnit", item, audit);
    return item;
  },
  async updateBusinessUnit(id: string, data: UpdateBusinessUnitInput, audit?: AuditContext) {
    const item = await execute(() => orgStructureRepository.updateBusinessUnit(id, data));
    await auditCatalogChange("UPDATE", "BusinessUnit", item, audit);
    return item;
  },

  async createEstablishment(data: CreateEstablishmentInput, audit?: AuditContext) {
    const item = await execute(() => orgStructureRepository.createEstablishment(data));
    await auditCatalogChange("CREATE", "Establishment", item, audit);
    return item;
  },
  async updateEstablishment(id: string, data: UpdateEstablishmentInput, audit?: AuditContext) {
    const item = await execute(() => orgStructureRepository.updateEstablishment(id, data));
    await auditCatalogChange("UPDATE", "Establishment", item, audit);
    return item;
  },

  async createArea(data: CreateAreaInput, audit?: AuditContext) {
    const item = await execute(() => orgStructureRepository.createArea(data));
    await auditCatalogChange("CREATE", "Area", item, audit);
    return item;
  },
  async updateArea(id: string, data: UpdateAreaInput, audit?: AuditContext) {
    const item = await execute(() => orgStructureRepository.updateArea(id, data));
    await auditCatalogChange("UPDATE", "Area", item, audit);
    return item;
  },

  async createSector(data: CreateSectorInput, audit?: AuditContext) {
    const item = await execute(() => orgStructureRepository.createSector(data));
    await auditCatalogChange("CREATE", "Sector", item, audit);
    return item;
  },
  async updateSector(id: string, data: UpdateSectorInput, audit?: AuditContext) {
    const item = await execute(() => orgStructureRepository.updateSector(id, data));
    await auditCatalogChange("UPDATE", "Sector", item, audit);
    return item;
  },

  async createCostCenter(data: CreateCostCenterInput, audit?: AuditContext) {
    const item = await execute(() => orgStructureRepository.createCostCenter(data));
    await auditCatalogChange("CREATE", "CostCenter", item, audit);
    return item;
  },
  async updateCostCenter(id: string, data: UpdateCostCenterInput, audit?: AuditContext) {
    const item = await execute(() => orgStructureRepository.updateCostCenter(id, data));
    await auditCatalogChange("UPDATE", "CostCenter", item, audit);
    return item;
  },
};
