import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { storageModuleService } from "./storage.service";
import { storageService } from "../../shared/storage/storage.service";
import { storageFilesRepository } from "../../shared/storage/storageFiles.repository";
import { auditService } from "../audit/audit.service";
import { roles } from "../../shared/security/roles";

vi.mock("../../shared/storage/storageFiles.repository", () => ({
  storageFilesRepository: {
    findActiveById: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

vi.mock("../../shared/storage/storage.service", () => ({
  storageService: {
    getStoredFilePublicUrl: vi.fn(),
    getStoredFilePath: vi.fn(),
    downloadStoredFile: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const filesRepo = storageFilesRepository as unknown as { findActiveById: Mock; updateStatus: Mock };
const storage = storageService as unknown as { getStoredFilePublicUrl: Mock; getStoredFilePath: Mock; downloadStoredFile: Mock };
const audit = auditService as unknown as { register: Mock };

const rrhhUser = { id: "user-1", role: roles.rrhh } as unknown as Express.AuthUser;

const driveFile = {
  id: "file-1",
  fileName: "foto.jpg",
  originalFileName: "foto.jpg",
  mimeType: "image/jpeg",
  storageProvider: "GOOGLE_DRIVE",
  storageKey: "drive-key-1",
  module: "FICHADAS",
  visibility: "SYSTEM_ONLY",
  status: "ACTIVE",
};

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Etapa 15D.1: `GET /storage/files/:id/download` (y /preview) es el endpoint
 * genérico compartido por documentos y evidencia del fichador. Debe resolver
 * siempre por el StorageFile.storageProvider persistido — nunca por el
 * provider global activo — ver docs/decisions/STORAGE_PROVIDER_REGISTRY_15D1.md.
 */
describe("storageModuleService.download — provider persistido (Etapa 15D.1)", () => {
  it("un archivo GOOGLE_DRIVE se descarga resolviendo por su storageProvider persistido", async () => {
    filesRepo.findActiveById.mockResolvedValue(driveFile);
    storage.downloadStoredFile.mockResolvedValue({ buffer: Buffer.from("foto"), mimeType: "image/jpeg" });

    const result = await storageModuleService.download("file-1", rrhhUser);

    expect(result).toMatchObject({ kind: "buffer", fileName: "foto.jpg", mimeType: "image/jpeg" });
    expect(storage.downloadStoredFile).toHaveBeenCalledWith(driveFile);
    expect(storage.getStoredFilePublicUrl).not.toHaveBeenCalled();
  });

  it("un archivo CLOUDINARY se descarga resolviendo por su storageProvider persistido", async () => {
    const cloudinaryFile = { ...driveFile, id: "file-2", storageProvider: "CLOUDINARY", storageKey: "cloud-key-1" };
    filesRepo.findActiveById.mockResolvedValue(cloudinaryFile);
    storage.getStoredFilePublicUrl.mockReturnValue("https://res.cloudinary.com/demo/raw/upload/cloud-key-1");

    const result = await storageModuleService.download("file-2", rrhhUser);

    expect(result).toEqual({ kind: "redirect", url: "https://res.cloudinary.com/demo/raw/upload/cloud-key-1" });
    expect(storage.getStoredFilePublicUrl).toHaveBeenCalledWith(cloudinaryFile);
    expect(storage.downloadStoredFile).not.toHaveBeenCalled();
  });

  it("audita EXPORT antes de resolver la entrega", async () => {
    filesRepo.findActiveById.mockResolvedValue(driveFile);
    storage.downloadStoredFile.mockResolvedValue({ buffer: Buffer.from("foto") });

    await storageModuleService.download("file-1", rrhhUser);

    expect(audit.register).toHaveBeenCalledWith(
      expect.objectContaining({ action: "EXPORT", entity: "StorageFile", entityId: "file-1" }),
    );
  });

  it("responde 404 si el archivo no existe o no está activo (nunca intenta resolver un provider)", async () => {
    filesRepo.findActiveById.mockResolvedValue(null);

    await expect(storageModuleService.download("nope", rrhhUser)).rejects.toMatchObject({
      statusCode: 404,
      code: "STORAGE_FILE_NOT_FOUND",
    });
    expect(storage.downloadStoredFile).not.toHaveBeenCalled();
    expect(storage.getStoredFilePublicUrl).not.toHaveBeenCalled();
  });
});
