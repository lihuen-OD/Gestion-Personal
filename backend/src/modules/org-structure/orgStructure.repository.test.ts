import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { orgStructureRepository, invalidateOverviewCache } from "./orgStructure.repository";

/**
 * Regresion de la simplificacion de jerarquia organizacional (2026-08-14):
 * BusinessUnit/Establishment/Area/Sector deben leer y escribir SOLO el FK
 * legado singular — sin doble-write ni lectura de las tablas M:N que se
 * eliminaron (BusinessUnitCompany, EstablishmentCompany,
 * EstablishmentBusinessUnit, AreaEstablishment, AreaBusinessUnit, SectorArea,
 * SectorEstablishment). CostCenter sigue usando sus tablas M:N sin cambios.
 */
vi.mock("../../shared/prisma/client", () => {
  const tx = {
    costCenter: { create: vi.fn(), update: vi.fn() },
    costCenterCompany: { createMany: vi.fn(), deleteMany: vi.fn() },
    costCenterBusinessUnit: { createMany: vi.fn(), deleteMany: vi.fn() },
    costCenterEstablishment: { createMany: vi.fn(), deleteMany: vi.fn() },
    costCenterArea: { createMany: vi.fn(), deleteMany: vi.fn() },
    costCenterSector: { createMany: vi.fn(), deleteMany: vi.fn() },
  };
  return {
    prisma: {
      company: { findMany: vi.fn() },
      businessUnit: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
      establishment: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
      area: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
      sector: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
      costCenter: { findMany: vi.fn() },
      $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      __tx: tx,
    },
  };
});

const mockedPrisma = prisma as unknown as {
  company: { findMany: Mock };
  businessUnit: { create: Mock; update: Mock; findMany: Mock };
  establishment: { create: Mock; update: Mock; findMany: Mock };
  area: { create: Mock; update: Mock; findMany: Mock };
  sector: { create: Mock; update: Mock; findMany: Mock };
  costCenter: { findMany: Mock };
};

beforeEach(() => {
  vi.clearAllMocks();
  invalidateOverviewCache();
});

describe("orgStructureRepository — BusinessUnit", () => {
  it("createBusinessUnit escribe solo companyId (FK), sin ninguna tabla M:N", async () => {
    mockedPrisma.businessUnit.create.mockResolvedValue({ id: "bu-1", companyId: "comp-1" });
    await orgStructureRepository.createBusinessUnit({ code: "UN-1", name: "Unidad 1", status: "ACTIVO", companyId: "comp-1" });
    expect(mockedPrisma.businessUnit.create).toHaveBeenCalledWith({
      data: { code: "UN-1", name: "Unidad 1", status: "ACTIVO", companyId: "comp-1" },
    });
  });

  it("updateBusinessUnit actualiza companyId directamente, sin doble-write", async () => {
    mockedPrisma.businessUnit.update.mockResolvedValue({ id: "bu-1", companyId: "comp-2" });
    await orgStructureRepository.updateBusinessUnit("bu-1", { companyId: "comp-2" });
    expect(mockedPrisma.businessUnit.update).toHaveBeenCalledWith({ where: { id: "bu-1" }, data: { companyId: "comp-2" } });
  });
});

describe("orgStructureRepository — Establishment", () => {
  it("createEstablishment escribe companyId y businessUnitId como FK simples", async () => {
    mockedPrisma.establishment.create.mockResolvedValue({ id: "est-1" });
    await orgStructureRepository.createEstablishment({
      code: "EST-1", name: "Establecimiento 1", status: "ACTIVO", companyId: "comp-1", businessUnitId: "bu-1",
    });
    expect(mockedPrisma.establishment.create).toHaveBeenCalledWith({
      data: { code: "EST-1", name: "Establecimiento 1", status: "ACTIVO", companyId: "comp-1", businessUnitId: "bu-1" },
    });
  });
});

describe("orgStructureRepository — Area", () => {
  it("createArea escribe solo establishmentId (FK), no hay campo de unidad de negocio", async () => {
    mockedPrisma.area.create.mockResolvedValue({ id: "area-1" });
    await orgStructureRepository.createArea({ code: "AREA-1", name: "Area 1", status: "ACTIVO", establishmentId: "est-1" });
    expect(mockedPrisma.area.create).toHaveBeenCalledWith({
      data: { code: "AREA-1", name: "Area 1", status: "ACTIVO", establishmentId: "est-1" },
    });
  });

  it("updateArea permite desasignar el establecimiento (null)", async () => {
    mockedPrisma.area.update.mockResolvedValue({ id: "area-1" });
    await orgStructureRepository.updateArea("area-1", { establishmentId: null });
    expect(mockedPrisma.area.update).toHaveBeenCalledWith({ where: { id: "area-1" }, data: { establishmentId: null } });
  });
});

describe("orgStructureRepository — Sector", () => {
  it("createSector escribe solo areaId (FK), no hay campo de establecimiento", async () => {
    mockedPrisma.sector.create.mockResolvedValue({ id: "sec-1" });
    await orgStructureRepository.createSector({ code: "SEC-1", name: "Sector 1", status: "ACTIVO", areaId: "area-1" });
    expect(mockedPrisma.sector.create).toHaveBeenCalledWith({
      data: { code: "SEC-1", name: "Sector 1", status: "ACTIVO", areaId: "area-1" },
    });
  });
});

describe("orgStructureRepository.getOverview", () => {
  it("devuelve datos coherentes: BusinessUnit/Establishment/Area/Sector solo con FK singular, CostCenter con sus arrays M:N", async () => {
    mockedPrisma.company.findMany.mockResolvedValue([{ id: "comp-1", code: "EMP-1", name: "Empresa 1", status: "ACTIVO" }]);
    mockedPrisma.businessUnit.findMany.mockResolvedValue([{ id: "bu-1", code: "UN-1", name: "Unidad 1", status: "ACTIVO", companyId: "comp-1" }]);
    mockedPrisma.establishment.findMany.mockResolvedValue([{ id: "est-1", code: "EST-1", name: "Est 1", status: "ACTIVO", companyId: "comp-1", businessUnitId: "bu-1" }]);
    mockedPrisma.area.findMany.mockResolvedValue([{ id: "area-1", code: "AREA-1", name: "Area 1", status: "ACTIVO", establishmentId: "est-1" }]);
    mockedPrisma.sector.findMany.mockResolvedValue([{ id: "sec-1", code: "SEC-1", name: "Sector 1", status: "ACTIVO", areaId: "area-1" }]);
    mockedPrisma.costCenter.findMany.mockResolvedValue([{
      id: "cc-1", code: "CC-1", name: "CC 1", status: "ACTIVO",
      companies: [{ companyId: "comp-1" }], businessUnits: [{ businessUnitId: "bu-1" }],
      establishments: [{ establishmentId: "est-1" }], areas: [{ areaId: "area-1" }], sectors: [{ sectorId: "sec-1" }],
    }]);

    const [companies, businessUnits, establishments, areas, sectors, costCenters] = await orgStructureRepository.getOverview();

    expect(businessUnits.at(0)).toEqual({ id: "bu-1", code: "UN-1", name: "Unidad 1", status: "ACTIVO", companyId: "comp-1" });
    expect(establishments.at(0)).toMatchObject({ companyId: "comp-1", businessUnitId: "bu-1" });
    expect(areas.at(0)).toEqual({ id: "area-1", code: "AREA-1", name: "Area 1", status: "ACTIVO", establishmentId: "est-1" });
    expect(sectors.at(0)).toEqual({ id: "sec-1", code: "SEC-1", name: "Sector 1", status: "ACTIVO", areaId: "area-1" });
    expect(costCenters.at(0)?.companies).toEqual([{ companyId: "comp-1" }]);
    expect(companies.at(0)?.code).toBe("EMP-1");

    // Confirma que ninguno de los selects usados para BusinessUnit/Establishment/Area/Sector
    // pide relaciones M:N (esos campos ya no existen en el cliente Prisma generado).
    const businessUnitSelect = mockedPrisma.businessUnit.findMany.mock.calls.at(0)?.[0]?.select;
    expect(businessUnitSelect).not.toHaveProperty("companies");
    const areaSelect = mockedPrisma.area.findMany.mock.calls.at(0)?.[0]?.select;
    expect(areaSelect).not.toHaveProperty("businessUnits");
    expect(areaSelect).not.toHaveProperty("establishments");
    const sectorSelect = mockedPrisma.sector.findMany.mock.calls.at(0)?.[0]?.select;
    expect(sectorSelect).not.toHaveProperty("areas");
    expect(sectorSelect).not.toHaveProperty("establishments");
  });
});
