/**
 * R4.9C.2 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.18) contra PostgreSQL REAL: simulación
 * integral de fichadas, jornadas, horas, incidentes y avisos con la configuración de Planta de
 * R4.9C.1, cargada y ACTIVADA por las API de administración (JWT de RRHH) con membresías de vigencia
 * futura respecto del reloj de pruebas. Fichadas por la app (createApp → /clock/photo-punch con
 * dispositivo real), post-proceso durable drenado y el mantenimiento real (`maintainClockPunchAttempts`)
 * ejecutado por ticks. El reloj del proceso (`Date`) es controlado: nunca se toca la fecha del sistema.
 *
 * Parámetros de QA (NO son política aprobada de Planta): entrada anterior 30 (única decisión
 * operativa), entrada posterior 10, salida anterior/posterior 20, límite absoluto 1200, mínimo y
 * máximo informativo NULL, olvido de salida NULL. Las alertas que dependen de ellos describen el
 * motor con esos valores, no reglas definitivas.
 *
 * Aislamiento: storage primario en memoria; Google Drive bloqueado (cualquier llamada falla el caso);
 * los avisos son SystemNotification internas (no hay correo ni push en el backend). Empleados y
 * usuarios ficticios.
 *
 * Opt-in: sólo corre con `PLANTA_SIM_IT_DATABASE_URL` → `localhost`, base `clock_it*` PROPIA con el
 * schema de este commit. VACÍA la base antes de cada caso. Nunca usa el DATABASE_URL del .env y
 * verifica `current_database()`.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PLANTA_ANCHOR, PLANTA_CREWS, PLANTA_EMPLOYEES, PLANTA_EXPECTED_TWO_WEEKS, PLANTA_TEMPLATES, plantaDays } from "../shifts/plantaRotation.fixture";

const url = process.env.PLANTA_SIM_IT_DATABASE_URL;

const external = vi.hoisted(() => ({ drive: 0 }));
// O2: retiene la PRÓXIMA subida de foto (la fichada queda con su intento PROCESSING y su instante ya tomado).
type UploadHold = { entered: () => void; release: Promise<void>; fail: boolean };
const uploadGate = vi.hoisted(() => ({ next: null as UploadHold | null }));

vi.mock("../../shared/storage/neonObjectStorage.provider", async () => {
  const { provider } = (await import("../../shared/testing/inMemoryObjectStorage")).inMemoryObjectStorage;
  return {
    neonObjectStorageProvider: {
      ...provider,
      async upload(input: Parameters<typeof provider.upload>[0]) {
        const hold = uploadGate.next;
        if (hold) {
          uploadGate.next = null;
          hold.entered();
          await hold.release;
          if (hold.fail) throw new Error("storage no disponible (simulado)");
        }
        return provider.upload(input);
      },
    },
  };
});
vi.mock("../../shared/storage/googleDriveStorage.provider", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../shared/storage/googleDriveStorage.provider")>();
  const blocked = async () => {
    external.drive += 1;
    throw new Error("Google Drive bloqueado en la simulación R4.9C.2");
  };
  return {
    ...original,
    isGoogleDriveConfigured: () => false,
    findGoogleDriveArchiveCopy: blocked,
    googleDriveStorageProvider: { ...original.googleDriveStorageProvider, upload: blocked, delete: blocked, download: blocked, exists: blocked },
  };
});

const PHOTO = `data:image/jpeg;base64,${Buffer.alloc(6000, 1).toString("base64")}`;
const at = (dateKey: string, time: string) => new Date(`${dateKey}T${time}:00-03:00`);
const day = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);
const addDays = (dateKey: string, days: number) => {
  const date = day(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string) => Math.round((day(to).getTime() - day(from).getTime()) / 86_400_000);
const plusMinutes = (instant: Date, minutes: number) => new Date(instant.getTime() + minutes * 60_000);

// Reloj de configuración: viernes previo al ancla (las membresías del 02/11 son futuras).
const SETUP_DAY = "2026-10-30";
// Semana A: lunes 02/11/2026; Semana B: lunes 09/11/2026; vuelve A el lunes 16/11.
const MON_A = "2026-11-02";
const TUE_A = "2026-11-03";
const WED_A = "2026-11-04";
const THU_A = "2026-11-05";
const FRI_A = "2026-11-06";
const SAT_A = "2026-11-07";
const MON_B = "2026-11-09";
const TUE_B = "2026-11-10";
const WED_B = "2026-11-11"; // feriado de QA en los casos de feriado
const FRI_B = "2026-11-13";
const SAT_B = "2026-11-14";
const SUN_B = "2026-11-15";
const MON_A2 = "2026-11-16";
const TUE_A2 = "2026-11-17";

const QA_TOLERANCES = {
  entryToleranceBeforeMinutes: 30,
  entryToleranceAfterMinutes: 10,
  exitToleranceBeforeMinutes: 20,
  exitToleranceAfterMinutes: 20,
  minimumMinutesForCompliance: null,
  maximumInformativeMinutes: null,
  missingOutAlertAfterMinutes: null,
  absoluteOpenShiftLimitMinutes: 1200,
} as const;

const AJENO = "emp-ajeno"; // Oficina L–V 08–16, fuera de la rotación y con historia
const PEOPLE = [...Object.values(PLANTA_EMPLOYEES), AJENO];
const ROTATING = Object.keys(PLANTA_EXPECTED_TWO_WEEKS);

type Modules = {
  env: typeof import("../../config/env").env;
  prisma: typeof import("../../shared/prisma/client").prisma;
  worker: typeof import("./clockPunchPostProcess.worker");
  maintenance: typeof import("../time-entries/clockPunchMaintenance");
  missing: typeof import("../time-entries/missingEntry.service");
  inactivity: typeof import("../time-entries/attendanceInactivity.service");
  openShift: typeof import("../shifts/openShiftMonitor.service");
  repo: typeof import("../time-entries/timeEntries.repository").timeEntriesRepository;
  timeEntries: typeof import("../time-entries/timeEntries.service");
  workday: typeof import("../shifts/expectedWorkday");
};
type Api = { status: number; data: any; error: { code: string; message: string; details?: any; clockGuidance?: any } | undefined; requestId?: string };
type Planned = { person: string; dateKey: string; start: Date; end: Date; code: string };

/** Bloques programados según la especificación (independiente del resolver). */
function planned(person: string, dateKey: string): Planned[] {
  const weekday = day(dateKey).getUTCDay();
  let spec: string;
  if (person === PLANTA_EMPLOYEES.JUANJO) spec = weekday >= 1 && weekday <= 5 ? "07-15" : "REST";
  else if (person === AJENO) spec = weekday >= 1 && weekday <= 5 ? "08-16" : "REST";
  else spec = PLANTA_EXPECTED_TWO_WEEKS[person]![((daysBetween(PLANTA_ANCHOR, dateKey) % 14) + 14) % 14]!;
  if (spec === "REST") return [];
  return spec.split("+").map((part) => {
    const [from, to] = part.split("-") as [string, string];
    return {
      person,
      dateKey,
      start: at(dateKey, `${from}:00`),
      end: at(to <= from ? addDays(dateKey, 1) : dateKey, `${to}:00`),
      code: person === AJENO ? "OF-08-16" : `PLANTA-${part}`,
    };
  });
}
const durationOf = (block: Planned) => (block.end.getTime() - block.start.getTime()) / 60_000;

// Los escenarios avanzan el reloj con ticks del mantenimiento real (decenas de
// consultas por tick): en el runner de CI tardan ~2,4× lo local y superaban el
// timeout por defecto de 5 s. Un caso vencido sigue corriendo en segundo plano
// (mueve el reloj y escribe) y arrastra a los siguientes; por eso un margen
// explícito. El ciclo completo conserva el suyo (600 s).
const SCENARIO_TIMEOUT_MS = 60_000;

describe.skipIf(!url)("R4.9C.2 — simulación integral de Planta contra PostgreSQL local", { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let m: Modules;
  let holder: PrismaClient;
  let server: Server;
  let baseUrl: string;
  let device: { id: string; secret: string };
  let credentials: typeof import("../../shared/security/clockDeviceCredentials");
  const employee: Record<string, string> = {};
  const nameOf: Record<string, string> = {};
  const templateId: Record<string, string> = {};
  const users = { rrhh: { id: "", email: "", role: "" }, supervisorJose: "", otherSupervisor: "" };
  let rotationId = "";
  let historyHash = "";
  let fixedRobertoId = "";

  const id = (person: string) => employee[person]!;

  async function call(method: string, path: string, body?: unknown): Promise<Api> {
    const token = jwt.sign({ sub: users.rrhh.id, email: users.rrhh.email, role: users.rrhh.role }, m.env.JWT_ACCESS_SECRET, { expiresIn: "15m" });
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await response.json()) as { data?: unknown; error?: Api["error"] };
    return { status: response.status, data: json.data, error: json.error };
  }

  async function punch(person: string, punchType: "IN" | "OUT", instant: Date, extra: Record<string, unknown> = {}, requestId: string = randomUUID()): Promise<Api> {
    vi.setSystemTime(instant);
    const response = await fetch(`${baseUrl}/clock/photo-punch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `ClockDevice ${device.id}.${device.secret}` },
      body: JSON.stringify({ requestId, employeeId: id(person), punchType, photo: PHOTO, faceValidationStatus: "VALID", faceDetectionScore: 0.97, ...extra }),
    });
    const json = (await response.json()) as { data?: unknown; error?: Api["error"] };
    await m.worker.drainClockPunchPostProcess({ employeeIds: [id(person)] });
    return { status: response.status, data: json.data, error: json.error, requestId };
  }
  async function tick(instant: Date) {
    vi.setSystemTime(instant);
    await m.maintenance.maintainClockPunchAttempts();
  }
  /** Ticks del mantenimiento real cada `stepMinutes` en [from, to]. */
  async function ticks(from: Date, to: Date, stepMinutes = 30) {
    for (let time = from.getTime(); time <= to.getTime(); time += stepMinutes * 60_000) await tick(new Date(time));
  }

  const shiftsOf = (person: string) => holder.workShift.findMany({ where: { employeeId: id(person) }, orderBy: { startAt: "asc" } });
  const newShiftsOf = async (person: string) => (await shiftsOf(person)).filter((shift) => shift.startAt >= day("2026-11-01"));
  const minutesOf = async (workShiftId: string) => (await holder.timeEntry.findMany({ where: { workShiftId } })).reduce((sum, entry) => sum + entry.totalMinutes, 0);
  const alertsOf = (workShiftId: string) => holder.shiftAlert.findMany({ where: { workShiftId }, orderBy: { type: "asc" } });
  const alertTypes = async (workShiftId: string) => (await alertsOf(workShiftId)).map((alert) => alert.type);
  /** Avisos cuya entidad (alerta, incidente o jornada) es de esa persona; opcionalmente de un destinatario. */
  async function noticesAbout(person: string, recipientUserId?: string) {
    const employeeId = id(person);
    const [alerts, incidents, shifts] = await Promise.all([
      holder.shiftAlert.findMany({ where: { employeeId }, select: { id: true } }),
      holder.attendanceInactivityIncident.findMany({ where: { employeeId }, select: { id: true } }),
      holder.workShift.findMany({ where: { employeeId }, select: { id: true } }),
    ]);
    const entityIds = [...alerts, ...incidents, ...shifts].map((row) => row.id);
    return holder.systemNotification.findMany({ where: { entityId: { in: entityIds }, ...(recipientUserId ? { recipientUserId } : {}) }, orderBy: { createdAt: "asc" } });
  }
  /** Avisos sobre esas jornadas o sus alertas (los ticks generan faltas legítimas de otros días/personas). */
  async function noticesOnShifts(workShiftIds: string[]) {
    const alertIds = (await holder.shiftAlert.findMany({ where: { workShiftId: { in: workShiftIds } }, select: { id: true } })).map((row) => row.id);
    return holder.systemNotification.findMany({ where: { entityId: { in: [...workShiftIds, ...alertIds] } } });
  }
  const titlesAbout = async (person: string, recipientUserId?: string) => (await noticesAbout(person, recipientUserId)).map((notice) => notice.title);
  const notices = () => holder.systemNotification.findMany({ orderBy: { createdAt: "asc" } });
  const noticesFor = (recipientUserId: string) => holder.systemNotification.findMany({ where: { recipientUserId }, orderBy: { createdAt: "asc" } });
  const incidentsOf = (person: string, dateKey?: string) => holder.attendanceInactivityIncident.findMany({ where: { employeeId: id(person), ...(dateKey ? { operationalDate: day(dateKey) } : {}) }, orderBy: [{ operationalDate: "asc" }, { scheduledStartAt: "asc" }] });
  const hashRows = async (sql: string) => createHash("sha256").update(JSON.stringify(await holder.$queryRawUnsafe(sql))).digest("hex");

  /** Historia previa a la rotación + perfiles ajenos: debe quedar byte a byte igual. */
  async function historicalHash() {
    const roberto = id(PLANTA_EMPLOYEES.ROBERTO);
    const ajeno = id(AJENO);
    const juanjo = id(PLANTA_EMPLOYEES.JUANJO);
    return [
      await hashRows(`SELECT * FROM "WorkShift" WHERE "startAt" < '2026-11-01' ORDER BY id`),
      await hashRows(`SELECT * FROM "TimeEntry" WHERE "date" < '2026-11-01' ORDER BY id`),
      await hashRows(`SELECT * FROM "AttendancePunch" WHERE "timestamp" < '2026-11-01' ORDER BY id`),
      await hashRows(`SELECT * FROM "AttendanceInactivityIncident" WHERE "operationalDate" < '2026-11-01' ORDER BY id`),
      await hashRows(`SELECT * FROM "ShiftAssignment" WHERE "employeeId" IN ('${ajeno}', '${juanjo}') ORDER BY id`),
      await hashRows(`SELECT id, legajo, status, "firstName", "lastName" FROM "Employee" ORDER BY id`),
      await hashRows(`SELECT * FROM "ShiftAssignment" WHERE "employeeId" = '${roberto}' AND id <> '${fixedRobertoId}' ORDER BY id`),
    ].join("|");
  }

  async function seed() {
    vi.setSystemTime(at(SETUP_DAY, "09:00"));
    external.drive = 0;
    const tables = await m.prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await m.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);
    await m.prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WorkShift_one_open_per_employee" ON "WorkShift"("employeeId") WHERE status = 'ABIERTO' AND "endAt" IS NULL`);
    const normal = await holder.hourConcept.create({ data: { code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", systemRole: "NORMAL_BASE" } });
    const rrhhRow = await holder.user.create({ data: { name: "RRHH Simulación", email: "rrhh-sim@example.com", passwordHash: "x", role: "NIVEL_1_RRHH" } });
    users.rrhh = { id: rrhhRow.id, email: rrhhRow.email, role: rrhhRow.role };
    users.supervisorJose = (await holder.user.create({ data: { name: "Encargado ficticio", email: "sup-sim@example.com", passwordHash: "x", role: "NIVEL_2_SUPERVISION" } })).id;
    users.otherSupervisor = (await holder.user.create({ data: { name: "Otro encargado ficticio", email: "sup-otro-sim@example.com", passwordHash: "x", role: "NIVEL_2_SUPERVISION" } })).id;
    for (const [index, key] of PEOPLE.entries()) {
      const created = await holder.employee.create({ data: { legajo: `SIM-${index + 1}`, cuil: `20-7${index + 1}`, dni: `7${index + 1}`, firstName: "Ficticio", lastName: key.replace("emp-", "") } });
      employee[key] = created.id;
      nameOf[created.id] = key;
      await holder.laborMovement.create({ data: { employeeId: created.id, type: "ALTA", effectiveFrom: day("2026-01-01"), reason: "Ingreso ficticio" } });
    }
    await holder.employeeAssignment.create({ data: { employeeId: id(PLANTA_EMPLOYEES.JOSE), userId: users.supervisorJose, type: "TIME_RESPONSIBLE", status: "ACTIVO" } });

    const group = await call("POST", "/shifts/groups", { code: "PLANTA", name: "Planta" });
    expect(group.status, JSON.stringify(group.error)).toBe(201);
    for (const template of Object.values(PLANTA_TEMPLATES)) {
      const created = await call("POST", "/workforce/shift-templates", { code: template.code, name: template.code, startTime: template.startTime, endTime: template.endTime, shiftGroupId: group.data.id, ...QA_TOLERANCES });
      expect(created.status, JSON.stringify(created.error)).toBe(201);
      templateId[template.id] = created.data.id;
    }
    const oficina = await call("POST", "/workforce/shift-templates", { code: "OF-08-16", name: "Oficina", startTime: "08:00", endTime: "16:00", entryToleranceBeforeMinutes: 10, entryToleranceAfterMinutes: 10, exitToleranceBeforeMinutes: 20, exitToleranceAfterMinutes: 20 });
    expect(oficina.status, JSON.stringify(oficina.error)).toBe(201);
    templateId.OFICINA = oficina.data.id;

    // Historia previa (antes de la rotación): turno fijo de Roberto y de un perfil ajeno, una jornada
    // procesada, horas y un incidente revisado fuera de la vigencia de la membresía.
    fixedRobertoId = (await holder.shiftAssignment.create({ data: { employeeId: id(PLANTA_EMPLOYEES.ROBERTO), shiftTemplateId: templateId[PLANTA_TEMPLATES.T0717.id]!, effectiveFrom: day("2026-10-01"), weekdays: [1, 2, 3, 4, 5] } })).id;
    await holder.shiftAssignment.create({ data: { employeeId: id(AJENO), shiftTemplateId: templateId.OFICINA!, effectiveFrom: day("2026-10-01"), weekdays: [1, 2, 3, 4, 5] } });
    for (const person of [PLANTA_EMPLOYEES.ROBERTO, AJENO]) {
      const start = person === AJENO ? at("2026-10-28", "08:00") : at("2026-10-28", "07:00");
      const end = plusMinutes(start, person === AJENO ? 480 : 600);
      const inPunch = await holder.attendancePunch.create({ data: { employeeId: id(person), type: "INGRESO", timestamp: start } });
      const outPunch = await holder.attendancePunch.create({ data: { employeeId: id(person), type: "SALIDA", timestamp: end } });
      const shift = await holder.workShift.create({ data: { employeeId: id(person), source: "PUBLIC_CLOCK_PHOTO", status: "PROCESADO", startAt: start, endAt: end, startPunchId: inPunch.id, endPunchId: outPunch.id, totalMinutes: (end.getTime() - start.getTime()) / 60_000 } });
      await holder.timeEntry.create({ data: { employeeId: id(person), hourConceptId: normal.id, workShiftId: shift.id, date: day("2026-10-28"), period: "2026-10", day: 28, hours: 10, totalMinutes: shift.totalMinutes!, status: "APROBADO", source: "PUBLIC_CLOCK_PHOTO" } });
    }
    await holder.attendanceInactivityIncident.create({ data: { employeeId: id(PLANTA_EMPLOYEES.ROBERTO), operationalDate: day("2026-10-20"), observation: "histórico", status: "RESUELTA", reviewedAt: at("2026-10-21", "10:00"), reviewedByUserId: users.rrhh.id, reviewNote: "justificado", notifiedAt: at("2026-10-20", "07:10") } });

    const juanjoFixed = await call("POST", "/shifts/assignments", { employeeIds: [id(PLANTA_EMPLOYEES.JUANJO)], shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id], effectiveFrom: MON_A, weekdays: [1, 2, 3, 4, 5] });
    expect(juanjoFixed.status, JSON.stringify(juanjoFixed.error)).toBe(201);
    historyHash = await historicalHash();

    // Rotación por la API: INACTIVA → equipos → versión → altas futuras (cierra el fijo de Roberto) → activación.
    const created = await call("POST", "/shifts/rotations", { code: "planta", name: "Planta Mañana/Tarde", shiftGroupId: group.data.id });
    expect(created.status, JSON.stringify(created.error)).toBe(201);
    rotationId = created.data.id;
    const crewIds: Record<string, string> = {};
    for (const [index, [key, fixtureId]] of Object.entries(PLANTA_CREWS).entries()) {
      const crew = await call("POST", `/shifts/rotations/${rotationId}/crews`, { code: key.replace("_", "-"), name: key.replace("_", " + "), sortOrder: index });
      expect(crew.status, JSON.stringify(crew.error)).toBe(201);
      crewIds[fixtureId] = crew.data.id;
    }
    const days = plantaDays().map((fixture) => ({ crewId: crewIds[fixture.crewId]!, cycleWeekIndex: fixture.cycleWeekIndex, weekday: fixture.weekday, kind: fixture.kind, blocks: fixture.blocks.map((block) => ({ blockIndex: block.blockIndex, shiftTemplateId: templateId[block.template.id]! })) }));
    const version = await call("POST", `/shifts/rotations/${rotationId}/versions`, { effectiveFrom: PLANTA_ANCHOR, cycleLengthWeeks: 2, anchorWeekStart: PLANTA_ANCHOR, days });
    expect(version.status, JSON.stringify(version.error)).toBe(201);
    const members: Array<[string, string]> = [
      [PLANTA_EMPLOYEES.ROBERTO, PLANTA_CREWS.ROBERTO_ARIEL],
      [PLANTA_EMPLOYEES.ARIEL, PLANTA_CREWS.ROBERTO_ARIEL],
      [PLANTA_EMPLOYEES.CARLOS, PLANTA_CREWS.CARLOS_WALTER],
      [PLANTA_EMPLOYEES.WALTER, PLANTA_CREWS.CARLOS_WALTER],
      [PLANTA_EMPLOYEES.JUANCHI, PLANTA_CREWS.JUANCHI],
      [PLANTA_EMPLOYEES.JOSE, PLANTA_CREWS.JOSE],
      [PLANTA_EMPLOYEES.JOHANNA, PLANTA_CREWS.JOHANNA],
    ];
    for (const [person, crew] of members) {
      const added = await call("POST", `/shifts/rotations/${rotationId}/crews/${crewIds[crew]}/members`, { employeeIds: [id(person)], effectiveFrom: PLANTA_ANCHOR, closeFixedAssignments: person === PLANTA_EMPLOYEES.ROBERTO });
      expect(added.status, JSON.stringify(added.error)).toBe(201);
    }
    const activated = await call("POST", `/shifts/rotations/${rotationId}/activate`);
    expect(activated.status, JSON.stringify(activated.error)).toBe(200);

    const secret = credentials.generateClockDeviceSecret();
    const createdDevice = await holder.clockDevice.create({ data: { name: "SIM R4.9C.2", status: "ACTIVE", tokenHash: credentials.hashClockDeviceSecret(secret), activatedAt: new Date(), lastSeenAt: new Date() } });
    device = { id: createdDevice.id, secret };
  }

  async function holiday(dateKey: string) {
    const rule = await holder.doubleHourRule.create({ data: { name: "Feriado de QA", recurrenceType: "FECHA", fromDate: day(dateKey), toDate: day(dateKey), multiplier: 2, kind: "FERIADO", reason: "qa" } });
    await holder.specialHourRuleDate.create({ data: { ruleId: rule.id, date: day(dateKey) } });
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("PLANTA_SIM_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    for (const name of ["STORAGE_PROVIDER", "DEFAULT_STORAGE_PROVIDER", "DOCUMENT_STORAGE_PROVIDER"]) process.env[name] = "local";
    // El reloj controlado vuelve a la misma fecha en cada caso: los limitadores en memoria acumularían
    // cientos de llamadas de configuración en la misma ventana. Sólo en este proceso de prueba.
    Object.assign(process.env, { RATE_LIMIT_MAX: "100000", CLOCK_IP_RATE_LIMIT_MAX: "20000", CLOCK_PUNCH_RATE_LIMIT_MAX: "1000", CLOCK_ATTEMPT_RATE_LIMIT_MAX: "5000" });
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ createApp }, { env }, { prisma }, worker, maintenance, missing, inactivity, openShift, { timeEntriesRepository }, timeEntries, workday, creds] = await Promise.all([
      import("../../app"),
      import("../../config/env"),
      import("../../shared/prisma/client"),
      import("./clockPunchPostProcess.worker"),
      import("../time-entries/clockPunchMaintenance"),
      import("../time-entries/missingEntry.service"),
      import("../time-entries/attendanceInactivity.service"),
      import("../shifts/openShiftMonitor.service"),
      import("../time-entries/timeEntries.repository"),
      import("../time-entries/timeEntries.service"),
      import("../shifts/expectedWorkday"),
      import("../../shared/security/clockDeviceCredentials"),
    ]);
    m = { env, prisma, worker, maintenance, missing, inactivity, openShift, repo: timeEntriesRepository, timeEntries, workday };
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
    await seed();
  }, 120_000);

  afterEach(async () => {
    // Nunca un proveedor externo real; toda evidencia en el storage en memoria.
    expect(external.drive).toBe(0);
    expect(await holder.storageFile.count({ where: { storageProvider: { not: "NEON_OBJECT_STORAGE" } } })).toBe(0);
  });

  afterAll(async () => {
    vi.useRealTimers();
    m?.worker.stopClockPunchPostProcessWorker();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await m?.prisma.$disconnect();
    await holder?.$disconnect();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  // ── 1, 5, 6, 8, 9, 13, 14 — ciclo completo A → B → A con fichadas normales ──────────────────

  it("ciclo completo 02/11–17/11: cada bloque programado genera UNA jornada con su bloque, minutos reales y sin incidentes ni avisos", async () => {
    const dates = Array.from({ length: 16 }, (_, index) => addDays(MON_A, index));
    const blocks = PEOPLE.flatMap((person) => dates.flatMap((dateKey) => planned(person, dateKey)));
    const horizon = at(TUE_A2, "12:00");
    type Step = { time: Date; run: () => Promise<unknown> };
    const steps: Step[] = blocks.flatMap((block) => [
      { time: plusMinutes(block.start, -5), run: () => punch(block.person, "IN", plusMinutes(block.start, -5)) },
      { time: plusMinutes(block.end, 5), run: () => punch(block.person, "OUT", plusMinutes(block.end, 5)) },
    ]);
    for (let time = at(MON_A, "00:00").getTime(); time <= horizon.getTime(); time += 30 * 60_000) steps.push({ time: new Date(time), run: () => tick(new Date(time)) });
    steps.sort((a, b) => a.time.getTime() - b.time.getTime());
    for (const step of steps) {
      const result = await step.run();
      if (result && typeof result === "object" && "status" in result) expect((result as Api).status, `${step.time.toISOString()} ${JSON.stringify((result as Api).error)}`).toBe(201);
    }

    const mismatches: string[] = [];
    let total = 0;
    for (const person of PEOPLE) {
      const shifts = await newShiftsOf(person);
      const expected = blocks.filter((block) => block.person === person);
      total += shifts.length;
      if (shifts.length !== expected.length) mismatches.push(`${person}: ${shifts.length} jornadas, ${expected.length} bloques`);
      for (const [index, block] of expected.entries()) {
        const shift = shifts[index];
        const rotating = ROTATING.includes(person);
        const got = shift && {
          status: shift.status,
          source: shift.shiftTemplateSource,
          scheduledStartAt: shift.scheduledStartAt?.toISOString() ?? null,
          template: shift.shiftTemplateId,
          startAt: shift.startAt.toISOString(),
          totalMinutes: shift.totalMinutes,
          segmentMinutes: (await holder.timeSegment.findMany({ where: { workShiftId: shift.id } })).reduce((sum, segment) => sum + segment.minutes, 0),
        };
        const want = {
          status: "PROCESADO",
          source: rotating ? "ROTATION" : null,
          scheduledStartAt: rotating ? block.start.toISOString() : null,
          template: templateId[person === AJENO ? "OFICINA" : block.code]!,
          startAt: plusMinutes(block.start, -5).toISOString(),
          totalMinutes: durationOf(block) + 10,
          segmentMinutes: durationOf(block) + 10,
        };
        if (JSON.stringify(got) !== JSON.stringify(want)) mismatches.push(`${person} ${block.dateKey} ${block.code}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(total).toBe(blocks.length);

    // Horas: TimeEntry es el agregado diario canónico (una NORMAL por persona y día calendario, ligada al
    // último tramo); un nocturno reparte sus minutos en dos días. Por día: horas = tramos; en total: = jornadas.
    const segments = await holder.timeSegment.findMany({ where: { date: { gte: day(MON_A) } } });
    const entries = await holder.timeEntry.findMany({ where: { date: { gte: day(MON_A) } } });
    const byDay = new Map<string, { segments: number; entries: number }>();
    for (const segment of segments) {
      const key = `${nameOf[segment.employeeId]}|${segment.date.toISOString().slice(0, 10)}`;
      byDay.set(key, { segments: (byDay.get(key)?.segments ?? 0) + segment.minutes, entries: byDay.get(key)?.entries ?? 0 });
    }
    for (const entry of entries) {
      const key = `${nameOf[entry.employeeId]}|${entry.date.toISOString().slice(0, 10)}`;
      byDay.set(key, { segments: byDay.get(key)?.segments ?? 0, entries: (byDay.get(key)?.entries ?? 0) + entry.totalMinutes });
    }
    expect([...byDay.entries()].filter(([, value]) => value.segments !== value.entries)).toEqual([]);
    expect(entries.reduce((sum, entry) => sum + entry.totalMinutes, 0)).toBe(blocks.reduce((sum, block) => sum + durationOf(block) + 10, 0));
    expect(new Set(entries.map((entry) => `${entry.employeeId}|${entry.date.toISOString()}|${entry.hourConceptId}`)).size).toBe(entries.length);

    const alerts = await holder.shiftAlert.findMany({ include: { workShift: true }, orderBy: { createdAt: "asc" } });
    expect(alerts.map((alert) => `${nameOf[alert.employeeId]} ${alert.type} ${alert.workShift?.scheduledStartAt?.toISOString() ?? alert.workShift?.startAt.toISOString()}`)).toEqual([]);
    expect(await holder.attendanceInactivityIncident.count({ where: { operationalDate: { gte: day(MON_A) } } })).toBe(0);
    expect(await holder.systemNotification.count()).toBe(0);

    // 14 — Novedades: minutos esperados por fecha operativa = bloques programados; lo fichado = +10 por bloque.
    const workdays = await m.workday.resolveExpectedWorkdays(ROTATING.map(id), day(MON_A), day(SUN_B), m.prisma);
    const workdayMismatches: string[] = [];
    for (const person of ROTATING) {
      for (const dateKey of dates.slice(0, 14)) {
        const dayBlocks = planned(person, dateKey);
        const expectedMinutes = dayBlocks.reduce((sum, block) => sum + durationOf(block), 0);
        const resolved = workdays.get(id(person))!.get(dateKey)!;
        const workedShifts = (await newShiftsOf(person)).filter((shift) => shift.scheduledStartAt && dayBlocks.some((block) => block.start.getTime() === shift.scheduledStartAt!.getTime()));
        const worked = workedShifts.reduce((sum, shift) => sum + (shift.totalMinutes ?? 0), 0);
        const got = { obligation: resolved.obligation, expectedMinutes: resolved.expectedMinutes, worked };
        const want = { obligation: dayBlocks.length ? "WORKDAY" : "NO_WORK_OBLIGATION", expectedMinutes, worked: expectedMinutes + 10 * dayBlocks.length };
        if (JSON.stringify(got) !== JSON.stringify(want)) workdayMismatches.push(`${person} ${dateKey}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      }
    }
    expect(workdayMismatches).toEqual([]);

    // Historia y perfiles ajenos intactos; el fijo de Roberto cerrado el día anterior al alta (contrato administrativo).
    expect(await historicalHash()).toBe(historyHash);
    expect(await holder.shiftAssignment.findUniqueOrThrow({ where: { id: fixedRobertoId } })).toMatchObject({ status: "HABILITADO", effectiveTo: day("2026-11-01") });
  }, 600_000);

  // ── 2 — entrada anticipada con tolerancia 30 ────────────────────────────────────────────────

  it("entrada anticipada −29 y −30: sin alerta; −31: INGRESO_ANTICIPADO con la diferencia real; minutos reales en los tres casos", async () => {
    const johanna = PLANTA_EMPLOYEES.JOHANNA;
    const cases = [[TUE_A, "06:31", -29], [WED_A, "06:30", -30], [THU_A, "06:29", -31]] as const;
    for (const [dateKey, time] of cases) {
      expect((await punch(johanna, "IN", at(dateKey, time))).status).toBe(201);
      expect((await punch(johanna, "OUT", at(dateKey, "15:00"))).status).toBe(201);
    }
    const shifts = await newShiftsOf(johanna);
    expect(shifts.map((shift) => [shift.shiftTemplateSource, shift.scheduledStartAt?.toISOString(), shift.totalMinutes])).toEqual([
      ["ROTATION", at(TUE_A, "07:00").toISOString(), 509],
      ["ROTATION", at(WED_A, "07:00").toISOString(), 510],
      ["ROTATION", at(THU_A, "07:00").toISOString(), 511],
    ]);
    for (const shift of shifts) expect(await minutesOf(shift.id)).toBe(shift.totalMinutes);
    expect(await alertsOf(shifts[0]!.id)).toEqual([]);
    expect(await alertsOf(shifts[1]!.id)).toEqual([]);
    expect(await alertsOf(shifts[2]!.id)).toEqual([expect.objectContaining({ type: "INGRESO_ANTICIPADO", differenceMinutes: -31, scheduledAt: at(THU_A, "07:00") })]);
    // Registro del comportamiento de avisos con los parámetros de QA (no es política aprobada).
    expect(await titlesAbout(johanna)).toEqual(["Ingreso anticipado"]);
  });

  // ── 3 — ingreso tardío ──────────────────────────────────────────────────────────────────────

  it("ingreso tardío: +10 sin alerta; +11 INGRESO_TARDE con aviso al encargado y a RRHH; la falta de ingreso del bloque se resuelve con la entrada", async () => {
    const jose = PLANTA_EMPLOYEES.JOSE;
    await tick(at(TUE_A, "07:09"));
    expect((await punch(jose, "IN", at(TUE_A, "07:10"))).status).toBe(201);
    await punch(jose, "OUT", at(TUE_A, "15:00"));
    // O2 (§25.19): la falta vence a +10:30, la misma frontera en que la entrada pasa a ser tardía.
    await tick(at(WED_A, "07:10"));
    expect(await incidentsOf(jose, WED_A)).toEqual([]);
    await tick(new Date(at(WED_A, "07:10").getTime() + 30_000));
    expect((await incidentsOf(jose, WED_A)).map((row) => [row.scheduledStartAt?.toISOString(), row.status])).toEqual([[at(WED_A, "07:00").toISOString(), "PENDIENTE"]]);
    expect((await punch(jose, "IN", at(WED_A, "07:11"))).status).toBe(201);
    await tick(at(WED_A, "07:12"));
    await punch(jose, "OUT", at(WED_A, "15:00"));
    const [tuesday, wednesday] = await newShiftsOf(jose);
    expect(await alertsOf(tuesday!.id)).toEqual([]);
    expect(await incidentsOf(jose, TUE_A)).toEqual([]);
    expect(await alertsOf(wednesday!.id)).toEqual([expect.objectContaining({ type: "INGRESO_TARDE", differenceMinutes: 11 })]);
    expect((await incidentsOf(jose, WED_A)).map((row) => [row.status, row.reviewedByUserId])).toEqual([["RESUELTA", null]]);
    expect(wednesday!.totalMinutes).toBe(469);
    const toSupervisor = (await titlesAbout(jose, users.supervisorJose)).sort();
    const toRrhh = (await titlesAbout(jose, users.rrhh.id)).sort();
    expect(toSupervisor).toEqual(toRrhh);
    expect(toRrhh).toEqual(["Falta de ingreso", "Ingreso fuera de tolerancia"].sort());
    expect(await noticesFor(users.otherSupervisor)).toEqual([]);
  });

  it("borde de tolerancia (O2 corregida, §25.19): el tick a +10:00 ya no vence; la entrada puntual de +10:00 no recibe falta ni aviso; +10:30 redondea a 11 y es tardía", async () => {
    const jose = PLANTA_EMPLOYEES.JOSE;
    // Martes: tick del mantenimiento real a las 07:10:00 y entrada en el mismo instante (antes de la corrección: falta + aviso).
    await tick(at(TUE_A, "07:10"));
    expect(await incidentsOf(jose, TUE_A)).toEqual([]);
    await punch(jose, "IN", at(TUE_A, "07:10"));
    await tick(at(TUE_A, "07:11"));
    await punch(jose, "OUT", at(TUE_A, "15:00"));
    const [tuesday] = await newShiftsOf(jose);
    expect(await alertsOf(tuesday!.id)).toEqual([]); // puntual: +10 no supera la tolerancia
    expect(await incidentsOf(jose, TUE_A)).toEqual([]);
    expect(await titlesAbout(jose, users.supervisorJose)).toEqual([]);
    // Miércoles: +10:30 se redondea a 11 → INGRESO_TARDE.
    await punch(jose, "IN", new Date(at(WED_A, "07:10").getTime() + 30_000));
    const [, wednesday] = await newShiftsOf(jose);
    expect((await alertsOf(wednesday!.id)).map((alert) => [alert.type, alert.differenceMinutes])).toEqual([["INGRESO_TARDE", 11]]);
  });

  // ── 4 — salida anticipada y tardía ──────────────────────────────────────────────────────────

  it("salida: −20 y +20 sin alerta; −21 SALIDA_ANTICIPADA; +21 SALIDA_TARDIA; minutos siempre reales", async () => {
    const johanna = PLANTA_EMPLOYEES.JOHANNA;
    const cases = [[MON_A, "14:40"], [TUE_A, "15:20"], [WED_A, "14:39"], [THU_A, "15:21"]] as const;
    for (const [dateKey, exit] of cases) {
      await punch(johanna, "IN", at(dateKey, "07:00"));
      expect((await punch(johanna, "OUT", at(dateKey, exit))).status).toBe(201);
    }
    const shifts = await newShiftsOf(johanna);
    expect(shifts.map((shift) => shift.totalMinutes)).toEqual([460, 500, 459, 501]);
    expect(await Promise.all(shifts.map((shift) => alertTypes(shift.id)))).toEqual([[], [], ["SALIDA_ANTICIPADA"], ["SALIDA_TARDIA"]]);
    expect((await alertsOf(shifts[2]!.id))[0]).toMatchObject({ differenceMinutes: -21, scheduledAt: at(WED_A, "15:00") });
    expect((await alertsOf(shifts[3]!.id))[0]).toMatchObject({ differenceMinutes: 21, scheduledAt: at(THU_A, "15:00") });
    for (const shift of shifts) expect(await minutesOf(shift.id)).toBe(shift.totalMinutes);
  });

  // ── 5 — nocturnos ───────────────────────────────────────────────────────────────────────────

  it("nocturnos 17–03 y 19–07: fecha operativa del inicio, salida contra el día siguiente, minutos reales; con ticks del mantenimiento durante la noche", async () => {
    const carlos = PLANTA_EMPLOYEES.CARLOS;
    const juanchi = PLANTA_EMPLOYEES.JUANCHI;
    await punch(carlos, "IN", at(MON_A, "16:40"));
    await punch(juanchi, "IN", at(FRI_B, "18:45"));
    await ticks(at(MON_A, "17:00"), at(TUE_A, "03:00"), 30);
    expect((await punch(carlos, "OUT", at(TUE_A, "03:15"))).status).toBe(201);
    await ticks(at(FRI_B, "19:00"), at(SAT_B, "07:00"), 30);
    expect((await punch(juanchi, "OUT", at(SAT_B, "07:12"))).status).toBe(201);
    const [carlosShift] = await newShiftsOf(carlos);
    const [juanchiShift] = await newShiftsOf(juanchi);
    expect(carlosShift).toMatchObject({ status: "PROCESADO", scheduledStartAt: at(MON_A, "17:00"), totalMinutes: 635 });
    expect(juanchiShift).toMatchObject({ status: "PROCESADO", scheduledStartAt: at(FRI_B, "19:00"), totalMinutes: 747 });
    const entries = await holder.timeEntry.findMany({ where: { workShiftId: { in: [carlosShift!.id, juanchiShift!.id] } }, orderBy: { date: "asc" } });
    expect(entries.reduce((sum, entry) => sum + entry.totalMinutes, 0)).toBe(635 + 747);
    expect(await alertTypes(carlosShift!.id)).toEqual([]);
    expect(await alertTypes(juanchiShift!.id)).toEqual([]);
    expect(await noticesOnShifts([carlosShift!.id, juanchiShift!.id])).toEqual([]);
    expect([...(await incidentsOf(carlos, MON_A)), ...(await incidentsOf(juanchi, FRI_B))]).toEqual([]);
  });

  // ── 6, 7 — José viernes A y cambio de bloque ────────────────────────────────────────────────

  it("José viernes A: 07–11 y 19–07 son dos jornadas independientes con su bloque; sin alertas ni avisos", async () => {
    const jose = PLANTA_EMPLOYEES.JOSE;
    await punch(jose, "IN", at(FRI_A, "06:40"));
    expect((await punch(jose, "OUT", at(FRI_A, "11:10"))).status).toBe(201);
    await punch(jose, "IN", at(FRI_A, "18:35"));
    await ticks(at(FRI_A, "19:00"), at(SAT_A, "07:00"), 30);
    expect((await punch(jose, "OUT", at(SAT_A, "07:15"))).status).toBe(201);
    const shifts = await newShiftsOf(jose);
    expect(shifts.map((shift) => [shift.shiftTemplateId, shift.scheduledStartAt?.toISOString(), shift.totalMinutes, shift.status])).toEqual([
      [templateId[PLANTA_TEMPLATES.T0711.id], at(FRI_A, "07:00").toISOString(), 270, "PROCESADO"],
      [templateId[PLANTA_TEMPLATES.T1907.id], at(FRI_A, "19:00").toISOString(), 760, "PROCESADO"],
    ]);
    for (const shift of shifts) expect(await alertTypes(shift.id)).toEqual([]);
    expect(await titlesAbout(jose)).toEqual([]);
    expect(await incidentsOf(jose, FRI_A)).toEqual([]);
  });

  it("cambio de bloque con la jornada anterior abierta: B1 FALTA_SALIDA sin salida ni horas ficticias, B2 abierta con su bloque; un solo aviso por destinatario", async () => {
    const jose = PLANTA_EMPLOYEES.JOSE;
    await punch(jose, "IN", at(FRI_A, "06:58"));
    await ticks(at(FRI_A, "07:30"), at(FRI_A, "18:30"), 60);
    expect((await punch(jose, "IN", at(FRI_A, "18:50"))).status).toBe(201);
    await tick(at(FRI_A, "19:30"));
    const [b1, b2] = await newShiftsOf(jose);
    expect(b1).toMatchObject({ status: "FALTA_SALIDA", endAt: null, endPunchId: null, totalMinutes: null, scheduledStartAt: at(FRI_A, "07:00") });
    expect(await minutesOf(b1!.id)).toBe(0);
    expect(b2).toMatchObject({ status: "ABIERTO", shiftTemplateSource: "ROTATION", scheduledStartAt: at(FRI_A, "19:00") });
    expect(await holder.attendancePunch.count({ where: { employeeId: id(jose), type: "SALIDA" } })).toBe(0);
    const toSupervisor = await titlesAbout(jose, users.supervisorJose);
    expect(toSupervisor.filter((title) => title === "Falta registrar la salida")).toHaveLength(1);
    expect(toSupervisor).toEqual(await titlesAbout(jose, users.rrhh.id));
    // B1 (07–11) abierta desde las 06:58: el posible olvido a las 10 h es legítimo; luego la falta de salida.
    expect(toSupervisor).toEqual(["Posible olvido de salida", "Falta registrar la salida"]);
    expect(await incidentsOf(jose, FRI_A)).toEqual([]);
  });

  // ── 8, 9 — transiciones domingo→lunes y Juanchi tras el fin de semana de sereno ───────────────

  it("domingo→lunes: Roberto 07–19 dom A → 17–03 lun B; Juanchi sereno V–S–D B → lunes A descanso → martes 03–11; Carlos dom B 07–19 → lunes A 17–03", async () => {
    const roberto = PLANTA_EMPLOYEES.ROBERTO;
    const juanchi = PLANTA_EMPLOYEES.JUANCHI;
    const carlos = PLANTA_EMPLOYEES.CARLOS;
    // Orden cronológico estricto (el reloj sólo avanza), con ticks del mantenimiento en las noches.
    await punch(roberto, "IN", at("2026-11-08", "06:50"));
    await punch(roberto, "OUT", at("2026-11-08", "19:05"));
    await punch(roberto, "IN", at(MON_B, "16:50"));
    await ticks(at(MON_B, "17:00"), at(TUE_B, "03:00"), 60);
    await punch(roberto, "OUT", at(TUE_B, "03:05"));
    await punch(juanchi, "IN", at(FRI_B, "18:50"));
    await ticks(at(FRI_B, "19:00"), at(SAT_B, "07:00"), 60);
    await punch(juanchi, "OUT", at(SAT_B, "07:05"));
    await punch(juanchi, "IN", at(SAT_B, "18:50"));
    await punch(juanchi, "OUT", at(SUN_B, "07:05"));
    await punch(carlos, "IN", at(SUN_B, "06:55"));
    await ticks(at(SUN_B, "07:00"), at(SUN_B, "18:00"), 60);
    await punch(juanchi, "IN", at(SUN_B, "18:50"));
    await punch(carlos, "OUT", at(SUN_B, "19:02"));
    await ticks(at(SUN_B, "19:30"), at(MON_A2, "07:00"), 60);
    await punch(juanchi, "OUT", at(MON_A2, "07:05"));
    await ticks(at(MON_A2, "07:30"), at(MON_A2, "16:30"), 60);
    await punch(carlos, "IN", at(MON_A2, "16:58"));
    await ticks(at(MON_A2, "17:30"), at(TUE_A2, "02:30"), 60);
    await punch(juanchi, "IN", at(TUE_A2, "02:50"));
    await punch(carlos, "OUT", at(TUE_A2, "03:04"));
    await ticks(at(TUE_A2, "03:30"), at(TUE_A2, "10:30"), 60);
    await punch(juanchi, "OUT", at(TUE_A2, "11:02"));

    const summary = async (person: string) => (await newShiftsOf(person)).map((shift) => [shift.scheduledStartAt?.toISOString(), shift.status, shift.totalMinutes]);
    expect(await summary(roberto)).toEqual([[at("2026-11-08", "07:00").toISOString(), "PROCESADO", 735], [at(MON_B, "17:00").toISOString(), "PROCESADO", 615]]);
    expect(await summary(juanchi)).toEqual([
      [at(FRI_B, "19:00").toISOString(), "PROCESADO", 735],
      [at(SAT_B, "19:00").toISOString(), "PROCESADO", 735],
      [at(SUN_B, "19:00").toISOString(), "PROCESADO", 735],
      [at(TUE_A2, "03:00").toISOString(), "PROCESADO", 492],
    ]);
    expect(await summary(carlos)).toEqual([[at(SUN_B, "07:00").toISOString(), "PROCESADO", 727], [at(MON_A2, "17:00").toISOString(), "PROCESADO", 606]]);
    // Lunes A2 es descanso de Juanchi: su salida de las 07:05 pertenece al domingo y no es trabajo no programado.
    const alerts = await holder.shiftAlert.findMany({ where: { employeeId: { in: [id(roberto), id(juanchi), id(carlos)] } }, include: { workShift: true } });
    expect(alerts.map((alert) => `${nameOf[alert.employeeId]} ${alert.type} ${alert.workShift?.scheduledStartAt?.toISOString()}`)).toEqual([]);
    expect(await incidentsOf(juanchi, MON_A2)).toEqual([]);
    const scenarioShifts = [...(await newShiftsOf(roberto)), ...(await newShiftsOf(juanchi)), ...(await newShiftsOf(carlos))];
    expect(await noticesOnShifts(scenarioShifts.map((shift) => shift.id))).toEqual([]);
    const scenarioDays: Array<[string, string]> = [[roberto, "2026-11-08"], [roberto, MON_B], [juanchi, FRI_B], [juanchi, SAT_B], [juanchi, SUN_B], [juanchi, MON_A2], [juanchi, TUE_A2], [carlos, SUN_B], [carlos, MON_A2]];
    for (const [person, dateKey] of scenarioDays) expect(await incidentsOf(person, dateKey), `${person} ${dateKey}`).toEqual([]);
  });

  // ── 10 — falta de ingreso, falta de salida y posible olvido ────────────────────────────────

  it("falta de ingreso (Walter ausente 17–03): un incidente por bloque al vencer, un aviso; reprocesos sin duplicar", async () => {
    const walter = PLANTA_EMPLOYEES.WALTER;
    await ticks(at(MON_A, "16:30"), at(MON_A, "16:50"), 10);
    await punch(PLANTA_EMPLOYEES.CARLOS, "IN", at(MON_A, "16:55"));
    await ticks(at(MON_A, "17:00"), at(MON_A, "18:00"), 10);
    await ticks(at(TUE_A, "00:00"), at(TUE_A, "02:00"), 60);
    const rows = await incidentsOf(walter, MON_A);
    expect(rows.map((row) => [row.scheduledStartAt?.toISOString(), row.status])).toEqual([[at(MON_A, "17:00").toISOString(), "PENDIENTE"]]);
    expect(await titlesAbout(walter, users.rrhh.id)).toEqual(["Falta de ingreso"]);
    // Walter sin responsable asignado: sólo RRHH. El compañero que fichó (Carlos) no tiene incidente.
    expect(await titlesAbout(walter)).toEqual(["Falta de ingreso"]);
    expect(await incidentsOf(PLANTA_EMPLOYEES.CARLOS, MON_A)).toEqual([]);
  });

  it("falta de salida y posible olvido (Johanna 07–15 sin salida): POSIBLE_OLVIDO_SALIDA una vez, FALTA_SALIDA al límite absoluto con 0 h, aviso único; la entrada siguiente es normal", async () => {
    const johanna = PLANTA_EMPLOYEES.JOHANNA;
    await punch(johanna, "IN", at(MON_A, "06:55"));
    await ticks(at(MON_A, "07:00"), at(TUE_A, "06:30"), 30);
    const [shift] = await newShiftsOf(johanna);
    // Vencimiento por límite absoluto: 0 h (el cambio de bloque deja totalMinutes null; ambos sin horas). Observación O3.
    expect(shift).toMatchObject({ status: "FALTA_SALIDA", endAt: null, endPunchId: null, totalMinutes: 0 });
    expect(await minutesOf(shift!.id)).toBe(0);
    expect(await holder.attendancePunch.count({ where: { employeeId: id(johanna), type: "SALIDA" } })).toBe(0);
    const olvido = (await alertsOf(shift!.id)).find((alert) => alert.type === "POSIBLE_OLVIDO_SALIDA");
    expect(olvido).toBeTruthy();
    const titles = await titlesAbout(johanna, users.rrhh.id);
    expect(titles.filter((title) => title === "Falta registrar la salida")).toHaveLength(1);
    expect(titles.filter((title) => title === "Posible olvido de salida")).toHaveLength(1);
    expect((await punch(johanna, "IN", at(TUE_A, "06:58"))).status).toBe(201);
    await punch(johanna, "OUT", at(TUE_A, "15:03"));
    expect((await newShiftsOf(johanna))[1]).toMatchObject({ status: "PROCESADO", scheduledStartAt: at(TUE_A, "07:00"), totalMinutes: 485 });
    // Registro: momento del posible olvido con olvido de salida NULL (umbral por defecto).
    expect(olvido!.actualAt.toISOString()).toBe(at(MON_A, "17:00").toISOString());
  });

  // ── 11 — feriados ───────────────────────────────────────────────────────────────────────────

  it("feriado sin convocatoria: sin obligación ni falta; trabajo igual → minutos reales e informativa sin aviso. Con convocatoria: obligación con el bloque convocado", async () => {
    await holiday(WED_B);
    const saved = await call("PUT", "/shifts/holiday-work/assignments", { date: WED_B, assignments: [{ employeeId: id(PLANTA_EMPLOYEES.JOSE), shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id] }, { employeeId: id(PLANTA_EMPLOYEES.ROBERTO), shiftTemplateId: templateId[PLANTA_TEMPLATES.T1703.id] }] });
    expect(saved.status, JSON.stringify(saved.error)).toBe(200);
    // José convocado trabaja; Roberto convocado no viene; Johanna no convocada no viene; Carlos no convocado viene.
    await punch(PLANTA_EMPLOYEES.JOSE, "IN", at(WED_B, "06:52"));
    await punch(PLANTA_EMPLOYEES.CARLOS, "IN", at(WED_B, "07:00"));
    await ticks(at(WED_B, "07:00"), at(WED_B, "15:00"), 30);
    await punch(PLANTA_EMPLOYEES.JOSE, "OUT", at(WED_B, "15:04"));
    await ticks(at(WED_B, "15:30"), at(WED_B, "16:30"), 30);
    await punch(PLANTA_EMPLOYEES.CARLOS, "OUT", at(WED_B, "17:00"));
    await ticks(at(WED_B, "17:30"), at("2026-11-12", "02:00"), 30);

    const [jose] = await newShiftsOf(PLANTA_EMPLOYEES.JOSE);
    expect(jose).toMatchObject({ status: "PROCESADO", shiftTemplateSource: "HOLIDAY_CONVOCATION", scheduledStartAt: at(WED_B, "07:00"), totalMinutes: 492 });
    expect(await alertTypes(jose!.id)).toEqual([]);
    const [carlos] = await newShiftsOf(PLANTA_EMPLOYEES.CARLOS);
    expect(carlos).toMatchObject({ status: "PROCESADO", shiftTemplateId: null, totalMinutes: 600 });
    expect(await minutesOf(carlos!.id)).toBe(600);
    // §20: el no convocado que trabaja cobra el FERIADO según el alcance de la regla (global → ×2),
    // aunque la fecha tenga convocados (con §16 quedaba ×1).
    expect((await holder.timeEntry.findMany({ where: { workShiftId: carlos!.id } })).map((entry) => Number(entry.appliedMultiplier))).toEqual([2]);
    expect((await alertsOf(carlos!.id)).map((alert) => [alert.type, alert.status, alert.severity])).toEqual([["TRABAJO_NO_PROGRAMADO", "RESUELTA", "INFO"]]);
    expect(await incidentsOf(PLANTA_EMPLOYEES.JOHANNA, WED_B)).toEqual([]);
    expect((await incidentsOf(PLANTA_EMPLOYEES.ROBERTO, WED_B)).map((row) => row.scheduledStartAt?.toISOString())).toEqual([at(WED_B, "17:00").toISOString()]);
    expect(await titlesAbout(PLANTA_EMPLOYEES.ROBERTO)).toEqual(["Falta de ingreso"]);
    expect([...(await titlesAbout(PLANTA_EMPLOYEES.JOSE)), ...(await titlesAbout(PLANTA_EMPLOYEES.CARLOS)), ...(await titlesAbout(PLANTA_EMPLOYEES.JOHANNA))]).toEqual([]);
    const workdays = await m.workday.resolveExpectedWorkdays([id(PLANTA_EMPLOYEES.JOHANNA), id(PLANTA_EMPLOYEES.JOSE)], day(WED_B), day(WED_B), m.prisma);
    expect(workdays.get(id(PLANTA_EMPLOYEES.JOHANNA))!.get(WED_B)).toMatchObject({ expectedMinutes: 0 });
    expect(workdays.get(id(PLANTA_EMPLOYEES.JOSE))!.get(WED_B)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 480 });
  });

  // ── 11b — §20: defecto detectado en la simulación de Planta (convocatorias y rotaciones) ──────
  // WORKED_TIME_ACCOUNTING_MODEL.md §20 (D9, P7, P8): la convocatoria sólo obliga; sin plantilla usa el
  // turno REAL del día (bloques de la rotación, nunca un fijo cerrado al entrar a la rotación); sin turno
  // resoluble se rechaza; con plantilla reemplaza al habitual (también en fijos); sin convocatorias, nadie.

  it("§20 Planta: candidatos con el turno real; convocatoria sin plantilla en día de turno → falta por bloque con aviso; en descanso → 422; fijo con plantilla → obligación y fichada contra ella", async () => {
    // Día hábil del ciclo con gente de turno y gente de descanso (el ajeno trabaja L–V).
    const HOLIDAY = [MON_B, TUE_B, WED_B, THU_A, FRI_A, FRI_B, TUE_A, WED_A].find((key) => ROTATING.some((person) => planned(person, key).length === 0) && ROTATING.some((person) => planned(person, key).length === 1 && person !== PLANTA_EMPLOYEES.ROBERTO))!;
    expect(HOLIDAY).toBeDefined();
    const NEXT = addDays(HOLIDAY, 1);
    await holiday(HOLIDAY);
    const working = ROTATING.filter((person) => planned(person, HOLIDAY).length === 1 && person !== PLANTA_EMPLOYEES.ROBERTO);
    const resting = ROTATING.filter((person) => planned(person, HOLIDAY).length === 0);
    const absent = working[0]!;
    const absentBlock = planned(absent, HOLIDAY)[0]!;

    // Candidatos: Roberto conserva su fijo 07–17 HABILITADO (cerrado al entrar a la rotación) y no se
    // propone; el turno sale de la rotación. El ajeno (Oficina L–V) muestra su fijo vigente.
    const candidates = await call("GET", `/shifts/holiday-work/candidates?date=${HOLIDAY}&take=100`);
    expect(candidates.status, JSON.stringify(candidates.error)).toBe(200);
    const scheduleOf = (person: string) => (candidates.data as Array<{ id: string; expectedSchedule: { kind: string; blocks: Array<{ code: string }> } }>).find((row) => row.id === id(person))!.expectedSchedule;
    expect(scheduleOf(PLANTA_EMPLOYEES.ROBERTO).kind).toMatch(/^ROTATION_/);
    expect(scheduleOf(PLANTA_EMPLOYEES.ROBERTO).blocks.map((block) => block.code)).not.toContain(PLANTA_TEMPLATES.T0717.code);
    expect(scheduleOf(absent)).toMatchObject({ kind: "ROTATION_SHIFTS", blocks: [{ code: absentBlock.code }] });
    expect(scheduleOf(resting[0]!)).toMatchObject({ kind: "ROTATION_REST", blocks: [] });
    expect(scheduleOf(AJENO)).toMatchObject({ kind: "FIXED", blocks: [{ code: "OF-08-16" }] });

    // Descanso de rotación sin plantilla → 422 y nada guardado.
    const rejected = await call("PUT", "/shifts/holiday-work/assignments", { date: HOLIDAY, assignments: [{ employeeId: id(resting[0]!), status: "ACTIVA" }] });
    expect(rejected.status).toBe(422);
    expect(rejected.error).toMatchObject({ code: "HOLIDAY_WORK_SCHEDULE_REQUIRED" });
    expect(await holder.holidayWorkAssignment.count({ where: { employeeId: id(resting[0]!) } })).toBe(0);

    // Sin plantilla en un día de turno: obliga con el bloque de la rotación. El ajeno, con plantilla 17–03 (P8).
    const saved = await call("PUT", "/shifts/holiday-work/assignments", { date: HOLIDAY, assignments: [{ employeeId: id(absent), status: "ACTIVA" }, { employeeId: id(AJENO), status: "ACTIVA", shiftTemplateId: templateId[PLANTA_TEMPLATES.T1703.id] }] });
    expect(saved.status, JSON.stringify(saved.error)).toBe(200);

    // El ajeno llega a las 17:00 (su convocatoria), no a las 08:00 (su fijo): sin falta ni alertas.
    await ticks(at(HOLIDAY, "06:30"), at(HOLIDAY, "16:30"), 30);
    await punch(AJENO, "IN", at(HOLIDAY, "17:00"));
    await ticks(at(HOLIDAY, "17:00"), at(NEXT, "02:30"), 30);
    await punch(AJENO, "OUT", at(NEXT, "02:58"));

    const [ajeno] = (await shiftsOf(AJENO)).filter((shift) => shift.startAt >= day(HOLIDAY));
    expect(ajeno).toMatchObject({ status: "PROCESADO", shiftTemplateId: templateId[PLANTA_TEMPLATES.T1703.id] });
    expect(await alertTypes(ajeno!.id)).toEqual([]);
    expect(await incidentsOf(AJENO, HOLIDAY)).toEqual([]);
    // Horas del convocado: ×2 por la regla global (alcance) sólo en la fecha del feriado; el tramo
    // nocturno del día siguiente, ×1 (la convocatoria nunca decide el multiplicador).
    const entries = await holder.timeEntry.findMany({ where: { workShiftId: ajeno!.id }, orderBy: { date: "asc" } });
    expect(entries.map((entry) => [entry.date.toISOString().slice(0, 10), Number(entry.appliedMultiplier)])).toEqual([[HOLIDAY, 2], [NEXT, 1]]);

    // El convocado de rotación ausente: una falta por su bloque con un aviso; el que descansa, nada.
    expect((await incidentsOf(absent, HOLIDAY)).map((row) => row.scheduledStartAt?.toISOString())).toEqual([absentBlock.start.toISOString()]);
    expect(await titlesAbout(absent)).toEqual(["Falta de ingreso"]);
    for (const person of resting) expect(await incidentsOf(person, HOLIDAY)).toEqual([]);
    expect(await titlesAbout(AJENO)).toEqual([]);

    // Novedades según jornada: los convocados tienen la jornada de su turno real; los demás, 0 confirmado.
    const workdays = await m.workday.resolveExpectedWorkdays([id(absent), id(AJENO), id(resting[0]!)], day(HOLIDAY), day(HOLIDAY), m.prisma);
    expect(workdays.get(id(absent))!.get(HOLIDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: durationOf(absentBlock), source: "HOLIDAY_CONVOCATION" });
    expect(workdays.get(id(AJENO))!.get(HOLIDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 600, minutesSource: "CONVOCATION_SHIFT_TEMPLATE" });
    expect(workdays.get(id(resting[0]!))!.get(HOLIDAY)).toMatchObject({ obligation: "HOLIDAY_NOT_CONVOKED", expectedMinutes: 0 });
  });

  it("§20 feriado sin ninguna convocatoria: nadie tiene obligación ni falta ni aviso (rotación, fijos y ajeno); quien trabaja cobra ×2 por la regla", async () => {
    await holiday(WED_A);
    // El reloj avanza siempre hacia adelante; hasta antes del primer bloque del jueves (03:00).
    await ticks(at(WED_A, "06:00"), at(WED_A, "06:30"), 30);
    await punch(PLANTA_EMPLOYEES.JUANJO, "IN", at(WED_A, "07:00"));
    await ticks(at(WED_A, "07:30"), at(WED_A, "14:30"), 30);
    await punch(PLANTA_EMPLOYEES.JUANJO, "OUT", at(WED_A, "15:00"));
    await ticks(at(WED_A, "15:30"), at("2026-11-05", "02:30"), 30);

    for (const person of [...ROTATING, PLANTA_EMPLOYEES.JUANJO, AJENO]) expect(await incidentsOf(person, WED_A)).toEqual([]);
    expect(await holder.systemNotification.count()).toBe(0);
    const [juanjo] = (await newShiftsOf(PLANTA_EMPLOYEES.JUANJO)).filter((shift) => shift.startAt >= day(WED_A));
    expect((await alertsOf(juanjo!.id)).map((alert) => [alert.type, alert.status])).toEqual([["TRABAJO_NO_PROGRAMADO", "RESUELTA"]]);
    expect((await holder.timeEntry.findMany({ where: { workShiftId: juanjo!.id } })).map((entry) => Number(entry.appliedMultiplier))).toEqual([2]);
  });

  // ── 12 — franco y trabajo no programado ─────────────────────────────────────────────────────

  it("franco: sin falta si no viene; si ficha → ACTIVIDAD_EN_FRANCO con un aviso. Descanso de rotación con trabajo → informativa sin aviso", async () => {
    const saved = await call("PUT", "/employee-day-offs", { date: TUE_B, employees: [{ employeeId: id(PLANTA_EMPLOYEES.JOHANNA), status: "ACTIVO" }, { employeeId: id(PLANTA_EMPLOYEES.JOSE), status: "ACTIVO" }] });
    expect(saved.status, JSON.stringify(saved.error)).toBe(200);
    await ticks(at(TUE_B, "06:30"), at(TUE_B, "08:00"), 30);
    expect(await incidentsOf(PLANTA_EMPLOYEES.JOHANNA, TUE_B)).toEqual([]);
    expect(await incidentsOf(PLANTA_EMPLOYEES.JOSE, TUE_B)).toEqual([]);
    await punch(PLANTA_EMPLOYEES.JOSE, "IN", at(TUE_B, "08:05"));
    await punch(PLANTA_EMPLOYEES.JOSE, "OUT", at(TUE_B, "12:05"));
    const [franco] = await newShiftsOf(PLANTA_EMPLOYEES.JOSE);
    expect(franco).toMatchObject({ shiftTemplateSource: null, totalMinutes: 240 });
    expect(await alertTypes(franco!.id)).toEqual(["ACTIVIDAD_EN_FRANCO"]);
    expect(await titlesAbout(PLANTA_EMPLOYEES.JOSE, users.supervisorJose)).toHaveLength(1);
    expect(await titlesAbout(PLANTA_EMPLOYEES.JOHANNA)).toEqual([]);

    await punch(PLANTA_EMPLOYEES.CARLOS, "IN", at(FRI_A, "09:00"));
    await punch(PLANTA_EMPLOYEES.CARLOS, "OUT", at(FRI_A, "13:30"));
    const [rest] = await newShiftsOf(PLANTA_EMPLOYEES.CARLOS);
    expect(rest).toMatchObject({ shiftTemplateId: null, totalMinutes: 270 });
    expect((await alertsOf(rest!.id)).map((alert) => [alert.type, alert.status])).toEqual([["TRABAJO_NO_PROGRAMADO", "RESUELTA"]]);
    const restAlertIds = (await alertsOf(rest!.id)).map((alert) => alert.id);
    expect(await holder.systemNotification.count({ where: { entityId: { in: [rest!.id, ...restAlertIds] } } })).toBe(0);
  });

  // ── 13 — Juanjo fuera de la rotación ───────────────────────────────────────────────────────

  it("Juanjo (fijo L–V 07–15): legacy intacto (sin bloque, falta de día legacy si no viene) y fichada opcional del sábado informativa sin aviso", async () => {
    const juanjo = PLANTA_EMPLOYEES.JUANJO;
    await punch(juanjo, "IN", at(MON_A, "06:45"));
    await punch(juanjo, "OUT", at(MON_A, "15:10"));
    const [monday] = await newShiftsOf(juanjo);
    expect(monday).toMatchObject({ shiftTemplateSource: null, scheduledStartAt: null, shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id], totalMinutes: 505 });
    expect(await alertTypes(monday!.id)).toEqual([]);
    expect(monday!.templateRulesSnapshot).toMatchObject({ entryToleranceBeforeMinutes: 30, exitToleranceAfterMinutes: 20 });
    await ticks(at(TUE_A, "07:00"), at(TUE_A, "08:00"), 30);
    expect((await incidentsOf(juanjo, TUE_A)).map((row) => row.scheduledStartAt)).toEqual([null]);
    await punch(juanjo, "IN", at(SAT_A, "08:00"));
    await punch(juanjo, "OUT", at(SAT_A, "12:00"));
    const saturday = (await newShiftsOf(juanjo)).at(-1)!;
    expect(saturday).toMatchObject({ shiftTemplateId: null, totalMinutes: 240 });
    expect((await alertsOf(saturday.id)).map((alert) => [alert.type, alert.status])).toEqual([["TRABAJO_NO_PROGRAMADO", "RESUELTA"]]);
    expect(await titlesAbout(juanjo, users.rrhh.id)).toEqual(["Falta de ingreso"]);
  });

  // ── 14 — Novedades frente a horas fichadas ─────────────────────────────────────────────────

  it("Novedades: vacaciones según jornada de José en semana A cubren los minutos programados (960 el viernes) y no se mezclan con horas fichadas", async () => {
    const { noveltyTypesService } = await import("../novelty-types/noveltyTypes.service");
    const typeSchemas = await import("../novelty-types/noveltyTypes.schemas");
    const { noveltiesService } = await import("../novelties/novelties.service");
    const noveltySchemas = await import("../novelties/novelties.schemas");
    vi.setSystemTime(at(SETUP_DAY, "10:00"));
    const type = await noveltyTypesService.create(typeSchemas.createNoveltyTypeSchema.parse({ name: "Vacaciones según jornada", kind: "VACACIONES", coverageMode: "EXPECTED_SCHEDULE", coverageDayRule: "WORK_OBLIGATION", coverageAppliesSpecialHours: true, coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" }));
    const actor = { id: users.rrhh.id, email: users.rrhh.email, name: "RRHH", role: "NIVEL_1_RRHH" } as Express.AuthUser;
    const preview = await noveltiesService.previewCoverage(noveltySchemas.noveltyCoveragePreviewSchema.parse({ employeeIds: [id(PLANTA_EMPLOYEES.JOSE)], noveltyTypeId: type.id, fromDate: MON_A, toDate: "2026-11-08" }), actor);
    const days = preview.employees[0]!.days.map((item: { date: string; outcome: string; baseMinutes: number }) => [item.date, item.outcome, item.baseMinutes]);
    expect(days).toEqual([
      [MON_A, "COVERED", 480],
      [TUE_A, "COVERED", 480],
      [WED_A, "COVERED", 480],
      [THU_A, "COVERED", 480],
      [FRI_A, "COVERED", 960],
      [SAT_A, "COVERED", 720],
      ["2026-11-08", "COVERED", 720],
    ]);
    expect(await holder.timeEntry.count({ where: { date: { gte: day(MON_A) } } })).toBe(0);
  });

  // ── 15 — idempotencia y concurrencia de incidentes y avisos ────────────────────────────────

  it("concurrencia: procesos de falta de ingreso, inactividad, olvido y vencimiento en paralelo y repetidos → un incidente/alerta y un aviso por hecho", async () => {
    await punch(PLANTA_EMPLOYEES.JOHANNA, "IN", at(MON_A, "06:55"));
    const now = at(MON_A, "17:30");
    vi.setSystemTime(now);
    await Promise.all([
      m.missing.checkMissingExpectedEntries(now),
      m.missing.checkMissingExpectedEntries(now),
      m.openShift.checkMissingOutRisk(now),
      m.openShift.checkMissingOutRisk(now),
      m.inactivity.detectAttendanceInactivity(MON_A),
      m.missing.checkMissingEntriesForElapsedDate(MON_A, now),
    ]);
    await Promise.all([m.missing.checkMissingExpectedEntries(now), m.openShift.checkMissingOutRisk(now)]);
    const incidents = await holder.attendanceInactivityIncident.findMany({ where: { operationalDate: day(MON_A) } });
    const keys = incidents.map((row) => `${nameOf[row.employeeId]}|${row.scheduledStartAt?.toISOString() ?? "día"}`);
    expect(new Set(keys).size).toBe(keys.length);
    const all = await notices();
    const perEntity = new Map<string, number>();
    for (const notice of all) perEntity.set(`${notice.recipientUserId}|${notice.entityType}|${notice.entityId}`, (perEntity.get(`${notice.recipientUserId}|${notice.entityType}|${notice.entityId}`) ?? 0) + 1);
    expect([...perEntity.entries()].filter(([, count]) => count > 1)).toEqual([]);
    const [johanna] = await newShiftsOf(PLANTA_EMPLOYEES.JOHANNA);
    expect((await alertTypes(johanna!.id)).filter((type) => type === "POSIBLE_OLVIDO_SALIDA")).toHaveLength(1);
  });

  it("reintentos de fichada: mismo requestId en paralelo y repetido → una fichada, misma respuesta", async () => {
    const requestId = randomUUID();
    const results = await Promise.all([punch(PLANTA_EMPLOYEES.ARIEL, "IN", at(MON_A, "06:55"), {}, requestId), punch(PLANTA_EMPLOYEES.ARIEL, "IN", at(MON_A, "06:55"), {}, requestId)]);
    const winner = results.find((result) => result.status === 201)!;
    expect(winner).toBeDefined();
    const retry = await punch(PLANTA_EMPLOYEES.ARIEL, "IN", at(MON_A, "06:57"), {}, requestId);
    expect(retry.data).toEqual(winner.data);
    expect(await holder.attendancePunch.count({ where: { employeeId: id(PLANTA_EMPLOYEES.ARIEL) } })).toBe(1);
    expect(await holder.workShift.count({ where: { employeeId: id(PLANTA_EMPLOYEES.ARIEL), startAt: { gte: day(MON_A) } } })).toBe(1);
  });

  // ── 16 — snapshot de reglas con la jornada abierta ─────────────────────────────────────────

  it("snapshot: cambiar tolerancias con la jornada abierta no altera esa jornada; la siguiente usa las nuevas", async () => {
    const johanna = PLANTA_EMPLOYEES.JOHANNA;
    await punch(johanna, "IN", at(MON_A, "06:58"));
    vi.setSystemTime(at(MON_A, "10:00"));
    const patched = await call("PATCH", `/workforce/shift-templates/${templateId[PLANTA_TEMPLATES.T0715.id]}`, { exitToleranceAfterMinutes: 60 });
    expect(patched.status, JSON.stringify(patched.error)).toBe(200);
    await punch(johanna, "OUT", at(MON_A, "15:30"));
    await punch(johanna, "IN", at(TUE_A, "06:58"));
    await punch(johanna, "OUT", at(TUE_A, "15:30"));
    const [open, next] = await newShiftsOf(johanna);
    expect(open!.templateRulesSnapshot).toMatchObject({ exitToleranceAfterMinutes: 20, entryToleranceBeforeMinutes: 30 });
    expect(await alertTypes(open!.id)).toEqual(["SALIDA_TARDIA"]);
    expect(next!.templateRulesSnapshot).toMatchObject({ exitToleranceAfterMinutes: 60 });
    expect(await alertTypes(next!.id)).toEqual([]);
  });

  // ── R4.9C.2 O2 — frontera de puntualidad e ingreso en curso (§25.19) ───────────────────────

  /** Fichada real cuya subida de foto queda retenida: su intento queda PROCESSING y su instante ya tomado. */
  async function heldPunch(person: string, instant: Date, options: { fail?: boolean } = {}) {
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    uploadGate.next = { entered, release: new Promise<void>((resolve) => { release = resolve; }), fail: options.fail ?? false };
    const response = punch(person, "IN", instant);
    await reached; // recién acá se puede mover el reloj: `now` de la fichada ya quedó tomado
    expect(await holder.clockPunchAttempt.findMany({ where: { employeeId: id(person), status: "PROCESSING" } })).toEqual([expect.objectContaining({ startedAt: instant })]);
    return { response, release: async () => { release(); return response; } };
  }
  const detect = async (instant: Date) => {
    vi.setSystemTime(instant);
    return m.missing.checkMissingExpectedEntries(instant);
  };
  const blockIncidents = async (person: string, start: Date) => holder.attendanceInactivityIncident.findMany({ where: { employeeId: id(person), scheduledStartAt: start } });
  /** Cumplen sus bloques de las 07:00 del martes A (y Juanchi el de las 03:00): sólo José y Johanna quedan en juego. */
  async function othersOnTimeTuesday() {
    await punch(PLANTA_EMPLOYEES.JUANCHI, "IN", at(TUE_A, "02:55"));
    for (const person of [PLANTA_EMPLOYEES.ROBERTO, PLANTA_EMPLOYEES.ARIEL, PLANTA_EMPLOYEES.JUANJO]) await punch(person, "IN", at(TUE_A, "06:55"));
  }

  it("O2 frontera (rotación y legacy): +10:29.999 no vence; +10:30 vence con un aviso; +10:20 es puntual sin falta; +10:30 es tardío y su falta se resuelve", async () => {
    await punch(PLANTA_EMPLOYEES.JUANCHI, "IN", at(TUE_A, "02:55"));
    await punch(PLANTA_EMPLOYEES.ROBERTO, "IN", at(TUE_A, "06:55"));
    await detect(at(TUE_A, "07:10"));
    await detect(new Date(at(TUE_A, "07:10").getTime() + 29_999));
    expect(await holder.attendanceInactivityIncident.count({ where: { operationalDate: day(TUE_A) } })).toBe(0);
    await punch(PLANTA_EMPLOYEES.JOSE, "IN", new Date(at(TUE_A, "07:10").getTime() + 20_000));
    await detect(new Date(at(TUE_A, "07:10").getTime() + 30_000));
    await detect(new Date(at(TUE_A, "07:10").getTime() + 45_000)); // repetido: sin duplicados
    // José: puntual, sin falta ni aviso ni alerta.
    expect(await blockIncidents(PLANTA_EMPLOYEES.JOSE, at(TUE_A, "07:00"))).toEqual([]);
    expect(await titlesAbout(PLANTA_EMPLOYEES.JOSE)).toEqual([]);
    expect(await alertsOf((await newShiftsOf(PLANTA_EMPLOYEES.JOSE))[0]!.id)).toEqual([]);
    // Johanna (rotación) y Juanjo (legacy, de día) ausentes: una falta y un aviso cada uno, recién a +10:30.
    expect((await blockIncidents(PLANTA_EMPLOYEES.JOHANNA, at(TUE_A, "07:00"))).map((row) => row.status)).toEqual(["PENDIENTE"]);
    expect((await incidentsOf(PLANTA_EMPLOYEES.JUANJO, TUE_A)).map((row) => row.scheduledStartAt)).toEqual([null]);
    expect(await titlesAbout(PLANTA_EMPLOYEES.JOHANNA)).toEqual(["Falta de ingreso"]);
    expect(await titlesAbout(PLANTA_EMPLOYEES.JUANJO)).toEqual(["Falta de ingreso"]);
    // Ariel ficha exactamente a +10:30: tardío (11) y su falta (ya creada) se resuelve sola — coherentes.
    await punch(PLANTA_EMPLOYEES.ARIEL, "IN", new Date(at(TUE_A, "07:10").getTime() + 30_000));
    await detect(at(TUE_A, "07:12"));
    expect((await alertsOf((await newShiftsOf(PLANTA_EMPLOYEES.ARIEL))[0]!.id)).map((alert) => [alert.type, alert.differenceMinutes])).toEqual([["INGRESO_TARDE", 11]]);
    expect((await blockIncidents(PLANTA_EMPLOYEES.ARIEL, at(TUE_A, "07:00"))).map((row) => row.status)).toEqual(["RESUELTA"]);
  });

  // Etapas del detector en las que se libera (y confirma) la fichada retenida de José (07:10:20, puntual).
  const STAGES = ["antes del chequeo", "tras leer intentos", "tras leer fichadas", "antes de persistir faltas", "antes del reclamo de avisos", "después del chequeo"] as const;
  for (const stage of STAGES) {
    it(`O2 intercalación «${stage}»: la fichada puntual en curso nunca recibe falta ni aviso; la falta real (Johanna) se crea y avisa una vez`, async () => {
      await othersOnTimeTuesday();
      const jose = await heldPunch(PLANTA_EMPLOYEES.JOSE, new Date(at(TUE_A, "07:10").getTime() + 20_000));
      let fired = stage === "antes del chequeo" || stage === "después del chequeo";
      const fire = async () => {
        if (fired) return;
        fired = true;
        expect((await jose.release()).status).toBe(201);
      };
      const isJoseQuery = (args: { where?: { employeeId?: { in?: string[] } } } | undefined) => Boolean(args?.where?.employeeId?.in?.includes(id(PLANTA_EMPLOYEES.JOSE)));
      const spies: Array<{ mockRestore: () => void }> = [];
      const after = <T extends object>(target: T, method: string, match: (args: any) => boolean) => {
        const original = (target as any)[method].bind(target);
        spies.push(vi.spyOn(target as any, method).mockImplementation(async (...args: any[]) => {
          const result = await original(...args);
          if (match(args[0])) await fire();
          return result;
        }));
      };
      let readAttempts = false;
      if (stage === "tras leer intentos") after(m.prisma.clockPunchAttempt, "findMany", isJoseQuery);
      if (stage === "tras leer fichadas") {
        after(m.prisma.clockPunchAttempt, "findMany", (args) => { if (isJoseQuery(args)) readAttempts = true; return false; });
        after(m.prisma.attendancePunch, "findMany", (args) => readAttempts && isJoseQuery(args));
      }
      if (stage === "antes de persistir faltas" || stage === "antes del reclamo de avisos") {
        let calls = 0;
        const target = stage === "antes de persistir faltas" ? 1 : 2;
        const original = m.prisma.$transaction.bind(m.prisma);
        spies.push(vi.spyOn(m.prisma, "$transaction").mockImplementation(async (...args: any[]) => {
          if (!fired && ++calls === target) await fire();
          return (original as any)(...args);
        }));
      }
      if (stage === "antes del chequeo") { fired = false; await fire(); }
      try {
        await detect(new Date(at(TUE_A, "07:10").getTime() + 31_000));
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
      if (stage === "después del chequeo") { fired = false; await fire(); }
      expect(fired).toBe(true);
      await detect(at(TUE_A, "07:12"));
      await detect(at(TUE_A, "07:15"));
      expect(await blockIncidents(PLANTA_EMPLOYEES.JOSE, at(TUE_A, "07:00"))).toEqual([]);
      expect(await titlesAbout(PLANTA_EMPLOYEES.JOSE)).toEqual([]);
      const [shift] = await newShiftsOf(PLANTA_EMPLOYEES.JOSE);
      expect(shift).toMatchObject({ shiftTemplateSource: "ROTATION", scheduledStartAt: at(TUE_A, "07:00") });
      expect(await alertsOf(shift!.id)).toEqual([]);
      expect((await blockIncidents(PLANTA_EMPLOYEES.JOHANNA, at(TUE_A, "07:00"))).map((row) => row.status)).toEqual(["PENDIENTE"]);
      expect(await titlesAbout(PLANTA_EMPLOYEES.JOHANNA)).toEqual(["Falta de ingreso"]);
    });
  }

  it("O2 nocturno 17–03: intento en curso de Carlos pospone sólo su bloque; Walter ausente recibe la falta a las 17:10:30", async () => {
    await detect(new Date(at(MON_A, "17:10").getTime() + 29_999));
    expect(await holder.attendanceInactivityIncident.count({ where: { operationalDate: day(MON_A), scheduledStartAt: at(MON_A, "17:00") } })).toBe(0);
    const carlos = await heldPunch(PLANTA_EMPLOYEES.CARLOS, at(MON_A, "17:10"));
    await detect(new Date(at(MON_A, "17:10").getTime() + 31_000));
    expect(await blockIncidents(PLANTA_EMPLOYEES.CARLOS, at(MON_A, "17:00"))).toEqual([]);
    expect(await blockIncidents(PLANTA_EMPLOYEES.WALTER, at(MON_A, "17:00"))).toHaveLength(1);
    expect((await carlos.release()).status).toBe(201);
    await detect(at(MON_A, "17:20"));
    expect(await blockIncidents(PLANTA_EMPLOYEES.CARLOS, at(MON_A, "17:00"))).toEqual([]);
    expect(await titlesAbout(PLANTA_EMPLOYEES.CARLOS)).toEqual([]);
    expect(await titlesAbout(PLANTA_EMPLOYEES.WALTER)).toEqual(["Falta de ingreso"]);
  });

  it("O2 doble bloque (José viernes A): el intento en curso del 19:00 no pospone la falta del 07:00", async () => {
    const jose = await heldPunch(PLANTA_EMPLOYEES.JOSE, new Date(at(FRI_A, "19:10").getTime() + 15_000));
    await detect(new Date(at(FRI_A, "19:10").getTime() + 31_000)); // ambos bloques vencidos en el mismo chequeo
    expect((await incidentsOf(PLANTA_EMPLOYEES.JOSE, FRI_A)).map((row) => row.scheduledStartAt?.toISOString())).toEqual([at(FRI_A, "07:00").toISOString()]);
    expect((await jose.release()).status).toBe(201);
    await detect(at(FRI_A, "19:20"));
    expect((await incidentsOf(PLANTA_EMPLOYEES.JOSE, FRI_A)).map((row) => [row.scheduledStartAt?.toISOString(), row.status])).toEqual([[at(FRI_A, "07:00").toISOString(), "PENDIENTE"]]);
    expect(await titlesAbout(PLANTA_EMPLOYEES.JOSE, users.supervisorJose)).toEqual(["Falta de ingreso"]);
    const [shift] = await newShiftsOf(PLANTA_EMPLOYEES.JOSE);
    expect(shift).toMatchObject({ scheduledStartAt: at(FRI_A, "19:00") });
    expect(await alertsOf(shift!.id)).toEqual([]);
  });

  it("O2 intento fallido: mientras está en curso se pospone; al fallar, la falta real se crea con un aviso", async () => {
    await othersOnTimeTuesday();
    const jose = await heldPunch(PLANTA_EMPLOYEES.JOSE, new Date(at(TUE_A, "07:10").getTime() + 20_000), { fail: true });
    await detect(new Date(at(TUE_A, "07:10").getTime() + 31_000));
    expect(await blockIncidents(PLANTA_EMPLOYEES.JOSE, at(TUE_A, "07:00"))).toEqual([]);
    expect((await jose.release()).status).toBe(503);
    expect(await holder.clockPunchAttempt.findMany({ where: { employeeId: id(PLANTA_EMPLOYEES.JOSE) }, select: { status: true } })).toEqual([{ status: "FAILED" }]);
    await detect(at(TUE_A, "07:12"));
    await detect(at(TUE_A, "07:13"));
    expect((await blockIncidents(PLANTA_EMPLOYEES.JOSE, at(TUE_A, "07:00"))).map((row) => row.status)).toEqual(["PENDIENTE"]);
    expect(await titlesAbout(PLANTA_EMPLOYEES.JOSE, users.supervisorJose)).toEqual(["Falta de ingreso"]);
  });

  it("O2 TTL: el intento en curso pospone hasta exactamente 60 s; vencido el TTL (el mantenimiento lo pasa a FAILED) la falta se crea con un aviso", async () => {
    await othersOnTimeTuesday();
    const started = new Date(at(TUE_A, "07:10").getTime() + 20_000);
    const jose = await heldPunch(PLANTA_EMPLOYEES.JOSE, started, { fail: true });
    await detect(new Date(started.getTime() + 60_000)); // startedAt == ahora − TTL: todavía en curso
    expect(await blockIncidents(PLANTA_EMPLOYEES.JOSE, at(TUE_A, "07:00"))).toEqual([]);
    await tick(new Date(started.getTime() + 60_001)); // mantenimiento real: vence el intento y luego detecta
    expect(await holder.clockPunchAttempt.findMany({ where: { employeeId: id(PLANTA_EMPLOYEES.JOSE) }, select: { status: true, errorCode: true } })).toEqual([{ status: "FAILED", errorCode: "CLOCK_ATTEMPT_TIMEOUT" }]);
    expect((await blockIncidents(PLANTA_EMPLOYEES.JOSE, at(TUE_A, "07:00"))).map((row) => row.status)).toEqual(["PENDIENTE"]);
    expect(await titlesAbout(PLANTA_EMPLOYEES.JOSE, users.supervisorJose)).toEqual(["Falta de ingreso"]);
    await jose.release();
    await tick(at(TUE_A, "07:15"));
    expect(await titlesAbout(PLANTA_EMPLOYEES.JOSE, users.supervisorJose)).toEqual(["Falta de ingreso"]);
  });

  it("O2 concurrencia: chequeos paralelos durante el intento en curso y tras confirmarlo → ninguna falta de José; la de Johanna una vez", async () => {
    await othersOnTimeTuesday();
    const jose = await heldPunch(PLANTA_EMPLOYEES.JOSE, new Date(at(TUE_A, "07:10").getTime() + 20_000));
    const t1 = new Date(at(TUE_A, "07:10").getTime() + 31_000);
    vi.setSystemTime(t1);
    await Promise.all([m.missing.checkMissingExpectedEntries(t1), m.missing.checkMissingExpectedEntries(t1), m.missing.checkMissingExpectedEntries(t1)]);
    const [released] = await Promise.all([jose.release(), m.missing.checkMissingExpectedEntries(t1), m.missing.checkMissingExpectedEntries(t1)]);
    expect(released.status).toBe(201);
    const t2 = at(TUE_A, "07:12");
    vi.setSystemTime(t2);
    await Promise.all([m.missing.checkMissingExpectedEntries(t2), m.missing.checkMissingExpectedEntries(t2)]);
    expect(await blockIncidents(PLANTA_EMPLOYEES.JOSE, at(TUE_A, "07:00"))).toEqual([]);
    expect(await titlesAbout(PLANTA_EMPLOYEES.JOSE)).toEqual([]);
    expect(await blockIncidents(PLANTA_EMPLOYEES.JOHANNA, at(TUE_A, "07:00"))).toHaveLength(1);
    expect(await titlesAbout(PLANTA_EMPLOYEES.JOHANNA)).toEqual(["Falta de ingreso"]);
  });

  it("O2 legacy (Juanjo, fijo): el intento en curso pospone su falta de día; confirmado, ninguna falta ni aviso", async () => {
    const juanjo = await heldPunch(PLANTA_EMPLOYEES.JUANJO, new Date(at(MON_A, "07:10").getTime() + 10_000));
    await detect(new Date(at(MON_A, "07:10").getTime() + 31_000));
    expect(await incidentsOf(PLANTA_EMPLOYEES.JUANJO, MON_A)).toEqual([]);
    expect((await juanjo.release()).status).toBe(201);
    await detect(at(MON_A, "07:12"));
    expect(await incidentsOf(PLANTA_EMPLOYEES.JUANJO, MON_A)).toEqual([]);
    expect(await titlesAbout(PLANTA_EMPLOYEES.JUANJO)).toEqual([]);
    expect(await alertsOf((await newShiftsOf(PLANTA_EMPLOYEES.JUANJO))[0]!.id)).toEqual([]);
  });
});
