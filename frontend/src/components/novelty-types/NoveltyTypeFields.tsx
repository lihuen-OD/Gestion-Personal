import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { describedBy, FieldMessages, type FieldMessagesProps } from "../ui/FieldMessages";
import type {
  FinnegansValueUnit,
  NoveltyTimeEntryBehavior,
  NoveltyType,
  NoveltyTypeKind,
  NoveltyUiColor,
} from "../../types/noveltyType.types";
import { noveltyColorClass, noveltyUiColors } from "../../utils/noveltyColor";
import { defaultNoveltyTypeCoverage, noveltyTypeIssues } from "../../utils/noveltyTypeCoverage";

export const noveltyKinds: NoveltyTypeKind[] = ["AUSENCIA", "LICENCIA", "HORARIA", "ACCIDENTE", "VACACIONES", "SANCION", "OTRO"];

// Etapa 15M.20: nunca mostrar el enum crudo del backend en pantalla -- único
// punto de verdad para la etiqueta humana de cada categoría de novedad.
export const noveltyKindLabels: Record<NoveltyTypeKind, string> = {
  AUSENCIA: "Ausencia",
  LICENCIA: "Licencia",
  HORARIA: "Horaria",
  ACCIDENTE: "Accidente",
  VACACIONES: "Vacaciones",
  SANCION: "Sanción",
  OTRO: "Otro",
};

// Etapa 15L.2B (docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md):
// único control visible de comportamiento horario. Etapa 15L.6
// (docs/decisions/NOVELTY_TYPE_LEGACY_REMOVAL_15L6.md): retiró los campos
// legacy que reemplazaba (blocksTimeEntry/setsWorkedHoursToZero/timeImpact).
export const noveltyTimeEntryBehaviors: NoveltyTimeEntryBehavior[] = ["NO_BLOQUEA", "BLOQUEA_NUEVA_CARGA"];
export const noveltyTimeEntryBehaviorLabels: Record<NoveltyTimeEntryBehavior, string> = {
  NO_BLOQUEA: "No bloquea la carga horaria",
  BLOQUEA_NUEVA_CARGA: "Bloquea nueva carga horaria cuando la novedad está aprobada",
};
export const noveltyTimeEntryBehaviorDescriptions: Record<NoveltyTimeEntryBehavior, string> = {
  NO_BLOQUEA: "La novedad se muestra como contexto, pero no impide cargar horas.",
  BLOQUEA_NUEVA_CARGA:
    "Cuando la novedad está aprobada, evita crear nuevas cargas horarias para ese día. No modifica horas ya registradas.",
};
export function noveltyTimeEntryBehaviorLabel(value?: string) {
  return noveltyTimeEntryBehaviorLabels[value as NoveltyTimeEntryBehavior] || noveltyTimeEntryBehaviorLabels.NO_BLOQUEA;
}

// Unidad real de "Valor 1" para exportación Finnegans.
export const finnegansValueUnits: FinnegansValueUnit[] = ["HOURS", "DAYS", "UNIT"];
export const finnegansValueUnitLabels: Record<FinnegansValueUnit, string> = {
  HOURS: "Horas",
  DAYS: "Días",
  UNIT: "Unidad",
};
export const finnegansValueUnitDescriptions: Record<FinnegansValueUnit, string> = {
  HOURS: "Valor 1 se toma de la cantidad de horas cargada en la novedad.",
  DAYS: "Valor 1 se toma de la cantidad de días cargada en la novedad.",
  UNIT: "Valor 1 se exporta como 1.",
};

export const roleOptions = ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"] as const;
export const noveltyUiColorLabels: Record<NoveltyUiColor, string> = {
  blue: "Azul",
  orange: "Naranja",
  violet: "Violeta",
  emerald: "Esmeralda",
  red: "Rojo",
  cyan: "Cian",
  fuchsia: "Fucsia",
  yellow: "Mostaza",
  pine: "Verde pino",
  pink: "Rosa",
  indigo: "Índigo",
  lime: "Lima",
  brown: "Marrón",
  sky: "Celeste",
  tangerine: "Naranja oscuro",
  purple: "Púrpura",
  green: "Verde",
  rose: "Bordó",
  slate: "Pizarra",
  amber: "Ámbar",
  magenta: "Magenta",
  teal: "Turquesa",
  navy: "Azul marino",
};

export function emptyNoveltyType(): NoveltyType {
  return {
    id: "",
    code: "",
    name: "",
    uiColor: "blue",
    kind: "AUSENCIA",
    description: "",
    status: "ACTIVO",
    rules: {
      exportsToFinnegans: false,
      requiresApproval: true,
      requiresDocumentation: false,
      allowsHours: false,
      timeEntryBehavior: "NO_BLOQUEA",
      allowsDateRange: true,
      finnegansValueUnit: null,
      finnegansRequiresValidity: false,
      requiresObservation: false,
    },
    coverage: defaultNoveltyTypeCoverage(),
    allowedLoadRoles: ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"],
    approvalRoles: ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión"],
    finnegansCode: null,
    finnegansName: null,
    notes: "",
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    updatedBy: "",
  };
}

// Etapa 15L.2B, punto 27: validación compartida entre creación y edición.
// Etapa 7: delega en noveltyTypeIssues (que también marca cada campo).
export function validateNoveltyType(item: NoveltyType): string | null {
  return noveltyTypeIssues(item)[0]?.message ?? null;
}

export function TextField({ label, value, onChange, disabled, readOnly, placeholder, type = "text", spellCheck = false, hint, error }: { label: string; value: string | number; onChange: (value: string) => void; disabled?: boolean; readOnly?: boolean; placeholder?: string; type?: string; spellCheck?: InputHTMLAttributes<HTMLInputElement>["spellCheck"] } & FieldMessagesProps) {
  const id = useId();
  const input = <input type={type} value={value} disabled={disabled} readOnly={readOnly} placeholder={placeholder} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, { hint, error })} spellCheck={spellCheck} lang={spellCheck ? "es-AR" : undefined} onChange={(event) => onChange(event.target.value)} />;
  if (!hint && !error) return <label>{label}{input}</label>;
  return <div className="field-stack"><label>{label}{input}</label><FieldMessages id={id} hint={hint} error={error} /></div>;
}

// Etapa 15M.20: `labels` es opcional -- humaniza el texto visible de cada
// <option> sin tocar el `value` (sigue siendo el enum crudo que espera el
// backend). Sin `labels`, se comporta como antes.
export function SelectField({ label, value, onChange, options, labels, disabled }: { label: string; value: string; onChange: (value: string) => void; options: readonly string[]; labels?: Record<string, string>; disabled?: boolean }) {
  return <label>{label}<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{labels?.[option] ?? option}</option>)}</select></label>;
}

export function TextAreaField({ label, value, onChange, disabled, spellCheck = true, hint, error }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; spellCheck?: TextareaHTMLAttributes<HTMLTextAreaElement>["spellCheck"] } & FieldMessagesProps) {
  const id = useId();
  const textarea = <textarea value={value} disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, { hint, error })} spellCheck={spellCheck} lang={spellCheck ? "es-AR" : undefined} onChange={(event) => onChange(event.target.value)} />;
  if (!hint && !error) return <label>{label}{textarea}</label>;
  return <div className="field-stack"><label>{label}{textarea}</label><FieldMessages id={id} hint={hint} error={error} /></div>;
}

export function RoleChecklist({ label, value, onChange, disabled }: { label: string; value: string[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  const toggle = (role: string) => onChange(value.includes(role) ? value.filter((item) => item !== role) : [...value, role]);
  return <div className="catalog-check-block"><small>{label}</small><div className="check-grid inline">{roleOptions.map((role) => <label className="check-card" key={role}><input type="checkbox" disabled={disabled} checked={value.includes(role)} onChange={() => toggle(role)} />{role}</label>)}</div></div>;
}

// Etapa 15L.2B: se quitó la validación de "color ya usado" -- vivía rota
// (usedColors nunca se poblaba con los colores de otros tipos, ver 15L.1
// §18/§25/§23) y, auditado, no hay ninguna regla de negocio real que exija
// unicidad de color. Es sólo una ayuda visual: permitir colores repetidos.
// Etapa 7: muestras compactas + vista previa del chip tal como se ve en la
// grilla (mismas clases novelty-color-*, que ya fijan el contraste del texto).
export function NoveltyColorField({ value, onChange, previewLabel, disabled }: { value: NoveltyUiColor; onChange: (value: NoveltyUiColor) => void; previewLabel: string; disabled?: boolean }) {
  return <div className="novelty-color-field">
    <div className="novelty-color-field-head">
      <span id="novelty-color-label">Color en carga horaria</span>
      <span className="novelty-color-preview">Vista previa: <span className={`cell-novelty-pill ${noveltyColorClass(value, value)}`}>{previewLabel.trim() || "Nueva novedad"}</span><span className="novelty-color-name">{noveltyUiColorLabels[value]}</span></span>
    </div>
    <div className="novelty-color-swatches" role="group" aria-labelledby="novelty-color-label">
      {noveltyUiColors.map((color) => (
        <button
          key={color}
          type="button"
          className={`novelty-color-swatch${value === color ? " active" : ""}`}
          aria-pressed={value === color}
          aria-label={noveltyUiColorLabels[color]}
          title={noveltyUiColorLabels[color]}
          disabled={disabled}
          onClick={() => onChange(color)}
        ><span aria-hidden="true" className={`cell-novelty-pill ${noveltyColorClass(color, color)}`}>Aa</span></button>
      ))}
    </div>
  </div>;
}
