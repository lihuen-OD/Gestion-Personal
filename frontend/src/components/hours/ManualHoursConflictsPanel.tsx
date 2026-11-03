import { Eye } from "lucide-react";
import type { ManualHoursConflict } from "../../services/api/manualHoursConflictApiService";
import { formatCalendarDate } from "../../utils/date";
import { formatDurationMinutes } from "../../utils/hours";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ErrorState } from "../ui/ErrorState";
import { Section } from "../ui/Section";
import { TableShell } from "../ui/TableShell";
import { formatMinutesDifference, manualHoursDecisionText } from "./ManualHoursConflictDialog";

// Revisiones del período (docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md): sólo
// aparece si hay alguna o si no se pudieron cargar; pendientes primero.
export function ManualHoursConflictsPanel({ conflicts, error, onRetry, onOpen }: { conflicts: ManualHoursConflict[]; error: string; onRetry: () => void; onOpen: (conflict: ManualHoursConflict) => void }) {
  if (!conflicts.length && !error) return null;
  const pending = conflicts.filter((conflict) => conflict.status === "PENDIENTE").length;
  const ordered = [...conflicts].sort((a, b) => (a.status === b.status ? a.operationalDate.localeCompare(b.operationalDate) : a.status === "PENDIENTE" ? -1 : 1));
  return (
    <Section
      title="Fichadas sobre horas cargadas manualmente"
      subtitle={error
        ? "No se pudo verificar si hay revisiones pendientes en el período."
        : pending ? `${pending === 1 ? "1 revisión pendiente" : `${pending} revisiones pendientes`}: mientras tanto computan las horas cargadas.` : "Sin revisiones pendientes en el período."}
    >
      {error ? (
        <ErrorState size="compact" message={error} onRetry={onRetry} />
      ) : (
        <TableShell minWidth={860}>
          <table className="manual-hours-conflicts-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Legajo / Persona</th>
                <th>Horas cargadas</th>
                <th>Horas fichadas</th>
                <th>Diferencia</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((conflict) => (
                <tr key={conflict.id}>
                  <td>{formatCalendarDate(conflict.operationalDate)}</td>
                  <td>
                    <b>{conflict.employee.legajo}</b> · {conflict.employee.lastName}, {conflict.employee.firstName}
                  </td>
                  <td>{formatDurationMinutes(conflict.manualMinutes)}</td>
                  <td>{formatDurationMinutes(conflict.clockMinutes)}</td>
                  <td>{formatMinutesDifference(conflict.differenceMinutes)}</td>
                  <td>
                    {conflict.status === "PENDIENTE"
                      ? <Badge tone="warning">Revisión pendiente</Badge>
                      : <span className="manual-hours-resolved"><Badge tone="success">Resuelta</Badge><small>{manualHoursDecisionText(conflict)}</small></span>}
                  </td>
                  <td>
                    <Button
                      variant={conflict.status === "PENDIENTE" ? "primary" : "subtle"}
                      icon={Eye}
                      onClick={() => onOpen(conflict)}
                      aria-label={`${conflict.status === "PENDIENTE" ? "Revisar" : "Ver"} la fichada de ${conflict.employee.lastName}, ${conflict.employee.firstName} del ${formatCalendarDate(conflict.operationalDate)}`}
                    >
                      {conflict.status === "PENDIENTE" ? "Revisar" : "Ver"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}
    </Section>
  );
}
