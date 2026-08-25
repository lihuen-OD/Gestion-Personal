import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { pendingRepository } from "./pending.repository";
import { pendingService } from "./pending.service";

vi.mock("./pending.repository", () => ({
  pendingRepository: {
    findPendingNovelties: vi.fn(),
    findPendingTimeEntries: vi.fn(),
    findPendingHourConceptBreakdowns: vi.fn(),
  },
}));

const repo = pendingRepository as unknown as {
  findPendingNovelties: Mock;
  findPendingTimeEntries: Mock;
  findPendingHourConceptBreakdowns: Mock;
};

const rrhhUser = { id: "user-rrhh", role: "NIVEL_1_RRHH" } as Express.AuthUser;

const employee = { id: "emp-1", legajo: "100", firstName: "Ana", lastName: "Gomez", sectorId: "sector-1" };

beforeEach(() => {
  vi.clearAllMocks();
  repo.findPendingNovelties.mockResolvedValue([]);
  repo.findPendingTimeEntries.mockResolvedValue([]);
  repo.findPendingHourConceptBreakdowns.mockResolvedValue([]);
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
});
