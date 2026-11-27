import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  holidayWorkAssignmentApiService,
  type HolidayDate,
  type HolidayWorkAssignmentCandidate,
  type HolidayWorkAssignmentInput,
} from "../../services/api/holidayWorkAssignmentApiService";
import { workforceApiService, type ShiftTemplate } from "../../services/api/workforceApiService";
import { orgStructureApiService } from "../../services/api/orgStructureApiService";
import { getUserErrorMessage } from "../../services/api/apiClient";
import type { OrgStructureCatalog } from "../../types/orgStructure.types";
import { useDebouncedValue } from "../../utils/useDebouncedValue";
import { expectedScheduleLabel, scheduleRequiresTemplate } from "../../utils/holidayConvocationSchedule";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { LoadingState } from "../ui/LoadingState";
import { Modal } from "../ui/Modal";
import { SearchInput } from "../ui/SearchInput";
import { TableShell } from "../ui/TableShell";

function monthRange(year: number, month: number) {
  const from = new Date(Date.UTC(year, month, 1));
  const to = new Date(Date.UTC(year, month + 1, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function formatDayLabel(dateKey: string) {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}

function formatFullDateLabel(dateKey: string) {
  const label = new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type EmployeeDetails = { shiftTemplateId: string; expectedStartTime: string; expectedEndTime: string; notes: string };
const emptyDetails: EmployeeDetails = { shiftTemplateId: "", expectedStartTime: "", expectedEndTime: "", notes: "" };

// Campos editables tal como viajan al guardar (vacío → null, notas sin
// espacios). La detección de cambios compara esta misma forma, así un dato
// que no cambia lo que se guardaría no cuenta como modificación.
function assignmentFields(details: EmployeeDetails) {
  return {
    shiftTemplateId: details.shiftTemplateId || null,
    expectedStartTime: details.expectedStartTime || null,
    expectedEndTime: details.expectedEndTime || null,
    notes: details.notes.trim() || null,
  };
}

function sameAssignmentFields(left: EmployeeDetails, right: EmployeeDetails) {
  const a = assignmentFields(left);
  const b = assignmentFields(right);
  return a.shiftTemplateId === b.shiftTemplateId && a.expectedStartTime === b.expectedStartTime && a.expectedEndTime === b.expectedEndTime && a.notes === b.notes;
}


const personLabel = (candidate: HolidayWorkAssignmentCandidate) => `${candidate.lastName}, ${candidate.firstName}`;
const DAY_OFF_BLOCKED = "Tiene franco asignado ese día: cancelá el franco primero (Gestionar francos).";
const PERIOD_BLOCKED = "El período ya fue enviado a cierre: sólo RRHH puede corregirlo.";

/**
 * "Gestionar feriados" (Gestión Horaria, junto a "Gestionar francos"):
 * feriado → personas del alcance → quiénes deben trabajarlo. La convocatoria
 * sólo define la obligación de asistir (docs/decisions/
 * WORKED_TIME_ACCOUNTING_MODEL.md §20); cuánto vale la hora del feriado lo
 * define la regla de RRHH. Nivel 1, 2 y 3 convocan legajos de su alcance: el
 * backend filtra los candidatos y valida el guardado todo o nada.
 */
export function HolidayWorkAssignmentDialog({
  initialMonth,
  canCorrectClosedPeriods,
  close,
  onSaved,
}: {
  initialMonth: string;
  // Sólo RRHH corrige un período enviado/aprobado, con motivo (como francos).
  canCorrectClosedPeriods: boolean;
  close: () => void;
  onSaved: () => void;
}) {
  const [initialYear, initialMonthNumber] = initialMonth.split("-").map(Number);
  const [cursor, setCursor] = useState({ year: initialYear!, month: initialMonthNumber! - 1 });
  const [holidayDates, setHolidayDates] = useState<HolidayDate[] | null>(null);
  const [datesStatus, setDatesStatus] = useState<"loading" | "success" | "error">("loading");
  const [datesRetryToken, setDatesRetryToken] = useState(0);

  const [selectedDate, setSelectedDate] = useState("");

  const [catalog, setCatalog] = useState<OrgStructureCatalog | null>(null);
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplate[]>([]);

  const [zoneFilter, setZoneFilter] = useState("");
  const [shiftFilter, setShiftFilter] = useState("");
  const [withoutShift, setWithoutShift] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 350);

  const [candidates, setCandidates] = useState<HolidayWorkAssignmentCandidate[] | null>(null);
  const [candidatesStatus, setCandidatesStatus] = useState<"loading" | "success" | "error">("loading");
  const [candidatesRetryToken, setCandidatesRetryToken] = useState(0);
  const [panelError, setPanelError] = useState("");

  const [originalAssignedIds, setOriginalAssignedIds] = useState<Set<string>>(new Set());
  // Detalle guardado de cada convocado (base para detectar ediciones).
  const [originalDetails, setOriginalDetails] = useState<Map<string, EmployeeDetails>>(new Map());
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Map<string, EmployeeDetails>>(new Map());
  // Plantillas de las convocatorias ya guardadas de la fecha (para mostrarlas aunque no estén entre las visibles).
  const [savedTemplates, setSavedTemplates] = useState<Map<string, string>>(new Map());

  const [correctionReason, setCorrectionReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");

  // Feriados del mes visible — mismo criterio "mes visible" que el
  // calendario de Horas Especiales (docs/PERFORMANCE_STANDARDS.md §7).
  useEffect(() => {
    let alive = true;
    if (!holidayDates) setDatesStatus("loading");
    const { from, to } = monthRange(cursor.year, cursor.month);
    holidayWorkAssignmentApiService
      .getHolidayDates(from, to)
      .then((days) => {
        if (!alive) return;
        setHolidayDates(days);
        setDatesStatus("success");
      })
      .catch(() => {
        if (alive) setDatesStatus("error");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, datesRetryToken]);

  useEffect(() => {
    let alive = true;
    Promise.all([orgStructureApiService.getCatalog(), workforceApiService.shiftTemplates()])
      .then(([catalogResult, templates]) => {
        if (!alive) return;
        setCatalog(catalogResult);
        setShiftTemplates(templates.filter((template) => template.status === "ACTIVO"));
      })
      .catch(() => {
        // Catálogos de filtro — si fallan, los selects quedan vacíos pero el
        // resto (feriados, candidatos sin filtrar) sigue usable.
      });
    return () => {
      alive = false;
    };
  }, []);

  // Convocatoria ya guardada para la fecha (sólo la del alcance del usuario):
  // se recarga al cambiar de fecha, nunca al cambiar un filtro.
  useEffect(() => {
    if (!selectedDate) return;
    let alive = true;
    holidayWorkAssignmentApiService
      .getAssignmentsByDate(selectedDate)
      .then((result) => {
        if (!alive) return;
        const activeIds = new Set(result.assignments.map((item) => item.employeeId));
        setOriginalAssignedIds(activeIds);
        setCheckedIds(new Set(activeIds));
        const detailsMap = new Map<string, EmployeeDetails>();
        for (const item of result.assignments) {
          detailsMap.set(item.employeeId, {
            shiftTemplateId: item.shiftTemplateId || "",
            expectedStartTime: item.expectedStartTime || "",
            expectedEndTime: item.expectedEndTime || "",
            notes: item.notes || "",
          });
        }
        setDetails(detailsMap);
        setOriginalDetails(new Map(detailsMap));
        setSavedTemplates(new Map(result.assignments.flatMap((item) => (item.shiftTemplate ? [[item.shiftTemplate.id, `${item.shiftTemplate.code} · ${item.shiftTemplate.name}`] as const] : []))));
      })
      .catch(() => {
        if (alive) setPanelError("No pudimos cargar la convocatoria ya guardada para esta fecha. Los cambios que hagas podrían no reflejar lo ya guardado.");
      });
    return () => {
      alive = false;
    };
  }, [selectedDate]);

  // Candidatos — se recarga por fecha y por cada filtro. No blanquea la tabla
  // mientras llega la respuesta de un filtro nuevo; sólo muestra el loading
  // grande la primera vez que se abre una fecha (forzado por openDate()).
  useEffect(() => {
    if (!selectedDate) return;
    let alive = true;
    if (!candidates) setCandidatesStatus("loading");
    holidayWorkAssignmentApiService
      .getCandidates({ date: selectedDate, locationZoneId: zoneFilter || undefined, locationDate: selectedDate, shiftTemplateId: shiftFilter || undefined, withoutShift: withoutShift || undefined, search: debouncedSearch || undefined })
      .then((result) => {
        if (!alive) return;
        setCandidates(result.items);
        setCandidatesStatus("success");
      })
      .catch(() => {
        if (alive) setCandidatesStatus("error");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, zoneFilter, shiftFilter, withoutShift, debouncedSearch, candidatesRetryToken]);

  const openDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    setCandidates(null);
    setCandidatesStatus("loading");
    setPanelError("");
    setFormError("");
    setNotice("");
  };

  // Franco ACTIVO ese día: no se puede convocar (el backend lo rechaza); si ya
  // estaba convocado se puede cancelar igual.
  const blockedByDayOff = (candidate: HolidayWorkAssignmentCandidate) => Boolean(candidate.dayOff) && !checkedIds.has(candidate.id);
  // Período enviado/aprobado: Nivel 2/3 no lo cambian (el backend lo rechaza).
  const blockedByPeriod = (candidate: HolidayWorkAssignmentCandidate) => Boolean(candidate.periodLocked) && !canCorrectClosedPeriods;
  const blockReason = (candidate: HolidayWorkAssignmentCandidate) => (blockedByPeriod(candidate) ? PERIOD_BLOCKED : blockedByDayOff(candidate) ? DAY_OFF_BLOCKED : undefined);

  // Nunca se propone un turno: sin plantilla rige el turno real del día
  // (§20); si no hay ninguno, el selector lo pide antes de guardar.
  const seedDetailsIfMissing = (candidate: HolidayWorkAssignmentCandidate) => {
    if (details.has(candidate.id)) return;
    setDetails((current) => new Map(current).set(candidate.id, { ...emptyDetails }));
  };

  const toggleEmployee = (candidate: HolidayWorkAssignmentCandidate) => {
    const isChecked = checkedIds.has(candidate.id);
    if (blockedByPeriod(candidate) || (!isChecked && blockedByDayOff(candidate))) return;
    setCheckedIds((current) => {
      const next = new Set(current);
      if (isChecked) next.delete(candidate.id);
      else next.add(candidate.id);
      return next;
    });
    if (!isChecked) seedDetailsIfMissing(candidate);
  };

  const selectAllVisible = () => {
    const visible = (candidates || []).filter((candidate) => !blockReason(candidate));
    setCheckedIds((current) => {
      const next = new Set(current);
      visible.forEach((candidate) => next.add(candidate.id));
      return next;
    });
    visible.forEach(seedDetailsIfMissing);
  };
  const deselectAllVisible = () => {
    const visible = (candidates || []).filter((candidate) => !blockedByPeriod(candidate));
    setCheckedIds((current) => {
      const next = new Set(current);
      visible.forEach((candidate) => next.delete(candidate.id));
      return next;
    });
  };
  // Los de un período cerrado que no se puede corregir quedan como estaban.
  const deselectAll = () => setCheckedIds((current) => new Set([...current].filter((id) => (candidates || []).some((candidate) => candidate.id === id && blockedByPeriod(candidate)))));

  // Turnos que se pueden elegir para la convocatoria. La convocatoria se
  // autoriza por legajo (nunca por grupo, §20): además de las plantillas
  // visibles para el usuario (para Nivel 2/3, las de sus grupos, R8), los
  // turnos reales de las personas de su alcance ese día y los ya guardados.
  const templateChoices = useMemo(() => {
    const choices = new Map<string, string>();
    for (const template of shiftTemplates) choices.set(template.id, `${template.code} ${template.startTime}–${template.endTime}`);
    for (const candidate of candidates ?? []) {
      for (const block of candidate.expectedSchedule?.blocks ?? []) if (!choices.has(block.templateId)) choices.set(block.templateId, `${block.code} ${block.startTime}–${block.endTime}`);
    }
    for (const [id, label] of savedTemplates) if (!choices.has(id)) choices.set(id, label);
    return [...choices].map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label));
  }, [shiftTemplates, candidates, savedTemplates]);
  const templateLabel = (templateId: string) => (templateId ? templateChoices.find((choice) => choice.id === templateId)?.label ?? "Turno guardado" : "El turno del día");

  const updateDetail = (employeeId: string, patch: Partial<EmployeeDetails>) => {
    setDetails((current) => new Map(current).set(employeeId, { ...emptyDetails, ...current.get(employeeId), ...patch }));
  };

  // Legajos cuya convocatoria cambia al guardar: alta, baja o algún campo
  // editable (turno, horario, observación) de alguien ya convocado.
  const changedEmployeeIds = () => {
    const changed = new Set<string>();
    for (const id of checkedIds) {
      if (!originalAssignedIds.has(id) || !sameAssignmentFields(details.get(id) || emptyDetails, originalDetails.get(id) || emptyDetails)) changed.add(id);
    }
    for (const id of originalAssignedIds) if (!checkedIds.has(id)) changed.add(id);
    return changed;
  };
  const hasChanges = () => changedEmployeeIds().size > 0;
  const changed = changedEmployeeIds();
  const reasonRequired = canCorrectClosedPeriods && (candidates || []).some((candidate) => candidate.periodLocked && changed.has(candidate.id));

  const handleSave = async () => {
    setFormError("");
    setNotice("");
    if (!hasChanges()) {
      setNotice("No hay cambios para guardar.");
      return;
    }
    if (reasonRequired && !correctionReason.trim()) {
      setFormError("Indicá el motivo de la corrección: el período ya fue enviado a cierre.");
      return;
    }
    // Misma regla que el backend (§20): ninguna convocatoria sin horario resoluble.
    const withoutSchedule = (candidates || []).filter((candidate) => checkedIds.has(candidate.id) && changed.has(candidate.id) && !details.get(candidate.id)?.shiftTemplateId && scheduleRequiresTemplate(candidate.expectedSchedule));
    if (withoutSchedule.length) {
      setFormError(`${withoutSchedule.map(personLabel).join("; ")} no ${withoutSchedule.length === 1 ? "tiene" : "tienen"} turno ese día: elegí el turno de la convocatoria.`);
      return;
    }
    setSaving(true);
    try {
      const payload: HolidayWorkAssignmentInput[] = [];
      for (const employeeId of checkedIds) {
        payload.push({ employeeId, status: "ACTIVA", ...assignmentFields(details.get(employeeId) || emptyDetails) });
      }
      for (const employeeId of originalAssignedIds) {
        if (!checkedIds.has(employeeId)) payload.push({ employeeId, status: "CANCELADA" });
      }
      const saved = await holidayWorkAssignmentApiService.saveAssignments(selectedDate, payload, reasonRequired ? correctionReason.trim() : null);
      const warnings = saved.flatMap((row) => (row.scheduleWarning ? [`${row.employee.lastName}, ${row.employee.firstName}: ${row.scheduleWarning}`] : []));
      setOriginalAssignedIds(new Set(checkedIds));
      setOriginalDetails(new Map([...checkedIds].map((employeeId) => [employeeId, details.get(employeeId) || emptyDetails])));
      setCorrectionReason("");
      setNotice(["Convocatoria guardada correctamente.", ...warnings].join(" "));
      onSaved();
    } catch (reason) {
      setFormError(getUserErrorMessage(reason, "No pudimos guardar los cambios. Intentá nuevamente."));
    } finally {
      setSaving(false);
    }
  };

  const goToPreviousMonth = () => setCursor((current) => (current.month === 0 ? { year: current.year - 1, month: 11 } : { year: current.year, month: current.month - 1 }));
  const goToNextMonth = () => setCursor((current) => (current.month === 11 ? { year: current.year + 1, month: 0 } : { year: current.year, month: current.month + 1 }));
  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <Modal
      size="wide"
      title="Gestionar feriados"
      subtitle="La convocatoria define quién debe trabajar el feriado: sólo los convocados tienen obligación de asistir y alertas por ausencia. Cuánto vale la hora del feriado lo define la regla de RRHH, no la convocatoria."
      close={close}
      closeDisabled={saving}
    >
      <div className="holiday-work-manager">
        <section className="holiday-work-block" aria-label="Feriados del mes">
          <div className="holiday-work-month-nav">
            <button type="button" className="table-icon-action" onClick={goToPreviousMonth} aria-label="Mes anterior"><ChevronLeft /></button>
            <strong>{monthLabel}</strong>
            <button type="button" className="table-icon-action" onClick={goToNextMonth} aria-label="Mes siguiente"><ChevronRight /></button>
          </div>
          {datesStatus === "loading" ? (
            <LoadingState text="Cargando feriados..." />
          ) : datesStatus === "error" ? (
            <ErrorState message="No pudimos cargar los feriados de este mes." onRetry={() => setDatesRetryToken((value) => value + 1)} size="compact" />
          ) : !holidayDates?.length ? (
            <EmptyState icon={CalendarDays} text="No hay feriados en este mes." size="compact" />
          ) : (
            <div className="holiday-work-date-list">
              {holidayDates.map((holiday) => (
                <button
                  key={holiday.date}
                  type="button"
                  className={`holiday-work-date-chip${selectedDate === holiday.date ? " is-selected" : ""}`}
                  onClick={() => openDate(holiday.date)}
                  title={holiday.rules.map((rule) => rule.name).join(", ")}
                  aria-pressed={selectedDate === holiday.date}
                >
                  <CalendarDays size={14} />
                  {formatDayLabel(holiday.date)}
                </button>
              ))}
            </div>
          )}
        </section>

        {selectedDate ? (
          <section className="holiday-work-block" aria-label={`Convocatoria — ${formatFullDateLabel(selectedDate)}`}>
            <h4 className="holiday-work-block-title">Convocatoria — {formatFullDateLabel(selectedDate)}</h4>
            {panelError ? (
              <div className="rule-form-alert-error" role="alert"><AlertTriangle size={16} /><span>{panelError}</span></div>
            ) : null}

            <div className="holiday-work-filters">
              <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o legajo" aria-label="Buscar persona" />
              <label className="field">
                <span>Turno</span>
                <select value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)}>
                  <option value="">Todos</option>
                  {shiftTemplates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Zona (vigente ese día)</span>
                <select value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)}>
                  <option value="">Todas</option>
                  {catalog?.zones.map((zone) => (
                    <option key={zone.id} value={zone.id}>{zone.name}</option>
                  ))}
                </select>
              </label>
              <label className="holiday-work-without-shift-toggle">
                <input type="checkbox" checked={withoutShift} onChange={(event) => setWithoutShift(event.target.checked)} />
                Mostrar empleados sin turno
              </label>
            </div>

            <div className="holiday-work-quick-actions">
              <Button type="button" variant="subtle" onClick={selectAllVisible} disabled={!candidates?.length}>Seleccionar todos los visibles</Button>
              <Button type="button" variant="subtle" onClick={deselectAllVisible} disabled={!candidates?.length}>Deseleccionar visibles</Button>
              <Button type="button" variant="subtle" onClick={deselectAll} disabled={!checkedIds.size}>Deseleccionar todos</Button>
              <span className="holiday-work-selected-count">{checkedIds.size} seleccionado{checkedIds.size === 1 ? "" : "s"}</span>
            </div>

            {candidatesStatus === "loading" ? (
              <LoadingState variant="table" text="Cargando empleados..." />
            ) : candidatesStatus === "error" ? (
              <ErrorState message="No pudimos cargar los empleados candidatos." onRetry={() => setCandidatesRetryToken((value) => value + 1)} size="compact" />
            ) : !candidates?.length ? (
              <EmptyState text={debouncedSearch || zoneFilter || shiftFilter || withoutShift ? "Nadie de tu alcance coincide con los filtros elegidos." : "No hay personas activas en tu alcance."} size="compact" />
            ) : (
              <TableShell className="holiday-work-table-shell" minWidth={1000}>
                <table className="holiday-work-table">
                  <thead>
                    <tr>
                      <th>Trabaja</th>
                      <th>Legajo</th>
                      <th>Empleado</th>
                      <th>Turno del día</th>
                      <th>Turno de la convocatoria</th>
                      <th>Observación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((candidate) => {
                      const checked = checkedIds.has(candidate.id);
                      const reason = blockReason(candidate);
                      const editable = checked && !blockedByPeriod(candidate);
                      const employeeDetails = details.get(candidate.id) || emptyDetails;
                      return (
                        <tr key={candidate.id} className={checked ? "is-selected" : ""}>
                          <td>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={Boolean(reason)}
                              title={reason}
                              onChange={() => toggleEmployee(candidate)}
                              aria-label={`Trabaja este feriado — ${personLabel(candidate)}`}
                            />
                          </td>
                          <td>{candidate.legajo}</td>
                          <td>
                            <span className="holiday-work-person">
                              {personLabel(candidate)}
                              {candidate.dayOff ? <Badge tone="info">Franco</Badge> : null}
                              {candidate.periodLocked ? <Badge tone="neutral">Período cerrado</Badge> : null}
                            </span>
                          </td>
                          <td>{expectedScheduleLabel(candidate.expectedSchedule)}</td>
                          <td>
                            {editable ? (
                              <select
                                value={employeeDetails.shiftTemplateId}
                                onChange={(event) => updateDetail(candidate.id, { shiftTemplateId: event.target.value })}
                                aria-label={`Turno de la convocatoria — ${personLabel(candidate)}`}
                                aria-invalid={!employeeDetails.shiftTemplateId && scheduleRequiresTemplate(candidate.expectedSchedule)}
                              >
                                <option value="">{scheduleRequiresTemplate(candidate.expectedSchedule) ? "Elegí un turno" : candidate.expectedSchedule?.blocks.length ? "El turno del día" : "Sin turno"}</option>
                                {templateChoices.map((choice) => (
                                  <option key={choice.id} value={choice.id}>{choice.label}</option>
                                ))}
                              </select>
                            ) : checked ? (
                              <span>{templateLabel(employeeDetails.shiftTemplateId)}</span>
                            ) : (
                              <span className="holiday-work-muted">-</span>
                            )}
                          </td>
                          <td>
                            {checked && (employeeDetails.expectedStartTime || employeeDetails.expectedEndTime) ? (
                              <small className="holiday-work-muted holiday-work-legacy-hours">Horario anterior (informativo): {employeeDetails.expectedStartTime || "?"}–{employeeDetails.expectedEndTime || "?"}</small>
                            ) : null}
                            {editable ? (
                              <input
                                value={employeeDetails.notes}
                                onChange={(event) => updateDetail(candidate.id, { notes: event.target.value })}
                                placeholder="Ej: Convocado por feriado"
                                maxLength={500}
                                aria-label={`Observación — ${personLabel(candidate)}`}
                              />
                            ) : checked ? (
                              employeeDetails.notes || <span className="holiday-work-muted">Sin observación</span>
                            ) : (
                              <span className="holiday-work-muted">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableShell>
            )}

            {reasonRequired ? (
              <label className="field holiday-work-correction">
                <span>Motivo de la corrección *</span>
                <textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} maxLength={500} rows={2} placeholder="Queda registrado en auditoría: el período ya fue enviado a cierre." />
              </label>
            ) : null}

            {formError ? (
              <div className="rule-form-alert-error" role="alert"><AlertTriangle size={16} /><span>{formError}</span></div>
            ) : null}
            {notice ? <div className="info-note" role="status">{notice}</div> : null}

            <div className="holiday-work-save-bar">
              <small className="rule-scope-help">Sólo los convocados deben trabajar ese día, con el turno del día o el de la convocatoria. Quien trabaje sin estar convocado cobra igual el valor del feriado si la regla lo alcanza.</small>
              <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button>
            </div>
          </section>
        ) : (
          <p className="holiday-work-muted holiday-work-hint">Elegí un feriado para ver o cargar quiénes deben trabajarlo.</p>
        )}
      </div>
    </Modal>
  );
}
