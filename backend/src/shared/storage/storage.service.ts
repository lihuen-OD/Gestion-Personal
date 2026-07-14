import { env } from "../../config/env";
import { cloudinaryStorageProvider } from "./cloudinaryStorage.provider";
import { googleDriveStorageProvider } from "./googleDriveStorage.provider";
import { localStorageProvider } from "./localStorage.provider";
import { storageFilesRepository } from "./storageFiles.repository";
import { checksum, fileExtension, safeFileName, validateStorageFile } from "./storageValidation";
import type { ManagedStorageObjectInput, StorageObjectInput, StorageProvider } from "./storage.types";

function provider(): StorageProvider {
  if (env.STORAGE_PROVIDER === "google_drive") return googleDriveStorageProvider;
  if (env.STORAGE_PROVIDER === "cloudinary") return cloudinaryStorageProvider;
  return localStorageProvider;
}

function providerName(resultProvider: string) {
  if (resultProvider === "google_drive") return "GOOGLE_DRIVE" as const;
  if (resultProvider === "cloudinary") return "CLOUDINARY" as const;
  return "LOCAL" as const;
}

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
    const uploaded = await provider().upload({ ...input, fileName });
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
        await provider().delete(uploaded.storageKey);
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
    await provider().delete(file.storageKey);
    await storageFilesRepository.updateStatus(id, { status: "DELETED", deletedAt: new Date() });
  },

  delete(storageKey: string) {
    return provider().delete(storageKey);
  },

  getPublicUrl(storageKey: string) {
    return provider().getPublicUrl(storageKey);
  },

  getFilePath(storageKey: string) {
    return provider().getFilePath(storageKey);
  },

  download(storageKey: string) {
    return provider().download?.(storageKey);
  },
};
