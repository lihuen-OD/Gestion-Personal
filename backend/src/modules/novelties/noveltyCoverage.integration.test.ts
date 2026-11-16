/**
 * Cobertura diaria de novedades contra PostgreSQL REAL — etapa 3
 * (docs/decisions/NOVELTY_COVERAGE_ENGINE.md): migraciones
 * 20261113180000_add_novelty_coverage_engine y
 * 20261114120000_add_novelty_coverage_employment_and_overlap, motor puro,
 * persistencia idempotente, vista previa, resolución manual, relación laboral,
 * guard de cierres, alcance, rechazo, borrado en cascada y constraints.
 *
 * Opt-in: sólo corre con `NOVELTY_COVERAGE_IT_DATABASE_URL` → `localhost`,
 * base `clock_it*` PROPIA con el schema de este commit. VACÍA la base al
 * empezar. Nunca usa el DATABASE_URL del .env y verifica `current_database()`.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NOVELTY_COVERAGE_IT_DATABASE_URL;

type Modules = {
  employees: typeof import("../employees/employees.service").employeesService;
  timeEntriesRepository: typeof import("../time-entries/timeEntries.repository").timeEntriesRepository;
  timeEntries: typeof import("../time-entries/timeEntries.service").timeEntriesService;
  workforce: typeof import("../workforce-management/workforce.service").workforceService;
  prisma: typeof import("../../shared/prisma/client").prisma;
  novelties: typeof import("./novelties.service").noveltiesService;
  noveltySchemas: typeof import("./novelties.schemas");
  types: typeof import("../novelty-types/noveltyTypes.service").noveltyTypesService;
  typeSchemas: typeof import("../novelty-types/noveltyTypes.schemas");
  coverage: typeof import("./noveltyCoverage.service");
};

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

describe.skipIf(!url)("Cobertura de novedades contra PostgreSQL local", () => {
  let m: Modules;
  let holder: PrismaClient;
  const users = { rrhh: "", sup: "", carga: "" };
  const employees = { a: "", b: "", minimal: "", late: "" };
  let normalConceptId = "";
  const types = { tramite: "", maternidadCover: "", maternidadNoCoverage: "", vacaciones: "", vacacionesJornada: "", vacacionesFijas: "", llegadaTarde: "", faltaSinAviso: "", licenciaAbierta: "", conCertificado: "" };

  const as = (role: "rrhh" | "sup" | "carga") =>
    ({ id: users[role], email: `${role}@example.com`, name: role, role: { rrhh: "NIVEL_1_RRHH", sup: "NIVEL_2_SUPERVISION", carga: "NIVEL_3_CARGA_HORARIA" }[role] }) as Express.AuthUser;
  const create = (role: "rrhh" | "sup" | "carga", payload: Record<string, unknown>) => m.novelties.create(m.noveltySchemas.createNoveltySchema.parse(payload), as(role));
  const coverageRows = (noveltyId: string) => holder.noveltyDayCoverage.findMany({ where: { noveltyId }, orderBy: { date: "asc" } });
  const byDate = <T extends { date: Date }>(rows: T[]) => new Map(rows.map((row) => [row.date.toISOString().slice(0, 10), row]));
  const createType = async (payload: Record<string, unknown>) => (await m.types.create(m.typeSchemas.createNoveltyTypeSchema.parse({ kind: "OTRO", ...payload }))).id;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("NOVELTY_COVERAGE_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    // Documentos de novedades (etapa 8): siempre al storage local de la
    // máquina (backend/uploads, ignorado por git), nunca a un proveedor externo
    // que pudiera venir del .env. Se fija antes de importar la configuración.
    for (const name of ["STORAGE_PROVIDER", "DEFAULT_STORAGE_PROVIDER", "DOCUMENT_STORAGE_PROVIDER"]) process.env[name] = "local";
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ prisma }, { noveltiesService }, noveltySchemas, { noveltyTypesService }, typeSchemas, coverage, { employeesService }, { timeEntriesRepository }, { timeEntriesService }, { workforceService }] = await Promise.all([
      import("../../shared/prisma/client"),
      import("./novelties.service"),
      import("./novelties.schemas"),
      import("../novelty-types/noveltyTypes.service"),
      import("../novelty-types/noveltyTypes.schemas"),
      import("./noveltyCoverage.service"),
      import("../employees/employees.service"),
      import("../time-entries/timeEntries.repository"),
      import("../time-entries/timeEntries.service"),
      import("../workforce-management/workforce.service"),
    ]);
    m = { prisma, novelties: noveltiesService, noveltySchemas, types: noveltyTypesService, typeSchemas, coverage, employees: employeesService, timeEntriesRepository, timeEntries: timeEntriesService, workforce: workforceService };
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);

    for (const role of ["rrhh", "sup", "carga"] as const) {
      users[role] = (await holder.user.create({ data: { name: role, email: `${role}@example.com`, passwordHash: "x", role: as(role).role as never } })).id;
    }
    const employee = async (legajo: string, alta: string | null) => {
      const created = await holder.employee.create({ data: { legajo, dni: `3000000${legajo}`, firstName: "Ana", lastName: `Prueba ${legajo}` } });
      if (alta) await holder.laborMovement.create({ data: { employeeId: created.id, type: "ALTA", effectiveFrom: day(alta), reason: "Ingreso" } });
      return created.id;
    };
    employees.a = await employee("101", "2026-01-01");
    employees.b = await employee("102", "2026-01-01");
    employees.minimal = await employee("103", null);
    employees.late = await employee("104", "2026-11-18");

    const template = async (code: string) => (await holder.shiftTemplate.create({ data: { code, name: code, startTime: "08:00", endTime: "16:00", expectedMinutes: 480 } })).id;
    const weekdaysShift = await template("T-LV");
    const everyDayShift = await template("T-ALL");
    await holder.shiftAssignment.create({ data: { employeeId: employees.a, shiftTemplateId: weekdaysShift, effectiveFrom: day("2026-01-01"), weekdays: [1, 2, 3, 4, 5] } });
    await holder.shiftAssignment.create({ data: { employeeId: employees.late, shiftTemplateId: weekdaysShift, effectiveFrom: day("2026-01-01"), weekdays: [1, 2, 3, 4, 5] } });
    await holder.shiftAssignment.create({ data: { employeeId: employees.b, shiftTemplateId: everyDayShift, effectiveFrom: day("2026-01-01"), weekdays: [] } });

    // Domingo ×2 global y feriado global del miércoles 18 con convocatoria de B.
    await holder.doubleHourRule.create({ data: { name: "Domingos", recurrenceType: "SEMANAL", weekdays: [0], fromDate: day("2026-01-01"), multiplier: 2, kind: "DOMINGO", reason: "it" } });
    const feriado = await holder.doubleHourRule.create({ data: { name: "Feriados", recurrenceType: "FECHA", fromDate: day("2026-11-18"), toDate: day("2026-11-25"), multiplier: 2, kind: "FERIADO", reason: "it" } });
    await holder.specialHourRuleDate.create({ data: { ruleId: feriado.id, date: day("2026-11-18") } });
    await holder.holidayWorkAssignment.create({ data: { date: day("2026-11-18"), employeeId: employees.b } });
    // Feriado con alcance por empresa el 25: nadie tiene historia de empresa empleadora.
    const company = await holder.company.create({ data: { name: "Empresa IT", code: "EIT" } });
    const scoped = await holder.doubleHourRule.create({ data: { name: "Feriado planta", recurrenceType: "FECHA", fromDate: day("2026-11-25"), toDate: day("2026-11-25"), multiplier: 2, kind: "FERIADO", reason: "it", companyId: company.id } });
    await holder.specialHourRuleDate.create({ data: { ruleId: scoped.id, date: day("2026-11-25") } });

    await holder.employeeDayOff.create({ data: { employeeId: employees.a, date: day("2026-11-17") } });
    normalConceptId = (await holder.hourConcept.create({ data: { code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", systemRole: "NORMAL_BASE" } })).id;
    // La supervisión sólo alcanza al legajo A.
    await holder.employeeAssignment.create({ data: { employeeId: employees.a, userId: users.sup, type: "TIME_RESPONSIBLE" } });

    types.tramite = await createType({ name: "Trámite bancario", allowsDateRange: false, coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 240, coverageOnDayOff: "NO_COVERAGE", coverageOnHoliday: "NO_COVERAGE", coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
    const maternidad = { coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageDayRule: "SELECTED_WEEKDAYS", coverageWeekdays: [1, 2, 3, 4, 5], coverageOnDayOff: "COVER", coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" };
    types.maternidadCover = await createType({ name: "Maternidad (cubre feriados)", ...maternidad, coverageOnHoliday: "COVER" });
    types.maternidadNoCoverage = await createType({ name: "Maternidad (sin feriados)", ...maternidad, coverageOnHoliday: "NO_COVERAGE" });
    types.vacaciones = await createType({ name: "Vacaciones", kind: "VACACIONES", coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageDayRule: "WORK_OBLIGATION", coverageAppliesSpecialHours: true, coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
    // §17: según jornada (necesita turno e historia laboral) y fija todos los días (no necesita ninguno).
    types.vacacionesJornada = await createType({ name: "Vacaciones según jornada", kind: "VACACIONES", coverageMode: "EXPECTED_SCHEDULE", coverageDayRule: "WORK_OBLIGATION", coverageAppliesSpecialHours: true, coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
    types.vacacionesFijas = await createType({ name: "Vacaciones fijas", kind: "VACACIONES", coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageDayRule: "EVERY_DAY", coverageOnDayOff: "COVER", coverageOnHoliday: "COVER", coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
    types.llegadaTarde = await createType({ name: "Llegada tarde", kind: "HORARIA", allowsHours: true, allowsDateRange: false, coverageMode: "MANUAL_MINUTES" });
    types.faltaSinAviso = await createType({ name: "Falta sin aviso", kind: "AUSENCIA", allowsDateRange: false, realWorkCompatibility: "INCOMPATIBLE", timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" });
    types.licenciaAbierta = await createType({ name: "Licencia abierta", kind: "LICENCIA" });
    // Etapa 8: documentación obligatoria (misma cobertura que Maternidad sin feriados).
    types.conCertificado = await createType({ name: "Licencia con certificado", kind: "LICENCIA", requiresDocumentation: true, ...maternidad, coverageOnHoliday: "NO_COVERAGE" });
    await holder.documentCategory.create({ data: { code: "DOC-NOV-IT", name: "Respaldo de novedad", kind: "NOVEDAD", scopes: ["NOVEDAD"], uploadRoles: ["Nivel 1 - RRHH"] } });
  });

  afterAll(async () => {
    await holder?.$disconnect();
    await m?.prisma.$disconnect();
  });

  it("paleta: los tipos creados sin color reciben colores distintos de la paleta (sin depender del nombre)", async () => {
    const colors = (await holder.noveltyType.findMany({ orderBy: { createdAt: "asc" }, select: { uiColor: true } })).map((row) => row.uiColor);
    expect(colors.length).toBeGreaterThan(5);
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors.slice(0, 3)).toEqual(["blue", "orange", "violet"]);
  });

  it("migraciones: los valores agregados son persistibles y los CHECKs siguen vigentes", async () => {
    const [created] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.faltaSinAviso, fromDate: "2026-11-10" });
    const id = created!.id;
    const base = { noveltyId: id, employeeId: employees.a, noveltyTypeId: types.faltaSinAviso, period: "2026-11", baseMinutes: 0, countsTowardTotal: false, realWorkCompatibility: "INCOMPATIBLE" as const, calculatedAt: new Date() };
    await expect(holder.noveltyDayCoverage.create({ data: { ...base, date: day("2026-11-11"), day: 11, outcome: "OUTSIDE_EMPLOYMENT" } })).resolves.toBeDefined();
    await expect(holder.noveltyDayCoverage.create({ data: { ...base, date: day("2026-11-12"), day: 12, outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "SHIFT_ASSIGNMENTS_OVERLAP", reviewStatus: "PENDING" } })).resolves.toBeDefined();
    await expect(holder.noveltyDayCoverage.create({ data: { ...base, date: day("2026-11-13"), day: 13, outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "EMPLOYMENT_HISTORY_UNRESOLVED", reviewStatus: "PENDING" } })).resolves.toBeDefined();
    // OUTSIDE_EMPLOYMENT con minutos viola NoveltyDayCoverage_minutes_check.
    await expect(holder.noveltyDayCoverage.create({ data: { ...base, date: day("2026-11-14"), day: 14, outcome: "OUTSIDE_EMPLOYMENT", baseMinutes: 60 } })).rejects.toThrow(/NoveltyDayCoverage_minutes_check/);
    // Única por novedad + fecha.
    await expect(holder.noveltyDayCoverage.create({ data: { ...base, date: day("2026-11-10"), day: 10, outcome: "NO_COVERAGE" } })).rejects.toMatchObject({ code: "P2002" });
    // Resolución incompleta viola NoveltyDayCoverage_resolution_check.
    await expect(
      holder.noveltyDayCoverage.create({ data: { ...base, date: day("2026-11-15"), day: 15, outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "SCHEDULE_MISSING", reviewStatus: "RESOLVED", resolution: "SET_BASE_MINUTES" } }),
    ).rejects.toThrow(/NoveltyDayCoverage_resolution_check/);
    // El borrado de la novedad arrastra su cobertura (dato derivado).
    await m.novelties.remove(id, as("rrhh"));
    expect(await coverageRows(id)).toHaveLength(0);
  });

  it("Vacaciones (legajo A, turno L–V): obligación, franco, feriado no convocado y fin de semana", async () => {
    const [novelty] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.vacaciones, fromDate: "2026-11-16", toDate: "2026-11-22" });
    const rows = byDate(await coverageRows(novelty!.id));
    expect(rows.size).toBe(7);
    expect(rows.get("2026-11-16")).toMatchObject({ outcome: "COVERED", baseMinutes: 480, reviewStatus: "NOT_REQUIRED", countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE", expectedMinutes: 480 });
    expect(Number(rows.get("2026-11-16")!.appliedMultiplier)).toBe(1);
    expect(rows.get("2026-11-17")).toMatchObject({ outcome: "DAY_OFF", baseMinutes: 0 });
    expect(rows.get("2026-11-18")).toMatchObject({ outcome: "HOLIDAY_NOT_CONVOKED", baseMinutes: 0 });
    expect(rows.get("2026-11-21")).toMatchObject({ outcome: "NO_WORK_OBLIGATION", baseMinutes: 0 });
    expect(rows.get("2026-11-22")).toMatchObject({ outcome: "NO_WORK_OBLIGATION", baseMinutes: 0 });
    // No se escribe ninguna hora.
    expect(await holder.timeEntry.count()).toBe(0);
  });

  it("Vacaciones (legajo B, turno todos los días): domingo ×2 y feriado convocado ×2; la vista previa coincide con lo persistido", async () => {
    const payload = { employeeIds: [employees.b], noveltyTypeId: types.vacaciones, fromDate: "2026-11-16", toDate: "2026-11-22" };
    const preview = await m.novelties.previewCoverage(m.noveltySchemas.noveltyCoveragePreviewSchema.parse(payload), as("rrhh"));
    const [novelty] = await create("rrhh", payload);
    const persisted = await m.novelties.getCoverage(novelty!.id, as("rrhh"));

    const sunday = persisted.days.find((item) => item.date === "2026-11-22")!;
    const holiday = persisted.days.find((item) => item.date === "2026-11-18")!;
    expect(sunday).toMatchObject({ outcome: "COVERED", baseMinutes: 480, multiplier: 2, computedMinutes: 960 });
    expect(holiday).toMatchObject({ outcome: "COVERED", baseMinutes: 480, multiplier: 2, computedMinutes: 960 });
    expect(persisted.totals).toMatchObject({ days: 7, coveredDays: 7, baseMinutes: 3360, computedMinutes: 3360 + 480 + 480 });

    const shape = (days: Array<Record<string, unknown>>) => days.map(({ date, outcome, baseMinutes, multiplier, computedMinutes, reviewStatus, label }) => ({ date, outcome, baseMinutes, multiplier, computedMinutes, reviewStatus, label }));
    expect(shape(preview.employees[0]!.days)).toEqual(shape(persisted.days));
    expect(await holder.noveltyDayCoverage.count({ where: { employeeId: employees.b } })).toBe(7);
  });

  it("§17: legajo sin ALTA ni turno — Vacaciones fijas cubre 480 cada día; con cantidad fija y días con obligación, a lo sumo el valor del tipo", async () => {
    const [fixed] = await create("rrhh", { employeeIds: [employees.minimal], noveltyTypeId: types.vacacionesFijas, fromDate: "2026-10-12", toDate: "2026-10-18" });
    const fixedRows = await coverageRows(fixed!.id);
    expect(fixedRows).toHaveLength(7);
    expect(fixedRows.every((row) => row.outcome === "COVERED" && row.baseMinutes === 480 && row.reviewStatus === "NOT_REQUIRED")).toBe(true);
    // Excepción administrativa: 0 h en un día, el resto sigue en 480; deshacerla vuelve al valor del tipo.
    const zero = m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "CONFIRMED_ZERO", note: "Ese día se presentó a trabajar" });
    await m.novelties.resolveCoverageDay(fixed!.id, "2026-10-14", zero, as("rrhh"));
    const otherAmount = m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 600, note: "Diez horas" });
    await expect(m.novelties.resolveCoverageDay(fixed!.id, "2026-10-15", otherAmount, as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED" });
    expect((await coverageRows(fixed!.id)).map((row) => row.resolvedBaseMinutes ?? row.baseMinutes)).toEqual([480, 480, 0, 480, 480, 480, 480]);
    const restore = m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "RESTORE_AUTOMATIC", note: "Se cargó por error" });
    expect(await m.novelties.resolveCoverageDay(fixed!.id, "2026-10-14", restore, as("rrhh"))).toMatchObject({ reviewStatus: "NOT_REQUIRED", resolution: null, effectiveBaseMinutes: 480 });
    await expect(m.novelties.resolveCoverageDay(fixed!.id, "2026-10-14", restore, as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_DAY_NOT_RESOLVED" });

    // Cantidad fija pero "días que debía trabajar": la regla del tipo sí necesita el turno para elegir los días.
    const [byObligation] = await create("rrhh", { employeeIds: [employees.minimal], noveltyTypeId: types.vacaciones, fromDate: "2026-10-19" });
    expect((await coverageRows(byObligation!.id))[0]).toMatchObject({ outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "SCHEDULE_MISSING", reviewStatus: "PENDING" });
    await expect(m.novelties.resolveCoverageDay(byObligation!.id, "2026-10-19", m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 540, note: "Eran 9 h" }), as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED" });
    expect(await m.novelties.resolveCoverageDay(byObligation!.id, "2026-10-19", m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 480, note: "Tenía que trabajar" }), as("rrhh"))).toMatchObject({ reviewStatus: "RESOLVED", effectiveBaseMinutes: 480 });
  });

  it("legajo mínimo sin ALTA (según jornada): 0 h provisional en revisión; registrar el ALTA cambia el motivo; la resolución manual se conserva al recalcular", async () => {
    const [novelty] = await create("rrhh", { employeeIds: [employees.minimal], noveltyTypeId: types.vacacionesJornada, fromDate: "2026-11-16", toDate: "2026-11-22" });
    const rows = await coverageRows(novelty!.id);
    expect(rows.every((row) => row.outcome === "SCHEDULE_UNRESOLVED" && row.scheduleReviewReason === "EMPLOYMENT_HISTORY_UNRESOLVED" && row.reviewStatus === "PENDING" && row.baseMinutes === 0)).toBe(true);

    // Con ALTA pero sin turno: el motivo pasa a ser la jornada.
    await holder.laborMovement.create({ data: { employeeId: employees.minimal, type: "ALTA", effectiveFrom: day("2026-01-01"), reason: "Ingreso" } });
    await m.prisma.$transaction((tx) => m.coverage.persistNoveltyCoverageWithin(tx, [novelty!.id], { protectedPeriods: "SKIP" }));
    const afterAlta = byDate(await coverageRows(novelty!.id));
    // El miércoles 18 es feriado global y el legajo no fue convocado: 0 h confirmado.
    expect(afterAlta.get("2026-11-18")).toMatchObject({ outcome: "HOLIDAY_NOT_CONVOKED", reviewStatus: "NOT_REQUIRED" });
    expect([...afterAlta.entries()].filter(([key]) => key !== "2026-11-18").every(([, row]) => row.scheduleReviewReason === "SCHEDULE_MISSING" && row.reviewStatus === "PENDING")).toBe(true);

    // Resolución del encargado: el domingo eran 8 h base → ×2 del motor de Horas Especiales.
    const resolved = await m.novelties.resolveCoverageDay(novelty!.id, "2026-11-22", m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 480, note: "Trabajaba domingos de 8 h" }), as("rrhh"));
    expect(resolved).toMatchObject({ reviewStatus: "RESOLVED", resolution: "SET_BASE_MINUTES", effectiveBaseMinutes: 480, multiplier: 2, computedMinutes: 960 });
    await m.novelties.resolveCoverageDay(novelty!.id, "2026-11-21", m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "CONFIRMED_ZERO", note: "No trabajaba sábados" }), as("rrhh"));

    const sundayRow = byDate(await coverageRows(novelty!.id)).get("2026-11-22")!;
    expect(sundayRow).toMatchObject({ resolvedBaseMinutes: 480, resolvedAgainstWorkedMinutes: 0, resolvedByUserId: users.rrhh, resolutionNote: "Trabajaba domingos de 8 h" });

    // Recálculo idempotente: mismas filas, la resolución sigue.
    await m.prisma.$transaction((tx) => m.coverage.persistNoveltyCoverageWithin(tx, [novelty!.id], { protectedPeriods: "SKIP" }));
    await m.prisma.$transaction((tx) => m.coverage.persistNoveltyCoverageWithin(tx, [novelty!.id], { protectedPeriods: "SKIP" }));
    const again = byDate(await coverageRows(novelty!.id));
    expect(again.size).toBe(7);
    expect(again.get("2026-11-22")).toMatchObject({ reviewStatus: "RESOLVED", resolvedBaseMinutes: 480, resolutionNote: "Trabajaba domingos de 8 h" });
    expect(again.get("2026-11-21")).toMatchObject({ reviewStatus: "RESOLVED", resolution: "CONFIRMED_ZERO", resolvedBaseMinutes: 0 });
    expect([...again.values()].filter((row) => row.reviewStatus === "PENDING")).toHaveLength(4);

    // Con turno asignado, la evidencia manda y las resoluciones se descartan.
    const shift = await holder.shiftTemplate.findFirstOrThrow({ where: { code: "T-ALL" } });
    await holder.shiftAssignment.create({ data: { employeeId: employees.minimal, shiftTemplateId: shift.id, effectiveFrom: day("2026-01-01"), weekdays: [] } });
    const summary = await m.prisma.$transaction((tx) => m.coverage.persistNoveltyCoverageWithin(tx, [novelty!.id], { protectedPeriods: "SKIP" }));
    expect(summary).toMatchObject({ droppedResolutions: 2, pendingReviewDays: 0 });
    expect(byDate(await coverageRows(novelty!.id)).get("2026-11-22")).toMatchObject({ outcome: "COVERED", reviewStatus: "NOT_REQUIRED", baseMinutes: 480, resolution: null });
  });

  it("resolución: entre 0 h y el valor del tipo, también en días sin cobertura automática; nota obligatoria y alcance del legajo", async () => {
    const [novelty] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.maternidadCover, fromDate: "2026-11-23", toDate: "2026-11-24" });
    const body = m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "CONFIRMED_ZERO", note: "No corresponde" });
    // §19: un día cubierto admite un ajuste hasta el valor del tipo, nunca más.
    await expect(m.novelties.resolveCoverageDay(novelty!.id, "2026-11-24", m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 540, note: "Nueve horas" }), as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED" });
    expect(await m.novelties.resolveCoverageDay(novelty!.id, "2026-11-24", body, as("rrhh"))).toMatchObject({ reviewStatus: "RESOLVED", resolution: "CONFIRMED_ZERO", effectiveBaseMinutes: 0 });
    // §18/§19: un día sin cobertura automática (sábado de una Maternidad L–V) admite hasta el valor del tipo, nunca más.
    const [weekend] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.maternidadCover, fromDate: "2026-11-28" });
    await expect(m.novelties.resolveCoverageDay(weekend!.id, "2026-11-28", m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 540, note: "Nueve horas" }), as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED" });
    expect(await m.novelties.resolveCoverageDay(weekend!.id, "2026-11-28", m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 240, note: "Medio sábado" }), as("rrhh"))).toMatchObject({ outcome: "WEEKDAY_NOT_INCLUDED", reviewStatus: "RESOLVED", effectiveBaseMinutes: 240 });
    await expect(m.novelties.resolveCoverageDay(novelty!.id, "2026-12-01", body, as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_DAY_NOT_FOUND" });
    await expect(m.novelties.resolveCoverageDay(novelty!.id, "2026-02-31", body, as("rrhh"))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(m.noveltySchemas.noveltyCoverageResolutionSchema.safeParse({ resolution: "CONFIRMED_ZERO", note: "" }).success).toBe(false);
    // Carga horaria sin el legajo asignado no lo ve.
    await expect(m.novelties.resolveCoverageDay(novelty!.id, "2026-11-23", body, as("carga"))).rejects.toMatchObject({ code: "NOVELTY_NOT_FOUND" });
    await expect(m.novelties.getCoverage(novelty!.id, as("carga"))).rejects.toMatchObject({ code: "NOVELTY_NOT_FOUND" });
  });

  it("relación laboral: antes del ALTA el día queda OUTSIDE_EMPLOYMENT (0 h confirmado)", async () => {
    const [novelty] = await create("rrhh", { employeeIds: [employees.late], noveltyTypeId: types.tramite, fromDate: "2026-11-16" });
    expect(await coverageRows(novelty!.id)).toEqual([expect.objectContaining({ outcome: "OUTSIDE_EMPLOYMENT", baseMinutes: 0, reviewStatus: "NOT_REQUIRED" })]);
  });

  it("Trámite bancario, Llegada tarde y Falta sin aviso", async () => {
    const [tramite] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.tramite, fromDate: "2026-11-19" });
    const [llegada] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.llegadaTarde, fromDate: "2026-11-19", quantityHours: 1 });
    const [falta] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.faltaSinAviso, fromDate: "2026-11-20" });
    expect(await coverageRows(tramite!.id)).toEqual([expect.objectContaining({ outcome: "COVERED", baseMinutes: 240, countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" })]);
    expect(await coverageRows(llegada!.id)).toEqual([expect.objectContaining({ outcome: "COVERED", baseMinutes: 60, countsTowardTotal: false, realWorkCompatibility: "COMPATIBLE" })]);
    expect(await coverageRows(falta!.id)).toEqual([expect.objectContaining({ outcome: "NO_COVERAGE", baseMinutes: 0, reviewStatus: "NOT_REQUIRED" })]);
  });

  it("Maternidad: feriado entre semana según la política configurada", async () => {
    const [cover] = await create("rrhh", { employeeIds: [employees.b], noveltyTypeId: types.maternidadCover, fromDate: "2026-11-18", toDate: "2026-11-18" });
    const [excluded] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.maternidadNoCoverage, fromDate: "2026-11-18", toDate: "2026-11-18" });
    expect(await coverageRows(cover!.id)).toEqual([expect.objectContaining({ outcome: "COVERED", baseMinutes: 480 })]);
    expect(await coverageRows(excluded!.id)).toEqual([expect.objectContaining({ outcome: "HOLIDAY_EXCLUDED", baseMinutes: 0 })]);
  });

  it("feriado con alcance sin historia laboral → 409 SPECIAL_HOUR_SCOPE_HISTORY_MISSING y no se crea nada", async () => {
    const before = await holder.novelty.count();
    await expect(create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.maternidadNoCoverage, fromDate: "2026-11-25", toDate: "2026-11-25" })).rejects.toMatchObject({
      statusCode: 409,
      code: "SPECIAL_HOUR_SCOPE_HISTORY_MISSING",
    });
    expect(await holder.novelty.count()).toBe(before);
  });

  // Etapa 8 (NOVELTY_COVERAGE_ENGINE.md §15.1): documentación obligatoria garantizada por el backend.
  it("documentación obligatoria: sin documento se rechaza; con documento crea novedad, archivo y vínculo; si el alta falla, no queda nada", async () => {
    const document = { fileName: "certificado.pdf", fileMimeType: "application/pdf", fileSizeBytes: 23, fileBase64: Buffer.from("%PDF-1.4\n%%EOF\n trailer").toString("base64") };
    const withDocument = (payload: Record<string, unknown>) => m.novelties.createWithDocument(m.noveltySchemas.createNoveltyWithDocumentSchema.parse({ ...payload, document }), as("rrhh"), { userId: users.rrhh } as never);
    const counts = async () => ({ novelties: await holder.novelty.count(), documents: await holder.employeeDocument.count(), files: await holder.storageFile.count({ where: { status: { not: "DELETED" } } }) });
    const before = await counts();

    await expect(create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.conCertificado, fromDate: "2026-11-16" })).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_DOCUMENTATION_REQUIRED" });
    expect(await counts()).toEqual(before);

    // El alta falla dentro de la transacción (feriado con alcance sin historia): el archivo ya subido se borra.
    await expect(withDocument({ employeeIds: [employees.a], noveltyTypeId: types.conCertificado, fromDate: "2026-11-25" })).rejects.toMatchObject({ code: "SPECIAL_HOUR_SCOPE_HISTORY_MISSING" });
    expect(await counts()).toEqual(before);

    const created = await withDocument({ employeeIds: [employees.a, employees.b], noveltyTypeId: types.conCertificado, fromDate: "2026-12-01" });
    expect(created).toHaveLength(2);
    const documents = await holder.employeeDocument.findMany({ where: { noveltyId: { in: created.map((item) => item.id) } }, include: { storageFile: true } });
    expect(documents).toHaveLength(2);
    for (const item of created) {
      const linked = documents.find((doc) => doc.noveltyId === item.id)!;
      expect(linked).toMatchObject({ employeeId: item.employeeId, fileName: "certificado.pdf", fileMimeType: "application/pdf", status: "VIGENTE" });
      expect(linked.storageFile).toMatchObject({ employeeId: item.employeeId, storageProvider: "LOCAL", status: "ACTIVE" });
    }
    // Limpieza del archivo local de prueba.
    const { storageService } = await import("../../shared/storage/storage.service");
    for (const doc of documents) await storageService.deleteManaged(doc.storageFileId!);
  });

  it("toDate nulo es exactamente un día (fromDate) para cualquier tipo, aunque admita rango; nunca un rango abierto", async () => {
    // Tipo sin tiempo que admite rango: una fila NO_COVERAGE, 0 minutos.
    const [none] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.licenciaAbierta, fromDate: "2026-11-01" });
    expect(await coverageRows(none!.id)).toEqual([expect.objectContaining({ date: day("2026-11-01"), outcome: "NO_COVERAGE", baseMinutes: 0, reviewStatus: "NOT_REQUIRED" })]);
    // Falta sin aviso (sin rango): una fila para su fecha.
    const [falta] = await create("rrhh", { employeeIds: [employees.b], noveltyTypeId: types.faltaSinAviso, fromDate: "2026-11-15" });
    expect(await coverageRows(falta!.id)).toEqual([expect.objectContaining({ date: day("2026-11-15"), outcome: "NO_COVERAGE", baseMinutes: 0 })]);
    // Vacaciones y Maternidad (admiten rango) sin fecha hasta: un único día.
    const [vacation] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.vacaciones, fromDate: "2026-11-30" });
    expect(await coverageRows(vacation!.id)).toEqual([expect.objectContaining({ date: day("2026-11-30"), outcome: "COVERED", baseMinutes: 480 })]);
    const [maternity] = await create("rrhh", { employeeIds: [employees.b], noveltyTypeId: types.maternidadCover, fromDate: "2026-12-07" });
    expect(await coverageRows(maternity!.id)).toEqual([expect.objectContaining({ date: day("2026-12-07"), outcome: "COVERED", baseMinutes: 480 })]);
    // fromDate = toDate también es un único día.
    const [same] = await create("rrhh", { employeeIds: [employees.b], noveltyTypeId: types.maternidadCover, fromDate: "2026-12-08", toDate: "2026-12-08" });
    expect(await coverageRows(same!.id)).toHaveLength(1);
  });

  it("rechazo elimina la cobertura derivada; la supervisión sólo aprueba dentro de su alcance", async () => {
    const [pending] = await create("sup", { employeeIds: [employees.a], noveltyTypeId: types.tramite, fromDate: "2026-11-26" });
    expect(pending!.status).toBe("PENDIENTE");
    expect(await coverageRows(pending!.id)).toHaveLength(1);
    await m.novelties.reject(pending!.id, { reason: "No corresponde" }, as("rrhh"));
    expect(await coverageRows(pending!.id)).toHaveLength(0);
    expect(await holder.novelty.findUniqueOrThrow({ where: { id: pending!.id } })).toMatchObject({ status: "RECHAZADO" });

    const [outside] = await create("rrhh", { employeeIds: [employees.b], noveltyTypeId: types.faltaSinAviso, fromDate: "2026-11-26" });
    await holder.novelty.update({ where: { id: outside!.id }, data: { status: "PENDIENTE" } });
    await expect(m.novelties.approve(outside!.id, as("sup"))).rejects.toMatchObject({ code: "NOVELTY_NOT_FOUND" });
    await expect(m.novelties.reject(outside!.id, { reason: "Fuera de alcance" }, as("sup"))).rejects.toMatchObject({ code: "NOVELTY_NOT_FOUND" });
  });

  it("aprobación masiva atómica: si una falla, no se aprueba ninguna", async () => {
    const [first] = await create("sup", { employeeIds: [employees.a], noveltyTypeId: types.tramite, fromDate: "2026-11-27" });
    const [second] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.faltaSinAviso, fromDate: "2026-11-27" });
    // second ya está APROBADO (lo cargó RRHH): el lote falla y first sigue pendiente.
    await expect(m.novelties.approveMany([first!.id, second!.id], as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_STATUS_NOT_APPROVABLE" });
    expect(await holder.novelty.findUniqueOrThrow({ where: { id: first!.id } })).toMatchObject({ status: "PENDIENTE" });
  });

  it("período ya enviado a cierre: supervisión → 409; RRHH sin motivo → 400; RRHH con motivo → corrige", async () => {
    await holder.monthlyTimeClosure.create({ data: { employeeId: employees.a, period: "2026-12", status: "ENVIADO" } });
    const payload = { employeeIds: [employees.a], noveltyTypeId: types.tramite, fromDate: "2026-12-01" };
    await expect(create("sup", payload)).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    await expect(create("rrhh", payload)).rejects.toMatchObject({ code: "NOVELTY_CORRECTION_REASON_REQUIRED" });
    const [corrected] = await create("rrhh", { ...payload, correctionReason: "Trámite informado tarde" });
    expect(await coverageRows(corrected!.id)).toHaveLength(1);

    // Un tipo sin tiempo no tiene nada que proteger.
    await expect(create("sup", { ...payload, noveltyTypeId: types.faltaSinAviso, fromDate: "2026-12-02" })).resolves.toHaveLength(1);
    // Borrar la corrección también exige motivo; el recálculo automático no toca el período protegido.
    await expect(m.novelties.remove(corrected!.id, as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_CORRECTION_REASON_REQUIRED" });
    const summary = await m.prisma.$transaction((tx) => m.coverage.persistNoveltyCoverageWithin(tx, [corrected!.id], { protectedPeriods: "SKIP" }));
    expect(summary.protectedPeriods).toEqual([{ employeeId: employees.a, period: "2026-12" }]);
    expect(summary.days).toBe(0);
    expect(await coverageRows(corrected!.id)).toHaveLength(1);
  });

  it("vista previa: mismos permisos que la carga y no escribe nada", async () => {
    const before = await holder.noveltyDayCoverage.count();
    await expect(
      m.novelties.previewCoverage(m.noveltySchemas.noveltyCoveragePreviewSchema.parse({ employeeIds: [employees.b], noveltyTypeId: types.tramite, fromDate: "2026-11-16" }), as("carga")),
    ).rejects.toMatchObject({ code: "EMPLOYEE_SCOPE_FORBIDDEN" });
    await m.novelties.previewCoverage(m.noveltySchemas.noveltyCoveragePreviewSchema.parse({ employeeIds: [employees.a], noveltyTypeId: types.vacaciones, fromDate: "2026-11-16", toDate: "2026-11-22" }), as("sup"));
    expect(await holder.noveltyDayCoverage.count()).toBe(before);
  });

  it("los datos de entrada inválidos se rechazan sin persistir", async () => {
    const count = await holder.novelty.count();
    await expect(create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.llegadaTarde, fromDate: "2026-11-16" })).rejects.toMatchObject({ code: "NOVELTY_MANUAL_QUANTITY_REQUIRED" });
    await expect(create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.vacaciones, fromDate: "2026-01-01", toDate: "2027-02-01" })).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_RANGE_TOO_LONG" });
    expect(await holder.novelty.count()).toBe(count);
    expect(Prisma).toBeDefined();
  });

  // §18: ajuste excepcional de un día ya calculado. Septiembre de 2027,
  // legajo 104 (turno L–V), feriado global el miércoles 15.
  it("§18/§19: tipo fijo 480 con feriado que no cuenta → RRHH ajusta ese día entre 0 y 480 (más se rechaza), el resto no cambia; el recálculo conserva el ajuste; restaurar vuelve a 0", async () => {
    const holiday = await holder.doubleHourRule.create({ data: { name: "Feriado septiembre", recurrenceType: "FECHA", fromDate: day("2027-09-15"), toDate: day("2027-09-15"), multiplier: 1, kind: "FERIADO", reason: "it" } });
    await holder.specialHourRuleDate.create({ data: { ruleId: holiday.id, date: day("2027-09-15") } });
    const fixedNoHoliday = await createType({ name: "Vacaciones 8 h sin feriados", kind: "VACACIONES", coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageDayRule: "EVERY_DAY", coverageOnDayOff: "COVER", coverageOnHoliday: "NO_COVERAGE", coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
    const [novelty] = await create("rrhh", { employeeIds: [employees.late], noveltyTypeId: fixedNoHoliday, fromDate: "2027-09-14", toDate: "2027-09-16" });
    const effective = async () => (await coverageRows(novelty!.id)).map((row) => row.resolvedBaseMinutes ?? row.baseMinutes);
    expect(byDate(await coverageRows(novelty!.id)).get("2027-09-15")).toMatchObject({ outcome: "HOLIDAY_EXCLUDED", baseMinutes: 0, reviewStatus: "NOT_REQUIRED" });
    expect(await effective()).toEqual([480, 0, 480]);

    const parse = (body: Record<string, unknown>) => m.noveltySchemas.noveltyCoverageResolutionSchema.parse(body);
    // Entre 0 y el valor del tipo; más se rechaza; la nota es obligatoria.
    await expect(m.novelties.resolveCoverageDay(novelty!.id, "2027-09-15", parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 600, note: "Diez horas" }), as("rrhh"))).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED" });
    await expect(m.novelties.resolveCoverageDay(novelty!.id, "2027-09-15", parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 481, note: "Un minuto de más" }), as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED" });
    // Valor parcial: 5 h se guardan, se ven en la grilla y sobreviven al recálculo.
    expect(await m.novelties.resolveCoverageDay(novelty!.id, "2027-09-15", parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 300, note: "Medio feriado de vacaciones" }), as("rrhh"))).toMatchObject({ reviewStatus: "RESOLVED", effectiveBaseMinutes: 300 });
    expect(await effective()).toEqual([480, 300, 480]);
    await m.prisma.$transaction((tx) => m.coverage.persistNoveltyCoverageWithin(tx, [novelty!.id], { protectedPeriods: "SKIP" }));
    expect(await effective()).toEqual([480, 300, 480]);
    expect(((await m.employees.getTimeGrid(employees.late, { period: "2027-09" } as never, as("rrhh"))) as { accounting: import("../time-entries/workedTimeAccounting").PeriodAccounting }).accounting.days["15"]).toMatchObject({ noveltyCoveredMinutes: 300 });
    expect(m.noveltySchemas.noveltyCoverageResolutionSchema.safeParse({ resolution: "SET_BASE_MINUTES", baseMinutes: 480, note: "" }).success).toBe(false);

    // El valor completo también se admite.
    const applied = await m.novelties.resolveCoverageDay(novelty!.id, "2027-09-15", parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 480, note: "Vacaciones acordadas incluyendo el feriado" }), as("rrhh"));
    expect(applied).toMatchObject({ outcome: "HOLIDAY_EXCLUDED", reviewStatus: "RESOLVED", resolution: "SET_BASE_MINUTES", effectiveBaseMinutes: 480 });
    expect(await effective()).toEqual([480, 480, 480]);
    const audit = await holder.auditLog.findFirst({ where: { entity: "Novelty", entityId: novelty!.id }, orderBy: { createdAt: "desc" } });
    expect(audit?.description).toMatch(/15\/09\/2027: 8 h base\. Nota: Vacaciones acordadas incluyendo el feriado/);
    const grid = (await m.employees.getTimeGrid(employees.late, { period: "2027-09" } as never, as("rrhh"))) as { accounting: import("../time-entries/workedTimeAccounting").PeriodAccounting };
    expect(grid.accounting.days["15"]).toMatchObject({ noveltyCoveredMinutes: 480, computableMinutes: 480 });
    expect(grid.accounting.novelty.reviewDays).toBe(0);

    // Un recálculo (por ejemplo, al cambiar la regla de feriados) conserva el ajuste.
    await m.prisma.$transaction((tx) => m.coverage.persistNoveltyCoverageWithin(tx, [novelty!.id], { protectedPeriods: "SKIP" }));
    expect(byDate(await coverageRows(novelty!.id)).get("2027-09-15")).toMatchObject({ reviewStatus: "RESOLVED", resolvedBaseMinutes: 480, resolutionNote: "Vacaciones acordadas incluyendo el feriado" });

    // Restaurar vuelve a la regla del tipo (feriado: no cuenta).
    expect(await m.novelties.resolveCoverageDay(novelty!.id, "2027-09-15", parse({ resolution: "RESTORE_AUTOMATIC", note: "Se vuelve a la regla del tipo" }), as("rrhh"))).toMatchObject({ outcome: "HOLIDAY_EXCLUDED", reviewStatus: "NOT_REQUIRED", resolution: null, effectiveBaseMinutes: 0 });
    expect(await effective()).toEqual([480, 0, 480]);

    // Con trabajo real ese día, una novedad incompatible no puede sumar horas.
    await holder.timeEntry.create({ data: { employeeId: employees.late, hourConceptId: normalConceptId, date: day("2027-09-15"), period: "2027-09", day: 15, hours: 8, totalMinutes: 480, status: "APROBADO" } });
    await expect(m.novelties.resolveCoverageDay(novelty!.id, "2027-09-15", parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 480, note: "Vacaciones en feriado" }), as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED" });
  });

  it("§19: el rango del ajuste sale del modo — manual hasta la cantidad cargada, según jornada hasta la jornada conocida, NONE sin cobertura", async () => {
    const parse = (body: Record<string, unknown>) => m.noveltySchemas.noveltyCoverageResolutionSchema.parse(body);
    // MANUAL_MINUTES: Llegada tarde de 1 h → 0..60.
    const [late] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.llegadaTarde, fromDate: "2027-10-04", quantityHours: 1 });
    await expect(m.novelties.resolveCoverageDay(late!.id, "2027-10-04", parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 90, note: "Hora y media" }), as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED" });
    expect(await m.novelties.resolveCoverageDay(late!.id, "2027-10-04", parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 30, note: "Media hora" }), as("rrhh"))).toMatchObject({ effectiveBaseMinutes: 30 });
    // EXPECTED_SCHEDULE con jornada conocida (turno L–V de 8 h) → 0..480.
    const [byShift] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.vacacionesJornada, fromDate: "2027-10-05" });
    await expect(m.novelties.resolveCoverageDay(byShift!.id, "2027-10-05", parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 540, note: "Nueve horas" }), as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED" });
    expect(await m.novelties.resolveCoverageDay(byShift!.id, "2027-10-05", parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 240, note: "Medio día" }), as("rrhh"))).toMatchObject({ effectiveBaseMinutes: 240 });
    expect(await m.novelties.resolveCoverageDay(byShift!.id, "2027-10-05", parse({ resolution: "RESTORE_AUTOMATIC", note: "Vuelve a la jornada" }), as("rrhh"))).toMatchObject({ reviewStatus: "NOT_REQUIRED", effectiveBaseMinutes: 480 });
    // NONE: Falta sin aviso no tiene cobertura que ajustar.
    const [falta] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.faltaSinAviso, fromDate: "2027-10-06" });
    await expect(m.novelties.resolveCoverageDay(falta!.id, "2027-10-06", parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 60, note: "Una hora" }), as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_DAY_NOT_IN_REVIEW" });
  });

  // ── Etapa 4: contabilidad con cobertura (febrero de 2027, aislado) ───────
  describe("etapa 4 — contabilidad, grillas, resumen, export y cierre con cobertura", () => {
    const worked = (employeeId: string, dateKey: string, hours: number) =>
      holder.timeEntry.create({
        data: {
          employeeId,
          hourConceptId: normalConceptId,
          date: day(dateKey),
          period: dateKey.slice(0, 7),
          day: Number(dateKey.slice(8, 10)),
          hours,
          totalMinutes: hours * 60,
          status: "APROBADO",
        },
      });
    const gridOf = (employeeId: string, includeDetails = false) =>
      m.employees.getTimeGrid(employeeId, { period: "2027-02", includeDetails } as never, as("rrhh")) as Promise<Record<string, unknown> & {
        accounting: import("../time-entries/workedTimeAccounting").PeriodAccounting;
        noveltyCoverageRows: Array<{ noveltyType: { name: string }; minutesByDay: Record<string, number>; stateByDay: Record<string, string> }>;
        noveltiesByDay: Record<string, Array<{ label: string; state: string; minutes: number }>>;
        novelties: Array<{ id: string }>;
      }>;
    let tramiteConflictId = "";

    beforeAll(async () => {
      // A (turno L–V): lunes 8 trabajó 8 h + Trámite (conflicto); martes 9
      // trabajó 7 h + Llegada tarde 1 h; miércoles 10 Trámite sin trabajo +
      // Llegada tarde 1 h; jueves 11 Trámite PENDIENTE; viernes 12 Falta sin
      // aviso sin trabajo. B (turno todos los días): Vacaciones 1–7 (domingo ×2).
      await worked(employees.a, "2027-02-08", 8);
      await worked(employees.a, "2027-02-09", 7);
      tramiteConflictId = (await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.tramite, fromDate: "2027-02-08" }))[0]!.id;
      await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.llegadaTarde, fromDate: "2027-02-09", quantityHours: 1 });
      await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.tramite, fromDate: "2027-02-10" });
      await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.llegadaTarde, fromDate: "2027-02-10", quantityHours: 1 });
      await create("sup", { employeeIds: [employees.a], noveltyTypeId: types.tramite, fromDate: "2027-02-11" });
      await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.faltaSinAviso, fromDate: "2027-02-12" });
      await create("rrhh", { employeeIds: [employees.b], noveltyTypeId: types.vacaciones, fromDate: "2027-02-01", toDate: "2027-02-07" });
      // Un tipo sin tiempo que admite rango, cargado en enero sin fecha hasta: es un día de enero.
      await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.licenciaAbierta, fromDate: "2027-01-20" });
    });

    it("grilla por legajo: trabajado real, cobertura que cuenta, computable, estados y filas por tipo", async () => {
      const grid = await gridOf(employees.a, true);
      expect(grid.accounting).toMatchObject({ totalWorkedMinutes: 900, noveltyCoveredMinutes: 240, computableMinutes: 1140 });
      expect(grid).toMatchObject({ totalWorkedMinutes: 900, noveltyCoveredMinutes: 240, computableMinutes: 1140 });
      expect(grid.accounting.novelty).toMatchObject({ heldMinutes: 240, pendingApprovalMinutes: 240, informativeMinutes: 120, reviewDays: 1, reviewDates: ["2027-02-08"] });
      expect(grid.accounting.days["8"]).toMatchObject({ totalWorkedMinutes: 480, computableMinutes: 480 });
      expect(grid.noveltiesByDay["8"]).toEqual([expect.objectContaining({ label: "Trámite bancario", state: "REVIEW_REQUIRED", minutes: 240 })]);
      // Dos tipos el mismo día: Trámite cuenta y Llegada tarde informa.
      expect(grid.noveltiesByDay["10"]).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: "Trámite bancario", state: "COUNTED" }), expect.objectContaining({ label: "Llegada tarde", state: "INFORMATIVE", minutes: 60 })]),
      );
      const tramiteRow = grid.noveltyCoverageRows.find((row) => row.noveltyType.name === "Trámite bancario")!;
      expect(tramiteRow.minutesByDay).toEqual({ "8": 240, "10": 240, "11": 240 });
      expect(tramiteRow.stateByDay).toEqual({ "8": "REVIEW_REQUIRED", "10": "COUNTED", "11": "PENDING_APPROVAL" });
      expect(grid.noveltyCoverageRows.map((row) => row.noveltyType.name)).toEqual(["Falta sin aviso", "Llegada tarde", "Trámite bancario"]);
      // toDate nulo es un día: la novedad del 20/01 no aparece en febrero.
      expect(grid.novelties.map((novelty) => novelty.id)).not.toContain((await holder.novelty.findFirstOrThrow({ where: { employeeId: employees.a, fromDate: day("2027-01-20") } })).id);
    });

    it("vacaciones: el domingo ×2 suma 8 h computables y 16 h para liquidación (nunca 16 h trabajadas)", async () => {
      const grid = await gridOf(employees.b);
      expect(grid.accounting).toMatchObject({ totalWorkedMinutes: 0, noveltyCoveredMinutes: 3360, computableMinutes: 3360, hasSpecialMultiplier: true });
      expect(grid.accounting.settlement).toMatchObject({ noveltyMinutes: 3840, totalMinutes: 3840 });
      expect(grid.accounting.days["7"]).toMatchObject({ totalWorkedMinutes: 0, computableMinutes: 480, settlement: expect.objectContaining({ noveltyMinutes: 960 }) });
    });

    it("grilla de período: cada día trae trabajado, cubierto, computable y las novedades con estado", async () => {
      const result = await m.timeEntriesRepository.findPeriodEmployees({ period: "2027-02", page: 1, take: 50 } as never, {});
      const rowA = result.items.find((item) => item.employee.id === employees.a)!;
      const dayOf = (day: number) => rowA.summary.dailyBreakdown.find((item) => item.day === day);
      expect(dayOf(10)).toMatchObject({ totalWorkedMinutes: 0, noveltyCoveredMinutes: 240, computableMinutes: 240 });
      expect(dayOf(8)).toMatchObject({ totalWorkedMinutes: 480, noveltyCoveredMinutes: 0, computableMinutes: 480, novelties: [expect.objectContaining({ reviewRequired: true })] });
      expect(dayOf(12)!.novelties).toEqual([expect.objectContaining({ label: "Falta sin aviso", minutes: 0, state: "INFORMATIVE" })]);
      expect(rowA.summary.accounting).toMatchObject({ computableMinutes: 1140 });
      // La novedad de enero sin fecha hasta no marca ningún día de febrero.
      expect(rowA.summary.dailyBreakdown.some((item) => item.novelty?.label === "Licencia abierta")).toBe(false);
    });

    it("resumen: \"Total trabajado\" sigue siendo trabajo real; cubierto y computable van aparte", async () => {
      const summary = await m.timeEntriesRepository.summary("2027-02", {});
      expect(summary).toMatchObject({ countableHours: 15, coveredHours: 60, computableHours: 75 });
    });

    it("export de horas: columnas de cobertura y quien sólo tiene vacaciones también se exporta", async () => {
      const result = await m.timeEntries.exportByPerson({ period: "2027-02", includeInReview: true } as never, as("rrhh"));
      const keys = result.columns.map((column) => column.key);
      expect(keys).toEqual(expect.arrayContaining(["Total trabajado", "Cubierto por novedades", "Total computable", "Novedades (para liquidación)", "Equivalencia para liquidación"]));
      expect(keys.indexOf("Cubierto por novedades")).toBe(keys.indexOf("Total trabajado") + 1);
      const rowB = result.rows.find((row) => row.Legajo === "102")!;
      expect(rowB).toBeDefined();
      expect(Number(rowB["Total trabajado"]!.replace(",", "."))).toBe(0);
      expect(Number(rowB["Cubierto por novedades"]!.replace(",", "."))).toBe(56);
      expect(Number(rowB["Equivalencia para liquidación"]!.replace(",", "."))).toBe(64);
    });

    it("Falta sin aviso (NONE + INCOMPATIBLE) con trabajo real: revisión administrativa sin minutos que resolver", async () => {
      // Marzo, legajo B: aislado de los totales de febrero.
      await worked(employees.b, "2027-03-03", 8);
      // Etapa 8: la vista previa anticipa la revisión con la misma contabilidad, sin escribir.
      const preview = await m.novelties.previewCoverage(m.noveltySchemas.noveltyCoveragePreviewSchema.parse({ employeeIds: [employees.b], noveltyTypeId: types.faltaSinAviso, fromDate: "2027-03-03" }), as("rrhh"));
      expect(preview.initialStatus).toBe("APROBADO");
      expect(preview.employees[0]!.days).toEqual([expect.objectContaining({ date: "2027-03-03", workedMinutes: 480, stateWhenApproved: "REVIEW_REQUIRED", reviewReasons: ["REAL_WORK_ON_INCOMPATIBLE"] })]);
      // Rango que cruza de mes: el trabajo real cae en su fecha exacta (la contabilidad indexa por día del mes).
      const crossMonth = await m.novelties.previewCoverage(m.noveltySchemas.noveltyCoveragePreviewSchema.parse({ employeeIds: [employees.b], noveltyTypeId: types.vacaciones, fromDate: "2027-02-27", toDate: "2027-03-04" }), as("rrhh"));
      const crossDays = new Map(crossMonth.employees[0]!.days.map((item) => [item.date, item]));
      expect(crossDays.get("2027-03-03")).toMatchObject({ workedMinutes: 480, stateWhenApproved: "REVIEW_REQUIRED", reviewReasons: ["REAL_WORK_ON_INCOMPATIBLE"] });
      expect(crossDays.get("2027-03-04")).toMatchObject({ workedMinutes: 0 });
      expect(await holder.noveltyDayCoverage.count({ where: { employeeId: employees.b, date: { gte: new Date("2027-02-27"), lte: new Date("2027-03-04") } } })).toBe(0);
      const [falta] = await create("rrhh", { employeeIds: [employees.b], noveltyTypeId: types.faltaSinAviso, fromDate: "2027-03-03" });
      const marchGrid = () => m.employees.getTimeGrid(employees.b, { period: "2027-03" } as never, as("rrhh")) as Promise<{ accounting: import("../time-entries/workedTimeAccounting").PeriodAccounting }>;
      const { accounting } = await marchGrid();
      expect(accounting.days["3"]).toMatchObject({ totalWorkedMinutes: 480, noveltyCoveredMinutes: 0, computableMinutes: 480 });
      expect(accounting.days["3"]!.settlement).toMatchObject({ noveltyMinutes: 0 });
      expect(accounting.days["3"]!.novelty.items).toEqual([expect.objectContaining({ state: "REVIEW_REQUIRED", reviewReasons: ["REAL_WORK_ON_INCOMPATIBLE"], baseMinutes: 0 })]);
      expect(accounting.novelty).toMatchObject({ heldMinutes: 0, reviewDays: 1, reviewDates: ["2027-03-03"] });
      // No hay cobertura que indicar ni que confirmar en 0: la salida es corregir el trabajo o quitar la novedad.
      for (const body of [
        { resolution: "SET_BASE_MINUTES", baseMinutes: 480, note: "Indicar horas" },
        { resolution: "CONFIRMED_ZERO", note: "Confirmar 0" },
      ]) {
        await expect(m.novelties.resolveCoverageDay(falta!.id, "2027-03-03", m.noveltySchemas.noveltyCoverageResolutionSchema.parse(body), as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_DAY_NOT_IN_REVIEW" });
      }
      await m.novelties.remove(falta!.id, as("rrhh"));
      expect((await marchGrid()).accounting.novelty).toMatchObject({ reviewDays: 0 });
    });

    it("cierre: rechaza el envío con días en revisión; resolver el conflicto (\"no cubre este día\") lo permite y congela el snapshot V2", async () => {
      await expect(m.workforce.submitClosures("2027-02", [employees.a], as("sup"))).rejects.toMatchObject({
        statusCode: 409,
        code: "CLOSURE_HAS_PENDING_NOVELTY_REVIEW",
        details: { employees: [expect.objectContaining({ employeeId: employees.a, reviewDays: 1, reviewDates: ["2027-02-08"] })] },
      });
      // En un tipo incompatible no se puede "sumar ambas": sólo "no cubre este día".
      const setBase = m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 240, note: "Sumar ambas" });
      await expect(m.novelties.resolveCoverageDay(tramiteConflictId, "2027-02-08", setBase, as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED" });
      const zero = m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "CONFIRMED_ZERO", note: "Trabajó: el trámite no corresponde" });
      await m.novelties.resolveCoverageDay(tramiteConflictId, "2027-02-08", zero, as("rrhh"));

      const [closure] = await m.workforce.submitClosures("2027-02", [employees.a], as("sup"));
      const snapshot = closure!.snapshot as { accounting: { model: string; totalWorkedMinutes: number; noveltyCoveredMinutes: number; computableMinutes: number; novelty: { reviewDays: number; types: Array<{ name: string }> } } };
      expect(closure).toMatchObject({ status: "ENVIADO" });
      expect(snapshot.accounting).toMatchObject({ model: "WORKED_TIME_ACCOUNTING_V2", totalWorkedMinutes: 900, noveltyCoveredMinutes: 240, computableMinutes: 1140, novelty: expect.objectContaining({ reviewDays: 0 }) });
      expect(snapshot.accounting.novelty.types.map((type) => type.name)).toEqual(expect.arrayContaining(["Trámite bancario", "Llegada tarde"]));
    });

    // Etapa 9 (NOVELTY_COVERAGE_ENGINE.md §16): Finnegans lee la cobertura diaria
    // con la contabilidad real. Abril–mayo de 2027, legajo B (turno todos los días).
    it("Finnegans: horas base por mes desde la cobertura, sin multiplicador; revisión bloquea; la resolución manual cuenta", async () => {
      const { finnegansExportService } = await import("../finnegans-export/finnegansExport.service");
      const vacacionesFinnegans = await createType({
        name: "Vacaciones Finnegans", kind: "VACACIONES", exportsToFinnegans: true, finnegansCode: "VACF", finnegansName: "Vacaciones", finnegansValueUnit: "HOURS",
        coverageMode: "EXPECTED_SCHEDULE", coverageDayRule: "WORK_OBLIGATION", coverageAppliesSpecialHours: true, coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE",
      });
      // Jueves 29/04 a domingo 02/05: el domingo es ×2 en la liquidación interna.
      const [vacation] = await create("rrhh", { employeeIds: [employees.b], noveltyTypeId: vacacionesFinnegans, fromDate: "2027-04-29", toDate: "2027-05-02" });
      const rowFor = async (period: string) => (await finnegansExportService.getPreview({ period })).rows.find((row) => row.sourceId === vacation!.id);

      expect(await rowFor("2027-04")).toMatchObject({ Novedad: "VACF", "Valor 1": "16", "Fecha Aplicación": "29/04/2027", estado: "CIERRE_PENDIENTE" });
      // Mayo: sábado 8 h + domingo 8 h base (nunca 24 h con el ×2).
      expect(await rowFor("2027-05")).toMatchObject({ "Valor 1": "16", "Fecha Aplicación": "01/05/2027" });

      // Trabajo real el 30/04 en un tipo incompatible: abril queda en revisión y no exporta horas.
      await worked(employees.b, "2027-04-30", 8);
      const april = await finnegansExportService.getPreview({ period: "2027-04" });
      expect(april.rows.find((row) => row.sourceId === vacation!.id)).toMatchObject({ "Valor 1": "", estado: "REVISION_PENDIENTE" });
      expect(april.readiness.reasons).toContain("1 día de novedades pendiente de revisión");

      // "No cubre este día": la base efectiva de ese día pasa a 0 y abril exporta sólo el 29.
      const zero = m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "CONFIRMED_ZERO", note: "Trabajó ese día" });
      await m.novelties.resolveCoverageDay(vacation!.id, "2027-04-30", zero, as("rrhh"));
      expect(await rowFor("2027-04")).toMatchObject({ "Valor 1": "8", estado: "CIERRE_PENDIENTE" });
      // Mismos datos, mismo resultado.
      expect(await finnegansExportService.getPreview({ period: "2027-04" })).toEqual(await finnegansExportService.getPreview({ period: "2027-04" }));
    });

    // Reproducibilidad (§16.1/§16.2): la configuración de Finnegans se congela
    // con el snapshot del cierre; una versión generada guarda sus filas.
    it("Finnegans: el cierre congela la configuración; la primera exportación posterior a un cambio del Tipo usa la del cierre", async () => {
      const { finnegansExportService } = await import("../finnegans-export/finnegansExport.service");
      const tramiteFinnegans = await createType({
        name: "Trámite Finnegans", exportsToFinnegans: true, finnegansCode: "TBF", finnegansName: "Trámite", finnegansValueUnit: "HOURS", allowsDateRange: false,
        coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 240, coverageOnDayOff: "NO_COVERAGE", coverageOnHoliday: "NO_COVERAGE", coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE",
      });
      const closeAndApprove = async (period: string) => {
        const [closure] = await m.workforce.submitClosures(period, [employees.a], as("sup"));
        await m.workforce.approveClosures([closure!.id], undefined, as("rrhh"));
        return closure!;
      };
      const visible = (rows: Array<Record<string, unknown>>) => rows.map(({ estado: _estado, sourceId: _sourceId, employeeId: _employeeId, ...cells }) => cells);

      // Junio: TBF en horas, cierre aprobado. Después el tipo cambia a NUEVO en días.
      await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: tramiteFinnegans, fromDate: "2027-06-14" });
      const june = await closeAndApprove("2027-06");
      expect((await holder.monthlyTimeClosure.findUniqueOrThrow({ where: { id: june.id } })).snapshot).toMatchObject({
        finnegans: { model: "FINNEGANS_CONFIG_V1", types: [expect.objectContaining({ noveltyTypeId: tramiteFinnegans, finnegansCode: "TBF", finnegansValueUnit: "HOURS", name: "Trámite Finnegans" })] },
      });
      await m.types.update(tramiteFinnegans, m.typeSchemas.updateNoveltyTypeSchema.parse({ finnegansCode: "NUEVO", finnegansValueUnit: "DAYS", name: "Trámite renombrado" }));

      // Primera exportación de junio, ya con el tipo cambiado: sale con la configuración del cierre.
      const junePreview = await finnegansExportService.getPreview({ period: "2027-06" });
      const idempotencyKey = randomUUID();
      const first = await finnegansExportService.exportDefinitive({ period: "2027-06", format: "CSV", idempotencyKey });
      expect(first.rows).toEqual([expect.objectContaining({ Novedad: "TBF", "Valor 1": "4", "Fecha Aplicación": "14/06/2027", detail: "Trámite Finnegans" })]);
      expect(visible(junePreview.rows)).toEqual(visible(first.rows));

      // La versión generada no cambia: reintento, historial y vista previa coinciden.
      const retry = await finnegansExportService.exportDefinitive({ period: "2027-06", format: "CSV", idempotencyKey });
      const detail = await finnegansExportService.getHistoryDetail(first.batch.id);
      expect(retry.batch).toMatchObject({ id: first.batch.id, version: 1 });
      expect(visible(retry.rows)).toEqual(visible(first.rows));
      expect(visible(detail.rows)).toEqual(visible(first.rows));
      expect((await finnegansExportService.getHistory({ period: "2027-06" })).batches).toHaveLength(1);
      expect((await finnegansExportService.getPreview({ period: "2027-06" })).lastExport).toMatchObject({ version: 1, sameAsCurrent: true });

      // Julio: el cierre nuevo congela la configuración nueva.
      await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: tramiteFinnegans, fromDate: "2027-07-12" });
      await closeAndApprove("2027-07");
      const july = await finnegansExportService.exportDefinitive({ period: "2027-07", format: "CSV", idempotencyKey: randomUUID() });
      expect(july.rows).toEqual([expect.objectContaining({ Novedad: "NUEVO", "Valor 1": "1", "Fecha Aplicación": "12/07/2027", detail: "Trámite renombrado" })]);

      // Un snapshot histórico sin configuración congelada usa el tipo vigente (comportamiento anterior).
      const legacySnapshot = { ...((await holder.monthlyTimeClosure.findUniqueOrThrow({ where: { id: june.id } })).snapshot as Record<string, unknown>) };
      delete legacySnapshot.finnegans;
      await holder.monthlyTimeClosure.update({ where: { id: june.id }, data: { snapshot: legacySnapshot as never } });
      const fallback = await finnegansExportService.getPreview({ period: "2027-06" });
      expect(fallback.rows).toEqual([expect.objectContaining({ Novedad: "NUEVO", "Valor 1": "1" })]);
      expect(fallback.lastExport).toMatchObject({ version: 1, sameAsCurrent: false });
      // Y aun así la versión 1 ya generada no cambia.
      expect(visible((await finnegansExportService.getHistoryDetail(first.batch.id)).rows)).toEqual(visible(first.rows));
    });

    // P5 (NOVELTY_COVERAGE_ENGINE.md §12.3): coberturas de tipos distintos el
    // mismo día que, sumadas, superan la jornada esperada. Agosto de 2027,
    // legajo A (turno L–V de 8 h): aislado de los demás casos.
    it("P5: Vacaciones + Trámite por encima de la jornada → revisión en grilla, cierre y Finnegans; confirmar 0 o quitar la novedad lo resuelve", async () => {
      const { finnegansExportService } = await import("../finnegans-export/finnegansExport.service");
      const vacacionesP5 = await createType({
        name: "Vacaciones P5", kind: "VACACIONES", exportsToFinnegans: true, finnegansCode: "VP5", finnegansName: "Vacaciones", finnegansValueUnit: "HOURS",
        coverageMode: "EXPECTED_SCHEDULE", coverageDayRule: "WORK_OBLIGATION", coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE",
      });
      const tramiteP5 = await createType({
        name: "Trámite P5", exportsToFinnegans: true, finnegansCode: "TP5", finnegansName: "Trámite", finnegansValueUnit: "HOURS", allowsDateRange: false,
        coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 180, coverageOnDayOff: "NO_COVERAGE", coverageOnHoliday: "NO_COVERAGE", coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE",
      });
      const grid = async () => ((await m.employees.getTimeGrid(employees.a, { period: "2027-08" } as never, as("rrhh"))) as { accounting: import("../time-entries/workedTimeAccounting").PeriodAccounting }).accounting;
      // Lunes 2 y martes 3: Vacaciones 8 h + Trámite (3 h exportable el 2; 4 h no exportable el 3).
      await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: vacacionesP5, fromDate: "2027-08-02", toDate: "2027-08-03" });
      const [tramite2] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: tramiteP5, fromDate: "2027-08-02" });
      const [tramite3] = await create("rrhh", { employeeIds: [employees.a], noveltyTypeId: types.tramite, fromDate: "2027-08-03" });

      // Grilla: nunca 11 h; el día computa sólo lo válido (0 h de trabajo) y queda para revisar.
      const before = await grid();
      expect(before.days["2"]).toMatchObject({ totalWorkedMinutes: 0, noveltyCoveredMinutes: 0, computableMinutes: 0 });
      expect(before.days["2"]!.novelty).toMatchObject({ reviewRequired: true, heldMinutes: 660 });
      expect(before.days["2"]!.novelty.items.map((item) => item.reviewReasons)).toEqual([["COVERAGE_TOTAL_EXCEEDS_EXPECTED"], ["COVERAGE_TOTAL_EXCEEDS_EXPECTED"]]);
      expect(before.novelty).toMatchObject({ reviewDays: 2, reviewDates: ["2027-08-02", "2027-08-03"] });

      // Cierre y Finnegans bloqueados.
      await expect(m.workforce.submitClosures("2027-08", [employees.a], as("sup"))).rejects.toMatchObject({ code: "CLOSURE_HAS_PENDING_NOVELTY_REVIEW" });
      const preview = await finnegansExportService.getPreview({ period: "2027-08" });
      expect(preview.rows.filter((row) => ["VP5", "TP5"].includes(row.Novedad)).map((row) => [row.Novedad, row["Valor 1"], row.estado])).toEqual(
        expect.arrayContaining([["VP5", "", "REVISION_PENDIENTE"], ["TP5", "", "REVISION_PENDIENTE"]]),
      );
      await expect(finnegansExportService.exportDefinitive({ period: "2027-08", format: "CSV", idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FINNEGANS_EXPORT_COVERAGE_REVIEW_PENDING" });

      // No se acepta un total mayor a la jornada: sólo "no cubre este día".
      const setBase = m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "SET_BASE_MINUTES", baseMinutes: 60, note: "Aceptar una parte" });
      await expect(m.novelties.resolveCoverageDay(tramite2!.id, "2027-08-02", setBase, as("rrhh"))).rejects.toMatchObject({ code: "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED" });
      const zero = m.noveltySchemas.noveltyCoverageResolutionSchema.parse({ resolution: "CONFIRMED_ZERO", note: "El trámite se hizo fuera del horario" });
      await m.novelties.resolveCoverageDay(tramite2!.id, "2027-08-02", zero, as("rrhh"));
      // Quitar la novedad incorrecta (no exportable) resuelve el otro día.
      await m.novelties.remove(tramite3!.id, as("rrhh"));

      const after = await grid();
      expect(after.days["2"]).toMatchObject({ noveltyCoveredMinutes: 480, computableMinutes: 480 });
      expect(after.days["3"]).toMatchObject({ noveltyCoveredMinutes: 480, computableMinutes: 480 });
      expect(after.novelty).toMatchObject({ reviewDays: 0, heldMinutes: 0 });
      const [closure] = await m.workforce.submitClosures("2027-08", [employees.a], as("sup"));
      await m.workforce.approveClosures([closure!.id], undefined, as("rrhh"));
      const exported = await finnegansExportService.exportDefinitive({ period: "2027-08", format: "CSV", idempotencyKey: randomUUID() });
      expect(exported.rows.filter((row) => row.Legajo === "101").map((row) => [row.Novedad, row["Valor 1"]])).toEqual([["VP5", "16"]]);
    });
  });
});
