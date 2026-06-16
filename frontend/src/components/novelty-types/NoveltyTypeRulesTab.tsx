import type { NoveltyType, NoveltyTypeRules } from "../../types/noveltyType.types";
import { noveltyTimeImpacts, RoleChecklist, SelectField } from "./NoveltyTypeFields";

type BooleanRuleKey = "exportsToFinnegans" | "requiresApproval" | "requiresDocumentation" | "allowsHours" | "allowsDateTo" | "hasValidity" | "blocksTimeEntry" | "setsWorkedHoursToZero";

const ruleLabels: Array<[BooleanRuleKey, string, string]> = [
  ["exportsToFinnegans", "Exporta a Finnegans", "Se incluye en la vista mensual de exportacion si tiene codigo Finnegans."],
  ["requiresApproval", "Requiere aprobacion", "Queda pendiente hasta aprobacion de un rol autorizado."],
  ["requiresDocumentation", "Requiere documentacion", "Pide adjuntar comprobante o certificado al cargar la novedad."],
  ["allowsHours", "Permite horas", "Habilita cantidad de horas, por ejemplo llegada tarde 1 h."],
  ["allowsDateTo", "Permite fecha hasta", "Habilita rango desde/hasta."],
  ["hasValidity", "Tiene vigencia", "Exige fecha desde y fecha hasta para exportacion Finnegans."],
  ["blocksTimeEntry", "Bloquea carga horaria", "El dia queda marcado para no cargar horas normales salvo excepcion."],
  ["setsWorkedHoursToZero", "Horas trabajadas cero", "Cuando se carga esta novedad, el dia queda con 0 hs trabajadas."],
];

export function NoveltyTypeRulesTab({ item, setItem, disabled }: { item: NoveltyType; setItem: (item: NoveltyType) => void; disabled?: boolean }) {
  const setRule = (key: BooleanRuleKey) => setItem({ ...item, rules: { ...item.rules, [key]: !item.rules[key] } });
  const patchRules = (patch: Partial<NoveltyTypeRules>) => setItem({ ...item, rules: { ...item.rules, ...patch } });
  return <div className="catalog-rules">
    <div className="impact-rule-panel">
      <div><b>Impacto en carga horaria</b><span>La app no liquida sueldos. Solo registra horas, novedades y prepara datos exportables a Finnegans.</span></div>
      <div className="form-grid compact">
        <SelectField label="Comportamiento horario" value={item.rules.timeImpact || "NO_AFECTA_HORAS"} disabled={disabled} options={noveltyTimeImpacts} onChange={(timeImpact) => patchRules({ timeImpact: timeImpact as NoveltyTypeRules["timeImpact"], blocksTimeEntry: timeImpact === "BLOQUEA_CARGA_DIA", setsWorkedHoursToZero: timeImpact === "BLOQUEA_CARGA_DIA" })} />
      </div>
    </div>
    <div className="catalog-rule-grid">{ruleLabels.map(([key, title, detail]) => <label className="catalog-rule-card" key={key}>
      <input type="checkbox" disabled={disabled} checked={Boolean(item.rules[key])} onChange={() => setRule(key)} />
      <span><b>{title}</b><small>{detail}</small></span>
    </label>)}</div>
    <RoleChecklist label="Roles que pueden cargarla" value={item.allowedLoadRoles} disabled={disabled} onChange={(allowedLoadRoles) => setItem({ ...item, allowedLoadRoles: allowedLoadRoles as NoveltyType["allowedLoadRoles"] })} />
    <RoleChecklist label="Roles que pueden aprobarla" value={item.approvalRoles} disabled={disabled} onChange={(approvalRoles) => setItem({ ...item, approvalRoles: approvalRoles as NoveltyType["approvalRoles"] })} />
  </div>;
}
