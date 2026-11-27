import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HolidayWorkAssignmentDialog } from "./HolidayWorkAssignmentDialog";
import {
  holidayWorkAssignmentApiService,
  type HolidayWorkAssignmentCandidate,
} from "../../services/api/holidayWorkAssignmentApiService";
import { ApiError, formatApiErrorMessage } from "../../services/api/apiClient";
import { workforceApiService } from "../../services/api/workforceApiService";
import { orgStructureApiService } from "../../services/api/orgStructureApiService";

vi.mock("../../services/api/holidayWorkAssignmentApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api/holidayWorkAssignmentApiService")>();
  return {
    ...actual,
    holidayWorkAssignmentApiService: {
      getHolidayDates: vi.fn(),
      getCandidates: vi.fn(),
      getAssignmentsByDate: vi.fn(),
      saveAssignments: vi.fn(),
    },
  };
});

vi.mock("../../services/api/workforceApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api/workforceApiService")>();
  return { ...actual, workforceApiService: { ...actual.workforceApiService, shiftTemplates: vi.fn() } };
});

vi.mock("../../services/api/orgStructureApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api/orgStructureApiService")>();
  return { ...actual, orgStructureApiService: { ...actual.orgStructureApiService, getCatalog: vi.fn() } };
});

const catalog = {
  companies: [],
  businessUnits: [],
  establishments: [],
  areas: [],
  // Pañol es un sector del modelo anterior (isLegacy persistido → pendingReload);
  // Agricultura, del nuevo.
  sectors: [{ id: "sector-panol", code: "PAN", name: "Pañol", status: "ACTIVO" as const, pendingReload: true }, { id: "sector-agro", code: "AGR", name: "Agricultura", status: "ACTIVO" as const, businessUnitId: "bu-1", pendingReload: false }],
  zones: [{ id: "zone-north", code: "ZN", name: "Zona Norte", status: "ACTIVO" as const }],
  costCenters: [],
};

const shiftTemplates = [
  { id: "template-manana", code: "MAN", name: "Turno mañana", categoryName: null, startTime: "06:00", endTime: "14:00", crossesMidnight: false, entryToleranceBeforeMinutes: 10, entryToleranceAfterMinutes: 10, exitToleranceBeforeMinutes: 20, exitToleranceAfterMinutes: 20, absoluteOpenShiftLimitMinutes: 1200, status: "ACTIVO" },
];

function candidate(overrides: Partial<HolidayWorkAssignmentCandidate> = {}): HolidayWorkAssignmentCandidate {
  return {
    id: "employee-1",
    legajo: "100",
    firstName: "Juan",
    lastName: "Pérez",
    status: "ACTIVO",
    // §20: turno REAL del feriado (fijo vigente ese día).
    expectedSchedule: { kind: "FIXED", blocks: [{ templateId: "template-manana", code: "MAN", name: "Turno mañana", startTime: "06:00", endTime: "14:00" }], planReason: null },
    ...overrides,
  };
}

const close = vi.fn();
const onSaved = vi.fn();

// El diálogo no depende del rol: Nivel 1, 2 y 3 convocan; el backend filtra
// los candidatos y valida el alcance del guardado.
function renderPage(canCorrectClosedPeriods = true) {
  return render(<HolidayWorkAssignmentDialog initialMonth="2026-08" canCorrectClosedPeriods={canCorrectClosedPeriods} close={close} onSaved={onSaved} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue(catalog as never);
  vi.mocked(workforceApiService.shiftTemplates).mockResolvedValue(shiftTemplates as never);
  vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockResolvedValue([]);
  vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 300, hasMore: false } });
  vi.mocked(holidayWorkAssignmentApiService.getAssignmentsByDate).mockResolvedValue({ date: "2026-08-27", assignments: [] });
  vi.mocked(holidayWorkAssignmentApiService.saveAssignments).mockResolvedValue([]);
});

describe("Gestionar feriados (HolidayWorkAssignmentDialog) — Etapa 12D + §20", () => {
  it("1 — empty state cuando el mes no tiene feriados; arranca en el mes de la grilla", async () => {
    renderPage();
    expect(await screen.findByText("No hay feriados en este mes.")).toBeInTheDocument();
    expect(holidayWorkAssignmentApiService.getHolidayDates).toHaveBeenCalledWith("2026-08-01", "2026-08-31");
    expect(screen.getByText("Elegí un feriado para ver o cargar quiénes deben trabajarlo.")).toBeInTheDocument();
  });

  it("2 — lista los feriados disponibles del mes", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockResolvedValue([
      { date: "2026-08-27", rules: [{ id: "rule-1", name: "Feriados" }] },
    ]);
    renderPage();
    expect(await screen.findByRole("button", { name: /jue.*27 ago/i })).toBeInTheDocument();
  });

  it("3 — seleccionar una fecha abre el panel de convocatoria", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockResolvedValue([{ date: "2026-08-27", rules: [{ id: "rule-1", name: "Feriados" }] }]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /jue.*27 ago/i }));

    expect(await screen.findByRole("heading", { name: /Convocatoria — Jueves, 27 de agosto de 2026/i })).toBeInTheDocument();
    expect(holidayWorkAssignmentApiService.getAssignmentsByDate).toHaveBeenCalledWith("2026-08-27");
    // El franco del día viaja con los candidatos (date).
    await waitFor(() => expect(holidayWorkAssignmentApiService.getCandidates).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-08-27" })));
  });

  async function openFirstDate(user: ReturnType<typeof userEvent.setup>, canCorrectClosedPeriods = true) {
    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockResolvedValue([{ date: "2026-08-27", rules: [{ id: "rule-1", name: "Feriados" }] }]);
    renderPage(canCorrectClosedPeriods);
    await user.click(await screen.findByRole("button", { name: /jue.*27 ago/i }));
    await screen.findByRole("heading", { name: /Convocatoria — / });
  }

  it("4 — ve a los empleados candidatos de la fecha elegida", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);

    expect(await screen.findByText("Pérez, Juan")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("Turno fijo: MAN 06:00–14:00", { selector: "td" })).toBeInTheDocument();
  });

  it("5 — filtrar por turno pide candidatos con shiftTemplateId", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    await user.selectOptions(screen.getByLabelText("Turno"), "template-manana");

    await waitFor(() => expect(holidayWorkAssignmentApiService.getCandidates).toHaveBeenCalledWith(expect.objectContaining({ shiftTemplateId: "template-manana" })));
  });

  it("6 — no ofrece filtro ni columna de sector anterior: M2 retiró el sector del legajo", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    expect(screen.queryByLabelText("Sector anterior")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Sector anterior" })).toBeNull();
    expect(holidayWorkAssignmentApiService.getCandidates).not.toHaveBeenCalledWith(expect.objectContaining({ sectorId: expect.anything() }));
  });

  it("6b — filtrar por zona pide candidatos con la ubicación vigente el día del feriado (A7)", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    await user.selectOptions(screen.getByLabelText("Zona (vigente ese día)"), "zone-north");

    await waitFor(() => expect(holidayWorkAssignmentApiService.getCandidates).toHaveBeenLastCalledWith(expect.objectContaining({ locationZoneId: "zone-north", locationDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })));
  });

  it("7 — activar 'Mostrar empleados sin turno' pide candidatos con withoutShift", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate({ id: "employee-2", expectedSchedule: { kind: "NONE", blocks: [], planReason: null } })], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    await user.click(screen.getByLabelText("Mostrar empleados sin turno"));

    await waitFor(() => expect(holidayWorkAssignmentApiService.getCandidates).toHaveBeenCalledWith(expect.objectContaining({ withoutShift: true })));
  });

  it("8 — buscar empleado pide candidatos con el término de búsqueda (debounced)", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    await user.type(screen.getByPlaceholderText("Buscar por nombre o legajo"), "Pedro");

    await waitFor(() => expect(holidayWorkAssignmentApiService.getCandidates).toHaveBeenCalledWith(expect.objectContaining({ search: "Pedro" })), { timeout: 2000 });
  });

  it("9 — seleccionar un empleado lo marca como convocado", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    const checkbox = screen.getByLabelText(/Trabaja este feriado — Pérez, Juan/i) as HTMLInputElement;
    await user.click(checkbox);

    expect(checkbox.checked).toBe(true);
    expect(screen.getByText("1 seleccionado")).toBeInTheDocument();
  });

  it("10 — seleccionar todos los visibles marca a todos los candidatos cargados", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({
      items: [candidate(), candidate({ id: "employee-2", legajo: "200", firstName: "Ana", lastName: "Gómez" })],
      meta: { total: 2, page: 1, pageSize: 300, hasMore: false },
    });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    await user.click(screen.getByRole("button", { name: "Seleccionar todos los visibles" }));

    expect((screen.getByLabelText(/Trabaja este feriado — Pérez, Juan/i) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Trabaja este feriado — Gómez, Ana/i) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("2 seleccionados")).toBeInTheDocument();
  });

  it("11 — deseleccionar visibles desmarca a los candidatos actualmente filtrados", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");
    await user.click(screen.getByRole("button", { name: "Seleccionar todos los visibles" }));
    expect((screen.getByLabelText(/Trabaja este feriado — Pérez, Juan/i) as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole("button", { name: "Deseleccionar visibles" }));

    expect((screen.getByLabelText(/Trabaja este feriado — Pérez, Juan/i) as HTMLInputElement).checked).toBe(false);
  });

  it("12 — guardar cambios manda el payload correcto (altas ACTIVA + bajas CANCELADA)", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({
      items: [candidate(), candidate({ id: "employee-2", legajo: "200", firstName: "Ana", lastName: "Gómez", expectedSchedule: { kind: "NONE", blocks: [], planReason: null } })],
      meta: { total: 2, page: 1, pageSize: 300, hasMore: false },
    });
    // employee-2 ya estaba convocado antes — al desmarcarlo debe viajar como CANCELADA.
    vi.mocked(holidayWorkAssignmentApiService.getAssignmentsByDate).mockResolvedValue({
      date: "2026-08-27",
      assignments: [{ id: "hwa-1", date: "2026-08-27", employeeId: "employee-2", status: "ACTIVA", shiftTemplateId: null, expectedStartTime: null, expectedEndTime: null, notes: null, createdAt: "", updatedAt: "", employee: { id: "employee-2", legajo: "200", firstName: "Ana", lastName: "Gómez", status: "ACTIVO" } }],
    });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    // employee-2 arranca marcado (ya convocado) — lo desmarco. employee-1 lo marco de nuevo.
    await user.click(screen.getByLabelText(/Trabaja este feriado — Gómez, Ana/i));
    await user.click(screen.getByLabelText(/Trabaja este feriado — Pérez, Juan/i));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(holidayWorkAssignmentApiService.saveAssignments).toHaveBeenCalled());
    const [date, payload] = vi.mocked(holidayWorkAssignmentApiService.saveAssignments).mock.calls[0]!;
    expect(date).toBe("2026-08-27");
    expect(payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: "employee-1", status: "ACTIVA" }),
      expect.objectContaining({ employeeId: "employee-2", status: "CANCELADA" }),
    ]));
  });

  it("13 — al recargar, muestra como marcados a los empleados ya convocados guardados para esa fecha", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    vi.mocked(holidayWorkAssignmentApiService.getAssignmentsByDate).mockResolvedValue({
      date: "2026-08-27",
      assignments: [{ id: "hwa-1", date: "2026-08-27", employeeId: "employee-1", status: "ACTIVA", shiftTemplateId: "template-manana", expectedStartTime: "08:00", expectedEndTime: "16:00", notes: "Convocado", createdAt: "", updatedAt: "", employee: { id: "employee-1", legajo: "100", firstName: "Juan", lastName: "Pérez", status: "ACTIVO" } }],
    });
    const user = userEvent.setup();
    await openFirstDate(user);

    const checkbox = await screen.findByLabelText(/Trabaja este feriado — Pérez, Juan/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("14 — el copy explica la regla (§20) sin lenguaje técnico ni prometer el multiplicador por convocar", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockResolvedValue([{ date: "2026-08-27", rules: [{ id: "rule-1", name: "Feriados" }] }]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /jue.*27 ago/i }));
    await screen.findByRole("heading", { name: /Convocatoria — / });

    expect(screen.getByRole("dialog", { name: "Gestionar feriados" })).toBeInTheDocument();
    expect(screen.getByText(/La convocatoria define quién debe trabajar el feriado/i)).toBeInTheDocument();
    expect(screen.getByText(/Quien trabaje sin estar convocado cobra igual el valor del feriado si la regla lo alcanza\./i)).toBeInTheDocument();
    expect(screen.queryByText(/se aplica sólo a ellos|se recalculan/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/DoubleHourRule|kind|enum|schema|backend|\bAPI\b/i)).not.toBeInTheDocument();
  });

  it("15a — loading state mientras cargan los feriados", async () => {
    let resolveDates!: (value: never[]) => void;
    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockReturnValue(new Promise((resolve) => { resolveDates = resolve; }));
    renderPage();

    expect(screen.getByText("Cargando feriados...")).toBeInTheDocument();
    resolveDates([]);
    await screen.findByText("No hay feriados en este mes.");
  });

  it("15b — error state con reintento si falla la carga de feriados", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("No pudimos cargar los feriados de este mes.")).toBeInTheDocument();

    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockResolvedValue([{ date: "2026-08-27", rules: [{ id: "rule-1", name: "Feriados" }] }]);
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("button", { name: /jue.*27 ago/i })).toBeInTheDocument();
  });

  it("15c — error state con reintento si falla la carga de candidatos", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    await openFirstDate(user);

    expect(await screen.findByText("No pudimos cargar los empleados candidatos.")).toBeInTheDocument();

    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Pérez, Juan")).toBeInTheDocument();
  });

  it("16 — siempre editable (Nivel 1, 2 y 3): checkboxes, acciones rápidas y guardado; sin candidatos, habla del alcance", async () => {
    const user = userEvent.setup();
    await openFirstDate(user);

    expect(await screen.findByText("No hay personas activas en tu alcance.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seleccionar todos los visibles" })).toBeInTheDocument();
  });

  it("17 — con franco ese día no se puede convocar (checkbox bloqueado con motivo) y 'seleccionar visibles' lo saltea", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({
      items: [candidate(), candidate({ id: "employee-2", legajo: "200", firstName: "Ana", lastName: "Gómez", dayOff: true })],
      meta: { total: 2, page: 1, pageSize: 300, hasMore: false },
    });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Gómez, Ana");

    const blocked = screen.getByLabelText(/Trabaja este feriado — Gómez, Ana/i) as HTMLInputElement;
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAttribute("title", expect.stringContaining("cancelá el franco primero"));
    expect(screen.getByText("Franco")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Seleccionar todos los visibles" }));
    expect(blocked.checked).toBe(false);
    expect(screen.getByText("1 seleccionado")).toBeInTheDocument();
  });

  it("18 — un convocado que además tiene franco (dato previo) se puede desconvocar", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate({ dayOff: true })], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    vi.mocked(holidayWorkAssignmentApiService.getAssignmentsByDate).mockResolvedValue({
      date: "2026-08-27",
      assignments: [{ id: "hwa-1", date: "2026-08-27", employeeId: "employee-1", status: "ACTIVA", shiftTemplateId: null, expectedStartTime: null, expectedEndTime: null, notes: null, createdAt: "", updatedAt: "", employee: { id: "employee-1", legajo: "100", firstName: "Juan", lastName: "Pérez", status: "ACTIVO" } }],
    });
    const user = userEvent.setup();
    await openFirstDate(user);

    const checkbox = await screen.findByLabelText(/Trabaja este feriado — Pérez, Juan/i) as HTMLInputElement;
    expect(checkbox).not.toBeDisabled();
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(holidayWorkAssignmentApiService.saveAssignments).toHaveBeenCalledWith("2026-08-27", [{ employeeId: "employee-1", status: "CANCELADA" }], null));
  });

  it("19 — al guardar avisa a la grilla (onSaved); un legajo fuera del alcance muestra el error del servidor y no avisa", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const payload = { error: { code: "EMPLOYEE_SCOPE_FORBIDDEN", message: "Employee not found or outside your scope" } };
    vi.mocked(holidayWorkAssignmentApiService.saveAssignments).mockRejectedValueOnce(new ApiError(formatApiErrorMessage(payload), "EMPLOYEE_SCOPE_FORBIDDEN", 403, payload));
    const user = userEvent.setup();
    await openFirstDate(user);
    await user.click(await screen.findByLabelText(/Trabaja este feriado — Pérez, Juan/i));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Convocatoria guardada correctamente.")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("21 — período cerrado para Nivel 2/3: fila bloqueada con motivo (ni marcar ni desmarcar ni editar)", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate({ periodLocked: true }), candidate({ id: "employee-2", legajo: "200", firstName: "Ana", lastName: "Gómez" })], meta: { total: 2, page: 1, pageSize: 300, hasMore: false } });
    vi.mocked(holidayWorkAssignmentApiService.getAssignmentsByDate).mockResolvedValue({
      date: "2026-08-27",
      assignments: [{ id: "hwa-1", date: "2026-08-27", employeeId: "employee-1", status: "ACTIVA", shiftTemplateId: null, expectedStartTime: null, expectedEndTime: null, notes: "Guardia", createdAt: "", updatedAt: "", employee: { id: "employee-1", legajo: "100", firstName: "Juan", lastName: "Pérez", status: "ACTIVO" } }],
    });
    const user = userEvent.setup();
    await openFirstDate(user, false);

    const locked = await screen.findByLabelText(/Trabaja este feriado — Pérez, Juan/i) as HTMLInputElement;
    expect(locked).toBeDisabled();
    expect(locked.checked).toBe(true);
    expect(locked).toHaveAttribute("title", expect.stringContaining("sólo RRHH puede corregirlo"));
    expect(screen.queryByLabelText(/Observación — Pérez, Juan/i)).not.toBeInTheDocument();
    expect(screen.getByText("Guardia")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Deseleccionar todos" }));
    expect(locked.checked).toBe(true);
    expect(screen.queryByLabelText(/Motivo de la corrección/i)).not.toBeInTheDocument();
  });

  it("22 — período cerrado para RRHH: pide el motivo y lo envía", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate({ periodLocked: true })], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user, true);

    await user.click(await screen.findByLabelText(/Trabaja este feriado — Pérez, Juan/i));
    const reason = screen.getByLabelText(/Motivo de la corrección/i);
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Indicá el motivo de la corrección");
    expect(holidayWorkAssignmentApiService.saveAssignments).not.toHaveBeenCalled();

    await user.type(reason, "Pedido de planta");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(holidayWorkAssignmentApiService.saveAssignments).toHaveBeenCalledWith("2026-08-27", [expect.objectContaining({ employeeId: "employee-1", status: "ACTIVA" })], "Pedido de planta"));
  });

  // §20 (D9, defecto de Planta): nunca se autocompleta un turno; el turno del día es el real y,
  // sin turno resoluble, la plantilla es obligatoria antes de llamar al backend.
  it("23 — turno real por tipo y sin autocompletar: marcar no elige plantilla; 'El turno del día' cuando hay turno", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({
      items: [
        candidate(),
        candidate({ id: "e-rot", legajo: "201", lastName: "Rotación", expectedSchedule: { kind: "ROTATION_SHIFTS", blocks: [{ templateId: "t1", code: "PLANTA-17-03", name: null, startTime: "17:00", endTime: "03:00" }], planReason: null } }),
        candidate({ id: "e-rest", legajo: "202", lastName: "Descanso", expectedSchedule: { kind: "ROTATION_REST", blocks: [], planReason: null } }),
        candidate({ id: "e-conf", legajo: "203", lastName: "Conflicto", expectedSchedule: { kind: "ROTATION_CONFLICT", blocks: [], planReason: "OVERLAPPING_BLOCKS" } }),
      ],
      meta: { total: 4, page: 1, pageSize: 300, hasMore: false },
    });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Rotación: PLANTA-17-03 17:00–03:00");
    expect(screen.getByText("Descanso de su rotación")).toBeInTheDocument();
    expect(screen.getByText("Conflicto en su rotación: Los bloques del día se superponen")).toBeInTheDocument();

    await user.click(screen.getByLabelText(/Trabaja este feriado — Pérez, Juan/i));
    const select = screen.getByLabelText(/Turno de la convocatoria — Pérez, Juan/i) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(within(select).getByRole("option", { name: "El turno del día" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(holidayWorkAssignmentApiService.saveAssignments).toHaveBeenCalledWith("2026-08-27", [expect.objectContaining({ employeeId: "employee-1", shiftTemplateId: null })], null));
  });

  it("24 — descanso o conflicto sin plantilla: no guarda y pide el turno; al elegirlo, guarda con la plantilla", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({
      items: [candidate({ id: "e-rest", legajo: "202", firstName: "Eva", lastName: "Descanso", expectedSchedule: { kind: "ROTATION_REST", blocks: [], planReason: null } })],
      meta: { total: 1, page: 1, pageSize: 300, hasMore: false },
    });
    const user = userEvent.setup();
    await openFirstDate(user);
    await user.click(await screen.findByLabelText(/Trabaja este feriado — Descanso, Eva/i));
    const select = screen.getByLabelText(/Turno de la convocatoria — Descanso, Eva/i);
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(within(select).getByRole("option", { name: "Elegí un turno" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Descanso, Eva no tiene turno ese día: elegí el turno de la convocatoria.");
    expect(holidayWorkAssignmentApiService.saveAssignments).not.toHaveBeenCalled();

    await user.selectOptions(select, "template-manana");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(holidayWorkAssignmentApiService.saveAssignments).toHaveBeenCalledWith("2026-08-27", [expect.objectContaining({ employeeId: "e-rest", shiftTemplateId: "template-manana" })], null));
  });

  it("25 — el aviso de conflicto de rotación devuelto por el servidor se muestra al guardar", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    vi.mocked(holidayWorkAssignmentApiService.saveAssignments).mockResolvedValueOnce([{ employeeId: "employee-1", scheduleWarning: "La rotación tiene un conflicto ese día (los bloques del día se superponen); rige el turno de la convocatoria.", employee: { id: "employee-1", legajo: "100", firstName: "Juan", lastName: "Pérez", status: "ACTIVO" } } as never]);
    const user = userEvent.setup();
    await openFirstDate(user);
    await user.click(await screen.findByLabelText(/Trabaja este feriado — Pérez, Juan/i));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Pérez, Juan: La rotación tiene un conflicto ese día");
  });

  it("26 — Nivel 2/3 sin grupos de turnos (catálogo vacío): puede elegir los turnos de su gente y ve el guardado por su nombre", async () => {
    vi.mocked(workforceApiService.shiftTemplates).mockResolvedValue([]);
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({
      items: [
        candidate({ id: "e-rot", legajo: "201", lastName: "Rotación", expectedSchedule: { kind: "ROTATION_SHIFTS", blocks: [{ templateId: "pl-m", code: "PL-07-17", name: null, startTime: "07:00", endTime: "17:00" }], planReason: null } }),
        candidate({ id: "e-rest", legajo: "202", firstName: "Eva", lastName: "Descanso", expectedSchedule: { kind: "ROTATION_REST", blocks: [], planReason: null } }),
      ],
      meta: { total: 2, page: 1, pageSize: 300, hasMore: false },
    });
    vi.mocked(holidayWorkAssignmentApiService.getAssignmentsByDate).mockResolvedValue({
      date: "2026-08-27",
      assignments: [{ id: "hwa-1", date: "2026-08-27", employeeId: "e-rot", status: "ACTIVA", shiftTemplateId: "guardia", expectedStartTime: null, expectedEndTime: null, notes: null, createdAt: "", updatedAt: "", employee: { id: "e-rot", legajo: "201", firstName: "Juan", lastName: "Rotación", status: "ACTIVO" }, shiftTemplate: { id: "guardia", code: "GUARDIA", name: "Guardia de feriado" } }],
    });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Rotación: PL-07-17 07:00–17:00");

    expect((screen.getByLabelText(/Turno de la convocatoria — Rotación, Juan/i) as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("GUARDIA · Guardia de feriado");
    await user.click(screen.getByLabelText(/Trabaja este feriado — Descanso, Eva/i));
    const select = screen.getByLabelText(/Turno de la convocatoria — Descanso, Eva/i);
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["Elegí un turno", "GUARDIA · Guardia de feriado", "PL-07-17 07:00–17:00"]);
    await user.selectOptions(select, "pl-m");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(holidayWorkAssignmentApiService.saveAssignments).toHaveBeenCalledWith("2026-08-27", expect.arrayContaining([expect.objectContaining({ employeeId: "e-rest", shiftTemplateId: "pl-m" })]), null));
  });

  it("20 — cerrar el diálogo llama a close", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  // fix/holiday-work-assignment-performance: la detección de cambios mira
  // también los campos editables, no sólo quiénes están convocados.
  describe("detección de cambios en los datos de la convocatoria", () => {
    const saved = {
      id: "hwa-1", date: "2026-08-27", employeeId: "employee-1", status: "ACTIVA" as const, shiftTemplateId: "template-manana", expectedStartTime: "08:00", expectedEndTime: "16:00", notes: "Convocado",
      createdAt: "", updatedAt: "", employee: { id: "employee-1", legajo: "100", firstName: "Juan", lastName: "Pérez", status: "ACTIVO" },
    };
    const openWithSavedAssignment = async () => {
      vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
      vi.mocked(holidayWorkAssignmentApiService.getAssignmentsByDate).mockResolvedValue({ date: "2026-08-27", assignments: [saved] });
      const user = userEvent.setup();
      await openFirstDate(user);
      await screen.findByDisplayValue("Convocado");
      return user;
    };
    const save = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    it("sin tocar nada informa que no hay cambios y no llama al backend", async () => {
      const user = await openWithSavedAssignment();
      await save(user);

      expect(await screen.findByText("No hay cambios para guardar.")).toBeInTheDocument();
      expect(holidayWorkAssignmentApiService.saveAssignments).not.toHaveBeenCalled();
    });

    it("cambiar sólo la observación de un convocado habilita el guardado y la envía con el resto de sus datos", async () => {
      const user = await openWithSavedAssignment();
      const notes = screen.getByLabelText(/Observación — Pérez, Juan/i);
      await user.clear(notes);
      await user.type(notes, "Llega 10:00");
      await save(user);

      await waitFor(() => expect(holidayWorkAssignmentApiService.saveAssignments).toHaveBeenCalledTimes(1));
      expect(vi.mocked(holidayWorkAssignmentApiService.saveAssignments).mock.calls[0]![1]).toEqual([
        { employeeId: "employee-1", status: "ACTIVA", shiftTemplateId: "template-manana", expectedStartTime: "08:00", expectedEndTime: "16:00", notes: "Llega 10:00" },
      ]);
    });

    // §20: el horario libre ya no se edita (no define la jornada); el guardado lo conserva y lo muestra informativo.
    it("cambiar sólo el turno de la convocatoria habilita el guardado y conserva el horario anterior", async () => {
      const user = await openWithSavedAssignment();
      expect(screen.queryByLabelText(/Horario desde/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Horario anterior \(informativo\): 08:00–16:00/)).toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText(/Turno de la convocatoria — Pérez, Juan/i), "");
      await save(user);

      await waitFor(() => expect(holidayWorkAssignmentApiService.saveAssignments).toHaveBeenCalledTimes(1));
      expect(vi.mocked(holidayWorkAssignmentApiService.saveAssignments).mock.calls[0]![1]).toEqual([expect.objectContaining({ employeeId: "employee-1", shiftTemplateId: null, expectedStartTime: "08:00", expectedEndTime: "16:00" })]);
    });

    it("una edición que vuelve al valor guardado (o sólo agrega espacios) no cuenta como cambio", async () => {
      const user = await openWithSavedAssignment();
      const notes = screen.getByLabelText(/Observación — Pérez, Juan/i);
      await user.clear(notes);
      await user.type(notes, "  Convocado  ");
      await save(user);

      expect(await screen.findByText("No hay cambios para guardar.")).toBeInTheDocument();
      expect(holidayWorkAssignmentApiService.saveAssignments).not.toHaveBeenCalled();
    });

    it("después de guardar una edición, la nueva versión pasa a ser la guardada", async () => {
      const user = await openWithSavedAssignment();
      const notes = screen.getByLabelText(/Observación — Pérez, Juan/i);
      await user.clear(notes);
      await user.type(notes, "Llega 10:00");
      await save(user);
      expect(await screen.findByText("Convocatoria guardada correctamente.")).toBeInTheDocument();

      await save(user);
      expect(await screen.findByText("No hay cambios para guardar.")).toBeInTheDocument();
      expect(holidayWorkAssignmentApiService.saveAssignments).toHaveBeenCalledTimes(1);
    });

    it("si el guardado vence (TRANSACTION_TIMEOUT) informa que no se guardó, conserva lo editado y no reintenta solo", async () => {
      const payload = { error: { code: "TRANSACTION_TIMEOUT", message: "Transaction already closed" } };
      vi.mocked(holidayWorkAssignmentApiService.saveAssignments).mockRejectedValueOnce(new ApiError(formatApiErrorMessage(payload), "TRANSACTION_TIMEOUT", 503, payload));
      const user = await openWithSavedAssignment();
      const notes = screen.getByLabelText(/Observación — Pérez, Juan/i);
      await user.clear(notes);
      await user.type(notes, "Llega 10:00");
      await save(user);

      expect(await screen.findByRole("alert")).toHaveTextContent("No se guardó ningún cambio");
      expect(screen.getByLabelText(/Observación — Pérez, Juan/i)).toHaveValue("Llega 10:00");
      expect((screen.getByLabelText(/Trabaja este feriado — Pérez, Juan/i) as HTMLInputElement).checked).toBe(true);
      expect(holidayWorkAssignmentApiService.saveAssignments).toHaveBeenCalledTimes(1);

      // El reintento es manual y sigue detectando el cambio pendiente.
      await save(user);
      await waitFor(() => expect(holidayWorkAssignmentApiService.saveAssignments).toHaveBeenCalledTimes(2));
    });
  });
});
