import { AlertTriangle } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormActions } from "../ui/FormControls";
import { describedBy, FieldMessages } from "../ui/FieldMessages";
import { shiftRotationApiService, type ShiftRotation, type ShiftRotationMember, type ShiftRotationWithoutFixedShift } from "../../services/api/shiftRotationApiService";
import { formatCalendarDate } from "../../utils/date";
import { closeRange, describeMemberError, membershipRangeText, moveRange, type MemberActionError } from "../../utils/shiftRotationMembers";

export type MemberDateAction = "close" | "move";

function rangeHint(range: { min: string; max: string | null }) {
  return range.max ? `Entre el ${formatCalendarDate(range.min)} y el ${formatCalendarDate(range.max)}.` : `Desde el ${formatCalendarDate(range.min)} o posterior.`;
}

/**
 * Baja (último día) o cambio de equipo (desde una fecha) de una membresía
 * (R4.8C, sólo RRHH). Las fechas propuestas son las que acepta el backend;
 * si igual rechaza la operación, el formulario se conserva con el mensaje.
 */
export function RotationMemberDateModal({ action, member, rotation, todayKey, close, onDone }: {
  action: MemberDateAction;
  member: ShiftRotationMember;
  rotation: ShiftRotation;
  todayKey: string;
  close: () => void;
  onDone: (result: { message: string; withoutFixedShift: ShiftRotationWithoutFixedShift[] }) => void;
}) {
  const range = (action === "close" ? closeRange(member, todayKey) : moveRange(member, todayKey))!;
  const targets = rotation.crews.filter((crew) => crew.status === "ACTIVO" && crew.id !== member.crewId).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const [date, setDate] = useState(range.min);
  const [crewId, setCrewId] = useState(targets.length === 1 ? targets[0]!.id : "");
  const [errors, setErrors] = useState<Partial<Record<"date" | "crew", string>>>({});
  const [failure, setFailure] = useState<MemberActionError | null>(null);
  const [busy, setBusy] = useState(false);
  const baseId = useId();
  const ids = { date: `${baseId}-date`, crew: `${baseId}-crew` };
  const isClose = action === "close";
  const messages = {
    date: { hint: errors.date ? undefined : rangeHint(range), error: errors.date },
    crew: { hint: errors.crew ? undefined : targets.length ? undefined : "No hay otro equipo activo en la rotación.", error: errors.crew },
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const next: typeof errors = {};
    if (!date) next.date = isClose ? "Indicá el último día." : "Indicá desde qué fecha.";
    else if (date < range.min || (range.max !== null && date > range.max)) next.date = `Elegí una fecha válida. ${rangeHint(range)}`;
    if (!isClose && !crewId) next.crew = "Elegí el equipo nuevo.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setFailure(null);
    try {
      if (isClose) {
        const result = await shiftRotationApiService.closeMember(rotation.id, member.id, date);
        onDone({ message: `Se dio de baja a ${member.employee} con último día ${formatCalendarDate(date)}.`, withoutFixedShift: result.withoutFixedShiftAfter });
      } else {
        await shiftRotationApiService.moveMember(rotation.id, member.id, crewId, date);
        const target = targets.find((crew) => crew.id === crewId)!;
        onDone({ message: `${member.employee} pasa a ${target.name} desde el ${formatCalendarDate(date)}.`, withoutFixedShift: [] });
      }
    } catch (reason) {
      setFailure(describeMemberError(reason, isClose ? "No pudimos dar de baja a la persona." : "No pudimos cambiar de equipo a la persona."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isClose ? "Dar de baja de la rotación" : "Cambiar de equipo"}
      subtitle={`${member.employee} · ${member.crew} · ${membershipRangeText(member)}`}
      close={close}
      closeDisabled={busy}
    >
      <form className="form-stack rotation-form" onSubmit={(event) => void submit(event)} noValidate>
        <p className="rotation-modal-lead">
          {isClose
            ? "El último día se trabaja completo, incluido un turno nocturno que empiece ese día. El período queda en el historial."
            : "La pertenencia actual termina el día anterior y la nueva empieza en la fecha elegida, en una sola operación. El período anterior queda en el historial."}
        </p>
        <div className="form-grid">
          {!isClose ? (
            <div className="field-stack">
              <label htmlFor={ids.crew}>Equipo nuevo *</label>
              <select id={ids.crew} value={crewId} disabled={busy} data-modal-initial-focus aria-invalid={errors.crew ? true : undefined} aria-describedby={describedBy(ids.crew, messages.crew)} onChange={(event) => setCrewId(event.target.value)}>
                <option value="">Elegí un equipo</option>
                {targets.map((crew) => <option key={crew.id} value={crew.id}>{crew.name} (equipo {crew.code})</option>)}
              </select>
              <FieldMessages id={ids.crew} {...messages.crew} />
            </div>
          ) : null}
          <div className="field-stack">
            <label htmlFor={ids.date}>{isClose ? "Último día *" : "Desde *"}</label>
            <input id={ids.date} type="date" min={range.min} max={range.max ?? undefined} value={date} disabled={busy} data-modal-initial-focus={isClose ? true : undefined} aria-invalid={errors.date ? true : undefined} aria-describedby={describedBy(ids.date, messages.date)} onChange={(event) => setDate(event.target.value)} />
            <FieldMessages id={ids.date} {...messages.date} />
          </div>
        </div>
        {isClose ? <p className="field-hint rotation-modal-note">Al confirmar, el sistema informa si la persona queda sin turno fijo ni otra rotación desde el día siguiente.</p> : null}
        {failure ? (
          <div className="rotation-save-error" role="alert">
            <p className="rotation-save-error-title"><AlertTriangle size={16} aria-hidden="true" />{failure.message}</p>
            {failure.details.length ? <ul>{failure.details.map((line) => <li key={line}>{line}</li>)}</ul> : null}
          </div>
        ) : null}
        <FormActions>
          <Button type="button" onClick={close} disabled={busy}>Cancelar</Button>
          <Button type="submit" variant={isClose ? "danger" : "primary"} loading={busy} disabled={busy || (!isClose && !targets.length)}>
            {busy ? "Guardando..." : isClose ? "Dar de baja" : "Cambiar de equipo"}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
