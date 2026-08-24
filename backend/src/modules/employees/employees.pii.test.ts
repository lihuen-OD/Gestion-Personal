import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { roles } from "../../shared/security/roles";
import { employeesRepository } from "./employees.repository";
import { employeesService } from "./employees.service";

vi.mock("./employees.repository", () => ({
  employeesRepository: {
    findOptions: vi.fn(),
    findTimeGrid: vi.fn(),
  },
}));

const repo = employeesRepository as unknown as { findOptions: Mock; findTimeGrid: Mock };
const cargaUser = { id: "user-carga", role: roles.cargaHoraria } as Express.AuthUser;
const rrhhUser = { id: "user-rrhh", role: roles.rrhh } as Express.AuthUser;
const employee = {
  id: "employee-1",
  legajo: "100",
  firstName: "Ana",
  lastName: "Gomez",
  status: "ACTIVO",
  dni: "30000000",
  cuil: "20300000001",
  sector: { id: "sector-1", name: "Administración" },
  costCenter: { id: "cc-1", name: "Central" },
  position: { id: "position-1", name: "Administrativa" },
};

beforeEach(() => vi.clearAllMocks());

describe("employees operational DTO", () => {
  it("options mantiene búsqueda operativa pero no devuelve DNI/CUIL a Nivel 3", async () => {
    repo.findOptions.mockResolvedValue([[employee], 1]);

    const result = await employeesService.listOptions({ page: 1, take: 25 } as never, cargaUser);

    expect(result.items[0]).toMatchObject({ id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" });
    expect(result.items[0]).not.toHaveProperty("dni");
    expect(result.items[0]).not.toHaveProperty("cuil");
  });

  it("time-grid conserva datos operativos y elimina PII anidada para Nivel 3", async () => {
    repo.findTimeGrid.mockResolvedValue({
      employee: { ...employee, address: { street: "Privada" }, emergencyContact: "Familiar" },
      entries: [{ id: "entry-1", employee }],
      novelties: [],
      documents: [{ fileName: "dni.pdf" }],
    });

    const result = await employeesService.getTimeGrid("employee-1", { period: "2026-08", includeDetails: false }, cargaUser);

    expect(result.employee).toMatchObject({ legajo: "100", sector: { name: "Administración" }, position: { name: "Administrativa" } });
    expect(result.employee).not.toHaveProperty("dni");
    expect(result.employee).not.toHaveProperty("cuil");
    expect(result.employee).not.toHaveProperty("address");
    expect(result.employee).not.toHaveProperty("emergencyContact");
    expect(result).not.toHaveProperty("documents");
    expect(result.entries[0]?.employee).not.toHaveProperty("dni");
    expect(result.entries[0]?.employee).not.toHaveProperty("cuil");
  });

  it("RRHH conserva el contrato completo", async () => {
    repo.findOptions.mockResolvedValue([[employee], 1]);

    const result = await employeesService.listOptions({ page: 1, take: 25 } as never, rrhhUser);

    expect(result.items[0]).toMatchObject({ dni: "30000000", cuil: "20300000001" });
  });
});
