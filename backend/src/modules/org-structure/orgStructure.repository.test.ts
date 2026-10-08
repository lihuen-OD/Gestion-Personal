import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { orgStructureRepository, invalidateOverviewCache } from "./orgStructure.repository";

/**
 * Modelo objetivo (docs/decisions/ORG_LOCATION_REORGANIZATION.md): las altas y
 * ediciones escriben SOLO el padre del modelo objetivo (Empresa → UN → Sector
 * → Área; Zona → Establecimiento). Las columnas del modelo anterior (areaId,
 * establishmentId, companyId/businessUnitId del establecimiento) no se
 * escriben; se leen en el overview hasta M2. Prisma se mockea: los tests nunca
 * tocan una base real.
 */
const { tx } = vi.hoisted(() => {
  const model = () => ({ create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), delete: vi.fn() });
  const links = () => ({ createMany: vi.fn(), deleteMany: vi.fn() });
  return {
    tx: {
      company: model(),
      businessUnit: model(),
      sector: model(),
      area: model(),
      zone: model(),
      establishment: model(),
      costCenter: model(),
      costCenterCompany: links(),
      costCenterBusinessUnit: links(),
      costCenterEstablishment: links(),
      costCenterArea: links(),
      costCenterSector: links(),
    },
  };
});

vi.mock("../../shared/prisma/client", () => ({
  prisma: { ...tx, $transaction: vi.fn((callback: (client: unknown) => unknown) => callback(tx)) },
}));

const mockedPrisma = prisma as unknown as typeof tx & { $transaction: Mock };

beforeEach(() => {
  vi.clearAllMocks();
  invalidateOverviewCache();
});

describe("orgStructureRepository — altas con el padre del modelo objetivo", () => {
  it("sector: escribe businessUnitId, nunca areaId, y clasifica con el criterio previo (A8-3)", async () => {
    tx.sector.create.mockResolvedValue({ id: "sec-1" });
    await orgStructureRepository.createNode(tx as never, "sector", { code: "SEC-1", name: "Cocina", status: "ACTIVO", businessUnitId: "bu-1" });
    expect(tx.sector.create).toHaveBeenCalledWith({ data: { code: "SEC-1", name: "Cocina", status: "ACTIVO", businessUnitId: "bu-1", isLegacy: false } });
  });

  it("sector: el alta ignora cualquier isLegacy entrante y clasifica con el criterio previo (A8-3)", async () => {
    tx.sector.create.mockResolvedValue({ id: "sec-1" });
    await orgStructureRepository.createNode(tx as never, "sector", { code: "SEC-1", name: "Cocina", status: "ACTIVO", businessUnitId: "bu-1", isLegacy: true } as never);
    expect(tx.sector.create).toHaveBeenCalledWith({ data: expect.objectContaining({ businessUnitId: "bu-1", isLegacy: false }) });
  });

  it("sector: una edición común no puede cambiar la clasificación persistida (A8-3)", async () => {
    tx.sector.update.mockResolvedValue({ id: "sec-1" });
    await orgStructureRepository.updateNode(tx as never, "sector", "sec-1", { code: "SEC-9", name: "Cocina", status: "ACTIVO", businessUnitId: "bu-2", isLegacy: true } as never);
    expect(tx.sector.update).toHaveBeenCalledWith({ where: { id: "sec-1" }, data: expect.not.objectContaining({ isLegacy: true }) });
  });

  it("área: escribe sectorId, nunca establishmentId, y clasifica con el criterio previo (A8-3)", async () => {
    tx.area.create.mockResolvedValue({ id: "area-1" });
    await orgStructureRepository.createNode(tx as never, "area", { code: "AREA-1", name: "Parrilla", status: "ACTIVO", sectorId: "sec-1" });
    expect(tx.area.create).toHaveBeenCalledWith({ data: { code: "AREA-1", name: "Parrilla", status: "ACTIVO", sectorId: "sec-1", isLegacy: false } });
  });

  it("área: creada sin sector del modelo objetivo queda clasificada como legada (A8-3)", async () => {
    tx.area.create.mockResolvedValue({ id: "area-2" });
    await orgStructureRepository.createNode(tx as never, "area", { code: "AREA-2", name: "Otra", status: "ACTIVO", sectorId: undefined } as never);
    expect(tx.area.create).toHaveBeenCalledWith({ data: expect.objectContaining({ isLegacy: true }) });
  });

  it("área: una edición común no puede cambiar la clasificación persistida (A8-3)", async () => {
    tx.area.update.mockResolvedValue({ id: "area-1" });
    await orgStructureRepository.updateNode(tx as never, "area", "area-1", { code: "AREA-9", name: "Parrilla", status: "ACTIVO", sectorId: "sec-1", isLegacy: true } as never);
    expect(tx.area.update).toHaveBeenCalledWith({ where: { id: "area-1" }, data: expect.not.objectContaining({ isLegacy: true }) });
  });

  it("establecimiento: escribe zoneId y domicilio, sin companyId ni businessUnitId, con clasificación de origen (A8-3)", async () => {
    tx.establishment.create.mockResolvedValue({ id: "est-1" });
    await orgStructureRepository.createNode(tx as never, "establishment", { code: "EST-1", name: "Local Centro", status: "ACTIVO", zoneId: "zone-1", city: "Rosario" });
    expect(tx.establishment.create).toHaveBeenCalledWith({ data: { code: "EST-1", name: "Local Centro", status: "ACTIVO", zoneId: "zone-1", city: "Rosario", isLegacy: false } });
  });

  it("establecimiento: una edición común no puede cambiar la clasificación persistida (A8-3)", async () => {
    tx.establishment.update.mockResolvedValue({ id: "est-1" });
    await orgStructureRepository.updateNode(tx as never, "establishment", "est-1", { code: "EST-1", name: "Local", status: "ACTIVO", zoneId: "zone-2", isLegacy: true } as never);
    expect(tx.establishment.update).toHaveBeenCalledWith({ where: { id: "est-1" }, data: expect.not.objectContaining({ isLegacy: true }) });
  });

  it("el lookup de unicidad recibe la zona, busca (zoneId, code) y excluye archivados (A8 §12.8)", async () => {
    await orgStructureRepository.findZonedEstablishmentByCode(tx as never, "zone-1", "EST-1", "est-9");
    expect(tx.establishment.findFirst).toHaveBeenCalledWith({ where: { zoneId: "zone-1", code: "EST-1", archivedAt: null, id: { not: "est-9" } }, select: { id: true } });
  });

  it("findArchivedNames consulta cada familia por archivedAt NOT NULL (§12.4)", async () => {
    tx.company.findMany.mockResolvedValue([{ name: "Los OD" }]);
    tx.businessUnit.findMany.mockResolvedValue([]);
    tx.sector.findMany.mockResolvedValue([]);
    tx.area.findMany.mockResolvedValue([]);
    tx.establishment.findMany.mockResolvedValue([]);
    await expect(orgStructureRepository.findArchivedNames(tx as never, { companyIds: ["c1"], businessUnitIds: [], sectorIds: [], areaIds: [], establishmentIds: [] }))
      .resolves.toEqual(["Los OD"]);
    expect(tx.company.findMany).toHaveBeenCalledWith({ where: { id: { in: ["c1"] }, archivedAt: { not: null } }, select: { name: true } });
  });

  it("el overview excluye archivados en los listados del modelo nuevo (§12.4)", async () => {
    mockedPrisma.company.findMany.mockResolvedValue([]);
    mockedPrisma.businessUnit.findMany.mockResolvedValue([]);
    mockedPrisma.establishment.findMany.mockResolvedValue([]);
    mockedPrisma.area.findMany.mockResolvedValue([]);
    mockedPrisma.sector.findMany.mockResolvedValue([]);
    mockedPrisma.costCenter.findMany.mockResolvedValue([]);
    mockedPrisma.zone.findMany.mockResolvedValue([]);
    await orgStructureRepository.getOverview();
    expect(mockedPrisma.company.findMany.mock.calls.at(0)?.[0]?.where).toEqual({ archivedAt: null });
    expect(mockedPrisma.sector.findMany.mock.calls.at(0)?.[0]?.where).toEqual({ archivedAt: null });
    expect(mockedPrisma.zone.findMany.mock.calls.at(0)?.[0]?.where).toBeUndefined();
  });
});

describe("orgStructureRepository.findNode — registro legado", () => {
  it("un sector clasificado como del modelo anterior (A8-3, columna persistida)", async () => {
    tx.sector.findUnique.mockResolvedValue({ id: "s1", code: "SEC-1", name: "Depósito", status: "ACTIVO", businessUnitId: null, isLegacy: true, _count: {} });
    await expect(orgStructureRepository.findNode(tx as never, "sector", "s1")).resolves.toMatchObject({ parentId: null, isLegacy: true });
  });

  it("la clasificación no depende del padre actual: un sector re-padreado sigue siendo legado (A8-3)", async () => {
    tx.sector.findUnique.mockResolvedValue({ id: "s1", code: "SEC-1", name: "Depósito", status: "ACTIVO", businessUnitId: "bu-nuevo", isLegacy: true, _count: {} });
    await expect(orgStructureRepository.findNode(tx as never, "sector", "s1")).resolves.toMatchObject({ parentId: "bu-nuevo", isLegacy: true });
  });

  it("un establecimiento con zona es del modelo objetivo", async () => {
    tx.establishment.findUnique.mockResolvedValue({ id: "e1", code: "EST-1", name: "Centro", status: "ACTIVO", zoneId: "z1", isLegacy: false, _count: {} });
    await expect(orgStructureRepository.findNode(tx as never, "establishment", "e1")).resolves.toMatchObject({ parentId: "z1", isLegacy: false });
  });

  it("el área usa la columna persistida y no deriva la clasificación de su padre actual (A8-3)", async () => {
    tx.area.findUnique.mockResolvedValue({ id: "a1", code: "AREA-1", name: "Parrilla", status: "ACTIVO", sectorId: "sec-nuevo", isLegacy: true, _count: {} });
    await expect(orgStructureRepository.findNode(tx as never, "area", "a1")).resolves.toMatchObject({ parentId: "sec-nuevo", isLegacy: true });
  });
});

describe("orgStructureRepository.deleteIfUnused", () => {
  it("borra un centro de costo eliminando explícitamente sus vínculos (no depende del CASCADE) y audita dentro de la transacción", async () => {
    tx.costCenter.findUnique.mockResolvedValue({ id: "cc1", code: "CC-9", name: "Error", status: "ACTIVO", _count: { employees: 0, doubleHourRules: 0 } });
    const onDeleted = vi.fn();

    await orgStructureRepository.deleteIfUnused("costCenter", "cc1", () => false, onDeleted);

    for (const links of [tx.costCenterCompany, tx.costCenterBusinessUnit, tx.costCenterEstablishment, tx.costCenterArea, tx.costCenterSector]) {
      expect(links.deleteMany).toHaveBeenCalledWith({ where: { costCenterId: "cc1" } });
    }
    expect(tx.costCenter.delete).toHaveBeenCalledWith({ where: { id: "cc1" } });
    expect(onDeleted).toHaveBeenCalledWith(tx, expect.objectContaining({ id: "cc1" }));
  });

  it("no borra ni audita si está bloqueado", async () => {
    tx.zone.findUnique.mockResolvedValue({ id: "z1", code: "ZN-1", name: "Norte", status: "ACTIVO", _count: { establishments: 2 } });
    const onDeleted = vi.fn();

    const result = await orgStructureRepository.deleteIfUnused("zone", "z1", () => true, onDeleted);

    expect(result.status).toBe("BLOCKED");
    expect(tx.zone.delete).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe("orgStructureRepository.getOverview", () => {
  it("devuelve ambos árboles con los padres del modelo objetivo y, hasta M2, los padres legados sólo de lectura", async () => {
    mockedPrisma.company.findMany.mockResolvedValue([{ id: "comp-1", code: "EMP-1", name: "Empresa 1", status: "ACTIVO" }]);
    mockedPrisma.businessUnit.findMany.mockResolvedValue([{ id: "bu-1", code: "UN-1", name: "Unidad 1", status: "ACTIVO", companyId: "comp-1" }]);
    mockedPrisma.establishment.findMany.mockResolvedValue([{ id: "est-1", code: "EST-1", name: "Est 1", status: "ACTIVO", zoneId: "zone-1", companyId: null, businessUnitId: null }]);
    mockedPrisma.area.findMany.mockResolvedValue([{ id: "area-1", code: "AREA-1", name: "Area 1", status: "ACTIVO", sectorId: "sec-1", establishmentId: null }]);
    mockedPrisma.sector.findMany.mockResolvedValue([{ id: "sec-1", code: "SEC-1", name: "Sector 1", status: "ACTIVO", businessUnitId: "bu-1", areaId: null }]);
    mockedPrisma.costCenter.findMany.mockResolvedValue([]);
    mockedPrisma.zone.findMany.mockResolvedValue([{ id: "zone-1", code: "ZN-1", name: "Norte", status: "ACTIVO" }]);

    const [, , , , , , zones] = await orgStructureRepository.getOverview();

    expect(zones).toEqual([{ id: "zone-1", code: "ZN-1", name: "Norte", status: "ACTIVO" }]);
    expect(mockedPrisma.sector.findMany.mock.calls.at(0)?.[0]?.select).toMatchObject({ businessUnitId: true, areaId: true });
    expect(mockedPrisma.area.findMany.mock.calls.at(0)?.[0]?.select).toMatchObject({ sectorId: true, establishmentId: true });
    expect(mockedPrisma.establishment.findMany.mock.calls.at(0)?.[0]?.select).toMatchObject({ zoneId: true, companyId: true, businessUnitId: true });
  });
});
