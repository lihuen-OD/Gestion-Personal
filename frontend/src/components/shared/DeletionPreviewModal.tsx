import { useEffect, useState } from "react";
import { getUserErrorMessage } from "../../services/api/apiClient";
import { deletionApiService, deletionPreviewFromError } from "../../services/api/deletionApiService";
import type { DeletionEffect, DeletionGroup, DeletionPreview } from "../../types/deletion.types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

const effectLabels: Record<DeletionEffect, string> = {
  DELETE: "Se elimina",
  ARCHIVE: "Se archiva",
  UNLINK: "Se desvincula",
  END: "Termina desde hoy",
  REVIEW: "Revisar",
  RECALCULATE: "Se recalcula",
};
const effectTones: Record<DeletionEffect, "danger" | "warning" | "neutral"> = {
  DELETE: "danger",
  ARCHIVE: "warning",
  UNLINK: "neutral",
  END: "warning",
  REVIEW: "warning",
  RECALCULATE: "neutral",
};
const VISIBLE_ITEMS = 6;

const normalizeName = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");

function GroupCard({ group }: { group: DeletionGroup }) {
  const [expanded, setExpanded] = useState(false);
  const items = expanded ? group.items : group.items.slice(0, VISIBLE_ITEMS);
  const hidden = group.count - items.length;
  return (
    <li className={`deletion-group effect-${group.effect.toLowerCase()}`}>
      <div className="deletion-group-head">
        <Badge tone={effectTones[group.effect]}>{effectLabels[group.effect]}</Badge>
        <b>{group.label}</b>
        <span className="deletion-group-count">{group.count}</span>
      </div>
      <p>{group.consequence}</p>
      {items.length ? (
        <ul className="deletion-group-items">{items.map((item) => <li key={item.id}>{item.name}</li>)}</ul>
      ) : null}
      {hidden > 0 && group.items.length > items.length ? (
        <button type="button" className="table-link" onClick={() => setExpanded(true)}>Ver {group.items.length - items.length} más{group.count > group.items.length ? ` (se listan ${group.items.length} de ${group.count})` : ""}</button>
      ) : group.count > group.items.length && group.items.length > 0 ? (
        <small className="deletion-group-more">Se listan {group.items.length} de {group.count}.</small>
      ) : null}
    </li>
  );
}

type Props = {
  /** Recurso del protocolo, p. ej. `/org-structure/zones/<id>`. */
  basePath: string;
  title: string;
  close: () => void;
  /** Después del commit: refrescar pantallas y cachés. */
  onDeleted: (preview: DeletionPreview) => void;
};

/**
 * Eliminación controlada (docs/BACKEND_API_CONTRACTS.md): muestra lo que el
 * backend calculó, pide confirmación explícita (con el nombre escrito si el
 * impacto es grande) y, si al confirmar las dependencias cambiaron, muestra la
 * vista previa nueva para confirmar otra vez.
 */
export function DeletionPreviewModal({ basePath, title, close, onDeleted }: Props) {
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let active = true;
    deletionApiService.preview(basePath)
      .then((value) => { if (active) setPreview(value); })
      .catch((reason) => { if (active) setLoadError(getUserErrorMessage(reason, "No pudimos calcular el impacto de la eliminación.")); });
    return () => { active = false; };
  }, [basePath]);

  const blocked = Boolean(preview?.blockers.length);
  const nameMatches = !preview?.requiresTypedConfirmation || normalizeName(typed) === normalizeName(preview.confirmationText);
  const canConfirm = Boolean(preview) && !blocked && nameMatches && !running;

  async function confirm() {
    if (!preview || !canConfirm) return;
    setRunning(true);
    setError("");
    try {
      await deletionApiService.confirm(basePath, preview, typed);
      onDeleted(preview);
    } catch (reason) {
      const fresh = deletionPreviewFromError(reason);
      if (fresh) {
        setPreview(fresh);
        setChanged(fresh.blockers.length === 0);
        setTyped("");
      }
      setError(getUserErrorMessage(reason, "No se pudo eliminar. Revisá la vista previa e intentá nuevamente."));
    } finally {
      setRunning(false);
    }
  }

  const affected = preview?.groups.reduce((total, group) => total + group.count, 0) ?? 0;
  return (
    <Modal
      title={title}
      subtitle="Revisá qué pasa con cada registro alcanzado antes de confirmar. Nada se borra hasta que confirmes."
      close={close}
      closeDisabled={running}
    >
      <div className="form-stack deletion-preview">
        {!preview && !loadError ? <p className="muted" role="status">Calculando el impacto…</p> : null}
        {loadError ? <p className="error" role="alert">{loadError}</p> : null}
        {preview ? (
          <>
            {changed ? (
              <div className="info-note compact deletion-changed" role="status"><b>El impacto cambió</b><p>Otra operación modificó las dependencias. Revisá la vista previa actualizada y confirmá de nuevo.</p></div>
            ) : null}
            {preview.blockers.length ? (
              <div className="deletion-blockers" role="alert">
                <b>No se puede eliminar por ahora</b>
                <ul>{preview.blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul>
              </div>
            ) : null}
            <p className="deletion-summary">
              {preview.target.label} <b>{preview.target.code ? `${preview.target.code} · ` : ""}{preview.target.name}</b> · {affected} {affected === 1 ? "registro alcanzado" : "registros alcanzados"}. Personas, horas, cierres, novedades, documentos y fichadas nunca se borran.
            </p>
            <ul className="deletion-groups">{preview.groups.map((group) => <GroupCard key={group.key} group={group} />)}</ul>
            {preview.requiresTypedConfirmation && !blocked ? (
              <label className="deletion-typed">
                <span>Para confirmar, escribí <b>{preview.confirmationText}</b></span>
                <input value={typed} onChange={(event) => { setTyped(event.target.value); setError(""); }} autoComplete="off" aria-label={`Escribí ${preview.confirmationText} para confirmar`} />
              </label>
            ) : null}
          </>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button variant="subtle" onClick={close} disabled={running}>Cancelar</Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={!canConfirm}>{running ? "Eliminando..." : "Confirmar eliminación"}</Button>
        </div>
      </div>
    </Modal>
  );
}
