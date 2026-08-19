import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { TableShell } from "../ui/TableShell";
import type { AttendanceSegment, AttendanceTimeEntry } from "../../services/api/attendanceApiService";
import {
  describeHourConceptRule,
  describeSpecialRuleApplication,
  formatMinutesDuration,
  formatMultiplier,
  getSegmentReviewState,
  segmentConceptStatusLabel,
  segmentConceptStatusMessage,
  segmentConceptStatusTone,
  sortSegmentsByStart,
} from "./segmentDisplay";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Cordoba", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Cordoba", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function SegmentRow({ segment }: { segment: AttendanceSegment }) {
  const reviewState = getSegmentReviewState(segment.conceptStatus);
  return (
    <tr>
      <td>{formatDate(segment.date)}</td>
      <td>{formatTime(segment.fromDateTime)}</td>
      <td>{formatTime(segment.toDateTime)}</td>
      <td>{formatMinutesDuration(segment.minutes)}</td>
      <td>{segment.hourConceptName}</td>
      <td>
        {segment.conceptStatus ? (
          <span title={segmentConceptStatusMessage(segment.conceptStatus)}>
            <Badge tone={segmentConceptStatusTone(segment.conceptStatus)}>{segmentConceptStatusLabel(segment.conceptStatus)}</Badge>
          </span>
        ) : (
          <Badge tone="neutral">No disponible</Badge>
        )}
      </td>
      <td>{segment.conceptStatus ? describeHourConceptRule(segment.hourConceptRuleId) : <em>No disponible</em>}</td>
      <td>
        <div className="segment-flag-badges">
          {segment.isNight ? <Badge tone="neutral">Nocturno</Badge> : null}
          {segment.isHoliday ? <Badge tone="neutral">Feriado</Badge> : null}
          {!segment.isNight && !segment.isHoliday ? <span className="table-sub">-</span> : null}
        </div>
      </td>
      <td>{describeSpecialRuleApplication(segment.isSpecial, segment.specialHourRuleApplications)}</td>
      <td>
        {reviewState === "REQUIRES_REVIEW" ? (
          <Badge tone="warning">Requiere revisión</Badge>
        ) : reviewState === "OK" ? (
          <Badge tone="success">Sin observaciones</Badge>
        ) : (
          <Badge tone="neutral">Sin dato</Badge>
        )}
      </td>
    </tr>
  );
}

function TimeEntriesSummary({ entries }: { entries: AttendanceTimeEntry[] }) {
  if (!entries.length) return null;
  return (
    <div className="work-shift-entries-summary">
      <h5>Carga horaria generada</h5>
      <TableShell minWidth={640}>
        <table className="attendance-table">
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Minutos reales</th>
              <th>Minutos computados</th>
              <th>Multiplicador</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.hourConcept.name}</td>
                <td>{entry.actualMinutes !== undefined ? formatMinutesDuration(entry.actualMinutes) : <em>No disponible</em>}</td>
                <td>{formatMinutesDuration(entry.totalMinutes)}</td>
                <td>{entry.appliedMultiplier !== undefined ? formatMultiplier(entry.appliedMultiplier) : <em>No disponible</em>}</td>
                <td>{entry.status.replace(/_/g, " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </div>
  );
}

export function WorkShiftSegmentsPanel({ segments: unsortedSegments, entries }: { segments: AttendanceSegment[]; entries: AttendanceTimeEntry[] }) {
  const segments = sortSegmentsByStart(unsortedSegments);
  const hasFullConceptData = segments.some((segment) => segment.conceptStatus !== undefined);
  const segmentsRequiringReview = segments.filter((segment) => getSegmentReviewState(segment.conceptStatus) === "REQUIRES_REVIEW");

  return (
    <div className="work-shift-segments-panel">
      <div className="info-note compact">
        <p>Si dos tramos se superponen, el sistema usa el de mayor prioridad. Un tramo puede quedar &quot;sin concepto compatible&quot; o &quot;no habilitado&quot; y requerir revisión de RRHH.</p>
        {!hasFullConceptData ? (
          <p><em>El estado de clasificación y la regla horaria de este listado no están disponibles todavía para jornadas cerradas de forma rutinaria — hoy solo se exponen para jornadas que llegaron a &quot;Problemas de fichada&quot;. Requiere extender la API de asistencia.</em></p>
        ) : null}
      </div>

      {!segments.length ? (
        <EmptyState text="Esta jornada todavía no tiene segmentos generados." />
      ) : (
        <TableShell minWidth={1080}>
          <table className="attendance-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Desde</th>
                <th>Hasta</th>
                <th>Duración real</th>
                <th>Concepto horario</th>
                <th>Estado de concepto</th>
                <th>Regla horaria</th>
                <th>Otros</th>
                <th>Reglas especiales</th>
                <th>Revisión</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((segment) => <SegmentRow key={segment.id} segment={segment} />)}
            </tbody>
          </table>
        </TableShell>
      )}

      {segmentsRequiringReview.length ? (
        <div className="info-note compact">
          <b>Tramos que requieren revisión</b>
          <ul>
            {segmentsRequiringReview.map((segment) => (
              <li key={segment.id}>
                {formatTime(segment.fromDateTime)} a {formatTime(segment.toDateTime)} ({segment.hourConceptName}): {segmentConceptStatusMessage(segment.conceptStatus as NonNullable<typeof segment.conceptStatus>)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <TimeEntriesSummary entries={entries} />
    </div>
  );
}
