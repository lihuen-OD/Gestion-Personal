/**
 * Horas cargadas a mano + fichada (docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md) contra
 * PostgreSQL REAL: fichada real por la app (createApp → /clock/photo-punch), post-proceso durable
 * real, contabilidad real de la grilla, locks reales. Sólo el object storage primario se reemplaza
 * por uno en memoria.
 *
 * Opt-in: sólo corre con `MANUAL_HOURS_IT_DATABASE_URL` → `localhost`, base `clock_it*` PROPIA con
 * el schema de este commit. VACÍA la base al empezar. Nunca usa el DATABASE_URL del .env y verifica
 * `current_database()`.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.MANUAL_HOURS_IT_DATABASE_URL;

vi.mock("../../shared/storage/neonObjectStorage.provider", async () => ({
  neonObjectStorageProvider: (await import("../../shared/testing/inMemoryObjectStorage")).inMemoryObjectStorage.provider,
}));

const PHOTO = `data:image/jpeg;base64,${Buffer.alloc(6000, 1).toString("base64")}`;
const MINUTE = 60_000;
const EMPLOYEES = ["review", "keep", "use", "during", "after", "retry", "night", "race", "expire", "outside"] as const;
type EmployeeKey = (typeof EMPLOYEES)[number];

type Modules = {
  env: typeof import("../../config/env").env;
  prisma: typeof import("../../shared/prisma/client").prisma;
  worker: typeof import("../clock/clockPunchPostProcess.worker");
  conflicts: typeof import("./manualHoursConflict.service").manualHoursConflictService;
  employees: typeof import("../employees/employees.service").employeesService;
  timeEntries: typeof import("./timeEntries.service").timeEntriesService;
  repository: typeof import("./timeEntries.repository").timeEntriesRepository;
  datetime: typeof import("../../shared/datetime/argentinaTime");
};

describe.skipIf(!url)("Horas manuales + fichada contra PostgreSQL local", () => {
  let m: Modules;
  let holder: PrismaClient;
  let server: Server;
  let baseUrl: string;
  let device: { id: string; secret: string };
  let originalPunchPhotoProvider: Modules["env"]["PUNCH_PHOTO_STORAGE_PROVIDER"];
  let normalConceptId: string;
  const ids: Record<string, string> = {};
  const employeeId = (key: EmployeeKey) => ids[key]!;
  let rrhh: Express.AuthUser;
  let supervisor: Express.AuthUser;
  let carga: Express.AuthUser;

  async function punch(key: EmployeeKey, punchType: "IN" | "OUT", requestId = randomUUID()) {
    const response = await fetch(`${baseUrl}/clock/photo-punch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `ClockDevice ${device.id}.${device.secret}` },
      body: JSON.stringify({ requestId, employeeId: employeeId(key), punchType, photo: PHOTO, faceValidationStatus: "VALID", faceDetectionScore: 0.97 }),
    });
    return { status: response.status, body: await response.json().catch(() => null) as { error?: { code?: string } } | null };
  }

  /** Retrocede la jornada abierta para producir minutos reales y salir del cooldown. */
  async function ageOpenShift(key: EmployeeKey, minutes: number) {
    const shift = await holder.workShift.findFirstOrThrow({ where: { employeeId: employeeId(key), status: "ABIERTO" } });
    const startAt = new Date(shift.startAt.getTime() - minutes * MINUTE);
    await holder.workShift.update({ where: { id: shift.id }, data: { startAt } });
    await holder.attendancePunch.update({ where: { id: shift.startPunchId! }, data: { timestamp: startAt } });
    return { workShiftId: shift.id, startAt, dateKey: m.datetime.argentinaDateKey(startAt) };
  }

  const drain = (key: EmployeeKey) => m.worker.drainClockPunchPostProcess({ employeeIds: [employeeId(key)] });
  const manual = (key: EmployeeKey, dateKey: string, hours: number, user = rrhh) => m.timeEntries.create({ employeeId: employeeId(key), hourConceptId: normalConceptId, date: m.datetime.argentinaCalendarDate(dateKey), hours }, user, { userId: user.id });
  const normalRows = (key: EmployeeKey) => holder.timeEntry.findMany({ where: { employeeId: employeeId(key) }, orderBy: { date: "asc" } });
  const conflictAlerts = (workShiftId: string) => holder.shiftAlert.findMany({ where: { workShiftId, type: "ACTIVIDAD_SOBRE_CARGA_MANUAL" } });
  const notices = async (workShiftId: string) => holder.systemNotification.findMany({ where: { entityType: "ShiftAlert", entityId: { in: (await conflictAlerts(workShiftId)).map((alert) => alert.id) } } });
  const conflictAudits = (alertId: string) => holder.auditLog.findMany({ where: { entity: "ShiftAlert", entityId: alertId } });

  async function workedMinutes(key: EmployeeKey) {
    const periods = new Set((await normalRows(key)).map((entry) => entry.period));
    let worked = 0;
    for (const period of periods) worked += (await m.employees.getTimeGrid(employeeId(key), { period, includeDetails: false } as never, rrhh)).accounting.totalWorkedMinutes;
    return worked;
  }

  /** Evidencia física de la persona: fichadas, fotos, jornadas y tramos. */
  async function evidence(key: EmployeeKey) {
    const [punches, photos, shifts, segments] = await Promise.all([
      holder.attendancePunch.count({ where: { employeeId: employeeId(key) } }),
      holder.storageFile.count({ where: { employeeId: employeeId(key) } }),
      holder.workShift.count({ where: { employeeId: employeeId(key) } }),
      holder.timeSegment.aggregate({ where: { employeeId: employeeId(key) }, _sum: { minutes: true } }),
    ]);
    return { punches, photos, shifts, segmentMinutes: segments._sum.minutes ?? 0 };
  }

  /** Carga manual de hoy → IN → `minutes` → OUT. */
  async function manualThenWork(key: EmployeeKey, minutes: number, load: (dateKey: string) => Promise<unknown>) {
    expect((await punch(key, "IN")).status).toBe(201);
    const shift = await ageOpenShift(key, minutes);
    await load(shift.dateKey);
    await drain(key);
    const out = await punch(key, "OUT");
    await drain(key);
    return { ...shift, out };
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("MANUAL_HOURS_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ createApp }, { env }, { prisma }, worker, { manualHoursConflictService }, { employeesService }, { timeEntriesService }, { timeEntriesRepository }, datetime, credentials] = await Promise.all([
      import("../../app"),
      import("../../config/env"),
      import("../../shared/prisma/client"),
      import("../clock/clockPunchPostProcess.worker"),
      import("./manualHoursConflict.service"),
      import("../employees/employees.service"),
      import("./timeEntries.service"),
      import("./timeEntries.repository"),
      import("../../shared/datetime/argentinaTime"),
      import("../../shared/security/clockDeviceCredentials"),
    ]);
    m = { env, prisma, worker, conflicts: manualHoursConflictService, employees: employeesService, timeEntries: timeEntriesService, repository: timeEntriesRepository, datetime };
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WorkShift_one_open_per_employee" ON "WorkShift"("employeeId") WHERE status = 'ABIERTO' AND "endAt" IS NULL`);

    normalConceptId = (await holder.hourConcept.create({ data: { code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", systemRole: "NORMAL_BASE" } })).id;
    const rrhhUser = await holder.user.create({ data: { name: "RRHH IT", email: "rrhh-manual@example.com", passwordHash: "x", role: "NIVEL_1_RRHH" } });
    const supervisorUser = await holder.user.create({ data: { name: "Supervisión IT", email: "sup-manual@example.com", passwordHash: "x", role: "NIVEL_2_SUPERVISION" } });
    const cargaUser = await holder.user.create({ data: { name: "Carga IT", email: "carga-manual@example.com", passwordHash: "x", role: "NIVEL_3_CARGA_HORARIA" } });
    rrhh = { id: rrhhUser.id, role: "NIVEL_1_RRHH" } as unknown as Express.AuthUser;
    supervisor = { id: supervisorUser.id, role: "NIVEL_2_SUPERVISION" } as unknown as Express.AuthUser;
    carga = { id: cargaUser.id, role: "NIVEL_3_CARGA_HORARIA" } as unknown as Express.AuthUser;
    for (const [index, key] of EMPLOYEES.entries()) {
      const employee = await holder.employee.create({ data: { legajo: `MH-${index + 1}`, cuil: `20-8${index + 1}`, dni: `8${index + 1}`, firstName: "Prueba", lastName: `Manual ${key}` } });
      ids[key] = employee.id;
      await holder.employeeHourConcept.create({ data: { employeeId: employee.id, hourConceptId: normalConceptId } });
      // "outside" queda fuera del alcance de Supervisión y de Carga horaria.
      if (key !== "outside") {
        await holder.employeeAssignment.create({ data: { employeeId: employee.id, userId: supervisorUser.id, type: "TIME_RESPONSIBLE", status: "ACTIVO" } });
        await holder.employeeAssignment.create({ data: { employeeId: employee.id, userId: cargaUser.id, type: "TIME_RESPONSIBLE", status: "ACTIVO" } });
      }
    }

    const secret = credentials.generateClockDeviceSecret();
    const created = await holder.clockDevice.create({ data: { name: "TEST HORAS MANUALES", status: "ACTIVE", tokenHash: credentials.hashClockDeviceSecret(secret), activatedAt: new Date(), lastSeenAt: new Date() } });
    device = { id: created.id, secret };

    originalPunchPhotoProvider = env.PUNCH_PHOTO_STORAGE_PROVIDER;
    env.PUNCH_PHOTO_STORAGE_PROVIDER = "neon_object_storage";
    env.CLOCK_PUNCH_COOLDOWN_SECONDS = 60;
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${env.API_PREFIX}`;
  }, 60_000);

  afterAll(async () => {
    if (m) m.env.PUNCH_PHOTO_STORAGE_PROVIDER = originalPunchPhotoProvider;
    m?.worker.stopClockPunchPostProcessWorker();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await m?.prisma.$disconnect();
    await holder?.$disconnect();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  it("caso reportado: carga manual EN_REVISION → ingreso → salida se ACEPTA, la carga manual no se toca y queda una sola revisión con su aviso", async () => {
    const { workShiftId, out } = await manualThenWork("review", 402, async (dateKey) => {
      const entry = await manual("review", dateKey, 8, supervisor);
      await m.timeEntries.submit(entry.id, supervisor, { userId: supervisor.id });
    });

    expect(out.status).toBe(201);
    const rows = await normalRows("review");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: null, status: "EN_REVISION", totalMinutes: 480 });
    expect(Number(rows[0]!.hours)).toBe(8);
    expect(await holder.workShift.findUniqueOrThrow({ where: { id: workShiftId } })).toMatchObject({ status: "OBSERVADO", totalMinutes: 402 });
    expect(await evidence("review")).toEqual({ punches: 2, photos: 2, shifts: 1, segmentMinutes: 402 });
    expect(await conflictAlerts(workShiftId)).toEqual([expect.objectContaining({ status: "PENDIENTE", severity: "ADVERTENCIA" })]);
    expect(await notices(workShiftId)).toHaveLength(3); // RRHH + dos responsables
  });

  it("carga manual → fichada → MANTENER: la manual sigue computando, la fichada queda como evidencia y la decisión se audita una sola vez", async () => {
    const { workShiftId, out } = await manualThenWork("keep", 402, (dateKey) => manual("keep", dateKey, 8));
    expect(out.status).toBe(201);
    expect(await workedMinutes("keep")).toBe(480);
    const [alert] = await conflictAlerts(workShiftId);
    const rowsBefore = await normalRows("keep");

    const view = await m.conflicts.resolve(alert!.id, { decision: "KEEP_MANUAL" }, supervisor, { userId: supervisor.id });

    expect(view).toMatchObject({ status: "RESUELTA", decision: "KEEP_MANUAL", manualMinutes: 480, clockMinutes: 402, differenceMinutes: -78, resolvedByName: "Supervisión IT" });
    expect(await workedMinutes("keep")).toBe(480);
    expect(await normalRows("keep")).toEqual(rowsBefore);
    expect(await holder.workShift.findUniqueOrThrow({ where: { id: workShiftId } })).toMatchObject({ status: "OBSERVADO" });
    expect(await evidence("keep")).toEqual({ punches: 2, photos: 2, shifts: 1, segmentMinutes: 402 });
    const audits = await conflictAudits(alert!.id);
    expect(audits).toEqual([expect.objectContaining({ userId: supervisor.id, description: expect.stringContaining("se mantuvo la carga manual (8 h); la fichada (6 h 42 min) queda como evidencia") })]);

    // Reintento de la misma decisión: sin cambios ni otra auditoría. Otra decisión: 409.
    await m.conflicts.resolve(alert!.id, { decision: "KEEP_MANUAL" }, supervisor, { userId: supervisor.id });
    expect(await conflictAudits(alert!.id)).toHaveLength(1);
    await expect(m.conflicts.resolve(alert!.id, { decision: "USE_CLOCK" }, supervisor)).rejects.toMatchObject({ statusCode: 409, code: "MANUAL_HOURS_CONFLICT_ALREADY_RESOLVED" });
  });

  it("carga manual → fichada → USAR FICHADA: computan las horas reales (6 h 42 min), la jornada pasa a procesada y la evidencia se conserva", async () => {
    const { workShiftId } = await manualThenWork("use", 402, (dateKey) => manual("use", dateKey, 8));
    expect(await workedMinutes("use")).toBe(480);
    const [alert] = await conflictAlerts(workShiftId);

    const view = await m.conflicts.resolve(alert!.id, { decision: "USE_CLOCK" }, carga, { userId: carga.id });

    // La revisión resuelta conserva lo que se vio al decidir; hoy computan las fichadas.
    expect(view).toMatchObject({ status: "RESUELTA", decision: "USE_CLOCK", manualMinutes: 480, clockMinutes: 402, differenceMinutes: -78 });
    expect(view.days).toEqual([expect.objectContaining({ manualMinutes: 480, clockMinutes: 402, countedMinutes: 402 })]);
    expect(await workedMinutes("use")).toBe(402);
    const rows = await normalRows("use");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "KIOSK", status: "APROBADO", totalMinutes: 402, actualMinutes: 402, workShiftId });
    expect(rows[0]!.observation).toContain("se reemplazó la carga manual (8 h) por las horas fichadas (6 h 42 min)");
    expect(await holder.workShift.findUniqueOrThrow({ where: { id: workShiftId } })).toMatchObject({ status: "PROCESADO" });
    expect(await evidence("use")).toEqual({ punches: 2, photos: 2, shifts: 1, segmentMinutes: 402 });
    const [audit] = await conflictAudits(alert!.id);
    expect(audit).toMatchObject({ userId: carga.id, description: expect.stringContaining("se usaron las horas fichadas (6 h 42 min) en lugar de la carga manual (8 h)") });
    expect(audit!.before).toMatchObject({ decision: null, manualMinutes: 480, clockMinutes: 402 });
    expect(audit!.after).toMatchObject({ decision: "USE_CLOCK" });
  });

  it("ingreso → carga manual MIENTRAS trabaja → salida: la salida se acepta y queda la revisión", async () => {
    expect((await punch("during", "IN")).status).toBe(201);
    const { workShiftId, dateKey } = await ageOpenShift("during", 300);
    await manual("during", dateKey, 8, supervisor);
    await drain("during");

    expect((await punch("during", "OUT")).status).toBe(201);
    await drain("during");

    expect(await normalRows("during")).toEqual([expect.objectContaining({ source: null, status: "BORRADOR", totalMinutes: 480 })]);
    expect(await conflictAlerts(workShiftId)).toHaveLength(1);
  });

  it("ingreso → salida → carga manual posterior: no se duplica ni se suma; responde 409 con un mensaje claro y la fichada sigue computando", async () => {
    expect((await punch("after", "IN")).status).toBe(201);
    const { dateKey } = await ageOpenShift("after", 60);
    await drain("after");
    expect((await punch("after", "OUT")).status).toBe(201);
    await drain("after");

    await expect(manual("after", dateKey, 8, supervisor)).rejects.toMatchObject({ statusCode: 409, code: "TIME_ENTRY_CLOCK_HOURS_EXIST" });
    expect(await normalRows("after")).toEqual([expect.objectContaining({ source: "KIOSK", totalMinutes: 60 })]);
    expect(await workedMinutes("after")).toBe(60);
  });

  it("reintento de la misma salida (mismo requestId): una sola salida, una sola revisión, un solo aviso por destinatario", async () => {
    expect((await punch("retry", "IN")).status).toBe(201);
    const { workShiftId, dateKey } = await ageOpenShift("retry", 120);
    await manual("retry", dateKey, 8);
    await drain("retry");
    const requestId = randomUUID();

    const first = await punch("retry", "OUT", requestId);
    const second = await punch("retry", "OUT", requestId);
    await drain("retry");

    expect(first.status).toBe(201);
    expect([200, 201]).toContain(second.status);
    expect(await evidence("retry")).toMatchObject({ punches: 2, shifts: 1, segmentMinutes: 120 });
    expect(await conflictAlerts(workShiftId)).toHaveLength(1);
    expect(await notices(workShiftId)).toHaveLength(3);
    expect(await normalRows("retry")).toHaveLength(1);
  });

  it("jornada nocturna 23:00 → 07:00 con carga manual en su fecha operativa: UNA revisión; usar fichada reparte 1 h + 7 h y nunca computa dos veces", async () => {
    const day = "2026-10-20";
    const next = "2026-10-21";
    await manual("night", day, 8);
    expect((await punch("night", "IN")).status).toBe(201);
    const open = await holder.workShift.findFirstOrThrow({ where: { employeeId: employeeId("night"), status: "ABIERTO" } });
    const startAt = new Date("2026-10-21T02:00:00.000Z"); // 20/10 23:00 en Argentina
    await holder.workShift.update({ where: { id: open.id }, data: { startAt } });
    await holder.attendancePunch.update({ where: { id: open.startPunchId! }, data: { timestamp: startAt } });
    await drain("night");

    await m.timeEntries.closeWorkShiftManually(open.id, { endAt: new Date("2026-10-21T10:00:00.000Z"), reason: "Salida informada por el encargado" }, rrhh, { userId: rrhh.id });

    expect(await conflictAlerts(open.id)).toHaveLength(1);
    expect(await normalRows("night")).toEqual([expect.objectContaining({ source: null, totalMinutes: 480 })]);
    const [listed] = (await m.conflicts.list({ period: "2026-10", employeeId: employeeId("night") }, supervisor)).items;
    expect(listed).toMatchObject({ operationalDate: day, manualMinutes: 480, clockMinutes: 480 });
    expect(listed!.days).toEqual([
      expect.objectContaining({ date: day, manualMinutes: 480, clockMinutes: 60 }),
      expect.objectContaining({ date: next, manualMinutes: null, clockMinutes: 420 }),
    ]);
    expect(await workedMinutes("night")).toBe(480);

    await m.conflicts.resolve(listed!.id, { decision: "USE_CLOCK" }, rrhh, { userId: rrhh.id });

    const rows = await normalRows("night");
    expect(rows.map((row) => [m.datetime.calendarDateKey(row.date), row.totalMinutes, row.source])).toEqual([[day, 60, "KIOSK"], [next, 420, "KIOSK"]]);
    expect(await workedMinutes("night")).toBe(480);
  });

  it("carrera: carga manual y salida a la vez → nunca dos filas ni horas sumadas; la salida siempre se acepta", async () => {
    expect((await punch("race", "IN")).status).toBe(201);
    const { workShiftId, dateKey } = await ageOpenShift("race", 90);
    await drain("race");

    const [out, load] = await Promise.allSettled([punch("race", "OUT"), manual("race", dateKey, 8, supervisor)]);
    await drain("race");

    expect(out.status === "fulfilled" && out.value.status).toBe(201);
    const rows = await normalRows("race");
    expect(rows).toHaveLength(1);
    if (load.status === "fulfilled") {
      // La carga entró primero: la salida quedó retenida para revisión.
      expect(rows[0]).toMatchObject({ source: null, totalMinutes: 480 });
      expect(await conflictAlerts(workShiftId)).toHaveLength(1);
    } else {
      // La salida entró primero: la carga manual se rechaza, sin duplicar.
      expect(load.reason).toMatchObject({ code: "TIME_ENTRY_CLOCK_HOURS_EXIST" });
      expect(rows[0]).toMatchObject({ source: "KIOSK", totalMinutes: 90 });
      expect(await conflictAlerts(workShiftId)).toHaveLength(0);
    }
  });

  it("jornada vencida sin salida sobre una fecha con carga manual: queda FALTA_SALIDA sin agregar la fila de 0 h", async () => {
    expect((await punch("expire", "IN")).status).toBe(201);
    const { workShiftId, dateKey } = await ageOpenShift("expire", 21 * 60);
    await manual("expire", dateKey, 8);
    await drain("expire");

    await m.repository.expireOpenWorkShifts(new Date());

    expect(await holder.workShift.findUniqueOrThrow({ where: { id: workShiftId } })).toMatchObject({ status: "FALTA_SALIDA" });
    expect(await normalRows("expire")).toEqual([expect.objectContaining({ source: null, totalMinutes: 480 })]);
  });

  it("permisos: un id fuera del alcance → 403 sin cambios; un id inexistente → 404", async () => {
    const { workShiftId } = await manualThenWork("outside", 60, (dateKey) => manual("outside", dateKey, 8));
    const [alert] = await conflictAlerts(workShiftId);

    await expect(m.conflicts.resolve(alert!.id, { decision: "USE_CLOCK" }, supervisor)).rejects.toMatchObject({ statusCode: 403 });
    await expect(m.conflicts.resolve(alert!.id, { decision: "KEEP_MANUAL" }, carga)).rejects.toMatchObject({ statusCode: 403 });
    await expect(m.conflicts.resolve(randomUUID(), { decision: "KEEP_MANUAL" }, rrhh)).rejects.toMatchObject({ statusCode: 404 });
    expect(await conflictAlerts(workShiftId)).toEqual([expect.objectContaining({ status: "PENDIENTE" })]);
    expect((await m.conflicts.list({ period: (await normalRows("outside"))[0]!.period }, supervisor)).items.some((item) => item.employee.id === employeeId("outside"))).toBe(false);

    // RRHH sí puede, y la resolución genérica de alertas no la cierra sin decisión.
    const { shiftAlertService } = await import("../shifts/shiftAlert.service");
    await expect(shiftAlertService.resolve(alert!.id, { resolution: "RESUELTA", reason: "Visto" }, rrhh)).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_ALERT_REQUIRES_HOURS_DECISION" });
    await expect(m.conflicts.resolve(alert!.id, { decision: "KEEP_MANUAL" }, rrhh, { userId: rrhh.id })).resolves.toMatchObject({ decision: "KEEP_MANUAL" });
  });
});
