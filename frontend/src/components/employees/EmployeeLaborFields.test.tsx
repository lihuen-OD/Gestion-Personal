import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SalaryRangeValidationCard } from "./EmployeeLaborFields";
import { employeeApiService } from "../../services/api/employeeApiService";
import { positionApiService } from "../../services/api/positionApiService";
import { salaryCategoryApiService } from "../../services/api/salaryCategoryApiService";
import type { Employee } from "../../types";

vi.mock("../../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api/employeeApiService")>();
  return { ...actual, employeeApiService: { ...actual.employeeApiService, getPositionValidation: vi.fn() } };
});
vi.mock("../../services/api/positionApiService", () => ({ positionApiService: { getAll: vi.fn() } }));
vi.mock("../../services/api/salaryCategoryApiService", () => ({ salaryCategoryApiService: { getGroups: vi.fn() } }));

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
    sector: "",
    position: "",
    positionId: "",
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(positionApiService.getAll).mockResolvedValue([]);
  vi.mocked(salaryCategoryApiService.getGroups).mockResolvedValue([]);
});

// Etapa 14D.2 (Parte 5, ítems 13-14 del pedido): `getPositionValidation`
// tardaba hasta 12825ms (14D.1) — este card ya tenía una validación local de
// respaldo (`localValidation`, calculada con datos ya disponibles) que se
// muestra ANTES de que el backend responda; estos tests protegen ese
// comportamiento (ya existía, no se tocó esta etapa, pero es lo que hace
// que "no bloquear el render" sea cierto) para que no se rompa sin querer en
// una futura edición de este archivo.
describe("SalaryRangeValidationCard — no bloquea render esperando position-validation (Etapa 14D.2)", () => {
  it("renderiza la validación local de inmediato, sin esperar la respuesta del backend", async () => {
    let resolveValidation!: (value: never) => void;
    vi.mocked(employeeApiService.getPositionValidation).mockReturnValue(new Promise((resolve) => { resolveValidation = resolve; }));

    render(<SalaryRangeValidationCard employee={buildEmployee({ positionId: "" })} />);

    // Sin puesto seleccionado, la validación local ya sabe mostrar esto —
    // no hay pantalla en blanco ni loader bloqueante mientras el backend
    // sigue en vuelo.
    expect(await screen.findByText("Puesto sin seleccionar")).toBeInTheDocument();
    expect(employeeApiService.getPositionValidation).toHaveBeenCalledTimes(1);

    resolveValidation(undefined as never);
  });

  it("cuando el backend responde, actualiza a esa validación sin dejar de mostrar contenido en el medio", async () => {
    vi.mocked(employeeApiService.getPositionValidation).mockResolvedValue({
      tone: "success",
      title: "Validación desde backend",
      categoryText: "Dentro de rango.",
      checks: [],
      category: { status: "IN_RANGE", value: "Administrativo A", range: ["Administrativo A"] },
    });

    render(<SalaryRangeValidationCard employee={buildEmployee({ positionId: "" })} />);

    await waitFor(() => expect(screen.getByText("Validación desde backend")).toBeInTheDocument());
  });

  it("si el backend falla, se queda con la validación local en vez de romper la pantalla", async () => {
    vi.mocked(employeeApiService.getPositionValidation).mockRejectedValue(new Error("timeout"));

    render(<SalaryRangeValidationCard employee={buildEmployee({ positionId: "" })} />);

    await waitFor(() => expect(screen.getByText("Puesto sin seleccionar")).toBeInTheDocument());
  });

  // Parte 2A del pedido: "debe quedar claro si la validación visible es
  // local o backend" — nunca se oculta silenciosamente que lo que se ve es
  // una aproximación o que hubo un error real.
  it("mientras el backend está en vuelo, deja explícito que la validación visible es preliminar (local)", async () => {
    let resolveValidation!: (value: never) => void;
    vi.mocked(employeeApiService.getPositionValidation).mockReturnValue(new Promise((resolve) => { resolveValidation = resolve; }));

    render(<SalaryRangeValidationCard employee={buildEmployee({ positionId: "" })} />);

    expect(await screen.findByText(/Validación preliminar \(local\)/)).toBeInTheDocument();
    resolveValidation(undefined as never);
    await waitFor(() => expect(screen.queryByText(/Validación preliminar \(local\)/)).not.toBeInTheDocument());
  });

  it("si el backend falla, muestra un aviso explícito del error — no lo oculta silenciosamente", async () => {
    vi.mocked(employeeApiService.getPositionValidation).mockRejectedValue(new Error("timeout"));

    render(<SalaryRangeValidationCard employee={buildEmployee({ positionId: "" })} />);

    expect(await screen.findByText(/No pudimos confirmar la validación oficial/)).toBeInTheDocument();
    // Y la validación local sigue mostrándose al lado del aviso — no rompe la pestaña.
    expect(screen.getByText("Puesto sin seleccionar")).toBeInTheDocument();
  });

  it("cuando el backend confirma, deja de mostrar la leyenda de 'preliminar'", async () => {
    vi.mocked(employeeApiService.getPositionValidation).mockResolvedValue({
      tone: "success",
      title: "Validación desde backend",
      categoryText: "Dentro de rango.",
      checks: [],
      category: { status: "IN_RANGE", value: "Administrativo A", range: ["Administrativo A"] },
    });

    render(<SalaryRangeValidationCard employee={buildEmployee({ positionId: "" })} />);

    await waitFor(() => expect(screen.getByText("Validación desde backend")).toBeInTheDocument());
    expect(screen.queryByText(/Validación preliminar \(local\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No pudimos confirmar/)).not.toBeInTheDocument();
  });
});
