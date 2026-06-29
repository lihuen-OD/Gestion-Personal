import { access } from "node:fs/promises";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { AppError } from "../../shared/errors/AppError";
import { storageService } from "../../shared/storage/storage.service";
import { documentsRepository } from "./documents.repository";
import type { ListDocumentsQuery } from "./documents.schemas";

export const documentsService = {
  async list(query: ListDocumentsQuery, user: Express.AuthUser) {
    const [items, total] = await documentsRepository.findMany(query, employeeAccessWhere(user));
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

  async download(id: string, user: Express.AuthUser) {
    const item = await documentsRepository.findById(id, employeeAccessWhere(user));
    if (!item) throw new AppError("Documento no encontrado", 404, "DOCUMENT_NOT_FOUND");

    const publicUrl = storageService.getPublicUrl(item.storageKey);
    if (publicUrl) {
      return {
        kind: "redirect" as const,
        url: publicUrl,
      };
    }

    const filePath = storageService.getFilePath(item.storageKey);
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
