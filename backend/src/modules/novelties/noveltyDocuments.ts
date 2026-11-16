import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { canAccessDocumentCategory } from "../../shared/security/documentCategoryAccess";
import { storagePathBuilder } from "../../shared/storage/storagePathBuilder";
import { storageService, type PreparedManagedStorageUpload } from "../../shared/storage/storage.service";
import { extensionFromMimeType, fileExtension } from "../../shared/storage/storageValidation";
import { noveltiesRepository } from "./novelties.repository";
import type { NoveltyDocumentInput } from "./novelties.schemas";

// Documentación obligatoria de una novedad (NOVELTY_COVERAGE_ENGINE.md §15.1).
//
// La base y el storage externo (Drive / Object Storage / local) no comparten
// transacción. Mismo patrón que la foto del fichador (F12-PERF-3):
//   1. se sube el objeto físico ANTES de la transacción (sin red adentro);
//   2. StorageFile + Novelty + EmployeeDocument se escriben en UNA transacción;
//   3. si la transacción falla, se borra el objeto subido (compensación).
// Si la compensación falla, el objeto queda huérfano en el storage, sin
// ninguna fila que lo use, y se registra como error crítico. Nunca queda una
// novedad sin su documento.

/**
 * Máximo de personas por alta con documento (decisión de negocio, ADR §15.1):
 * se sube una copia por legajo de forma síncrona, así que un lote grande
 * arriesga timeouts. Sin documento rige el máximo general del schema (250).
 */
export const MAX_EMPLOYEES_WITH_DOCUMENT = 25;

export function assertDocumentBatchSize(employeeIds: string[]) {
  if (new Set(employeeIds).size > MAX_EMPLOYEES_WITH_DOCUMENT) {
    throw new AppError(
      `Con documentación podés cargar la novedad para hasta ${MAX_EMPLOYEES_WITH_DOCUMENT} personas por vez. Dividí la carga en grupos más pequeños.`,
      400,
      "NOVELTY_DOCUMENT_TOO_MANY_EMPLOYEES",
    );
  }
}

export type PreparedNoveltyDocument = { employeeId: string; categoryId: string; prepared: PreparedManagedStorageUpload };

function bufferFromBase64(value: string) {
  const base64 = value.includes(",") ? value.split(",").pop() : value;
  return Buffer.from(base64 || "", "base64");
}

export async function compensateNoveltyDocuments(documents: PreparedNoveltyDocument[]) {
  for (const document of documents) {
    try {
      await storageService.compensateManagedUpload(document.prepared);
    } catch (error) {
      console.error("NOVELTY_DOCUMENT_COMPENSATION_FAILED", {
        severity: "critical",
        storageKey: document.prepared.uploaded.storageKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Sube una copia del documento por legajo (cada documento vive en la carpeta
 * de su legajo, igual que un documento cargado desde el legajo). Valida
 * categoría y permiso ANTES de tocar el storage. Si una subida falla, borra
 * las anteriores y la novedad no se crea.
 */
export async function uploadNoveltyDocuments(employeeIds: string[], document: NoveltyDocumentInput, user: Express.AuthUser, audit?: AuditContext): Promise<PreparedNoveltyDocument[]> {
  const category = await noveltiesRepository.findNoveltyDocumentCategory();
  if (!category) throw new AppError("No hay una categoría documental activa para novedades. Pedile a RRHH que la configure.", 409, "NOVELTY_DOCUMENT_CATEGORY_MISSING");
  if (!canAccessDocumentCategory({ userRole: user.role, category, action: "upload" })) {
    throw new AppError("No tenés permiso para subir documentos de esta categoría.", 403, "DOCUMENT_UPLOAD_FORBIDDEN");
  }
  const employees = await noveltiesRepository.findEmployeeIdentities(employeeIds);
  const buffer = bufferFromBase64(document.fileBase64);
  const uploaded: PreparedNoveltyDocument[] = [];
  try {
    for (const employee of employees) {
      const location = storagePathBuilder.employeeDocument({
        employeeId: employee.id,
        employee,
        category,
        uploadedAt: new Date(),
        extension: fileExtension(document.fileName) || extensionFromMimeType(document.fileMimeType),
        uniqueSuffix: randomBytes(3).toString("hex"),
      });
      const prepared = await storageService.uploadManagedObject({
        buffer,
        fileName: document.fileName,
        storedFileName: location.fileName,
        mimeType: document.fileMimeType,
        folderSegments: location.folderSegments,
        driveFolders: location.driveFolders,
        module: "LEGAJOS",
        entityType: "EMPLOYEE_DOCUMENT",
        entityId: employee.id,
        employeeId: employee.id,
        documentType: category.code || category.name,
        visibility: "RRHH_ONLY",
        uploadedByUserId: audit?.userId || null,
        purpose: "general",
      });
      uploaded.push({ employeeId: employee.id, categoryId: category.id, prepared });
    }
  } catch (error) {
    await compensateNoveltyDocuments(uploaded);
    // Un archivo inválido (vacío, formato, tamaño) se explica tal cual; una falla del storage, no.
    if (error instanceof AppError && error.statusCode < 500) throw error;
    throw new AppError("No pudimos guardar la documentación, así que la novedad no se creó. Intentá nuevamente.", 502, "NOVELTY_DOCUMENT_UPLOAD_FAILED");
  }
  return uploaded;
}

/** Dentro de la transacción del alta: StorageFile (+ archivo secundario) y EmployeeDocument por novedad. */
export async function persistNoveltyDocumentsWithin(
  tx: PrismaTransactionClient,
  documents: PreparedNoveltyDocument[],
  novelties: Array<{ id: string; employeeId: string }>,
  document: NoveltyDocumentInput,
  uploadedByUserId: string | null | undefined,
) {
  const rows: Prisma.EmployeeDocumentUncheckedCreateInput[] = [];
  for (const novelty of novelties) {
    const prepared = documents.find((item) => item.employeeId === novelty.employeeId);
    if (!prepared) throw new AppError("Falta la documentación de una de las personas.", 500, "NOVELTY_DOCUMENT_MISMATCH");
    const stored = await storageService.persistManagedUploadWithArchive(prepared.prepared, tx);
    rows.push({
      employeeId: novelty.employeeId,
      categoryId: prepared.categoryId,
      noveltyId: novelty.id,
      fileName: document.fileName,
      fileMimeType: document.fileMimeType,
      fileSizeBytes: document.fileSizeBytes,
      storageKey: stored.storageKey,
      storageFileId: stored.id,
      status: "VIGENTE",
      notes: document.notes || null,
      uploadedByUserId: uploadedByUserId || null,
    });
  }
  return noveltiesRepository.createDocumentsWithin(tx, rows);
}
