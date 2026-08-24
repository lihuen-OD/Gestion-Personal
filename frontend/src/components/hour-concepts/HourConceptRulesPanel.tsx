import { Pencil, Plus, Power } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { Field } from "../ui/FormControls";
import { LoadingState } from "../ui/LoadingState";
import { Modal } from "../ui/Modal";
import { TableShell } from "../ui/TableShell";
import { confirmAction } from "../../services/appDialog";
import { getUserErrorMessage } from "../../services/api/apiClient";
import { hourConceptRuleApiService } from "../../services/api/hourConceptRuleApiService";
import type { HourConceptRule } from "../../types/hourConceptRule.types";
import type { HourConceptLoadMode } from "../../types/hourConcept.types";
import { useAsyncAction } from "../../utils/useAsyncAction";
import { crossesMidnightLabel, hourConceptRuleStatusLabel, hourConceptRuleStatusTone, sortHourConceptRules } from "./hourConceptRuleLabels";
import { validateHourConceptRuleDraft } from "./hourConceptRuleValidation";

type HourConceptRuleDraft = {
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  status: HourConceptRule["status"];
};

function emptyDraft(): HourConceptRuleDraft {
  return { startTime: "", endTime: "", crossesMidnight: false, status: "ACTIVO" };
}

export function HourConceptRulesPanel({ hourConceptId, loadMode, canEdit }: { hourConceptId: string; loadMode: HourConceptLoadMode; canEdit: boolean }) {
  const [rules, setRules] = useState<HourConceptRule[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");

  const [open, setOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<HourConceptRuleDraft>(emptyDraft());
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    if (loadMode === "MANUAL") {
      setRules([]);
      setLoadStatus("success");
      return () => { mounted = false; };
    }
    setLoadStatus("loading");
    hourConceptRuleApiService.listByConcept(hourConceptId)
      .then((items) => {
        if (!mounted) return;
        setRules(items);
        setLoadStatus("success");
      })
      .catch(() => {
        if (mounted) setLoadStatus("error");
      });
    return () => { mounted = false; };
  }, [hourConceptId, loadMode, refresh]);

  const reload = () => setRefresh((value) => value + 1);

  const close = () => {
    setOpen(false);
    setEditingRuleId(null);
    setDraft(emptyDraft());
    setError("");
  };

  const openCreate = () => {
    setEditingRuleId(null);
    setDraft(emptyDraft());
    setError("");
    setOpen(true);
  };

  const openEdit = (rule: HourConceptRule) => {
    setEditingRuleId(rule.id);
    setDraft({
      startTime: rule.startTime,
      endTime: rule.endTime,
      crossesMidnight: rule.crossesMidnight,
      status: rule.status,
    });
    setError("");
    setOpen(true);
  };

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    const validationError = validateHourConceptRuleDraft(draft);
    if (validationError) return setError(validationError);

    const payload = {
      hourConceptId,
      startTime: draft.startTime,
      endTime: draft.endTime,
      crossesMidnight: draft.crossesMidnight,
      status: draft.status,
    };
    try {
      if (editingRuleId) await hourConceptRuleApiService.update(editingRuleId, payload);
      else await hourConceptRuleApiService.create(payload);
      reload();
      close();
      setNotice("Regla horaria guardada correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch (saveError) {
      setError(getUserErrorMessage(saveError, "No pudimos guardar la regla horaria. Intentá nuevamente."));
    }
  });

  const toggleStatus = async (rule: HourConceptRule) => {
    const activating = rule.status !== "ACTIVO";
    const confirmed = await confirmAction(
      activating
        ? `¿Querés activar la regla ${rule.startTime}-${rule.endTime}?`
        : `¿Querés inactivar la regla ${rule.startTime}-${rule.endTime}? Deja de participar en la clasificación automática.`,
      {
        title: activating ? "Activar regla horaria" : "Inactivar regla horaria",
        confirmLabel: activating ? "Activar" : "Inactivar",
        tone: activating ? "primary" : "danger",
      },
    );
    if (!confirmed) return;
    try {
      await hourConceptRuleApiService.updateStatus(rule.id, activating ? "ACTIVO" : "INACTIVO");
      reload();
    } catch (statusError) {
      setNotice(getUserErrorMessage(statusError, "No pudimos cambiar el estado de la regla. Intentá nuevamente."));
      setTimeout(() => setNotice(""), 3000);
    }
  };

  if (loadMode === "MANUAL") {
    return (
      <div className="info-note compact">
        <p>Este concepto se carga manualmente desde la grilla futura y no utiliza reglas automáticas.</p>
      </div>
    );
  }
  if (loadStatus === "loading") return <LoadingState text="Cargando reglas horarias..." />;
  if (loadStatus === "error") return <ErrorState message="No pudimos cargar las reglas horarias de este concepto." onRetry={reload} />;

  const sortedRules = sortHourConceptRules(rules);

  return (
    <div className="hour-concept-rules-panel">
      {notice ? <div className="toast">{notice}</div> : null}

      <div className="block-card-head">
        <div>
          <h4>Reglas horarias</h4>
          <p>Franjas utilizadas para generar automáticamente este desglose.</p>
        </div>
        {canEdit ? (
          <div className="tracked-actions">
            <Button variant="primary" onClick={openCreate}><Plus size={15} /> Nueva regla</Button>
          </div>
        ) : null}
      </div>

      {!sortedRules.length ? (
        <EmptyState text="Este concepto todavía no tiene reglas horarias configuradas." />
      ) : (
        <TableShell minWidth={720}>
          <table>
            <thead>
              <tr>
                <th>Desde</th>
                <th>Hasta</th>
                <th>Cruza medianoche</th>
                <th>Estado</th>
                {canEdit ? <th>Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {sortedRules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.startTime}</td>
                  <td>{rule.endTime}</td>
                  <td>{crossesMidnightLabel(rule.crossesMidnight)}</td>
                  <td><Badge tone={hourConceptRuleStatusTone(rule.status)}>{hourConceptRuleStatusLabel(rule.status)}</Badge></td>
                  {canEdit ? (
                    <td>
                      <div className="table-actions">
                        <button className="table-icon-action" title="Editar regla" aria-label="Editar regla" onClick={() => openEdit(rule)}>
                          <Pencil size={14} /><span>Editar</span>
                        </button>
                        <button className="table-icon-action" title={rule.status === "ACTIVO" ? "Inactivar regla" : "Activar regla"} aria-label={rule.status === "ACTIVO" ? "Inactivar regla" : "Activar regla"} onClick={() => toggleStatus(rule)}>
                          <Power size={14} /><span>{rule.status === "ACTIVO" ? "Inactivar" : "Activar"}</span>
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}

      {open && (
        <Modal title={editingRuleId ? "Editar regla horaria" : "Nueva regla horaria"} close={close}>
          <div className="form-stack">
            <Field label="Hora desde *" type="time" value={draft.startTime} set={(startTime) => setDraft({ ...draft, startTime })} />
            <Field label="Hora hasta *" type="time" value={draft.endTime} set={(endTime) => setDraft({ ...draft, endTime })} />
            <label className="check-card">
              <input type="checkbox" checked={draft.crossesMidnight} onChange={(event) => setDraft({ ...draft, crossesMidnight: event.target.checked })} />
              Cruza medianoche
            </label>
            {draft.crossesMidnight ? (
              <div className="info-note compact">
                <p>Ejemplo: 21:00 a 04:00 cubre desde la noche hasta la madrugada del día siguiente.</p>
              </div>
            ) : null}
            <label>
              Estado
              <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as HourConceptRule["status"] })}>
                <option value="ACTIVO">Activo</option>
                <option value="INACTIVO">Inactivo</option>
              </select>
            </label>

            {error && <p className="error">{error}</p>}

            <div className="form-actions">
              <Button variant="subtle" onClick={close}>Cancelar</Button>
              <Button variant="primary" onClick={save} disabled={isSaving}>{isSaving ? "Guardando..." : editingRuleId ? "Guardar cambios" : "Guardar regla"}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
