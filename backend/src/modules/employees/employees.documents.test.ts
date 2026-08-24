import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { auditService } from "../audit/audit.service";
import { storageService } from "../../shared/storage/storage.service";
import { employeesRepository } from "./employees.repository";
import { createEmployeeDocumentSchema } from "./employees.schemas";
import { employeesService } from "./employees.service";

vi.mock("./employees.repository", () => ({
  employeesRepository: {
    findById: vi.fn(),
    findDocumentCategory: vi.fn(),
    createDocument: vi.fn(),
  },
}));

vi.mock("../../shared/storage/storage.service", () => ({
  storageService: { uploadManaged: vi.fn() },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const repo = employeesRepository as unknown as {
  findById: Mock;
  findDocumentCategory: Mock;
  createDocument: Mock;
};
const storage = storageService as unknown as { uploadManaged: Mock };
const audit = auditService as unknown as { register: Mock };

const input = {
  categoryId: "10000000-0000-4000-8000-000000000001",
  fileName: "contrato.pdf",
  fileMimeType: "application/pdf",
  fileSizeBytes: 4,
  fileBase64: Buffer.from("%PDF").toString("base64"),
  status: "VIGENTE" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  repo.findById.mockResolvedValue({ id: "employee-1", legajo: "100", documents: [] });
  repo.findDocumentCategory.mockResolvedValue({ id: input.categoryId, code: "CONTRATO", name: "Contrato" });
  storage.uploadManaged.mockResolvedValue({ id: "storage-file-1", storageKey: "managed/contrato.pdf" });
  repo.createDocument.mockResolvedValue({
    id: "employee-1",
    legajo: "100",
    documents: [{ id: "document-1", storageKey: "managed/contrato.pdf" }],
  });
});

describe("employee document storage", () => {
  it("rechaza storageKey enviado por el cliente", () => {
    const result = createEmployeeDocumentSchema.safeParse({ ...input, storageKey: "client/bypass.pdf" });

    expect(result.success).toBe(false);
  });

  it("exige contenido para que el servidor valide y registre el archivo", () => {
    const result = createEmployeeDocumentSchema.safeParse({ ...input, fileBase64: undefined });

    expect(result.success).toBe(false);
  });

  it("usa exclusivamente el StorageFile creado por uploadManaged", async () => {
    await employeesService.createDocument("employee-1", input, { userId: "user-1" });

    expect(storage.uploadManaged).toHaveBeenCalledWith(expect.objectContaining({
      module: "LEGAJOS",
      entityType: "EMPLOYEE_DOCUMENT",
      entityId: "employee-1",
      employeeId: "employee-1",
      uploadedByUserId: "user-1",
    }));
    expect(repo.createDocument).toHaveBeenCalledWith(
      "employee-1",
      expect.objectContaining({ storageKey: "managed/contrato.pdf", storageFileId: "storage-file-1" }),
      "user-1",
    );
    expect(audit.register).toHaveBeenCalled();
  });
});
