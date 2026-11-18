import type { NoveltyType, NoveltyTypeRules } from "../../types/noveltyType.types";
import { noveltyTimeEntryBehaviorDescriptions, noveltyTimeEntryBehaviorLabels, noveltyTimeEntryBehaviors, RoleChecklist } from "./NoveltyTypeFields";

// Etapa 15L.2B/15L.6: un solo control de comportamiento horario
// (timeEntryBehavior). Etapa 7 (NOVELTY_COVERAGE_ENGINE.md §14): sección
// "Carga y control" con preguntas de negocio; `allowsDateRange` queda fijo
// cuando el tiempo lo indica quien carga. `allowsHours` (carga heredada) vive
// en "Integración y otras opciones" (NoveltyTypeIntegrationFields).

function RuleCard({ checked, onToggle, title, description, disabled }: { checked: boolean; onToggle: () => void; title: string; description: string; disabled?: boolean }) {
  return <label className={`catalog-rule-card${disabled ? " is-locked" : ""}`}>
    <input type="checkbox" disabled={disabled} checked={checked} onChange={onToggle} />
    <span><b>{title}</b><small>{description}</small></span>
  </label>;
}

export function NoveltyTypeLoadControlFields({ item, setItem, disabled }: { item: NoveltyType; setItem: (item: NoveltyType) => void; disabled?: boolean }) {
  const patchRules = (patch: Partial<NoveltyTypeRules>) => setItem({ ...item, rules: { ...item.rules, ...patch } });
  const manualQuantity = item.coverage.mode === "MANUAL_MINUTES";
  const sumsHours = item.coverage.mode !== "NONE" && item.coverage.countsTowardTotal;

  return <div className="catalog-rules">
    <div className="catalog-rule-grid">
      <RuleCard
        title="¿Se puede cargar para varios días?"
        checked={item.rules.allowsDateRange}
        disabled={disabled || manualQuantity}
        onToggle={() => patchRules({ allowsDateRange: !item.rules.allowsDateRange })}
        description={manualQuantity
          ? "No: cuando la duración se indica al cargar, la novedad es de un único día."
          : "Permite indicar una fecha hasta. Si queda vacía, la novedad vale sólo para la fecha desde."}
      />
      <RuleCard
        title="¿Necesita aprobación antes de contar?"
        checked={item.rules.requiresApproval}
        disabled={disabled}
        onToggle={() => patchRules({ requiresApproval: !item.rules.requiresApproval })}
        description={item.rules.requiresApproval
          ? `Las novedades cargadas por Supervisión o Carga Horaria quedan pendientes hasta ser aprobadas; RRHH las aprueba automáticamente.${sumsHours ? " Hasta ser aprobada, la novedad será visible pero no sumará horas." : ""}`
          : "Las novedades cargadas por roles habilitados quedan aprobadas al crearse."}
      />
      <RuleCard
        title="¿La observación es obligatoria?"
        checked={item.rules.requiresObservation}
        disabled={disabled}
        onToggle={() => patchRules({ requiresObservation: !item.rules.requiresObservation })}
        description="Exige escribir una observación al cargar la novedad."
      />
      <RuleCard
        title="¿Debe adjuntarse documentación?"
        checked={item.rules.requiresDocumentation}
        disabled={disabled}
        onToggle={() => patchRules({ requiresDocumentation: !item.rules.requiresDocumentation })}
        description="Solicita adjuntar documentación respaldatoria al cargar la novedad."
      />
    </div>

    <div className="impact-rule-panel">
      <div><b>Bloqueo de la carga horaria</b><span>Nunca modifica horas ya registradas.</span></div>
      <div className="field-stack">
        <label>¿Bloquea nuevas cargas de horas?
          <select
            value={item.rules.timeEntryBehavior}
            disabled={disabled}
            aria-describedby="novelty-type-time-entry-behavior-hint"
            onChange={(event) => patchRules({ timeEntryBehavior: event.target.value as NoveltyTypeRules["timeEntryBehavior"] })}
          >
            {noveltyTimeEntryBehaviors.map((option) => <option key={option} value={option}>{noveltyTimeEntryBehaviorLabels[option]}</option>)}
          </select>
        </label>
        <small id="novelty-type-time-entry-behavior-hint" className="field-hint">{noveltyTimeEntryBehaviorDescriptions[item.rules.timeEntryBehavior]}</small>
      </div>
    </div>

    <div className="novelty-role-grid">
      <RoleChecklist label="Roles que pueden cargarla" value={item.allowedLoadRoles} disabled={disabled} onChange={(allowedLoadRoles) => setItem({ ...item, allowedLoadRoles: allowedLoadRoles as NoveltyType["allowedLoadRoles"] })} />
      <RoleChecklist label="Roles que pueden aprobarla" value={item.approvalRoles} disabled={disabled} onChange={(approvalRoles) => setItem({ ...item, approvalRoles: approvalRoles as NoveltyType["approvalRoles"] })} />
    </div>
    {item.rules.requiresApproval && item.approvalRoles.length === 0 ? (
      <p className="info-note compact">Sin roles de aprobación seleccionados, sólo RRHH podrá aprobar esta novedad.</p>
    ) : null}
    {item.allowedLoadRoles.length === 0 ? (
      <p className="info-note compact">Sin roles de carga seleccionados, sólo RRHH podrá crear esta novedad.</p>
    ) : null}
  </div>;
}
