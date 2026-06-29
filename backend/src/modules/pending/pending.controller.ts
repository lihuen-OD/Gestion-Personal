import type { RequestHandler } from "express";
import type { PendingQuery } from "./pending.schemas";
import { pendingService } from "./pending.service";

export const pendingController = {
  list: (async (req, res) => {
    const result = await pendingService.list(req.query as unknown as PendingQuery, req.user!);
    res.json({ data: result });
  }) satisfies RequestHandler,
};
