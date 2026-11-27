/**
 * R4.3b (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.5) contra PostgreSQL REAL: obligación,
 * falta de ingreso por bloque (intradía y catch-up), resolución por bloque, exclusión de
 * SIN_ACTIVIDAD_REGISTRADA, reconciliación con incidentes de día, avisos internos idempotentes y
 * jornada esperada de Novedades, con la grilla REAL de Planta (plantaRotation.fixture.ts) cargada
 * en las tablas de R4.1/R4.1A y la unicidad por bloque de R4.3a.
 *
 * Opt-in: sólo corre con `ROTATION_ATTENDANCE_IT_DATABASE_URL` → `localhost`, base `clock_it*`
 * PROPIA con el schema de este commit (migraciones aplicadas desde cero, nunca `db push`). VACÍA
 * la base al empezar. Nunca usa el DATABASE_URL del .env y verifica `current_database()`.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PLANTA_ANCHOR, PLANTA_CREWS, PLANTA_EMPLOYEES, PLANTA_TEMPLATES, plantaDays } from "../shifts/plantaRotation.fixture";

const url = process.env.ROTATION_ATTENDANCE_IT_DATABASE_URL;

type Modules = {
  prisma: typeof import("../../shared/prisma/client").prisma;
  missing: typeof import("./missingEntry.service");
  inactivity: typeof import("./attendanceInactivity.service");
  workObligation: typeof import("../shifts/workObligation.service");
  workday: typeof import("../shifts/expectedWorkday");
  datetime: typeof import("../../shared/datetime/argentinaTime");
};

/** Instante ART (UTC−3, sin horario de verano). */
// R4.9C.2 O2: admite segundos ("07:10:30") para las fronteras de vencimiento.
const at = (dateKey: string, time: string) => new Date(`${dateKey}T${time.length === 5 ? `${time}:00` : time}-03:00`);
const day = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

// Semana A: lunes 02/11/2026 (ancla). Semana B: lunes 09/11/2026.
const FRI_A = "2026-11-06"; // José: 07–11 + 19–07
const SAT_A = "2026-11-07"; // José: 19–07
const FRI_B = "2026-11-13"; // Juanchi: 19–07
const SAT_B = "2026-11-14"; // Juanchi: 19–07

describe.skipIf(!url)("R4.3b — asistencia por bloque de rotación contra PostgreSQL local", () => {
  let m: Modules;
  let holder: PrismaClient;
  const employee: Record<string, string> = {};
  const templateId: Record<string, string> = {};
  let rrhhId: string;

  const jose = () => employee[PLANTA_EMPLOYEES.JOSE]!;
  const juanchi = () => employee[PLANTA_EMPLOYEES.JUANCHI]!;
  const juanjo = () => employee[PLANTA_EMPLOYEES.JUANJO]!;

  const incidentsOf = (employeeId: string, dateKey: string) =>
    holder.attendanceInactivityIncident.findMany({ where: { employeeId, operationalDate: day(dateKey) }, orderBy: [{ scheduledStartAt: "asc" }] });
  const noticesOf = async (employeeId: string, dateKey?: string) => {
    const incidents = await holder.attendanceInactivityIncident.findMany({ where: { employeeId, ...(dateKey ? { operationalDate: day(dateKey) } : {}) }, select: { id: true } });
    return holder.systemNotification.findMany({ where: { entityType: "AttendanceInactivityIncident", entityId: { in: incidents.map((incident) => incident.id) } } });
  };
  const punchIn = (employeeId: string, timestamp: Date) => holder.attendancePunch.create({ data: { employeeId, type: "INGRESO", timestamp } });
  const starts = (rows: Array<{ scheduledStartAt: Date | null }>) => rows.map((row) => row.scheduledStartAt?.toISOString() ?? null);

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("ROTATION_ATTENDANCE_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ prisma }, missing, inactivity, workObligation, workday, datetime] = await Promise.all([
      import("../../shared/prisma/client"),
      import("./missingEntry.service"),
      import("./attendanceInactivity.service"),
      import("../shifts/workObligation.service"),
      import("../shifts/expectedWorkday"),
      import("../../shared/datetime/argentinaTime"),
    ]);
    m = { prisma, missing, inactivity, workObligation, workday, datetime };
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);

    rrhhId = (await holder.user.create({ data: { name: "RRHH IT", email: "rrhh-rotation@example.com", passwordHash: "x", role: "NIVEL_1_RRHH" } })).id;
    for (const [index, key] of Object.values(PLANTA_EMPLOYEES).entries()) {
      const created = await holder.employee.create({ data: { legajo: `RT-${index + 1}`, cuil: `20-8${index + 1}`, dni: `8${index + 1}`, firstName: "Prueba", lastName: key.replace("emp-", "") } });
      employee[key] = created.id;
    }
    for (const template of Object.values(PLANTA_TEMPLATES)) {
      const created = await holder.shiftTemplate.create({
        data: { code: template.code, name: template.code, startTime: template.startTime, endTime: template.endTime, crossesMidnight: template.crossesMidnight, entryToleranceAfterMinutes: 10 },
      });
      templateId[template.id] = created.id;
    }
    // Juanjo NO es miembro: turno fijo L–V 07–15 (camino legacy).
    await holder.shiftAssignment.create({ data: { employeeId: juanjo(), shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id]!, effectiveFrom: day(PLANTA_ANCHOR), weekdays: [1, 2, 3, 4, 5] } });

    const group = await holder.shiftGroup.create({ data: { code: "PLANTA", name: "Planta" } });
    const rotation = await holder.shiftRotation.create({ data: { code: "PLANTA", name: "Planta", shiftGroupId: group.id } });
    const version = await holder.shiftRotationVersion.create({ data: { rotationId: rotation.id, cycleLengthWeeks: 2, anchorWeekStart: day(PLANTA_ANCHOR), effectiveFrom: day(PLANTA_ANCHOR) } });
    const crewId: Record<string, string> = {};
    for (const [code, id] of Object.entries(PLANTA_CREWS)) {
      crewId[id] = (await holder.shiftRotationCrew.create({ data: { rotationId: rotation.id, code, name: code } })).id;
    }
    for (const fixtureDay of plantaDays()) {
      const created = await holder.shiftRotationDay.create({
        data: { versionId: version.id, crewId: crewId[fixtureDay.crewId]!, cycleWeekIndex: fixtureDay.cycleWeekIndex, weekday: fixtureDay.weekday, kind: fixtureDay.kind },
      });
      for (const block of fixtureDay.blocks) {
        await holder.shiftRotationBlock.create({ data: { dayId: created.id, blockIndex: block.blockIndex, shiftTemplateId: templateId[block.template.id]! } });
      }
    }
    const members: Array<[string, string]> = [
      [PLANTA_EMPLOYEES.ROBERTO, PLANTA_CREWS.ROBERTO_ARIEL],
      [PLANTA_EMPLOYEES.ARIEL, PLANTA_CREWS.ROBERTO_ARIEL],
      [PLANTA_EMPLOYEES.CARLOS, PLANTA_CREWS.CARLOS_WALTER],
      [PLANTA_EMPLOYEES.WALTER, PLANTA_CREWS.CARLOS_WALTER],
      [PLANTA_EMPLOYEES.JUANCHI, PLANTA_CREWS.JUANCHI],
      [PLANTA_EMPLOYEES.JOSE, PLANTA_CREWS.JOSE],
      [PLANTA_EMPLOYEES.JOHANNA, PLANTA_CREWS.JOHANNA],
    ];
    for (const [key, crew] of members) {
      await holder.shiftRotationCrewMember.create({ data: { crewId: crewId[crew]!, employeeId: employee[key]!, effectiveFrom: day(PLANTA_ANCHOR) } });
    }
  }, 60_000);

  beforeEach(async () => {
    await holder.systemNotification.deleteMany({});
    await holder.attendanceInactivityIncident.deleteMany({});
    await holder.attendancePunch.deleteMany({});
    await holder.holidayWorkAssignment.deleteMany({});
    await holder.specialHourRuleDate.deleteMany({});
    await holder.doubleHourRule.deleteMany({});
  });

  afterAll(async () => {
    await m?.prisma.$disconnect();
    await holder?.$disconnect();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  it("obligación: José viernes A tiene 2 candidatos por bloque (07:00 y 19:00) y Juanjo 1 candidato fijo sin bloque", async () => {
    const { candidates } = await m.workObligation.resolveWorkObligationCandidates(FRI_A);
    const ofJose = candidates.filter((candidate) => candidate.employeeId === jose());
    expect(ofJose.map((candidate) => candidate.scheduledStartAt.toISOString())).toEqual([at(FRI_A, "07:00").toISOString(), at(FRI_A, "19:00").toISOString()]);
    expect(ofJose.every((candidate) => candidate.block?.obligationKey === `${jose()}|${candidate.scheduledStartAt.toISOString()}`)).toBe(true);
    const ofJuanjo = candidates.filter((candidate) => candidate.employeeId === juanjo());
    expect(ofJuanjo).toHaveLength(1);
    expect(ofJuanjo[0]).not.toHaveProperty("block");
  });

  it("1 — José sin ninguna entrada: una falta por bloque al vencer cada tolerancia, con su aviso", async () => {
    await m.missing.checkMissingExpectedEntries(at(FRI_A, "07:10:29.999"));
    expect(await incidentsOf(jose(), FRI_A)).toHaveLength(0);
    await m.missing.checkMissingExpectedEntries(at(FRI_A, "07:10:30"));
    expect(starts(await incidentsOf(jose(), FRI_A))).toEqual([at(FRI_A, "07:00").toISOString()]);
    const result = await m.missing.checkMissingExpectedEntries(at(FRI_A, "19:10:30"));
    expect(result).not.toHaveProperty("reconciliationRequired");
    const rows = await incidentsOf(jose(), FRI_A);
    expect(starts(rows)).toEqual([at(FRI_A, "07:00").toISOString(), at(FRI_A, "19:00").toISOString()]);
    expect(rows.every((row) => row.status === "PENDIENTE" && row.notifiedAt)).toBe(true);
    expect(rows.map((row) => row.observation)).toEqual([expect.stringContaining("PLANTA-07-11 (07:00)"), expect.stringContaining("PLANTA-19-07 (19:00)")]);
    const notices = await noticesOf(jose(), FRI_A);
    expect(notices).toHaveLength(2);
    expect(notices.every((notice) => notice.recipientUserId === rrhhId && notice.type === "FALTA_INGRESO")).toBe(true);
    expect(notices.map((notice) => notice.message).sort()).toEqual([expect.stringContaining("PLANTA-07-11 (07:00)"), expect.stringContaining("PLANTA-19-07 (19:00)")]);
  });

  it("2 — inactividad ANTES de las faltas por bloque: resultado final 2 faltas por bloque, sin SIN_ACTIVIDAD (Juanjo sigue legacy)", async () => {
    await m.inactivity.detectAttendanceInactivity(FRI_A);
    expect(await incidentsOf(jose(), FRI_A)).toHaveLength(0);
    expect(starts(await incidentsOf(juanjo(), FRI_A))).toEqual([null]);
    await m.missing.checkMissingEntriesForElapsedDate(FRI_A, at(SAT_A, "01:00"));
    expect(starts(await incidentsOf(jose(), FRI_A))).toEqual([at(FRI_A, "07:00").toISOString(), at(FRI_A, "19:00").toISOString()]);
    expect((await noticesOf(jose(), FRI_A)).every((notice) => notice.type === "FALTA_INGRESO")).toBe(true);
    expect(await incidentsOf(juanjo(), FRI_A)).toHaveLength(1);
  });

  it("3 — faltas por bloque ANTES de inactividad: mismo resultado", async () => {
    await m.missing.checkMissingEntriesForElapsedDate(FRI_A, at(SAT_A, "01:00"));
    await m.inactivity.detectAttendanceInactivity(FRI_A);
    const rows = await incidentsOf(jose(), FRI_A);
    expect(starts(rows)).toEqual([at(FRI_A, "07:00").toISOString(), at(FRI_A, "19:00").toISOString()]);
    expect(await noticesOf(jose(), FRI_A)).toHaveLength(2);
    expect(starts(await incidentsOf(juanjo(), FRI_A))).toEqual([null]);
  });

  it("4 — ambos procesos en paralelo (y repetidos): sin duplicados ni bloques perdidos, un aviso por incidente", async () => {
    await Promise.all([
      m.inactivity.detectAttendanceInactivity(FRI_A),
      m.missing.checkMissingExpectedEntries(at(FRI_A, "19:10:30")),
      m.missing.checkMissingEntriesForElapsedDate(FRI_A, at(SAT_A, "01:00")),
      m.missing.checkMissingExpectedEntries(at(FRI_A, "19:10:30")),
      m.inactivity.detectAttendanceInactivity(FRI_A),
    ]);
    expect(starts(await incidentsOf(jose(), FRI_A))).toEqual([at(FRI_A, "07:00").toISOString(), at(FRI_A, "19:00").toISOString()]);
    expect(await noticesOf(jose(), FRI_A)).toHaveLength(2);
    expect(await incidentsOf(juanjo(), FRI_A)).toHaveLength(1);
    expect(await noticesOf(juanjo(), FRI_A)).toHaveLength(1);
  });

  it("5 — reproceso tras interrupción (incidente creado sin aviso; catch-up repetido): idempotente, un aviso por incidente", async () => {
    // Interrupción simulada: la falta del bloque 07:00 quedó creada sin avisar.
    await holder.attendanceInactivityIncident.create({ data: { employeeId: jose(), operationalDate: day(FRI_A), scheduledStartAt: at(FRI_A, "07:00"), observation: "creada antes de la caída" } });
    await m.missing.checkMissingEntriesForElapsedDate(FRI_A, at(SAT_A, "01:00"));
    await m.missing.checkMissingEntriesForElapsedDate(FRI_A, at(SAT_A, "01:00"));
    const rows = await incidentsOf(jose(), FRI_A);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.notifiedAt)).toBe(true);
    expect(await noticesOf(jose(), FRI_A)).toHaveLength(2);
  });

  it("6 — entrada del primer bloque (07:02) no cumple el segundo: el 19:00 vence a las 19:10:30 (frontera de puntualidad, O2)", async () => {
    await punchIn(jose(), at(FRI_A, "07:02"));
    await m.missing.checkMissingExpectedEntries(at(FRI_A, "07:10:30"));
    expect(await incidentsOf(jose(), FRI_A)).toHaveLength(0);
    await m.missing.checkMissingExpectedEntries(at(FRI_A, "19:10:29.999"));
    expect(await incidentsOf(jose(), FRI_A)).toHaveLength(0);
    await m.missing.checkMissingExpectedEntries(at(FRI_A, "19:10:30"));
    expect(starts(await incidentsOf(jose(), FRI_A))).toEqual([at(FRI_A, "19:00").toISOString()]);
  });

  it("7 — entrada posterior del segundo bloque resuelve SÓLO su incidente", async () => {
    await m.missing.checkMissingExpectedEntries(at(FRI_A, "19:10:30"));
    expect(await incidentsOf(jose(), FRI_A)).toHaveLength(2);
    await punchIn(jose(), at(FRI_A, "19:25"));
    const result = await m.missing.checkMissingExpectedEntries(at(FRI_A, "19:26"));
    expect(result.resolved).toBeGreaterThanOrEqual(1);
    const rows = await incidentsOf(jose(), FRI_A);
    expect(rows.map((row) => [row.scheduledStartAt?.toISOString(), row.status])).toEqual([
      [at(FRI_A, "07:00").toISOString(), "PENDIENTE"],
      [at(FRI_A, "19:00").toISOString(), "RESUELTA"],
    ]);
    expect(rows[1]!.reviewedByUserId).toBeNull();
  });

  it("8 — convocatoria de feriado que reemplaza el bloque habitual: la obligación y la evidencia usan la convocatoria, nunca el habitual", async () => {
    const feriado = await holder.doubleHourRule.create({ data: { name: "Feriado IT", recurrenceType: "FECHA", fromDate: day(SAT_A), toDate: day(SAT_A), multiplier: 2, kind: "FERIADO", reason: "it" } });
    await holder.specialHourRuleDate.create({ data: { ruleId: feriado.id, date: day(SAT_A) } });
    await holder.holidayWorkAssignment.create({ data: { employeeId: jose(), date: day(SAT_A), shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id]! } });
    // 18:50 habría sido entrada del bloque habitual 19:00 (reemplazado): no satisface nada.
    await punchIn(jose(), at(SAT_A, "18:50"));
    await m.missing.checkMissingEntriesForElapsedDate(SAT_A, at("2026-11-08", "01:00"));
    expect((await incidentsOf(jose(), SAT_A)).map((row) => [row.scheduledStartAt?.toISOString(), row.status])).toEqual([[at(SAT_A, "07:00").toISOString(), "PENDIENTE"]]);
    // Una entrada dentro de la ventana de la convocatoria la resuelve.
    await punchIn(jose(), at(SAT_A, "07:05"));
    await m.missing.checkMissingEntriesForElapsedDate(SAT_A, at("2026-11-08", "01:00"));
    expect((await incidentsOf(jose(), SAT_A)).map((row) => row.status)).toEqual(["RESUELTA"]);
  });

  it("9 — avisos concurrentes sobre el mismo incidente: un solo juego de avisos", async () => {
    const incident = await holder.attendanceInactivityIncident.create({ data: { employeeId: jose(), operationalDate: day(FRI_A), scheduledStartAt: at(FRI_A, "07:00"), observation: "concurrencia" } });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => m.inactivity.claimAndNotifyInactivityIncidents([incident], FRI_A, "FALTA_INGRESO", "Falta de ingreso", () => "aviso")),
    );
    expect(results.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(await noticesOf(jose(), FRI_A)).toHaveLength(1);
  });

  it("10 — Juanjo (fijo, no miembro): un incidente de día, legacy intacto", async () => {
    await m.missing.checkMissingExpectedEntries(at(FRI_A, "07:10:30"));
    await m.inactivity.detectAttendanceInactivity(FRI_A);
    const rows = await incidentsOf(juanjo(), FRI_A);
    expect(starts(rows)).toEqual([null]);
    // FALTA_INGRESO y SIN_ACTIVIDAD comparten la fila de día (legacy, 15M.19B): un solo aviso.
    expect(await noticesOf(juanjo(), FRI_A)).toHaveLength(1);
  });

  it("nocturnos de Juanchi: la entrada del viernes 19:03 cumple sólo el bloque del viernes; el sábado 19:00 queda en falta", async () => {
    await punchIn(juanchi(), at(FRI_B, "19:03"));
    await punchIn(juanchi(), at(SAT_B, "06:30")); // en curso del bloque del viernes: no es entrada del sábado
    await m.missing.checkMissingEntriesForElapsedDate(FRI_B, at(SAT_B, "01:00"));
    expect(await incidentsOf(juanchi(), FRI_B)).toHaveLength(0);
    await m.missing.checkMissingEntriesForElapsedDate(SAT_B, at("2026-11-15", "01:00"));
    expect(starts(await incidentsOf(juanchi(), SAT_B))).toEqual([at(SAT_B, "19:00").toISOString()]);
  });

  it("día revisado por una persona (alcance desconocido): no se crean faltas por bloque ni avisos; se informa la conciliación", async () => {
    const dayIncident = await holder.attendanceInactivityIncident.create({
      data: { employeeId: jose(), operationalDate: day(FRI_A), observation: "día", status: "RESUELTA", reviewedAt: at(FRI_A, "12:00"), reviewedByUserId: rrhhId, reviewNote: "justificado", notifiedAt: at(FRI_A, "07:10") },
    });
    const result = await m.missing.checkMissingExpectedEntries(at(FRI_A, "19:10:30"));
    expect(result.reconciliationRequired).toEqual([
      { employeeId: jose(), dateKey: FRI_A, dayIncidentId: dayIncident.id, blockKeys: [`${jose()}|${at(FRI_A, "07:00").toISOString()}`, `${jose()}|${at(FRI_A, "19:00").toISOString()}`] },
    ]);
    const rows = await incidentsOf(jose(), FRI_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: dayIncident.id, status: "RESUELTA", reviewedByUserId: rrhhId, reviewNote: "justificado" });
    expect(await noticesOf(jose(), FRI_A)).toHaveLength(0);
    // Reproceso: mismo resultado determinístico.
    const again = await m.missing.checkMissingEntriesForElapsedDate(FRI_A, at(SAT_A, "01:00"));
    expect(again.reconciliationRequired).toEqual(result.reconciliationRequired);
    expect(await incidentsOf(jose(), FRI_A)).toHaveLength(1);
  });

  it("día DESCARTADO: tampoco se crean faltas por bloque", async () => {
    await holder.attendanceInactivityIncident.create({ data: { employeeId: jose(), operationalDate: day(FRI_A), observation: "día", status: "DESCARTADA" } });
    const result = await m.missing.checkMissingExpectedEntries(at(FRI_A, "07:10:30"));
    expect(result.reconciliationRequired).toHaveLength(1);
    expect(await incidentsOf(jose(), FRI_A)).toHaveLength(1);
  });

  it("día PENDIENTE sin revisión: con un bloque vencido y otro futuro, se reemplaza recién al persistir el vencido; el futuro se crea al vencer", async () => {
    const dayIncident = await holder.attendanceInactivityIncident.create({ data: { employeeId: jose(), operationalDate: day(FRI_A), observation: "día", notifiedAt: at(FRI_A, "07:10") } });
    await m.missing.checkMissingExpectedEntries(at(FRI_A, "06:00"));
    expect((await holder.attendanceInactivityIncident.findUniqueOrThrow({ where: { id: dayIncident.id } })).status).toBe("PENDIENTE"); // nunca por bloques futuros
    await m.missing.checkMissingExpectedEntries(at(FRI_A, "07:10:30"));
    let rows = await incidentsOf(jose(), FRI_A);
    expect(rows.map((row) => [row.scheduledStartAt?.toISOString() ?? null, row.status])).toEqual([
      [at(FRI_A, "07:00").toISOString(), "PENDIENTE"],
      [null, "RESUELTA"],
    ]);
    expect(rows[1]).toMatchObject({ reviewedByUserId: null, reviewNote: "Reemplazado por las faltas de ingreso por bloque de la programación por rotación." });
    await m.missing.checkMissingExpectedEntries(at(FRI_A, "19:10:30"));
    rows = await incidentsOf(jose(), FRI_A);
    expect(rows.map((row) => [row.scheduledStartAt?.toISOString() ?? null, row.status])).toEqual([
      [at(FRI_A, "07:00").toISOString(), "PENDIENTE"],
      [at(FRI_A, "19:00").toISOString(), "PENDIENTE"],
      [null, "RESUELTA"],
    ]);
    expect(await noticesOf(jose(), FRI_A)).toHaveLength(2); // sólo los de bloque (el del día ya estaba avisado)
  });

  it("Novedades: José viernes A espera 960 min por bloques; sábado B descanso 0", async () => {
    const result = await m.workday.resolveExpectedWorkdays([jose()], day(FRI_A), day("2026-11-14"), m.prisma);
    expect(result.get(jose())!.get(FRI_A)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 960, source: "SHIFT_ROTATION", minutesSource: "ROTATION_BLOCKS" });
    expect(result.get(jose())!.get("2026-11-14")).toMatchObject({ obligation: "NO_WORK_OBLIGATION", expectedMinutes: 0 });
  });
});
