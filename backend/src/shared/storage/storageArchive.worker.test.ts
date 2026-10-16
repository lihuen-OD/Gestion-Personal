import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { AppError } from "../errors/AppError";
import { checksum } from "./storageValidation";
import { archiveLocation, processOneStorageArchiveJob, processStorageArchiveBatch } from "./storageArchive.worker";
import { storageArchiveRepository } from "./storageArchive.repository";
import { storageService } from "./storage.service";
import { findGoogleDriveArchiveCopy, googleDriveStorageProvider, isGoogleDriveConfigured } from "./googleDriveStorage.provider";

/**
 * F12-PERF-4 (docs/decisions/F12_PERF_3_4.md): archivo asíncrono Neon →
 * Google Drive. Repositorio, storage y Drive mockeados: el claim/lease real
 * contra PostgreSQL está en clock/clock.integration.test.ts.
 */
vi.mock("./storageArchive.repository", () => ({
  storageArchiveRepository: { claimNext: vi.fn(), complete: vi.fn(), retry: vi.fn(), fail: vi.fn() },
}));
vi.mock("./storage.service", () => ({
  storageService: { downloadStoredFile: vi.fn() },
}));
vi.mock("./googleDriveStorage.provider", () => ({
  googleDriveStorageProvider: { upload: vi.fn() },
  findGoogleDriveArchiveCopy: vi.fn(),
  isGoogleDriveConfigured: vi.fn(),
}));

const repo = storageArchiveRepository as unknown as { claimNext: Mock; complete: Mock; retry: Mock; fail: Mock };
const download = storageService.downloadStoredFile as unknown as Mock;
const driveUpload = googleDriveStorageProvider.upload as unknown as Mock;
const findCopy = findGoogleDriveArchiveCopy as unknown as Mock;
const driveConfigured = isGoogleDriveConfigured as unknown as Mock;

const PHOTO = Buffer.from("foto-original");
const KEY = "attendance/2026/10/device-1/req-1.jpg";

function claimedJob(overrides: Record<string, unknown> = {}, source: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    targetProvider: "GOOGLE_DRIVE",
    attemptCount: 1,
    sourceStorageFile: { id: "sf-1", status: "ACTIVE", storageProvider: "NEON_OBJECT_STORAGE", storageKey: KEY, fileName: "req-1.jpg", mimeType: "image/jpeg", checksum: checksum(PHOTO), metadata: null, ...source },
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
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("archiveLocation", () => {
  it("replica la key primaria bajo <raíz>-archive (año/mes/dispositivo, un archivo por requestId)", () => {
    expect(archiveLocation(KEY)).toEqual({ folderSegments: ["attendance-archive", "2026", "10", "device-1"], fileName: "req-1.jpg" });
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
      folderSegments: ["attendance-archive", "2026", "10", "device-1"],
      fileName: "req-1.jpg",
      metadata: { sourceStorageFileId: "sf-1", checksum: checksum(PHOTO) },
    });
    expect(repo.complete).toHaveBeenCalledWith("job-1", 1, "drive-file-1", expect.any(Date));
  });

  it("si la copia ya existe en Drive (lease vencido tras subirla), completa con ella sin descargar ni duplicar", async () => {
    repo.claimNext.mockResolvedValueOnce(claimedJob({ attemptCount: 2 }));
    findCopy.mockResolvedValueOnce({ id: "drive-existing" });

    await processOneStorageArchiveJob();

    expect(findCopy).toHaveBeenCalledWith("sf-1");
    expect(download).not.toHaveBeenCalled();
    expect(driveUpload).not.toHaveBeenCalled();
    expect(repo.complete).toHaveBeenCalledWith("job-1", 2, "drive-existing", expect.any(Date));
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
