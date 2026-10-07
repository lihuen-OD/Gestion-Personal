import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { auditService, clearAuditDerivedCaches } from "../audit/audit.service";
import { invalidateOverviewCache, orgStructureRepository, type OrgRecord } from "./orgStructure.repository";
import { orgStructureService } from "./orgStructure.service";

// Reglas del modelo objetivo (docs/decisions/ORG_LOCATION_REORGANIZATION.md
// §3.1/§3.5). El repositorio se mockea; `transaction` ejecuta el callback con
// un cliente ficticio, igual que haría Prisma.

const tx = { marker: "tx" };

vi.mock("./orgStructure.repository", () => ({
  invalidateOverviewCache: vi.fn(),
  orgStructureRepository: {
    transaction: vi.fn((operation: (client: unknown) => unknown) => operation(tx)),
    findNode: vi.fn(),
    createNode: vi.fn(),
    updateNode: vi.fn(),
    findZonedEstablishmentByCode: vi.fn(),
    findCostCenterLinks: vi.fn(),
    findLegacyNames: vi.fn(),
    createCostCenter: vi.fn(),
    updateCostCenter: vi.fn(),
  },
}));
vi.mock("../audit/audit.service", () => ({ auditService: { registerWithin: vi.fn() }, clearAuditDerivedCaches: vi.fn() }));

const repo = orgStructureRepository as unknown as Record<keyof typeof orgStructureRepository, Mock>;
const registerWithin = auditService.registerWithin as unknown as Mock;

function record(overrides: Partial<OrgRecord>): OrgRecord {
  return { id: "id", code: "CODE", name: "Nombre", status: "ACTIVO", parentId: null, isLegacy: false, counts: {}, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.findLegacyNames.mockResolvedValue([]);
  repo.findZonedEstablishmentByCode.mockResolvedValue(null);
});

describe("altas: padre obligatorio, activo y del modelo objetivo", () => {
  it("crea un sector bajo una unidad de negocio activa, audita en la misma transacción y limpia cachés después", async () => {
    repo.findNode.mockResolvedValue(record({ id: "bu-1", name: "Restaurantes" }));
    repo.createNode.mockResolvedValue({ id: "sec-1", code: "SEC-1", name: "Cocina", status: "ACTIVO" });

    await orgStructureService.createNode("sector", { code: "SEC-1", name: "Cocina", status: "ACTIVO", businessUnitId: "bu-1" }, { userId: "u1" });

    expect(repo.findNode).toHaveBeenCalledWith(tx, "businessUnit", "bu-1");
    expect(registerWithin).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "CREATE", entity: "Sector", entityId: "sec-1", description: "Se creó el sector SEC-1 - Cocina.", userId: "u1" }));
    expect(invalidateOverviewCache).toHaveBeenCalledTimes(1);
    expect(clearAuditDerivedCaches).toHaveBeenCalledTimes(1);
  });

  it("rechaza un área bajo un sector de la estructura anterior (la limpieza lo eliminará)", async () => {
    repo.findNode.mockResolvedValue(record({ id: "old-sec", name: "Depósito", isLegacy: true }));

    await expect(orgStructureService.createNode("area", { code: "AREA-1", name: "Parrilla", status: "ACTIVO", sectorId: "old-sec" }))
      .rejects.toMatchObject({ statusCode: 400, code: "ORG_STRUCTURE_INVALID_PARENT", message: "Sector “Depósito” pertenece a la estructura anterior y no puede recibir elementos nuevos." });
    expect(repo.createNode).not.toHaveBeenCalled();
  });

  it("rechaza un padre inactivo, con concordancia de género", async () => {
    repo.findNode.mockResolvedValue(record({ id: "z1", name: "Norte", status: "INACTIVO" }));

    await expect(orgStructureService.createNode("establishment", { code: "EST-1", name: "Centro", status: "ACTIVO", zoneId: "z1" }))
      .rejects.toMatchObject({ statusCode: 400, message: "Zona “Norte” está inactiva." });
    expect(repo.createNode).not.toHaveBeenCalled();
  });

  it("rechaza un padre inexistente", async () => {
    repo.findNode.mockResolvedValue(null);

    await expect(orgStructureService.createNode("area", { code: "AREA-1", name: "Parrilla", status: "ACTIVO", sectorId: "nope" }))
      .rejects.toMatchObject({ statusCode: 400, message: "No encontramos el sector seleccionado." });
  });

  it("una zona es raíz: no busca padre", async () => {
    repo.createNode.mockResolvedValue({ id: "z1", code: "ZN-1", name: "Norte", status: "ACTIVO" });

    await orgStructureService.createNode("zone", { code: "ZN-1", name: "Norte", status: "ACTIVO" });

    expect(repo.findNode).not.toHaveBeenCalled();
    expect(registerWithin).toHaveBeenCalledWith(tx, expect.objectContaining({ entity: "Zone", description: "Se creó la zona ZN-1 - Norte." }));
  });

  it("rechaza un código de establecimiento repetido entre los del modelo objetivo", async () => {
    repo.findNode.mockResolvedValue(record({ id: "z1" }));
    repo.findZonedEstablishmentByCode.mockResolvedValue({ id: "est-otro" });

    await expect(orgStructureService.createNode("establishment", { code: "EST-1", name: "Centro", status: "ACTIVO", zoneId: "z1" }))
      .rejects.toMatchObject({ statusCode: 409, code: "UNIQUE_CONSTRAINT" });
    expect(repo.createNode).not.toHaveBeenCalled();
  });

  it("si la auditoría falla, el error se propaga (la transacción se revierte) y no se limpian cachés", async () => {
    repo.findNode.mockResolvedValue(record({ id: "bu-1" }));
    repo.createNode.mockResolvedValue({ id: "sec-1", code: "SEC-1", name: "Cocina", status: "ACTIVO" });
    registerWithin.mockRejectedValueOnce(new Error("audit down"));

    await expect(orgStructureService.createNode("sector", { code: "SEC-1", name: "Cocina", status: "ACTIVO", businessUnitId: "bu-1" })).rejects.toThrow("audit down");
    expect(invalidateOverviewCache).not.toHaveBeenCalled();
    expect(clearAuditDerivedCaches).not.toHaveBeenCalled();
  });
});

describe("ediciones: cambio de padre", () => {
  it("bloquea mover un nodo en uso (D-9) y no lo actualiza", async () => {
    repo.findNode.mockResolvedValueOnce(record({ id: "sec-1", name: "Cocina", parentId: "bu-1", counts: { areas: 2, positionScopes: 1 } }));

    await expect(orgStructureService.updateNode("sector", "sec-1", { businessUnitId: "bu-2" }))
      .rejects.toMatchObject({ statusCode: 409, code: "ORG_STRUCTURE_PARENT_IN_USE", message: expect.stringContaining("2 áreas y 1 alcance de puesto") });
    expect(repo.updateNode).not.toHaveBeenCalled();
  });

  it("un registro de la estructura anterior no se reubica en la nueva", async () => {
    repo.findNode.mockResolvedValueOnce(record({ id: "old-sec", name: "Depósito", isLegacy: true }));

    await expect(orgStructureService.updateNode("sector", "old-sec", { businessUnitId: "bu-1" }))
      .rejects.toMatchObject({ statusCode: 409, code: "ORG_STRUCTURE_LEGACY_RECORD", message: "Sector “Depósito” pertenece a la estructura anterior: no se reubica en la nueva. Creá uno nuevo." });
    expect(repo.updateNode).not.toHaveBeenCalled();
  });

  it("un registro de la estructura anterior sí puede corregir nombre o estado, y queda auditado con el estado previo", async () => {
    repo.findNode.mockResolvedValueOnce(record({ id: "old-sec", code: "SEC-OLD", name: "Deposito", isLegacy: true }));
    repo.updateNode.mockResolvedValue({ id: "old-sec", code: "SEC-OLD", name: "Depósito", status: "ACTIVO" });

    await orgStructureService.updateNode("sector", "old-sec", { name: "Depósito" });

    expect(repo.updateNode).toHaveBeenCalledWith(tx, "sector", "old-sec", { name: "Depósito" });
    expect(registerWithin).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "UPDATE", before: expect.objectContaining({ name: "Deposito" }) }));
  });

  it("mueve un nodo sin dependencias a un padre válido", async () => {
    repo.findNode
      .mockResolvedValueOnce(record({ id: "sec-1", parentId: "bu-1" }))
      .mockResolvedValueOnce(record({ id: "bu-2" }));
    repo.updateNode.mockResolvedValue({ id: "sec-1", code: "SEC-1", name: "Cocina", status: "ACTIVO" });

    await orgStructureService.updateNode("sector", "sec-1", { businessUnitId: "bu-2" });

    expect(repo.findNode).toHaveBeenLastCalledWith(tx, "businessUnit", "bu-2");
    expect(repo.updateNode).toHaveBeenCalled();
  });

  it("registro inexistente → 404", async () => {
    repo.findNode.mockResolvedValueOnce(null);
    await expect(orgStructureService.updateNode("zone", "nope", { name: "X" })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("centros de costo", () => {
  const links = { companyIds: [], businessUnitIds: [], establishmentIds: [], areaIds: [], sectorIds: [] };

  it("no agrega vínculos a registros de la estructura anterior", async () => {
    repo.findLegacyNames.mockResolvedValue(["Depósito"]);

    await expect(orgStructureService.createCostCenter({ code: "CC-1", name: "Cocina", status: "ACTIVO", ...links, sectorIds: ["old-sec"] }))
      .rejects.toMatchObject({ statusCode: 400, code: "ORG_STRUCTURE_LEGACY_LINK" });
    expect(repo.createCostCenter).not.toHaveBeenCalled();
  });

  it("conserva los vínculos legados que ya tenía: sólo valida los agregados", async () => {
    repo.findCostCenterLinks.mockResolvedValue({ ...links, sectorIds: ["old-sec"] });
    repo.updateCostCenter.mockResolvedValue({ id: "cc1", code: "CC-1", name: "Cocina", status: "ACTIVO" });

    await orgStructureService.updateCostCenter("cc1", { sectorIds: ["old-sec", "new-sec"] });

    expect(repo.findLegacyNames).toHaveBeenCalledWith(tx, { sectorIds: ["new-sec"], areaIds: [], establishmentIds: [] });
    expect(registerWithin).toHaveBeenCalledWith(tx, expect.objectContaining({ entity: "CostCenter", action: "UPDATE" }));
  });
});
