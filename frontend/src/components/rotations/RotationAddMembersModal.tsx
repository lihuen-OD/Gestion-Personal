import { AlertTriangle } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormActions } from "../ui/FormControls";
import { describedBy, FieldMessages } from "../ui/FieldMessages";
import { EmployeeRemoteSelector } from "../employees/EmployeeRemoteSelector";
import { shiftRotationApiService, type ShiftRotation } from "../../services/api/shiftRotationApiService";
import type { Employee } from "../../types";
import { formatCalendarDate } from "../../utils/date";
import { addDaysKey } from "../../utils/shiftRotationDraft";
import { describeMemberError, fixedAssignmentText, MAX_MEMBERS_PER_ADD, type MemberActionError } from "../../utils/shiftRotationMembers";

/**
 * Alta de personas en un equipo (R4.8C, sólo RRHH): hasta 50 por vez, desde
 * mañana, con fin opcional. Si el backend informa turnos fijos superpuestos,
 * se explican y RRHH decide si repetir el alta cerrándolos (opción explícita
 * del contrato); nunca se cierran sin esa confirmación. Ante cualquier error
 * se conservan la selección y las fechas.
 */
export function RotationAddMembersModal({ rotation, todayKey, close, onAdded }: { rotation: ShiftRotation; todayKey: string; close: () => void; onAdded: (summary: { added: number; closedFixedAssignments: number }) => void }) {
  const crews = rotation.crews.filter((crew) => crew.status === "ACTIVO").sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const tomorrow = addDaysKey(todayKey, 1);
  const [crewId, setCrewId] = useState(crews.length === 1 ? crews[0]!.id : "");
  const [from, setFrom] = useState(tomorrow);
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<Employee[]>([]);
  const [closeFixed, setCloseFixed] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<"crew" | "from" | "to" | "employees", string>>>({});
  const [failure, setFailure] = useState<MemberActionError | null>(null);
  const [busy, setBusy] = useState(false);
  const baseId = useId();
  const ids = { crew: `${baseId}-crew`, from: `${baseId}-from`, to: `${baseId}-to`, employees: `${baseId}-employees`, closeFixed: `${baseId}-close-fixed` };
  const fixedConflicts = failure?.fixedAssignments ?? [];
  const tooMany = selected.length > MAX_MEMBERS_PER_ADD;

  const messages = {
    crew: { hint: errors.crew ? undefined : crews.length ? undefined : "No hay equipos activos: activá o creá uno en «Equipos y grilla».", error: errors.crew },
    from: { hint: errors.from ? undefined : `Desde el ${formatCalendarDate(tomorrow)} o posterior.`, error: errors.from },
    to: { hint: errors.to ? undefined : "Opcional. Sin fecha, la persona sigue en la rotación hasta que se la dé de baja.", error: errors.to },
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const next: typeof errors = {};
    if (!crewId) next.crew = "Elegí el equipo.";
    if (!from) next.from = "Indicá desde qué fecha.";
    else if (from < tomorrow) next.from = `Elegí el ${formatCalendarDate(tomorrow)} o una fecha posterior.`;
    if (to && from && to < from) next.to = "La fecha de fin no puede ser anterior a la de inicio.";
    if (!selected.length) next.employees = "Elegí al menos una persona.";
    else if (tooMany) next.employees = `Podés incorporar hasta ${MAX_MEMBERS_PER_ADD} personas por vez.`;
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const result = await shiftRotationApiService.addMembers(rotation.id, crewId, {
        employeeIds: selected.map((employee) => employee.id),
        effectiveFrom: from,
        effectiveTo: to || null,
        closeFixedAssignments: fixedConflicts.length > 0 && closeFixed,
      });
      onAdded({ added: result.members.length, closedFixedAssignments: result.closedFixedAssignments });
    } catch (reason) {
      const described = describeMemberError(reason, "No pudimos incorporar a las personas. Revisá los datos y volvé a intentar.");
      setFailure(described);
      if (!described.fixedAssignments.length) setCloseFixed(false);
    } finally {
      setBusy(false);
    }
  };

  // Si cambian las personas o las fechas, la lista de turnos fijos mostrada ya no corresponde: la confirmación se vuelve a pedir.
  const edited = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    if (fixedConflicts.length) {
      setFailure(null);
      setCloseFixed(false);
    }
  };

  const submitLabel = fixedConflicts.length && closeFixed ? "Cerrar turnos fijos e incorporar" : "Incorporar personas";

  return (
    <Modal title="Incorporar personas" subtitle={`Rotación ${rotation.name}. Cada persona sigue la fila de su equipo en la grilla desde la fecha de inicio.`} close={close} closeDisabled={busy} size="wide">
      <form className="form-stack rotation-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="form-grid rotation-members-form-grid">
          <div className="field-stack">
            <label htmlFor={ids.crew}>Equipo *</label>
            <select id={ids.crew} value={crewId} data-modal-initial-focus disabled={busy} aria-invalid={errors.crew ? true : undefined} aria-describedby={describedBy(ids.crew, messages.crew)} onChange={(event) => edited(setCrewId)(event.target.value)}>
              <option value="">Elegí un equipo</option>
              {crews.map((crew) => <option key={crew.id} value={crew.id}>{crew.name} (equipo {crew.code})</option>)}
            </select>
            <FieldMessages id={ids.crew} {...messages.crew} />
          </div>
          <div className="field-stack">
            <label htmlFor={ids.from}>Desde *</label>
            <input id={ids.from} type="date" min={tomorrow} value={from} disabled={busy} aria-invalid={errors.from ? true : undefined} aria-describedby={describedBy(ids.from, messages.from)} onChange={(event) => edited(setFrom)(event.target.value)} />
            <FieldMessages id={ids.from} {...messages.from} />
          </div>
          <div className="field-stack">
            <label htmlFor={ids.to}>Hasta</label>
            <input id={ids.to} type="date" min={from || tomorrow} value={to} disabled={busy} aria-invalid={errors.to ? true : undefined} aria-describedby={describedBy(ids.to, messages.to)} onChange={(event) => edited(setTo)(event.target.value)} />
            <FieldMessages id={ids.to} {...messages.to} />
          </div>
        </div>

        <fieldset className="rotation-members-picker" aria-describedby={`${ids.employees}-count`}>
          <legend>Personas *</legend>
          <EmployeeRemoteSelector selected={selected} multiple onChange={(next) => { edited(setSelected)(next); setErrors((current) => ({ ...current, employees: undefined })); }} />
          <p id={`${ids.employees}-count`} className={`rotation-members-count${tooMany ? " is-over" : ""}`} aria-live="polite">
            {tooMany ? `Elegiste ${selected.length} personas: el máximo es ${MAX_MEMBERS_PER_ADD} por vez.` : `Hasta ${MAX_MEMBERS_PER_ADD} personas por vez. Sólo se ofrecen personas activas.`}
          </p>
          {errors.employees ? <small className="field-error" role="alert">{errors.employees}</small> : null}
        </fieldset>

        {fixedConflicts.length ? (
          <div className="rotation-fixed-conflict" role="alert">
            <p className="rotation-fixed-conflict-title"><AlertTriangle size={16} aria-hidden="true" />{failure!.message}</p>
            <ul>{fixedConflicts.map((conflict) => <li key={`${conflict.employee}-${conflict.template}-${conflict.effectiveFrom}`}>{fixedAssignmentText(conflict)}</li>)}</ul>
            <p>Una persona no puede tener turno fijo y rotación a la vez. Podés elegir otras fechas o cerrar esos turnos fijos al incorporarlas: los que ya rigen terminan el {formatCalendarDate(addDaysKey(from, -1))} (día anterior al alta) y los que empiezan después quedan deshabilitados. Queda registrado en la auditoría.</p>
            <div className="rotation-fixed-conflict-check">
              <input id={ids.closeFixed} type="checkbox" checked={closeFixed} disabled={busy} onChange={(event) => setCloseFixed(event.target.checked)} />
              <label htmlFor={ids.closeFixed}>Cerrar estos turnos fijos al incorporar a las personas</label>
            </div>
          </div>
        ) : failure ? (
          <div className="rotation-save-error" role="alert">
            <p className="rotation-save-error-title"><AlertTriangle size={16} aria-hidden="true" />{failure.message}</p>
            {failure.details.length ? <ul>{failure.details.map((line) => <li key={line}>{line}</li>)}</ul> : null}
            <p className="rotation-save-error-hint">La selección y las fechas se conservaron: corregí y volvé a intentar.</p>
          </div>
        ) : null}

        <FormActions>
          <Button type="button" onClick={close} disabled={busy}>Cancelar</Button>
          <Button type="submit" variant={fixedConflicts.length && closeFixed ? "danger" : "primary"} loading={busy} disabled={busy || !crews.length}>{busy ? "Incorporando..." : submitLabel}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
