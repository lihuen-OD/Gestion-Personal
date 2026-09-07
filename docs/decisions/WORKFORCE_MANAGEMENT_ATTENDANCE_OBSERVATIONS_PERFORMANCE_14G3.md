# Etapa 14G.3 — Optimización de Asistencia / `GET /time-entries/attendance/observations`

Fecha: 2026-09-07
Estado: **completa. Backend optimizado (sin cambiar contrato/RBAC/reglas de negocio), un fix mínimo de "silent refresh" en frontend (mismo patrón ya usado en el resto del proyecto), sin tocar Prisma schema, sin migraciones, sin cambios de diseño visual.**
Alcance: exclusivamente el submódulo Asistencia (`/asistencia`, `AttendancePage.tsx`) y su endpoint `GET /time-entries/attendance/observations`.

---

## 1. Contexto

14G.2 (optimización de Inicio/home-summary) dejó como nuevo peor candidato a `GET /time-entries/attendance/observations`, con `home-summary` ya resuelto (Crítico → Medio) y fuera del top del ranking. 14G.3 optimiza puntualmente ese endpoint, sin tocar Fichador, Carga de horas, Alertas de turnos ni Cierres mensuales.

## 2. Evidencia de 14G.1/14G.2

De `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json` (corrida previa a esta etapa, ya reflejando el estado post-14G.2):

- Acción "Entrar a Asistencia (carga inicial del día)": `networkIdleMs` **5248ms** (Crítico).
- `GET /api/time-entries/attendance/observations` disparado 2 veces (duplicado por StrictMode, mismo patrón ya documentado y no corregido en 14G.2 para `home-summary`): **3108ms** y **4681ms**.
- Submódulo "B. Asistencia" era el nuevo #1 del ranking recomendado para 14G.3+ tras cerrar 14G.2.

## 3. Diagnóstico antes del cambio

`timeEntriesController.attendanceObservations` → `timeEntriesService.attendanceObservations(query, user)` → `timeEntriesRepository.attendanceObservations(...)`:

- **6 queries envueltas en `prisma.$transaction([...])`** (forma array, mismo antipatrón de 14C.2/14G.2): `workShift.findMany`, `attendancePunch.findMany`, `attendanceInactivityIncident.findMany` (cada una con includes reales: empleado + para shifts también `startPunch`, `endPunch`, `timeSegments`, `timeEntries`) + `workShift.count`, `attendancePunch.count`, `attendanceInactivityIncident.count`.
- **Todas independientes entre sí** — cada categoría (turnos/fichadas/incidentes de inactividad) es una fuente de datos separada, sin ninguna dependencia de resultado entre ellas ni necesidad de snapshot atómico (son "problemas de fichada" para mostrar en una lista, no un cálculo financiero).
- **Queries "dummy" cuando `type` filtra**: cuando el usuario elige un tipo específico (`SHIFT`/`PUNCH`/`INACTIVITY`), el código igual disparaba las 4 queries de las categorías excluidas con un `where: { id: "__none__" }` — un round-trip real a Neon que siempre devuelve vacío/0, sólo para mantener la forma del array de la transacción.
- **No hay over-fetch de campos que se pueda corregir sin romper el contrato**: `startPunch: true`/`endPunch: true` traen el objeto completo de `AttendancePunch` (más campos de los que `ObservationRows` en `AttendancePage.tsx` usa hoy), pero el frontend ya documenta explícitamente (`attendanceApiService.ts`, comentarios de `SegmentConceptStatus`/`AttendanceSegment`) que este endpoint "no recorta el select de Prisma" a propósito y que el tipo `AttendanceObservation` depende de ese shape completo. Recortarlo sería un cambio de shape del JSON — prohibido por la Parte 2 del pedido sin autorización explícita. **No se tocó.**
- **Filtros preservados y verificados** (fecha, tipo, búsqueda, `reviewStatus`, scope): el `where` de empleado (`employeeWhere`) y los `where` por categoría (`shiftWhere`/`punchWhere`/`inactivityWhere`) no cambiaron ni una línea — sólo se movió CÓMO se ejecutan las 6 queries, nunca QUÉ piden.
- **Sin cache backend ni frontend**: único endpoint de "listas" del módulo `time-entries` sin ningún `createTtlCache` (`list`/`summary`/`periodEmployees`/`attendanceSummary`/`home-summary` ya tenían); frontend usa `apiCache: false` explícito.
- **Duplicado por StrictMode confirmado** (§2) — mismo patrón ya visto y documentado (no corregido) en `home-summary` (14G.2) y en el aterrizaje inicial (14F.1/14F.2 parcialmente). No es un bug nuevo de Asistencia.
- **No comparte lógica de query con `attendanceSummary`**: son dos repositorios de datos distintos con propósitos distintos (`attendanceSummary` = jornadas abiertas/cerradas del día; `attendanceObservations` = problemas pendientes de revisión, sin acotar a un solo día por default) — ambos comparten el mismo *select* unificado de `timeSegments`/`timeEntries` (Etapa 8F, ya así antes de esta etapa) pero no ejecutan la misma query.
- **Loading incorrecto detectado en el frontend** (evidencia nueva, no reportada en 14G.1): el efecto de React que carga las observaciones en `AttendancePage.tsx` hacía `setObservationsLoading(true)` incondicionalmente en cada cambio de fecha/búsqueda/tipo/estado o al resolver una observación, blanqueando la tabla con el skeleton completo aunque ya hubiera datos visibles — inconsistente con el efecto de `summary` en el mismo archivo (¡a 30 líneas de distancia!), que sí tiene la guarda `if (!summary) setLoading(true)` desde la Etapa 9B.

## 4. Causa raíz

Misma causa raíz que 14G.2, en el mismo archivo: **`prisma.$transaction([...])` (forma array) para 6 lecturas independientes**, serializando cada round-trip sobre una única conexión. Agravado acá porque 3 de las 6 queries son `findMany` con includes reales (no simples counts), y porque el filtro por tipo disparaba 4 round-trips "dummy" adicionales sin necesidad.

Causa secundaria (frontend, hallazgo nuevo): falta de la guarda de "silent refresh" ya estándar en el resto del proyecto, en un efecto que además puede dispararse por acciones frecuentes (cambiar filtros, resolver una observación).

## 5. Cambios aplicados

### Backend — `backend/src/modules/time-entries/`

1. **`timeEntries.repository.ts`** — `attendanceObservations`: `prisma.$transaction([...])` → `Promise.all([...])` sobre el cliente `prisma` global. Las 3 queries de detalle (`findShifts`/`findPunches`/`findInactivity`) se extrajeron a funciones nombradas para preservar el tipo exacto de Prisma al saltearlas condicionalmente. Cuando `type` excluye una categoría, esa categoría ya NO dispara ningún round-trip: se usa `Promise.resolve([])`/`Promise.resolve(0)` localmente (mismo resultado que la query "dummy" de antes, sin ir a la base). Mismos `where`, mismos `include`, mismo orden de destructuring — cero cambio de semántica ni de shape de respuesta.
2. **`timeEntries.cache.ts`** — nuevo `attendanceObservationsCache = createTtlCache(15_000)` (mismo mecanismo `createTtlCache` ya usado por los otros 5 caches del módulo). Agregado a `clearTimeEntriesReadCaches()`.
3. **`timeEntries.controller.ts`** — `attendanceObservations` ahora usa `userScopedCacheKey(req)` + `attendanceObservationsCache.get/set`, mismo patrón que `list`/`summary`/`periodEmployees`/`attendanceSummary`/`home-summary`.

### Frontend — `frontend/src/pages/AttendancePage.tsx`

4. El efecto de observaciones ahora usa `if (!observations.length) setObservationsLoading(true);` (antes: incondicional) — mismo patrón exacto que el efecto de `summary` en el mismo archivo (Etapa 9B) y que ~15 pantallas más del proyecto. Un cambio de una línea + comentario; cero cambio de diseño, cero cambio de lógica de negocio.

No se tocó ningún otro archivo, ningún otro endpoint, ningún otro submódulo, Prisma schema, RBAC, ni el resto de `AttendancePage.tsx` (summary, acciones de escritura, modales).

## 6. Qué NO se cambió

- Método, ruta, query params (`date`, `search`, `type`, `reviewStatus`, `before`, `take`) — sin cambios.
- Shape del JSON de respuesta ni nombres de campos — `items`/`meta{total,pageSize,hasMore,nextBefore}` intactos; `startPunch`/`endPunch`/`timeSegments`/`timeEntries` del shift siguen viniendo completos, tal como los espera el frontend hoy.
- Criterios de "problemas de fichada" (estados `OBSERVADO`/`FALTA_SALIDA`/`FALTA_INGRESO`/`INVALIDO` para turnos, `OBSERVADA`/`RECHAZADA` sin turno asociado para fichadas, incidentes de inactividad `PENDIENTE`/`RESUELTA`/`DESCARTADA`) — mismos `where` exactos.
- Filtros por fecha (`argentinaDayRange`/`argentinaCalendarDate`, sin cambios), por tipo, por búsqueda (nombre/apellido/legajo/dni/sector, insensitive) — mismos `where` exactos.
- Scope del usuario (`employeeAccessWhere`), permisos (`requireAnyRole(operationalRoles)`), visibilidad por nivel — sin cambios.
- Poll silencioso de Asistencia (60s, sólo afecta a `summary`, nunca a `observations` — confirmado leyendo el código: son dos `useEffect` con dependencias distintas) — sin cambios.
- Loading/error/empty states de las secciones de jornadas abiertas/cerradas — sin cambios; sólo se ajustó la guarda de loading de "Problemas de fichada".
- **No se encontró ningún bug de datos incorrectos** en el endpoint — no aplicó la excepción de "corregir un bug mínimo imprescindible".
- El duplicado por StrictMode (§3) **no se corrigió** — mismo criterio que 14G.2: patrón de sólo-desarrollo, documentado como candidato para una etapa de frontend dedicada (ver §12).
- El over-fetch de `startPunch: true`/`endPunch: true` **no se tocó** — recortarlo cambiaría el shape del JSON, prohibido sin autorización explícita (ver §3).

## 7. Contrato de API preservado

Ruta, método, query params, estructura y campos del JSON de respuesta, status codes: **sin cambios**. Verificado con tests nuevos que fijan exactamente qué queries se disparan (o no) según `type`, y que la respuesta sigue trayendo `startPunch`/`endPunch`/`timeSegments`/`timeEntries` sin recortar.

## 8. RBAC/scope preservado

`requireAnyRole(operationalRoles)` sin cambios. `employeeAccessWhere(user)` se sigue calculando igual y se sigue pasando a las 3 categorías (antes serializado dentro de la transacción, ahora en `Promise.all`) — verificado con un test que confirma que Nivel 2 (supervisión) nunca recibe el scope vacío `{}` de RRHH.

## 9. Cache — detalle

- **TTL**: 15.000ms (15s) — dentro del rango 10-20s pedido; consistente con `timeEntriesListCache` (15s, misma categoría "lista operativa"). Más largo que `attendanceSummaryCache` (10s) a propósito: `summary` tiene un poll automático de 60s que se beneficia de datos algo más frescos, mientras que `observations` no tiene ningún poll — su único refresh automático es una acción real del usuario.
- **Mecanismo**: `createTtlCache`, el mismo helper compartido que ya usan las otras 5 caches del módulo — ninguna infraestructura nueva.
- **Key**: `userScopedCacheKey(req)` = `${userId}:${role}:${originalUrl}` — el querystring completo (fecha, tipo, búsqueda, reviewStatus, before, take) ya forma parte de `originalUrl`, así que cada combinación de filtros de cada usuario es una entrada de cache distinta. Verificado con test: cambiar cualquier filtro es un cache-miss nuevo; dos usuarios con los mismos filtros nunca comparten resultado.
- **Invalidación**: agregada a `clearTimeEntriesReadCaches()`, ya llamada por `resolveAttendanceObservation` (resolver un problema de fichada) y por todas las mutaciones de horas/novedades que ya invalidaban esta función compartida — cero call-sites nuevos. Verificado con un test que ejecuta el handler REAL de `resolveAttendanceObservation` y confirma que el próximo pedido de observations ya no sirve el resultado viejo.
- **Riesgos de la ventana de cache**: durante 15s, una observación resuelta por OTRO usuario (o desde otra pestaña) no se refleja hasta que expira el TTL o hasta que ese propio usuario dispara una invalidación real. Tolerancia aceptada, mismo criterio que `attendanceSummaryCache`/`homeSummaryCache`.

## 10. Tests

Backend, **24 tests nuevos**, todos en el módulo `time-entries` (233/233 pasando):
- `timeEntries.repository.test.ts` (+11): sin `$transaction`; `type=ALL` dispara las 6 queries; `type=SHIFT`/`PUNCH`/`INACTIVITY` NO disparan ninguna query de las categorías excluidas (antes sí, como "dummy"); el total sigue siendo la suma correcta; filtros de fecha/búsqueda/reviewStatus/scope preservados; el include de shift sigue trayendo `startPunch`/`endPunch` completos (contrato intacto).
- `timeEntries.service.test.ts` (+6): contrato de respuesta (`items`+`meta`), `nextBefore` null cuando `hasMore` es false, scope/RBAC preservado, traducción de `date`→rango argentino, propagación exacta de `type`/`search`/`reviewStatus`/`before`/`take`.
- `timeEntries.attendanceObservations.test.ts` (nuevo, +7, cache real sin mockear): hit/miss, key por filtros, key por usuario (sin compartir entre scopes), invalidación vía `clearTimeEntriesReadCaches()`, invalidación real end-to-end vía el handler de `resolveAttendanceObservation`.

Frontend, **2 tests nuevos** en `AttendancePage.test.tsx` (8/8 pasando en el archivo): loading grande sólo en la carga inicial real; cambiar el filtro "Mostrar" no blanquea la tabla mientras llega la respuesta nueva (misma fila anterior visible, sin skeleton).

Ningún test depende de tiempos exactos (se usan promesas controladas manualmente, no `setTimeout`/duraciones reales).

## 11. Métricas antes/después

| Métrica | Antes (14G.1/14G.2) | Después (14G.3) | Mejora |
|---|---|---|---|
| Acción "Entrar a Asistencia" — `visibleMs` | 77ms | 76ms | ~1% (ya era rápido) |
| Acción "Entrar a Asistencia" — `networkIdleMs` | **5248ms (Crítico)** | **2192ms (Lento)** | **~58%** |
| `GET /attendance/observations` (llamada más lenta de las 2 por StrictMode) | 4681ms | 844ms | **~82%** |
| `GET /attendance/observations` (llamada más rápida de las 2) | 3108ms | 844ms | ~73% |
| Ranking — submódulo "B. Asistencia" | Top candidato tras 14G.2 (5248ms, Crítico) | Fuera del top 3, `attendance/observations` ahora más rápido que `attendance` (summary) del mismo submódulo | Deja de ser prioridad |
| HTTP errors / console errors / escrituras ejecutadas | — | 0 / 0 / 0 | — |

Fuente: `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json`, corridas de `npm run perf:journey:workforce` antes y después de este cambio.

## 12. Riesgos pendientes

- Consistencia entre-queries no atómica (`Promise.all` en vez de `$transaction`) — mismo criterio ya aceptado en 14C.2/14G.2, irrelevante para una lista de "problemas de fichada" que se refresca sola.
- Ventana de cache de 15s (ver §9).
- Duplicado por StrictMode aún sin dedupe frontend — sólo afecta desarrollo, no producción; mismo candidato ya documentado en 14G.2 para `home-summary`.
- Over-fetch de `startPunch`/`endPunch` completo — no se tocó por ser un cambio de contrato; candidato para una etapa futura coordinada frontend+backend con autorización explícita.
- Journey de un solo usuario sin concurrencia — no reemplaza métricas de producción bajo carga real.

## 13. Recomendación para 14G.4

Con Inicio y Asistencia resueltos, el candidato más claro por **tiempo de acción compuesto** (no por endpoint individual — ningún request cruzó el umbral Crítico de 3000ms esta corrida) es **D. Carga de horas**, que sigue en rango Crítico por acción (3362ms de `networkIdleMs` en "Entrar a Carga de horas") — explícitamente fuera de alcance de 14G.1-14G.3 ("No tocar Carga de horas todavía"), ya diagnosticado en 14G.1 (`period-employees` optimizado en 14C.2 pero aún Crítico individualmente). Alternativas por ranking de endpoints Lento: **H. Notificaciones** (`GET /workforce/notifications`, sin cache backend) y **C. Alertas de turnos** (`GET /shifts/alerts`, medido Crítico por 14B.3 y nunca revisado, sin cache backend, mismo perfil de antipatrón a confirmar).
