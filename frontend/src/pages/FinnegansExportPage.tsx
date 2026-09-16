import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Download, FileBarChart } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { roleLevel } from "../utils/roles";
import { OverflowCell } from "../components/ui/OverflowCell";
import { FilterPanel } from "../components/ui/FilterPanel";
import { DataTable } from "../components/ui/DataTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { StatCard } from "../components/ui/StatCard";
import { ApiError } from "../services/api/apiClient";
import {
  finnegansExportApiService,
  type FinnegansExportRow,
  type FinnegansReadinessSummary,
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

// Etapa 15L.3A §26: sólo se llama con el resultado de getDefinitive() — nunca
// con las filas de preview ni con el subconjunto filtrado por búsqueda en
// pantalla, para que el archivo generado sea siempre exactamente lo que el
// backend autorizó.
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

// Etapa 15L.3A §17/§29: mismo dato (readiness) que decide si el botón
// "Exportar" está habilitado, mostrado en formato legible para RRHH — sin
// ningún id técnico, sólo lo que backend ya devolvió como texto humano.
function ReadinessBanner({ readiness }: { readiness: FinnegansReadinessSummary }) {
  if (!readiness.totalRows) {
    return <div className="info-note">No hay novedades exportables en este período.</div>;
  }
  if (readiness.ready) {
    return (
      <div className="info-note readiness-ready">
        <b>✓ Listo para exportar</b>
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
    </div>
  );
}

export function FinnegansExportPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<FinnegansExportRow[]>([]);
  const [readiness, setReadiness] = useState<FinnegansReadinessSummary | undefined>();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    let mounted = true;
    // Etapa 9G: sólo mostrar el loading grande cuando todavía no hay filas
    // en pantalla — a diferencia de Dashboard/Reportes (sin ningún filtro
    // interactivo, sólo reintento tras error), esta pantalla sí tiene un
    // selector de período en vivo que antes blanqueaba la tabla de vista
    // previa en cada cambio, con datos ya cargados (mismo patrón ya
    // corregido en Novedades/Documentos/Auditoría/Horas Especiales/Turnos en
    // 9B/9C, y en Puestos/Usuarios en 9E).
    if (!rows.length) setStatus("loading");

    // Etapa 15L.3A §15/§26: esta llamada siempre pide preview=true — nunca
    // exige cierre mensual aprobado y nunca queda auditada como una
    // exportación. El click en "Exportar Excel" vuelve a pedirle al backend
    // el resultado definitivo, sin reutilizar estas filas.
    finnegansExportApiService
      .getPreview(period)
      .then((result) => {
        if (!mounted) return;
        setRows(result.rows);
        setReadiness(result.readiness);
        setStatus("success");
      })
      .catch(() => {
        if (!mounted) return;
        setRows([]);
        setReadiness(undefined);
        setStatus("error");
      });

    return () => {
      mounted = false;
    };
  }, [period, retry]);

  const normalizedSearch = search.toLowerCase();
  const filtered = rows.filter((row) =>
    `${row.legajo} ${row.employeeName} ${row.novedad} ${row.detail}`
      .toLowerCase()
      .includes(normalizedSearch),
  );
  const exportableNovelties = filtered.filter((row) => row.source === "Novedad").length;
  const canExport = status === "success" && !!readiness?.ready && rows.length > 0;

  // Etapa 15L.3A §18/§26/§31: el botón deshabilitado es sólo una ayuda
  // visual — la autoridad real es el backend. Este handler siempre vuelve a
  // pedir el endpoint definitivo (sin preview=true) y sólo genera el .xlsx
  // si esa respuesta es exitosa; un 409 nunca genera archivo.
  const handleExport = async () => {
    setExportError("");
    setExporting(true);
    try {
      const result = await finnegansExportApiService.getDefinitive(period);
      await exportFinnegansExcel(result.rows, period);
    } catch (error) {
      if (error instanceof ApiError && error.code === "FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED") {
        setExportError("El período tiene cierres pendientes para personas incluidas en la exportación.");
      } else if (error instanceof ApiError && error.code === "FINNEGANS_EXPORT_NOT_READY") {
        setExportError("Hay novedades que necesitan completar su configuración antes de exportar.");
      } else {
        setExportError("No pudimos generar la exportación. Intentá nuevamente.");
      }
    } finally {
      setExporting(false);
    }
  };

  if (roleLevel(user!.role) !== 1) return <Navigate to="/" />;

  return (
    <>
      <PageHeader
        eyebrow="FINNEGANS"
        title="Exportacion Finnegans"
        description="Vista mensual de novedades exportables. La app no calcula sueldos ni exporta horas especiales."
        action={
          <Button variant="subtle" icon={Download} loading={exporting} disabled={!canExport} onClick={handleExport}>
            {exporting ? "Generando..." : "Exportar Excel Finnegans"}
          </Button>
        }
      />

      {exportError ? <div className="form-error">{exportError}</div> : null}

      {status === "success" && readiness ? <ReadinessBanner readiness={readiness} /> : null}

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
    </>
  );
}
