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

const rrhhUser = { id: "user-1", role: "NIVEL_1_RRHH" } as unknown as Express.AuthUser;

beforeEach(() => {
  vi.clearAllMocks();
  repo.findById.mockResolvedValue({ id: "employee-1", legajo: "100", documents: [] });
  // uploadRoles no importa para RRHH (superadmin documental, Etapa 15D.4) —
  // se deja vacío a propósito para probar que igual pasa.
  repo.findDocumentCategory.mockResolvedValue({ id: input.categoryId, code: "CONTRATO", name: "Contrato", uploadRoles: [] });
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
    await employeesService.createDocument("employee-1", input, rrhhUser, { userId: "user-1" });

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

/**
 * Etapa 15D.4 (docs/decisions/DOCUMENT_CATEGORY_AUTHORIZATION_15D4.md): orden
 * seguro — categoría, uploadRoles de la categoría y alcance del empleado se
 * validan ANTES de tocar storage, así una categoría inexistente o no
 * autorizada nunca deja un archivo huérfano subido.
 */
describe("employeesService.createDocument — autorización documental por categoría (Etapa 15D.4)", () => {
  const supervisionUser = { id: "user-2", role: "NIVEL_2_SUPERVISION" } as unknown as Express.AuthUser;
  const cargaUser = { id: "user-3", role: "NIVEL_3_CARGA_HORARIA" } as unknown as Express.AuthUser;

  it("categoría inexistente: 404 antes de tocar storage — no queda archivo huérfano", async () => {
    repo.findDocumentCategory.mockResolvedValue(null);

    await expect(employeesService.createDocument("employee-1", input, rrhhUser)).rejects.toMatchObject({
      statusCode: 404,
      code: "DOCUMENT_CATEGORY_NOT_FOUND",
    });

    expect(storage.uploadManaged).not.toHaveBeenCalled();
    expect(repo.createDocument).not.toHaveBeenCalled();
  });

  it("Supervisión sin permiso de categoría: 403 antes de tocar storage y antes de chequear alcance del empleado", async () => {
    repo.findDocumentCategory.mockResolvedValue({
      id: input.categoryId,
      code: "CONTRATO",
      name: "Contrato",
      uploadRoles: ["Nivel 1 - RRHH"],
    });

    await expect(employeesService.createDocument("employee-1", input, supervisionUser)).rejects.toMatchObject({
      statusCode: 403,
      code: "DOCUMENT_UPLOAD_FORBIDDEN",
    });

    expect(repo.findById).not.toHaveBeenCalled(); // el chequeo de alcance ni se llega a hacer
    expect(storage.uploadManaged).not.toHaveBeenCalled();
    expect(repo.createDocument).not.toHaveBeenCalled();
  });

  it("Supervisión con la categoría habilitada y el empleado dentro de su alcance: sube correctamente", async () => {
    repo.findDocumentCategory.mockResolvedValue({
      id: input.categoryId,
      code: "CONTRATO",
      name: "Contrato",
      uploadRoles: ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión"],
    });

    await employeesService.createDocument("employee-1", input, supervisionUser, { userId: "user-2" });

    expect(repo.findById).toHaveBeenCalledTimes(1); // scope check vía getById(id, user)
    expect(storage.uploadManaged).toHaveBeenCalledTimes(1);
    expect(repo.createDocument).toHaveBeenCalledTimes(1);
  });

  it("Nivel 3 se comporta igual que Supervisión: sube si la categoría lo habilita y el empleado está en su alcance", async () => {
    repo.findDocumentCategory.mockResolvedValue({
      id: input.categoryId,
      code: "CONTRATO",
      name: "Contrato",
      uploadRoles: ["Nivel 1 - RRHH", "Nivel 3 - Administrativo de Carga Horaria"],
    });

    await employeesService.createDocument("employee-1", input, cargaUser, { userId: "user-3" });

    expect(storage.uploadManaged).toHaveBeenCalledTimes(1);
    expect(repo.createDocument).toHaveBeenCalledTimes(1);
  });

  it("permiso de categoría OK pero empleado fuera de alcance: 404 antes de tocar storage — no queda archivo huérfano", async () => {
    repo.findDocumentCategory.mockResolvedValue({
      id: input.categoryId,
      code: "CONTRATO",
      name: "Contrato",
      uploadRoles: ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión"],
    });
    repo.findById.mockResolvedValue(null); // employeeAccessWhere no matchea — fuera de alcance

    await expect(employeesService.createDocument("employee-1", input, supervisionUser)).rejects.toMatchObject({
      statusCode: 404,
      code: "EMPLOYEE_NOT_FOUND",
    });

    expect(storage.uploadManaged).not.toHaveBeenCalled();
    expect(repo.createDocument).not.toHaveBeenCalled();
  });

  it("RRHH sube aunque uploadRoles no lo incluya explícitamente (superadmin documental)", async () => {
    repo.findDocumentCategory.mockResolvedValue({
      id: input.categoryId,
      code: "CONTRATO",
      name: "Contrato",
      uploadRoles: ["Nivel 2 - Supervisión / Gestión"], // RRHH deliberadamente NO listado
    });

    await employeesService.createDocument("employee-1", input, rrhhUser);

    expect(storage.uploadManaged).toHaveBeenCalledTimes(1);
    expect(repo.createDocument).toHaveBeenCalledTimes(1);
  });
});
