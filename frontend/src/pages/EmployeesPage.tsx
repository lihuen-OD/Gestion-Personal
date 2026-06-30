import { Link } from "react-router-dom";
import { AlertTriangle, Archive, CheckCircle2, Clock3, Eye, Plus, RefreshCcw, Search, SlidersHorizontal, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { employeeApiService } from "../services/api/employeeApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { timeEntryApiService } from "../services/api/timeEntryApiService";
import { calculateEmployeeStatus } from "../services/employeeStatusService";
import type { Employee } from "../types";
import { displayLegajo, employeeCompanies } from "../utils/employee";
import { roleLevel } from "../utils/roles";
import { statusClass } from "../utils/status";
import { OverflowCell } from "../components/ui/OverflowCell";
import { TableShell } from "../components/ui/TableShell";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";

const pendingTimeStatuses = new Set(["Pendiente", "En revision", "En revisión"]);

export function EmployeesPage() {
  const { user } = useAuth();
  const level = roleLevel(user!.role);
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [all, setAll] = useState<Employee[]>([]);
  const [structureCompanies, setStructureCompanies] = useState<string[]>([]);
  const [pendingTimeLoads, setPendingTimeLoads] = useState(0);

  useEffect(() => {
    let mounted = true;
    employeeApiService
      .getAll()
      .then((items) => {
        if (mounted) setAll(items);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [refresh]);

  useEffect(() => {
    let mounted = true;
    timeEntryApiService
      .getAll({ take: 1000 })
      .then((entries) => {
        if (!mounted) return;
        setPendingTimeLoads(new Set(entries.filter((entry) => pendingTimeStatuses.has(entry.status)).map((entry) => entry.employeeId)).size);
      })
      .catch(() => {
        if (!mounted) return;
        setPendingTimeLoads(0);
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
        if (mounted) setStructureCompanies(catalog.companies.filter((item) => item.status === "ACTIVO").map((item) => item.name));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const companyOptions = Array.from(new Set([...structureCompanies, ...all.flatMap((employee) => employeeCompanies(employee))])).filter(Boolean);
  const employees = all.filter(
    (employee) =>
      (level !== 2 || employee.sector === user!.sector) &&
      (!company || employeeCompanies(employee).includes(company)) &&
      `${displayLegajo(employee)} ${employee.legajoFinnegans} ${employee.dni} ${employee.cuil} ${employee.lastName} ${employee.firstName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

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
              <button className="button subtle" type="button" onClick={syncLaborStatuses} disabled={syncing}>
                <RefreshCcw size={16} /> {syncing ? "Sincronizando..." : "Sincronizar estados"}
              </button>
              <Link to="/legajos/nuevo" className="button primary">
                <Plus size={17} /> Nuevo legajo
              </Link>
            </div>
          ) : undefined
        }
      />
      {syncMessage ? <div className="info-note compact">{syncMessage}</div> : null}

      <div className="stat-grid five">
        <StatCard label="Total legajos" value={all.length} icon={Users} />
        <StatCard
          label="Activos"
          value={all.filter((employee) => calculateEmployeeStatus(employee) === "Activo").length}
          icon={CheckCircle2}
          tone="green"
        />
        <StatCard
          label="Inactivos"
          value={all.filter((employee) => calculateEmployeeStatus(employee) === "Inactivo").length}
          icon={Archive}
          tone="red"
        />
        <StatCard
          label="Sin responsable"
          value={all.filter((employee) => !employee.timeResponsible).length}
          icon={AlertTriangle}
          tone="orange"
        />
        <StatCard label="Carga pendiente" value={pendingTimeLoads} icon={Clock3} tone="purple" />
      </div>

      <Section
        title="Listado de legajos"
        subtitle={`${employees.length} resultados`}
        action={
          <button className="button subtle">
            <SlidersHorizontal size={16} /> Mas filtros
          </button>
        }
      >
        <div className="filters">
          <label className="search-field">
            <Search size={17} />
            <input
              placeholder="Buscar por legajo, DNI, CUIL, apellido o nombre"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select value={company} onChange={(event) => setCompany(event.target.value)}>
            <option value="">Todas las empresas</option>
            {companyOptions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>

        <TableShell minWidth={980}>
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
              {employees.map((employee) => {
                const laborStatus = calculateEmployeeStatus(employee);
                return (
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
                      <span className={statusClass(laborStatus)}>{laborStatus}</span>
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
                );
              })}
            </tbody>
          </table>
        </TableShell>
      </Section>
    </>
  );
}
