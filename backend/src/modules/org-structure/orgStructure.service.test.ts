import { Prisma } from "@prisma/client";
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
    findArchivedNames: vi.fn(),
    createCostCenter: vi.fn(),
    updateCostCenter: vi.fn(),
  },
}));
vi.mock("../audit/audit.service", () => ({ auditService: { registerWithin: vi.fn() }, clearAuditDerivedCaches: vi.fn() }));

const repo = orgStructureRepository as unknown as Record<keyof typeof orgStructureRepository, Mock>;
const registerWithin = auditService.registerWithin as unknown as Mock;

function record(overrides: Partial<OrgRecord>): OrgRecord {
  return { id: "id", code: "CODE", name: "Nombre", status: "ACTIVO", parentId: null, isLegacy: false, archivedAt: null, counts: {}, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.findLegacyNames.mockResolvedValue([]);
  repo.findArchivedNames.mockResolvedValue([]);
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

describe("archivo A8-1 — I4 y §12.4 (rechazos con destino archivado)", () => {
  it("no edita un registro archivado: 409 ORG_STRUCTURE_ARCHIVED_RECORD sin escribir", async () => {
    repo.findNode.mockResolvedValue(record({ id: "c1", name: "Los OD", archivedAt: new Date("2026-10-08") }));

    await expect(orgStructureService.updateNode("company", "c1", { name: "Otro nombre" }))
      .rejects.toMatchObject({ statusCode: 409, code: "ORG_STRUCTURE_ARCHIVED_RECORD", message: expect.stringContaining("archivado") });
    expect(repo.updateNode).not.toHaveBeenCalled();
    expect(registerWithin).not.toHaveBeenCalled();
  });

  it("no recibe hijos nuevos: un padre archivado rechaza el alta con 409 (§12.4)", async () => {
    repo.findNode.mockResolvedValue(record({ id: "sec-1", name: "Cocina", archivedAt: new Date("2026-10-08") }));

    await expect(orgStructureService.createNode("area", { code: "AREA-1", name: "Parrilla", status: "ACTIVO", sectorId: "sec-1" }))
      .rejects.toMatchObject({ statusCode: 409, code: "ORG_STRUCTURE_ARCHIVED_RECORD", message: expect.stringContaining("no puede recibir elementos nuevos") });
    expect(repo.createNode).not.toHaveBeenCalled();
  });

  it("un vínculo NUEVO de centro de costo hacia un archivado se rechaza con 409 (§12.4)", async () => {
    repo.findArchivedNames.mockResolvedValue(["Los OD"]);

    await expect(orgStructureService.createCostCenter({ code: "CC-1", name: "Compras", status: "ACTIVO", companyIds: ["c1"], businessUnitIds: [], sectorIds: [], areaIds: [], establishmentIds: [] }))
      .rejects.toMatchObject({ statusCode: 409, code: "ORG_STRUCTURE_ARCHIVED_RECORD", message: expect.stringContaining("Los OD") });
    expect(repo.createCostCenter).not.toHaveBeenCalled();
  });

  it("un vínculo existente hacia un archivado no se toca: sólo se chequean los IDs nuevos", async () => {
    repo.createCostCenter.mockResolvedValue({ id: "cc1", code: "CC-1", name: "Compras", status: "ACTIVO" });
    await orgStructureService.createCostCenter({ code: "CC-1", name: "Compras", status: "ACTIVO", companyIds: [], businessUnitIds: [], sectorIds: [], areaIds: [], establishmentIds: [] });
    expect(repo.findArchivedNames).toHaveBeenCalledWith(tx, { companyIds: [], businessUnitIds: [], sectorIds: [], areaIds: [], establishmentIds: [] });
  });

  it("edición de establecimiento: cambiar de ZONA con el mismo código valida (zoneId, code) en la zona destino (§12.8)", async () => {
    repo.findNode.mockResolvedValue(record({ id: "est-1", code: "EST-1", parentId: "z1", archivedAt: null }));
    repo.findZonedEstablishmentByCode.mockResolvedValue(null);
    repo.updateNode.mockResolvedValue({ id: "est-1", code: "EST-1", name: "Local", status: "ACTIVO" });

    await orgStructureService.updateNode("establishment", "est-1", { zoneId: "z2" });

    expect(repo.findZonedEstablishmentByCode).toHaveBeenCalledWith(tx, "z2", "EST-1", "est-1");
  });

  it("edición de establecimiento: el código repetido en la zona destino choca aunque el código no cambie (AT-8)", async () => {
    repo.findNode.mockResolvedValue(record({ id: "est-1", parentId: "z1", archivedAt: null }));
    repo.findZonedEstablishmentByCode.mockResolvedValue({ id: "est-otro" });

    await expect(orgStructureService.updateNode("establishment", "est-1", { zoneId: "z2" }))
      .rejects.toMatchObject({ statusCode: 409, code: "UNIQUE_CONSTRAINT" });
    expect(repo.updateNode).not.toHaveBeenCalled();
  });

  it("edición que no toca zona ni código no consulta el lookup de unicidad", async () => {
    repo.findNode.mockResolvedValue(record({ id: "est-1", parentId: "z1", archivedAt: null }));
    repo.updateNode.mockResolvedValue({ id: "est-1", code: "EST-1", name: "Local", status: "ACTIVO" });

    await orgStructureService.updateNode("establishment", "est-1", { city: "Rosario" });

    expect(repo.findZonedEstablishmentByCode).not.toHaveBeenCalled();
  });
});

describe("AT-4 — matriz de padres organizacionales (§12.4): archivado → 409 con su código; activo → éxito", () => {
  const ARCHIVED = new Date("2026-10-09");
  // Zone no tiene archivo (no está en DELETE_ORDER): establishment → zone queda fuera de la matriz.
  const cases = [
    { kind: "businessUnit", parentKind: "company", field: "companyId" },
    { kind: "sector", parentKind: "businessUnit", field: "businessUnitId" },
    { kind: "area", parentKind: "sector", field: "sectorId" },
  ] as const;

  it.each(cases)("alta de $kind bajo $parentKind archivado → 409 ORG_STRUCTURE_ARCHIVED_RECORD, sin escribir", async ({ kind, parentKind, field }) => {
    repo.findNode.mockResolvedValue(record({ id: "parent", name: "Padre viejo", archivedAt: ARCHIVED }));

    await expect(orgStructureService.createNode(kind, { code: "N-1", name: "Nuevo", status: "ACTIVO", [field]: "parent" } as never))
      .rejects.toMatchObject({ statusCode: 409, code: "ORG_STRUCTURE_ARCHIVED_RECORD" });
    expect(repo.findNode).toHaveBeenCalledWith(tx, parentKind, "parent");
    expect(repo.createNode).not.toHaveBeenCalled();
    expect(registerWithin).not.toHaveBeenCalled();
  });

  it.each(cases)("reubicar $kind hacia $parentKind archivado → 409, sin escribir", async ({ kind, field }) => {
    repo.findNode
      .mockResolvedValueOnce(record({ id: "node", parentId: "old-parent", counts: {} }))
      .mockResolvedValueOnce(record({ id: "parent", name: "Padre viejo", archivedAt: ARCHIVED }));

    await expect(orgStructureService.updateNode(kind, "node", { [field]: "parent" } as never))
      .rejects.toMatchObject({ statusCode: 409, code: "ORG_STRUCTURE_ARCHIVED_RECORD" });
    expect(repo.updateNode).not.toHaveBeenCalled();
  });

  it.each(cases)("regresión: alta de $kind bajo $parentKind activo sigue funcionando", async ({ kind, field }) => {
    repo.findNode.mockResolvedValue(record({ id: "parent", name: "Padre activo" }));
    repo.createNode.mockResolvedValue({ id: "n-1", code: "N-1", name: "Nuevo", status: "ACTIVO" });

    await orgStructureService.createNode(kind, { code: "N-1", name: "Nuevo", status: "ACTIVO", [field]: "parent" } as never);

    expect(repo.createNode).toHaveBeenCalled();
  });

  it("archivado manda sobre legado e inactivo: un padre archivado, legado e inactivo da ARCHIVED", async () => {
    repo.findNode.mockResolvedValue(record({ id: "parent", isLegacy: true, status: "INACTIVO", archivedAt: ARCHIVED }));

    await expect(orgStructureService.createNode("area", { code: "N-1", name: "Nueva", status: "ACTIVO", sectorId: "parent" }))
      .rejects.toMatchObject({ code: "ORG_STRUCTURE_ARCHIVED_RECORD" });
  });
});

describe("AT-8 — un código ocupado por un archivado no se recicla (§12.8)", () => {
  it.each(["company", "sector", "area"] as const)("alta de %s con el código de un archivado → 409 UNIQUE_CONSTRAINT (único de la base, sin excepción)", async (kind) => {
    repo.findNode.mockResolvedValue(record({ id: "parent" }));
    repo.createNode.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }));

    await expect(orgStructureService.createNode(kind, { code: "OCUPADO", name: "Nuevo", status: "ACTIVO", businessUnitId: "parent", sectorId: "parent" } as never))
      .rejects.toMatchObject({ statusCode: 409, code: "UNIQUE_CONSTRAINT" });
    expect(registerWithin).not.toHaveBeenCalled();
  });

  it("establecimiento: el lookup de alta busca (zoneId, code) y no colisiona con el archivado del mismo código (gobernado por companyId)", async () => {
    repo.findNode.mockResolvedValue(record({ id: "z1" }));
    repo.findZonedEstablishmentByCode.mockResolvedValue(null); // el repositorio excluye archivados (orgStructure.repository.test)
    repo.createNode.mockResolvedValue({ id: "est-new", code: "E1", name: "Local", status: "ACTIVO" });

    await orgStructureService.createNode("establishment", { code: "E1", name: "Local", status: "ACTIVO", zoneId: "z1" } as never);

    expect(repo.findZonedEstablishmentByCode).toHaveBeenCalledWith(tx, "z1", "E1", undefined);
    expect(repo.createNode).toHaveBeenCalled();
  });
});
