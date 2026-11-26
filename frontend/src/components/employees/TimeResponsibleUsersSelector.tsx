import { useCallback, useEffect, useState } from "react";
import { userApiService } from "../../services/api/userApiService";
import type { User } from "../../types";
import { MultiOptionSelector } from "../users/MultiOptionSelector";

const SUPERVISION_ROLE: User["role"] = "Nivel 2 - Supervisión / Gestión";

export type TimeResponsibleSelection = { ids: string[]; names: string[] };

/**
 * Responsables de carga horaria de un legajo: sólo usuarios Nivel 2 activos,
 * elegidos por usuario (se guarda su `userId`, nunca sólo un nombre). Los Nivel
 * 3 que cada Nivel 2 supervisa heredan el legajo automáticamente. Un
 * seleccionado que dejó de ser Nivel 2 activo se ofrece sólo para quitarlo.
 */
export function TimeResponsibleUsersSelector({
  selectedIds,
  onChange,
  disabled = false,
}: {
  selectedIds: string[];
  onChange: (selection: TimeResponsibleSelection) => void;
  disabled?: boolean;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");

  const load = useCallback(() => {
    setStatus("loading");
    userApiService
      .getAll()
      .then((rows) => {
        setUsers(rows);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);
  useEffect(load, [load]);

  const eligible = users.filter((user) => (user.role === SUPERVISION_ROLE && user.status === "Activo") || selectedIds.includes(user.id));
  const options = eligible.map((user) => ({
    id: user.id,
    label: user.name,
    detail: [user.employeeName, user.email].filter(Boolean).join(" · "),
    inactive: user.role !== SUPERVISION_ROLE || user.status !== "Activo",
  }));
  const nameOf = (id: string) => users.find((user) => user.id === id)?.name || "";

  return (
    <MultiOptionSelector
      title="Responsables de carga horaria"
      help="Usuarios Nivel 2 que acceden a este legajo. Los Nivel 3 que cada uno supervisa lo heredan automáticamente."
      options={options}
      selectedIds={selectedIds}
      onChange={(ids) => onChange({ ids, names: ids.map(nameOf) })}
      disabled={disabled}
      status={status}
      onRetry={load}
      labels={{
        searchPlaceholder: "Buscar usuario Nivel 2 por nombre, legajo vinculado o email",
        searchLabel: "Buscar responsable de carga horaria",
        resultsLabel: "Usuarios Nivel 2 disponibles",
        noMatch: "No encontramos usuarios Nivel 2 con esa búsqueda.",
        noOptions: "Todavía no hay usuarios Nivel 2 - Supervisión / Gestión activos.",
        noneSelected: "Sin responsables de carga horaria.",
        loading: "Cargando usuarios…",
        error: "No se pudieron cargar los usuarios.",
        count: (count) => `${count} responsable${count === 1 ? "" : "s"} seleccionado${count === 1 ? "" : "s"}`,
      }}
    />
  );
}
