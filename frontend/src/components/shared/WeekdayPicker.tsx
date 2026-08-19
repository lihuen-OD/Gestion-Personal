import { WEEKDAY_DISPLAY_ORDER, WEEKDAY_LABELS, toggleWeekday } from "../../utils/shiftAssignment";

// Selector de días de la semana compartido entre el formulario de asignar
// turno desde legajo (EmployeeShiftsPanel) y desde turno (ShiftEmployeesPanel),
// Etapa 8I — un solo lugar con la lógica de toggle, para no duplicarla entre
// los dos formularios. Reutiliza la clase "weekday-picker" ya definida para
// el selector semanal de WorkScheduleSettingsPage.
export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (weekdays: number[]) => void }) {
  return (
    <div className="weekday-picker">
      {WEEKDAY_DISPLAY_ORDER.map((day) => (
        <label key={day}>
          <input type="checkbox" checked={value.includes(day)} onChange={() => onChange(toggleWeekday(value, day))} />
          {WEEKDAY_LABELS[day]}
        </label>
      ))}
    </div>
  );
}
