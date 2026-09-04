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
    novelty: { findMany: vi.fn() },
    employeeDocument: { create: vi.fn(), findMany: vi.fn() },
    employeeFieldHistory: { findMany: vi.fn(), create: vi.fn() },
    employeeBlockHistory: { findMany: vi.fn(), create: vi.fn() },
    position: { findUnique: vi.fn() },
    timeEntry: { groupBy: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// Etapa 14C.2 (ampliada): findById y los 7 endpoints de guardado de Legajos
// que devuelven el legajo completo (updateContact, upsertAddress,
// upsertTransport, replaceAssignments, replaceHourConcepts,
// createLaborMovement, createDocument) ahora arman la respuesta con
// `findEmployeeDetailById`/`findEmployeeDetailByIdOrThrow`: el core (findFirst
// / findUniqueOrThrow) más `attachEmployeeDetailRelations` (6 findMany en
// paralelo). Este helper deja esas 6 en `[]` por default para no repetir el
// mock en cada describe block que ejercita alguno de esos 8 call sites.
function mockEmptyDetailRelations() {
  (prisma.employeeCompany.findMany as Mock).mockResolvedValue([]);
  (prisma.laborMovement.findMany as Mock).mockResolvedValue([]);
  (prisma.employeeAssignment.findMany as Mock).mockResolvedValue([]);
  (prisma.employeeHourConcept.findMany as Mock).mockResolvedValue([]);
  (prisma.novelty.findMany as Mock).mockResolvedValue([]);
  (prisma.employeeDocument.findMany as Mock).mockResolvedValue([]);
}
const emptyDetailRelations = { companies: [], laborMovements: [], assignments: [], hourConcepts: [], novelties: [], documents: [] };

describe("employeesRepository.findById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmptyDetailRelations();
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

    // Etapa 14C.2 (ampliada): el core (findFirst) trae la cadena sector/etc.
    // igual que antes; companies/laborMovements/assignments/hourConcepts/
    // novelties/documents se agregan aparte, vía attachEmployeeDetailRelations.
    expect(result).toEqual({ ...resolvedChain, ...emptyDetailRelations });
    const findFirstMock = prisma.employee.findFirst as Mock;
    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ id: "emp-1" }, {}] } }));
    const call = findFirstMock.mock.calls.at(0)?.[0];
    expect(call?.select?.sector?.select?.area?.select?.establishment?.select?.businessUnit).toEqual({
      select: { id: true, name: true },
    });
    // hourConcepts ya no viaja anidado en el core (ver comentario arriba de
    // employeeDetailCoreSelect) — se resuelve como employeeHourConcept.findMany
    // propio, reusando el mismo where/select que findOverviewDetailsById.
    expect(call?.select?.hourConcepts).toBeUndefined();
    expect(prisma.employeeHourConcept.findMany).toHaveBeenCalledWith({
      where: { employeeId: "emp-1", hourConcept: { systemRole: null, status: "ACTIVO", deletedAt: null, loadMode: { not: null } } },
      select: {
        hourConceptId: true,
        hourConcept: { select: { id: true, code: true, name: true, kind: true, loadMode: true, status: true, systemRole: true } },
      },
    });
  });

  it("respeta el accessWhere adicional sin alterar la forma de la cadena", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue(null);

    const result = await employeesRepository.findById("emp-2", { sectorId: { in: ["sec-1"] } });

    expect(prisma.employee.findFirst as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{ id: "emp-2" }, { sectorId: { in: ["sec-1"] } }] } }),
    );
    // No accesible/no existe: nunca dispara las 6 consultas hijas.
    expect(result).toBeNull();
    expect(prisma.employeeCompany.findMany).not.toHaveBeenCalled();
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

describe("employeesRepository.findMany (listado de Legajos) — Etapa 14C.1 / 14C.3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.employee.findMany as Mock).mockResolvedValue([]);
    (prisma.employee.count as Mock).mockResolvedValue(0);
  });

  // Etapa 14C.3: `$transaction([findMany, count])` -> `Promise.all([...])`
  // (mismo patrón ya corregido en `summary()` durante 14C.1) — la forma-array
  // de `$transaction` serializaba las dos lecturas de cada página sobre una
  // única conexión, en vez de correrlas en paralelo real.
  it("usa Promise.all (no $transaction) — findMany y count son independientes entre sí", async () => {
    const [items, total] = await employeesRepository.findMany({ page: 1, take: 25 } as never, {});

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.employee.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.employee.count).toHaveBeenCalledTimes(1);
    expect(items).toEqual([]);
    expect(total).toBe(0);
  });

  it("no carga sector/position/companies (relaciones no usadas por el listado)", async () => {
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

describe("employeesRepository.findOrgChart / findOptions — Etapa 14C.3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.employee.findMany as Mock).mockResolvedValue([]);
    (prisma.employee.count as Mock).mockResolvedValue(0);
  });

  it("findOrgChart usa Promise.all (no $transaction)", async () => {
    const [items, total] = await employeesRepository.findOrgChart({ page: 1, take: 25 } as never, {});

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.employee.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.employee.count).toHaveBeenCalledTimes(1);
    expect(items).toEqual([]);
    expect(total).toBe(0);
  });

  it("findOptions usa Promise.all (no $transaction)", async () => {
    const [items, total] = await employeesRepository.findOptions({ page: 1, take: 25 } as never, {});

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.employee.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.employee.count).toHaveBeenCalledTimes(1);
    expect(items).toEqual([]);
    expect(total).toBe(0);
  });
});

describe("employeesRepository.existsWithAccess — Etapa 14C.3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Causa raíz real de block-history/field-history reportada en 14C.3:
  // `listFieldHistory`/`listBlockHistory` sólo necesitan confirmar
  // existencia + alcance del legajo, no su detalle completo. Este check no
  // debe traer NINGUNA relación (a diferencia de `findById`/
  // `findEmployeeDetailById`, que trae 6 relaciones más el núcleo con la
  // cadena sector/position de 4 niveles).
  it("consulta sólo { id: true }, sin relaciones, con el mismo where que findById", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue({ id: "emp-1" });

    const result = await employeesRepository.existsWithAccess("emp-1", { sectorId: { in: ["sec-1"] } });

    expect(result).toBe(true);
    expect(prisma.employee.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: "emp-1" }, { sectorId: { in: ["sec-1"] } }] },
      select: { id: true },
    });
    expect(prisma.employeeCompany.findMany).not.toHaveBeenCalled();
    expect(prisma.laborMovement.findMany).not.toHaveBeenCalled();
    expect(prisma.employeeAssignment.findMany).not.toHaveBeenCalled();
    expect(prisma.novelty.findMany).not.toHaveBeenCalled();
    expect(prisma.employeeDocument.findMany).not.toHaveBeenCalled();
  });

  it("devuelve false si el legajo no existe o está fuera del alcance (accessWhere no matchea)", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue(null);

    const result = await employeesRepository.existsWithAccess("emp-2", { id: "__NO_ACCESS__" });

    expect(result).toBe(false);
  });
});

// Etapa 14D.2: causa real de los 12825ms máx/9978ms medidos en el journey de
// 14D.1 (`GET /employees/:id/position-validation`) — `getPositionValidation`
// usaba `findById`/`findEmployeeDetailById` (detalle completo: núcleo con
// cadena sector/position de 4 niveles + 6 `findMany` batch) para leer sólo
// `internalCategory`/`sector`/`position`. Este select no debe traer ninguna
// de esas 6 relaciones — mismo criterio ya usado para `existsWithAccess`.
describe("employeesRepository.findPositionValidationById — Etapa 14D.2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("consulta sólo internalCategory/sector/position (sin companies/laborMovements/assignments/hourConcepts/novelties/documents)", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue({ internalCategory: "Administrativo A", sector: null, position: null });

    const result = await employeesRepository.findPositionValidationById("emp-1", { sectorId: { in: ["sec-1"] } });

    expect(result).toEqual({ internalCategory: "Administrativo A", sector: null, position: null });
    const call = (prisma.employee.findFirst as Mock).mock.calls.at(0)?.[0];
    expect(call.where).toEqual({ AND: [{ id: "emp-1" }, { sectorId: { in: ["sec-1"] } }] });
    expect(call.select.internalCategory).toBe(true);
    expect(call.select.sector).toBeDefined();
    expect(call.select.position).toBeDefined();
    // Ninguna de las 6 relaciones batch de employeeDetailSelect — la causa
    // real de los 12s medidos en 14D.1.
    expect(call.select.companies).toBeUndefined();
    expect(call.select.laborMovements).toBeUndefined();
    expect(call.select.assignments).toBeUndefined();
    expect(call.select.hourConcepts).toBeUndefined();
    expect(call.select.novelties).toBeUndefined();
    expect(call.select.documents).toBeUndefined();
    expect(call.select.address).toBeUndefined();
    expect(call.select.transport).toBeUndefined();
    expect(call.select.costCenter).toBeUndefined();
    expect(prisma.employeeCompany.findMany).not.toHaveBeenCalled();
    expect(prisma.laborMovement.findMany).not.toHaveBeenCalled();
    expect(prisma.employeeAssignment.findMany).not.toHaveBeenCalled();
    expect(prisma.novelty.findMany).not.toHaveBeenCalled();
    expect(prisma.employeeDocument.findMany).not.toHaveBeenCalled();
  });

  it("trae la cadena sector -> area -> establecimiento -> unidad de negocio completa, tanto del empleado como del puesto", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue({ internalCategory: null, sector: null, position: null });

    await employeesRepository.findPositionValidationById("emp-1", {});

    const call = (prisma.employee.findFirst as Mock).mock.calls.at(0)?.[0];
    expect(call.select.sector.select.area.select.establishment.select.businessUnit).toEqual({ select: { id: true, name: true } });
    expect(call.select.position.select.sector.select.area.select.establishment.select.businessUnit).toEqual({ select: { id: true, name: true } });
    expect(call.select.position.select.salaryCategories).toBeDefined();
  });

  it("devuelve null si el legajo no existe o está fuera de alcance", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue(null);

    const result = await employeesRepository.findPositionValidationById("emp-404", { id: "__NO_ACCESS__" });

    expect(result).toBeNull();
  });
});

// Etapa 14D.2.1: cuando el caller ya conoce el positionId (el frontend
// siempre lo conoce, viene de overview-details), se resuelve en 2 consultas
// de nivel superior independientes vía Promise.all en vez de 1 findFirst
// con 2 cadenas anidadas — mismo resultado final, menos tiempo en serie.
describe("employeesRepository.findPositionValidationById — camino paralelo con positionId (Etapa 14D.2.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("con positionId conocido: resuelve empleado y puesto en paralelo (Promise.all), no un único findFirst anidado", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue({ internalCategory: "Administrativo A", positionId: "pos-1", sector: { name: "Ventas" } });
    (prisma.position.findUnique as Mock).mockResolvedValue({ sector: { name: "Ventas" }, salaryCategories: [] });

    const result = await employeesRepository.findPositionValidationById("emp-1", { sectorId: { in: ["sec-1"] } }, "pos-1");

    expect(result).toEqual({ internalCategory: "Administrativo A", sector: { name: "Ventas" }, position: { sector: { name: "Ventas" }, salaryCategories: [] } });
    // El select del empleado ya NO pide `position` anidado (eso se resuelve
    // en la consulta paralela aparte) — sólo lo mínimo: internalCategory,
    // positionId (para el chequeo de seguridad) y su propia cadena de sector.
    const employeeCall = (prisma.employee.findFirst as Mock).mock.calls.at(0)?.[0];
    expect(employeeCall.where).toEqual({ AND: [{ id: "emp-1" }, { sectorId: { in: ["sec-1"] } }] });
    expect(employeeCall.select.position).toBeUndefined();
    expect(employeeCall.select.positionId).toBe(true);
    const positionCall = (prisma.position.findUnique as Mock).mock.calls.at(0)?.[0];
    expect(positionCall.where).toEqual({ id: "pos-1" });
  });

  // Seguridad: nunca confía ciegamente en el positionId del cliente — si no
  // coincide con el positionId REAL del empleado, vuelve a pedir el puesto
  // correcto en vez de devolver una validación contra el puesto equivocado.
  it("si el positionId del cliente está desactualizado (no coincide con el real), vuelve a pedir el puesto correcto", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue({ internalCategory: "Administrativo A", positionId: "pos-REAL", sector: null });
    (prisma.position.findUnique as Mock)
      .mockResolvedValueOnce({ sector: null, salaryCategories: [], _tag: "puesto-viejo-del-cliente" } as never)
      .mockResolvedValueOnce({ sector: null, salaryCategories: [], _tag: "puesto-real" } as never);

    const result = await employeesRepository.findPositionValidationById("emp-1", {}, "pos-VIEJO-DEL-CLIENTE");

    expect(prisma.position.findUnique).toHaveBeenCalledTimes(2);
    expect((prisma.position.findUnique as Mock).mock.calls[1]![0].where).toEqual({ id: "pos-REAL" });
    expect((result as unknown as { position: { _tag: string } }).position._tag).toBe("puesto-real");
  });

  it("si el empleado no tiene puesto asignado (positionId null), no pide ningún puesto de más", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue({ internalCategory: null, positionId: null, sector: null });

    const result = await employeesRepository.findPositionValidationById("emp-1", {}, "pos-cliente-obsoleto");

    expect(result).toEqual({ internalCategory: null, sector: null, position: null });
    // La consulta con el positionId del cliente sí se dispara en paralelo
    // (no hay forma de saber de antemano que está desactualizado), pero no
    // se hace una SEGUNDA consulta de más una vez confirmado que el
    // empleado no tiene puesto real.
    expect(prisma.position.findUnique).toHaveBeenCalledTimes(1);
  });

  it("devuelve null si el legajo no existe o está fuera de alcance (mismo comportamiento que el camino sin positionId)", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue(null);
    (prisma.position.findUnique as Mock).mockResolvedValue({ sector: null, salaryCategories: [] });

    const result = await employeesRepository.findPositionValidationById("emp-404", { id: "__NO_ACCESS__" }, "pos-1");

    expect(result).toBeNull();
  });
});

// Etapa 14D.2 (Parte 5, ítems 5-7 del pedido): `findFieldHistory`/
// `findBlockHistory` no se modificaron esta etapa (ya filtraban
// correctamente desde antes, confirmado en el diagnóstico), pero no tenían
// tests directos a nivel repositorio — sólo cobertura indirecta vía
// `listFieldHistory`/`listBlockHistory` (14C.3). Se agregan acá para dejar
// documentado y protegido el comportamiento real: siempre filtra por
// `employeeId` (nunca trae historial de otro legajo) y aplica
// `section`/`field`/`block` sólo cuando vienen en la query.
describe("employeesRepository.findFieldHistory / findBlockHistory — filtros (Etapa 14D.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.employeeFieldHistory.findMany as Mock).mockResolvedValue([]);
    (prisma.employeeBlockHistory.findMany as Mock).mockResolvedValue([]);
  });

  it("findFieldHistory siempre filtra por employeeId y agrega section/field sólo si vienen en la query", async () => {
    await employeesRepository.findFieldHistory("emp-1", { section: "DATOS_LABORALES", field: "sector", take: 50 } as never);

    expect(prisma.employeeFieldHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: "emp-1", section: "DATOS_LABORALES", field: "sector" } }),
    );
  });

  it("findFieldHistory sin section/field: sólo filtra por employeeId (no trae historial de otro legajo, no filtra de más)", async () => {
    await employeesRepository.findFieldHistory("emp-1", { take: 50 } as never);

    expect(prisma.employeeFieldHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: "emp-1" } }),
    );
  });

  it("findBlockHistory siempre filtra por employeeId y agrega section/block sólo si vienen en la query", async () => {
    await employeesRepository.findBlockHistory("emp-2", { section: "TRANSPORTE", block: "TRANSPORTE", take: 50 } as never);

    expect(prisma.employeeBlockHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: "emp-2", section: "TRANSPORTE", block: "TRANSPORTE" } }),
    );
  });

  it("findBlockHistory con un employeeId distinto no reusa el where de otro legajo (cada llamada arma su propio where)", async () => {
    await employeesRepository.findBlockHistory("emp-a", { block: "RESPONSABLE_CARGA_HORARIA", take: 50 } as never);
    await employeesRepository.findBlockHistory("emp-b", { block: "RESPONSABLE_CARGA_HORARIA", take: 50 } as never);

    const calls = (prisma.employeeBlockHistory.findMany as Mock).mock.calls;
    expect(calls[0]![0].where.employeeId).toBe("emp-a");
    expect(calls[1]![0].where.employeeId).toBe("emp-b");
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
    mockEmptyDetailRelations();
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
    expect(result).toEqual({ id: "emp-1", ...emptyDetailRelations });
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
    expect(result).toEqual({ id: "emp-1", ...emptyDetailRelations });
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
    mockEmptyDetailRelations();
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
    expect(result).toEqual({ employee: { id: "emp-1", ...emptyDetailRelations }, movement: { id: "mov-1", type: "BAJA" } });
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
    expect(result).toEqual({ id: "emp-1", ...emptyDetailRelations });
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
