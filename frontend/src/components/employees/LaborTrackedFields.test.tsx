import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MultiCompanyField } from "./LaborTrackedFields";
import { employeeHistoryApiService } from "../../services/api/employeeHistoryApiService";
import { orgStructureApiService } from "../../services/api/orgStructureApiService";
import type { Employee, User } from "../../types";

vi.mock("../../services/api/employeeHistoryApiService", () => ({
  employeeHistoryApiService: {
    getFieldHistory: vi.fn(),
    createFieldHistory: vi.fn(),
  },
}));

vi.mock("../../services/api/employeeApiService", () => ({
  employeeApiService: { update: vi.fn() },
}));

vi.mock("../../services/api/orgStructureApiService", () => ({
  orgStructureApiService: { getCatalog: vi.fn() },
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
    company: "Los Odwyer",
    companies: ["Los Odwyer"],
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
  vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue({ companies: [], sectors: [], costCenters: [] } as never);
});

// Etapa 14D.2: MultiCompanyField (historial de "Empresa" en Datos Laborales)
// usa el mismo hook `useBackendFieldHistory` que EmployeePositionField — este
// test cubre el patrón compartido; ver FieldHistoryControls.test.tsx para la
// cobertura equivalente del otro mecanismo lazy (FieldWithHistory).
describe("MultiCompanyField — historial de Empresa bajo demanda (Etapa 14D.2)", () => {
  it("no dispara field-history al montar", () => {
    render(<MultiCompanyField employee={buildEmployee()} canEdit={false} user={rrhhUser} onSaved={() => {}} />);

    expect(employeeHistoryApiService.getFieldHistory).not.toHaveBeenCalled();
  });

  it("abrir el historial dispara field-history con field=companies", async () => {
    vi.mocked(employeeHistoryApiService.getFieldHistory).mockResolvedValue([]);
    const user = userEvent.setup();
    render(<MultiCompanyField employee={buildEmployee()} canEdit={false} user={rrhhUser} onSaved={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Historial" }));

    expect(employeeHistoryApiService.getFieldHistory).toHaveBeenCalledTimes(1);
    expect(employeeHistoryApiService.getFieldHistory).toHaveBeenCalledWith("employee-1", { section: "DATOS_LABORALES", field: "companies" });
  });

  it("cerrar y reabrir no repite el request", async () => {
    vi.mocked(employeeHistoryApiService.getFieldHistory).mockResolvedValue([]);
    const user = userEvent.setup();
    render(<MultiCompanyField employee={buildEmployee()} canEdit={false} user={rrhhUser} onSaved={() => {}} />);

    const toggle = screen.getByRole("button", { name: "Historial" });
    await user.click(toggle);
    await waitFor(() => expect(employeeHistoryApiService.getFieldHistory).toHaveBeenCalledTimes(1));
    await user.click(toggle);
    await user.click(toggle);

    expect(employeeHistoryApiService.getFieldHistory).toHaveBeenCalledTimes(1);
  });
});
