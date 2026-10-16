import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { env } from "../../config/env";
import { AppError } from "../errors/AppError";
import { storageService, storageProviderRegistry } from "./storage.service";
import { localStorageProvider } from "./localStorage.provider";
import { googleDriveStorageProvider } from "./googleDriveStorage.provider";
import { cloudinaryStorageProvider } from "./cloudinaryStorage.provider";
import { neonObjectStorageProvider } from "./neonObjectStorage.provider";
import { storageFilesRepository } from "./storageFiles.repository";
import { storageArchiveRepository } from "./storageArchive.repository";

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
vi.mock("./neonObjectStorage.provider", () => ({
  neonObjectStorageProvider: { upload: vi.fn(), delete: vi.fn(), getPublicUrl: vi.fn(), getFilePath: vi.fn(), download: vi.fn(), exists: vi.fn() },
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

vi.mock("./storageArchive.repository", () => ({
  storageArchiveRepository: { enqueue: vi.fn() },
}));

type MutableEnv = {
  STORAGE_PROVIDER?: string;
  DEFAULT_STORAGE_PROVIDER?: string;
  DOCUMENT_STORAGE_PROVIDER?: string;
  PUNCH_PHOTO_STORAGE_PROVIDER?: string;
};
type MockProvider = { upload: Mock; delete: Mock; getPublicUrl: Mock; getFilePath: Mock; download: Mock };

const local = localStorageProvider as unknown as MockProvider;
const drive = googleDriveStorageProvider as unknown as MockProvider;
const cloudinary = cloudinaryStorageProvider as unknown as MockProvider;
const neon = neonObjectStorageProvider as unknown as MockProvider;
const filesRepo = storageFilesRepository as unknown as { findById: Mock; updateStatus: Mock; create: Mock };

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
    expect(drive.download).toHaveBeenCalledWith("drive-key-1", undefined);
    expect(cloudinary.download).not.toHaveBeenCalled();
  });

  it("downloadStoredFile usa CLOUDINARY persistido aunque el provider global activo sea google_drive", async () => {
    (env as MutableEnv).STORAGE_PROVIDER = "google_drive";
    cloudinary.download.mockResolvedValue({ buffer: Buffer.from("foto-cloudinary") });

    const result = await storageService.downloadStoredFile({ storageProvider: "CLOUDINARY", storageKey: "cloud-key-1" });

    expect(result).toEqual({ buffer: Buffer.from("foto-cloudinary") });
    expect(cloudinary.download).toHaveBeenCalledWith("cloud-key-1", undefined);
    expect(drive.download).not.toHaveBeenCalled();
  });

  it("registry resuelve NEON_OBJECT_STORAGE sin afectar Google Drive histórico", async () => {
    neon.download.mockResolvedValue({ buffer: Buffer.from("foto-neon") });
    drive.download.mockResolvedValue({ buffer: Buffer.from("foto-drive") });
    await expect(storageService.downloadStoredFile({ storageProvider: "NEON_OBJECT_STORAGE", storageKey: "new-key" })).resolves.toEqual({ buffer: Buffer.from("foto-neon") });
    await expect(storageService.downloadStoredFile({ storageProvider: "GOOGLE_DRIVE", storageKey: "old-key" })).resolves.toEqual({ buffer: Buffer.from("foto-drive") });
  });

  it("deleteStoredFile usa el provider persistido, no el global activo, y pasa la metadata persistida (Etapa 15D.3)", async () => {
    (env as MutableEnv).STORAGE_PROVIDER = "local";
    drive.delete.mockResolvedValue(undefined);
    const metadata = { cloudinaryResourceType: "raw" };

    await storageService.deleteStoredFile({ storageProvider: "GOOGLE_DRIVE", storageKey: "drive-key-2", metadata });

    expect(drive.delete).toHaveBeenCalledWith("drive-key-2", metadata);
    expect(local.delete).not.toHaveBeenCalled();
  });

  it("deleteManaged (compensación/borrado gestionado) resuelve el provider desde el StorageFile, no desde el global activo, y pasa su metadata (Etapa 15D.3)", async () => {
    (env as MutableEnv).STORAGE_PROVIDER = "local";
    const metadata = { cloudinaryResourceType: "raw", cloudinaryDeliveryType: "authenticated" };
    filesRepo.findById.mockResolvedValue({ id: "file-1", status: "ACTIVE", storageProvider: "CLOUDINARY", storageKey: "cloud-key-2", metadata });
    filesRepo.updateStatus.mockResolvedValue({});
    cloudinary.delete.mockResolvedValue(undefined);

    await storageService.deleteManaged("file-1");

    expect(cloudinary.delete).toHaveBeenCalledWith("cloud-key-2", metadata);
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
    expect(drive.getPublicUrl).toHaveBeenCalledWith("drive-key-3", undefined);
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

/**
 * Etapa 15D.2 (docs/decisions/STORAGE_UPLOAD_POLICY_15D2.md): a qué provider
 * va un upload NUEVO según module/propósito — nunca afecta lectura/borrado
 * de un archivo ya existente (eso sigue siendo 15D.1, arriba). Cadena de
 * resolución: variable específica del propósito -> DEFAULT_STORAGE_PROVIDER
 * -> STORAGE_PROVIDER.
 */
describe("storageService.uploadManaged — política de upload por módulo/propósito (Etapa 15D.2)", () => {
  const originalStorageProvider = env.STORAGE_PROVIDER;
  const originalDefault = env.DEFAULT_STORAGE_PROVIDER;
  const originalDocument = env.DOCUMENT_STORAGE_PROVIDER;
  const originalPunchPhoto = env.PUNCH_PHOTO_STORAGE_PROVIDER;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    (env as MutableEnv).STORAGE_PROVIDER = originalStorageProvider;
    (env as MutableEnv).DEFAULT_STORAGE_PROVIDER = originalDefault;
    (env as MutableEnv).DOCUMENT_STORAGE_PROVIDER = originalDocument;
    (env as MutableEnv).PUNCH_PHOTO_STORAGE_PROVIDER = originalPunchPhoto;
  });

  const documentInput = {
    buffer: Buffer.from("contenido-pdf"),
    fileName: "contrato.pdf",
    mimeType: "application/pdf",
    module: "LEGAJOS" as const,
    entityType: "EMPLOYEE_DOCUMENT" as const,
    entityId: "employee-1",
    purpose: "general" as const,
  };

  const punchPhotoInput = {
    buffer: Buffer.from("foto-jpeg"),
    fileName: "punch.jpg",
    mimeType: "image/jpeg",
    module: "FICHADAS" as const,
    entityType: "ATTENDANCE_PUNCH" as const,
    entityId: "employee-1",
    purpose: "punch-photo" as const,
  };

  it("un documento (module=LEGAJOS) sube por DOCUMENT_STORAGE_PROVIDER aunque STORAGE_PROVIDER global sea otro", async () => {
    (env as MutableEnv).STORAGE_PROVIDER = "local";
    (env as MutableEnv).DOCUMENT_STORAGE_PROVIDER = "cloudinary";
    cloudinary.upload.mockResolvedValue({ provider: "cloudinary", storageKey: "cloud-doc-1" });
    filesRepo.create.mockResolvedValue({ id: "sf-1", storageProvider: "CLOUDINARY", storageKey: "cloud-doc-1" });

    await storageService.uploadManaged(documentInput);

    expect(cloudinary.upload).toHaveBeenCalledTimes(1);
    expect(local.upload).not.toHaveBeenCalled();
    expect(drive.upload).not.toHaveBeenCalled();
  });

  it("una foto de fichada (module=FICHADAS) sube por PUNCH_PHOTO_STORAGE_PROVIDER aunque STORAGE_PROVIDER global sea otro", async () => {
    (env as MutableEnv).STORAGE_PROVIDER = "cloudinary";
    (env as MutableEnv).PUNCH_PHOTO_STORAGE_PROVIDER = "google_drive";
    drive.upload.mockResolvedValue({ provider: "google_drive", storageKey: "drive-punch-1" });
    filesRepo.create.mockResolvedValue({ id: "sf-2", storageProvider: "GOOGLE_DRIVE", storageKey: "drive-punch-1" });

    await storageService.uploadManaged(punchPhotoInput);

    expect(drive.upload).toHaveBeenCalledTimes(1);
    expect(cloudinary.upload).not.toHaveBeenCalled();
    expect(local.upload).not.toHaveBeenCalled();
  });

  it("module=DOCUMENTACION_GENERAL también resuelve por DOCUMENT_STORAGE_PROVIDER", async () => {
    (env as MutableEnv).STORAGE_PROVIDER = "local";
    (env as MutableEnv).DOCUMENT_STORAGE_PROVIDER = "cloudinary";
    cloudinary.upload.mockResolvedValue({ provider: "cloudinary", storageKey: "cloud-doc-2" });
    filesRepo.create.mockResolvedValue({ id: "sf-3", storageProvider: "CLOUDINARY", storageKey: "cloud-doc-2" });

    await storageService.uploadManaged({ ...documentInput, module: "DOCUMENTACION_GENERAL", entityType: "GENERAL_DOCUMENT" });

    expect(cloudinary.upload).toHaveBeenCalledTimes(1);
  });

  it("un módulo sin regla específica (p. ej. NOVEDADES) cae en DEFAULT_STORAGE_PROVIDER", async () => {
    (env as MutableEnv).STORAGE_PROVIDER = "local";
    (env as MutableEnv).DEFAULT_STORAGE_PROVIDER = "google_drive";
    drive.upload.mockResolvedValue({ provider: "google_drive", storageKey: "drive-default-1" });
    filesRepo.create.mockResolvedValue({ id: "sf-4", storageProvider: "GOOGLE_DRIVE", storageKey: "drive-default-1" });

    await storageService.uploadManaged({ ...documentInput, module: "NOVEDADES", entityType: "ABSENCE" });

    expect(drive.upload).toHaveBeenCalledTimes(1);
    expect(local.upload).not.toHaveBeenCalled();
  });

  it("sin ninguna variable nueva configurada, el comportamiento es idéntico al de antes de 15D.2 (usa STORAGE_PROVIDER global para cualquier módulo)", async () => {
    (env as MutableEnv).STORAGE_PROVIDER = "local";
    local.upload.mockResolvedValue({ provider: "local", storageKey: "local-doc-1" });
    filesRepo.create.mockResolvedValue({ id: "sf-5", storageProvider: "LOCAL", storageKey: "local-doc-1" });

    await storageService.uploadManaged(documentInput);
    await storageService.uploadManaged(punchPhotoInput);

    expect(local.upload).toHaveBeenCalledTimes(2);
    expect(drive.upload).not.toHaveBeenCalled();
    expect(cloudinary.upload).not.toHaveBeenCalled();
  });

  it("si falla la creación del StorageFile, la compensación borra con el MISMO provider que recibió el upload — no con el provider global", async () => {
    (env as MutableEnv).STORAGE_PROVIDER = "local";
    (env as MutableEnv).PUNCH_PHOTO_STORAGE_PROVIDER = "google_drive";
    drive.upload.mockResolvedValue({ provider: "google_drive", storageKey: "drive-punch-2" });
    drive.delete.mockResolvedValue(undefined);
    filesRepo.create.mockRejectedValue(new Error("db down"));

    await expect(storageService.uploadManaged(punchPhotoInput)).rejects.toThrow("db down");

    expect(drive.delete).toHaveBeenCalledWith("drive-punch-2");
    expect(local.delete).not.toHaveBeenCalled();
  });
});

/**
 * F12-PERF-3/4 (docs/decisions/F12_PERF_3_4.md): el objeto físico se sube
 * antes de la transacción de la fichada; el StorageFile y su archive job se
 * escriben dentro, con la tx del llamador, y la compensación del objeto la
 * hace el llamador (nunca una llamada de red dentro de la transacción).
 */
describe("storageService — upload primario + persistencia transaccional (F12-PERF-3/4)", () => {
  const originalStorageProvider = env.STORAGE_PROVIDER;
  const originalPunchPhoto = env.PUNCH_PHOTO_STORAGE_PROVIDER;
  const archiveRepo = storageArchiveRepository as unknown as { enqueue: Mock };
  const tx = { marker: "tx" } as never;

  const punchPhotoInput = {
    buffer: Buffer.from("foto-jpeg"),
    fileName: "req-1.jpg",
    mimeType: "image/jpeg",
    module: "FICHADAS" as const,
    entityType: "ATTENDANCE_PUNCH" as const,
    entityId: "employee-1",
    employeeId: "employee-1",
    purpose: "punch-photo" as const,
    folderSegments: ["attendance", "2026", "10", "device-1"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (env as MutableEnv).STORAGE_PROVIDER = "google_drive";
    (env as MutableEnv).PUNCH_PHOTO_STORAGE_PROVIDER = "neon_object_storage";
    neon.upload.mockResolvedValue({ provider: "neon_object_storage", storageKey: "attendance/2026/10/device-1/req-1.jpg", sizeBytes: 9 });
    archiveRepo.enqueue.mockResolvedValue({ id: "job-1" });
  });

  afterEach(() => {
    (env as MutableEnv).STORAGE_PROVIDER = originalStorageProvider;
    (env as MutableEnv).PUNCH_PHOTO_STORAGE_PROVIDER = originalPunchPhoto;
  });

  it("uploadManagedObject sube al primary de FICHADAS (Neon) y no escribe StorageFile ni toca Drive", async () => {
    const prepared = await storageService.uploadManagedObject(punchPhotoInput);

    expect(neon.upload).toHaveBeenCalledTimes(1);
    expect(neon.upload.mock.calls[0]![0]).toMatchObject({ folderSegments: punchPhotoInput.folderSegments, fileName: "req-1.jpg" });
    expect(prepared.uploaded.storageKey).toBe("attendance/2026/10/device-1/req-1.jpg");
    expect(filesRepo.create).not.toHaveBeenCalled();
    expect(drive.upload).not.toHaveBeenCalled();
  });

  it("persistManagedUploadWithArchive: primary Neon → StorageFile NEON_OBJECT_STORAGE + job GOOGLE_DRIVE, ambos con la tx del llamador", async () => {
    filesRepo.create.mockResolvedValue({ id: "sf-1", storageProvider: "NEON_OBJECT_STORAGE", storageKey: "k" });
    const prepared = await storageService.uploadManagedObject(punchPhotoInput);

    const stored = await storageService.persistManagedUploadWithArchive(prepared, tx);

    expect(stored).toMatchObject({ id: "sf-1" });
    expect(filesRepo.create).toHaveBeenCalledWith(expect.objectContaining({ storageProvider: "NEON_OBJECT_STORAGE", module: "FICHADAS", checksum: expect.stringMatching(/^[0-9a-f]{64}$/) }), tx);
    expect(archiveRepo.enqueue).toHaveBeenCalledWith(tx, "sf-1", "GOOGLE_DRIVE");
    expect(drive.upload).not.toHaveBeenCalled();
  });

  it.each([
    ["google_drive", "GOOGLE_DRIVE"],
    ["local", "LOCAL"],
  ] as const)("primary %s → sin archive job (Drive nunca se re-archiva en Drive)", async (envName, persisted) => {
    (env as MutableEnv).PUNCH_PHOTO_STORAGE_PROVIDER = envName;
    const provider = envName === "google_drive" ? drive : local;
    provider.upload.mockResolvedValue({ provider: envName, storageKey: "k" });
    filesRepo.create.mockResolvedValue({ id: "sf-2", storageProvider: persisted, storageKey: "k" });

    await storageService.persistManagedUploadWithArchive(await storageService.uploadManagedObject(punchPhotoInput), tx);

    expect(archiveRepo.enqueue).not.toHaveBeenCalled();
  });

  it("con tx, si falla el insert del StorageFile no compensa adentro: lo hace el llamador con compensateManagedUpload y el provider del upload", async () => {
    filesRepo.create.mockRejectedValue(new Error("db down"));
    const prepared = await storageService.uploadManagedObject(punchPhotoInput);

    await expect(storageService.persistManagedUploadWithArchive(prepared, tx)).rejects.toThrow("db down");
    expect(neon.delete).not.toHaveBeenCalled();
    expect(archiveRepo.enqueue).not.toHaveBeenCalled();

    await storageService.compensateManagedUpload(prepared);
    expect(neon.delete).toHaveBeenCalledWith("attendance/2026/10/device-1/req-1.jpg");
    expect(drive.delete).not.toHaveBeenCalled();
  });

  it("si el upload primario falla, no hay nada que persistir ni compensar", async () => {
    neon.upload.mockRejectedValue(new AppError("Neon Object Storage timeout", 504, "STORAGE_NEON_TIMEOUT"));

    await expect(storageService.uploadManagedObject(punchPhotoInput)).rejects.toMatchObject({ code: "STORAGE_NEON_TIMEOUT" });
    expect(filesRepo.create).not.toHaveBeenCalled();
    expect(neon.delete).not.toHaveBeenCalled();
  });
});
