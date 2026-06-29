import type { Employee } from "../../types";
import type { OrgCategory } from "../../types/organizationChart.types";

export function EmployeeOrgNode({ employee, category, orphan, onClick }: { employee: Employee; category: OrgCategory; orphan?: boolean; onClick: () => void }) {
  return <button className={`org-employee-node ${employee.status === "Inactivo" ? "inactive" : ""} ${orphan ? "orphan" : ""}`} style={{ borderColor: category.nodeColor }} onClick={onClick} title="Click para ver resumen">
    <b>{employee.lastName}, {employee.firstName}</b>
    <small>{employee.puestoNombre || employee.position || "Sin puesto"}</small>
    <em>{employee.internalCategory || employee.receiptCategory || "Sin categoría"}</em>
    <i>{employee.status}</i>
  </button>;
}
