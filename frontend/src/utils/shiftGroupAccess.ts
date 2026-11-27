import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import type { ShiftGroupAccess, User } from "../types";
import { roleLevel } from "./roles";

/**
 * R8 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §26): alcance por grupo de
 * turnos tal como lo informa el backend (login y `/auth/me`). Nivel 1 ve y
 * administra todo. Nivel 2 sus grupos asignados; Nivel 3 los heredados de sus
 * Nivel 2 activos. Sin grupos = nada (nunca acceso global por defecto).
 *
 * Sólo decide qué mostrar u ofrecer: cada pedido lo vuelve a autorizar el
 * backend, que responde 403/404 ante un grupo o legajo ajeno.
 */
export function shiftGroupAccessOf(user: Pick<User, "role" | "shiftGroupAccess"> | undefined): ShiftGroupAccess {
  if (!user) return { all: false, groupIds: [] };
  if (roleLevel(user.role) === 1) return { all: true, groupIds: [] };
  // Para Nivel 2/3 nunca se toma `all` de la sesión guardada: sólo sus grupos.
  return { all: false, groupIds: user.shiftGroupAccess?.groupIds ?? [] };
}

/** `true` sólo si el grupo es administrable. Sin grupo (`null`) = sólo Nivel 1. */
export function canManageGroup(access: ShiftGroupAccess, groupId: string | null | undefined): boolean {
  if (access.all) return true;
  return typeof groupId === "string" && access.groupIds.includes(groupId);
}

/**
 * Alcance de la sesión para las pantallas de Turnos. Al montarse vuelve a
 * leerlo del backend, así una revocación (o un grupo nuevo) se refleja al
 * entrar, sin cerrar sesión.
 */
export function useShiftGroupAccess() {
  const { user, refreshShiftGroupAccess } = useAuth();
  const level = user ? roleLevel(user.role) : 0;
  useEffect(() => {
    if (level === 2 || level === 3) void refreshShiftGroupAccess?.();
  }, [level, refreshShiftGroupAccess]);
  const access = shiftGroupAccessOf(user);
  return {
    access,
    isGlobal: access.all,
    hasGroups: access.all || access.groupIds.length > 0,
    canManageGroup: (groupId: string | null | undefined) => canManageGroup(access, groupId),
  };
}
