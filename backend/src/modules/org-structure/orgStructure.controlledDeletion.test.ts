import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { auditService } from "../audit/audit.service";
import { employeeWorkLocationsService } from "../employees/employeeWorkLocations.service";
import { orgStructureDeletion } from "./orgStructure.deletion";

/**
 * Eliminación controlada de la estructura (shared/deletion) con una base
 * simulada por modelo: decide eliminar o archivar según la historia, revalida
 * la huella y el actor dentro de la transacción y nunca escribe si algo no
 * coincide. Las piezas de legajos/puestos se mockean (tienen sus propios tests).
 */
type Model = Record<"findMany" | "findUnique" | "update" | "delete" | "deleteMany" | "updateMany", Mock>;
const { db } = vi.hoisted(() => {
  const models = new Map<string, unknown>();
  const db = new Proxy({} as Record<string, unknown>, {
    get(_target, key: string | symbol) {
      if (typeof key !== "string" || key === "then") return undefined;
      if (key === "reset") return () => models.clear();
      if (key === "$transaction") return (operation: (tx: unknown) => unknown) => operation(db);
      if (!models.has(key)) {
        models.set(key, {
          findMany: vi.fn(async () => []),
          findUnique: vi.fn(async () => null),
          update: vi.fn(async () => ({})),
          delete: vi.fn(async () => ({})),
          deleteMany: vi.fn(async () => ({ count: 0 })),
          updateMany: vi.fn(async () => ({ count: 0 })),
        });
      }
      return models.get(key);
    },
  });
  return { db };
});

vi.mock("../../shared/prisma/client", () => ({ prisma: db }));
vi.mock("../../shared/monthlyClosure/closurePeriodGuard", () => ({ findProtectedClosurePeriods: vi.fn(async () => new Map()) }));
vi.mock("../audit/audit.service", () => ({ auditService: { registerWithin: vi.fn() }, clearAuditDerivedCaches: vi.fn() }));
vi.mock("../employees/employees.service", () => ({ employeesService: { detachLaborReferencesWithin: vi.fn() } }));
vi.mock("../employees/employeeWorkLocations.service", () => ({ employeeWorkLocationsService: { previewNodeDetachmentWithin: vi.fn(async () => []), detachNodesWithin: vi.fn(async () => 0) } }));
vi.mock("../positions/positions.service", () => ({ positionsService: { removeScopeNodesWithin: vi.fn() } }));
vi.mock("../positions/positions.repository", () => ({ invalidatePositionsCache: vi.fn() }));
vi.mock("./orgStructure.repository", () => ({ invalidateOverviewCache: vi.fn() }));


const model = (name: string) => (db as unknown as Record<string, Model>)[name]!;
const zone = { id: "zone-1", code: "ZN-001", name: "Granjas porcinas", archivedAt: null };
const estA = { id: "est-a", code: "EST-001", name: "La Sucho", archivedAt: null };
const estB = { id: "est-b", code: "EST-002", name: "La Honoria", archivedAt: null };
const audit = { userId: "u-rrhh" };

function arrangeZone(options: { history?: boolean } = {}) {
  model("user").findUnique.mockResolvedValue({ role: "NIVEL_1_RRHH", status: "ACTIVO" });
  model("zone").findMany.mockImplementation(async (args: { where: { id: unknown } }) => (typeof args.where.id === "string" ? [zone] : [{ id: zone.id, provinceId: null }]));
  model("establishment").findMany.mockResolvedValue([estA, estB]);
  if (options.history) {
    model("employeeWorkLocation").findMany.mockResolvedValue([{ zoneId: zone.id }]);
    model("employeeWorkLocationEstablishment").findMany.mockResolvedValue([{ establishmentId: estA.id }]);
  }
}

beforeEach(() => {
  (db as unknown as { reset: () => void }).reset();
  vi.clearAllMocks();
});

describe("zona sin historia (caso “Granjas porcinas”)", () => {
  it("la vista previa elimina la zona y sus establecimientos; no pide escribir el nombre", async () => {
    arrangeZone();
    const preview = await orgStructureDeletion.preview("zone", zone.id);
    expect(preview.groups.map((group) => [group.key, group.count])).toEqual([["zone.delete", 1], ["establishment.delete", 2]]);
    expect(preview.requiresTypedConfirmation).toBe(false);
    expect(preview.blockers).toEqual([]);
  });

  it("al confirmar borra de las hojas a la raíz y audita en la misma transacción", async () => {
    arrangeZone();
    const preview = await orgStructureDeletion.preview("zone", zone.id);
    await orgStructureDeletion.execute("zone", zone.id, { token: preview.token }, audit);

    expect(employeeWorkLocationsService.detachNodesWithin).toHaveBeenCalledWith(db, { zoneIds: [zone.id], establishmentIds: [estA.id, estB.id], unitIds: [] }, expect.objectContaining({ reason: "Eliminación de la zona “Granjas porcinas”" }));
    expect(model("establishment").delete.mock.calls.map(([args]) => args.where.id)).toEqual([estA.id, estB.id]);
    expect(model("zone").delete).toHaveBeenCalledWith({ where: { id: zone.id } });
    expect(model("establishment").update).not.toHaveBeenCalled();
    expect(auditService.registerWithin).toHaveBeenCalledWith(db, expect.objectContaining({ action: "DELETE", entity: "Zone", entityId: zone.id }));
  });
});

describe("zona con historia", () => {
  it("se archiva; el establecimiento con ubicaciones se archiva desprendido de la zona y el otro se elimina", async () => {
    arrangeZone({ history: true });
    const preview = await orgStructureDeletion.preview("zone", zone.id);
    expect(preview.groups.map((group) => [group.key, group.count])).toEqual([["zone.archive", 1], ["establishment.delete", 1], ["establishment.archive", 1]]);
    expect(preview.requiresTypedConfirmation).toBe(true);

    await orgStructureDeletion.execute("zone", zone.id, { token: preview.token, confirmationText: "granjas porcinas" }, audit);
    expect(model("establishment").update).toHaveBeenCalledWith({ where: { id: estA.id }, data: { archivedAt: expect.any(Date), zoneId: null } });
    expect(model("establishment").delete).toHaveBeenCalledWith({ where: { id: estB.id } });
    expect(model("zone").update).toHaveBeenCalledWith({ where: { id: zone.id }, data: { archivedAt: expect.any(Date) } });
    expect(model("zone").delete).not.toHaveBeenCalled();
  });
});

describe("revalidación al confirmar", () => {
  it("huella vencida → 409 con la vista previa nueva y sin escribir nada", async () => {
    arrangeZone();
    await expect(orgStructureDeletion.execute("zone", zone.id, { token: "f".repeat(64) }, audit)).rejects.toMatchObject({ statusCode: 409, code: "DELETION_PREVIEW_CHANGED", details: { preview: expect.objectContaining({ token: expect.any(String) }) } });
    expect(employeeWorkLocationsService.detachNodesWithin).not.toHaveBeenCalled();
    expect(model("zone").delete).not.toHaveBeenCalled();
    expect(auditService.registerWithin).not.toHaveBeenCalled();
  });

  it("actor sin permiso al confirmar → 403 antes de calcular o escribir", async () => {
    arrangeZone();
    const preview = await orgStructureDeletion.preview("zone", zone.id);
    model("user").findUnique.mockResolvedValue({ role: "NIVEL_2_SUPERVISION", status: "ACTIVO" });
    await expect(orgStructureDeletion.execute("zone", zone.id, { token: preview.token }, audit)).rejects.toMatchObject({ statusCode: 403, code: "DELETION_FORBIDDEN" });
    expect(model("zone").delete).not.toHaveBeenCalled();
  });
});

describe("sector referenciado por una regla de horas especiales", () => {
  it("se archiva desprendido de su UN; la regla se marca para revisar y nunca se modifica", async () => {
    model("user").findUnique.mockResolvedValue({ role: "NIVEL_1_RRHH", status: "ACTIVO" });
    model("sector").findMany.mockResolvedValue([{ id: "sec-1", code: "SEC-1", name: "Cosecha", archivedAt: null }]);
    model("doubleHourRule").findMany.mockResolvedValue([{ id: "rule-1", name: "Domingos cosecha", companyId: null, sectorId: "sec-1", costCenterId: null }]);
    const preview = await orgStructureDeletion.preview("sector", "sec-1");
    expect(preview.groups.map((group) => group.key)).toEqual(["sector.archive", "doubleHourRule.review"]);

    await orgStructureDeletion.execute("sector", "sec-1", { token: preview.token, confirmationText: "Cosecha" }, audit);
    expect(model("sector").update).toHaveBeenCalledWith({ where: { id: "sec-1" }, data: { archivedAt: expect.any(Date), businessUnitId: null } });
    expect(model("doubleHourRule").update).not.toHaveBeenCalled();
    expect(model("doubleHourRule").updateMany).not.toHaveBeenCalled();
    expect(model("doubleHourRule").delete).not.toHaveBeenCalled();
  });
});
