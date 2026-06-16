import { Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { OverflowCell } from "../ui/OverflowCell";
import { TableShell } from "../ui/TableShell";
import type { Employee } from "../../types";

function employeeCompanies(employee: Employee) {
  return employee.companies?.length ? employee.companies.join(", ") : employee.company;
}

export function PuestoAssignedPeopleTab({ employees }: { employees: Employee[] }) {
  if (!employees.length) return <div className="empty"><span>Todavia no hay personas asignadas a este puesto.</span></div>;
  return <TableShell minWidth={1080}><table><thead><tr><th>Legajo</th><th>Apellido</th><th>Nombre</th><th>Empresa</th><th>Centro de costo</th><th>Sector</th><th>Categoria interna</th><th>Estado</th><th>Accion</th></tr></thead><tbody>
    {employees.map((employee) => <tr key={employee.id}><td><b>{employee.legajoInterno || employee.legajo}</b></td><td>{employee.lastName}</td><td>{employee.firstName}</td><td><OverflowCell value={employeeCompanies(employee)} /></td><td><OverflowCell value={employee.costCenter} /></td><td><OverflowCell value={employee.sector} /></td><td><OverflowCell value={employee.internalCategory} /></td><td><span className={employee.status === "Activo" ? "badge success" : "badge danger"}>{employee.status}</span></td><td><Link className="table-link table-icon-action" title="Ver legajo" aria-label="Ver legajo" to={`/legajos/${employee.id}`}><Eye size={14} /><span>Ver legajo</span></Link></td></tr>)}
  </tbody></table></TableShell>;
}
