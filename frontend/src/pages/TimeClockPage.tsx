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

  const canSubmit = Boolean(selected?.id) && !loading;
  const employeeLabel = useMemo(() => status?.employee || result?.employee, [result, status]);
  const openShiftMinutes = useMemo(() => {
    if (!status?.openShift?.startAt) return 0;
    return Math.max(0, Math.round((now.getTime() - new Date(status.openShift.startAt).getTime()) / 60_000));
  }, [now, status?.openShift?.startAt]);
  const openShiftExceeded = openShiftMinutes > MAX_CLOCK_SHIFT_MINUTES;
  const canClockIn = canSubmit && (!status?.openShift || openShiftExceeded);
  const canClockOut = canSubmit && Boolean(status?.openShift) && !openShiftExceeded;

  const refreshStatus = async (employeeId = selected?.id) => {
    if (!employeeId || loading) return;
    if (!canSubmit) return;
    setError("");
    setResult(undefined);
    setLoading(true);
    try {
      setStatus(await timeClockApiService.status(employeeId));
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
      setStatus(await timeClockApiService.status(employee.id));
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
  };

  const clockIn = async () => {
    if (!canSubmit) return;
    setError("");
    setPendingPunch("IN");
  };

  const clockOut = async () => {
    if (!canSubmit) return;
    setError("");
    setPendingPunch("OUT");
  };

  const confirmPhotoPunch = async (capture: FaceCaptureResult) => {
    if (!selected || !pendingPunch) return;
    setError("");
    setLoading(true);
    try {
      const response = await timeClockApiService.photoPunch({
        employeeId: selected.id,
        punchType: pendingPunch,
        photo: capture.photo,
        faceValidationStatus: capture.faceValidationStatus,
        faceDetectionScore: capture.faceDetectionScore,
        device: capture.device,
      });
      setResult(response);
      if ("totalHours" in response.workShift) {
        setStatus({ employee: response.employee, openShift: null });
      } else {
        setStatus({ employee: response.employee, openShift: response.workShift });
      }
      setPendingPunch(undefined);
    } catch (err) {
      const fallback = pendingPunch === "IN"
        ? "No se pudo registrar el ingreso. Verificá si ya tenés una jornada abierta."
        : "No se pudo registrar la salida. Verificá que exista un ingreso abierto o avisá a RRHH.";
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setLoading(false);
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
            {openShiftExceeded ? <span>Ese día quedó con olvido de salida. Podés marcar un nuevo ingreso; RRHH lo revisa desde Asistencia.</span> : null}
          </div>
        ) : null}

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
            onCancel={() => {
              if (!loading) setPendingPunch(undefined);
            }}
            onConfirm={confirmPhotoPunch}
          />
        </Suspense>
      ) : null}
    </main>
  );
}
