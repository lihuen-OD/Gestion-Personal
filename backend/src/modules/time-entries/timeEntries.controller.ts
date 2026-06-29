import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListTimeEntriesQuery, TimeEntriesExportQuery } from "./timeEntries.schemas";
import { timeEntriesExportToCsv, timeEntriesService } from "./timeEntries.service";

export const timeEntriesController = {
  list: (async (req, res) => {
    const result = await timeEntriesService.list(req.query as unknown as ListTimeEntriesQuery, req.user!);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await timeEntriesService.create(req.body, req.user!, requestAuditContext(req));
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await timeEntriesService.update(requireParam(req, "id"), req.body, req.user!, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,

  submit: (async (req, res) => {
    const item = await timeEntriesService.submit(requireParam(req, "id"), req.user!, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,

  approve: (async (req, res) => {
    const item = await timeEntriesService.approve(requireParam(req, "id"), req.user!, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,

  reject: (async (req, res) => {
    const item = await timeEntriesService.reject(requireParam(req, "id"), req.body, req.user!, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,

  returnForCorrection: (async (req, res) => {
    const item = await timeEntriesService.returnForCorrection(requireParam(req, "id"), req.body, req.user!, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,

  exportJson: (async (req, res) => {
    const result = await timeEntriesService.exportByPerson(req.query as unknown as TimeEntriesExportQuery, req.user!, requestAuditContext(req));
    res.json({ data: result });
  }) satisfies RequestHandler,

  exportCsv: (async (req, res) => {
    const query = req.query as unknown as TimeEntriesExportQuery;
    const result = await timeEntriesService.exportByPerson(query, req.user!, requestAuditContext(req));
    const csv = timeEntriesExportToCsv(result.rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="horas_trabajadas_${query.period}.csv"`);
    res.send(`\uFEFF${csv}`);
  }) satisfies RequestHandler,
};
