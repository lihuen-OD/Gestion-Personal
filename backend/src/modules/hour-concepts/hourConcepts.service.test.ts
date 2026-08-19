import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { hourConceptsService } from "./hourConcepts.service";
import { hourConceptsRepository, invalidateHourConceptsCache } from "./hourConcepts.repository";
import { auditService } from "../audit/audit.service";
import { roles } from "../../shared/security/roles";

vi.mock("./hourConcepts.repository", () => ({
  invalidateHourConceptsCache: vi.fn(),
  hourConceptsRepository: {
    findMany: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findEmployees: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(undefined) },
}));

const repo = hourConceptsRepository as unknown as {
  findMany: Mock;
  findById: Mock;
  create: Mock;
  update: Mock;
  findEmployees: Mock;
};
const mockedAudit = auditService.register as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

function prismaKnownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("mock prisma error", { code, clientVersion: "0.0.0" });
}

const rrhhUser = { id: "user-rrhh", role: roles.rrhh } as Express.AuthUser;
const employeeRow = {
  employeeId: "employee-1",
  employee: {
    id: "employee-1",
    legajo: "100",
    cuil: "20-12345678-9",
    firstName: "Ana",
    lastName: "Prueba",
    status: "ACTIVO",
    sector: { id: "sector-1", name: "Campo" },
    costCenter: null,
    companies: [{ company: { id: "company-1", name: "OD" } }],
  },
};

describe("listEmployees — empleados habilitados (Etapa 8G)", () => {
  it("rechaza concepto inexistente (404), sin llegar a consultar empleados", async () => {
    repo.findById.mockRejectedValue(prismaKnownError("P2025"));

    await expect(
      hourConceptsService.listEmployees("concept-inexistente", { page: 1, take: 50 } as never, rrhhUser),
    ).rejects.toMatchObject({ statusCode: 404, code: "HOUR_CONCEPT_NOT_FOUND" });
    expect(repo.findEmployees).not.toHaveBeenCalled();
  });

  it("lista empleados habilitados, mapeando employeeId y los datos del empleado", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1" });
    repo.findEmployees.mockResolvedValue([[employeeRow], 1]);

    const result = await hourConceptsService.listEmployees("concept-1", { page: 1, take: 50 } as never, rrhhUser);

    expect(result.items).toEqual([
      {
        employeeId: "employee-1",
        employee: {
          id: "employee-1",
          legajo: "100",
          cuil: "20-12345678-9",
          firstName: "Ana",
          lastName: "Prueba",
          status: "ACTIVO",
          sector: { id: "sector-1", name: "Campo" },
          costCenter: null,
          companies: [{ id: "company-1", name: "OD" }],
        },
      },
    ]);
    expect(result.meta).toMatchObject({ total: 1, page: 1, pageSize: 50 });
  });

  it("no devuelve empleados no habilitados: si el repository no los trae, la lista queda vacía sin inventar filas", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1" });
    repo.findEmployees.mockResolvedValue([[], 0]);

    const result = await hourConceptsService.listEmployees("concept-1", { page: 1, take: 50 } as never, rrhhUser);

    expect(result.items).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it("pasa los filtros (search/sectorId/costCenterId/companyId/status/page/take) al repository sin transformarlos", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1" });
    repo.findEmployees.mockResolvedValue([[], 0]);

    const query = { search: "perez", sectorId: "sector-1", costCenterId: "cc-1", companyId: "company-1", status: "ACTIVO", page: 2, take: 25 } as never;
    await hourConceptsService.listEmployees("concept-1", query, rrhhUser);

    expect(repo.findEmployees).toHaveBeenCalledWith("concept-1", query, {});
  });

  it("respeta el patrón de permisos por área: un usuario de supervisión no recibe accessWhere vacío como RRHH", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1" });
    repo.findEmployees.mockResolvedValue([[], 0]);
    const supervisionUser = { id: "user-sup", role: roles.supervision } as Express.AuthUser;

    await hourConceptsService.listEmployees("concept-1", { page: 1, take: 50 } as never, supervisionUser);

    const accessWhereUsed = repo.findEmployees.mock.calls.at(0)?.[2];
    expect(accessWhereUsed).not.toEqual({});
    expect(accessWhereUsed).toMatchObject({ assignments: { some: expect.objectContaining({ type: "TIME_RESPONSIBLE", userId: "user-sup" }) } });
  });
});

describe("mockedAudit/invalidateHourConceptsCache no se disparan por listEmployees (es solo lectura)", () => {
  it("no audita ni invalida cache al listar empleados", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1" });
    repo.findEmployees.mockResolvedValue([[], 0]);

    await hourConceptsService.listEmployees("concept-1", { page: 1, take: 50 } as never, rrhhUser);

    expect(mockedAudit).not.toHaveBeenCalled();
    expect(invalidateHourConceptsCache).not.toHaveBeenCalled();
  });
});
