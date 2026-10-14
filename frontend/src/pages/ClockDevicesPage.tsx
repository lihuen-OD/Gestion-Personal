import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Pencil, Search, ShieldOff, Trash2 } from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { DataTable } from "../components/ui/DataTable";
import { Field, FormActions } from "../components/ui/FormControls";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { confirmAction } from "../services/appDialog";
import { getUserErrorMessage } from "../services/api/apiClient";
import { clockDeviceApiService, type ClockDevice, type ClockDeviceConnectivity, type ClockDeviceStatus } from "../services/api/clockDeviceApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { formatDateTime, formatInstantDate } from "../utils/date";
import { TOAST_SUCCESS_MS } from "../utils/toast";

const statusLabel: Record<ClockDeviceStatus, string> = { PENDING: "Pendiente", ACTIVE: "Activo", REVOKED: "Revocado" };
const statusTone: Record<ClockDeviceStatus, "warning" | "success" | "danger"> = { PENDING: "warning", ACTIVE: "success", REVOKED: "danger" };
// F9: la conectividad la deriva el backend del último contacto (heartbeat u
// operación); acá sólo se traduce. Sólo un ACTIVE la tiene.
const connectivityLabel: Record<ClockDeviceConnectivity, string> = { ONLINE: "En línea", OFFLINE: "Sin conexión", NEVER_SEEN: "Sin conexión registrada" };
/**
 * F9: la conectividad cambia sola (un equipo deja de mandar heartbeats), así
 * que la lista se refresca en silencio mientras la pantalla está abierta y
 * visible: sin skeleton, sin tocar modales ni filtros, y un fallo no vacía lo
 * que ya se ve.
 */
export const CLOCK_DEVICES_REFRESH_MS = 30_000;
export const CLOCK_DEVICES_REFRESH_ERROR = "No pudimos actualizar el estado de los dispositivos.";

type EstablishmentOption = { id: string; label: string };

function locationLabel(establishment: NonNullable<ClockDevice["establishment"]>) {
  return establishment.zone ? `${establishment.zone.name} · ${establishment.name}` : establishment.name;
}

function deviceSubtitle(device: ClockDevice) {
  if (device.status === "ACTIVE" && device.activatedAt) return `Aprobado el ${formatInstantDate(device.activatedAt)}`;
  if (device.status === "REVOKED" && device.revokedAt) return `Revocado el ${formatInstantDate(device.revokedAt)}`;
  return `Solicitud del ${formatDateTime(device.createdAt)}`;
}

function Connectivity({ device }: { device: ClockDevice }) {
  if (device.status !== "ACTIVE" || !device.connectivity) return <span className="muted">—</span>;
  return <span className={`device-connectivity ${device.connectivity.toLowerCase()}`}><i aria-hidden="true" />{connectivityLabel[device.connectivity]}</span>;
}

export function ClockDevicesPage() {
  const [items, setItems] = useState<ClockDevice[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageSize: 25, hasMore: false });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [refreshError, setRefreshError] = useState("");
  const [filter, setFilter] = useState<ClockDeviceStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [candidate, setCandidate] = useState<ClockDevice | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [establishmentId, setEstablishmentId] = useState("");
  const [establishments, setEstablishments] = useState<EstablishmentOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ClockDevice | null>(null);
  const [editName, setEditName] = useState("");
  const [editEstablishmentId, setEditEstablishmentId] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [notice, setNotice] = useState("");
  // Sólo la respuesta del último pedido se aplica: un refresco viejo nunca pisa
  // un filtro nuevo.
  const requestSeq = useRef(0);

  const load = useCallback(async (mode: "initial" | "silent") => {
    const seq = ++requestSeq.current;
    if (mode === "initial") setStatus("loading");
    try {
      const response = await clockDeviceApiService.list({ status: filter || undefined, search: search.trim() || undefined, page, take: 25 });
      if (seq !== requestSeq.current) return;
      setItems(response.data); setMeta(response.meta); setStatus("ready"); setRefreshError("");
    } catch {
      if (seq !== requestSeq.current) return;
      if (mode === "initial") setStatus("error");
      else setRefreshError(CLOCK_DEVICES_REFRESH_ERROR);
    }
  }, [filter, search, page]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load("initial"), 200);
    return () => { window.clearTimeout(timeout); requestSeq.current += 1; };
  }, [load, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void load("silent"); }, CLOCK_DEVICES_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(""), TOAST_SUCCESS_MS);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const reload = () => setRefresh((value) => value + 1);
  const closePairing = () => { setPairingOpen(false); setPairingCode(""); setCandidate(null); setDeviceName(""); setEstablishmentId(""); setError(""); };

  // Establecimientos activos del modelo vigente (Zona → Establecimiento), una
  // vez por pantalla. Describen dónde está el equipo; no restringen a quién ficha.
  const loadEstablishments = async () => {
    if (establishments) return establishments;
    const catalog = await orgStructureApiService.getCatalog();
    const options = catalog.establishments
      .filter((item) => item.status === "ACTIVO" && item.zoneId)
      .map(({ id, name, zoneId }) => ({ id, label: `${catalog.zones.find((zone) => zone.id === zoneId)?.name || "Zona"} · ${name}` }));
    setEstablishments(options);
    return options;
  };

  const resolve = async () => {
    setBusy(true); setError("");
    try {
      const resolved = await clockDeviceApiService.resolvePairing(pairingCode);
      await loadEstablishments();
      setCandidate(resolved);
      setDeviceName(resolved.name || "");
      setEstablishmentId(resolved.establishmentId || "");
    } catch (resolveError) { setError(getUserErrorMessage(resolveError, "El código no existe o venció.")); }
    finally { setBusy(false); }
  };

  const activate = async () => {
    if (!candidate || deviceName.trim().length < 2) return setError("Ingresá un nombre para identificar el dispositivo.");
    setBusy(true); setError("");
    try {
      await clockDeviceApiService.activate(candidate.id, { pairingCode, name: deviceName.trim(), establishmentId: establishmentId || null });
      closePairing(); reload();
    } catch (activateError) { setError(getUserErrorMessage(activateError, "No pudimos aprobar el dispositivo.")); }
    finally { setBusy(false); }
  };

  const openEdit = async (device: ClockDevice) => {
    setEditing(device); setEditName(device.name || ""); setEditEstablishmentId(device.establishmentId || ""); setEditError("");
    try { await loadEstablishments(); }
    catch { setEditError("No pudimos cargar los establecimientos. Podés cambiar sólo el nombre."); }
  };
  const closeEdit = () => { setEditing(null); setEditError(""); };

  const saveEdit = async () => {
    if (!editing) return;
    const name = editName.trim();
    if (name.length < 2) return setEditError("Ingresá un nombre de al menos 2 caracteres.");
    if (name.length > 120) return setEditError("El nombre no puede superar los 120 caracteres.");
    const changes: { name?: string; establishmentId?: string | null } = {};
    if (name !== (editing.name || "")) changes.name = name;
    if ((editEstablishmentId || null) !== editing.establishmentId) changes.establishmentId = editEstablishmentId || null;
    if (!Object.keys(changes).length) return closeEdit();
    setEditBusy(true); setEditError("");
    try {
      await clockDeviceApiService.update(editing.id, changes);
      closeEdit();
      setNotice("Dispositivo actualizado");
      void load("silent");
    } catch (saveError) { setEditError(getUserErrorMessage(saveError, "No pudimos guardar los cambios.")); }
    finally { setEditBusy(false); }
  };

  const revoke = async (device: ClockDevice) => {
    if (!await confirmAction(`¿Querés revocar “${device.name}”? El fichador quedará bloqueado.`, { title: "Revocar dispositivo", confirmLabel: "Revocar", tone: "danger" })) return;
    await clockDeviceApiService.revoke(device.id); void load("silent");
  };

  const remove = async (device: ClockDevice) => {
    if (!await confirmAction("¿Querés eliminar esta solicitud pendiente? El dispositivo deberá configurarse nuevamente.", { title: "Eliminar solicitud", confirmLabel: "Eliminar", tone: "danger" })) return;
    await clockDeviceApiService.deletePending(device.id); void load("silent");
  };

  // Si el establecimiento actual ya no está activo, igual se muestra como
  // opción para no aparentar "Sin establecimiento".
  const editOptions = (() => {
    const options = establishments || [];
    const current = editing?.establishment;
    return current && !options.some((option) => option.id === current.id) ? [{ id: current.id, label: `${locationLabel(current)} (inactivo)` }, ...options] : options;
  })();

  return <>
    <PageHeader eyebrow="FICHADOR" title="Dispositivos de fichada" description="Aprobá, ubicá y revocá los equipos habilitados para el fichador standalone." action={<Button variant="primary" icon={Check} onClick={() => setPairingOpen(true)}>Aprobar dispositivo</Button>} />
    <Section title="Equipos registrados" subtitle={`${meta.total} dispositivos encontrados`}>
      <div className="filters">
        <label className="search-field"><Search size={16} /><input aria-label="Buscar dispositivo" placeholder="Buscar por nombre" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        <label>Estado<select value={filter} onChange={(event) => { setFilter(event.target.value as ClockDeviceStatus | ""); setPage(1); }}><option value="">Todos</option><option value="PENDING">Pendientes</option><option value="ACTIVE">Activos</option><option value="REVOKED">Revocados</option></select></label>
      </div>
      {refreshError && status === "ready" ? <div className="clock-devices-refresh-warning" role="status"><AlertTriangle size={15} aria-hidden="true" /><span>{refreshError}</span></div> : null}
      <DataTable status={status === "loading" ? "loading" : status === "error" ? "error" : items.length ? "ready" : "empty"} minWidth={960} emptyText="No hay dispositivos con estos filtros." errorMessage="No se pudieron cargar los dispositivos." onRetry={reload}>
        <table className="clock-devices-table"><thead><tr><th>Dispositivo</th><th>Estado</th><th>Conexión</th><th>Establecimiento</th><th>Última conexión</th><th>Versión</th><th>Acciones</th></tr></thead>
          <tbody>{items.map((device) => <tr key={device.id}>
            <td className="clock-device-cell"><b>{device.name || "Solicitud pendiente"}</b><span>{deviceSubtitle(device)}</span></td>
            <td><Badge tone={statusTone[device.status]}>{statusLabel[device.status]}</Badge></td>
            <td><Connectivity device={device} /></td>
            <td>{device.establishment ? locationLabel(device.establishment) : <span className="muted">Sin establecimiento</span>}</td>
            <td className="cell-nowrap">{device.lastSeenAt ? formatDateTime(device.lastSeenAt) : <span className="muted">Sin registro</span>}</td>
            <td>{device.lastAppVersion || <span className="muted">—</span>}</td>
            <td><div className="table-actions">
              {device.status !== "REVOKED" ? <button className="table-icon-action" title="Editar" aria-label={`Editar ${device.name || "solicitud pendiente"}`} onClick={() => void openEdit(device)}><Pencil size={15} /></button> : null}
              {device.status === "ACTIVE" ? <button className="table-icon-action" title="Revocar" aria-label={`Revocar ${device.name}`} onClick={() => void revoke(device)}><ShieldOff size={15} /></button> : null}
              {device.status === "PENDING" ? <button className="table-icon-action danger-link" title="Eliminar solicitud" aria-label="Eliminar solicitud" onClick={() => void remove(device)}><Trash2 size={15} /></button> : null}
            </div></td>
          </tr>)}</tbody></table>
      </DataTable>
      {meta.total > meta.pageSize ? <div className="form-actions"><Button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button><span className="muted small">Página {page}</span><Button disabled={!meta.hasMore} onClick={() => setPage((value) => value + 1)}>Siguiente</Button></div> : null}
    </Section>
    {pairingOpen ? <Modal title={candidate ? "Completar aprobación" : "Vincular dispositivo"} subtitle={candidate ? "Verificá los datos antes de habilitar el equipo." : "Ingresá el código que muestra el fichador."} close={closePairing} closeDisabled={busy}>
      <div className="form-stack">
        {!candidate ? <><Field label="Código de vinculación" value={pairingCode} set={setPairingCode} /><div className="info-note compact"><b>Validación en dos pasos</b><p>Primero verificamos el código. Luego podrás asignar nombre y establecimiento.</p></div></> : <><div className="info-note compact"><b>Solicitud encontrada</b><p>Registrada {formatDateTime(candidate.createdAt)} · última conexión {candidate.lastSeenAt ? formatDateTime(candidate.lastSeenAt) : "sin conexión"} · versión {candidate.lastAppVersion || "no informada"}.</p></div><Field label="Nombre del dispositivo *" value={deviceName} set={setDeviceName} /><label>Establecimiento (opcional)<select value={establishmentId} onChange={(event) => setEstablishmentId(event.target.value)}><option value="">Sin establecimiento</option>{(establishments || []).map((establishment) => <option key={establishment.id} value={establishment.id}>{establishment.label}</option>)}</select></label></>}
        {error ? <p className="create-error">{error}</p> : null}
        <FormActions><Button onClick={closePairing} disabled={busy}>Cancelar</Button><Button variant="primary" loading={busy} onClick={() => void (candidate ? activate() : resolve())}>{candidate ? "Aprobar dispositivo" : "Verificar código"}</Button></FormActions>
      </div>
    </Modal> : null}
    {editing ? <Modal title="Editar dispositivo" subtitle="El nombre identifica sus fichadas en Asistencia." close={closeEdit} closeDisabled={editBusy}>
      <div className="form-stack clock-device-form">
        <Field label="Nombre del dispositivo *" value={editName} set={setEditName} />
        <label>Establecimiento<select value={editEstablishmentId} onChange={(event) => setEditEstablishmentId(event.target.value)}><option value="">Sin establecimiento</option>{editOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <div className="info-note compact"><b>Ubicación física</b><p>Indica dónde está instalado el equipo. No limita qué personas pueden fichar en él.</p></div>
        {editError ? <p className="error" role="alert">{editError}</p> : null}
        <FormActions><Button onClick={closeEdit} disabled={editBusy}>Cancelar</Button><Button variant="primary" loading={editBusy} onClick={() => void saveEdit()}>Guardar cambios</Button></FormActions>
      </div>
    </Modal> : null}
    {notice ? <div className="toast" role="status">{notice}</div> : null}
  </>;
}
