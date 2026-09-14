import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { env } from "../../config/env";
import { AppError } from "../errors/AppError";
import { storageService, storageProviderRegistry } from "./storage.service";
import { localStorageProvider } from "./localStorage.provider";
import { googleDriveStorageProvider } from "./googleDriveStorage.provider";
import { cloudinaryStorageProvider } from "./cloudinaryStorage.provider";
import { storageFilesRepository } from "./storageFiles.repository";

/**
 * Etapa 15D.1 (docs/decisions/STORAGE_PROVIDER_REGISTRY_15D1.md): operaciones
 * sobre un archivo EXISTENTE (download/delete/getUrl/compensación) deben
 * resolver siempre por StorageFile.storageProvider persistido, nunca por el
 * provider global activo hoy (env.STORAGE_PROVIDER). Estos tests mockean los
 * 3 providers crudos y prueban el registry/servicio en aislamiento — sin
 * tocar red, filesystem ni DB real.
 */
vi.mock("./localStorage.provider", () => ({
  localStorageProvider: { upload: vi.fn(), delete: vi.fn(), getPublicUrl: vi.fn(), getFilePath: vi.fn(), download: vi.fn() },
}));

vi.mock("./googleDriveStorage.provider", () => ({
  googleDriveStorageProvider: { upload: vi.fn(), delete: vi.fn(), getPublicUrl: vi.fn(), getFilePath: vi.fn(), download: vi.fn() },
}));

vi.mock("./cloudinaryStorage.provider", () => ({
  cloudinaryStorageProvider: { upload: vi.fn(), delete: vi.fn(), getPublicUrl: vi.fn(), getFilePath: vi.fn(), download: vi.fn() },
}));

vi.mock("./storageFiles.repository", () => ({
  storageFilesRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findActiveById: vi.fn(),
    findMany: vi.fn(),
    countUnlinkedPunchEvidence: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

type MutableEnv = { STORAGE_PROVIDER?: string };
type MockProvider = { upload: Mock; delete: Mock; getPublicUrl: Mock; getFilePath: Mock; download: Mock };

const local = localStorageProvider as unknown as MockProvider;
const drive = googleDriveStorageProvider as unknown as MockProvider;
const cloudinary = cloudinaryStorageProvider as unknown as MockProvider;
const filesRepo = storageFilesRepository as unknown as { findById: Mock; updateStatus: Mock };

describe("storageService — provider persistido por StorageFile (Etapa 15D.1)", () => {
  const originalStorageProvider = env.STORAGE_PROVIDER;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    (env as MutableEnv).STORAGE_PROVIDER = originalStorageProvider;
  });

  it("downloadStoredFile usa GOOGLE_DRIVE persistido aunque el provider global activo sea cloudinary", async () => {
    (env as MutableEnv).STORAGE_PROVIDER = "cloudinary";
    drive.download.mockResolvedValue({ buffer: Buffer.from("foto-drive") });

    const result = await storageService.downloadStoredFile({ storageProvider: "GOOGLE_DRIVE", storageKey: "drive-key-1" });

    expect(result).toEqual({ buffer: Buffer.from("foto-drive") });
    expect(drive.download).toHaveBeenCalledWith("drive-key-1");
    expect(cloudinary.download).not.toHaveBeenCalled();
  });

  it("downloadStoredFile usa CLOUDINARY persistido aunque el provider global activo sea google_drive", async () => {
    (env as MutableEnv).STORAGE_PROVIDER = "google_drive";
    cloudinary.download.mockResolvedValue({ buffer: Buffer.from("foto-cloudinary") });

    const result = await storageService.downloadStoredFile({ storageProvider: "CLOUDINARY", storageKey: "cloud-key-1" });

    expect(result).toEqual({ buffer: Buffer.from("foto-cloudinary") });
    expect(cloudinary.download).toHaveBeenCalledWith("cloud-key-1");
    expect(drive.download).not.toHaveBeenCalled();
  });

  it("deleteStoredFile usa el provider persistido, no el global activo", async () => {
    (env as MutableEnv).STORAGE_PROVIDER = "local";
    drive.delete.mockResolvedValue(undefined);

    await storageService.deleteStoredFile({ storageProvider: "GOOGLE_DRIVE", storageKey: "drive-key-2" });

    expect(drive.delete).toHaveBeenCalledWith("drive-key-2");
    expect(local.delete).not.toHaveBeenCalled();
  });

  it("deleteManaged (compensación/borrado gestionado) resuelve el provider desde el StorageFile, no desde el global activo", async () => {
    (env as MutableEnv).STORAGE_PROVIDER = "local";
    filesRepo.findById.mockResolvedValue({ id: "file-1", status: "ACTIVE", storageProvider: "CLOUDINARY", storageKey: "cloud-key-2" });
    filesRepo.updateStatus.mockResolvedValue({});
    cloudinary.delete.mockResolvedValue(undefined);

    await storageService.deleteManaged("file-1");

    expect(cloudinary.delete).toHaveBeenCalledWith("cloud-key-2");
    expect(local.delete).not.toHaveBeenCalled();
    expect(filesRepo.updateStatus).toHaveBeenCalledWith("file-1", expect.objectContaining({ status: "DELETED" }));
  });

  it("deleteManaged no vuelve a borrar un archivo que ya estaba DELETED", async () => {
    filesRepo.findById.mockResolvedValue({ id: "file-2", status: "DELETED", storageProvider: "LOCAL", storageKey: "local-key" });

    await storageService.deleteManaged("file-2");

    expect(local.delete).not.toHaveBeenCalled();
    expect(filesRepo.updateStatus).not.toHaveBeenCalled();
  });

  it("upload() sigue usando el provider global configurado hoy — sin cambios en 15D.1", async () => {
    (env as MutableEnv).STORAGE_PROVIDER = "google_drive";
    drive.upload.mockResolvedValue({ provider: "google_drive", storageKey: "new-key" });

    const result = await storageService.upload({ fileName: "a.pdf", mimeType: "application/pdf" });

    expect(result).toEqual({ provider: "google_drive", storageKey: "new-key" });
    expect(drive.upload).toHaveBeenCalledTimes(1);
    expect(local.upload).not.toHaveBeenCalled();
    expect(cloudinary.upload).not.toHaveBeenCalled();
  });

  it("getStoredFilePublicUrl / getStoredFilePath delegan al provider persistido", () => {
    local.getFilePath.mockReturnValue("/uploads/local-key");
    drive.getPublicUrl.mockReturnValue(undefined);

    expect(storageService.getStoredFilePath({ storageProvider: "LOCAL", storageKey: "local-key" })).toBe("/uploads/local-key");
    expect(local.getFilePath).toHaveBeenCalledWith("local-key");

    expect(storageService.getStoredFilePublicUrl({ storageProvider: "GOOGLE_DRIVE", storageKey: "drive-key-3" })).toBeUndefined();
    expect(drive.getPublicUrl).toHaveBeenCalledWith("drive-key-3");
  });

  it("un storageProvider desconocido/corrupto responde un error claro y seguro (500 STORAGE_PROVIDER_UNKNOWN), nunca undefined silencioso", () => {
    expect(() => storageProviderRegistry.get("FTP" as never)).toThrowError(AppError);
    try {
      storageProviderRegistry.get("FTP" as never);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("STORAGE_PROVIDER_UNKNOWN");
      expect((error as AppError).statusCode).toBe(500);
    }
  });
});
