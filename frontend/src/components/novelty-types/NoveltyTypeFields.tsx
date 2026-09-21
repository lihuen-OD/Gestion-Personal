import type {
  FinnegansValueUnit,
  NoveltyTimeEntryBehavior,
  NoveltyType,
  NoveltyTypeKind,
  NoveltyUiColor,
} from "../../types/noveltyType.types";
import { noveltyColorClass, noveltyUiColors } from "../../utils/noveltyColor";

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
  sky: "Celeste",
  cyan: "Cian",
  teal: "Turquesa",
  emerald: "Esmeralda",
  green: "Verde",
  lime: "Lima",
  amber: "Ambar",
  orange: "Naranja",
  red: "Rojo",
  rose: "Rosa oscuro",
  pink: "Rosa",
  violet: "Violeta",
  purple: "Purpura",
  slate: "Pizarra",
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
    },
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

// Etapa 15L.2B, punto 27: validación compartida entre creación y edición
// -- evita tener dos implementaciones distintas de la misma regla.
export function validateNoveltyType(item: NoveltyType): string | null {
  if (!item.name.trim()) return "Completá el nombre de la novedad.";
  if (!item.description.trim()) return "Completá la descripción funcional.";
  if (item.rules.exportsToFinnegans) {
    if (!item.finnegansCode?.trim() || !item.finnegansName?.trim()) {
      return "Para exportar a Finnegans completá el código y el nombre Finnegans.";
    }
    if (!item.rules.finnegansValueUnit) {
      return "Para exportar a Finnegans elegí la unidad de Valor 1.";
    }
  }
  return null;
}

export function TextField({ label, value, onChange, disabled, type = "text" }: { label: string; value: string | number; onChange: (value: string) => void; disabled?: boolean; type?: string }) {
  return <label>{label}<input type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

// Etapa 15M.20: `labels` es opcional -- humaniza el texto visible de cada
// <option> sin tocar el `value` (sigue siendo el enum crudo que espera el
// backend). Sin `labels`, se comporta como antes.
export function SelectField({ label, value, onChange, options, labels, disabled }: { label: string; value: string; onChange: (value: string) => void; options: readonly string[]; labels?: Record<string, string>; disabled?: boolean }) {
  return <label>{label}<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{labels?.[option] ?? option}</option>)}</select></label>;
}

export function TextAreaField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label>{label}<textarea value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function RoleChecklist({ label, value, onChange, disabled }: { label: string; value: string[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  const toggle = (role: string) => onChange(value.includes(role) ? value.filter((item) => item !== role) : [...value, role]);
  return <div className="catalog-check-block"><small>{label}</small><div className="check-grid inline">{roleOptions.map((role) => <label className="check-card" key={role}><input type="checkbox" disabled={disabled} checked={value.includes(role)} onChange={() => toggle(role)} />{role}</label>)}</div></div>;
}

// Etapa 15L.2B: se quitó la validación de "color ya usado" -- vivía rota
// (usedColors nunca se poblaba con los colores de otros tipos, ver 15L.1
// §18/§25/§23) y, auditado, no hay ninguna regla de negocio real que exija
// unicidad de color. Es sólo una ayuda visual: permitir colores repetidos.
export function NoveltyColorField({ value, onChange, disabled }: { value: NoveltyUiColor; onChange: (value: NoveltyUiColor) => void; disabled?: boolean }) {
  return <div className="catalog-check-block form-wide">
    <small>Color en carga horaria</small>
    <div className="novelty-color-grid">
      {noveltyUiColors.map((color) => {
        const active = value === color;
        return <button
          key={color}
          type="button"
          className={`novelty-color-option ${active ? "active" : ""}`}
          disabled={disabled}
          onClick={() => onChange(color)}
        >
          <span className={`cell-novelty-pill ${noveltyColorClass(color, color)}`}>{noveltyUiColorLabels[color]}</span>
          <small>{active ? "Seleccionado" : "Usar color"}</small>
        </button>;
      })}
    </div>
  </div>;
}
