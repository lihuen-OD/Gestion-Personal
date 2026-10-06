-- SystemNotification.eventAt: fecha efectiva del hecho de negocio que originó
-- la notificación (docs/decisions/NOTIFICATIONS_EVENT_ORDER.md). Hasta ahora
-- se derivaba en cada lectura, DESPUÉS de paginar por createdAt, desde la
-- entidad de origen — no se podía ordenar, filtrar ni paginar por ella.
--
-- Backfill, mismo criterio que scripts/diagnose-notification-event-at.ts
-- (correrlo antes para ver los conteos por fuente):
--   * ShiftAlert                   -> actualAt (instante real del hecho)
--   * WorkShift                    -> startAt (la jornada, no el cierre automático)
--   * AttendanceInactivityIncident -> operationalDate, fecha calendario
--     argentina, convertida a 00:00 de ese día en Argentina. Nunca 00:00 UTC
--     (eso es 21:00 del día anterior en Argentina).
--   * sin entidad con fecha, o referencia huérfana (entidad ya borrada)
--     -> createdAt. No se inventa ninguna fecha y no se aborta la migración.
-- Desde acá eventAt queda congelado: si un upsert posterior mueve
-- ShiftAlert.actualAt, la notificación histórica no cambia.

ALTER TABLE "SystemNotification" ADD COLUMN "eventAt" TIMESTAMPTZ(3);

UPDATE "SystemNotification" n
SET "eventAt" = COALESCE(
  (SELECT a."actualAt" FROM "ShiftAlert" a WHERE n."entityType" = 'ShiftAlert' AND a."id" = n."entityId"),
  (SELECT w."startAt" FROM "WorkShift" w WHERE n."entityType" = 'WorkShift' AND w."id" = n."entityId"),
  (SELECT i."operationalDate"::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires' FROM "AttendanceInactivityIncident" i WHERE n."entityType" = 'AttendanceInactivityIncident' AND i."id" = n."entityId"),
  n."createdAt"
);

-- Sin hecho propio, un INSERT nuevo toma el mismo CURRENT_TIMESTAMP que createdAt.
ALTER TABLE "SystemNotification" ALTER COLUMN "eventAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SystemNotification" ALTER COLUMN "eventAt" SET NOT NULL;

-- Orden/filtro de la pantalla: (recipientUserId[, status], eventAt). El índice
-- existente (recipientUserId, status, createdAt) se conserva: sigue cubriendo
-- el contador de no leídas y su retiro requiere medición, no intuición.
CREATE INDEX "SystemNotification_recipientUserId_status_eventAt_idx" ON "SystemNotification"("recipientUserId", "status", "eventAt");
CREATE INDEX "SystemNotification_recipientUserId_eventAt_idx" ON "SystemNotification"("recipientUserId", "eventAt");
