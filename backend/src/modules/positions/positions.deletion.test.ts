import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { auditService } from "../audit/audit.service";
import { employeesService } from "../employees/employees.service";
import { positionsDeletion } from "./positions.deletion";
import { positionsService } from "./positions.service";

/**
 * Eliminación controlada de un puesto (shared/deletion): con historia o
 * personas se archiva (las personas quedan sin puesto desde hoy); sin uso se
 * borra con su configuración propia. Las reglas no se tocan.
 */
type Model = Record<"findMany" | "findUnique" | "update" | "delete" | "deleteMany", Mock>;
const { db } = vi.hoisted(() => {
  const models = new Map<string, unknown>();
  const db: Record<string, unknown> = new Proxy({}, {
    get(_target, key: string | symbol) {
      if (typeof key !== "string" || key === "then") return undefined;
      if (key === "reset") return () => models.clear();
      if (key === "$transaction") return (operation: (tx: unknown) => unknown) => operation(db);
      if (!models.has(key)) models.set(key, { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})), delete: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 0 })) });
      return models.get(key);
    },
  });
  return { db };
});

vi.mock("../../shared/prisma/client", () => ({ prisma: db }));
vi.mock("../../shared/monthlyClosure/closurePeriodGuard", () => ({ findProtectedClosurePeriods: vi.fn(async () => new Map()) }));
vi.mock("../audit/audit.service", () => ({ auditService: { registerWithin: vi.fn() }, clearAuditDerivedCaches: vi.fn() }));
vi.mock("../employees/employees.service", () => ({ employeesService: { detachLaborReferencesWithin: vi.fn() } }));
vi.mock("./positions.service", () => ({ positionsService: { removeScopeNodesWithin: vi.fn() } }));
vi.mock("./positions.repository", () => ({ invalidatePositionsCache: vi.fn() }));


const model = (name: string) => (db as Record<string, Model>)[name]!;
const position = (counts: { employeePeriods?: number; orgScopes?: number }) => ({ id: "pos-1", code: "PUE-1", name: "Tractorista", archivedAt: null, _count: { employeePeriods: 0, orgScopes: 1, salaryCategories: 0, scopePeriods: 1, ...counts } });

beforeEach(() => {
  (db as unknown as { reset: () => void }).reset();
  vi.clearAllMocks();
  model("user").findUnique.mockResolvedValue({ role: "NIVEL_1_RRHH", status: "ACTIVO" });
});

describe("positionsDeletion", () => {
  it("sin uso: se elimina con su alcance, su historia de alcance propia y sus categorías", async () => {
    model("position").findUnique.mockResolvedValue(position({}));
    const preview = await positionsDeletion.preview("pos-1");
    expect(preview.groups.map((group) => group.key)).toEqual(["position.delete"]);

    await positionsDeletion.execute("pos-1", { token: preview.token }, { userId: "u1" });
    expect(model("positionOrgScopePeriodNode").deleteMany).toHaveBeenCalledWith({ where: { period: { positionId: "pos-1" } } });
    expect(model("positionOrgScopePeriod").deleteMany).toHaveBeenCalledWith({ where: { positionId: "pos-1" } });
    expect(model("position").delete).toHaveBeenCalledWith({ where: { id: "pos-1" } });
    expect(auditService.registerWithin).toHaveBeenCalledWith(db, expect.objectContaining({ action: "DELETE", entity: "Position" }));
  });

  it("con personas y una regla: las personas quedan sin puesto desde hoy, el alcance se cierra y el puesto se archiva; la regla no se toca", async () => {
    model("position").findUnique.mockResolvedValue(position({ employeePeriods: 3 }));
    model("employee").findMany.mockResolvedValue([{ id: "emp-1", legajo: "01", firstName: "Ana", lastName: "Gómez" }]);
    model("doubleHourRule").findMany.mockResolvedValue([{ id: "rule-1", name: "Domingos tractoristas" }]);
    model("positionOrgScope").findMany.mockResolvedValue([{ level: "SECTOR", companyId: null, businessUnitId: null, sectorId: "sec-1", areaId: null }]);
    const preview = await positionsDeletion.preview("pos-1");
    expect(preview.groups.map((group) => group.key)).toEqual(["position.archive", "employee.position", "doubleHourRule.review"]);
    expect(preview.requiresTypedConfirmation).toBe(true);

    await positionsDeletion.execute("pos-1", { token: preview.token, confirmationText: "Tractorista" }, { userId: "u1" });
    expect(employeesService.detachLaborReferencesWithin).toHaveBeenCalledWith(db, "emp-1", { positionId: "pos-1" }, expect.objectContaining({ reason: "Eliminación del puesto “Tractorista”" }));
    expect(positionsService.removeScopeNodesWithin).toHaveBeenCalledWith(db, "pos-1", new Set(["SECTOR:sec-1"]), expect.anything());
    expect(model("position").update).toHaveBeenCalledWith({ where: { id: "pos-1" }, data: { archivedAt: expect.any(Date) } });
    expect(model("position").delete).not.toHaveBeenCalled();
    expect(model("doubleHourRule").update).not.toHaveBeenCalled();
  });

  it("un puesto ya archivado queda bloqueado", async () => {
    model("position").findUnique.mockResolvedValue({ ...position({}), archivedAt: new Date() });
    const preview = await positionsDeletion.preview("pos-1");
    expect(preview.blockers.map((blocker) => blocker.code)).toEqual(["POSITION_ARCHIVED"]);
    await expect(positionsDeletion.execute("pos-1", { token: preview.token }, { userId: "u1" })).rejects.toMatchObject({ code: "DELETION_BLOCKED" });
  });
});
