import { env } from "../../config/env";
import { AppError } from "../errors/AppError";
import { cloudinaryStorageProvider } from "./cloudinaryStorage.provider";
import { googleDriveStorageProvider } from "./googleDriveStorage.provider";
import { localStorageProvider } from "./localStorage.provider";
import { storageFilesRepository } from "./storageFiles.repository";
import { checksum, fileExtension, safeFileName, validateStorageFile } from "./storageValidation";
import type {
  ManagedStorageObjectInput,
  PersistedStorageProvider,
  StorageFileRef,
  StorageObjectInput,
  StorageProvider,
} from "./storage.types";

function providerByEnvName(name: string | undefined): StorageProvider {
  if (name === "google_drive") return googleDriveStorageProvider;
  if (name === "cloudinary") return cloudinaryStorageProvider;
  return localStorageProvider;
}

function provider(): StorageProvider {
  return providerByEnvName(env.STORAGE_PROVIDER);
}

/**
 * Etapa 15D.2 (docs/decisions/STORAGE_UPLOAD_POLICY_15D2.md): a qué provider
 * va un upload NUEVO, según el `module` del archivo (LEGAJOS/FICHADAS/...).
 * Sólo afecta uploads — nunca la lectura/eliminación de un archivo ya
 * existente, que sigue resolviendo por StorageFile.storageProvider
 * persistido (Etapa 15D.1, `providerFor` más abajo). Cadena de resolución:
 * la variable específica del propósito -> DEFAULT_STORAGE_PROVIDER ->
 * STORAGE_PROVIDER — así con las variables nuevas sin configurar, el
 * comportamiento es idéntico al de antes de esta etapa.
 */
function uploadProviderEnvName(module: ManagedStorageObjectInput["module"]): string | undefined {
  if (module === "FICHADAS") return env.PUNCH_PHOTO_STORAGE_PROVIDER;
  if (module === "LEGAJOS" || module === "DOCUMENTACION_GENERAL") return env.DOCUMENT_STORAGE_PROVIDER;
  return undefined;
}

function uploadProviderFor(module: ManagedStorageObjectInput["module"]): StorageProvider {
  const configured = uploadProviderEnvName(module) || env.DEFAULT_STORAGE_PROVIDER || env.STORAGE_PROVIDER;
  return providerByEnvName(configured);
}

function providerName(resultProvider: string) {
  if (resultProvider === "google_drive") return "GOOGLE_DRIVE" as const;
  if (resultProvider === "cloudinary") return "CLOUDINARY" as const;
  return "LOCAL" as const;
}

/**
 * Etapa 15D.1 (docs/decisions/STORAGE_PROVIDER_REGISTRY_15D1.md): registry
 * que resuelve el provider por StorageFile.storageProvider PERSISTIDO — no
 * por el provider global ni por la política de upload de 15D.2. Un archivo
 * ya existente puede haberse subido con un provider distinto al que hoy
 * resolvería un upload nuevo (p. ej. se subió a Google Drive antes de que
 * existiera PUNCH_PHOTO_STORAGE_PROVIDER, o antes de que cambiara de valor),
 * y las operaciones sobre ese archivo (download/delete/url) deben seguir
 * resolviendo contra el provider con el que realmente se subió.
 */
const providerRegistry: Record<PersistedStorageProvider, StorageProvider> = {
  LOCAL: localStorageProvider,
  GOOGLE_DRIVE: googleDriveStorageProvider,
  CLOUDINARY: cloudinaryStorageProvider,
};

function providerFor(name: PersistedStorageProvider): StorageProvider {
  const found = providerRegistry[name];
  if (!found) {
    throw new AppError(`Proveedor de storage desconocido: ${name}`, 500, "STORAGE_PROVIDER_UNKNOWN");
  }
  return found;
}

export const storageProviderRegistry = { get: providerFor };

export const storageService = {
  upload(input: StorageObjectInput) {
    return provider().upload(input);
  },

  async uploadManaged(input: ManagedStorageObjectInput) {
    validateStorageFile({
      buffer: input.buffer,
      fileName: input.fileName,
      mimeType: input.mimeType,
      purpose: input.purpose,
    });

    const fileName = safeFileName(input.fileName);
    const selectedProvider = uploadProviderFor(input.module);
    const uploaded = await selectedProvider.upload({ ...input, fileName });
    try {
      return await storageFilesRepository.create({
        storageProvider: providerName(uploaded.provider),
        storageKey: uploaded.storageKey,
        driveFileId: uploaded.driveFileId || null,
        driveFolderId: uploaded.driveFolderId || null,
        driveWebViewLink: uploaded.driveWebViewLink || null,
        driveWebContentLink: uploaded.driveWebContentLink || null,
        fileName,
        originalFileName: input.fileName,
        mimeType: input.mimeType,
        extension: fileExtension(fileName),
        sizeBytes: uploaded.sizeBytes || input.buffer?.length || 0,
        module: input.module,
        entityType: input.entityType,
        entityId: input.entityId,
        employeeId: input.employeeId || null,
        attendancePunchId: input.attendancePunchId || null,
        documentType: input.documentType || null,
        isThumbnail: Boolean(input.isThumbnail),
        originalFileId: input.originalFileId || null,
        visibility: input.visibility || "PRIVATE",
        uploadedByUserId: input.uploadedByUserId || null,
        checksum: input.buffer ? checksum(input.buffer) : null,
        metadata: input.metadata || {},
      });
    } catch (error) {
      try {
        // Compensar con el MISMO provider que acaba de recibir el upload —
        // nunca con provider() (global): desde 15D.2 pueden diferir según
        // input.module, y compensar con el provider equivocado dejaría el
        // archivo huérfano en el provider real.
        await selectedProvider.delete(uploaded.storageKey);
      } catch (compensationError) {
        console.error("STORAGE_COMPENSATION_FAILED", {
          severity: "critical",
          storageKey: uploaded.storageKey,
          error: compensationError instanceof Error ? compensationError.message : String(compensationError),
        });
      }
      throw error;
    }
  },

  async deleteManaged(id: string) {
    const file = await storageFilesRepository.findById(id);
    if (!file || file.status === "DELETED") return;
    await providerFor(file.storageProvider).delete(file.storageKey);
    await storageFilesRepository.updateStatus(id, { status: "DELETED", deletedAt: new Date() });
  },

  /**
   * @legacy Resuelve por el provider GLOBAL activo, no por el provider con
   * el que el archivo se subió. Sólo válido para storageKeys sin
   * StorageFile vinculado (datos previos a esta etapa). Para un archivo
   * con StorageFile, usar deleteStoredFile.
   */
  delete(storageKey: string) {
    return provider().delete(storageKey);
  },

  /** @legacy Ver nota de `delete` — usar getStoredFilePublicUrl para un archivo con StorageFile. */
  getPublicUrl(storageKey: string) {
    return provider().getPublicUrl(storageKey);
  },

  /** @legacy Ver nota de `delete` — usar getStoredFilePath para un archivo con StorageFile. */
  getFilePath(storageKey: string) {
    return provider().getFilePath(storageKey);
  },

  /** @legacy Ver nota de `delete` — usar downloadStoredFile para un archivo con StorageFile. */
  download(storageKey: string) {
    return provider().download?.(storageKey);
  },

  // Etapa 15D.1 — operaciones sobre un archivo EXISTENTE, resueltas por su
  // StorageFile.storageProvider persistido (nunca por el provider global).
  getStoredFilePublicUrl(file: StorageFileRef) {
    return providerFor(file.storageProvider).getPublicUrl(file.storageKey);
  },

  getStoredFilePath(file: StorageFileRef) {
    return providerFor(file.storageProvider).getFilePath(file.storageKey);
  },

  downloadStoredFile(file: StorageFileRef) {
    return providerFor(file.storageProvider).download?.(file.storageKey);
  },

  async deleteStoredFile(file: StorageFileRef) {
    await providerFor(file.storageProvider).delete(file.storageKey);
  },
};
