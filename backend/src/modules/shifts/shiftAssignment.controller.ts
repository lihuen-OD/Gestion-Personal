import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListShiftAssignmentsQuery } from "./shiftAssignment.schemas";
import { shiftAssignmentService } from "./shiftAssignment.service";

export const shiftAssignmentController = {
  list: (async (req, res) => {
    const data = await shiftAssignmentService.list(req.query as unknown as ListShiftAssignmentsQuery, req.user!);
    res.json({ data });
  }) satisfies RequestHandler,

  assign: (async (req, res) => {
    const data = await shiftAssignmentService.assign(req.body, req.user!, requestAuditContext(req));
    res.status(201).json({ data });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const data = await shiftAssignmentService.update(requireParam(req, "id"), req.body, req.user!, requestAuditContext(req));
    res.json({ data });
  }) satisfies RequestHandler,

  remove: (async (req, res) => {
    const data = await shiftAssignmentService.remove(requireParam(req, "id"), requestAuditContext(req));
    res.json({ data });
  }) satisfies RequestHandler,
};
