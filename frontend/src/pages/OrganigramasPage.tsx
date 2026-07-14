import { useEffect, useMemo, useState } from "react";
import { FileBarChart } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { employeeApiService } from "../services/api/employeeApiService";
import { organizationChartMockService } from "../services/organizationChartMockService";
import { demoMode } from "../config/runtimeMode";
import type { Employee, Role } from "../types";
import type { OrgChartFilters } from "../types/organizationChart.types";
import { CategoryOrgChart } from "../components/organigramas/CategoryOrgChart";
import { FunctionalOrgChart } from "../components/organigramas/FunctionalOrgChart";
import { OrganigramFilters } from "../components/organigramas/OrganigramFilters";
import { OrgChartTabs, type OrgChartTab } from "../components/organigramas/OrgChartTabs";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";

const roleLevel = (role: Role) => role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3;

async function exportOrganigramWorkbook(employees: Employee[], tab: OrgChartTab) {
  const XLSX = await import("xlsx");
  const headers = ["Legajo", "CUIL", "Apellido", "Nombre", "Empresa", "Puesto", "Categoria", "Encargado directo", "Responsable carga", "Sector", "Centro de costo", "Estado"];
  const rows = employees.map((employee) => [
    employee.legajoInterno || employee.legajo,
    employee.cuil,
    employee.lastName,
    employee.firstName,
    employee.companies?.length ? employee.companies.join(", ") : employee.company,
    employee.puestoNombre || employee.position,
    employee.internalCategory || employee.receiptCategory,
    employee.directManagers?.length ? employee.directManagers.join(", ") : employee.directManager,
    employee.timeResponsibles?.length ? employee.timeResponsibles.join(", ") : employee.timeResponsible,
    employee.sector,
    employee.costCenter,
    employee.status,
  ]);
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet["!cols"] = [
    { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 28 }, { wch: 28 },
    { wch: 18 }, { wch: 26 }, { wch: 26 }, { wch: 22 }, { wch: 18 }, { wch: 12 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Organigrama");
  XLSX.writeFile(workbook, `organigrama_${tab.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true });
}

export function OrganigramasPage() {
  const { user } = useAuth();
  const level = roleLevel(user!.role);
  const [tab, setTab] = useState<OrgChartTab>("CATEGORIES");
  const [filters, setFilters] = useState<OrgChartFilters>({ company: "", businessUnit: "", establishment: "", costCenter: "", sector: "", position: "", internalCategory: "", receiptCategory: "", status: "", directManager: "", timeResponsible: "", search: "" });
  const [toast, setToast] = useState("");
  const [sourceEmployees, setSourceEmployees] = useState<Employee[]>([]);
  const [usesBackend, setUsesBackend] = useState(false);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let mounted = true;
    employeeApiService
      .getOrgChart()
      .then((employees) => {
        if (!mounted) return;
        setSourceEmployees(employees);
        setUsesBackend(true);
      })
      .catch(() => {
        employeeApiService
          .getAll()
          .then((employees) => {
            if (!mounted) return;
            setSourceEmployees(employees);
            setUsesBackend(true);
          })
          .catch(async () => {
            if (!mounted) return;
            if (demoMode) {
              const { employeeMockService } = await import("../services/employeeMockService");
              setSourceEmployees(employeeMockService.getAll());
              setUsesBackend(false);
              return;
            }
            setSourceEmployees([]);
            setLoadError("No se pudo cargar el organigrama desde el backend. Reintentá cuando la API esté disponible.");
          });
      });
    return () => {
      mounted = false;
    };
  }, [user]);

  const options = useMemo(
    () => organizationChartMockService.getFilterOptionsFrom(sourceEmployees, user!.role, user!.sector),
    [sourceEmployees, user],
  );
  const categories = useMemo(() => organizationChartMockService.getCategories(), []);
  const employees = organizationChartMockService.getEmployeesFrom(sourceEmployees, user!.role, user!.sector, filters);
  const model = organizationChartMockService.buildCategoryModel(employees, categories);
  const exportView = () => {
    exportOrganigramWorkbook(employees, tab);
    setToast(`Se exportaron ${employees.length} personas visibles del organigrama.`);
    setTimeout(() => setToast(""), 2500);
  };
  const filterControls = <OrganigramFilters filters={filters} options={options} onChange={setFilters} onClear={() => setFilters({ company: "", businessUnit: "", establishment: "", costCenter: "", sector: "", position: "", internalCategory: "", receiptCategory: "", status: "", directManager: "", timeResponsible: "", search: "" })} />;

  if (level === 3) return <><PageHeader eyebrow="ACCESO RESTRINGIDO" title="Organigramas" description="Tu perfil de carga horaria no tiene acceso al módulo de estructura organizacional." /></>;

  return <><PageHeader eyebrow="ESTRUCTURA ORGANIZACIONAL" title="Organigramas" description={loadError ? "No hay datos disponibles hasta restablecer la conexión con la API." : usesBackend ? "Visualización alimentada desde legajos reales: categoría interna, encargado directo, sector, centro de costo y estado." : "Visualización alimentada desde Legajos en modo demo local."} action={<Button variant="subtle" icon={FileBarChart} onClick={exportView} disabled={Boolean(loadError)}>Exportar vista</Button>} />
    {loadError ? <div className="form-error">{loadError}</div> : null}
    {toast && <div className="toast">{toast}</div>}
    <OrgChartTabs active={tab} onChange={setTab} />
    {filterControls}
    {tab === "CATEGORIES" ? <CategoryOrgChart model={model} onExport={exportView} filterControls={filterControls} /> : <FunctionalOrgChart employees={employees} onExport={exportView} />}
  </>;
}
