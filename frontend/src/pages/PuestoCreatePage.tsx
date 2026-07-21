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
import { useAsyncAction } from "../utils/useAsyncAction";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";

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

  const { isRunning: isSaving, run: save } = useAsyncAction(async (event: FormEvent) => {
    event.preventDefault();
    if (!position.name.trim() || !position.areaDepartment.trim() || !position.sector.trim() || !position.status || !position.mission.trim() || !position.lastUpdatedAt) return setError("Completa nombre, area/departamento, sector, estado, mision y fecha de actualizacion.");
    try {
      const created = await positionApiService.create(position);
      if (created) navigate(`/puestos/${created.id}`, { state: { created: true, usesApi } });
    } catch {
      setError("No pudimos guardar el puesto. Revisá si el código ya existe e intentá nuevamente.");
    }
  });

  if (roleLevel(user!.role) !== 1) return <Navigate to="/puestos" />;

  return <form onSubmit={save}>
    <PageHeader eyebrow="PUESTOS" title="Crear nuevo puesto" description="Descripcion funcional reutilizable para legajos, organigramas, dashboard y evaluaciones futuras." />
    <Section title="1. Identificacion del puesto" subtitle="Datos base y estructura sugerida."><PuestoIdentificationTab position={position} setPosition={setPosition} /></Section>
    <Section title="2. Proposito / Mision"><PuestoMissionTab position={position} setPosition={setPosition} /></Section>
    <Section title="3. Rango salarial"><PuestoSalaryRangeTab position={position} setPosition={setPosition} /></Section>
    <Section title="4. Responsabilidades"><PuestoResponsibilitiesTab position={position} setPosition={setPosition} /></Section>
    <Section title="5. Relaciones internas y externas"><PuestoRelationsTab position={position} setPosition={setPosition} /></Section>
    <Section title="6. Competencias clave"><PuestoCompetenciesTab position={position} setPosition={setPosition} /></Section>
    <Section title="7. Condiciones de trabajo"><PuestoWorkConditionsTab position={position} setPosition={setPosition} /></Section>
    <Section title="8. Indicadores de desempeno"><PuestoIndicatorsTab position={position} setPosition={setPosition} /></Section>
    <Section title="9. Criterios de evaluacion"><PuestoEvaluationCriteriaTab position={position} setPosition={setPosition} /></Section>
    {error && <p className="error create-error">{error}</p>}
    <div className="form-actions create-actions">
      <Link to="/puestos" className="button subtle">Cancelar</Link>
      <Button variant="primary" disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar puesto"}</Button>
    </div>
  </form>;
}
