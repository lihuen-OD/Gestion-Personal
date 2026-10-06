import { useEffect, useRef, useState } from "react";
import { Bell, Check, Eye, FilePlus2 } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { FilterPanel } from "../components/ui/FilterPanel";
import { NOTIFICATIONS_POLL_INTERVAL_MS, NOTIFICATIONS_REFRESH_WINDOW_MAX, workforceApiService, type SystemNotification, type SystemNotificationListMeta, type SystemNotificationListParams } from "../services/api/workforceApiService";
import { NoveltyFromContextModal } from "../components/novelties/NoveltyFromContextModal";
import { buildNoveltyPrefillFromNotification, type NoveltyPrefillContext } from "../utils/noveltyFromAlert";
import { TOAST_SUCCESS_MS } from "../utils/toast";
import { formatDateTime, formatInstantDate } from "../utils/date";

const PAGE_SIZE = 20;
type StatusFilter = "" | "NO_LEIDA" | "LEIDA";
type Filters = { status: StatusFilter; dateFrom: string; dateTo: string };

const emptyFilters: Filters = { status: "", dateFrom: "", dateTo: "" };
const emptyMeta: SystemNotificationListMeta = { total: 0, page: 1, pageSize: PAGE_SIZE, hasMore: false, nextCursor: null };
const INVALID_RANGE_MESSAGE = "La fecha «Desde» no puede ser posterior a «Hasta».";

function filterParams(filters: Filters): SystemNotificationListParams {
  return { status: filters.status || undefined, dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined };
}

// docs/decisions/NOTIFICATIONS_EVENT_ORDER.md: `eventAt` es la única fuente
// de la fecha visible — la misma con la que el backend ordena y filtra
// Desde/Hasta. Sólo cambia el FORMATO: "sin actividad registrada" es un
// hecho de día calendario (eventAt = 00:00 Argentina de ese día), mostrar
// "00:00" sugeriría una hora que no existe.
function notificationDateLabel(item: SystemNotification): string {
  return item.entityType === "AttendanceInactivityIncident" ? formatInstantDate(item.eventAt) : formatDateTime(item.eventAt);
}

export function NotificationsPage() {
  const [items, setItems] = useState<SystemNotification[]>([]);
  const [meta, setMeta] = useState<SystemNotificationListMeta>(emptyMeta);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  // Etapa 15G.2 (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md): "Crear
  // novedad" es el punto principal de este flujo -- Notificaciones agrupa
  // TODAS las alertas del fichador, no sólo las de turno. Crear la
  // novedad no marca la notificación como leída ni cambia su estado; eso
  // sigue siendo "Marcar leída", una acción manual aparte.
  const [noveltyContext, setNoveltyContext] = useState<NoveltyPrefillContext>();
  const [noveltyNotice, setNoveltyNotice] = useState("");
  // La lista visible es siempre un prefijo exacto del orden del backend
  // (eventAt, createdAt, id DESC) que termina en `cursorRef` (meta.nextCursor).
  // Refs y no estado: el polling y "Cargar más" corren desde closures viejas
  // y necesitan el valor vigente, no el del render en que se crearon.
  const cursorRef = useRef<string | null>(null);
  // Sube con cada cambio de filtros/reintento: descarta respuestas de una
  // consulta anterior aunque su cursor coincida por casualidad.
  const generationRef = useRef(0);
  const loadingMoreRef = useRef(false);
  // "Leída" es monótono (no existe "marcar como no leída"): una respuesta
  // pedida antes del POST de lectura nunca revierte lo que ya se marcó acá.
  const readIdsRef = useRef(new Set<string>());

  const invalidRange = Boolean(filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo);

  function commitMeta(next: SystemNotificationListMeta) {
    cursorRef.current = next.nextCursor;
    setMeta(next);
  }

  function reconcileReads(fresh: SystemNotification[], statusFilter: StatusFilter) {
    return fresh.flatMap((item) => {
      if (!readIdsRef.current.has(item.id) || item.status === "LEIDA") return [item];
      return statusFilter === "NO_LEIDA" ? [] : [{ ...item, status: "LEIDA" as const }];
    });
  }

  useEffect(() => {
    let mounted = true;
    const generation = ++generationRef.current;
    // Cambiar un filtro descarta el cursor y lo acumulado con "Cargar más":
    // la lista se reemplaza entera por la primera página del filtro nuevo.
    // Etapa 9I: sin blanquear la lista ya poblada mientras llega la respuesta
    // ("Cargar más" queda oculto hasta entonces — no hay cursor).
    cursorRef.current = null;
    setMeta((current) => ({ ...current, hasMore: false, nextCursor: null }));
    setError("");
    if (invalidRange) {
      setItems([]);
      setMeta(emptyMeta);
      setStatus("success");
      return () => { mounted = false; };
    }
    if (!items.length) setStatus("loading");
    const params = filterParams(filters);
    workforceApiService
      .notifications({ ...params, page: 1, take: PAGE_SIZE })
      .then((result) => {
        if (!mounted) return;
        setItems(reconcileReads(result.items, filters.status));
        commitMeta(result.meta);
        setStatus("success");
      })
      .catch(() => {
        if (!mounted) return;
        setError("No se pudieron cargar las notificaciones.");
        setStatus("error");
      });

    // Etapa 15M.19C (docs/decisions/NOTIFICATIONS_PAGE_LIVE_REFRESH_15M19C.md):
    // refresco silencioso, nunca toca loading/error. Desde la etapa de orden
    // por fecha efectiva vuelve a pedir la VENTANA VISIBLE COMPLETA (`through`
    // = última fila cargada, con los mismos filtros) y la reemplaza: una
    // notificación atrasada por catch-up puede caer en el medio de la lista,
    // no sólo arriba, y sólo así aparece en su lugar cronológico. Acotado a
    // NOTIFICATIONS_REFRESH_WINDOW_MAX: si la ventana creció por encima, la
    // respuesta corta ahí (prefijo correcto) y "Cargar más" sigue desde su
    // última fila — nunca crece indefinidamente ni pierde filas. Un fallo se
    // ignora: el próximo tick/evento reintenta.
    function refreshSilently() {
      if (loadingMoreRef.current) return;
      const through = cursorRef.current;
      const request = through
        ? workforceApiService.notifications({ ...params, through, take: NOTIFICATIONS_REFRESH_WINDOW_MAX })
        : workforceApiService.notifications({ ...params, page: 1, take: PAGE_SIZE });
      request
        .then((result) => {
          // La ventana cambió mientras tanto ("Cargar más", otro refresco o filtros).
          if (!mounted || generation !== generationRef.current || cursorRef.current !== through) return;
          setItems(reconcileReads(result.items, filters.status));
          commitMeta(result.meta);
        })
        .catch(() => undefined);
    }

    const timer = window.setInterval(refreshSilently, NOTIFICATIONS_POLL_INTERVAL_MS);
    // Etapa 15M.19C §11/21: mismo evento que ya usa la campana del topbar
    // (AppShell.tsx) — reacciona sin esperar al próximo tick. `markRead`, más
    // abajo, ya lo dispara al marcar como leída; también puede llegar de
    // otra pestaña/flujo futuro. `focus` cubre volver a la pestaña/app.
    window.addEventListener("app:notifications-changed", refreshSilently);
    window.addEventListener("focus", refreshSilently);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener("app:notifications-changed", refreshSilently);
      window.removeEventListener("focus", refreshSilently);
    };
  }, [filters.status, filters.dateFrom, filters.dateTo, refresh]);

  const loadMore = async () => {
    const after = cursorRef.current;
    if (!meta.hasMore || loadingMoreRef.current || !after) return;
    const generation = generationRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError("");
    try {
      // Cursor (eventAt, createdAt, id) de la última fila, mismos filtros:
      // estable aunque entren notificaciones nuevas o atrasadas entre medio.
      const result = await workforceApiService.notifications({ ...filterParams(filters), after, take: PAGE_SIZE });
      if (generation !== generationRef.current || cursorRef.current !== after) return;
      setItems((current) => {
        const existingIds = new Set(current.map((row) => row.id));
        return [...current, ...reconcileReads(result.items, filters.status).filter((row) => !existingIds.has(row.id))];
      });
      commitMeta(result.meta);
    } catch {
      setError("No se pudieron cargar las notificaciones.");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const markRead = async (item: SystemNotification) => {
    if (item.status === "LEIDA") return;
    try {
      await workforceApiService.readNotification(item.id);
      readIdsRef.current.add(item.id);
      setItems((current) =>
        // Etapa 15M.19C §12: bajo el filtro "No leídas", una fila recién
        // marcada como leída deja de pertenecer a la vista actual — se
        // quita de inmediato en vez de quedar visible con el badge "Leída"
        // hasta el próximo refresco. El cursor no cambia: sigue marcando el
        // mismo punto del orden aunque esa fila ya no se vea.
        filters.status === "NO_LEIDA"
          ? current.filter((row) => row.id !== item.id)
          : current.map((row) => (row.id === item.id ? { ...row, status: "LEIDA" } : row)),
      );
      if (filters.status === "NO_LEIDA") setMeta((current) => ({ ...current, total: Math.max(0, current.total - 1) }));
      window.dispatchEvent(new Event("app:notifications-changed"));
    } catch {
      setError("No se pudo marcar la notificación como leída.");
    }
  };

  const subtitle = status === "loading"
    ? "Consultando notificaciones..."
    : filters.status === "NO_LEIDA" ? `${meta.total} sin leer`
    : filters.status === "LEIDA" ? `${meta.total} leídas`
    : `${meta.total} notificaciones`;

  const hasFilters = Boolean(filters.status || filters.dateFrom || filters.dateTo);
  const emptyText = hasFilters ? "No hay notificaciones para los filtros seleccionados." : "Todavía no hay notificaciones.";

  return <>
    <PageHeader eyebrow="SEGUIMIENTO" title="Notificaciones" description="Alertas de fichada, novedades, cierres mensuales y solicitudes que requieren atención." />
    <Section title="Historial" subtitle={subtitle}>
      <FilterPanel title="Filtros" onClear={hasFilters ? () => setFilters(emptyFilters) : undefined}>
        <label>Desde<input type="date" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
        <label>Hasta<input type="date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} /></label>
        <label>Estado<select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as StatusFilter }))}>
          <option value="">Todas</option>
          <option value="NO_LEIDA">No leídas</option>
          <option value="LEIDA">Leídas</option>
        </select></label>
      </FilterPanel>
      {invalidRange ? <div className="form-error" role="alert">{INVALID_RANGE_MESSAGE}</div> : null}
      {error && status !== "error" ? <div className="form-error">{error}</div> : null}
      <div className="notification-list">
        {status === "loading" ? <LoadingState text="Cargando notificaciones..." /> : null}
        {status === "error" ? <ErrorState message={error} onRetry={() => setRefresh((value) => value + 1)} /> : null}
        {status === "success" ? items.map((item) => {
          const employee = item.employee;
          return <article className={`notification-row ${item.status === "NO_LEIDA" ? "unread" : ""}`} key={item.id}>
          <div className="notification-icon"><Bell size={17}/></div><div><b>{item.title}</b>{employee ? <span className="notification-person">{employee.lastName}, {employee.firstName} · Legajo {employee.legajo}</span> : null}<p>{item.message}</p><small>{notificationDateLabel(item)}</small></div>
          {/* Etapa 14G.6: "Ver detalle" antes marcaba como leída como efecto
              colateral de la navegación (además del botón explícito "Marcar
              leída", que hacía lo mismo) -- sin ninguna distinción visual
              entre ambas acciones. Ahora navegar sólo navega; "Marcar leída"
              sigue siendo la única forma explícita de marcar como leída. */}
          <div className="notification-actions">
            {item.link ? <Link className="table-icon-action" title="Ver detalle" aria-label="Ver detalle" to={item.link}><Eye size={14} /><span>Ver detalle</span></Link> : null}
            {/* Sólo si el backend ya resolvió el empleado para esta
                notificación (ShiftAlert/WorkShift/Employee/
                AttendanceInactivityIncident -- los 4 entityType que
                workforce.service.ts::notifications() enriquece hoy). Sin
                eso no hay datos suficientes para precargar nada. */}
            {employee ? <button type="button" className="table-icon-action" title="Crear novedad" aria-label="Crear novedad" onClick={() => setNoveltyContext(buildNoveltyPrefillFromNotification({ ...item, employee }))}><FilePlus2 size={14} /><span>Crear novedad</span></button> : null}
            {item.status === "NO_LEIDA" ? <button className="table-link" onClick={() => void markRead(item)}><Check size={15}/> Marcar leída</button> : <Badge tone="neutral">Leída</Badge>}
          </div>
        </article>;
        }) : null}
        {status === "success" && !items.length && !invalidRange ? <div className="empty">{emptyText}</div> : null}
      </div>
      {status === "success" && meta.hasMore ? <div className="attendance-load-more"><Button variant="subtle" onClick={() => void loadMore()} loading={loadingMore}>Cargar {Math.min(PAGE_SIZE, meta.total - items.length)} más</Button></div> : null}
    </Section>

    {noveltyContext ? (
      <NoveltyFromContextModal
        context={noveltyContext}
        close={() => setNoveltyContext(undefined)}
        saved={() => {
          setNoveltyContext(undefined);
          setNoveltyNotice("Novedad creada. RRHH la revisa como cualquier otra novedad.");
          // Etapa 15M.16: faltaba este auto-cierre -- el mensaje quedaba
          // anclado en pantalla indefinidamente (mismo bug duplicado en
          // AttendancePage.tsx, mismo flujo de origen). El resto de los
          // ".toast" de la app siempre se limpian solos; éste era la
          // excepción, no la regla.
          setTimeout(() => setNoveltyNotice(""), TOAST_SUCCESS_MS);
        }}
      />
    ) : null}

    {noveltyNotice ? <div className="toast" role="status">{noveltyNotice}</div> : null}
  </>;
}
