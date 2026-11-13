/**
 * Alta mínima de legajo contra PostgreSQL REAL (migración
 * 20261113120000_make_employee_cuil_optional): un legajo con sólo legajo, DNI,
 * nombre y apellido se crea ACTIVO, sin datos inventados, se completa después y
 * el fichador lo encuentra, lo consulta por employeeId y le registra una
 * fichada con las reglas normales. Sólo el object storage primario se
 * reemplaza por uno en memoria.
 *
 * Opt-in: sólo corre con `EMPLOYEE_MINIMAL_IT_DATABASE_URL` → `localhost`, base
 * `clock_it*` PROPIA con el schema de este commit. VACÍA la base al empezar.
 * Nunca usa el DATABASE_URL del .env y verifica `current_database()`.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.EMPLOYEE_MINIMAL_IT_DATABASE_URL;

vi.mock("../../shared/storage/neonObjectStorage.provider", async () => ({
  neonObjectStorageProvider: (await import("../../shared/testing/inMemoryObjectStorage")).inMemoryObjectStorage.provider,
}));

const PHOTO = `data:image/jpeg;base64,${Buffer.alloc(6000, 1).toString("base64")}`;

type Modules = {
  env: typeof import("../../config/env").env;
  prisma: typeof import("../../shared/prisma/client").prisma;
  worker: typeof import("../clock/clockPunchPostProcess.worker");
  employees: typeof import("./employees.service").employeesService;
  schemas: typeof import("./employees.schemas");
};

describe.skipIf(!url)("Alta mínima de legajo contra PostgreSQL local", () => {
  let m: Modules;
  let holder: PrismaClient;
  let server: Server;
  let baseUrl: string;
  let device: { id: string; secret: string };
  let originalPunchPhotoProvider: Modules["env"]["PUNCH_PHOTO_STORAGE_PROVIDER"];
  let rrhhUserId: string;
  let minimalId: string;

  const create = (payload: Record<string, unknown>) => m.employees.create(m.schemas.createEmployeeSchema.parse(payload), { userId: rrhhUserId });
  const clock = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}/clock${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: `ClockDevice ${device.id}.${device.secret}` },
    });

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("EMPLOYEE_MINIMAL_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ createApp }, { env }, { prisma }, worker, { employeesService }, schemas, credentials] = await Promise.all([
      import("../../app"),
      import("../../config/env"),
      import("../../shared/prisma/client"),
      import("../clock/clockPunchPostProcess.worker"),
      import("./employees.service"),
      import("./employees.schemas"),
      import("../../shared/security/clockDeviceCredentials"),
    ]);
    m = { env, prisma, worker, employees: employeesService, schemas };
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WorkShift_one_open_per_employee" ON "WorkShift"("employeeId") WHERE status = 'ABIERTO' AND "endAt" IS NULL`);

    await holder.hourConcept.create({ data: { code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", systemRole: "NORMAL_BASE" } });
    rrhhUserId = (await holder.user.create({ data: { name: "RRHH IT", email: "rrhh-minimal@example.com", passwordHash: "x", role: "NIVEL_1_RRHH" } })).id;

    const secret = credentials.generateClockDeviceSecret();
    const created = await holder.clockDevice.create({ data: { name: "TEST ALTA MINIMA", status: "ACTIVE", tokenHash: credentials.hashClockDeviceSecret(secret), activatedAt: new Date(), lastSeenAt: new Date() } });
    device = { id: created.id, secret };

    originalPunchPhotoProvider = env.PUNCH_PHOTO_STORAGE_PROVIDER;
    env.PUNCH_PHOTO_STORAGE_PROVIDER = "neon_object_storage";
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

  it("caso de aceptación: Legajo 0001, DNI 12345678, Juan Perez y nada más → se crea ACTIVO y sin datos inventados", async () => {
    // Mismo cuerpo que envía el formulario con todo lo demás vacío.
    const created = await create({
      legajo: "0001", dni: "12345678", firstName: "Juan", lastName: "Perez",
      legajoFinnegans: null, cuil: null, birthDate: null, gender: null, civilStatus: null, nationality: null,
      email: null, phone: null, mobile: null, emergencyContact: null, emergencyRelation: null, emergencyPhone: null,
      status: "ACTIVO", positionId: null, costCenterId: null, healthInsurance: null, agreement: null, receiptCategory: null, internalCategory: null,
      companyIds: [], primaryCompanyId: null,
    });
    minimalId = created.id;

    const row = await holder.employee.findUniqueOrThrow({
      where: { id: minimalId },
      include: { address: true, companies: true, laborMovements: true, workLocations: true, assignments: true, hourConcepts: true, transport: true },
    });
    expect(row).toMatchObject({
      legajo: "0001", dni: "12345678", firstName: "Juan", lastName: "Perez", status: "ACTIVO",
      cuil: null, birthDate: null, gender: null, nationality: null, civilStatus: null, positionId: null, costCenterId: null, legajoFinnegans: null,
    });
    expect(row.address).toBeNull();
    expect(row.transport).toBeNull();
    expect(row.companies).toEqual([]);
    expect(row.laborMovements).toEqual([]);
    expect(row.workLocations).toEqual([]);
    expect(row.assignments).toEqual([]);
    expect(row.hourConcepts).toEqual([]);
    // La historia laboral se abre sin valores (sin puesto, centro de costo ni empleador).
    expect(await holder.employeePositionPeriod.findMany({ where: { employeeId: minimalId }, select: { positionId: true } })).toEqual([{ positionId: null }]);
    expect(await holder.employeeCostCenterPeriod.findMany({ where: { employeeId: minimalId }, select: { costCenterId: true } })).toEqual([{ costCenterId: null }]);
    expect(await holder.auditLog.count({ where: { entity: "Employee", entityId: minimalId, action: "CREATE" } })).toBe(1);
  });

  it("varios legajos sin CUIL conviven; un CUIL real sigue siendo único (servicio 409 y restricción de PostgreSQL)", async () => {
    await create({ legajo: "0002", dni: "22345678", firstName: "Ana", lastName: "Gomez" });
    await create({ legajo: "0003", dni: "32345678", firstName: "Luis", lastName: "Diaz", cuil: null });
    expect(await holder.employee.count({ where: { cuil: null } })).toBe(3);

    await create({ legajo: "0004", dni: "42345678", firstName: "Eva", lastName: "Ruiz", cuil: "20-42345678-1" });
    await expect(create({ legajo: "0005", dni: "52345678", firstName: "Leo", lastName: "Sosa", cuil: "20-42345678-1" })).rejects.toMatchObject({ statusCode: 409, code: "EMPLOYEE_ALREADY_EXISTS" });
    // Aun salteando el chequeo del servicio, el índice único rechaza el CUIL repetido.
    const direct = holder.employee.create({ data: { legajo: "0005", dni: "52345678", firstName: "Leo", lastName: "Sosa", cuil: "20-42345678-1" } });
    await expect(direct).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    await expect(direct).rejects.toMatchObject({ code: "P2002" });
  });

  it("DNI o legajo duplicados se siguen rechazando aunque ninguno tenga CUIL", async () => {
    await expect(create({ legajo: "0099", dni: "12345678", firstName: "Otro", lastName: "Perez" })).rejects.toMatchObject({ statusCode: 409, code: "EMPLOYEE_ALREADY_EXISTS" });
    await expect(create({ legajo: "0001", dni: "99345678", firstName: "Otro", lastName: "Perez" })).rejects.toMatchObject({ statusCode: 409, code: "EMPLOYEE_ALREADY_EXISTS" });
    expect(await holder.employee.count({ where: { legajo: { in: ["0099"] } } })).toBe(0);
  });

  it("con fecha de alta, el movimiento ALTA inicial se mantiene como antes", async () => {
    const created = await create({ legajo: "0006", dni: "62345678", firstName: "Sol", lastName: "Paz", initialLaborMovement: { type: "ALTA", effectiveFrom: "2026-01-05", reason: "Reingreso" } });
    const movements = await holder.laborMovement.findMany({ where: { employeeId: created.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: "ALTA", reason: "Reingreso", createdByUserId: rrhhUserId });
    expect((await holder.employee.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("ACTIVO");
  });

  it("el fichador lo encuentra, lo consulta por employeeId y registra el ingreso con las reglas normales", async () => {
    const search = await clock("/employees?search=Perez");
    expect(search.status).toBe(200);
    const found = ((await search.json()) as { data: Array<{ id: string; legajo: string }> }).data;
    expect(found).toEqual([expect.objectContaining({ id: minimalId, legajo: "0001" })]);

    const status = await clock("/status", { method: "POST", body: JSON.stringify({ employeeId: minimalId }) });
    expect(status.status).toBe(200);
    expect(((await status.json()) as { data: { employee: { id: string }; openShift: unknown } }).data).toMatchObject({ employee: { id: minimalId }, openShift: null });

    const punch = await clock("/photo-punch", {
      method: "POST",
      body: JSON.stringify({ requestId: randomUUID(), employeeId: minimalId, punchType: "IN", photo: PHOTO, faceValidationStatus: "VALID", faceDetectionScore: 0.97 }),
    });
    expect(punch.status).toBe(201);
    await m.worker.drainClockPunchPostProcess({ employeeIds: [minimalId] });
    expect(await holder.attendancePunch.count({ where: { employeeId: minimalId } })).toBe(1);
    expect(await holder.workShift.count({ where: { employeeId: minimalId, status: "ABIERTO" } })).toBe(1);
  });

  it("los datos faltantes se completan después sin inconsistencias, y se pueden volver a vaciar sin chocar con otros legajos sin CUIL", async () => {
    await m.employees.update(minimalId, m.schemas.updateEmployeeSchema.parse({ cuil: "20-12345678-3", birthDate: "1990-05-10", gender: "Masculino", nationality: "Argentina" }), { userId: rrhhUserId });
    const completed = await holder.employee.findUniqueOrThrow({ where: { id: minimalId } });
    expect(completed).toMatchObject({ cuil: "20-12345678-3", gender: "Masculino", nationality: "Argentina" });
    expect(completed.birthDate?.toISOString().slice(0, 10)).toBe("1990-05-10");

    // Vaciar el CUIL (null) no se compara contra los otros legajos sin CUIL, y nacimiento null queda null (no 1970-01-01).
    await m.employees.update(minimalId, m.schemas.updateEmployeeSchema.parse({ cuil: null, birthDate: null }), { userId: rrhhUserId });
    expect(await holder.employee.findUniqueOrThrow({ where: { id: minimalId } })).toMatchObject({ cuil: null, birthDate: null });
  });
});
