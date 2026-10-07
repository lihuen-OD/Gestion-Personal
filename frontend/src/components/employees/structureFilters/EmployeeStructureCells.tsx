import type { Employee } from "../../../types";
import { Badge } from "../../ui/Badge";
import { isReloadPending } from "./employeeStructureFilters";

/**
 * A7: celdas de listado — puesto con su alcance (contexto, sólo consulta) y
 * zonas vigentes hoy. "Pendiente de recarga" con el mismo criterio que el
 * filtro del backend.
 */
export function EmployeeStructureCells({ employee }: { employee: Employee }) {
  const scopes = employee.positionScopes;
  const scopeText = scopes?.length
    ? scopes.map((scope) => scope.name).join(", ")
    : employee.positionScopeCount
      ? `${employee.positionScopeCount} ${employee.positionScopeCount === 1 ? "alcance" : "alcances"}`
      : employee.positionId ? "Sin alcance" : "";
  const zones = employee.currentWorkLocations?.map((location) => location.zoneName) ?? [];
  return (
    <>
      <td className="structure-cell">
        <b title={employee.puestoNombre || employee.position}>{employee.puestoNombre || employee.position || "Sin puesto"}</b>
        {scopeText ? <small title={scopeText}>{scopeText}</small> : null}
        {isReloadPending(employee) ? <Badge tone="warning">Pendiente de recarga</Badge> : null}
      </td>
      <td className="structure-cell">
        {zones.length ? <span title={zones.join(", ")}>{Array.from(new Set(zones)).join(", ")}</span> : <small>Sin ubicación vigente</small>}
      </td>
    </>
  );
}
