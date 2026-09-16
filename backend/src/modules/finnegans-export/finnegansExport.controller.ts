import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import type { FinnegansExportQuery } from "./finnegansExport.schemas";
import { finnegansExportService, toCsv } from "./finnegansExport.service";

export const finnegansExportController = {
  // Etapa 15L.3A §15/§26: preview=true nunca exige cierre ni audita;
  // preview=false (default) es la operación definitiva, revalida todo y
  // audita al autorizar. El frontend vuelve a pedir este endpoint sin
  // preview=true recién al clickear "Exportar" — nunca reutiliza filas de
  // preview.
  noveltiesJson: (async (req, res) => {
    const query = req.query as unknown as FinnegansExportQuery;
    const result = query.preview
      ? await finnegansExportService.getPreview(query)
      : await finnegansExportService.getDefinitive(query, requestAuditContext(req));
    res.json({ data: result });
  }) satisfies RequestHandler,

  // Etapa 15L.3A §25: el CSV no tiene modo preview — siempre corre la
  // operación definitiva (misma revalidación, mismo gate de cierre, misma
  // auditoría). No lee `query.preview` a propósito, así no existe ningún
  // camino por CSV que bypasee el gate.
  noveltiesCsv: (async (req, res) => {
    const query = req.query as unknown as FinnegansExportQuery;
    const result = await finnegansExportService.getDefinitive(query, requestAuditContext(req));
    const csv = toCsv(result.rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="finnegans_novedades_${query.period}.csv"`);
    res.send(`﻿${csv}`);
  }) satisfies RequestHandler,
};
