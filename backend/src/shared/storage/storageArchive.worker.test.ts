import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { AppError } from "../errors/AppError";
import { checksum } from "./storageValidation";
import { archiveLocation, processOneStorageArchiveJob, processStorageArchiveBatch } from "./storageArchive.worker";
import { storageArchiveRepository } from "./storageArchive.repository";
import { storageService } from "./storage.service";
import { findGoogleDriveArchiveCopy, googleDriveArchiveAppProperties, googleDriveStorageProvider, isGoogleDriveConfigured } from "./googleDriveStorage.provider";

/**
 * F12-PERF-4 (docs/decisions/F12_PERF_3_4.md): archivo asíncrono Neon →
 * Google Drive. Repositorio, storage y Drive mockeados: el claim/lease real
 * contra PostgreSQL está en clock/clock.integration.test.ts.
 */
vi.mock("./storageArchive.repository", () => ({
  storageArchiveRepository: { claimNext: vi.fn(), complete: vi.fn(), retry: vi.fn(), fail: vi.fn(), findArchiveContext: vi.fn() },
}));
vi.mock("./storage.service", () => ({
  storageService: { downloadStoredFile: vi.fn() },
}));
vi.mock("./googleDriveStorage.provider", () => ({
  googleDriveStorageProvider: { upload: vi.fn() },
  findGoogleDriveArchiveCopy: vi.fn(),
  googleDriveArchiveAppProperties: vi.fn(),
  isGoogleDriveConfigured: vi.fn(),
}));

const repo = storageArchiveRepository as unknown as { claimNext: Mock; complete: Mock; retry: Mock; fail: Mock; findArchiveContext: Mock };
const download = storageService.downloadStoredFile as unknown as Mock;
const driveUpload = googleDriveStorageProvider.upload as unknown as Mock;
const findCopy = findGoogleDriveArchiveCopy as unknown as Mock;
const driveConfigured = isGoogleDriveConfigured as unknown as Mock;
const archiveProps = googleDriveArchiveAppProperties as unknown as Mock;

const PHOTO = Buffer.from("foto-original");
const REQUEST_ID = "b72d61e4-0c1a-4a8e-9a55-3c7f0e2d9b10";
const KEY = `attendance/2026/11/device-1/${REQUEST_ID}.jpg`;
// Empleado de alta mínima: sólo legajo, nombre y apellido — sin puesto,
// establecimiento, empresa ni ninguna estructura organizacional.
const EMPLOYEE = { legajo: "0001", firstName: "Juan", lastName: "Perez" };
// 13/11/2026 08:02 hora argentina (11:02 UTC).
const PUNCH_AT = new Date("2026-11-13T11:02:00.000Z");

function archiveContext(overrides: Record<string, unknown> = {}) {
  return {
    id: "sf-1",
    module: "FICHADAS",
    extension: "jpg",
    uploadedAt: PUNCH_AT,
    metadata: { requestId: REQUEST_ID, punchType: "IN" },
    employee: EMPLOYEE,
    attendancePunchPhotoLinks: [{ type: "INGRESO", timestamp: PUNCH_AT, employee: EMPLOYEE }],
    ...overrides,
  };
}

const HUMAN_FOLDERS = [{ name: "Fichadas" }, { name: "2026" }, { name: "11 - Noviembre" }, { name: "0001 - Juan Perez" }];

function claimedJob(overrides: Record<string, unknown> = {}, source: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    targetProvider: "GOOGLE_DRIVE",
    attemptCount: 1,
    sourceStorageFile: { id: "sf-1", status: "ACTIVE", module: "FICHADAS", storageProvider: "NEON_OBJECT_STORAGE", storageKey: KEY, fileName: `${REQUEST_ID}.jpg`, mimeType: "image/jpeg", checksum: checksum(PHOTO), metadata: { requestId: REQUEST_ID, punchType: "IN" }, ...source },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  driveConfigured.mockReturnValue(true);
  findCopy.mockResolvedValue(null);
  download.mockResolvedValue({ buffer: PHOTO, mimeType: "image/jpeg" });
  driveUpload.mockResolvedValue({ provider: "google_drive", storageKey: "drive-file-1", driveFileId: "drive-file-1" });
  [repo.complete, repo.retry, repo.fail].forEach((fn) => fn.mockResolvedValue({ count: 1 }));
  repo.findArchiveContext.mockResolvedValue(archiveContext());
  archiveProps.mockImplementation((sourceStorageFileId: string, sum: string | null) => ({ sourceStorageFileId, checksum: sum || "", archiveRootId: "root-dev" }));
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("archiveLocation (respaldo técnico, sólo módulos que no son FICHADAS)", () => {
  it("replica la key primaria bajo <raíz>-archive", () => {
    expect(archiveLocation("otros/2026/11/x/archivo.pdf")).toEqual({ folderSegments: ["otros-archive", "2026", "11", "x"], fileName: "archivo.pdf" });
  });
});

describe("processOneStorageArchiveJob", () => {
  it("sin job reclamable no hace nada", async () => {
    repo.claimNext.mockResolvedValueOnce(null);

    await expect(processOneStorageArchiveJob()).resolves.toEqual({ processed: false });
    expect(download).not.toHaveBeenCalled();
  });

  it("descarga del primary, verifica el checksum, sube a Drive marcado con el StorageFile de origen y completa con fencing", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob());

    await expect(processOneStorageArchiveJob()).resolves.toEqual({ processed: true, completed: true });

    expect(download).toHaveBeenCalledWith(expect.objectContaining({ id: "sf-1", storageProvider: "NEON_OBJECT_STORAGE" }));
    expect(driveUpload).toHaveBeenCalledWith({
      buffer: PHOTO,
      mimeType: "image/jpeg",
      driveFolders: HUMAN_FOLDERS,
      fileName: "2026-11-13_08-02_INGRESO_b72d61.jpg",
      metadata: { sourceStorageFileId: "sf-1", checksum: checksum(PHOTO), archiveRootId: "root-dev" },
    });
    expect(repo.complete).toHaveBeenCalledWith("job-1", 1, "drive-file-1", expect.any(Date), undefined);
    expect(repo.findArchiveContext).toHaveBeenCalledWith("sf-1");
  });

  it("si la copia ya existe en Drive (lease vencido tras subirla), completa con ella sin descargar ni duplicar", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob({ attemptCount: 2 }));
    findCopy.mockResolvedValueOnce({ id: "drive-existing" });

    await processOneStorageArchiveJob();

    expect(findCopy).toHaveBeenCalledWith("sf-1");
    expect(download).not.toHaveBeenCalled();
    expect(driveUpload).not.toHaveBeenCalled();
    expect(repo.complete).toHaveBeenCalledWith("job-1", 2, "drive-existing", expect.any(Date), undefined);
  });

  it("un checksum distinto deja el job FAILED sin subir nada (no reintenta un origen corrupto)", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob());
    download.mockResolvedValueOnce({ buffer: Buffer.from("otra-cosa") });

    await expect(processOneStorageArchiveJob()).resolves.toMatchObject({ completed: false, retry: false });

    expect(driveUpload).not.toHaveBeenCalled();
    expect(repo.fail).toHaveBeenCalledWith("job-1", 1, "STORAGE_ARCHIVE_SOURCE_CORRUPT", expect.any(String));
  });

  it("un StorageFile de origen borrado no se archiva", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob({}, { status: "DELETED" }));

    await processOneStorageArchiveJob();

    expect(download).not.toHaveBeenCalled();
    expect(repo.fail).toHaveBeenCalledWith("job-1", 1, "STORAGE_ARCHIVE_SOURCE_DELETED", expect.any(String));
  });

  it("un error transitorio de Drive vuelve a PENDING con backoff exponencial y el error saneado", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob({ attemptCount: 3 }));
    driveUpload.mockRejectedValueOnce(new AppError("Google Drive API error", 502, "STORAGE_GOOGLE_DRIVE_API_ERROR", "detalle interno de Drive"));
    const before = Date.now();

    await expect(processOneStorageArchiveJob()).resolves.toMatchObject({ completed: false, retry: true });

    const [id, attemptCount, nextAttemptAt, code, message] = repo.retry.mock.calls[0]!;
    expect([id, attemptCount, code, message]).toEqual(["job-1", 3, "STORAGE_GOOGLE_DRIVE_API_ERROR", "Google Drive API error"]);
    // 3er intento: 5 s · 2² = 20 s, más hasta 20 % de jitter.
    expect((nextAttemptAt as Date).getTime() - before).toBeGreaterThanOrEqual(20_000);
    expect((nextAttemptAt as Date).getTime() - before).toBeLessThanOrEqual(24_000 + 1_000);
    expect(repo.fail).not.toHaveBeenCalled();
  });

  it("un error desconocido se reintenta sin persistir su mensaje", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob());
    download.mockRejectedValueOnce(new Error("socket hang up con datos sensibles"));

    await processOneStorageArchiveJob();

    expect(repo.retry).toHaveBeenCalledWith("job-1", 1, expect.any(Date), "STORAGE_ARCHIVE_UNKNOWN", "Storage archive failed");
  });

  it("agotados los intentos queda FAILED para revisión manual", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob({ attemptCount: 12 }));
    driveUpload.mockRejectedValueOnce(new AppError("Google Drive API error", 502, "STORAGE_GOOGLE_DRIVE_API_ERROR"));

    await expect(processOneStorageArchiveJob()).resolves.toMatchObject({ completed: false, retry: false });

    expect(repo.retry).not.toHaveBeenCalled();
    expect(repo.fail).toHaveBeenCalledWith("job-1", 12, "STORAGE_GOOGLE_DRIVE_API_ERROR", expect.any(String));
  });

  it("un target que no es Google Drive no se procesa", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob({ targetProvider: "CLOUDINARY" }));

    await processOneStorageArchiveJob();

    expect(download).not.toHaveBeenCalled();
    expect(repo.fail).toHaveBeenCalledWith("job-1", 1, "STORAGE_ARCHIVE_TARGET_UNSUPPORTED", expect.any(String));
  });
});

describe("processOneStorageArchiveJob — ruta humana en Drive", () => {
  function uploadedLocation() {
    const input = driveUpload.mock.calls[0]![0] as { driveFolders: unknown; fileName: string; folderSegments?: unknown };
    return input;
  }

  it("la key técnica de Neon no cambia: el worker sólo lee el primary por su key persistida", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob());

    await processOneStorageArchiveJob();

    expect(download).toHaveBeenCalledWith(expect.objectContaining({ storageKey: KEY }));
    expect(uploadedLocation().folderSegments).toBeUndefined();
    expect(JSON.stringify(uploadedLocation())).not.toContain("device-1");
  });

  it("SALIDA genera SALIDA en el nombre", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob());
    repo.findArchiveContext.mockResolvedValueOnce(archiveContext({
      metadata: { requestId: REQUEST_ID, punchType: "OUT" },
      attendancePunchPhotoLinks: [{ type: "SALIDA", timestamp: new Date("2026-11-13T20:05:00.000Z"), employee: EMPLOYEE }],
    }));

    await processOneStorageArchiveJob();

    expect(uploadedLocation().fileName).toBe("2026-11-13_17-05_SALIDA_b72d61.jpg");
  });

  it("usa el timestamp real de la fichada en hora argentina (23:30 del último día del mes no pasa al mes siguiente)", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob());
    // 30/11/2026 23:30 Argentina = 01/12/2026 02:30 UTC.
    repo.findArchiveContext.mockResolvedValueOnce(archiveContext({
      attendancePunchPhotoLinks: [{ type: "INGRESO", timestamp: new Date("2026-12-01T02:30:00.000Z"), employee: EMPLOYEE }],
    }));

    await processOneStorageArchiveJob();

    expect(uploadedLocation()).toMatchObject({
      driveFolders: [{ name: "Fichadas" }, { name: "2026" }, { name: "11 - Noviembre" }, { name: "0001 - Juan Perez" }],
      fileName: "2026-11-30_23-30_INGRESO_b72d61.jpg",
    });
  });

  it("toma el empleado de la fichada (datos vigentes al archivar) y conserva acentos y Ñ en la carpeta", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob());
    const jose = { legajo: "0007", firstName: "José", lastName: "Peña" };
    repo.findArchiveContext.mockResolvedValueOnce(archiveContext({
      employee: EMPLOYEE,
      attendancePunchPhotoLinks: [{ type: "INGRESO", timestamp: PUNCH_AT, employee: jose }],
    }));

    await processOneStorageArchiveJob();

    expect((uploadedLocation().driveFolders as Array<{ name: string }>)[3]).toEqual({ name: "0007 - José Peña" });
  });

  it("dos fichadas en el mismo minuto con distinto requestId generan nombres distintos", async () => {
    const other = "a19f82c3-1111-4222-8333-444455556666";
    repo.claimNext.mockResolvedValueOnce(claimedJob()).mockResolvedValueOnce(claimedJob({ id: "job-2" }, { id: "sf-2" }));
    repo.findArchiveContext
      .mockResolvedValueOnce(archiveContext())
      .mockResolvedValueOnce(archiveContext({ id: "sf-2", metadata: { requestId: other, punchType: "IN" } }));

    await processOneStorageArchiveJob();
    await processOneStorageArchiveJob();

    const names = driveUpload.mock.calls.map(([input]) => (input as { fileName: string }).fileName);
    expect(names).toEqual(["2026-11-13_08-02_INGRESO_b72d61.jpg", "2026-11-13_08-02_INGRESO_a19f82.jpg"]);
  });

  it("evidencia sin fichada vinculada: archiva en _Sin vincular, lo registra como error observable y marca el job", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    repo.claimNext.mockResolvedValueOnce(claimedJob());
    repo.findArchiveContext.mockResolvedValueOnce(archiveContext({ attendancePunchPhotoLinks: [] }));

    await expect(processOneStorageArchiveJob()).resolves.toEqual({ processed: true, completed: true });

    expect(uploadedLocation()).toMatchObject({
      driveFolders: [{ name: "Fichadas" }, { name: "_Sin vincular" }, { name: "2026" }, { name: "11 - Noviembre" }, { name: "0001 - Juan Perez" }],
      fileName: "2026-11-13_08-02_INGRESO_b72d61.jpg",
    });
    expect(error).toHaveBeenCalledWith("STORAGE_ARCHIVE_UNLINKED", expect.objectContaining({ jobId: "job-1", sourceStorageFileId: "sf-1", reason: "NO_ATTENDANCE_PUNCH" }));
    // Sin datos personales en el log.
    expect(JSON.stringify(error.mock.calls)).not.toContain("Perez");
    expect(repo.complete).toHaveBeenCalledWith("job-1", 1, "drive-file-1", expect.any(Date), expect.objectContaining({ code: "STORAGE_ARCHIVE_UNLINKED" }));
  });

  it("sin fichada ni empleado ni tipo: carpeta del mes en _Sin vincular y SIN-TIPO", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob());
    repo.findArchiveContext.mockResolvedValueOnce(archiveContext({ employee: null, metadata: {}, attendancePunchPhotoLinks: [] }));

    await processOneStorageArchiveJob();

    expect(uploadedLocation()).toMatchObject({
      driveFolders: [{ name: "Fichadas" }, { name: "_Sin vincular" }, { name: "2026" }, { name: "11 - Noviembre" }],
      fileName: "2026-11-13_08-02_SIN-TIPO_sf1.jpg",
    });
  });

  it("un reintento del mismo job que encuentra su copia (acotada a la raíz) no resuelve la ruta ni vuelve a subir", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob({ attemptCount: 2 }));
    findCopy.mockResolvedValueOnce({ id: "drive-existing" });

    await processOneStorageArchiveJob();

    expect(repo.findArchiveContext).not.toHaveBeenCalled();
    expect(driveUpload).not.toHaveBeenCalled();
  });
});

describe("processStorageArchiveBatch", () => {
  it("sin Drive configurado no reclama nada: los jobs quedan PENDING para cuando vuelva", async () => {
    driveConfigured.mockReturnValue(false);

    await expect(processStorageArchiveBatch()).resolves.toEqual({ processed: 0, skipped: true });
    expect(repo.claimNext).not.toHaveBeenCalled();
  });

  it("procesa hasta el límite por tick y corta cuando no quedan jobs", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob()).mockResolvedValueOnce(claimedJob({ id: "job-2" })).mockResolvedValueOnce(null);

    await expect(processStorageArchiveBatch(5)).resolves.toEqual({ processed: 2, skipped: false });
    expect(repo.claimNext).toHaveBeenCalledTimes(3);
  });

  it("respeta el límite aunque haya más jobs", async () => {
    repo.claimNext.mockResolvedValue(claimedJob());

    await expect(processStorageArchiveBatch(2)).resolves.toEqual({ processed: 2, skipped: false });
    expect(repo.claimNext).toHaveBeenCalledTimes(2);
  });
});
