import { useId, useState, type FormEvent } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormActions } from "../ui/FormControls";
import { describedBy, FieldMessages } from "../ui/FieldMessages";
import { getUserErrorMessage } from "../../services/api/apiClient";
import type { ShiftGroup } from "../../services/api/shiftGroupApiService";
import { shiftRotationApiService, type ShiftRotation, type ShiftRotationUpdateInput } from "../../services/api/shiftRotationApiService";
import { humanizeRotationMessage, normalizeRotationText, rotationGroupOptions, validateRotationForm, type RotationFormErrors, type RotationFormValue } from "../../utils/shiftRotation";

function initialValue(rotation: ShiftRotation | null): RotationFormValue {
  return { code: rotation?.code ?? "", name: rotation?.name ?? "", shiftGroupId: rotation?.shiftGroup.id ?? "", observation: rotation?.observation ?? "" };
}

/** Sólo los campos que cambiaron (el backend rechaza un PATCH vacío). */
function changedFields(rotation: ShiftRotation, value: RotationFormValue): ShiftRotationUpdateInput {
  const code = normalizeRotationText(value.code).toUpperCase();
  const name = normalizeRotationText(value.name);
  const observation = value.observation.trim() || null;
  return {
    ...(code !== rotation.code ? { code } : {}),
    ...(name !== rotation.name ? { name } : {}),
    ...(value.shiftGroupId !== rotation.shiftGroup.id ? { shiftGroupId: value.shiftGroupId } : {}),
    ...(observation !== (rotation.observation || null) ? { observation } : {}),
  };
}

/**
 * Alta y edición de los datos de una rotación (sólo RRHH). Una rotación nace
 * inactiva; equipos, grilla y personas se configuran después. Los bloqueos de
 * código y grupo los informa el backend (`hasRuled`, versiones) y acá sólo se
 * reflejan para no ofrecer un cambio que será rechazado.
 */
export function RotationFormModal({ rotation, groups, groupsUnavailable, close, onSaved }: { rotation: ShiftRotation | null; groups: ShiftGroup[] | null; groupsUnavailable: boolean; close: () => void; onSaved: (saved: ShiftRotation) => void }) {
  const [value, setValue] = useState<RotationFormValue>(() => initialValue(rotation));
  const [errors, setErrors] = useState<RotationFormErrors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const baseId = useId();
  const ids = { code: `${baseId}-code`, name: `${baseId}-name`, group: `${baseId}-group`, observation: `${baseId}-observation` };
  const codeLocked = Boolean(rotation?.hasRuled);
  const groupLocked = Boolean(rotation?.versions.length);
  const options = rotationGroupOptions(groups, rotation?.shiftGroup ?? null);
  const set = (field: keyof RotationFormValue) => (next: string) => setValue((current) => ({ ...current, [field]: next }));

  const messages = {
    code: { hint: errors.code ? undefined : codeLocked ? "No se puede cambiar: la rotación ya rigió." : "Se guarda en mayúsculas.", error: errors.code },
    name: { error: errors.name },
    group: {
      hint: errors.shiftGroupId ? undefined
        : groupLocked ? "No se puede cambiar: la rotación ya tiene versiones con turnos de este grupo."
        : groupsUnavailable ? "No pudimos cargar los grupos. Podés conservar el actual o reintentar más tarde."
        : !options.length ? "No hay grupos activos. Creá uno en la pestaña «Grupos» de Turnos."
        : "Los turnos de la grilla tendrán que pertenecer a este grupo.",
      error: errors.shiftGroupId,
    },
    observation: { hint: errors.observation ? undefined : "Opcional. Hasta 500 caracteres.", error: errors.observation },
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const nextErrors = validateRotationForm(value);
    setErrors(nextErrors);
    setError("");
    if (Object.keys(nextErrors).length) return;
    setBusy(true);
    try {
      const saved = rotation
        ? await shiftRotationApiService.update(rotation.id, changedFields(rotation, value))
        : await shiftRotationApiService.create({
            code: normalizeRotationText(value.code).toUpperCase(),
            name: normalizeRotationText(value.name),
            shiftGroupId: value.shiftGroupId,
            observation: value.observation.trim() || null,
          });
      onSaved(saved);
    } catch (reason) {
      setError(humanizeRotationMessage(getUserErrorMessage(reason, "No pudimos guardar la rotación.")));
    } finally {
      setBusy(false);
    }
  };

  const unchanged = Boolean(rotation) && Object.keys(changedFields(rotation!, value)).length === 0;

  return (
    <Modal
      title={rotation ? "Editar rotación" : "Crear rotación"}
      subtitle={rotation ? undefined : "La rotación se crea inactiva. Después vas a configurar sus equipos, la grilla del ciclo y las personas."}
      close={close}
      closeDisabled={busy}
    >
      <form className="form-stack rotation-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="form-grid">
          <div className="field-stack">
            <label htmlFor={ids.code}>Código *</label>
            <input id={ids.code} data-modal-initial-focus={codeLocked ? undefined : true} value={value.code} maxLength={30} spellCheck={false} autoCapitalize="characters" disabled={codeLocked || busy} aria-invalid={errors.code ? true : undefined} aria-describedby={describedBy(ids.code, messages.code)} onChange={(event) => set("code")(event.target.value.toUpperCase())} placeholder="Ej: PLANTA-4X4" />
            <FieldMessages id={ids.code} {...messages.code} />
          </div>
          <div className="field-stack">
            <label htmlFor={ids.name}>Nombre *</label>
            <input id={ids.name} data-modal-initial-focus={codeLocked ? true : undefined} value={value.name} maxLength={80} disabled={busy} aria-invalid={errors.name ? true : undefined} aria-describedby={describedBy(ids.name, messages.name)} onChange={(event) => set("name")(event.target.value)} placeholder="Ej: Planta 4x4" />
            <FieldMessages id={ids.name} {...messages.name} />
          </div>
          <div className="field-stack rotation-form-full">
            <label htmlFor={ids.group}>Grupo (lugar) *</label>
            <select id={ids.group} value={value.shiftGroupId} disabled={groupLocked || busy} aria-invalid={errors.shiftGroupId ? true : undefined} aria-describedby={describedBy(ids.group, messages.group)} onChange={(event) => set("shiftGroupId")(event.target.value)}>
              <option value="">Seleccionar grupo</option>
              {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <FieldMessages id={ids.group} {...messages.group} />
          </div>
          <div className="field-stack rotation-form-full">
            <label htmlFor={ids.observation}>Observación</label>
            <textarea id={ids.observation} rows={3} value={value.observation} maxLength={500} spellCheck lang="es-AR" disabled={busy} aria-invalid={errors.observation ? true : undefined} aria-describedby={describedBy(ids.observation, messages.observation)} onChange={(event) => set("observation")(event.target.value)} />
            <FieldMessages id={ids.observation} {...messages.observation} />
          </div>
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <FormActions>
          <Button type="button" onClick={close} disabled={busy}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={busy || unchanged}>{rotation ? "Guardar cambios" : "Crear rotación"}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
