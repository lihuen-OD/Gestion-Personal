import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { auditRepository } from "./audit.repository";
import type { ListAuditQuery } from "./audit.schemas";

// Etapa 14C.2 (ampliada): findMany() pasó de prisma.$transaction([...]) a
// Promise.all([...]) para dejar de forzar que el listado y el conteo del
// historial de auditoría (usado por la pestaña "Historial de Eventos" de
// Legajos) corran en serie por la misma conexión. Estos tests confirman que
// el resultado, el filtrado y la paginación no cambiaron.
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    auditLog: { findMany: vi.fn(), count: vi.fn() },
  },
}));

const mockedPrisma = prisma as unknown as { auditLog: { findMany: Mock; count: Mock } };

function baseQuery(overrides: Partial<ListAuditQuery> = {}): ListAuditQuery {
  return { page: 1, take: 100, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.auditLog.findMany.mockResolvedValue([]);
  mockedPrisma.auditLog.count.mockResolvedValue(0);
});

describe("auditRepository.findMany", () => {
  it("devuelve [registros, total] igual que antes (misma forma de respuesta)", async () => {
    const rows = [{ id: "audit-1" }, { id: "audit-2" }];
    mockedPrisma.auditLog.findMany.mockResolvedValue(rows);
    mockedPrisma.auditLog.count.mockResolvedValue(2);

    const result = await auditRepository.findMany(baseQuery());

    expect(result).toEqual([rows, 2]);
  });

  it("filtra por entityId — no mezcla el historial de un legajo con el de otro", async () => {
    await auditRepository.findMany(baseQuery({ entityId: "employee-1" }));

    expect(mockedPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entityId: "employee-1" } }),
    );
    expect(mockedPrisma.auditLog.count).toHaveBeenCalledWith({ where: { entityId: "employee-1" } });
  });

  it("no filtra por campos ausentes en el query (entity/userId/action opcionales)", async () => {
    await auditRepository.findMany(baseQuery({ entityId: "employee-1" }));

    const [{ where }] = mockedPrisma.auditLog.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(where).not.toHaveProperty("entity");
    expect(where).not.toHaveProperty("userId");
    expect(where).not.toHaveProperty("action");
  });

  it("pagina con skip/take calculados a partir de page/take", async () => {
    await auditRepository.findMany(baseQuery({ page: 3, take: 20 }));

    expect(mockedPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 20 }),
    );
  });

  it("mantiene el orden por fecha descendente y el include del usuario autor", async () => {
    await auditRepository.findMany(baseQuery());

    expect(mockedPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      }),
    );
  });

  it("ya no usa prisma.$transaction (findMany y count corren como llamadas independientes al pool)", async () => {
    await auditRepository.findMany(baseQuery());

    expect(mockedPrisma).not.toHaveProperty("$transaction");
    expect(mockedPrisma.auditLog.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.auditLog.count).toHaveBeenCalledTimes(1);
  });
});
