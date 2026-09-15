import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssignmentBlock } from "./EmployeeDetailBlocks";
import { employeeApiService } from "../../services/api/employeeApiService";
import { employeeHistoryApiService } from "../../services/api/employeeHistoryApiService";
import { userApiService } from "../../services/api/userApiService";
import type { Employee, User } from "../../types";

vi.mock("../../services/api/employeeApiService", () => ({
  employeeApiService: { getOptions: vi.fn(), replaceAssignments: vi.fn() },
}));

vi.mock("../../services/api/employeeHistoryApiService", () => ({
  employeeHistoryApiService: { getBlockHistory: vi.fn(), createBlockHistory: vi.fn() },
}));

vi.mock("../../services/api/userApiService", () => ({
  userApiService: { getAll: vi.fn() },
}));

function buildEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "employee-1",
    legajo: "100",
    legajoInterno: "100",
    lastName: "Taller",
    firstName: "15",
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
    directManagerFrom: "",
    directManagerStatus: "",
    directManagerNotes: "",
    timeResponsible: "15 Taller",
    timeResponsibles: ["15 Taller"],
    // Valor legacy de EmployeeAssignment.role — ya no se edita ni se muestra
    // tal cual: sólo confirma que el guardado no lo toca ni lo borra.
    timeResponsibleRole: "Nivel 2 - Supervisión / Gestión",
    timeResponsibleFrom: "2026-01-01",
    timeResponsibleStatus: "",
    timeResponsibleNotes: "",
    startDate: "2020-01-01",
    transport: false,
    transportRoute: "",
    transportNotes: "",
    enabledHours: [],
    status: "Activo",
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
  vi.mocked(employeeApiService.getOptions).mockResolvedValue({
    items: [],
    meta: { total: 0, page: 1, pageSize: 25, hasMore: false },
  });
  vi.mocked(userApiService.getAll).mockResolvedValue([]);
  vi.mocked(employeeHistoryApiService.getBlockHistory).mockResolvedValue([]);
});

async function openEditModal() {
  const trigger = await screen.findByRole("button", { name: "Editar responsables" });
  await userEvent.click(trigger);
  return screen.findByRole("button", { name: "Guardar asignacion" });
}

describe("AssignmentBlock (Responsable de carga horaria) — sin selector de Rol redundante", () => {
  it("el modal ya no muestra ningún selector editable de Rol; sólo responsable, fecha desde y motivo", async () => {
    render(<AssignmentBlock employee={buildEmployee()} user={rrhhUser} canEdit onSaved={vi.fn()} kind="TIME" />);

    await openEditModal();

    expect(screen.queryByLabelText("Rol")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Responsables de carga horaria")).toBeInTheDocument();
    expect(screen.getByLabelText("Fecha desde")).toBeInTheDocument();
    expect(screen.getByLabelText("Motivo del cambio")).toBeInTheDocument();
  });

  it("abrir y editar la asignación no consulta usuarios (userApiService.getAll) — el rol ya no se resuelve por nombre", async () => {
    render(<AssignmentBlock employee={buildEmployee()} user={rrhhUser} canEdit onSaved={vi.fn()} kind="TIME" />);
    await openEditModal();

    expect(screen.queryByText(/Nivel \d/)).not.toBeInTheDocument();
    expect(userApiService.getAll).not.toHaveBeenCalled();
  });

  it("permite agregar un nuevo responsable mediante la búsqueda de personas", async () => {
    vi.mocked(employeeApiService.getOptions).mockImplementation(async (filters) => {
      if (filters?.search?.trim() === "Carlos") {
        return {
          items: [buildEmployee({ id: "employee-9", firstName: "Carlos", lastName: "Nuevo", timeResponsibles: [], timeResponsible: "" })],
          meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
        };
      }
      return { items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } };
    });

    render(<AssignmentBlock employee={buildEmployee()} user={rrhhUser} canEdit onSaved={vi.fn()} kind="TIME" />);
    await openEditModal();

    await userEvent.type(screen.getByPlaceholderText("Buscar por nombre, apellido, DNI, CUIL o legajo"), "Carlos");

    const candidate = await screen.findByRole("button", { name: /Carlos Nuevo/ }, { timeout: 2000 });
    await userEvent.click(candidate);

    expect(await screen.findAllByText("Carlos Nuevo")).not.toHaveLength(0);
    expect(userApiService.getAll).not.toHaveBeenCalled();
  });

  it("exige Fecha desde para guardar la asignación", async () => {
    const onSaved = vi.fn();
    render(<AssignmentBlock employee={buildEmployee()} user={rrhhUser} canEdit onSaved={onSaved} kind="TIME" />);
    await openEditModal();

    fireEvent.change(screen.getByLabelText("Fecha desde"), { target: { value: "" } });
    await userEvent.click(screen.getByRole("button", { name: "Guardar asignacion" }));

    expect(await screen.findByText("La fecha desde es obligatoria.")).toBeInTheDocument();
    expect(employeeApiService.replaceAssignments).not.toHaveBeenCalled();
  });

  it("exige Motivo del cambio y, una vez completo, guarda sin enviar ni modificar ningún rol", async () => {
    const onSaved = vi.fn();
    const employee = buildEmployee();
    vi.mocked(employeeApiService.replaceAssignments).mockResolvedValue(employee);

    render(<AssignmentBlock employee={employee} user={rrhhUser} canEdit onSaved={onSaved} kind="TIME" />);
    await openEditModal();

    await userEvent.click(screen.getByRole("button", { name: "Guardar asignacion" }));
    expect(await screen.findByText("El motivo del cambio es obligatorio.")).toBeInTheDocument();
    expect(employeeApiService.replaceAssignments).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Motivo del cambio"), "Reasignación de responsable");
    await userEvent.click(screen.getByRole("button", { name: "Guardar asignacion" }));

    await waitFor(() => expect(employeeApiService.replaceAssignments).toHaveBeenCalledTimes(1));
    const savedEmployee = vi.mocked(employeeApiService.replaceAssignments).mock.calls[0][0];
    // El modal nunca ofreció un control para cambiar el rol: el valor legacy
    // viaja intacto porque nadie lo tocó, no porque el componente lo fuerce.
    expect(savedEmployee.timeResponsibleRole).toBe("Nivel 2 - Supervisión / Gestión");

    await waitFor(() => expect(employeeHistoryApiService.createBlockHistory).toHaveBeenCalledTimes(1));
    const historyCall = vi.mocked(employeeHistoryApiService.createBlockHistory).mock.calls[0][0] as { newValue: string; oldValue: string | null };
    expect(historyCall.newValue).not.toMatch(/Nivel/);
    expect(historyCall.oldValue).not.toMatch(/Nivel/);

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(employee));
    expect(userApiService.getAll).not.toHaveBeenCalled();
  });
});
