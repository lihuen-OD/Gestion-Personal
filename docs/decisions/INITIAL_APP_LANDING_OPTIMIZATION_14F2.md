# Etapa 14F.2 — Optimización del aterrizaje inicial / login

Fecha: 2026-09-07
Estado: **implementado. Frontend-only. Sin commitear.**
Base: diagnóstico de [`INITIAL_APP_LANDING_PERFORMANCE_14F1.md`](./INITIAL_APP_LANDING_PERFORMANCE_14F1.md) (commit `f631ed7`).

---

## 1. Resumen

14F.1 encontró 3 causas concretas de por qué el aterrizaje disparaba 6 requests con 2 pares duplicados: (a) `notifications-unread-count` y `/audit?take=5` no tenían dedupe/cache frontend, así que StrictMode los pedía 2 veces cada uno; (b) `DashboardPage` acoplaba `metrics` y `audit` en el mismo `Promise.all`/estado, dejando que la lentitud de `/audit` retrasara las KPI cards. Esta etapa corrigió exactamente esas 3 causas, sin tocar backend, sin cambiar ningún contrato de API, y sin tocar la invalidación de cache por login (fuera de alcance, documentada como pendiente en §14). Resultado medido: 6 → 4 requests por corrida, 0 duplicados (antes 2 pares) en 6 corridas independientes.

---

## 2. Qué se cambió

### A) `DashboardPage.tsx` — desacoplar metrics de audit

- Un único `status` (`loading | success | error`) pasó a ser dos estados independientes: `metricsStatus` (`loading | success | error`) y `auditStatus` (`idle | loading | success | error`), cada uno con su propio `useEffect` y su propio contador de retry (`metricsRetry`, `auditRetry`).
- Las KPI cards y el resto del contenido del dashboard (dotación por sector, alertas, transporte, cumpleaños, control de carga horaria) dependen únicamente de `metricsStatus` — exactamente igual que antes, ya que ninguno de ellos leía `audit`.
- El widget "Actividad reciente" (único que lee `audit`, sólo visible para Nivel 1 - RRHH) ahora tiene su propio loading/error/empty a través del `status` que ya soporta `DataTable` (`loading | error | empty | ready`), con su propio botón de reintentar — antes no existía un retry específico para audit, sólo el retry combinado de metrics.
- Para roles que no ven auditoría (Nivel 2/3), el efecto de audit ni siquiera se ejecuta (`if (level !== 1) { setAuditStatus("idle"); return; }`) — mismo comportamiento de origen (`level === 1 ? getAudit(5) : Promise.resolve([])`), sólo que ahora expresado como un efecto separado en vez de una rama del `Promise.all`.

### B) `workforceApiService.unreadNotificationCount` — dedupe/cache frontend

- Se envolvió el `apiRequest` existente en `cachedData` con la policy nueva `notificationsUnreadCount` (ver §8).
- `readNotification(id)` ahora invalida la familia `"notifications"` después de que el POST resuelve, antes de que `NotificationsPage` dispare su evento `app:notifications-changed` — así el siguiente `unreadNotificationCount()` (el que dispara ese evento en `AppShell`) pide el número real en vez de servir el conteo cacheado desactualizado.
- `AppShell.tsx` **no se tocó** — sigue llamando `workforceApiService.unreadNotificationCount()` exactamente igual, con el mismo intervalo de 60s.

### C) `auditApiService.list`/`getAll` — dedupe/cache frontend

- Se envolvió el `apiRequest` existente en `cachedData` con la policy nueva `auditList` (ver §8), dentro de `auditApiService.list` (no en el componente, según lo pedido) — `getAll` y `dashboardMetricsApiService.getAudit(5)` se benefician automáticamente al llamar a `list` internamente.
- La `requestKey` incluye el query string completo (`page`, `take`, `entity`, `entityId`) para que `take=5` (Dashboard) y `take=25` (AuditPage, default) nunca compartan resultado.

### D) `dashboard/metrics` — sin cambios

No se tocó `dashboardMetricsApiService.getMetrics`, su policy (`dashboardMetrics`, family `"dashboard"`, 30s) ni el backend. Sigue siendo la única request "cara" del aterrizaje — fuera de alcance de esta etapa (14E.1/14E.2 ya la trabajaron).

### E/F) Backend e invalidación por login — sin cambios

Cero archivos backend tocados. `auditService.register()`, `dashboardMetricsCache` y `auditListCache` quedaron exactamente como estaban — ver §14 (pendiente documentado, no corregido).

---

## 3. Qué NO se tocó

Backend (ningún archivo bajo `backend/`), Prisma schema, migraciones, RBAC, contratos de API (mismos endpoints, mismos métodos, misma forma de respuesta), diseño visual general (mismas clases CSS, mismo layout — sólo se agregó un `onRetry` al `DataTable` de auditoría, reutilizando su UI de error ya existente), Legajos, Carga Horaria, Fichador, Turnos, Horas Especiales, Conceptos Horarios, Puestos, `auditService.register()`, `dashboardMetricsCache`, `auditListCache`, `AppShell.tsx` (revisado, no modificado — no hacía falta cambiar su código, sólo el servicio que ya llama), `docs/PERFORMANCE_STANDARDS.md` (ver §"Regla transversal" al final).

---

## 4. Antes / después — requests por corrida (login → `/`)

| | Antes (14F.1) | Después (14F.2) |
|---|---|---|
| Requests totales | 6 | **4** |
| `POST /auth/login` | 1 | 1 |
| `GET /workforce/notifications-unread-count` | **2** (duplicado) | **1** |
| `GET /audit?take=5` | **2** (duplicado) | **1** |
| `GET /dashboard/metrics` | 1 | 1 |

Confirmado en **6 corridas independientes** (2 ejecuciones completas de `npm run perf:journey:landing`, 3 sub-corridas cada una: fría / tibia / después de 16s) — las 6 muestran exactamente 4 requests y "sin duplicados". Confirmado también en `npm run perf:journey:employees` (la acción "Login" del recorrido de Legajos): 4 requests, sin duplicados (antes: 6, con los mismos 2 pares duplicados).

## 5. Antes / después — duplicados

| Endpoint | Antes | Después |
|---|---|---|
| `notifications-unread-count` | 2x por mount (StrictMode, sin dedupe) | 1x (dedupe in-flight vía `cachedData`) |
| `/audit?take=5` | 2x por mount (StrictMode, sin dedupe) | 1x (dedupe in-flight vía `cachedData`) |
| `dashboard/metrics` | 1x (ya deduplicado desde 14E.1/14E.2) | 1x (sin cambios) |

## 6. Antes / después — visible / network idle

| | Antes (14F.1, 6 sub-corridas) | Después (14F.2, 6 sub-corridas) |
|---|---|---|
| Login visible (`.app-shell`) | 867 – 1958ms | 862 – 1648ms |
| Login network idle | 2634 – 6402ms | 2634 – 5876ms |

Los rangos se solapan — esperable y explícitamente anticipado en el pedido ("no prometer que network idle baje siempre mucho, porque Neon y caches backend tienen ruido"). La ganancia real y consistente **no** es una reducción dramática de network idle (dominado por la latencia de `dashboard/metrics` contra Neon, sin tocar), sino: 2 requests menos por corrida, 0 duplicados (antes 2 pares en el 100% de las corridas), y el desacople de metrics/audit descrito en §7.

**Nota sobre el outlier del journey de Legajos**: en la corrida de validación de `perf:journey:employees` (Etapa 14D.1, ejecutada como parte de las validaciones obligatorias de esta etapa), `GET /api/dashboard/metrics` registró un outlier de **13667ms** y elevó el `networkIdleMs` de la acción "Login" a **15036ms**. No se considera una regresión de 14F.2: esta etapa no tocó `dashboard/metrics`, backend, batching, Prisma ni caches backend — 14F.2 fue **frontend-only**. Además, el journey específico `perf:journey:landing` (mismo aterrizaje, mismo endpoint) confirmó **4 requests y 0 duplicados en las 6 sub-corridas** medidas, con tiempos normales de `dashboard/metrics` en todas ellas (1251–4028ms, sin ningún otro outlier de esa magnitud). Este outlier puntual queda documentado como ruido/latencia de Neon (ya señalado como fuente de variabilidad en 14F.1) y como posible análisis backend futuro, no como un fallo de esta etapa.

## 7. Cómo quedaron separados metrics/audit — evidencia concreta

En la corrida "tibia" de la primera ejecución post-cambio, `dashboard/metrics` resolvió en 1277ms mientras `/audit` (el más lento de esa corrida) tardó 1900ms. **Antes** de esta etapa, con ambos en el mismo `Promise.all`, las KPI cards habrían esperado los 1900ms de audit (el máximo de los dos). **Después**, al estar desacoplados, las KPI cards quedan disponibles apenas resuelve `metrics` (1277ms) — una diferencia real de ~600ms en esa corrida específica, con el widget de auditoría mostrando su propio loading mientras tanto. Esto es evidencia directa (no teórica) de que desacoplar los estados efectivamente adelanta el contenido principal cuando audit es el más lento de los dos.

## 8. Cache policies nuevas

En `frontend/src/services/cache/cachePolicy.ts` (dos familias nuevas: `"audit"`, `"notifications"`):

| Policy | Family | TTL | Persist | Sensitive |
|---|---|---|---|---|
| `auditList` | `audit` | 15.000ms | `false` | `true` |
| `notificationsUnreadCount` | `notifications` | 20.000ms | `false` | `true` |

## 9. TTL elegido y por qué

- **`auditList` — 15s**: igual al TTL del cache backend (`auditListCache`) — no tiene sentido que el frontend cachee más tiempo que el propio backend, ya que en ese caso el frontend simplemente estaría sirviendo un dato que el backend de todos modos ya habría refrescado.
- **`notificationsUnreadCount` — 20s**: el propósito real de este cache no es "ahorrar" en el intervalo de 60s de `AppShell` (20s < 60s, así que cada tick del intervalo siempre va a ser un cache-miss real de todos modos, por diseño) — es sobrevivir el doble-montaje de StrictMode y remounts rápidos (ej. navegar y volver en segundos). 20s da margen de sobra para eso sin arriesgar mostrar un badge desactualizado por mucho tiempo, y la invalidación explícita en `readNotification` cubre el caso en que el propio usuario acaba de marcar algo como leído.

Ninguna de las dos se persiste (`persist: false`): ambas son datos de sesión de corta vida, no catálogos — no hay beneficio en sobrevivir un refresh de página, y sí hay más superficie de riesgo si un dato per-usuario quedara en IndexedDB más tiempo del necesario.

## 10. Seguridad / PII

- Ambas policies son `sensitive: true` (datos por-usuario: conteo de notificaciones propio, feed de auditoría con acciones de personas) — consistente con el resto de las policies per-usuario ya existentes (`employeesOptions`, `employeeDetailCore`, etc.).
- Ninguna se persiste en IndexedDB/localStorage (`persist: false`) — el feed de auditoría en particular nunca toca storage persistente, tal como pedía la etapa explícitamente.
- La cache key (`buildCacheKey`) ya incluye el scope de usuario/rol/empresa/sector (`currentCacheScope()`, hasheado) automáticamente para toda policy — no hizo falta ningún cambio adicional para que la cache esté naturalmente separada por sesión: dos usuarios distintos (o el mismo usuario tras un cambio de rol) nunca comparten una entrada de cache.
- La `requestKey` de `auditList` es el path + query string tal cual se le pasa a `apiRequest` (`/audit?page=1&take=5`) — nunca incluye headers, tokens ni el `Authorization` de la request real. Verificado con un test dedicado (`auditApiService.test.ts`, "no arma la cache key con datos sensibles").

## 11. RBAC / contratos

Sin cambios. Los 3 endpoints tocados (`/audit`, `/workforce/notifications-unread-count`, y por extensión `/workforce/notifications/:id/read`) mantienen exactamente el mismo método HTTP, mismo path, mismos parámetros y misma forma de respuesta que antes — el cache es una capa puramente del lado del cliente, invisible para el backend. Ninguna ruta backend fue tocada, así que ningún middleware de rol/permiso cambió.

## 12. Tests

- **`frontend/src/services/api/workforceApiService.test.ts`** (+6 tests): dedupe in-flight de `unreadNotificationCount` (2 llamadas concurrentes → 1 request real), cache dentro del TTL, invalidación por familia hace que vuelva a pedir, un error no queda cacheado permanentemente, `readNotification` invalida la familia `"notifications"`, `readNotification` mantiene su contrato de retorno. El mock de `../cache` se cambió de reemplazar `invalidateCacheFamily` por un no-op a **envolver la implementación real** (`vi.fn(actual.invalidateCacheFamily)`) — necesario para que los tests de invalidación-real funcionen, sin dejar de ser espiable para los tests ya existentes de `reviewCorrection` (que siguen pasando sin cambios en sus aserciones).
- **`frontend/src/services/api/auditApiService.test.ts`** (+6 tests): dedupe in-flight de `getAll({take:5})`, `take=5` vs `take=10` usan cache keys distintas, cache dentro del TTL, error no cacheado permanentemente, `list()` mantiene el shape `{items, meta}`, la cache key nunca lleva tokens/Authorization.
- **`frontend/src/pages/DashboardPage.test.tsx`** (nuevo archivo, 6 tests): KPIs visibles con audit todavía pendiente; KPIs visibles aunque audit falle (error localizado sólo en el widget); error localizado en KPIs si falla metrics (aunque audit haya resuelto); Nivel 2 (sin auditoría) nunca llama a `getAudit`; retry de metrics sigue funcionando; retry de audit funciona sin volver a pedir metrics.
- Se usó `mockReset()` en vez de `clearAllMocks()` para el mock de `apiRequest` en los describes nuevos — `clearAllMocks` no vacía la cola de `mockResolvedValueOnce`/`mockRejectedValueOnce`, y un valor "once" sin consumir (por ejemplo, porque la cache evitó una segunda llamada real) se filtraba al test siguiente. Se detectó exactamente este problema durante el desarrollo de esta etapa (4 tests fallaban en cadena) y se corrigió antes de darla por cerrada.
- `frontend/e2e/support/landingJourney.ts`/`.test.ts` **no se modificaron** — sus 11 tests siguen pasando sin cambios; sólo cambiaron los reportes que generan (`.md`/`.json`), regenerados por la corrida real, no editados a mano.
- Total suite frontend: **74 archivos, 636 tests, todos verdes** (antes de esta etapa: 73 archivos, 618 tests — 18 tests nuevos).

## 13. Riesgos

- `notificationsUnreadCount` con TTL de 20s podría, en un escenario límite (dos pestañas del mismo usuario, una marca como leída sin pasar por `NotificationsPage`... aunque hoy no existe otro flujo que marque como leída), mostrar un badge desactualizado hasta por 20s en vez de instantáneo — mismo tipo de trade-off ya aceptado en el resto del proyecto para datos de baja criticidad (un badge, no una acción bloqueante).
- `auditList` con TTL de 15s significa que una acción de otro módulo que genere una fila de auditoría nueva (ej. aprobar una corrección) no aparecerá en el widget "Actividad reciente" hasta que el TTL expire — esto ya era así a nivel backend (`auditListCache`, mismo TTL) desde antes de esta etapa; el frontend ahora simplemente iguala ese mismo lag, no lo empeora.
- El mock de `../cache` en `workforceApiService.test.ts` ahora delega a la implementación real de `invalidateCacheFamily` — si algún test futuro en ese archivo asume que `invalidateCacheFamily` es un no-op puro, podría sorprenderse con un efecto de cache real; documentado en el propio comentario del mock.

## 14. Pendientes

- **No se tocó** si `auditService.register()` debería invalidar `dashboardMetricsCache` en un login exitoso (candidato C, riesgo medio, documentado en 14F.1 §7) — sigue pendiente para una etapa de backend dedicada, con más cuidado.
- No se agregó preload del chunk de `DashboardPage` durante `LoginPage` (candidato E de 14F.1) — no estaba en el alcance explícito de esta etapa (A, B, C únicamente).
- No se revisó el payload de `/audit?take=5` para ver si trae más campos de los que el widget realmente usa (candidato G de 14F.1) — sigue como diagnóstico pendiente.

## 15. Rollback

Cada cambio es independiente y reversible por archivo sin efectos cruzados:
- Revertir `DashboardPage.tsx` a su versión anterior (un solo `status`/`Promise.all`) no afecta a B/C.
- Revertir `workforceApiService.ts` (quitar el `cachedData` de `unreadNotificationCount` y la invalidación en `readNotification`) no afecta a A/C — `AppShell.tsx` sigue llamando la misma función con la misma firma.
- Revertir `auditApiService.ts` (quitar el `cachedData` de `list`) no afecta a A/B.
- Las 2 policies nuevas en `cachePolicy.ts` pueden quedar sin uso sin romper nada si se revierte cualquiera de los tres puntos anteriores (no hay migración de datos ni de schema de cache involucrada — `schemaVersion` sigue en 1).
- No hay cambios de backend, migraciones ni contratos que revertir.

---

### Nota sobre `docs/PERFORMANCE_STANDARDS.md`

No se modificó. La regla candidata mencionada en el pedido ("todo fetch montado en AppShell/DashboardPage debe tener dedupe in-flight") describe bien lo que se hizo acá, pero generalizarla a *todo* el proyecto excede lo que esta etapa puede confirmar — hay decenas de otros call-sites con `apiRequest` directo (ver otros `{ apiCache: false }` en `workforceApiService.ts` mismo, ej. `closures`, `corrections`, `notifications`) que no fueron auditados en esta etapa y podrían o no necesitar el mismo tratamiento según su propio patrón de uso (algunos son acciones explícitas del usuario, no efectos de montaje — el riesgo de duplicado por StrictMode no aplica igual). Consistente con "no modificar standards salvo que aparezca una regla transversal comprobada", se deja sin tocar.
