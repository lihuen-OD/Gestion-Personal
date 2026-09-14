import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { timeEntriesService } from "./timeEntries.service";
import { timeEntriesRepository } from "./timeEntries.repository";
import { storageService } from "../../shared/storage/storage.service";
import { roles } from "../../shared/security/roles";

/**
 * Etapa 15D.1 (docs/decisions/STORAGE_PROVIDER_REGISTRY_15D1.md): la foto de
 * una fichada (`photoFile`) debe descargarse siempre por su
 * StorageFile.storageProvider persistido, nunca por el provider global
 * activo hoy — así conviven fotos viejas subidas a un provider con el
 * provider actualmente configurado. Sólo se mockean `timeEntriesRepository`
 * y `storageService`; el resto del módulo (datetime, clasificación, etc.)
 * queda real porque `attendancePunchPhoto` no lo ejercita.
 */
vi.mock("./timeEntries.repository", () => ({
  timeEntriesRepository: {
    findAttendancePunchEvidence: vi.fn(),
  },
}));

vi.mock("../../shared/storage/storage.service", () => ({
  storageService: {
    getPublicUrl: vi.fn(),
    getFilePath: vi.fn(),
    download: vi.fn(),
    getStoredFilePublicUrl: vi.fn(),
    getStoredFilePath: vi.fn(),
    downloadStoredFile: vi.fn(),
  },
}));

const repo = timeEntriesRepository as unknown as { findAttendancePunchEvidence: Mock };
const storage = storageService as unknown as {
  getPublicUrl: Mock;
  getFilePath: Mock;
  download: Mock;
  getStoredFilePublicUrl: Mock;
  getStoredFilePath: Mock;
  downloadStoredFile: Mock;
};

const rrhhUser = { id: "user-1", role: roles.rrhh } as unknown as Express.AuthUser;

const basePunch = {
  id: "punch-1",
  employeeId: "employee-1",
  type: "INGRESO",
  timestamp: new Date("2026-09-01T12:00:00.000Z"),
  source: "PORTAL_DNI",
  photoUrl: null,
  photoStoragePath: "storage-sistema/fichadas/2026/09/01/legacy.jpg",
  photoFileId: "file-cloud-1",
  thumbnailFileId: null,
  photoFile: {
    id: "file-cloud-1",
    storageProvider: "CLOUDINARY",
    storageKey: "cloud-key-punch-1",
    mimeType: "image/jpeg",
    driveWebViewLink: null,
  },
  employee: { legajo: "000123", firstName: "Ana", lastName: "Gomez" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("timeEntriesService.attendancePunchPhoto — provider persistido (Etapa 15D.1)", () => {
  it("descarga la foto por el storageProvider CLOUDINARY persistido en photoFile, no por storageService legacy", async () => {
    repo.findAttendancePunchEvidence.mockResolvedValue(basePunch);
    storage.downloadStoredFile.mockResolvedValue({ buffer: Buffer.from("foto-cloudinary"), mimeType: "image/jpeg" });

    const result = await timeEntriesService.attendancePunchPhoto("punch-1", rrhhUser);

    expect(result).toMatchObject({ kind: "buffer", mimeType: "image/jpeg" });
    expect(storage.downloadStoredFile).toHaveBeenCalledWith(basePunch.photoFile);
    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.getPublicUrl).not.toHaveBeenCalled();
  });

  it("una fichada legacy sin photoFile (sólo photoStoragePath) sigue resolviendo por el provider global activo", async () => {
    const legacyPunch = { ...basePunch, photoFile: null, photoFileId: null };
    repo.findAttendancePunchEvidence.mockResolvedValue(legacyPunch);
    storage.getPublicUrl.mockReturnValue(undefined);
    storage.download.mockResolvedValue({ buffer: Buffer.from("foto-legacy"), mimeType: "image/jpeg" });

    const result = await timeEntriesService.attendancePunchPhoto("punch-1", rrhhUser);

    expect(result).toMatchObject({ kind: "buffer" });
    expect(storage.download).toHaveBeenCalledWith(legacyPunch.photoStoragePath);
    expect(storage.downloadStoredFile).not.toHaveBeenCalled();
  });

  it("responde 404 si la fichada no tiene ninguna foto asociada", async () => {
    repo.findAttendancePunchEvidence.mockResolvedValue({ ...basePunch, photoFile: null, photoFileId: null, photoStoragePath: null });

    await expect(timeEntriesService.attendancePunchPhoto("punch-1", rrhhUser)).rejects.toMatchObject({
      statusCode: 404,
      code: "ATTENDANCE_PUNCH_PHOTO_NOT_FOUND",
    });
  });

  it("responde 404 si la fichada no existe / está fuera de alcance", async () => {
    repo.findAttendancePunchEvidence.mockResolvedValue(null);

    await expect(timeEntriesService.attendancePunchPhoto("nope", rrhhUser)).rejects.toMatchObject({
      statusCode: 404,
      code: "ATTENDANCE_PUNCH_NOT_FOUND",
    });
  });
});
