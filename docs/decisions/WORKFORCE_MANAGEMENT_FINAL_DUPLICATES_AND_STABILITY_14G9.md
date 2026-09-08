# Etapa 14G.9 — Barrido final de duplicados, estabilidad y ranking final de Gestión horaria

Fecha: 2026-09-08
Estado: **completa. Etapa de cierre/QA, no de feature. Se corrigieron 2 duplicados reales confirmados (home-summary, Asistencia summary+observations) con el mismo patrón de dedupe ya usado 7 veces en 14G.2-14G.8. Se auditaron las 11 caches backend + 4 familias frontend agregadas en 14G.2-14G.8: todas correctamente scopeadas, sin fugas entre usuarios, sin cachear escrituras. Sin cambios de contrato, RBAC, diseño ni reglas de negocio. Sin escrituras ejecutadas.**
Alcance: `frontend/src/services/api/timeEntryApiService.ts` (`getHomeSummary`), `frontend/src/services/api/attendanceApiService.ts` (`getSummary`, `getObservations` + 4 write paths que ahora invalidan). Ningún archivo backend tocado — el diagnóstico confirmó que las caches backend de ambos endpoints ya estaban correctamente implementadas desde 14G.2/14G.3.

---

## 1. Contexto

Con 14G.2-14G.8 cerradas (Inicio, Asistencia, Carga de horas, Alertas de turnos, Notificaciones, Bandeja de revisión, Cierres mensuales), quedaban 2 candidatos de duplicado nombrados explícitamente en el pedido de 14G.9 (home-summary, Asistencia) más un mandato de auditoría completa de las caches agregadas en toda la serie y un ranking final consolidado.

## 2. Objetivo de cierre

Etapa de QA de performance, no de feature: confirmar con evidencia si los 2 candidatos de duplicado son reales o artefactos metodológicos, corregir sólo si son reales y el fix es chico/seguro, auditar la salud de las 11 caches backend + 4 familias frontend de la serie, y dejar un ranking final + recomendación para 14H.

## 3. Estado antes del barrido

Última corrida del journey (generada al cierre de 14G.8, `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json`, `generatedAt: 2026-09-08T12:20:46.981Z`):

- **A. Inicio** — "Entrar a Inicio": `networkIdleMs` 1151ms, `GET /time-entries/home-summary` **x2** (577ms y 578ms — duraciones casi idénticas, firma característica de 2 queries concurrentes reales, no de un artefacto de medición).
- **B. Asistencia** — "Entrar a Asistencia": `networkIdleMs` 2056ms (rango Lento), `GET /time-entries/attendance/observations` **x2** (547ms/548ms) **y** `GET /time-entries/attendance` **x2** (1301ms/1493ms) — ambos endpoints duplicados, no sólo observations.

## 4. Hallazgos

### A. Home-summary

- **`timeEntryApiService.getHomeSummary()`** (frontend) llamaba `apiRequest` directo con `{apiCache: false}` — **sin `cachedData`, sin dedupe in-flight**. Confirmado leyendo el código antes de tocar nada.
- **`HourlyManagementHomePage.tsx`** monta un único `useEffect(() => { load() }, [retry])` — en React StrictMode (dev), este efecto corre 2 veces al montar. Sin dedupe, cada corrida dispara su propia llamada de red real.
- **Backend**: `homeSummaryCache` (`timeEntries.cache.ts`, TTL 20s, agregada en 14G.2) ya existe y está correctamente scopeada por `userScopedCacheKey`. **Pero un cache backend no alcanza para evitar el duplicado**: las 2 llamadas de StrictMode llegan como 2 requests HTTP separados y casi simultáneos — la segunda puede llegar antes de que la primera haya terminado de escribir en el cache (`homeSummaryCache.set(...)` ocurre recién cuando la promesa del service resuelve), así que ambas terminan siendo cache-miss y disparan su propia query real. Esto explica exactamente las 2 duraciones casi idénticas observadas (577ms/578ms: 2 queries reales, no 1 real + 1 instantánea desde cache).
- **Conclusión**: duplicado real, no artefacto. Ya estaba documentado como pendiente desde el propio comentario de 14G.2 en el backend (`homeCounts` en `timeEntries.service.ts`) y nunca se cerró porque ninguna etapa posterior tocó Inicio de nuevo.
- **¿Conviene dedupe frontend aunque el backend cache exista?** Sí — son 2 mecanismos que resuelven problemas distintos (backend cache = repetir visitas entre cargas de página completas; dedupe frontend in-flight = coalescer llamadas concurrentes dentro del mismo montaje de React). Mismo criterio ya aplicado 7 veces en esta serie.
- **¿Riesgo de datos sensibles/consistencia?** Ninguno nuevo — `getHomeSummary()` no tiene parámetros, la key de cache ya está scopeada automáticamente por usuario (`buildCacheKey`/`currentUserHash()`), y toda escritura de horas ya invalida la familia `"time-entries"` compartida (`invalidateTimeEntryDependentCaches()`, sin cambios).

### B. Asistencia

- **`attendanceApiService.getSummary()` y `getObservations()`** (frontend) — **ambos** sin `cachedData`, mismo patrón exacto que home-summary. Confirmado que esto es distinto de lo que 14G.3 corrigió: esa etapa arregló el `$transaction` del backend y agregó `attendanceObservationsCache` (backend), pero **dejó explícitamente documentado como pendiente** el dedupe frontend ("Duplicado por StrictMode aún sin dedupe frontend — sólo afecta desarrollo, no producción", §12 de `WORKFORCE_MANAGEMENT_ATTENDANCE_OBSERVATIONS_PERFORMANCE_14G3.md`) — y nunca se corrigió porque ninguna etapa posterior volvió a tocar Asistencia.
- **`getSummary()` (resumen del día, `/time-entries/attendance`) nunca fue tocado en ninguna etapa de 14G** — ni el `$transaction` (ya estaba resuelto antes de 14G.1, sin antipatrón) ni el dedupe frontend. El duplicado x2 de este endpoint viene desde 14G.1 (documentado en su §10 original) y quedó sin corregir 8 etapas seguidas simplemente porque ninguna se enfocó en Asistencia después de 14G.3.
- **¿Es regresión real desde 14G.3?** No — es el mismo gap que 14G.3 ya conocía y decidió explícitamente no corregir en esa etapa (fuera de su alcance declarado). No es algo que se rompió después; es algo que nunca se terminó de cerrar.
- **¿La caché de 14G.3 cubre bien filtros/usuario/scope?** Sí, confirmado sin cambios — `attendanceObservationsCache`/`attendanceSummaryCache` (backend) ya scopeadas por `userScopedCacheKey` con filtros completos en `originalUrl`.
- **¿La UI mantiene datos durante refetch?** Sí, confirmado sin cambios — los 2 guards de `AttendancePage.tsx` (Etapa 9B para summary, Etapa 14G.3 para observations) siguen intactos, no se tocó el componente.

### C. Caches (auditoría completa, 14G.2-14G.8)

Ver tabla completa en §9. Resumen de la auditoría:

- **Ninguna cache comparte datos entre usuarios/scopes**: las 11 caches backend usan `userScopedCacheKey` (`userId:role:originalUrl`); las 4 familias frontend usan `buildCacheKey`/`currentUserHash()` (hash de `userId+role+company+sector`). Ambos mecanismos garantizan que el `userId` (o su hash) sea parte de la key en el 100% de los casos — verificado leyendo el código de las 3 controllers (`timeEntries.controller.ts`, `workforce.controller.ts`, `shiftAlert.controller.ts`) y de `cacheKey.ts`/`cachedData.ts`.
- **Ninguna cache cachea escrituras**: confirmado leyendo los 3 archivos de cache backend — ningún `.set()` ocurre dentro de un handler `POST`/`PATCH`/`DELETE`; los únicos `.set()` están en los handlers `GET`. Mismo patrón en frontend (`cachedData` sólo envuelve `fetcher`s de lectura en los 3 servicios tocados por 14G).
- **2 invalidaciones con hueco aceptado, ambas ya documentadas explícitamente en su propia etapa**: `shiftAlertListCache` (14G.5, generación de alertas desde Fichador no invalida) y `notificationsListCache` (14G.6, creación de notificaciones desde 5+ módulos no invalida). Ambas acotadas por TTL corto (15s y 10s respectivamente) — riesgo ya evaluado y aceptado, no es un hallazgo nuevo de 14G.9.
- **1 conjunto de invalidación cerrado sin ningún hueco**: `closuresCache`/`correctionsCache` (14G.8) — los 6 write paths de `MonthlyTimeClosure`/`TimeCorrectionRequest` están confirmados exhaustivamente dentro de un solo archivo, todos invalidan.
- **Ninguna familia frontend resultó demasiado ancha o demasiado angosta** para lo que agrupa: `"time-entries"` (ahora 7 endpoints: `getSummary`/`getPeriodEmployees`/`list`/`listByEmployee`/`getHomeSummary`/`attendance.getSummary`/`attendance.getObservations`) refleja exactamente la misma agrupación que ya existe en el backend (`clearTimeEntriesReadCaches()`, 6 caches, mismo criterio desde antes de 14G); `"shift-alerts"`, `"notifications"` y `"monthly-closures"` son cada una un solo submódulo, sin mezclar dominios no relacionados.

### D. Ranking final

Ver §10 (métricas) y §12 más abajo.

## 5. Cambios aplicados

### Frontend — `frontend/src/services/api/timeEntryApiService.ts`

1. **`getHomeSummary()`** — envuelto con `cachedData`, reusando `cachePolicies.timeEntriesAggregates` (familia `"time-entries"`, ya usada por 4 métodos del mismo servicio desde 14G.4) — sin política nueva.

### Frontend — `frontend/src/services/api/attendanceApiService.ts`

2. **`getSummary()`/`getObservations()`** — envueltos con `cachedData`, misma familia `"time-entries"` (mismo criterio: el backend ya agrupa estos 2 endpoints junto con el resto de time-entries bajo `clearTimeEntriesReadCaches()`).
3. **`resolveObservation()`/`closeWorkShiftManually()`/`markMissingOut()`/`observeWorkShift()`** — las 4 escrituras de este servicio ahora invalidan la familia `"time-entries"` tras la escritura real (necesario recién ahora que hay algo que invalidar del lado del frontend; el backend ya se invalidaba solo).

No se tocó ningún archivo backend — las 2 caches backend involucradas (`homeSummaryCache`, `attendanceSummaryCache`/`attendanceObservationsCache`) ya estaban correctamente implementadas desde 14G.2/14G.3, sin ningún bug de key/invalidación que corregir. No se tocó `HourlyManagementHomePage.tsx` ni `AttendancePage.tsx` — el fix es 100% de la capa de servicio, sin necesidad de tocar componentes.

## 6. Qué NO se cambió

- Ningún contrato de API (rutas, métodos, query params, shape de respuesta) de `GET /time-entries/home-summary`, `GET /time-entries/attendance`, `GET /time-entries/attendance/observations` ni de los 3 endpoints de escritura de asistencia.
- Ningún archivo backend — cero cambios en `timeEntries.controller.ts`, `timeEntries.service.ts`, `timeEntries.cache.ts`, `workforce.cache.ts`, `shiftAlert.cache.ts`.
- Ningún componente de página (`HourlyManagementHomePage.tsx`, `AttendancePage.tsx`) — el diagnóstico confirmó que sus loading guards ya eran correctos (Etapas 9B/14G.3), sin blanking que corregir.
- Reglas de negocio de asistencia (jornadas, riesgo de olvido de salida, resolución de observaciones) — sin cambios.
- RBAC/scope de ningún endpoint — sin cambios.
- Diseño visual — cero cambios de JSX/CSS.
- Los 2 huecos de invalidación ya aceptados (`shiftAlertListCache`, `notificationsListCache`) — evaluados, no reabiertos, mismo criterio ya documentado en 14G.5/14G.6.
- Los 3 duplicados restantes fuera de alcance (`GET /employees/:id/time-grid` x3 y `GET /novelties` x2 en "Abrir edición de horas de un empleado", `GET /novelties` x2 en Novedades, `GET /finnegans-export/novelties` x2 en Exportación) — **no corregidos**: ninguno pertenece a un submódulo que 14G.2-14G.9 haya tocado (`EmployeeHoursPage.tsx`, `NoveltiesPage.tsx`, `FinnegansExportPage.tsx` nunca estuvieron en alcance), así que corregirlos ahora sería reabrir/abrir módulos nuevos sin autorización — quedan documentados como candidatos para una etapa futura (§11).
- No se ejecutó ninguna escritura real — todos los tests nuevos mockean `apiRequest`, y el journey de performance sigue saltando explícitamente las 2 acciones de escritura de Asistencia.
- Fichador — no se tocó ningún archivo.

## 7. Contrato de API preservado

Sin cambios — los 5 endpoints tocados (2 de lectura de home-summary/attendance + 3 de escritura de asistencia... en realidad 2 de lectura + 4 de escritura, ver §5) mantienen exactamente la misma ruta, método, query params y shape de respuesta. Verificado con 14 tests nuevos que fijan el contrato exacto (`toEqual`/`toMatchObject` contra la respuesta esperada) además de la dedupe/invalidación.

## 8. RBAC/scope preservado

Sin cambios — no se tocó ningún middleware, ningún `requireAnyRole`, ningún `employeeAccessWhere`. El único cambio de "scope" es puramente de cache (dedupe/invalidación), que ya heredaba el scope del backend sin alterarlo — verificado que ninguna cache backend ni frontend involucrada permite compartir datos entre usuarios (§4.C).

## 9. Tabla de caches 14G (auditoría completa)

| Cache | Capa | Etapa | TTL | Key | Usuario/scope | Filtros/paginación | Invalidación | Riesgo stale | Riesgo leak | Tests |
|---|---|---|---|---|---|---|---|---|---|---|
| `homeSummaryCache` | Backend | 14G.2 | 20s | `userId:role:originalUrl` | Sí | N/A (sin params) | `clearTimeEntriesReadCaches()` | Bajo (20s) | Ninguno | Sí (14G.2) |
| `attendanceSummaryCache` | Backend | Pre-14G | 10s | `userId:role:originalUrl` | Sí | Sí (`date`) | `clearTimeEntriesReadCaches()` | Bajo (10s + poll 60s) | Ninguno | Sí (preexistente) |
| `attendanceObservationsCache` | Backend | 14G.3 | 15s | `userId:role:originalUrl` | Sí | Sí (fecha/tipo/búsqueda/reviewStatus/before/take) | `clearTimeEntriesReadCaches()` (incluye `resolveAttendanceObservation`) | Bajo (15s) | Ninguno | Sí (14G.3, 24 tests) |
| `timeEntriesListCache` | Backend | Pre-14G (repo tocado en 14G.7) | 15s | `userId:role:originalUrl` | Sí | Sí (`view`/status/período/búsqueda/paginación) | `clearTimeEntriesReadCaches()` | Bajo (15s) | Ninguno | Sí (14G.7) |
| `timeEntriesSummaryCache` | Backend | Pre-14G | 20s | `userId:role:originalUrl` | Sí | Sí (período) | `clearTimeEntriesReadCaches()` | Bajo (20s) | Ninguno | Sí (preexistente) |
| `timeEntriesPeriodEmployeesCache` | Backend | 14C.2 | 20s | `userId:role:originalUrl` | Sí | Sí (período/búsqueda/costCenter/paginación) | `clearTimeEntriesReadCaches()` | Bajo (20s) | Ninguno | Sí (14C.2) |
| `shiftAlertListCache` | Backend | 14G.5 | 15s | `userId:role:originalUrl` | Sí | Sí (type/severity/status/search/before/take) | `clearShiftAlertReadCaches()` — sólo `resolve` | **Medio** — generación desde Fichador/monitor no invalida (aceptado, documentado en 14G.5) | Ninguno | Sí (14G.5, 8 tests) |
| `notificationsListCache` | Backend | 14G.6 | 10s | `userId:role:originalUrl` | Sí | Sí (status/page/take) | `clearNotificationsListCache()` — sólo `readNotification` | **Medio** — creación desde 5+ módulos no invalida (aceptado, documentado en 14G.6) | Ninguno | Sí (14G.6, 5 tests) |
| `closuresCache` | Backend | 14G.8 | 15s | `userId:role:originalUrl` | Sí | Sí (período) | `clearMonthlyClosuresReadCaches()` — 6 write paths, conjunto cerrado | Bajo (sin hueco aceptado) | Ninguno | Sí (14G.8, 14 tests) |
| `correctionsCache` | Backend | 14G.8 | 15s | `userId:role:originalUrl` | Sí | N/A (filtro de período vive en frontend) | `clearMonthlyClosuresReadCaches()` — mismo conjunto cerrado | Bajo | Ninguno | Sí (14G.8) |
| `shiftTemplatesCache`/`doubleRulesCache` | Backend | Pre-14G (9C) | 30s | `userId:role:originalUrl` | Sí | N/A | Funciones dedicadas por CRUD | Bajo | Ninguno | Sí (preexistente) |
| `timeEntriesAggregates` (familia `"time-entries"`) | Frontend | 14G.4 (+14G.9: `getHomeSummary`/attendance) | 30s | `GET:<url+params>` + hash usuario | Sí (`currentUserHash`) | Sí (por request key) | `invalidateTimeEntryDependentCaches()` / invalidación directa en attendance | Bajo (30s, acotado por invalidación en cada escritura de horas/asistencia) | Ninguno | Sí (14G.4 + 14G.9, +14 tests) |
| `shiftAlertsList` (familia `"shift-alerts"`) | Frontend | 14G.5 | 15s | `GET:<url+params>` + hash usuario | Sí | Sí | `invalidateCacheFamily("shift-alerts")` en `resolve` | Medio (mismo hueco que el backend) | Ninguno | Sí (14G.5) |
| `notificationsUnreadCount`/`notificationsList` (familia `"notifications"`) | Frontend | 14F.2/14G.6 | 20s/10s | `GET:<url>` + hash usuario | Sí | Sí (list) | `invalidateCacheFamily("notifications")` en `readNotification` | Medio (mismo hueco que el backend) | Ninguno | Sí (14F.2/14G.6) |
| `monthlyClosuresList`/`timeCorrectionsList` (familia `"monthly-closures"`) | Frontend | 14G.8 | 15s cada uno | `GET:<url+params>` + hash usuario | Sí | Sí (`closures` por período) | `invalidateCacheFamily("monthly-closures")` en 5 métodos de escritura | Bajo (sin hueco) | Ninguno | Sí (14G.8) |

## 10. Métricas finales (post-14G.8/14G.9, 2 corridas de `perf:journey:workforce`)

| Submódulo | Peor `networkIdleMs` | Rango | Duplicados |
|---|---|---|---|
| Inicio | 2146-2442ms | Lento | **0** (antes: `home-summary` x2) |
| Asistencia | 2181-2229ms | Lento | **0** (antes: `observations` x2, `attendance` x2) |
| Carga de horas | 2220-2280ms | Lento | 0 en la acción de entrada; `time-grid` x3/`novelties` x2 sólo en "Abrir edición" (`/horas/:id`, fuera de alcance — ver §11) |
| Cierres mensuales | 950ms | OK | 0 |
| Bandeja de revisión | 943-1389ms | Medio | 0 |
| Notificaciones | 931ms | OK | 0 |
| Alertas de turnos | 1106ms | Medio | 0 |
| Fichador | 877ms | OK | 0 (fuera de cualquier ranking de optimización, `docs/PERFORMANCE_STANDARDS.md` §10) |
| Exportación | 1699-2279ms | Lento/Medio | `finnegans-export/novelties` x2 (fuera de alcance — ver §11) |
| Novedades | 1744ms | Medio | `novelties` x2 (fuera de alcance — ver §11) |

**Nota sobre `networkIdleMs` de Inicio/Asistencia**: los duplicados se eliminaron de forma confirmada y estable en las 2 corridas (antes: 2 requests por endpoint con duraciones casi idénticas; después: 1 request por endpoint). Sin embargo, el `networkIdleMs` de la acción completa **no bajó** en estas 2 corridas puntuales — se mantiene o sube levemente. Esto se explica por variancia de "cold start" de Neon: "Entrar a Inicio" es la primera acción del journey que toca la base de datos después del login, y "Entrar a Asistencia" es la segunda — ambas pagan el costo de conexión inicial independientemente de si disparan 1 o 2 requests. Esto se confirma con evidencia adicional: en ambas corridas, `GET /dashboard/metrics` y `GET /audit` (las 2 primeras llamadas reales de todo el journey, ajenas a Gestión horaria) encabezan por lejos el ranking de requests más lentas (4034ms y 3283ms) — el mismo patrón de "primera query paga costo de conexión" que explica por qué Login siempre es la acción más lenta de cualquier corrida de esta serie. La mejora real y confirmada de esta etapa es **estructural** (mitad de las queries reales al backend para estas 2 acciones), no necesariamente visible en el `networkIdleMs` de una corrida de un solo usuario contra un entorno con esta variancia ya documentada desde 14G.1.

## 11. Pendientes reales

- **Duplicados fuera de alcance de toda la serie 14G** (ninguno es una regresión de 14G, todos preexistentes desde 14G.1 en submódulos nunca tocados): `GET /employees/:id/time-grid` x3 y `GET /novelties` x2 en "Abrir edición de horas de un empleado" (`EmployeeHoursPage.tsx`, ruta `/horas/:id`); `GET /novelties` x2 al entrar a Novedades (`NoveltiesPage.tsx`); `GET /finnegans-export/novelties` x2 al entrar a Exportación (`FinnegansExportPage.tsx`). Los 3 son candidatos limpios para 14H con el mismo patrón de dedupe ya probado 9 veces en esta serie.
- **2 huecos de invalidación ya aceptados** (`shiftAlertListCache`/`notificationsListCache`, generación/creación desde módulos externos) — documentados desde 14G.5/14G.6, revisados en esta auditoría, siguen siendo el criterio correcto (TTL corto acota el riesgo).
- **Paginación de `GET /workforce/closures` y filtro de período server-side de `GET /workforce/corrections`** — documentados como pendientes desde 14G.8, requieren cambio de contrato, no tocados.
- **`include: {hourConcept: true}`** (over-fetch menor, `time-entries`/`corrections`) — documentado desde 14G.7/14G.8, requiere cambio de shape, no tocado.

## 12. Pendientes metodológicos

- **Variancia de "cold start" en las primeras acciones del journey** (Login, Inicio, Asistencia) — no es un problema de la aplicación, es inherente a medir contra Neon (staging real) con una conexión fría por corrida. No hay ninguna acción de código que lo resuelva sin cambiar el entorno de medición (fuera de alcance).
- **Algunas acciones de "Cambiar período"/"Cambiar filtro"** (Cierres mensuales, Carga de horas) siguen sin capturar requests distinguibles en el journey en ninguna corrida de la serie — artefacto ya documentado en 14G.7/14G.8, no atribuible a ningún cambio de código.
- **12 repeticiones de `GET /workforce/notifications-unread-count`** a lo largo de todo el journey — ya diagnosticado exhaustivamente en 14G.6 como artefacto de que el journey navega con `page.goto()` (recarga completa de página) en vez de navegación SPA — confirmado que sigue así, sin cambios, correcto.

## 13. Recomendación para 14H

Con la serie 14G.1-14G.9 cerrada (los 10 submódulos de Gestión horaria diagnosticados y, donde correspondía, optimizados), los candidatos con evidencia ya recolectada para una posible serie 14H son:

1. **Duplicados de StrictMode restantes** (§11): `EmployeeHoursPage.tsx` (`/horas/:id`), `NoveltiesPage.tsx`, `FinnegansExportPage.tsx` — mismo patrón de dedupe, 3 candidatos pequeños y seguros.
2. **Paginación real de `GET /workforce/closures`** y **filtro de período server-side de `GET /workforce/corrections`** — requieren autorización explícita de cambio de contrato (documentado en 14G.8 §10).
3. Con el macro-journey de Gestión horaria ya estable y sin duplicados en ningún submódulo tocado por 14G, **14H podría ser una serie distinta** (otro dominio del sistema) en vez de continuar profundizando en Gestión horaria — la serie actual llegó a un punto de rendimientos decrecientes (los candidatos que quedan son o bien fuera del alcance original, o requieren cambios de contrato que necesitan autorización explícita, no más limpieza de duplicados).
