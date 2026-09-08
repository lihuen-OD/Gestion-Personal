# Etapa 14G.7 — Optimización de Bandeja de revisión (`/pendientes`, vista "Por persona")

Fecha: 2026-09-08
Estado: **completa. Backend optimizado (sin cambiar contrato/RBAC/reglas de negocio/agrupación), sin cambios de frontend (diagnóstico confirmó que ya estaba correctamente optimizado desde 14G.4). Sin tocar Prisma schema, sin migraciones, sin cambios de diseño visual, sin escrituras ejecutadas.**
Alcance: backend del módulo `time-entries` (`timeEntries.repository.ts`) para `GET /time-entries` en sus 2 vistas (`view=flat` — "Por registro" — y `view=byEmployee` — "Por persona"), ambas gobernadas por la misma función `findMany`/`findManyByEmployeeGrouped`.

---

## 1. Contexto

14G.1-14G.6 resolvieron Inicio, Asistencia, Carga de horas, Alertas de turnos y Notificaciones. El candidato señalado repetidamente desde 14G.1 (§15) y reafirmado en 14G.5 (§14) era **F. Bandeja de revisión, vista "Por persona"**: `findManyByEmployeeGrouped`, documentado 2 veces (14C.2 y el propio ranking de 14G.1) como pendiente de corregir el mismo antipatrón `$transaction` ya resuelto en 5 endpoints anteriores de esta serie.

## 2. Evidencia desde 14C.2 y 14G.1-14G.6

- **`docs/decisions/TIME_ENTRIES_PERFORMANCE_14C2.md`** (14C.2, leído completo en esta etapa): trimeó `periodEmployeeSelect` (sacó `sector`/`position`/`dni`/`cuil`) para `findPeriodEmployees`. Su §"Riesgos/pendientes" (línea 193) dejó anotado explícitamente: *"Colapsar sector/position también en otros selects de time-entries (ej. findManyByEmployeeGrouped, usado por la bandeja) — no evaluado en esta etapa por no ser el endpoint medido como crítico."* — confirmado en esta etapa que **ya no aplica**: `findManyByEmployeeGrouped` reusa el mismo `periodEmployeeSelect` compartido, así que el trim de 14C.2 ya lo alcanzó automáticamente (ver §3).
- **14G.1** (`docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json`, corridas históricas): "Entrar a Bandeja de revisión (Por registro)" en rango Medio (1690-1858ms según la corrida), sin duplicados. §15 señaló repetidamente `findManyByEmployeeGrouped` como el antipatrón `$transaction` sin corregir.
- **14G.4** (`docs/decisions/WORKFORCE_MANAGEMENT_HOURS_ENTRY_PERFORMANCE_14G4.md`): al optimizar la entrada a `/horas`, se corrigió (inevitablemente, mismo componente `HoursPage.tsx`) el mismo gate artificial (`costCenterOptionsReady`) en el efecto de Bandeja, y se agregó dedupe frontend (`cachedData`) a `list()`/`listByEmployee()` — ambos cambios ya benefician a "Por registro" y "Por persona" por igual, confirmado vigente en esta etapa (§3).
- **14G.5/14G.6** (`WORKFORCE_MANAGEMENT_SHIFT_ALERTS_PERFORMANCE_14G5.md`, `WORKFORCE_MANAGEMENT_NOTIFICATIONS_PERFORMANCE_14G6.md`): mismo criterio de "`$transaction` array-form/interactiva -> `Promise.all` sobre el cliente `prisma` global" aplicado con éxito 5 veces antes de esta etapa — el patrón exacto que se repite acá.

## 3. Diagnóstico antes del cambio

**Endpoints disparados al entrar a `/pendientes`** (confirmado con el journey y leyendo `HoursPage.tsx`): `GET /time-entries/summary`, `GET /workforce/notifications-unread-count` (AppShell), `GET /pending`, `GET /time-entries` (vista `flat`, tab por default "Por registro"), y `GET /org-structure` (catálogo de centro de costo, ya no bloqueante desde 14G.4). **Al cambiar a "Por persona"**: `GET /time-entries?view=byEmployee` (reemplaza al de arriba, mismo componente `HoursPage.tsx`, efecto B).

- **`findManyByEmployeeGrouped` ("Por persona") SÍ usaba `$transaction`** — pero en su forma **interactiva** (`prisma.$transaction(async (tx) => {...})`), no la forma array ya vista en otros endpoints. Adentro, hacía `Promise.all([tx.employee.findMany, tx.employee.count])` y, condicionalmente, `Promise.all([tx.timeEntry.findMany, tx.hourConceptBreakdown.findMany])` — pero una transacción interactiva de Prisma usa **una única conexión** para todo el callback, así que esos `Promise.all` de `tx.*` no lograban concurrencia real (mismo hallazgo, mismo mecanismo, que `findPeriodEmployees` tenía antes de 14C.2 — confirmado con el comentario ya existente en este mismo archivo, línea ~636).
- **Hallazgo adicional (no nombrado explícitamente en el pedido, pero mismo repositorio/mismo endpoint)**: `findMany` (rama `view=flat`/"Por registro", la vista por default de Bandeja) **también** envolvía `findMany`+`count` en `prisma.$transaction([...])` (forma array) — el mismo antipatrón, sin corregir. Gobierna el mismo `GET /time-entries` del que depende "Por registro" — se incluye en el alcance por ser el mismo bloque de código diagnosticado, no un submódulo distinto.
- **¿Son independientes las queries?** Sí — en ambas ramas, cada query es de sólo lectura, sin relación de escritura entre sí. `employees` (lista+count) no depende de `entries`/`breakdowns`; estas últimas sólo dependen de los `employeeIds` ya resueltos por la primera etapa (una dependencia real de datos, no de escritura — se preservó: primero se resuelven los empleados de la página, después se agregan sus horas).
- **¿Agrupa antes o después de paginar?** Después de paginar los EMPLEADOS (`employee.findMany` con `skip`/`take` ya aplicado), la agregación de horas/desgloses sólo corre para los `employeeIds` de esa página — nunca se trae de más para agrupar en memoria.
- **¿Over-fetch?** No encontrado. `periodEmployeeSelect` (compartido con `findPeriodEmployees` desde 14C.2) ya está recortado (sin `sector`/`position`/`dni`/`cuil`) — confirma que el pendiente de 14C.2 §193 ya no aplica. Los `select` de `TimeEntry` (`employeeId, day, hours, appliedMultiplier, timeSegment{...}`) y `HourConceptBreakdown` (`employeeId, day, minutes`) ya son puntuales, no `include` amplios. El `include: {hourConcept: true}` de la vista "Por registro" (`timeEntryInclude`) trae el modelo `HourConcept` completo (no sólo `name`/`kind`, que es lo único que el frontend usa) — es un over-fetch menor, de un solo registro relacionado (no una lista, sin N+1), pero **no se tocó**: recortarlo a un `select` cambiaría el shape del JSON de esa relación, prohibido sin autorización explícita por la Parte 2 del pedido. Documentado como candidato menor para una etapa futura con autorización de contrato.
- **Filtros** (`status`, `period`, `search`, `costCenterId`, `employeeId`, `hourConceptId`): todos aplicados en el `where` de Prisma, en DB, en ambas vistas — sin filtros en memoria.
- **Duplicados por StrictMode**: no encontrados para "Entrar a Bandeja" en el journey — ya resueltos desde 14G.4 (`list`/`listByEmployee` pasan por `cachedData`).
- **`pendingQueue` (frontend) vs `GET /time-entries`**: confirmado que `pendingQueue` (TTL 30s) sólo cachea `/pending` — nunca cacheó `GET /time-entries`. Esto está bien: `GET /time-entries` (ambas vistas) ya tiene su propia cache **backend** (`timeEntriesListCache`, 15s TTL, wireada en `timeEntries.controller.ts` desde antes de esta etapa) que aplica de forma genérica vía `userScopedCacheKey` (`userId:role:originalUrl`) — el parámetro `view` ya forma parte de `originalUrl`, así que "Por registro" y "Por persona" tienen entradas de cache **distintas** automáticamente, sin necesitar ningún cambio.
- **¿Blanquea la tabla?** No — confirmado que el guard de Etapa 9F (`if (!reviewEntries.length && !reviewByPerson.length) setReviewLoading(true)`) sigue intacto y sigue sin blanquear.
- **Impacto de 14G.4 en Bandeja**: **positivo** — el gate `costCenterOptionsReady` removido en esa etapa beneficiaba a los 2 efectos (grilla de `/horas` y Bandeja), confirmado vigente; y el dedupe de `list`/`listByEmployee` agregado en 14G.4 sigue funcionando (0 duplicados en el journey).
- **`pending` (auxiliar, `/pending`)**: revisado — ya usa `Promise.all` (3 queries independientes), `select` recortado en las 3, sin `$transaction`, con dedupe frontend (`pendingQueue`, 30s) desde antes. Sin hallazgos, sin cambios.
- **Nivel 3 y Bandeja**: confirmado leyendo `frontend/src/app/navigation.tsx` — el link "Bandeja de revisión" ya está oculto para `level === 3` (regla preexistente, sin cambios). El backend (`requireAnyRole(operationalRoles)`) sí permite lectura a los 3 niveles operativos a nivel de API — esto es preexistente y no se tocó (fuera de alcance sin autorización explícita, no es un hallazgo nuevo de esta etapa).
- **Limitación del entorno de medición**: el ambiente de staging usado por el journey no tiene, para el usuario RRHH de la corrida, ningún empleado con `TimeEntry` en estado `EN_REVISION` agrupable en "Por persona" — confirmado por el propio journey (`"Abrir detalle (Ver detalle, Por persona)": no hay ninguna fila en la vista Por persona en el entorno actual`). Esto significa que la acción "Cambiar a pestaña 'Por persona'" nunca ejecuta una consulta con datos reales para medir en este entorno — ver §12 para cómo se compensó esto con evidencia de código (tests) y con la mejora medida en la vista hermana ("Por registro", mismo archivo, mismo antipatrón, sí con datos reales).

## 4. Causa raíz

**`prisma.$transaction(...)` en las 2 ramas de `timeEntriesRepository.findMany`** (interactiva para `view=byEmployee`, array-form para `view=flat`) — mismo antipatrón de fondo en ambas: lecturas independientes serializadas sobre una única conexión en vez de correr en paralelo sobre el pool de conexiones del cliente `prisma` global. Ninguna causa de over-fetch, filtros en memoria, ni de agrupación incorrecta.

## 5. Cambios aplicados

### Backend — `backend/src/modules/time-entries/timeEntries.repository.ts`

1. **`findManyByEmployeeGrouped`** (vista "Por persona"): se quita `prisma.$transaction(async (tx) => {...})` — las 4 queries (`employee.findMany`, `employee.count`, `timeEntry.findMany`, `hourConceptBreakdown.findMany`) ahora corren directamente sobre el cliente `prisma` global, en los mismos 2 `Promise.all` que ya existían adentro de la transacción (sin cambiar su estructura ni su orden de dependencia real). Misma lógica de agregación en memoria, sin ningún cambio.
2. **`findMany`** (vista "Por registro"/flat, default): `prisma.$transaction([...])` (forma array) → `Promise.all([...])`. Mismos `where`/`include`/`orderBy`/`skip`/`take` exactos.

No se tocó ningún archivo frontend — el diagnóstico (§3) confirmó que `HoursPage.tsx`/`timeEntryApiService.ts` ya estaban correctamente optimizados para Bandeja desde 14G.4 (dedupe, sin gate artificial, sin blanking). No se tocó `pending.service.ts`/`pending.repository.ts` — ya optimizados, sin hallazgos. No se agregó ninguna cache nueva — `timeEntriesListCache` (backend, 15s) ya cubre ambas vistas de `GET /time-entries` desde antes de esta etapa.

## 6. Qué NO se cambió

- Método, ruta, query params (`status`, `period`, `search`, `costCenterId`, `employeeId`, `hourConceptId`, `view`, `page`, `take`) de `GET /time-entries` — sin cambios.
- Shape del JSON de respuesta en ambas vistas — intacto (mismos campos `employee`/`summary` para "Por persona"; mismos campos de `TimeEntry` para "Por registro").
- Agrupación por empleado en "Por persona" — sigue calculándose exactamente igual (mismas prioridades de estado, mismo cálculo de horas especiales/liquidable, Etapa 11C intacta).
- Filtros por período, búsqueda, estado, centro de costo — mismos `where` exactos en ambas vistas.
- Scope del usuario (`employeeAccessWhere`), permisos (`requireAnyRole(operationalRoles)`), ocultamiento del link de Bandeja para Nivel 3 — sin cambios.
- Acciones de aprobar/rechazar/devolver registro, novedad, desglose manual — no se tocó ningún controller/service de esos flujos ni sus invalidaciones existentes (`clearTimeEntriesReadCaches()`, ya llamada desde `time-entries`/`novelties`/`employees` controllers, confirmado vigente y sin cambios).
- Cálculo real/liquidable, conceptos horarios, horas especiales — sin cambios de lógica de negocio.
- Navegación a `/horas/:id`, comportamiento de `/horas` (grilla de Carga de horas) — sin cambios (no se tocó `HoursPage.tsx` ni `EmployeeHoursPage.tsx`).
- `include: {hourConcept: true}` (over-fetch menor identificado en §3) — no se tocó, cambiar a un `select` alteraría el shape del JSON, prohibido sin autorización explícita.
- **No se encontró ningún bug funcional** que requiriera autorización para corregir.
- Fichador, generación de alertas, Inicio/home-summary, Asistencia, Alertas de turnos, Notificaciones, Cierres mensuales — ningún archivo de esos módulos se tocó.

## 7. Contrato de API preservado

Ruta, método, query params, estructura y campos del JSON de respuesta, status codes: **sin cambios** en ninguna de las 2 vistas. Verificado con 6 tests nuevos que fijan exactamente `where`/`select`/`orderBy`/`skip`/`take` (idénticos a antes) para ambas ramas, más los 6 tests preexistentes de "Por persona" (Etapa 6M/11C) migrados de mockear `__tx.*` a mockear `prisma.*` directamente, sin cambiar ninguna aserción de contrato/negocio.

## 8. RBAC/scope preservado

`requireAnyRole(operationalRoles)` (RRHH, Supervisión, Carga horaria) sin cambios en la ruta. `employeeAccessWhere(user)` se sigue calculando igual y se sigue pasando a las queries de ambas vistas (antes serializado dentro de la transacción, ahora sobre el cliente global) — verificado con los tests existentes que ya cubrían scope (sin cambios de aserción, sólo de mecanismo de mock). El ocultamiento del link de Bandeja para Nivel 3 (frontend, preexistente) no se tocó.

## 9. Impacto sobre `/horas` por componente compartido

**Ninguno negativo, confirmado con evidencia.** `HoursPage.tsx` no se tocó en esta etapa (0 cambios de código frontend). El journey de esta etapa midió "Entrar a Carga de horas" en 2252ms — dentro del mismo rango ya estable desde 14G.4/14G.5 (2110-2265ms) — sin ninguna regresión atribuible a este cambio (que además es 100% backend, en un archivo/módulo distinto del que usa la grilla de `/horas`: `getPeriodEmployees`/`getSummary` no pasan por `findMany`/`findManyByEmployeeGrouped`, exclusivos de Bandeja). Los 44 tests de `HoursPage.test.tsx` (grilla + Bandeja, incluidos los de 14G.4) siguen pasando sin modificación.

## 10. Cache/dedupe/loading

No se agregó ninguna cache/política nueva — ya existían y ya cubrían ambas vistas antes de esta etapa:

- **Backend**: `timeEntriesListCache` (`timeEntries.cache.ts`, TTL 15s) — wireada en `timeEntries.controller.ts`'s handler `list` desde antes de 14G.7. Key: `userScopedCacheKey(req)` = `${userId}:${role}:${originalUrl}` — el querystring completo (incluido `view=byEmployee` vs sin `view`) ya forma parte de `originalUrl`, así que "Por registro" y "Por persona" son entradas de cache distintas automáticamente, nunca compartidas entre usuarios ni entre vistas. Invalidación: `clearTimeEntriesReadCaches()`, ya llamada desde `time-entries`/`novelties`/`employees` controllers en cada mutación real (aprobar/rechazar/devolver registro, novedad, desglose, guardar horas, enviar a revisión) — confirmado vigente, sin huecos nuevos.
- **Frontend**: `list()`/`listByEmployee()` ya envueltos con `cachedData` (familia `"time-entries"`, TTL 30s) desde 14G.4 — dedupe in-flight confirmado sin duplicados en el journey de esta etapa.
- **Riesgos**: ninguno nuevo — mismas ventanas de TTL ya aceptadas desde 14G.4/14C.2.

## 11. Tests

Backend, **6 tests nuevos** en `timeEntries.repository.test.ts` (todos los tests del módulo pasando, 128/128 en el archivo):
- Vista "Por registro" (nuevo describe, +5): sin `$transaction`; `[items, total]` combinados correctamente; paginación (`skip`/`take`); ordenamiento (`date desc`, `employee.lastName asc`); filtros (`status`/`period`/`employeeId`/`hourConceptId`) preservados en el `where` de `findMany` y de `count`.
- Vista "Por persona" (+1 nuevo: sin `$transaction`; los 11 tests preexistentes de Etapa 6M/11C migrados de `mockedPrisma.__tx.*` a `mockedPrisma.*` — mismas aserciones de negocio (Horas Especiales, suma de horas normales, exclusión de conceptos adicionales), sin ningún cambio de expectativa.

No se agregaron tests nuevos de `timeEntries.controller.test.ts`/`timeEntries.service.test.ts` — ninguno de los 2 archivos mockea `$transaction` (mockean la capa de repositorio), así que no se ven afectados por este cambio y sus aserciones de contrato ya cubrían `list()` sin modificación necesaria.

Ningún test depende de tiempos exactos.

## 12. Métricas antes/después

Fuente: `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json`, 1 corrida antes del cambio (histórica, 14G.5/14G.6) + 2 corridas después (para confirmar estabilidad).

| Métrica | Antes | Después (14G.7, 2 corridas) | Mejora |
|---|---|---|---|
| "Entrar a Bandeja de revisión" — `visibleMs` | 76-80ms | 80-81ms | ~igual (ya era rápido) |
| "Entrar a Bandeja de revisión" — `networkIdleMs` | **1858ms (Medio, tope alto)** | **935-1329ms (Medio, tope bajo)** | **~28.5-49.7%** |
| `GET /time-entries` (vista "Por registro", por llamada) | 1292ms | 369-567ms | **~56-71%** |
| Duplicados de `GET /time-entries` en "Entrar a Bandeja" | No (ya resuelto desde 14G.4) | No (ambas corridas) | Sin cambios — sigue sin duplicados |
| `GET /time-entries?view=byEmployee` ("Por persona") | Sin datos que agrupar en el entorno de staging — no medible por el journey en ninguna corrida (antes ni después) | Ídem | No medible por el journey; ver evidencia de código (tests) abajo |
| Contrato: `$transaction` en `findMany`/`findManyByEmployeeGrouped` | Presente (array-form y forma interactiva respectivamente) | **Ausente**, confirmado por 6 tests que asertan `mockedPrisma.$transaction).not.toHaveBeenCalled()` | Antipatrón eliminado en el código, con evidencia de test — la ganancia de "Por persona" se infiere por analogía directa con "Por registro" (mismo archivo, mismo patrón, mismo tipo de queries) |
| Impacto sobre "Entrar a Carga de horas" (`/horas`, componente compartido) | 2110-2265ms (rango ya estable desde 14G.4/14G.5) | 2252ms | Sin regresión |
| HTTP errors / console errors / escrituras ejecutadas | — | 0 / 0 / 0 (ambas corridas) | — |

## 13. Riesgos pendientes

- **La mejora de "Por persona" no se pudo medir directamente con el journey** por falta de datos agrupables en el entorno de staging (§3/§12) — mitigado con evidencia de código (tests que confirman la eliminación del `$transaction`) y con la analogía directa de la vista hermana ("Por registro", mismo archivo, mismo antipatrón, mismo tipo de queries, sí medida con datos reales: ~56-71% de mejora por llamada). Recomendado: si se dispone de un entorno con datos reales de "Por persona" en el futuro, re-medir puntualmente esa acción.
- **`include: {hourConcept: true}`** (vista "Por registro") — over-fetch menor de un registro relacionado (no una lista, sin N+1); no se tocó por requerir autorización explícita para cambiar el shape del JSON. Candidato de bajo impacto para una etapa futura coordinada.
- Consistencia entre-queries no atómica (`Promise.all` en vez de `$transaction`) en ambas vistas — mismo criterio ya aceptado 5 veces en esta serie (14C.2/14G.2/14G.3/14G.5/14G.6), irrelevante para una bandeja operativa que se refresca sola.
- La línea de contexto histórico del propio journey (`docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md` §15: "`findManyByEmployeeGrouped`... documentado 2 veces como pendiente, nunca corregido") queda desactualizada tras esta etapa — texto fijo del generador (`workforceManagementPerformanceJourney.spec.ts`), fuera del alcance permitido de 14G.7 (mismo criterio ya documentado en 14G.5 para una línea equivalente sobre `shifts/alerts`).
- Journey de un solo usuario sin concurrencia — no reemplaza métricas de producción bajo carga real.

## 14. Recomendación para 14G.8

Con Inicio, Asistencia, Carga de horas, Alertas de turnos, Notificaciones y Bandeja de revisión resueltos, los candidatos con evidencia ya recolectada son:

1. **A. Inicio** (`GET /time-entries/home-summary`) — reapareció con duplicado x2 por StrictMode en las 2 corridas de esta etapa (§10 del journey regenerado), nunca corregido desde 14G.2 (que sólo optimizó el `$transaction`, dejando el dedupe frontend documentado como pendiente).
2. **Cierres mensuales** (`GET /workforce/closures`/`GET /workforce/corrections`) — mostraron duplicado x2 en corridas anteriores (14G.1), nunca medidos antes de esa etapa ni revisados desde entonces.
3. Con estos 2 candidatos y la vista "Por persona" de Bandeja pendiente de re-medición cuando haya datos reales, sería razonable considerar una nueva corrida de diagnóstico consolidado (¿14G.8 como cierre de la serie, o una etapa dedicada a "Por persona" con datos sembrados a propósito?) antes de dar por terminada la serie 14G completa.
