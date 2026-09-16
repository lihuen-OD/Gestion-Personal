import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Download, FileBarChart, History } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { roleLevel } from "../utils/roles";
import { useAsyncAction } from "../utils/useAsyncAction";
import { OverflowCell } from "../components/ui/OverflowCell";
import { FilterPanel } from "../components/ui/FilterPanel";
import { DataTable } from "../components/ui/DataTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { StatCard } from "../components/ui/StatCard";
import { Modal } from "../components/ui/Modal";
import { ApiError } from "../services/api/apiClient";
import {
  finnegansExportApiService,
  type FinnegansExportHistoryEntry,
  type FinnegansExportPreview,
  type FinnegansExportRow,
  type FinnegansRowStatus,
} from "../services/api/finnegansExportApiService";
import { currentMonthPeriod } from "../utils/period";

const exportHeaders = [
  "Legajo",
  "Novedad",
  "Centro de costo",
  "Valor 1",
  "Fecha Aplicacion",
  "Fecha desde",
  "Fecha hasta",
];

// Etapa 15L.4 (docs/decisions/FINNEGANS_EXPORT_HISTORY_IDEMPOTENCY_15L4.md):
// mismo formato ya usado en AttendancePage.tsx/ShiftAlertsPage.tsx para
// instantes reales (TIMESTAMPTZ) — con año, porque un historial puede
// mostrar exportaciones de meses/años distintos al actual.
function formatBatchTimestamp(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Cordoba",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

// Etapa 15L.3A §26: sólo se llama con el resultado de exportDefinitive() —
// nunca con las filas de preview ni con el subconjunto filtrado por
// búsqueda en pantalla, para que el archivo generado sea siempre
// exactamente lo que el backend autorizó.
async function exportFinnegansExcel(rows: FinnegansExportRow[], period: string) {
  const XLSX = await import("xlsx");
  const sheetRows = [
    exportHeaders,
    ...rows.map((row) => [
      row.legajo,
      row.novedad,
      row.centroCosto,
      row.valor1,
      row.fechaAplicacion,
      row.fechaDesde,
      row.fechaHasta,
    ]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);

  rows.forEach((row, index) => {
    const cellRef = `A${index + 2}`;
    worksheet[cellRef] = { t: "s", v: row.legajo, z: "@" };
  });

  worksheet["!cols"] = [
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 12 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Novedades");
  XLSX.writeFile(workbook, `finnegans_novedades_${period}.xlsx`, {
    compression: true,
  });
}

const rowStatusBadge: Record<FinnegansRowStatus, { tone: "success" | "warning"; label: string }> = {
  LISTO: { tone: "success", label: "Listo" },
  FALTA_CANTIDAD: { tone: "warning", label: "Falta cantidad" },
  FALTA_CONFIGURACION: { tone: "warning", label: "Falta configuración" },
  CIERRE_PENDIENTE: { tone: "warning", label: "Cierre pendiente" },
};

function exportStatusLabel(lastExport: FinnegansExportPreview["lastExport"]) {
  if (!lastExport) return "Sin exportaciones registradas para este período.";
  const changeLabel = lastExport.sameAsCurrent ? "Sin cambios desde la última exportación." : "Hay cambios desde la última exportación.";
  return `Última exportación: versión ${lastExport.version} · ${formatBatchTimestamp(lastExport.createdAt)} — ${changeLabel}`;
}

// Etapa 15L.3A §17/§29 / 15L.4 §29: mismo dato (readiness) que decide si el
// botón "Exportar" está habilitado, mostrado en formato legible para RRHH —
// sin ningún id técnico. Ahora también informa el estado de exportación del
// período (nunca exportado / última versión / hay o no cambios), todo sin
// crear ningún batch — sólo lectura de la preview.
function PeriodStatusBanner({ preview }: { preview: FinnegansExportPreview }) {
  const { readiness, lastExport } = preview;

  if (!readiness.totalRows) {
    return <div className="info-note">No hay novedades exportables en este período.</div>;
  }

  if (readiness.ready) {
    return (
      <div className="info-note readiness-ready">
        <b>✓ Listo para exportar</b>
        <p>{exportStatusLabel(lastExport)}</p>
      </div>
    );
  }

  return (
    <div className="info-note readiness-blocked">
      <b>⚠ Exportación pendiente de completar</b>
      {readiness.reasons.length > 0 ? (
        <>
          <p>Problemas:</p>
          <ul className="readiness-reasons">
            {readiness.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </>
      ) : null}
      <p>{exportStatusLabel(lastExport)}</p>
    </div>
  );
}

// Etapa 15L.4 §33: resumen mínimo de diferencias contra la versión
// anterior — sin diff celda por celda, sólo conteos.
function diffSummaryLabel(diff: FinnegansExportHistoryEntry["diff"]) {
  if (!diff) return null;
  const parts: string[] = [];
  if (diff.added) parts.push(`+${diff.added} novedad${diff.added === 1 ? "" : "es"}`);
  if (diff.removed) parts.push(`-${diff.removed} novedad${diff.removed === 1 ? "" : "es"}`);
  if (diff.modified) parts.push(`~${diff.modified} modificada${diff.modified === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : null;
}

function ExportHistoryTimeline({ status, batches }: { status: "loading" | "success" | "error"; batches: FinnegansExportHistoryEntry[] }) {
  if (status === "loading") return <div className="empty"><span>Cargando historial...</span></div>;
  if (status === "error") return <div className="empty"><span>No pudimos cargar el historial de este período.</span></div>;
  if (!batches.length) return <div className="empty"><span>Todavía no se generó ninguna exportación para este período.</span></div>;

  return (
    <div className="timeline">
      {batches.map((batch) => {
        const diffLabel = diffSummaryLabel(batch.diff);
        return (
          <div key={batch.id}>
            <i />
            <b>
              Versión {batch.version}{" "}
              <Badge tone={batch.isReexport ? "warning" : "success"}>{batch.isReexport ? "Reexportación" : "Primera exportación"}</Badge>
            </b>
            <span>
              {formatBatchTimestamp(batch.createdAt)} · {batch.format} · {batch.rowCount} novedades
              {batch.createdByName ? ` · ${batch.createdByName}` : ""}
            </span>
            {batch.reason ? <p>Motivo: {batch.reason}</p> : null}
            {diffLabel ? <p className="table-sub">{diffLabel}</p> : batch.sameAsPrevious ? <p className="table-sub">Sin cambios respecto de la versión anterior.</p> : null}
          </div>
        );
      })}
    </div>
  );
}

export function FinnegansExportPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<FinnegansExportPreview | undefined>();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [exportError, setExportError] = useState("");
  const [historyBatches, setHistoryBatches] = useState<FinnegansExportHistoryEntry[]>([]);
  const [historyStatus, setHistoryStatus] = useState<"loading" | "success" | "error">("loading");
  const [reexportModalOpen, setReexportModalOpen] = useState(false);
  const [reexportReason, setReexportReason] = useState("");

  useEffect(() => {
    let mounted = true;
    // Etapa 9G: sólo mostrar el loading grande cuando todavía no hay filas
    // en pantalla — a diferencia de Dashboard/Reportes (sin ningún filtro
    // interactivo, sólo reintento tras error), esta pantalla sí tiene un
    // selector de período en vivo que antes blanqueaba la tabla de vista
    // previa en cada cambio, con datos ya cargados (mismo patrón ya
    // corregido en Novedades/Documentos/Auditoría/Horas Especiales/Turnos en
    // 9B/9C, y en Puestos/Usuarios en 9E).
    if (!preview?.rows.length) setStatus("loading");

    // Etapa 15L.3A §15/§26: esta llamada siempre pide preview=true — nunca
    // exige cierre mensual aprobado y nunca queda auditada como una
    // exportación. El click en "Exportar"/"Reexportar" vuelve a pedirle al
    // backend el resultado definitivo, sin reutilizar estas filas.
    finnegansExportApiService
      .getPreview(period)
      .then((result) => {
        if (!mounted) return;
        setPreview(result);
        setStatus("success");
      })
      .catch(() => {
        if (!mounted) return;
        setPreview(undefined);
        setStatus("error");
      });

    return () => {
      mounted = false;
    };
  }, [period, retry]);

  useEffect(() => {
    let mounted = true;
    setHistoryStatus("loading");
    finnegansExportApiService
      .getHistory(period)
      .then((result) => {
        if (!mounted) return;
        setHistoryBatches(result.batches);
        setHistoryStatus("success");
      })
      .catch(() => {
        if (!mounted) return;
        setHistoryBatches([]);
        setHistoryStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [period, retry]);

  const rows = preview?.rows ?? [];
  const normalizedSearch = search.toLowerCase();
  const filtered = rows.filter((row) =>
    `${row.legajo} ${row.employeeName} ${row.novedad} ${row.detail}`
      .toLowerCase()
      .includes(normalizedSearch),
  );
  const exportableNovelties = filtered.filter((row) => row.source === "Novedad").length;
  const canExport = status === "success" && !!preview?.readiness.ready && rows.length > 0;
  const lastExport = preview?.lastExport ?? null;

  // Etapa 15L.4 §18/§23/§26/§31: el botón deshabilitado es sólo una ayuda
  // visual — la autoridad real es el backend. Siempre vuelve a pedir el
  // endpoint definitivo (POST, nunca la preview) con una idempotencyKey
  // nueva por intento; un 409 nunca genera archivo. useAsyncAction además
  // bloquea sincrónicamente un segundo click mientras el primero sigue en
  // vuelo (test de doble click).
  const { isRunning: exporting, run: runExport } = useAsyncAction(async (reexportReasonInput?: string) => {
    setExportError("");
    try {
      const idempotencyKey = crypto.randomUUID();
      const result = await finnegansExportApiService.exportDefinitive({
        period,
        format: "XLSX",
        reexportReason: reexportReasonInput,
        idempotencyKey,
      });
      await exportFinnegansExcel(result.rows, period);
      setReexportModalOpen(false);
      setReexportReason("");
      setRetry((value) => value + 1);
    } catch (error) {
      if (error instanceof ApiError && error.code === "FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED") {
        setExportError("El período tiene cierres pendientes para personas incluidas en la exportación.");
      } else if (error instanceof ApiError && error.code === "FINNEGANS_EXPORT_NOT_READY") {
        setExportError("Hay novedades que necesitan completar su configuración antes de exportar.");
      } else if (error instanceof ApiError && error.code === "FINNEGANS_EXPORT_REASON_REQUIRED") {
        // Backend es la autoridad final: si el período ya tenía un batch que
        // la preview todavía no reflejaba (carrera con otra exportación),
        // este código puede llegar aunque el modal no estuviera abierto —
        // se abre igual para que RRHH pueda completar el motivo.
        setExportError("Indicá un motivo para reexportar este período.");
        setReexportModalOpen(true);
      } else {
        setExportError("No pudimos generar la exportación. Intentá nuevamente.");
      }
    }
  });

  // Etapa 15L.4 §30/§31: primera exportación no pide confirmación; si ya
  // existe historial, exportar pasa a ser una reexportación explícita, con
  // motivo obligatorio pedido en un modal aparte.
  const handleExportClick = () => {
    setExportError("");
    if (lastExport) {
      setReexportReason("");
      setReexportModalOpen(true);
      return;
    }
    void runExport(undefined);
  };

  const canConfirmReexport = reexportReason.trim().length >= 5;

  if (roleLevel(user!.role) !== 1) return <Navigate to="/" />;

  return (
    <>
      <PageHeader
        eyebrow="FINNEGANS"
        title="Exportacion Finnegans"
        description="Vista mensual de novedades exportables. La app no calcula sueldos ni exporta horas especiales."
        action={
          <Button variant="subtle" icon={Download} loading={exporting} disabled={!canExport || exporting} onClick={handleExportClick}>
            {exporting ? "Generando..." : lastExport ? "Reexportar Excel Finnegans" : "Exportar Excel Finnegans"}
          </Button>
        }
      />

      {exportError && !reexportModalOpen ? <div className="form-error">{exportError}</div> : null}

      {status === "success" && preview ? <PeriodStatusBanner preview={preview} /> : null}

      <div className="stat-grid novelty-type-summary">
        <StatCard label="Registros exportables" value={filtered.length} detail="Periodo seleccionado" />
        <StatCard label="Novedades" value={exportableNovelties} detail="Con codigo Finnegans" />
        <StatCard label="Horas especiales" value={0} detail="No exportan a Finnegans" />
        <StatCard label="Legajos" value={new Set(filtered.map((row) => row.legajo)).size} detail="Formato texto" />
      </div>

      <Section title="Registros preparados para importar" subtitle="El archivo respeta el formato Finnegans. Centro de costo se incluye como columna vacia." action={<FileBarChart size={22} />}>
        <FilterPanel search={{ value: search, onChange: setSearch, placeholder: "Buscar por legajo, persona, codigo o detalle" }}>
          <label>
            Periodo
            <input
              type="month"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            />
          </label>
        </FilterPanel>

        <DataTable
          status={status === "loading" ? "loading" : status === "error" ? "error" : filtered.length === 0 ? "empty" : "ready"}
          minWidth={1220}
          emptyText="No hay registros para exportar en este periodo."
          errorMessage="No pudimos preparar la exportación. Intentá nuevamente."
          onRetry={() => setRetry((value) => value + 1)}
        >
          <table>
            <thead>
              <tr>
                <th>Origen</th>
                <th>Legajo</th>
                <th>Persona</th>
                <th>Novedad</th>
                <th>Centro de costo</th>
                <th>Valor 1</th>
                <th>Fecha Aplicacion</th>
                <th>Fecha desde</th>
                <th>Fecha hasta</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Badge tone="neutral">{row.source}</Badge>
                    <span className="table-sub">{row.detail}</span>
                  </td>
                  <td>
                    <b>{row.legajo}</b>
                  </td>
                  <td>
                    <OverflowCell value={row.employeeName} />
                  </td>
                  <td>{row.novedad || "-"}</td>
                  <td>{row.centroCosto || "-"}</td>
                  <td>{row.valor1 || "-"}</td>
                  <td>{row.fechaAplicacion}</td>
                  <td>{row.fechaDesde || "-"}</td>
                  <td>{row.fechaHasta || "-"}</td>
                  <td>
                    <Badge tone={rowStatusBadge[row.estado].tone}>{rowStatusBadge[row.estado].label}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </Section>

      <Section title="Historial de exportaciones" subtitle="Versiones definitivas ya generadas para el período seleccionado." action={<History size={22} />}>
        <ExportHistoryTimeline status={historyStatus} batches={historyBatches} />
      </Section>

      {reexportModalOpen ? (
        <Modal title="Reexportar período" subtitle="Este período ya fue exportado." close={() => setReexportModalOpen(false)} closeDisabled={exporting}>
          <div className="form-stack">
            {lastExport ? (
              <div className="info-note compact">
                <b>Última versión: {lastExport.version}</b>
                <p>{formatBatchTimestamp(lastExport.createdAt)} · {lastExport.rowCount} novedades</p>
                <p>{lastExport.sameAsCurrent ? "No se detectaron cambios respecto de la última exportación." : "Hay cambios respecto de la última exportación."}</p>
              </div>
            ) : null}
            <label>
              Motivo de reexportación
              <textarea
                value={reexportReason}
                onChange={(event) => setReexportReason(event.target.value)}
                placeholder="Ej.: se corrigió una novedad de licencia"
              />
            </label>
            {exportError ? <div className="form-error">{exportError}</div> : null}
            <div className="form-actions">
              <Button variant="subtle" onClick={() => setReexportModalOpen(false)} disabled={exporting}>Cancelar</Button>
              <Button loading={exporting} disabled={!canConfirmReexport} onClick={() => void runExport(reexportReason.trim())}>
                Confirmar reexportación
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
