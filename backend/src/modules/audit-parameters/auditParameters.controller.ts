import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { createTtlCache } from "../../shared/cache/ttlCache";
import { requireParam } from "../../shared/http/params";
import { auditParametersService } from "./auditParameters.service";
import type { ListAuditParametersQuery } from "./auditParameters.schemas";

// Etapa 14H.6: GET /audit-parameters no tenía ninguna cache backend (a
// diferencia de sus hermanos de Configuración, hourConceptsReadCache/
// documentCategoriesReadCache, mismo patrón — TTL 60s, key = req.originalUrl,
// sin scope de usuario porque list() no recibe user y todo este router ya
// requiere adminRoles desde auditParameters.routes.ts, así que no hay
// variación de datos entre usuarios que compartir por error).
const auditParametersReadCache = createTtlCache<Awaited<ReturnType<typeof auditParametersService.list>>>(60_000);

export const auditParametersController = {
  list: (async (req, res) => {
    const cached = auditParametersReadCache.get(req.originalUrl);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await auditParametersService.list(req.query as unknown as ListAuditParametersQuery);
    auditParametersReadCache.set(req.originalUrl, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await auditParametersService.create(req.body, req.user!, requestAuditContext(req));
    auditParametersReadCache.clear();
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await auditParametersService.update(requireParam(req, "id"), req.body, req.user!, requestAuditContext(req));
    auditParametersReadCache.clear();
    res.json({ data: item });
  }) satisfies RequestHandler,
};
