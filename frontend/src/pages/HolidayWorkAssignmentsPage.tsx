import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { LoadingState } from "../components/ui/LoadingState";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { TableShell } from "../components/ui/TableShell";
import { SearchInput } from "../components/ui/SearchInput";
import {
  holidayWorkAssignmentApiService,
  type HolidayDate,
  type HolidayWorkAssignmentCandidate,
  type HolidayWorkAssignmentInput,
} from "../services/api/holidayWorkAssignmentApiService";
import { workforceApiService, type ShiftTemplate } from "../services/api/workforceApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import type { OrgStructureCatalog } from "../types/orgStructure.types";
import { useDebouncedValue } from "../utils/useDebouncedValue";
import { useAuth } from "../context/AuthContext";
import { roleLevel } from "../utils/roles";

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

function habitualShiftLabel(candidate: HolidayWorkAssignmentCandidate) {
  if (!candidate.shiftAssignments.length) return "Sin turno habitual";
  return candidate.shiftAssignments.map((item) => item.shiftTemplate.name).join(", ");
}

export function HolidayWorkAssignmentsPage() {
  const { user } = useAuth();
  const canEdit = roleLevel(user!.role) === 1;

  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getUTCFullYear(), month: today.getUTCMonth() });
  const [holidayDates, setHolidayDates] = useState<HolidayDate[] | null>(null);
  const [datesStatus, setDatesStatus] = useState<"loading" | "success" | "error">("loading");
  const [datesRetryToken, setDatesRetryToken] = useState(0);

  const [selectedDate, setSelectedDate] = useState("");

  const [catalog, setCatalog] = useState<OrgStructureCatalog | null>(null);
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplate[]>([]);

  const [sectorFilter, setSectorFilter] = useState("");
  const [shiftFilter, setShiftFilter] = useState("");
  const [withoutShift, setWithoutShift] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 350);

  const [candidates, setCandidates] = useState<HolidayWorkAssignmentCandidate[] | null>(null);
  const [candidatesStatus, setCandidatesStatus] = useState<"loading" | "success" | "error">("loading");
  const [candidatesRetryToken, setCandidatesRetryToken] = useState(0);
  const [panelError, setPanelError] = useState("");

  const [originalAssignedIds, setOriginalAssignedIds] = useState<Set<string>>(new Set());
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Map<string, EmployeeDetails>>(new Map());

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
        // resto de la pantalla (feriados, candidatos sin filtrar) sigue usable.
      });
    return () => {
      alive = false;
    };
  }, []);

  // Convocatoria ya guardada para la fecha — sólo se recarga al cambiar de
  // fecha, nunca al cambiar un filtro (los filtros sólo acotan qué candidatos
  // se muestran, no tocan la selección ya hecha).
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
      })
      .catch(() => {
        if (alive) setPanelError("No pudimos cargar la convocatoria ya guardada para esta fecha. Los cambios que hagas podrían no reflejar lo ya guardado.");
      });
    return () => {
      alive = false;
    };
  }, [selectedDate]);

  // Candidatos — se recarga por fecha y por cada filtro. No blanquea la
  // tabla mientras llega la respuesta de un filtro nuevo (candidates ya
  // tiene datos de la carga anterior); sólo muestra el loading grande la
  // primera vez que se abre una fecha (candidates === null, forzado por
  // openDate()).
  useEffect(() => {
    if (!selectedDate) return;
    let alive = true;
    if (!candidates) setCandidatesStatus("loading");
    holidayWorkAssignmentApiService
      .getCandidates({ sectorId: sectorFilter || undefined, shiftTemplateId: shiftFilter || undefined, withoutShift: withoutShift || undefined, search: debouncedSearch || undefined })
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
  }, [selectedDate, sectorFilter, shiftFilter, withoutShift, debouncedSearch, candidatesRetryToken]);

  const openDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    setCandidates(null);
    setCandidatesStatus("loading");
    setPanelError("");
    setFormError("");
    setNotice("");
  };

  const seedDetailsIfMissing = (candidate: HolidayWorkAssignmentCandidate) => {
    if (details.has(candidate.id)) return;
    const habitual = candidate.shiftAssignments[0]?.shiftTemplate;
    setDetails((current) => new Map(current).set(candidate.id, { ...emptyDetails, shiftTemplateId: habitual?.id || "" }));
  };

  const toggleEmployee = (candidate: HolidayWorkAssignmentCandidate) => {
    const isChecked = checkedIds.has(candidate.id);
    setCheckedIds((current) => {
      const next = new Set(current);
      if (isChecked) next.delete(candidate.id);
      else next.add(candidate.id);
      return next;
    });
    if (!isChecked) seedDetailsIfMissing(candidate);
  };

  const selectAllVisible = () => {
    const visible = candidates || [];
    setCheckedIds((current) => {
      const next = new Set(current);
      visible.forEach((candidate) => next.add(candidate.id));
      return next;
    });
    visible.forEach(seedDetailsIfMissing);
  };
  const deselectAllVisible = () => {
    const visible = candidates || [];
    setCheckedIds((current) => {
      const next = new Set(current);
      visible.forEach((candidate) => next.delete(candidate.id));
      return next;
    });
  };
  const deselectAll = () => setCheckedIds(new Set());

  const updateDetail = (employeeId: string, patch: Partial<EmployeeDetails>) => {
    setDetails((current) => new Map(current).set(employeeId, { ...emptyDetails, ...current.get(employeeId), ...patch }));
  };

  const hasChanges = () => {
    if (checkedIds.size !== originalAssignedIds.size) return true;
    for (const id of checkedIds) if (!originalAssignedIds.has(id)) return true;
    return false;
  };

  const handleSave = async () => {
    setFormError("");
    setNotice("");
    if (!hasChanges()) {
      setNotice("No hay cambios para guardar.");
      return;
    }
    setSaving(true);
    try {
      const payload: HolidayWorkAssignmentInput[] = [];
      for (const employeeId of checkedIds) {
        const employeeDetails = details.get(employeeId) || emptyDetails;
        payload.push({
          employeeId,
          status: "ACTIVA",
          shiftTemplateId: employeeDetails.shiftTemplateId || null,
          expectedStartTime: employeeDetails.expectedStartTime || null,
          expectedEndTime: employeeDetails.expectedEndTime || null,
          notes: employeeDetails.notes.trim() || null,
        });
      }
      for (const employeeId of originalAssignedIds) {
        if (!checkedIds.has(employeeId)) payload.push({ employeeId, status: "CANCELADA" });
      }
      await holidayWorkAssignmentApiService.saveAssignments(selectedDate, payload);
      setOriginalAssignedIds(new Set(checkedIds));
      setNotice("Convocatoria guardada correctamente.");
      setTimeout(() => setNotice(""), 2500);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "No pudimos guardar los cambios. Intentá nuevamente.");
    } finally {
      setSaving(false);
    }
  };

  const goToPreviousMonth = () => setCursor((current) => (current.month === 0 ? { year: current.year - 1, month: 11 } : { year: current.year, month: current.month - 1 }));
  const goToNextMonth = () => setCursor((current) => (current.month === 11 ? { year: current.year + 1, month: 0 } : { year: current.year, month: current.month + 1 }));
  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader
        eyebrow="TURNOS"
        title="Asignaciones de feriados"
        description="Estas fechas vienen de Horas Especiales clasificadas como Feriado. La liquidación de las horas trabajadas la sigue resolviendo Horas Especiales — acá sólo se registra quiénes estaban convocados a trabajar."
      />

      <Section className="holiday-work-section" title="Feriados disponibles" subtitle="Elegí una fecha para ver o cargar la convocatoria.">
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
          <EmptyState icon={CalendarDays} text="No hay feriados disponibles. Primero clasificá una regla de Horas Especiales como Feriado." />
        ) : (
          <div className="holiday-work-date-list">
            {holidayDates.map((holiday) => (
              <button
                key={holiday.date}
                type="button"
                className={`holiday-work-date-chip${selectedDate === holiday.date ? " is-selected" : ""}`}
                onClick={() => openDate(holiday.date)}
                title={holiday.rules.map((rule) => rule.name).join(", ")}
              >
                <CalendarDays size={14} />
                {formatDayLabel(holiday.date)}
              </button>
            ))}
          </div>
        )}
      </Section>

      {selectedDate ? (
        <Section
          className="holiday-work-section"
          title={`Convocatoria — ${formatFullDateLabel(selectedDate)}`}
          subtitle="Seleccioná quiénes estaban convocados a trabajar ese feriado."
        >
          {panelError ? (
            <div className="rule-form-alert-error" role="alert"><AlertTriangle size={16} /><span>{panelError}</span></div>
          ) : null}

          <div className="holiday-work-filters">
            <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o legajo" />
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
              <span>Sector</span>
              <select value={sectorFilter} onChange={(event) => setSectorFilter(event.target.value)}>
                <option value="">Todos</option>
                {catalog?.sectors.filter((sector) => sector.status === "ACTIVO").map((sector) => (
                  <option key={sector.id} value={sector.id}>{sector.name}</option>
                ))}
              </select>
            </label>
            <label className="holiday-work-without-shift-toggle">
              <input type="checkbox" checked={withoutShift} onChange={(event) => setWithoutShift(event.target.checked)} />
              Mostrar empleados sin turno
            </label>
          </div>

          {canEdit ? (
            <div className="holiday-work-quick-actions">
              <Button type="button" variant="subtle" onClick={selectAllVisible} disabled={!candidates?.length}>Seleccionar todos los visibles</Button>
              <Button type="button" variant="subtle" onClick={deselectAllVisible} disabled={!candidates?.length}>Deseleccionar visibles</Button>
              <Button type="button" variant="subtle" onClick={deselectAll} disabled={!checkedIds.size}>Deseleccionar todos</Button>
              <span className="holiday-work-selected-count">{checkedIds.size} seleccionado{checkedIds.size === 1 ? "" : "s"}</span>
            </div>
          ) : null}

          {candidatesStatus === "loading" ? (
            <LoadingState variant="table" text="Cargando empleados..." />
          ) : candidatesStatus === "error" ? (
            <ErrorState message="No pudimos cargar los empleados candidatos." onRetry={() => setCandidatesRetryToken((value) => value + 1)} size="compact" />
          ) : !candidates?.length ? (
            <EmptyState text="Ningún empleado coincide con los filtros elegidos." size="compact" />
          ) : (
            <TableShell minWidth={1100}>
              <table>
                <thead>
                  <tr>
                    {canEdit ? <th>Trabaja</th> : null}
                    <th>Legajo</th>
                    <th>Empleado</th>
                    <th>Sector</th>
                    <th>Turno habitual</th>
                    <th>Horario esperado</th>
                    <th>Observación</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => {
                    const checked = checkedIds.has(candidate.id);
                    const employeeDetails = details.get(candidate.id) || emptyDetails;
                    return (
                      <tr key={candidate.id} className={checked ? "is-selected" : ""}>
                        {canEdit ? (
                          <td>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleEmployee(candidate)}
                              aria-label={`Trabaja este feriado — ${candidate.lastName}, ${candidate.firstName}`}
                            />
                          </td>
                        ) : null}
                        <td>{candidate.legajo}</td>
                        <td>{candidate.lastName}, {candidate.firstName}</td>
                        <td>{candidate.sector?.name || "-"}</td>
                        <td>{habitualShiftLabel(candidate)}</td>
                        <td>
                          {checked && canEdit ? (
                            <div className="holiday-work-time-inputs">
                              <input type="time" aria-label={`Horario desde — ${candidate.lastName}, ${candidate.firstName}`} value={employeeDetails.expectedStartTime} onChange={(event) => updateDetail(candidate.id, { expectedStartTime: event.target.value })} />
                              <input type="time" aria-label={`Horario hasta — ${candidate.lastName}, ${candidate.firstName}`} value={employeeDetails.expectedEndTime} onChange={(event) => updateDetail(candidate.id, { expectedEndTime: event.target.value })} />
                            </div>
                          ) : checked ? (
                            <span>{employeeDetails.expectedStartTime || "-"}{employeeDetails.expectedEndTime ? ` – ${employeeDetails.expectedEndTime}` : ""}</span>
                          ) : (
                            <span className="holiday-work-muted">-</span>
                          )}
                        </td>
                        <td>
                          {checked && canEdit ? (
                            <input
                              value={employeeDetails.notes}
                              onChange={(event) => updateDetail(candidate.id, { notes: event.target.value })}
                              placeholder="Ej: Convocado por feriado"
                              aria-label={`Observación — ${candidate.lastName}, ${candidate.firstName}`}
                            />
                          ) : checked ? (
                            employeeDetails.notes || <em>Sin observación</em>
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

          {formError ? (
            <div className="rule-form-alert-error" role="alert"><AlertTriangle size={16} /><span>{formError}</span></div>
          ) : null}
          {notice ? <div className="info-note">{notice}</div> : null}

          {canEdit ? (
            <div className="holiday-work-save-bar">
              <small className="rule-scope-help">La liquidación de las horas trabajadas la sigue resolviendo Horas Especiales — acá sólo queda registrada la expectativa de quién debía trabajar.</small>
              <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button>
            </div>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}
