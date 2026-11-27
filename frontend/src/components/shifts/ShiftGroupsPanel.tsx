import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { LoadingState } from "../ui/LoadingState";
import { Section } from "../ui/Section";
import { TableShell } from "../ui/TableShell";
import { getUserErrorMessage } from "../../services/api/apiClient";
import { shiftGroupApiService, type ShiftGroup } from "../../services/api/shiftGroupApiService";
import { confirmAction } from "../../services/appDialog";
import { sortShiftGroups } from "../../utils/shiftGroups";
import { TOAST_SUCCESS_MS } from "../../utils/toast";
import { ShiftGroupFormModal } from "./ShiftGroupFormModal";

export const NO_GROUPS_TEXT = "Aún no hay grupos configurados. Los turnos se muestran en «Sin grupo».";

function templatesLabel(count: number) {
  return count === 1 ? "1 turno" : `${count} turnos`;
}

/**
 * Gestión de grupos de turnos (R3.2). Lectura para todos los roles; alta,
 * edición, activación e inactivación y eliminación sólo RRHH (el backend es la
 * autoridad). El alcance por grupo para Nivel 2/3 es R8.
 */
export function ShiftGroupsPanel({ groups, status, canEdit, onChanged, onRetry }: { groups: ShiftGroup[] | null; status: "loading" | "success" | "error"; canEdit: boolean; onChanged: () => void; onRetry: () => void }) {
  const [editing, setEditing] = useState<ShiftGroup | "new" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), TOAST_SUCCESS_MS);
    return () => clearTimeout(timeout);
  }, [notice]);

  const ordered = sortShiftGroups(groups ?? []);
  const nextOrder = ordered.length ? Math.min(9999, Math.max(...ordered.map((group) => group.sortOrder)) + 10) : 10;

  const done = (message: string) => {
    setError("");
    setNotice(message);
    onChanged();
  };

  const toggleStatus = async (group: ShiftGroup) => {
    const activating = group.status !== "ACTIVO";
    const message = activating
      ? `¿Querés activar el grupo «${group.name}»? Vuelve a estar disponible para asociarle turnos.`
      : `¿Querés inactivar el grupo «${group.name}»? Deja de estar disponible para asociarle turnos nuevos. ${group.templateCount ? `Sus ${templatesLabel(group.templateCount)} no se borran ni dejan de funcionar.` : ""}`.trim();
    if (!(await confirmAction(message, { title: activating ? "Activar grupo" : "Inactivar grupo", confirmLabel: activating ? "Activar" : "Inactivar", tone: activating ? "primary" : "danger" }))) return;
    try {
      await shiftGroupApiService.update(group.id, { status: activating ? "ACTIVO" : "INACTIVO" });
      done(activating ? "Grupo activado." : "Grupo inactivado.");
    } catch (reason) {
      setError(getUserErrorMessage(reason, "No pudimos cambiar el estado del grupo."));
    }
  };

  const remove = async (group: ShiftGroup) => {
    if (!(await confirmAction(`¿Querés eliminar el grupo «${group.name}»? Esta acción no se puede deshacer.`, { title: "Eliminar grupo", confirmLabel: "Eliminar", tone: "danger" }))) return;
    try {
      await shiftGroupApiService.remove(group.id);
      done("Grupo eliminado.");
    } catch (reason) {
      setError(getUserErrorMessage(reason, "No pudimos eliminar el grupo."));
    }
  };

  // Con la lista vacía el CTA vive en el estado vacío (uno solo, no dos botones iguales).
  const action = canEdit && status === "success" && ordered.length ? <Button variant="primary" onClick={() => setEditing("new")}><Plus size={16} /> Crear grupo</Button> : undefined;

  return (
    <Section title="Grupos de turnos" subtitle="Lugar o ámbito donde se trabaja cada turno. Un turno sin grupo sigue funcionando igual." action={action}>
      {notice ? <div className="toast" role="status">{notice}</div> : null}
      {error ? <p className="error shift-group-panel-error" role="alert">{error}</p> : null}
      {status === "loading" ? (
        <LoadingState text="Cargando grupos..." />
      ) : status === "error" ? (
        <ErrorState message="No pudimos cargar los grupos de turnos." onRetry={onRetry} />
      ) : !ordered.length ? (
        <EmptyState text={NO_GROUPS_TEXT} action={canEdit ? <Button variant="primary" onClick={() => setEditing("new")}><Plus size={16} /> Crear grupo</Button> : undefined} />
      ) : (
        <TableShell minWidth={720}>
          <table className="shift-groups-table">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Código</th>
                <th>Nombre</th>
                <th>Turnos</th>
                <th>Estado</th>
                {canEdit ? <th>Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {ordered.map((group) => (
                <tr key={group.id}>
                  <td>{group.sortOrder}</td>
                  <td><b>{group.code}</b></td>
                  <td>{group.name}</td>
                  <td>{templatesLabel(group.templateCount)}</td>
                  <td><Badge tone={group.status === "ACTIVO" ? "success" : "neutral"}>{group.status === "ACTIVO" ? "Activo" : "Inactivo"}</Badge></td>
                  {canEdit ? (
                    <td>
                      <div className="table-actions">
                        <button type="button" className="table-icon-action" aria-label={`Editar ${group.name}`} title="Editar" onClick={() => setEditing(group)}>
                          <Pencil size={14} /><span>Editar</span>
                        </button>
                        <button type="button" className="table-icon-action" aria-label={`${group.status === "ACTIVO" ? "Inactivar" : "Activar"} ${group.name}`} title={group.status === "ACTIVO" ? "Inactivar" : "Activar"} onClick={() => void toggleStatus(group)}>
                          <Power size={14} /><span>{group.status === "ACTIVO" ? "Inactivar" : "Activar"}</span>
                        </button>
                        <button type="button" className="table-icon-action danger-link" aria-label={`Eliminar ${group.name}`} title="Eliminar" onClick={() => void remove(group)}>
                          <Trash2 size={14} /><span>Eliminar</span>
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
      {editing ? (
        <ShiftGroupFormModal
          group={editing === "new" ? null : editing}
          suggestedOrder={nextOrder}
          close={() => setEditing(null)}
          onSaved={() => {
            const created = editing === "new";
            setEditing(null);
            done(created ? "Grupo creado." : "Cambios guardados.");
          }}
        />
      ) : null}
    </Section>
  );
}
