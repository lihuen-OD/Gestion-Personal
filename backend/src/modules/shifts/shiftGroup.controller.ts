import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import { clearShiftTemplatesReadCache } from "../workforce-management/workforce.cache";
import type { ListShiftGroupsQuery } from "./shiftGroup.schemas";
import { shiftGroupService } from "./shiftGroup.service";
import { requestShiftGroupScope } from "./shiftGroupAccess";

// Sin caché propia (catálogo chico, se lee al abrir la configuración). Toda
// escritura invalida el catálogo de plantillas (workforce.cache.ts), que
// incluye código, nombre, orden y estado del grupo de cada plantilla.
export const shiftGroupController = {
  list: (async (req, res) => {
    const data = await shiftGroupService.list(req.query as unknown as ListShiftGroupsQuery, await requestShiftGroupScope(req));
    res.json({ data });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const data = await shiftGroupService.create(req.body, requestAuditContext(req));
    clearShiftTemplatesReadCache();
    res.status(201).json({ data });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const data = await shiftGroupService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    clearShiftTemplatesReadCache();
    res.json({ data });
  }) satisfies RequestHandler,

  remove: (async (req, res) => {
    const data = await shiftGroupService.remove(requireParam(req, "id"), requestAuditContext(req));
    clearShiftTemplatesReadCache();
    res.json({ data });
  }) satisfies RequestHandler,
};
