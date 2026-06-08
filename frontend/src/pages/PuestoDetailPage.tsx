import { useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { PuestoAssignedPeopleTab } from "../components/puestos/PuestoAssignedPeopleTab";
import { PuestoCompetenciesTab } from "../components/puestos/PuestoCompetenciesTab";
import { PuestoEvaluationCriteriaTab } from "../components/puestos/PuestoEvaluationCriteriaTab";
import { PuestoHeader } from "../components/puestos/PuestoHeader";
import { PuestoHistoryTab } from "../components/puestos/PuestoHistoryTab";
import { PuestoIdentificationTab } from "../components/puestos/PuestoIdentificationTab";
import { PuestoIndicatorsTab } from "../components/puestos/PuestoIndicatorsTab";
import { PuestoMissionTab } from "../components/puestos/PuestoMissionTab";
import { PuestoRelationsTab } from "../components/puestos/PuestoRelationsTab";
import { PuestoResponsibilitiesTab } from "../components/puestos/PuestoResponsibilitiesTab";
import { PuestoWorkConditionsTab } from "../components/puestos/PuestoWorkConditionsTab";
import { useAuth } from "../context/AuthContext";
import { positionMockService } from "../services/positionMockService";
import type { Position } from "../types/position.types";

const tabs = ["Identificacion", "Proposito / Mision", "Responsabilidades", "Relaciones", "Competencias", "Condiciones", "Indicadores", "Criterios", "Personas Asignadas", "Historial"];
function roleLevel(role: string) { return role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3; }

export function PuestoDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const source = positionMockService.getById(id!);
  const [position, setPosition] = useState<Position | undefined>(source);
  const [tab, setTab] = useState(0);
  const [notice, setNotice] = useState(location.state?.created ? "Puesto creado correctamente." : "");
  if (roleLevel(user!.role) === 3) return <Navigate to="/horas" />;
  if (!position) return <Navigate to="/puestos" />;
  const canEdit = roleLevel(user!.role) === 1;
  const assigned = positionMockService.getAssignedEmployees(position.id);
  const save = (action = `Edicion de ${tabs[tab]}`) => {
    const saved = positionMockService.update(position.id, position, user!, action, `Se actualizo la solapa ${tabs[tab]}.`);
    setPosition(saved);
    setNotice("Cambios guardados correctamente.");
    setTimeout(() => setNotice(""), 2200);
  };
  const toggle = () => {
    if (!confirm(`Confirmar ${position.status === "ACTIVO" ? "inactivacion" : "activacion"} del puesto ${position.name}?`)) return;
    const saved = positionMockService.changeStatus(position.id, position.status === "ACTIVO" ? "INACTIVO" : "ACTIVO", user!);
    if (saved) setPosition(saved);
  };
  const remove = () => {
    const message = assigned.length ? `Este puesto tiene ${assigned.length} persona(s) asignadas. No se borra para no romper legajos; se va a inactivar/ocultar. ¿Confirmar?` : "Este puesto no tiene personas asignadas. ¿Confirmar eliminación?";
    if (!confirm(message)) return;
    const result = positionMockService.removeOrHide(position.id, user!);
    if (result) { setPosition(result); setNotice("Puesto inactivado para conservar trazabilidad."); }
    else navigate("/puestos");
  };
  const render = () => {
    if (tab === 0) return <PuestoIdentificationTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 1) return <PuestoMissionTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 2) return <PuestoResponsibilitiesTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 3) return <PuestoRelationsTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 4) return <PuestoCompetenciesTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 5) return <PuestoWorkConditionsTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 6) return <PuestoIndicatorsTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 7) return <PuestoEvaluationCriteriaTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 8) return <PuestoAssignedPeopleTab employees={assigned} />;
    return <PuestoHistoryTab position={position} />;
  };
  return <>
    <PuestoHeader position={position} assignedCount={assigned.length} canEdit={canEdit} onRemove={remove} onToggleStatus={toggle} />
    {notice && <div className="toast">{notice}</div>}
    <div className="tabs">{tabs.map((label, index) => <button key={label} className={tab === index ? "active" : ""} onClick={() => setTab(index)}>{index + 1}. {label}</button>)}</div>
    <section className="panel"><div className="panel-head"><div><h3>{tabs[tab]}</h3><p>{tab === 8 ? "Calculado desde legajos activos vinculados a este puesto." : tab === 9 ? "Historial general del puesto." : "Informacion editable de la descripcion de puesto."}</p></div>{canEdit && tab < 8 && <button className="button primary" onClick={() => save()}>Guardar cambios</button>}</div><div className="panel-body">{render()}</div></section>
  </>;
}
