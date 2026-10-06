import type { Prisma } from "@prisma/client";
import { argentinaDayRange } from "../../shared/datetime/argentinaTime";

/**
 * Orden, cursor y filtro de fecha del listado de Notificaciones
 * (docs/decisions/NOTIFICATIONS_EVENT_ORDER.md).
 *
 * `eventAt` (fecha efectiva del hecho, inmutable) es la única fecha que se
 * muestra, ordena y filtra. `createdAt` e `id` sólo desempatan, para que el
 * orden sea total y estable aunque muchas filas compartan el mismo instante.
 */
export const NOTIFICATION_ORDER_BY = [{ eventAt: "desc" }, { createdAt: "desc" }, { id: "desc" }] satisfies Prisma.SystemNotificationOrderByWithRelationInput[];

/** Posición de una fila en ese orden. Nunca un offset: no se corre cuando entran filas nuevas. */
export type NotificationCursor = { eventAt: Date; createdAt: Date; id: string };

// "<eventAt ISO>_<createdAt ISO>_<id>": legible, sin estado y con las tres claves del orden.
const ISO = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z`;
const CURSOR = new RegExp(`^(${ISO})_(${ISO})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`);

export function formatNotificationCursor(row: NotificationCursor): string {
  return `${row.eventAt.toISOString()}_${row.createdAt.toISOString()}_${row.id}`;
}

export function parseNotificationCursor(value: string): NotificationCursor | null {
  const [, eventAtIso, createdAtIso, id] = CURSOR.exec(value) ?? [];
  if (!eventAtIso || !createdAtIso || !id) return null;
  const eventAt = new Date(eventAtIso);
  const createdAt = new Date(createdAtIso);
  if (Number.isNaN(eventAt.getTime()) || Number.isNaN(createdAt.getTime())) return null;
  return { eventAt, createdAt, id };
}

/** Filas estrictamente posteriores a `cursor` en el orden DESC (la página siguiente). */
export function afterNotificationCursor(cursor: NotificationCursor): Prisma.SystemNotificationWhereInput {
  return {
    OR: [
      { eventAt: { lt: cursor.eventAt } },
      { eventAt: cursor.eventAt, createdAt: { lt: cursor.createdAt } },
      { eventAt: cursor.eventAt, createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/** Filas desde el principio hasta `cursor` inclusive: la ventana ya visible, para refrescarla entera. */
export function throughNotificationCursor(cursor: NotificationCursor): Prisma.SystemNotificationWhereInput {
  return { NOT: afterNotificationCursor(cursor) };
}

/**
 * Días calendario Argentina, inclusive en ambos extremos: desde las 00:00 de
 * `dateFrom` hasta antes de las 00:00 del día siguiente a `dateTo`.
 */
export function notificationEventDateWhere(dateFrom?: string, dateTo?: string): Prisma.SystemNotificationWhereInput {
  if (!dateFrom && !dateTo) return {};
  return {
    eventAt: {
      ...(dateFrom ? { gte: argentinaDayRange(dateFrom).startAt } : {}),
      ...(dateTo ? { lt: argentinaDayRange(dateTo).endAt } : {}),
    },
  };
}

/**
 * `eventAt` de una notificación cuyo hecho es un día calendario (columna
 * `@db.Date`, ej. `AttendanceInactivityIncident.operationalDate`): las 00:00
 * de ese día en Argentina. Nunca 00:00 UTC, que en Argentina es el día anterior.
 */
export function calendarDayEventAt(dateKey: string): Date {
  return argentinaDayRange(dateKey).startAt;
}
