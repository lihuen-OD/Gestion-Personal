import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { documentsRepository } from "./documents.repository";
import { documentsService } from "./documents.service";
import { storageService } from "../../shared/storage/storage.service";
import { auditService } from "../audit/audit.service";

vi.mock("./documents.repository", () => ({
  documentsRepository: {
    findById: vi.fn(),
    findMany: vi.fn(),
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

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const repo = documentsRepository as unknown as { findById: Mock; findMany: Mock };
const storage = storageService as unknown as {
  getPublicUrl: Mock;
  getFilePath: Mock;
  download: Mock;
  getStoredFilePublicUrl: Mock;
  getStoredFilePath: Mock;
  downloadStoredFile: Mock;
};
const audit = auditService as unknown as { register: Mock };

const fakeUser = { id: "user-1", role: "NIVEL_1_RRHH" } as unknown as Express.AuthUser;
const cargaUser = { id: "user-3", role: "NIVEL_3_CARGA_HORARIA" } as unknown as Express.AuthUser;

const document = {
  id: "doc-1",
  fileName: "dni.pdf",
  fileMimeType: "application/pdf",
  storageKey: "legajos/100/dni.pdf",
  storageFile: null,
  employee: { id: "employee-1", legajo: "100" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("documentsService.download", () => {
  it("audita EXPORT sobre el documento antes de resolver la entrega", async () => {
    repo.findById.mockResolvedValue(document);
    storage.getPublicUrl.mockReturnValue("https://storage.example/dni.pdf");

    const result = await documentsService.download("doc-1", fakeUser);

    expect(result).toEqual({ kind: "redirect", url: "https://storage.example/dni.pdf" });
    expect(audit.register).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "EXPORT",
        entity: "EmployeeDocument",
        entityId: "doc-1",
        description: expect.stringContaining("dni.pdf"),
      }),
    );
  });

  it("no audita nada si el documento no existe (404)", async () => {
    repo.findById.mockResolvedValue(null);

    await expect(documentsService.download("doc-inexistente", fakeUser)).rejects.toMatchObject({
      statusCode: 404,
      code: "DOCUMENT_NOT_FOUND",
    });
    expect(audit.register).not.toHaveBeenCalled();
  });
});

/**
 * Etapa 15D.1 (docs/decisions/STORAGE_PROVIDER_REGISTRY_15D1.md): un
 * documento con storageFile vinculado debe resolver SIEMPRE por su
 * storageProvider persistido, nunca por el provider global activo hoy —
 * el fallback a `storageKey` suelto sólo existe para documentos previos a
 * que StorageFile existiera.
 */
describe("documentsService.download — provider persistido por storageFile (Etapa 15D.1)", () => {
  it("descarga por el storageProvider GOOGLE_DRIVE persistido, nunca por storageService legacy", async () => {
    const docWithStorageFile = {
      ...document,
      id: "doc-2",
      storageFile: { id: "sf-1", storageProvider: "GOOGLE_DRIVE", storageKey: "drive-key-9", driveWebViewLink: null },
    };
    repo.findById.mockResolvedValue(docWithStorageFile);
    storage.downloadStoredFile.mockResolvedValue({ buffer: Buffer.from("contenido"), mimeType: "application/pdf" });

    const result = await documentsService.download("doc-2", fakeUser);

    expect(result).toMatchObject({ kind: "buffer", fileName: "dni.pdf", mimeType: "application/pdf" });
    expect(storage.downloadStoredFile).toHaveBeenCalledWith(docWithStorageFile.storageFile);
    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.getPublicUrl).not.toHaveBeenCalled();
  });

  it("un documento sin storageFile (legacy) sigue resolviendo por el provider global activo, sin usar los métodos nuevos", async () => {
    repo.findById.mockResolvedValue(document); // fixture: storageFile: null
    storage.getPublicUrl.mockReturnValue("https://storage.example/dni.pdf");

    const result = await documentsService.download("doc-1", fakeUser);

    expect(result).toEqual({ kind: "redirect", url: "https://storage.example/dni.pdf" });
    expect(storage.getPublicUrl).toHaveBeenCalledWith(document.storageKey);
    expect(storage.getStoredFilePublicUrl).not.toHaveBeenCalled();
    expect(storage.downloadStoredFile).not.toHaveBeenCalled();
  });
});

/**
 * Etapa 15D.3 (docs/decisions/CLOUDINARY_SECURE_DELIVERY_15D3.md): un
 * documento CLOUDINARY nunca debe resolver en `{ kind: "redirect" }` — el
 * provider real ya no entrega ninguna URL pública permanente
 * (`getStoredFilePublicUrl` resuelve `undefined`), así que la descarga cae
 * siempre en el buffer que sirve el propio endpoint backend autenticado.
 * El frontend nunca recibe una URL de Cloudinary para seguir por su cuenta.
 */
describe("documentsService.download — Cloudinary nunca redirige a URL pública (Etapa 15D.3)", () => {
  it("un documento CLOUDINARY se descarga como buffer servido por el backend, nunca como redirect", async () => {
    const cloudinaryDocument = {
      ...document,
      id: "doc-3",
      storageFile: {
        id: "sf-2",
        storageProvider: "CLOUDINARY",
        storageKey: "1234-contrato",
        driveWebViewLink: null,
        metadata: { cloudinaryResourceType: "image", cloudinaryDeliveryType: "authenticated" },
      },
    };
    repo.findById.mockResolvedValue(cloudinaryDocument);
    // Como en el provider real de 15D.3, getStoredFilePublicUrl para
    // Cloudinary nunca entrega una URL — se simula acá devolviendo undefined.
    storage.getStoredFilePublicUrl.mockReturnValue(undefined);
    storage.downloadStoredFile.mockResolvedValue({ buffer: Buffer.from("contrato-bytes"), mimeType: "application/pdf" });

    const result = await documentsService.download("doc-3", fakeUser);

    expect(result).toMatchObject({ kind: "buffer", fileName: "dni.pdf", mimeType: "application/pdf" });
    expect(storage.downloadStoredFile).toHaveBeenCalledWith(cloudinaryDocument.storageFile);
  });
});

describe("documentsService permisos Nivel 3", () => {
  it("no permite listar documentos", async () => {
    await expect(documentsService.list({ page: 1, take: 25 } as never, cargaUser)).rejects.toMatchObject({
      statusCode: 403,
      code: "DOCUMENT_ACCESS_FORBIDDEN",
    });
    expect(repo.findMany).not.toHaveBeenCalled();
  });

  it("no permite descargar documentos", async () => {
    await expect(documentsService.download("doc-1", cargaUser)).rejects.toMatchObject({
      statusCode: 403,
      code: "DOCUMENT_ACCESS_FORBIDDEN",
    });
    expect(repo.findById).not.toHaveBeenCalled();
  });
});
