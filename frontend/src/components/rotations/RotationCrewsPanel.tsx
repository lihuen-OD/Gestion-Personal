import { Pencil, Plus, Power } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Section } from "../ui/Section";
import { TableShell } from "../ui/TableShell";
import { getUserErrorMessage } from "../../services/api/apiClient";
import { shiftRotationApiService, type ShiftRotation, type ShiftRotationCrew } from "../../services/api/shiftRotationApiService";
import { confirmAction } from "../../services/appDialog";
import { countLabel, humanizeRotationMessage } from "../../utils/shiftRotation";
import { TOAST_SUCCESS_MS } from "../../utils/toast";
import { RotationCrewFormModal } from "./RotationCrewFormModal";

/**
 * Equipos de la rotación (R4.8B1). Lectura para todos; alta, edición y
 * activación/inactivación sólo RRHH. Un equipo que alguna vez tuvo personas no
 * se inactiva (cambiaría los días pasados): la acción no se ofrece y el backend
 * lo rechaza igual.
 */
export function RotationCrewsPanel({ rotation, canEdit, onChanged }: { rotation: ShiftRotation; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<ShiftRotationCrew | "new" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyCrew, setBusyCrew] = useState<string | null>(null);
  const crews = [...rotation.crews].sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code));
  const nextOrder = crews.length ? Math.min(9999, Math.max(...crews.map((crew) => crew.sortOrder)) + 10) : 10;

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), TOAST_SUCCESS_MS);
    return () => clearTimeout(timeout);
  }, [notice]);

  const done = (message: string) => {
    setError("");
    setNotice(message);
    onChanged();
  };

  const toggleStatus = async (crew: ShiftRotationCrew) => {
    const activating = crew.status !== "ACTIVO";
    const message = activating
      ? `¿Querés activar el equipo «${crew.name}»? Un equipo activo necesita sus días completos en cada versión de la grilla que esté vigente o por venir.`
      : `¿Querés inactivar el equipo «${crew.name}»? No tiene ni tuvo personas asignadas; deja de exigir días en la grilla.`;
    if (!(await confirmAction(message, { title: activating ? "Activar equipo" : "Inactivar equipo", confirmLabel: activating ? "Activar" : "Inactivar", tone: activating ? "primary" : "danger" }))) return;
    setBusyCrew(crew.id);
    try {
      await shiftRotationApiService.updateCrew(rotation.id, crew.id, { status: activating ? "ACTIVO" : "INACTIVO" });
      done(activating ? "Equipo activado." : "Equipo inactivado.");
    } catch (reason) {
      setError(humanizeRotationMessage(getUserErrorMessage(reason, "No pudimos cambiar el estado del equipo.")));
    } finally {
      setBusyCrew(null);
    }
  };

  const addButton = <Button variant="primary" onClick={() => setEditing("new")}><Plus size={16} /> Agregar equipo</Button>;

  return (
    <Section title="Equipos" subtitle="Grupos de personas que siguen la misma fila de la grilla." action={canEdit && crews.length ? addButton : undefined}>
      {notice ? <div className="toast" role="status">{notice}</div> : null}
      {error ? <p className="error rotation-section-error" role="alert">{error}</p> : null}
      {!crews.length ? (
        <EmptyState text="Esta rotación todavía no tiene equipos. Cada equipo sigue su propia fila de turnos y descansos en la grilla." action={canEdit ? addButton : undefined} />
      ) : (
        <TableShell minWidth={640}>
          <table className="rotation-crews-table">
            <thead>
              <tr>
                <th className="col-order">Orden</th>
                <th className="col-code">Código</th>
                <th>Nombre</th>
                <th className="col-count">Personas</th>
                <th className="col-state">Estado</th>
                {canEdit ? <th className="col-actions">Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {crews.map((crew) => (
                <tr key={crew.id}>
                  <td className="col-order">{crew.sortOrder}</td>
                  <td className="col-code"><b>{crew.code}</b></td>
                  <td>{crew.name}</td>
                  <td className="col-count">{crew.openMemberCount}</td>
                  <td className="col-state"><Badge tone={crew.status === "ACTIVO" ? "success" : "neutral"}>{crew.status === "ACTIVO" ? "Activo" : "Inactivo"}</Badge></td>
                  {canEdit ? (
                    <td className="col-actions">
                      <div className="table-actions">
                        <button type="button" className="table-icon-action" title="Editar" aria-label={`Editar ${crew.name}`} onClick={() => setEditing(crew)}>
                          <Pencil size={14} /><span>Editar</span>
                        </button>
                        {crew.status !== "ACTIVO" || !crew.everHadMembers ? (
                          <button type="button" className="table-icon-action" title={crew.status === "ACTIVO" ? "Inactivar" : "Activar"} aria-label={`${crew.status === "ACTIVO" ? "Inactivar" : "Activar"} ${crew.name}`} disabled={busyCrew === crew.id} onClick={() => void toggleStatus(crew)}>
                            <Power size={14} /><span>{crew.status === "ACTIVO" ? "Inactivar" : "Activar"}</span>
                          </button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}
      {crews.length ? <p className="rotation-section-footnote">{countLabel(crews.filter((crew) => crew.status === "ACTIVO").length, "equipo activo", "equipos activos")}. «Personas» cuenta asignaciones vigentes o con inicio futuro.</p> : null}
      {editing ? (
        <RotationCrewFormModal
          rotationId={rotation.id}
          crew={editing === "new" ? null : editing}
          suggestedOrder={nextOrder}
          close={() => setEditing(null)}
          onSaved={() => {
            const created = editing === "new";
            setEditing(null);
            done(created ? "Equipo agregado." : "Cambios guardados.");
          }}
        />
      ) : null}
    </Section>
  );
}
