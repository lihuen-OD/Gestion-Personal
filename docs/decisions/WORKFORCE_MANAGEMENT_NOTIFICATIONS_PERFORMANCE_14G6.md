# Etapa 14G.6 — Optimización y saneamiento de Notificaciones (`/notificaciones`)

Fecha: 2026-09-07
Estado: **completa. Backend optimizado (sin cambiar contrato/RBAC/reglas de negocio), cache backend + dedupe frontend nuevos, y un fix de seguridad/UX explícitamente autorizado (separar navegación de escritura en "Ver detalle"). Sin tocar Prisma schema, sin migraciones, sin cambios de diseño visual, sin tocar Fichador ni generación de alertas.**
Alcance: submódulo Notificaciones (`/notificaciones`, `NotificationsPage.tsx`), badge de `AppShell.tsx` (sólo diagnóstico, sin cambios de código) y el módulo backend `workforce-management` (`workforce.service.ts`/`workforce.controller.ts`/`workforce.cache.ts`) para los 3 endpoints de notificaciones.

---

## 1. Contexto

14G.1-14G.5 resolvieron Inicio, Asistencia, Carga de horas y Alertas de turnos. El candidato recomendado en `docs/decisions/WORKFORCE_MANAGEMENT_SHIFT_ALERTS_PERFORMANCE_14G5.md` §14 para la siguiente etapa era **H. Notificaciones**, con evidencia acumulada desde 14G.1 de: `GET /workforce/notifications` sin cache backend, duplicado x2 por acción, y el hallazgo de seguridad/UX ya documentado de que "Ver detalle" dispara `POST /workforce/notifications/:id/read` como efecto colateral de un click de navegación.

## 2. Evidencia desde 14G.1-14G.5

- **14G.1** (`docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json`, corrida previa a esta etapa): "Entrar a Notificaciones (Todas)" — `networkIdleMs` **2799ms** (Lento), con `GET /workforce/notifications` disparado **x2** (1328ms y 2237ms — duplicado por StrictMode, documentado en §10 de ese reporte). `GET /workforce/notifications-unread-count` aparecía **12 veces** en total a lo largo de todo el recorrido (§9), repartido entre casi todas las acciones "Entrar a X".
- **14G.1 §14** ("Hallazgo de seguridad adicional"): "en Notificaciones, el link 'Ver detalle' dispara `POST /workforce/notifications/:id/read` como efecto colateral de un click de navegación — no es sólo un botón explícito de 'Marcar leída' lo que escribe." El propio journey evita hacer click en filas de esa pantalla por esta razón.
- **`docs/decisions/INITIAL_APP_LANDING_OPTIMIZATION_14F2.md`** (14F.2): ya agregó dedupe/cache frontend a `unreadNotificationCount()` (familia `"notifications"`, TTL 20s) e invalidación en `readNotification()`. Su §14 (limitaciones) dice explícitamente que `notifications()` (el listado) **no fue auditado en esa etapa** — "hay decenas de otros call-sites... que no fueron auditados... podrían o no necesitar el mismo tratamiento". Esta etapa es exactamente esa auditoría pendiente.
- **`docs/PERFORMANCE_STANDARDS.md` §10**: precedente ya establecido para aceptar un hueco de invalidación acotado por un TTL corto cuando el conjunto de write paths no es cerrado (fichador, no corregido "porque requiere una etapa dedicada"). Este mismo criterio ya se aplicó en 14G.5 para `shiftAlertListCache` (no invalidada al generar una alerta nueva desde Fichador, sólo al resolver).

## 3. Diagnóstico antes del cambio

**Backend** (`backend/src/modules/workforce-management/workforce.service.ts`/`workforce.controller.ts`/`workforce.cache.ts`, no existe un módulo `notifications` separado — vive dentro de `workforce-management`):

- **`GET /workforce/notifications` (`notifications()`)**: envolvía sus 2 queries (`findMany` + `count`, ambas de sólo lectura e independientes) en `prisma.$transaction([...])` (forma array) — el mismo antipatrón ya corregido 5 veces en esta serie (14C.2/14G.2/14G.3/14G.5). Serializaba ambas sobre una única conexión en vez de correr en paralelo.
- **Enriquecimiento** (legajo del empleado para notificaciones de tipo `ShiftAlert`/`WorkShift`/`Employee`): ya usaba `Promise.all` (no `$transaction`) desde antes, y sólo se dispara si al menos una notificación de la página actual tiene `entityId` — no hay over-fetch: el `select` (`id, legajo, firstName, lastName`) ya está recortado a lo que la fila de notificación muestra. Confirmado con test que ya existía (`no dispara ninguna query de enriquecimiento cuando ninguna notificación de la página tiene entityId`).
- **Filtros** (`status`): se aplican en el `where` de Prisma, **en DB**, no en memoria. **Paginación** (`page`/`take`, max 100): real, aplicada antes de traer registros.
- **Scope**: `recipientUserId: user.id` — cada usuario sólo ve SUS PROPIAS notificaciones, aplicado directamente en el `where` de ambas queries (no se trae de más y se filtra después). Este es el scope más estricto posible (por usuario, no por rol/jerarquía) — no hay forma de que dos usuarios compartan datos.
- **Cache backend**: **no existía**, y el comentario original explicaba por qué (deliberado, no un olvido): los write paths de `SystemNotification` están dispersos en 5+ módulos (`novelties`/`workforce-management`/`time-entries`/`shifts`/`attendance`, todos vía `notifyUsers`/`notifyRrhh` o creación directa) — "no es un conjunto cerrado y enumerable con confianza" (criterio de `docs/PERFORMANCE_STANDARDS.md` §5). Esta etapa revisita esa decisión con el precedente ya establecido en 14G.5 (§9).
- **`GET /workforce/notifications-unread-count` (`unreadNotificationCount()`)**: una sola query (`prisma.systemNotification.count(...)`), ya rápida en el journey (178-865ms según la corrida) — **no tiene ningún antipatrón que corregir**, no se tocó el backend de este endpoint.
- **`POST /workforce/notifications/:id/read` (`markNotificationRead()`)**: `updateMany` simple, scopeado por `recipientUserId` — sin cambios de lógica, sólo se le agregó invalidación de la nueva cache de listado (mismo write path que ya invalidaba el badge desde 14F.2, ahora extendido).

**Frontend** (`frontend/src/pages/NotificationsPage.tsx`, `frontend/src/app/AppShell.tsx`, `frontend/src/services/api/workforceApiService.ts`):

- **`workforceApiService.notifications()`**: `apiRequest` directo, **sin `cachedData`** (a diferencia de `unreadNotificationCount()`, ya migrado en 14F.2) — sin dedupe in-flight, el doble-montaje de StrictMode disparaba 2 llamadas de red reales por acción. Esto es la causa directa del duplicado x2 visto en 14G.1.
- **`AppShell.tsx` — por qué `unreadNotificationCount` aparece 12 veces en el journey**: se leyó el efecto completo (`useEffect(..., [user?.id])`) — depende únicamente de `user?.id`, monta **una sola vez** por sesión (login), con un poll de 60s y un listener del evento `app:notifications-changed`. **No se refetch en cada navegación interna** (no depende de `location`). Se confirmó, leyendo `workforceManagementPerformanceJourney.spec.ts`, que el journey navega entre submódulos con `page.goto("/ruta")` — una navegación de **página completa**, no un click de `<Link>` dentro de la SPA. Cada `page.goto` reinicia el contexto de JS del navegador, así que `AppShell` (y su cache en memoria) se remonta desde cero en cada acción "Entrar a X" — de ahí las 12 llamadas. **Esto es un artefacto de la metodología de medición (navegación de página completa para poder medir cada acción de forma aislada), no un bug de deduplicación real**: en el uso real de la app (clicks de sidebar, SPA), `AppShell` nunca se remonta mientras la sesión sigue activa, así que esto no ocurre. No se tocó `AppShell.tsx` — no hay ningún problema real que corregir ahí, y agregar persistencia entre recargas completas (única forma de "arreglar" el número del journey) iría contra el criterio ya establecido en el proyecto de no persistir datos operativos de corta vida (`docs/PERFORMANCE_STANDARDS.md`: "Datos operativos... 10-20s backend, 30s frontend", nunca con `persist:true`).
- **Blanking**: `NotificationsPage.tsx` **ya tenía** la guarda correcta desde la Etapa 9I (`if (!items.length) setStatus("loading")`) — no hay ningún bug de blanking que corregir acá (a diferencia de lo que se encontró en Alertas de turnos en 14G.5).
- **"Ver detalle" y `markRead`**: confirmado leyendo el JSX — cuando una notificación no leída tiene `link`, se muestran **2 acciones a la vez**: el `<Link>` "Ver detalle" (que además de navegar dispara `markRead(item)` en su `onClick`) y el botón explícito "Marcar leída" (que hace exactamente lo mismo). Ninguna distinción visual entre ambas. Ver §10 para la decisión tomada sobre esto.

## 4. Causa raíz

**Backend**: `prisma.$transaction([...])` (forma array) para 2 lecturas independientes en `workforceService.notifications`, sin cache backend (decisión previa razonable pero superada por el precedente de 14G.5).

**Frontend**: `workforceApiService.notifications()` sin dedupe in-flight (nunca migrado a `cachedData`, a diferencia de `unreadNotificationCount()`).

**UX/seguridad**: `NotificationsPage.tsx` — "Ver detalle" marcaba como leída sin que el usuario lo supiera, con un botón redundante ("Marcar leída") visible al lado que hacía lo mismo de forma explícita. Confirmado con el usuario como corrección deseada antes de implementar (ver §10).

Ninguna causa es de over-fetch, de filtros en memoria, ni de un problema real de deduplicación del badge (el conteo alto en el journey es metodológico, no un bug).

## 5. Cambios aplicados

### Backend — `backend/src/modules/workforce-management/`

1. **`workforce.service.ts`** — `notifications()`: `prisma.$transaction([...])` → `Promise.all([...])` sobre el cliente `prisma` global. Mismos `where`/`orderBy`/`skip`/`take` exactos.
2. **`workforce.cache.ts`** (nuevo) — `notificationsListCache = createTtlCache(10_000)` (10s, más corto que el resto de las listas operativas del proyecto, precisamente por el conjunto de write paths no cerrado) + `clearNotificationsListCache()`.
3. **`workforce.controller.ts`** — `notifications` ahora usa `userScopedCacheKey(req)` (helper ya existente en este mismo controller, usado por `shiftTemplates`/`doubleRules` desde 9C) + `notificationsListCache.get/set`. `readNotification` ahora llama `clearNotificationsListCache()` tras la escritura real.

### Frontend — `frontend/src/services/cache/cachePolicy.ts` y `frontend/src/services/api/workforceApiService.ts`

4. **`cachePolicy.ts`** — nueva política `notificationsList` (familia `"notifications"` **reusada**, no una nueva — misma familia que `notificationsUnreadCount`, TTL 10s, no persiste, sensible).
5. **`workforceApiService.notifications`** — envuelto con `cachedData` (dedupe in-flight vía `pendingRevalidations`, mismo mecanismo que `unreadNotificationCount`/`getSummary`/etc.). Al compartir familia `"notifications"`, `readNotification()` (que ya invalidaba esa familia desde 14F.2) ahora invalida el badge **y** el listado con la misma llamada, sin código nuevo de invalidación en el frontend.

### Frontend — `frontend/src/pages/NotificationsPage.tsx` (autorizado explícitamente por el usuario, ver §10)

6. El `<Link>` "Ver detalle" ya no tiene `onClick={() => markRead(item)}` — ahora sólo navega. El botón "Marcar leída" (sin cambios) sigue siendo la única acción que marca como leída.

No se tocó `AppShell.tsx` (diagnóstico confirmó que no hay ningún bug ahí — ver §3), ningún otro submódulo, Prisma schema, RBAC, ni el resto de `NotificationsPage.tsx` (filtro de estado, paginación "Cargar más", estados de loading/error/empty).

## 6. Qué NO se cambió

- Método, ruta, query params (`status`, `page`, `take`) de los 3 endpoints — sin cambios.
- Shape del JSON de respuesta (`data`/`meta{total,page,pageSize,hasMore}` para el listado; `{count}` para unread-count) — intacto.
- Filtro por estado (`NO_LEIDA`/`LEIDA`), paginación, ordenamiento (`createdAt desc`) — mismos `where`/`orderBy` exactos.
- Scope del usuario (`recipientUserId`), permisos (`requireAnyRole`) — sin cambios.
- El botón explícito "Marcar leída" — sigue funcionando exactamente igual (mismo `markRead(item)`, mismo `readNotification(id)`).
- El contador de no leídas (badge de `AppShell`) — mismo intervalo de 60s, mismo evento `app:notifications-changed`, mismo TTL de 20s del cache frontend (sin cambios; sólo comparte familia de invalidación con la nueva cache del listado).
- Loading/error/empty states de `NotificationsPage.tsx` — sin cambios (el guard de blanking ya existía desde 9I).
- **No se encontró ningún bug de datos incorrectos** en ninguno de los 3 endpoints.
- Fichador y generación de alertas — no se tocó ningún archivo de esos módulos.

## 7. Contrato de API preservado

Ruta, método, query params, estructura y campos del JSON de respuesta, status codes de los 3 endpoints: **sin cambios**. Verificado con 6 tests nuevos de servicio (que fijan exactamente `where`/`orderBy`/`skip`/`take`, idénticos a antes) y 5 tests nuevos de controller (que fijan que la respuesta cacheada es igual a la del service).

## 8. RBAC/scope preservado

`requireAnyRole([rrhh, supervision, cargaHoraria])` sin cambios en las 3 rutas. `recipientUserId: user.id` se sigue calculando igual y se sigue pasando a ambas queries (antes serializado dentro de la transacción, ahora en `Promise.all`) — verificado con tests que confirman que el `where` de `findMany` y de `count` filtra siempre por el usuario autenticado, y que supervisor/RH nunca mezclan sus propias notificaciones. La cache está scopeada por `userScopedCacheKey` (`userId:role:originalUrl`) — verificado con un test que confirma que dos usuarios con los mismos filtros nunca comparten el resultado cacheado del otro.

## 9. Cache/dedupe

- **TTL backend**: 10.000ms (10s) — el más corto de todos los caches operativos del proyecto hasta ahora (el resto usa 15-20s), a propósito: el conjunto de write paths de `SystemNotification` no es cerrado (§3), así que se acota al mínimo razonable la ventana de "no ver una notificación nueva todavía".
- **TTL frontend**: 10.000ms — igual al backend, más corto que los 20s ya usados por `notificationsUnreadCount` (mismo criterio: el listado es más sensible a mostrar contenido desactualizado que un simple contador).
- **Key backend**: `userScopedCacheKey(req)` = `${userId}:${role}:${originalUrl}` — el querystring completo (`status`, `page`, `take`) ya forma parte de `originalUrl`. Verificado con tests: cambiar cualquier filtro es un cache-miss nuevo; dos usuarios con los mismos filtros nunca comparten resultado.
- **Key frontend**: `GET:/workforce/notifications?<querystring>` dentro de la familia `"notifications"` (reusada, no nueva), además scopeado automáticamente por usuario/rol/empresa/sector vía `buildCacheKey`/`currentUserHash()` (mecanismo ya existente).
- **Invalidación**: `clearNotificationsListCache()` (backend) se dispara al **marcar una notificación como leída** (`POST /workforce/notifications/:id/read`) — el único write path controlado dentro de este módulo. En frontend, `readNotification()` ya invalidaba la familia `"notifications"` completa desde 14F.2 — al compartir familia, ahora también invalida el listado, sin código nuevo.
- **Riesgo de invalidación aceptado y documentado explícitamente**: las notificaciones se **crean** desde `notifyUsers`/`notifyRrhh`, llamados desde 5+ módulos (novelties, workforce-management, time-entries, shifts, attendance). Ninguno de esos call sites invalida `notificationsListCache` — hacerlo requeriría auditar y tocar código en múltiples módulos (incluido, potencialmente, algo cercano a Fichador), fuera de alcance de esta etapa. El riesgo queda acotado al TTL de 10s: una notificación nueva puede tardar hasta 10s en aparecer en el listado para el usuario que la recibe (el badge de no leídas, que corre en un poll separado de 60s + evento, tiene su propio TTL de 20s, sin cambios). Mismo criterio ya aceptado y aplicado en 14G.5 para `shiftAlertListCache`, con un TTL todavía más corto acá por tener un conjunto de write paths más disperso.
- **No se cachean escrituras** — `readNotification`/`markNotificationRead` nunca pasan por ninguna de las 2 caches, sólo las invalidan.

## 10. Caso "Ver detalle" — decisión sobre `markRead`

- **Comportamiento anterior**: al hacer click en "Ver detalle" (un `<Link>` de navegación), además de navegar se disparaba `markRead(item)` → `POST /workforce/notifications/:id/read`, exactamente la misma llamada que el botón explícito "Marcar leída" (visible al mismo tiempo, al lado, para toda notificación no leída). No había ninguna forma de distinguir, desde la UI, "sólo quiero ver el detalle" de "confirmo que la leí".
- **Decisión**: se presentó la evidencia al usuario (dos acciones visibles haciendo lo mismo sin distinción, tal como pide la Parte 2 del pedido para este caso especial) y se preguntó explícitamente qué hacer. El usuario eligió **separar navegación de escritura**: "Ver detalle" ahora sólo navega; "Marcar leída" sigue siendo la única acción que marca como leída.
- **Por qué es seguro**: es un cambio puramente de UI (se quitó un `onClick` de un `<Link>`) — no toca el endpoint `POST /workforce/notifications/:id/read`, ni su contrato, ni su lógica (`markNotificationRead` en el service, sin cambios), ni el botón "Marcar leída" (mismo código, mismo comportamiento). Ningún test backend se vio afectado. El único riesgo funcional (que una notificación que antes se marcaba "sola" al navegar ahora quede como no leída hasta que el usuario la marque explícitamente) es exactamente el comportamiento que el usuario pidió.
- **Tests**: 4 tests nuevos en `NotificationsPage.test.tsx` — "Ver detalle" no ejecuta `readNotification`; "Ver detalle" sigue navegando (mismo `href`); "Marcar leída" sigue ejecutando la escritura sin cambios; una notificación sin `link` no muestra "Ver detalle" (sólo el botón).

## 11. Tests

Backend, **11 tests nuevos** en `workforce-management` (todos los tests del módulo pasando):
- `workforce.service.test.ts` (+1 nuevo, el resto de los 11 existentes migrados de `$transaction` a `Promise.all`): confirma que `notifications()` ya no usa `$transaction`; scope/filtros/paginación/orden/enriquecimiento preservados exactamente.
- `workforce.controller.test.ts` (+5, cache real sin mockear): hit/miss, key por filtros, key por usuario (sin compartir entre scopes), invalidación real end-to-end vía el handler de `readNotification`.

Frontend, **10 tests nuevos**:
- `workforceApiService.test.ts` (+6): dedupe in-flight de `notifications()` (2 llamadas concurrentes → 1 request real), cache dentro del TTL, cache-miss al cambiar page/take/status, invalidación por familia hace que vuelva a pedir, contrato preservado (`{items, meta}`).
- `NotificationsPage.test.tsx` (+4): "Ver detalle" no ejecuta `readNotification`; "Ver detalle" sigue navegando; "Marcar leída" sigue funcionando; sin `link` no se muestra "Ver detalle".

Ningún test depende de tiempos exactos (se usan promesas controladas manualmente y `vi.useFakeTimers()` con `vi.setSystemTime()`, no `setTimeout`/duraciones reales).

## 12. Métricas antes/después

Fuente: `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json`, 1 corrida antes del cambio (14G.1) + 2 corridas después (para confirmar estabilidad).

| Métrica | Antes (14G.1) | Después (14G.6, 2 corridas) | Mejora |
|---|---|---|---|
| "Entrar a Notificaciones" — `visibleMs` | 80ms | 77-81ms | ~igual (ya era rápido) |
| "Entrar a Notificaciones" — `networkIdleMs` | **2799ms (Lento)** | **958-1031ms (Medio)** | **~63-66%** |
| `GET /workforce/notifications` (por llamada) | 1328ms y 2237ms (x2, duplicado) | 395ms y 469ms (x1, sin duplicado) | **~65-79% por llamada, 2 llamadas → 1** |
| Duplicados de `GET /workforce/notifications` en la acción de entrada | Sí (x2, StrictMode) | No (0 en ambas corridas) | Eliminado |
| `GET /workforce/notifications-unread-count` — repeticiones totales en el journey | 12 | 12 | Sin cambios — confirmado como artefacto de `page.goto()` (navegación de página completa entre acciones), no un bug real (ver §3) |
| Ranking — submódulo "H. Notificaciones" | Lento (2799ms) | Medio (1031ms/958ms máx.) | Sale del rango Lento |
| Escrituras ejecutadas por el journey en Notificaciones | 0 (acción de escritura saltada explícitamente) | 0 (ambas corridas) | Sin cambios — sigue sin ejecutar `readNotification` en el journey |
| HTTP errors / console errors | — | 0 / 0 (ambas corridas) | — |

## 13. Riesgos pendientes

- **Invalidación de cache no alcanza la creación de notificaciones desde otros módulos** (§9) — acotado al TTL de 10s, documentado y aceptado explícitamente. Candidato para una etapa futura si se decide auditar los 5+ write paths de `notifyUsers`/`notifyRrhh`.
- Consistencia entre-queries no atómica (`Promise.all` en vez de `$transaction`) — mismo criterio ya aceptado en toda la serie 14G, irrelevante para un listado de notificaciones que se refresca solo.
- Ventana de cache de 10s (frontend y backend) — la más corta de todo el proyecto hasta ahora, elegida a propósito por el riesgo mayor de write-paths dispersos.
- El conteo de 12 repeticiones de `unread-count` en el journey seguirá apareciendo en corridas futuras — es esperado y está documentado como artefacto metodológico, no debe interpretarse como una regresión si reaparece en 14G.7+.
- Journey de un solo usuario sin concurrencia — no reemplaza métricas de producción bajo carga real.

## 14. Recomendación para 14G.7

Con Inicio, Asistencia, Carga de horas, Alertas de turnos y Notificaciones resueltos, quedan como candidatos con evidencia ya recolectada:

1. **F. Bandeja de revisión, vista "Por persona"** (`findManyByEmployeeGrouped`) — señalado repetidamente desde 14G.1 como pendiente (mismo antipatrón `$transaction` ya corregido en 6 endpoints de esta serie), nunca corregido.
2. **A. Inicio** — reapareció en el ranking en corridas de 14G.5 (`GET /time-entries/home-summary` sigue con el duplicado por StrictMode documentado desde 14G.2 y nunca corregido, a diferencia de lo que se hizo para `shifts/alerts` en 14G.5 y `notifications` en esta etapa).
3. Con estos 2 candidatos cerrados, el macro-journey de Gestión horaria (14G.1-14G.7) quedaría con los 10 submódulos revisados al menos una vez desde el diagnóstico inicial — buen punto para una nueva corrida de diagnóstico consolidado (¿14G.8?) antes de dar por cerrada toda la serie.
