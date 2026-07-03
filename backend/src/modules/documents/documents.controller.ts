import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/AppError";
import { documentsListCache } from "./documents.cache";
import { documentsService } from "./documents.service";
import type { ListDocumentsQuery } from "./documents.schemas";

function userScopedCacheKey(req: Parameters<RequestHandler>[0]) {
  return `${req.user?.id || "anon"}:${req.user?.role || "none"}:${req.originalUrl}`;
}

export const documentsController = {
  list: (async (req, res) => {
    const key = userScopedCacheKey(req);
    const cached = documentsListCache.get(key);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await documentsService.list(req.query as unknown as ListDocumentsQuery, req.user!);
    documentsListCache.set(key, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  download: (async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError("Documento no encontrado", 404, "DOCUMENT_NOT_FOUND");
    const result = await documentsService.download(id, req.user!);
    if (result.kind === "redirect") {
      res.redirect(result.url);
      return;
    }

    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
    res.sendFile(result.path);
  }) satisfies RequestHandler,
};
