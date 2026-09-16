import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { FinnegansExportHistoryQuery, FinnegansExportQuery, FinnegansExportRequest } from "./finnegansExport.schemas";
import { finnegansExportService } from "./finnegansExport.service";

export const finnegansExportController = {
  // Etapa 15L.4: este GET queda exclusivamente para preview — nunca exige
  // cierre, nunca audita, nunca crea historial. La exportación definitiva
  // se movió a POST /novelties/export (ver `exportNovelties` abajo).
  noveltiesJson: (async (req, res) => {
    const query = req.query as unknown as FinnegansExportQuery;
    const result = await finnegansExportService.getPreview(query);
    res.json({ data: result });
  }) satisfies RequestHandler,

  // Etapa 15L.4 §18/§22: operación definitiva — revalida todo, exige motivo
  // en toda reexportación, y sólo si autoriza deja un batch persistente
  // (historial) además del AuditLog ya existente. `idempotencyKey` la genera
  // el frontend una vez por intento de exportación; un reintento con la
  // misma key nunca crea una versión nueva.
  exportNovelties: (async (req, res) => {
    const body = req.body as FinnegansExportRequest;
    const result = await finnegansExportService.exportDefinitive(body, requestAuditContext(req));
    res.json({ data: result });
  }) satisfies RequestHandler,

  // Etapa 15L.4 §26: listado de exportaciones definitivas de un período,
  // más nueva primero.
  history: (async (req, res) => {
    const query = req.query as unknown as FinnegansExportHistoryQuery;
    const result = await finnegansExportService.getHistory(query);
    res.json({ data: result });
  }) satisfies RequestHandler,

  // Etapa 15L.4 §27: detalle de un batch puntual — metadata + snapshot +
  // diff contra el anterior.
  historyDetail: (async (req, res) => {
    const result = await finnegansExportService.getHistoryDetail(requireParam(req, "batchId"));
    res.json({ data: result });
  }) satisfies RequestHandler,
};
