import type { NoveltyType, NoveltyTypeKind } from "../../types/noveltyType.types";

export const noveltyKinds: NoveltyTypeKind[] = ["AUSENCIA", "LICENCIA", "HORARIA", "ACCIDENTE", "VACACIONES", "SANCION", "OTRO"];
export const roleOptions = ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"] as const;

export function emptyNoveltyType(): NoveltyType {
  return {
    id: "",
    code: "",
    name: "",
    kind: "AUSENCIA",
    description: "",
    status: "ACTIVO",
    rules: {
      affectsAttendance: true,
      affectsSettlement: true,
      requiresApproval: true,
      requiresDocumentation: false,
      allowsFullDay: true,
      allowsHalfDay: false,
      allowsHours: false,
      allowsDateTo: true,
      allowsQuantityDays: true,
      allowsQuantityHours: false,
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
