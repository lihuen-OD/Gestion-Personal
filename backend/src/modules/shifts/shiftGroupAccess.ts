/**
 * R8 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §26): única fuente del
 * alcance de administración de turnos por grupo. Ningún módulo reimplementa
 * esta regla; todos la combinan con su query.
 *
 * - Nivel 1 (RRHH): todos los grupos, sin filas.
 * - Nivel 2: los grupos de sus filas `UserShiftGroupScope`.
 * - Nivel 3: no tiene filas propias. Hereda, en vivo, la unión de los grupos
 *   de los Nivel 2 ACTIVOS que lo supervisan (`UserSupervisionAssignment`).
 *   El supervisor tiene que seguir siendo Nivel 2: una relación desfasada
 *   nunca abre alcance.
 * - Cualquier otro rol, o sin filas: ningún grupo. Nunca acceso global por
 *   defecto.
 *
 * Es un eje independiente del alcance de legajos (`employeeAccessWhere`): no
 * lo lee ni lo modifica. Las lecturas sobre personas combinan ambos.
 *
 * Sin caché global: el alcance se resuelve una vez por request (memo por
 * objeto request), así que asignar o revocar un grupo, cambiar una
 * supervisión, un rol o el estado de un Nivel 2 rige en la request siguiente.
 * Las cachés de respuesta que dependan del alcance incluyen su huella
 * (`shiftGroupScopeCacheKey`) en la clave, en vez de depender de invalidarse.
 *
 * Los motores internos (resolver, obligaciones, fichador, cobertura) no usan
 * este alcance: no son superficie HTTP de un usuario.
 */
import type { Prisma } from "@prisma/client";
import type { Express, Request } from "express";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { roles } from "../../shared/security/roles";

export type ShiftGroupScope =
  | { readonly all: true }
  | { readonly all: false; readonly groupIds: ReadonlySet<string> };

export const ALL_SHIFT_GROUPS: ShiftGroupScope = Object.freeze({ all: true as const });

const NO_ACCESS_ID = "__NO_ACCESS__";

/** Filtro de `ShiftGroup` administrables por `user`, para combinar en una query. */
export function shiftGroupScopeWhere(user: Pick<Express.AuthUser, "id" | "role">): Prisma.ShiftGroupWhereInput {
  if (user.role === roles.rrhh) return {};
  if (user.role === roles.supervision) return { userScopes: { some: { userId: user.id } } };
  if (user.role === roles.cargaHoraria) {
    return {
      userScopes: {
        some: {
          user: {
            role: roles.supervision,
            status: "ACTIVO",
            supervisionsAsSupervisor: { some: { supervisedUserId: user.id } },
          },
        },
      },
    };
  }
  return { id: NO_ACCESS_ID };
}

type ScopeDb = Pick<PrismaTransactionClient, "shiftGroup">;

/** Resuelve los grupos administrables (una query; ninguna para Nivel 1). */
export async function resolveShiftGroupScope(user: Pick<Express.AuthUser, "id" | "role">, db: ScopeDb = prisma): Promise<ShiftGroupScope> {
  if (user.role === roles.rrhh) return ALL_SHIFT_GROUPS;
  const where = shiftGroupScopeWhere(user);
  if ("id" in where && where.id === NO_ACCESS_ID) return { all: false, groupIds: new Set() };
  const rows = await db.shiftGroup.findMany({ where, select: { id: true } });
  return { all: false, groupIds: new Set(rows.map((row) => row.id)) };
}

const requestScopes = new WeakMap<Request, Promise<ShiftGroupScope>>();

/**
 * Alcance del usuario autenticado, resuelto una sola vez por request. El memo
 * vive con el objeto request (WeakMap): nunca sobrevive a la request.
 */
export function requestShiftGroupScope(req: Request): Promise<ShiftGroupScope> {
  const user = req.user;
  if (!user) return Promise.resolve({ all: false, groupIds: new Set<string>() });
  let scope = requestScopes.get(req);
  if (!scope) {
    scope = resolveShiftGroupScope(user);
    requestScopes.set(req, scope);
  }
  return scope;
}

/** `true` sólo si el grupo es administrable. Sin grupo (`null`) = sólo Nivel 1. */
export function canAccessShiftGroup(scope: ShiftGroupScope, shiftGroupId: string | null | undefined): boolean {
  if (scope.all) return true;
  return typeof shiftGroupId === "string" && scope.groupIds.has(shiftGroupId);
}

function scopedIds(scope: Extract<ShiftGroupScope, { all: false }>) {
  return [...scope.groupIds];
}

/** Filtro de grupos para una query ya resuelta. */
export function shiftGroupWhereForScope(scope: ShiftGroupScope): Prisma.ShiftGroupWhereInput {
  return scope.all ? {} : { id: { in: scopedIds(scope) } };
}

/** Plantillas visibles: las de grupos administrables. Una plantilla sin grupo es sólo de Nivel 1. */
export function shiftTemplateWhereForScope(scope: ShiftGroupScope): Prisma.ShiftTemplateWhereInput {
  return scope.all ? {} : { shiftGroupId: { in: scopedIds(scope) } };
}

/** Rotaciones visibles: las de grupos administrables. */
export function shiftRotationWhereForScope(scope: ShiftGroupScope): Prisma.ShiftRotationWhereInput {
  return scope.all ? {} : { shiftGroupId: { in: scopedIds(scope) } };
}

/**
 * R8.4: forma pública del alcance para la UI (login, refresh, `/auth/me`). Es
 * sólo una pista para mostrar u ocultar acciones: la autoridad es siempre el
 * backend, que lo vuelve a resolver en cada request.
 */
export type ShiftGroupAccess = { all: boolean; groupIds: string[] };

export function toShiftGroupAccess(scope: ShiftGroupScope): ShiftGroupAccess {
  return scope.all ? { all: true, groupIds: [] } : { all: false, groupIds: scopedIds(scope).sort() };
}

/**
 * Huella estable del alcance para claves de caché de respuesta: dos alcances
 * distintos (p. ej. antes y después de una revocación) nunca comparten
 * entrada, sin necesidad de invalidar.
 */
export function shiftGroupScopeCacheKey(scope: ShiftGroupScope): string {
  return scope.all ? "groups:all" : `groups:${scopedIds(scope).sort().join(",")}`;
}
