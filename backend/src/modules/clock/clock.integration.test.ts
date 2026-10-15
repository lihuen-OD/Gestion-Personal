/**
 * F7 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §26) contra PostgreSQL REAL: namespace
 * `/api/clock/*`, source KIOSK, cooldown entre fichadas distintas y su concurrencia. Todo pasa
 * por la app real (createApp, requireClockDevice, controller, servicio, repositorio, auditoría);
 * sólo el storage de fotos se reemplaza por filas StorageFile locales. F11 (§30): el alias legacy
 * `/time-entries/clock/*` ya no existe; las jornadas PUBLIC_CLOCK_PHOTO son sólo historia.
 *
 * Opt-in: sólo corre con `CLOCK_IT_DATABASE_URL` → `localhost`, base `clock_it*`, con el schema de
 * este commit (`DATABASE_URL=<url> npx prisma db push --skip-generate`). VACÍA la base al empezar.
 * Nunca usa el DATABASE_URL del .env: descarta un cliente Prisma global previo y verifica
 * `current_database()` antes de escribir nada.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ManagedStorageObjectInput } from "../../shared/storage/storage.types";

const url = process.env.CLOCK_IT_DATABASE_URL;

vi.mock("../../shared/storage/storage.service", () => ({
  storageService: { uploadManaged: vi.fn(), deleteManaged: vi.fn() },
}));

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const PHOTO = `data:image/jpeg;base64,${Buffer.alloc(6000, 1).toString("base64")}`;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type Device = { id: string; secret: string; name: string };
type Modules = {
  createApp: typeof import("../../app").createApp;
  env: typeof import("../../config/env").env;
  prisma: typeof import("../../shared/prisma/client").prisma;
  repository: typeof import("../time-entries/timeEntries.repository").timeEntriesRepository;
  Conflict: typeof import("../time-entries/clockPunchCooldown").ClockPunchCooldownConflict;
  auditService: typeof import("../audit/audit.service").auditService;
};

describe.skipIf(!url)("F7 — /api/clock contra PostgreSQL local (cooldown y concurrencia reales)", () => {
  let m: Modules;
  let holder: PrismaClient;
  let server: Server;
  let baseUrl: string;
  let originalDatabaseUrl: string | undefined;
  const employees: Record<string, string> = {};
  let deviceA: Device;
  let deviceB: Device;

  const body = (employeeKey: string, punchType: "IN" | "OUT", requestId: string = randomUUID()) => ({ requestId, employeeId: employees[employeeKey]!, punchType, photo: PHOTO, faceValidationStatus: "VALID" });

  async function call(method: string, path: string, device: Device, payload?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `ClockDevice ${device.id}.${device.secret}` },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const json = (await response.json().catch(() => null)) as { data?: Record<string, any>; error?: { code: string; retryAfterSeconds?: number } } | null;
    return { status: response.status, data: json?.data, error: json?.error };
  }

  const punchesOf = (employeeKey: string) => m.prisma.attendancePunch.findMany({ where: { employeeId: employees[employeeKey]! }, orderBy: { timestamp: "asc" } });

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("CLOCK_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url;
    // shared/prisma/client reutiliza globalThis.prisma: un cliente creado antes en este proceso
    // apuntaría al .env. Se descarta para que el import de abajo cree uno contra clock_it.
    delete (globalThis as { prisma?: unknown }).prisma;

    const [{ createApp }, { env }, { prisma }, { timeEntriesRepository }, { ClockPunchCooldownConflict }, credentials, { storageService }, { auditService }] = await Promise.all([
      import("../../app"),
      import("../../config/env"),
      import("../../shared/prisma/client"),
      import("../time-entries/timeEntries.repository"),
      import("../time-entries/clockPunchCooldown"),
      import("../../shared/security/clockDeviceCredentials"),
      import("../../shared/storage/storage.service"),
      import("../audit/audit.service"),
    ]);
    m = { createApp, env, prisma, repository: timeEntriesRepository, Conflict: ClockPunchCooldownConflict, auditService };

    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);
    // Índice parcial de la migración 20260702… (Prisma no lo modela; db push no lo crea).
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WorkShift_one_open_per_employee" ON "WorkShift"("employeeId") WHERE status = 'ABIERTO' AND "endAt" IS NULL`);

    await prisma.hourConcept.create({ data: { code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", systemRole: "NORMAL_BASE" } });
    for (const [index, key] of ["race", "legacy", "parallelA", "parallelB", "lockHeld", "lockFree", "txRace", "cutover", "kioskBoth", "rollover", "retryMeta", "auditDown"].entries()) {
      const created = await prisma.employee.create({ data: { legajo: `IT-${index + 1}`, cuil: `20-${index + 1}`, dni: `${index + 1}`, firstName: "Prueba", lastName: `IT ${key}` } });
      employees[key] = created.id;
    }
    const device = async (name: string): Promise<Device> => {
      const secret = credentials.generateClockDeviceSecret();
      const created = await prisma.clockDevice.create({ data: { name, status: "ACTIVE", tokenHash: credentials.hashClockDeviceSecret(secret), activatedAt: new Date() } });
      return { id: created.id, secret, name };
    };
    deviceA = await device("TEST IT A");
    deviceB = await device("TEST IT B");

    vi.mocked(storageService.uploadManaged).mockImplementation((async (input: ManagedStorageObjectInput) => prisma.storageFile.create({
      data: {
        storageProvider: "LOCAL", storageKey: `it/${randomUUID()}`, fileName: input.fileName, originalFileName: input.fileName, mimeType: input.mimeType,
        extension: "jpg", sizeBytes: input.buffer?.length ?? 0, module: input.module, entityType: input.entityType, entityId: input.entityId,
        employeeId: input.employeeId ?? null, attendancePunchId: input.attendancePunchId ?? null, isThumbnail: input.isThumbnail ?? false,
        originalFileId: input.originalFileId ?? null, visibility: input.visibility ?? "SYSTEM_ONLY",
      },
    })) as never);
    vi.mocked(storageService.deleteManaged).mockImplementation(async (id: string) => {
      await prisma.storageFile.update({ where: { id }, data: { status: "DELETED", deletedAt: new Date() } });
    });

    env.CLOCK_PUNCH_COOLDOWN_SECONDS = 60;
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${env.API_PREFIX}`;
  }, 60_000);

  afterAll(async () => {
    await sleep(1_000); // miniatura diferida (750 ms) de la última fichada; la auditoría es transaccional (F11)
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await m?.prisma.$disconnect();
    await holder?.$disconnect();
    delete (globalThis as { prisma?: unknown }).prisma;
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("dos dispositivos, mismo empleado, requestIds distintos y simultáneos: una sola fichada (KIOSK), la otra en cooldown", async () => {
    const results = await Promise.all([
      call("POST", "/clock/photo-punch", deviceA, body("race", "IN")),
      call("POST", "/clock/photo-punch", deviceB, body("race", "IN")),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const loser = results.find((result) => result.status === 409)!;
    expect(loser.error).toMatchObject({ code: "CLOCK_PUNCH_COOLDOWN" });
    expect(loser.error!.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(loser.error!.retryAfterSeconds).toBeLessThanOrEqual(60);

    const punches = await punchesOf("race");
    expect(punches).toHaveLength(1);
    expect(punches[0]).toMatchObject({ type: "INGRESO", source: "KIOSK" });
    expect([deviceA.id, deviceB.id]).toContain(punches[0]!.deviceId);
    const shifts = await m.prisma.workShift.findMany({ where: { employeeId: employees.race! } });
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({ status: "ABIERTO", source: "KIOSK" });

    const attempts = await m.prisma.clockPunchAttempt.findMany({ where: { employeeId: employees.race! } });
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual(["COMPLETED", "FAILED"]);
    const failed = attempts.find((attempt) => attempt.status === "FAILED")!;
    expect(failed).toMatchObject({ errorCode: "CLOCK_PUNCH_COOLDOWN", httpStatus: 409 });
    expect(failed.deviceId).not.toBe(punches[0]!.deviceId);
  });

  it("reintento del mismo requestId → mismo resultado (idempotencia antes que cooldown); requestId nuevo → cooldown; attempts aislados por dispositivo", async () => {
    const completed = (await m.prisma.clockPunchAttempt.findFirst({ where: { employeeId: employees.race!, status: "COMPLETED" } }))!;
    const winner = completed.deviceId === deviceA.id ? deviceA : deviceB;
    const other = winner === deviceA ? deviceB : deviceA;
    const [shift] = await m.prisma.workShift.findMany({ where: { employeeId: employees.race! } });

    // El payload es idéntico al original: mismo requestHash.
    const retry = await call("POST", "/clock/photo-punch", winner, body("race", "IN", completed.requestId));
    expect(retry.status).toBe(201);
    expect(retry.data!.workShift.id).toBe(shift!.id);

    const exitRequestId = randomUUID();
    const exit = await call("POST", "/clock/photo-punch", winner, body("race", "OUT", exitRequestId));
    expect(exit).toMatchObject({ status: 409, error: { code: "CLOCK_PUNCH_COOLDOWN" } });
    expect(await punchesOf("race")).toHaveLength(1);
    expect((await m.prisma.workShift.findUnique({ where: { id: shift!.id } }))!.status).toBe("ABIERTO");

    const own = await call("GET", `/clock/attempts/${exitRequestId}?employeeId=${employees.race}`, winner);
    expect(own).toMatchObject({ status: 200, data: { status: "FAILED", error: { code: "CLOCK_PUNCH_COOLDOWN", httpStatus: 409 } } });
    expect(await call("GET", `/clock/attempts/${exitRequestId}?employeeId=${employees.race}`, other)).toMatchObject({ status: 404, error: { code: "CLOCK_ATTEMPT_NOT_FOUND" } });
    expect(await call("GET", `/clock/attempts/${completed.requestId}?employeeId=${employees.race}`, winner)).toMatchObject({ status: 200, data: { status: "COMPLETED" } });
  });

  // F11: sin esperar nada: la auditoría se escribió en la transacción de la fichada.
  it("la fichada queda auditada con el dispositivo como actor técnico (nombre visible, id sólo en metadata, sin usuario)", async () => {
    const [shift] = await m.prisma.workShift.findMany({ where: { employeeId: employees.race! } });
    const logs = await m.prisma.auditLog.findMany({ where: { entity: "WorkShift", entityId: shift!.id } });
    expect(logs).toHaveLength(1);
    const punch = (await punchesOf("race"))[0]!;
    const winner = punch.deviceId === deviceA.id ? deviceA : deviceB;
    expect(logs[0]!.userId).toBeNull();
    expect(logs[0]!.description).toBe(`Ingreso con foto registrado desde el dispositivo de fichada "${winner.name}" para legajo IT-1.`);
    expect(logs[0]!.description).not.toMatch(UUID_PATTERN);
    expect(logs[0]!.after).toEqual({ workShiftId: shift!.id, employeeId: employees.race, source: "KIOSK", actorClockDeviceId: winner.id });
    expect(JSON.stringify(logs[0])).not.toMatch(/tokenHash|secret/i);
  });

  it("buscar empleados y consultar estado no escriben auditoría", async () => {
    const before = await m.prisma.auditLog.count();
    expect((await call("GET", "/clock/employees?search=IT", deviceA)).status).toBe(200);
    expect((await call("POST", "/clock/status", deviceA, { employeeId: employees.race })).status).toBe(200);
    expect(await m.prisma.auditLog.count()).toBe(before);
  });

  it("fuera de la ventana la fichada sigue según el estado de la jornada (salida real KIOSK)", async () => {
    m.env.CLOCK_PUNCH_COOLDOWN_SECONDS = 2;
    try {
      await sleep(2_200);
      const exit = await call("POST", "/clock/photo-punch", deviceA, body("race", "OUT"));
      expect(exit.status).toBe(201);
      const punches = await punchesOf("race");
      expect(punches.map((punch) => [punch.type, punch.source])).toEqual([["INGRESO", "KIOSK"], ["SALIDA", "KIOSK"]]);
      expect(punches[1]!.deviceId).toBe(deviceA.id);
      const [shift] = await m.prisma.workShift.findMany({ where: { employeeId: employees.race! } });
      expect(shift!.status).not.toBe("ABIERTO");
      // F11: exactamente una auditoría por fichada confirmada (ingreso + salida), apenas responde.
      const logs = await m.prisma.auditLog.findMany({ where: { entity: "WorkShift", entityId: shift!.id }, orderBy: { createdAt: "asc" } });
      expect(logs.map((log) => log.description.split(" ")[0])).toEqual(["Ingreso", "Salida"]);
    } finally {
      m.env.CLOCK_PUNCH_COOLDOWN_SECONDS = 60;
    }
  });

  it("empleados distintos fichan en paralelo sin bloquearse (el lock es por empleado)", async () => {
    const results = await Promise.all([
      call("POST", "/clock/photo-punch", deviceA, body("parallelA", "IN")),
      call("POST", "/clock/photo-punch", deviceB, body("parallelB", "IN")),
    ]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
  });

  it("F11: el alias legacy retirado responde 404 y no escribe nada (ni fichada, ni intento, ni auditoría)", async () => {
    const auditsBefore = await m.prisma.auditLog.count();
    const request = body("legacy", "IN");
    expect(await call("POST", "/time-entries/clock/photo-punch", deviceA, request)).toMatchObject({ status: 404, error: { code: "ROUTE_NOT_FOUND" } });
    expect(await call("GET", `/time-entries/clock/attempts/${request.requestId}?employeeId=${employees.legacy}`, deviceA)).toMatchObject({ status: 404, error: { code: "ROUTE_NOT_FOUND" } });
    expect(await punchesOf("legacy")).toHaveLength(0);
    expect(await m.prisma.clockPunchAttempt.count({ where: { requestId: request.requestId } })).toBe(0);
    expect(await m.prisma.auditLog.count()).toBe(auditsBefore);
  });

  it("con el lock de un empleado tomado por otra transacción, su fichada falla al instante y la de otro empleado pasa", async () => {
    let release!: () => void;
    let acquired!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const isLocked = new Promise<void>((resolve) => { acquired = resolve; });
    const holding = holder.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtextextended('clock-punch:${employees.lockHeld}', 0))`);
      acquired();
      await released;
    }, { timeout: 20_000 });
    await isLocked;
    try {
      const windowStart = new Date(Date.now() - 60_000);
      const started = performance.now();
      const error = await m.repository.createOpenWorkShift({ employeeId: employees.lockHeld!, source: "KIOSK", startAt: new Date(), cooldown: { windowStart } }).catch((caught: unknown) => caught);
      const elapsedMs = performance.now() - started;
      expect(error).toBeInstanceOf(m.Conflict);
      expect((error as InstanceType<Modules["Conflict"]>).lastPunchAt).toBeNull();
      expect(elapsedMs).toBeLessThan(1_500); // no espera al otro: pg_try_advisory_xact_lock

      await expect(m.repository.createOpenWorkShift({ employeeId: employees.lockFree!, source: "KIOSK", startAt: new Date(), cooldown: { windowStart } })).resolves.toMatchObject({ status: "ABIERTO" });
    } finally {
      release();
      await holding;
    }
    expect(await punchesOf("lockHeld")).toHaveLength(0);
  });

  it("dos transacciones simultáneas del mismo empleado (sin el chequeo previo): exactamente una escribe", async () => {
    const windowStart = new Date(Date.now() - 60_000);
    const outcomes = await Promise.allSettled([1, 2].map(() => m.repository.createOpenWorkShift({ employeeId: employees.txRace!, source: "KIOSK", startAt: new Date(), cooldown: { windowStart } })));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(m.Conflict);
    expect(await punchesOf("txRace")).toHaveLength(1);
  });

  // ── F11 (plan §30): auditoría de la fichada en la misma transacción ──

  it("si la auditoría falla dentro de la transacción, no queda fichada: 503 no confirmado, intento FAILED, evidencia compensada; el reintento no duplica y un requestId nuevo ficha con una sola auditoría", async () => {
    const auditsBefore = await m.prisma.auditLog.count();
    const failing = body("auditDown", "IN");
    const spy = vi.spyOn(m.auditService, "registerWithin").mockRejectedValueOnce(new Error("audit store down"));
    try {
      expect(await call("POST", "/clock/photo-punch", deviceA, failing)).toMatchObject({ status: 503, error: { code: "CLOCK_TEMPORARY_FAILURE" } });
    } finally {
      spy.mockRestore();
    }
    expect(await punchesOf("auditDown")).toHaveLength(0);
    expect(await m.prisma.workShift.count({ where: { employeeId: employees.auditDown! } })).toBe(0);
    expect(await m.prisma.auditLog.count()).toBe(auditsBefore);
    expect(await m.prisma.clockPunchAttempt.findUnique({ where: { requestId: failing.requestId } })).toMatchObject({ status: "FAILED", errorCode: "CLOCK_TEMPORARY_FAILURE", httpStatus: 503 });
    const evidence = await m.prisma.storageFile.findMany({ where: { employeeId: employees.auditDown!, module: "FICHADAS" } });
    expect(evidence.length).toBeGreaterThanOrEqual(1);
    expect(evidence.every((file) => file.status === "DELETED")).toBe(true);

    // Mismo requestId: devuelve el resultado guardado, sin volver a fichar.
    expect(await call("POST", "/clock/photo-punch", deviceA, failing)).toMatchObject({ status: 503, error: { code: "CLOCK_TEMPORARY_FAILURE" } });
    expect(await punchesOf("auditDown")).toHaveLength(0);

    // requestId nuevo (la PWA lo genera para la próxima intención): ficha con su única auditoría.
    expect((await call("POST", "/clock/photo-punch", deviceA, body("auditDown", "IN"))).status).toBe(201);
    const [shift] = await m.prisma.workShift.findMany({ where: { employeeId: employees.auditDown! } });
    expect(await punchesOf("auditDown")).toHaveLength(1);
    expect(await m.prisma.auditLog.count({ where: { entity: "WorkShift", entityId: shift!.id } })).toBe(1);
  });

  // ── F7.1 (plan §26.12): source de la jornada a través del cutover legacy → /api/clock ──
  // Desde F11 el alias no existe: una jornada PUBLIC_CLOCK_PHOTO abierta sólo puede ser
  // HISTÓRICA (abierta antes del retiro). Se siembra con el repositorio, igual que la dejaba
  // el alias, y se cierra o reemplaza por /api/clock.

  /**
   * Ingreso y después se adelanta la jornada `minutes` hacia atrás en esta base de test
   * (inicio y fichada de ingreso), para que la salida produzca tramos y TimeEntry reales (una
   * jornada de segundos no genera horas) y quede fuera del cooldown. `kiosk` ficha por HTTP;
   * `historicalLegacy` siembra la jornada PUBLIC_CLOCK_PHOTO que dejaba el alias retirado.
   */
  async function clockInAndAge(employeeKey: string, entry: "kiosk" | "historicalLegacy", device: Device, minutes: number) {
    if (entry === "kiosk") {
      expect((await call("POST", "/clock/photo-punch", device, body(employeeKey, "IN"))).status).toBe(201);
    } else {
      const normal = (await m.prisma.hourConcept.findFirst({ where: { code: "HC-NORMAL" } }))!;
      await m.repository.createOpenWorkShift({
        employeeId: employees[employeeKey]!,
        hourConceptId: normal.id,
        hourConceptName: normal.name,
        source: "PUBLIC_CLOCK_PHOTO",
        startAt: new Date(),
        punchEvidence: { deviceId: device.id, faceDetected: true, faceValidationStatus: "VALID" },
      });
    }
    const shift = (await m.prisma.workShift.findFirst({ where: { employeeId: employees[employeeKey]!, status: "ABIERTO" } }))!;
    const startAt = new Date(shift.startAt.getTime() - minutes * 60_000);
    await m.prisma.workShift.update({ where: { id: shift.id }, data: { startAt } });
    await m.prisma.attendancePunch.update({ where: { id: shift.startPunchId! }, data: { timestamp: startAt } });
    return shift.id;
  }

  async function sourcesOf(workShiftId: string) {
    const shift = (await m.prisma.workShift.findUnique({ where: { id: workShiftId }, include: { startPunch: true, endPunch: true, timeEntries: true } }))!;
    return { shift: shift.source, status: shift.status, start: shift.startPunch?.source, end: shift.endPunch?.source, entries: shift.timeEntries.map((entry) => entry.source) };
  }

  it.each([
    ["jornada legacy histórica → KIOSK OUT (cutover): la salida es KIOSK pero la jornada y sus horas conservan PUBLIC_CLOCK_PHOTO", "cutover", "historicalLegacy", { start: "PUBLIC_CLOCK_PHOTO", end: "KIOSK", shift: "PUBLIC_CLOCK_PHOTO" }],
    ["KIOSK IN → KIOSK OUT: todo KIOSK", "kioskBoth", "kiosk", { start: "KIOSK", end: "KIOSK", shift: "KIOSK" }],
  ] as const)("%s", async (_label, employeeKey, entry, expected) => {
    const workShiftId = await clockInAndAge(employeeKey, entry, deviceA, 90);

    const exit = await call("POST", "/clock/photo-punch", deviceB, body(employeeKey, "OUT"));
    expect(exit.status).toBe(201);

    const sources = await sourcesOf(workShiftId);
    expect(sources).toMatchObject({ status: "PROCESADO", start: expected.start, end: expected.end, shift: expected.shift });
    expect(sources.entries.length).toBeGreaterThanOrEqual(1);
    expect(new Set(sources.entries)).toEqual(new Set([expected.shift])); // TimeEntry.source = WorkShift.source
    const minutes = (await m.prisma.timeEntry.aggregate({ where: { workShiftId }, _sum: { totalMinutes: true } }))._sum.totalMinutes;
    expect(minutes).toBe(90); // el motor de horas cerró la jornada real
    expect((await m.prisma.attendancePunch.findUnique({ where: { id: (await m.prisma.workShift.findUnique({ where: { id: workShiftId } }))!.endPunchId! } }))!.deviceId).toBe(deviceB.id);
  });

  it("rollover: jornada legacy histórica vencida + IN por /api/clock → la vieja y su TimeEntry 0 h quedan PUBLIC_CLOCK_PHOTO; la fichada y la jornada nuevas son KIOSK", async () => {
    const oldShiftId = await clockInAndAge("rollover", "historicalLegacy", deviceA, 21 * 60);

    const entry = await call("POST", "/clock/photo-punch", deviceB, body("rollover", "IN"));
    expect(entry.status).toBe(201);
    expect(entry.data!.previousOpenShift).toMatchObject({ id: oldShiftId, status: "FALTA_SALIDA" });

    const old = await sourcesOf(oldShiftId);
    expect(old).toMatchObject({ status: "FALTA_SALIDA", shift: "PUBLIC_CLOCK_PHOTO", start: "PUBLIC_CLOCK_PHOTO" });
    expect(old.entries).toEqual(["PUBLIC_CLOCK_PHOTO"]);
    const fresh = await sourcesOf(entry.data!.workShift.id);
    expect(fresh).toMatchObject({ status: "ABIERTO", shift: "KIOSK", start: "KIOSK" });
    expect(fresh.entries).toEqual([]);
  });

  // ── F7.1 (plan §26.13): el reintento de un cooldown conserva el retryAfterSeconds original ──

  it("cooldown recuperado por requestId conserva retryAfterSeconds (reintento y GET attempts), sin recalcular con el reloj", async () => {
    expect((await call("POST", "/clock/photo-punch", deviceA, body("retryMeta", "IN"))).status).toBe(201);
    const exit = body("retryMeta", "OUT");

    const first = await call("POST", "/clock/photo-punch", deviceA, exit);
    expect(first).toMatchObject({ status: 409, error: { code: "CLOCK_PUNCH_COOLDOWN" } });
    const original = first.error!.retryAfterSeconds!;
    expect(original).toBeGreaterThanOrEqual(1);

    await sleep(1_500); // un recálculo daría al menos un segundo menos

    const retry = await call("POST", "/clock/photo-punch", deviceA, exit);
    expect(retry).toMatchObject({ status: 409, error: { code: "CLOCK_PUNCH_COOLDOWN", retryAfterSeconds: original } });
    expect(retry.error).not.toHaveProperty("details");

    const polled = await call("GET", `/clock/attempts/${exit.requestId}?employeeId=${employees.retryMeta}`, deviceA);
    expect(polled).toMatchObject({ status: 200, data: { status: "FAILED", response: null, error: { code: "CLOCK_PUNCH_COOLDOWN", httpStatus: 409, retryAfterSeconds: original } } });

    const stored = (await m.prisma.clockPunchAttempt.findUnique({ where: { requestId: exit.requestId } }))!;
    expect(stored.response).toEqual({ error: { retryAfterSeconds: original } });

    // Aislamiento F6 intacto: otro dispositivo no lo ve ni lo reutiliza.
    expect(await call("GET", `/clock/attempts/${exit.requestId}?employeeId=${employees.retryMeta}`, deviceB)).toMatchObject({ status: 404, error: { code: "CLOCK_ATTEMPT_NOT_FOUND" } });
    const reused = await call("POST", "/clock/photo-punch", deviceB, exit);
    expect(reused).toMatchObject({ status: 409, error: { code: "CLOCK_IDEMPOTENCY_KEY_REUSED" } });
    expect(reused.error).not.toHaveProperty("retryAfterSeconds");
    expect(await punchesOf("retryMeta")).toHaveLength(1);
  });
});
