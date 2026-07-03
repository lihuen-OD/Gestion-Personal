import { useEffect, useState } from "react";
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
import { PuestoSalaryRangeTab } from "../components/puestos/PuestoSalaryRangeTab";
import { PuestoWorkConditionsTab } from "../components/puestos/PuestoWorkConditionsTab";
import { useAuth } from "../context/AuthContext";
import { positionApiService } from "../services/api/positionApiService";
import type { Employee } from "../types";
import type { Position } from "../types/position.types";
import { roleLevel } from "../utils/roles";
import { useAsyncAction } from "../utils/useAsyncAction";

const tabs = ["Identificacion", "Proposito / Mision", "Rango Salarial", "Responsabilidades", "Relaciones", "Competencias", "Condiciones", "Indicadores", "Criterios", "Personas Asignadas", "Historial"];

export function PuestoDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [position, setPosition] = useState<Position | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [assigned, setAssigned] = useState<Employee[]>([]);
  const [tab, setTab] = useState(0);
  const [notice, setNotice] = useState(location.state?.created ? "Puesto creado correctamente." : "");

  useEffect(() => {
    let alive = true;
    if (!id) return;
    setIsLoading(true);
    positionApiService.getById(id)
      .then((source) => {
        if (!alive) return;
        setPosition(source ?? undefined);
      })
      .catch(() => {
        if (!alive) return;
        setPosition(undefined);
      })
      .finally(() => {
        if (alive) setIsLoading(false);
      });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    let alive = true;
    if (!position) {
      setAssigned([]);
      return () => { alive = false; };
    }
    positionApiService.getAssignedEmployees(position.id)
      .then((employees) => {
        if (!alive) return;
        setAssigned(employees);
      })
      .catch(() => {
        if (alive) setAssigned([]);
      });
    return () => { alive = false; };
  }, [position?.id, position?.name]);

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!position) return;
    try {
      const saved = await positionApiService.update(position);
      if (saved) setPosition(saved);
      setNotice("Cambios guardados correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch {
      setNotice("No se pudo guardar el puesto en backend.");
    }
  });

  if (roleLevel(user!.role) === 3) return <Navigate to="/horas" />;
  if (isLoading) return <section className="panel"><div className="panel-body"><div className="empty">Cargando puesto...</div></div></section>;
  if (!position) return <Navigate to="/puestos" />;

  const canEdit = roleLevel(user!.role) === 1;

  const toggle = async () => {
    if (!confirm(`Confirmar ${position.status === "ACTIVO" ? "inactivacion" : "activacion"} del puesto ${position.name}?`)) return;
    const next = { ...position, status: position.status === "ACTIVO" ? "INACTIVO" : "ACTIVO" } as Position;
    const saved = await positionApiService.update(next);
    if (saved) setPosition(saved);
  };

  const remove = async () => {
    const message = assigned.length ? `Este puesto tiene ${assigned.length} persona(s) asignadas. No se borra para no romper legajos; se va a inactivar/ocultar. Confirmar?` : "Confirmar ocultar/eliminar este puesto?";
    if (!confirm(message)) return;
    const result = await positionApiService.removeOrHide(position.id);
    if (result) { setPosition(result); setNotice("Puesto inactivado para conservar trazabilidad."); }
    else navigate("/puestos");
  };

  const render = () => {
    if (tab === 0) return <PuestoIdentificationTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 1) return <PuestoMissionTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 2) return <PuestoSalaryRangeTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 3) return <PuestoResponsibilitiesTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 4) return <PuestoRelationsTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 5) return <PuestoCompetenciesTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 6) return <PuestoWorkConditionsTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 7) return <PuestoIndicatorsTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 8) return <PuestoEvaluationCriteriaTab position={position} setPosition={setPosition} disabled={!canEdit} />;
    if (tab === 9) return <PuestoAssignedPeopleTab employees={assigned} />;
    return <PuestoHistoryTab position={position} />;
  };

  return <>
    <PuestoHeader position={position} assignedCount={assigned.length} canEdit={canEdit} onRemove={remove} onToggleStatus={toggle} />
    {notice && <div className="toast">{notice}</div>}

    <div className="tabs">{tabs.map((label, index) => <button key={label} className={tab === index ? "active" : ""} onClick={() => setTab(index)}>{index + 1}. {label}</button>)}</div>
    <section className="panel"><div className="panel-head"><div><h3>{tabs[tab]}</h3><p>{tab === 9 ? "Calculado desde legajos activos vinculados a este puesto." : tab === 10 ? "Historial general del puesto." : "Informacion editable de la descripcion de puesto."}</p></div>{canEdit && tab < 9 && <button className="button primary" onClick={save} disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar cambios"}</button>}</div><div className="panel-body">{render()}</div></section>
  </>;
}
