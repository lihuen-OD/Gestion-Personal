import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/AppError";
import { documentsService } from "./documents.service";
import type { ListDocumentsQuery } from "./documents.schemas";

export const documentsController = {
  list: (async (req, res) => {
    const result = await documentsService.list(req.query as unknown as ListDocumentsQuery, req.user!);
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
