# Etapa 14G.2 — Optimización de Inicio de Gestión horaria / `GET /time-entries/home-summary`

Fecha: 2026-09-07
Estado: **completa. Backend optimizado (sin cambiar contrato/RBAC/reglas de negocio), sin tocar Prisma schema, sin migraciones, sin cambios de diseño visual, sin tocar frontend (no hizo falta).**
Alcance: exclusivamente el submódulo Inicio (`/gestion-horaria`, `HourlyManagementHomePage.tsx`) y su endpoint `GET /time-entries/home-summary`.

---

## 1. Contexto

14G.1 (diagnóstico macro de Gestión horaria) identificó `GET /time-entries/home-summary` como el endpoint más lento medido en todo el recorrido: 6246ms (rango Crítico), en la acción "Entrar a Inicio (Gestión horaria)" — la primera pantalla que ve cualquier usuario de Gestión horaria. 14G.2 optimiza puntualmente ese endpoint, sin tocar ningún otro submódulo.

## 2. Evidencia de 14G.1

De `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json` (corrida previa a esta etapa):

- Acción "Entrar a Inicio (Gestión horaria)": `visibleMs` 94ms, `networkIdleMs` **6827ms** (Crítico).
- `GET /api/time-entries/home-summary` disparado **2 veces** dentro de esa misma acción (duplicado por StrictMode, ver §6): 3085ms y **6246ms**.
- Submódulo "A. Inicio" era el #1 del ranking recomendado para 14G.2+ (1 endpoint Crítico, ningún otro submódulo tenía más).

## 3. Diagnóstico del endpoint antes del cambio

`timeEntriesController.homeSummary` → `timeEntriesService.homeSummary(user)`:

1. `const counts = await timeEntriesRepository.homeCounts(period, access);` — **awaited sola**, antes de cualquier otra query.
2. Sólo si `user.role !== cargaHoraria` (roles RRHH/supervisión — "revisión"): `await Promise.all([pendingNoveltiesCount(access), attendanceObservedCount({...})])` — **recién después** de que `homeCounts` terminó.

`timeEntriesRepository.homeCounts` (3 counts: empleados sin cargar, horas devueltas, horas en revisión) y `timeEntriesRepository.attendanceObservedCount` (3 counts: jornadas observadas, fichadas observadas, incidentes de inactividad) estaban **cada una** envueltas en `prisma.$transaction([...])` (forma array).

**Sin cache backend** — `home-summary` era el único endpoint del módulo `time-entries` sin ningún `createTtlCache` (confirmado en la Matriz 1 de 14G.1): `list`/`summary`/`periodEmployees` (15-20s) y `attendance` (10s) sí tenían.

No hay índices faltantes: las 6 queries (`Employee.count`, `TimeEntry.count` x2, `Novelty.count`, `WorkShift.count`, `AttendancePunch.count`, `AttendanceInactivityIncident.count`) filtran por columnas ya indexadas por relaciones FK y por los mismos criterios que `summary`/`attendanceSummary` (endpoints hermanos, ya medidos rápidos tras 14C.2/14E.2) — no se detectó ni se propone ningún cambio de índice.

## 4. Causa raíz

**`prisma.$transaction([...])` (forma array) en `homeCounts` y `attendanceObservedCount`.** Una transacción interactiva de Prisma usa una única conexión de la pool — el array de "queries en paralelo" en realidad serializa cada round-trip a Neon uno detrás del otro, sin ninguna ganancia de atomicidad real (son 3 counts de sólo lectura e independientes en cada función). Este es **exactamente el mismo antipatrón que 14C.2 ya identificó y corrigió** en `findPeriodEmployees`, `summary` y `attendanceSummary` — pero `homeCounts` y `attendanceObservedCount` quedaron afuera de ese barrido (viven en el mismo archivo, a pocas líneas del comentario que documenta el fix de 14C.2).

Efecto compuesto para el rol "revisión" (RRHH/supervisión, el camino más común): 3 counts serializados (`homeCounts`) + `await` adicional antes de arrancar 2 counts más (uno de los cuales, `attendanceObservedCount`, internamente serializa 3 counts más) — hasta 6 round-trips a Neon en cadena para un solo request HTTP, sin ninguna necesidad de esa secuencialidad.

Sin cache backend, cada entrada a Inicio (y cada re-render de React StrictMode en desarrollo) repetía el costo completo.

## 5. Cambios aplicados

### Backend — `backend/src/modules/time-entries/`

1. **`timeEntries.repository.ts`** — `homeCounts`: `prisma.$transaction([...])` → `Promise.all([...])` sobre el cliente `prisma` global (pool de conexiones). Mismas 3 queries, mismos filtros, mismo orden de destructuring — cero cambio de semántica.
2. **`timeEntries.repository.ts`** — `attendanceObservedCount`: mismo cambio ($transaction → Promise.all), mismas 3 queries y mismo cálculo de suma final.
3. **`timeEntries.service.ts`** — `homeSummary`: para el rol "revisión", las 3 llamadas (`homeCounts`, `pendingNoveltiesCount`, `attendanceObservedCount`) ahora corren en **un único `Promise.all`** en vez de "await homeCounts, después Promise.all de las otras dos" — eliminada la dependencia secuencial artificial (ninguna de las 3 necesita el resultado de otra). Para el rol "carga" no cambia nada (siempre fue 1 sola query).
4. **`timeEntries.cache.ts`** — nuevo `homeSummaryCache = createTtlCache(20_000)` (mismo TTL que `timeEntriesSummaryCache`, mismo mecanismo `createTtlCache` ya usado por los otros 4 caches del módulo — ninguna infraestructura nueva). Agregado a `clearTimeEntriesReadCaches()`.
5. **`timeEntries.controller.ts`** — `homeSummary` ahora usa `userScopedCacheKey(req)` + `homeSummaryCache.get/set`, exactamente el mismo patrón ya usado por `list`/`summary`/`periodEmployees`/`attendanceSummary` en el mismo archivo.

No se tocó ningún otro archivo, ningún otro endpoint, ningún otro submódulo, Prisma schema, RBAC, ni el frontend (no hizo falta — ver §11).

## 6. Qué NO se cambió

- Nombres de campos ni estructura del JSON de respuesta (`role`, `period`, `paraCargar`/`devueltosParaCorregir`/`enviadoEsperandoRevision` para "carga"; `paraRevisarHoy`/`novedadesPendientes`/`fichadasObservadas` para "revisión").
- Permisos ni visibilidad por nivel (`requireAnyRole(operationalRoles)` intacto en `timeEntries.routes.ts`).
- Período usado (`currentPeriod()`, sin cambios) ni fechas de asistencia (`argentinaDayRange(todayArgentinaDateKey())`, sin cambios).
- Criterios de "pendientes" (`EmployeeStatus.ACTIVO` + `timeEntries: none`), de "devueltos"/"en revisión" (`ApprovalStatus`), de novedades pendientes, ni de fichadas/incidentes observados — mismos `where` exactos, sólo se removió el wrapper `$transaction`.
- Datos mostrados en las cards de `HourlyManagementHomePage.tsx` ni la navegación de los `StatLink` — el frontend no se tocó.
- Diseño visual — cero cambios de UI.
- **No se encontró ningún bug de datos incorrectos** en el endpoint durante el diagnóstico — no aplicó la excepción de "corregir un bug mínimo imprescindible".
- El duplicado por StrictMode de `home-summary` (2 llamadas en la misma carga de página, ver §2) **no se corrigió** — es un patrón de sólo-desarrollo (React StrictMode), no ocurre en producción, y arreglarlo requeriría tocar el frontend (dedupe/cache), fuera del criterio mínimo de esta etapa dado que el endpoint ya deja de ser Crítico incluso con el duplicado. Documentado como candidato para una etapa de frontend dedicada (ver §13).

## 7. Riesgos

- **Consistencia entre-queries**: `Promise.all` corre las 3 (o 6, contando `attendanceObservedCount`) queries como snapshots independientes en vez de una transacción atómica. Para un contador de "para hacer hoy" que se refresca en el próximo request (o cada 20s por cache), una inconsistencia momentánea entre counts (p. ej. alguien aprueba una novedad a mitad del request) es imperceptible y ya es el criterio aceptado en 14C.2 para `findPeriodEmployees`/`summary`/`attendanceSummary` — mismo estándar, no uno nuevo.
- **Cache 20s**: durante esa ventana, un cambio real (nueva hora enviada a revisión, novedad aprobada, fichada observada) no se refleja en Inicio hasta que expira el TTL o hasta la próxima escritura relacionada (que invalida vía `clearTimeEntriesReadCaches()`, ver §10). Igual a la tolerancia ya aceptada para `summary`/`attendanceSummary`.
- Journey de un solo usuario sin concurrencia — no reemplaza métricas de producción bajo carga real.
- El duplicado por StrictMode sigue sin corregir (ver §6) — en desarrollo, dos requests casi simultáneos pueden ambos fallar el cache (el segundo llega antes de que el primero termine y haga `.set()`), pagando el costo completo dos veces; en producción (sin StrictMode) esto no ocurre.

## 8. Contrato de API preservado

Ruta, método, query params (ninguno), estructura y campos del JSON de respuesta, status codes y códigos de error: **sin cambios**. Verificado con tests nuevos (`timeEntries.service.test.ts`, `timeEntries.repository.test.ts`) que fijan el shape exacto de la respuesta para ambos roles.

## 9. Seguridad/RBAC/scope

- `requireAnyRole(operationalRoles)` (RRHH, supervisión, carga horaria) en `timeEntries.routes.ts`: **sin cambios**.
- `employeeAccessWhere(user)` se sigue calculando igual y se sigue pasando a las 3 queries (antes secuencial, ahora en paralelo) — verificado con un test nuevo que confirma que Nivel 2 (supervisión) nunca recibe el scope vacío `{}` de RRHH, y que RRHH sigue recibiendo `{}` (sin restricción) como antes.
- La cache nueva está scopeada por `userScopedCacheKey` (`userId:role:originalUrl`) — dos usuarios nunca comparten una entrada de cache, incluso si están en el mismo sector/empresa, porque la key incluye el `userId` real. Verificado con un test de integración dedicado (`timeEntries.homeSummary.test.ts`) que llama al controller con dos usuarios distintos y confirma que cada uno recibe sólo su propio resultado cacheado.

## 10. Cache — detalle

- **TTL**: 20.000ms (20s) — igual a `timeEntriesSummaryCache`, dentro del rango 15-30s pedido y de la categoría "operational" de `PERFORMANCE_STANDARDS.md` §2.C (10-20s backend).
- **Mecanismo**: `createTtlCache` (el mismo helper compartido que ya usan `timeEntriesListCache`/`timeEntriesSummaryCache`/`timeEntriesPeriodEmployeesCache`/`attendanceSummaryCache`) — ninguna infraestructura de cache nueva.
- **Key**: `userScopedCacheKey(req)` = `${req.user.id}:${req.user.role}:${req.originalUrl}` — como `home-summary` no acepta ningún query param, la key se reduce a `userId:role:/api/time-entries/home-summary`, una entrada por usuario.
- **Por qué no filtra datos entre usuarios/scopes**: la key incluye el `userId` real (no sólo el rol ni el sector) — dos usuarios con el mismo rol y el mismo scope de `employeeAccessWhere` (p. ej. dos supervisores del mismo sector) NUNCA comparten entrada, cada uno tiene la suya. No hay forma de que un usuario vea el resultado cacheado de otro.
- **Invalidación**: agregada a `clearTimeEntriesReadCaches()`, la función que YA es llamada por absolutamente todas las mutaciones que pueden afectar los 6 counts subyacentes (`create`/`update`/`submit`/`approve`/`reject`/`returnForCorrection` de horas, `resolveAttendanceObservation`, `closeWorkShiftManually`/`observeWorkShift`/`markMissingOut`, todos los clock-in/out/photo-punch, y — vía `novelties.controller.ts`, que también llama `clearTimeEntriesReadCaches()` en cada mutación — crear/aprobar/aprobar-en-lote/rechazar/eliminar novedades). Cero call-sites nuevos: se reusan los ~15 ya existentes y correctos.

## 11. Frontend — no se tocó

`HourlyManagementHomePage.tsx`, `timeEntryApiService.ts` y la navegación quedaron intactos. Con el fix de backend, la acción "Entrar a Inicio" pasó de 6827ms a 1352ms de `networkIdleMs` (Medio) — no se detectó necesidad de mejorar loading/silent-refresh/dedupe frontend para cumplir el criterio de éxito de esta etapa. El duplicado StrictMode (§6/§13) queda como candidato explícito para una etapa de frontend futura si se decide perseguir la ganancia adicional.

## 12. Métricas antes/después

| Métrica | Antes (14G.1) | Después (14G.2) | Mejora |
|---|---|---|---|
| Acción "Entrar a Inicio" — `visibleMs` | 94ms | 86ms | ~9% (ya era rápido, sin cambios relevantes) |
| Acción "Entrar a Inicio" — `networkIdleMs` | **6827ms (Crítico)** | **1352ms (Medio)** | **~80%** |
| `GET /time-entries/home-summary` (llamada más lenta de las 2 por StrictMode) | 6246ms | 779ms | **~87.5%** |
| `GET /time-entries/home-summary` (llamada más rápida de las 2) | 3085ms | 777ms | ~74.8% |
| Ranking 14G.2+ — posición de "A. Inicio" | **#1 de 10** (1 Crítico) | **#8 de 10** (0 Crítico, 0 Lento) | Deja de ser prioridad |
| Nuevo #1 del ranking | — | **B. Asistencia** (`attendance/observations`, 4681ms Crítico) | Candidato claro para 14G.3 |

Fuente: `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json`, corridas de `npm run perf:journey:workforce` antes y después de este cambio (mismo journey de 14G.1, no se creó uno nuevo — mide todo Gestión horaria, no sólo Inicio, así que también sirve de regresión para los otros 9 submódulos).

## 13. Validaciones ejecutadas

Backend:
- `npx prisma validate` → OK (schema sin cambios).
- `npm run typecheck` → limpio.
- `npm test` → 1165/1165 (1148 preexistentes + 17 nuevos: 8 en `timeEntries.repository.test.ts`, 6 en `timeEntries.service.test.ts`, 4 en `timeEntries.homeSummary.test.ts` — ver detalle en el reporte final de la etapa).
- `npm run build` → OK.

Frontend:
- `npx tsc -p tsconfig.e2e.json --noEmit` → limpio.
- `npm run test` → 664/664 (sin cambios, no se tocó frontend).
- `npm run build` → OK.
- `npm run perf:journey:workforce` → 1 passed, 0 HTTP errors, 0 console errors, 0 escrituras ejecutadas, 37/65 acciones cubiertas (igual que antes — sin regresión de cobertura).
- `npm run perf:journey:employees` → ver resultado en el reporte final de la etapa.

General: `git diff --check`, `git status --short`, `git diff --stat` — ver reporte final.

## 14. Próximos pasos

- **14G.3 recomendado**: Asistencia (`GET /time-entries/attendance/observations`, medido en 4681ms Crítico en esta misma corrida — sin cache backend, `$transaction` array-form de 6 queries, ver Matriz 1 de 14G.1). Es ahora el #1 del ranking.
- Candidato menor (no bloqueante): eliminar el duplicado por StrictMode de `home-summary` con un cache/dedupe frontend, mismo patrón que 14F.2 aplicó a `notifications-unread-count`/`audit` — evaluar si se justifica en una etapa de frontend dedicada.
- `findManyByEmployeeGrouped` (Bandeja de revisión, "Por persona") sigue con el mismo antipatrón `$transaction`, documentado 2 veces desde 14C.2 — sigue pendiente, no tocado por alcance de esta etapa.
