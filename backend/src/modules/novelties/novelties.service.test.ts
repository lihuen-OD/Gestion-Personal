import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { noveltiesRepository } from "./novelties.repository";
import { noveltiesService } from "./novelties.service";
import { createNoveltySchema } from "./novelties.schemas";
import { roles } from "../../shared/security/roles";

vi.mock("./novelties.repository", () => ({
  noveltiesRepository: {
    findById: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    countEmployees: vi.fn(),
    findNoveltyType: vi.fn(),
    createMany: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

vi.mock("../workforce-management/workforce.service", () => ({
  notifyRrhh: vi.fn().mockResolvedValue(undefined),
}));

const repo = noveltiesRepository as unknown as {
  findById: Mock;
  approve: Mock;
  reject: Mock;
  countEmployees: Mock;
  findNoveltyType: Mock;
  createMany: Mock;
};

const rrhhUser = { id: "user-rrhh", role: roles.rrhh } as unknown as Express.AuthUser;
const supervisionUser = { id: "user-sup", role: roles.supervision } as unknown as Express.AuthUser;

function novelty(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "novelty-1",
    status: "PENDIENTE",
    noveltyType: { code: "VAC", name: "Vacaciones", approvalRoles: [] },
    employee: { legajo: "100" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("noveltiesService.approve", () => {
  it("aprueba una novedad PENDIENTE", async () => {
    repo.findById.mockResolvedValue(novelty());
    repo.approve.mockResolvedValue(novelty({ status: "APROBADO" }));

    const result = await noveltiesService.approve("novelty-1", rrhhUser);

    expect(result.status).toBe("APROBADO");
    expect(repo.approve).toHaveBeenCalledWith("novelty-1", rrhhUser.id);
  });

  it("impide aprobar una novedad ya aprobada (regresion: la guarda ya existia, se protege con test)", async () => {
    repo.findById.mockResolvedValue(novelty({ status: "APROBADO" }));

    await expect(noveltiesService.approve("novelty-1", rrhhUser)).rejects.toMatchObject({
      statusCode: 400,
      code: "NOVELTY_STATUS_NOT_APPROVABLE",
    });
    expect(repo.approve).not.toHaveBeenCalled();
  });

  it("impide que un rol sin permiso de aprobacion para ese tipo de novedad apruebe", async () => {
    repo.findById.mockResolvedValue(novelty({ noveltyType: { code: "VAC", name: "Vacaciones", approvalRoles: [] } }));

    await expect(noveltiesService.approve("novelty-1", supervisionUser)).rejects.toMatchObject({
      statusCode: 403,
      code: "NOVELTY_APPROVAL_FORBIDDEN",
    });
    expect(repo.approve).not.toHaveBeenCalled();
  });
});

describe("noveltiesService.reject", () => {
  it("rechaza una novedad PENDIENTE con motivo", async () => {
    repo.findById.mockResolvedValue(novelty());
    repo.reject.mockResolvedValue(novelty({ status: "RECHAZADO" }));

    const result = await noveltiesService.reject("novelty-1", { reason: "Datos incompletos" }, rrhhUser);

    expect(result.status).toBe("RECHAZADO");
  });

  it("impide rechazar dos veces la misma novedad (regresion)", async () => {
    repo.findById.mockResolvedValue(novelty({ status: "RECHAZADO" }));

    await expect(noveltiesService.reject("novelty-1", { reason: "otra vez" }, rrhhUser)).rejects.toMatchObject({
      statusCode: 400,
      code: "NOVELTY_STATUS_NOT_REJECTABLE",
    });
    expect(repo.reject).not.toHaveBeenCalled();
  });
});

function createInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    employeeIds: ["emp-1"],
    noveltyTypeId: "type-1",
    fromDate: new Date("2026-08-10"),
    toDate: null,
    quantityHours: null,
    quantityDays: null,
    observation: null,
    targetHourConceptId: null,
    ...overrides,
  } as Parameters<typeof noveltiesService.create>[0];
}

function noveltyType(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "type-1",
    code: "VAC",
    name: "Vacaciones",
    status: "ACTIVO",
    allowsHours: false,
    allowsDateTo: true,
    hasValidity: false,
    setsWorkedHoursToZero: false,
    allowedLoadRoles: [] as string[],
    ...overrides,
  };
}

describe("noveltiesService.create", () => {
  beforeEach(() => {
    repo.countEmployees.mockResolvedValue(1);
    repo.findNoveltyType.mockResolvedValue(noveltyType());
    repo.createMany.mockResolvedValue([{ id: "novelty-new" }]);
  });

  it("crea una novedad valida: RRHH crea ya APROBADO y no notifica a RH (es RH)", async () => {
    const items = await noveltiesService.create(createInput(), rrhhUser);

    expect(items).toEqual([{ id: "novelty-new" }]);
    expect(repo.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ employeeIds: ["emp-1"] }),
      "APROBADO",
      rrhhUser.id,
      expect.objectContaining({ createZeroTimeEntries: false }),
    );
  });

  it("un rol no-RRHH crea la novedad PENDIENTE y notifica a RH", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ allowedLoadRoles: [roles.supervision] }));

    const items = await noveltiesService.create(createInput(), supervisionUser);

    expect(items).toEqual([{ id: "novelty-new" }]);
    expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "PENDIENTE", supervisionUser.id, expect.anything());
  });

  it("rechaza si algun empleado esta fuera del alcance de quien crea (EMPLOYEE_SCOPE_FORBIDDEN)", async () => {
    repo.countEmployees.mockResolvedValue(0);

    await expect(noveltiesService.create(createInput({ employeeIds: ["emp-1", "emp-2"] }), supervisionUser)).rejects.toMatchObject({
      statusCode: 403,
      code: "EMPLOYEE_SCOPE_FORBIDDEN",
    });
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  it("rechaza si el tipo de novedad no existe o esta inactivo (NOVELTY_TYPE_NOT_AVAILABLE)", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ status: "INACTIVO" }));

    await expect(noveltiesService.create(createInput(), rrhhUser)).rejects.toMatchObject({
      statusCode: 400,
      code: "NOVELTY_TYPE_NOT_AVAILABLE",
    });
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  it("rechaza cantidad de horas si el tipo no la permite (NOVELTY_HOURS_NOT_ALLOWED)", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: false }));

    await expect(noveltiesService.create(createInput({ quantityHours: 4 }), rrhhUser)).rejects.toMatchObject({
      statusCode: 400,
      code: "NOVELTY_HOURS_NOT_ALLOWED",
    });
  });

  it("rechaza fechaHasta si el tipo no la permite (NOVELTY_TO_DATE_NOT_ALLOWED)", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsDateTo: false }));

    await expect(
      noveltiesService.create(createInput({ fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-12") }), rrhhUser),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TO_DATE_NOT_ALLOWED" });
  });

  it("exige fechaDesde y fechaHasta cuando el tipo tiene vigencia obligatoria (NOVELTY_VALIDITY_REQUIRED)", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ hasValidity: true, allowsDateTo: true }));

    await expect(noveltiesService.create(createInput({ toDate: null }), rrhhUser)).rejects.toMatchObject({
      statusCode: 400,
      code: "NOVELTY_VALIDITY_REQUIRED",
    });
  });

  it("rechaza si el rol de quien crea no esta habilitado para cargar este tipo de novedad (NOVELTY_LOAD_FORBIDDEN)", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ allowedLoadRoles: [roles.rrhh] }));

    await expect(noveltiesService.create(createInput(), supervisionUser)).rejects.toMatchObject({
      statusCode: 403,
      code: "NOVELTY_LOAD_FORBIDDEN",
    });
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  // NOTA (auditoria 2026-08-24): no se encontro, en create() ni en
  // novelties.dateRange.ts, ninguna validacion que rechace novedades
  // solapadas (mismo empleado + rango de fechas superpuesto) ni duplicados
  // logicos (mismo empleado + tipo + fecha). noveltyCoversDay solo se usa
  // para calcular cobertura dia-por-dia en la grilla mensual de horas
  // (timeEntries.repository.ts), no para bloquear la creacion. No se agrega
  // esa regla aqui porque implementarla es logica de negocio nueva, fuera
  // del alcance autorizado para esta etapa — queda documentado como pendiente
  // de decision, no como bug cerrado.
  it("DOCUMENTA UN GAP REAL: hoy no existe ningun chequeo de solapamiento/duplicado al crear (no hay assert que lo bloquee)", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType());
    repo.createMany.mockResolvedValue([{ id: "novelty-a" }]);

    const first = await noveltiesService.create(createInput({ fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-15") }), rrhhUser);
    const second = await noveltiesService.create(createInput({ fromDate: new Date("2026-08-12"), toDate: new Date("2026-08-20") }), rrhhUser);

    // Ambas creaciones se completan sin error pese a solaparse en fechas
    // para el mismo empleado — este test falla (a proposito) si alguien
    // agrega la validacion mas adelante, como recordatorio de actualizarlo.
    expect(first).toEqual([{ id: "novelty-a" }]);
    expect(second).toEqual([{ id: "novelty-a" }]);
    expect(repo.createMany).toHaveBeenCalledTimes(2);
  });
});

describe("createNoveltySchema — fechas invalidas", () => {
  it("rechaza toDate anterior a fromDate", () => {
    const result = createNoveltySchema.safeParse({
      employeeIds: ["11111111-1111-1111-1111-111111111111"],
      noveltyTypeId: "22222222-2222-2222-2222-222222222222",
      fromDate: "2026-08-15",
      toDate: "2026-08-10",
    });
    expect(result.success).toBe(false);
  });

  it("acepta toDate igual o posterior a fromDate", () => {
    const result = createNoveltySchema.safeParse({
      employeeIds: ["11111111-1111-1111-1111-111111111111"],
      noveltyTypeId: "22222222-2222-2222-2222-222222222222",
      fromDate: "2026-08-10",
      toDate: "2026-08-15",
    });
    expect(result.success).toBe(true);
  });
});
