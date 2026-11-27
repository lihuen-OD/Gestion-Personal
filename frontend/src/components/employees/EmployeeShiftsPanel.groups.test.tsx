import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { EmployeeShiftsPanel } from "./EmployeeShiftsPanel";
import { shiftAssignmentApiService, type ShiftAssignment } from "../../services/api/shiftAssignmentApiService";
import { workforceApiService, type ShiftTemplate } from "../../services/api/workforceApiService";
import type { Employee, User } from "../../types";

vi.mock("../../services/api/shiftAssignmentApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api/shiftAssignmentApiService")>();
  return { ...actual, shiftAssignmentApiService: { ...actual.shiftAssignmentApiService, getAll: vi.fn() } };
});
vi.mock("../../services/api/workforceApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api/workforceApiService")>();
  return { ...actual, workforceApiService: { ...actual.workforceApiService, shiftTemplates: vi.fn() } };
});

const mockUseAuth = vi.fn();
vi.mock("../../context/AuthContext", () => ({ useAuth: () => mockUseAuth() }));
function authAs(role: string, groupIds: string[] = []) {
  mockUseAuth.mockReturnValue({ user: { id: "u1", name: "Usuario", email: "u@test.com", password: "", role, status: "Activo", shiftGroupAccess: { all: false, groupIds } }, refreshShiftGroupAccess: vi.fn() });
}

const base = { startTime: "07:00", endTime: "17:00", crossesMidnight: false, entryToleranceBeforeMinutes: 10, entryToleranceAfterMinutes: 10, exitToleranceBeforeMinutes: 10, exitToleranceAfterMinutes: 10, absoluteOpenShiftLimitMinutes: 1200, status: "ACTIVO" };
const templates: ShiftTemplate[] = [
  { ...base, id: "t-pl", code: "Planta-01", name: "Planta 01", categoryName: "Planta", shiftGroupId: "g-pl", shiftGroup: { id: "g-pl", code: "PLANTA", name: "Planta", status: "ACTIVO", sortOrder: 20 } },
  { ...base, id: "t-se", code: "Sereno-01", name: "Sereno 01", categoryName: "Sereno", shiftGroupId: null, shiftGroup: null },
];
function assignment(template: ShiftTemplate): ShiftAssignment {
  return {
    id: `a-${template.id}`, employeeId: "e1", shiftTemplateId: template.id, status: "HABILITADO", effectiveFrom: "2026-01-01", effectiveTo: null, weekdays: [1, 2, 3, 4, 5],
    assignedAt: "2026-01-01T00:00:00Z", observation: null, createdAt: "", updatedAt: "",
    employee: { id: "e1", legajo: "001", firstName: "Ana", lastName: "Pérez", status: "ACTIVO" },
    shiftTemplate: { id: template.id, code: template.code, name: template.name, categoryName: template.categoryName, startTime: template.startTime, endTime: template.endTime, crossesMidnight: false, status: "ACTIVO" },
  } as ShiftAssignment;
}

describe("Legajo → Turnos: grupo del turno (R3.2)", () => {
  beforeEach(() => authAs("Nivel 1 - RRHH"));

  it("muestra el grupo de cada turno asignado, o «Sin grupo», junto a la categoría", async () => {
    vi.mocked(shiftAssignmentApiService.getAll).mockResolvedValue(templates.map(assignment));
    vi.mocked(workforceApiService.shiftTemplates).mockResolvedValue(templates);
    render(<EmployeeShiftsPanel employee={{ id: "e1" } as Employee} user={{} as User} />);
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Grupo" })).toBeInTheDocument();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("Planta 01")).toBeInTheDocument();
    expect(rows[0]!.children[1]!.textContent).toBe("Planta");
    expect(rows[1]!.children[1]!.textContent).toBe("Sin grupo");
    expect(rows[1]!.children[2]!.textContent).toBe("Sereno");
  });
});

describe("Legajo → Turnos: edición por grupo (R8)", () => {
  // Para un Nivel 2 el catálogo del backend sólo trae sus grupos: Planta sí, Taller no.
  const taller = { ...base, id: "t-ta", code: "Taller-01", name: "Taller 01", categoryName: null, shiftGroupId: "g-ta", shiftGroup: { id: "g-ta", code: "TALLER", name: "Taller", status: "ACTIVO", sortOrder: 30 } } as ShiftTemplate;
  const planta02 = { ...templates[0]!, id: "t-pl2", code: "Planta-02", name: "Planta 02" } as ShiftTemplate;

  beforeEach(() => {
    vi.mocked(shiftAssignmentApiService.getAll).mockResolvedValue([assignment(templates[0]!), assignment(taller)]);
    vi.mocked(workforceApiService.shiftTemplates).mockResolvedValue([templates[0]!, planta02]);
  });

  it("Nivel 2: edita sólo los turnos de sus grupos; los demás quedan «Otro grupo», sólo lectura", async () => {
    authAs("Nivel 2 - Supervisión / Gestión", ["g-pl"]);
    render(<EmployeeShiftsPanel employee={{ id: "e1" } as Employee} user={{} as User} />);
    const table = await screen.findByRole("table");
    const [planta, ajena] = within(table).getAllByRole("row").slice(1);
    expect(within(planta!).getByRole("button", { name: "Deshabilitar" })).toBeInTheDocument();
    expect(ajena!.children[1]!.textContent).toBe("Otro grupo");
    expect(within(ajena!).queryByRole("button")).not.toBeInTheDocument();
    expect(within(ajena!).getByText("Sólo lectura")).toBeInTheDocument();
    expect(screen.getByText("Los turnos de grupos que no administrás se muestran sólo para consulta.")).toBeInTheDocument();
    // Sólo ofrece agregar turnos de sus grupos que todavía no tiene.
    expect(within(screen.getByLabelText("Agregar turno")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Seleccionar turno...", "Planta 02 · Planta (Planta)"]);
  });

  it("Nivel 2 sin grupos: sólo consulta, sin formulario ni acciones", async () => {
    authAs("Nivel 2 - Supervisión / Gestión");
    render(<EmployeeShiftsPanel employee={{ id: "e1" } as Employee} user={{} as User} />);
    const table = await screen.findByRole("table");
    expect(within(table).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Agregar turno")).not.toBeInTheDocument();
  });
});
