import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { pendingRepository } from "./pending.repository";
import { pendingService } from "./pending.service";

vi.mock("./pending.repository", () => ({
  pendingRepository: {
    findPendingNovelties: vi.fn(),
    findPendingTimeEntries: vi.fn(),
    findPendingHourConceptBreakdowns: vi.fn(),
    countPendingNovelties: vi.fn(),
    countPendingTimeEntries: vi.fn(),
    countPendingHourConceptBreakdowns: vi.fn(),
  },
}));

const repo = pendingRepository as unknown as {
  findPendingNovelties: Mock;
  findPendingTimeEntries: Mock;
  findPendingHourConceptBreakdowns: Mock;
  countPendingNovelties: Mock;
  countPendingTimeEntries: Mock;
  countPendingHourConceptBreakdowns: Mock;
};

const rrhhUser = { id: "user-rrhh", role: "NIVEL_1_RRHH" } as Express.AuthUser;

const employee = { id: "emp-1", legajo: "100", firstName: "Ana", lastName: "Gomez", sectorId: "sector-1" };

beforeEach(() => {
  vi.clearAllMocks();
  repo.findPendingNovelties.mockResolvedValue([]);
  repo.findPendingTimeEntries.mockResolvedValue([]);
  repo.findPendingHourConceptBreakdowns.mockResolvedValue([]);
  // Por default los counts coinciden con lo que devuelve cada find (dataset
  // chico); los tests de totales reales los sobrescriben.
  repo.countPendingNovelties.mockImplementation(async (...args: unknown[]) => (await repo.findPendingNovelties(...args)).length);
  repo.countPendingTimeEntries.mockImplementation(async (...args: unknown[]) => (await repo.findPendingTimeEntries(...args)).length);
  repo.countPendingHourConceptBreakdowns.mockImplementation(async (...args: unknown[]) => (await repo.findPendingHourConceptBreakdowns(...args)).length);
});

describe("pendingService.list — bandeja de revisión incluye desgloses manuales EN_REVISION (Etapa 6L.3)", () => {
  it("una carga de Nivel 2/3 en EN_REVISION (TimeEntry) aparece en la bandeja de RRHH", async () => {
    repo.findPendingTimeEntries.mockResolvedValue([{
      id: "entry-1", status: "EN_REVISION", date: new Date("2026-08-10T00:00:00Z"), createdAt: new Date("2026-08-10T00:00:00Z"),
      employee, hourConcept: { id: "normal", code: "HC-NORMAL", name: "Hora normal" }, hours: { toString: () => "8" },
    }]);

    const result = await pendingService.list({ kind: "all", take: 100 } as never, rrhhUser);

    expect(result.summary).toMatchObject({ total: 1, novelties: 0, timeEntries: 1, hourConceptBreakdowns: 0 });
    expect(result.data[0]).toMatchObject({ kind: "timeEntry", sourceId: "entry-1" });
  });

  it("un desglose manual de Nivel 2/3 en EN_REVISION aparece en la bandeja de RRHH como 'hourConceptBreakdown'", async () => {
    repo.findPendingHourConceptBreakdowns.mockResolvedValue([{
      id: "breakdown-1", status: "EN_REVISION", date: new Date("2026-08-12T00:00:00Z"), createdAt: new Date("2026-08-12T00:00:00Z"),
      minutes: 120, employee, hourConcept: { id: "colectivo", code: "HC-COLECTIVO", name: "Colectivo" },
    }]);

    const result = await pendingService.list({ kind: "all", take: 100 } as never, rrhhUser);

    expect(result.summary).toMatchObject({ total: 1, hourConceptBreakdowns: 1 });
    expect(result.data[0]).toMatchObject({ kind: "hourConceptBreakdown", sourceId: "breakdown-1", title: "Colectivo", quantity: "2.00" });
  });

  it("un desglose aprobado directamente por RRHH nunca llega acá (la consulta ya filtra EN_REVISION, esto sólo confirma que la agregación no inventa datos)", async () => {
    repo.findPendingHourConceptBreakdowns.mockResolvedValue([]);

    const result = await pendingService.list({ kind: "all", take: 100 } as never, rrhhUser);

    expect(result.summary.hourConceptBreakdowns).toBe(0);
    expect(result.data).toHaveLength(0);
  });

  it("kind=novelties no consulta ni TimeEntry ni HourConceptBreakdown", async () => {
    await pendingService.list({ kind: "novelties", take: 100 } as never, rrhhUser);

    expect(repo.findPendingTimeEntries).not.toHaveBeenCalled();
    expect(repo.findPendingHourConceptBreakdowns).not.toHaveBeenCalled();
    expect(repo.findPendingNovelties).toHaveBeenCalled();
  });

  it("novedades, cargas y desgloses pendientes se combinan y ordenan por fecha", async () => {
    repo.findPendingNovelties.mockResolvedValue([{
      id: "nov-1", status: "PENDIENTE", fromDate: new Date("2026-08-15T00:00:00Z"), createdAt: new Date("2026-08-15T00:00:00Z"),
      employee, noveltyType: { id: "nt-1", code: "NOV-VAC", name: "Vacaciones" }, targetHourConcept: null, quantityHours: null, quantityDays: { toString: () => "1" },
    }]);
    repo.findPendingTimeEntries.mockResolvedValue([{
      id: "entry-1", status: "EN_REVISION", date: new Date("2026-08-05T00:00:00Z"), createdAt: new Date("2026-08-05T00:00:00Z"),
      employee, hourConcept: { id: "normal", code: "HC-NORMAL", name: "Hora normal" }, hours: { toString: () => "8" },
    }]);
    repo.findPendingHourConceptBreakdowns.mockResolvedValue([{
      id: "breakdown-1", status: "EN_REVISION", date: new Date("2026-08-10T00:00:00Z"), createdAt: new Date("2026-08-10T00:00:00Z"),
      minutes: 60, employee, hourConcept: { id: "colectivo", code: "HC-COLECTIVO", name: "Colectivo" },
    }]);

    const result = await pendingService.list({ kind: "all", take: 100 } as never, rrhhUser);

    expect(result.summary).toMatchObject({ total: 3, novelties: 1, timeEntries: 1, hourConceptBreakdowns: 1 });
    expect(result.data.map((item) => item.kind)).toEqual(["timeEntry", "hourConceptBreakdown", "novelty"]);
  });

  it("cada ítem expone employeeId (Etapa 6L.5): el frontend lo necesita para armar la URL de aprobar/rechazar/devolver un desglose manual", async () => {
    repo.findPendingTimeEntries.mockResolvedValue([{
      id: "entry-1", status: "EN_REVISION", date: new Date("2026-08-10T00:00:00Z"), createdAt: new Date("2026-08-10T00:00:00Z"),
      employee, hourConcept: { id: "normal", code: "HC-NORMAL", name: "Hora normal" }, hours: { toString: () => "8" },
    }]);
    repo.findPendingHourConceptBreakdowns.mockResolvedValue([{
      id: "breakdown-1", status: "EN_REVISION", date: new Date("2026-08-12T00:00:00Z"), createdAt: new Date("2026-08-12T00:00:00Z"),
      minutes: 120, employee, hourConcept: { id: "colectivo", code: "HC-COLECTIVO", name: "Colectivo" },
    }]);

    const result = await pendingService.list({ kind: "all", take: 100 } as never, rrhhUser);

    expect(result.data.every((item) => item.employeeId === "emp-1")).toBe(true);
    expect(result.data[0]).not.toHaveProperty("employee");
  });
});

describe("pendingService.list — sin truncado silencioso", () => {
  it("el summary informa el total real aunque se traiga una sola página", async () => {
    repo.findPendingNovelties.mockResolvedValue([]);
    repo.countPendingNovelties.mockResolvedValue(340);

    const result = await pendingService.list({ kind: "novelties", page: 2, take: 25 } as never, rrhhUser);

    expect(result.summary).toMatchObject({ total: 340, novelties: 340 });
    expect(result.meta).toEqual({ total: 340, page: 2, pageSize: 25, hasMore: true });
    expect(repo.findPendingNovelties).toHaveBeenCalledWith(expect.objectContaining({ page: 2, take: 25 }), expect.anything());
  });

  it("kind=hourConceptBreakdowns pagina sólo desgloses", async () => {
    repo.countPendingHourConceptBreakdowns.mockResolvedValue(3);

    const result = await pendingService.list({ kind: "hourConceptBreakdowns", page: 1, take: 25 } as never, rrhhUser);

    expect(repo.findPendingNovelties).not.toHaveBeenCalled();
    expect(repo.findPendingTimeEntries).not.toHaveBeenCalled();
    expect(result.meta).toEqual({ total: 3, page: 1, pageSize: 25, hasMore: false });
  });

  it("kinds combinados siempre consultan la página 1 de cada fuente y marcan hasMore cuando hay más", async () => {
    repo.countPendingNovelties.mockResolvedValue(400);

    const result = await pendingService.list({ kind: "all", page: 3, take: 100 } as never, rrhhUser);

    expect(repo.findPendingNovelties).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }), expect.anything());
    expect(result.meta).toMatchObject({ total: 400, page: 1, hasMore: true });
  });
});
