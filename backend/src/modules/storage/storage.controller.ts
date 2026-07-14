import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import { storageModuleService } from "./storage.service";

export const storageController = {
  metadata: (async (req, res) => {
    const file = await storageModuleService.getMetadata(requireParam(req, "id"), req.user!, requestAuditContext(req));
    res.json({ data: file });
  }) satisfies RequestHandler,

  download: (async (req, res) => {
    const result = await storageModuleService.download(requireParam(req, "id"), req.user!, requestAuditContext(req));
    if (result.kind === "redirect") {
      res.redirect(result.url);
      return;
    }
    if (result.kind === "buffer") {
      res.setHeader("Content-Type", result.mimeType);
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
      res.send(result.buffer);
      return;
    }
    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
    res.sendFile(result.path);
  }) satisfies RequestHandler,

  archive: (async (req, res) => {
    const file = await storageModuleService.archive(requireParam(req, "id"), req.user!, requestAuditContext(req));
    res.json({ data: file });
  }) satisfies RequestHandler,
};
