import { useEffect, useMemo, useState } from "react";
import { FileBarChart } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { employeeApiService, orgChartReachedLimit } from "../services/api/employeeApiService";
import { organizationChartMockService } from "../services/organizationChartMockService";
import { demoMode } from "../config/runtimeMode";
import type { Employee, Role } from "../types";
import type { OrgChartFilters } from "../types/organizationChart.types";
import { CategoryOrgChart } from "../components/organigramas/CategoryOrgChart";
import { FunctionalOrgChart } from "../components/organigramas/FunctionalOrgChart";
import { OrganigramFilters } from "../components/organigramas/OrganigramFilters";
import { OrgChartTabs, type OrgChartTab } from "../components/organigramas/OrgChartTabs";
import { EmployeeStructureFilterControls } from "../components/employees/structureFilters/EmployeeStructureFilterControls";
import { emptyStructureFilters, hasStructureFilters, isReloadPending, structureFilterParams, type EmployeeStructureFilterValue } from "../components/employees/structureFilters/employeeStructureFilters";
import { useOrgStructureCatalog } from "../components/employees/structureFilters/useOrgStructureCatalog";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";

const roleLevel = (role: Role) => role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3;
const emptyFilters = (): OrgChartFilters => organizationChartMockService.getEmptyFilters();

// A7: la exportación separa empresa empleadora, alcance del puesto,
// ubicaciones vigentes y el estado de recarga (M2 retiró el sector del legajo).
async function exportOrganigramWorkbook(employees: Employee[], tab: OrgChartTab) {
  const XLSX = await import("xlsx");
  const headers = ["Legajo", "CUIL", "Apellido", "Nombre", "Empresa empleadora", "Puesto", "Alcance del puesto", "Ubicaciones vigentes", "Categoria", "Encargado directo", "Responsable carga", "Centro de costo", "Estado", "Recarga"];
  const rows = employees.map((employee) => [
    employee.legajoInterno || employee.legajo,
    employee.cuil,
    employee.lastName,
    employee.firstName,
    employee.companies?.length ? employee.companies.join(", ") : employee.company,
    employee.puestoNombre || employee.position,
    employee.positionScopes?.map((scope) => scope.name).join(", ") || "",
    employee.currentWorkLocations?.map((location) => `${location.zoneName}: ${location.establishments.join(", ")}`).join(" | ") || "",
    employee.internalCategory || employee.receiptCategory,
    employee.directManagers?.length ? employee.directManagers.join(", ") : employee.directManager,
    employee.timeResponsibles?.length ? employee.timeResponsibles.join(", ") : employee.timeResponsible,
    employee.costCenter,
    employee.status,
    isReloadPending(employee) ? "Pendiente" : isReloadPending(employee) === false ? "Completa" : "",
  ]);
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet["!cols"] = [
    { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 28 }, { wch: 28 }, { wch: 34 }, { wch: 40 },
    { wch: 18 }, { wch: 26 }, { wch: 26 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Organigrama");
  XLSX.writeFile(workbook, `organigrama_${tab.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true });
}

export function OrganigramasPage() {
  const { user } = useAuth();
  const level = roleLevel(user!.role);
  const [tab, setTab] = useState<OrgChartTab>("CATEGORIES");
  const [filters, setFilters] = useState<OrgChartFilters>(emptyFilters);
  const [structure, setStructure] = useState<EmployeeStructureFilterValue>(emptyStructureFilters);
  const structureParams = useMemo(() => structureFilterParams(structure), [structure]);
  const catalog = useOrgStructureCatalog();
  const [toast, setToast] = useState("");
  const [sourceEmployees, setSourceEmployees] = useState<Employee[]>([]);
  const [managerContext, setManagerContext] = useState<Employee[]>([]);
  const [usesBackend, setUsesBackend] = useState(false);
  const [reachedEmployeeLimit, setReachedEmployeeLimit] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let mounted = true;
    setLoadStatus("loading");
    setLoadError("");
    employeeApiService
      .getOrgChart(structureParams)
      .then((result) => {
        if (!mounted) return;
        setSourceEmployees(result.items);
        setManagerContext(result.contextItems ?? []);
        setReachedEmployeeLimit(orgChartReachedLimit(result));
        setUsesBackend(true);
        setLoadStatus("success");
      })
      .catch(() => {
        // El respaldo sin filtros de estructura sólo aplica cuando no hay
        // ninguno pedido: nunca se muestran resultados sin filtrar como si
        // estuvieran filtrados.
        if (Object.keys(structureParams).length) {
          if (!mounted) return;
          setSourceEmployees([]);
          setManagerContext([]);
          setLoadError("No pudimos aplicar los filtros de alcance o ubicación. Intentá nuevamente.");
          setLoadStatus("error");
          return;
        }
        employeeApiService
          .getAll()
          .then((employees) => {
            if (!mounted) return;
            setSourceEmployees(employees);
            setReachedEmployeeLimit(false);
            setUsesBackend(true);
            setLoadStatus("success");
          })
          .catch(async () => {
            if (!mounted) return;
            if (demoMode) {
              const { employeeMockService } = await import("../services/employeeMockService");
              setSourceEmployees(employeeMockService.getAll());
              setReachedEmployeeLimit(false);
              setUsesBackend(false);
              setLoadStatus("success");
              return;
            }
            setSourceEmployees([]);
            setReachedEmployeeLimit(false);
            setLoadError("No pudimos cargar el organigrama. Intentá nuevamente en unos minutos.");
            setLoadStatus("error");
          });
      });
    return () => {
      mounted = false;
    };
  }, [user, retry, structureParams]);

  const options = useMemo(() => organizationChartMockService.getFilterOptionsFrom(sourceEmployees), [sourceEmployees]);
  const categories = useMemo(() => organizationChartMockService.getCategories(), []);
  const employees = useMemo(() => organizationChartMockService.getEmployeesFrom(sourceEmployees, filters), [filters, sourceEmployees]);
  const functionalEmployees = useMemo(() => [...employees, ...managerContext.filter((manager) => !employees.some((employee) => employee.id === manager.id))], [employees, managerContext]);
  const model = useMemo(() => organizationChartMockService.buildCategoryModel(employees, categories), [categories, employees]);
  const exportView = () => {
    exportOrganigramWorkbook(employees, tab);
    setToast(`Se exportaron ${employees.length} personas visibles del organigrama.`);
    setTimeout(() => setToast(""), 2500);
  };
  const clearFilters = () => { setFilters(emptyFilters()); setStructure(emptyStructureFilters); };
  const filterControls = <OrganigramFilters filters={filters} options={options} onChange={setFilters} onClear={clearFilters} structure={<EmployeeStructureFilterControls value={structure} catalog={catalog} onChange={setStructure} />} />;

  if (level === 3) return <><PageHeader eyebrow="ACCESO RESTRINGIDO" title="Organigramas" description="Tu perfil de carga horaria no tiene acceso al módulo de estructura organizacional." /></>;

  return <><PageHeader eyebrow="ESTRUCTURA ORGANIZACIONAL" title="Organigramas" description={loadError && !sourceEmployees.length && loadStatus === "error" ? "La información no está disponible temporalmente." : usesBackend ? "Relaciones por encargado directo, con el alcance del puesto y las ubicaciones vigentes como contexto. La categoría salarial ordena la vista, no define la jerarquía." : "Visualización alimentada desde Legajos en modo demostración."} action={<Button variant="subtle" icon={FileBarChart} onClick={exportView} disabled={loadStatus !== "success"}>Exportar vista</Button>} />
    <OrgChartTabs active={tab} onChange={setTab} />
    {filterControls}
    {loadStatus === "loading" ? <LoadingState text="Cargando organigrama..." /> : null}
    {loadStatus === "error" ? <ErrorState message={loadError} onRetry={() => setRetry((value) => value + 1)} /> : null}
    {loadStatus === "success" && reachedEmployeeLimit ? <div className="info-note compact">Se alcanzó el límite de 1000 empleados. El organigrama puede estar incompleto.</div> : null}
    {loadStatus === "success" && hasStructureFilters(structure) ? <div className="info-note compact">Filtro de alcance o ubicación activo: los encargados externos visibles por tus permisos se muestran sólo como contexto y no se cuentan como resultados.</div> : null}
    {toast && <div className="toast">{toast}</div>}
    {loadStatus === "success" ? <>
    {tab === "CATEGORIES" ? <CategoryOrgChart model={model} onExport={exportView} filterControls={filterControls} /> : <FunctionalOrgChart employees={functionalEmployees} onExport={exportView} />}</> : null}
  </>;
}
