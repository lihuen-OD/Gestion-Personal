import { useMemo, useState } from "react";
import { Download, FileBarChart, Search } from "lucide-react";
import * as XLSX from "xlsx";
import { OverflowCell } from "../components/ui/OverflowCell";
import { TableShell } from "../components/ui/TableShell";
import { employeeMockService } from "../services/employeeMockService";
import { noveltyMockService } from "../services/noveltyMockService";
import { noveltyTypeMockService } from "../services/noveltyTypeMockService";
import type { Employee, Novelty } from "../types";

type ExportRow = {
  id: string;
  source: "Novedad";
  employee: Employee | undefined;
  legajo: string;
  novedad: string;
  centroCosto: "";
  valor1: string;
  fechaAplicacion: string;
  fechaDesde: string;
  fechaHasta: string;
  detail: string;
};

const exportHeaders = ["Legajo", "Novedad", "Centro de costo", "Valor 1", "Fecha Aplicacion", "Fecha desde", "Fecha hasta"];

const displayLegajo = (employee?: Employee) => employee ? (employee.legajoInterno || employee.legajoFinnegans || employee.legajo || "Sin cargar") : "Sin cargar";
const fullName = (employee?: Employee) => employee ? `${employee.lastName}, ${employee.firstName}` : "-";

function formatDateForFinnegans(value?: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function normalizeExportValue(value: unknown) {
  return String(value || "1").replace(" h", "").replace(" dias", "").replace(" días", "").trim();
}

function noveltyFinnegansData(novelty: Novelty) {
  const type = novelty.noveltyTypeId ? noveltyTypeMockService.getById(novelty.noveltyTypeId) : noveltyTypeMockService.getByName(novelty.type);
  const link = type?.finnegansLinks.find((item) => item.status === "ACTIVO");
  const exportsToFinnegans = Boolean(novelty.exportsToFinnegans ?? type?.rules.exportsToFinnegans);
  const code = novelty.finnegansCode || link?.code || "";
  const hasValidity = Boolean(novelty.hasValidity ?? link?.hasValidity ?? type?.rules.hasValidity);
  return { exportsToFinnegans, code, hasValidity };
}

function buildNoveltyRow(novelty: Novelty, employee: Employee | undefined): ExportRow | null {
  if (novelty.status === "Rechazado" || novelty.status === "Pendiente") return null;
  const finnegans = noveltyFinnegansData(novelty);
  if (!finnegans.exportsToFinnegans || !finnegans.code) return null;

  return {
    id: `nov-${novelty.id}`,
    source: "Novedad",
    employee,
    legajo: displayLegajo(employee),
    novedad: finnegans.code,
    centroCosto: "",
    valor1: normalizeExportValue(novelty.valor1 || novelty.hoursImpact || novelty.quantity),
    fechaAplicacion: formatDateForFinnegans(novelty.fechaAplicacion || novelty.from),
    fechaDesde: finnegans.hasValidity ? formatDateForFinnegans(novelty.from) : "",
    fechaHasta: finnegans.hasValidity ? formatDateForFinnegans(novelty.to || novelty.from) : "",
    detail: novelty.type,
  };
}

function exportFinnegansExcel(rows: ExportRow[], period: string) {
  const sheetRows = [
    exportHeaders,
    ...rows.map((row) => [row.legajo, row.novedad, row.centroCosto, row.valor1, row.fechaAplicacion, row.fechaDesde, row.fechaHasta]),
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
  XLSX.writeFile(workbook, `finnegans_novedades_${period}.xlsx`, { compression: true });
}

export function FinnegansExportPage() {
  const [period, setPeriod] = useState("2026-06");
  const [search, setSearch] = useState("");
  const employees = employeeMockService.getAll();
  const rows = useMemo(() => {
    const employeesById = new Map(employees.map((employee) => [employee.id, employee]));
    return noveltyMockService.getAll()
      .filter((novelty) => novelty.from.startsWith(period) || (novelty.to || novelty.from).startsWith(period))
      .map((novelty) => buildNoveltyRow(novelty, employeesById.get(novelty.employeeId)))
      .filter(Boolean) as ExportRow[];
  }, [employees, period]);
  const filtered = rows.filter((row) => `${row.legajo} ${fullName(row.employee)} ${row.novedad} ${row.detail}`.toLowerCase().includes(search.toLowerCase()));
  const exportableNovelties = filtered.filter((row) => row.source === "Novedad").length;
  const canExport = filtered.length > 0;

  return <>
    <div className="page-header">
      <div>
        <p className="eyebrow">FINNEGANS</p>
        <h1>Exportacion Finnegans</h1>
        <p>Vista mensual de novedades exportables. La app no calcula sueldos ni exporta horas especiales.</p>
      </div>
      <button className="button subtle" type="button" disabled={!canExport} onClick={() => exportFinnegansExcel(filtered, period)}>
        <Download size={16} /> Exportar Excel Finnegans
      </button>
    </div>
    <div className="stat-grid novelty-type-summary">
      <div className="stat-card"><div><small>Registros exportables</small><strong>{filtered.length}</strong><span>Periodo seleccionado</span></div></div>
      <div className="stat-card"><div><small>Novedades</small><strong>{exportableNovelties}</strong><span>Con codigo Finnegans</span></div></div>
      <div className="stat-card"><div><small>Horas especiales</small><strong>0</strong><span>No exportan a Finnegans</span></div></div>
      <div className="stat-card"><div><small>Legajos</small><strong>{new Set(filtered.map((row) => row.legajo)).size}</strong><span>Formato texto</span></div></div>
    </div>
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Registros preparados para importar</h3>
          <p>El archivo respeta el formato Finnegans. Centro de costo se incluye como columna vacia.</p>
        </div>
        <FileBarChart size={22} />
      </div>
      <div className="panel-body">
        <div className="filters catalog-filters">
          <label>Periodo<input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
          <label className="search-field"><Search size={17} /><input placeholder="Buscar por legajo, persona, codigo o detalle" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>
        {filtered.length ? <TableShell minWidth={1120}><table>
          <thead><tr><th>Origen</th><th>Legajo</th><th>Persona</th><th>Novedad</th><th>Centro de costo</th><th>Valor 1</th><th>Fecha Aplicacion</th><th>Fecha desde</th><th>Fecha hasta</th></tr></thead>
          <tbody>{filtered.map((row) => <tr key={row.id}><td><span className="badge neutral">{row.source}</span><span className="table-sub">{row.detail}</span></td><td><b>{row.legajo}</b></td><td><OverflowCell value={fullName(row.employee)} /></td><td>{row.novedad}</td><td>{row.centroCosto || "-"}</td><td>{row.valor1}</td><td>{row.fechaAplicacion}</td><td>{row.fechaDesde || "-"}</td><td>{row.fechaHasta || "-"}</td></tr>)}</tbody>
        </table></TableShell> : <div className="empty">No hay registros para exportar en este periodo.</div>}
      </div>
    </section>
  </>;
}
