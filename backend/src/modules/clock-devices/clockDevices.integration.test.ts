/**
 * F9 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §28) contra PostgreSQL REAL: heartbeat,
 * conectividad derivada en el listado RRHH, edición con auditoría, "Kiosco · <dispositivo>" en
 * Asistencia (sin N+1) y limpieza de solicitudes PENDING abandonadas. Todo pasa por la app real
 * (createApp, requireClockDevice/requireAuth, controllers, servicios, repositorios, auditoría);
 * sólo el storage de fotos se reemplaza por filas StorageFile locales.
 *
 * Opt-in: sólo corre con `CLOCK_DEVICES_IT_DATABASE_URL` → `localhost`, base `clock_it*` PROPIA
 * (no la de clock.integration.test.ts: las dos vacían su base al empezar y pueden correr en
 * paralelo), con el schema de este commit (`DATABASE_URL=<url> npx prisma db push --skip-generate`).
 * Nunca usa el DATABASE_URL del .env y verifica `current_database()` antes de escribir.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ManagedStorageObjectInput } from "../../shared/storage/storage.types";

const url = process.env.CLOCK_DEVICES_IT_DATABASE_URL;

vi.mock("../../shared/storage/storage.service", () => ({
  storageService: { uploadManaged: vi.fn(), deleteManaged: vi.fn() },
}));

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const PHOTO = `data:image/jpeg;base64,${Buffer.alloc(6000, 1).toString("base64")}`;
const HOUR = 60 * 60_000;

type Device = { id: string; secret: string };
type Json = Record<string, any>;
type Modules = {
  createApp: typeof import("../../app").createApp;
  env: typeof import("../../config/env").env;
  prisma: typeof import("../../shared/prisma/client").prisma;
  service: typeof import("./clockDevices.service").clockDevicesService;
  credentials: typeof import("../../shared/security/clockDeviceCredentials");
};

describe.skipIf(!url)("F9 — dispositivos de fichada contra PostgreSQL local", () => {
  let m: Modules;
  let holder: PrismaClient;
  let server: Server;
  let baseUrl: string;
  let token: string;
  let rrhhUserId: string;
  const employees: string[] = [];
  const establishments: Record<"norte" | "sur" | "inactivo", string> = { norte: "", sur: "", inactivo: "" };
  let queryLog: string[] = [];

  async function device(name: string | null, status: "PENDING" | "ACTIVE" | "REVOKED", data: Json = {}): Promise<Device> {
    const secret = m.credentials.generateClockDeviceSecret();
    const created = await holder.clockDevice.create({
      data: { name, status, tokenHash: m.credentials.hashClockDeviceSecret(secret), ...(status === "ACTIVE" ? { activatedAt: new Date() } : {}), ...data },
    });
    return { id: created.id, secret };
  }

  async function call(method: string, path: string, options: { device?: Device; bearer?: boolean; body?: unknown; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { "content-type": "application/json", ...options.headers };
    if (options.device) headers.authorization = `ClockDevice ${options.device.id}.${options.device.secret}`;
    if (options.bearer) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const json = (await response.json().catch(() => null)) as { data?: any; error?: { code: string } } | null;
    return { status: response.status, data: json?.data, error: json?.error };
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("CLOCK_DEVICES_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    // shared/prisma/client reutiliza globalThis.prisma: un cliente creado antes en este proceso
    // apuntaría al .env. Se descarta para que el import de abajo cree uno contra la base de prueba.
    delete (globalThis as { prisma?: unknown }).prisma;

    const [{ createApp }, { env }, { prisma }, { clockDevicesService }, credentials, { storageService }] = await Promise.all([
      import("../../app"),
      import("../../config/env"),
      import("../../shared/prisma/client"),
      import("./clockDevices.service"),
      import("../../shared/security/clockDeviceCredentials"),
      import("../../shared/storage/storage.service"),
    ]);
    m = { createApp, env, prisma, service: clockDevicesService, credentials };

    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });

    // Cuenta las sentencias SQL que emite el cliente de la APP (no el holder) para medir N+1.
    (globalThis as unknown as { prisma: PrismaClient<{ log: [{ emit: "event"; level: "query" }] }> }).prisma.$on("query", (event) => queryLog.push(event.query));

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WorkShift_one_open_per_employee" ON "WorkShift"("employeeId") WHERE status = 'ABIERTO' AND "endAt" IS NULL`);

    await holder.hourConcept.create({ data: { code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", systemRole: "NORMAL_BASE" } });
    for (let index = 1; index <= 4; index += 1) {
      const created = await holder.employee.create({ data: { legajo: `F9-${index}`, cuil: `20-9${index}`, dni: `9${index}`, firstName: "Prueba", lastName: `F9 ${index}` } });
      employees.push(created.id);
    }
    const zone = await holder.zone.create({ data: { name: "Zona Centro", code: "ZC" } });
    establishments.norte = (await holder.establishment.create({ data: { name: "Planta Norte", code: "PN", isLegacy: false, zoneId: zone.id } })).id;
    establishments.sur = (await holder.establishment.create({ data: { name: "Planta Sur", code: "PS", isLegacy: false, zoneId: zone.id } })).id;
    establishments.inactivo = (await holder.establishment.create({ data: { name: "Depósito cerrado", code: "DC", isLegacy: false, zoneId: zone.id, status: "INACTIVO" } })).id;

    const rrhh = await holder.user.create({ data: { name: "RRHH F9", email: "rrhh-f9@example.com", passwordHash: "x", role: "NIVEL_1_RRHH" } });
    rrhhUserId = rrhh.id;
    token = jwt.sign({ sub: rrhh.id, email: rrhh.email, role: rrhh.role }, env.JWT_ACCESS_SECRET, { expiresIn: "15m" });

    vi.mocked(storageService.uploadManaged).mockImplementation((async (input: ManagedStorageObjectInput) => holder.storageFile.create({
      data: {
        storageProvider: "LOCAL", storageKey: `it/${randomUUID()}`, fileName: input.fileName, originalFileName: input.fileName, mimeType: input.mimeType,
        extension: "jpg", sizeBytes: input.buffer?.length ?? 0, module: input.module, entityType: input.entityType, entityId: input.entityId,
        employeeId: input.employeeId ?? null, attendancePunchId: input.attendancePunchId ?? null, isThumbnail: input.isThumbnail ?? false,
        originalFileId: input.originalFileId ?? null, visibility: input.visibility ?? "SYSTEM_ONLY",
      },
    })) as never);
    vi.mocked(storageService.deleteManaged).mockImplementation(async (id: string) => {
      await holder.storageFile.update({ where: { id }, data: { status: "DELETED", deletedAt: new Date() } });
    });

    env.CLOCK_PUNCH_COOLDOWN_SECONDS = 0;
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${env.API_PREFIX}`;
  }, 60_000);

  afterAll(async () => {
    await sleep(1_000); // miniatura y auditoría diferidas de la última fichada
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await m?.prisma.$disconnect();
    await holder?.$disconnect();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  it("heartbeat: actualiza lastSeenAt, IP, user-agent y versión desde la request (no del body) y devuelve la hora del servidor", async () => {
    const kiosk = await device("TEST F9 heartbeat", "ACTIVE", { lastSeenAt: new Date(Date.now() - 3 * HOUR), lastAppVersion: "1.0.0" });
    const before = Date.now();

    const result = await call("POST", "/clock/heartbeat", {
      device: kiosk,
      headers: { "user-agent": "iPad F9", "x-clock-app-version": "1.9.0" },
      body: { ip: "10.9.9.9", userAgent: "falso", appVersion: "6.6.6", deviceId: randomUUID() },
    });

    expect(result.status).toBe(200);
    expect(result.data.device).toEqual({ id: kiosk.id, name: "TEST F9 heartbeat", status: "ACTIVE", establishment: null });
    expect(Date.parse(result.data.serverTime)).toBeGreaterThanOrEqual(before - 1_000);
    const row = await holder.clockDevice.findUniqueOrThrow({ where: { id: kiosk.id } });
    expect(row.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect(row.lastIp).toMatch(/127\.0\.0\.1$/);
    expect(row.lastUserAgent).toBe("iPad F9");
    expect(row.lastAppVersion).toBe("1.9.0");
    expect(await holder.auditLog.count({ where: { entityId: kiosk.id } })).toBe(0);
  });

  it("heartbeat de PENDING o REVOKED → 403 sin tocar lastSeenAt", async () => {
    const oldSeen = new Date(Date.now() - 5 * HOUR);
    for (const status of ["PENDING", "REVOKED"] as const) {
      const entry = await device(`TEST F9 ${status}`, status, { lastSeenAt: oldSeen });
      expect((await call("POST", "/clock/heartbeat", { device: entry })).status).toBe(403);
      expect((await holder.clockDevice.findUniqueOrThrow({ where: { id: entry.id } })).lastSeenAt).toEqual(oldSeen);
    }
  });

  it("listado RRHH: conectividad derivada (en línea / sin conexión / nunca) sólo para ACTIVE; un heartbeat lo vuelve a 'en línea'", async () => {
    const online = await device("TEST F9 en línea", "ACTIVE", { lastSeenAt: new Date(Date.now() - 30_000) });
    const offline = await device("TEST F9 sin conexión", "ACTIVE", { lastSeenAt: new Date(Date.now() - 10 * 60_000) });
    const never = await device("TEST F9 nunca", "ACTIVE", { lastSeenAt: null });
    const revoked = await device("TEST F9 revocado reciente", "REVOKED", { lastSeenAt: new Date() });
    const pending = await device(null, "PENDING", { lastSeenAt: new Date() });

    const list = async () => {
      const result = await call("GET", "/clock-devices?take=100", { bearer: true });
      expect(result.status).toBe(200);
      return new Map((result.data as Json[]).map((item) => [item.id, item.connectivity]));
    };
    const first = await list();
    expect([first.get(online.id), first.get(offline.id), first.get(never.id), first.get(revoked.id), first.get(pending.id)]).toEqual(["ONLINE", "OFFLINE", "NEVER_SEEN", null, null]);

    expect((await call("POST", "/clock/heartbeat", { device: offline })).status).toBe(200);
    expect((await list()).get(offline.id)).toBe("ONLINE");
  });

  it("PATCH: renombra y reubica (trim), audita antes/después con el usuario RRHH; rechaza establecimiento inactivo, campos no editables y REVOKED", async () => {
    const kiosk = await device("TEST F9 editable", "ACTIVE", { establishmentId: establishments.norte });

    const renamed = await call("PATCH", `/clock-devices/${kiosk.id}`, { bearer: true, body: { name: "  TEST F9 Pañol principal  ", establishmentId: establishments.sur } });
    expect(renamed.status).toBe(200);
    expect(renamed.data).toMatchObject({ name: "TEST F9 Pañol principal", establishmentId: establishments.sur, establishment: { name: "Planta Sur", zone: { name: "Zona Centro" } } });
    const audit = await holder.auditLog.findFirstOrThrow({ where: { entity: "ClockDevice", entityId: kiosk.id, action: "UPDATE" } });
    expect(audit.userId).toBe(rrhhUserId);
    expect(audit.before).toEqual({ name: "TEST F9 editable", establishmentId: establishments.norte, establishment: "Zona Centro · Planta Norte" });
    expect(audit.after).toEqual({ name: "TEST F9 Pañol principal", establishmentId: establishments.sur, establishment: "Zona Centro · Planta Sur" });
    expect(JSON.stringify(audit)).not.toMatch(/tokenHash|pairing|secret|lastIp|lastUserAgent/);

    expect(await call("PATCH", `/clock-devices/${kiosk.id}`, { bearer: true, body: { establishmentId: establishments.inactivo } })).toMatchObject({ status: 400, error: { code: "CLOCK_DEVICE_ESTABLISHMENT_INVALID" } });
    expect(await call("PATCH", `/clock-devices/${kiosk.id}`, { bearer: true, body: { name: "Otro", status: "REVOKED" } })).toMatchObject({ status: 400, error: { code: "VALIDATION_ERROR" } });
    expect(await call("PATCH", `/clock-devices/${kiosk.id}`, { bearer: true, body: { name: " " } })).toMatchObject({ status: 400, error: { code: "VALIDATION_ERROR" } });
    const row = await holder.clockDevice.findUniqueOrThrow({ where: { id: kiosk.id } });
    expect(row).toMatchObject({ name: "TEST F9 Pañol principal", status: "ACTIVE", establishmentId: establishments.sur });

    const revoked = await device("TEST F9 revocado", "REVOKED");
    expect(await call("PATCH", `/clock-devices/${revoked.id}`, { bearer: true, body: { name: "Renombrado" } })).toMatchObject({ status: 409, error: { code: "CLOCK_DEVICE_NOT_EDITABLE" } });
    expect(await call("PATCH", `/clock-devices/${kiosk.id}`, { device: kiosk, body: { name: "Sin JWT" } })).toMatchObject({ status: 401 });
  });

  it("Asistencia: la fichada KIOSK trae el nombre ACTUAL del dispositivo (también renombrado o revocado), en la misma consulta para 1 o 3 jornadas", async () => {
    const kiosk = await device("TEST F9 Asistencia", "ACTIVE");
    const others = [await device("TEST F9 Asistencia B", "ACTIVE"), await device("TEST F9 Asistencia C", "ACTIVE")];
    const punch = (entry: Device, employeeIndex: number) => call("POST", "/clock/photo-punch", { device: entry, body: { requestId: randomUUID(), employeeId: employees[employeeIndex]!, punchType: "IN", photo: PHOTO, faceValidationStatus: "VALID" } });
    const attendance = async () => {
      await sleep(1_200); // deja terminar la miniatura y la auditoría diferidas antes de medir
      queryLog = [];
      const result = await call("GET", "/time-entries/attendance", { bearer: true });
      expect(result.status).toBe(200);
      return { shifts: result.data.openShifts as Json[], queries: queryLog.length, deviceQueries: queryLog.filter((query) => query.includes('"ClockDevice"')).length };
    };

    expect((await punch(kiosk, 0)).status).toBe(201);
    const one = await attendance();
    const shift = one.shifts.find((item) => item.employeeId === employees[0])!;
    expect(shift).toMatchObject({ source: "KIOSK", startPunch: { source: "KIOSK", device: { name: "TEST F9 Asistencia" } } });
    expect(shift.startPunch.device).toEqual({ name: "TEST F9 Asistencia" });

    expect((await punch(others[0]!, 1)).status).toBe(201);
    expect((await punch(others[1]!, 2)).status).toBe(201);
    const three = await attendance();
    expect(three.shifts.map((item) => item.startPunch.device.name).sort()).toEqual(["TEST F9 Asistencia", "TEST F9 Asistencia B", "TEST F9 Asistencia C"]);
    // Sin N+1: la cantidad de sentencias no crece con las filas.
    expect(three.queries).toBe(one.queries);
    expect(three.deviceQueries).toBe(one.deviceQueries);
    console.info("F9_ATTENDANCE_QUERY_COUNT", { shifts1: one.queries, shifts3: three.queries, clockDeviceStatements: three.deviceQueries });

    expect((await call("PATCH", `/clock-devices/${kiosk.id}`, { bearer: true, body: { name: "TEST F9 Pañol renombrado" } })).status).toBe(200);
    await call("POST", `/clock-devices/${kiosk.id}/revoke`, { bearer: true });
    const after = await attendance();
    expect(after.shifts.find((item) => item.employeeId === employees[0])!.startPunch.device).toEqual({ name: "TEST F9 Pañol renombrado" });
  });

  it("limpieza: sólo borra PENDING abandonados sin historia; nunca ACTIVE, REVOKED ni PENDING con fichadas, intentos o activación previa", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 30 * HOUR);
    const expired = new Date(now.getTime() - 29 * HOUR);
    const stale = { createdAt: old, lastSeenAt: old, pairingExpiresAt: expired, pairingCodeHash: null };

    const abandoned = await device(null, "PENDING", stale);
    const abandonedNeverSeen = await device(null, "PENDING", { ...stale, lastSeenAt: null });
    const recent = await device(null, "PENDING", { createdAt: new Date(now.getTime() - HOUR), lastSeenAt: new Date(now.getTime() - HOUR), pairingExpiresAt: expired });
    const stillPolling = await device(null, "PENDING", { ...stale, lastSeenAt: new Date(now.getTime() - 10_000) });
    const validPairing = await device(null, "PENDING", { ...stale, pairingExpiresAt: new Date(now.getTime() + 5 * 60_000) });
    const activeOld = await device("TEST F9 activo viejo", "ACTIVE", stale);
    const revokedOld = await device("TEST F9 revocado viejo", "REVOKED", stale);
    const onceActivated = await device(null, "PENDING", { ...stale, activatedAt: old });
    const withAttempt = await device(null, "PENDING", stale);
    const withPunch = await device(null, "PENDING", stale);
    await holder.clockPunchAttempt.create({ data: { requestId: randomUUID(), employeeId: employees[3]!, deviceId: withAttempt.id, punchType: "INGRESO", requestHash: "h" } });
    await holder.attendancePunch.create({ data: { employeeId: employees[3]!, type: "INGRESO", timestamp: old, deviceId: withPunch.id } });

    const result = await m.service.cleanupStalePending(now);

    expect(result).toEqual({ deleted: 2 });
    const remaining = new Set((await holder.clockDevice.findMany({ select: { id: true } })).map((row) => row.id));
    expect(remaining.has(abandoned.id)).toBe(false);
    expect(remaining.has(abandonedNeverSeen.id)).toBe(false);
    for (const kept of [recent, stillPolling, validPairing, activeOld, revokedOld, onceActivated, withAttempt, withPunch]) expect(remaining.has(kept.id)).toBe(true);
    const audits = await holder.auditLog.findMany({ where: { entity: "ClockDevice", action: "DELETE", entityId: { in: [abandoned.id, abandonedNeverSeen.id] } } });
    expect(audits).toHaveLength(2);
    expect(audits.every((audit) => audit.userId === null)).toBe(true);

    expect(await m.service.cleanupStalePending(now)).toEqual({ deleted: 0 });
  });
});
