import { ArrowRight } from "lucide-react";
import type { ClosureBlockerGroup, ClosureBlockerType } from "../../services/api/workforceApiService";
import { formatCalendarDate } from "../../utils/date";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

export const closureBlockerTypeLabel: Record<ClosureBlockerType, string> = {
  OPEN_SHIFT: "Jornada abierta",
  INCOMPLETE_SHIFT: "Jornada incompleta",
  MANUAL_CLOCK_CONFLICT: "Fichada vs. carga manual",
  NOVELTY_REVIEW: "Novedad en revisión",
};

const typeTone: Record<ClosureBlockerType, "warning" | "danger" | "info"> = {
  OPEN_SHIFT: "warning",
  INCOMPLETE_SHIFT: "danger",
  MANUAL_CLOCK_CONFLICT: "warning",
  NOVELTY_REVIEW: "info",
};

export function employeeLabel(employee: ClosureBlockerGroup["employee"]) {
  return `${employee.lastName}, ${employee.firstName}`;
}

/**
 * Bloqueantes del cierre agrupados por legajo: qué pasó, por qué impide cerrar,
 * qué hacer y un acceso directo al módulo donde se resuelve. El estado del
 * período se vuelve a consultar al regresar a Cierres mensuales.
 */
export function ClosureBlockerList({ groups, onNavigate }: { groups: ClosureBlockerGroup[]; onNavigate?: () => void }) {
  return (
    <div className="closure-blocker-groups">
      {groups.map((group) => (
        <section key={group.employee.id} className="closure-blocker-group" aria-label={`Pendientes de ${employeeLabel(group.employee)}`}>
          <header>
            <div>
              <b>{employeeLabel(group.employee)}</b>
              <span>Legajo {group.employee.legajo}</span>
            </div>
            <Badge tone="warning">{group.blockers.length} {group.blockers.length === 1 ? "pendiente" : "pendientes"}</Badge>
          </header>
          <ul>
            {group.blockers.map((blocker) => (
              <li key={blocker.id} className="closure-blocker-item">
                <div className="closure-blocker-meta">
                  <time dateTime={blocker.date}>{formatCalendarDate(blocker.date)}</time>
                  <Badge tone={typeTone[blocker.type]}>{closureBlockerTypeLabel[blocker.type]}</Badge>
                </div>
                <div className="closure-blocker-body">
                  <b>{blocker.title}</b>
                  <p>{blocker.reason}</p>
                  <p className="closure-blocker-action"><span>Qué hacer:</span> {blocker.action}</p>
                </div>
                <Button className="closure-blocker-link" to={blocker.resolution.path} icon={ArrowRight} onClick={onNavigate}>{blocker.resolution.label}</Button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
