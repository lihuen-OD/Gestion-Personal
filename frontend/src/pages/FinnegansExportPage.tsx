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

export function FinnegansExportPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<FinnegansExportRow[]>([]);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let mounted = true;
    setStatus("loading");

    finnegansExportApiService
      .getNoveltyRows(period)
      .then((items) => {
        if (!mounted) return;
        setRows(items);
        setStatus("success");
      })
      .catch(() => {
        if (!mounted) return;
        setRows([]);
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
  const canExport = filtered.length > 0;

  if (roleLevel(user!.role) !== 1) return <Navigate to="/" />;

  return (
    <>
      <PageHeader
        eyebrow="FINNEGANS"
        title="Exportacion Finnegans"
        description="Vista mensual de novedades exportables. La app no calcula sueldos ni exporta horas especiales."
        action={<Button variant="subtle" icon={Download} disabled={!canExport} onClick={() => exportFinnegansExcel(filtered, period)}>Exportar Excel Finnegans</Button>}
      />

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
          minWidth={1120}
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
        </DataTable>
      </Section>
    </>
  );
}
