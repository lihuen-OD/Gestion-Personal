import { AppError } from "../errors/AppError";
import { checksum } from "./storageValidation";
import { findGoogleDriveArchiveCopy, googleDriveStorageProvider, isGoogleDriveConfigured } from "./googleDriveStorage.provider";
import { storageArchiveRepository } from "./storageArchive.repository";
import { storageService } from "./storage.service";

/**
 * F12-PERF-4 (docs/decisions/F12_PERF_3_4.md): copia asíncrona a Google Drive
 * de la evidencia guardada en el primary (Neon Object Storage). Corre en el
 * tick de clockPunchMaintenance, nunca en el request de la fichada.
 */
const LEASE_MS = 2 * 60_000;
// Backoff 5 s·2^(n-1) con techo de 1 h: 12 intentos cubren ~2,5 h de caída
// de Drive antes de dejar el job FAILED para revisión manual.
const MAX_ATTEMPTS = 12;

function safeError(error: unknown) {
  const code = error instanceof AppError ? error.code : "STORAGE_ARCHIVE_UNKNOWN";
  const message = error instanceof AppError ? error.message : "Storage archive failed";
  return { code, message: message.slice(0, 500) };
}

// Errores de configuración o de datos: reintentarlos no cambia el resultado.
const terminalCodes = new Set(["STORAGE_ARCHIVE_TARGET_UNSUPPORTED", "STORAGE_ARCHIVE_SOURCE_UNREADABLE", "STORAGE_ARCHIVE_SOURCE_DELETED", "STORAGE_ARCHIVE_SOURCE_CORRUPT"]);

function retryable(error: unknown) {
  if (!(error instanceof AppError)) return true;
  if (terminalCodes.has(error.code)) return false;
  return error.statusCode === 429 || error.statusCode >= 500 || ["STORAGE_NEON_TIMEOUT", "STORAGE_NEON_UNAVAILABLE", "STORAGE_GOOGLE_DRIVE_API_ERROR"].includes(error.code);
}

function nextRetry(attemptCount: number) {
  const base = Math.min(60 * 60_000, 5_000 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(Date.now() + base + Math.floor(Math.random() * Math.max(1, base * 0.2)));
}

/**
 * La copia en Drive replica la key primaria bajo `<raíz>-archive/`, p. ej.
 * `attendance/2026/10/<dispositivo>/<requestId>.jpg` →
 * `attendance-archive/2026/10/<dispositivo>/` + `<requestId>.jpg`.
 */
export function archiveLocation(storageKey: string) {
  const parts = storageKey.split("/").filter(Boolean);
  if (parts.length < 2) return { folderSegments: ["archive"], fileName: parts[0] || "archivo" };
  return {
    folderSegments: [`${parts[0]}-archive`, ...parts.slice(1, -1)],
    fileName: parts[parts.length - 1]!,
  };
}

export async function processOneStorageArchiveJob(now = new Date()) {
  const job = await storageArchiveRepository.claimNext(now, LEASE_MS);
  if (!job) return { processed: false };
  try {
    if (job.targetProvider !== "GOOGLE_DRIVE") throw new AppError("Unsupported archive target", 500, "STORAGE_ARCHIVE_TARGET_UNSUPPORTED");
    const source = job.sourceStorageFile;
    if (source.status === "DELETED") throw new AppError("Source file was deleted", 409, "STORAGE_ARCHIVE_SOURCE_DELETED");
    const existing = await findGoogleDriveArchiveCopy(source.id);
    let targetKey = existing?.id;
    if (!targetKey) {
      const downloaded = await storageService.downloadStoredFile(source);
      if (!downloaded) throw new AppError("Source provider cannot download", 500, "STORAGE_ARCHIVE_SOURCE_UNREADABLE");
      if (source.checksum && checksum(downloaded.buffer) !== source.checksum) {
        throw new AppError("Source checksum mismatch", 422, "STORAGE_ARCHIVE_SOURCE_CORRUPT");
      }
      const target = await googleDriveStorageProvider.upload({
        buffer: downloaded.buffer,
        mimeType: source.mimeType,
        ...archiveLocation(source.storageKey),
        metadata: { sourceStorageFileId: source.id, checksum: source.checksum || "" },
      });
      targetKey = target.storageKey;
    }
    await storageArchiveRepository.complete(job.id, job.attemptCount, targetKey, new Date());
    console.info("STORAGE_ARCHIVE_COMPLETED", { jobId: job.id, provider: "google_drive", attemptCount: job.attemptCount, reused: Boolean(existing) });
    return { processed: true, completed: true };
  } catch (error) {
    const safe = safeError(error);
    if (retryable(error) && job.attemptCount < MAX_ATTEMPTS) {
      await storageArchiveRepository.retry(job.id, job.attemptCount, nextRetry(job.attemptCount), safe.code, safe.message);
      console.warn("STORAGE_ARCHIVE_RETRY", { jobId: job.id, code: safe.code, attemptCount: job.attemptCount });
      return { processed: true, completed: false, retry: true };
    }
    await storageArchiveRepository.fail(job.id, job.attemptCount, safe.code, safe.message);
    console.error("STORAGE_ARCHIVE_FAILED", { severity: "critical", jobId: job.id, code: safe.code, attemptCount: job.attemptCount });
    return { processed: true, completed: false, retry: false };
  }
}

/**
 * Sin Drive configurado no se reclama nada: los jobs quedan PENDING (durables)
 * y se archivan cuando Drive vuelva a estar disponible, en vez de agotar sus
 * intentos contra un provider deshabilitado.
 */
export async function processStorageArchiveBatch(limit = 5) {
  if (!isGoogleDriveConfigured()) return { processed: 0, skipped: true };
  let processed = 0;
  while (processed < limit) {
    const result = await processOneStorageArchiveJob();
    if (!result.processed) break;
    processed += 1;
  }
  return { processed, skipped: false };
}
