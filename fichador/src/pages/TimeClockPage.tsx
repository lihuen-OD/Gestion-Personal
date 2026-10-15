// Fichador standalone (F1, docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md).
// Única copia del fichador (la del admin se retiró en F6). F3: la página
// informa cuándo está ocupada para no aplicar una actualización de la app en
// medio de una fichada. F8 (§27): usa sólo /api/clock/*, cada intención de
// fichar tiene UN requestId que se conserva en toda la recuperación
// (features/punch/punchSubmission.ts), el cooldown se muestra con cuenta
// regresiva local y una fichada confirmada vuelve sola al estado inicial.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock3, LogIn, LogOut, RefreshCw } from "lucide-react";
import { getUserErrorMessage, type ApiError } from "../services/api/apiClient";
import { isClockDeviceAuthFailure } from "../services/api/clockDeviceSession";
import { timeClockApiService, type ClockEmployee, type ClockPunchResult } from "../services/api/timeClockApiService";
import { submitPunch, type PunchOutcome } from "../features/punch/punchSubmission";
import { Button } from "../components/ui/Button";
import { LoadingState } from "../components/ui/LoadingState";
import type { FaceCaptureResult, SubmissionStage } from "../components/time-clock/FaceCaptureModal";
import { CAMERA_PAUSED_MESSAGE } from "../components/time-clock/captureMessages";
import { formatDateTime, formatTime } from "../utils/date";
import { kioskActivity } from "../pwa/kioskActivity";

const FaceCaptureModal = lazy(() =>
  import("../components/time-clock/FaceCaptureModal").then((module) => ({ default: module.FaceCaptureModal })),
);

const MAX_CLOCK_SHIFT_MINUTES = 20 * 60;
/** Cuánto queda visible la confirmación antes de volver solo al inicio. */
export const SUCCESS_RESET_MS = 3_500;
/** A partir de cuándo el envío avisa que puede demorar (la foto puede tardar ~10 s). */
const SLOW_SUBMIT_MS = 4_000;
/**
 * F8.1: espera local de un cooldown que llegó SIN retryAfterSeconds (intento
 * anterior a F7.1, backend desactualizado o respuesta incompleta). Sólo evita
 * habilitar de inmediato; no es la ventana real del backend, que no se
 * adivina: si se reintenta antes de tiempo, el backend vuelve a responder
 * cooldown con su tiempo exacto.
 */
export const FALLBACK_COOLDOWN_SECONDS = 5;

export const OFFLINE_MESSAGE = "Sin conexión. No se puede registrar la fichada.";
export const UNCONFIRMED_MESSAGE = "No pudimos confirmar el estado de esta fichada. Esperá unos segundos y volvé a intentar.";

// Errores de negocio que indican que la jornada cambió: antes de habilitar
// el siguiente intento se vuelve a consultar el estado real del legajo.
const SHIFT_STATE_CODES = new Set(["CLOCK_ALREADY_OPEN", "CLOCK_NO_OPEN_SHIFT", "CLOCK_ALREADY_CLOSED", "CLOCK_SHIFT_CHANGED"]);

type PunchType = "IN" | "OUT";
type ClockStatus = Awaited<ReturnType<typeof timeClockApiService.status>>;
// requestId: UNO por intención, creado al tocar "Marcar ingreso/salida" y
// descartado al terminar (éxito, error o resultado no confirmado).
type PunchFlow =
  | { step: "capturing"; punchType: PunchType; requestId: string }
  | { step: "submitting"; punchType: PunchType; requestId: string; stage: SubmissionStage };
type PunchView =
  | { kind: "success"; punchType: PunchType; employee: ClockEmployee; at: string; previousOpenShiftAt?: string }
  | { kind: "cooldown"; deadline: number }
  | { kind: "error"; message: string }
  // F10: aviso neutro (no es un error), p. ej. la cámara se pausó al pasar a segundo plano.
  | { kind: "notice"; message: string };

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Segundos que faltan para `deadline`, con un timer propio alineado al
 * momento en que empezó la espera (no al reloj de pantalla): nunca muestra
 * un segundo de más ni habilita tarde. Sólo local, sin consultar al backend.
 */
function useSecondsLeft(deadline: number | undefined) {
  // Se calcula en el render (nunca un valor viejo del deadline anterior); el
  // timer sólo fuerza el re-render.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!deadline) return undefined;
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;
}

function employeeIdentity(employee: ClockEmployee) {
  return employee.dniSuffix ? `Legajo ${employee.legajo} · DNI terminado en ${employee.dniSuffix}` : `Legajo ${employee.legajo}`;
}

function formatCurrentTime(value: Date) {
  return value.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/** Espera de un cooldown: la del backend (0 incluido, por eso `??`) o el fallback local. */
function cooldownSeconds(failure: ApiError) {
  return failure.retryAfterSeconds ?? FALLBACK_COOLDOWN_SECONDS;
}

/** Hora OFICIAL de la fichada: la que devolvió el backend, nunca el reloj del equipo. */
function serverPunchTime(result: ClockPunchResult) {
  return "endAt" in result.workShift ? result.workShift.endAt : result.workShift.startAt;
}

export function TimeClockPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ClockEmployee>();
  const [matches, setMatches] = useState<ClockEmployee[]>([]);
  const [now, setNow] = useState(new Date());
  const [status, setStatus] = useState<ClockStatus>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [punch, setPunch] = useState<PunchFlow | null>(null);
  const [view, setView] = useState<PunchView | null>(null);
  // Guardas síncronas: un doble tap llega antes del re-render.
  const intentLock = useRef(false);
  const submitLock = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

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
      } catch (searchError) {
        if (!cancelled) setError(getUserErrorMessage(searchError, "No se pudo buscar empleados."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, selected]);

  // F3: una actualización de la app sólo se aplica con el kiosco ocioso
  // (src/pwa/kioskUpdates.ts): nunca con un empleado elegido, una búsqueda
  // escrita, la cámara abierta, una fichada enviándose o verificándose, ni
  // mientras se muestra su resultado.
  useEffect(() => {
    kioskActivity.setBusy(Boolean(search.trim() || selected || punch || loading || view));
    return () => kioskActivity.setBusy(false);
  }, [search, selected, punch, loading, view]);

  const resetKiosk = useCallback(() => {
    setSelected(undefined);
    setStatus(undefined);
    setSearch("");
    setMatches([]);
    setError("");
    setView(null);
    setPunch(null);
    intentLock.current = false;
    submitLock.current = false;
  }, []);

  // Éxito: la confirmación queda visible un momento y el kiosco vuelve solo
  // al inicio (sin recargar la app ni tocar la credencial del equipo).
  useEffect(() => {
    if (view?.kind !== "success") return undefined;
    const timer = window.setTimeout(resetKiosk, SUCCESS_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [view, resetKiosk]);

  // Cooldown: cuenta regresiva local con el retryAfterSeconds original del
  // backend (o FALLBACK_COOLDOWN_SECONDS si no vino); al llegar a 0 se
  // habilita de nuevo, sin fichar automáticamente.
  const cooldownRemaining = useSecondsLeft(view?.kind === "cooldown" ? view.deadline : undefined);
  const cooldownActive = cooldownRemaining > 0;
  useEffect(() => {
    if (view?.kind === "cooldown" && !cooldownActive) setView(null);
  }, [view, cooldownActive]);

  const canSubmit = Boolean(selected?.id) && !loading && !punch && !cooldownActive && view?.kind !== "success";
  const employeeLabel = useMemo(() => status?.employee, [status]);
  const openShiftMinutes = useMemo(() => {
    if (!status?.openShift?.startAt) return 0;
    return Math.max(0, Math.round((now.getTime() - new Date(status.openShift.startAt).getTime()) / 60_000));
  }, [now, status?.openShift?.startAt]);
  const openShiftExceeded = openShiftMinutes > MAX_CLOCK_SHIFT_MINUTES;
  const canClockIn = canSubmit && (!status?.openShift || openShiftExceeded);
  const canClockOut = canSubmit && Boolean(status?.openShift) && !openShiftExceeded;
  const exitIsPrimary = Boolean(status?.openShift) && !openShiftExceeded;

  const loadStatus = async (employeeId: string) => {
    setLoading(true);
    try {
      const nextStatus = await timeClockApiService.status(employeeId);
      setStatus(nextStatus);
    } catch (statusError) {
      setStatus(undefined);
      setError(getUserErrorMessage(statusError, "No pudimos consultar el estado del legajo seleccionado."));
    } finally {
      setLoading(false);
    }
  };

  // Después de un error que cambia la jornada o de un resultado no
  // confirmado: estado real del legajo antes del próximo intento. Si falla,
  // el mensaje del intento ya está en pantalla.
  const refreshStatusQuietly = async (employeeId: string) => {
    try {
      const nextStatus = await timeClockApiService.status(employeeId);
      if (alive.current) setStatus((current) => (current?.employee.id === employeeId || !current ? nextStatus : current));
    } catch {
      // sin acción: no se pisa el mensaje del intento
    }
  };

  const refreshStatus = async () => {
    if (!selected || loading || punch) return;
    setError("");
    setView(null);
    await loadStatus(selected.id);
  };

  const selectEmployee = async (employee: ClockEmployee) => {
    setSelected(employee);
    setSearch(`${employee.lastName}, ${employee.firstName}`);
    setMatches([]);
    setView(null);
    setError("");
    await loadStatus(employee.id);
  };

  const clearEmployee = () => {
    setSelected(undefined);
    setStatus(undefined);
    setView(null);
    setSearch("");
    setMatches([]);
    setError("");
  };

  const startPunch = (punchType: PunchType) => {
    if (intentLock.current || !canSubmit) return;
    // Sin red no hay fichada: no se abre la cámara ni sale ningún request.
    if (!navigator.onLine) {
      setView({ kind: "error", message: OFFLINE_MESSAGE });
      return;
    }
    intentLock.current = true;
    setError("");
    setView(null);
    setPunch({ step: "capturing", punchType, requestId: crypto.randomUUID() });
  };

  const cancelCapture = () => {
    if (punch?.step !== "capturing") return;
    setPunch(null);
    intentLock.current = false;
  };

  // F10: el fichador pasó a segundo plano con la cámara abierta y sin
  // confirmar. La cámara ya se apagó: la intención se descarta (su requestId
  // nunca se envió) y la próxima captura empieza de cero, con otro requestId.
  const cameraInterrupted = () => {
    if (punch?.step !== "capturing") return;
    setPunch(null);
    intentLock.current = false;
    setView({ kind: "notice", message: CAMERA_PAUSED_MESSAGE });
  };

  const finishIntent = () => {
    setPunch(null);
    intentLock.current = false;
    submitLock.current = false;
  };

  const showFailure = (failure: ApiError, employee: ClockEmployee) => {
    // 401/403 del dispositivo: la sesión ya se cerró y el Gate bloquea el
    // fichador (F6). No es un error de red ni de la fichada.
    if (isClockDeviceAuthFailure(failure)) return;
    if (failure.code === "CLOCK_PUNCH_COOLDOWN") {
      setView({ kind: "cooldown", deadline: Date.now() + cooldownSeconds(failure) * 1000 });
      return;
    }
    if (failure.code === "CLOCK_IDEMPOTENCY_KEY_REUSED" && import.meta.env.DEV) {
      console.warn("CLOCK_PUNCH_ABANDONED", { code: failure.code });
    }
    setView({ kind: "error", message: failure.message });
    if (SHIFT_STATE_CODES.has(failure.code)) void refreshStatusQuietly(employee.id);
  };

  const showOutcome = (outcome: PunchOutcome, punchType: PunchType, employee: ClockEmployee) => {
    if (outcome.kind === "success") {
      const { result } = outcome;
      setStatus("endAt" in result.workShift
        ? { employee: result.employee, openShift: null }
        : { employee: result.employee, openShift: { id: result.workShift.id, startAt: result.workShift.startAt } });
      setView({
        kind: "success",
        punchType,
        employee: result.employee,
        at: serverPunchTime(result),
        previousOpenShiftAt: "previousOpenShift" in result ? result.previousOpenShift?.startAt : undefined,
      });
      return;
    }
    if (outcome.kind === "unconfirmed") {
      setView({ kind: "error", message: UNCONFIRMED_MESSAGE });
      void refreshStatusQuietly(employee.id);
      return;
    }
    showFailure(outcome.error, employee);
  };

  const confirmPhotoPunch = async (capture: FaceCaptureResult) => {
    if (!selected || punch?.step !== "capturing" || submitLock.current) return;
    const { punchType, requestId } = punch;
    const employee = selected;
    const perceivedStartedAt = performance.now();
    const payloadBytes = new Blob([capture.photo, capture.thumbnail]).size;
    console.info(JSON.stringify({ level: "info", event: "clock_punch_timing", requestId, phase: "capture_encode", durationMs: Number((capture.captureEncodeMs ?? 0).toFixed(1)), bytes: payloadBytes, result: "success" }));
    // Antes de enviar (caso A): sin red, nada sale y el intento se descarta.
    if (!navigator.onLine) {
      finishIntent();
      setView({ kind: "error", message: OFFLINE_MESSAGE });
      return;
    }
    submitLock.current = true;
    setPunch({ step: "submitting", punchType, requestId, stage: "sending" });
    const slowTimer = window.setTimeout(() => {
      setPunch((current) => (current?.step === "submitting" && current.stage === "sending" ? { ...current, stage: "slow" } : current));
    }, SLOW_SUBMIT_MS);
    const outcome = await submitPunch(
      {
        requestId,
        employeeId: employee.id,
        punchType,
        photo: capture.photo,
        thumbnail: capture.thumbnail,
        faceValidationStatus: capture.faceValidationStatus,
        faceDetectionScore: capture.faceDetectionScore,
        device: capture.device,
      },
      {
        api: timeClockApiService,
        sleep,
        isCancelled: () => !alive.current,
        onStage: (stage) => {
          if (alive.current && stage !== "sending") setPunch((current) => (current?.step === "submitting" ? { ...current, stage } : current));
        },
      },
    );
    window.clearTimeout(slowTimer);
    console.info(JSON.stringify({ level: "info", event: "clock_punch_timing", requestId, phase: "total_perceived", durationMs: Number((performance.now() - perceivedStartedAt).toFixed(1)), bytes: payloadBytes, result: outcome.kind === "success" ? "success" : "error" }));
    if (!alive.current) return;
    finishIntent();
    showOutcome(outcome, punchType, employee);
  };

  const success = view?.kind === "success" ? view : null;

  return (
    <main className="clock-page">
      <section className="clock-panel">
        <div className="clock-heading">
          <p className="eyebrow">CONTROL HORARIO</p>
          <h1>Fichador de personal</h1>
          <strong>{formatCurrentTime(now)}</strong>
        </div>

        {success ? (
          <div className="clock-success" role="status" aria-live="polite">
            <CheckCircle2 className="clock-success-icon" aria-hidden="true" />
            <b>{success.punchType === "IN" ? "Entrada registrada" : "Salida registrada"}</b>
            <span className="clock-success-name">{success.employee.firstName} {success.employee.lastName}</span>
            <strong className="clock-success-time" aria-label={`Hora ${formatTime(success.at)}`}>{formatTime(success.at)}</strong>
            {success.previousOpenShiftAt ? (
              <small>El ingreso anterior del {formatDateTime(success.previousOpenShiftAt)} quedó marcado como olvido de salida.</small>
            ) : null}
            <span className="clock-success-hint">Podés continuar.</span>
          </div>
        ) : (
          <>
            <label className="clock-dni-field">
              Buscar por nombre o apellido
              <div>
                <input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setSelected(undefined);
                    setStatus(undefined);
                    setView(null);
                    setError("");
                  }}
                  placeholder="Ej.: Pérez Juan"
                />
                {/* F10: actualizar el estado del legajo (no es una búsqueda); gira mientras consulta. */}
                <button type="button" className="icon-button" onClick={() => void refreshStatus()} title="Actualizar estado" aria-label="Actualizar estado" disabled={!selected || Boolean(punch) || loading}>
                  <RefreshCw className={selected && loading ? "spin-icon" : undefined} />
                </button>
              </div>
            </label>

            {matches.length ? (
              <div className="clock-results-list">
                {matches.map((employee) => (
                  <button key={employee.id} type="button" onClick={() => void selectEmployee(employee)}>
                    <b>{employee.lastName}, {employee.firstName}</b>
                    <span>{employeeIdentity(employee)}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {employeeLabel ? (
              <div className="clock-employee">
                <b>{employeeLabel.lastName}, {employeeLabel.firstName}</b>
                <span>{employeeIdentity(employeeLabel)}</span>
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

            {selected ? (
              <p className="muted">El fichador registra únicamente entrada y salida. Los conceptos horarios se calculan o cargan luego desde la gestión horaria.</p>
            ) : null}

            {view?.kind === "cooldown" && cooldownActive ? (
              <div className="clock-cooldown" role="status">
                <Clock3 className="clock-cooldown-icon" aria-hidden="true" />
                <div>
                  <b>Ya registraste una fichada hace unos segundos.</b>
                  <span role="timer" aria-live="off">Podés volver a intentar en {cooldownRemaining} s.</span>
                </div>
              </div>
            ) : null}

            {/* F10: la acción que corresponde al estado del legajo es la principal
                (sólo jerarquía visual; habilitarlas sigue siendo canClockIn/canClockOut).
                Con un ingreso abierto, la salida; sin ingreso abierto o con la
                jornada vencida (olvido de salida), el ingreso. */}
            <div className="clock-actions">
              <Button variant={exitIsPrimary ? "subtle" : "primary"} icon={LogIn} disabled={!canClockIn} onClick={() => startPunch("IN")}>
                {openShiftExceeded ? "Marcar nuevo ingreso" : "Marcar ingreso"}
              </Button>
              <Button variant={exitIsPrimary ? "primary" : "subtle"} icon={LogOut} disabled={!canClockOut} onClick={() => startPunch("OUT")}>
                Marcar salida
              </Button>
            </div>

            {view?.kind === "error" ? <p className="error" role="alert">{view.message}</p> : null}
            {view?.kind === "notice" ? <p className="clock-notice" role="status">{view.message}</p> : null}
            {error ? <p className="error" role="alert">{error}</p> : null}
          </>
        )}
      </section>

      {punch ? (
        <Suspense fallback={<LoadingState text="Preparando cámara..." />}>
          <FaceCaptureModal
            punchType={punch.punchType}
            submitting={punch.step === "submitting"}
            submissionStage={punch.step === "submitting" ? punch.stage : "sending"}
            onCancel={cancelCapture}
            onInterrupted={cameraInterrupted}
            onConfirm={(capture) => void confirmPhotoPunch(capture)}
          />
        </Suspense>
      ) : null}
    </main>
  );
}
