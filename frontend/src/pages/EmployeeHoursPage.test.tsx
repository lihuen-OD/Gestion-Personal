import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EmployeeHoursPage } from "./EmployeeHoursPage";
import { employeeApiService } from "../services/api/employeeApiService";
import { noveltyApiService } from "../services/api/noveltyApiService";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import { documentCategoryApiService } from "../services/api/documentCategoryApiService";
import { timeEntryApiService } from "../services/api/timeEntryApiService";
import { ApiError } from "../services/api/apiClient";
import type { Employee, Novelty } from "../types";
import type { NoveltyType } from "../types/noveltyType.types";
import type { EmployeeTimeGrid } from "../services/api/employeeApiService";
import { dayAccounting, timeGridFixture } from "../test/workedTimeAccountingFixtures";

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

function authAs(role: string, overrides: Partial<{ id: string; name: string }> = {}) {
  mockUseAuth.mockReturnValue({
    user: { id: overrides.id || "user-1", name: overrides.name || "Ana Test", email: "ana@test.com", password: "", role, status: "Activo" },
    login: vi.fn(),
    loginAs: vi.fn(),
    logout: vi.fn(),
  });
}

vi.mock("../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/employeeApiService")>();
  return {
    ...actual,
    employeeApiService: {
      ...actual.employeeApiService,
      getTimeGrid: vi.fn(),
      saveManualHourConceptBreakdown: vi.fn(),
    },
  };
});

vi.mock("../services/api/noveltyApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/noveltyApiService")>();
  return { ...actual, noveltyApiService: { ...actual.noveltyApiService, getAll: vi.fn().mockResolvedValue([]), create: vi.fn() } };
});

vi.mock("../services/api/noveltyTypeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/noveltyTypeApiService")>();
  return { ...actual, noveltyTypeApiService: { ...actual.noveltyTypeApiService, getAll: vi.fn().mockResolvedValue([]) } };
});

vi.mock("../services/api/documentApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/documentApiService")>();
  return { ...actual, documentApiService: { ...actual.documentApiService, create: vi.fn() } };
});

vi.mock("../services/api/documentCategoryApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/documentCategoryApiService")>();
  return { ...actual, documentCategoryApiService: { ...actual.documentCategoryApiService, getAll: vi.fn().mockResolvedValue([]) } };
});

vi.mock("../services/api/timeEntryApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/timeEntryApiService")>();
  return {
    ...actual,
    timeEntryApiService: {
      ...actual.timeEntryApiService,
      canReview: vi.fn(() => true),
      canEdit: vi.fn(() => true),
      save: vi.fn(),
      update: vi.fn(),
    },
  };
});

function buildEmployee(): Employee {
  return {
    id: "employee-1",
    legajo: "100",
    legajoInterno: "100",
    lastName: "Prueba",
    firstName: "Ana",
    dni: "12345678",
    cuil: "20-12345678-9",
    birthDate: "",
    gender: "",
    civilStatus: "",
    nationality: "Argentina",
    phone: "",
    mobile: "",
    email: "",
    address: "",
    addressStreet: "",
    addressNumber: "",
    city: "",
    department: "",
    province: "",
    zip: "",
    domicilio: {
      calle: "",
      numero: "",
      provinciaId: "",
      provinciaNombre: "",
      departamentoId: "",
      departamentoNombre: "",
      localidadId: "",
      localidadNombre: "",
      codigoPostal: "",
      ubicacionMapa: { lat: null, lng: null, source: "API", label: "" },
    },
    emergencyContact: "",
    emergencyRelation: "",
    emergencyPhone: "",
    company: "",
    businessUnit: "",
    establishment: "",
    costCenter: "",
    sector: "",
    position: "",
    receiptCategory: "",
    internalCategory: "",
    agreement: "",
    healthInsurance: "",
    directManager: "",
    timeResponsible: "",
    startDate: "",
    transport: false,
    transportRoute: "",
    transportNotes: "",
    enabledHours: [],
    status: "Activo",
    directManagerFrom: "",
    directManagerStatus: "",
    directManagerNotes: "",
    timeResponsibleRole: "",
    timeResponsibleFrom: "",
    timeResponsibleStatus: "",
    timeResponsibleNotes: "",
    mapLocation: "",
    locationMap: { lat: null, lng: null, source: "API", label: "" },
    novelties: [],
    documents: [],
    historyEvents: [],
    audit: [],
    routeHistory: [],
  };
}

// Fixtures del modelo de tiempo trabajado (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md):
// default = un día común (4) con base 8, Sereno 3 dentro de la jornada y
// Colectivo 1 adicional. Los valores replican lo que calcula el backend.
function buildGrid(days = [dayAccounting(4)], overrides: Partial<EmployeeTimeGrid> = {}): EmployeeTimeGrid {
  return timeGridFixture(days, { employee: buildEmployee(), ...overrides });
}

function buildNormalOnlyGrid(): EmployeeTimeGrid {
  const grid = buildGrid([]);
  return { ...grid, rows: grid.rows.filter((row) => row.role === "NORMAL_BASE") };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/horas/employee-1?period=2026-08"]}>
      <Routes>
        <Route path="/horas/:id" element={<EmployeeHoursPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// Filas de la grilla mensual (no del resumen "Composición del período", que
// también usa filas de tabla con los mismos nombres).
function rowFor(name: string) {
  const table = document.querySelector("table.monthly-concept-table") as HTMLElement | null;
  if (!table) throw new Error("No se encontró la grilla mensual");
  const row = within(table).getAllByRole("row").find((candidate) => within(candidate).queryByText(name, { selector: "b" }));
  if (!row) throw new Error(`No se encontró la fila de "${name}"`);
  return row;
}

function totalCellText(row: HTMLElement) {
  const cells = within(row).getAllByRole("cell");
  return cells[cells.length - 1]!.textContent;
}

function statCardValue(label: string) {
  const card = screen.getAllByText(label).map((element) => element.closest(".stat-card")).find(Boolean);
  if (!card) throw new Error(`No se encontró la tarjeta de estadística "${label}"`);
  // Etapa 11B: se apunta directo al <strong> (el value de StatCard) en vez de
  // getByText(/\d/) — una tarjeta con `detail` (ej. "Valor liquidable", que
  // también tiene dígitos en su detalle) rompía ese query por ambigüedad.
  return card.querySelector("strong")?.textContent ?? null;
}

function dayCellText(row: HTMLElement, dayIndex: number) {
  const buttons = within(row).getAllByRole("button");
  if (buttons[dayIndex]) return buttons[dayIndex].textContent;
  return within(row).getAllByRole("cell")[dayIndex + 1]?.textContent;
}

// La grilla ya cargó cuando aparece el encabezado de la grilla mensual.
const waitForGridLoaded = () => screen.findByText("Grilla mensual por concepto");
const LOADING_TEXT = "Preparando grilla horaria...";

beforeEach(() => {
  vi.mocked(employeeApiService.getTimeGrid).mockReset();
  vi.mocked(employeeApiService.saveManualHourConceptBreakdown).mockReset();
  vi.mocked(noveltyApiService.getAll).mockResolvedValue([]);
  vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([]);
  vi.mocked(documentCategoryApiService.getAll).mockResolvedValue([]);
  vi.mocked(timeEntryApiService.save).mockReset();
  vi.mocked(timeEntryApiService.update).mockReset();
  authAs("Nivel 1 - RRHH");
});

describe("EmployeeHoursPage — Hora normal es universal (bug: HOUR_CONCEPT_NOT_ENABLED sin conceptos adicionales)", () => {
  it("el modal 'Cargar Hora normal' permite guardar aunque el legajo no tenga ningún concepto adicional asignado", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildNormalOnlyGrid());
    vi.mocked(timeEntryApiService.save).mockResolvedValueOnce({
      id: "entry-1", employeeId: "employee-1", period: "2026-08", day: 1, type: "Hora normal", hours: 8, status: "Aprobado", conceptId: "normal",
    });
    renderPage();
    await waitForGridLoaded();

    const normalDay1 = within(rowFor("Horas base")).getAllByRole("button")[0]!;
    await user.click(normalDay1);
    expect(await screen.findByText(/Cargar Horas base/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(timeEntryApiService.save).toHaveBeenCalledTimes(1));
    expect(timeEntryApiService.save).toHaveBeenCalledWith(
      expect.objectContaining({ conceptId: "normal", hours: 8 }),
      { knownExistingId: null },
    );
    await waitFor(() => expect(screen.queryByText(/Cargar Horas base/i)).not.toBeInTheDocument());
  });

  it("no muestra 'Ese tipo de hora no esta habilitado para este legajo' al guardar Hora normal sin conceptos adicionales", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildNormalOnlyGrid());
    vi.mocked(timeEntryApiService.save).mockResolvedValueOnce({
      id: "entry-1", employeeId: "employee-1", period: "2026-08", day: 1, type: "Hora normal", hours: 8, status: "Aprobado", conceptId: "normal",
    });
    renderPage();
    await waitForGridLoaded();

    const normalDay1 = within(rowFor("Horas base")).getAllByRole("button")[0]!;
    await user.click(normalDay1);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(timeEntryApiService.save).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Ese tipo de hora no esta habilitado para este legajo.")).not.toBeInTheDocument();
  });

  it("si el backend igual rechazara la carga por otro motivo, sigue mostrando ese error tal cual (la corrección no oculta errores reales)", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildNormalOnlyGrid());
    vi.mocked(timeEntryApiService.save).mockRejectedValueOnce(new ApiError("blocked", "TIME_ENTRY_DAY_BLOCKED_BY_NOVELTY", 409));
    renderPage();
    await waitForGridLoaded();

    const normalDay1 = within(rowFor("Horas base")).getAllByRole("button")[0]!;
    await user.click(normalDay1);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Ese dia esta bloqueado por una novedad. Solo se permiten 0 hs salvo que se modifique la novedad.")).toBeInTheDocument();
  });
});

describe("EmployeeHoursPage — flujo de aprobación por rol en carga manual (Etapa 6L.3)", () => {
  it("RRHH ve una única acción 'Guardar' y no 'Enviar a revisión' en el modal de Hora normal", async () => {
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildNormalOnlyGrid());
    renderPage();
    await waitForGridLoaded();

    const normalDay1 = within(rowFor("Horas base")).getAllByRole("button")[0]!;
    await user.click(normalDay1);

    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Guardar borrador/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enviar a revisión/i })).not.toBeInTheDocument();
  });

  it("RRHH al guardar Hora normal llama a timeEntryApiService.save con estado 'Aprobado', sin encadenar un envío a revisión", async () => {
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildNormalOnlyGrid());
    vi.mocked(timeEntryApiService.save).mockResolvedValueOnce({
      id: "entry-1", employeeId: "employee-1", period: "2026-08", day: 1, type: "Hora normal", hours: 8, status: "Aprobado", conceptId: "normal",
    });
    renderPage();
    await waitForGridLoaded();

    const normalDay1 = within(rowFor("Horas base")).getAllByRole("button")[0]!;
    await user.click(normalDay1);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(timeEntryApiService.save).toHaveBeenCalledTimes(1));
    expect(timeEntryApiService.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: "Aprobado" }),
      { knownExistingId: null },
    );
  });

  it.each(["Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"])(
    "%s sigue viendo 'Guardar borrador' y 'Enviar a revisión' en el modal de Hora normal",
    async (role) => {
      const user = userEvent.setup();
      authAs(role);
      vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildNormalOnlyGrid());
      renderPage();
      await waitForGridLoaded();

      const normalDay1 = within(rowFor("Horas base")).getAllByRole("button")[0]!;
      await user.click(normalDay1);

      expect(screen.getByRole("button", { name: /Guardar borrador/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Enviar a revisión/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
    },
  );

  it("Nivel 2/3 al enviar Hora normal a revisión sigue mandando status 'En revisión' (flujo sin cambios)", async () => {
    const user = userEvent.setup();
    authAs("Nivel 2 - Supervisión / Gestión");
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildNormalOnlyGrid());
    vi.mocked(timeEntryApiService.save).mockResolvedValueOnce({
      id: "entry-1", employeeId: "employee-1", period: "2026-08", day: 1, type: "Hora normal", hours: 8, status: "En revisión", conceptId: "normal",
    });
    renderPage();
    await waitForGridLoaded();

    const normalDay1 = within(rowFor("Horas base")).getAllByRole("button")[0]!;
    await user.click(normalDay1);
    await user.click(screen.getByRole("button", { name: /Enviar a revisión/i }));

    await waitFor(() => expect(timeEntryApiService.save).toHaveBeenCalledTimes(1));
    expect(timeEntryApiService.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: "En revisión" }),
      { knownExistingId: null },
    );
  });
});

describe("EmployeeHoursPage — el botón 'Recalcular automáticos' ya no se expone en la grilla (Etapa 6L.4)", () => {
  it("no muestra el botón 'Recalcular automáticos'", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(buildGrid());
    renderPage();
    await waitForGridLoaded();
    expect(screen.queryByRole("button", { name: /Recalcular/i })).not.toBeInTheDocument();
  });

  it("un concepto AUTOMATIC sigue mostrando sus minutos (vienen de HourConceptBreakdown, no de un botón) y es solo lectura", async () => {
    const grid = buildGrid();
    grid.rows = grid.rows.map((row) => (row.concept.id === "sereno" ? { ...row, concept: { ...row.concept, loadMode: "AUTOMATIC" as const } } : row));
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(grid);
    renderPage();
    await waitForGridLoaded();
    expect(within(rowFor("Sereno")).queryAllByRole("button")).toHaveLength(0);
    expect(totalCellText(rowFor("Sereno"))).toBe("3h");
  });

  it("el concepto MANUAL (Colectivo) sigue siendo editable", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(buildGrid());
    renderPage();
    await waitForGridLoaded();
    const colectivoDay1 = within(rowFor("Colectivo")).getAllByRole("button")[0]!;
    await userEvent.setup().click(colectivoDay1);
    expect(await screen.findByText(/Cargar Colectivo/i)).toBeInTheDocument();
  });

  it("no expone 'priority' en la grilla", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(buildGrid());
    const { container } = renderPage();
    await waitForGridLoaded();
    expect(container.textContent).not.toMatch(/priority/i);
  });

  it("no expone 'countsAsWorked' en la grilla", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(buildGrid());
    const { container } = renderPage();
    await waitForGridLoaded();
    expect(container.textContent).not.toMatch(/countsAsWorked/i);
  });
});

describe("EmployeeHoursPage — actualización local sin recarga completa (Etapa 6L.4)", () => {
  it("guardar Hora normal actualiza la celda visible sin esperar un segundo getTimeGrid", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid)
      .mockResolvedValueOnce(buildGrid())
      .mockReturnValueOnce(new Promise(() => {})); // el refresh de fondo nunca resuelve: si la celda igual se actualiza, fue local.
    vi.mocked(timeEntryApiService.save).mockResolvedValueOnce({
      id: "entry-2", employeeId: "employee-1", period: "2026-08", day: 2, type: "Hora normal", hours: 5, status: "Aprobado", conceptId: "normal",
    });
    renderPage();
    await waitForGridLoaded();

    const normalDay2 = within(rowFor("Horas base")).getAllByRole("button")[1]!;
    await user.click(normalDay2);
    const hoursInput = screen.getByLabelText("Cantidad de horas");
    await user.clear(hoursInput);
    await user.type(hoursInput, "5");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByText(/Cargar Horas base/i)).not.toBeInTheDocument());
    expect(dayCellText(rowFor("Horas base"), 1)).toBe("5h");
  });

  it("guardar Horas base actualiza la celda y el total de la fila de inmediato; los totales calculados quedan 'actualizando' hasta que llega el backend", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid)
      .mockResolvedValueOnce(buildGrid())
      .mockReturnValueOnce(new Promise(() => {}));
    vi.mocked(timeEntryApiService.save).mockResolvedValueOnce({
      id: "entry-2", employeeId: "employee-1", period: "2026-08", day: 2, type: "Hora normal", hours: 5, status: "Aprobado", conceptId: "normal",
    });
    renderPage();
    await waitForGridLoaded();
    expect(statCardValue("Total trabajado")).toBe("9 h");

    const normalDay2 = within(rowFor("Horas base")).getAllByRole("button")[1]!;
    await user.click(normalDay2);
    const hoursInput = screen.getByLabelText("Cantidad de horas");
    await user.clear(hoursInput);
    await user.type(hoursInput, "5");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByText(/Cargar Horas base/i)).not.toBeInTheDocument());
    expect(totalCellText(rowFor("Horas base"))).toBe("13h");
    // El frontend no recalcula total ni Horas normales: quedan atenuados.
    expect(rowFor("Total trabajado")).toHaveClass("is-syncing");
    expect(rowFor("Horas normales")).toHaveClass("is-syncing");
    expect(document.querySelector(".hours-composition")).toHaveClass("is-syncing");
  });

  it("guardar Colectivo actualiza su celda y, al llegar la contabilidad del backend, el total trabajado pasa a 10 h (base + adicionales)", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid)
      .mockResolvedValueOnce(buildGrid())
      .mockResolvedValueOnce(buildGrid([dayAccounting(4, { colectivo: 2 })]));
    vi.mocked(employeeApiService.saveManualHourConceptBreakdown).mockResolvedValueOnce({ id: "breakdown-1" });
    renderPage();
    await waitForGridLoaded();
    expect(statCardValue("Total trabajado")).toBe("9 h");

    const colectivoDay4 = within(rowFor("Colectivo")).getAllByRole("button")[3]!;
    await user.click(colectivoDay4);
    const hoursInput = screen.getByLabelText("Cantidad de horas");
    await user.clear(hoursInput);
    await user.type(hoursInput, "2");
    await user.click(screen.getByRole("button", { name: /Guardar carga/i }));

    await waitFor(() => expect(statCardValue("Total trabajado")).toBe("10 h"));
    expect(totalCellText(rowFor("Horas base"))).toBe("8h");
    expect(rowFor("Total trabajado")).not.toHaveClass("is-syncing");
  });

  it("guardar la carga manual de un concepto actualiza su celda de inmediato sin esperar un segundo getTimeGrid", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid)
      .mockResolvedValueOnce(buildGrid())
      .mockReturnValueOnce(new Promise(() => {}));
    vi.mocked(employeeApiService.saveManualHourConceptBreakdown).mockResolvedValueOnce({ id: "breakdown-1" });
    renderPage();
    await waitForGridLoaded();

    const colectivoDay1 = within(rowFor("Colectivo")).getAllByRole("button")[0]!;
    await user.click(colectivoDay1);
    const hoursInput = screen.getByLabelText("Cantidad de horas");
    await user.clear(hoursInput);
    await user.type(hoursInput, "2");
    await user.click(screen.getByRole("button", { name: /Guardar carga/i }));

    await waitFor(() => expect(screen.queryByText(/Cargar Colectivo/i)).not.toBeInTheDocument());
    expect(dayCellText(rowFor("Colectivo"), 0)).toBe("2h");
  });

  it("no vuelve a mostrar 'Preparando grilla horaria...' después de guardar (no hay recarga completa)", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid)
      .mockResolvedValueOnce(buildGrid())
      .mockResolvedValueOnce(buildGrid()); // background refresh: si tarda, no debe mostrar el placeholder mientras tanto.
    vi.mocked(timeEntryApiService.save).mockResolvedValueOnce({
      id: "entry-2", employeeId: "employee-1", period: "2026-08", day: 2, type: "Hora normal", hours: 5, status: "Aprobado", conceptId: "normal",
    });
    renderPage();
    await waitForGridLoaded();
    expect(screen.queryByText(LOADING_TEXT)).not.toBeInTheDocument();

    const normalDay2 = within(rowFor("Horas base")).getAllByRole("button")[1]!;
    await user.click(normalDay2);
    const hoursInput = screen.getByLabelText("Cantidad de horas");
    await user.clear(hoursInput);
    await user.type(hoursInput, "5");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByText(/Cargar Horas base/i)).not.toBeInTheDocument());
    expect(screen.queryByText(LOADING_TEXT)).not.toBeInTheDocument();
    await waitFor(() => expect(employeeApiService.getTimeGrid).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(LOADING_TEXT)).not.toBeInTheDocument();
  });

  // Etapa 14I.11: el efecto de re-sincronización silenciosa (dependiente de
  // `refresh`) usaba un `useRef(false)` que se ponía en `true` en su primera
  // ejecución para "saltarse" el mount — pero bajo React.StrictMode (dev),
  // React vuelve a ejecutar ese mismo efecto una segunda vez con el MISMO
  // `refresh` inicial, y como el ref ya había quedado en `true` tras la
  // primera pasada, la segunda pasada ya no entraba a la rama de skip y
  // disparaba un tercer `getTimeGrid` espurio (confirmado con el journey de
  // Gestión Horaria: x3 en vez de x2 — ver docs/decisions/
  // TIME_GRID_DUPLICATE_REQUESTS_DIAGNOSTIC_14I11.md). Este test renderiza
  // bajo `StrictMode` explícitamente (a diferencia de `renderPage()`, que no
  // lo hace) para reproducir el double-invoke real y confirmar que, tras el
  // fix, sólo quedan los 2 llamados esperables del efecto de carga inicial
  // (Effect A, doble-invocado por StrictMode — sin costo en producción, no
  // se toca) y ninguno de más del efecto de refresh.
  it("Etapa 14I.11: bajo React.StrictMode no dispara un tercer getTimeGrid espurio al montar (x2 esperado, no x3)", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/horas/employee-1?period=2026-08"]}>
          <Routes>
            <Route path="/horas/:id" element={<EmployeeHoursPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    await waitForGridLoaded();

    await waitFor(() => expect(employeeApiService.getTimeGrid).toHaveBeenCalledTimes(2));
  });

  it("si el desglose manual falla por un conflicto concurrente, muestra un mensaje específico (no genérico)", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    vi.mocked(employeeApiService.saveManualHourConceptBreakdown).mockRejectedValueOnce(
      new ApiError("Concurrent manual breakdown update", "MANUAL_BREAKDOWN_CONCURRENT_CONFLICT", 409),
    );
    renderPage();
    await waitForGridLoaded();

    const colectivoDay1 = within(rowFor("Colectivo")).getAllByRole("button")[0]!;
    await user.click(colectivoDay1);
    const hoursInput = screen.getByLabelText("Cantidad de horas");
    await user.clear(hoursInput);
    await user.type(hoursInput, "2");
    await user.click(screen.getByRole("button", { name: /Guardar carga/i }));

    expect(await screen.findByText("Alguien más modificó esta carga al mismo tiempo. Volvé a intentar.")).toBeInTheDocument();
  });
});

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md — reemplaza los casos 11B
// (8 + 4 Sereno x2 = 24): la pantalla muestra la composición real y la
// equivalencia para liquidación que calcula el backend.
describe("EmployeeHoursPage — composición del período y Hora Especial", () => {
  it("día común: Horas base 8, Horas normales 5, Sereno 3, Colectivo 1, Total trabajado 9 — Sereno no se suma de nuevo", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    renderPage();
    await waitForGridLoaded();

    expect(statCardValue("Total trabajado")).toBe("9 h");
    expect(screen.getByText("Base 8 h + adicionales 1 h")).toBeInTheDocument();
    const composition = document.querySelector(".hours-composition") as HTMLElement;
    expect(composition).toHaveTextContent("Horas base");
    expect(composition).toHaveTextContent("Distribución de la jornada");
    expect(composition).toHaveTextContent("Horas normales5 h");
    expect(composition).toHaveTextContent("Sereno3 h");
    expect(composition).toHaveTextContent("Horas adicionales");
    expect(composition).toHaveTextContent("Colectivo1 h");
    expect(composition).toHaveTextContent("Total trabajado9 h");
    expect(totalCellText(rowFor("Horas normales"))).toBe("5h");
    expect(totalCellText(rowFor("Total trabajado"))).toBe("9h");
    expect(screen.queryByText("Equivalencia para liquidación")).not.toBeInTheDocument();
  });

  it("domingo x2 — base 8 + Sereno 3 + Colectivo 1: real 9, para liquidación 10 + 6 + 2 = 18 (nunca 22 ni 24)", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid([dayAccounting(2, { multiplier: 2 })]));
    const { container } = renderPage();
    await waitForGridLoaded();

    expect(statCardValue("Total trabajado")).toBe("9 h");
    expect(statCardValue("Para liquidación")).toBe("18 h");
    const composition = document.querySelector(".hours-composition") as HTMLElement;
    expect(composition).toHaveTextContent("Horas normales5 h10 h");
    expect(composition).toHaveTextContent("Sereno3 h6 h");
    expect(composition).toHaveTextContent("Colectivo1 h2 h");
    expect(composition).toHaveTextContent("Total trabajado · Equivalencia9 h18 h");
    expect(totalCellText(rowFor("Equivalencia para liquidación"))).toBe("18h");
    expect(container.textContent).not.toMatch(/22 h|24 h|22h|24h/);
  });

  it("copy de negocio: sin enums técnicos en la pantalla", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid([dayAccounting(2, { multiplier: 2 })]));
    const { container } = renderPage();
    await waitForGridLoaded();
    expect(container.textContent).not.toMatch(/WITHIN_BASE|ADDITIVE_TO_WORKED_TOTAL|NORMAL_BASE|HourConceptBreakdown|Valor liquidable|Desglose/);
  });

  it("el modal de Horas base muestra el aviso de Hora especial con multiplicador, regla y equivalencia del día", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid([dayAccounting(1, { multiplier: 2 })]));
    renderPage();
    await waitForGridLoaded();

    await user.click(within(rowFor("Horas base")).getAllByRole("button")[0]!);

    expect(await screen.findByText(/Hora especial aplicada.*Multiplicador x2.*Domingos/)).toBeInTheDocument();
    expect(screen.getByText(/Equivalencia del día para liquidación: 18 h \(total trabajado 9 h\)/)).toBeInTheDocument();
  });

  it("humaniza observaciones históricas y mantiene compacto el aviso administrativo", async () => {
    const user = userEvent.setup();
    const uuid = "a90b1c2d-3456-4789-8abc-def012345678";
    const grid = buildGrid([dayAccounting(1, { multiplier: 2 })]);
    grid.entries = [{
      id: "entry-1",
      employeeId: "employee-1",
      period: "2026-08",
      day: 1,
      type: "Hora normal",
      hours: 8,
      totalMinutes: 480,
      status: "Aprobado",
      conceptId: "normal",
      notes: `Fichada ${uuid}: generado por ingreso/salida. Reglas aplicadas: Domingo. Multiplicador efectivo x2 (146 min reales).`,
    }];
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(grid);
    renderPage();
    await waitForGridLoaded();

    await user.click(within(rowFor("Horas base")).getAllByRole("button")[0]!);

    expect(await screen.findByDisplayValue(/Generado automáticamente a partir de la fichada/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/2 h 26 min trabajadas/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(new RegExp(uuid))).not.toBeInTheDocument();
    expect(screen.getByText("Corrección administrativa").closest(".administrative-correction-callout")).toBeInTheDocument();
    expect(screen.getByText(/Equivalencia del día para liquidación: 18 h/)).toBeInTheDocument();
    expect(document.querySelector(".time-entry-modal-summary .context-hour-card")).toBeInTheDocument();
    expect(document.querySelector(".time-entry-modal-summary .special-hour")).toBeInTheDocument();
    expect(document.querySelector(".time-entry-modal-content > .time-entry-fields")).toBeInTheDocument();
    expect(document.querySelector(".time-entry-modal-content > .context-novelty-card")).toBeInTheDocument();
    expect(screen.getByText("Formato decimal. Equivale a 8 h.")).toBeInTheDocument();
  });

  it("el modal de Colectivo explica que suma al total y avisa la Hora Especial del día", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid([dayAccounting(1, { multiplier: 2 })]));
    renderPage();
    await waitForGridLoaded();

    await user.click(within(rowFor("Colectivo")).getAllByRole("button")[0]!);

    expect(await screen.findByText(/Hora especial aplicada.*Multiplicador x2.*Domingos/)).toBeInTheDocument();
    expect(screen.getByText(/también queda alcanzado ese día/)).toBeInTheDocument();
    expect(screen.getByText("Horas adicionales · Manual")).toBeInTheDocument();
    expect(screen.getByText(/Suma al total trabajado/)).toBeInTheDocument();
  });

  it("el modal de Sereno (dentro de la jornada, manual y automático) aclara que no suma al total y requiere horas base", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    renderPage();
    await waitForGridLoaded();

    await user.click(within(rowFor("Sereno")).getAllByRole("button")[3]!);

    expect(await screen.findByText("Dentro de la jornada · Manual y automático")).toBeInTheDocument();
    expect(screen.getByText(/No suma al total trabajado\. Reduce las horas normales de ese día y requiere horas base registradas\./)).toBeInTheDocument();
  });

  it("si el backend rechaza Sereno sin horas base, muestra su mensaje de negocio (nunca lo convierte en horas adicionales)", async () => {
    const user = userEvent.setup();
    const message = "No se puede cargar Sereno dentro de la jornada porque no hay horas base registradas para ese día.";
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    vi.mocked(employeeApiService.saveManualHourConceptBreakdown).mockRejectedValueOnce(new ApiError(message, "WITHIN_BASE_REQUIRES_BASE_HOURS", 409));
    renderPage();
    await waitForGridLoaded();

    await user.click(within(rowFor("Sereno")).getAllByRole("button")[0]!);
    const hoursInput = screen.getByLabelText("Cantidad de horas");
    await user.clear(hoursInput);
    await user.type(hoursInput, "2");
    await user.click(screen.getByRole("button", { name: /Guardar carga/i }));

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("sin Hora Especial ese día: el modal no muestra ningún aviso adicional", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    renderPage();
    await waitForGridLoaded();

    await user.click(within(rowFor("Horas base")).getAllByRole("button")[0]!);

    expect(await screen.findByText(/Cargar Horas base/i)).toBeInTheDocument();
    expect(screen.queryByText(/Hora especial aplicada/)).not.toBeInTheDocument();
  });
});

function buildBlockingNovelty(overrides: Partial<Novelty> = {}): Novelty {
  return {
    id: "novelty-1",
    employeeId: "employee-1",
    type: "Suspensión",
    from: "2026-08-05",
    to: "2026-08-05",
    quantity: "1 día",
    status: "Aprobado",
    createdBy: "Sistema",
    ...overrides,
  };
}

function buildHourlyNoveltyType(overrides: Partial<NoveltyType> = {}): NoveltyType {
  return {
    id: "type-late",
    code: "NOV-LLEGADA-TARDE",
    name: "Llegada tarde",
    uiColor: "amber",
    kind: "HORARIA",
    description: "Ingreso posterior al horario previsto.",
    status: "ACTIVO",
    rules: {
      exportsToFinnegans: false,
      requiresApproval: false,
      requiresDocumentation: false,
      allowsHours: true,
      timeEntryBehavior: "NO_BLOQUEA",
      allowsDateRange: false,
      finnegansValueUnit: "HOURS",
      finnegansRequiresValidity: false,
    },
    allowedLoadRoles: ["Nivel 1 - RRHH"],
    approvalRoles: ["Nivel 1 - RRHH"],
    finnegansCode: null,
    finnegansName: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    createdBy: "Sistema",
    updatedBy: "Sistema",
    ...overrides,
  };
}

describe("EmployeeHoursPage — estado de novedad en el modal (Etapa 15M.10)", () => {
  async function openNormalDayOne() {
    renderPage();
    await waitForGridLoaded();
    await userEvent.click(within(rowFor("Horas base")).getAllByRole("button")[0]!);
    await screen.findByText(/Cargar Horas base/i);
  }

  it("muestra un estado vacío cuando no hay selección ni detección", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    await openNormalDayOne();
    expect(screen.getByLabelText("Tipo de novedad")).toHaveValue("");
    expect(screen.getByText("No hay novedad asociada a esta hora.")).toBeInTheDocument();
    expect(screen.queryByText("Detección del sistema")).not.toBeInTheDocument();
  });

  it("distingue una detección existente de una novedad seleccionada", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    vi.mocked(noveltyApiService.getAll).mockResolvedValue([
      buildBlockingNovelty({
        type: "Llegada tarde",
        from: "2026-08-01",
        to: "2026-08-01",
        quantity: "1h",
        timeEntryBehavior: "NO_BLOQUEA",
        targetHourConceptName: "Hora normal",
      }),
    ]);
    await openNormalDayOne();
    expect(screen.getByLabelText("Tipo de novedad")).toHaveValue("");
    expect(screen.getByText("Detección del sistema")).toBeInTheDocument();
    expect(screen.getByText("Duración estimada: 1h")).toBeInTheDocument();
    expect(screen.getByText(/no queda asociada automáticamente/i)).toBeInTheDocument();
    expect(document.querySelector(".context-novelty-card .cell-novelty-pill")).not.toBeInTheDocument();
  });

  it("muestra la novedad aplicada y permite volver a Sin novedad", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildHourlyNoveltyType()]);
    await openNormalDayOne();

    const selector = await screen.findByLabelText("Tipo de novedad");
    await user.selectOptions(selector, "type-late");
    expect(screen.getByText("Novedad asociada", { selector: ".hour-novelty-eyebrow" })).toBeInTheDocument();
    expect(screen.getByText("Duración: 1h")).toBeInTheDocument();
    expect(screen.getByText(/Se asociará únicamente a esta fila/i)).toBeInTheDocument();

    await user.selectOptions(selector, "");
    expect(screen.getByText("No hay novedad asociada a esta hora.")).toBeInTheDocument();
    expect(screen.queryByText(/Se asociará únicamente a esta fila/i)).not.toBeInTheDocument();
  });

  it("mantiene legible un nombre y una duración largos", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([
      buildHourlyNoveltyType({ name: "Llegada tarde con justificación administrativa pendiente de revisión" }),
    ]);
    await openNormalDayOne();
    await user.selectOptions(await screen.findByLabelText("Tipo de novedad"), "type-late");
    const noveltyHoursInput = screen.getAllByLabelText("Cantidad de horas")[1]!;
    await user.clear(noveltyHoursInput);
    await user.type(noveltyHoursInput, "26.8667");
    expect(screen.getByText("26h 52m", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/justificación administrativa pendiente/i, { selector: ".hour-novelty-state b" })).toBeInTheDocument();
  });
});

// Etapa 15L.2C (docs/decisions/NOVELTY_TYPE_CONSUMER_MIGRATION_15L2C.md):
// isBlocked/conceptNovelties usan timeEntryBehavior como única fuente.
describe("EmployeeHoursPage — bloqueo por novedad vía timeEntryBehavior (Etapa 15L.2C)", () => {
  it("timeEntryBehavior=BLOQUEA_NUEVA_CARGA bloquea la celda de Hora normal ese día", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    vi.mocked(noveltyApiService.getAll).mockResolvedValue([
      buildBlockingNovelty({ timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" }),
    ]);
    renderPage();
    await waitForGridLoaded();

    const day5 = within(rowFor("Horas base")).getByTitle("0 h · Suspensión");
    expect(day5.className).toContain("blocked");
    expect(within(day5).getByText("0m")).toBeInTheDocument();
  });

  it("timeEntryBehavior=NO_BLOQUEA no bloquea la celda", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    vi.mocked(noveltyApiService.getAll).mockResolvedValue([
      buildBlockingNovelty({ timeEntryBehavior: "NO_BLOQUEA" }),
    ]);
    renderPage();
    await waitForGridLoaded();

    // Día 5 = 5to botón de la fila (sin bloqueo y sin concepto destino, la
    // novedad no aparece en el título -- conceptNovelties la filtra fuera
    // de "Hora normal", comportamiento correcto y sin cambios de esta etapa).
    const day5 = within(rowFor("Horas base")).getAllByRole("button")[4]!;
    expect(day5.className).not.toContain("blocked");
    expect(within(day5).getByText("+")).toBeInTheDocument();
  });
});
