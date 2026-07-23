import type { ShiftTemplate } from "../../services/api/workforceApiService";

export type ShiftTemplateFormValue = {
  code: string;
  name: string;
  description: string;
  categoryName: string;
  startTime: string;
  endTime: string;
  entryToleranceBeforeMinutes: number;
  entryToleranceAfterMinutes: number;
  exitToleranceBeforeMinutes: number;
  exitToleranceAfterMinutes: number;
  minimumMinutesForCompliance: number | "";
  maximumInformativeMinutes: number | "";
  missingOutAlertAfterMinutes: number | "";
  absoluteOpenShiftLimitMinutes: number;
  status: "ACTIVO" | "INACTIVO";
};

export function emptyShiftTemplate(): ShiftTemplateFormValue {
  return {
    code: "",
    name: "",
    description: "",
    categoryName: "",
    startTime: "08:00",
    endTime: "16:00",
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 20,
    exitToleranceAfterMinutes: 20,
    minimumMinutesForCompliance: "",
    maximumInformativeMinutes: "",
    missingOutAlertAfterMinutes: "",
    absoluteOpenShiftLimitMinutes: 1200,
    status: "ACTIVO",
  };
}

export function shiftTemplateToFormValue(item: ShiftTemplate): ShiftTemplateFormValue {
  return {
    code: item.code,
    name: item.name,
    description: item.description || "",
    categoryName: item.categoryName || "",
    startTime: item.startTime,
    endTime: item.endTime,
    entryToleranceBeforeMinutes: item.entryToleranceBeforeMinutes,
    entryToleranceAfterMinutes: item.entryToleranceAfterMinutes,
    exitToleranceBeforeMinutes: item.exitToleranceBeforeMinutes,
    exitToleranceAfterMinutes: item.exitToleranceAfterMinutes,
    minimumMinutesForCompliance: item.minimumMinutesForCompliance ?? "",
    maximumInformativeMinutes: item.maximumInformativeMinutes ?? "",
    missingOutAlertAfterMinutes: item.missingOutAlertAfterMinutes ?? "",
    absoluteOpenShiftLimitMinutes: item.absoluteOpenShiftLimitMinutes,
    status: (item.status as "ACTIVO" | "INACTIVO") || "ACTIVO",
  };
}

export function shiftTemplateFormToInput(value: ShiftTemplateFormValue) {
  return {
    code: value.code.trim(),
    name: value.name.trim(),
    description: value.description.trim() || null,
    categoryName: value.categoryName.trim() || null,
    startTime: value.startTime,
    endTime: value.endTime,
    entryToleranceBeforeMinutes: Number(value.entryToleranceBeforeMinutes),
    entryToleranceAfterMinutes: Number(value.entryToleranceAfterMinutes),
    exitToleranceBeforeMinutes: Number(value.exitToleranceBeforeMinutes),
    exitToleranceAfterMinutes: Number(value.exitToleranceAfterMinutes),
    minimumMinutesForCompliance: value.minimumMinutesForCompliance === "" ? null : Number(value.minimumMinutesForCompliance),
    maximumInformativeMinutes: value.maximumInformativeMinutes === "" ? null : Number(value.maximumInformativeMinutes),
    missingOutAlertAfterMinutes: value.missingOutAlertAfterMinutes === "" ? null : Number(value.missingOutAlertAfterMinutes),
    absoluteOpenShiftLimitMinutes: Number(value.absoluteOpenShiftLimitMinutes),
    status: value.status,
  };
}

function minutesOfDay(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

export function previewShiftSchedule(startTime: string, endTime: string) {
  const crossesMidnight = endTime <= startTime;
  const start = minutesOfDay(startTime);
  const end = minutesOfDay(endTime);
  const expectedMinutes = crossesMidnight ? 24 * 60 - start + end : end - start;
  return { crossesMidnight, expectedMinutes };
}

export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function ShiftTemplateFormFields({ value, onChange, disabled }: { value: ShiftTemplateFormValue; onChange: (value: ShiftTemplateFormValue) => void; disabled?: boolean }) {
  const set = (patch: Partial<ShiftTemplateFormValue>) => onChange({ ...value, ...patch });
  const { crossesMidnight, expectedMinutes } = previewShiftSchedule(value.startTime, value.endTime);

  return (
    <div className="shift-template-fields">
      <div className="form-grid">
        <label className="field"><span>Código</span><input required disabled={disabled} value={value.code} onChange={(e) => set({ code: e.target.value })} /></label>
        <label className="field"><span>Nombre</span><input required disabled={disabled} value={value.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="field"><span>Categoría / tipo</span><input disabled={disabled} placeholder="Ej: Administrativo, Cosecha, Sereno" value={value.categoryName} onChange={(e) => set({ categoryName: e.target.value })} /></label>
        <label className="field"><span>Estado</span><select disabled={disabled} value={value.status} onChange={(e) => set({ status: e.target.value as "ACTIVO" | "INACTIVO" })}><option value="ACTIVO">Activo</option><option value="INACTIVO">Inactivo</option></select></label>
        <label className="field form-wide"><span>Descripción</span><textarea disabled={disabled} value={value.description} onChange={(e) => set({ description: e.target.value })} /></label>
      </div>

      <div className="form-grid">
        <label className="field"><span>Entrada esperada</span><input type="time" required disabled={disabled} value={value.startTime} onChange={(e) => set({ startTime: e.target.value })} /></label>
        <label className="field"><span>Salida esperada</span><input type="time" required disabled={disabled} value={value.endTime} onChange={(e) => set({ endTime: e.target.value })} /></label>
        <label className="field"><span>Cruza medianoche</span><input disabled value={crossesMidnight ? "Sí" : "No"} readOnly /></label>
        <label className="field"><span>Horas esperadas</span><input disabled value={formatMinutes(expectedMinutes)} readOnly /></label>
      </div>

      <div className="form-grid">
        <label className="field"><span>Margen entrada antes (min)</span><input type="number" min={0} max={180} disabled={disabled} value={value.entryToleranceBeforeMinutes} onChange={(e) => set({ entryToleranceBeforeMinutes: Number(e.target.value) })} /></label>
        <label className="field"><span>Margen entrada después (min)</span><input type="number" min={0} max={180} disabled={disabled} value={value.entryToleranceAfterMinutes} onChange={(e) => set({ entryToleranceAfterMinutes: Number(e.target.value) })} /></label>
        <label className="field"><span>Margen salida antes (min)</span><input type="number" min={0} max={180} disabled={disabled} value={value.exitToleranceBeforeMinutes} onChange={(e) => set({ exitToleranceBeforeMinutes: Number(e.target.value) })} /></label>
        <label className="field"><span>Margen salida después (min)</span><input type="number" min={0} max={180} disabled={disabled} value={value.exitToleranceAfterMinutes} onChange={(e) => set({ exitToleranceAfterMinutes: Number(e.target.value) })} /></label>
      </div>

      <div className="form-grid">
        <label className="field"><span>Mínimo informativo (min)</span><input type="number" min={0} max={1440} disabled={disabled} value={value.minimumMinutesForCompliance} placeholder="Sin definir" onChange={(e) => set({ minimumMinutesForCompliance: e.target.value === "" ? "" : Number(e.target.value) })} /></label>
        <label className="field"><span>Máximo informativo (min)</span><input type="number" min={0} max={1440} disabled={disabled} value={value.maximumInformativeMinutes} placeholder="Sin definir" onChange={(e) => set({ maximumInformativeMinutes: e.target.value === "" ? "" : Number(e.target.value) })} /></label>
        <label className="field"><span>Alerta de olvido de salida (min tras salida esperada)</span><input type="number" min={0} max={600} disabled={disabled} value={value.missingOutAlertAfterMinutes} placeholder="Sin definir" onChange={(e) => set({ missingOutAlertAfterMinutes: e.target.value === "" ? "" : Number(e.target.value) })} /></label>
        <label className="field"><span>Límite absoluto de jornada abierta (min)</span><input type="number" min={60} max={1440} required disabled={disabled} value={value.absoluteOpenShiftLimitMinutes} onChange={(e) => set({ absoluteOpenShiftLimitMinutes: Number(e.target.value) })} /></label>
      </div>
    </div>
  );
}
