import type { PreviewBlock } from "../../services/api/shiftRotationApiService";
import { AlertTriangle, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Modal } from "../ui/Modal";
import type { PreviewCell, PreviewRow } from "../../services/api/shiftRotationApiService";
import { formatCalendarDate } from "../../utils/date";
import { formatDurationMinutes } from "../../utils/hours";
import { blockCodeText, blockSpanText, blockTimeText, dayHeader, previewCellView, previewKindText, previewLabels } from "../../utils/shiftRotationPreview";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function rangeText(from: string, to: string | null) {
  return to ? `Del ${formatCalendarDate(from)} al ${formatCalendarDate(to)}` : `Desde el ${formatCalendarDate(from)}`;
}

/**
 * Detalle de un día de la vista previa (R4.8D): todo lo que devolvió el
 * backend para esa persona y fecha, traducido a lenguaje de RRHH. Sólo
 * lectura. Los identificadores internos del contrato (p. ej. el detalle de un
 * conflicto) no se muestran: sólo su motivo.
 */
export function RotationPreviewCellModal({ row, cell, close }: { row: PreviewRow; cell: PreviewCell; close: () => void }) {
  const view = previewCellView(cell);
  const header = dayHeader(cell.date);
  const assignment = cell.assignment;
  // Con plantilla oculta (R8) se compara por horario real: el id no viene.
  const blockKey = (block: PreviewBlock) => block.template.id ?? `${block.scheduledStartAt}|${block.scheduledEndAt}`;
  const plannedIds = cell.planning.blocks.map(blockKey).join("|");
  const effectiveDiffers = cell.effective.blocks.length > 0 && cell.effective.blocks.map(blockKey).join("|") !== plannedIds;
  const planReason = cell.planning.kind === "MISSING" || cell.planning.kind === "CONFLICT" ? previewLabels.planIssue(cell.planning.reason) : null;
  const transition = cell.transitionFromPrevious;

  return (
    <Modal title="Detalle del día" subtitle={`${row.employee.lastName}, ${row.employee.firstName} · Legajo ${row.employee.legajo} · ${header.full}`} close={close} size="wide">
      <div className="rotation-preview-detail">
        <section aria-labelledby="preview-detail-plan">
          <h4 id="preview-detail-plan">Plan de la rotación</h4>
          <dl className="rotation-facts">
            <Fact label="Plan del día">{previewKindText(view.kind)}</Fact>
            <Fact label="Semana del ciclo">{assignment?.cycleWeekLabel ? `Semana ${assignment.cycleWeekLabel}` : "No corresponde"}</Fact>
            <Fact label="Equipo">{assignment?.crew ? `${assignment.crew.name} (equipo ${assignment.crew.code})` : assignment ? "Sin equipo" : "Sin pertenencia a la rotación en esta fecha"}</Fact>
            <Fact label="Pertenencia">{assignment ? rangeText(assignment.effectiveFrom, assignment.effectiveTo) : "—"}</Fact>
            <Fact label="Versión de la grilla">{assignment?.version ? rangeText(assignment.version.effectiveFrom, assignment.version.effectiveTo) : "—"}</Fact>
            {planReason ? <Fact label="Motivo">{planReason}</Fact> : null}
          </dl>
        </section>

        <section aria-labelledby="preview-detail-blocks">
          <h4 id="preview-detail-blocks">Bloques programados</h4>
          {view.blocks.length ? (
            <ol className="rotation-preview-detail-blocks">
              {view.blocks.map((block) => (
                <li key={`${block.blockIndex}-${block.scheduledStartAt}`}>
                  <b>{blockCodeText(block)} · {blockTimeText(block)}</b>
                  {block.template.crossesMidnight ? <abbr className="rotation-next-day" title="Termina al día siguiente">+1</abbr> : null}
                  <span>{blockSpanText(block)} · {formatDurationMinutes(block.durationMinutes)} · {previewLabels.blockSource(block.source)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="rotation-preview-detail-empty">Sin bloques para este día.</p>}
          {view.blocks.some((block) => block.template.crossesMidnight) ? <p className="field-hint">Un turno que termina al día siguiente pertenece a este día y no se repite en el siguiente.</p> : null}
        </section>

        <section aria-labelledby="preview-detail-obligation">
          <h4 id="preview-detail-obligation">Obligación de asistencia</h4>
          <dl className="rotation-facts">
            <Fact label="Resultado">{previewLabels.obligation(cell.effective.obligation)}</Fact>
            <Fact label="Origen">{previewLabels.source(cell.effective.source)}</Fact>
            {cell.effective.reason ? <Fact label="Motivo">{previewLabels.reason(cell.effective.reason)}</Fact> : null}
            {effectiveDiffers ? <Fact label="Turnos exigidos">{cell.effective.blocks.map((block) => `${blockCodeText(block)} · ${blockTimeText(block)}${block.template.crossesMidnight ? " (+1)" : ""}`).join("; ")}</Fact> : null}
          </dl>
        </section>

        <section aria-labelledby="preview-detail-workday">
          <h4 id="preview-detail-workday">Jornada esperada para Novedades</h4>
          <dl className="rotation-facts">
            <Fact label="Jornada">{previewLabels.workday(cell.expectedWorkday.obligation)}</Fact>
            <Fact label="Horas esperadas">{cell.expectedWorkday.expectedMinutes === null ? "Sin determinar" : formatDurationMinutes(cell.expectedWorkday.expectedMinutes)}</Fact>
            {cell.expectedWorkday.unresolvedReason ? <Fact label="Motivo">{previewLabels.unresolved(cell.expectedWorkday.unresolvedReason)}</Fact> : null}
            {cell.expectedWorkday.planIssue ? <Fact label="Problema de la grilla">{previewLabels.planIssue(cell.expectedWorkday.planIssue.reason)}</Fact> : null}
          </dl>
        </section>

        <section aria-labelledby="preview-detail-facts">
          <h4 id="preview-detail-facts">Franco, feriado y régimen</h4>
          <dl className="rotation-facts">
            <Fact label="Franco">{cell.facts.dayOff ? "Sí" : "No"}</Fact>
            <Fact label="Feriado">{previewLabels.holiday(cell.facts.holidayScope)}</Fact>
            <Fact label="Convocatoria">{cell.facts.convoked ? "Convocado al feriado" : "No"}</Fact>
            <Fact label="Régimen laboral">{previewLabels.regime(cell.facts.regimeKind)}</Fact>
          </dl>
        </section>

        <section aria-labelledby="preview-detail-transition">
          <h4 id="preview-detail-transition">Descanso desde el bloque anterior</h4>
          <p className="rotation-preview-detail-text">
            {!transition
              ? "No hay un bloque anterior cercano para comparar."
              : transition.overlap
                ? `Se superpone con el bloque del ${formatCalendarDate(transition.previousOperationalDate)}.`
                : transition.restMinutes === null
                  ? `Sigue al bloque del ${formatCalendarDate(transition.previousOperationalDate)}.`
                  : transition.restMinutes === 0
                    ? `Empieza justo cuando termina el bloque del ${formatCalendarDate(transition.previousOperationalDate)}.`
                    : `${formatDurationMinutes(transition.restMinutes)} desde el bloque del ${formatCalendarDate(transition.previousOperationalDate)}.`}
          </p>
          <p className="field-hint">Dato informativo: no hay un mínimo de descanso definido.</p>
        </section>

        <section aria-labelledby="preview-detail-warnings">
          <h4 id="preview-detail-warnings">Advertencias</h4>
          {cell.warnings.length ? (
            <ul className="rotation-preview-detail-warnings">
              {cell.warnings.map((warning, index) => (
                <li key={`${warning.code}-${index}`} className={warning.severity === "ERROR" ? "is-error" : "is-warning"}>
                  {warning.severity === "ERROR" ? <XCircle size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
                  <span><span className="sr-only">{warning.severity === "ERROR" ? "Error: " : "Advertencia: "}</span>{previewLabels.warning(warning.message)}{warning.relatedDate ? ` (relacionado con el ${formatCalendarDate(warning.relatedDate)})` : ""}</span>
                </li>
              ))}
            </ul>
          ) : <p className="rotation-preview-detail-empty">Sin advertencias.</p>}
        </section>
      </div>
    </Modal>
  );
}
