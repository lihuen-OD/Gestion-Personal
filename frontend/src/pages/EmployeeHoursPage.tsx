import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, Bell, CalendarDays, CheckCircle2, Clock3, ClipboardList, RefreshCcw } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { employeeApiService } from "../services/api/employeeApiService";
import { ApiError } from "../services/api/apiClient";
import { documentApiService } from "../services/api/documentApiService";
import { documentCategoryApiService } from "../services/api/documentCategoryApiService";
import { hourConceptApiService } from "../services/api/hourConceptApiService";
import { noveltyApiService } from "../services/api/noveltyApiService";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import { timeEntryApiService } from "../services/api/timeEntryApiService";
import type { Employee, Novelty, TimeEntry, TimeStatus } from "../types";
import type { HourConcept } from "../types/hourConcept.types";
import type { NoveltyType } from "../types/noveltyType.types";
import { noveltyColorClass } from "../utils/noveltyColor";
import { displayLegajo, fullName } from "../utils/employee";
import { currentMonthPeriod, formatPeriodDay, formatPeriodLabel, getMonthDays, getWeekdayAbbr, monthDate } from "../utils/period";
import { formatHours } from "../utils/hours";
import { statusTone } from "../utils/status";
import { useAsyncAction } from "../utils/useAsyncAction";
import { Field } from "../components/ui/FormControls";
import { Modal } from "../components/ui/Modal";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";

const noveltyTone = (novelty?: Novelty, uiColor?: string) =>
  novelty ? noveltyColorClass(uiColor, novelty.noveltyTypeId || novelty.type) : "";

const normalHourConcept: HourConcept = {
  id: "normal-hour-fallback",
  code: "HN",
  name: "Hora normal",
  kind: "NORMAL",
  description: "Hora trabajada base",
  status: "ACTIVO",
  rules: { defaultUnit: "HORAS" },
  allowedLoadRoles: [],
  approvalRoles: [],
  finnegansLinks: [],
  createdAt: "",
  updatedAt: "",
  createdBy: "",
  updatedBy: "",
  history: [],
};

function timeEntrySaveErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "TIME_ENTRY_DAY_BLOCKED_BY_NOVELTY") {
      return "Ese dia esta bloqueado por una novedad. Solo se permiten 0 hs salvo que se modifique la novedad.";
    }
    if (error.code === "TIME_ENTRY_DUPLICATED") {
      return "Ya existe una carga para esa persona, dia y tipo de hora.";
    }
    if (error.code === "TIME_ENTRY_LOCKED") {
      return "La carga ya esta aprobada o cerrada y no puede editarse.";
    }
    if (error.code === "HOUR_CONCEPT_NOT_ENABLED") {
      return "Ese tipo de hora no esta habilitado para este legajo.";
    }
  }
  return "No se pudo guardar la carga horaria. Revisa los datos e intenta nuevamente.";
}

export function EmployeeHoursPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const period = searchParams.get("period") || currentMonthPeriod();
  const [selected, setSelected] = useState<{ day: number; concept: string }>();
  const [hours, setHours] = useState("8");
  const [notes, setNotes] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [noveltyTypes, setNoveltyTypes] = useState<NoveltyType[]>([]);
  const [catalog, setCatalog] = useState<HourConcept[]>([]);
  const activeTypes = noveltyTypes.filter((item) => item.status === "ACTIVO");
  const noveltyTypesById = new Map(noveltyTypes.map((item) => [item.id, item]));
  const noveltyTypesByName = new Map(
    noveltyTypes.map((item) => [item.name.trim().toLowerCase(), item]),
  );
  const [noveltyTypeId, setNoveltyTypeId] = useState("");
  const [noveltyFrom, setNoveltyFrom] = useState(monthDate(period, 1));
  const [noveltyTo, setNoveltyTo] = useState(monthDate(period, 1));
  const [noveltyHours, setNoveltyHours] = useState("1");
  const [fileName, setFileName] = useState("");
  const [docNotes, setDocNotes] = useState("");
  const [error, setError] = useState("");
  const [savingStatus, setSavingStatus] = useState<TimeStatus | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [periodNovelties, setPeriodNovelties] = useState<Novelty[]>([]);
  const [attendanceIssues, setAttendanceIssues] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const monthDays = getMonthDays(period);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) return;
      setLoading(true);
      setLoadError("");
      try {
        const grid = await employeeApiService.getTimeGrid(id, period, { includeDetails: false });
        if (cancelled) return;
        setEmployee(grid.employee);
        setEntries(grid.entries);
        setPeriodNovelties([]);
        setNoveltyTypes([]);
        setCatalog(grid.hourConcepts);
        setAttendanceIssues(grid.attendanceIssues);
        setLoading(false);

        Promise.all([
          hourConceptApiService.getAll({ status: "ACTIVO" }),
          noveltyApiService.getAll({ employeeId: id }),
          noveltyTypeApiService.getAll(),
        ]).then(([apiHourConcepts, apiNovelties, apiNoveltyTypes]) => {
          if (cancelled) return;
          setCatalog(apiHourConcepts);
          setPeriodNovelties(
            apiNovelties.filter(
              (novelty) =>
                novelty.from.startsWith(period) || (novelty.to || novelty.from).startsWith(period),
            ),
          );
          setNoveltyTypes(apiNoveltyTypes);
        }).catch(() => {
          if (!cancelled) {
            setPeriodNovelties([]);
            setNoveltyTypes([]);
          }
        });
      } catch (loadError) {
        if (cancelled) return;
        setEmployee(null);
        setEntries([]);
        setPeriodNovelties([]);
        setNoveltyTypes([]);
        setCatalog([]);
        setAttendanceIssues(0);
        setLoadError("No pudimos cargar la grilla horaria. Verificá el legajo e intentá nuevamente.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id, period, refresh]);

  const enabledNames = new Set(
    employee?.enabledHours?.length ? employee.enabledHours : ["Hora normal"],
  );
  const conceptsFromCatalog = catalog.filter(
    (concept) => enabledNames.has(concept.name) || concept.name === "Hora normal",
  );
  const concepts = conceptsFromCatalog.length
    ? conceptsFromCatalog
    : [normalHourConcept];
  const selectedType = activeTypes.find((item) => item.id === noveltyTypeId);
  const noveltyVisualClass = (novelty?: Novelty) => {
    if (!novelty) return "";
    const type =
      (novelty.noveltyTypeId
        ? noveltyTypesById.get(novelty.noveltyTypeId)
        : undefined) || noveltyTypesByName.get(novelty.type.trim().toLowerCase());
    return noveltyTone(novelty, type?.uiColor);
  };
  const dayNovelties = (day: number) =>
    periodNovelties.filter((novelty) => {
      const fromDay = Number(novelty.from.slice(8, 10));
      const toDay = Number((novelty.to || novelty.from).slice(8, 10));
      return day >= fromDay && day <= toDay;
    });
  const conceptNovelties = (day: number, conceptName: string) =>
    dayNovelties(day).filter((novelty) =>
      novelty.blocksTimeEntry || novelty.timeImpact === "BLOQUEA_CARGA_DIA"
        ? true
        : novelty.targetHourConceptName
          ? novelty.targetHourConceptName === conceptName
          : novelty.timeImpact === "REGISTRA_HORAS_NO_TRABAJADAS"
            ? conceptName === "Hora normal"
            : false,
    );
  const entryFor = (day: number, conceptName: string) =>
    entries.find((entry) => entry.day === day && entry.type === conceptName);
  const conceptTotal = (conceptName: string) =>
    entries
      .filter(
        (entry) =>
          entry.type === conceptName && timeEntryApiService.isCountableStatus(entry.status),
      )
      .reduce((sum, entry) => sum + entry.hours, 0);
  const isBlocked = (day: number) =>
    dayNovelties(day).some(
      (novelty) =>
        novelty.blocksTimeEntry || novelty.timeImpact === "BLOQUEA_CARGA_DIA",
    );
  const openCell = (day: number, concept: string, entry?: TimeEntry) => {
    const date = monthDate(period, day);
    setSelected({ day, concept });
    setHours(
      String(
        entry?.hours ??
          (isBlocked(day) && concept === "Hora normal"
            ? 0
            : concept === "Hora normal"
              ? 8
              : 1),
      ),
    );
    setNotes(entry?.notes || "");
    setCorrectionReason("");
    setNoveltyTypeId("");
    setNoveltyFrom(date);
    setNoveltyTo(date);
    setNoveltyHours("1");
    setFileName("");
    setDocNotes("");
    setError("");
  };
  const selectedEntry = selected ? entryFor(selected.day, selected.concept) : undefined;
  const canCorrectApproved = Boolean(selectedEntry?.status === "Aprobado" && user && timeEntryApiService.canReview(user));
  const selectedLocked = selectedEntry ? !timeEntryApiService.canEdit(selectedEntry) && !canCorrectApproved : false;
  const noveltyRange = () => {
    const start = new Date(`${noveltyFrom}T00:00:00`);
    const end = new Date(
      `${selectedType?.rules.allowsDateTo ? noveltyTo : noveltyFrom}T00:00:00`,
    );
    const days: number[] = [];
    for (
      const current = new Date(start);
      current <= end;
      current.setDate(current.getDate() + 1)
    ) {
      if (current.getMonth() === start.getMonth()) days.push(current.getDate());
    }
    return days;
  };
  const { isRunning: isSaving, run: save } = useAsyncAction(async (status: TimeStatus) => {
    if (!selected || !employee) return;
    if (!user || !id) return;
    if (selectedLocked) {
      return setError(
        "La carga ya fue aprobada. Para modificarla primero hay que reabrirla.",
      );
    }
    if (canCorrectApproved && correctionReason.trim().length < 2) {
      return setError("Indicá el motivo de la corrección. Quedará registrado en auditoría.");
    }
    if (selectedType?.rules.requiresDocumentation && !fileName) {
      return setError("Adjunta la documentacion requerida para guardar esta novedad.");
    }
    if (
      selectedType?.rules.hasValidity &&
      selectedType.rules.allowsDateTo &&
      noveltyTo < noveltyFrom
    ) {
      return setError("La fecha hasta no puede ser anterior a la fecha desde.");
    }
    const concept = catalog.find((item) => item.name === selected.concept);
    const nextHours = Number(hours) || 0;
    const payload = {
        employeeId: id!,
        period,
        day: selected.day,
        type: selected.concept,
        hours: nextHours,
        notes,
        status,
        conceptId: concept?.id,
        isSpecial: selected.concept !== "Hora normal",
        origin: "MANUAL",
      } satisfies Omit<TimeEntry, "id">;
    let savedEntry: TimeEntry | undefined;
    setSavingStatus(status);
    try {
      try {
        savedEntry = canCorrectApproved && selectedEntry
          ? await timeEntryApiService.update(selectedEntry.id, { ...payload, correctionReason })
          : await timeEntryApiService.save(payload);
      } catch (saveError) {
        return setError(timeEntrySaveErrorMessage(saveError));
      }
      if (!savedEntry) {
        return setError(
          "La carga no se pudo guardar porque el registro esta bloqueado para edicion.",
        );
      }
      if (selectedType) {
        const hoursImpact = selectedType.rules.allowsHours ? Number(noveltyHours) || 0 : 0;
        let createdNovelties: Novelty[] = [];
        try {
          createdNovelties = await noveltyApiService.create({
            employeeIds: [id],
            noveltyTypeId: selectedType.id,
            fromDate: noveltyFrom,
            toDate: selectedType.rules.allowsDateTo ? noveltyTo : null,
            quantityHours: selectedType.rules.allowsHours ? hoursImpact : null,
            quantityDays: selectedType.rules.allowsHours ? null : Math.max(1, noveltyRange().length),
            observation: docNotes || null,
            targetHourConceptId: concept?.id || null,
          });
        } catch (noveltyError) {
          if (noveltyError instanceof ApiError) {
            return setError(`La hora se guardo, pero no se pudo guardar la novedad: ${noveltyError.message} (${noveltyError.code}).`);
          }
          return setError("La hora se guardó, pero no pudimos registrar la novedad. Revisá el tipo seleccionado e intentá nuevamente.");
        }
        if (fileName) {
          try {
            const categories = await documentCategoryApiService.getAll({ status: "ACTIVO", scope: "NOVEDAD" });
            const category = categories.find((item) => item.kind === "NOVEDAD") || categories[0];
            if (!category) {
              return setError("No hay una categoria documental activa para novedades.");
            }
            await documentApiService.create({
              employeeId: id,
              noveltyId: createdNovelties[0]?.id,
              categoryId: category.id,
              fileName,
              fileMimeType: "application/octet-stream",
              fileSizeBytes: 1,
              status: "Vigente",
              notes: docNotes,
            });
          } catch (documentError) {
            return setError("La novedad se guardó, pero no pudimos asociar la documentación. Intentá adjuntarla nuevamente.");
          }
        }
      }
      setRefresh((value) => value + 1);
      setSelected(undefined);
    } finally {
      setSavingStatus(null);
    }
  });

  if (loading) {
    return (
      <Section title="Carga de horas" subtitle="Cargando información">
        <div className="empty">Preparando grilla horaria...</div>
      </Section>
    );
  }

  if (loadError || !employee) {
    return (
      <Section title="Carga de horas" subtitle="No pudimos obtener la información del legajo">
        <div className="empty">{loadError || "Legajo no encontrado."}</div>
      </Section>
    );
  }
  const periodSummary = timeEntryApiService.getEmployeePeriodSummary(entries, id!);
  const total = periodSummary.total;
  const specialTotal = periodSummary.specialHours;
  const blockedDays = monthDays.filter((day) => isBlocked(day)).length;
  const exportableNovelties = periodNovelties.filter(
    (novelty) =>
      novelty.status !== "Rechazado" &&
      (novelty.exportsToFinnegans || novelty.finnegansCode),
  ).length;
  const approvedEntries = entries.filter((entry) => ["Aprobado", "Cerrado", "Exportado"].includes(entry.status)).length;
  const reviewEntries = entries.filter((entry) => entry.status === "En revisión").length;
  const correctionEntries = entries.filter((entry) => entry.status === "Devuelto" || entry.status === "Rechazado").length;
  const draftEntries = entries.filter((entry) => entry.status === "Borrador" || entry.status === "Pendiente").length;
  const entriesWithNovelties = entries.filter((entry) => conceptNovelties(entry.day, entry.type).length > 0).length;
  const actionableCount = reviewEntries + entries.filter((entry) => entry.status === "Devuelto").length + attendanceIssues;
  const periodState = actionableCount > 0
    ? { label: "Con pendientes", tone: "warning" as const }
    : draftEntries > 0
      ? { label: "En preparación", tone: "neutral" as const }
      : entries.length
        ? { label: "Sin pendientes", tone: "success" as const }
        : { label: "Sin cargas", tone: "neutral" as const };

  return (
    <>
      <div className="detail-hero compact">
        <Link to={`/horas?period=${period}`} className="back-link">
          ← Volver a carga de horas
        </Link>
        <div>
          <div className="avatar">
            {employee.firstName[0]}
            {employee.lastName[0]}
          </div>
          <div>
            <p className="eyebrow">
              {formatPeriodLabel(period)} · LEGAJO {displayLegajo(employee)}
            </p>
            <h1>
              {employee.firstName} {employee.lastName}
            </h1>
            <p>
              {employee.company} · {employee.costCenter} · {employee.cuil}
            </p>
          </div>
        </div>
        <div className="hero-actions">
          <Badge tone={periodState.tone}>{periodState.label}</Badge>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Horas trabajadas" value={`${formatHours(total)} h`} icon={Clock3} />
        <StatCard
          label="Horas especiales"
          value={`${formatHours(specialTotal)} h`}
          icon={AlertTriangle}
          tone="orange"
        />
        <StatCard
          label="Dias con carga"
          value={periodSummary.daysWithEntries}
          icon={CalendarDays}
          tone="blue"
        />
        <StatCard
          label="Novedades Finnegans"
          value={exportableNovelties}
          icon={Bell}
          tone="purple"
        />
      </div>

      <Section
        title="Estado del período"
        subtitle="Resumen de cargas que requieren seguimiento para este legajo."
        action={actionableCount > 0 ? <Badge tone="warning">{actionableCount} pendientes</Badge> : <Badge tone="success">Al día</Badge>}
        className="employee-hours-status"
      >
        <div className="employee-hours-status-grid">
          <div className="employee-hours-status-item success"><CheckCircle2 size={18} /><b>{approvedEntries}</b><span>Cargas aprobadas</span></div>
          {user && timeEntryApiService.canReview(user) ? (
            <Link className="employee-hours-status-item warning" to={`/pendientes?period=${period}`}><ClipboardList size={18} /><b>{reviewEntries}</b><span>En revisión</span></Link>
          ) : (
            <div className="employee-hours-status-item warning"><ClipboardList size={18} /><b>{reviewEntries}</b><span>En revisión</span></div>
          )}
          <div className="employee-hours-status-item danger"><RefreshCcw size={18} /><b>{correctionEntries}</b><span>Devueltas o rechazadas</span></div>
          <div className="employee-hours-status-item purple"><Bell size={18} /><b>{entriesWithNovelties}</b><span>Cargas con novedades</span></div>
          <Link className="employee-hours-status-item orange" to="/asistencia"><AlertTriangle size={18} /><b>{attendanceIssues}</b><span>Problemas de fichada</span></Link>
        </div>
      </Section>

      <Section
        title="Grilla mensual por concepto"
        subtitle={`Cada celda permite cargar horas y, si corresponde, una novedad asociada a esa misma hora para ${formatPeriodLabel(period)}.`}
      >
        <div className="hours-grid">
          <table>
            <thead>
              <tr>
                <th>Concepto</th>
                {monthDays.map((day) => (
                  <th key={day}>{getWeekdayAbbr(period, day)} {day}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {concepts.map((concept) => (
                <tr key={concept.id}>
                  <td>
                    <b>{concept.name}</b>
                    <span className="table-sub">
                      {concept.name === "Hora normal" ? "Hora trabajada base" : "Hora especial"}
                    </span>
                  </td>
                  {monthDays.map((day) => {
                    const entry = entryFor(day, concept.name);
                    const novelties = conceptNovelties(day, concept.name);
                    const mainNovelty = novelties[0];
                    const cellClass = [
                      "hour-cell",
                      entry ? "filled" : "",
                      isBlocked(day) ? "blocked" : "",
                      noveltyVisualClass(mainNovelty),
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <td key={`${concept.id}-${day}`}>
                        <button
                          className={cellClass}
                          title={novelties.map((novelty) => novelty.type).join(", ")}
                          onClick={() => openCell(day, concept.name, entry)}
                        >
                          <span>
                            {entry?.hours ??
                              (isBlocked(day) && concept.name === "Hora normal" ? "0" : "+")}
                          </span>
                          {mainNovelty ? <small>{mainNovelty.type.slice(0, 3)}</small> : null}
                        </button>
                      </td>
                    );
                  })}
                  <td>
                    <b>{formatHours(conceptTotal(concept.name))}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {selected ? (
        <Modal
          title={`Cargar ${selected.concept} · ${formatPeriodDay(period, selected.day)}`}
          close={() => setSelected(undefined)}
        >
          <div className="form-stack">
            <div className="context-hour-card">
              <div>
                <b>{selected.concept}</b>
                <span>
                  {fullName(employee)} · {monthDate(period, selected.day)}
                </span>
              </div>
              <span className="badge neutral">
                {conceptNovelties(selected.day, selected.concept).length
                  ? `${conceptNovelties(selected.day, selected.concept).length} novedad(es)`
                  : "Sin novedad cargada"}
              </span>
            </div>

            {selectedLocked ? (
              <div className="info-note compact">
                <b>Registro aprobado</b>
                <p>Esta carga ya fue aprobada y quedo bloqueada para edicion directa.</p>
              </div>
            ) : null}
            {canCorrectApproved ? (
              <div className="info-note compact">
                <b>Corrección administrativa</b>
                <p>La hora seguirá registrada. El cambio y su motivo quedarán auditados.</p>
              </div>
            ) : null}

            <div className="form-grid">
              <label>
                Fecha
                <input value={formatPeriodDay(period, selected.day)} disabled />
              </label>
              <label>
                Cantidad de horas
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={hours}
                  disabled={selectedLocked}
                  onChange={(event) => setHours(event.target.value)}
                />
              </label>
              <label className="form-wide">
                Observaciones
                <textarea
                  value={notes}
                  disabled={selectedLocked}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
              {canCorrectApproved ? (
                <label className="form-wide">
                  Motivo obligatorio de la corrección
                  <textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Ej.: el encargado confirmó el horario correcto con el empleado" />
                </label>
              ) : null}
            </div>

            <div className="context-novelty-card">
              <div>
                <b>Novedad asociada a esta hora</b>
                <span>
                  Opcional. Si cargas una novedad aca, queda marcada solo en esta fila de la
                  grilla.
                </span>
              </div>
              <div className="form-grid">
                <label>
                  Tipo de novedad
                  <select
                    value={noveltyTypeId}
                    disabled={selectedLocked}
                    onChange={(event) => {
                      setNoveltyTypeId(event.target.value);
                      setFileName("");
                      setDocNotes("");
                      setError("");
                    }}
                  >
                    <option value="">Sin novedad</option>
                    {activeTypes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} · {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedType ? (
                  <Field
                    label="Desde"
                    type="date"
                    value={noveltyFrom}
                    set={setNoveltyFrom}
                    disabled={selectedLocked}
                  />
                ) : null}
                {selectedType?.rules.allowsDateTo ? (
                  <Field
                    label="Hasta"
                    type="date"
                    value={noveltyTo}
                    set={setNoveltyTo}
                    disabled={selectedLocked}
                  />
                ) : null}
                {selectedType?.rules.allowsHours ? (
                  <Field
                    label="Cantidad de horas"
                    type="number"
                    value={noveltyHours}
                    set={setNoveltyHours}
                    disabled={selectedLocked}
                  />
                ) : null}
              </div>

              {selectedType?.uiColor ? (
                <div className="novelty-color-preview">
                  <span
                    className={`cell-novelty-pill ${noveltyColorClass(
                      selectedType.uiColor,
                      selectedType.id,
                    )}`}
                  >
                    Color aplicado: {selectedType.name}
                  </span>
                </div>
              ) : null}

              {selectedType?.rules.requiresDocumentation ? (
                <div className="document-upload-card">
                  <b>Documentacion requerida</b>
                  <p>Adjunta el comprobante o certificado respaldatorio.</p>
                  <label>
                    Adjuntar documento
                    <input
                      type="file"
                      disabled={selectedLocked}
                      onChange={(event) => setFileName(event.target.files?.[0]?.name || "")}
                    />
                  </label>
                  {fileName ? <small>Archivo seleccionado: {fileName}</small> : null}
                  <label>
                    Observacion documental
                    <textarea
                      value={docNotes}
                      disabled={selectedLocked}
                      onChange={(event) => setDocNotes(event.target.value)}
                      placeholder="Detalle opcional del documento adjunto"
                    />
                  </label>
                </div>
              ) : null}

              {conceptNovelties(selected.day, selected.concept).length ? (
                <div className="cell-novelty-list">
                  {conceptNovelties(selected.day, selected.concept).map((novelty) => (
                    <span
                      className={`cell-novelty-pill ${noveltyVisualClass(novelty)}`}
                      key={novelty.id}
                    >
                      {novelty.type} · {novelty.quantity}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {error ? <p className="error">{error}</p> : null}

            <div className="form-actions">
              <Button variant="subtle" onClick={() => setSelected(undefined)}>
                Cancelar
              </Button>
              {canCorrectApproved ? (
                <Button variant="primary" onClick={() => save("Aprobado")} disabled={isSaving}>
                  {isSaving ? "Guardando corrección..." : "Guardar corrección"}
                </Button>
              ) : !selectedLocked ? (
                <>
                  <Button variant="subtle" onClick={() => save("Borrador")} disabled={isSaving}>
                    {isSaving && savingStatus === "Borrador" ? "Guardando..." : "Guardar borrador"}
                  </Button>
                  <Button variant="primary" onClick={() => save("En revisión")} disabled={isSaving}>
                    {isSaving && savingStatus === "En revisión" ? "Enviando..." : "Enviar a revisión"}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
