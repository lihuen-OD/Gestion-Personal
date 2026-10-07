import type { Employee } from "../../types";
import { Button } from "../ui/Button";
import { orgNodeTypeLabels } from "../org-structure/orgStructureTree";

const displayLegajo = (employee: Employee) => employee.legajoInterno || employee.legajoFinnegans || employee.legajo || "Sin cargar";

export function EmployeeOrgPopover({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const companies = employee.companies?.length ? employee.companies.join(", ") : employee.company;
  // A7: organización (alcance del puesto), ubicación y empresa empleadora por
  // separado; la estructura anterior queda rotulada como tal.
  const scopes = employee.positionScopes?.map((scope) => `${orgNodeTypeLabels[scope.level]}: ${scope.name}`).join(" · ");
  const locations = employee.currentWorkLocations?.map((location) => `${location.zoneName} (${location.establishments.join(", ")})`).join(" · ");
  const rows = [
    ["Legajo", displayLegajo(employee)], ["CUIL", employee.cuil], ["Empresa empleadora", companies], ["Centro de costo", employee.costCenter],
    ["Puesto", employee.position || "Sin puesto"], ["Alcance del puesto", scopes || (employee.positionId ? "Pendiente de recarga: el puesto no tiene alcance" : "-")],
    ["Ubicaciones vigentes", locations || "Sin ubicación vigente"],
    ["Categoría", employee.internalCategory || employee.receiptCategory || "Sin categoría"], ["Encargado directo", employee.directManager || "-"], ["Responsable de carga", employee.timeResponsible || "-"],
    ...(employee.sector ? [["Sector anterior", `${employee.sector} (sólo consulta)`]] : []),
  ];
  return <div className="org-popover-backdrop" onClick={onClose}><article className="org-popover" onClick={(event) => event.stopPropagation()}>
    <button className="icon-button" onClick={onClose}>×</button>
    <p className="eyebrow">RESUMEN DEL LEGAJO</p><h3>{employee.lastName}, {employee.firstName}</h3>
    <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="form-actions"><Button variant="primary" to={`/legajos/${employee.id}`}>Ver legajo</Button></div>
  </article></div>;
}
