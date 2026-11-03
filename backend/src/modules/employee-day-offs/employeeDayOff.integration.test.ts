/**
 * Francos (docs/decisions/EMPLOYEE_DAY_OFF.md) contra PostgreSQL REAL: fichada real por la app
 * (createApp → /clock/photo-punch), post-proceso durable real, contabilidad real de la grilla y
 * guardados concurrentes reales. Sólo el object storage primario se reemplaza por uno en memoria.
 *
 * Opt-in: sólo corre con `DAY_OFF_IT_DATABASE_URL` → `localhost`, base `clock_it*` PROPIA con el
 * schema de este commit (migraciones aplicadas con `prisma db execute`, nunca `db push`). VACÍA la
 * base al empezar. Nunca usa el DATABASE_URL del .env y verifica `current_database()`.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.DAY_OFF_IT_DATABASE_URL;

vi.mock("../../shared/storage/neonObjectStorage.provider", async () => ({
  neonObjectStorageProvider: (await import("../../shared/testing/inMemoryObjectStorage")).inMemoryObjectStorage.provider,
}));

const PHOTO = `data:image/jpeg;base64,${Buffer.alloc(6000, 1).toString("base64")}`;
const MINUTE = 60_000;
const EMPLOYEES = ["before", "after", "cancel", "concurrent", "holiday", "outside"] as const;
type EmployeeKey = (typeof EMPLOYEES)[number];

type Modules = {
  env: typeof import("../../config/env").env;
  prisma: typeof import("../../shared/prisma/client").prisma;
  worker: typeof import("../clock/clockPunchPostProcess.worker");
  dayOffs: typeof import("./employeeDayOff.service").employeeDayOffService;
  activity: typeof import("./employeeDayOffActivity");
  employees: typeof import("../employees/employees.service").employeesService;
  timeEntries: typeof import("../time-entries/timeEntries.service").timeEntriesService;
  holiday: typeof import("../shifts/holidayWorkAssignment.service").holidayWorkAssignmentService;
  datetime: typeof import("../../shared/datetime/argentinaTime");
};

describe.skipIf(!url)("Francos contra PostgreSQL local", () => {
  let m: Modules;
  let holder: PrismaClient;
  let server: Server;
  let baseUrl: string;
  let device: { id: string; secret: string };
  let originalPunchPhotoProvider: Modules["env"]["PUNCH_PHOTO_STORAGE_PROVIDER"];
  const ids: Record<string, string> = {};
  const employeeId = (key: EmployeeKey) => ids[key]!;
  let rrhh: Express.AuthUser;
  let supervisor: Express.AuthUser;

  async function punch(key: EmployeeKey, punchType: "IN" | "OUT") {
    const response = await fetch(`${baseUrl}/clock/photo-punch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `ClockDevice ${device.id}.${device.secret}` },
      body: JSON.stringify({ requestId: randomUUID(), employeeId: employeeId(key), punchType, photo: PHOTO, faceValidationStatus: "VALID", faceDetectionScore: 0.97 }),
    });
    return response.status;
  }

  /** Retrocede la jornada abierta para producir minutos reales y salir del cooldown. */
  async function ageOpenShift(key: EmployeeKey, minutes: number) {
    const shift = await holder.workShift.findFirstOrThrow({ where: { employeeId: employeeId(key), status: "ABIERTO" } });
    const startAt = new Date(shift.startAt.getTime() - minutes * MINUTE);
    await holder.workShift.update({ where: { id: shift.id }, data: { startAt } });
    await holder.attendancePunch.update({ where: { id: shift.startPunchId! }, data: { timestamp: startAt } });
    return { workShiftId: shift.id, startAt };
  }

  /** IN → 60 min → OUT, con el post-proceso drenado. Devuelve la jornada y su fecha operativa (sin turno = fecha del ingreso). */
  async function workOneHour(key: EmployeeKey, beforeDrain?: (dateKey: string) => Promise<void>) {
    expect(await punch(key, "IN")).toBe(201);
    const { workShiftId, startAt } = await ageOpenShift(key, 60);
    const dateKey = m.datetime.argentinaDateKey(startAt);
    await beforeDrain?.(dateKey);
    await m.worker.drainClockPunchPostProcess({ employeeIds: [employeeId(key)] });
    expect(await punch(key, "OUT")).toBe(201);
    await m.worker.drainClockPunchPostProcess({ employeeIds: [employeeId(key)] });
    return { workShiftId, dateKey };
  }

  /** Total trabajado y minutos sin computar de la grilla real, sumando los períodos de la jornada. */
  async function gridTotals(key: EmployeeKey) {
    const entries = await holder.timeEntry.findMany({ where: { employeeId: employeeId(key) }, select: { period: true } });
    let worked = 0;
    let uncounted = 0;
    for (const period of new Set(entries.map((entry) => entry.period))) {
      const grid = await m.employees.getTimeGrid(employeeId(key), { period, includeDetails: false } as never, rrhh);
      worked += grid.accounting.totalWorkedMinutes;
      uncounted += grid.accounting.dayOffUncountedMinutes;
    }
    return { worked, uncounted };
  }

  const dayOffAlerts = (workShiftId: string) => holder.shiftAlert.findMany({ where: { workShiftId, type: "ACTIVIDAD_EN_FRANCO" } });
  const dayOffNotices = async (workShiftId: string) => holder.systemNotification.findMany({ where: { entityType: "ShiftAlert", entityId: { in: (await dayOffAlerts(workShiftId)).map((alert) => alert.id) } } });
  const saveDayOff = (key: EmployeeKey, date: string, status: "ACTIVO" | "CANCELADO", user = supervisor) => m.dayOffs.save({ date, employees: [{ employeeId: employeeId(key), status }] }, user, { userId: user.id });

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("DAY_OFF_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ createApp }, { env }, { prisma }, worker, { employeeDayOffService }, activity, { employeesService }, { timeEntriesService }, { holidayWorkAssignmentService }, datetime, credentials] = await Promise.all([
      import("../../app"),
      import("../../config/env"),
      import("../../shared/prisma/client"),
      import("../clock/clockPunchPostProcess.worker"),
      import("./employeeDayOff.service"),
      import("./employeeDayOffActivity"),
      import("../employees/employees.service"),
      import("../time-entries/timeEntries.service"),
      import("../shifts/holidayWorkAssignment.service"),
      import("../../shared/datetime/argentinaTime"),
      import("../../shared/security/clockDeviceCredentials"),
    ]);
    m = { env, prisma, worker, dayOffs: employeeDayOffService, activity, employees: employeesService, timeEntries: timeEntriesService, holiday: holidayWorkAssignmentService, datetime };
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WorkShift_one_open_per_employee" ON "WorkShift"("employeeId") WHERE status = 'ABIERTO' AND "endAt" IS NULL`);

    await holder.hourConcept.create({ data: { code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", systemRole: "NORMAL_BASE" } });
    const rrhhUser = await holder.user.create({ data: { name: "RRHH IT", email: "rrhh-dayoff@example.com", passwordHash: "x", role: "NIVEL_1_RRHH" } });
    const supervisorUser = await holder.user.create({ data: { name: "Supervisión IT", email: "sup-dayoff@example.com", passwordHash: "x", role: "NIVEL_2_SUPERVISION" } });
    rrhh = { id: rrhhUser.id, role: "NIVEL_1_RRHH" } as unknown as Express.AuthUser;
    supervisor = { id: supervisorUser.id, role: "NIVEL_2_SUPERVISION" } as unknown as Express.AuthUser;
    for (const [index, key] of EMPLOYEES.entries()) {
      const employee = await holder.employee.create({ data: { legajo: `FR-${index + 1}`, cuil: `20-7${index + 1}`, dni: `7${index + 1}`, firstName: "Prueba", lastName: `Franco ${key}` } });
      ids[key] = employee.id;
      // "outside" queda fuera del alcance del supervisor.
      if (key !== "outside") await holder.employeeAssignment.create({ data: { employeeId: employee.id, userId: supervisorUser.id, type: "TIME_RESPONSIBLE", status: "ACTIVO" } });
    }

    const secret = credentials.generateClockDeviceSecret();
    const created = await holder.clockDevice.create({ data: { name: "TEST FRANCOS", status: "ACTIVE", tokenHash: credentials.hashClockDeviceSecret(secret), activatedAt: new Date(), lastSeenAt: new Date() } });
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

  it("franco ANTES de fichar: la fichada se acepta y se conserva, sus horas no computan, el post-proceso alerta y notifica una sola vez; corregir las horas las reconoce", async () => {
    const { workShiftId, dateKey } = await workOneHour("before", async (key) => {
      // El franco ya existía cuando se procesa el ingreso.
      await holder.employeeDayOff.create({ data: { employeeId: employeeId("before"), date: m.datetime.argentinaCalendarDate(key), createdByUserId: supervisor.id } });
    });

    // Evidencia intacta: fichadas, jornada, tramos y horas (TimeEntry.hours nunca se reescribe).
    expect(await holder.attendancePunch.count({ where: { employeeId: employeeId("before") } })).toBe(2);
    expect(await holder.workShift.findUniqueOrThrow({ where: { id: workShiftId } })).toMatchObject({ status: "PROCESADO", totalMinutes: 60 });
    expect((await holder.timeSegment.findMany({ where: { workShiftId } })).reduce((sum, segment) => sum + segment.minutes, 0)).toBe(60);
    const entries = await holder.timeEntry.findMany({ where: { employeeId: employeeId("before") } });
    expect(entries.reduce((sum, entry) => sum + Number(entry.hours) * 60, 0)).toBeCloseTo(60, 0);
    expect(entries.every((entry) => entry.source === "KIOSK")).toBe(true);

    // Franco con fichada → 0 h + alerta.
    expect(await gridTotals("before")).toEqual({ worked: 0, uncounted: 60 });
    expect(await dayOffAlerts(workShiftId)).toHaveLength(1);
    expect(await dayOffNotices(workShiftId)).toHaveLength(2); // RRHH + responsable

    // Reintento del paso (p. ej. otro worker): no duplica alerta ni notificación.
    await m.prisma.$transaction((tx) => m.activity.evaluateWorkShiftDayOff(workShiftId, { db: tx }));
    expect(await dayOffAlerts(workShiftId)).toHaveLength(1);
    expect(await dayOffNotices(workShiftId)).toHaveLength(2);

    // Reconocimiento con el flujo existente de corrección manual: computa, el franco sigue.
    for (const entry of entries) {
      await m.timeEntries.update(entry.id, { hours: Number(entry.hours), correctionReason: "Trabajó en su franco: se reconocen las horas" } as never, rrhh, { userId: rrhh.id });
    }
    expect(await gridTotals("before")).toEqual({ worked: 60, uncounted: 0 });
    expect(await holder.employeeDayOff.findFirstOrThrow({ where: { employeeId: employeeId("before"), date: m.datetime.argentinaCalendarDate(dateKey) } })).toMatchObject({ status: "ACTIVO" });
    expect(await holder.auditLog.count({ where: { entity: "TimeEntry", action: "UPDATE", description: { contains: "Trabajó en su franco" } } })).toBe(entries.length);
  });

  it("franco creado DESPUÉS de la fichada: las horas dejan de computar en el acto, aparece la alerta y la evidencia no cambia", async () => {
    const { workShiftId, dateKey } = await workOneHour("after");
    expect(await gridTotals("after")).toEqual({ worked: 60, uncounted: 0 });
    const hoursBefore = await holder.timeEntry.findMany({ where: { employeeId: employeeId("after") }, select: { id: true, hours: true, source: true } });

    const result = await saveDayOff("after", dateKey, "ACTIVO");

    expect(result.summary).toMatchObject({ changed: 1, activityAlerts: 1 });
    expect(await gridTotals("after")).toEqual({ worked: 0, uncounted: 60 });
    expect(await dayOffAlerts(workShiftId)).toHaveLength(1);
    expect(await holder.timeEntry.findMany({ where: { employeeId: employeeId("after") }, select: { id: true, hours: true, source: true } })).toEqual(hoursBefore);
    expect(await holder.auditLog.findFirst({ where: { entity: "EmployeeDayOff", action: "CREATE" }, orderBy: { createdAt: "desc" } })).toMatchObject({ userId: supervisor.id, description: expect.stringContaining("Se asignó franco a Franco after, Prueba · Legajo FR-2") });
  });

  it("cancelar el franco después: vuelve la contabilidad normal según la fuente y la alerta pendiente se resuelve sin borrarse", async () => {
    const { workShiftId, dateKey } = await workOneHour("cancel");
    await saveDayOff("cancel", dateKey, "ACTIVO");
    expect(await gridTotals("cancel")).toEqual({ worked: 0, uncounted: 60 });

    const result = await saveDayOff("cancel", dateKey, "CANCELADO");

    expect(result.summary).toMatchObject({ changed: 1, resolvedActivityAlerts: 1 });
    expect(await gridTotals("cancel")).toEqual({ worked: 60, uncounted: 0 });
    expect(await dayOffAlerts(workShiftId)).toEqual([expect.objectContaining({ status: "RESUELTA", resolutionNote: m.activity.DAY_OFF_CANCELED_ALERT_NOTE })]);
    expect(await holder.employeeDayOff.findFirstOrThrow({ where: { employeeId: employeeId("cancel") } })).toMatchObject({ status: "CANCELADO" });

    // Reactivarlo reabre esa alerta (no crea otra).
    await saveDayOff("cancel", dateKey, "ACTIVO");
    expect(await dayOffAlerts(workShiftId)).toEqual([expect.objectContaining({ status: "PENDIENTE", resolutionNote: null })]);
  });

  it("dos guardados concurrentes del mismo empleado/fecha: una sola fila, un solo alta auditada, ninguno falla", async () => {
    const date = "2026-12-15";
    const results = await Promise.all([saveDayOff("concurrent", date, "ACTIVO"), saveDayOff("concurrent", date, "ACTIVO")]);

    expect(results.map((result) => result.summary.changed).sort()).toEqual([0, 1]);
    expect(await holder.employeeDayOff.count({ where: { employeeId: employeeId("concurrent") } })).toBe(1);
    expect(await holder.auditLog.count({ where: { entity: "EmployeeDayOff", description: { contains: "Franco concurrent" } } })).toBe(1);
  });

  it("franco y convocatoria al feriado del mismo día en paralelo: exactamente uno queda activo, el otro recibe 409", async () => {
    const date = "2026-12-25";
    const outcomes = await Promise.allSettled([
      saveDayOff("holiday", date, "ACTIVO", rrhh),
      m.holiday.save({ date: m.datetime.argentinaCalendarDate(date), assignments: [{ employeeId: employeeId("holiday"), status: "ACTIVA" }] } as never, rrhh),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ statusCode: 409 });
    const active = (await holder.employeeDayOff.count({ where: { employeeId: employeeId("holiday"), status: "ACTIVO" } }))
      + (await holder.holidayWorkAssignment.count({ where: { employeeId: employeeId("holiday"), status: "ACTIVA" } }));
    expect(active).toBe(1);
  });

  it("un UUID fuera del alcance de un Nivel 2 → 403 y no se guarda nada del lote", async () => {
    await expect(m.dayOffs.save({ date: "2026-12-16", employees: [{ employeeId: employeeId("concurrent"), status: "ACTIVO" }, { employeeId: employeeId("outside"), status: "ACTIVO" }] }, supervisor)).rejects.toMatchObject({ statusCode: 403 });
    expect(await holder.employeeDayOff.count({ where: { date: m.datetime.argentinaCalendarDate("2026-12-16") } })).toBe(0);
  });
});
