// Fichador standalone (F1, docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md).
// Única copia del fichador (la del admin se retiró en F6). F3: la página
// informa cuándo está ocupada para no aplicar una actualización de la app en
// medio de una fichada. F8 (§27): usa sólo /api/clock/*, cada intención de
// fichar tiene UN requestId que se conserva en toda la recuperación
// (features/punch/punchSubmission.ts), el cooldown se muestra con cuenta
// regresiva local y una fichada confirmada vuelve sola al estado inicial.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getUserErrorMessage, type ApiError } from "../services/api/apiClient";
import { isClockDeviceAuthFailure } from "../services/api/clockDeviceSession";
import { timeClockApiService, type ClockEmployee, type ClockPunchResult } from "../services/api/timeClockApiService";
import { submitPunch, type PunchOutcome } from "../features/punch/punchSubmission";
import { LoadingState } from "../components/ui/LoadingState";
import type { FaceCaptureResult, SubmissionStage } from "../components/time-clock/FaceCaptureModal";
import { CAMERA_PAUSED_MESSAGE } from "../components/time-clock/captureMessages";
import { kioskActivity } from "../pwa/kioskActivity";
import { useMaintenanceTrigger } from "../features/maintenance/maintenanceTrigger";
import { ClockAmbient, type ClockStep } from "../features/clock/ClockAmbient";
import { EmployeeSearch, MIN_SEARCH_LENGTH, type SearchState } from "../features/clock/EmployeeSearch";
import { EmployeeStatus, type ShiftView } from "../features/clock/EmployeeStatus";
import { CooldownNotice, DockNotice, PunchDock } from "../features/clock/PunchDock";
import { PunchResult } from "../features/clock/PunchResult";
import { employeeFullName } from "../features/clock/employeeLabels";
import { useOnlineStatus } from "../features/clock/useOnlineStatus";

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

const STATUS_ERROR_FALLBACK = "No pudimos consultar el estado del legajo seleccionado.";

type PunchType = "IN" | "OUT";
type ClockStatus = Awaited<ReturnType<typeof timeClockApiService.status>>;
/**
 * Etapa 6B-1 (F6-01/F6-02): el estado de jornada pertenece a UNA consulta de
 * UN legajo. `seq` identifica la consulta vigente: una respuesta (éxito o
 * error) sólo se aplica si sigue siendo la vigente para el mismo legajo. Limpiar
 * la selección o reiniciar el kiosco descarta la consulta (null), así que una
 * respuesta tardía nunca restaura datos de otra selección.
 */
type StatusQuery =
  | { phase: "loading"; employeeId: string; seq: number }
  | { phase: "ready"; employeeId: string; seq: number; data: ClockStatus }
  | { phase: "error"; employeeId: string; seq: number; message: string };
// requestId: UNO por intención, creado al tocar "Marcar ingreso/salida" y
// descartado al terminar (éxito, error o resultado no confirmado). `employee`
// es la persona confirmada al iniciar la intención: la captura la nombra a
// ella y el envío usa su id, aunque el resto de la pantalla cambie.
type PunchFlow =
  | { step: "capturing"; punchType: PunchType; requestId: string; employee: ClockEmployee }
  | { step: "submitting"; punchType: PunchType; requestId: string; employee: ClockEmployee; stage: SubmissionStage };

const isCurrentQuery = (query: StatusQuery | null, employeeId: string, seq: number) => query?.employeeId === employeeId && query.seq === seq;
type PunchView =
  | { kind: "success"; punchType: PunchType; employee: ClockEmployee; at: string; previousOpenShiftAt?: string }
  | { kind: "cooldown"; deadline: number; totalSeconds: number }
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
  const [statusQuery, setStatusQuery] = useState<StatusQuery | null>(null);
  // `error` y `loading` son sólo de la búsqueda; los de la jornada viven en statusQuery.
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [punch, setPunch] = useState<PunchFlow | null>(null);
  const [view, setView] = useState<PunchView | null>(null);
  // P3 (sólo vista): texto para el que ya llegó la respuesta de la búsqueda.
  // Distingue "buscando" de "sin resultados" sin cambiar la consulta.
  const [searchedFor, setSearchedFor] = useState("");
  const online = useOnlineStatus();
  // Guardas síncronas: un doble tap llega antes del re-render.
  const intentLock = useRef(false);
  const submitLock = useRef(false);
  const alive = useRef(true);
  // Contador de consultas de estado (una por pedido, incluidos los refrescos).
  const statusSeq = useRef(0);
  // Etapa 6B-2: destino del foco al cerrar la cámara si "Marcar…" quedó
  // deshabilitado (p. ej. por la espera entre fichadas).
  const panelRef = useRef<HTMLElement>(null);

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
      // Una búsqueda que quedó en vuelo (cancelada) no deja "buscando" colgado.
      setLoading(false);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const items = await timeClockApiService.searchEmployees(query);
        if (!cancelled) {
          setMatches(items);
          setSearchedFor(query);
        }
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
    setStatusQuery(null);
    setSearch("");
    setMatches([]);
    setSearchedFor("");
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

  // Sólo un estado CONFIRMADO del legajo elegido habilita acciones (F6-02):
  // cargando, con error o de otra selección, no hay ingreso ni salida.
  const confirmedStatus = selected && statusQuery?.phase === "ready" && statusQuery.employeeId === selected.id ? statusQuery.data : undefined;
  const statusLoading = Boolean(selected) && statusQuery?.phase === "loading" && statusQuery.employeeId === selected?.id;
  const statusError = selected && statusQuery?.phase === "error" && statusQuery.employeeId === selected.id ? statusQuery.message : "";
  const canSubmit = Boolean(confirmedStatus) && !punch && !cooldownActive && view?.kind !== "success";
  const openShiftMinutes = useMemo(() => {
    if (!confirmedStatus?.openShift?.startAt) return 0;
    return Math.max(0, Math.round((now.getTime() - new Date(confirmedStatus.openShift.startAt).getTime()) / 60_000));
  }, [now, confirmedStatus?.openShift?.startAt]);
  const openShiftExceeded = openShiftMinutes > MAX_CLOCK_SHIFT_MINUTES;
  const canClockIn = canSubmit && (!confirmedStatus?.openShift || openShiftExceeded);
  const canClockOut = canSubmit && Boolean(confirmedStatus?.openShift) && !openShiftExceeded;
  const exitIsPrimary = Boolean(confirmedStatus?.openShift) && !openShiftExceeded;

  // Consulta del estado de UN legajo. Se aplica sólo si al volver sigue siendo
  // la consulta vigente de ese legajo (no hubo otra selección, limpieza,
  // reinicio ni consulta posterior). El backend responde por el legajo pedido:
  // si la respuesta nombra a otro, no se usa.
  const loadStatus = async (employee: ClockEmployee) => {
    const seq = ++statusSeq.current;
    const employeeId = employee.id;
    setStatusQuery({ phase: "loading", employeeId, seq });
    let next: StatusQuery;
    try {
      const data = await timeClockApiService.status(employeeId);
      next = data.employee.id === employeeId
        ? { phase: "ready", employeeId, seq, data }
        : { phase: "error", employeeId, seq, message: STATUS_ERROR_FALLBACK };
    } catch (statusError) {
      next = { phase: "error", employeeId, seq, message: getUserErrorMessage(statusError, STATUS_ERROR_FALLBACK) };
    }
    if (alive.current) setStatusQuery((current) => (isCurrentQuery(current, employeeId, seq) ? next : current));
  };

  // Después de un error que cambia la jornada o de un resultado no
  // confirmado: estado real del legajo antes del próximo intento, sin pasar
  // por "cargando". Toma la consulta vigente de ESE legajo (si la selección
  // cambió, no toma nada y la respuesta se descarta). Si falla, queda lo que
  // había y el mensaje del intento sigue en pantalla.
  const refreshStatusQuietly = async (employeeId: string) => {
    const seq = ++statusSeq.current;
    setStatusQuery((current) => (current?.employeeId === employeeId && current.phase !== "loading" ? { ...current, seq } : current));
    try {
      const data = await timeClockApiService.status(employeeId);
      if (!alive.current || data.employee.id !== employeeId) return;
      setStatusQuery((current) => (isCurrentQuery(current, employeeId, seq) ? { phase: "ready", employeeId, seq, data } : current));
    } catch {
      // sin acción: no se pisa el mensaje del intento
    }
  };

  const refreshStatus = async () => {
    if (!selected || statusLoading || punch) return;
    setView(null);
    await loadStatus(selected);
  };

  // Con una intención de fichar en curso (cámara abierta o envío) la persona
  // elegida no cambia: la fichada termina, se cancela o se descarta primero.
  const selectEmployee = async (employee: ClockEmployee) => {
    if (punch) return;
    setSelected(employee);
    setSearch(`${employee.lastName}, ${employee.firstName}`);
    setMatches([]);
    setView(null);
    setError("");
    await loadStatus(employee);
  };

  const clearEmployee = () => {
    if (punch) return;
    setSelected(undefined);
    setStatusQuery(null);
    setView(null);
    setSearch("");
    setMatches([]);
    setSearchedFor("");
    setError("");
  };

  const startPunch = (punchType: PunchType) => {
    if (intentLock.current || !canSubmit || !confirmedStatus) return;
    // Sin red no hay fichada: no se abre la cámara ni sale ningún request.
    if (!navigator.onLine) {
      setView({ kind: "error", message: OFFLINE_MESSAGE });
      return;
    }
    intentLock.current = true;
    setError("");
    setView(null);
    setPunch({ step: "capturing", punchType, requestId: crypto.randomUUID(), employee: confirmedStatus.employee });
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
      const totalSeconds = cooldownSeconds(failure);
      setView({ kind: "cooldown", deadline: Date.now() + totalSeconds * 1000, totalSeconds });
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
      // La jornada que confirmó el servidor pasa a ser el estado vigente del
      // legajo que fichó (y deja sin efecto cualquier refresco anterior).
      const seq = ++statusSeq.current;
      const data: ClockStatus = "endAt" in result.workShift
        ? { employee: result.employee, openShift: null }
        : { employee: result.employee, openShift: { id: result.workShift.id, startAt: result.workShift.startAt } };
      setStatusQuery((current) => (current?.employeeId === employee.id && result.employee.id === employee.id ? { phase: "ready", employeeId: employee.id, seq, data } : current));
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
    if (punch?.step !== "capturing" || submitLock.current) return;
    // La fichada es de la persona con la que se inició la intención. Si la
    // selección ya no es esa (no debería pasar: no se puede cambiar con la
    // cámara abierta), no se envía nada.
    const { punchType, requestId, employee } = punch;
    if (selected?.id !== employee.id) {
      finishIntent();
      return;
    }
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
    setPunch({ step: "submitting", punchType, requestId, employee, stage: "sending" });
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
  // Gesto oculto del modo mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md):
  // presión larga sobre el reloj, sólo sin cámara ni fichada en curso. No
  // agrega nada visible para quien ficha.
  const maintenanceTrigger = useMaintenanceTrigger(!punch);

  const onSearchChange = (value: string) => {
    if (punch) return;
    setSearch(value);
    setSelected(undefined);
    setStatusQuery(null);
    setView(null);
    setError("");
  };

  // Confirmación (sólo con respuesta exitosa del backend): reemplaza toda la
  // pantalla hasta que el kiosco vuelve solo al inicio.
  if (success) {
    return (
      <PunchResult
        punchType={success.punchType}
        employeeName={employeeFullName(success.employee)}
        at={success.at}
        previousOpenShiftAt={success.previousOpenShiftAt}
      />
    );
  }

  // Etapa 2 del rediseño: sólo presentación. Qué se busca, qué acción
  // corresponde y si está habilitada sigue saliendo del estado de arriba.
  const query = search.trim();
  const searchState: SearchState = selected ? "idle"
    : error ? "error"
      : query.length === 0 ? "idle"
        : query.length < MIN_SEARCH_LENGTH ? "hint"
          : loading || searchedFor !== query ? "pending"
            : matches.length ? "results" : "empty";

  // Persona y jornada de la selección vigente (confirmedStatus siempre es de
  // `selected`); la captura nombra a la persona con la que se inició.
  const employee = confirmedStatus?.employee ?? selected;
  const shift: ShiftView = statusLoading ? { kind: "loading" }
    : !confirmedStatus ? { kind: "unknown" }
      : !confirmedStatus.openShift ? { kind: "none" }
        : openShiftExceeded ? { kind: "late", startAt: confirmedStatus.openShift.startAt }
          : { kind: "open", startAt: confirmedStatus.openShift.startAt, minutes: openShiftMinutes };

  // Una sola acción: la que corresponde al legajo (canClockIn y canClockOut
  // nunca están habilitadas a la vez). Mismo criterio de F10 (exitIsPrimary).
  const punchType: PunchType = exitIsPrimary ? "OUT" : "IN";
  // Sin estado confirmado (falló la consulta) no se afirma qué fichada corresponde.
  const punchLabel = shift.kind === "unknown" ? "Marcar ingreso o salida"
    : punchType === "OUT" ? "Marcar salida" : openShiftExceeded ? "Marcar nuevo ingreso" : "Marcar ingreso";
  const punchEnabled = punchType === "OUT" ? canClockOut : canClockIn;

  let notice = null;
  if (view?.kind === "cooldown" && cooldownActive) notice = <CooldownNotice secondsLeft={cooldownRemaining} totalSeconds={view.totalSeconds} />;
  else if (view?.kind === "error") {
    const tone = view.message === OFFLINE_MESSAGE || view.message === UNCONFIRMED_MESSAGE ? "warn" : "danger";
    const icon = view.message === OFFLINE_MESSAGE ? "offline" : view.message === UNCONFIRMED_MESSAGE ? "unconfirmed" : "error";
    notice = <DockNotice tone={tone} icon={icon} role="alert">{view.message}</DockNotice>;
  } else if (view?.kind === "notice") notice = <DockNotice tone="neutral" icon="paused" role="status">{view.message}</DockNotice>;
  else if (statusError) notice = <DockNotice tone="danger" icon="error" role="alert">{statusError}</DockNotice>;

  const step: ClockStep = punch ? 3 : selected ? 2 : 1;

  return (
    <main className="kiosk">
      <ClockAmbient now={now} step={step} online={online} maintenanceTrigger={maintenanceTrigger} />

      <section ref={panelRef} className="kiosk-panel" aria-label="Fichada" tabIndex={-1}>
        <div className="kiosk-panel-inner">
          {selected && employee ? (
            <>
              <EmployeeStatus
                employee={employee}
                shift={shift}
                now={now}
                refreshing={statusLoading}
                refreshDisabled={Boolean(punch) || statusLoading}
                changeDisabled={Boolean(punch)}
                onRefresh={() => void refreshStatus()}
                onChange={clearEmployee}
              />
              <PunchDock
                notice={notice}
                punchType={punchType}
                label={punchLabel}
                enabled={punchEnabled}
                statusLoading={statusLoading}
                statusUnknown={shift.kind === "unknown"}
                onPunch={() => startPunch(punchType)}
              />
            </>
          ) : (
            <EmployeeSearch
              value={search}
              state={searchState}
              matches={matches}
              errorMessage={error}
              onChange={onSearchChange}
              onClear={() => onSearchChange("")}
              onSelect={(match) => void selectEmployee(match)}
            />
          )}
        </div>
      </section>

      {punch ? (
        <Suspense fallback={<div className="kiosk-loading"><LoadingState text="Preparando cámara..." /></div>}>
          <FaceCaptureModal
            punchType={punch.punchType}
            submitting={punch.step === "submitting"}
            submissionStage={punch.step === "submitting" ? punch.stage : "sending"}
            onCancel={cancelCapture}
            onInterrupted={cameraInterrupted}
            onConfirm={(capture) => void confirmPhotoPunch(capture)}
            employeeLabel={`${employeeFullName(punch.employee)} · Legajo ${punch.employee.legajo}`}
            now={now}
            returnFocus={() => panelRef.current}
          />
        </Suspense>
      ) : null}
    </main>
  );
}
