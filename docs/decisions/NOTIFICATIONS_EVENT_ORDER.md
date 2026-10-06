# Notificaciones — orden, filtro y paginación por fecha efectiva del hecho

Fecha: 2026-10-06
Estado: implementado y validado; migración aplicada **sólo en staging** (production sin tocar)
Continúa: `AUTOMATIC_NOTIFICATION_RECONCILIATION_15M19E.md` (que introdujo `eventDate` derivado — reemplazado acá), `NOTIFICATIONS_PAGE_LIVE_REFRESH_15M19C.md`, `NOTIFICATIONS_END_TO_END_ACCEPTANCE_15M19D.md`, `WORKFORCE_MANAGEMENT_NOTIFICATIONS_PERFORMANCE_14G6.md`

## 1. Problema

Caso real: nadie abrió la app el 02, 03 ni 04/10. El 05/10 el catch-up (15M.19A/B) generó las notificaciones atrasadas de esos días **después** de las del propio 05/10. El listado ordenaba por `createdAt desc`, así que una notificación del 02/10 aparecía por encima de las del 05/10 solo porque su fila se insertó después.

15M.19E ya mostraba la fecha real (`eventDate`), pero la **derivaba en la lectura, después de paginar** por `createdAt`. La fecha que se veía no era la fecha con la que se ordenaba. Por eso no se podía ni ordenar, ni filtrar, ni paginar por ella. Reordenar en memoria la página de 20 habría sido incorrecto entre páginas.

## 2. Dos fechas conceptuales en `SystemNotification`

| Campo | Significa | Uso |
|---|---|---|
| `eventAt` | Cuándo ocurrió el **hecho de negocio** que originó ESTA notificación | La pantalla Notificaciones lo usa para **mostrar, ordenar y filtrar** (Desde/Hasta). Es la única fecha visible. |
| `createdAt` | Cuándo se creó la **fila técnica** | Metadata: segundo criterio de orden, auditoría y diagnóstico de catch-up. No se muestra. |

`eventAt` es un `TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP` y es **inmutable**:
- Lo fija el productor al crear la notificación.
- Ninguna lectura lo vuelve a derivar de la entidad de origen.
- Si un upsert posterior de `ShiftAlert` mueve `actualAt`, la notificación histórica no cambia de fecha ni de posición. La nueva notificación nace con su propio `eventAt`.

Valor de `eventAt` según el productor (`notifyUsers(..., { eventAt })`):

| Productor | `entityType` | `eventAt` |
|---|---|---|
| `createShiftAlert` (`workShiftEvaluationRunner.ts`) | `ShiftAlert` | `actualAt` del hecho |
| `notifyMissingExit` (`timeEntries.service.ts`; vencimiento automático y rollover del fichador) | `WorkShift` | `startAt` de la jornada (no el momento del cierre automático) |
| `persistAndNotifyInactivityIncidents` (`attendanceInactivity.service.ts`) | `AttendanceInactivityIncident` | 00:00 Argentina del día operativo (`calendarDayEventAt`). Nunca 00:00 UTC, que en Argentina es el día anterior |
| Cierres, correcciones, novedades pendientes, intento con jornada abierta | sin hecho propio distinto | se omite: el default de la DB usa **el mismo instante que `createdAt`** (mismo `CURRENT_TIMESTAMP` del INSERT, verificado en staging) |

No cambió cuándo ni qué se genera, ni el texto de ningún mensaje. Solo se agrega el dato de fecha.

## 3. Por qué persistir (y no ordenar por la relación)

Se descartó ordenar en SQL con `LEFT JOIN` a las 3 entidades y `COALESCE` por estos motivos:
- Ningún índice cubre ese orden, así que cada poll (60 s) recorre todas las notificaciones del usuario.
- Acopla el módulo a 3 tablas.
- La fecha seguiría moviéndose con el upsert de `ShiftAlert`.

La fecha efectiva es un concepto estable del dominio. Persistida, ordenar, filtrar y paginar son Prisma directo sobre una columna indexada.

## 4. Orden, cursor y refresco

**Orden total y estable** (`NOTIFICATION_ORDER_BY`, `notificationListing.ts`): `eventAt DESC, createdAt DESC, id DESC`.

**Cursor**, nunca offset:
- Formato: `"<eventAt ISO>_<createdAt ISO>_<id>"`, con las tres claves del orden.
- `after=<cursor>` pide las filas **estrictamente posteriores** a esa tupla:

  ```
  eventAt < E
  OR (eventAt = E AND createdAt < C)
  OR (eventAt = E AND createdAt = C AND id < I)
  ```

- `through=<cursor>` pide la ventana desde el principio **hasta esa fila inclusive**, como `NOT(after)`.
- El UUID se valida en minúsculas, porque la comparación de `id` debe coincidir con el orden de la DB.

**Respuesta**: `meta = { total, page, pageSize, hasMore, nextCursor }`.
- `nextCursor` es la última fila cubierta. Si la página vino vacía, es el borde pedido.
- `hasMore` es una consulta `findFirst` posterior al borde con los mismos filtros (índice, `LIMIT 1`).
- `page` se mantiene por compatibilidad, solo sin cursor. `page > 1` junto con un cursor se rechaza.

**Pantalla** (`NotificationsPage.tsx`):
- "Cargar más" pide `after = meta.nextCursor` con los mismos filtros.
- El polling, el evento `app:notifications-changed` y `focus` piden `through = meta.nextCursor` con `take = NOTIFICATIONS_REFRESH_WINDOW_MAX` (100, igual al máximo de `take` del backend) y **reemplazan** la lista.
  - Una notificación atrasada que cae en el medio de la ventana aparece en su posición cronológica.
  - Bajo "No leídas", las leídas en otro cliente salen de la lista.
  - Si la ventana creció por encima de 100 filas, la respuesta corta ahí (prefijo correcto) y "Cargar más" continúa desde su última fila. El refresco nunca crece indefinidamente ni pierde filas.
- La pantalla **nunca reordena**: muestra el orden del backend.
- Se descartan respuestas obsoletas:
  - un refresco que vuelve después de un "Cargar más";
  - cualquier respuesta de un filtro anterior (contador de generación).
- Cambiar Estado, Desde o Hasta descarta el cursor y lo acumulado, y vuelve a la página 1. "Cargar más" queda oculto hasta la respuesta.
- "Leída" es monótona en el cliente: un refresco pedido antes del POST de lectura no la revierte.

## 5. Filtros Desde/Hasta

- `dateFrom`/`dateTo` usan el formato `AAAA-MM-DD`, son días calendario Argentina e inclusivos. Se combinan con `status`.
- La traducción es `argentinaDayRange`: `eventAt >= 00:00 AR de dateFrom` y `eventAt < 00:00 AR del día siguiente a dateTo`.
- Se filtra por la misma `eventAt` que se muestra y ordena, nunca por `createdAt`.
- Validaciones del schema, con mensajes de negocio:
  - formato inválido;
  - fecha inexistente;
  - "La fecha «Desde» no puede ser posterior a «Hasta»".
- En la UI, cada input de fecha acota al otro (`min`/`max`). Un rango invertido muestra ese mismo mensaje y no consulta al backend.
- Mensajes de vacío distintos:
  - sin filtros: "Todavía no hay notificaciones.";
  - con filtros: "No hay notificaciones para los filtros seleccionados.".

## 6. Fecha visible

`notificationDateLabel` usa **solo** `eventAt`:
- `AttendanceInactivityIncident` se formatea como día (`formatInstantDate`): es un hecho de día calendario y mostrar "00:00" inventaría una hora.
- El resto se formatea como fecha y hora Argentina (`formatDateTime`).

Consecuencia esperada: dentro de un mismo día, los hechos de día calendario (00:00) quedan debajo de los hechos con hora de ese día.

"Crear novedad" desde una notificación (`buildNoveltyPrefillFromNotification`) precarga el día Argentina de `eventAt`. Antes usaba `createdAt`, que en un catch-up ponía el día de la recuperación en lugar del día del hecho.

## 7. Migración y backfill

Migración: `20261006100000_add_system_notification_event_at`. Agrega la columna nullable, la backfillea, le pone `DEFAULT` y `NOT NULL`, y crea 2 índices.

Regla del backfill (la misma que reporta `npm run staging:notifications:event-at`):
- `ShiftAlert.actualAt`;
- `WorkShift.startAt`;
- `operationalDate::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'`;
- si no, `createdAt`. Las **referencias huérfanas** (entidad ya borrada) caen a `createdAt`: no se inventa ninguna fecha y la migración no se aborta.

Staging, 2026-10-06:

| Fuente | Filas |
|---|---|
| `AttendanceInactivityIncident.operationalDate` | 785 |
| `ShiftAlert.actualAt` | 79 |
| `WorkShift.startAt` | 21 |
| `createdAt`, sin entidad con fecha (Employee 2, sin entityType 3) | 5 |
| `createdAt` por referencia huérfana (ShiftAlert 90, WorkShift 4) | 94 |
| **Total** | **984** |

Verificación posterior:
- 984/984 con `eventAt` NOT NULL;
- 0 diferencias contra la regla;
- 0 incidentes corridos de día;
- 593 filas con día del hecho distinto al de creación (catch-up real).

Reportes, EXPLAIN y log en `../backups/notifications-event-at-staging-2026-10-06.*`, fuera del repo.

Rollback (antes de desplegar código que dependa de la columna):

```sql
DROP INDEX "SystemNotification_recipientUserId_eventAt_idx";
DROP INDEX "SystemNotification_recipientUserId_status_eventAt_idx";
ALTER TABLE "SystemNotification" DROP COLUMN "eventAt";
```

## 8. Índices

Índices finales:
- `[recipientUserId, status, createdAt]`: existente, se conserva.
- `[recipientUserId, status, eventAt]`: nuevo.
- `[recipientUserId, eventAt]`: nuevo.

EXPLAIN en staging (usuario con 882 notificaciones):
- "Todas", página 1: antes *Seq Scan* de 882 filas más sort; ahora *Index Scan Backward* sobre `[recipientUserId, eventAt]` más *Incremental Sort* (lee ~21 filas), 0,09 ms.
- Rango de fechas, cursor `after`, `hasMore` y `count`: el mismo índice, 0,09–0,2 ms.
- "No leídas" y el contador de la campana: `[recipientUserId, status, eventAt]`.
- Refresco `through`: *Bitmap Index Scan*, 0,15 ms.

El índice `[recipientUserId, status, createdAt]` ya no aparece en ningún plan de estas consultas. El nuevo `(status, eventAt)` cubre el mismo prefijo. Queda como candidato a retirar **después de medir** en production, no por intuición.

## 9. Fuera de alcance

Sin cambios en:
- la lógica de generación de notificaciones;
- el scheduler;
- inactividad de asistencia;
- alertas de turno;
- el badge;
- el texto de los mensajes;
- los permisos.

Production sin tocar. Antes de aplicar la migración en production, correr el diagnóstico read-only allí. El script exige `APP_ENV=staging`, así que production requiere una decisión explícita.
