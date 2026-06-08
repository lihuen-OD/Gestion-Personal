import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { Employee } from "../../types";

function employeeCompanies(employee: Employee) {
  return employee.companies?.length ? employee.companies.join(", ") : employee.company;
}

export function PuestoAssignedPeopleTab({ employees }: { employees: Employee[] }) {
  if (!employees.length) return <div className="empty"><span>Todavia no hay personas asignadas a este puesto.</span></div>;
  return <table><thead><tr><th>Legajo</th><th>Apellido</th><th>Nombre</th><th>Empresa</th><th>Centro de costo</th><th>Sector</th><th>Categoria interna</th><th>Estado</th><th>Accion</th></tr></thead><tbody>
    {employees.map((employee) => <tr key={employee.id}><td><b>{employee.legajoInterno || employee.legajo}</b></td><td>{employee.lastName}</td><td>{employee.firstName}</td><td>{employeeCompanies(employee)}</td><td>{employee.costCenter}</td><td>{employee.sector}</td><td>{employee.internalCategory}</td><td><span className={employee.status === "Activo" ? "badge success" : "badge danger"}>{employee.status}</span></td><td><Link className="table-link" to={`/legajos/${employee.id}`}>Ver legajo <ChevronRight size={15} /></Link></td></tr>)}
  </tbody></table>;
}
