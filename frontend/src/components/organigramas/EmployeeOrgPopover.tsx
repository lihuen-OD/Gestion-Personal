import { Link } from "react-router-dom";
import type { Employee } from "../../types";

const displayLegajo = (employee: Employee) => employee.legajoInterno || employee.legajoFinnegans || employee.legajo || "Sin cargar";

export function EmployeeOrgPopover({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const companies = employee.companies?.length ? employee.companies.join(", ") : employee.company;
  const rows = [
    ["Legajo", displayLegajo(employee)], ["CUIL", employee.cuil], ["Empresa", companies], ["Unidad de negocio", employee.businessUnit],
    ["Establecimiento", employee.establishment], ["Centro de costo", employee.costCenter], ["Sector", employee.sector], ["Puesto", employee.position],
    ["Categoría", employee.internalCategory || employee.receiptCategory || "Sin categoría"], ["Encargado directo", employee.directManager || "-"], ["Responsable de carga", employee.timeResponsible || "-"],
  ];
  return <div className="org-popover-backdrop" onClick={onClose}><article className="org-popover" onClick={(event) => event.stopPropagation()}>
    <button className="icon-button" onClick={onClose}>×</button>
    <p className="eyebrow">RESUMEN DEL LEGAJO</p><h3>{employee.lastName}, {employee.firstName}</h3>
    <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="form-actions"><Link className="button primary" to={`/legajos/${employee.id}`}>Ver legajo</Link></div>
  </article></div>;
}
