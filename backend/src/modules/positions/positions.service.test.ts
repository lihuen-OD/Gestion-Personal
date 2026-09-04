import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { positionsRepository } from "./positions.repository";
import { positionsService } from "./positions.service";
import { roles } from "../../shared/security/roles";

// Auditoria 2026-08-24 (critico): GET /positions/:id/employees solo tenia
// requireAuth (ver positions.routes.ts) y ademas no filtraba por alcance de
// empleado, a diferencia de los endpoints equivalentes de hour-concepts y
// work-regimes, que si aplican employeeAccessWhere(user). Este archivo cubre
// que Nivel 3 (y supervision) ahora reciben exactamente el mismo filtro de
// alcance que esos endpoints hermanos, y que RRHH sigue viendo todo.
vi.mock("./positions.repository", () => ({
  positionsRepository: {
    findById: vi.fn(),
    findAssignedEmployees: vi.fn(),
    findMany: vi.fn(),
    findOptions: vi.fn(),
  },
  invalidatePositionsCache: vi.fn(),
}));

const repo = positionsRepository as unknown as { findById: Mock; findAssignedEmployees: Mock; findMany: Mock; findOptions: Mock };

const rrhhUser = { id: "user-rrhh", role: roles.rrhh } as unknown as Express.AuthUser;
const supervisionUser = { id: "user-sup", role: roles.supervision } as unknown as Express.AuthUser;
const cargaHorariaUser = { id: "user-carga", role: roles.cargaHoraria } as unknown as Express.AuthUser;

beforeEach(() => {
  vi.clearAllMocks();
  repo.findById.mockResolvedValue({ id: "pos-1", code: "PUE-1", name: "Puesto 1", _count: { employees: 1 } });
  repo.findAssignedEmployees.mockResolvedValue([]);
});

describe("positionsService.listAssignedEmployees", () => {
  it("RRHH ve todos los empleados del puesto: se le pasa un where vacio (sin restriccion)", async () => {
    await positionsService.listAssignedEmployees("pos-1", rrhhUser);

    expect(repo.findAssignedEmployees).toHaveBeenCalledWith("pos-1", {});
  });

  it("Supervision solo ve empleados dentro de su alcance: recibe el mismo filtro de employeeAccessWhere que usan hour-concepts/work-regimes", async () => {
    await positionsService.listAssignedEmployees("pos-1", supervisionUser);

    const accessWhere = repo.findAssignedEmployees.mock.calls[0]![1];
    expect(accessWhere).toEqual({
      assignments: {
        some: {
          type: "TIME_RESPONSIBLE",
          userId: supervisionUser.id,
          AND: [
            { OR: [{ status: null }, { status: "ACTIVO" }, { status: "Activo" }] },
            { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: expect.any(Date) } }] },
            { OR: [{ effectiveTo: null }, { effectiveTo: { gte: expect.any(Date) } }] },
          ],
        },
      },
    });
  });

  it("Nivel 3 (Carga Horaria) tambien queda acotado a sus empleados asignados, no ve el puesto completo", async () => {
    await positionsService.listAssignedEmployees("pos-1", cargaHorariaUser);

    const accessWhere = repo.findAssignedEmployees.mock.calls[0]![1];
    expect(accessWhere.assignments.some.userId).toBe(cargaHorariaUser.id);
    expect(accessWhere.assignments.some.type).toBe("TIME_RESPONSIBLE");
    expect(accessWhere).not.toEqual({});
  });

  it("verifica que el puesto exista antes de listar (404 si no existe)", async () => {
    repo.findById.mockRejectedValue(new Error("not found"));

    await expect(positionsService.listAssignedEmployees("pos-inexistente", rrhhUser)).rejects.toThrow();
    expect(repo.findAssignedEmployees).not.toHaveBeenCalled();
  });
});

describe("positionsService.list — Etapa 9E (meta de paginación)", () => {
  it("arma meta.total/page/pageSize/hasMore a partir de lo que devuelve el repository", async () => {
    repo.findMany.mockResolvedValue([[{ id: "pos-1" }, { id: "pos-2" }], 42]);

    const result = await positionsService.list({ page: 2, take: 2 } as never);

    expect(result.items).toEqual([{ id: "pos-1" }, { id: "pos-2" }]);
    expect(result.meta).toEqual({ total: 42, page: 2, pageSize: 2, hasMore: true });
  });

  it("hasMore es false cuando la página actual ya cubre el total", async () => {
    repo.findMany.mockResolvedValue([[{ id: "pos-1" }], 1]);

    const result = await positionsService.list({ page: 1, take: 25 } as never);

    expect(result.meta).toEqual({ total: 1, page: 1, pageSize: 25, hasMore: false });
  });

  it("caso sin resultados: meta.total en 0, items vacío", async () => {
    repo.findMany.mockResolvedValue([[], 0]);

    const result = await positionsService.list({ page: 1, take: 25 } as never);

    expect(result.items).toEqual([]);
    expect(result.meta).toEqual({ total: 0, page: 1, pageSize: 25, hasMore: false });
  });
});

describe("positionsService.listOptions — Etapa 14D.4", () => {
  it("delega directo al repositorio, sin transformar el resultado", async () => {
    const rows = [{ id: "pos-1", code: "PUE-1", name: "Puesto 1" }];
    repo.findOptions.mockResolvedValue(rows);

    const result = await positionsService.listOptions({ take: 300 } as never);

    expect(repo.findOptions).toHaveBeenCalledWith({ take: 300 });
    expect(result).toBe(rows);
  });
});
