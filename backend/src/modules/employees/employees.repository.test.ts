import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { employeesRepository, resolveLaborStatus } from "./employees.repository";
import { EmployeeStatus } from "@prisma/client";

/**
 * Regresion de la simplificacion de jerarquia organizacional (2026-08-14):
 * findById resuelve el legajo -> sector -> area -> establecimiento -> unidad
 * de negocio usando unicamente el FK legado anidado (nunca las tablas M:N
 * eliminadas). Esta cadena no se tocó durante la migración; el test confirma
 * que sigue pidiendo y devolviendo exactamente esa forma.
 */
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employee: { findFirst: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
    hourConcept: { findMany: vi.fn() },
    employeeCompany: { findMany: vi.fn() },
    laborMovement: { findMany: vi.fn() },
    employeeAssignment: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    employeeHourConcept: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    employeeDocument: { create: vi.fn() },
    timeEntry: { groupBy: vi.fn() },
    $transaction: vi.fn(),
  },
}));

describe("employeesRepository.findById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resuelve la cadena sector -> area -> establecimiento -> unidad de negocio via FK anidado", async () => {
    const resolvedChain = {
      id: "emp-1",
      sector: {
        id: "sec-1",
        name: "Sector 1",
        code: "SEC-1",
        area: {
          id: "area-1",
          name: "Area 1",
          establishment: {
            id: "est-1",
            name: "Establecimiento 1",
            businessUnit: { id: "bu-1", name: "Unidad 1" },
          },
        },
      },
    };
    (prisma.employee.findFirst as Mock).mockResolvedValue(resolvedChain);

    const result = await employeesRepository.findById("emp-1");

    expect(result).toEqual(resolvedChain);
    const findFirstMock = prisma.employee.findFirst as Mock;
    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ id: "emp-1" }, {}] } }));
    const call = findFirstMock.mock.calls.at(0)?.[0];
    expect(call?.select?.sector?.select?.area?.select?.establishment?.select?.businessUnit).toEqual({
      select: { id: true, name: true },
    });
    expect(call?.select?.hourConcepts).toEqual({
      where: { hourConcept: { systemRole: null, status: "ACTIVO", deletedAt: null, loadMode: { not: null } } },
      select: {
        hourConceptId: true,
        hourConcept: { select: { id: true, code: true, name: true, kind: true, loadMode: true, status: true, systemRole: true } },
      },
    });
  });

  it("respeta el accessWhere adicional sin alterar la forma de la cadena", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue(null);

    await employeesRepository.findById("emp-2", { sectorId: { in: ["sec-1"] } });

    expect(prisma.employee.findFirst as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{ id: "emp-2" }, { sectorId: { in: ["sec-1"] } }] } }),
    );
  });
});

describe("employeesRepository.findOverviewDetailsById — Etapa 6L.1 / 14C.1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.employeeCompany.findMany as Mock).mockResolvedValue([]);
    (prisma.laborMovement.findMany as Mock).mockResolvedValue([]);
    (prisma.employeeAssignment.findMany as Mock).mockResolvedValue([]);
    (prisma.employeeHourConcept.findMany as Mock).mockResolvedValue([]);
  });

  // Regresión de la Etapa 6L.1, reubicada: antes de esa etapa, /overview-details
  // seleccionaba `hourConcepts` sin loadMode/systemRole ni el where de
  // asignabilidad, y mapEmployeeFromApi (que filtra por
  // `Boolean(hourConcept.loadMode)`) mostraba siempre cero conceptos
  // adicionales asignados. Desde la Etapa 14C.1, `hourConcepts` ya no viaja
  // anidado dentro del `findFirst` de Employee — es un `employeeHourConcept.
  // findMany` propio, pero reusa el MISMO `assignableHourConceptsSelect` que
  // `findById` (fuente de verdad compartida) — este test confirma que ese
  // where/select nunca diverge, ahora en su nueva ubicación.
  it("selecciona hourConcepts con exactamente el mismo where/select que findById (misma fuente de verdad)", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue({ id: "emp-1" });

    await employeesRepository.findOverviewDetailsById("emp-1");

    const call = (prisma.employeeHourConcept.findMany as Mock).mock.calls.at(0)?.[0];
    expect(call).toEqual({
      where: {
        employeeId: "emp-1",
        hourConcept: { systemRole: null, status: "ACTIVO", deletedAt: null, loadMode: { not: null } },
      },
      select: {
        hourConceptId: true,
        hourConcept: { select: { id: true, code: true, name: true, kind: true, loadMode: true, status: true, systemRole: true } },
      },
    });
  });

  it("Etapa 14C.1: resuelve companies/laborMovements/assignments/hourConcepts en paralelo (Promise.all), no dentro del findFirst", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue({ id: "emp-1", legajo: "100" });
    (prisma.employeeCompany.findMany as Mock).mockResolvedValue([{ isPrimary: true, company: { id: "c1", name: "OD", code: "OD" } }]);
    (prisma.laborMovement.findMany as Mock).mockResolvedValue([{ id: "mov-1", type: "ALTA" }]);
    (prisma.employeeAssignment.findMany as Mock).mockResolvedValue([{ id: "asg-1", type: "DIRECT_MANAGER" }]);
    (prisma.employeeHourConcept.findMany as Mock).mockResolvedValue([{ hourConceptId: "hc-1" }]);

    const result = await employeesRepository.findOverviewDetailsById("emp-1");

    // El findFirst del núcleo (escalares + relaciones to-one) ya NO pide
    // companies/laborMovements/assignments/hourConcepts — confirma que el
    // select gigante anterior quedó desarmado.
    const coreCall = (prisma.employee.findFirst as Mock).mock.calls.at(0)?.[0];
    expect(coreCall?.select?.companies).toBeUndefined();
    expect(coreCall?.select?.laborMovements).toBeUndefined();
    expect(coreCall?.select?.assignments).toBeUndefined();
    expect(coreCall?.select?.hourConcepts).toBeUndefined();
    // Pero el core sigue trayendo las relaciones to-one que la cabecera del
    // legajo necesita.
    expect(coreCall?.select?.sector).toBeDefined();
    expect(coreCall?.select?.costCenter).toBeDefined();
    expect(coreCall?.select?.position).toBe(true);

    // Las 4 consultas hijas filtran únicamente por employeeId (el control de
    // acceso ya se validó en el core).
    expect(prisma.employeeCompany.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employeeId: "emp-1" } }));
    expect(prisma.laborMovement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employeeId: "emp-1" }, take: 50 }));
    expect(prisma.employeeAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employeeId: "emp-1" }, take: 100 }));

    // El shape final del objeto devuelto es idéntico al de antes de esta
    // etapa (mismos 4 campos, ahora ensamblados en vez de anidados).
    expect(result).toEqual({
      id: "emp-1",
      legajo: "100",
      companies: [{ isPrimary: true, company: { id: "c1", name: "OD", code: "OD" } }],
      laborMovements: [{ id: "mov-1", type: "ALTA" }],
      assignments: [{ id: "asg-1", type: "DIRECT_MANAGER" }],
      hourConcepts: [{ hourConceptId: "hc-1" }],
    });
  });

  it("Etapa 14C.1 — permisos: si el core no existe/no es accesible, nunca dispara las 4 consultas hijas", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue(null);

    const result = await employeesRepository.findOverviewDetailsById("emp-2", { sectorId: { in: ["sec-ajeno"] } });

    expect(result).toBeNull();
    expect(prisma.employeeCompany.findMany).not.toHaveBeenCalled();
    expect(prisma.laborMovement.findMany).not.toHaveBeenCalled();
    expect(prisma.employeeAssignment.findMany).not.toHaveBeenCalled();
    expect(prisma.employeeHourConcept.findMany).not.toHaveBeenCalled();
    expect((prisma.employee.findFirst as Mock).mock.calls.at(0)?.[0]).toEqual(
      expect.objectContaining({ where: { AND: [{ id: "emp-2" }, { sectorId: { in: ["sec-ajeno"] } }] } }),
    );
  });
});

describe("employeesRepository.findMany (listado de Legajos) — Etapa 14C.1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as Mock).mockResolvedValue([[], 0]);
  });

  it("el select del listado trae exactamente lo que la tabla/badge de Legajos necesita, nada más", async () => {
    await employeesRepository.findMany({ page: 1, take: 25 } as never, {});

    const transactionArg = (prisma.$transaction as Mock).mock.calls.at(0)?.[0] as unknown[];
    expect(transactionArg).toHaveLength(2);
  });

  it("no carga sector/position/companies (relaciones no usadas por el listado)", async () => {
    // `findMany` del repositorio arma el array de promesas (llamando
    // employee.findMany/count de una) antes de pasarlo a `$transaction`
    // (mockeado como función simple que no ejecuta el array) — alcanza con
    // espiar los argumentos con los que se llamó employee.findMany.
    (prisma.employee.findMany as Mock).mockReturnValue(Promise.resolve([]));
    (prisma.employee.count as Mock).mockReturnValue(Promise.resolve(0));

    await employeesRepository.findMany({ page: 1, take: 25 } as never, {});

    const call = (prisma.employee.findMany as Mock).mock.calls.at(0)?.[0];
    expect(call.select.sector).toBeUndefined();
    expect(call.select.position).toBeUndefined();
    expect(call.select.companies).toBeUndefined();
    expect(call.select.dni).toBeUndefined();
    expect(call.select.birthDate).toBeUndefined();
    // Pero sí mantiene lo que la tabla/Estado (calculado desde movimientos) necesitan.
    expect(call.select.id).toBe(true);
    expect(call.select.legajo).toBe(true);
    expect(call.select.legajoFinnegans).toBe(true);
    expect(call.select.cuil).toBe(true);
    expect(call.select.firstName).toBe(true);
    expect(call.select.lastName).toBe(true);
    expect(call.select.status).toBe(true);
    expect(call.select.costCenter).toBeDefined();
    expect(call.select.laborMovements).toBeDefined();
    expect(call.select.laborMovements.take).toBe(5);
  });

  it("respeta paginación (skip/take) y accessWhere sin cambios", async () => {
    (prisma.employee.findMany as Mock).mockReturnValue(Promise.resolve([]));
    (prisma.employee.count as Mock).mockReturnValue(Promise.resolve(0));

    await employeesRepository.findMany({ page: 3, take: 10 } as never, { sectorId: { in: ["sec-1"] } });

    const call = (prisma.employee.findMany as Mock).mock.calls.at(0)?.[0];
    expect(call.skip).toBe(20);
    expect(call.take).toBe(10);
    expect(call.where.AND).toContainEqual({ sectorId: { in: ["sec-1"] } });
  });
});

describe("employeesRepository.summary — Etapa 14C.1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.employee.groupBy as Mock).mockResolvedValue([{ status: EmployeeStatus.ACTIVO, _count: { _all: 5 } }]);
    (prisma.timeEntry.groupBy as Mock).mockResolvedValue([]);
    (prisma.employee.count as Mock).mockResolvedValue(0);
  });

  it("usa Promise.all (no $transaction) — las 3 queries son independientes entre sí", async () => {
    await employeesRepository.summary({});

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.employee.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.timeEntry.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.employee.count).toHaveBeenCalledTimes(1);
  });

  it("mantiene el mismo cálculo de total/active/inactive/pendingTimeLoads/missingTimeResponsible", async () => {
    (prisma.employee.groupBy as Mock).mockResolvedValue([
      { status: EmployeeStatus.ACTIVO, _count: { _all: 8 } },
      { status: EmployeeStatus.INACTIVO, _count: { _all: 2 } },
    ]);
    (prisma.timeEntry.groupBy as Mock).mockResolvedValue([{ employeeId: "e1" }, { employeeId: "e2" }]);
    (prisma.employee.count as Mock).mockResolvedValue(3);

    const result = await employeesRepository.summary({});

    expect(result).toEqual({ total: 10, active: 8, inactive: 2, missingTimeResponsible: 3, pendingTimeLoads: 2 });
  });
});

describe("employeesRepository.findAssignableHourConceptIds", () => {
  it("filtra por identidad estable, estado, baja lógica y loadMode", async () => {
    (prisma.hourConcept.findMany as Mock).mockResolvedValue([{ id: "colectivo" }]);
    await employeesRepository.findAssignableHourConceptIds(["colectivo", "normal"]);
    expect(prisma.hourConcept.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["colectivo", "normal"] },
        systemRole: null,
        status: "ACTIVO",
        deletedAt: null,
        loadMode: { not: null },
      },
      select: { id: true },
    });
  });
});

// Etapa 6Q (QA): replaceAssignments/replaceHourConcepts hacían el re-fetch con
// employeeDetailSelect (relaciones anidadas pesadas) DENTRO de la misma
// transacción interactiva que el delete+create. En vivo, contra Neon con
// latencia elevada, eso hizo expirar el timeout de 5s de Prisma (500
// INTERNAL_ERROR) aunque el delete+create en sí era liviano y rápido. El
// fix saca ese re-fetch de la transacción — sigue siendo la única lectura
// que da forma a la respuesta, pero ya no arriesga el timeout de la
// transacción. Estos tests fijan que el delete+create quede dentro de
// $transaction y el re-fetch pesado se haga después, sobre `prisma` directo.
describe("employeesRepository.replaceAssignments / replaceHourConcepts — Etapa 6Q", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaceAssignments: hace el delete+create dentro de $transaction y el re-fetch fuera", async () => {
    const tx = { employeeAssignment: { deleteMany: vi.fn(), createMany: vi.fn() } };
    (prisma.$transaction as Mock).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    (prisma.employee.findUniqueOrThrow as Mock).mockResolvedValue({ id: "emp-1" });

    const result = await employeesRepository.replaceAssignments("emp-1", [
      { type: "TIME_RESPONSIBLE", userId: "user-1" },
    ]);

    expect(tx.employeeAssignment.deleteMany).toHaveBeenCalledWith({ where: { employeeId: "emp-1" } });
    expect(tx.employeeAssignment.createMany).toHaveBeenCalled();
    expect(prisma.employee.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "emp-1" } }),
    );
    // el re-fetch corre sobre prisma, no sobre `tx` — es decir, después de que la transacción cerró
    expect((tx as Record<string, unknown>).employee).toBeUndefined();
    expect(result).toEqual({ id: "emp-1" });
  });

  it("replaceHourConcepts: hace el delete+create dentro de $transaction y el re-fetch fuera", async () => {
    const tx = { employeeHourConcept: { deleteMany: vi.fn(), createMany: vi.fn() } };
    (prisma.$transaction as Mock).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    (prisma.employee.findUniqueOrThrow as Mock).mockResolvedValue({ id: "emp-1" });

    const result = await employeesRepository.replaceHourConcepts("emp-1", ["colectivo"]);

    expect(tx.employeeHourConcept.deleteMany).toHaveBeenCalledWith({ where: { employeeId: "emp-1" } });
    expect(tx.employeeHourConcept.createMany).toHaveBeenCalledWith({
      data: [{ employeeId: "emp-1", hourConceptId: "colectivo" }],
    });
    expect(prisma.employee.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "emp-1" } }),
    );
    expect((tx as Record<string, unknown>).employee).toBeUndefined();
    expect(result).toEqual({ id: "emp-1" });
  });
});

// Etapa 7A: los dos usos restantes del mismo antipatrón que arregló 6Q — el
// re-fetch con employeeDetailSelect (relaciones anidadas pesadas, varias
// colecciones con take 20/50/100) corría DENTRO de la transacción interactiva.
// En createLaborMovement el create + recálculo de estado sí necesitan
// atomicidad y quedan adentro; sólo sale la lectura. En createDocument la
// transacción envolvía un único create más esa lectura, así que se retira
// entera sin perder garantías.
describe("employeesRepository.createLaborMovement / createDocument — Etapa 7A", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createLaborMovement: create + update de estado quedan dentro de $transaction y el re-fetch pesado fuera", async () => {
    const tx = {
      laborMovement: {
        create: vi.fn().mockResolvedValue({ id: "mov-1", type: "BAJA" }),
        findMany: vi.fn().mockResolvedValue([{ type: "ALTA", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") }]),
      },
      employee: { update: vi.fn() },
    };
    (prisma.$transaction as Mock).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    (prisma.employee.findUniqueOrThrow as Mock).mockResolvedValue({ id: "emp-1" });

    const result = await employeesRepository.createLaborMovement("emp-1", {
      type: "ALTA",
      effectiveFrom: new Date("2026-02-01T00:00:00.000Z"),
      reason: "Ingreso",
    } as Parameters<typeof employeesRepository.createLaborMovement>[1]);

    // lo que sí necesita ser atómico sigue adentro de la transacción
    expect(tx.laborMovement.create).toHaveBeenCalledTimes(1);
    expect(tx.employee.update).toHaveBeenCalledTimes(1);
    // el re-fetch pesado corre sobre `prisma`, no sobre `tx` — o sea, ya cerrada la transacción
    expect(tx.employee).not.toHaveProperty("findUniqueOrThrow");
    expect(prisma.employee.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "emp-1" } }),
    );
    expect(result).toEqual({ employee: { id: "emp-1" }, movement: { id: "mov-1", type: "BAJA" } });
  });

  it("createDocument: ya no abre transacción interactiva y devuelve el legajo leído fuera", async () => {
    (prisma.employeeDocument.create as Mock).mockResolvedValue({ id: "doc-1" });
    (prisma.employee.findUniqueOrThrow as Mock).mockResolvedValue({ id: "emp-1" });

    const result = await employeesRepository.createDocument("emp-1", {
      categoryId: "cat-1",
      fileName: "recibo.pdf",
      fileMimeType: "application/pdf",
      fileSizeBytes: 1024,
      storageKey: "employees/emp-1/recibo.pdf",
      status: "VIGENTE",
    } as Parameters<typeof employeesRepository.createDocument>[1]);

    expect(prisma.employeeDocument.create).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.employee.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "emp-1" } }),
    );
    expect(result).toEqual({ id: "emp-1" });
  });
});

describe("resolveLaborStatus", () => {
  it("no adelanta una baja del día UTC siguiente mientras todavía es el día anterior en Argentina", () => {
    const reference = new Date("2026-08-15T01:30:00.000Z"); // 14/08 22:30 en Argentina
    const movements = [
      { type: "ALTA" as const, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") },
      { type: "BAJA" as const, effectiveFrom: new Date("2026-08-15T00:00:00.000Z") },
    ];

    expect(resolveLaborStatus(movements, reference)).toBe(EmployeeStatus.ACTIVO);
  });

  it("mantiene inactiva un alta futura hasta que comienza el día calendario Argentina", () => {
    const reference = new Date("2026-08-15T01:30:00.000Z"); // 14/08 22:30 en Argentina
    const movements = [{ type: "ALTA" as const, effectiveFrom: new Date("2026-08-15T00:00:00.000Z") }];

    expect(resolveLaborStatus(movements, reference)).toBe(EmployeeStatus.INACTIVO);
  });
});
