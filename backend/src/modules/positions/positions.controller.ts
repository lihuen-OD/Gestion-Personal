import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { createTtlCache } from "../../shared/cache/ttlCache";
import { requireParam } from "../../shared/http/params";
import type { ListPositionOptionsQuery, ListPositionsQuery } from "./positions.schemas";
import { positionsService } from "./positions.service";

// Etapa 14D.4: mismo patrón ya usado en `employees.controller.ts` para
// `GET /employees/options` — caché TTL a nivel controller, además del select
// liviano en sí (§ repositorio). El catálogo de puestos no está scopeado por
// usuario/rol (`GET /positions` tampoco lo está, confirmado en
// `positions.routes.ts` — sólo `requireAuth`), así que la clave es la URL
// completa (query incluida), sin necesidad de `userScopedCacheKey`.
const positionOptionsCache = createTtlCache<Awaited<ReturnType<typeof positionsService.listOptions>>>(60_000);

export const positionsController = {
  list: (async (req, res) => {
    const result = await positionsService.list(req.query as unknown as ListPositionsQuery);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  listOptions: (async (req, res) => {
    const key = req.originalUrl;
    const cached = positionOptionsCache.get(key);
    if (cached) return res.json({ data: cached });
    const result = await positionsService.listOptions(req.query as unknown as ListPositionOptionsQuery);
    positionOptionsCache.set(key, result);
    res.json({ data: result });
  }) satisfies RequestHandler,

  getById: (async (req, res) => {
    const item = await positionsService.getById(requireParam(req, "id"));
    res.json({ data: item });
  }) satisfies RequestHandler,

  assignedEmployees: (async (req, res) => {
    const items = await positionsService.listAssignedEmployees(requireParam(req, "id"), req.user!);
    res.json({ data: items });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await positionsService.create(req.body, requestAuditContext(req));
    positionOptionsCache.clear();
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await positionsService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    positionOptionsCache.clear();
    res.json({ data: item });
  }) satisfies RequestHandler,

  remove: (async (req, res) => {
    const item = await positionsService.remove(requireParam(req, "id"), requestAuditContext(req));
    positionOptionsCache.clear();
    res.json({ data: item });
  }) satisfies RequestHandler,
};
