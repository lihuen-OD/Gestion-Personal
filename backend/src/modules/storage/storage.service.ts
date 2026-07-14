import { access } from "node:fs/promises";
import type { StorageFile } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { storageService } from "../../shared/storage/storage.service";
import { storageFilesRepository } from "../../shared/storage/storageFiles.repository";
import { roles } from "../../shared/security/roles";

function canAccessStorageFile(file: StorageFile, user: Express.AuthUser) {
  if (user.role === roles.rrhh) return true;
  if (file.visibility === "SYSTEM_ONLY" && (user.role === roles.supervision || user.role === roles.cargaHoraria)) {
    return file.module === "FICHADAS";
  }
  if (file.visibility === "SUPERVISOR_ALLOWED" && user.role === roles.supervision) return true;
  return false;
}

async function requireStorageFile(id: string, user: Express.AuthUser) {
  const file = await storageFilesRepository.findActiveById(id);
  if (!file) throw new AppError("Archivo no encontrado", 404, "STORAGE_FILE_NOT_FOUND");
  if (!canAccessStorageFile(file, user)) {
    throw new AppError("No tenés permiso para acceder al archivo.", 403, "STORAGE_FILE_FORBIDDEN");
  }
  return file;
}

export const storageModuleService = {
  async getMetadata(id: string, user: Express.AuthUser, audit?: AuditContext) {
    const file = await requireStorageFile(id, user);
    await auditService.register({
      ...audit,
      action: "EXPORT",
      entity: "StorageFile",
      entityId: id,
      description: `Se consulto metadata del archivo ${file.fileName}.`,
    });
    return file;
  },

  async download(id: string, user: Express.AuthUser, audit?: AuditContext) {
    const file = await requireStorageFile(id, user);
    await auditService.register({
      ...audit,
      action: "EXPORT",
      entity: "StorageFile",
      entityId: id,
      description: `Se descargo archivo ${file.fileName}.`,
    });

    const publicUrl = file.storageProvider === "GOOGLE_DRIVE" ? undefined : storageService.getPublicUrl(file.storageKey);
    if (publicUrl) return { kind: "redirect" as const, url: publicUrl };

    const downloaded = await storageService.download(file.storageKey);
    if (downloaded) {
      return {
        kind: "buffer" as const,
        buffer: downloaded.buffer,
        fileName: file.originalFileName || file.fileName,
        mimeType: downloaded.mimeType || file.mimeType,
      };
    }

    const filePath = storageService.getFilePath(file.storageKey);
    if (!filePath) throw new AppError("Archivo no disponible", 404, "STORAGE_FILE_NOT_AVAILABLE");
    await access(filePath).catch(() => {
      throw new AppError("Archivo no encontrado en storage", 404, "STORAGE_FILE_NOT_FOUND");
    });
    return {
      kind: "file" as const,
      path: filePath,
      fileName: file.originalFileName || file.fileName,
      mimeType: file.mimeType,
    };
  },

  async archive(id: string, user: Express.AuthUser, audit?: AuditContext) {
    if (user.role !== roles.rrhh) throw new AppError("Solo RRHH puede archivar archivos.", 403, "STORAGE_ARCHIVE_FORBIDDEN");
    const file = await requireStorageFile(id, user);
    const updated = await storageFilesRepository.updateStatus(id, {
      status: "DELETED",
      deletedByUserId: user.id,
      deletedAt: new Date(),
    });
    await auditService.register({
      ...audit,
      action: "DELETE",
      entity: "StorageFile",
      entityId: id,
      description: `Se marco como eliminado el archivo ${file.fileName}.`,
      before: file,
      after: updated,
    });
    return updated;
  },
};
