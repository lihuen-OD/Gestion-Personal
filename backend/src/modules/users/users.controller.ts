import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { createTtlCache } from "../../shared/cache/ttlCache";
import { requireParam } from "../../shared/http/params";
import type { ListUsersQuery } from "./users.schemas";
import { usersService } from "./users.service";

const usersListCache = createTtlCache<Awaited<ReturnType<typeof usersService.list>>>(30_000);
const usersDetailCache = createTtlCache<Awaited<ReturnType<typeof usersService.getById>>>(30_000);

function clearUsersReadCache() {
  usersListCache.clear();
  usersDetailCache.clear();
}

export const usersController = {
  list: (async (req, res) => {
    const cached = usersListCache.get(req.originalUrl);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await usersService.list(req.query as unknown as ListUsersQuery);
    usersListCache.set(req.originalUrl, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  getById: (async (req, res) => {
    const key = requireParam(req, "id");
    const cached = usersDetailCache.get(key);
    if (cached) return res.json({ data: cached });
    const user = await usersService.getById(key);
    usersDetailCache.set(key, user);
    res.json({ data: user });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const user = await usersService.create(req.body, requestAuditContext(req));
    clearUsersReadCache();
    res.status(201).json({ data: user });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const user = await usersService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    clearUsersReadCache();
    res.json({ data: user });
  }) satisfies RequestHandler,

  resetPassword: (async (req, res) => {
    const user = await usersService.resetPassword(requireParam(req, "id"), req.body, requestAuditContext(req));
    clearUsersReadCache();
    res.json({ data: user });
  }) satisfies RequestHandler,
};
