import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { positionsRepository } from "./positions.repository";
import { positionsService } from "./positions.service";
import { roles } from "../../shared/security/roles";
import { auditService } from "../audit/audit.service";

vi.mock("../audit/audit.service", () => ({ auditService: { registerWithin: vi.fn() }, clearAuditDerivedCaches: vi.fn() }));

// Auditoria 2026-08-24 (critico): GET /positions/:id/employees solo tenia
// requireAuth (ver positions.routes.ts) y ademas no filtraba por alcance de
// empleado, a diferencia de los endpoints equivalentes de hour-concepts y
// work-regimes, que si aplican employeeAccessWhere(user). Este archivo cubre
// que Nivel 3 (y supervision) ahora reciben exactamente el mismo filtro de
// alcance que esos endpoints hermanos, y que RRHH sigue viendo todo.
vi.mock("./positions.repository", () => ({
  positionsRepository: {
    findById: vi.fn(),
    existsById: vi.fn(),
    findAssignedEmployees: vi.fn(),
    findMany: vi.fn(),
    findOptions: vi.fn(),
    transaction: vi.fn(),
    resolveScopeNodes: vi.fn(),
    createWithin: vi.fn(),
    updateWithin: vi.fn(),
    findScopeKeys: vi.fn(),
  },
  invalidatePositionsCache: vi.fn(),
}));

const repo = positionsRepository as unknown as { findById: Mock; existsById: Mock; findAssignedEmployees: Mock; findMany: Mock; findOptions: Mock; transaction: Mock; resolveScopeNodes: Mock; createWithin: Mock; updateWithin: Mock; findScopeKeys: Mock };

const rrhhUser = { id: "user-rrhh", role: roles.rrhh } as unknown as Express.AuthUser;
const supervisionUser = { id: "user-sup", role: roles.supervision } as unknown as Express.AuthUser;
const cargaHorariaUser = { id: "user-carga", role: roles.cargaHoraria } as unknown as Express.AuthUser;

const listQuery = { page: 1, take: 25 };

beforeEach(() => {
  vi.clearAllMocks();
  repo.findById.mockResolvedValue({ id: "pos-1", code: "PUE-1", name: "Puesto 1", _count: { employees: 1 } });
  repo.existsById.mockResolvedValue({ id: "pos-1" });
  repo.findAssignedEmployees.mockResolvedValue([[], 0]);
  repo.transaction.mockImplementation((operation: (tx: object) => unknown) => operation({ position: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "pos-1", code: "PUE-1", name: "Puesto 1", status: "ACTIVO" }) } }));
  repo.resolveScopeNodes.mockResolvedValue({ companies: [], businessUnits: [], sectors: [], areas: [] });
  repo.createWithin.mockResolvedValue({ id: "pos-new", code: "PUE-2", name: "Director" });
  repo.updateWithin.mockResolvedValue({ id: "pos-1", code: "PUE-1", name: "Puesto 1" });
  repo.findScopeKeys.mockResolvedValue([]);
});

describe("positionsService.listAssignedEmployees", () => {
  it("RRHH ve todos los empleados del puesto: se le pasa un where vacio (sin restriccion)", async () => {
    await positionsService.listAssignedEmployees("pos-1", listQuery, rrhhUser);

    expect(repo.findAssignedEmployees).toHaveBeenCalledWith("pos-1", listQuery, {});
  });

  it("Supervision solo ve empleados dentro de su alcance: recibe el mismo filtro de employeeAccessWhere que usan hour-concepts/work-regimes", async () => {
    await positionsService.listAssignedEmployees("pos-1", listQuery, supervisionUser);

    const accessWhere = repo.findAssignedEmployees.mock.calls[0]![2];
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
    await positionsService.listAssignedEmployees("pos-1", listQuery, cargaHorariaUser);

    const accessWhere = repo.findAssignedEmployees.mock.calls[0]![2];
    expect(accessWhere.assignments.some.userId).toBe(cargaHorariaUser.id);
    expect(accessWhere.assignments.some.type).toBe("TIME_RESPONSIBLE");
    expect(accessWhere).not.toEqual({});
  });

  it("verifica que el puesto exista antes de listar (404 si no existe)", async () => {
    repo.existsById.mockRejectedValue(new Error("not found"));

    await expect(positionsService.listAssignedEmployees("pos-inexistente", listQuery, rrhhUser)).rejects.toThrow();
    expect(repo.findAssignedEmployees).not.toHaveBeenCalled();
  });

  // Etapa 14H.7: el chequeo de existencia paso de findById() (positionInclude
  // completo) a existsById() (select minimo) — el resultado nunca se usaba
  // para nada mas que el 404, asi que este test confirma que el camino feliz
  // ya no paga ese costo.
  it("usa existsById (select minimo), no findById (positionInclude completo), para el chequeo de existencia", async () => {
    await positionsService.listAssignedEmployees("pos-1", listQuery, rrhhUser);

    expect(repo.existsById).toHaveBeenCalledWith("pos-1");
    expect(repo.findById).not.toHaveBeenCalled();
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

  it("devuelve la página pedida con el total real (antes take: 500 fijo, sin meta)", async () => {
    repo.findAssignedEmployees.mockResolvedValue([[{ id: "emp-1" }], 612]);

    const result = await positionsService.listAssignedEmployees("pos-1", { page: 2, take: 25 }, rrhhUser);

    expect(result).toEqual({ items: [{ id: "emp-1" }], meta: { total: 612, page: 2, pageSize: 25, hasMore: true } });
  });
});

describe("positionsService — alcances organizacionales A5", () => {
  const input = { code: "PUE-2", name: "Director", status: "ACTIVO", responsibilities: [], internalRelations: [], externalRelations: [], competencies: [], workConditions: { modality: "PRESENCIAL", workload: "", workplace: "", relationType: "", observations: "" }, performanceIndicators: [], evaluationCriteria: [], salaryCategoryIds: [], orgScopes: [{ level: "COMPANY", nodeId: "c1" }] };

  it("crea alcance múltiple válido y auditoría dentro de la misma transacción", async () => {
    repo.resolveScopeNodes.mockResolvedValue({ companies: [{ id: "c1", name: "LOSOD", status: "ACTIVO" }, { id: "c2", name: "Tropa", status: "ACTIVO" }], businessUnits: [], sectors: [], areas: [] });
    repo.findById.mockResolvedValue({ id: "pos-new" });
    await positionsService.create({ ...input, orgScopes: [{ level: "COMPANY", nodeId: "c1" }, { level: "COMPANY", nodeId: "c2" }] } as never, { userId: "u1" });
    expect(repo.createWithin).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orgScopes: expect.any(Array) }), "u1");
    expect(auditService.registerWithin).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "CREATE", entity: "Position" }));
  });

  it("rechaza ancestro y descendiente con mensaje claro", async () => {
    repo.resolveScopeNodes.mockResolvedValue({ companies: [{ id: "c1", name: "LOSOD", status: "ACTIVO" }], businessUnits: [{ id: "bu1", name: "Servicios", status: "ACTIVO", companyId: "c1" }], sectors: [], areas: [] });
    await expect(positionsService.create({ ...input, orgScopes: [{ level: "COMPANY", nodeId: "c1" }, { level: "BUSINESS_UNIT", nodeId: "bu1" }] } as never)).rejects.toMatchObject({ code: "POSITION_SCOPE_REDUNDANT", message: expect.stringContaining("incluido por") });
    expect(repo.createWithin).not.toHaveBeenCalled();
  });

  it("rechaza referencia inexistente y nodo legado", async () => {
    await expect(positionsService.create(input as never)).rejects.toMatchObject({ code: "POSITION_SCOPE_INVALID" });
    repo.resolveScopeNodes.mockResolvedValue({ companies: [], businessUnits: [], sectors: [{ id: "s0", name: "Anterior", status: "ACTIVO", businessUnitId: null, businessUnit: null }], areas: [] });
    await expect(positionsService.create({ ...input, orgScopes: [{ level: "SECTOR", nodeId: "s0" }] } as never)).rejects.toMatchObject({ code: "POSITION_SCOPE_LEGACY" });
  });

  it("permite conservar un alcance inactivo existente, pero no agregarlo", async () => {
    repo.resolveScopeNodes.mockResolvedValue({ companies: [{ id: "c1", name: "LOSOD", status: "INACTIVO" }], businessUnits: [], sectors: [], areas: [] });
    await expect(positionsService.create(input as never)).rejects.toMatchObject({ code: "POSITION_SCOPE_INACTIVE" });
    repo.findScopeKeys.mockResolvedValue([{ level: "COMPANY", companyId: "c1", businessUnitId: null, sectorId: null, areaId: null }]);
    await expect(positionsService.update("pos-1", { orgScopes: [{ level: "COMPANY", nodeId: "c1" }] } as never)).resolves.toBeDefined();
  });
});
