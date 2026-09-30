import type { Request, RequestHandler, Response } from "express";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { AppError } from "../../shared/errors/AppError";
import { roles } from "../../shared/security/roles";
import { auditService } from "../audit/audit.service";
import { dependencyBlockedMessage, describeDependencies } from "./orgStructure.dependencies";
import { orgStructureRouter } from "./orgStructure.routes";
import { orgStructureService } from "./orgStructure.service";

// Eliminación segura de la estructura organizacional. Prisma se mockea: los
// tests nunca tocan la base de desarrollo.

const { tx, prismaMock } = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), delete: vi.fn() });
  const tx = { company: model(), businessUnit: model(), establishment: model(), area: model(), sector: model(), costCenter: model() };
  return { tx, prismaMock: { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) } };
});

vi.mock("../../shared/prisma/client", () => ({ prisma: prismaMock }));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn() } }));


const zeroCompanyCounts = { businessUnits: 0, establishments: 0, employees: 0, users: 0, costCenterLinks: 0, doubleHourRules: 0 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mensajes de dependencias", () => {
  it("lista sólo las dependencias presentes, en lenguaje de negocio y con sugerencia de inactivar", () => {
    const dependencies = describeDependencies("businessUnit", { establishments: 2, costCenterLinks: 1 });
    expect(dependencyBlockedMessage("businessUnit", "Producción", dependencies)).toBe(
      "No se puede eliminar la unidad de negocio “Producción” porque tiene elementos asociados: 2 establecimientos y 1 centro de costo. Podés inactivarla si ya no debe utilizarse.",
    );
    expect(dependencyBlockedMessage("sector", "RRHH", describeDependencies("sector", { employees: 1 }))).toMatch(/1 empleado\. Podés inactivarlo/);
  });
});

describe("orgStructureService.deleteEntity", () => {
  it("elimina una entidad sin dependencias, dentro de una transacción Serializable, y lo audita", async () => {
    tx.company.findUnique.mockResolvedValue({ id: "c1", code: "EMP-9", name: "Creada por error", _count: zeroCompanyCounts });

    const result = await orgStructureService.deleteEntity("company", "c1", { userId: "u1" });

    expect(result).toEqual({ id: "c1", code: "EMP-9", name: "Creada por error" });
    expect(tx.company.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({
      action: "DELETE",
      entity: "Company",
      entityId: "c1",
      description: "Se eliminó definitivamente empresa EMP-9 - Creada por error (sin dependencias).",
    }));
  });

  it("bloquea una entidad con hijos en la estructura: no borra y devuelve 409 con el motivo", async () => {
    tx.area.findUnique.mockResolvedValue({ id: "a1", code: "AREA-1", name: "Administración", _count: { sectors: 2, costCenterLinks: 0 } });

    const error = await orgStructureService.deleteEntity("area", "a1").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 409, code: "ORG_STRUCTURE_HAS_DEPENDENCIES", message: expect.stringContaining("2 sectores") });
    expect(tx.area.delete).not.toHaveBeenCalled();
    expect(auditService.register).not.toHaveBeenCalled();
  });

  it("bloquea un sector asignado a empleados y puestos (la base haría SET NULL en silencio)", async () => {
    tx.sector.findUnique.mockResolvedValue({ id: "s1", code: "SEC-1", name: "Depósito", _count: { employees: 3, positions: 1, users: 0, costCenterLinks: 0, doubleHourRules: 0 } });

    await expect(orgStructureService.deleteEntity("sector", "s1")).rejects.toMatchObject({
      statusCode: 409,
      message: "No se puede eliminar el sector “Depósito” porque tiene elementos asociados: 3 empleados y 1 puesto. Podés inactivarlo si ya no debe utilizarse.",
    });
    expect(tx.sector.delete).not.toHaveBeenCalled();
  });

  it("bloquea una empresa con legajos vinculados (EmployeeCompany haría CASCADE)", async () => {
    tx.company.findUnique.mockResolvedValue({ id: "c1", code: "EMP-1", name: "Los O'Dwyer", _count: { ...zeroCompanyCounts, employees: 12 } });

    await expect(orgStructureService.deleteEntity("company", "c1")).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("12 empleados") });
    expect(tx.company.delete).not.toHaveBeenCalled();
  });

  it("un centro de costo sin empleados ni reglas se elimina (sus propios vínculos de ubicación caen con él)", async () => {
    tx.costCenter.findUnique.mockResolvedValue({ id: "cc1", code: "CC-9", name: "Error", _count: { employees: 0, doubleHourRules: 0 } });

    await orgStructureService.deleteEntity("costCenter", "cc1");

    expect(tx.costCenter.delete).toHaveBeenCalledWith({ where: { id: "cc1" } });
  });

  it("entidad inexistente → 404 legible", async () => {
    tx.establishment.findUnique.mockResolvedValue(null);

    await expect(orgStructureService.deleteEntity("establishment", "nope")).rejects.toMatchObject({ statusCode: 404, code: "RECORD_NOT_FOUND" });
    expect(tx.establishment.delete).not.toHaveBeenCalled();
  });

  it("conflicto de concurrencia (P2034, Serializable) se traduce a un error funcional", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("serialization failure", { code: "P2034", clientVersion: "test" }));

    await expect(orgStructureService.deleteEntity("businessUnit", "bu1")).rejects.toMatchObject({ statusCode: 409, code: "ORG_STRUCTURE_CONCURRENT_CHANGE" });
  });
});

describe("permisos de DELETE", () => {
  function authorizationFor(path: string): RequestHandler {
    const layer = orgStructureRouter.stack.find((item) => item.route?.path === path && (item.route as unknown as { methods: Record<string, boolean> }).methods.delete);
    if (!layer?.route?.stack[0]) throw new Error(`Route not found: DELETE ${path}`);
    return layer.route.stack[0].handle;
  }
  function invoke(handler: RequestHandler, role: string) {
    const next: Mock = vi.fn();
    handler({ user: { id: "user-1", role } } as unknown as Request, {} as Response, next);
    return next.mock.calls[0]?.[0] as AppError | undefined;
  }

  for (const path of ["/companies/:id", "/business-units/:id", "/establishments/:id", "/areas/:id", "/sectors/:id", "/cost-centers/:id"]) {
    it(`DELETE ${path}: sólo RRHH (mismo nivel que crear/editar estructura)`, () => {
      expect(invoke(authorizationFor(path), roles.rrhh)).toBeUndefined();
      expect(invoke(authorizationFor(path), roles.supervision)).toMatchObject({ statusCode: 403 });
      expect(invoke(authorizationFor(path), roles.cargaHoraria)).toMatchObject({ statusCode: 403 });
    });
  }
});
