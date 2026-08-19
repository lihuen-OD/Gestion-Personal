import { WeekdayPicker } from "./WeekdayPicker";

// Campos de vigencia (desde/hasta/días) compartidos entre el formulario de
// asignar turno desde legajo y desde turno (Etapa 8I) — mismo criterio que
// el resto de esta sesión: un solo lugar con la lógica del formulario, no
// dos copias con validaciones/labels que puedan divergir.
export function ShiftAssignmentVigencyFields({
  effectiveFrom,
  effectiveTo,
  weekdays,
  onEffectiveFromChange,
  onEffectiveToChange,
  onWeekdaysChange,
}: {
  effectiveFrom: string;
  effectiveTo: string;
  weekdays: number[];
  onEffectiveFromChange: (value: string) => void;
  onEffectiveToChange: (value: string) => void;
  onWeekdaysChange: (value: number[]) => void;
}) {
  return (
    <>
      <label className="field">
        <span>Desde *</span>
        <input type="date" required value={effectiveFrom} onChange={(event) => onEffectiveFromChange(event.target.value)} />
      </label>
      <label className="field">
        <span>Hasta (opcional)</span>
        <input type="date" value={effectiveTo} onChange={(event) => onEffectiveToChange(event.target.value)} min={effectiveFrom || undefined} />
      </label>
      <div className="field form-wide">
        <span>Días aplicables</span>
        <WeekdayPicker value={weekdays} onChange={onWeekdaysChange} />
        <small>Si no marcás ningún día, aplica todos los días.</small>
      </div>
    </>
  );
}
