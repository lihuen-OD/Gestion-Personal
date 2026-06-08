import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { PuestoCompetenciesTab } from "../components/puestos/PuestoCompetenciesTab";
import { PuestoEvaluationCriteriaTab } from "../components/puestos/PuestoEvaluationCriteriaTab";
import { emptyPosition } from "../components/puestos/PuestoFields";
import { PuestoIdentificationTab } from "../components/puestos/PuestoIdentificationTab";
import { PuestoIndicatorsTab } from "../components/puestos/PuestoIndicatorsTab";
import { PuestoMissionTab } from "../components/puestos/PuestoMissionTab";
import { PuestoRelationsTab } from "../components/puestos/PuestoRelationsTab";
import { PuestoResponsibilitiesTab } from "../components/puestos/PuestoResponsibilitiesTab";
import { PuestoSalaryRangeTab } from "../components/puestos/PuestoSalaryRangeTab";
import { PuestoWorkConditionsTab } from "../components/puestos/PuestoWorkConditionsTab";
import { useAuth } from "../context/AuthContext";
import { positionMockService } from "../services/positionMockService";
import type { Position } from "../types/position.types";

function roleLevel(role: string) { return role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3; }

export function PuestoCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [position, setPosition] = useState<Position>({ ...emptyPosition(), code: positionMockService.getNextCode(), id: crypto.randomUUID(), history: [], createdAt: "", updatedAt: "" });
  const [error, setError] = useState("");
  if (roleLevel(user!.role) !== 1) return <Navigate to="/puestos" />;
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!position.name.trim() || !position.areaDepartment.trim() || !position.sector.trim() || !position.status || !position.mission.trim() || !position.lastUpdatedAt) return setError("Completá nombre, area/departamento, sector, estado, mision y fecha de actualizacion.");
    const created = positionMockService.create(position, user!);
    navigate(`/puestos/${created.id}`, { state: { created: true } });
  };
  return <form onSubmit={save}>
    <div className="page-header"><div><p className="eyebrow">PUESTOS</p><h1>Crear nuevo puesto</h1><p>Descripcion funcional reutilizable para legajos, organigramas, dashboard y evaluaciones futuras.</p></div></div>
    <section className="panel"><div className="panel-head"><div><h3>1. Identificacion del puesto</h3><p>Datos base y estructura sugerida.</p></div></div><PuestoIdentificationTab position={position} setPosition={setPosition} /></section>
    <section className="panel"><div className="panel-head"><div><h3>2. Proposito / Mision</h3></div></div><PuestoMissionTab position={position} setPosition={setPosition} /></section>
    <section className="panel"><div className="panel-head"><div><h3>3. Rango salarial</h3></div></div><PuestoSalaryRangeTab position={position} setPosition={setPosition} /></section>
    <section className="panel"><div className="panel-head"><div><h3>4. Responsabilidades</h3></div></div><PuestoResponsibilitiesTab position={position} setPosition={setPosition} /></section>
    <section className="panel"><div className="panel-head"><div><h3>5. Relaciones internas y externas</h3></div></div><PuestoRelationsTab position={position} setPosition={setPosition} /></section>
    <section className="panel"><div className="panel-head"><div><h3>6. Competencias clave</h3></div></div><PuestoCompetenciesTab position={position} setPosition={setPosition} /></section>
    <section className="panel"><div className="panel-head"><div><h3>7. Condiciones de trabajo</h3></div></div><PuestoWorkConditionsTab position={position} setPosition={setPosition} /></section>
    <section className="panel"><div className="panel-head"><div><h3>8. Indicadores de desempeno</h3></div></div><PuestoIndicatorsTab position={position} setPosition={setPosition} /></section>
    <section className="panel"><div className="panel-head"><div><h3>9. Criterios de evaluacion</h3></div></div><PuestoEvaluationCriteriaTab position={position} setPosition={setPosition} /></section>
    {error && <p className="error create-error">{error}</p>}
    <div className="form-actions create-actions"><Link to="/puestos" className="button subtle">Cancelar</Link><button className="button primary">Guardar puesto</button></div>
  </form>;
}
