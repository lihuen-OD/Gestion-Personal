import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AttendancePage } from "./AttendancePage";
import { attendanceApiService, type AttendanceInactivityIncident, type AttendanceObservation, type AttendanceShift, type AttendanceSummary } from "../services/api/attendanceApiService";
import { employeeApiService } from "../services/api/employeeApiService";
import { noveltyApiService } from "../services/api/noveltyApiService";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import { hourConceptApiService } from "../services/api/hourConceptApiService";
import type { NoveltyType } from "../types/noveltyType.types";

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

// Etapa 15G.2 (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md): mocks para el
// flujo "Crear novedad" desde una observación de asistencia.
// employeeApiService se mockea sólo para poder afirmar que NUNCA se llama
// (ver "evitar over-fetching" más abajo) -- la observación ya trae los
// datos mínimos del empleado, no hace falta ningún fetch adicional.
vi.mock("../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/employeeApiService")>();
  return { ...actual, employeeApiService: { ...actual.employeeApiService, getById: vi.fn() } };
});
vi.mock("../services/api/noveltyApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/noveltyApiService")>();
  return { ...actual, noveltyApiService: { ...actual.noveltyApiService, create: vi.fn() } };
});
vi.mock("../services/api/noveltyTypeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/noveltyTypeApiService")>();
  return { ...actual, noveltyTypeApiService: { ...actual.noveltyTypeApiService, getAll: vi.fn() } };
});
vi.mock("../services/api/hourConceptApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/hourConceptApiService")>();
  return { ...actual, hourConceptApiService: { ...actual.hourConceptApiService, getAll: vi.fn().mockResolvedValue([]) } };
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

function buildInactivityIncident(overrides: Partial<AttendanceInactivityIncident> = {}): AttendanceInactivityIncident {
  return {
    id: "incident-1",
    employeeId: "employee-1",
    operationalDate: "2026-08-27",
    status: "PENDIENTE",
    observation: "El legajo no registró fichadas, jornadas ni horas cargadas el 27/08/2026.",
    detectedAt: "2026-08-28T09:00:00.000Z",
    employee: { id: "employee-1", legajo: "100", dni: "30111222", firstName: "Ana", lastName: "Gomez", status: "ACTIVO" },
    ...overrides,
  };
}

function buildGenericActiveType(): NoveltyType {
  return {
    id: "type-vacaciones",
    code: "NOV-VACACIONES",
    name: "Vacaciones",
    uiColor: "blue",
    kind: "VACACIONES",
    origin: "INTERNA",
    description: "",
    status: "ACTIVO",
    rules: {
      exportsToFinnegans: false,
      requiresApproval: true,
      requiresDocumentation: false,
      allowsHours: false,
      allowsDateTo: true,
      hasValidity: false,
      blocksTimeEntry: false,
      setsWorkedHoursToZero: false,
      timeImpact: "NO_AFECTA_HORAS",
    },
    allowedLoadRoles: [],
    approvalRoles: [],
    finnegansLinks: [],
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    updatedBy: "",
    history: [],
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

describe("AttendancePage — Etapa 14G.3 (refresh silencioso de Problemas de fichada)", () => {
  it("muestra el loading grande sólo en la carga inicial de Problemas de fichada, cuando todavía no hay observaciones en pantalla", async () => {
    vi.mocked(attendanceApiService.getSummary).mockResolvedValue(buildSummary());
    let resolveObservations!: (value: { data: AttendanceObservation[]; meta: { total: number; pageSize: number; hasMore: boolean; nextBefore: string | null } }) => void;
    vi.mocked(attendanceApiService.getObservations).mockReturnValue(new Promise((resolve) => { resolveObservations = resolve; }));

    renderPage();
    await screen.findByText("Gomez, Ana");
    expect(document.querySelectorAll(".skeleton-bar").length).toBeGreaterThan(0);

    resolveObservations({ data: [], meta: { total: 0, pageSize: 10, hasMore: false, nextBefore: null } });
    await waitFor(() => expect(document.querySelectorAll(".skeleton-bar").length).toBe(0));
  });

  it("cambiar el filtro 'Mostrar' no blanquea la tabla de problemas de fichada mientras llega la respuesta nueva", async () => {
    vi.mocked(attendanceApiService.getSummary).mockResolvedValue(buildSummary());
    const firstObservation: AttendanceObservation = {
      kind: "SHIFT",
      occurredAt: "2026-08-27T20:00:00.000Z",
      shift: buildShift({
        id: "shift-obs-1",
        status: "OBSERVADO",
        reviewStatus: "PENDIENTE",
        employee: { id: "employee-3", legajo: "300", dni: "30777666", firstName: "Marta", lastName: "Diaz", status: "ACTIVO" },
      }),
    };
    vi.mocked(attendanceApiService.getObservations).mockResolvedValueOnce({
      data: [firstObservation],
      meta: { total: 1, pageSize: 10, hasMore: false, nextBefore: null },
    });

    renderPage();
    await screen.findByText("Diaz, Marta");
    expect(document.querySelectorAll(".skeleton-bar").length).toBe(0);

    let resolveObservations!: (value: { data: AttendanceObservation[]; meta: { total: number; pageSize: number; hasMore: boolean; nextBefore: string | null } }) => void;
    vi.mocked(attendanceApiService.getObservations).mockReturnValue(new Promise((resolve) => { resolveObservations = resolve; }));

    fireEvent.change(screen.getByLabelText("Mostrar"), { target: { value: "SHIFT" } });
    await waitFor(() => expect(attendanceApiService.getObservations).toHaveBeenCalledTimes(2));

    // Mientras la respuesta del nuevo filtro está en vuelo, la fila anterior
    // sigue visible (no se reemplaza por el skeleton de carga completo).
    expect(screen.getByText("Diaz, Marta")).toBeInTheDocument();
    expect(document.querySelectorAll(".skeleton-bar").length).toBe(0);

    resolveObservations({ data: [], meta: { total: 0, pageSize: 10, hasMore: false, nextBefore: null } });
    await waitFor(() => expect(screen.queryByText("Diaz, Marta")).not.toBeInTheDocument());
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

async function findModalScope() {
  // NoveltyFromContextModal muestra "Crear novedad desde alerta" mientras
  // resuelve el legajo (breve, síncrono en los mocks de test) y "Nueva
  // novedad" (el título propio de NoveltyModal) una vez resuelto -- se
  // espera directamente por el título final para no correr contra un
  // estado transitorio que ya pasó.
  const heading = await screen.findByText("Nueva novedad");
  return within(heading.closest(".modal") as HTMLElement);
}

// Etapa 15G.2 (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md): "Crear
// novedad" desde una observación de asistencia (ausencia/falta de
// fichada) -- mismo endpoint/flujo normal de creación, sin efecto sobre
// TimeEntry ni cambio de estado de la observación.
describe("AttendancePage — Etapa 15G.2 (crear novedad desde alerta/observación de asistencia)", () => {
  it("una incidencia de inactividad (ausencia) muestra el botón 'Crear novedad'", async () => {
    vi.mocked(attendanceApiService.getSummary).mockResolvedValueOnce(buildSummary({ totals: { open: 0, closed: 0, observed: 1, workedHours: 0 }, openShifts: [] }));
    vi.mocked(attendanceApiService.getObservations).mockResolvedValueOnce({
      data: [{ kind: "INACTIVITY", occurredAt: "2026-08-27T00:00:00.000Z", incident: buildInactivityIncident() }],
      meta: { total: 1, pageSize: 10, hasMore: false, nextBefore: null },
    });

    renderPage();

    expect(await screen.findByRole("button", { name: "Crear novedad" })).toBeInTheDocument();
  });

  // Ajuste (evitar over-fetching, docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md):
  // la incidencia ya trae id/legajo/nombre/apellido del empleado -- el
  // modal abre precargado sin ninguna llamada de red adicional.
  it("click en 'Crear novedad' de una ausencia abre NoveltyModal precargado con fecha y observación de la incidencia, SIN llamar a employeeApiService.getById", async () => {
    vi.mocked(attendanceApiService.getSummary).mockResolvedValueOnce(buildSummary({ totals: { open: 0, closed: 0, observed: 1, workedHours: 0 }, openShifts: [] }));
    vi.mocked(attendanceApiService.getObservations).mockResolvedValueOnce({
      data: [{ kind: "INACTIVITY", occurredAt: "2026-08-27T00:00:00.000Z", incident: buildInactivityIncident() }],
      meta: { total: 1, pageSize: 10, hasMore: false, nextBefore: null },
    });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildGenericActiveType()]);

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Crear novedad" }));

    const modal = await findModalScope();
    await waitFor(() => expect(modal.getByLabelText("Desde")).toHaveValue("2026-08-27"));
    // Ausencia no tiene NoveltyType "Ausencia" seedeado garantizado -> sin
    // tipo sugerido, cae al primer tipo activo (mismo comportamiento de
    // siempre, sin romper).
    expect(modal.getByLabelText("Tipo de novedad")).toHaveValue("type-vacaciones");
    expect(modal.getByText(/Origen: alerta del fichador/)).toBeInTheDocument();
    expect(modal.getByText(/no registró fichadas/)).toBeInTheDocument();
    expect(modal.queryByText(/incident-1/)).not.toBeInTheDocument();
    expect(employeeApiService.getById).not.toHaveBeenCalled();
  });

  it("una jornada con falta de fichada (SHIFT) también muestra 'Crear novedad', con una observación humana sin id técnico de la jornada", async () => {
    vi.mocked(attendanceApiService.getSummary).mockResolvedValueOnce(buildSummary({ totals: { open: 0, closed: 0, observed: 1, workedHours: 0 }, openShifts: [] }));
    vi.mocked(attendanceApiService.getObservations).mockResolvedValueOnce({
      data: [{ kind: "SHIFT", occurredAt: "2026-08-27T20:00:00.000Z", shift: buildShift({ id: "shift-falta-salida", status: "FALTA_SALIDA", reviewStatus: "PENDIENTE" }) }],
      meta: { total: 1, pageSize: 10, hasMore: false, nextBefore: null },
    });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildGenericActiveType()]);

    renderPage();
    await screen.findByText("Falta registrar la salida");
    await userEvent.click(screen.getByRole("button", { name: "Crear novedad" }));

    const modal = await findModalScope();
    expect(modal.getByText(/Origen: alerta del fichador/)).toBeInTheDocument();
    expect(modal.queryByText(/shift-falta-salida/)).not.toBeInTheDocument();
  });

  it("guardar la novedad precargada usa el flujo normal de creación y no cambia el estado de la observación", async () => {
    vi.mocked(attendanceApiService.getSummary).mockResolvedValueOnce(buildSummary({ totals: { open: 0, closed: 0, observed: 1, workedHours: 0 }, openShifts: [] }));
    vi.mocked(attendanceApiService.getObservations).mockResolvedValueOnce({
      data: [{ kind: "INACTIVITY", occurredAt: "2026-08-27T00:00:00.000Z", incident: buildInactivityIncident() }],
      meta: { total: 1, pageSize: 10, hasMore: false, nextBefore: null },
    });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildGenericActiveType()]);
    vi.mocked(noveltyApiService.create).mockResolvedValue([{ id: "novelty-1" } as never]);
    const resolveObservationSpy = vi.spyOn(attendanceApiService, "resolveObservation");

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Crear novedad" }));
    const modal = await findModalScope();
    await userEvent.click(modal.getByRole("button", { name: "Guardar novedad" }));

    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(
      expect.objectContaining({ employeeIds: ["employee-1"], noveltyTypeId: "type-vacaciones" }),
    ));
    await screen.findByText("Novedad creada. RRHH la revisa como cualquier otra novedad.");
    expect(resolveObservationSpy).not.toHaveBeenCalled();
    expect(employeeApiService.getById).not.toHaveBeenCalled();
    resolveObservationSpy.mockRestore();
  });
});
