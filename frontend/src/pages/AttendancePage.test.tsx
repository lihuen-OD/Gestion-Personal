import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AttendancePage } from "./AttendancePage";
import { attendanceApiService, type AttendanceObservation, type AttendanceShift, type AttendanceSummary } from "../services/api/attendanceApiService";

vi.mock("../services/api/attendanceApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/attendanceApiService")>();
  return {
    ...actual,
    attendanceApiService: {
      ...actual.attendanceApiService,
      getSummary: vi.fn(),
      getObservations: vi.fn(),
    },
  };
});

function buildShift(overrides: Partial<AttendanceShift> = {}): AttendanceShift {
  return {
    id: "shift-1",
    employeeId: "employee-1",
    source: "APP",
    status: "ABIERTO",
    startAt: "2026-08-27T12:00:00.000Z",
    workedMinutes: 120,
    workedHours: 2,
    crossesMidnight: false,
    employee: { id: "employee-1", legajo: "100", dni: "30111222", firstName: "Ana", lastName: "Gomez", status: "ACTIVO" },
    timeSegments: [],
    timeEntries: [],
    ...overrides,
  };
}

function buildSummary(overrides: Partial<AttendanceSummary> = {}): AttendanceSummary {
  return {
    date: "2026-08-27",
    totals: { open: 1, closed: 0, observed: 0, workedHours: 2 },
    openShifts: [buildShift()],
    closedShifts: [],
    observedShifts: [],
    observedPunches: [],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AttendancePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(attendanceApiService.getObservations).mockResolvedValue({ data: [], meta: { total: 0, pageSize: 10, hasMore: false, nextBefore: null } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AttendancePage — Etapa 9B (refresh silencioso del poll de 60s)", () => {
  it("muestra el loading grande en la carga inicial, cuando todavía no hay resumen en pantalla", async () => {
    let resolveSummary!: (value: AttendanceSummary) => void;
    vi.mocked(attendanceApiService.getSummary).mockReturnValue(new Promise((resolve) => { resolveSummary = resolve; }));

    renderPage();

    expect(document.querySelectorAll(".skeleton-bar").length).toBeGreaterThan(0);

    resolveSummary(buildSummary());
    await screen.findByText("Gomez, Ana");
    expect(document.querySelectorAll(".skeleton-bar").length).toBe(0);
  });

  it("el refresh automático de 60s no blanquea las tablas ni pierde la fecha filtrada", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(attendanceApiService.getSummary).mockResolvedValueOnce(buildSummary());

    renderPage();
    await vi.waitFor(() => expect(screen.getByText("Gomez, Ana")).toBeInTheDocument());

    // El input de fecha principal (sin aria-label propio, sólo un ícono) es
    // el primer <input type="date"> del documento — el segundo es el filtro
    // de la lista de observaciones, con su propio aria-label.
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    const dateBeforePoll = dateInput.value;
    expect(dateBeforePoll).toBeTruthy();

    let resolvePoll!: (value: AttendanceSummary) => void;
    vi.mocked(attendanceApiService.getSummary).mockReturnValue(new Promise((resolve) => { resolvePoll = resolve; }));

    vi.advanceTimersByTime(60_000);
    await vi.waitFor(() => expect(attendanceApiService.getSummary).toHaveBeenCalledTimes(2));

    // Mientras la respuesta del poll está en vuelo, la fila anterior sigue
    // visible (no se reemplaza por el skeleton de carga completo) y la
    // fecha elegida por el usuario no se pierde.
    expect(screen.getByText("Gomez, Ana")).toBeInTheDocument();
    expect(document.querySelectorAll(".skeleton-bar").length).toBe(0);
    expect(dateInput.value).toBe(dateBeforePoll);

    resolvePoll(buildSummary({ openShifts: [buildShift({ id: "shift-2", employee: { id: "employee-2", legajo: "200", dni: "30999888", firstName: "Luis", lastName: "Perez", status: "ACTIVO" } })] }));

    await vi.waitFor(() => expect(screen.getByText("Perez, Luis")).toBeInTheDocument());
  });
});

describe("AttendancePage — Etapa 10E (traducción de problemas de fichada, sin enums crudos)", () => {
  it("una jornada con status FALTA_SALIDA se muestra como 'Falta registrar la salida', nunca como el enum crudo", async () => {
    vi.mocked(attendanceApiService.getSummary).mockResolvedValueOnce(buildSummary({ totals: { open: 0, closed: 0, observed: 1, workedHours: 0 }, openShifts: [] }));
    const observation: AttendanceObservation = {
      kind: "SHIFT",
      occurredAt: "2026-08-27T20:00:00.000Z",
      shift: buildShift({ id: "shift-falta-salida", status: "FALTA_SALIDA", reviewStatus: "PENDIENTE" }),
    };
    vi.mocked(attendanceApiService.getObservations).mockResolvedValueOnce({
      data: [observation],
      meta: { total: 1, pageSize: 10, hasMore: false, nextBefore: null },
    });

    renderPage();

    await screen.findByText("Falta registrar la salida");
    expect(screen.queryByText(/FALTA_SALIDA/)).not.toBeInTheDocument();
    expect(screen.queryByText(/FALTA SALIDA/)).not.toBeInTheDocument();
  });
});
