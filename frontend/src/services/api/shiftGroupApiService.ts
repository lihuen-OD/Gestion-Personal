import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";

/**
 * Grupos de turnos (R3, docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §23): el
 * lugar / ámbito operativo de un turno (Planta, Granja, Oficina…), no su
 * función (eso es `ShiftTemplate.categoryName`). Sólo clasificación: no
 * cambia ningún cálculo de jornada.
 */
export type ShiftGroupStatus = "ACTIVO" | "INACTIVO";

export type ShiftGroup = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  status: ShiftGroupStatus;
  templateCount: number;
  createdAt: string;
  updatedAt: string;
};

/** Forma del grupo embebida en cada plantilla del catálogo (`shiftGroup: null` = sin grupo). */
export type ShiftGroupSummary = Pick<ShiftGroup, "id" | "code" | "name" | "status" | "sortOrder">;

export type ShiftGroupCreateInput = { code: string; name: string; sortOrder: number };
export type ShiftGroupUpdateInput = Partial<ShiftGroupCreateInput & { status: ShiftGroupStatus }>;

// Las escrituras son siempre de la misma pantalla: invalidar la familia
// "workforce-config" también refresca el catálogo de plantillas, que trae el
// grupo de cada una (nombre, orden y estado). `silentErrors`: el modal o la
// acción muestran el error en contexto, sin el aviso global duplicado.
export const shiftGroupApiService = {
  list() {
    return cachedData({
      requestKey: "GET:/shifts/groups",
      policy: cachePolicies.shiftGroupsCatalog,
      fetcher: () => apiRequest<{ data: ShiftGroup[] }>("/shifts/groups", { apiCache: false }).then((response) => response.data),
      validate: (value) => Array.isArray(value),
    });
  },
  async create(input: ShiftGroupCreateInput) {
    const result = await apiRequest<{ data: ShiftGroup }>("/shifts/groups", { method: "POST", body: input, silentErrors: true }).then((response) => response.data);
    await invalidateCacheFamily("workforce-config", "shift group created");
    return result;
  },
  async update(id: string, input: ShiftGroupUpdateInput) {
    const result = await apiRequest<{ data: ShiftGroup }>(`/shifts/groups/${id}`, { method: "PATCH", body: input, silentErrors: true }).then((response) => response.data);
    await invalidateCacheFamily("workforce-config", "shift group updated");
    return result;
  },
  async remove(id: string) {
    const result = await apiRequest<{ data: { id: string } }>(`/shifts/groups/${id}`, { method: "DELETE", silentErrors: true }).then((response) => response.data);
    await invalidateCacheFamily("workforce-config", "shift group removed");
    return result;
  },
};
