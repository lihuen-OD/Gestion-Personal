/**
 * Integración PostgreSQL de la etapa 5 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md
 * §13): la cobertura de novedades se recalcula sola, en la transacción del
 * cambio y sólo en su alcance, cuando cambia una fuente que lee el motor:
 * francos, convocatorias, asignaciones de turno, plantillas, regímenes,
 * relación laboral, reglas de Horas Especiales y configuración del tipo.
 * Cubre también resoluciones manuales (se conservan o se descartan),
 * períodos protegidos, snapshots abiertos y ausencia de N+1.
 *
 * Opt-in: sólo corre con `NOVELTY_RECALC_IT_DATABASE_URL` → `localhost`, base
 * `clock_it*` PROPIA con el schema de este commit. VACÍA la base al empezar.
 * Nunca usa el DATABASE_URL del .env y verifica `current_database()`.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// R8.3: actor de Nivel 1 literal (un import de shiftWriteAccess cargaría el
// cliente Prisma antes de que la suite apunte a su base).
const globalShiftActor = (user: Express.AuthUser) => ({ user, scope: { all: true as const } });

const url = process.env.NOVELTY_RECALC_IT_DATABASE_URL;

type Modules = {
  prisma: typeof import("../../shared/prisma/client").prisma;
  novelties: typeof import("./novelties.service").noveltiesService;
  noveltySchemas: typeof import("./novelties.schemas");
  types: typeof import("../novelty-types/noveltyTypes.service").noveltyTypesService;
  typeSchemas: typeof import("../novelty-types/noveltyTypes.schemas");
  recalculation: typeof import("./noveltyCoverageRecalculation");
  employees: typeof import("../employees/employees.service").employeesService;
  dayOffs: typeof import("../employee-day-offs/employeeDayOff.service").employeeDayOffService;
  holidays: typeof import("../shifts/holidayWorkAssignment.service").holidayWorkAssignmentService;
  holidaySchemas: typeof import("../shifts/holidayWorkAssignment.schemas");
  assignments: typeof import("../shifts/shiftAssignment.service").shiftAssignmentService;
  regimes: typeof import("../work-regimes/workRegimes.service").workRegimesService;
  workforce: typeof import("../workforce-management/workforce.service").workforceService;
  workforceSchemas: typeof import("../workforce-management/workforce.schemas");
};

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
// Marzo de 2027: lunes 1, domingo 7, domingo 14, miércoles 24 (feriado global).

describe.skipIf(!url)("Recálculo automático de la cobertura de novedades contra PostgreSQL local (etapa 5)", () => {
  let m: Modules;
  let holder: PrismaClient;
  let rrhh = "";
  const templates = { lv: "", all: "" };
  const types = { vacaciones: "", jornada: "" };
  let domingoGlobal = "";
  let legajo = 500;

  const user = () => ({ id: rrhh, email: "rrhh@example.com", name: "rrhh", role: "NIVEL_1_RRHH" }) as Express.AuthUser;
  const audit = () => ({ userId: rrhh });
  const createNovelty = async (employeeId: string, noveltyTypeId: string, fromDate: string, toDate?: string) =>
    (await m.novelties.create(m.noveltySchemas.createNoveltySchema.parse({ employeeIds: [employeeId], noveltyTypeId, fromDate, ...(toDate ? { toDate } : {}) }), user()))[0]!.id;
  const rows = async (noveltyId: string) =>
    new Map((await holder.noveltyDayCoverage.findMany({ where: { noveltyId }, orderBy: { date: "asc" } })).map((row) => [row.date.toISOString().slice(0, 10), row]));
  const createType = async (payload: Record<string, unknown>) => (await m.types.create(m.typeSchemas.createNoveltyTypeSchema.parse({ kind: "OTRO", ...payload }))).id;
  const employee = async (options: { alta?: string | null; template?: string; weekdays?: number[] } = {}) => {
    legajo += 1;
    const created = await holder.employee.create({ data: { legajo: String(legajo), dni: `40000${legajo}`, firstName: "Eva", lastName: `Recálculo ${legajo}` } });
    const alta = options.alta === undefined ? "2027-01-01" : options.alta;
    if (alta) await holder.laborMovement.create({ data: { employeeId: created.id, type: "ALTA", effectiveFrom: day(alta), reason: "Ingreso" } });
    if (options.template) await holder.shiftAssignment.create({ data: { employeeId: created.id, shiftTemplateId: options.template, effectiveFrom: day("2027-01-01"), weekdays: options.weekdays ?? [] } });
    return created.id;
  };
  const closure = (employeeId: string, period: string, status: "DEVUELTO" | "ENVIADO") => holder.monthlyTimeClosure.create({ data: { employeeId, period, status, snapshot: { marker: "previo" } } });
  const snapshotOf = async (employeeId: string, period: string) => (await holder.monthlyTimeClosure.findFirstOrThrow({ where: { employeeId, period } })).snapshot as { marker?: string; accounting?: { noveltyCoveredMinutes: number }; recalculation?: { reason: string; source?: string } };

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("NOVELTY_RECALC_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ prisma }, { noveltiesService }, noveltySchemas, { noveltyTypesService }, typeSchemas, recalculation, { employeesService }, { employeeDayOffService }, { holidayWorkAssignmentService }, holidaySchemas, { shiftAssignmentService }, { workRegimesService }, { workforceService }, workforceSchemas] = await Promise.all([
      import("../../shared/prisma/client"),
      import("./novelties.service"),
      import("./novelties.schemas"),
      import("../novelty-types/noveltyTypes.service"),
      import("../novelty-types/noveltyTypes.schemas"),
      import("./noveltyCoverageRecalculation"),
      import("../employees/employees.service"),
      import("../employee-day-offs/employeeDayOff.service"),
      import("../shifts/holidayWorkAssignment.service"),
      import("../shifts/holidayWorkAssignment.schemas"),
      import("../shifts/shiftAssignment.service"),
      import("../work-regimes/workRegimes.service"),
      import("../workforce-management/workforce.service"),
      import("../workforce-management/workforce.schemas"),
    ]);
    m = { prisma, novelties: noveltiesService, noveltySchemas, types: noveltyTypesService, typeSchemas, recalculation, employees: employeesService, dayOffs: employeeDayOffService, holidays: holidayWorkAssignmentService, holidaySchemas, assignments: shiftAssignmentService, regimes: workRegimesService, workforce: workforceService, workforceSchemas };
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);

    rrhh = (await holder.user.create({ data: { name: "rrhh", email: "rrhh@example.com", passwordHash: "x", role: "NIVEL_1_RRHH" } })).id;
    await holder.hourConcept.create({ data: { code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", systemRole: "NORMAL_BASE" } });
    templates.lv = (await holder.shiftTemplate.create({ data: { code: "R-LV", name: "R-LV", startTime: "08:00", endTime: "16:00", expectedMinutes: 480 } })).id;
    templates.all = (await holder.shiftTemplate.create({ data: { code: "R-ALL", name: "R-ALL", startTime: "08:00", endTime: "16:00", expectedMinutes: 480 } })).id;
    domingoGlobal = (await holder.doubleHourRule.create({ data: { name: "Domingos", recurrenceType: "SEMANAL", weekdays: [0], fromDate: day("2027-01-01"), multiplier: 2, kind: "DOMINGO", reason: "it" } })).id;
    const feriado = await holder.doubleHourRule.create({ data: { name: "Feriado 24", recurrenceType: "FECHA", fromDate: day("2027-03-24"), toDate: day("2027-03-24"), multiplier: 2, kind: "FERIADO", reason: "it" } });
    await holder.specialHourRuleDate.create({ data: { ruleId: feriado.id, date: day("2027-03-24") } });

    types.vacaciones = await createType({ name: "Vacaciones", kind: "VACACIONES", coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageDayRule: "WORK_OBLIGATION", coverageAppliesSpecialHours: true, coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
    types.jornada = await createType({ name: "Licencia por jornada", kind: "LICENCIA", coverageMode: "EXPECTED_SCHEDULE", coverageDayRule: "WORK_OBLIGATION", coverageAppliesSpecialHours: true, coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
  });

  afterAll(async () => {
    await holder?.$disconnect();
    await m?.prisma.$disconnect();
  });

  it("francos: asignar → 0 (DAY_OFF) sólo ese día, sin reescribir los demás; cancelar → restaura; el snapshot abierto se reconstruye", async () => {
    const emp = await employee({ template: templates.lv, weekdays: [1, 2, 3, 4, 5] });
    const novelty = await createNovelty(emp, types.vacaciones, "2027-03-01", "2027-03-05");
    await closure(emp, "2027-03", "DEVUELTO");
    const before = await rows(novelty);
    expect([...before.values()].every((row) => row.outcome === "COVERED" && row.baseMinutes === 480)).toBe(true);

    await m.dayOffs.save({ date: "2027-03-03", employees: [{ employeeId: emp, status: "ACTIVO" }] } as never, user(), audit());
    const withDayOff = await rows(novelty);
    expect(withDayOff.get("2027-03-03")).toMatchObject({ outcome: "DAY_OFF", baseMinutes: 0 });
    // Diferencia: los días que no cambiaron conservan su fila (no se reescriben).
    expect(withDayOff.get("2027-03-01")!.id).toBe(before.get("2027-03-01")!.id);
    expect(withDayOff.get("2027-03-01")!.calculatedAt).toEqual(before.get("2027-03-01")!.calculatedAt);
    expect((await snapshotOf(emp, "2027-03")).accounting).toMatchObject({ noveltyCoveredMinutes: 4 * 480 });

    await m.dayOffs.save({ date: "2027-03-03", employees: [{ employeeId: emp, status: "CANCELADO" }] } as never, user(), audit());
    expect((await rows(novelty)).get("2027-03-03")).toMatchObject({ outcome: "COVERED", baseMinutes: 480 });
    expect((await snapshotOf(emp, "2027-03")).accounting).toMatchObject({ noveltyCoveredMinutes: 5 * 480 });
  });

  it("convocatoria a feriado: convocar → 480 × 2; cancelar → 0 (HOLIDAY_NOT_CONVOKED)", async () => {
    const emp = await employee({ template: templates.all });
    const novelty = await createNovelty(emp, types.vacaciones, "2027-03-24");
    expect((await rows(novelty)).get("2027-03-24")).toMatchObject({ outcome: "HOLIDAY_NOT_CONVOKED", baseMinutes: 0 });

    const save = (status: "ACTIVA" | "CANCELADA") => m.holidays.save(m.holidaySchemas.saveHolidayWorkAssignmentsSchema.parse({ date: "2027-03-24", assignments: [{ employeeId: emp, status }] }), user(), audit());
    await save("ACTIVA");
    const convoked = (await rows(novelty)).get("2027-03-24")!;
    expect(convoked).toMatchObject({ outcome: "COVERED", baseMinutes: 480 });
    expect(Number(convoked.appliedMultiplier)).toBe(2);

    await save("CANCELADA");
    expect((await rows(novelty)).get("2027-03-24")).toMatchObject({ outcome: "HOLIDAY_NOT_CONVOKED", baseMinutes: 0 });
  });

  it("turnos: L–V → agregar el domingo recalcula sólo esa vigencia (0 → 480 × 2) sin tocar los demás días", async () => {
    const emp = await employee();
    const [assignment] = await m.assignments.assign({ employeeIds: [emp], shiftTemplateId: templates.lv, effectiveFrom: day("2027-01-01"), weekdays: [1, 2, 3, 4, 5] } as never, globalShiftActor(user()), audit());
    const novelty = await createNovelty(emp, types.vacaciones, "2027-03-01", "2027-03-07");
    const before = await rows(novelty);
    expect(before.get("2027-03-07")).toMatchObject({ outcome: "NO_WORK_OBLIGATION", baseMinutes: 0 });

    await m.assignments.update(assignment!.id, { weekdays: [0, 1, 2, 3, 4, 5] } as never, globalShiftActor(user()), audit());
    const after = await rows(novelty);
    expect(after.get("2027-03-07")).toMatchObject({ outcome: "COVERED", baseMinutes: 480 });
    expect(Number(after.get("2027-03-07")!.appliedMultiplier)).toBe(2);
    expect(after.get("2027-03-02")!.id).toBe(before.get("2027-03-02")!.id);
  });

  it("turnos: introducir un solapamiento manda a revisión; quitarlo lo resuelve solo", async () => {
    const emp = await employee({ template: templates.lv, weekdays: [1, 2, 3, 4, 5] });
    const novelty = await createNovelty(emp, types.vacaciones, "2027-03-01", "2027-03-02");
    const [overlapping] = await m.assignments.assign({ employeeIds: [emp], shiftTemplateId: templates.all, effectiveFrom: day("2027-02-01"), weekdays: [] } as never, globalShiftActor(user()), audit());
    const overlapped = await rows(novelty);
    expect([...overlapped.values()].map((row) => [row.outcome, row.scheduleReviewReason, row.reviewStatus])).toEqual([
      ["SCHEDULE_UNRESOLVED", "SHIFT_ASSIGNMENTS_OVERLAP", "PENDING"],
      ["SCHEDULE_UNRESOLVED", "SHIFT_ASSIGNMENTS_OVERLAP", "PENDING"],
    ]);

    await m.assignments.remove(overlapping!.id, globalShiftActor(user()), audit());
    expect([...(await rows(novelty)).values()].map((row) => [row.outcome, row.baseMinutes, row.reviewStatus])).toEqual([
      ["COVERED", 480, "NOT_REQUIRED"],
      ["COVERED", 480, "NOT_REQUIRED"],
    ]);
  });

  it("resoluciones manuales: se conservan si la incertidumbre sigue (y toman el multiplicador nuevo); se descartan, auditadas, cuando aparece el turno", async () => {
    const emp = await employee();
    const firstSunday = await createNovelty(emp, types.vacaciones, "2027-03-07");
    const secondSunday = await createNovelty(emp, types.vacaciones, "2027-03-14");
    expect((await rows(secondSunday)).get("2027-03-14")).toMatchObject({ outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "SCHEDULE_MISSING", reviewStatus: "PENDING" });
    const resolution = m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 480, note: "Trabajaba domingos de 8 h" });
    await m.novelties.resolveCoverageDay(firstSunday, "2027-03-07", resolution, user());
    await m.novelties.resolveCoverageDay(secondSunday, "2027-03-14", resolution, user());

    // Evento no relacionado (regla de domingos sólo para este legajo, ×3): misma incertidumbre → se conserva.
    await m.workforce.createDoubleRule(m.workforceSchemas.doubleRuleSchema.parse({ name: "Domingo especial", recurrenceType: "SEMANAL", weekdays: [0], fromDate: "2027-01-01", multiplier: 3, priority: 10, kind: "DOMINGO", employeeIds: [emp], reason: "it" }), user(), audit());
    const kept = (await rows(secondSunday)).get("2027-03-14")!;
    expect(kept).toMatchObject({ reviewStatus: "RESOLVED", resolution: "SET_BASE_MINUTES", resolvedBaseMinutes: 480, resolutionNote: "Trabajaba domingos de 8 h", resolvedByUserId: rrhh });
    expect(Number(kept.appliedMultiplier)).toBe(3);

    // Aparece el turno desde el 10/03: el 14 ya se puede calcular → manda la evidencia; el 7 sigue igual.
    const [assignment] = await m.assignments.assign({ employeeIds: [emp], shiftTemplateId: templates.all, effectiveFrom: day("2027-03-10"), weekdays: [] } as never, globalShiftActor(user()), audit());
    expect((await rows(secondSunday)).get("2027-03-14")).toMatchObject({ outcome: "COVERED", baseMinutes: 480, reviewStatus: "NOT_REQUIRED", resolution: null, resolutionNote: null });
    expect((await rows(firstSunday)).get("2027-03-07")).toMatchObject({ reviewStatus: "RESOLVED", resolvedBaseMinutes: 480 });
    const dropped = await holder.auditLog.findFirst({ where: { entity: "NoveltyDayCoverage", entityId: secondSunday } });
    expect(dropped?.description).toMatch(/^Se descartó la resolución manual del 14\/03\/2027 de .*Legajo/);
    expect(dropped?.before).toMatchObject({ resolution: "SET_BASE_MINUTES", resolvedBaseMinutes: 480, resolutionNote: "Trabajaba domingos de 8 h" });

    // Quitar el turno vuelve a revisión: la resolución descartada no resucita.
    await m.assignments.remove(assignment!.id, globalShiftActor(user()), audit());
    expect((await rows(secondSunday)).get("2027-03-14")).toMatchObject({ outcome: "SCHEDULE_UNRESOLVED", reviewStatus: "PENDING", resolution: null });
  });

  it("plantilla: cambiar el horario recalcula la jornada sólo de quienes la usan; un turno nocturno sigue correcto", async () => {
    const template = (await holder.shiftTemplate.create({ data: { code: "R-X", name: "R-X", startTime: "08:00", endTime: "16:00", expectedMinutes: 480 } })).id;
    const user1 = await employee({ template });
    const other = await employee({ template: templates.all });
    const mine = await createNovelty(user1, types.jornada, "2027-03-02");
    const theirs = await createNovelty(other, types.jornada, "2027-03-02");
    const theirsBefore = (await rows(theirs)).get("2027-03-02")!;

    await m.workforce.updateShiftTemplate(template, { endTime: "17:00" }, globalShiftActor(user()), audit());
    expect((await rows(mine)).get("2027-03-02")).toMatchObject({ outcome: "COVERED", baseMinutes: 540, expectedMinutes: 540 });
    expect((await rows(theirs)).get("2027-03-02")!.calculatedAt).toEqual(theirsBefore.calculatedAt);

    await m.workforce.updateShiftTemplate(template, { startTime: "22:00", endTime: "06:00" }, globalShiftActor(user()), audit());
    expect((await rows(mine)).get("2027-03-02")).toMatchObject({ outcome: "COVERED", baseMinutes: 480, expectedMinutes: 480 });
  });

  it("régimen: asignar flexible → revisión; flexible → obligatorio → 0 confirmado; → sin turno → revisión; cerrar la vigencia → 0 confirmado", async () => {
    const emp = await employee({ template: templates.lv, weekdays: [1, 2, 3, 4, 5] });
    const novelty = await createNovelty(emp, types.vacaciones, "2027-03-07");
    const sunday = async () => (await rows(novelty)).get("2027-03-07")!;
    expect(await sunday()).toMatchObject({ outcome: "NO_WORK_OBLIGATION", reviewStatus: "NOT_REQUIRED" });

    const regime = await holder.workRegime.create({ data: { code: `RG-${legajo}`, name: "Régimen IT", kind: "TURNO_FLEXIBLE" } });
    const assigned = await m.regimes.assign(emp, { workRegimeId: regime.id, effectiveFrom: day("2027-01-01") } as never, audit());
    expect(await sunday()).toMatchObject({ outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "FLEXIBLE_REGIME_NO_ASSIGNMENT", reviewStatus: "PENDING" });

    await m.regimes.update(regime.id, { kind: "TURNO_OBLIGATORIO" } as never, audit());
    expect(await sunday()).toMatchObject({ outcome: "NO_WORK_OBLIGATION", reviewStatus: "NOT_REQUIRED" });

    await m.regimes.update(regime.id, { kind: "SIN_TURNO" } as never, audit());
    expect(await sunday()).toMatchObject({ outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "REGIME_WITHOUT_SCHEDULE" });

    await m.regimes.closeAssignment(emp, assigned.id, day("2027-03-01"), audit());
    expect(await sunday()).toMatchObject({ outcome: "NO_WORK_OBLIGATION", reviewStatus: "NOT_REQUIRED" });
  });

  it("relación laboral: el ALTA resuelve los días pendientes; la BAJA deja los posteriores en 0 confirmado sin tocar los anteriores", async () => {
    const emp = await employee({ alta: null, template: templates.lv, weekdays: [1, 2, 3, 4, 5] });
    // §17: con cantidad fija la falta de ALTA no importa; sólo la jornada esperada la necesita.
    const fixed = await createNovelty(emp, types.vacaciones, "2027-03-08", "2027-03-09");
    expect([...(await rows(fixed)).values()].every((row) => row.outcome === "COVERED" && row.baseMinutes === 480 && row.reviewStatus === "NOT_REQUIRED")).toBe(true);
    const novelty = await createNovelty(emp, types.jornada, "2027-03-01", "2027-03-05");
    expect([...(await rows(novelty)).values()].every((row) => row.scheduleReviewReason === "EMPLOYMENT_HISTORY_UNRESOLVED" && row.reviewStatus === "PENDING")).toBe(true);

    await m.employees.createLaborMovement(emp, { type: "ALTA", effectiveFrom: day("2027-01-01"), reason: "Ingreso" } as never, audit());
    const employed = await rows(novelty);
    expect([...employed.values()].every((row) => row.outcome === "COVERED" && row.baseMinutes === 480 && row.reviewStatus === "NOT_REQUIRED")).toBe(true);

    await m.employees.createLaborMovement(emp, { type: "BAJA", effectiveFrom: day("2027-03-04"), reason: "Renuncia" } as never, audit());
    const afterBaja = await rows(novelty);
    expect(afterBaja.get("2027-03-04")).toMatchObject({ outcome: "OUTSIDE_EMPLOYMENT", baseMinutes: 0, reviewStatus: "NOT_REQUIRED" });
    expect(afterBaja.get("2027-03-05")).toMatchObject({ outcome: "OUTSIDE_EMPLOYMENT", baseMinutes: 0 });
    expect(afterBaja.get("2027-03-03")!.id).toBe(employed.get("2027-03-03")!.id);
  });

  it("multiplicadores: ×2 → ×1,5 cambia la liquidación, no la base computable; un cambio de alcance mueve a quien entra y a quien sale; sin historia, el cambio se rechaza entero", async () => {
    const first = await employee({ template: templates.all });
    const second = await employee({ template: templates.all });
    const firstSunday = await createNovelty(first, types.vacaciones, "2027-03-21");
    const secondSunday = await createNovelty(second, types.vacaciones, "2027-03-21");
    const rule = await m.workforce.createDoubleRule(m.workforceSchemas.doubleRuleSchema.parse({ name: "Domingo planta", recurrenceType: "SEMANAL", weekdays: [0], fromDate: "2027-03-01", multiplier: 2, priority: 20, kind: "DOMINGO", employeeIds: [first], reason: "it" }), user(), audit());

    await m.workforce.updateDoubleRule(rule.id, m.workforceSchemas.updateDoubleRuleSchema.parse({ multiplier: 1.5 }), audit());
    expect(Number((await rows(firstSunday)).get("2027-03-21")!.appliedMultiplier)).toBe(1.5);
    const grid = await m.employees.getTimeGrid(first, { period: "2027-03" } as never, user()) as unknown as { accounting: { totalWorkedMinutes: number; noveltyCoveredMinutes: number; computableMinutes: number; settlement: { noveltyMinutes: number } } };
    expect(grid.accounting).toMatchObject({ totalWorkedMinutes: 0, noveltyCoveredMinutes: 480, computableMinutes: 480, settlement: expect.objectContaining({ noveltyMinutes: 720 }) });

    // Alcance: deja al primero (vuelve al domingo global ×2) y toma al segundo (×1,5).
    await m.workforce.updateDoubleRule(rule.id, m.workforceSchemas.updateDoubleRuleSchema.parse({ employeeIds: [second] }), audit());
    expect(Number((await rows(firstSunday)).get("2027-03-21")!.appliedMultiplier)).toBe(2);
    expect(Number((await rows(secondSunday)).get("2027-03-21")!.appliedMultiplier)).toBe(1.5);

    // Regla con alcance por empresa y nadie con historia de empresa: nunca cae en silencio a ×1.
    const company = await holder.company.create({ data: { name: "Empresa recálculo", code: "ERC" } });
    await expect(
      m.workforce.createDoubleRule(m.workforceSchemas.doubleRuleSchema.parse({ name: "Domingo empresa", recurrenceType: "SEMANAL", weekdays: [0], fromDate: "2027-03-01", multiplier: 3, priority: 30, kind: "DOMINGO", companyId: company.id, reason: "it" }), user(), audit()),
    ).rejects.toMatchObject({ code: "SPECIAL_HOUR_SCOPE_HISTORY_MISSING" });
    expect(await holder.doubleHourRule.count({ where: { name: "Domingo empresa" } })).toBe(0);
    expect(Number((await rows(secondSunday)).get("2027-03-21")!.appliedMultiplier)).toBe(1.5);
  });

  it("tipo de novedad: 4 h → 3 h en períodos abiertos; el período protegido no se toca ni se reconstruye; el abierto sí", async () => {
    const tramite = await createType({ name: "Trámite recálculo", allowsDateRange: false, coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 240, coverageOnDayOff: "NO_COVERAGE", coverageOnHoliday: "NO_COVERAGE", coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
    const informativo = await createType({ name: "Informativo protegido", allowsDateRange: false, coverageMode: "NONE", realWorkCompatibility: "COMPATIBLE" });
    const emp = await employee({ template: templates.lv, weekdays: [1, 2, 3, 4, 5] });
    const february = await createNovelty(emp, tramite, "2027-02-10");
    const march = await createNovelty(emp, tramite, "2027-03-02");
    await closure(emp, "2027-02", "ENVIADO");
    await closure(emp, "2027-03", "DEVUELTO");
    // Una novedad NONE puede cargarse en un cierre porque no altera minutos,
    // pero un recálculo automático posterior tampoco debe reinterpretar su
    // snapshot diario dentro del período ya protegido.
    const protectedNone = await createNovelty(emp, informativo, "2027-02-11");
    const protectedNoneBefore = (await rows(protectedNone)).get("2027-02-11")!;

    await m.types.update(tramite, m.typeSchemas.updateNoveltyTypeSchema.parse({ coverageFixedMinutes: 180 }), audit());
    await m.types.update(informativo, m.typeSchemas.updateNoveltyTypeSchema.parse({ realWorkCompatibility: "INCOMPATIBLE" }), audit());
    expect((await rows(march)).get("2027-03-02")).toMatchObject({ baseMinutes: 180 });
    expect((await rows(february)).get("2027-02-10")).toMatchObject({ baseMinutes: 240 });
    expect((await rows(protectedNone)).get("2027-02-11")).toMatchObject({ id: protectedNoneBefore.id, realWorkCompatibility: "COMPATIBLE" });
    expect(await snapshotOf(emp, "2027-02")).toEqual({ marker: "previo" });
    const rebuilt = await snapshotOf(emp, "2027-03");
    expect(rebuilt.accounting).toMatchObject({ noveltyCoveredMinutes: 180 });
    expect(rebuilt.recalculation).toMatchObject({ reason: "NOVELTY_COVERAGE_CHANGED", source: "NOVELTY_TYPE_CHANGED" });
    const summary = await holder.auditLog.findFirst({ where: { entity: "NoveltyDayCoverage", entityId: null }, orderBy: { createdAt: "desc" } });
    expect(summary?.description).toContain("No se reinterpretaron períodos enviados o aprobados (febrero de 2027)");
  });

  it("tipo de novedad: días de la semana, feriado, multiplicadores y 'no suma → suma'", async () => {
    const maternidad = await createType({ name: "Maternidad recálculo", coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageDayRule: "SELECTED_WEEKDAYS", coverageWeekdays: [1, 2, 3, 4, 5], coverageOnDayOff: "COVER", coverageOnHoliday: "COVER", coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
    const vacaciones = await createType({ name: "Vacaciones recálculo", kind: "VACACIONES", coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageDayRule: "WORK_OBLIGATION", coverageAppliesSpecialHours: true, coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
    const informativo = await createType({ name: "Informativo recálculo", allowsDateRange: false, coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 60, coverageOnDayOff: "COVER", coverageOnHoliday: "COVER", coverageCountsTowardTotal: false });
    const emp = await employee({ template: templates.all });
    const leave = await createNovelty(emp, maternidad, "2027-03-22", "2027-03-26");
    const sunday = await createNovelty(emp, vacaciones, "2027-03-28");
    const info = await createNovelty(emp, informativo, "2027-03-23");
    expect((await rows(leave)).get("2027-03-24")).toMatchObject({ outcome: "COVERED", baseMinutes: 480 });

    await m.types.update(maternidad, m.typeSchemas.updateNoveltyTypeSchema.parse({ coverageOnHoliday: "NO_COVERAGE", coverageWeekdays: [1, 2, 3, 4] }), audit());
    const leaveAfter = await rows(leave);
    expect(leaveAfter.get("2027-03-24")).toMatchObject({ outcome: "HOLIDAY_EXCLUDED", baseMinutes: 0 });
    expect(leaveAfter.get("2027-03-26")).toMatchObject({ outcome: "WEEKDAY_NOT_INCLUDED", baseMinutes: 0 });

    expect(Number((await rows(sunday)).get("2027-03-28")!.appliedMultiplier)).toBe(2);
    await m.types.update(vacaciones, m.typeSchemas.updateNoveltyTypeSchema.parse({ coverageAppliesSpecialHours: false }), audit());
    expect(Number((await rows(sunday)).get("2027-03-28")!.appliedMultiplier)).toBe(1);

    await m.types.update(informativo, m.typeSchemas.updateNoveltyTypeSchema.parse({ coverageCountsTowardTotal: true }), audit());
    expect((await rows(info)).get("2027-03-23")).toMatchObject({ countsTowardTotal: true });
  });

  it("rendimiento: un recálculo hace la misma cantidad de consultas para 2 que para 8 legajos (sin N+1)", async () => {
    const perfType = await createType({ name: "Perf recálculo", kind: "VACACIONES", coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageDayRule: "WORK_OBLIGATION", coverageAppliesSpecialHours: true, coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
    const people: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const emp = await employee({ template: templates.all });
      people.push(emp);
      await createNovelty(emp, perfType, "2027-04-01", "2027-04-30");
    }
    const countQueries = async (employeeIds: string[]) => {
      let count = 0;
      await m.prisma.$transaction(async (tx) => {
        const counted = new Proxy(tx, {
          get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof value === "function") return (...args: unknown[]) => (count += 1, (value as (...rest: unknown[]) => unknown).apply(target, args));
            if (value && typeof value === "object") {
              return new Proxy(value, { get: (model, method) => {
                const fn = Reflect.get(model, method);
                return typeof fn === "function" ? (...args: unknown[]) => (count += 1, fn.apply(model, args)) : fn;
              } });
            }
            return value;
          },
        });
        await m.recalculation.recalculateNoveltyCoverage(counted as typeof tx, { employeeIds, noveltyTypeIds: [perfType], from: day("2027-04-01"), to: day("2027-04-30") }, { source: "SHIFT_TEMPLATE_CHANGED", label: "prueba de rendimiento" });
      }, { timeout: 30_000 });
      return count;
    };
    const few = await countQueries(people.slice(0, 2));
    const many = await countQueries(people);
    expect(many).toBe(few);
    expect(few).toBeLessThan(30);
  });
});
