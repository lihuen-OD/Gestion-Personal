/**
 * Alta mínima de legajo contra PostgreSQL REAL (migración
 * 20261113120000_make_employee_cuil_optional): un legajo con sólo legajo, DNI,
 * nombre y apellido se crea ACTIVO, sin datos inventados, se completa después y
 * el fichador lo encuentra, lo consulta por employeeId y le registra una
 * fichada con las reglas normales. Sólo el object storage primario se
 * reemplaza por uno en memoria y Google Drive por uno simulado: con eso se
 * prueba también la organización humana del storage (copia de la foto en
 * Fichadas/... y documentos en Legajos/...) sin estructura organizacional.
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

// Google Drive simulado: guarda lo subido (con su ubicación humana) y puede
// "caerse" para probar que la fichada no depende de Drive.
type FakeDriveFile = { id: string; buffer: Buffer; mimeType: string; fileName: string; driveFolders?: unknown; metadata?: Record<string, string> };
const fakeDrive = vi.hoisted(() => ({ files: [] as FakeDriveFile[], down: false, nextId: 1 }));
const ARCHIVE_ROOT = "root-it-dev";
vi.mock("../../shared/storage/googleDriveStorage.provider", async () => {
  const { AppError } = await import("../../shared/errors/AppError");
  return {
    isGoogleDriveConfigured: () => true,
    googleDriveArchiveAppProperties: (sourceStorageFileId: string, checksum: string | null) => ({ sourceStorageFileId, checksum: checksum || "", archiveRootId: ARCHIVE_ROOT }),
    findGoogleDriveArchiveCopy: async (sourceStorageFileId: string) =>
      fakeDrive.files.find((file) => file.metadata?.sourceStorageFileId === sourceStorageFileId && file.metadata?.archiveRootId === ARCHIVE_ROOT) || null,
    googleDriveStorageProvider: {
      async upload(input: { buffer?: Buffer; mimeType: string; fileName: string; driveFolders?: unknown; metadata?: Record<string, string> }) {
        if (fakeDrive.down) throw new AppError("Google Drive API error", 502, "STORAGE_GOOGLE_DRIVE_API_ERROR");
        const id = `drive-${fakeDrive.nextId++}`;
        fakeDrive.files.push({ id, buffer: input.buffer!, mimeType: input.mimeType, fileName: input.fileName, driveFolders: input.driveFolders, metadata: input.metadata });
        return { provider: "google_drive", storageKey: id, driveFileId: id, driveFolderId: "folder-it", sizeBytes: input.buffer!.length };
      },
      async download(storageKey: string) {
        const found = fakeDrive.files.find((file) => file.id === storageKey);
        if (!found) throw new AppError("Google Drive API error", 404, "STORAGE_GOOGLE_DRIVE_API_ERROR");
        return { buffer: found.buffer, mimeType: found.mimeType };
      },
      async delete() {},
      getPublicUrl: () => undefined,
      getFilePath: () => undefined,
    },
  };
});

const PHOTO = `data:image/jpeg;base64,${Buffer.alloc(6000, 1).toString("base64")}`;

type Modules = {
  env: typeof import("../../config/env").env;
  prisma: typeof import("../../shared/prisma/client").prisma;
  worker: typeof import("../clock/clockPunchPostProcess.worker");
  employees: typeof import("./employees.service").employeesService;
  schemas: typeof import("./employees.schemas");
  documents: typeof import("../documents/documents.service").documentsService;
  archive: typeof import("../../shared/storage/storageArchive.worker");
  objectStorage: typeof import("../../shared/testing/inMemoryObjectStorage").inMemoryObjectStorage;
};

describe.skipIf(!url)("Alta mínima de legajo contra PostgreSQL local", () => {
  let m: Modules;
  let holder: PrismaClient;
  let server: Server;
  let baseUrl: string;
  let device: { id: string; secret: string };
  let originalPunchPhotoProvider: Modules["env"]["PUNCH_PHOTO_STORAGE_PROVIDER"];
  let originalDocumentProvider: Modules["env"]["DOCUMENT_STORAGE_PROVIDER"];
  let rrhhUserId: string;
  let minimalId: string;
  const punchRequestId = randomUUID();
  const rrhhUser = () => ({ id: rrhhUserId, email: "rrhh-minimal@example.com", name: "RRHH IT", role: "NIVEL_1_RRHH" }) as Express.AuthUser;

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
    const [{ createApp }, { env }, { prisma }, worker, { employeesService }, schemas, credentials, { documentsService }, archive, { inMemoryObjectStorage }] = await Promise.all([
      import("../../app"),
      import("../../config/env"),
      import("../../shared/prisma/client"),
      import("../clock/clockPunchPostProcess.worker"),
      import("./employees.service"),
      import("./employees.schemas"),
      import("../../shared/security/clockDeviceCredentials"),
      import("../documents/documents.service"),
      import("../../shared/storage/storageArchive.worker"),
      import("../../shared/testing/inMemoryObjectStorage"),
    ]);
    m = { env, prisma, worker, employees: employeesService, schemas, documents: documentsService, archive, objectStorage: inMemoryObjectStorage };
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
    originalDocumentProvider = env.DOCUMENT_STORAGE_PROVIDER;
    env.PUNCH_PHOTO_STORAGE_PROVIDER = "neon_object_storage";
    env.DOCUMENT_STORAGE_PROVIDER = "google_drive";
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${env.API_PREFIX}`;
  }, 60_000);

  afterAll(async () => {
    if (m) {
      m.env.PUNCH_PHOTO_STORAGE_PROVIDER = originalPunchPhotoProvider;
      m.env.DOCUMENT_STORAGE_PROVIDER = originalDocumentProvider;
    }
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
      body: JSON.stringify({ requestId: punchRequestId, employeeId: minimalId, punchType: "IN", photo: PHOTO, faceValidationStatus: "VALID", faceDetectionScore: 0.97 }),
    });
    expect(punch.status).toBe(201);
    await m.worker.drainClockPunchPostProcess({ employeeIds: [minimalId] });
    expect(await holder.attendancePunch.count({ where: { employeeId: minimalId } })).toBe(1);
    expect(await holder.workShift.count({ where: { employeeId: minimalId, status: "ABIERTO" } })).toBe(1);
  });

  it("storage: la foto queda en Neon con su key técnica; Drive caído no afecta la fichada; el archivo usa la ruta humana sin estructura organizacional", async () => {
    const punch = await holder.attendancePunch.findFirstOrThrow({ where: { employeeId: minimalId }, include: { photoFile: { include: { archiveJobs: true } } } });
    const file = punch.photoFile!;
    // Neon: key técnica intacta (año/mes/dispositivo/requestId).
    expect(file).toMatchObject({ storageProvider: "NEON_OBJECT_STORAGE", status: "ACTIVE" });
    expect(file.storageKey).toMatch(new RegExp(`^attendance/\\d{4}/\\d{2}/${device.id}/${punchRequestId}\\.jpg$`));
    expect(file.archiveJobs).toEqual([expect.objectContaining({ status: "PENDING", targetProvider: "GOOGLE_DRIVE" })]);
    const jobId = file.archiveJobs[0]!.id;

    // Drive caído: el job vuelve a PENDING; la fichada, su StorageFile y el objeto en Neon siguen intactos.
    fakeDrive.down = true;
    try {
      expect(await m.archive.processOneStorageArchiveJob()).toMatchObject({ processed: true, completed: false, retry: true });
    } finally {
      fakeDrive.down = false;
    }
    expect(await holder.storageArchiveJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: "PENDING", attemptCount: 1, lastErrorCode: "STORAGE_GOOGLE_DRIVE_API_ERROR" });
    expect(await holder.attendancePunch.count({ where: { employeeId: minimalId } })).toBe(1);
    expect((await holder.storageFile.findUniqueOrThrow({ where: { id: file.id } })).status).toBe("ACTIVE");
    expect(m.objectStorage.objects.has(file.storageKey)).toBe(true);
    expect(fakeDrive.files).toHaveLength(0);

    // Drive vuelve: la copia sale con la ruta humana, en hora argentina.
    await holder.storageArchiveJob.update({ where: { id: jobId }, data: { nextAttemptAt: new Date() } });
    expect(await m.archive.processOneStorageArchiveJob()).toMatchObject({ processed: true, completed: true });
    const { argentinaDateParts } = await import("../../shared/datetime/argentinaTime");
    const at = argentinaDateParts(punch.timestamp);
    const pad = (value: number) => String(value).padStart(2, "0");
    const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    expect(fakeDrive.files).toHaveLength(1);
    expect(fakeDrive.files[0]).toMatchObject({
      driveFolders: [{ name: "Fichadas" }, { name: String(at.year) }, { name: `${pad(at.month)} - ${months[at.month - 1]}` }, { name: "0001 - Juan Perez" }],
      fileName: `${at.key}_${pad(at.hour)}-${pad(at.minute)}_INGRESO_${punchRequestId.replace(/-/g, "").slice(0, 6)}.jpg`,
      metadata: { sourceStorageFileId: file.id, checksum: file.checksum, archiveRootId: ARCHIVE_ROOT },
    });
    expect(fakeDrive.files[0]!.buffer.equals(m.objectStorage.objects.get(file.storageKey)!.buffer)).toBe(true);
    expect(await holder.storageArchiveJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: "COMPLETED", targetStorageKey: fakeDrive.files[0]!.id, lastErrorCode: null });

    // Reproceso del mismo job (p. ej. lease vencido tras subir): reutiliza la copia, no duplica.
    await holder.storageArchiveJob.update({ where: { id: jobId }, data: { status: "PENDING", nextAttemptAt: new Date(), completedAt: null } });
    expect(await m.archive.processOneStorageArchiveJob()).toMatchObject({ processed: true, completed: true });
    expect(fakeDrive.files).toHaveLength(1);
    expect((await holder.storageArchiveJob.findUniqueOrThrow({ where: { id: jobId } })).targetStorageKey).toBe(fakeDrive.files[0]!.id);
    // El primary sigue en Neon y la foto se sirve desde ahí.
    expect((await holder.storageFile.findUniqueOrThrow({ where: { id: file.id } })).storageProvider).toBe("NEON_OBJECT_STORAGE");
  });

  it("storage: un legajo de alta mínima sube documentos a Legajos/<legajo - Nombre Apellido>/<categoría> con nombre humano y conserva el original", async () => {
    const category = await holder.documentCategory.create({ data: { code: "DOC-IT-005", name: "Licencia de conducir", kind: "TRANSPORTE" } });
    const parsed = m.schemas.createEmployeeDocumentSchema.parse({
      categoryId: category.id, fileName: "IMG_3728.pdf", fileMimeType: "application/pdf", fileSizeBytes: 9, fileBase64: Buffer.from("%PDF-1.4\n").toString("base64"),
    });
    const before = fakeDrive.files.length;
    await m.employees.createDocument(minimalId, parsed, rrhhUser(), { userId: rrhhUserId });
    await m.employees.createDocument(minimalId, parsed, rrhhUser(), { userId: rrhhUserId });

    const uploads = fakeDrive.files.slice(before);
    expect(uploads).toHaveLength(2);
    for (const upload of uploads) {
      expect(upload.driveFolders).toEqual([{ name: "Legajos" }, { name: "0001 - Juan Perez", appProperties: { employeeId: minimalId } }, { name: "Transporte" }]);
      expect(upload.fileName).toMatch(/^\d{4}-\d{2}-\d{2}_Licencia-de-conducir_Juan-Perez_[0-9a-f]{6}\.pdf$/);
    }
    expect(uploads[0]!.fileName).not.toBe(uploads[1]!.fileName);

    const documents = await holder.employeeDocument.findMany({ where: { employeeId: minimalId }, include: { storageFile: true } });
    expect(documents).toHaveLength(2);
    for (const document of documents) {
      expect(document.fileName).toBe("IMG_3728.pdf");
      expect(document.storageFile).toMatchObject({ storageProvider: "GOOGLE_DRIVE", originalFileName: "IMG_3728.pdf", employeeId: minimalId, module: "LEGAJOS" });
      expect(document.storageFile!.fileName).toMatch(/^\d{4}-\d{2}-\d{2}_Licencia-de-conducir_Juan-Perez_[0-9a-f]{6}\.pdf$/);
      expect(document.storageKey).toBe(document.storageFile!.storageKey);
    }

    // La descarga sale por provider/key persistidos y con el nombre original.
    const downloaded = await m.documents.download(documents[0]!.id, rrhhUser());
    expect(downloaded).toMatchObject({ kind: "buffer", fileName: "IMG_3728.pdf" });
  });

  it("storage: un archivo histórico (layout anterior) se sigue descargando por su provider/key aunque cambie el nombre del legajo", async () => {
    fakeDrive.files.push({ id: "legacy-drive-file", buffer: Buffer.from("%PDF-legacy"), mimeType: "application/pdf", fileName: "dni.pdf" });
    const category = await holder.documentCategory.findFirstOrThrow({ where: { code: "DOC-IT-005" } });
    const legacyFile = await holder.storageFile.create({ data: {
      storageProvider: "GOOGLE_DRIVE", storageKey: "legacy-drive-file", driveFileId: "legacy-drive-file", fileName: "dni.pdf", originalFileName: "dni.pdf",
      mimeType: "application/pdf", extension: "pdf", sizeBytes: 11, module: "LEGAJOS", entityType: "EMPLOYEE_DOCUMENT", entityId: minimalId, employeeId: minimalId,
      metadata: { legacyPath: "storage-sistema/legajos/0001/documentos-personales" },
    } });
    const legacyDocument = await holder.employeeDocument.create({ data: {
      employeeId: minimalId, categoryId: category.id, fileName: "dni.pdf", fileMimeType: "application/pdf", fileSizeBytes: 11, storageKey: "legacy-drive-file", storageFileId: legacyFile.id,
    } });
    await holder.employee.update({ where: { id: minimalId }, data: { firstName: "Juan Carlos" } });
    try {
      const downloaded = await m.documents.download(legacyDocument.id, rrhhUser());
      expect(downloaded).toMatchObject({ kind: "buffer", fileName: "dni.pdf" });
      expect((downloaded as { buffer: Buffer }).buffer.toString()).toBe("%PDF-legacy");
    } finally {
      await holder.employee.update({ where: { id: minimalId }, data: { firstName: "Juan" } });
    }
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
