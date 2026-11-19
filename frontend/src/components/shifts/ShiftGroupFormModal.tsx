import { useId, useState, type FormEvent } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormActions } from "../ui/FormControls";
import { describedBy, FieldMessages } from "../ui/FieldMessages";
import { getUserErrorMessage } from "../../services/api/apiClient";
import { shiftGroupApiService, type ShiftGroup } from "../../services/api/shiftGroupApiService";

/** Misma normalización que el backend: sin espacios en los extremos ni repetidos. */
export function normalizeShiftGroupText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export type ShiftGroupFormErrors = Partial<Record<"code" | "name" | "sortOrder", string>>;

export function validateShiftGroupForm(value: { code: string; name: string; sortOrder: string }): ShiftGroupFormErrors {
  const errors: ShiftGroupFormErrors = {};
  const code = normalizeShiftGroupText(value.code);
  const name = normalizeShiftGroupText(value.name);
  if (code.length < 2) errors.code = "Ingresá un código de al menos 2 caracteres.";
  else if (code.length > 30) errors.code = "El código no puede superar los 30 caracteres.";
  if (name.length < 2) errors.name = "Ingresá un nombre de al menos 2 caracteres.";
  else if (name.length > 60) errors.name = "El nombre no puede superar los 60 caracteres.";
  const order = Number(value.sortOrder);
  if (value.sortOrder.trim() === "" || !Number.isInteger(order) || order < 0 || order > 9999) errors.sortOrder = "Ingresá un número entero entre 0 y 9999.";
  return errors;
}

/**
 * Alta y edición de un grupo de turnos (sólo RRHH). El estado se cambia
 * desde la acción Activar/Inactivar de la lista, con su explicación.
 */
export function ShiftGroupFormModal({ group, suggestedOrder, close, onSaved }: { group: ShiftGroup | null; suggestedOrder: number; close: () => void; onSaved: (saved: ShiftGroup) => void }) {
  const [code, setCode] = useState(group?.code ?? "");
  const [name, setName] = useState(group?.name ?? "");
  const [sortOrder, setSortOrder] = useState(String(group?.sortOrder ?? suggestedOrder));
  const [errors, setErrors] = useState<ShiftGroupFormErrors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const baseId = useId();
  const ids = { code: `${baseId}-code`, name: `${baseId}-name`, sortOrder: `${baseId}-order` };
  // La ayuda se reemplaza por el error cuando hay uno (mismos datos para el texto y para aria-describedby).
  const messages = {
    code: { hint: errors.code ? undefined : "Se guarda en mayúsculas.", error: errors.code },
    name: { error: errors.name },
    sortOrder: { hint: errors.sortOrder ? undefined : "Los grupos se listan de menor a mayor orden.", error: errors.sortOrder },
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const nextErrors = validateShiftGroupForm({ code, name, sortOrder });
    setErrors(nextErrors);
    setError("");
    if (Object.keys(nextErrors).length) return;
    const payload = { code: normalizeShiftGroupText(code).toUpperCase(), name: normalizeShiftGroupText(name), sortOrder: Number(sortOrder) };
    setBusy(true);
    try {
      const saved = group
        ? await shiftGroupApiService.update(group.id, {
            ...(payload.code !== group.code ? { code: payload.code } : {}),
            ...(payload.name !== group.name ? { name: payload.name } : {}),
            ...(payload.sortOrder !== group.sortOrder ? { sortOrder: payload.sortOrder } : {}),
          })
        : await shiftGroupApiService.create(payload);
      onSaved(saved);
    } catch (reason) {
      setError(getUserErrorMessage(reason, "No pudimos guardar el grupo."));
    } finally {
      setBusy(false);
    }
  };

  const unchanged = Boolean(group) && normalizeShiftGroupText(code).toUpperCase() === group!.code && normalizeShiftGroupText(name) === group!.name && Number(sortOrder) === group!.sortOrder;

  return (
    <Modal title={group ? "Editar grupo" : "Crear grupo"} subtitle="El grupo es el lugar donde se trabaja el turno (Planta, Granja, Oficina…). La función del turno sigue en su categoría." close={close} closeDisabled={busy}>
      <form className="form-stack shift-group-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="form-grid">
          <div className="field-stack">
            <label htmlFor={ids.code}>Código *</label>
            <input id={ids.code} data-modal-initial-focus value={code} maxLength={30} spellCheck={false} autoCapitalize="characters" aria-invalid={errors.code ? true : undefined} aria-describedby={describedBy(ids.code, messages.code)} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Ej: PLANTA" />
            <FieldMessages id={ids.code} {...messages.code} />
          </div>
          <div className="field-stack">
            <label htmlFor={ids.name}>Nombre *</label>
            <input id={ids.name} value={name} maxLength={60} aria-invalid={errors.name ? true : undefined} aria-describedby={describedBy(ids.name, messages.name)} onChange={(event) => setName(event.target.value)} placeholder="Ej: Planta" />
            <FieldMessages id={ids.name} {...messages.name} />
          </div>
          <div className="field-stack">
            <label htmlFor={ids.sortOrder}>Orden *</label>
            <input id={ids.sortOrder} type="number" inputMode="numeric" min={0} max={9999} step={1} value={sortOrder} aria-invalid={errors.sortOrder ? true : undefined} aria-describedby={describedBy(ids.sortOrder, messages.sortOrder)} onChange={(event) => setSortOrder(event.target.value)} />
            <FieldMessages id={ids.sortOrder} {...messages.sortOrder} />
          </div>
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <FormActions>
          <Button type="button" onClick={close} disabled={busy}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={busy || unchanged}>{group ? "Guardar cambios" : "Crear grupo"}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
