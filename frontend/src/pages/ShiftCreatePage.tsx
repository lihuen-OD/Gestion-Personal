import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { emptyShiftTemplate, shiftTemplateFormToInput, ShiftTemplateFormFields } from "../components/shifts/ShiftTemplateFormFields";
import { useAuth } from "../context/AuthContext";
import { workforceApiService } from "../services/api/workforceApiService";
import { roleLevel } from "../utils/roles";
import { useAsyncAction } from "../utils/useAsyncAction";

export function ShiftCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [value, setValue] = useState(emptyShiftTemplate());
  const [error, setError] = useState("");

  const { isRunning: isSaving, run: save } = useAsyncAction(async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!value.code.trim() || !value.name.trim()) return setError("Completá código y nombre del turno.");
    try {
      const created = await workforceApiService.createShiftTemplate(shiftTemplateFormToInput(value));
      navigate(`/configuracion/turnos/${created.id}`, { state: { created: true } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos guardar el turno.");
    }
  });

  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion/turnos" />;

  return (
    <form onSubmit={save}>
      <PageHeader eyebrow="TURNOS" title="Crear turno" description="Definí el horario de referencia, sus tolerancias y las reglas de control." />
      <Section title="Datos generales, horario, tolerancias y control" subtitle="Los empleados se asocian una vez creado el turno.">
        <ShiftTemplateFormFields value={value} onChange={setValue} />
      </Section>
      {error ? <p className="error create-error">{error}</p> : null}
      <div className="form-actions create-actions">
        <Link to="/configuracion/turnos" className="button subtle">Cancelar</Link>
        <Button variant="primary" disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar turno"}</Button>
      </div>
    </form>
  );
}
