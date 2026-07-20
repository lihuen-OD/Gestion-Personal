import { Link } from "react-router-dom";
import { AlertTriangle, Archive, CheckCircle2, Clock3, Eye, Plus, RefreshCcw, Search, SlidersHorizontal, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { employeeApiService, type EmployeeSummary } from "../services/api/employeeApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import type { Employee } from "../types";
import { displayLegajo, employeeCompanies } from "../utils/employee";
import { roleLevel } from "../utils/roles";
import { statusTone } from "../utils/status";
import { useDebouncedValue } from "../utils/useDebouncedValue";
import { OverflowCell } from "../components/ui/OverflowCell";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/DataTable";
import { Pagination } from "../components/ui/Pagination";

const pageSize = 25;
const emptySummary: EmployeeSummary = {
  total: 0,
  active: 0,
  inactive: 0,
  missingTimeResponsible: 0,
  pendingTimeLoads: 0,
};

export function EmployeesPage() {
  const { user } = useAuth();
  const level = roleLevel(user!.role);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [company, setCompany] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const initialList = employeeApiService.peekList({ page: 1, take: pageSize });
  const [all, setAll] = useState<Employee[]>(initialList?.items || []);
  const [listStatus, setListStatus] = useState<"loading" | "success" | "error">(initialList ? "success" : "loading");
  const [structureCompanies, setStructureCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [summary, setSummary] = useState<EmployeeSummary>(emptySummary);
  const [meta, setMeta] = useState(initialList?.meta || { total: 0, page: 1, pageSize, hasMore: false });
  const selectedCompanyId = structureCompanies.find((item) => item.name === company)?.id;

  useEffect(() => {
    let mounted = true;
    if (!all.length) setListStatus("loading");
    employeeApiService
      .list({ search: debouncedSearch, companyId: selectedCompanyId, page, take: pageSize })
      .then((result) => {
        if (!mounted) return;
        setAll(result.items);
        setMeta(result.meta);
        setListStatus("success");
      })
      .catch(() => {
        if (!mounted) return;
        setAll([]);
        setMeta({ total: 0, page, pageSize, hasMore: false });
        setListStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [debouncedSearch, page, refresh, selectedCompanyId]);

  useEffect(() => {
    let mounted = true;
    employeeApiService
      .getSummary()
      .then((result) => {
        if (mounted) setSummary(result);
      })
      .catch(() => {
        if (!mounted) return;
        setSummary(emptySummary);
      });
    return () => {
      mounted = false;
    };
  }, [refresh]);

  useEffect(() => {
    let mounted = true;
    orgStructureApiService
      .getCatalog()
      .then((catalog) => {
        if (mounted) setStructureCompanies(catalog.companies.filter((item) => item.status === "ACTIVO").map((item) => ({ id: item.id, name: item.name })));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const companyOptions = Array.from(new Set([...structureCompanies.map((item) => item.name), ...all.flatMap((employee) => employeeCompanies(employee))])).filter(Boolean);
  const employees = all;

  const syncLaborStatuses = async () => {
    setSyncing(true);
    setSyncMessage("");
    try {
      const result = await employeeApiService.syncLaborStatuses();
      setSyncMessage(`Estados sincronizados: ${result.updated} actualizados sobre ${result.scanned} revisados.`);
      setRefresh((value) => value + 1);
    } catch (error) {
      setSyncMessage("No se pudo sincronizar desde backend. Verifica que la API este levantada.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="BASE MAESTRA DE PERSONAS"
        title={level === 2 ? "Legajos de mi area" : "Legajos"}
        description="Busca, consulta y gestiona la informacion integral de cada colaborador."
        action={
          level === 1 ? (
            <div className="form-actions inline-actions">
              <Button variant="subtle" icon={RefreshCcw} onClick={syncLaborStatuses} disabled={syncing}>
                {syncing ? "Sincronizando..." : "Sincronizar estados"}
              </Button>
              <Link to="/legajos/nuevo" className="button primary">
                <Plus size={17} /> Nuevo legajo
              </Link>
            </div>
          ) : undefined
        }
      />
      {syncMessage ? <div className="info-note compact">{syncMessage}</div> : null}

      <div className="stat-grid five">
        <StatCard label="Total legajos" value={summary.total} icon={Users} />
        <StatCard label="Activos" value={summary.active} icon={CheckCircle2} tone="green" />
        <StatCard label="Inactivos" value={summary.inactive} icon={Archive} tone="red" />
        <StatCard label="Sin responsable" value={summary.missingTimeResponsible} icon={AlertTriangle} tone="orange" />
        <StatCard label="Carga pendiente" value={summary.pendingTimeLoads} icon={Clock3} tone="purple" />
      </div>

      <Section
        title="Listado de legajos"
        subtitle={`${meta.total} resultados`}
        action={<Button variant="subtle" icon={SlidersHorizontal}>Mas filtros</Button>}
      >
        <div className="filters">
          <label className="search-field">
            <Search size={17} />
            <input
              placeholder="Buscar por legajo, DNI, CUIL, apellido o nombre"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            value={company}
            onChange={(event) => {
              setCompany(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas las empresas</option>
            {companyOptions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>

        <DataTable
          status={listStatus === "loading" ? "loading" : listStatus === "error" ? "error" : employees.length === 0 ? "empty" : "ready"}
          minWidth={980}
          emptyText="No se encontraron legajos con los filtros aplicados."
          errorMessage="No se pudieron cargar los legajos. Intentá nuevamente."
          onRetry={() => setRefresh((value) => value + 1)}
        >
          <table>
            <thead>
              <tr>
                <th>Legajo</th>
                <th>CUIL</th>
                <th>Apellido</th>
                <th>Nombre</th>
                <th>Centro de costo</th>
                <th>Estado</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td>
                    <b>{displayLegajo(employee)}</b>
                  </td>
                  <td>{employee.cuil}</td>
                  <td>{employee.lastName}</td>
                  <td>{employee.firstName}</td>
                  <td>
                    <OverflowCell value={employee.costCenter} />
                  </td>
                  <td>
                    <Badge tone={statusTone(employee.status)}>{employee.status}</Badge>
                  </td>
                  <td>
                    <Link
                      className="table-link table-icon-action"
                      title="Ver detalle"
                      aria-label="Ver detalle"
                      to={`/legajos/${employee.id}`}
                    >
                      <Eye size={14} />
                      <span>Ver detalle</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>

        {listStatus === "success" && employees.length > 0 && (
          <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} hasMore={meta.hasMore} onPageChange={setPage} itemLabel="legajos" />
        )}
      </Section>
    </>
  );
}
