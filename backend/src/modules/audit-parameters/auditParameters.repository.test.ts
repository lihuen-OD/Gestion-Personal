import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { auditParametersRepository } from "./auditParameters.repository";

/**
 * Trazabilidad de autoria (2026-08-18), decision para AuditParameter (opcion 2):
 * createdBy/updatedBy pasan a ser createdByUserId/updatedByUserId (FK real,
 * puede quedar en null) mas createdByUserName/updatedByUserName (snapshot de
 * texto). create/update deben escribir ambos a partir del usuario autenticado,
 * y dejar los campos en undefined (no un valor inventado) cuando no hay usuario.
 */
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    auditParameter: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const mockedPrisma = prisma as unknown as { auditParameter: { create: Mock; update: Mock; findMany: Mock; count: Mock }; $transaction: Mock };

function baseCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    code: "AUD-100",
    name: "Parametro test",
    scope: "LEGAJO",
    severity: "INFO",
    status: "ACTIVO",
    description: "Descripcion",
    trackCreate: true,
    trackUpdate: true,
    trackDeleteOrDeactivate: false,
    trackApproval: false,
    trackExport: false,
    requiresReason: false,
    requiresEffectiveDate: false,
    visibleToRoles: ["Nivel 1 - RRHH"],
    notification: { enabled: false, rolesToNotify: ["Nivel 1 - RRHH"], notifyOnCreate: false, notifyOnUpdate: true, notifyOnDeleteOrDeactivate: true, notifyOnExport: false },
    retention: { amount: 1, unit: "ANIOS", lockAfterClose: false, allowExport: true },
    history: [],
    ...overrides,
  } as Parameters<typeof auditParametersRepository.create>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Etapa 14H.6: findMany no tenía ningún test dedicado hasta esta etapa —
// agregado al corregir el $transaction que hasta ahora se usaba SIEMPRE
// (sin rama alternativa sin filtros, a diferencia de hourConcepts/
// documentCategories) — ver auditParameters.repository.ts.
describe("auditParametersRepository.findMany — Etapa 14H.6", () => {
  it("pagina con Promise.all([findMany, count]) — sin $transaction", async () => {
    mockedPrisma.auditParameter.findMany.mockResolvedValue([]);
    mockedPrisma.auditParameter.count.mockResolvedValue(0);

    await auditParametersRepository.findMany({ page: 2, take: 10 } as never);

    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPrisma.auditParameter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
    expect(mockedPrisma.auditParameter.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.any(Object) }));
  });

  it("arma el where con scope/severity/status/requiresReason/search", async () => {
    mockedPrisma.auditParameter.findMany.mockResolvedValue([]);
    mockedPrisma.auditParameter.count.mockResolvedValue(0);

    await auditParametersRepository.findMany({ scope: "LEGAJO", severity: "CRITICO", status: "ACTIVO", requiresReason: true, search: "acceso", page: 1, take: 50 } as never);

    const call = mockedPrisma.auditParameter.findMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ scope: "LEGAJO", severity: "CRITICO", status: "ACTIVO", requiresReason: true });
    expect(call.where.OR).toEqual(
      expect.arrayContaining([{ code: { contains: "acceso", mode: "insensitive" } }]),
    );
  });
});

describe("auditParametersRepository.create", () => {
  it("escribe createdByUserId/createdByUserName y updatedByUserId/updatedByUserName desde el usuario autenticado", async () => {
    mockedPrisma.auditParameter.create.mockResolvedValue({ id: "param-1" });

    await auditParametersRepository.create(baseCreateInput(), { id: "user-1", name: "Ana Gomez" });

    const data = mockedPrisma.auditParameter.create.mock.calls.at(0)?.[0]?.data;
    expect(data).toMatchObject({
      createdByUserId: "user-1",
      createdByUserName: "Ana Gomez",
      updatedByUserId: "user-1",
      updatedByUserName: "Ana Gomez",
    });
  });

  it("sin usuario (accion de sistema) no inventa un id: queda undefined, no un valor de texto en la columna de FK", async () => {
    mockedPrisma.auditParameter.create.mockResolvedValue({ id: "param-1" });

    await auditParametersRepository.create(baseCreateInput());

    const data = mockedPrisma.auditParameter.create.mock.calls.at(0)?.[0]?.data;
    expect(data?.createdByUserId).toBeUndefined();
    expect(data?.createdByUserName).toBeUndefined();
  });
});

describe("auditParametersRepository.update", () => {
  it("escribe solo updatedByUserId/updatedByUserName, no toca los campos de creacion", async () => {
    mockedPrisma.auditParameter.update.mockResolvedValue({ id: "param-1" });

    await auditParametersRepository.update("param-1", { name: "Nuevo nombre" }, { id: "user-2", name: "Luis Diaz" });

    const data = mockedPrisma.auditParameter.update.mock.calls.at(0)?.[0]?.data;
    expect(data).toMatchObject({ updatedByUserId: "user-2", updatedByUserName: "Luis Diaz" });
    expect(data).not.toHaveProperty("createdByUserId");
    expect(data).not.toHaveProperty("createdByUserName");
  });
});
