import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FieldWithHistory } from "./FieldHistoryControls";
import { employeeHistoryApiService } from "../../services/api/employeeHistoryApiService";
import type { Employee, User } from "../../types";

vi.mock("../../services/api/employeeHistoryApiService", () => ({
  employeeHistoryApiService: {
    getFieldHistory: vi.fn(),
    createFieldHistory: vi.fn(),
    getBlockHistory: vi.fn(),
    createBlockHistory: vi.fn(),
  },
}));

vi.mock("../../services/api/employeeApiService", () => ({
  employeeApiService: { update: vi.fn() },
}));

function buildEmployee(overrides: Partial<Employee> = {}): Employee {
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
    sector: "Ventas",
    position: "",
    receiptCategory: "",
    internalCategory: "",
    agreement: "",
    healthInsurance: "",
    directManager: "",
    timeResponsible: "",
    startDate: "2020-01-01",
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
    ...overrides,
  };
}

const rrhhUser: User = { id: "user-1", name: "RRHH", email: "rrhh@test.com", password: "", role: "Nivel 1 - RRHH", status: "Activo" };

beforeEach(() => {
  vi.clearAllMocks();
});

// Etapa 14D.2: antes, FieldWithHistory disparaba GET /field-history apenas
// montaba (8 en paralelo por pestaña — 16 con React StrictMode en dev,
// medido en el journey de 14D.1), sin que el usuario pidiera ver ningún
// historial. Estos tests protegen el comportamiento lazy nuevo.
describe("FieldWithHistory — historial bajo demanda (Etapa 14D.2)", () => {
  it("no dispara field-history al montar (el campo arranca cerrado)", () => {
    render(
      <FieldWithHistory
        employee={buildEmployee()}
        section="DATOS_LABORALES"
        field="sector"
        label="Sector"
        value="Ventas"
        canEdit={false}
        user={rrhhUser}
        onSaved={() => {}}
      />,
    );

    expect(employeeHistoryApiService.getFieldHistory).not.toHaveBeenCalled();
  });

  it("abrir el historial dispara field-history con employeeId/section/field correctos", async () => {
    vi.mocked(employeeHistoryApiService.getFieldHistory).mockResolvedValue([]);
    const user = userEvent.setup();
    render(
      <FieldWithHistory
        employee={buildEmployee()}
        section="DATOS_LABORALES"
        field="sector"
        label="Sector"
        value="Ventas"
        canEdit={false}
        user={rrhhUser}
        onSaved={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Historial" }));

    expect(employeeHistoryApiService.getFieldHistory).toHaveBeenCalledTimes(1);
    expect(employeeHistoryApiService.getFieldHistory).toHaveBeenCalledWith("employee-1", { section: "DATOS_LABORALES", field: "sector" });
  });

  it("cerrar y reabrir no repite el request — usa la caché local ya cargada", async () => {
    vi.mocked(employeeHistoryApiService.getFieldHistory).mockResolvedValue([]);
    const user = userEvent.setup();
    render(
      <FieldWithHistory
        employee={buildEmployee()}
        section="DATOS_LABORALES"
        field="sector"
        label="Sector"
        value="Ventas"
        canEdit={false}
        user={rrhhUser}
        onSaved={() => {}}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Historial" });
    await user.click(toggle); // abre — dispara el fetch
    await waitFor(() => expect(employeeHistoryApiService.getFieldHistory).toHaveBeenCalledTimes(1));
    await user.click(toggle); // cierra
    await user.click(toggle); // reabre

    expect(employeeHistoryApiService.getFieldHistory).toHaveBeenCalledTimes(1);
  });

  it("loading de historial es localizado: el encabezado del campo sigue visible mientras carga", async () => {
    let resolveHistory!: (value: never[]) => void;
    vi.mocked(employeeHistoryApiService.getFieldHistory).mockReturnValue(new Promise((resolve) => { resolveHistory = resolve; }));
    const user = userEvent.setup();
    render(
      <FieldWithHistory
        employee={buildEmployee()}
        section="DATOS_LABORALES"
        field="sector"
        label="Sector"
        value="Ventas"
        canEdit={false}
        user={rrhhUser}
        onSaved={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Historial" }));

    expect(screen.getByText("Sector")).toBeInTheDocument(); // encabezado del campo, siempre visible
    expect(screen.getByText("Ventas")).toBeInTheDocument(); // valor actual, siempre visible
    expect(screen.getByText("Cargando historial...")).toBeInTheDocument(); // loading contenido dentro del panel

    resolveHistory([]);
    await waitFor(() => expect(screen.queryByText("Cargando historial...")).not.toBeInTheDocument());
  });

  it("un error de historial no rompe el resto del campo (error localizado, con reintentar)", async () => {
    vi.mocked(employeeHistoryApiService.getFieldHistory).mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    render(
      <FieldWithHistory
        employee={buildEmployee()}
        section="DATOS_LABORALES"
        field="sector"
        label="Sector"
        value="Ventas"
        canEdit={false}
        user={rrhhUser}
        onSaved={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Historial" }));

    await screen.findByText("No pudimos cargar el historial.");
    expect(screen.getByText("Sector")).toBeInTheDocument();
    expect(screen.getByText("Ventas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
