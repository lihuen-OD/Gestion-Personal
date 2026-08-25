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
import type { Employee } from "../types";
import type { EmployeeTimeGrid, EmployeeTimeGridRow } from "../services/api/employeeApiService";

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

function buildRows(serenoMinutes: number): EmployeeTimeGridRow[] {
  const base = { createdAt: "2026-01-01", updatedAt: "2026-01-01" };
  return [
    {
      concept: { ...base, id: "normal", code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", status: "ACTIVO", loadMode: null, systemRole: "NORMAL_BASE" },
      role: "NORMAL_BASE",
      minutesByDay: { "1": 480 },
      totalMinutes: 480,
    },
    {
      concept: { ...base, id: "sereno", code: "HC-SERENO", name: "Sereno", kind: "SERENO", status: "ACTIVO", loadMode: "AUTOMATIC", systemRole: null },
      role: "ADDITIONAL",
      minutesByDay: { "1": serenoMinutes },
      totalMinutes: serenoMinutes,
    },
    {
      concept: { ...base, id: "colectivo", code: "HC-COLECTIVO", name: "Colectivo", kind: "TRANSPORTE", status: "ACTIVO", loadMode: "MANUAL", systemRole: null },
      role: "ADDITIONAL",
      minutesByDay: {},
      totalMinutes: 0,
    },
  ];
}

function buildGrid(serenoMinutes = 360): EmployeeTimeGrid {
  return {
    employee: buildEmployee(),
    entries: [],
    novelties: [],
    noveltyTypes: [],
    hourConcepts: [],
    rows: buildRows(serenoMinutes),
    totalWorkedMinutes: 480,
    attendanceIssues: 0,
  };
}

function buildNormalOnlyGrid(): EmployeeTimeGrid {
  const base = { createdAt: "2026-01-01", updatedAt: "2026-01-01" };
  return {
    employee: buildEmployee(),
    entries: [],
    novelties: [],
    noveltyTypes: [],
    hourConcepts: [],
    rows: [
      {
        concept: { ...base, id: "normal", code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", status: "ACTIVO", loadMode: null, systemRole: "NORMAL_BASE" },
        role: "NORMAL_BASE",
        minutesByDay: {},
        totalMinutes: 0,
      },
    ],
    totalWorkedMinutes: 0,
    attendanceIssues: 0,
  };
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

function rowFor(name: string) {
  const rows = screen.getAllByRole("row");
  const row = rows.find((candidate) => within(candidate).queryByText(name));
  if (!row) throw new Error(`No se encontró la fila de "${name}"`);
  return row;
}

function totalCellText(row: HTMLElement) {
  const cells = within(row).getAllByRole("cell");
  return cells[cells.length - 1]!.textContent;
}

function statCardValue(label: string) {
  const card = screen.getByText(label).closest(".stat-card");
  if (!card) throw new Error(`No se encontró la tarjeta de estadística "${label}"`);
  return within(card as HTMLElement).getByText(/\d/).textContent;
}

function dayCellText(row: HTMLElement, dayIndex: number) {
  const buttons = within(row).getAllByRole("button");
  if (buttons[dayIndex]) return buttons[dayIndex].textContent;
  return within(row).getAllByRole("cell")[dayIndex + 1]?.textContent;
}

// La grilla ya cargó cuando aparece la fila de Hora normal — reemplaza el
// viejo ancla "esperar el botón Recalcular automáticos" (Etapa 6L.4: ese
// botón ya no existe en esta pantalla).
const waitForGridLoaded = () => screen.findByText("Hora normal");
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

    const normalDay1 = within(rowFor("Hora normal")).getAllByRole("button")[0]!;
    await user.click(normalDay1);
    expect(await screen.findByText(/Cargar Hora normal/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(timeEntryApiService.save).toHaveBeenCalledTimes(1));
    expect(timeEntryApiService.save).toHaveBeenCalledWith(expect.objectContaining({ conceptId: "normal", hours: 8 }));
    await waitFor(() => expect(screen.queryByText(/Cargar Hora normal/i)).not.toBeInTheDocument());
  });

  it("no muestra 'Ese tipo de hora no esta habilitado para este legajo' al guardar Hora normal sin conceptos adicionales", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildNormalOnlyGrid());
    vi.mocked(timeEntryApiService.save).mockResolvedValueOnce({
      id: "entry-1", employeeId: "employee-1", period: "2026-08", day: 1, type: "Hora normal", hours: 8, status: "Aprobado", conceptId: "normal",
    });
    renderPage();
    await waitForGridLoaded();

    const normalDay1 = within(rowFor("Hora normal")).getAllByRole("button")[0]!;
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

    const normalDay1 = within(rowFor("Hora normal")).getAllByRole("button")[0]!;
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

    const normalDay1 = within(rowFor("Hora normal")).getAllByRole("button")[0]!;
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

    const normalDay1 = within(rowFor("Hora normal")).getAllByRole("button")[0]!;
    await user.click(normalDay1);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(timeEntryApiService.save).toHaveBeenCalledTimes(1));
    expect(timeEntryApiService.save).toHaveBeenCalledWith(expect.objectContaining({ status: "Aprobado" }));
  });

  it.each(["Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"])(
    "%s sigue viendo 'Guardar borrador' y 'Enviar a revisión' en el modal de Hora normal",
    async (role) => {
      const user = userEvent.setup();
      authAs(role);
      vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildNormalOnlyGrid());
      renderPage();
      await waitForGridLoaded();

      const normalDay1 = within(rowFor("Hora normal")).getAllByRole("button")[0]!;
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

    const normalDay1 = within(rowFor("Hora normal")).getAllByRole("button")[0]!;
    await user.click(normalDay1);
    await user.click(screen.getByRole("button", { name: /Enviar a revisión/i }));

    await waitFor(() => expect(timeEntryApiService.save).toHaveBeenCalledTimes(1));
    expect(timeEntryApiService.save).toHaveBeenCalledWith(expect.objectContaining({ status: "En revisión" }));
  });
});

describe("EmployeeHoursPage — el botón 'Recalcular automáticos' ya no se expone en la grilla (Etapa 6L.4)", () => {
  it("no muestra el botón 'Recalcular automáticos'", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(buildGrid());
    renderPage();
    await waitForGridLoaded();
    expect(screen.queryByRole("button", { name: /Recalcular/i })).not.toBeInTheDocument();
  });

  it("el concepto AUTOMATIC (Sereno) sigue mostrando sus minutos (vienen de HourConceptBreakdown, no de un botón) y es solo lectura", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(buildGrid());
    renderPage();
    await waitForGridLoaded();
    expect(within(rowFor("Sereno")).queryAllByRole("button")).toHaveLength(0);
    expect(totalCellText(rowFor("Sereno"))).toBe("6.00");
  });

  it("el concepto MANUAL (Colectivo) sigue siendo editable", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(buildGrid());
    renderPage();
    await waitForGridLoaded();
    const colectivoDay1 = within(rowFor("Colectivo")).getAllByRole("button")[0]!;
    await userEvent.setup().click(colectivoDay1);
    expect(await screen.findByText(/Cargar desglose Colectivo/i)).toBeInTheDocument();
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

    const normalDay2 = within(rowFor("Hora normal")).getAllByRole("button")[1]!;
    await user.click(normalDay2);
    const hoursInput = screen.getByLabelText("Cantidad de horas");
    await user.clear(hoursInput);
    await user.type(hoursInput, "5");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByText(/Cargar Hora normal/i)).not.toBeInTheDocument());
    expect(dayCellText(rowFor("Hora normal"), 1)).toBe("5");
  });

  it("guardar Hora normal actualiza el total diario/mensual (Horas trabajadas y columna Total) de inmediato", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid)
      .mockResolvedValueOnce(buildGrid())
      .mockReturnValueOnce(new Promise(() => {}));
    vi.mocked(timeEntryApiService.save).mockResolvedValueOnce({
      id: "entry-2", employeeId: "employee-1", period: "2026-08", day: 2, type: "Hora normal", hours: 5, status: "Aprobado", conceptId: "normal",
    });
    renderPage();
    await waitForGridLoaded();
    expect(statCardValue("Horas trabajadas")).toBe("8.00 h");

    const normalDay2 = within(rowFor("Hora normal")).getAllByRole("button")[1]!;
    await user.click(normalDay2);
    const hoursInput = screen.getByLabelText("Cantidad de horas");
    await user.clear(hoursInput);
    await user.type(hoursInput, "5");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByText(/Cargar Hora normal/i)).not.toBeInTheDocument());
    expect(totalCellText(rowFor("Hora normal"))).toBe("13.00");
    expect(statCardValue("Horas trabajadas")).toBe("13.00 h");
  });

  it("guardar un desglose manual actualiza su celda de inmediato sin esperar un segundo getTimeGrid", async () => {
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
    await user.click(screen.getByRole("button", { name: /Guardar desglose/i }));

    await waitFor(() => expect(screen.queryByText(/Cargar desglose Colectivo/i)).not.toBeInTheDocument());
    expect(dayCellText(rowFor("Colectivo"), 0)).toBe("2.00");
  });

  it("guardar un desglose manual no modifica Horas trabajadas (totalWorkedMinutes)", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid)
      .mockResolvedValueOnce(buildGrid())
      .mockReturnValueOnce(new Promise(() => {}));
    vi.mocked(employeeApiService.saveManualHourConceptBreakdown).mockResolvedValueOnce({ id: "breakdown-1" });
    renderPage();
    await waitForGridLoaded();
    expect(statCardValue("Horas trabajadas")).toBe("8.00 h");

    const colectivoDay1 = within(rowFor("Colectivo")).getAllByRole("button")[0]!;
    await user.click(colectivoDay1);
    const hoursInput = screen.getByLabelText("Cantidad de horas");
    await user.clear(hoursInput);
    await user.type(hoursInput, "2");
    await user.click(screen.getByRole("button", { name: /Guardar desglose/i }));

    await waitFor(() => expect(screen.queryByText(/Cargar desglose Colectivo/i)).not.toBeInTheDocument());
    expect(statCardValue("Horas trabajadas")).toBe("8.00 h");
    expect(totalCellText(rowFor("Hora normal"))).toBe("8.00");
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

    const normalDay2 = within(rowFor("Hora normal")).getAllByRole("button")[1]!;
    await user.click(normalDay2);
    const hoursInput = screen.getByLabelText("Cantidad de horas");
    await user.clear(hoursInput);
    await user.type(hoursInput, "5");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByText(/Cargar Hora normal/i)).not.toBeInTheDocument());
    expect(screen.queryByText(LOADING_TEXT)).not.toBeInTheDocument();
    await waitFor(() => expect(employeeApiService.getTimeGrid).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(LOADING_TEXT)).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: /Guardar desglose/i }));

    expect(await screen.findByText("Alguien más modificó este desglose al mismo tiempo. Volvé a intentar.")).toBeInTheDocument();
  });
});
