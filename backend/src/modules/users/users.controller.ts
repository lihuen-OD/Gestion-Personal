import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListUsersQuery } from "./users.schemas";
import { usersService } from "./users.service";

export const usersController = {
  list: (async (req, res) => {
    const result = await usersService.list(req.query as unknown as ListUsersQuery);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  getById: (async (req, res) => {
    const user = await usersService.getById(requireParam(req, "id"));
    res.json({ data: user });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const user = await usersService.create(req.body, requestAuditContext(req));
    res.status(201).json({ data: user });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const user = await usersService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: user });
  }) satisfies RequestHandler,

  resetPassword: (async (req, res) => {
    const user = await usersService.resetPassword(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: user });
  }) satisfies RequestHandler,
};
