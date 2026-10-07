import { useEffect, useState } from "react";
import { positionApiService } from "../../../services/api/positionApiService";
import type { Position } from "../../../types/position.types";

// Etapa 14D.4: catálogo liviano (`getOptions`, cacheado en services/cache),
// nunca el registro completo de Position. Devuelve todos los estados: el
// legajo tiene que poder mostrar su puesto actual aunque esté inactivo o
// pendiente de recarga.
export function usePositionOptions() {
  const [items, setItems] = useState<Position[]>([]);

  useEffect(() => {
    let mounted = true;
    positionApiService.getOptions()
      .then((positions) => {
        if (mounted) setItems(positions);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  return items;
}

/**
 * A6 (ORG_LOCATION_REORGANIZATION.md §3.3): sólo se asigna un puesto NUEVO si
 * está activo y tiene alcance organizacional. Un puesto anterior (sector sin
 * alcance) sigue siendo consultable, pero no se ofrece para nuevas
 * asignaciones. El backend aplica la misma regla.
 */
export function isAssignablePosition(position: Position) {
  return position.status === "ACTIVO" && Boolean(position.orgScopes?.length);
}
