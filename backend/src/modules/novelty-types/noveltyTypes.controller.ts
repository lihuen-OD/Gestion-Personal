import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { createTtlCache } from "../../shared/cache/ttlCache";
import { requireParam } from "../../shared/http/params";
import type { ListNoveltyTypesQuery } from "./noveltyTypes.schemas";
import { noveltyTypesService } from "./noveltyTypes.service";

const noveltyTypesListCache = createTtlCache<Awaited<ReturnType<typeof noveltyTypesService.list>>>(60_000);
const noveltyTypesDetailCache = createTtlCache<Awaited<ReturnType<typeof noveltyTypesService.getById>>>(60_000);

export const noveltyTypesController = {
  list: (async (req, res) => {
    const cached = noveltyTypesListCache.get(req.originalUrl);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await noveltyTypesService.list(req.query as unknown as ListNoveltyTypesQuery);
    noveltyTypesListCache.set(req.originalUrl, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  getById: (async (req, res) => {
    const key = requireParam(req, "id");
    const cached = noveltyTypesDetailCache.get(key);
    if (cached) return res.json({ data: cached });
    const item = await noveltyTypesService.getById(requireParam(req, "id"));
    noveltyTypesDetailCache.set(key, item);
    res.json({ data: item });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await noveltyTypesService.create(req.body, requestAuditContext(req));
    noveltyTypesListCache.clear();
    noveltyTypesDetailCache.clear();
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await noveltyTypesService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    noveltyTypesListCache.clear();
    noveltyTypesDetailCache.clear();
    res.json({ data: item });
  }) satisfies RequestHandler,
};
