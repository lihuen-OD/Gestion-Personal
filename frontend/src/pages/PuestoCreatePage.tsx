import { useEffect, useState, type FormEvent } from "react";
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
import { positionApiService } from "../services/api/positionApiService";
import type { Position } from "../types/position.types";
import { roleLevel } from "../utils/roles";

export function PuestoCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [usesApi, setUsesApi] = useState(false);
  const [position, setPosition] = useState<Position>({ ...emptyPosition(), id: crypto.randomUUID(), history: [], createdAt: "", updatedAt: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    positionApiService.getAll()
      .then((items) => {
        if (!alive) return;
        setUsesApi(true);
        setPosition((current) => ({ ...current, code: positionApiService.getNextCode(items) }));
      })
      .catch(() => setUsesApi(false));
    return () => { alive = false; };
  }, []);

  if (roleLevel(user!.role) !== 1) return <Navigate to="/puestos" />;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!position.name.trim() || !position.areaDepartment.trim() || !position.sector.trim() || !position.status || !position.mission.trim() || !position.lastUpdatedAt) return setError("Completa nombre, area/departamento, sector, estado, mision y fecha de actualizacion.");
    try {
      const created = await positionApiService.create(position);
      if (created) navigate(`/puestos/${created.id}`, { state: { created: true, usesApi } });
    } catch {
      setError("No se pudo guardar el puesto en backend. Revisa codigo duplicado o conexion.");
    }
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
