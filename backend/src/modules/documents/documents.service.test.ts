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
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const repo = documentsRepository as unknown as { findById: Mock; findMany: Mock };
const storage = storageService as unknown as { getPublicUrl: Mock; getFilePath: Mock; download: Mock };
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
