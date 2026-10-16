import { AppError } from "../errors/AppError";
import type { StorageObjectInput, StorageObjectResult, StorageProvider } from "../storage/storage.types";

/**
 * F12-PERF-3 (docs/decisions/F12_PERF_3_4.md): object storage en memoria con
 * la misma key que neonObjectStorageProvider (`<folderSegments>/<fileName>`).
 * Los tests de integración lo ponen en lugar de Neon (vi.mock) para correr el
 * storage REAL — StorageFile y StorageArchiveJob dentro de la transacción de
 * la fichada — sin red. `puts` registra toda key subida, también las que la
 * compensación borró después.
 */
export function createInMemoryObjectStorage() {
  const objects = new Map<string, { buffer: Buffer; mimeType: string }>();
  const puts: string[] = [];
  const provider: StorageProvider = {
    async upload(input: StorageObjectInput): Promise<StorageObjectResult> {
      if (!input.buffer) throw new AppError("File buffer is required", 400, "STORAGE_FILE_BUFFER_REQUIRED");
      const storageKey = [...(input.folderSegments || []), input.fileName].join("/");
      objects.set(storageKey, { buffer: input.buffer, mimeType: input.mimeType });
      puts.push(storageKey);
      return { provider: "neon_object_storage", storageKey, sizeBytes: input.buffer.length };
    },
    async download(storageKey: string) {
      const found = objects.get(storageKey);
      if (!found) throw new AppError("Archivo no encontrado", 404, "STORAGE_NEON_OBJECT_NOT_FOUND");
      return { buffer: found.buffer, mimeType: found.mimeType };
    },
    async delete(storageKey: string) {
      objects.delete(storageKey);
    },
    async exists(storageKey: string) {
      return objects.has(storageKey);
    },
    getPublicUrl() { return undefined; },
    getFilePath() { return undefined; },
  };
  return {
    provider,
    objects,
    puts,
    keysFor: (requestId: string) => ({
      uploaded: puts.filter((key) => key.includes(requestId)),
      stored: [...objects.keys()].filter((key) => key.includes(requestId)),
    }),
  };
}

export const inMemoryObjectStorage = createInMemoryObjectStorage();
