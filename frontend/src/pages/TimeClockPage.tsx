import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { LogIn, LogOut, Search } from "lucide-react";
import { ApiError } from "../services/api/apiClient";
import { timeClockApiService } from "../services/api/timeClockApiService";
import { Button } from "../components/ui/Button";
import { LoadingState } from "../components/ui/LoadingState";
import type { FaceCaptureResult } from "../components/time-clock/FaceCaptureModal";

const FaceCaptureModal = lazy(() =>
  import("../components/time-clock/FaceCaptureModal").then((module) => ({ default: module.FaceCaptureModal })),
);

const MAX_CLOCK_SHIFT_MINUTES = 20 * 60;

function formatDateTime(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatCurrentTime(value: Date) {
  return value.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function TimeClockPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Awaited<ReturnType<typeof timeClockApiService.searchEmployees>>[number]>();
  const [matches, setMatches] = useState<Awaited<ReturnType<typeof timeClockApiService.searchEmployees>>>([]);
  const [now, setNow] = useState(new Date());
  const [status, setStatus] = useState<Awaited<ReturnType<typeof timeClockApiService.status>>>();
  const [result, setResult] = useState<Awaited<ReturnType<typeof timeClockApiService.clockOut>> | Awaited<ReturnType<typeof timeClockApiService.clockIn>>>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingPunch, setPendingPunch] = useState<"IN" | "OUT">();
  const [attemptId, setAttemptId] = useState("");
  const [attemptLocked, setAttemptLocked] = useState(false);
  const [submissionStage, setSubmissionStage] = useState<"registering" | "slow" | "checking">("registering");
  const [hourConceptId, setHourConceptId] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const query = search.trim();
    if (query.length < 2 || selected) {
      setMatches([]);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const items = await timeClockApiService.searchEmployees(query);
        if (!cancelled) setMatches(items);
      } catch {
        if (!cancelled) setError("No se pudo buscar empleados.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, selected]);

  const canSubmit = Boolean(selected?.id) && !loading && !attemptLocked;
  const employeeLabel = useMemo(() => status?.employee || result?.employee, [result, status]);
  const openShiftMinutes = useMemo(() => {
    if (!status?.openShift?.startAt) return 0;
    return Math.max(0, Math.round((now.getTime() - new Date(status.openShift.startAt).getTime()) / 60_000));
  }, [now, status?.openShift?.startAt]);
  const openShiftExceeded = openShiftMinutes > MAX_CLOCK_SHIFT_MINUTES;
  const canClockIn = canSubmit && Boolean(hourConceptId) && (!status?.openShift || openShiftExceeded);
  const canClockOut = canSubmit && Boolean(status?.openShift) && !openShiftExceeded;

  const refreshStatus = async (employeeId = selected?.id) => {
    if (!employeeId || loading) return;
    if (!canSubmit) return;
    setError("");
    setResult(undefined);
    setLoading(true);
    try {
      const nextStatus = await timeClockApiService.status(employeeId);
      setStatus(nextStatus);
      setHourConceptId(nextStatus.openShift?.hourConcept?.id || nextStatus.hourConcepts.find((concept) => concept.kind === "NORMAL")?.id || nextStatus.hourConcepts[0]?.id || "");
    } catch {
      setStatus(undefined);
      setError("No pudimos consultar el estado del legajo seleccionado.");
    } finally {
      setLoading(false);
    }
  };
  const selectEmployee = async (employee: Awaited<ReturnType<typeof timeClockApiService.searchEmployees>>[number]) => {
    setSelected(employee);
    setSearch(`${employee.lastName}, ${employee.firstName}`);
    setMatches([]);
    setResult(undefined);
    setError("");
    setLoading(true);
    try {
      const nextStatus = await timeClockApiService.status(employee.id);
      setStatus(nextStatus);
      setHourConceptId(nextStatus.openShift?.hourConcept?.id || nextStatus.hourConcepts.find((concept) => concept.kind === "NORMAL")?.id || nextStatus.hourConcepts[0]?.id || "");
    } catch {
      setStatus(undefined);
      setError("No pudimos consultar el estado del legajo seleccionado.");
    } finally {
      setLoading(false);
    }
  };
  const clearEmployee = () => {
    setSelected(undefined);
    setStatus(undefined);
    setResult(undefined);
    setSearch("");
    setMatches([]);
    setError("");
    setHourConceptId("");
  };

  const clockIn = async () => {
    if (!canSubmit) return;
    setError("");
    setAttemptId(crypto.randomUUID());
    setPendingPunch("IN");
  };

  const clockOut = async () => {
    if (!canSubmit) return;
    setError("");
    setAttemptId(crypto.randomUUID());
    setPendingPunch("OUT");
  };

  const applyPunchResponse = (response: Awaited<ReturnType<typeof timeClockApiService.photoPunch>>) => {
    setResult(response);
    if ("totalHours" in response.workShift) {
      setStatus((current) => ({ employee: response.employee, openShift: null, hourConcepts: current?.hourConcepts || [] }));
    } else {
      setStatus((current) => ({ employee: response.employee, openShift: { ...response.workShift, hourConcept: current?.hourConcepts.find((concept) => concept.id === hourConceptId) || null }, hourConcepts: current?.hourConcepts || [] }));
    }
    setPendingPunch(undefined);
    setAttemptId("");
  };

  const verifyAttempt = async (requestId: string, employeeId: string) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const state = await timeClockApiService.attemptStatus(requestId, employeeId);
        if (state.status === "COMPLETED" && state.response) return state.response;
        if (state.status === "FAILED" && state.error) throw new ApiError(state.error.message, state.error.code, state.error.httpStatus);
      } catch (error) {
        if (error instanceof ApiError && error.status !== 404) throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    }
    return undefined;
  };

  const confirmPhotoPunch = async (capture: FaceCaptureResult) => {
    if (!selected || !pendingPunch || !attemptId || loading) return;
    setError("");
    setLoading(true);
    setAttemptLocked(true);
    setSubmissionStage("registering");
    const slowTimer = window.setTimeout(() => setSubmissionStage("slow"), 4_000);
    let terminal = false;
    try {
      const response = await timeClockApiService.photoPunch({
        requestId: attemptId,
        employeeId: selected.id,
        punchType: pendingPunch,
        hourConceptId: pendingPunch === "IN" ? hourConceptId : status?.openShift?.hourConcept?.id || undefined,
        photo: capture.photo,
        thumbnail: capture.thumbnail,
        faceValidationStatus: capture.faceValidationStatus,
        faceDetectionScore: capture.faceDetectionScore,
        device: capture.device,
      });
      terminal = true;
      applyPunchResponse(response);
    } catch (err) {
      window.clearTimeout(slowTimer);
      setSubmissionStage("checking");
      let verifiedTerminalError = false;
      try {
        const confirmed = await verifyAttempt(attemptId, selected.id);
        if (confirmed) {
          terminal = true;
          applyPunchResponse(confirmed);
          return;
        }
      } catch (verifiedError) {
        err = verifiedError;
        verifiedTerminalError = true;
      }
      const fallback = pendingPunch === "IN"
        ? "No pudimos determinar todavía si el ingreso terminó. No inicies otro intento y avisá a RRHH."
        : "No pudimos determinar todavía si la salida terminó. No inicies otro intento y avisá a RRHH.";
      if (verifiedTerminalError && err instanceof ApiError) {
        terminal = true;
        setError(err.message);
        setPendingPunch(undefined);
        setAttemptId("");
      } else {
        setError(fallback);
      }
    } finally {
      window.clearTimeout(slowTimer);
      setLoading(false);
      if (terminal) setAttemptLocked(false);
    }
  };

  return (
    <main className="clock-page">
      <section className="clock-panel">
        <div className="clock-heading">
          <p className="eyebrow">CONTROL HORARIO</p>
          <h1>Fichador de personal</h1>
          <strong>{formatCurrentTime(now)}</strong>
        </div>

        <label className="clock-dni-field">
          Buscar por nombre o apellido
          <div>
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelected(undefined);
                setStatus(undefined);
                setResult(undefined);
                setError("");
              }}
              placeholder="Ej.: Pérez Juan"
            />
            <button type="button" className="icon-button" onClick={() => refreshStatus()} title="Actualizar estado" aria-label="Actualizar estado" disabled={!selected}>
              <Search />
            </button>
          </div>
        </label>

        {matches.length ? (
          <div className="clock-results-list">
            {matches.map((employee) => (
              <button key={employee.id} type="button" onClick={() => selectEmployee(employee)}>
                <b>{employee.lastName}, {employee.firstName}</b>
                <span>DNI {employee.dni} · Legajo {employee.legajo}</span>
              </button>
            ))}
          </div>
        ) : null}

        {employeeLabel ? (
          <div className="clock-employee">
            <b>{employeeLabel.lastName}, {employeeLabel.firstName}</b>
            <span>DNI {employeeLabel.dni} · Legajo {employeeLabel.legajo}</span>
            <button type="button" className="table-link" onClick={clearEmployee}>Cambiar empleado</button>
          </div>
        ) : null}

        {status?.openShift ? (
          <div className="clock-open">
            <b>Ingreso abierto</b>
            <span>Registrado: {formatDateTime(status.openShift.startAt)}</span>
            {status.openShift.hourConcept ? <span>Tipo de jornada: <b>{status.openShift.hourConcept.name}</b></span> : null}
            {openShiftExceeded ? <span>Ese día quedó con olvido de salida. Podés marcar un nuevo ingreso; RRHH lo revisa desde Asistencia.</span> : null}
          </div>
        ) : null}

        {selected && !status?.openShift && status?.hourConcepts.length ? (
          <fieldset className="clock-concepts" disabled={loading || attemptLocked}>
            <legend>¿Qué tipo de jornada vas a registrar?</legend>
            <div>{status.hourConcepts.map((concept) => (
              <label key={concept.id} className={hourConceptId === concept.id ? "is-selected" : ""}>
                <input type="radio" name="clock-hour-concept" checked={hourConceptId === concept.id} onChange={() => setHourConceptId(concept.id)} />
                <span><b>{concept.name}</b><small>{concept.kind === "NORMAL" ? "Jornada habitual" : "Se contabiliza por separado"}</small></span>
              </label>
            ))}</div>
          </fieldset>
        ) : null}
        {selected && !status?.openShift && status && !status.hourConcepts.length ? <p className="error">Este legajo no tiene tipos de jornada habilitados. RRHH debe configurarlo antes de fichar.</p> : null}

        <div className="clock-actions">
          <Button variant="primary" icon={LogIn} disabled={!canClockIn} onClick={clockIn}>
            {openShiftExceeded ? "Marcar nuevo ingreso" : "Marcar ingreso"}
          </Button>
          <Button variant="subtle" icon={LogOut} disabled={!canClockOut} onClick={clockOut}>
            Marcar salida
          </Button>
        </div>

        {result && "workShift" in result ? (
          <div className="clock-result">
            {"totalHours" in result.workShift ? (
              <>
                <b>Salida registrada: {result.workShift.totalHours} h</b>
                {"segments" in result && result.segments.length ? (
                  <ul>
                    {result.segments.map((segment) => <li key={`${segment.date}-${segment.startAt}`}>{segment.label}</li>)}
                  </ul>
                ) : null}
              </>
            ) : (
              <>
                {"previousOpenShift" in result && result.previousOpenShift ? (
                  <span>El ingreso anterior del {formatDateTime(result.previousOpenShift.startAt)} quedó marcado como olvido de salida.</span>
                ) : null}
                <b>Ingreso registrado: {formatDateTime(result.workShift.startAt)}</b>
              </>
            )}
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
      </section>

      {pendingPunch ? (
        <Suspense fallback={<LoadingState text="Preparando cámara..." />}>
          <FaceCaptureModal
            punchType={pendingPunch}
            submitting={loading || attemptLocked}
            submissionStage={submissionStage}
            onCancel={() => {
              if (!loading && !attemptLocked) setPendingPunch(undefined);
            }}
            onConfirm={confirmPhotoPunch}
          />
        </Suspense>
      ) : null}
    </main>
  );
}
