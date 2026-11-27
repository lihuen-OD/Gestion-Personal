/**
 * Integración PostgreSQL del guardado en lote de convocatorias a feriado
 * (fix/holiday-work-assignment-performance + §20): altas, cambios reales,
 * cancelaciones y guardados sin cambios; auditoría sólo de lo que cambió;
 * presupuesto de consultas que no crece con los convocados sin cambios;
 * unicidad concurrente; rollback completo si falla el recálculo y timeout
 * transaccional real (P2028 → 503); alcance N1/N2/N3 por legajo y período
 * protegido. Las fallas son reales del dominio y de la base (sin mocks).
 *
 * §20 (WORKED_TIME_ACCOUNTING_MODEL.md, reemplaza §16): la convocatoria sólo
 * define la obligación de asistir. Después de cada guardado se corre el
 * recálculo completo de la fecha (oráculo: cobertura de TODOS los legajos y
 * Horas Especiales) y debe dar CERO cambios: recalcular sólo los legajos
 * cambiados alcanza, y ninguna convocatoria cambia el multiplicador.
 *
 * Opt-in: sólo corre con `HOLIDAY_WORK_IT_DATABASE_URL` → `localhost`, base
 * `clock_it*` PROPIA con el schema de este commit. VACÍA la base al empezar.
 * Nunca usa el DATABASE_URL del .env y verifica `current_database()`.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.HOLIDAY_WORK_IT_DATABASE_URL;

type Modules = {
  prisma: typeof import("../../shared/prisma/client").prisma;
  holidays: typeof import("./holidayWorkAssignment.service").holidayWorkAssignmentService;
  schemas: typeof import("./holidayWorkAssignment.schemas");
  novelties: typeof import("../novelties/novelties.service").noveltiesService;
  noveltySchemas: typeof import("../novelties/novelties.schemas");
  types: typeof import("../novelty-types/noveltyTypes.service").noveltyTypesService;
  typeSchemas: typeof import("../novelty-types/noveltyTypes.schemas");
  recalculation: typeof import("../novelties/noveltyCoverageRecalculation");
  reinterpretation: typeof import("../workforce-management/specialHourReinterpretation");
  snapshots: typeof import("../workforce-management/closureSnapshot");
};

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const HOLIDAY = "2027-03-24";
const PERIOD = "2027-03";

describe.skipIf(!url)("Guardado en lote de convocatorias a feriado contra PostgreSQL local", () => {
  let m: Modules;
  let holder: PrismaClient;
  let rrhh = "";
  let template = "";
  let otherTemplate = "";
  let vacaciones = "";
  let normalConcept = "";
  let legajo = 700;
  let queries = 0;
  let queryLog: string[] = [];
  const employees: string[] = [];

  let supervisor = "";
  let loader = "";
  const user = () => ({ id: rrhh, email: "rrhh@example.com", name: "rrhh", role: "NIVEL_1_RRHH" }) as Express.AuthUser;
  const n2 = () => ({ id: supervisor, email: "n2@example.com", name: "n2", role: "NIVEL_2_SUPERVISION" }) as Express.AuthUser;
  const n3 = () => ({ id: loader, email: "n3@example.com", name: "n3", role: "NIVEL_3_CARGA_HORARIA" }) as Express.AuthUser;
  const audit = () => ({ userId: rrhh });
  const save = (assignments: Array<Record<string, unknown>>, date = HOLIDAY, actor = user(), correctionReason?: string) =>
    m.holidays.save(m.schemas.saveHolidayWorkAssignmentsSchema.parse({ date, assignments, correctionReason }), actor, { userId: actor.id });
  const active = (employeeId: string, extra: Record<string, unknown> = {}) => ({ employeeId, status: "ACTIVA", ...extra });
  // Auditoría por convocatoria (la del recálculo de horas usa la misma entidad sin entityId).
  const assignmentAudits = () => holder.auditLog.count({ where: { entity: "HolidayWorkAssignment", entityId: { not: null } } });

  const createEmployee = async () => {
    legajo += 1;
    const created = await holder.employee.create({ data: { legajo: String(legajo), dni: `41000${legajo}`, firstName: "Ana", lastName: `Feriado ${legajo}` } });
    await holder.laborMovement.create({ data: { employeeId: created.id, type: "ALTA", effectiveFrom: day("2027-01-01"), reason: "Ingreso" } });
    await holder.shiftAssignment.create({ data: { employeeId: created.id, shiftTemplateId: template, effectiveFrom: day("2027-01-01"), weekdays: [] } });
    return created.id;
  };

  /** Estado completo que lee o escribe un guardado (para comparar antes/después). */
  const state = async () => ({
    assignments: await holder.holidayWorkAssignment.findMany({ orderBy: { employeeId: "asc" } }),
    coverage: await holder.noveltyDayCoverage.findMany({ orderBy: [{ noveltyId: "asc" }, { date: "asc" }] }),
    timeEntries: await holder.timeEntry.findMany({ orderBy: { id: "asc" }, select: { id: true, appliedMultiplier: true, updatedAt: true } }),
    closures: await holder.monthlyTimeClosure.findMany({ orderBy: { id: "asc" }, select: { id: true, snapshot: true, updatedAt: true } }),
    audits: await holder.auditLog.count(),
  });

  /**
   * Oráculo: el recálculo completo de la implementación anterior sobre el
   * estado actual no debe cambiar nada (y no escribe si no cambia nada), y
   * cada snapshot abierto debe ser igual al reconstruido desde cero.
   */
  const expectEngineFixedPoint = async () => {
    const reason = { source: "HOLIDAY_WORK_ASSIGNMENT_CHANGED" as const, label: "oráculo" };
    const result = await m.prisma.$transaction(async (tx) => {
      const coverage = await m.recalculation.recalculateNoveltyCoverage(tx, { from: day(HOLIDAY), to: day(HOLIDAY) }, reason, { rebuildSnapshots: false });
      const hours = await m.reinterpretation.reinterpretSpecialHoursOnDates(tx, [day(HOLIDAY)], { reason: "SPECIAL_HOUR_RECONCILIATION" });
      const closures = await tx.monthlyTimeClosure.findMany({ where: { period: PERIOD } });
      const rebuilt = await m.snapshots.buildClosureSnapshots(tx, closures.map((closure) => closure.employeeId), PERIOD);
      return { coverage, hours, closures, rebuilt };
    }, { timeout: 60_000 });
    expect(result.coverage.changedDays).toBe(0);
    expect(result.coverage.droppedResolutions).toEqual([]);
    expect([result.hours.timeEntries, result.hours.breakdowns, result.hours.segments]).toEqual([0, 0, 0]);
    // Los snapshots que algún guardado reconstruyó (los demás siguen con su
    // contenido previo, igual que con la implementación anterior).
    for (const closure of result.closures.filter((item) => (item.snapshot as { recalculation?: unknown }).recalculation)) {
      expect((closure.snapshot as { accounting?: unknown }).accounting).toEqual((result.rebuilt.get(closure.employeeId) as { accounting?: unknown }).accounting);
    }
  };

  const coverageOf = async (employeeId: string) => holder.noveltyDayCoverage.findFirstOrThrow({ where: { employeeId, date: day(HOLIDAY) } });
  const multiplierOf = async (employeeId: string) => Number((await holder.timeEntry.findFirstOrThrow({ where: { employeeId, date: day(HOLIDAY) } })).appliedMultiplier);

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("HOLIDAY_WORK_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ prisma }, { holidayWorkAssignmentService }, schemas, { noveltiesService }, noveltySchemas, { noveltyTypesService }, typeSchemas, recalculation, reinterpretation, snapshots] = await Promise.all([
      import("../../shared/prisma/client"),
      import("./holidayWorkAssignment.service"),
      import("./holidayWorkAssignment.schemas"),
      import("../novelties/novelties.service"),
      import("../novelties/novelties.schemas"),
      import("../novelty-types/noveltyTypes.service"),
      import("../novelty-types/noveltyTypes.schemas"),
      import("../novelties/noveltyCoverageRecalculation"),
      import("../workforce-management/specialHourReinterpretation"),
      import("../workforce-management/closureSnapshot"),
    ]);
    m = { prisma, holidays: holidayWorkAssignmentService, schemas, novelties: noveltiesService, noveltySchemas, types: noveltyTypesService, typeSchemas, recalculation, reinterpretation, snapshots };
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });
    // Cliente base de la app (sin extensión): emite un evento por consulta.
    (globalThis as unknown as { prisma: { $on: (event: "query", callback: (event: { query: string }) => void) => void } }).prisma.$on("query", (event: { query: string }) => { queries += 1; queryLog.push(event.query.slice(0, 90)); });

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);

    rrhh = (await holder.user.create({ data: { name: "rrhh", email: "rrhh@example.com", passwordHash: "x", role: "NIVEL_1_RRHH" } })).id;
    normalConcept = (await holder.hourConcept.create({ data: { code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", systemRole: "NORMAL_BASE" } })).id;
    template = (await holder.shiftTemplate.create({ data: { code: "F-ALL", name: "F-ALL", startTime: "08:00", endTime: "16:00", expectedMinutes: 480 } })).id;
    otherTemplate = (await holder.shiftTemplate.create({ data: { code: "F-TARDE", name: "F-TARDE", startTime: "14:00", endTime: "22:00", expectedMinutes: 480 } })).id;
    const feriado = await holder.doubleHourRule.create({ data: { name: "Feriado 24", recurrenceType: "FECHA", fromDate: day(HOLIDAY), toDate: day(HOLIDAY), multiplier: 2, kind: "FERIADO", reason: "it" } });
    await holder.specialHourRuleDate.create({ data: { ruleId: feriado.id, date: day(HOLIDAY) } });
    vacaciones = (await m.types.create(m.typeSchemas.createNoveltyTypeSchema.parse({ name: "Vacaciones", kind: "VACACIONES", coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageDayRule: "WORK_OBLIGATION", coverageAppliesSpecialHours: true, coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" }))).id;

    // 12 legajos: los pares con vacaciones el feriado, los impares con horas
    // cargadas ese día; todos con cierre abierto (DEVUELTO) del período.
    for (let index = 0; index < 12; index += 1) {
      const id = await createEmployee();
      employees.push(id);
      if (index % 2 === 0) {
        await m.novelties.create(m.noveltySchemas.createNoveltySchema.parse({ employeeIds: [id], noveltyTypeId: vacaciones, fromDate: HOLIDAY }), user());
      } else {
        // Cargadas como lo haría el motor (§20): feriado global x2 para todos.
        await holder.timeEntry.create({ data: { employeeId: id, hourConceptId: normalConcept, date: day(HOLIDAY), period: PERIOD, day: 24, hours: 8, totalMinutes: 480, status: "APROBADO", appliedMultiplier: 2 } });
      }
      await holder.monthlyTimeClosure.create({ data: { employeeId: id, period: PERIOD, status: "DEVUELTO", snapshot: { marker: "previo" } } });
    }
    // Alcance: el Nivel 2 es responsable horario de los legajos 0–5; el
    // Nivel 3 lo hereda mientras el Nivel 2 esté ACTIVO.
    supervisor = (await holder.user.create({ data: { name: "n2", email: "n2@example.com", passwordHash: "x", role: "NIVEL_2_SUPERVISION" } })).id;
    loader = (await holder.user.create({ data: { name: "n3", email: "n3@example.com", passwordHash: "x", role: "NIVEL_3_CARGA_HORARIA" } })).id;
    await holder.userSupervisionAssignment.create({ data: { supervisorUserId: supervisor, supervisedUserId: loader } });
    for (const id of employees.slice(0, 6)) {
      await holder.employeeAssignment.create({ data: { employeeId: id, userId: supervisor, type: "TIME_RESPONSIBLE", status: "ACTIVO", effectiveFrom: day("2026-01-01") } });
    }
  }, 120_000);

  afterAll(async () => {
    await holder?.$disconnect();
    await m?.prisma.$disconnect();
  });

  it("alta de un empleado y alta masiva: filas, auditoría por empleado, cobertura y Horas Especiales iguales al recálculo completo", async () => {
    const [first, ...rest] = employees.slice(0, 6);
    await save([active(first!, { shiftTemplateId: template, expectedStartTime: "08:00", expectedEndTime: "16:00", notes: "Guardia" })]);
    expect(await holder.holidayWorkAssignment.findFirstOrThrow({ where: { employeeId: first } })).toMatchObject({ status: "ACTIVA", shiftTemplateId: template, notes: "Guardia", createdByUserId: rrhh });
    expect(await assignmentAudits()).toBe(1);
    await expectEngineFixedPoint();

    const result = await save([active(first!, { shiftTemplateId: template, expectedStartTime: "08:00", expectedEndTime: "16:00", notes: "Guardia" }), ...rest.map((id) => active(id))]);
    expect(result.map((row) => row.employeeId)).toEqual([first, ...rest]);
    expect(result.every((row) => row.employee.legajo)).toBe(true);
    expect(await assignmentAudits()).toBe(1 + rest.length);
    await expectEngineFixedPoint();

    // Anclas de negocio (§20): convocado con vacaciones → cubre 480 × 2;
    // no convocado con vacaciones → HOLIDAY_NOT_CONVOKED; las horas valen
    // × 2 por la regla global, convocado (1) o no (7).
    const convokedLeave = employees[0]!;
    const notConvokedLeave = employees[6]!;
    expect(await coverageOf(convokedLeave)).toMatchObject({ outcome: "COVERED", baseMinutes: 480 });
    expect(Number((await coverageOf(convokedLeave)).appliedMultiplier)).toBe(2);
    expect(await coverageOf(notConvokedLeave)).toMatchObject({ outcome: "HOLIDAY_NOT_CONVOKED", baseMinutes: 0 });
    expect(await multiplierOf(employees[1]!)).toBe(2);
    expect(await multiplierOf(employees[7]!)).toBe(2);
    // Los snapshots abiertos se reconstruyeron con la convocatoria.
    expect((await holder.monthlyTimeClosure.findFirstOrThrow({ where: { employeeId: convokedLeave } })).snapshot).not.toEqual({ marker: "previo" });
  });

  it("guardado sin cambios: no escribe filas, cobertura, horas ni cierres y no audita", async () => {
    const before = await state();
    const result = await save([active(employees[0]!, { shiftTemplateId: template, expectedStartTime: "08:00", expectedEndTime: "16:00", notes: "Guardia" }), ...employees.slice(1, 6).map((id) => active(id)), { employeeId: employees[11]!, status: "CANCELADA" }]);

    expect(result).toHaveLength(6);
    expect(await state()).toEqual(before);
    await expectEngineFixedPoint();
  });

  it("cambio de turno/horario, cambio de observaciones, cancelación existente y cancelación inexistente: sólo se audita lo que cambió", async () => {
    const auditsBefore = await assignmentAudits();
    const cancelled = employees[5]!;
    const ghost = employees[10]!;
    await save([
      active(employees[0]!, { shiftTemplateId: otherTemplate, expectedStartTime: "14:00", expectedEndTime: "22:00", notes: "Guardia" }),
      active(employees[2]!, { notes: "Llega tarde" }),
      active(employees[3]!),
      { employeeId: cancelled, status: "CANCELADA" },
      { employeeId: ghost, status: "CANCELADA" },
    ]);

    const audits = await holder.auditLog.findMany({ where: { entity: "HolidayWorkAssignment", entityId: { not: null } }, orderBy: { createdAt: "asc" }, skip: auditsBefore });
    // Mismo milisegundo posible entre auditorías: se compara sin depender del orden.
    const byEntity = (entries: Array<[string, string | null]>) => [...entries].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    expect(byEntity(audits.map((entry) => [entry.action, entry.entityId]))).toEqual(byEntity([["UPDATE", employees[0]!], ["UPDATE", employees[2]!], ["DEACTIVATE", cancelled]]));
    const changedTemplate = audits.find((entry) => entry.entityId === employees[0])!;
    expect(changedTemplate.before).toMatchObject({ shiftTemplateId: template, expectedStartTime: "08:00" });
    expect(changedTemplate.after).toMatchObject({ shiftTemplateId: otherTemplate, expectedStartTime: "14:00" });
    expect(await holder.holidayWorkAssignment.findFirstOrThrow({ where: { employeeId: cancelled } })).toMatchObject({ status: "CANCELADA" });
    expect(await holder.holidayWorkAssignment.count({ where: { employeeId: ghost } })).toBe(0);
    // Cancelar al convocado con horas no cambia lo que cobra (§20).
    expect(await multiplierOf(cancelled)).toBe(2);
    await expectEngineFixedPoint();

    // Reactivar → ACTIVATE, sigue × 2.
    await save([active(cancelled)]);
    expect(await holder.auditLog.findFirst({ where: { entity: "HolidayWorkAssignment", entityId: cancelled, action: "ACTIVATE" } })).not.toBeNull();
    expect(await multiplierOf(cancelled)).toBe(2);
    await expectEngineFixedPoint();
  });

  it("presupuesto de consultas: no crece con los convocados sin cambios", async () => {
    const measure = async (unchanged: string[], added: string) => {
      queries = 0;
      queryLog = [];
      await save([...unchanged.map((id) => active(id)), active(added)]);
      if (process.env.HOLIDAY_WORK_IT_QUERY_LOG) console.info(`[consultas ${unchanged.length}]\n${queryLog.join("\n")}`);
      return queries;
    };
    // Los "sin cambios" deben serlo de verdad (las pruebas anteriores dejaron
    // observaciones/horarios): se normalizan antes de medir.
    await save(employees.slice(1, 6).map((id) => active(id)));
    // Mismo cambio efectivo (alta de un legajo con vacaciones ese día) con 2
    // y con 6 convocados sin cambios.
    const small = await measure(employees.slice(1, 3), employees[6]!);
    const large = await measure(employees.slice(1, 7), employees[10]!);

    expect(large).toBe(small);
    queries = 0;
    await save(employees.slice(1, 7).map((id) => active(id)));
    const noChange = queries;
    // Sin cambios: conteo de empleados, feriado del calendario (§20), locks,
    // francos, lectura y respuesta. Sin cambios no se valida el horario.
    expect(noChange).toBeLessThanOrEqual(9);
    console.info(`[presupuesto] alta con 2 sin cambios=${small} consultas; alta con 6 sin cambios=${large}; guardado sin cambios (6 legajos)=${noChange}`);
    await expectEngineFixedPoint();
  });

  it("error de unicidad concurrente: otra transacción inserta la misma (fecha, empleado) → 409 y nada del guardado queda escrito", async () => {
    const target = employees[8]!;
    const before = await state();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let inserted!: () => void;
    const insertedSignal = new Promise<void>((resolve) => { inserted = resolve; });
    // Inserta sin el lock por empleado + fecha (como una carrera real que el
    // lock no cubre) y mantiene la transacción abierta hasta liberar.
    const concurrent = holder.$transaction(async (tx) => {
      await tx.holidayWorkAssignment.create({ data: { date: day(HOLIDAY), employeeId: target, status: "ACTIVA", notes: "concurrente" } });
      inserted();
      await gate;
    }, { timeout: 20_000 });
    await insertedSignal;
    const attempt = save([active(target), active(employees[9]!)]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await concurrent;

    await expect(attempt).rejects.toMatchObject({ statusCode: 409, code: "HOLIDAY_WORK_ASSIGNMENT_ALREADY_EXISTS" });
    expect(await holder.holidayWorkAssignment.findFirstOrThrow({ where: { employeeId: target } })).toMatchObject({ notes: "concurrente" });
    expect(await holder.holidayWorkAssignment.count({ where: { employeeId: employees[9]! } })).toBe(0);
    expect(await holder.auditLog.count()).toBe(before.audits);
    // Deja el estado consistente para el resto (la fila concurrente no pasó por el motor).
    await holder.holidayWorkAssignment.delete({ where: { date_employeeId: { date: day(HOLIDAY), employeeId: target } } });
    await expectEngineFixedPoint();
  });

  it("rollback cuando falla el recálculo: la convocatoria ya insertada no queda escrita y no se audita", async () => {
    // Falla real del motor de cobertura: una novedad de más de 366 días que
    // toca el feriado (sólo posible cargada por fuera del servicio) hace que
    // el recálculo de la fecha rechace la operación DESPUÉS del createMany.
    const invalid = await holder.novelty.create({ data: { employeeId: employees[9]!, noveltyTypeId: vacaciones, fromDate: day("2026-01-01"), toDate: day("2027-12-31"), status: "APROBADO" } });
    try {
      const before = await state();
      await expect(save([active(employees[8]!), active(employees[9]!)])).rejects.toMatchObject({ code: "NOVELTY_RANGE_TOO_LONG" });
      expect(await state()).toEqual(before);
    } finally {
      await holder.novelty.delete({ where: { id: invalid.id } });
    }
  });

  it("timeout transaccional real (P2028): 503 TRANSACTION_TIMEOUT, nada escrito ni auditado", async () => {
    const before = await state();
    // Otra transacción retiene el lock de cierre del legajo convocado (con
    // vacaciones: su cobertura cambia y su snapshot se reconstruye) más que el
    // presupuesto de 30 s: el guardado ya insertó la convocatoria y queda
    // esperando en la reconstrucción del cierre.
    const blocked = employees[8]!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const lockedSignal = new Promise<void>((resolve) => { locked = resolve; });
    const blocker = holder.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`closure:${blocked}:${PERIOD}`}::text, 0))`;
      locked();
      await gate;
    }, { timeout: 60_000 });
    await lockedSignal;
    const started = Date.now();
    // Prisma no puede abortar una consulta bloqueada: el bloqueo se libera a
    // los 31 s y la consulta siguiente encuentra la transacción vencida.
    const timer = setTimeout(release, 31_000);
    try {
      await expect(save([active(employees[8]!)])).rejects.toMatchObject({ statusCode: 503, code: "TRANSACTION_TIMEOUT", message: expect.stringContaining("No se guardó ningún cambio") });
    } finally {
      clearTimeout(timer);
      release();
      await blocker;
    }
    expect(Date.now() - started).toBeGreaterThanOrEqual(30_000);
    expect(await state()).toEqual(before);
    await expectEngineFixedPoint();
  }, 70_000);

  it("§20: la convocatoria de un legajo no toca horas, cobertura, cierres ni auditoría de los demás", async () => {
    const target = employees[10]!;
    const others = employees.filter((id) => id !== target);
    const otherClosures = (await holder.monthlyTimeClosure.findMany({ where: { employeeId: { in: others } }, select: { id: true } })).map((row) => row.id);
    const snapshotOf = async () => ({
      coverage: await holder.noveltyDayCoverage.findMany({ where: { employeeId: { in: others } }, orderBy: [{ noveltyId: "asc" }, { date: "asc" }] }),
      timeEntries: await holder.timeEntry.findMany({ where: { employeeId: { in: others } }, orderBy: { id: "asc" }, select: { id: true, appliedMultiplier: true, updatedAt: true } }),
      closures: await holder.monthlyTimeClosure.findMany({ where: { employeeId: { in: others } }, orderBy: { id: "asc" }, select: { id: true, snapshot: true, updatedAt: true } }),
      audits: await holder.auditLog.count({ where: { entityId: { in: [...others, ...otherClosures] } } }),
    });
    const before = await snapshotOf();
    await save([{ employeeId: target, status: "CANCELADA" }]);
    await save([active(target)]);
    expect(await snapshotOf()).toEqual(before);
    expect(await holder.auditLog.count({ where: { entity: "HolidayWorkAssignment", entityId: null } })).toBe(0);
    await expectEngineFixedPoint();
  });

  it("alcance: Nivel 2 convoca sólo sus legajos; uno ajeno en el lote → 403 sin escribir nada", async () => {
    const own = employees[4]!;
    const foreign = employees[11]!;
    await save([{ employeeId: own, status: "CANCELADA" }]);
    const before = await state();

    await expect(save([active(own), active(foreign)], HOLIDAY, n2())).rejects.toMatchObject({ statusCode: 403, code: "EMPLOYEE_SCOPE_FORBIDDEN" });
    expect(await state()).toEqual(before);

    await save([active(own)], HOLIDAY, n2());
    expect(await holder.holidayWorkAssignment.findFirstOrThrow({ where: { employeeId: own } })).toMatchObject({ status: "ACTIVA", updatedByUserId: supervisor });
    expect((await m.holidays.listByDate(day(HOLIDAY), n2())).assignments.every((row: { employeeId: string }) => employees.slice(0, 6).includes(row.employeeId))).toBe(true);
    await expectEngineFixedPoint();
  });

  it("alcance: Nivel 3 hereda los legajos de su Nivel 2 ACTIVO y los pierde si se inactiva", async () => {
    const own = employees[3]!;
    await save([{ employeeId: own, status: "CANCELADA" }], HOLIDAY, n3());
    expect(await holder.holidayWorkAssignment.findFirstOrThrow({ where: { employeeId: own } })).toMatchObject({ status: "CANCELADA", updatedByUserId: loader });
    await expect(save([active(employees[7]!)], HOLIDAY, n3())).rejects.toMatchObject({ statusCode: 403 });

    await holder.user.update({ where: { id: supervisor }, data: { status: "INACTIVO" } });
    try {
      await expect(save([active(own)], HOLIDAY, n3())).rejects.toMatchObject({ statusCode: 403, code: "EMPLOYEE_SCOPE_FORBIDDEN" });
    } finally {
      await holder.user.update({ where: { id: supervisor }, data: { status: "ACTIVO" } });
    }
    await save([active(own)], HOLIDAY, n3());
    await expectEngineFixedPoint();
  });

  it("período enviado a cierre: Nivel 2 no puede cambiar la convocatoria; RRHH sí, con motivo", async () => {
    const own = employees[2]!;
    await save([active(own, { notes: "Antes del cierre" })]);
    await holder.monthlyTimeClosure.updateMany({ where: { employeeId: own, period: PERIOD }, data: { status: "ENVIADO" } });
    try {
      const before = await state();
      await expect(save([{ employeeId: own, status: "CANCELADA" }], HOLIDAY, n2())).rejects.toMatchObject({ statusCode: 409, code: "PERIOD_CLOSED" });
      expect(await state()).toEqual(before);
      // Un guardado sin cambios efectivos no choca con el cierre.
      await save([active(own, { notes: "Antes del cierre" })], HOLIDAY, n2());
      await expect(save([{ employeeId: own, status: "CANCELADA" }])).rejects.toMatchObject({ statusCode: 400, code: "HOLIDAY_WORK_CORRECTION_REASON_REQUIRED" });
      const closureBefore = await holder.monthlyTimeClosure.findFirstOrThrow({ where: { employeeId: own, period: PERIOD } });
      await save([{ employeeId: own, status: "CANCELADA" }], HOLIDAY, user(), "Planta pidió el cambio");
      expect(await holder.holidayWorkAssignment.findFirstOrThrow({ where: { employeeId: own } })).toMatchObject({ status: "CANCELADA", updatedByUserId: rrhh });
      const correction = await holder.auditLog.findFirstOrThrow({ where: { entity: "HolidayWorkAssignment", entityId: own, action: "DEACTIVATE" }, orderBy: { createdAt: "desc" } });
      expect(correction.description).toContain("Motivo: Planta pidió el cambio");
      // El snapshot de un período protegido nunca se reconstruye solo.
      expect((await holder.monthlyTimeClosure.findFirstOrThrow({ where: { employeeId: own, period: PERIOD } })).snapshot).toEqual(closureBefore.snapshot);
    } finally {
      await holder.monthlyTimeClosure.updateMany({ where: { employeeId: own, period: PERIOD }, data: { status: "DEVUELTO" } });
    }
  });
});
