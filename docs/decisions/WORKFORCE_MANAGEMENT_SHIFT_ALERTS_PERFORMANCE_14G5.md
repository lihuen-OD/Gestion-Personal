# Etapa 14G.5 — Optimización de Alertas de turnos / `GET /shifts/alerts`

Fecha: 2026-09-07
Estado: **completa. Backend optimizado (sin cambiar contrato/RBAC/reglas de negocio), cache backend nueva, dedupe + fix de blanking en frontend. Sin tocar Prisma schema, sin migraciones, sin cambios de diseño visual, sin tocar Fichador.**
Alcance: exclusivamente el submódulo Alertas de turnos (`/asistencia/alertas`, `ShiftAlertsPage.tsx`) y su endpoint `GET /shifts/alerts` (módulo backend `shifts`, archivos `shiftAlert.*`).

---

## 1. Contexto

14G.1-14G.4 resolvieron Inicio (`home-summary`), Asistencia (`attendance/observations`) y la entrada compuesta a Carga de horas (`/horas`). El candidato recomendado en `docs/decisions/WORKFORCE_MANAGEMENT_ATTENDANCE_OBSERVATIONS_PERFORMANCE_14G3.md` §13 para la siguiente etapa era **C. Alertas de turnos** (`GET /shifts/alerts`), señalado como Crítico desde 14B.3 y "nunca revisado desde entonces" — esta etapa hace exactamente esa revisión.

## 2. Evidencia histórica (14B.3) y evidencia 14G.1-14G.4

- **14B.3**: `GET /shifts/alerts` medido en **3906ms (Crítico)** — nunca corregido desde entonces (confirmado leyendo `shiftAlert.repository.ts`: cero cambios de performance desde 13H/13H.1, que sólo tocaron la agrupación visual del frontend).
- **14G.1** (`docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json`, corrida previa a esta etapa): "Entrar a Alertas de turnos" — `networkIdleMs` **2509ms** (Lento), con `GET /shifts/alerts` disparado **x2 dentro de la misma acción** (1253ms y 1958ms — duplicado por StrictMode, documentado en §10 de ese reporte y nunca corregido). "Limpiar búsqueda de alertas" mostraba `visibleMs` **1822ms** (anómalo frente al resto de acciones de "limpiar filtro" del proyecto, que rondan 20-50ms) — primera señal del bug de blanking diagnosticado en esta etapa (§3).
- **14G.4** (corridas de cierre de esa etapa): `GET /shifts/alerts` siguió apareciendo en rango Lento/Crítico en corridas sueltas (hasta 3044ms), confirmando que el submódulo seguía sin optimizar y que la variancia del entorno no explicaba por sí sola el problema.
- **13H/13H.1** (`docs/decisions/SHIFT_ALERTS_GROUPED_VIEW_13H.md`, leído en esta etapa): la agrupación por `workShiftId` se implementó **100% en frontend** (`groupAlerts()` en `ShiftAlertsPage.tsx`, vía `useMemo`) — el backend nunca agrupó ni agregó ningún dato extra para esa vista. Confirmado que esto sigue siendo así y que no hay ningún over-fetch atribuible a la agrupación.

## 3. Diagnóstico antes del cambio

**Backend** (`backend/src/modules/shifts/shiftAlert.repository.ts`, `shiftAlert.service.ts`, `shiftAlert.controller.ts`, `shiftAlert.schemas.ts`):

- **Causa encontrada**: `shiftAlertRepository.findMany` envolvía sus 2 queries (`findMany` + `count`, ambas de sólo lectura e independientes) en `prisma.$transaction([...])` (forma array) — el mismo antipatrón ya corregido en `time-entries` por 14C.2/14G.2/14G.3. Una transacción interactiva usa una única conexión, así que las 2 queries se ejecutaban en serie sobre esa conexión en vez de en paralelo sobre el pool de conexiones del cliente `prisma` global.
- **Selects**: `employeeSelect` (`id, legajo, dni, firstName, lastName, status`) y `workShiftSelect` (`id, startAt, endAt, status, shiftTemplate{id,code,name}`) ya estaban recortados a exactamente lo que `ShiftAlertsPage.tsx` renderiza (legajo/nombre del empleado, código/nombre del turno) — **no hay over-fetch de relaciones completas**. No se encontró ningún `include` sin `select` anidado.
- **Filtros** (`type`, `severity`, `status`, `employeeId`, `workShiftId`, `search`, `before`): los 7 se aplican en el `where` de Prisma (`buildWhere`), **en DB, no en memoria** — confirmado leyendo `buildWhere` línea por línea, sin ningún `.filter()` de JS sobre el resultado.
- **Paginación**: `take: query.take + 1` (patrón cursor estándar para detectar `hasMore` sin un `count` adicional) se aplica **antes** de traer los registros, no después — no hay procesamiento de "muchos registros antes de paginar". `take` máximo 50 (`shiftAlertTypeSchema`), default 20 — acotado.
- **Counts**: un solo `count` adicional (el total), igual que `time-entries`/`period-employees`/`summary` — no hay counts redundantes.
- **Agrupación**: confirmado 100% frontend (§2) — el backend nunca agrupa por `workShiftId` ni trae datos adicionales para esa vista. No se tocó (no está permitido moverla sin cambiar contrato).
- **Cache backend**: **no existía ninguna** para este endpoint (a diferencia de `time-entries`, que ya tiene 6 caches en `timeEntries.cache.ts`) — confirmado con `grep` en todo el módulo `shifts`.
- **Scope/RBAC**: `requireAnyRole([rrhh, supervision, cargaHoraria])` en la ruta (`shifts.routes.ts`) se evalúa **antes** de tocar la base (middleware Express, corre antes del controller). El scope de datos (`employeeAccessWhere(user)`) se aplica dentro del `where` de ambas queries (`findMany` y `count`), **antes** de traer cualquier registro — nunca se trae de más y se filtra después.
- **Índices**: no se creó ninguna migración ni se tocó el schema (fuera de alcance sin autorización explícita) — el `orderBy: [{ createdAt: "desc" }, { id: "desc" }]` combinado con los filtros del `where` es candidato razonable a un índice compuesto, pero **queda documentado como riesgo/candidato futuro (§13), no aplicado**.

**Frontend** (`frontend/src/pages/ShiftAlertsPage.tsx`, `frontend/src/services/api/shiftAlertApiService.ts`):

- **Duplicados por StrictMode**: `shiftAlertApiService.getAll` era un `apiRequest` directo, **sin pasar por `cachedData`** (a diferencia de `getSummary`/`getPeriodEmployees`/`getCatalog`/`list`/`listByEmployee`, ya migrados en 14D.5/14F.2/14G.4) — sin dedupe in-flight, el doble-montaje de React StrictMode disparaba 2 llamadas de red reales por acción (confirmado en 14G.1 §10 y reproducido en la corrida de diagnóstico de esta etapa).
- **Blanking de tabla (hallazgo nuevo, no reportado en 14G.1)**: el efecto de carga hacía `setLoadStatus("loading")` **incondicional** en cada cambio de búsqueda/tipo/severidad/estado, reemplazando la tabla completa por el skeleton (`LoadingState variant="table"`) aunque ya hubiera alertas visibles — inconsistente con el patrón ya estándar en el resto del proyecto (`HoursPage.tsx`/`AttendancePage.tsx`: `if (!X.length) setLoading(true)`). Esto explica el `visibleMs` anómalamente alto (1822ms) de "Limpiar búsqueda de alertas" en 14G.1: la acción esperaba a que el skeleton completo desapareciera, y la respuesta (duplicada, sin cache) tardaba ~2s.
- **Filtro inicial**: no dispara doble fetch — el único efecto de carga depende de `[debouncedSearch, type, severity, status, refresh]`, sin ningún gate artificial (a diferencia del hallazgo de 14G.4 en `HoursPage.tsx`) — no había ninguna dependencia artificial que remover acá.
- **Loading/error/empty**: preservados sin cambios de semántica — sólo se corrigió CUÁNDO se dispara el loading grande (§5), no el resto de los 3 estados.

## 4. Causa raíz

**Backend**: `prisma.$transaction([...])` (forma array) para 2 lecturas independientes en `shiftAlertRepository.findMany` — mismo antipatrón ya corregido en 3 endpoints de `time-entries` (14C.2/14G.2/14G.3), nunca aplicado a `shifts` porque este módulo no había tenido ninguna etapa de performance dedicada desde 13H.

**Frontend**: `shiftAlertApiService.getAll` sin dedupe in-flight (nunca migrado a `cachedData`) + `ShiftAlertsPage.tsx` blanqueando la tabla completa en cada cambio de filtro (gap de UX preexistente, no relacionado a 13H).

Ninguna de las 2 causas es de over-fetch, de filtros en memoria, ni de agrupación — el diagnóstico (§3) descarta esas hipótesis con evidencia.

## 5. Cambios aplicados

### Backend — `backend/src/modules/shifts/`

1. **`shiftAlert.repository.ts`** — `findMany`: `prisma.$transaction([...])` → `Promise.all([...])` sobre el cliente `prisma` global. Mismos `where`/`include`/`orderBy`/`take` exactos — cero cambio de shape ni de semántica.
2. **`shiftAlert.cache.ts`** (nuevo) — `shiftAlertListCache = createTtlCache(15_000)` (mismo helper compartido `createTtlCache` ya usado por las 6 caches de `time-entries`) + `clearShiftAlertReadCaches()`.
3. **`shiftAlert.controller.ts`** — `list` ahora usa `userScopedCacheKey(req)` (mismo patrón exacto ya usado en `timeEntries.controller.ts`/`novelties.controller.ts`/`employees.controller.ts` — cada módulo mantiene su propia copia local del helper, no compartida) + `shiftAlertListCache.get/set`. `resolve` ahora llama `clearShiftAlertReadCaches()` tras la escritura real.

### Frontend — `frontend/src/services/api/shiftAlertApiService.ts` y `frontend/src/services/cache/cachePolicy.ts`

4. **`cachePolicy.ts`** — nueva familia `"shift-alerts"` y política `shiftAlertsList` (TTL 15s, no persiste, sensible) — misma infraestructura `cachedData`/`cachePolicies` ya existente, ninguna mecánica de cache nueva.
5. **`shiftAlertApiService.getAll`** — envuelto con `cachedData` (dedupe in-flight vía `pendingRevalidations`, mismo mecanismo que `getSummary`/`getPeriodEmployees`/`list`/`listByEmployee`). `resolve` ahora invalida la familia `"shift-alerts"` tras la escritura real.

### Frontend — `frontend/src/pages/ShiftAlertsPage.tsx`

6. El efecto de carga ahora usa `if (!alerts.length) setLoadStatus("loading");` (antes: incondicional) — mismo patrón ya usado en `HoursPage.tsx`/`AttendancePage.tsx`. Un cambio de una línea + comentario; cero cambio de diseño, cero cambio de lógica de negocio ni de agrupación.

No se tocó ningún otro archivo, ningún otro submódulo, Prisma schema, RBAC, ni el resto de `ShiftAlertsPage.tsx` (modal de resolución, agrupación, acciones de "Ver legajo"/"Ver turno").

## 6. Qué NO se cambió

- Método, ruta, query params (`type`, `severity`, `status`, `employeeId`, `workShiftId`, `search`, `before`, `take`) — sin cambios.
- Shape del JSON de respuesta (`data`/`meta{total,pageSize,hasMore,nextBefore}`, campos de `ShiftAlert`/`employee`/`workShift`) — intacto.
- Agrupación por `workShiftId` (100% frontend, `groupAlerts()`) — no se movió al backend ni se cambió su semántica (prioridad de alerta principal, estado de grupo, hallazgos secundarios).
- Filtros por tipo/severidad/estado/búsqueda, paginación (`take`/`before`/`nextBefore`), ordenamiento (`createdAt desc, id desc`) — mismos `where`/`orderBy` exactos.
- Scope del usuario (`employeeAccessWhere`), permisos (`requireAnyRole`), visibilidad por nivel — sin cambios.
- Reglas de generación/resolución de alertas (`workShiftEvaluationRunner.ts`, `openShiftMonitor.service.ts`, `resolveAttendanceObservation`) — **no se tocó ningún archivo de generación de alertas** (ver riesgo aceptado en §9).
- Comportamiento del botón "Resolver" (modal, validación de motivo obligatorio, estados PENDIENTE/RESUELTA/DESCARTADA) — sin cambios.
- **No se encontró ningún bug de datos incorrectos** en el endpoint — no aplicó la excepción de "corregir un bug mínimo imprescindible".
- El duplicado por StrictMode **si se corrigió** (a diferencia de 14G.2/14G.3, que lo dejaron documentado sin corregir) — acá se tomó la opción explícitamente habilitada por la Parte 3.5 del pedido de esta etapa ("agregar dedupe/cache frontend").
- Fichador — no se tocó ningún archivo de `timeEntries.service.ts` ni de `clockPunchMaintenance.ts`, aunque ambos generan `ShiftAlert` (ver §9, riesgo aceptado explícitamente para no violar la restricción de la etapa).

## 7. Contrato de API preservado

Ruta, método, query params, estructura y campos del JSON de respuesta, status codes: **sin cambios**. Verificado con 9 tests nuevos de repositorio que fijan exactamente `where`/`include`/`orderBy`/`take` (idénticos a antes) y 8 tests nuevos de controller que fijan que la respuesta cacheada es byte-a-byte la misma que la del service.

## 8. RBAC/scope preservado

`requireAnyRole([rrhh, supervision, cargaHoraria])` sin cambios en la ruta. `employeeAccessWhere(user)` se sigue calculando igual y se sigue pasando a ambas queries (antes serializado dentro de la transacción, ahora en `Promise.all`) — verificado con un test que confirma que el `where` de `findMany` y de `count` incluye el scope exacto pasado. La cache está scopeada por `userScopedCacheKey` (`userId:role:originalUrl`) — verificado con un test que confirma que dos usuarios con los mismos filtros nunca comparten el resultado cacheado del otro.

## 9. Cache — detalle

- **TTL**: 15.000ms (15s) — dentro del rango 10-20s pedido; consistente con `timeEntriesListCache`/`attendanceObservationsCache` (15s, misma categoría "lista operativa"). En frontend, `cachePolicies.shiftAlertsList` usa el mismo TTL (15s) en vez de los 30s típicos de otras listas del proyecto, a propósito: acota más la ventana de inconsistencia dado que las alertas se generan por eventos reales de asistencia (ver riesgo abajo).
- **Mecanismo**: `createTtlCache` (backend) / `cachedData` (frontend) — los mismos helpers compartidos que ya usa el resto del proyecto, ninguna infraestructura nueva.
- **Key backend**: `userScopedCacheKey(req)` = `${userId}:${role}:${originalUrl}` — el querystring completo (`type`, `severity`, `status`, `search`, `before`, `take`) ya forma parte de `originalUrl`, así que cada combinación de filtros de cada usuario es una entrada de cache distinta. Verificado con tests: cambiar cualquier filtro es un cache-miss nuevo; dos usuarios con los mismos filtros nunca comparten resultado.
- **Key frontend**: `GET:/shifts/alerts?<querystring>` dentro de la familia `"shift-alerts"`, además scopeado automáticamente por usuario/rol/empresa/sector vía `buildCacheKey`/`currentUserHash()` (mecanismo ya existente, sin cambios).
- **Invalidación**: `clearShiftAlertReadCaches()` (backend) e `invalidateCacheFamily("shift-alerts", ...)` (frontend) se disparan al **resolver una alerta** (`POST /shifts/alerts/:id/resolve`) — el único endpoint de escritura dentro del propio módulo `shifts/shiftAlert.*`. Verificado con un test que ejecuta el handler real de `resolve` y confirma que el próximo pedido de `list` ya no sirve el resultado cacheado viejo.
- **Riesgo de invalidación aceptado y documentado explícitamente**: las alertas también se **generan** (no sólo se resuelven) desde `workShiftEvaluationRunner.ts` (durante clock-in/clock-out, disparado desde `timeEntries.service.ts` — Fichador) y desde `openShiftMonitor.service.ts`/`clockPunchMaintenance.ts` (monitor de jornadas abiertas, job de mantenimiento del fichador). Ninguno de esos call sites invalida `shiftAlertListCache` — hacerlo requeriría tocar código de Fichador o sus jobs de mantenimiento, **explícitamente prohibido en esta etapa**. El riesgo queda acotado al TTL: una alerta nueva generada por un clock-in/out puede tardar hasta 15s en aparecer en la lista para otro usuario (o en la misma sesión, hasta que expire o se dispare otra invalidación real). Mismo criterio ya aceptado y documentado por el propio `docs/PERFORMANCE_STANDARDS.md` §10 para el hueco de auditoría de `clockInResolved`/`clockOutResolved` — un gap de invalidación cross-módulo acotado por un TTL corto es "detalle de latencia", no "bug crítico", siempre que el TTL sea corto (acá, 15s). Ver §13 para la recomendación de una etapa futura dedicada.

## 10. Impacto frontend

- **Dedupe**: `getAll` ahora coalesce llamadas concurrentes (StrictMode) en una sola request real — confirmado en la corrida del journey (§12): 0 duplicados de `GET /shifts/alerts` en las 2 corridas después del cambio (antes: x2 en "Entrar a Alertas de turnos").
- **No blanking**: la tabla ya no se reemplaza por el skeleton completo en cambios de filtro si ya había alertas visibles — confirmado con 2 tests nuevos (uno mide que no aparece `.loading-table` y que la fila anterior sigue visible mientras la respuesta está en vuelo; otro confirma que la carga inicial, sin datos previos, sigue mostrando el skeleton normalmente).
- **Diseño visual**: cero cambios de JSX/CSS — el único archivo de UI tocado (`ShiftAlertsPage.tsx`) sólo cambió la condición de un `setState`, nada de markup.
- **Resolver alerta**: confirmado con un test dedicado que la acción de resolver **no** se dispara como efecto colateral de cargar/filtrar (sólo con un click explícito en "Confirmar" dentro del modal) — y el journey de performance confirma 0 escrituras ejecutadas (`Resolver alerta de turno` sigue saltada, `visibleMs`/`networkIdleMs`: None).

## 11. Tests

Backend, **17 tests nuevos** en el módulo `shifts` (todos los tests del módulo pasando):
- `shiftAlert.repository.test.ts` (nuevo, +9): sin `$transaction`; `items`+`total` combinados correctamente; `take+1` con `orderBy` preservado; `include` con select recortado (no el registro completo); scope (`employeeAccessWhere`) presente en `findMany` y en `count`; filtros `type`/`severity`/`status`/`employeeId`/`workShiftId` preservados; `status=ALL` no filtra por status; `search` arma el `OR` en DB (no en memoria); `before` afecta sólo a `findMany`, no a `count` (el total es del universo de filtros, no de la página).
- `shiftAlert.controller.test.ts` (nuevo, +8, cache real sin mockear): hit/miss, key por filtros, key por usuario+rol (sin compartir entre scopes), invalidación vía `clearShiftAlertReadCaches()`, invalidación real end-to-end vía el handler de `resolve`.

Frontend, **4 tests nuevos** en `ShiftAlertsPage.test.tsx` (24/24 pasando en el archivo): cambiar el filtro "Estado" con datos ya cargados no blanquea la tabla; la carga inicial (sin datos previos) sigue mostrando el skeleton normalmente; cambiar "Severidad" dispara exactamente un pedido nuevo a `getAll` con el filtro correcto; resolver una alerta no se ejecuta como efecto colateral de cargar/filtrar.

Ningún test depende de tiempos exactos (se usan promesas controladas manualmente, no `setTimeout`/duraciones reales).

## 12. Métricas antes/después

Fuente: `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json`, 1 corrida antes del cambio (14G.1/14G.4) + 2 corridas después (para confirmar estabilidad).

| Métrica | Antes (14G.1) | Después (14G.5, 2 corridas) | Mejora |
|---|---|---|---|
| "Entrar a Alertas de turnos" — `visibleMs` | 67ms | 68-72ms | ~igual (ya era rápido) |
| "Entrar a Alertas de turnos" — `networkIdleMs` | **2509ms (Lento)** | **1092-1268ms (Medio/OK)** | **~50-56%** |
| `GET /shifts/alerts` (por llamada) | 1253ms y 1958ms (x2, duplicado) | 539ms y 712ms (x1, sin duplicado) | **~43-64% por llamada, ~2 llamadas → 1** |
| Duplicados de `GET /shifts/alerts` en la acción de entrada | Sí (x2, StrictMode) | No (0 en ambas corridas) | Eliminado |
| "Limpiar búsqueda de alertas" — `visibleMs` | **1822ms** (blanking) | **22-23ms** | **~98.7%** |
| "Filtrar alertas por tipo" — `visibleMs` | 1313ms | 16-17ms | **~98.7%** |
| Ranking — submódulo "C. Alertas de turnos" | Top 2 candidato (2509ms, Lento; hasta 3044ms Crítico en corridas de 14G.4) | Fuera del top (712ms/539ms máx. individual, puesto 9 de 10 en §15 del journey) | Deja de ser prioridad |
| HTTP errors / console errors / escrituras ejecutadas | — | 0 / 0 / 0 (ambas corridas) | — |

## 13. Riesgos pendientes

- **Invalidación de cache no alcanza la generación de alertas por Fichador** (§9) — acotado al TTL de 15s, documentado y aceptado explícitamente por no poder tocar Fichador esta etapa. Candidato para una etapa futura coordinada, con autorización explícita para tocar `timeEntries.service.ts`/`clockPunchMaintenance.ts` únicamente para agregar la invalidación (sin tocar lógica de negocio de fichadas).
- **Índice compuesto no evaluado con migración** — `orderBy: [{ createdAt: "desc" }, { id: "desc" }]` combinado con los filtros de `where` es candidato razonable a un índice compuesto en `ShiftAlert`, pero no se creó ninguna migración (fuera de alcance sin autorización explícita). Sin evidencia de que sea necesario hoy (las duraciones post-cambio son buenas), pero podría volverse relevante si el volumen de `ShiftAlert` crece mucho.
- Consistencia entre-queries no atómica (`Promise.all` en vez de `$transaction`) — mismo criterio ya aceptado en 14C.2/14G.2/14G.3/14G.4, irrelevante para una lista de alertas que se refresca sola.
- Ventana de cache de 15s (frontend y backend) — mismo criterio ya aceptado para el resto de las listas operativas del proyecto.
- Journey de un solo usuario sin concurrencia — no reemplaza métricas de producción bajo carga real.
- La línea de contexto histórico del propio journey (`docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md` §15: "`GET /shifts/alerts` ... nunca se revisó desde entonces") queda desactualizada tras esta etapa — es texto fijo del generador (`workforceManagementPerformanceJourney.spec.ts`), fuera del alcance permitido de 14G.5 (no se autorizó tocar el script del journey). Queda como limpieza de documentación menor para una etapa futura.

## 14. Recomendación para 14G.6

Con Inicio, Asistencia, Carga de horas y Alertas de turnos resueltos, los candidatos que quedan en rango Lento con evidencia ya recolectada en el journey de esta etapa son:

1. **A. Inicio** (`/gestion-horaria`) volvió a aparecer en el tope del ranking (§15 del journey regenerado, 2735ms/2161ms según la corrida) — ya fue optimizado en 14G.2 (`home-summary`), pero el duplicado por StrictMode de ese endpoint nunca se corrigió (documentado como candidato desde 14G.2, igual que se corrigió acá para `shifts/alerts`). Sería una continuación natural del mismo patrón de dedupe aplicado en 14G.4/14G.5.
2. **H. Notificaciones** (`GET /workforce/notifications`) — sin cache backend, consistentemente en rango Lento (2092-2799ms según la corrida) desde 14G.1, nunca revisado.
3. **F. Bandeja de revisión, vista "Por persona"** (`findManyByEmployeeGrouped`) — señalado repetidamente desde 14G.1 como pendiente (mismo antipatrón `$transaction` ya corregido en otros 5 endpoints), nunca corregido.
