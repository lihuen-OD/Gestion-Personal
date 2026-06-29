import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import type { FinnegansExportQuery } from "./finnegansExport.schemas";
import { finnegansExportService, toCsv } from "./finnegansExport.service";

function filePeriod(query: FinnegansExportQuery) {
  if (query.period) return query.period;
  const from = query.from?.toISOString().slice(0, 10) || "desde";
  const to = query.to?.toISOString().slice(0, 10) || "hasta";
  return `${from}_${to}`;
}

export const finnegansExportController = {
  noveltiesJson: (async (req, res) => {
    const result = await finnegansExportService.getRows(req.query as unknown as FinnegansExportQuery, requestAuditContext(req));
    res.json({ data: result });
  }) satisfies RequestHandler,

  noveltiesCsv: (async (req, res) => {
    const query = req.query as unknown as FinnegansExportQuery;
    const result = await finnegansExportService.getRows(query, requestAuditContext(req));
    const csv = toCsv(result.rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="finnegans_novedades_${filePeriod(query)}.csv"`);
    res.send(`\uFEFF${csv}`);
  }) satisfies RequestHandler,
};
