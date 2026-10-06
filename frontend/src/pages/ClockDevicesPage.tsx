import { useEffect, useState } from "react";
import { Check, Search, ShieldOff, Trash2 } from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { DataTable } from "../components/ui/DataTable";
import { Field, FormActions } from "../components/ui/FormControls";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { confirmAction } from "../services/appDialog";
import { getUserErrorMessage } from "../services/api/apiClient";
import { clockDeviceApiService, type ClockDevice, type ClockDeviceStatus } from "../services/api/clockDeviceApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { formatDateTime } from "../utils/date";

const statusLabel: Record<ClockDeviceStatus, string> = { PENDING: "Pendiente", ACTIVE: "Activo", REVOKED: "Revocado" };
const statusTone: Record<ClockDeviceStatus, "warning" | "success" | "danger"> = { PENDING: "warning", ACTIVE: "success", REVOKED: "danger" };

export function ClockDevicesPage() {
  const [items, setItems] = useState<ClockDevice[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageSize: 25, hasMore: false });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [filter, setFilter] = useState<ClockDeviceStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [candidate, setCandidate] = useState<ClockDevice | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [sectors, setSectors] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setStatus("loading");
    const timeout = window.setTimeout(() => {
      clockDeviceApiService.list({ status: filter || undefined, search: search.trim() || undefined, page, take: 25 })
        .then((response) => { if (mounted) { setItems(response.data); setMeta(response.meta); setStatus("ready"); } })
        .catch(() => { if (mounted) setStatus("error"); });
    }, 200);
    return () => { mounted = false; window.clearTimeout(timeout); };
  }, [filter, search, page, refresh]);

  const reload = () => setRefresh((value) => value + 1);
  const closePairing = () => { setPairingOpen(false); setPairingCode(""); setCandidate(null); setDeviceName(""); setSectorId(""); setError(""); };

  const resolve = async () => {
    setBusy(true); setError("");
    try {
      const resolved = await clockDeviceApiService.resolvePairing(pairingCode);
      setCandidate(resolved);
      const catalog = await orgStructureApiService.getCatalog();
      setSectors(catalog.sectors.filter((item) => item.status === "ACTIVO").map(({ id, name }) => ({ id, name })));
    } catch (resolveError) { setError(getUserErrorMessage(resolveError, "El código no existe o venció.")); }
    finally { setBusy(false); }
  };

  const activate = async () => {
    if (!candidate || deviceName.trim().length < 2) return setError("Ingresá un nombre para identificar el dispositivo.");
    setBusy(true); setError("");
    try {
      await clockDeviceApiService.activate(candidate.id, { pairingCode, name: deviceName.trim(), sectorId: sectorId || null });
      closePairing(); reload();
    } catch (activateError) { setError(getUserErrorMessage(activateError, "No pudimos aprobar el dispositivo.")); }
    finally { setBusy(false); }
  };

  const revoke = async (device: ClockDevice) => {
    if (!await confirmAction(`¿Querés revocar “${device.name}”? El fichador quedará bloqueado.`, { title: "Revocar dispositivo", confirmLabel: "Revocar", tone: "danger" })) return;
    await clockDeviceApiService.revoke(device.id); reload();
  };

  const remove = async (device: ClockDevice) => {
    if (!await confirmAction("¿Querés eliminar esta solicitud pendiente? El dispositivo deberá configurarse nuevamente.", { title: "Eliminar solicitud", confirmLabel: "Eliminar", tone: "danger" })) return;
    await clockDeviceApiService.deletePending(device.id); reload();
  };

  return <>
    <PageHeader eyebrow="FICHADOR" title="Dispositivos de fichada" description="Aprobá, ubicá y revocá los equipos habilitados para el fichador standalone." action={<Button variant="primary" icon={Check} onClick={() => setPairingOpen(true)}>Aprobar dispositivo</Button>} />
    <Section title="Equipos registrados" subtitle={`${meta.total} dispositivos encontrados`}>
      <div className="filters">
        <label className="search-field"><Search size={16} /><input aria-label="Buscar dispositivo" placeholder="Buscar por nombre" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        <label>Estado<select value={filter} onChange={(event) => { setFilter(event.target.value as ClockDeviceStatus | ""); setPage(1); }}><option value="">Todos</option><option value="PENDING">Pendientes</option><option value="ACTIVE">Activos</option><option value="REVOKED">Revocados</option></select></label>
      </div>
      <DataTable status={status === "loading" ? "loading" : status === "error" ? "error" : items.length ? "ready" : "empty"} minWidth={980} emptyText="No hay dispositivos con estos filtros." errorMessage="No se pudieron cargar los dispositivos." onRetry={reload}>
        <table><thead><tr><th>Dispositivo</th><th>Estado</th><th>Sector</th><th>Última conexión</th><th>Versión</th><th>Registrado</th><th>Acciones</th></tr></thead>
          <tbody>{items.map((device) => <tr key={device.id}><td><b>{device.name || "Solicitud pendiente"}</b></td><td><Badge tone={statusTone[device.status]}>{statusLabel[device.status]}</Badge></td><td>{device.sector?.name || "Sin sector"}</td><td>{device.lastSeenAt ? formatDateTime(device.lastSeenAt) : "Nunca"}</td><td>{device.lastAppVersion || "-"}</td><td>{formatDateTime(device.createdAt)}</td><td><div className="table-actions">{device.status === "ACTIVE" ? <button className="table-icon-action" title="Revocar" onClick={() => void revoke(device)}><ShieldOff size={15} /></button> : null}{device.status === "PENDING" ? <button className="table-icon-action danger-link" title="Eliminar solicitud" onClick={() => void remove(device)}><Trash2 size={15} /></button> : null}</div></td></tr>)}</tbody></table>
      </DataTable>
      {meta.total > meta.pageSize ? <div className="form-actions"><Button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button><span className="muted small">Página {page}</span><Button disabled={!meta.hasMore} onClick={() => setPage((value) => value + 1)}>Siguiente</Button></div> : null}
    </Section>
    {pairingOpen ? <Modal title={candidate ? "Completar aprobación" : "Vincular dispositivo"} subtitle={candidate ? "Verificá los datos antes de habilitar el equipo." : "Ingresá el código que muestra el fichador."} close={closePairing} closeDisabled={busy}>
      <div className="form-stack">
        {!candidate ? <><Field label="Código de vinculación" value={pairingCode} set={setPairingCode} /><div className="info-note compact"><b>Validación en dos pasos</b><p>Primero verificamos el código. Luego podrás asignar nombre y sector.</p></div></> : <><div className="info-note compact"><b>Solicitud encontrada</b><p>Registrada {formatDateTime(candidate.createdAt)} · última conexión {candidate.lastSeenAt ? formatDateTime(candidate.lastSeenAt) : "sin conexión"} · versión {candidate.lastAppVersion || "no informada"}.</p></div><Field label="Nombre del dispositivo *" value={deviceName} set={setDeviceName} /><label>Sector (opcional)<select value={sectorId} onChange={(event) => setSectorId(event.target.value)}><option value="">Sin sector</option>{sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label></>}
        {error ? <p className="create-error">{error}</p> : null}
        <FormActions><Button onClick={closePairing} disabled={busy}>Cancelar</Button><Button variant="primary" loading={busy} onClick={() => void (candidate ? activate() : resolve())}>{candidate ? "Aprobar dispositivo" : "Verificar código"}</Button></FormActions>
      </div>
    </Modal> : null}
  </>;
}
