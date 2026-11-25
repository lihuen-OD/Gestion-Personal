import { describe, expect, it, vi } from "vitest";
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
