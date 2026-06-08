import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { PuestoFilters } from "../components/puestos/PuestoFilters";
import { PuestoSummaryCards } from "../components/puestos/PuestoSummaryCards";
import { PuestoTable } from "../components/puestos/PuestoTable";
import { useAuth } from "../context/AuthContext";
import { positionMockService } from "../services/positionMockService";
import type { Position } from "../types/position.types";

function roleLevel(role: string) { return role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3; }

export function PuestosPage() {
  const { user } = useAuth();
  const level = roleLevel(user!.role);
  const canEdit = level === 1;
  const [filters, setFilters] = useState(positionMockService.getEmptyFilters());
  const [refresh, setRefresh] = useState(0);
  if (level === 3) return <Navigate to="/horas" />;
  void refresh;
  const positions = positionMockService.getFiltered(filters);
  const toggle = (position: Position) => {
    if (!confirm(`Confirmar ${position.status === "ACTIVO" ? "inactivacion" : "activacion"} del puesto ${position.name}?`)) return;
    positionMockService.changeStatus(position.id, position.status === "ACTIVO" ? "INACTIVO" : "ACTIVO", user!);
    setRefresh((value) => value + 1);
  };
  const remove = (position: Position) => {
    const assigned = positionMockService.getAssignedEmployees(position.id).length;
    const message = assigned ? `El puesto ${position.name} tiene ${assigned} persona(s) asignadas. No se borra para no romper legajos; se va a inactivar/ocultar. ¿Confirmar?` : `El puesto ${position.name} no tiene personas asignadas. ¿Confirmar eliminación?`;
    if (!confirm(message)) return;
    positionMockService.removeOrHide(position.id, user!);
    setRefresh((value) => value + 1);
  };
  return <>
    <div className="page-header"><div><p className="eyebrow">PUESTOS</p><h1>Puestos</h1><p>Administracion de descripciones de puesto y estructura funcional.</p></div>{canEdit && <Link className="button primary" to="/puestos/nuevo"><Plus size={17} /> Crear puesto</Link>}</div>
    <PuestoSummaryCards summary={positionMockService.getSummary()} />
    <section className="panel"><div className="panel-head"><div><h3>Listado de puestos</h3><p>{positions.length} resultados segun filtros aplicados.</p></div></div><div className="panel-body"><PuestoFilters filters={filters} options={positionMockService.getFilterOptions()} onChange={setFilters} /><PuestoTable positions={positions} assignedCount={(id) => positionMockService.getAssignedEmployees(id).length} canEdit={canEdit} onRemove={remove} onToggleStatus={toggle} /></div></section>
  </>;
}
