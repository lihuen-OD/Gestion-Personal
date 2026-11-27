import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import type { ShiftRotationIssue } from "../../services/api/shiftRotationApiService";
import { groupRotationIssues, type RotationIssueGroup } from "../../utils/shiftRotation";

const VISIBLE_MESSAGES = 4;

function IssueGroup({ group }: { group: RotationIssueGroup }) {
  const [expanded, setExpanded] = useState(false);
  const isError = group.severity === "ERROR";
  const Icon = isError ? XCircle : AlertTriangle;
  const hidden = group.messages.length - VISIBLE_MESSAGES;
  const visible = expanded || hidden <= 0 ? group.messages : group.messages.slice(0, VISIBLE_MESSAGES);
  return (
    <li className={`rotation-issue ${isError ? "is-error" : "is-warning"}`}>
      <Icon size={18} aria-hidden="true" className="rotation-issue-icon" />
      <div className="rotation-issue-body">
        <p className="rotation-issue-title">
          <span className="sr-only">{isError ? "Error: " : "Advertencia: "}</span>
          {group.title}
          {group.messages.length > 1 ? <span className="rotation-issue-count">{group.messages.length} casos</span> : null}
        </p>
        <p className="rotation-issue-explanation">{group.explanation}</p>
        {visible.length ? <ul className="rotation-issue-messages">{visible.map((message) => <li key={message}>{message}</li>)}</ul> : null}
        {hidden > 0 ? (
          <button type="button" className="rotation-issue-more" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Mostrar menos" : `Ver ${hidden} ${hidden === 1 ? "caso más" : "casos más"}`}
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Diagnóstico de la rotación tal como lo calcula el backend (R4.6): agrupado
 * por tipo, errores primero. El código interno nunca se muestra; cada grupo
 * tiene un título y una explicación para RRHH, y los casos conservan el
 * mensaje de dominio (persona, equipo, fechas).
 */
export function RotationIssuesPanel({ issues, inactive }: { issues: ShiftRotationIssue[]; inactive: boolean }) {
  const groups = groupRotationIssues(issues);
  if (!groups.length) {
    return (
      <div className="rotation-issues-ok" role="status">
        <CheckCircle2 size={18} aria-hidden="true" />
        <p>La configuración no tiene observaciones.</p>
      </div>
    );
  }
  const errors = groups.filter((group) => group.severity === "ERROR").length;
  return (
    <div className="rotation-issues">
      <p className="rotation-issues-summary">
        {errors
          ? inactive ? "Hay errores que se deben corregir antes de poder activar la rotación." : "Hay errores en la configuración que se deben corregir."
          : "Hay advertencias para revisar. No impiden que la rotación funcione."}
      </p>
      <ul className="rotation-issue-list">{groups.map((group) => <IssueGroup key={`${group.severity}:${group.code}`} group={group} />)}</ul>
    </div>
  );
}
