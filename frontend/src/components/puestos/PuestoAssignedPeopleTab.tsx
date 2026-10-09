import { Eye } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { OverflowCell } from "../ui/OverflowCell";
import { DataTable } from "../ui/DataTable";
import { Badge } from "../ui/Badge";
import { Pagination } from "../ui/Pagination";
import { SortableHeader } from "../ui/SortableHeader";
import { positionApiService, type AssignedEmployeeSortKey } from "../../services/api/positionApiService";
import type { ListMeta } from "../../services/api/listQuery";
import type { Employee } from "../../types";
import { useSortState } from "../../utils/sort";

const pageSize = 25;

function employeeCompanies(employee: Employee) {
  return employee.companies?.length ? employee.companies.join(", ") : employee.company;
}

// Personas asignadas al puesto: paginado y ordenado server-side (antes el
// endpoint devolvía hasta 500 personas sin meta y cortaba en silencio).
export function PuestoAssignedPeopleTab({ positionId }: { positionId: string }) {
  const [page, setPage] = useState(1);
  const resetPage = useCallback(() => setPage(1), []);
  const { sort, toggleSort } = useSortState<AssignedEmployeeSortKey>(resetPage);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [meta, setMeta] = useState<ListMeta>({ total: 0, page: 1, pageSize, hasMore: false });
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    if (!employees.length) setStatus("loading");
    positionApiService.getAssignedEmployees(positionId, { page, take: pageSize, sort })
      .then((result) => {
        if (!alive) return;
        setEmployees(result.items);
        setMeta(result.meta);
        setStatus("success");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => { alive = false; };
  }, [page, positionId, retry, sort]);

  return <>
    <DataTable
      status={status === "loading" ? "loading" : status === "error" ? "error" : employees.length ? "ready" : "empty"}
      minWidth={1080}
      emptyText="Todavía no hay personas asignadas a este puesto."
      errorMessage="No pudimos cargar las personas asignadas."
      onRetry={() => setRetry((value) => value + 1)}
    >
      <table><thead><tr><SortableHeader label="Legajo" sortKey="legajo" sort={sort} onSort={toggleSort} /><SortableHeader label="Apellido" sortKey="employee" sort={sort} onSort={toggleSort} /><th>Nombre</th><th>Empresa</th><th>Centro de costo</th><th>Categoria interna</th><th>Estado</th><th>Accion</th></tr></thead><tbody>
        {employees.map((employee) => <tr key={employee.id}><td><b>{employee.legajoInterno || employee.legajo}</b></td><td>{employee.lastName}</td><td>{employee.firstName}</td><td><OverflowCell value={employeeCompanies(employee)} /></td><td><OverflowCell value={employee.costCenter} /></td><td><OverflowCell value={employee.internalCategory} /></td><td><Badge tone={employee.status === "Activo" ? "success" : "neutral"}>{employee.status}</Badge></td><td><Link className="table-icon-action" title="Ver legajo" aria-label="Ver legajo" to={`/legajos/${employee.id}`}><Eye size={14} /><span>Ver legajo</span></Link></td></tr>)}
      </tbody></table>
    </DataTable>
    {status === "success" && meta.total > 0 ? <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} hasMore={meta.hasMore} onPageChange={setPage} itemLabel="personas" /> : null}
  </>;
}
