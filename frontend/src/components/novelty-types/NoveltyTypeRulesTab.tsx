import type { NoveltyType, NoveltyTypeRules } from "../../types/noveltyType.types";
import { RoleChecklist } from "./NoveltyTypeFields";

const ruleLabels: Array<[keyof NoveltyTypeRules, string, string]> = [
  ["affectsAttendance", "Afecta asistencia", "Impacta en ausentismo, presentismo y dashboard."],
  ["affectsSettlement", "Afecta liquidación", "Se considera para liquidación o exportación."],
  ["requiresApproval", "Requiere aprobación", "Queda pendiente hasta aprobación de un rol autorizado."],
  ["requiresDocumentation", "Requiere documentación", "Muestra alerta documental al cargar la novedad."],
  ["allowsFullDay", "Permite día completo", "Permite registrar jornadas completas."],
  ["allowsHalfDay", "Permite medio día", "Permite registrar media jornada."],
  ["allowsHours", "Permite horas", "Habilita cantidad de horas."],
  ["allowsDateTo", "Permite fecha hasta", "Habilita rango desde/hasta."],
  ["allowsQuantityDays", "Permite cantidad de días", "Calcula o permite informar días."],
  ["allowsQuantityHours", "Permite cantidad de horas", "Calcula o permite informar horas."],
];

export function NoveltyTypeRulesTab({ item, setItem, disabled }: { item: NoveltyType; setItem: (item: NoveltyType) => void; disabled?: boolean }) {
  const setRule = (key: keyof NoveltyTypeRules) => setItem({ ...item, rules: { ...item.rules, [key]: !item.rules[key] } });
  return <div className="catalog-rules">
    <div className="catalog-rule-grid">{ruleLabels.map(([key, title, detail]) => <label className="catalog-rule-card" key={key}>
      <input type="checkbox" disabled={disabled} checked={item.rules[key]} onChange={() => setRule(key)} />
      <span><b>{title}</b><small>{detail}</small></span>
    </label>)}</div>
    <RoleChecklist label="Roles que pueden cargarla" value={item.allowedLoadRoles} disabled={disabled} onChange={(allowedLoadRoles) => setItem({ ...item, allowedLoadRoles: allowedLoadRoles as NoveltyType["allowedLoadRoles"] })} />
    <RoleChecklist label="Roles que pueden aprobarla" value={item.approvalRoles} disabled={disabled} onChange={(approvalRoles) => setItem({ ...item, approvalRoles: approvalRoles as NoveltyType["approvalRoles"] })} />
  </div>;
}
