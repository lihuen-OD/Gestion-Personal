import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { auditService } from "../audit/audit.service";
import { assertShiftGroupAssignable, shiftGroupService, shiftGroupUniquenessKey } from "./shiftGroup.service";
import { createShiftGroupSchema, updateShiftGroupSchema } from "./shiftGroup.schemas";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    shiftGroup: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn(), registerWithin: vi.fn() } }));

const db = prisma as unknown as { shiftGroup: Record<"findMany" | "findUnique" | "create" | "update" | "delete", Mock>; $transaction: Mock };
const register = auditService.register as unknown as Mock;
const registerWithin = auditService.registerWithin as unknown as Mock;

const GROUP_ID = "0b6f3f8e-8c1a-4a77-9d3b-2d6f2f1b9a10";
const createdAt = new Date("2026-11-19T12:00:00.000Z");
function row(overrides: Partial<{ id: string; code: string; name: string; sortOrder: number; status: "ACTIVO" | "INACTIVO"; templates: number }> = {}) {
  const { templates = 0, ...rest } = overrides;
  return { id: GROUP_ID, code: "PLANTA", name: "Planta", sortOrder: 10, status: "ACTIVO" as const, createdByUserId: null, updatedByUserId: null, createdAt, updatedAt: createdAt, _count: { templates }, ...rest };
}
const knownError = (code: string) => new Prisma.PrismaClientKnownRequestError("error", { code, clientVersion: "test" });
const audit = { userId: "user-1" };
const auditDescriptions = () => [...register.mock.calls, ...registerWithin.mock.calls].map((call) => (call.length === 2 ? call[1] : call[0]).description as string);

beforeEach(() => {
  vi.clearAllMocks();
  db.shiftGroup.findMany.mockResolvedValue([]);
  db.shiftGroup.delete.mockResolvedValue({});
  db.shiftGroup.create.mockReset();
  db.shiftGroup.update.mockReset();
  db.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
});

describe("listar", () => {
  it("ordena por sortOrder y nombre, filtra por estado y devuelve la cantidad de plantillas", async () => {
    db.shiftGroup.findMany.mockResolvedValue([row({ templates: 3 }), row({ id: "g2", code: "TALLER", name: "Taller", sortOrder: 20, status: "INACTIVO" })]);
    const items = await shiftGroupService.list({ status: "ACTIVO" });
    expect(db.shiftGroup.findMany).toHaveBeenCalledWith({ where: { status: "ACTIVO" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { templates: true } } } });
    expect(items).toEqual([
      { id: GROUP_ID, code: "PLANTA", name: "Planta", sortOrder: 10, status: "ACTIVO", templateCount: 3, createdAt, updatedAt: createdAt },
      { id: "g2", code: "TALLER", name: "Taller", sortOrder: 20, status: "INACTIVO", templateCount: 0, createdAt, updatedAt: createdAt },
    ]);
  });

  it("sin filtro de estado lista todos", async () => {
    await shiftGroupService.list({});
    expect(db.shiftGroup.findMany.mock.calls[0]![0].where).toBeUndefined();
  });
});

describe("crear", () => {
  it("crea con autoría y audita con código y nombre", async () => {
    db.shiftGroup.create.mockResolvedValue(row());
    const item = await shiftGroupService.create({ code: "PLANTA", name: "Planta", sortOrder: 10 }, audit);
    expect(db.shiftGroup.create.mock.calls[0]![0].data).toEqual({ code: "PLANTA", name: "Planta", sortOrder: 10, createdByUserId: "user-1", updatedByUserId: "user-1" });
    expect(item).toMatchObject({ code: "PLANTA", templateCount: 0 });
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "ShiftGroup", entityId: GROUP_ID, description: "Se creó el grupo de turnos PLANTA - Planta." }));
  });

  it("lee código y nombre de los demás grupos (sin ILIKE) para comparar con la clave de los índices lower()", async () => {
    db.shiftGroup.create.mockResolvedValue(row());
    await shiftGroupService.create({ code: "PLANTA", name: "Planta", sortOrder: 0 });
    expect(db.shiftGroup.findMany.mock.calls[0]![0]).toEqual({ where: undefined, select: { id: true, code: true, name: true } });
  });

  it("«Planta» y «PLANTA» son el mismo nombre", async () => {
    db.shiftGroup.findMany.mockResolvedValue([{ id: "g-x", code: "PLT", name: "Planta" }]);
    await expect(shiftGroupService.create({ code: "OTRO", name: "PLANTA", sortOrder: 0 })).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_GROUP_DUPLICATE", message: expect.stringContaining("nombre «PLANTA»") });
    expect(db.shiftGroup.create).not.toHaveBeenCalled();
  });

  it("«Oficina» y « oficina » son el mismo nombre tras normalizar (schema + servicio)", async () => {
    db.shiftGroup.findMany.mockResolvedValue([{ id: "g-x", code: "OFICINA", name: "Oficina" }]);
    const input = createShiftGroupSchema.parse({ code: "OF", name: " oficina " });
    expect(input.name).toBe("oficina");
    await expect(shiftGroupService.create(input)).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_GROUP_DUPLICATE" });
  });

  it("dos códigos equivalentes por mayúsculas: el schema los lleva a MAYÚSCULAS y el servicio los rechaza", async () => {
    db.shiftGroup.findMany.mockResolvedValue([{ id: "g-x", code: "OFICINA", name: "Oficina" }]);
    const input = createShiftGroupSchema.parse({ code: "oficina", name: "Oficina Central" });
    expect(input.code).toBe("OFICINA");
    await expect(shiftGroupService.create(input)).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("código «OFICINA»") });
    // Aun si llegara sin pasar por el schema, la clave ignora mayúsculas.
    await expect(shiftGroupService.create({ code: "Oficina", name: "Otra", sortOrder: 0 })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("caracteres de patrón (_ %) no generan falsos duplicados", async () => {
    db.shiftGroup.findMany.mockResolvedValue([{ id: "g-x", code: "PL-1", name: "Planta-1" }]);
    db.shiftGroup.create.mockResolvedValue(row({ code: "PL_1", name: "Planta_1" }));
    await expect(shiftGroupService.create({ code: "PL_1", name: "Planta_1", sortOrder: 0 })).resolves.toMatchObject({ code: "PL_1" });
    db.shiftGroup.create.mockResolvedValue(row({ code: "PL%", name: "Planta%" }));
    await expect(shiftGroupService.create({ code: "PL%", name: "Planta%", sortOrder: 0 })).resolves.toMatchObject({ code: "PL%" });
  });

  it("clave de unicidad: equivalente a lower() de la base", () => {
    expect(shiftGroupUniquenessKey("Medio Ambiente")).toBe(shiftGroupUniquenessKey("MEDIO AMBIENTE"));
    expect(shiftGroupUniquenessKey("Granja")).not.toBe(shiftGroupUniquenessKey("Granja 02"));
  });

  it.each([
    ["código", { code: "planta", name: "Otro" }, { code: "PLANTA", name: "Planta" }, /código «planta»/],
    ["nombre", { code: "OTRO", name: "PLANTA" }, { code: "X", name: "Planta" }, /nombre «PLANTA»/],
  ])("rechaza un %s duplicado (409) antes de escribir", async (_label, input, existing, message) => {
    db.shiftGroup.findMany.mockResolvedValue([{ id: "g-x", ...existing }]);
    await expect(shiftGroupService.create({ ...input, sortOrder: 0 })).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_GROUP_DUPLICATE", message: expect.stringMatching(message) });
    expect(db.shiftGroup.create).not.toHaveBeenCalled();
  });

  it("concurrencia: la violación de un índice único (lower o exacto) llega como P2002 y es el mismo 409", async () => {
    // Dos altas simultáneas «Planta» / «PLANTA»: ambas pasan la validación previa y
    // la segunda choca con ShiftGroup_name_lower_key (23505 → P2002).
    db.shiftGroup.create.mockRejectedValue(knownError("P2002"));
    await expect(shiftGroupService.create({ code: "PLANTA", name: "PLANTA", sortOrder: 0 })).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_GROUP_DUPLICATE" });
  });
});

describe("editar", () => {
  it("edita nombre, código y orden; excluye al propio grupo del chequeo de duplicados", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(row());
    db.shiftGroup.update.mockResolvedValue(row({ code: "PLT", name: "Planta Norte", sortOrder: 5 }));
    const item = await shiftGroupService.update(GROUP_ID, { code: "PLT", name: "Planta Norte", sortOrder: 5 }, audit);
    expect(db.shiftGroup.findMany.mock.calls[0]![0].where.id).toEqual({ not: GROUP_ID });
    expect(db.shiftGroup.update.mock.calls[0]![0].data).toEqual({ code: "PLT", name: "Planta Norte", sortOrder: 5, updatedByUserId: "user-1" });
    expect(item).toMatchObject({ code: "PLT", sortOrder: 5 });
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", description: "Se actualizó el grupo de turnos PLT - Planta Norte." }));
  });

  it("concurrencia en la edición: P2002 → 409", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(row());
    db.shiftGroup.update.mockRejectedValue(knownError("P2002"));
    const input = updateShiftGroupSchema.parse({ name: "GRANJA" });
    await expect(shiftGroupService.update(GROUP_ID, input)).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_GROUP_DUPLICATE" });
  });

  it("renombrar cambiando sólo mayúsculas no choca consigo mismo (se excluye el propio id)", async () => {
    db.shiftGroup.findMany.mockResolvedValue([{ id: "g2", code: "TALLER", name: "Taller" }]);
    db.shiftGroup.findUnique.mockResolvedValue(row());
    db.shiftGroup.update.mockResolvedValue(row({ name: "PLANTA" }));
    await expect(shiftGroupService.update(GROUP_ID, { name: "PLANTA" })).resolves.toMatchObject({ name: "PLANTA" });
    expect(db.shiftGroup.findMany.mock.calls[0]![0].where).toEqual({ id: { not: GROUP_ID } });
  });

  it("sólo reordenar no consulta duplicados", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(row());
    db.shiftGroup.update.mockResolvedValue(row({ sortOrder: 99 }));
    await shiftGroupService.update(GROUP_ID, { sortOrder: 99 });
    expect(db.shiftGroup.findMany).not.toHaveBeenCalled();
  });

  it("inactivar conserva las plantillas y lo deja dicho en la auditoría (DEACTIVATE)", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(row({ templates: 2 }));
    db.shiftGroup.update.mockResolvedValue(row({ status: "INACTIVO", templates: 2 }));
    const item = await shiftGroupService.update(GROUP_ID, { status: "INACTIVO" }, audit);
    expect(item).toMatchObject({ status: "INACTIVO", templateCount: 2 });
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ action: "DEACTIVATE", description: expect.stringContaining("Sus 2 turno(s) siguen asociados y funcionando") }));
  });

  it("reactivar audita ACTIVATE", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(row({ status: "INACTIVO" }));
    db.shiftGroup.update.mockResolvedValue(row());
    await shiftGroupService.update(GROUP_ID, { status: "ACTIVO" });
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ action: "ACTIVATE", description: "Se activó el grupo de turnos PLANTA - Planta." }));
  });

  it("grupo inexistente → 404", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(null);
    await expect(shiftGroupService.update(GROUP_ID, { name: "Nada" })).rejects.toMatchObject({ statusCode: 404, code: "SHIFT_GROUP_NOT_FOUND" });
  });
});

describe("eliminar", () => {
  it("sin plantillas: borra en transacción Serializable y audita dentro", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(row());
    await expect(shiftGroupService.remove(GROUP_ID, audit)).resolves.toEqual({ id: GROUP_ID });
    expect(db.$transaction.mock.calls[0]![1]).toEqual({ isolationLevel: "Serializable" });
    expect(db.shiftGroup.delete).toHaveBeenCalledWith({ where: { id: GROUP_ID } });
    expect(registerWithin).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: "DELETE", description: "Se eliminó el grupo de turnos sin uso PLANTA - Planta." }));
  });

  it("con plantillas: 409 de dominio que sugiere inactivar, sin borrar", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(row({ templates: 3 }));
    await expect(shiftGroupService.remove(GROUP_ID)).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_GROUP_IN_USE", message: expect.stringContaining("Inactivalo") });
    expect(db.shiftGroup.delete).not.toHaveBeenCalled();
  });

  it("FK RESTRICT como segunda defensa (P2003, plantilla asociada en paralelo) → 409", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(row());
    db.shiftGroup.delete.mockRejectedValue(knownError("P2003"));
    await expect(shiftGroupService.remove(GROUP_ID)).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_GROUP_IN_USE" });
  });

  it("inexistente → 404", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(null);
    await expect(shiftGroupService.remove(GROUP_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("auditoría legible", () => {
  it("ninguna descripción contiene el id del grupo", async () => {
    db.shiftGroup.create.mockResolvedValue(row());
    await shiftGroupService.create({ code: "PLANTA", name: "Planta", sortOrder: 0 });
    db.shiftGroup.findUnique.mockResolvedValue(row({ templates: 1 }));
    db.shiftGroup.update.mockResolvedValue(row({ status: "INACTIVO", templates: 1 }));
    await shiftGroupService.update(GROUP_ID, { status: "INACTIVO" });
    db.shiftGroup.findUnique.mockResolvedValue(row());
    await shiftGroupService.remove(GROUP_ID);
    expect(auditDescriptions()).toHaveLength(3);
    for (const description of auditDescriptions()) expect(description).not.toContain(GROUP_ID);
  });
});

describe("assertShiftGroupAssignable (plantillas)", () => {
  it("null o ausente: sin grupo, válido y sin consultar", async () => {
    await expect(assertShiftGroupAssignable(null, null)).resolves.toBeNull();
    await expect(assertShiftGroupAssignable(undefined, null)).resolves.toBeNull();
    expect(db.shiftGroup.findUnique).not.toHaveBeenCalled();
  });

  it("grupo inexistente → 404", async () => {
    db.shiftGroup.findUnique.mockResolvedValue(null);
    await expect(assertShiftGroupAssignable(GROUP_ID, null)).rejects.toMatchObject({ statusCode: 404, code: "SHIFT_GROUP_NOT_FOUND" });
  });

  it("grupo ACTIVO → lo devuelve", async () => {
    db.shiftGroup.findUnique.mockResolvedValue({ id: GROUP_ID, code: "PLANTA", name: "Planta", status: "ACTIVO" });
    await expect(assertShiftGroupAssignable(GROUP_ID, null)).resolves.toMatchObject({ name: "Planta" });
  });

  it("grupo INACTIVO nuevo para la plantilla → 409", async () => {
    db.shiftGroup.findUnique.mockResolvedValue({ id: GROUP_ID, code: "PLANTA", name: "Planta", status: "INACTIVO" });
    await expect(assertShiftGroupAssignable(GROUP_ID, null)).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_GROUP_INACTIVE" });
    await expect(assertShiftGroupAssignable(GROUP_ID, "otro-grupo")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("grupo INACTIVO que la plantilla ya tenía → se conserva", async () => {
    db.shiftGroup.findUnique.mockResolvedValue({ id: GROUP_ID, code: "PLANTA", name: "Planta", status: "INACTIVO" });
    await expect(assertShiftGroupAssignable(GROUP_ID, GROUP_ID)).resolves.toMatchObject({ status: "INACTIVO" });
  });
});
