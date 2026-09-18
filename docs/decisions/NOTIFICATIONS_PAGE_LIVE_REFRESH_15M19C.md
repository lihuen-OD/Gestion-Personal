# Etapa 15M.19C — Refresco automático de NotificationsPage (sin F5, sin SSE/WebSocket)

Fecha: 2026-09-18
Estado: implementado, validado (tests/typecheck/build de frontend verdes), pendiente de aprobación para commitear — no commiteado, no pusheado
Continúa: diagnóstico 15M.18 (§16-§19), `docs/decisions/DURABLE_ATTENDANCE_INACTIVITY_SCHEDULER_15M19A.md`, `docs/decisions/MISSING_EXPECTED_ENTRY_15M19B.md`

## 1. Resumen ejecutivo

15M.18 diagnosticó que `NotificationsPage` no se actualiza mientras permanece abierta — el backend ya genera notificaciones de forma completamente independiente del frontend (15M.19A/B lo reforzaron), pero la página sólo pedía datos al montar o al cambiar de filtro. Esta etapa es **frontend-only**: agrega polling silencioso reutilizando exactamente el mismo intervalo, la misma capa de acceso HTTP y el mismo evento que ya usaba la campana del topbar — sin SSE, sin WebSocket, sin infraestructura nueva. Cero archivos de backend tocados.

**Archivo modificado**: `frontend/src/pages/NotificationsPage.tsx`. **Constante extraída**: `NOTIFICATIONS_POLL_INTERVAL_MS` (`workforceApiService.ts`), usada también por `AppShell.tsx` (antes tenía `60_000` hardcodeado inline). +10 tests nuevos en `NotificationsPage.test.tsx` (24 → 34, todos verdes) más 2 tests existentes actualizados para reflejar el comportamiento nuevo (ver §14). Suite completa de frontend: 96 archivos, 1041 tests, todos verdes. `tsc -b` y `build` verdes.

## 2. Comportamiento anterior

- Fetch al montar y al cambiar `statusFilter` (`useEffect` con deps `[statusFilter, refresh]`) — sin ningún timer.
- La campana del topbar (`AppShell.tsx`) ya hacía polling cada 60s + escuchaba `app:notifications-changed` — pero sólo actualizaba el contador (`GET /workforce/notifications-unread-count`), nunca la lista de `NotificationsPage`.
- `markRead` (al marcar como leída) ya disparaba `app:notifications-changed` — sólo la campana lo escuchaba; `NotificationsPage` no.

## 3. Mecanismo nuevo — polling, reutilizando todo lo existente

Un único `useEffect` (mismo que ya hacía el fetch de página 1) gana, además del fetch de siempre:

```ts
const timer = window.setInterval(refreshSilently, NOTIFICATIONS_POLL_INTERVAL_MS);
window.addEventListener("app:notifications-changed", refreshSilently);
window.addEventListener("focus", refreshSilently);
return () => {
  mounted = false;
  window.clearInterval(timer);
  window.removeEventListener("app:notifications-changed", refreshSilently);
  window.removeEventListener("focus", refreshSilently);
};
```

`refreshSilently` llama a `workforceApiService.notifications({ page: 1, take: PAGE_SIZE, status: statusFilter || undefined })` — la MISMA función que ya usan el fetch inicial y `loadMore`, con la MISMA capa de cache (`cachedData`, familia `"notifications"`, TTL 10s — ya menor que el intervalo de 60s, así que cada tick pega a red real, no sirve cache vieja). Sin cliente HTTP nuevo, sin hook nuevo, sin duplicar fetchers.

## 4. Intervalo — constante compartida

`NOTIFICATIONS_POLL_INTERVAL_MS = 60_000` en `workforceApiService.ts` (co-ubicada con las funciones de notificaciones que la usan). `AppShell.tsx` (la campana) pasó a importarla en vez de tener `60_000` hardcodeado inline — el único cambio en ese archivo. Ningún otro comportamiento de la campana se tocó.

## 5. Por qué el efecto se re-crea con el filtro (y por qué eso es correcto)

El `useEffect` sigue dependiendo de `[statusFilter, refresh]` — sin cambios en esa lista de dependencias. Cuando el filtro cambia, el efecto se limpia (cancela el timer/listeners viejos) y se vuelve a crear con el nuevo `statusFilter` ya cerrado en el closure de `refreshSilently` — el próximo tick de polling automáticamente usa el filtro correcto, sin ningún estado adicional que sincronizar a mano.

## 6. Fetch inicial — sin cambios de UX

El bloque original (loading gateado por `!items.length`, error con `ErrorState`/reintento) se dejó exactamente igual — no se tocó una sola línea de ese camino. `refreshSilently` es un camino de código enteramente separado, que nunca llama a `setStatus`/`setError`.

## 7. Silencioso — qué significa exactamente

`refreshSilently`, en éxito: fusiona `items` (ver §9) y actualiza sólo `meta.total`/`meta.hasMore` (nunca `meta.page`, ver §8). En error: no hace nada visible — ni `setError` ni `setStatus("error")` — el catch está vacío a propósito, con un comentario explicando por qué (§12). Nunca se dispara un `LoadingState`/skeleton para un tick de polling — verificado con test (Caso H).

## 8. Paginación — política elegida

**El problema real**: la paginación es offset-based (`page`/`take`, sin cursor) — insertar notificaciones nuevas mientras el usuario ya cargó varias páginas mueve el "piso" de cualquier página siguiente. Cambiar a cursor-based habría requerido tocar el backend (`workforce.service.ts::notifications`), explícitamente fuera de alcance de esta etapa ("Backend NO debería cambiar").

**Política elegida, sin tocar el backend**:
- `refreshSilently` SIEMPRE pide página 1 (las `PAGE_SIZE` más recientes) — nunca re-pide páginas ya cargadas.
- El resultado se fusiona (`mergeNotifications`, ver §9) con lo que ya está en pantalla — nunca reemplaza el array completo. Cualquier fila ya cargada (de "Cargar más") que no aparezca en la ventana fresca de página 1 se conserva tal cual, al final.
- `meta.page`/`meta.pageSize` — el par que `loadMore` usa para pedir la página siguiente — **nunca se tocan** en un refresco silencioso. Sólo `meta.total`/`meta.hasMore` se actualizan (recalculado como `items.length` ya fusionado `< total` fresco, no el `hasMore` que el backend devolvió para su propia página 1). Si se pisara `meta.page` con el `1` que cada refresco silencioso trae, "Cargar más" jamás avanzaría más allá de la página 2 — se rompería la paginación profunda por completo.
- `loadMore` gana una deduplicación por id (`existingIds`) antes de anexar la respuesta de la página siguiente — protege contra el caso en que el drift de offset (una notificación nueva empujó el límite de página) haga que la próxima página "oficial" repita una fila que un refresco silencioso ya había traído.

**Límite aceptado, documentado, no bloqueante**: con inserciones muy frecuentes y páginas muy profundas, es teóricamente posible que una fila caiga en una brecha (nunca la trae ni el refresco de página 1 ni ninguna página "oficial" ya solicitada) — nunca se duplica (la deduplicación por id lo impide estructuralmente) y nunca se sirve algo incorrecto, en el peor caso una fila queda sin mostrarse hasta un remontaje completo de la página. Este es un límite inherente a paginación offset con inserciones en vivo, preexistente a esta etapa (ya podía pasar sin polling, con sólo "Cargar más" repetido a lo largo de una sesión larga) — no se intentó resolver sin cambiar a cursor-based en el backend, correctamente fuera de alcance acá.

## 9. `mergeNotifications` — fusión por id, orden y estado monótono

```ts
function mergeNotifications(current, fresh) {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const freshIds = new Set(fresh.map((item) => item.id));
  const reconciled = fresh.map((item) => {
    const existing = currentById.get(item.id);
    if (existing?.status === "LEIDA" && item.status !== "LEIDA") return { ...item, status: existing.status };
    return item;
  });
  const remaining = current.filter((item) => !freshIds.has(item.id));
  return [...reconciled, ...remaining];
}
```

- **Orden**: `fresh` ya viene `createdAt desc` del backend — las filas frescas (nuevas o actualizadas) van primero, seguidas de lo previamente cargado que no reapareció en la ventana fresca. Una notificación nueva siempre aparece arriba.
- **Sin duplicados**: `remaining` excluye explícitamente cualquier id presente en `fresh` — estructuralmente imposible renderizar la misma fila dos veces, sin importar el drift de offset de §8.
- **Estado "leída" monótono**: el producto no tiene "marcar como no leída" — si el estado local de una fila ya avanzó a `LEIDA` (por ejemplo, por `markRead`, cuyo POST puede completar antes o después de que un poll ya en vuelo devuelva una respuesta vieja), un refresco que todavía no vio esa escritura nunca la revierte. Esto cierra la única carrera real identificada entre "marcar como leída" y un poll concurrente.

## 10. Marcar como leída — sin esperar al polling

`markRead` no cambió su flujo (`await readNotification` → actualiza local → dispatch del evento), pero gana una distinción por filtro activo:

- Filtro `"NO_LEIDA"`: la fila se **quita** de `items` de inmediato (ya no pertenece a esa vista) y `meta.total` se decrementa en 1 — sin esto, la fila quedaba visible con el badge "Leída" hasta el próximo refresco, contradiciendo el propio filtro.
- Cualquier otro filtro (`""`/`"LEIDA"`): igual que antes, sólo actualiza el `status` en el lugar (bajo `"LEIDA"` nunca puede ocurrir en la práctica — el botón "Marcar leída" no se renderiza para una fila ya `LEIDA`).

El `dispatchEvent("app:notifications-changed")` que `markRead` ya hacía (para la campana) ahora también dispara el `refreshSilently` propio de `NotificationsPage` — un refresco extra, redundante con la actualización local inmediata pero inofensivo (mismo endpoint, mismo merge idempotente) y coherente con "reaccionar al mismo evento que ya existe" (§11 del pedido).

## 11. Evento `app:notifications-changed` y foco de ventana

`NotificationsPage` ahora escucha el mismo evento que ya escuchaba la campana — cualquier disparo (el propio `markRead`, u otro origen futuro) dispara un `refreshSilently` inmediato, sin esperar el próximo tick de 60s. Se agregó además `window.addEventListener("focus", refreshSilently)` (pedido como preferencia "si es simple de implementar", §21 del pedido) — volver a la pestaña/app trae datos frescos de inmediato en vez de esperar hasta 60s. Ambos listeners comparten la misma función `refreshSilently`, sin duplicar lógica.

## 12. Errores temporales de polling

El `.catch()` de `refreshSilently` está vacío a propósito — ni vacía `items`, ni toca `status`/`error`, ni muestra ningún banner. El siguiente tick (60s después) o el siguiente evento reintenta solo, sin ninguna acción del usuario. El fetch inicial/manual (montaje, cambio de filtro, botón "Reintentar" de `ErrorState`) conserva exactamente el comportamiento de error de siempre — sin cambios.

## 13. Scroll, foco de UI y accesibilidad

- **Scroll** (15M.14): ningún código nuevo llama a `scrollTo`/`scrollIntoView`. Prepender filas nuevas arriba de la lista es responsabilidad del scroll-anchoring nativo del navegador; `.page-wrap` (dueño del scroll vertical desde 15M.14) no se tocó.
- **Foco/modales**: `refreshSilently` sólo toca `items`/`meta` — nunca `noveltyContext` (el modal de "Crear novedad") ni ningún elemento de foco. Un poll en curso no puede cerrar un modal abierto ni robar foco.
- **Accesibilidad**: no se agregó ninguna región `aria-live` para la lista — el único `role="status"` existente (el toast de "Novedad creada") es ajeno a este cambio y sigue igual. Sin anuncios nuevos por refresco silencioso.

## 14. Cache

`cachePolicies.notificationsList` (familia `"notifications"`, TTL 10s) ya garantizaba que cualquier llamada a `notifications()` separada por más de 10s pegue a red real — con un intervalo de 60s, cada tick de polling siempre obtiene datos actuales, sin necesidad de tocar la política de cache. No se eliminó ni se agregó ningún cache nuevo.

## 15. StrictMode / cleanup

El `useEffect` limpia el `timer` (`clearInterval`) y ambos listeners (`removeEventListener`) en su función de cleanup — el mismo patrón ya usado por la campana en `AppShell.tsx` (que ya convive con StrictMode sin duplicar timers). Un doble-montaje de StrictMode en desarrollo termina con exactamente un timer y un par de listeners activos, nunca duplicados.

## 16. Tests

`NotificationsPage.test.tsx`: 24 → 34 tests (todos verdes). 2 tests existentes actualizados para reflejar el comportamiento nuevo (ver detalle abajo — no rotos, sino corregidos porque afirmaban como correcto el comportamiento que esta etapa cambia a propósito):

- **Actualizados**: "marcar como leída... no vuelve a pedir el listado completo" pasó a describir que la actualización es inmediata (sin esperar refetch); se agregó un test hermano que confirma explícitamente el refresco silencioso adicional disparado por el propio evento que `markRead` ya emitía.
- **Nuevos — Casos A-H del pedido**: A (fetch inicial, ya cubierto por la suite existente de la Etapa 9I), B (polling tras el intervalo), C (notificación nueva aparece sin remount), D (el polling conserva el filtro activo), E (un fallo temporal no vacía la lista, el siguiente tick reintenta solo), F (evento `app:notifications-changed` → refetch inmediato), G (desmontar limpia el timer), H (el refresco silencioso nunca muestra el skeleton).
- **Foco de ventana**: recuperar el foco dispara un refetch inmediato.
- **Paginación + polling**: con 2 páginas ya cargadas, un refresco silencioso con una notificación nueva no duplica "Página uno" ni pierde "Página dos"; "Cargar más" después de un refresco silencioso no duplica una fila que ese refresco ya había traído.

**Validación de frontend**: `npx tsc -b` ✅, `npm run test` ✅ (96 archivos, 1041 tests), `npm run build` ✅, `git diff --check` ✅.

**Backend**: sin cambios, sin tests nuevos — ningún archivo de `backend/` tocado.

## 17. Qué NO se tocó

- Generación backend, scheduler (`clockPunchMaintenance.ts`, `attendanceInactivityScheduler.ts`, `missingEntry.service.ts`) — ningún archivo de `backend/` tocado.
- `ShiftAlert`, `AttendanceInactivityIncident`, `WorkRegime`, lógica de feriados — sin cambios.
- El endpoint `GET /workforce/notifications` y su paginación offset-based — sin cambios (la política de §8 trabaja enteramente del lado del cliente).
- La política de cache (`cachePolicy.ts`) — sin cambios, TTL existente ya era suficiente.
- El resto de `AppShell.tsx` (sidebar, navegación, reset de datos demo) — sólo la línea del intervalo de la campana pasó a usar la constante compartida.
- `NoveltyFromContextModal`/flujo de "Crear novedad" desde una notificación — sin cambios.

## 18. Riesgos pendientes

- **Límite de paginación offset + inserciones en vivo** (§8) — documentado, preexistente a esta etapa, sin impacto en duplicados/visualización incorrecta (sólo un gap teórico y acotado, nunca observado en los escenarios de test). Resolverlo de raíz requeriría paginación cursor-based en el backend — fuera de alcance.
- **Refresco redundante al marcar como leída** (§10) — un `dispatchEvent` que la propia página ya sabía manejar localmente dispara además un fetch de red extra. Aceptado por simplicidad (reutiliza el mecanismo genérico en vez de suprimirlo condicionalmente) — costo de un request ocasional, no un problema de correctitud.
- **`document.visibilityState` (pestaña oculta) no se pausa** — evaluado y descartado a propósito (pedido explícito: "no obligatorio si añade complejidad"); el listener de `focus` ya cubre el caso más común (volver a la pestaña).

## 19. Próximas etapas

- **15M.19D** — regresión end-to-end fin de semana/recuperación, usando los escenarios A-I originales de 15M.18 como suite de aceptación.

---

No se commiteó, no se pusheó. Ningún archivo de `backend/` fue modificado.
