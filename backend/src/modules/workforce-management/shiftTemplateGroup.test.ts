/**
 * R3.1 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §23): grupo opcional de
 * una plantilla de turno. Asignar, cambiar o quitar el grupo es clasificación:
 * nunca recalcula cobertura ni toca la jornada esperada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { auditService } from "../audit/audit.service";
import { workforceService } from "./workforce.service";

// Mismo par de mocks que workforce.service.test.ts (el orden de carga importa).
vi.mock("../novelties/noveltyCoverage.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../novelties/noveltyCoverage.service")>()),
  lockNoveltyCoverageGlobally: vi.fn(),
}));
vi.mock("../novelties/noveltyCoverageRecalculation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../novelties/noveltyCoverageRecalculation")>()),
  recalculateNoveltyCoverage: vi.fn(),
  auditNoveltyCoverageRecalculation: vi.fn(),
}));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn(), registerWithin: vi.fn() } }));
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    shiftTemplate: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    shiftGroup: { findUnique: vi.fn() },
    shiftAssignment: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    holidayWorkAssignment: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    workShift: { findFirst: vi.fn().mockResolvedValue(null) },
    shiftRotationBlock: { findFirst: vi.fn().mockResolvedValue(null) },
    clockPunchPostProcessJob: { count: vi.fn().mockResolvedValue(0) },
    // R4.3b: sin membresías de rotación (camino legacy).
    shiftRotationCrewMember: { findFirst: vi.fn().mockResolvedValue(null) },
    // Advisory locks de los caminos que sí recalculan cobertura (control).
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
  },
}));

const db = prisma as unknown as {
  shiftTemplate: Record<"findMany" | "create" | "findUnique" | "update", Mock>;
  shiftGroup: { findUnique: Mock };
  $transaction: Mock;
};
const register = auditService.register as unknown as Mock;

const PLANTA_ID = "0b6f3f8e-8c1a-4a77-9d3b-2d6f2f1b9a10";
const GRANJA_ID = "5d1e2a77-3c44-4b0e-9a61-7f2c8e9d0b21";
const PLANTA = { id: PLANTA_ID, code: "PLANTA", name: "Planta", status: "ACTIVO" as const, sortOrder: 10 };
const GRANJA = { id: GRANJA_ID, code: "GRANJA", name: "Granja", status: "ACTIVO" as const, sortOrder: 20 };
const GROUP_INCLUDE = { shiftGroup: { select: { id: true, code: true, name: true, status: true, sortOrder: true } } };

const input = { code: "PL-01", name: "Planta 01", startTime: "07:00", endTime: "17:00", entryToleranceBeforeMinutes: 10, entryToleranceAfterMinutes: 10, exitToleranceBeforeMinutes: 10, exitToleranceAfterMinutes: 10 };
function template(overrides: Record<string, unknown> = {}) {
  return { id: "template-1", code: "PL-01", name: "Planta 01", startTime: "07:00", endTime: "17:00", crossesMidnight: false, expectedMinutes: 600, status: "ACTIVO", categoryName: null, shiftGroupId: null, shiftGroup: null, ...overrides };
}
function givenGroups(...groups: Array<typeof PLANTA>) {
  db.shiftGroup.findUnique.mockImplementation(async (args: { where: { id: string } }) => groups.find((group) => group.id === args.where.id) ?? null);
}
const lastDescription = () => register.mock.calls.at(-1)![0].description as string;

beforeEach(() => {
  vi.clearAllMocks();
  givenGroups(PLANTA, GRANJA);
  db.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  db.shiftTemplate.create.mockImplementation(async (args: { data: Record<string, unknown> }) => template({ ...args.data, shiftGroup: args.data.shiftGroupId === PLANTA_ID ? PLANTA : null }));
});

describe("catálogo (serialización)", () => {
  it("incluye el grupo de cada plantilla; sin grupo = shiftGroup null", async () => {
    db.shiftTemplate.findMany.mockResolvedValue([template(), template({ id: "template-2", shiftGroupId: PLANTA_ID, shiftGroup: PLANTA })]);
    const items = await workforceService.shiftTemplates();
    expect(db.shiftTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { startTime: "asc" }, include: expect.objectContaining(GROUP_INCLUDE) }));
    expect(items.map((item) => item.shiftGroup)).toEqual([null, PLANTA]);
    expect(items.every((item) => item.inUseFromTomorrow === false)).toBe(true);
  });
});

describe("alta", () => {
  it("sin grupo: no consulta grupos y audita como siempre", async () => {
    const item = await workforceService.createShiftTemplate(input, { userId: "user-1" });
    expect(db.shiftGroup.findUnique).not.toHaveBeenCalled();
    expect(db.shiftTemplate.create.mock.calls[0]![0].include).toEqual(GROUP_INCLUDE);
    expect(item.shiftGroup).toBeNull();
    expect(lastDescription()).toBe("Se creó el turno PL-01 - Planta 01.");
  });

  it("con grupo ACTIVO: lo guarda y lo nombra en la auditoría (sin ids)", async () => {
    const item = await workforceService.createShiftTemplate({ ...input, shiftGroupId: PLANTA_ID });
    expect(db.shiftTemplate.create.mock.calls[0]![0].data.shiftGroupId).toBe(PLANTA_ID);
    expect(item.shiftGroup).toEqual(PLANTA);
    expect(lastDescription()).toBe("Se creó el turno PL-01 - Planta 01. Grupo: PLANTA - Planta.");
    expect(lastDescription()).not.toContain(PLANTA_ID);
  });

  it("grupo inexistente → 404 sin crear", async () => {
    givenGroups();
    await expect(workforceService.createShiftTemplate({ ...input, shiftGroupId: PLANTA_ID })).rejects.toMatchObject({ statusCode: 404, code: "SHIFT_GROUP_NOT_FOUND" });
    expect(db.shiftTemplate.create).not.toHaveBeenCalled();
  });

  it("grupo INACTIVO → 409 sin crear", async () => {
    givenGroups({ ...PLANTA, status: "INACTIVO" as never });
    await expect(workforceService.createShiftTemplate({ ...input, shiftGroupId: PLANTA_ID })).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_GROUP_INACTIVE" });
    expect(db.shiftTemplate.create).not.toHaveBeenCalled();
  });
});

describe("edición", () => {
  function givenBefore(overrides: Record<string, unknown> = {}) {
    const before = template(overrides);
    db.shiftTemplate.findUnique.mockResolvedValue(before);
    db.shiftTemplate.update.mockImplementation(async (args: { data: Record<string, unknown> }) => {
      const shiftGroupId = "shiftGroupId" in args.data ? args.data.shiftGroupId : before.shiftGroupId;
      return template({ ...before, ...args.data, shiftGroupId, shiftGroup: [PLANTA, GRANJA].find((group) => group.id === shiftGroupId) ?? null });
    });
    return before;
  }
  // Sin recálculo: no se busca quiénes usan la plantilla (primer paso,
  // determinístico, de recalculateTemplateCoverage).
  const usersOfTemplateLookup = () => (prisma as unknown as { shiftAssignment: { findMany: Mock } }).shiftAssignment.findMany;
  const expectNoRecalculation = () => {
    expect(usersOfTemplateLookup()).not.toHaveBeenCalled();
    expect(db.$transaction.mock.calls.length).toBeGreaterThan(0); // la edición sí corrió
  };

  it("asignar grupo a una plantilla sin grupo: sin recálculo de cobertura", async () => {
    givenBefore();
    const item = await workforceService.updateShiftTemplate("template-1", { shiftGroupId: PLANTA_ID });
    expect(db.shiftTemplate.findUnique).toHaveBeenCalledWith({ where: { id: "template-1" }, include: GROUP_INCLUDE });
    expect(item.shiftGroup).toEqual(PLANTA);
    expectNoRecalculation();
    expect(lastDescription()).toBe("Se actualizó el turno PL-01 - Planta 01. Grupo: sin grupo → PLANTA - Planta.");
  });

  it("cambiar de grupo", async () => {
    givenBefore({ shiftGroupId: PLANTA_ID, shiftGroup: PLANTA });
    const item = await workforceService.updateShiftTemplate("template-1", { shiftGroupId: GRANJA_ID });
    expect(item.shiftGroup).toEqual(GRANJA);
    expectNoRecalculation();
    expect(lastDescription()).toContain("Grupo: PLANTA - Planta → GRANJA - Granja.");
  });

  it("desasignar con null (sin consultar grupos)", async () => {
    givenBefore({ shiftGroupId: PLANTA_ID, shiftGroup: PLANTA });
    const item = await workforceService.updateShiftTemplate("template-1", { shiftGroupId: null });
    expect(db.shiftTemplate.update.mock.calls[0]![0].data.shiftGroupId).toBeNull();
    expect(item.shiftGroup).toBeNull();
    expect(db.shiftGroup.findUnique).not.toHaveBeenCalled();
    expectNoRecalculation();
    expect(lastDescription()).toContain("Grupo: PLANTA - Planta → sin grupo.");
  });

  it("asignar un grupo INACTIVO nuevo → 409 sin escribir", async () => {
    givenBefore();
    givenGroups({ ...PLANTA, status: "INACTIVO" as never });
    await expect(workforceService.updateShiftTemplate("template-1", { shiftGroupId: PLANTA_ID })).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_GROUP_INACTIVE" });
    expect(db.shiftTemplate.update).not.toHaveBeenCalled();
  });

  it("grupo inexistente → 404 sin escribir", async () => {
    givenBefore();
    givenGroups();
    await expect(workforceService.updateShiftTemplate("template-1", { shiftGroupId: PLANTA_ID })).rejects.toMatchObject({ statusCode: 404 });
    expect(db.shiftTemplate.update).not.toHaveBeenCalled();
  });

  it("editar otro dato de una plantilla cuyo grupo se inactivó: la plantilla sigue funcionando y conserva el grupo", async () => {
    givenBefore({ shiftGroupId: PLANTA_ID, shiftGroup: { ...PLANTA, status: "INACTIVO" } });
    givenGroups({ ...PLANTA, status: "INACTIVO" as never });
    await expect(workforceService.updateShiftTemplate("template-1", { name: "Planta Uno" })).resolves.toMatchObject({ shiftGroupId: PLANTA_ID });
    // Reenviar el mismo grupo inactivo tampoco es un cambio.
    await expect(workforceService.updateShiftTemplate("template-1", { shiftGroupId: PLANTA_ID, name: "Planta Uno" })).resolves.toMatchObject({ shiftGroupId: PLANTA_ID });
    expect(db.shiftGroup.findUnique).not.toHaveBeenCalled();
    expect(lastDescription()).toBe("Se actualizó el turno PL-01 - Planta Uno.");
  });

  it("control: cambiar el horario sí recalcula cobertura (comportamiento previo intacto)", async () => {
    givenBefore();
    await workforceService.updateShiftTemplate("template-1", { startTime: "08:00", shiftGroupId: PLANTA_ID });
    expect(usersOfTemplateLookup()).toHaveBeenCalledWith(expect.objectContaining({ where: { shiftTemplateId: "template-1" } }));
  });
});
