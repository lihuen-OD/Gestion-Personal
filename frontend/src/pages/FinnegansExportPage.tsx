import { useEffect, useState } from "react";
import { Download, FileBarChart, Search } from "lucide-react";
import * as XLSX from "xlsx";
import { OverflowCell } from "../components/ui/OverflowCell";
import { TableShell } from "../components/ui/TableShell";
import { finnegansExportApiService, type FinnegansExportRow } from "../services/api/finnegansExportApiService";
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

function exportFinnegansExcel(rows: FinnegansExportRow[], period: string) {
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

export function FinnegansExportPage() {
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<FinnegansExportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setLoadError("");

    finnegansExportApiService
      .getNoveltyRows(period)
      .then((items) => {
        if (!mounted) return;
        setRows(items);
      })
      .catch(() => {
        if (!mounted) return;
        setRows([]);
        setLoadError("No se pudo cargar la exportacion desde backend. Verifica que la API este levantada.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [period]);

  const normalizedSearch = search.toLowerCase();
  const filtered = rows.filter((row) =>
    `${row.legajo} ${row.employeeName} ${row.novedad} ${row.detail}`
      .toLowerCase()
      .includes(normalizedSearch),
  );
  const exportableNovelties = filtered.filter((row) => row.source === "Novedad").length;
  const canExport = filtered.length > 0;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">FINNEGANS</p>
          <h1>Exportacion Finnegans</h1>
          <p>
            Vista mensual de novedades exportables. La app no calcula sueldos ni
            exporta horas especiales.
          </p>
        </div>
        <button
          className="button subtle"
          type="button"
          disabled={!canExport}
          onClick={() => exportFinnegansExcel(filtered, period)}
        >
          <Download size={16} /> Exportar Excel Finnegans
        </button>
      </div>

      <div className="stat-grid novelty-type-summary">
        <div className="stat-card">
          <div>
            <small>Registros exportables</small>
            <strong>{filtered.length}</strong>
            <span>Periodo seleccionado</span>
          </div>
        </div>
        <div className="stat-card">
          <div>
            <small>Novedades</small>
            <strong>{exportableNovelties}</strong>
            <span>Con codigo Finnegans</span>
          </div>
        </div>
        <div className="stat-card">
          <div>
            <small>Horas especiales</small>
            <strong>0</strong>
            <span>No exportan a Finnegans</span>
          </div>
        </div>
        <div className="stat-card">
          <div>
            <small>Legajos</small>
            <strong>{new Set(filtered.map((row) => row.legajo)).size}</strong>
            <span>Formato texto</span>
          </div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Registros preparados para importar</h3>
            <p>
              El archivo respeta el formato Finnegans. Centro de costo se incluye
              como columna vacia.
            </p>
          </div>
          <FileBarChart size={22} />
        </div>
        <div className="panel-body">
          <div className="filters catalog-filters">
            <label>
              Periodo
              <input
                type="month"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
              />
            </label>
            <label className="search-field">
              <Search size={17} />
              <input
                placeholder="Buscar por legajo, persona, codigo o detalle"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          {loadError ? <p className="form-error">{loadError}</p> : null}

          {loading ? (
            <div className="empty">Cargando registros exportables...</div>
          ) : filtered.length ? (
            <TableShell minWidth={1120}>
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
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className="badge neutral">{row.source}</span>
                        <span className="table-sub">{row.detail}</span>
                      </td>
                      <td>
                        <b>{row.legajo}</b>
                      </td>
                      <td>
                        <OverflowCell value={row.employeeName} />
                      </td>
                      <td>{row.novedad}</td>
                      <td>{row.centroCosto || "-"}</td>
                      <td>{row.valor1}</td>
                      <td>{row.fechaAplicacion}</td>
                      <td>{row.fechaDesde || "-"}</td>
                      <td>{row.fechaHasta || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          ) : (
            <div className="empty">No hay registros para exportar en este periodo.</div>
          )}
        </div>
      </section>
    </>
  );
}
