import { beforeEach, describe, expect, it, vi } from "vitest";
import { employeesRepository } from "./employees.repository";
import { employeesService } from "./employees.service";

vi.mock("../../shared/prisma/client", () => ({ prisma: {} }));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn(), registerWithin: vi.fn() }, clearAuditDerivedCaches: vi.fn() }));
vi.mock("./employees.repository", () => ({
  employeesRepository: {
    findActiveSupervisionUserIds: vi.fn(),
    findAssignmentsAuditSnapshot: vi.fn(),
    replaceAssignments: vi.fn(),
  },
}));

const repo = vi.mocked(employeesRepository);
const tr = (userId: string | null, personName: string | null = null) => ({ type: "TIME_RESPONSIBLE" as const, userId, personName });

// Responsable de carga = usuario Nivel 2 ACTIVO por userId (regla de alcance:
// N2 directo, N3 heredado). Un nombre suelto u otro rol no abren alcance.
describe("employeesService.replaceAssignments — responsables de carga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.findAssignmentsAuditSnapshot.mockResolvedValue({ assignments: [] } as never);
    repo.replaceAssignments.mockResolvedValue({ id: "emp", legajo: "992", assignments: [] } as never);
    repo.findActiveSupervisionUserIds.mockImplementation(async (ids: string[]) => new Set(ids.filter((id) => id === "planta")));
  });

  it("acepta un Nivel 2 activo por userId", async () => {
    await employeesService.replaceAssignments("emp", { assignments: [tr("planta")] });
    expect(repo.findActiveSupervisionUserIds).toHaveBeenCalledWith(["planta"]);
    expect(repo.replaceAssignments).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sólo nombre (sin userId)", tr(null, "Wicky Stefania")],
    ["Nivel 3, Nivel 1 o inactivo (no vuelve como Nivel 2 activo)", tr("carga-demo")],
  ])("rechaza %s con 422 y no escribe", async (_label, assignment) => {
    await expect(employeesService.replaceAssignments("emp", { assignments: [tr("planta"), assignment] })).rejects.toMatchObject({
      statusCode: 422,
      code: "TIME_RESPONSIBLE_REQUIRES_N2_USER",
    });
    expect(repo.replaceAssignments).not.toHaveBeenCalled();
  });

  it("DIRECT_MANAGER por nombre sigue permitido y no consulta usuarios", async () => {
    await employeesService.replaceAssignments("emp", { assignments: [{ type: "DIRECT_MANAGER", personName: "Encargado" }] });
    expect(repo.findActiveSupervisionUserIds).not.toHaveBeenCalled();
    expect(repo.replaceAssignments).toHaveBeenCalledTimes(1);
  });
});
