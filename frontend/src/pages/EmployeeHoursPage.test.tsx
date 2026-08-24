import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EmployeeHoursPage } from "./EmployeeHoursPage";
import { employeeApiService } from "../services/api/employeeApiService";
import { noveltyApiService } from "../services/api/noveltyApiService";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import { documentCategoryApiService } from "../services/api/documentCategoryApiService";
import { ApiError } from "../services/api/apiClient";
import type { Employee } from "../types";
import type { EmployeeTimeGrid, EmployeeTimeGridRow } from "../services/api/employeeApiService";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "Ana Test", email: "ana@test.com", password: "", role: "Nivel 1 - RRHH", status: "Activo" },
    login: vi.fn(),
    loginAs: vi.fn(),
    logout: vi.fn(),
  }),
}));

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
