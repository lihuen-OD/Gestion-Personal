import { useEffect } from "react";
import { noveltyTypeMockService } from "../../services/noveltyTypeMockService";
import type { NoveltyTimeImpact, NoveltyType, NoveltyTypeKind, NoveltyTypeOrigin, NoveltyUiColor } from "../../types/noveltyType.types";
import { noveltyColorClass, noveltyUiColors } from "../../utils/noveltyColor";

export const noveltyKinds: NoveltyTypeKind[] = ["AUSENCIA", "LICENCIA", "HORARIA", "ACCIDENTE", "VACACIONES", "SANCION", "OTRO"];
export const noveltyOrigins: NoveltyTypeOrigin[] = ["INTERNA", "FINNEGANS", "MIXTA"];
export const noveltyTimeImpacts: NoveltyTimeImpact[] = ["NO_AFECTA_HORAS", "REGISTRA_HORAS_NO_TRABAJADAS", "BLOQUEA_CARGA_DIA"];
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
    origin: "INTERNA",
    description: "",
    status: "ACTIVO",
    rules: {
      exportsToFinnegans: false,
      requiresApproval: true,
      requiresDocumentation: false,
      allowsHours: false,
      allowsDateTo: true,
      hasValidity: true,
      blocksTimeEntry: false,
      setsWorkedHoursToZero: false,
      timeImpact: "NO_AFECTA_HORAS",
    },
    allowedLoadRoles: ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"],
    approvalRoles: ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión"],
    finnegansLinks: [],
    notes: "",
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    updatedBy: "",
    history: [],
  };
}

export function TextField({ label, value, onChange, disabled, type = "text" }: { label: string; value: string | number; onChange: (value: string) => void; disabled?: boolean; type?: string }) {
  return <label>{label}<input type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function SelectField({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (value: string) => void; options: readonly string[]; disabled?: boolean }) {
  return <label>{label}<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

export function TextAreaField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label>{label}<textarea value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function RoleChecklist({ label, value, onChange, disabled }: { label: string; value: string[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  const toggle = (role: string) => onChange(value.includes(role) ? value.filter((item) => item !== role) : [...value, role]);
  return <div className="catalog-check-block"><small>{label}</small><div className="check-grid inline">{roleOptions.map((role) => <label className="check-card" key={role}><input type="checkbox" disabled={disabled} checked={value.includes(role)} onChange={() => toggle(role)} />{role}</label>)}</div></div>;
}

export function NoveltyColorField({ value, onChange, disabled, noveltyTypeId }: { value: NoveltyUiColor; onChange: (value: NoveltyUiColor) => void; disabled?: boolean; noveltyTypeId?: string }) {
  const usedColors = new Set(
    noveltyTypeMockService
      .getAll()
      .filter((type) => type.id !== noveltyTypeId)
      .map((type) => type.uiColor),
  );
  const firstAvailable = noveltyUiColors.find((color) => !usedColors.has(color));

  useEffect(() => {
    if (!disabled && usedColors.has(value) && firstAvailable) onChange(firstAvailable);
  }, [disabled, firstAvailable, onChange, usedColors, value]);

  return <div className="catalog-check-block form-wide">
    <small>Color en carga horaria</small>
    <div className="novelty-color-grid">
      {noveltyUiColors.map((color) => {
        const active = value === color;
        const alreadyUsed = usedColors.has(color);
        return <button
          key={color}
          type="button"
          className={`novelty-color-option ${active ? "active" : ""}`}
          disabled={disabled || alreadyUsed}
          onClick={() => onChange(color)}
          title={alreadyUsed ? "Este color ya esta asignado a otra novedad." : undefined}
        >
          <span className={`cell-novelty-pill ${noveltyColorClass(color, color)}`}>{noveltyUiColorLabels[color]}</span>
          <small>{alreadyUsed ? "Ya asignado" : active ? "Seleccionado" : "Usar color"}</small>
        </button>;
      })}
    </div>
    {!firstAvailable && !noveltyTypeId ? <p className="info-note compact">Todos los colores disponibles ya estan asignados.</p> : null}
  </div>;
}
