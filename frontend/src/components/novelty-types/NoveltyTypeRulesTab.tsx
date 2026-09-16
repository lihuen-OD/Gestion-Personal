import type { NoveltyType, NoveltyTypeRules } from "../../types/noveltyType.types";
import { noveltyTimeEntryBehaviorDescriptions, noveltyTimeEntryBehaviorLabels, noveltyTimeEntryBehaviors, RoleChecklist } from "./NoveltyTypeFields";

// Etapa 15L.2B (docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md): un
// solo control de comportamiento horario (timeEntryBehavior) en vez de 3
// campos legacy independientes y desincronizables entre sí
// (blocksTimeEntry/setsWorkedHoursToZero/timeImpact, ver 15L.1 §7). El
// backend sigue sincronizando los 3 legacy a partir de este único valor.
export function NoveltyTypeRulesTab({ item, setItem, disabled }: { item: NoveltyType; setItem: (item: NoveltyType) => void; disabled?: boolean }) {
  const patchRules = (patch: Partial<NoveltyTypeRules>) => setItem({ ...item, rules: { ...item.rules, ...patch } });

  return <div className="catalog-rules">
    <div className="impact-rule-panel">
      <div><b>Comportamiento en carga horaria</b><span>No modifica las horas automáticamente. La app no liquida sueldos: sólo registra horas, novedades y prepara datos exportables a Finnegans.</span></div>
      <div className="form-grid compact">
        <label>Comportamiento
          <select
            value={item.rules.timeEntryBehavior}
            disabled={disabled}
            onChange={(event) => patchRules({ timeEntryBehavior: event.target.value as NoveltyTypeRules["timeEntryBehavior"] })}
          >
            {noveltyTimeEntryBehaviors.map((option) => <option key={option} value={option}>{noveltyTimeEntryBehaviorLabels[option]}</option>)}
          </select>
          <small>{noveltyTimeEntryBehaviorDescriptions[item.rules.timeEntryBehavior]}</small>
        </label>
      </div>
    </div>

    <div className="catalog-rule-grid">
      <label className="catalog-rule-card">
        <input type="checkbox" disabled={disabled} checked={item.rules.requiresApproval} onChange={() => patchRules({ requiresApproval: !item.rules.requiresApproval })} />
        <span>
          <b>Requiere aprobación</b>
          <small>
            {item.rules.requiresApproval
              ? "Si está activo, las novedades cargadas por Supervisión o Carga Horaria quedan pendientes hasta ser aprobadas. RRHH las aprueba automáticamente."
              : "Las novedades cargadas por roles habilitados quedan aprobadas al crearse."}
          </small>
        </span>
      </label>

      <label className="catalog-rule-card">
        <input type="checkbox" disabled={disabled} checked={item.rules.requiresDocumentation} onChange={() => patchRules({ requiresDocumentation: !item.rules.requiresDocumentation })} />
        <span>
          <b>Requiere documentación</b>
          <small>Solicita adjuntar documentación respaldatoria al cargar la novedad.</small>
        </span>
      </label>

      <label className="catalog-rule-card">
        <input type="checkbox" disabled={disabled} checked={item.rules.allowsDateRange} onChange={() => patchRules({ allowsDateRange: !item.rules.allowsDateRange })} />
        <span>
          <b>Permite rango de fechas</b>
          <small>Permite cargar una fecha desde y una fecha hasta para la misma novedad.</small>
        </span>
      </label>

      <label className="catalog-rule-card">
        <input type="checkbox" disabled={disabled} checked={item.rules.allowsHours} onChange={() => patchRules({ allowsHours: !item.rules.allowsHours })} />
        <span>
          <b>Permite cantidad de horas</b>
          <small>Habilita ingresar una cantidad de horas al cargar esta novedad (por ejemplo, llegadas tarde). No modifica el total de horas trabajadas.</small>
        </span>
      </label>
    </div>

    <RoleChecklist label="Roles que pueden cargarla" value={item.allowedLoadRoles} disabled={disabled} onChange={(allowedLoadRoles) => setItem({ ...item, allowedLoadRoles: allowedLoadRoles as NoveltyType["allowedLoadRoles"] })} />
    <RoleChecklist label="Roles que pueden aprobarla" value={item.approvalRoles} disabled={disabled} onChange={(approvalRoles) => setItem({ ...item, approvalRoles: approvalRoles as NoveltyType["approvalRoles"] })} />
    {item.rules.requiresApproval && item.approvalRoles.length === 0 ? (
      <p className="info-note compact">Sin roles de aprobación seleccionados, sólo RRHH podrá aprobar esta novedad.</p>
    ) : null}
    {item.allowedLoadRoles.length === 0 ? (
      <p className="info-note compact">Sin roles de carga seleccionados, sólo RRHH podrá crear esta novedad.</p>
    ) : null}
  </div>;
}
