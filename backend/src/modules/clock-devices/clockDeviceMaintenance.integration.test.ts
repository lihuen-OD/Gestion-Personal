/**
 * Acceso de mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md) contra
 * PostgreSQL REAL: un solo uso bajo concurrencia, vencimiento, código ligado al
 * dispositivo, anulación por intentos, revocación y las CHECK de la migración.
 * Todo pasa por la app real (createApp, requireAuth/requireClockDevice,
 * limitadores, controllers, servicio, repositorio y auditoría).
 *
 * Opt-in: sólo corre con `CLOCK_MAINTENANCE_IT_DATABASE_URL` → `localhost`, base
 * `clock_it*` PROPIA (las otras integraciones vacían la suya al empezar). Las
 * CHECK no las crea `db push`: la base se arma con el SQL del schema anterior
 * (`prisma migrate diff --from-empty --to-schema-datamodel <schema previo> --script`)
 * más `prisma db execute` de la migración 20261026120000, y `prisma migrate diff
 * --from-url <url> --to-schema-datamodel prisma/schema.prisma` tiene que dar
 * vacío. Nunca usa el DATABASE_URL del .env y verifica `current_database()`
 * antes de escribir.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const url = process.env.CLOCK_MAINTENANCE_IT_DATABASE_URL;

type Device = { id: string; secret: string };
type Json = Record<string, any>;

describe.skipIf(!url)("Mantenimiento del fichador contra PostgreSQL local", () => {
  let holder: PrismaClient;
  let appPrisma: { $disconnect: () => Promise<void> };
  let credentials: typeof import("../../shared/security/clockDeviceCredentials");
  let server: Server;
  let baseUrl: string;
  let token: string;
  let rrhhUserId: string;
  let jwtSecret: string;
  let seq = 0;

  async function device(name: string, status: "ACTIVE" | "REVOKED" = "ACTIVE"): Promise<Device> {
    const secret = credentials.generateClockDeviceSecret();
    const created = await holder.clockDevice.create({ data: { name: `TEST MANT ${name} ${++seq}`, status, tokenHash: credentials.hashClockDeviceSecret(secret), activatedAt: new Date() } });
    return { id: created.id, secret };
  }

  async function call(method: string, path: string, options: { device?: Device; bearer?: boolean; body?: unknown; session?: string } = {}) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.device) headers.authorization = `ClockDevice ${options.device.id}.${options.device.secret}`;
    if (options.bearer) headers.authorization = `Bearer ${token}`;
    if (options.session) headers["x-clock-maintenance-session"] = options.session;
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const json = (await response.json().catch(() => null)) as { data?: Json; error?: { code: string } } | null;
    return { status: response.status, data: json?.data, error: json?.error, cacheControl: response.headers.get("cache-control") };
  }

  const issue = async (entry: Device) => {
    const result = await call("POST", `/clock-devices/${entry.id}/maintenance-code`, { bearer: true });
    expect(result.status).toBe(201);
    return result.data!.code as string;
  };
  const open = (entry: Device, code: string) => call("POST", "/clock/maintenance/session", { device: entry, body: { code } });
  const rowOf = (entry: Device) => holder.clockDevice.findUniqueOrThrow({ where: { id: entry.id } });
  const wrongCodeFor = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("CLOCK_MAINTENANCE_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    delete (globalThis as { prisma?: unknown }).prisma;

    const [{ createApp }, { env }, { prisma }, creds] = await Promise.all([
      import("../../app"),
      import("../../config/env"),
      import("../../shared/prisma/client"),
      import("../../shared/security/clockDeviceCredentials"),
    ]);
    credentials = creds;
    appPrisma = prisma;
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);

    jwtSecret = env.JWT_ACCESS_SECRET;
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${env.API_PREFIX}`;
  }, 60_000);

  // La emisión tiene cupo por usuario RRHH (10 / 5 min): un usuario por test.
  beforeEach(async () => {
    const rrhh = await holder.user.create({ data: { name: "RRHH Mantenimiento", email: `rrhh-mant-${++seq}@example.com`, passwordHash: "x", role: "NIVEL_1_RRHH" } });
    rrhhUserId = rrhh.id;
    token = jwt.sign({ sub: rrhh.id, email: rrhh.email, role: rrhh.role }, jwtSecret, { expiresIn: "15m" });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await appPrisma?.$disconnect();
    await holder?.$disconnect();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  it("RRHH genera el código: sólo el hash en la fila, no-store, auditoría con el usuario y sin el código", async () => {
    const kiosk = await device("emisión");
    const result = await call("POST", `/clock-devices/${kiosk.id}/maintenance-code`, { bearer: true });

    expect(result.status).toBe(201);
    expect(result.cacheControl).toBe("no-store");
    expect(result.data).toMatchObject({ code: expect.stringMatching(/^\d{6}$/), expiresInSeconds: 300 });
    const row = await rowOf(kiosk);
    expect(row.maintenanceCodeHash).toBe(credentials.maintenanceCodeHash(kiosk.id, result.data!.code));
    expect(row.maintenanceCodeExpiresAt!.getTime()).toBe(Date.parse(result.data!.expiresAt));
    expect(JSON.stringify(row)).not.toContain(result.data!.code);
    const audit = await holder.auditLog.findFirstOrThrow({ where: { entity: "ClockDeviceMaintenance", entityId: kiosk.id, action: "CREATE" } });
    expect(audit.userId).toBe(rrhhUserId);
    expect(JSON.stringify(audit)).not.toContain(result.data!.code);
  });

  it("canje válido: abre la sesión (sólo su hash en la base), audita el ingreso con el dispositivo como actor y el código no sirve dos veces", async () => {
    const kiosk = await device("canje");
    const code = await issue(kiosk);
    const opened = await open(kiosk, code);

    expect(opened.status).toBe(201);
    const row = await rowOf(kiosk);
    expect(row).toMatchObject({ maintenanceCodeHash: null, maintenanceCodeExpiresAt: null, maintenanceCodeFailedAttempts: 0 });
    expect(row.maintenanceSessionHash).toBe(credentials.hashClockDeviceSecret(opened.data!.token));
    expect(JSON.stringify(row)).not.toContain(opened.data!.token);
    const login = await holder.auditLog.findFirstOrThrow({ where: { entity: "ClockDeviceMaintenance", entityId: kiosk.id, action: "LOGIN" } });
    expect(login.userId).toBeNull();
    expect(login.after).toMatchObject({ actorClockDeviceId: kiosk.id });

    expect(await open(kiosk, code)).toMatchObject({ status: 401, error: { code: "CLOCK_MAINTENANCE_CODE_INVALID" } });
    const session = await call("GET", "/clock/maintenance/session", { device: kiosk, session: opened.data!.token });
    expect(session.status).toBe(200);
    expect(session.data!.device).toMatchObject({ status: "ACTIVE", connectivity: expect.any(String) });
    expect(session.data!.device).not.toHaveProperty("id");
  });

  it("un solo uso bajo concurrencia: 5 canjes simultáneos del mismo código → exactamente un 201", async () => {
    const kiosk = await device("concurrencia");
    const code = await issue(kiosk);
    const results = await Promise.all(Array.from({ length: 5 }, () => open(kiosk, code)));
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => result.status === 401)).toHaveLength(4);
    expect(await holder.auditLog.count({ where: { entity: "ClockDeviceMaintenance", entityId: kiosk.id, action: "LOGIN" } })).toBe(1);
  });

  it("el código de A no sirve en B (misma respuesta que uno inexistente) y no se consume: A lo usa después", async () => {
    const a = await device("A");
    const b = await device("B");
    const code = await issue(a);
    const crossed = await open(b, code);
    const unknown = await open(b, wrongCodeFor(code));
    expect(crossed).toMatchObject({ status: 401, error: { code: "CLOCK_MAINTENANCE_CODE_INVALID" } });
    expect(crossed.error).toEqual(unknown.error);
    expect((await open(a, code)).status).toBe(201);
  });

  it("vencimiento real: un código vencido no entra y una sesión vencida deja de servir", async () => {
    const kiosk = await device("vencimiento");
    const code = await issue(kiosk);
    await holder.clockDevice.update({ where: { id: kiosk.id }, data: { maintenanceCodeExpiresAt: new Date(Date.now() - 1_000) } });
    expect(await open(kiosk, code)).toMatchObject({ status: 401, error: { code: "CLOCK_MAINTENANCE_CODE_INVALID" } });

    const opened = await open(kiosk, await issue(kiosk));
    expect(opened.status).toBe(201);
    await holder.clockDevice.update({ where: { id: kiosk.id }, data: { maintenanceSessionExpiresAt: new Date(Date.now() - 1_000) } });
    expect(await call("GET", "/clock/maintenance/session", { device: kiosk, session: opened.data!.token })).toMatchObject({ status: 401, error: { code: "CLOCK_MAINTENANCE_SESSION_INVALID" } });
  });

  it("un código nuevo invalida el anterior; 5 intentos fallidos anulan el vigente (auditado)", async () => {
    const kiosk = await device("intentos");
    const first = await issue(kiosk);
    let second = await issue(kiosk);
    while (second === first) second = await issue(kiosk);
    // El canje de `first` (ya reemplazado) cuenta como fallo contra el código vigente.
    expect((await open(kiosk, first)).status).toBe(401);
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await open(kiosk, wrongCodeFor(second))).status).toBe(401);
    expect((await rowOf(kiosk)).maintenanceCodeFailedAttempts).toBe(4);
    // El 5.º fallo anula el código: el correcto ya no entra.
    expect((await open(kiosk, wrongCodeFor(second))).status).toBe(401);
    expect(await rowOf(kiosk)).toMatchObject({ maintenanceCodeHash: null, maintenanceCodeExpiresAt: null, maintenanceCodeFailedAttempts: 0 });
    expect((await open(kiosk, second)).status).toBe(401);

    const rejects = await holder.auditLog.findMany({ where: { entity: "ClockDeviceMaintenance", entityId: kiosk.id, action: "REJECT" }, orderBy: { createdAt: "asc" } });
    // Sólo los 5 intentos contra un código vigente; el posterior a la anulación no se audita.
    expect(rejects).toHaveLength(5);
    expect(rejects.at(-1)!.description).toContain("quedó anulado por exceso de intentos");
    expect(rejects.every((entry) => !JSON.stringify(entry).includes(second))).toBe(true);
  });

  it("revocar desde Admin corta el mantenimiento en el mismo UPDATE: la sesión deja de servir y no se pueden generar códigos", async () => {
    const kiosk = await device("revocado");
    const opened = await open(kiosk, await issue(kiosk));
    expect(opened.status).toBe(201);
    await issue(kiosk);

    expect((await call("POST", `/clock-devices/${kiosk.id}/revoke`, { bearer: true })).status).toBe(200);
    expect(await rowOf(kiosk)).toMatchObject({ status: "REVOKED", maintenanceCodeHash: null, maintenanceCodeExpiresAt: null, maintenanceSessionHash: null, maintenanceSessionExpiresAt: null });
    expect(await call("GET", "/clock/maintenance/session", { device: kiosk, session: opened.data!.token })).toMatchObject({ status: 403, error: { code: "CLOCK_DEVICE_REVOKED" } });
    expect(await call("POST", `/clock-devices/${kiosk.id}/maintenance-code`, { bearer: true })).toMatchObject({ status: 409, error: { code: "CLOCK_MAINTENANCE_DEVICE_NOT_ACTIVE" } });
  });

  it("CHECK de la migración: un no ACTIVE no puede tener estado de mantenimiento, y hash y vencimiento van juntos", async () => {
    const revoked = await device("check revocado", "REVOKED");
    const active = await device("check activo");
    const later = new Date(Date.now() + 60_000);
    await expect(holder.clockDevice.update({ where: { id: revoked.id }, data: { maintenanceCodeHash: "h".repeat(64), maintenanceCodeExpiresAt: later } })).rejects.toThrow(/ClockDevice_maintenance_active_only_check/);
    await expect(holder.clockDevice.update({ where: { id: revoked.id }, data: { maintenanceSessionHash: "s".repeat(64), maintenanceSessionExpiresAt: later } })).rejects.toThrow(/ClockDevice_maintenance_active_only_check/);
    await expect(holder.clockDevice.update({ where: { id: active.id }, data: { maintenanceCodeHash: "h".repeat(64) } })).rejects.toThrow(/ClockDevice_maintenance_code_shape_check/);
    await expect(holder.clockDevice.update({ where: { id: active.id }, data: { maintenanceSessionExpiresAt: later } })).rejects.toThrow(/ClockDevice_maintenance_session_shape_check/);
  });
});
