import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
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
      recalculateAutomaticHourConceptBreakdowns: vi.fn(),
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

beforeEach(() => {
  vi.mocked(employeeApiService.getTimeGrid).mockReset();
  vi.mocked(employeeApiService.recalculateAutomaticHourConceptBreakdowns).mockReset();
  vi.mocked(employeeApiService.saveManualHourConceptBreakdown).mockReset();
  vi.mocked(noveltyApiService.getAll).mockResolvedValue([]);
  vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([]);
  vi.mocked(documentCategoryApiService.getAll).mockResolvedValue([]);
  vi.mocked(timeEntryApiService.save).mockReset();
  vi.mocked(timeEntryApiService.update).mockReset();
  authAs("Nivel 1 - RRHH");
});

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

describe("EmployeeHoursPage — Hora normal es universal (bug: HOUR_CONCEPT_NOT_ENABLED sin conceptos adicionales)", () => {
  it("el modal 'Cargar Hora normal' permite guardar aunque el legajo no tenga ningún concepto adicional asignado", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildNormalOnlyGrid());
    vi.mocked(timeEntryApiService.save).mockResolvedValueOnce({
      id: "entry-1", employeeId: "employee-1", period: "2026-08", day: 1, type: "Hora normal", hours: 8, status: "Aprobado", conceptId: "normal",
    });
    renderPage();
    await screen.findByRole("button", { name: /Recalcular automáticos/i });

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
    await screen.findByRole("button", { name: /Recalcular automáticos/i });

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
    await screen.findByRole("button", { name: /Recalcular automáticos/i });

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
    await screen.findByRole("button", { name: /Recalcular automáticos/i });

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
    await screen.findByRole("button", { name: /Recalcular automáticos/i });

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
      await screen.findByRole("button", { name: /Recalcular automáticos/i });

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
    await screen.findByRole("button", { name: /Recalcular automáticos/i });

    const normalDay1 = within(rowFor("Hora normal")).getAllByRole("button")[0]!;
    await user.click(normalDay1);
    await user.click(screen.getByRole("button", { name: /Enviar a revisión/i }));

    await waitFor(() => expect(timeEntryApiService.save).toHaveBeenCalledTimes(1));
    expect(timeEntryApiService.save).toHaveBeenCalledWith(expect.objectContaining({ status: "En revisión" }));
  });
});

describe("EmployeeHoursPage — recálculo de automáticos (Etapa 6J)", () => {
  it("muestra el botón 'Recalcular automáticos'", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(buildGrid());
    renderPage();
    expect(await screen.findByRole("button", { name: /Recalcular automáticos/i })).toBeInTheDocument();
  });

  it("llama al endpoint con el employeeId y el período visible en la grilla", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    vi.mocked(employeeApiService.recalculateAutomaticHourConceptBreakdowns).mockResolvedValueOnce({
      employeeId: "employee-1", period: "2026-08", processedShifts: 1, eligibleConcepts: 1, generated: 1, removed: 0,
    });
    renderPage();
    const button = await screen.findByRole("button", { name: /Recalcular automáticos/i });
    fireEvent.click(button);
    await waitFor(() => {
      expect(employeeApiService.recalculateAutomaticHourConceptBreakdowns).toHaveBeenCalledWith("employee-1", "2026-08");
    });
  });

  it("deshabilita el botón mientras la recalculación está en curso", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    let resolveRecalculate!: (value: Awaited<ReturnType<typeof employeeApiService.recalculateAutomaticHourConceptBreakdowns>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof employeeApiService.recalculateAutomaticHourConceptBreakdowns>>>((resolve) => {
      resolveRecalculate = resolve;
    });
    vi.mocked(employeeApiService.recalculateAutomaticHourConceptBreakdowns).mockReturnValueOnce(pending);
    renderPage();
    const button = await screen.findByRole("button", { name: /Recalcular automáticos/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());

    resolveRecalculate({ employeeId: "employee-1", period: "2026-08", processedShifts: 1, eligibleConcepts: 1, generated: 1, removed: 0 });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("refresca la grilla luego del éxito y mantiene Horas normales sin cambios", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(buildGrid(360)).mockResolvedValueOnce(buildGrid(420));
    vi.mocked(employeeApiService.recalculateAutomaticHourConceptBreakdowns).mockResolvedValueOnce({
      employeeId: "employee-1", period: "2026-08", processedShifts: 2, eligibleConcepts: 1, generated: 2, removed: 1,
    });
    renderPage();
    const button = await screen.findByRole("button", { name: /Recalcular automáticos/i });
    expect(totalCellText(rowFor("Sereno"))).toBe("6.00");
    fireEvent.click(button);

    await waitFor(() => expect(employeeApiService.getTimeGrid).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(totalCellText(rowFor("Sereno"))).toBe("7.00"));
    expect(totalCellText(rowFor("Hora normal"))).toBe("8.00");
  });

  it("muestra un mensaje de éxito al terminar de recalcular", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    vi.mocked(employeeApiService.recalculateAutomaticHourConceptBreakdowns).mockResolvedValueOnce({
      employeeId: "employee-1", period: "2026-08", processedShifts: 1, eligibleConcepts: 1, generated: 1, removed: 0,
    });
    renderPage();
    const button = await screen.findByRole("button", { name: /Recalcular automáticos/i });
    fireEvent.click(button);
    expect(await screen.findByText("Conceptos automáticos recalculados correctamente.")).toBeInTheDocument();
  });

  it("muestra un error claro si el backend rechaza el recálculo y no refresca la grilla", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(buildGrid());
    vi.mocked(employeeApiService.recalculateAutomaticHourConceptBreakdowns).mockRejectedValueOnce(
      new ApiError("The period is closed for recalculation", "PERIOD_CLOSED", 409),
    );
    renderPage();
    const button = await screen.findByRole("button", { name: /Recalcular automáticos/i });
    fireEvent.click(button);
    expect(await screen.findByText("El período está cerrado y no admite recálculo de automáticos.")).toBeInTheDocument();
    expect(employeeApiService.getTimeGrid).toHaveBeenCalledTimes(1);
    expect(within(rowFor("Hora normal")).getByText("8.00")).toBeInTheDocument();
  });

  it("no pierde una edición manual abierta si el recálculo automático falla", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    vi.mocked(employeeApiService.recalculateAutomaticHourConceptBreakdowns).mockRejectedValueOnce(
      new ApiError("The period is closed for recalculation", "PERIOD_CLOSED", 409),
    );
    renderPage();
    await screen.findByRole("button", { name: /Recalcular automáticos/i });

    const colectivoDay1 = within(rowFor("Colectivo")).getAllByRole("button")[0]!;
    await user.click(colectivoDay1);
    const observationField = screen.getByLabelText("Observaciones");
    await user.type(observationField, "Ida y vuelta");
    expect(observationField).toHaveValue("Ida y vuelta");

    const recalculateButton = screen.getByRole("button", { name: /Recalcular automáticos/i });
    fireEvent.click(recalculateButton);
    await screen.findByText("El período está cerrado y no admite recálculo de automáticos.");

    expect(screen.getByLabelText("Observaciones")).toHaveValue("Ida y vuelta");
  });

  it("el concepto AUTOMATIC (Sereno) sigue siendo solo lectura", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(buildGrid());
    renderPage();
    await screen.findByRole("button", { name: /Recalcular automáticos/i });
    expect(within(rowFor("Sereno")).queryAllByRole("button")).toHaveLength(0);
  });

  it("el concepto MANUAL (Colectivo) sigue siendo editable", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(buildGrid());
    renderPage();
    await screen.findByRole("button", { name: /Recalcular automáticos/i });
    const colectivoDay1 = within(rowFor("Colectivo")).getAllByRole("button")[0]!;
    fireEvent.click(colectivoDay1);
    expect(await screen.findByText(/Cargar desglose Colectivo/i)).toBeInTheDocument();
  });

  it("no expone 'priority' en la grilla", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(buildGrid());
    const { container } = renderPage();
    await screen.findByRole("button", { name: /Recalcular automáticos/i });
    expect(container.textContent).not.toMatch(/priority/i);
  });

  it("no expone 'countsAsWorked' en la grilla", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(buildGrid());
    const { container } = renderPage();
    await screen.findByRole("button", { name: /Recalcular automáticos/i });
    expect(container.textContent).not.toMatch(/countsAsWorked/i);
  });
});
