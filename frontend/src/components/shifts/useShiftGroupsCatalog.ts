import { useEffect, useState } from "react";
import { shiftGroupApiService, type ShiftGroup } from "../../services/api/shiftGroupApiService";

/** Catálogo de grupos para los formularios de turno. `groups = null` si no cargó (el formulario sigue usable). */
export function useShiftGroupsCatalog() {
  const [groups, setGroups] = useState<ShiftGroup[] | null>(null);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  useEffect(() => {
    let alive = true;
    shiftGroupApiService
      .list()
      .then((items) => {
        if (!alive) return;
        setGroups(items);
        setStatus("success");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, []);
  return { groups, status };
}
