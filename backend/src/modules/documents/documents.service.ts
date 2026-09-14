import { access } from "node:fs/promises";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { AppError } from "../../shared/errors/AppError";
import { storageService } from "../../shared/storage/storage.service";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { documentsRepository } from "./documents.repository";
import type { ListDocumentsQuery } from "./documents.schemas";
import { documentCategoryViewWhere } from "../../shared/security/documentCategoryAccess";

// Etapa 15D.4 (docs/decisions/DOCUMENT_CATEGORY_AUTHORIZATION_15D4.md):
// reemplaza el bloqueo total que existía acá para Nivel 3 (Carga Horaria)
// por control granular real: employeeAccessWhere (scope) +
// documentCategoryViewWhere (category.viewRoles) resuelven juntos qué
// documentos ve cada rol. RRHH sigue viendo todo (superadmin documental);
// Nivel 3/Supervisión sólo ven lo que su categoría les habilita
// explícitamente — por default (categorías no configuradas) eso sigue
// siendo "nada" para Nivel 3, igual que antes de esta etapa.

export const documentsService = {
  async list(query: ListDocumentsQuery, user: Express.AuthUser) {
    const [items, total] = await documentsRepository.findMany(
      query,
      employeeAccessWhere(user),
      documentCategoryViewWhere(user.role),
    );
    return {
      items,
      meta: {
        total,
        page: query.page,
        pageSize: query.take,
        hasMore: query.page * query.take < total,
      },
    };
  },

  async download(id: string, user: Express.AuthUser, audit?: AuditContext) {
    const item = await documentsRepository.findById(id, employeeAccessWhere(user), documentCategoryViewWhere(user.role));
    if (!item) throw new AppError("Documento no encontrado", 404, "DOCUMENT_NOT_FOUND");

    await auditService.register({
      ...audit,
      action: "EXPORT",
      entity: "EmployeeDocument",
      entityId: item.id,
      description: `Se descargo/visualizo el documento ${item.fileName} del legajo ${item.employee.legajo}.`,
    });

    // Etapa 15D.1: un documento con storageFile vinculado resuelve SIEMPRE
    // por su storageProvider persistido, nunca por el provider global activo
    // hoy — ver docs/decisions/STORAGE_PROVIDER_REGISTRY_15D1.md. El
    // fallback a storageKey "suelto" (sin storageFile) sólo aplica a
    // documentos previos a que StorageFile existiera, y conserva el
    // comportamiento legacy (provider global) porque no hay forma de saber
    // con qué provider se subieron.
    const storageKey = item.storageFile?.storageKey || item.storageKey;
    const fileRef = item.storageFile;
    const publicUrl = item.storageFile?.driveWebViewLink
      ? undefined
      : fileRef
        ? storageService.getStoredFilePublicUrl(fileRef)
        : storageService.getPublicUrl(storageKey);
    if (publicUrl) {
      return {
        kind: "redirect" as const,
        url: publicUrl,
      };
    }

    const downloaded = fileRef ? await storageService.downloadStoredFile(fileRef) : await storageService.download(storageKey);
    if (downloaded) {
      return {
        kind: "buffer" as const,
        buffer: downloaded.buffer,
        fileName: item.fileName,
        mimeType: downloaded.mimeType || item.fileMimeType,
      };
    }

    const filePath = fileRef ? storageService.getStoredFilePath(fileRef) : storageService.getFilePath(storageKey);
    if (!filePath) throw new AppError("Archivo no disponible", 404, "DOCUMENT_FILE_NOT_AVAILABLE");

    await access(filePath).catch(() => {
      throw new AppError("Archivo no encontrado en storage", 404, "DOCUMENT_FILE_NOT_FOUND");
    });

    return {
      kind: "file" as const,
      path: filePath,
      fileName: item.fileName,
      mimeType: item.fileMimeType,
    };
  },
};
