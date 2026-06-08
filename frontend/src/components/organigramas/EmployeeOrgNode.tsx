import type { Employee } from "../../types";
import type { OrgCategory } from "../../types/organizationChart.types";
import { positionMockService } from "../../services/positionMockService";

export function EmployeeOrgNode({ employee, category, orphan, onClick }: { employee: Employee; category: OrgCategory; orphan?: boolean; onClick: () => void }) {
  const positionName = employee.positionId ? positionMockService.getById(employee.positionId)?.name : undefined;
  return <button className={`org-employee-node ${employee.status === "Inactivo" ? "inactive" : ""} ${orphan ? "orphan" : ""}`} style={{ borderColor: category.nodeColor }} onClick={onClick} title="Click para ver resumen">
    <b>{employee.lastName}, {employee.firstName}</b>
    <small>{positionName || employee.puestoNombre || employee.position || "Sin puesto"}</small>
    <em>{employee.internalCategory || employee.receiptCategory || "Sin categoría"}</em>
    <i>{employee.status}</i>
  </button>;
}
