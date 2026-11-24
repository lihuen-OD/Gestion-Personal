import { useId, useState, type FormEvent } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormActions } from "../ui/FormControls";
import { describedBy, FieldMessages } from "../ui/FieldMessages";
import { getUserErrorMessage } from "../../services/api/apiClient";
import { shiftRotationApiService, type ShiftRotationCrew } from "../../services/api/shiftRotationApiService";
import { humanizeRotationMessage, normalizeRotationText } from "../../utils/shiftRotation";
import { validateCrewForm, type CrewFormErrors, type CrewFormValue } from "../../utils/shiftRotationGrid";

/**
 * Alta y edición de un equipo de la rotación (sólo RRHH). El código no se
 * cambia después del alta (el contrato de edición no lo admite); el estado se
 * cambia desde la acción de la tabla, con su confirmación.
 */
export function RotationCrewFormModal({ rotationId, crew, suggestedOrder, close, onSaved }: { rotationId: string; crew: ShiftRotationCrew | null; suggestedOrder: number; close: () => void; onSaved: () => void }) {
  const [value, setValue] = useState<CrewFormValue>({ code: crew?.code ?? "", name: crew?.name ?? "", sortOrder: String(crew?.sortOrder ?? suggestedOrder) });
  const [errors, setErrors] = useState<CrewFormErrors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const baseId = useId();
  const ids = { code: `${baseId}-code`, name: `${baseId}-name`, sortOrder: `${baseId}-order` };
  const set = (field: keyof CrewFormValue) => (next: string) => setValue((current) => ({ ...current, [field]: next }));
  const messages = {
    code: { hint: errors.code ? undefined : crew ? "El código no se cambia después del alta." : "Por ejemplo A, B o NOCHE. Se guarda en mayúsculas.", error: errors.code },
    name: { error: errors.name },
    sortOrder: { hint: errors.sortOrder ? undefined : "Los equipos se listan de menor a mayor orden.", error: errors.sortOrder },
  };
  const name = normalizeRotationText(value.name);
  const order = Number(value.sortOrder);
  const unchanged = Boolean(crew) && name === crew!.name && order === crew!.sortOrder;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const nextErrors = validateCrewForm(value, { creating: !crew });
    setErrors(nextErrors);
    setError("");
    if (Object.keys(nextErrors).length) return;
    setBusy(true);
    try {
      if (crew) {
        await shiftRotationApiService.updateCrew(rotationId, crew.id, {
          ...(name !== crew.name ? { name } : {}),
          ...(order !== crew.sortOrder ? { sortOrder: order } : {}),
        });
      } else {
        await shiftRotationApiService.createCrew(rotationId, { code: normalizeRotationText(value.code).toUpperCase(), name, sortOrder: order });
      }
      onSaved();
    } catch (reason) {
      setError(humanizeRotationMessage(getUserErrorMessage(reason, "No pudimos guardar el equipo.")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={crew ? "Editar equipo" : "Agregar equipo"}
      subtitle={crew ? undefined : "El equipo nuevo no tiene días en la grilla: sus turnos y descansos se definen en una versión de la grilla."}
      close={close}
      closeDisabled={busy}
    >
      <form className="form-stack rotation-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="form-grid rotation-crew-form-grid">
          <div className="field-stack">
            <label htmlFor={ids.code}>Código *</label>
            <input id={ids.code} data-modal-initial-focus={crew ? undefined : true} value={value.code} maxLength={20} spellCheck={false} autoCapitalize="characters" disabled={Boolean(crew) || busy} aria-invalid={errors.code ? true : undefined} aria-describedby={describedBy(ids.code, messages.code)} onChange={(event) => set("code")(event.target.value.toUpperCase())} placeholder="Ej: A" />
            <FieldMessages id={ids.code} {...messages.code} />
          </div>
          <div className="field-stack">
            <label htmlFor={ids.name}>Nombre *</label>
            <input id={ids.name} data-modal-initial-focus={crew ? true : undefined} value={value.name} maxLength={80} disabled={busy} aria-invalid={errors.name ? true : undefined} aria-describedby={describedBy(ids.name, messages.name)} onChange={(event) => set("name")(event.target.value)} placeholder="Ej: Equipo A" />
            <FieldMessages id={ids.name} {...messages.name} />
          </div>
          <div className="field-stack">
            <label htmlFor={ids.sortOrder}>Orden *</label>
            <input id={ids.sortOrder} type="number" inputMode="numeric" min={0} max={9999} step={1} value={value.sortOrder} disabled={busy} aria-invalid={errors.sortOrder ? true : undefined} aria-describedby={describedBy(ids.sortOrder, messages.sortOrder)} onChange={(event) => set("sortOrder")(event.target.value)} />
            <FieldMessages id={ids.sortOrder} {...messages.sortOrder} />
          </div>
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <FormActions>
          <Button type="button" onClick={close} disabled={busy}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={busy || unchanged}>{crew ? "Guardar cambios" : "Agregar equipo"}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
