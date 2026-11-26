import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { FormActions } from "../components/ui/FormControls";
import { emptyShiftTemplate, shiftTemplateFormToInput, ShiftTemplateFormFields } from "../components/shifts/ShiftTemplateFormFields";
import { useAuth } from "../context/AuthContext";
import { getUserErrorMessage } from "../services/api/apiClient";
import { workforceApiService } from "../services/api/workforceApiService";
import { roleLevel } from "../utils/roles";
import { useShiftGroupAccess } from "../utils/shiftGroupAccess";
import { useAsyncAction } from "../utils/useAsyncAction";
import { useShiftGroupsCatalog } from "../components/shifts/useShiftGroupsCatalog";
import { shiftGroupSelectOptions } from "../utils/shiftGroups";

export function ShiftCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [value, setValue] = useState(emptyShiftTemplate());
  const [error, setError] = useState("");
  const { groups, status: groupsStatus } = useShiftGroupsCatalog();
  // R8: RRHH puede dejar un turno sin grupo; Nivel 2/3 sólo crean en sus grupos
  // (el catálogo ya viene filtrado por el backend, que vuelve a validarlo).
  const isRrhh = roleLevel(user!.role) === 1;
  const { hasGroups } = useShiftGroupAccess();
  const options = shiftGroupSelectOptions(groups, null, { allowUngrouped: isRrhh });
  const groupField = {
    options,
    unavailableMessage: groupsStatus === "error"
      ? isRrhh ? "No pudimos cargar los grupos: el turno se crea sin grupo y podés asignarlo después." : "No pudimos cargar tus grupos de turnos. Volvé a intentar en unos minutos."
      : groupsStatus === "loading" ? "Cargando grupos..." : undefined,
  };
  // Nivel 2/3: preselecciona su primer grupo (no hay «Sin grupo»).
  const firstGroupId = !isRrhh ? options[0]?.value ?? "" : "";
  useEffect(() => {
    if (firstGroupId && !value.shiftGroupId) setValue((current) => ({ ...current, shiftGroupId: firstGroupId }));
  }, [firstGroupId, value.shiftGroupId]);

  const { isRunning: isSaving, run: save } = useAsyncAction(async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!value.code.trim() || !value.name.trim()) return setError("Completá código y nombre del turno.");
    if (!isRrhh && !value.shiftGroupId) return setError("Elegí el grupo del turno.");
    try {
      const created = await workforceApiService.createShiftTemplate(shiftTemplateFormToInput(value));
      navigate(`/configuracion/turnos/${created.id}`, { state: { created: true } });
    } catch (reason) {
      setError(getUserErrorMessage(reason, "No pudimos guardar el turno."));
    }
  });

  if (!hasGroups) return <Navigate to="/configuracion/turnos" />;

  return (
    <form onSubmit={save}>
      <PageHeader eyebrow="TURNOS" title="Crear turno" description="Definí el horario de referencia, sus tolerancias y las reglas de control." />
      <Section title="Datos generales, horario, tolerancias y control" subtitle="Los empleados se asocian una vez creado el turno.">
        <ShiftTemplateFormFields value={value} onChange={setValue} groupField={groupField} />
      </Section>
      {error ? <p className="error create-error">{error}</p> : null}
      <FormActions className="create-actions">
        <Button to="/configuracion/turnos" variant="subtle">Cancelar</Button>
        <Button variant="primary" disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar turno"}</Button>
      </FormActions>
    </form>
  );
}
