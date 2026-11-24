/**
 * R4.4 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.6) contra PostgreSQL REAL: fichadas reales
 * por la app (createApp → /clock/photo-punch con dispositivo real), post-proceso durable drenado,
 * la grilla REAL de Planta (plantaRotation.fixture.ts) cargada en las tablas de rotación, responsables
 * asignados y avisos reales. Sólo el object storage primario se reemplaza por uno en memoria y el
 * reloj del proceso (`Date`) se fija en cada fichada para ubicar los casos en el horario de Planta.
 *
 * Opt-in: sólo corre con `ROTATION_CLOCK_IT_DATABASE_URL` → `localhost`, base `clock_it*` PROPIA con
 * el schema de este commit. VACÍA la base antes de cada caso. Nunca usa el DATABASE_URL del .env y
 * verifica `current_database()`.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PLANTA_ANCHOR, PLANTA_CREWS, PLANTA_EMPLOYEES, PLANTA_TEMPLATES, plantaDays } from "../shifts/plantaRotation.fixture";

const url = process.env.ROTATION_CLOCK_IT_DATABASE_URL;

vi.mock("../../shared/storage/neonObjectStorage.provider", async () => ({
  neonObjectStorageProvider: (await import("../../shared/testing/inMemoryObjectStorage")).inMemoryObjectStorage.provider,
}));

const PHOTO = `data:image/jpeg;base64,${Buffer.alloc(6000, 1).toString("base64")}`;
const at = (dateKey: string, time: string) => new Date(`${dateKey}T${time}:00-03:00`);
const day = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

// Semana A: lunes 02/11/2026. Semana B: lunes 09/11/2026.
const THU_A = "2026-11-05";
const FRI_A = "2026-11-06"; // José: 07–11 + 19–07
const SAT_A = "2026-11-07";
const MON_A = "2026-11-02"; // Carlos/Walter: 17–03
const TUE_A = "2026-11-03";
const MON_B = "2026-11-09"; // Roberto: 17–03; Juanchi: 07–15
const TUE_B = "2026-11-10"; // Juanchi: 03–11
const FRI_B = "2026-11-13"; // Juanchi: 19–07
const SAT_B = "2026-11-14";

type Modules = {
  env: typeof import("../../config/env").env;
  prisma: typeof import("../../shared/prisma/client").prisma;
  worker: typeof import("./clockPunchPostProcess.worker");
  repo: typeof import("../time-entries/timeEntries.repository").timeEntriesRepository;
};

type PunchResult = { status: number; data: Record<string, unknown> | undefined; error: { code: string; message: string; clockGuidance?: Record<string, unknown> } | undefined; requestId: string };

describe.skipIf(!url)("R4.4 — fichador con bloques de rotación contra PostgreSQL local", () => {
  let m: Modules;
  let holder: PrismaClient;
  let server: Server;
  let baseUrl: string;
  let device: { id: string; secret: string };
  let credentials: typeof import("../../shared/security/clockDeviceCredentials");
  const employee: Record<string, string> = {};
  const templateId: Record<string, string> = {};
  const crewId: Record<string, string> = {};
  const users: Record<"rrhh" | "supervisorJose" | "otherSupervisor", string> = { rrhh: "", supervisorJose: "", otherSupervisor: "" };
  let rotationId = "";

  const jose = () => employee[PLANTA_EMPLOYEES.JOSE]!;

  async function punch(employeeId: string, punchType: "IN" | "OUT", instant: Date, extra: Record<string, unknown> = {}, requestId: string = randomUUID()): Promise<PunchResult> {
    vi.setSystemTime(instant);
    const response = await fetch(`${baseUrl}/clock/photo-punch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `ClockDevice ${device.id}.${device.secret}` },
      body: JSON.stringify({ requestId, employeeId, punchType, photo: PHOTO, faceValidationStatus: "VALID", faceDetectionScore: 0.97, ...extra }),
    });
    const json = (await response.json()) as { data?: Record<string, unknown>; error?: PunchResult["error"] };
    return { status: response.status, data: json.data, error: json.error, requestId };
  }
  const drain = (employeeId: string) => m.worker.drainClockPunchPostProcess({ employeeIds: [employeeId] });
  const shiftsOf = (employeeId: string) => holder.workShift.findMany({ where: { employeeId }, orderBy: { startAt: "asc" } });
  const exitPunchesOf = (employeeId: string) => holder.attendancePunch.count({ where: { employeeId, type: "SALIDA" } });
  const alertsOf = (workShiftId: string) => holder.shiftAlert.findMany({ where: { workShiftId }, orderBy: { type: "asc" } });
  const noticesFor = async (recipientUserId: string) => holder.systemNotification.findMany({ where: { recipientUserId }, orderBy: { createdAt: "asc" } });
  const auditAfter = async (workShiftId: string) => (await holder.auditLog.findMany({ where: { entity: "WorkShift", entityId: workShiftId }, orderBy: { createdAt: "asc" } })).map((row) => row.after as Record<string, unknown> | null);

  async function seed() {
    const tables = await m.prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await m.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);
    await m.prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WorkShift_one_open_per_employee" ON "WorkShift"("employeeId") WHERE status = 'ABIERTO' AND "endAt" IS NULL`);
    await holder.hourConcept.create({ data: { code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", systemRole: "NORMAL_BASE" } });
    users.rrhh = (await holder.user.create({ data: { name: "RRHH IT", email: "rrhh-r44@example.com", passwordHash: "x", role: "NIVEL_1_RRHH" } })).id;
    users.supervisorJose = (await holder.user.create({ data: { name: "Encargado José", email: "sup-jose-r44@example.com", passwordHash: "x", role: "NIVEL_2_SUPERVISION" } })).id;
    users.otherSupervisor = (await holder.user.create({ data: { name: "Otro encargado", email: "sup-otro-r44@example.com", passwordHash: "x", role: "NIVEL_2_SUPERVISION" } })).id;
    const keys = [...Object.values(PLANTA_EMPLOYEES), "emp-missing", "emp-conflict"];
    for (const [index, key] of keys.entries()) {
      employee[key] = (await holder.employee.create({ data: { legajo: `R44-${index + 1}`, cuil: `20-9${index + 1}`, dni: `9${index + 1}`, firstName: "Prueba", lastName: key.replace("emp-", "") } })).id;
    }
    await holder.employeeAssignment.create({ data: { employeeId: jose(), userId: users.supervisorJose, type: "TIME_RESPONSIBLE", status: "ACTIVO" } });
    for (const template of Object.values(PLANTA_TEMPLATES)) {
      templateId[template.id] = (await holder.shiftTemplate.create({
        data: { code: template.code, name: template.code, startTime: template.startTime, endTime: template.endTime, crossesMidnight: template.crossesMidnight, entryToleranceBeforeMinutes: 10, entryToleranceAfterMinutes: 10, exitToleranceBeforeMinutes: 20, exitToleranceAfterMinutes: 20 },
      })).id;
    }
    await holder.shiftAssignment.create({ data: { employeeId: employee[PLANTA_EMPLOYEES.JUANJO]!, shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id]!, effectiveFrom: day(PLANTA_ANCHOR), weekdays: [1, 2, 3, 4, 5] } });
    const group = await holder.shiftGroup.create({ data: { code: "PLANTA", name: "Planta" } });
    rotationId = (await holder.shiftRotation.create({ data: { code: "PLANTA", name: "Planta", shiftGroupId: group.id } })).id;
    const version = await holder.shiftRotationVersion.create({ data: { rotationId, cycleLengthWeeks: 2, anchorWeekStart: day(PLANTA_ANCHOR), effectiveFrom: day(PLANTA_ANCHOR) } });
    for (const [code, id] of Object.entries(PLANTA_CREWS)) crewId[id] = (await holder.shiftRotationCrew.create({ data: { rotationId, code, name: code } })).id;
    // Equipo sin grilla: sus miembros tienen plan MISSING (NO_DAY_ROW).
    crewId["crew-sin-grilla"] = (await holder.shiftRotationCrew.create({ data: { rotationId, code: "SIN_GRILLA", name: "Sin grilla" } })).id;
    // Equipo con dos bloques superpuestos el viernes A ⇒ plan CONFLICT (OVERLAPPING_BLOCKS).
    crewId["crew-conflicto"] = (await holder.shiftRotationCrew.create({ data: { rotationId, code: "CONFLICTO", name: "Conflicto" } })).id;
    const days = plantaDays().map((fixtureDay) => ({ ...fixtureDay, dbId: randomUUID() }));
    await holder.shiftRotationDay.createMany({ data: days.map((fixtureDay) => ({ id: fixtureDay.dbId, versionId: version.id, crewId: crewId[fixtureDay.crewId]!, cycleWeekIndex: fixtureDay.cycleWeekIndex, weekday: fixtureDay.weekday, kind: fixtureDay.kind })) });
    await holder.shiftRotationBlock.createMany({ data: days.flatMap((fixtureDay) => fixtureDay.blocks.map((block) => ({ dayId: fixtureDay.dbId, blockIndex: block.blockIndex, shiftTemplateId: templateId[block.template.id]! }))) });
    const conflictDay = await holder.shiftRotationDay.create({ data: { versionId: version.id, crewId: crewId["crew-conflicto"]!, cycleWeekIndex: 0, weekday: 5, kind: "SHIFT" } });
    await holder.shiftRotationBlock.createMany({ data: [
      { dayId: conflictDay.id, blockIndex: 0, shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id]! },
      { dayId: conflictDay.id, blockIndex: 1, shiftTemplateId: templateId[PLANTA_TEMPLATES.T0711.id]! },
    ] });
    const members: Array<[string, string]> = [
      [PLANTA_EMPLOYEES.ROBERTO, PLANTA_CREWS.ROBERTO_ARIEL],
      [PLANTA_EMPLOYEES.ARIEL, PLANTA_CREWS.ROBERTO_ARIEL],
      [PLANTA_EMPLOYEES.CARLOS, PLANTA_CREWS.CARLOS_WALTER],
      [PLANTA_EMPLOYEES.WALTER, PLANTA_CREWS.CARLOS_WALTER],
      [PLANTA_EMPLOYEES.JUANCHI, PLANTA_CREWS.JUANCHI],
      [PLANTA_EMPLOYEES.JOSE, PLANTA_CREWS.JOSE],
      [PLANTA_EMPLOYEES.JOHANNA, PLANTA_CREWS.JOHANNA],
      ["emp-missing", "crew-sin-grilla"],
      ["emp-conflict", "crew-conflicto"],
    ];
    for (const [key, crew] of members) await holder.shiftRotationCrewMember.create({ data: { crewId: crewId[crew]!, employeeId: employee[key]!, effectiveFrom: day(PLANTA_ANCHOR) } });
    const secret = credentials.generateClockDeviceSecret();
    const created = await holder.clockDevice.create({ data: { name: "TEST R4.4", status: "ACTIVE", tokenHash: credentials.hashClockDeviceSecret(secret), activatedAt: new Date(), lastSeenAt: new Date() } });
    device = { id: created.id, secret };
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("ROTATION_CLOCK_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ createApp }, { env }, { prisma }, worker, { timeEntriesRepository }, creds] = await Promise.all([
      import("../../app"),
      import("../../config/env"),
      import("../../shared/prisma/client"),
      import("./clockPunchPostProcess.worker"),
      import("../time-entries/timeEntries.repository"),
      import("../../shared/security/clockDeviceCredentials"),
    ]);
    m = { env, prisma, worker, repo: timeEntriesRepository };
    credentials = creds;
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });
    env.PUNCH_PHOTO_STORAGE_PROVIDER = "neon_object_storage";
    env.CLOCK_PUNCH_COOLDOWN_SECONDS = 60;
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${env.API_PREFIX}`;
    vi.useFakeTimers({ toFake: ["Date"] });
  }, 60_000);

  beforeEach(async () => {
    vi.setSystemTime(at(FRI_A, "06:00"));
    await seed();
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    m?.worker.stopClockPunchPostProcessWorker();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await m?.prisma.$disconnect();
    await holder?.$disconnect();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  // ── José, viernes A: B1 07:00–11:00 y B2 19:00–07:00 ────────────────────────

  it("José con dos bloques correctos: dos jornadas independientes, cada una con su bloque congelado, sin alertas", async () => {
    expect((await punch(jose(), "IN", at(FRI_A, "07:00"))).status).toBe(201);
    expect((await punch(jose(), "OUT", at(FRI_A, "11:02"))).status).toBe(201);
    expect((await punch(jose(), "IN", at(FRI_A, "19:00"))).status).toBe(201);
    expect((await punch(jose(), "OUT", at(SAT_A, "07:10"))).status).toBe(201);
    await drain(jose());
    const shifts = await shiftsOf(jose());
    expect(shifts.map((shift) => [shift.status, shift.shiftTemplateSource, shift.scheduledStartAt?.toISOString(), shift.totalMinutes])).toEqual([
      ["PROCESADO", "ROTATION", at(FRI_A, "07:00").toISOString(), 242],
      ["PROCESADO", "ROTATION", at(FRI_A, "19:00").toISOString(), 730],
    ]);
    expect(shifts[0]!.shiftTemplateId).toBe(templateId[PLANTA_TEMPLATES.T0711.id]);
    expect(shifts[1]!.shiftTemplateId).toBe(templateId[PLANTA_TEMPLATES.T1907.id]);
    for (const shift of shifts) expect(await alertsOf(shift.id)).toEqual([]);
    const [entryAudit] = await auditAfter(shifts[1]!.id);
    expect(entryAudit?.rotationDiagnosis).toMatchObject({ version: 1, kind: "ASSIGNED", punctuality: "ON_TIME", block: { obligationKey: `${jose()}|${at(FRI_A, "19:00").toISOString()}`, templateCode: "PLANTA-19-07", operationalDate: FRI_A } });
    expect(await noticesFor(users.supervisorJose)).toEqual([]);
  });

  it("salidas 12:30 y 15:00: cierre automático con las fichadas reales y SALIDA_TARDIA; nunca confirmación ni olvido de salida", async () => {
    for (const [exit, minutes, late] of [["12:30", 330, 90], ["15:00", 480, 240]] as const) {
      await seed();
      await punch(jose(), "IN", at(FRI_A, "07:00"));
      const out = await punch(jose(), "OUT", at(FRI_A, exit));
      expect(out.status, exit).toBe(201);
      await drain(jose());
      const [shift] = await shiftsOf(jose());
      expect(shift).toMatchObject({ status: "PROCESADO", totalMinutes: minutes });
      const alerts = await alertsOf(shift!.id);
      expect(alerts.find((alert) => alert.type === "SALIDA_TARDIA")).toMatchObject({ differenceMinutes: late, scheduledAt: at(FRI_A, "11:00") });
      expect(alerts.some((alert) => alert.type === "POSIBLE_OLVIDO_SALIDA")).toBe(false);
      // Un aviso por salida: encargado de José y RRHH, no otro encargado.
      expect((await noticesFor(users.supervisorJose)).length).toBe(1);
      expect((await noticesFor(users.rrhh)).length).toBe(1);
      expect(await noticesFor(users.otherSupervisor)).toEqual([]);
    }
  });

  it("salida 18:49 cierra sola; 18:55 y 19:02 piden confirmación previa sin persistir nada (y el reintento repite la misma pregunta)", async () => {
    await punch(jose(), "IN", at(FRI_A, "07:00"));
    for (const exit of ["18:55", "19:02"]) {
      const asked = await punch(jose(), "OUT", at(FRI_A, exit));
      expect(asked.status).toBe(409);
      expect(asked.error).toMatchObject({ code: "CLOCK_EXIT_CONFIRMATION_REQUIRED", message: expect.stringContaining("terminó a las 11:00 y ahora tenés otro turno programado a las 19:00") });
      const shiftId = (await shiftsOf(jose()))[0]!.id;
      expect(asked.error?.clockGuidance).toMatchObject({ kind: "EXIT_CONFIRMATION_REQUIRED", openShiftId: shiftId, nextBlock: { key: `${jose()}|${at(FRI_A, "19:00").toISOString()}`, startAt: at(FRI_A, "19:00").toISOString() }, previousBlock: { endAt: at(FRI_A, "11:00").toISOString() } });
      const replay = await punch(jose(), "OUT", at(FRI_A, exit), {}, asked.requestId);
      expect(replay.status).toBe(409);
      expect(replay.error).toEqual(asked.error);
    }
    expect(await exitPunchesOf(jose())).toBe(0);
    expect((await shiftsOf(jose()))[0]).toMatchObject({ status: "ABIERTO", endAt: null });
    await drain(jose());
    expect(await holder.systemNotification.count()).toBe(0);
    await seed();
    await punch(jose(), "IN", at(FRI_A, "07:00"));
    expect((await punch(jose(), "OUT", at(FRI_A, "18:49"))).status).toBe(201);
  });

  it("José elige ENTRADA en la confirmación: B1 en FALTA_SALIDA sin salida ni horas, B2 abierta con su bloque; aviso único y correcto al encargado", async () => {
    await punch(jose(), "IN", at(FRI_A, "07:00"));
    expect((await punch(jose(), "OUT", at(FRI_A, "19:02"))).status).toBe(409);
    const entry = await punch(jose(), "IN", at(FRI_A, "19:02"));
    expect(entry.status).toBe(201);
    expect(entry.data).toMatchObject({ previousOpenShift: { status: "FALTA_SALIDA" } });
    await drain(jose());
    const [b1, b2] = await shiftsOf(jose());
    expect(b1).toMatchObject({ status: "FALTA_SALIDA", endAt: null, endPunchId: null, totalMinutes: null });
    expect(b1!.observation).toContain("Falta registrar la salida del turno de las 07:00 a las 11:00");
    expect(await holder.timeEntry.findMany({ where: { workShiftId: b1!.id }, select: { totalMinutes: true } })).toEqual([{ totalMinutes: 0 }]);
    expect(b2).toMatchObject({ status: "ABIERTO", shiftTemplateSource: "ROTATION", scheduledStartAt: at(FRI_A, "19:00") });
    expect(await exitPunchesOf(jose())).toBe(0);
    const notices = await noticesFor(users.supervisorJose);
    expect(notices.map((notice) => notice.type)).toEqual(["FALTA_SALIDA"]);
    expect(notices[0]!.message).toContain("ya ingresó a su turno de las 19:00");
    expect((await noticesFor(users.rrhh)).length).toBe(1);
    expect(await noticesFor(users.otherSupervisor)).toEqual([]);
    const audits = await auditAfter(b2!.id);
    expect(audits[0]?.rotationDiagnosis).toMatchObject({ kind: "ASSIGNED", blockChange: { previousShiftId: b1!.id, alertOnly: false } });
  });

  it("José registra directamente la ENTRADA del segundo bloque (sin pasar por la confirmación): mismo resultado, idempotente ante reintento", async () => {
    await punch(jose(), "IN", at(FRI_A, "07:00"));
    const entry = await punch(jose(), "IN", at(FRI_A, "19:00"));
    expect(entry.status).toBe(201);
    const replay = await punch(jose(), "IN", at(FRI_A, "19:00"), {}, entry.requestId);
    expect(replay.status).toBe(201);
    expect(replay.data).toEqual(entry.data);
    await drain(jose());
    expect((await shiftsOf(jose())).map((shift) => shift.status)).toEqual(["FALTA_SALIDA", "ABIERTO"]);
    expect((await noticesFor(users.supervisorJose)).length).toBe(1);
  });

  it("José confirma la SALIDA: cierre con las fichadas reales, un solo aviso con el contexto, diagnóstico confirmado; la confirmación ligada a la jornada", async () => {
    await punch(jose(), "IN", at(FRI_A, "07:00"));
    const asked = await punch(jose(), "OUT", at(FRI_A, "19:02"));
    const guidance = asked.error!.clockGuidance!;
    const confirmed = await punch(jose(), "OUT", at(FRI_A, "19:02"), { exitConfirmation: { openShiftId: guidance.openShiftId, nextBlockKey: (guidance.nextBlock as { key: string }).key } });
    expect(confirmed.status).toBe(201);
    await drain(jose());
    const [shift] = await shiftsOf(jose());
    expect(shift).toMatchObject({ status: "PROCESADO", totalMinutes: 722 });
    const notices = await noticesFor(users.supervisorJose);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.message).toContain("cerca de su turno de las 19:00");
    expect(notices[0]!.message).toContain("confirmó en el fichador");
    const audits = await auditAfter(shift!.id);
    expect(audits.at(-1)?.rotationDiagnosis).toMatchObject({ exit: "LIKELY_FORGOTTEN_EXIT", confirmed: true, minutesAfterScheduledEnd: 482 });
  });

  it("confirmación que excede el límite absoluto: no se registra la salida (ni con confirmación), queda evidencia del intento y la ENTRADA posterior funciona", async () => {
    await holder.shiftTemplate.update({ where: { id: templateId[PLANTA_TEMPLATES.T0711.id]! }, data: { absoluteOpenShiftLimitMinutes: 600 } });
    await punch(jose(), "IN", at(FRI_A, "07:00"));
    expect((await shiftsOf(jose()))[0]!.maxAllowedMinutes).toBe(600);
    const rejected = await punch(jose(), "OUT", at(FRI_A, "18:55"), { exitConfirmation: { openShiftId: (await shiftsOf(jose()))[0]!.id, nextBlockKey: `${jose()}|${at(FRI_A, "19:00").toISOString()}` } });
    expect(rejected.status).toBe(409);
    expect(rejected.error).toMatchObject({ code: "CLOCK_SHIFT_LIMIT_EXCEEDED", clockGuidance: { kind: "SHIFT_LIMIT_EXCEEDED", nextBlock: { startAt: at(FRI_A, "19:00").toISOString() } } });
    expect(await exitPunchesOf(jose())).toBe(0);
    expect(await holder.auditLog.findMany({ where: { action: "REJECT", entity: "ClockPunchAttempt", entityId: rejected.requestId } })).toHaveLength(1);
    expect(await holder.systemNotification.count()).toBe(0);
    expect((await punch(jose(), "IN", at(FRI_A, "19:00"))).status).toBe(201);
    await drain(jose());
    expect((await shiftsOf(jose())).map((shift) => [shift.status, shift.totalMinutes])).toEqual([["FALTA_SALIDA", null], ["ABIERTO", null]]);
  });

  it("ALERT_ONLY: el cambio de bloque se acepta igual; la revisión de B1 queda CRÍTICA y pendiente; un solo aviso (falta de salida)", async () => {
    const regime = await holder.workRegime.create({ data: { code: "PLANTA-AO", name: "Planta alerta", kind: "TURNO_OBLIGATORIO", openShiftOverflowAction: "ALERT_ONLY" } });
    await holder.employeeWorkRegime.create({ data: { employeeId: jose(), workRegimeId: regime.id, effectiveFrom: day(PLANTA_ANCHOR) } });
    await punch(jose(), "IN", at(FRI_A, "07:00"));
    expect((await punch(jose(), "IN", at(FRI_A, "19:00"))).status).toBe(201);
    await drain(jose());
    const [b1, b2] = await shiftsOf(jose());
    expect(b1!.status).toBe("FALTA_SALIDA");
    expect(b2!.status).toBe("ABIERTO");
    expect(await alertsOf(b1!.id)).toEqual([expect.objectContaining({ type: "POSIBLE_OLVIDO_SALIDA", severity: "CRITICA", status: "PENDIENTE" })]);
    expect((await noticesFor(users.supervisorJose)).map((notice) => notice.type)).toEqual(["FALTA_SALIDA"]);
  });

  it("concurrencia: dos confirmaciones simultáneas dejan UNA salida; confirmación vieja tras otro movimiento → CLOCK_SHIFT_CHANGED", async () => {
    await punch(jose(), "IN", at(FRI_A, "07:00"));
    const asked = await punch(jose(), "OUT", at(FRI_A, "19:02"));
    const confirmation = { exitConfirmation: { openShiftId: asked.error!.clockGuidance!.openShiftId, nextBlockKey: (asked.error!.clockGuidance!.nextBlock as { key: string }).key } };
    vi.setSystemTime(at(FRI_A, "19:02"));
    const results = await Promise.all([punch(jose(), "OUT", at(FRI_A, "19:02"), confirmation), punch(jose(), "OUT", at(FRI_A, "19:02"), confirmation)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await exitPunchesOf(jose())).toBe(1);
    await seed();
    await punch(jose(), "IN", at(FRI_A, "07:00"));
    const stale = await punch(jose(), "OUT", at(FRI_A, "19:02"));
    expect((await punch(jose(), "IN", at(FRI_A, "19:03"))).status).toBe(201);
    const late = await punch(jose(), "OUT", at(FRI_A, "19:05"), { exitConfirmation: { openShiftId: stale.error!.clockGuidance!.openShiftId, nextBlockKey: (stale.error!.clockGuidance!.nextBlock as { key: string }).key } });
    expect(late.status).toBe(409);
    expect(late.error?.code).toBe("CLOCK_SHIFT_CHANGED");
    expect(await exitPunchesOf(jose())).toBe(0);
  });

  it("concurrencia: cambio de bloque en carrera con el vencimiento de B1 → siempre B1 FALTA_SALIDA una vez y B2 abierta una vez, sin error para la persona", async () => {
    await holder.shiftTemplate.update({ where: { id: templateId[PLANTA_TEMPLATES.T0711.id]! }, data: { absoluteOpenShiftLimitMinutes: 600 } });
    await punch(jose(), "IN", at(FRI_A, "07:00"));
    vi.setSystemTime(at(FRI_A, "19:00"));
    const [entry] = await Promise.all([punch(jose(), "IN", at(FRI_A, "19:00")), m.repo.expireOpenWorkShifts(at(FRI_A, "19:00"))]);
    expect(entry.status).toBe(201);
    await drain(jose());
    const shifts = await shiftsOf(jose());
    expect(shifts.map((shift) => shift.status)).toEqual(["FALTA_SALIDA", "ABIERTO"]);
    expect(await holder.timeEntry.count({ where: { workShiftId: shifts[0]!.id } })).toBe(1);
  });

  it("superposición con otra jornada registrada: la salida no se persiste (CLOCK_SHIFT_OVERLAP) y la jornada sigue abierta", async () => {
    await holder.workShift.create({ data: { employeeId: jose(), source: "ADMIN", status: "PROCESADO", startAt: at(FRI_A, "08:00"), endAt: at(FRI_A, "09:00"), totalMinutes: 60 } });
    await punch(jose(), "IN", at(FRI_A, "07:00"));
    const out = await punch(jose(), "OUT", at(FRI_A, "11:02"));
    expect(out.status).toBe(409);
    expect(out.error?.code).toBe("CLOCK_SHIFT_OVERLAP");
    expect(await exitPunchesOf(jose())).toBe(0);
    expect((await holder.workShift.findFirst({ where: { employeeId: jose(), source: { not: "ADMIN" } } }))?.status).toBe("ABIERTO");
  });

  it("horas manuales y período protegido: se aplican las reglas existentes de cierre (jornada OBSERVADO, sin horas automáticas)", async () => {
    const normal = await holder.hourConcept.findFirstOrThrow({ where: { code: "HC-NORMAL" } });
    await holder.timeEntry.create({ data: { employeeId: jose(), hourConceptId: normal.id, date: day(FRI_A), period: "2026-11", day: 6, hours: 4, totalMinutes: 240, status: "APROBADO", source: "ADMIN" } });
    await punch(jose(), "IN", at(FRI_A, "07:00"));
    expect((await punch(jose(), "OUT", at(FRI_A, "11:02"))).status).toBe(201);
    await drain(jose());
    const [manualShift] = await shiftsOf(jose());
    expect(manualShift!.status).toBe("OBSERVADO");
    expect((await alertsOf(manualShift!.id)).map((alert) => alert.type)).toContain("ACTIVIDAD_SOBRE_CARGA_MANUAL");
    expect(await holder.timeEntry.count({ where: { workShiftId: manualShift!.id } })).toBe(0);

    await seed();
    await holder.monthlyTimeClosure.create({ data: { employeeId: jose(), period: "2026-11", status: "APROBADO" } });
    await punch(jose(), "IN", at(FRI_A, "07:00"));
    expect((await punch(jose(), "OUT", at(FRI_A, "11:02"))).status).toBe(201);
    expect((await shiftsOf(jose()))[0]!.status).toBe("OBSERVADO");
  });

  // ── Nocturnos y casos especiales ─────────────────────────────────────────

  it("Carlos 17–03: ingreso tardío 00:30 queda en el bloque del lunes (INGRESO_TARDE), salida 03:05 contra 03:00 del martes, fecha operativa lunes", async () => {
    const carlos = employee[PLANTA_EMPLOYEES.CARLOS]!;
    expect((await punch(carlos, "IN", at(TUE_A, "00:30"))).status).toBe(201);
    expect((await punch(carlos, "OUT", at(TUE_A, "03:05"))).status).toBe(201);
    await drain(carlos);
    const [shift] = await shiftsOf(carlos);
    expect(shift).toMatchObject({ scheduledStartAt: at(MON_A, "17:00"), shiftTemplateSource: "ROTATION", status: "PROCESADO" });
    const alerts = await alertsOf(shift!.id);
    expect(alerts.map((alert) => alert.type)).toEqual(["INGRESO_TARDE"]);
    expect(alerts[0]!.differenceMinutes).toBe(450);
  });

  it("Juanchi: sereno 19–07 sale 07:05 sin pregunta; olvido de la salida del lunes 07–15 y SALIDA a las 02:55 del martes (bloque 03:00) → pregunta", async () => {
    let juanchi = employee[PLANTA_EMPLOYEES.JUANCHI]!;
    await punch(juanchi, "IN", at(FRI_B, "19:03"));
    expect((await punch(juanchi, "OUT", at(SAT_B, "07:05"))).status).toBe(201);
    await drain(juanchi);
    expect((await shiftsOf(juanchi))[0]).toMatchObject({ scheduledStartAt: at(FRI_B, "19:00"), totalMinutes: 722 });
    await seed();
    juanchi = employee[PLANTA_EMPLOYEES.JUANCHI]!;
    await punch(juanchi, "IN", at(MON_B, "07:00"));
    const asked = await punch(juanchi, "OUT", at(TUE_B, "02:55"));
    expect(asked.status).toBe(409);
    expect(asked.error?.code).toBe("CLOCK_EXIT_CONFIRMATION_REQUIRED");
  });

  it("Roberto (semana B, 17–03): 11:30 fuera de ventana → sin bloque, TURNO_NO_IDENTIFICADO no suprimido con el inicio de 17:00; 13:00 → asignado con INGRESO_ANTICIPADO de revisión", async () => {
    let roberto = employee[PLANTA_EMPLOYEES.ROBERTO]!;
    await punch(roberto, "IN", at(MON_B, "11:30"));
    await drain(roberto);
    const [early] = await shiftsOf(roberto);
    expect(early).toMatchObject({ shiftTemplateId: null, shiftTemplateSource: null, scheduledStartAt: null });
    expect(await alertsOf(early!.id)).toEqual([expect.objectContaining({ type: "TURNO_NO_IDENTIFICADO", scheduledAt: at(MON_B, "17:00"), differenceMinutes: -330 })]);
    await seed();
    roberto = employee[PLANTA_EMPLOYEES.ROBERTO]!;
    await punch(roberto, "IN", at(MON_B, "13:00"));
    await drain(roberto);
    const [assigned] = await shiftsOf(roberto);
    expect(assigned).toMatchObject({ scheduledStartAt: at(MON_B, "17:00"), shiftTemplateSource: "ROTATION" });
    expect(await alertsOf(assigned!.id)).toEqual([expect.objectContaining({ type: "INGRESO_ANTICIPADO", severity: "ADVERTENCIA", differenceMinutes: -240 })]);
  });

  it("feriado con convocatoria: el bloque de la convocatoria (HOLIDAY_CONVOCATION) gobierna entrada y salida", async () => {
    const feriado = await holder.doubleHourRule.create({ data: { name: "Feriado IT", recurrenceType: "FECHA", fromDate: day(SAT_A), toDate: day(SAT_A), multiplier: 2, kind: "FERIADO", reason: "it" } });
    await holder.specialHourRuleDate.create({ data: { ruleId: feriado.id, date: day(SAT_A) } });
    await holder.holidayWorkAssignment.create({ data: { employeeId: jose(), date: day(SAT_A), shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id]! } });
    await punch(jose(), "IN", at(SAT_A, "07:05"));
    expect((await punch(jose(), "OUT", at(SAT_A, "15:10"))).status).toBe(201);
    await drain(jose());
    const [shift] = await shiftsOf(jose());
    expect(shift).toMatchObject({ shiftTemplateSource: "HOLIDAY_CONVOCATION", shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id], scheduledStartAt: at(SAT_A, "07:00") });
    expect(await alertsOf(shift!.id)).toEqual([]);
  });

  it("franco: la fichada se registra sin bloque y sólo genera ACTIVIDAD_EN_FRANCO (nunca TURNO_NO_IDENTIFICADO además)", async () => {
    await holder.employeeDayOff.create({ data: { employeeId: jose(), date: day(THU_A), createdByUserId: users.rrhh } });
    await punch(jose(), "IN", at(THU_A, "08:00"));
    await drain(jose());
    const [shift] = await shiftsOf(jose());
    expect(shift!.shiftTemplateSource).toBeNull();
    expect((await alertsOf(shift!.id)).map((alert) => alert.type)).toEqual(["ACTIVIDAD_EN_FRANCO"]);
  });

  it("REST (Carlos viernes A): trabajo no programado, sin bloque, TURNO_NO_IDENTIFICADO provisional", async () => {
    const carlos = employee[PLANTA_EMPLOYEES.CARLOS]!;
    await punch(carlos, "IN", at(FRI_A, "10:00"));
    await drain(carlos);
    const [shift] = await shiftsOf(carlos);
    expect(shift).toMatchObject({ shiftTemplateId: null, shiftTemplateSource: null });
    expect((await alertsOf(shift!.id)).map((alert) => alert.type)).toEqual(["TURNO_NO_IDENTIFICADO"]);
  });

  it("MISSING y CONFLICT: POSSIBLE_SHIFT_CONFIGURATION_MISSING sin plantilla arbitraria; un solo aviso por persona y día aunque fiche dos veces", async () => {
    const missing = employee["emp-missing"]!;
    await punch(missing, "IN", at(FRI_A, "08:00"));
    await punch(missing, "OUT", at(FRI_A, "09:00"));
    await punch(missing, "IN", at(FRI_A, "10:00"));
    await drain(missing);
    const shifts = await shiftsOf(missing);
    expect(shifts.every((shift) => shift.shiftTemplateId === null)).toBe(true);
    for (const shift of shifts) expect((await alertsOf(shift.id)).map((alert) => alert.type)).toEqual(["POSSIBLE_SHIFT_CONFIGURATION_MISSING"]);
    const configNotices = (await noticesFor(users.rrhh)).filter((notice) => notice.title === "Revisar configuración de turno");
    expect(configNotices).toHaveLength(1);
    expect(configNotices[0]!.message).toContain("no tiene un turno configurado");
    const conflict = employee["emp-conflict"]!;
    await punch(conflict, "IN", at(FRI_A, "08:00"));
    await drain(conflict);
    const [conflictShift] = await shiftsOf(conflict);
    expect(conflictShift!.shiftTemplateId).toBeNull();
    expect((await alertsOf(conflictShift!.id)).map((alert) => alert.type)).toEqual(["POSSIBLE_SHIFT_CONFIGURATION_MISSING"]);
    expect((await noticesFor(users.rrhh)).some((notice) => notice.message.includes("configuración contradictoria"))).toBe(true);
  });

  it("legacy: Juanjo (turno fijo) conserva el comportamiento anterior: 409 con la jornada abierta, sin bloque ni diagnóstico de rotación", async () => {
    const juanjo = employee[PLANTA_EMPLOYEES.JUANJO]!;
    expect((await punch(juanjo, "IN", at(FRI_A, "07:00"))).status).toBe(201);
    const second = await punch(juanjo, "IN", at(FRI_A, "19:00"));
    expect(second.status).toBe(409);
    expect(second.error?.code).toBe("CLOCK_ALREADY_OPEN");
    expect((await punch(juanjo, "OUT", at(FRI_A, "21:00"))).status).toBe(201);
    await drain(juanjo);
    const [shift] = await shiftsOf(juanjo);
    expect(shift).toMatchObject({ status: "PROCESADO", shiftTemplateSource: null, scheduledStartAt: null, shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id] });
    expect((await auditAfter(shift!.id)).every((after) => after && !("rotationDiagnosis" in after))).toBe(true);
  });
});
