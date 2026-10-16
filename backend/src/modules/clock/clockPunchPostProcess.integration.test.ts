/**
 * PERF-5D (docs/decisions/F12_PERF_5.md) contra PostgreSQL REAL: el outbox durable del
 * post-proceso de fichadas. Todo pasa por la app real (createApp → controller → servicio →
 * repositorios) y por el worker real; sólo el object storage primario (Neon) se reemplaza por uno
 * en memoria. El worker NO corre dentro de la app: cada caso decide cuándo y cómo se procesa
 * (o se "cae") para reproducir reinicios, leases vencidos, reintentos y workers concurrentes.
 * Las fallas de base se inyectan con triggers temporales que abortan un INSERT.
 *
 * Opt-in: sólo corre con `CLOCK_POSTPROCESS_IT_DATABASE_URL` → `localhost`, base `clock_it*`
 * PROPIA, con el schema de este commit (`DATABASE_URL=<url> npx prisma db push --skip-generate`).
 * VACÍA la base al empezar. Nunca usa el DATABASE_URL del .env y verifica `current_database()`.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.CLOCK_POSTPROCESS_IT_DATABASE_URL;

vi.mock("../../shared/storage/neonObjectStorage.provider", async () => ({
  neonObjectStorageProvider: (await import("../../shared/testing/inMemoryObjectStorage")).inMemoryObjectStorage.provider,
}));

const PHOTO = `data:image/jpeg;base64,${Buffer.alloc(6000, 1).toString("base64")}`;
const MINUTE = 60_000;
const EMPLOYEES = ["restart", "ordering", "lease", "notifyFails", "motorBFails", "exhausted", "busy", "rollback", "sameRequest", "concurrent1", "concurrent2", "concurrent3"] as const;
type EmployeeKey = (typeof EMPLOYEES)[number];

type Modules = {
  env: typeof import("../../config/env").env;
  prisma: typeof import("../../shared/prisma/client").prisma;
  worker: typeof import("./clockPunchPostProcess.worker");
  repository: typeof import("./clockPunchPostProcess.repository").clockPunchPostProcessRepository;
  workforce: typeof import("../workforce-management/workforce.service").workforceService;
  datetime: typeof import("../../shared/datetime/argentinaTime");
};

describe.skipIf(!url)("PERF-5D — post-proceso durable de fichadas contra PostgreSQL local", () => {
  let m: Modules;
  let holder: PrismaClient;
  let server: Server;
  let baseUrl: string;
  let device: { id: string; secret: string };
  let originalPunchPhotoProvider: Modules["env"]["PUNCH_PHOTO_STORAGE_PROVIDER"];
  const ids: Record<string, string> = {};
  const employeeId = (key: EmployeeKey) => ids[key]!;
  let supervisor: Express.AuthUser;

  async function punch(key: EmployeeKey, punchType: "IN" | "OUT", requestId = randomUUID()) {
    const response = await fetch(`${baseUrl}/clock/photo-punch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `ClockDevice ${device.id}.${device.secret}` },
      body: JSON.stringify({ requestId, employeeId: employeeId(key), punchType, photo: PHOTO, faceValidationStatus: "VALID", faceDetectionScore: 0.97 }),
    });
    const json = (await response.json()) as { data?: any; error?: { code: string } };
    return { status: response.status, data: json.data, error: json.error };
  }

  /** Retrocede la jornada abierta para producir minutos reales y salir del cooldown. */
  async function ageOpenShift(key: EmployeeKey, minutes: number) {
    const shift = await holder.workShift.findFirstOrThrow({ where: { employeeId: employeeId(key), status: "ABIERTO" } });
    const startAt = new Date(shift.startAt.getTime() - minutes * MINUTE);
    await holder.workShift.update({ where: { id: shift.id }, data: { startAt } });
    await holder.attendancePunch.update({ where: { id: shift.startPunchId! }, data: { timestamp: startAt } });
    return shift.id;
  }

  const jobsOf = (key: EmployeeKey) => holder.clockPunchPostProcessJob.findMany({ where: { employeeId: employeeId(key) }, orderBy: { createdAt: "asc" } });
  const alertsOf = (workShiftId: string) => holder.shiftAlert.findMany({ where: { workShiftId }, orderBy: { type: "asc" } });
  const notificationsOf = async (workShiftId: string) => {
    const alerts = await alertsOf(workShiftId);
    return holder.systemNotification.findMany({ where: { OR: [{ entityType: "WorkShift", entityId: workShiftId }, { entityType: "ShiftAlert", entityId: { in: alerts.map((alert) => alert.id) } }] } });
  };
  // Destinatarios de asistencia de cada legajo del fixture: RRHH + su responsable horario.
  const RECIPIENTS = 2;
  /** Un aviso por destinatario y alerta, sin duplicados. */
  async function expectOneNoticePerRecipient(workShiftId: string, alerts = 1) {
    const notifications = await notificationsOf(workShiftId);
    expect(notifications).toHaveLength(alerts * RECIPIENTS);
    expect(new Set(notifications.map((item) => `${item.recipientUserId}:${item.entityId}`)).size).toBe(notifications.length);
  }
  const breakdownAuditsOf = (key: EmployeeKey) => holder.auditLog.count({ where: { entity: "HourConceptBreakdown", entityId: employeeId(key) } });

  /** Hace fallar todo INSERT en `table` hasta `dropFailures()` (falla de base inyectada). */
  const injected: string[] = [];
  async function failInsertsInto(table: string) {
    const name = `it_fail_${table.toLowerCase()}`;
    await holder.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION it_inject_failure()`);
    injected.push(`DROP TRIGGER IF EXISTS "${name}" ON "${table}"`);
  }
  async function dropFailures() {
    while (injected.length) await holder.$executeRawUnsafe(injected.pop()!);
  }

  /** Procesa un job puntual "más tarde" (después de su backoff), como lo haría el próximo tick. */
  async function processLater(jobId: string, minutes = 60) {
    const job = await m.repository.claimNext(new Date(Date.now() + minutes * MINUTE), 2 * MINUTE, { workShiftId: (await holder.clockPunchPostProcessJob.findUniqueOrThrow({ where: { id: jobId } })).workShiftId });
    expect(job?.id).toBe(jobId);
    return m.worker.processClaimedClockPunchPostProcessJob(job!);
  }

  /** IN + post-proceso del ingreso + jornada envejecida + OUT: deja el job EXIT pendiente. */
  async function exitPending(key: EmployeeKey, minutes = 60) {
    expect((await punch(key, "IN")).status).toBe(201);
    await m.worker.drainClockPunchPostProcess({ employeeIds: [employeeId(key)] });
    const workShiftId = await ageOpenShift(key, minutes);
    expect((await punch(key, "OUT")).status).toBe(201);
    const exitJob = (await jobsOf(key)).find((job) => job.kind === "EXIT")!;
    expect(exitJob).toMatchObject({ status: "PENDING", workShiftId });
    return { workShiftId, exitJob };
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("CLOCK_POSTPROCESS_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ createApp }, { env }, { prisma }, worker, { clockPunchPostProcessRepository }, { workforceService }, datetime, credentials] = await Promise.all([
      import("../../app"),
      import("../../config/env"),
      import("../../shared/prisma/client"),
      import("./clockPunchPostProcess.worker"),
      import("./clockPunchPostProcess.repository"),
      import("../workforce-management/workforce.service"),
      import("../../shared/datetime/argentinaTime"),
      import("../../shared/security/clockDeviceCredentials"),
    ]);
    m = { env, prisma, worker, repository: clockPunchPostProcessRepository, workforce: workforceService, datetime };
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WorkShift_one_open_per_employee" ON "WorkShift"("employeeId") WHERE status = 'ABIERTO' AND "endAt" IS NULL`);
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION it_inject_failure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'IT_INJECTED_FAILURE on %', TG_TABLE_NAME; END $$ LANGUAGE plpgsql`);

    await holder.hourConcept.create({ data: { code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", systemRole: "NORMAL_BASE" } });
    const night = await holder.hourConcept.create({ data: { code: "HC-NOCHE", name: "Hora nocturna IT", kind: "NOCTURNA", loadMode: "AUTOMATIC", workTreatment: "WITHIN_BASE" } });
    await holder.hourConceptRule.create({ data: { hourConceptId: night.id, startTime: "00:00", endTime: "23:59" } });
    ids.rrhh = (await holder.user.create({ data: { name: "RRHH IT", email: "rrhh-perf5d@example.com", passwordHash: "x", role: "NIVEL_1_RRHH" } })).id;
    const supervisorUser = await holder.user.create({ data: { name: "Supervisión IT", email: "sup-perf5d@example.com", passwordHash: "x", role: "NIVEL_2_SUPERVISION" } });
    supervisor = { id: supervisorUser.id, role: "NIVEL_2_SUPERVISION" } as unknown as Express.AuthUser;
    for (const [index, key] of EMPLOYEES.entries()) {
      const employee = await holder.employee.create({ data: { legajo: `P5D-${index + 1}`, cuil: `20-6${index + 1}`, dni: `6${index + 1}`, firstName: "Prueba", lastName: `PERF5D ${key}` } });
      ids[key] = employee.id;
      await holder.employeeHourConcept.create({ data: { employeeId: employee.id, hourConceptId: night.id } });
      await holder.employeeAssignment.create({ data: { employeeId: employee.id, userId: supervisorUser.id, type: "TIME_RESPONSIBLE", status: "ACTIVO" } });
    }
    // Turno propio del legajo `ordering` que arranca ahora (hora Argentina): su ingreso lo adopta y
    // la salida temprana sólo se detecta si la evaluación de salida ve ese turno ya adoptado.
    const now = datetime.argentinaDateParts(new Date());
    const hhmm = (hour: number, minute: number) => `${String(hour % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const template = await holder.shiftTemplate.create({ data: { code: "IT-PERF5D", name: "Turno IT", startTime: hhmm(now.hour, now.minute), endTime: hhmm(now.hour + 8, now.minute), crossesMidnight: now.hour + 8 >= 24, expectedMinutes: 480 } });
    ids.template = template.id;
    await holder.shiftAssignment.create({ data: { employeeId: employeeId("ordering"), shiftTemplateId: template.id, status: "HABILITADO", effectiveFrom: datetime.argentinaCalendarDate(now.key) } });

    const secret = credentials.generateClockDeviceSecret();
    const created = await holder.clockDevice.create({ data: { name: "TEST PERF5D", status: "ACTIVE", tokenHash: credentials.hashClockDeviceSecret(secret), activatedAt: new Date(), lastSeenAt: new Date() } });
    device = { id: created.id, secret };

    originalPunchPhotoProvider = env.PUNCH_PHOTO_STORAGE_PROVIDER;
    env.PUNCH_PHOTO_STORAGE_PROVIDER = "neon_object_storage";
    env.CLOCK_PUNCH_COOLDOWN_SECONDS = 60;
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${env.API_PREFIX}`;
  }, 60_000);

  afterEach(async () => {
    await dropFailures();
    m?.worker.stopClockPunchPostProcessWorker();
  });

  afterAll(async () => {
    if (m) m.env.PUNCH_PHOTO_STORAGE_PROVIDER = originalPunchPhotoProvider;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await m?.prisma.$disconnect();
    await holder?.$disconnect();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  it("el 201 llega con la fichada completa y el job PENDING; si el backend muere, el próximo arranque lo procesa", async () => {
    const entry = await punch("restart", "IN");
    expect(entry.status).toBe(201);
    const workShiftId = entry.data.workShift.id as string;
    const shift = await holder.workShift.findUniqueOrThrow({ where: { id: workShiftId } });
    expect(shift).toMatchObject({ status: "ABIERTO", employeeId: employeeId("restart") });
    const [job] = await jobsOf("restart");
    expect(job).toMatchObject({ kind: "ENTRY", status: "PENDING", attendancePunchId: shift.startPunchId, workShiftId, stepsCompleted: [], attemptCount: 0, periods: [m.datetime.periodFromInstant(shift.startAt)] });
    // Lo derivado todavía no existe: no se calculó en el request.
    expect(await alertsOf(workShiftId)).toHaveLength(0);

    // "Otra instancia" arranca: su primer tick recoge lo que quedó PENDING.
    expect(m.worker.startClockPunchPostProcessWorker()).toBe(true);
    await vi.waitFor(async () => expect((await jobsOf("restart"))[0]!.status).toBe("COMPLETED"), { timeout: 10_000, interval: 50 });

    const completed = (await jobsOf("restart"))[0]!;
    expect(completed).toMatchObject({ attemptCount: 1, stepsCompleted: ["entry-evaluation"], leaseExpiresAt: null });
    expect(completed.completedAt).toBeInstanceOf(Date);
    expect((await alertsOf(workShiftId)).map((alert) => alert.type)).toEqual(["TURNO_NO_IDENTIFICADO"]);
    await expectOneNoticePerRecipient(workShiftId);
  });

  it("orden ENTRY→OUT por jornada: el EXIT no se reclama mientras el ingreso esté pendiente, en backoff o tomado, y evalúa con el turno ya adoptado", async () => {
    expect((await punch("ordering", "IN")).status).toBe(201);
    const workShiftId = await ageOpenShift("ordering", 60);
    expect((await punch("ordering", "OUT")).status).toBe(201);
    const [entryJob, exitJob] = await jobsOf("ordering");
    expect([entryJob!.kind, exitJob!.kind]).toEqual(["ENTRY", "EXIT"]);
    const scope = { workShiftId };

    // Ingreso en backoff: no es reclamable y el EXIT queda bloqueado detrás.
    await holder.clockPunchPostProcessJob.update({ where: { id: entryJob!.id }, data: { nextAttemptAt: new Date(Date.now() + 60 * MINUTE) } });
    expect(await m.repository.claimNext(new Date(), 2 * MINUTE, scope)).toBeNull();

    // Ingreso tomado por otro worker (lease vigente): el EXIT sigue bloqueado.
    await holder.clockPunchPostProcessJob.update({ where: { id: entryJob!.id }, data: { nextAttemptAt: new Date() } });
    const claimedEntry = await m.repository.claimNext(new Date(), 2 * MINUTE, scope);
    expect(claimedEntry).toMatchObject({ id: entryJob!.id, status: "PROCESSING", attemptCount: 1 });
    expect(await m.repository.claimNext(new Date(), 2 * MINUTE, scope)).toBeNull();

    await expect(m.worker.processClaimedClockPunchPostProcessJob(claimedEntry!)).resolves.toMatchObject({ status: "COMPLETED" });
    expect(await holder.workShift.findUniqueOrThrow({ where: { id: workShiftId } })).toMatchObject({ shiftTemplateId: ids.template });

    const claimedExit = await m.repository.claimNext(new Date(), 2 * MINUTE, scope);
    expect(claimedExit?.id).toBe(exitJob!.id);
    await expect(m.worker.processClaimedClockPunchPostProcessJob(claimedExit!)).resolves.toMatchObject({ status: "COMPLETED" });
    // Salió 7 h antes del fin del turno adoptado: sólo se ve si el EXIT corrió después del ENTRY.
    expect((await alertsOf(workShiftId)).map((alert) => alert.type)).toContain("SALIDA_ANTICIPADA");
    expect(await holder.hourConceptBreakdown.count({ where: { workShiftId, source: "AUTOMATIC" } })).toBeGreaterThan(0);
  });

  it("crash en PROCESSING: con el lease vigente nadie lo toma; vencido, otro worker lo retoma y el worker viejo ya no escribe nada (fencing)", async () => {
    const entry = await punch("lease", "IN");
    const workShiftId = entry.data.workShift.id as string;
    const scope = { workShiftId };
    const stale = await m.repository.claimNext(new Date(), 2 * MINUTE, scope);
    expect(stale).toMatchObject({ status: "PROCESSING", attemptCount: 1 });

    expect(await m.repository.claimNext(new Date(), 2 * MINUTE, scope)).toBeNull();
    const reclaimed = await m.repository.claimNext(new Date(Date.now() + 3 * MINUTE), 2 * MINUTE, scope);
    expect(reclaimed).toMatchObject({ id: stale!.id, status: "PROCESSING", attemptCount: 2 });

    await expect(m.worker.processClaimedClockPunchPostProcessJob(stale!)).resolves.toMatchObject({ status: "LEASE_LOST" });
    expect(await alertsOf(workShiftId)).toHaveLength(0);
    expect(await m.repository.complete(stale!.id, 1, {}, new Date())).toEqual({ count: 0 });

    await expect(m.worker.processClaimedClockPunchPostProcessJob(reclaimed!)).resolves.toMatchObject({ status: "COMPLETED" });
    expect(await alertsOf(workShiftId)).toHaveLength(1);
    await expectOneNoticePerRecipient(workShiftId);
  });

  it("falla la notificación: el paso se revierte entero (sin alerta huérfana), reintenta con backoff y termina con una sola alerta y un solo aviso", async () => {
    const entry = await punch("notifyFails", "IN");
    const workShiftId = entry.data.workShift.id as string;
    await failInsertsInto("SystemNotification");

    const [job] = await jobsOf("notifyFails");
    const claimed = await m.repository.claimNext(new Date(), 2 * MINUTE, { workShiftId });
    const before = Date.now();
    await expect(m.worker.processClaimedClockPunchPostProcessJob(claimed!)).resolves.toMatchObject({ status: "RETRY" });

    const retrying = await holder.clockPunchPostProcessJob.findUniqueOrThrow({ where: { id: job!.id } });
    expect(retrying).toMatchObject({ status: "PENDING", attemptCount: 1, stepsCompleted: [], leaseExpiresAt: null });
    expect(retrying.lastErrorMessage).toContain("IT_INJECTED_FAILURE");
    expect(retrying.lastErrorCode).toBeTruthy();
    expect(retrying.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 5_000);
    expect(await alertsOf(workShiftId)).toHaveLength(0);
    // La fichada nunca se invalida por su post-proceso.
    expect(await holder.workShift.findUniqueOrThrow({ where: { id: workShiftId } })).toMatchObject({ status: "ABIERTO" });

    await dropFailures();
    await expect(processLater(job!.id)).resolves.toMatchObject({ status: "COMPLETED" });
    expect(await alertsOf(workShiftId)).toHaveLength(1);
    await expectOneNoticePerRecipient(workShiftId);

    // Re-entrega del mismo job (p. ej. se cayó justo antes de completarse): sus pasos ya tienen marca.
    await holder.clockPunchPostProcessJob.update({ where: { id: job!.id }, data: { status: "PENDING", completedAt: null } });
    await expect(processLater(job!.id)).resolves.toMatchObject({ status: "COMPLETED" });
    expect(await alertsOf(workShiftId)).toHaveLength(1);
    await expectOneNoticePerRecipient(workShiftId);
  });

  it("falla Motor B: la evaluación de salida espera; al reintentar, desgloses y auditoría del recálculo quedan una sola vez", async () => {
    const { workShiftId, exitJob } = await exitPending("motorBFails");
    await failInsertsInto("HourConceptBreakdown");

    await expect(processLater(exitJob.id, 0)).resolves.toMatchObject({ status: "RETRY" });
    expect(await holder.clockPunchPostProcessJob.findUniqueOrThrow({ where: { id: exitJob.id } })).toMatchObject({ status: "PENDING", stepsCompleted: [] });
    expect(await holder.hourConceptBreakdown.count({ where: { workShiftId } })).toBe(0);
    expect(await breakdownAuditsOf("motorBFails")).toBe(0);
    // Las horas (Motor A) estaban correctas desde el 201.
    expect(await holder.timeEntry.count({ where: { workShiftId } })).toBe(1);

    await dropFailures();
    await expect(processLater(exitJob.id)).resolves.toMatchObject({ status: "COMPLETED" });
    const breakdowns = await holder.hourConceptBreakdown.count({ where: { workShiftId } });
    expect(breakdowns).toBeGreaterThan(0);
    expect(await breakdownAuditsOf("motorBFails")).toBe(exitJob.periods.length);

    await holder.clockPunchPostProcessJob.update({ where: { id: exitJob.id }, data: { status: "PENDING", completedAt: null } });
    await expect(processLater(exitJob.id)).resolves.toMatchObject({ status: "COMPLETED" });
    expect(await holder.hourConceptBreakdown.count({ where: { workShiftId } })).toBe(breakdowns);
    expect(await breakdownAuditsOf("motorBFails")).toBe(exitJob.periods.length);
  });

  it("agotado queda FAILED y observable; el envío del cierre lo reintenta, se bloquea con 409 mientras falle y avanza cuando se recupera", async () => {
    const { workShiftId, exitJob } = await exitPending("exhausted");
    const period = exitJob.periods[0]!;
    await failInsertsInto("HourConceptBreakdown");
    await holder.clockPunchPostProcessJob.update({ where: { id: exitJob.id }, data: { attemptCount: 11 } });

    await expect(processLater(exitJob.id, 0)).resolves.toMatchObject({ status: "FAILED" });
    expect(await holder.clockPunchPostProcessJob.findUniqueOrThrow({ where: { id: exitJob.id } })).toMatchObject({ status: "FAILED", attemptCount: 12 });

    const settle = (scope: { employeeIds: string[] }) => m.worker.drainClockPunchPostProcess(scope, { waitMs: 300 });
    await expect(m.workforce.submitClosures(period, [employeeId("exhausted")], supervisor, undefined, { settleClockPunchPostProcess: settle })).rejects.toMatchObject({ statusCode: 409, code: "CLOCK_POSTPROCESS_PENDING" });
    expect(await holder.monthlyTimeClosure.count({ where: { employeeId: employeeId("exhausted") } })).toBe(0);
    expect(await holder.clockPunchPostProcessJob.findUniqueOrThrow({ where: { id: exitJob.id } })).toMatchObject({ status: "FAILED", attemptCount: 13 });

    await dropFailures();
    const [closure] = await m.workforce.submitClosures(period, [employeeId("exhausted")], supervisor, undefined, { settleClockPunchPostProcess: settle });
    expect(closure).toMatchObject({ status: "ENVIADO", period });
    expect(await holder.clockPunchPostProcessJob.findUniqueOrThrow({ where: { id: exitJob.id } })).toMatchObject({ status: "COMPLETED" });
    expect(await holder.hourConceptBreakdown.count({ where: { workShiftId } })).toBeGreaterThan(0);
    // El snapshot del cierre ya incluye los desgloses de Motor B de esa salida.
    expect(JSON.stringify(closure!.snapshot)).toContain("Hora nocturna IT");
  });

  it("un job tomado por otro worker (lease vigente) bloquea el envío del cierre con 409 tras esperar sólo el límite", async () => {
    const { exitJob } = await exitPending("busy");
    const held = await m.repository.claimNext(new Date(), 2 * MINUTE, { workShiftId: exitJob.workShiftId });
    expect(held?.id).toBe(exitJob.id);

    const started = Date.now();
    await expect(m.workforce.submitClosures(exitJob.periods[0]!, [employeeId("busy")], supervisor, undefined, { settleClockPunchPostProcess: (scope) => m.worker.drainClockPunchPostProcess(scope, { waitMs: 300 }) })).rejects.toMatchObject({ code: "CLOCK_POSTPROCESS_PENDING" });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await holder.monthlyTimeClosure.count({ where: { employeeId: employeeId("busy") } })).toBe(0);
  });

  it("si el job no se puede encolar, la fichada se revierte entera: nunca hay fichada confirmada sin su post-proceso", async () => {
    await failInsertsInto("ClockPunchPostProcessJob");
    const requestId = randomUUID();
    const entry = await punch("rollback", "IN", requestId);

    expect(entry.status).toBe(503);
    expect(entry.error?.code).toBe("CLOCK_TEMPORARY_FAILURE");
    expect(await holder.attendancePunch.count({ where: { employeeId: employeeId("rollback") } })).toBe(0);
    expect(await holder.workShift.count({ where: { employeeId: employeeId("rollback") } })).toBe(0);
    expect(await holder.clockPunchAttempt.findUniqueOrThrow({ where: { requestId } })).toMatchObject({ status: "FAILED" });
    expect(await jobsOf("rollback")).toHaveLength(0);
  });

  it("el mismo requestId reintentado responde lo guardado y no crea otro job", async () => {
    const requestId = randomUUID();
    const first = await punch("sameRequest", "IN", requestId);
    const retry = await punch("sameRequest", "IN", requestId);

    expect([first.status, retry.status]).toEqual([201, 201]);
    expect(retry.data.workShift.id).toBe(first.data.workShift.id);
    expect(await jobsOf("sameRequest")).toHaveLength(1);
  });

  it("workers concurrentes: cada job se reclama y procesa una sola vez", async () => {
    const keys = ["concurrent1", "concurrent2", "concurrent3"] as const;
    const shifts = [];
    for (const key of keys) shifts.push((await punch(key, "IN")).data.workShift.id as string);
    const scope = { employeeIds: keys.map(employeeId) };

    const batches = await Promise.all([1, 2, 3].map(() => m.worker.processClockPunchPostProcessBatch(10, scope)));

    const outcomes = batches.flat();
    expect(outcomes.filter((outcome) => outcome.processed && outcome.status === "COMPLETED")).toHaveLength(3);
    expect(new Set(outcomes.map((outcome) => outcome.processed && outcome.jobId)).size).toBe(3);
    for (const workShiftId of shifts) {
      expect(await alertsOf(workShiftId)).toHaveLength(1);
      await expectOneNoticePerRecipient(workShiftId);
    }
    for (const key of keys) expect((await jobsOf(key)).map((job) => [job.status, job.attemptCount])).toEqual([["COMPLETED", 1]]);
  });
});
