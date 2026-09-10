# Etapa 14I.1 — Diagnóstico transversal de infraestructura de performance backend

**Etapa de diagnóstico puro. Cero cambios de código productivo.** No se tocó ningún repository, controller, service, schema de Prisma ni frontend. Todo lo que sigue es evidencia de lectura directa de código (con citas archivo:línea) más la consolidación de 20 documentos de decisión previos (14C-14H).

## 1. Resumen ejecutivo

Con las series 14D (Legajos), 14G (Gestión horaria) y 14H (Configuración + Puestos) cerradas, este diagnóstico mapea la deuda técnica de infraestructura backend que queda **transversal a todos los módulos**, en vez de seguir optimizando pantalla por pantalla. Hallazgo principal: el patrón `$transaction([findMany, count])` → `Promise.all` — corregido ya **15 veces** en 14C/14G/14H — **sigue sin aplicarse en 6 lugares**, 3 de ellos en módulos que **ninguna etapa de performance auditó nunca** (`novelties`, `users`, `salary-categories`), uno en un módulo parcialmente auditado (`documents`), uno en un sibling-file fácil de pasar por alto (`hourConceptRules.repository.ts`, distinto de `hourConcepts.repository.ts` ya corregido) y uno en **forma callback** dentro de un módulo que sí tuvo una etapa dedicada (`timeEntries.repository.ts::attendanceSummary`, ver §4.4 — la forma callback-sin-escrituras es la misma clase de antipatrón que la forma array, y pasó desapercibida incluso para 14G.3). De esos 6, **3 son candidatos P0 inmediatos** (lecturas siempre ejecutadas, con caller real, sin ningún riesgo de contrato) y 3 quedan como P1/P2 por distintas razones (sin caller real, o dentro de un módulo Gestión-horaria-adyacente que requiere el mismo cuidado que cualquier cambio a `time-entries`).

**Nota de proceso**: este diagnóstico se compiló combinando verificación directa mía (línea por línea, sin muestreo) con un agente de grep exhaustivo independiente sobre los 22 módulos del backend; el cruce de ambos detectó una familia completa de 6 caches del módulo `employees` (`employeeDetailCache`/`employeeTimeGridCache`/`employeeListCache`/`employeeSummaryCache`/`employeeOrgChartCache`/`employeeOptionsCache`, todas en `employees.controller.ts:11-16`) que mi primera pasada no había registrado, más el cache de `auth.service.ts` (`currentUserCache`) y los caches de infraestructura de `googleDriveStorage.provider.ts` — todos ya incorporados abajo. El número real de caches backend auditadas es **~34**, no 22 como se reportó en la primera pasada de esta misma etapa.

En `relationJoins`, la situación es sana y ya quirúrgica: el preview feature está habilitado desde 14D.7 y aplicado en exactamente 5 queries de 2 módulos, con una lista explícita y documentada de exclusiones (`_count`, `$transaction`, paginación, `orderBy` anidado) — no hay trabajo de limpieza pendiente ahí, sólo candidatos nuevos a evaluar con su propio diagnóstico.

En cache backend, el patrón `createTtlCache` (factory compartida) está sano y consistentemente bien scopeado por usuario/rol donde hace falta (verificado en 14G.9 para 11 caches, y re-verificado acá para 6 módulos adicionales nunca antes auditados — cero hallazgos de leak entre usuarios en ningún caso). El problema real no es de seguridad sino de **consistencia arquitectónica**: 5 módulos (`positions`, `hour-concepts`, `novelty-types`, `document-categories`, `salary-categories`) replican **el mismo patrón de cache a mano** (`listCache` a nivel repositorio, `{data, expiresAt}` sin extraer a un helper) en vez de compartir una función, y 3 de ellos (`hour-concepts`, `novelty-types`, `salary-categories`) además lo **apilan** con una segunda cache a nivel controller sobre el mismo recurso — deuda ya documentada 3 veces (14H.5, 14H.6, 14H.8), nunca consolidada a propósito.

Se encontró además una **desactualización objetiva de `docs/PERFORMANCE_STANDARDS.md`**: su §17 dice "notificaciones sin cache, deliberado" y compara con "`closures()` sin cachear, igual criterio" — ambas afirmaciones ya no son ciertas (14G.6 le agregó cache a notificaciones, 14G.8 se lo agregó a `closures()`), simplemente el documento nunca se actualizó después. Se corrige en este mismo diagnóstico (§17 más abajo lista el cambio propuesto, no aplicado todavía — ver Parte 5, "actualizar documentación si se encuentra error objetivo" es lo único permitido tocar hoy).

## 2. Contexto 14D/14G/14H

- **14D** (Legajos): estableció el patrón `$transaction`→`Promise.all` (14C.1/14C.3) y diagnosticó/adoptó `relationLoadStrategy: "join"` (14D.6 diagnóstico, 14D.7 rollout permanente y acotado a 4-5 queries). También creó `runInBatches` (14E.1) para acotar fan-outs de `Promise.all` que saturaban el pool de Neon bajo carga real (incidente confirmado: `P1017`, 15 queries concurrentes del dashboard).
- **14G** (Gestión horaria): aplicó el mismo patrón `$transaction`→`Promise.all` 7 veces más (`time-entries` ×3 lugares, `shiftAlert`, `workforce.service.notifications`), agregó 5 caches backend nuevas (`homeSummaryCache`, `attendanceObservationsCache`, `shiftAlertListCache`, `notificationsListCache`, `closuresCache`/`correctionsCache`), y cerró con una auditoría completa de las 11 caches backend + 4 familias frontend de la serie (14G.9) — **cero hallazgos de leak entre usuarios/roles**, sólo 2 huecos de invalidación cross-módulo aceptados como deuda acotada por TTL corto (`shiftAlertListCache` no invalidado por el Fichador; `notificationsListCache` no invalidado por 5+ módulos generadores).
- **14H** (Configuración + Puestos): aplicó el mismo patrón 5 veces más (`work-regimes`, `holiday-work`, `hour-concepts` ×2, `document-categories`, `audit-parameters`, `positions`, `novelty-types`), y estableció explícitamente el criterio **"sólo se corrige lo que tiene un caller real, verificado por grep"** (14H.5, reafirmado 14H.6/14H.8) — criterio que este diagnóstico aplica de nuevo en §4 y §10.
- Ningún doc de 14D/14G/14H tocó nunca: `novelties`, `users`, `salary-categories` (nunca auditados), ni completó una pasada de `documents` (sólo tiene test de servicio, no de repositorio/cache).

## 3. Metodología

1. Lectura completa de los 9 docs de 14H (macro + 6 submódulos + Puestos + Tipos de novedades), los 9 docs de 14G, los 2 docs de `relationJoins` (14D.6/14D.7), los 2 docs de dashboard (14E.1/14E.2) y `docs/PERFORMANCE_STANDARDS.md` completo — para separar "ya corregido" de "documentado como pendiente" y no re-reportar nada como hallazgo nuevo.
2. Grep exhaustivo y verificado a mano, línea por línea, de `$transaction` en los 22 módulos de `backend/src/modules` (no una muestra) — cada ocurrencia clasificada como forma-array (candidato) vs. forma-callback (transacción interactiva de escritura, legítima) vs. comentario histórico.
3. Grep exhaustivo de `createTtlCache`, `*.cache.ts` y patrones de cache inline (`listCache`, `overviewCache`, `timeGridCatalogCache`) en los 22 módulos — cada uno leído completo (no sólo grep) para confirmar key, TTL, scope y invalidación reales.
4. Grep de `relationLoadStrategy` en todo `backend/src` y lectura directa de `backend/prisma/schema.prisma` (no se confió en la narrativa histórica de los docs: 14D.6 diagnosticó y **revirtió**, 14D.7 lo hizo permanente — hay que leer los dos en orden para no asumir mal el estado actual).
5. Para cada `$transaction` remanente, grep del frontend completo (`frontend/src`) para confirmar si existe un caller real que ejercite esa rama de código — mismo criterio que 14H.5/14H.6/14H.8, aplicado ahora a los 3 módulos nunca auditados.
6. Verificación de tests existentes por módulo (`find *.test.ts`) para el inventario de "cache sin test de aislamiento".

## 4. Inventario `$transaction`

### 4.1 Ya corregidos (histórico, no se re-audita — 13 casos confirmados)

| # | Módulo | Función | Etapa |
|---|---|---|---|
| 1 | `employees.repository.ts` | `findMany` (Legajos) | 14C.1 |
| 2 | `employees.repository.ts` | otro `findMany`/agregación | 14C.3 |
| 3 | `work-regimes/workRegimes.repository.ts` | `findMany` | 14H.2 |
| 4 | `work-regimes/workRegimes.repository.ts` | `findEmployees` | 14H.2 |
| 5 | `time-entries/timeEntries.repository.ts` | `homeCounts`/`attendanceObservedCount` | 14G.2 |
| 6 | `time-entries/timeEntries.repository.ts` | `attendanceObservations` (6 queries) | 14G.3 |
| 7 | `shifts/shiftAlert.repository.ts` | `findMany` | 14G.5 |
| 8 | `workforce-management/workforce.service.ts` | `notifications()` | 14G.6 |
| 9 | `time-entries/timeEntries.repository.ts` | `findManyByEmployeeGrouped` (forma interactiva) + `findMany` flat | 14G.7 |
| 10 | `shifts/holidayWorkAssignment.repository.ts` | `findCandidates` | 14H.4 |
| 11 | `hour-concepts/hourConcepts.repository.ts` | `findMany` (filtrada) + `findEmployees` | 14H.5 |
| 12 | `document-categories/documentCategories.repository.ts` | `findMany` (filtrada) | 14H.6 |
| 13 | `audit-parameters/auditParameters.repository.ts` | `findMany` (siempre) | 14H.6 |
| 14 | `positions/positions.repository.ts` | `findMany` (filtrada) | 14H.7 |
| 15 | `novelty-types/noveltyTypes.repository.ts` | `findMany` (filtrada) | 14H.8 |

(15 fixes reales, no 13 — la cifra "13 veces" citada en los docs de 14H.6/14H.7 no contaba los 2 de `employees` de 14C; se corrige acá con el conteo completo.)

### 4.2 Remanentes confirmados hoy (grep directo, 2026-09-10) — 5 casos

| # | Archivo:línea | Función | Forma | ¿Caller real? | Contrato | Prioridad |
|---|---|---|---|---|---|---|
| 1 | `novelties/novelties.repository.ts:166` | `findMany` (listado principal de Novedades) | Array, **incondicional** (sin rama `hasActiveFilters`) | **Sí** — `NoveltiesPage.tsx`, `NoveltyModal.tsx` (cross-referencia), `EmployeeHoursPage.tsx` vía `noveltyApiService.getAll({employeeId})`. RBAC-scoped (`employeeAccessWhere`). | `GET /novelties` sin cambios de shape | **P0** |
| 2 | `users/users.repository.ts:41` | `findMany` (listado de Usuarios) | Array, **incondicional** | **Sí** — `UsersPage.tsx` (única pantalla admin de usuarios, siempre la ejercita al entrar). Sólo `adminRoles`. | `GET /users` sin cambios de shape | **P0** |
| 3 | `documents/documents.repository.ts:72` | `findMany` (listado de Documentos) | Array, **incondicional** | **Sí** — `DocumentsPage.tsx`. RBAC-scoped (`employeeAccessWhere`). Mitigado parcialmente por `documentsListCache` (20s, `userScopedCacheKey`) — pero cada cache-miss/expiración sigue pagando el antipatrón. | `GET /documents` sin cambios de shape | **P0/P1** |
| 4 | `salary-categories/salaryCategories.repository.ts:52` | `findMany`, sólo rama `hasActiveFilters` | Array, condicional | **No** — único caller (`salaryCategoryApiService.getAll()` desde `PuestoSalaryRangeTab.tsx`) nunca pasa `family`/`status`/`search`. Mismo patrón exacto que `positions`/`hour-concepts`/`novelty-types` antes de sus etapas. | Sin cambios si se corrige | **P2** |
| 5 | `hour-concepts/hourConceptRules.repository.ts:23` | `findMany` (listado general de reglas, **distinto** de `findByConceptId`/`listByConcept` que sí se usa) | Array, incondicional dentro de sí misma | **No** — confirmado de nuevo hoy (grep): ningún caller de `hourConceptRuleApiService.list()`/`.getAll()` existe en el frontend; sólo `.listByConcept()` (función distinta, sin `$transaction`) se usa. Mismo hallazgo ya documentado en 14H.5, sigue vigente sin cambios. | Sin cambios si se corrige | **P2** |

### 4.3 Remanente adicional en forma callback (mismo antipatrón, forma distinta)

| Archivo:línea | Función | Forma | ¿Caller real? | Nota | Prioridad |
|---|---|---|---|---|---|
| `time-entries/timeEntries.repository.ts:977` | `attendanceSummary` | `prisma.$transaction(async (tx) => { ... Promise.all([tx.workShift.findMany, tx.attendancePunch.findMany]) ... })` — **el callback no contiene ninguna escritura**, sólo 2 lecturas ya envueltas en su propio `Promise.all` interno, pinadas innecesariamente a una transacción | Sí — `AttendancePage.tsx` (resumen de asistencia) | Distinta de `attendanceObservations` (misma clase de módulo, ya corregida en 14G.3) — esta función específica no fue tocada por ninguna etapa de la serie 14G. Mismo costo que la forma array (serializa 2 lecturas independientes sobre una conexión), sólo que expresado con `async (tx) =>` en vez de `[...]`. | **P1** — real, con caller, pero vive en `time-entries.repository.ts` (Gestión horaria/Fichador-adyacente); cualquier cambio ahí requiere el mismo cuidado que cualquier otro cambio a ese módulo (no es el Fichador de reloj en sí — es la pantalla de Asistencia — pero comparte archivo con lógica de Fichador real, revisar con atención antes de tocar) |

### 4.4 Confirmado NO-problema (forma callback / escritura atómica legítima — no tocar)

Revisado explícitamente para no confundir con el antipatrón: `novelties.repository.ts:199` (create), `novelty-types.repository.ts:119` (update + reemplazo de `finnegansLinks`), `org-structure.repository.ts:172,184` (alta/edición de centro de costo), `positions.repository.ts:252,265` (create/update + `salaryCategories`), `workforce-management/workforce.service.ts:104` (`$transaction(map(upsert))` — alta atómica real de N `MonthlyTimeClosure` en un solo lote, necesita atomicidad genuina, **no** es el antipatrón de lecturas), `:127,138` (aprobar/rechazar cierre), `time-entries/timeEntries.repository.ts` (9 ocurrencias callback, todas escrituras multi-paso del Fichador/carga horaria — **no tocar**, fuera de alcance explícito), `employees.repository.ts:1303,1567,1592,1623` (alta/baja/movimiento laboral), `automaticHourConceptBreakdowns.repository.ts:52`, `attendanceInactivity.service.ts:131`. Ninguno de estos 20 usos necesita cambiar.

## 5. Inventario `relationJoins`

**Estado verificado directamente en `backend/prisma/schema.prisma:1-11`**: `previewFeatures = ["relationJoins"]` **habilitado**, permanente desde 14D.7 (14D.6 lo había probado y **revertido**; ambos docs deben leerse en orden para no asumir mal el estado).

**Aplicado hoy en exactamente 5 sitios** (el comentario del propio `schema.prisma:3-9` dice "4 queries puntuales" — desactualizado en 1, ver nota):

| Archivo:línea | Query | Medido en | Mejora medida |
|---|---|---|---|
| `positions/positions.repository.ts:220` | `findOptions` (catálogo `/positions/options`) | 14D.6 | ~85-87% |
| `employees/employees.repository.ts:520` | `findPositionValidationByIdParallel` — `employee.findFirst` | 14D.6 | ~83-84% (función completa) |
| `employees/employees.repository.ts:525` | misma función — `position.findUnique` (hint) | 14D.6 | idem |
| `employees/employees.repository.ts:533` | misma función — `position.findUnique` (fallback si no coincide) | 14D.6 | idem |
| `employees/employees.repository.ts:1184` | `findOverviewDetailsById` — cadena de sector | 14D.6 | ~59-60% (función completa) |

Nota: el comentario de `schema.prisma` cuenta 4 porque agrupa las 3 llamadas de `findPositionValidationByIdParallel` como "1 query lógica" — no es un error funcional, sólo una imprecisión de conteo en el comentario. No se corrige en esta etapa (es un comentario, no afecta comportamiento; se deja documentado acá).

**Probado y explícitamente descartado** (14E.2): `dashboard.service.ts` — 2 `findMany` con relaciones de 1 solo nivel (hermanas, no encadenadas) — 0% de mejora medible, revertido. Confirma la regla: `relationJoins` ayuda a cadenas TO-ONE de 3-4 niveles, no a relaciones planas de 1 nivel.

**Excluidos/diferidos explícitamente por 14D.7 §11** (candidatos nombrados para una etapa futura dedicada, nunca aplicados):
- `GET /positions` **endpoint principal** (`findMany`/`findById`, usa `_count.employees` — combinación `relationLoadStrategy`+`_count` nunca probada, riesgo señalado por la comunidad de Prisma).
- Queries con paginación/offset (`positionsRepository.findMany` con filtros, que además usa `$transaction` — combinación tampoco probada).
- `GET /dashboard/metrics`, `GET /org-structure`, `block-history`, `field-history` — relaciones planas, sin cadena que colapsar.

**Candidatos nuevos evaluados en esta etapa (ninguno recomendado todavía)**: se revisó si algún módulo nunca auditado (`novelties`, `documents`, `users`, `salary-categories`) tiene una cadena de relaciones profunda candidata — **no la tiene ninguno** (`novelties.repository.ts:noveltyInclude` es 2 niveles con relaciones hermanas, `documents.repository.ts:documentListInclude` es 2 niveles, `users`/`salary-categories` no tienen relaciones anidadas en absoluto). No hay ningún candidato nuevo de `relationJoins` fuera de los 2 ya nombrados por 14D.7 (`GET /positions` principal, paginación).

**Riesgos confirmados a respetar en cualquier extensión futura** (14D.6 §6, reafirmados): compatibilidad con `_count` (no probada), compatibilidad con `$transaction` (no probada), relaciones to-many de alta cardinalidad (riesgo teórico de duplicación de filas antes de la reconstrucción del cliente, nunca probado), `where` complejo (no probado), `orderBy` anidado (no probado), paginación por offset (no probada), es un preview feature (no GA, puede cambiar de comportamiento en upgrades de Prisma).

## 6. Inventario caches backend

Verificado leyendo completo cada uno de los 8 archivos `*.cache.ts` + las caches inline en controllers + las 5 caches a nivel repositorio (`listCache`) + los casos aislados (`org-structure` `overviewCache`, `employees` `timeGridCatalogCache`, `auth` `currentUserCache`, `googleDriveStorage.provider.ts` token/folder cache) — **~34 caches backend en total** (corregido tras cruzar con un segundo agente de grep exhaustivo — la primera pasada de esta misma etapa había reportado 22, omitiendo por completo la familia de 6 caches de `employees.controller.ts`, más `auth`/`storage`).

**Nota de diseño transversal (`backend/src/shared/cache/ttlCache.ts`)**: la factory sólo expone `get/set/clear()` — **no hay invalidación por key individual**. Toda "invalidación" real del proyecto es un `.clear()` completo (vacía todas las entradas de todos los usuarios/filtros de esa cache, no sólo la fila mutada). Es correcto desde el punto de vista de seguridad (nunca deja una entrada stale de otro usuario más tiempo del necesario) pero es ineficiente desde el punto de vista de hit-rate: mutar el registro de un usuario invalida también el cache de todos los demás usuarios de esa misma cache. Ninguna de las 34 caches se ve afectada por esto de forma incorrecta — es una característica de diseño consistente, no un bug — pero es un candidato razonable a mencionar si se extrae un helper nuevo en 14I.3 (podría valer la pena soportar invalidación por prefijo/key en esa instancia, no en las 34 existentes).

**Familia adicional encontrada — `employees.controller.ts:11-16`** (6 caches, `createTtlCache`, todas correctamente scopeadas por usuario vía `detailCacheKey`/equivalentes): `employeeDetailCache` (30s), `employeeTimeGridCache` (60s), `employeeListCache` (20s), `employeeSummaryCache` (20s), `employeeOrgChartCache` (20s), `employeeOptionsCache` (30s) — todas invalidadas por `clearEmployeeReadCaches()`, con una lista de call sites muy amplia (creación/edición/contacto/domicilio/transporte/asignaciones/conceptos horarios/movimientos laborales/documentos/historial de campo/historial de bloqueo, más invalidación cruzada desde `hour-concepts` enable/disable, `novelties`, y `workforce.approveCorrection`). Ninguna tiene test de hit/miss real propio — `employees.controller.test.ts` sólo verifica que `clearTimeEntriesReadCaches()` se dispare en los mutadores de desglose, no el comportamiento de estas 6 caches en sí (mismo tipo de gap ya señalado para `documents`/`novelties` en §10).

**Otros 2 casos aislados, nunca antes documentados**:
- `auth/auth.service.ts:35` `currentUserCache` — `Map<userId, {...}>` (TTL `AUTH_USER_CACHE_MS`, default 5s), seguro por construcción (keyed por `id`). Invalidado en logout y en `users.service.ts` create/update/resetPassword. Sin test dedicado (`auth.service.test.ts` no tiene ninguna aserción de cache).
- `shared/storage/googleDriveStorage.provider.ts:17-19` — token OAuth cacheado (expira según `expires_in`, refresh con margen de 60s) + `folderCache`/`folderInflight` (permanentes por proceso, sin invalidación). No son datos de usuario — infraestructura de integración — sin riesgo de leak, pero sin ningún test.

**Corrección de matiz sobre "tests existentes"**: varias caches de `time-entries` que la primera pasada marcó como `hasTest:true` en realidad están **mockeadas** en su test de controller (`timeEntriesListCache`/`timeEntriesSummaryCache`/`timeEntriesPeriodEmployeesCache`/`attendanceSummaryCache` — el test reemplaza `get`/`set` por `vi.fn()` y sólo confirma que se llama, no el comportamiento real de hit/miss/TTL). Sólo `homeSummaryCache` y `attendanceObservationsCache` tienen test de cache real end-to-end en ese módulo. Se corrige esta distinción en la tabla de abajo.

| Cache | Archivo | TTL | Key | ¿Scope usuario? | Invalidación | Test dedicado | Riesgo |
|---|---|---|---|---|---|---|---|
| `dashboardMetricsCache` | `dashboard.cache.ts` | 30s (env-configurable) | global (sin key) | N/A (agregado, mismo para todos) | `clearDashboardMetricsCache()` | Sí | Ninguno |
| `auditListCache` | `audit.cache.ts` | 15s | `req.originalUrl` | **No** — **verificado correcto**: `auditService.list(query)` no recibe `user`, ruta gateada `adminRoles` (dato global, no varía por viewer) | `clearAuditListCache()` en `register()` | No | Bajo (verificado, no un hallazgo) |
| `documentsListCache` | `documents.cache.ts` | 20s | `userScopedCacheKey` (`userId:role:originalUrl`) | **Sí**, correcto — `list(query, user)` usa `employeeAccessWhere` | `clearDocumentsReadCaches()` | **No** (sólo test de servicio, no de cache/repo) | Bajo, pero sin test de aislamiento (§10 P1) |
| `noveltiesListCache` | `novelties.cache.ts` | 15s | `userScopedCacheKey` | **Sí**, correcto | `clearNoveltiesReadCaches()` | **No** (sólo test de servicio) | Bajo, sin test de aislamiento (§10 P1) |
| `shiftTemplatesCache`/`doubleRulesCache` | `workforce.cache.ts` | 30s | global | No (catálogo compartido) | `clear*ReadCache()` en create/update/remove | Sí | Ninguno |
| `notificationsListCache` | `workforce.cache.ts` | 10s | `userScopedCacheKey` | Sí, correcto | Sólo `readNotification` — hueco de invalidación cross-módulo ya documentado (14G.6/14G.9), aceptado, acotado a 10s | Sí (scope) | Deuda ya aceptada, no nueva |
| `closuresCache`/`correctionsCache` | `workforce.cache.ts` | 15s | `userScopedCacheKey` | Sí, correcto | 6 mutadores, conjunto cerrado confirmado (14G.8) | Sí | Ninguno |
| `shiftAlertListCache` | `shiftAlert.cache.ts` | 15s | `userScopedCacheKey` | Sí, correcto | Sólo `resolve` — hueco cross-módulo con Fichador ya documentado (14G.5/14G.9), aceptado | Sí | Deuda ya aceptada, no nueva |
| `shiftAssignmentSummaryCache` | `shiftAssignment.cache.ts` | 30s | `userScopedCacheKey` | Sí, correcto (`employeeAccessWhere`) | 5 mutadores, conjunto cerrado confirmado (14H.3) | Sí | Ninguno |
| `timeEntriesListCache`/`summaryCache`/`periodEmployeesCache`/`attendanceSummaryCache`/`homeSummaryCache`/`attendanceObservationsCache` (6) | `timeEntries.cache.ts` | 10-20s c/u | `userScopedCacheKey` (5) / directa (1) | Sí, correcto en las 6 | `clearTimeEntriesReadCaches()`, ~15 call sites | Sí | Ninguno |
| `positionOptionsCache` | `positions.controller.ts` | 60s | `req.originalUrl` | No — verificado correcto (`listOptions` no recibe `user`) | `.clear()` en create/update/remove | Sí | Ninguno |
| `hourConceptsReadCache` + `listCache` (repo) | `hour-concepts` (controller + repository) | 60s + 2min | `req.originalUrl` / sin key (global) | No — correcto | Ambas se limpian en mutadores | Sí | **Doble capa sobre el mismo recurso** — deuda documentada (14H.5), ver §6.1 |
| `noveltyTypesListCache`/`noveltyTypesDetailCache` + `listCache` (repo) | `novelty-types` (controller + repository) | 60s + 2min | `req.originalUrl`/`id` / global | No — correcto | Ambas se limpian | Sí | **Doble capa** — deuda documentada (14H.8) |
| `documentCategoriesReadCache` + `listCache` (repo) | `document-categories` | 60s + 2min | `req.originalUrl` / global | No — correcto | Ambas se limpian | Sí | **Doble capa** — deuda documentada (14H.6) |
| `auditParametersReadCache` (sin `listCache` repo — endpoint siempre paginado/filtrado) | `audit-parameters` | 60s | `req.originalUrl` | No — correcto | `.clear()` en create/update | Sí | Ninguno — este SÍ es capa única |
| `salaryCategoriesReadCache` + `listCache` (repo) | `salary-categories` | 60s + 2min | `req.originalUrl` / global | No — correcto | Ambas se limpian | **No** (módulo sin ningún test) | **Doble capa nueva, nunca antes documentada** — ver §6.1 |
| `usersListCache`/`usersDetailCache` | `users.controller.ts` | 30s c/u | `req.originalUrl` / `id` | No — verificado correcto (`list(query)` no recibe `user`, ruta `adminRoles`) | `clearUsersReadCache()` en create/update/reset | **No** (módulo sin ningún test) | Bajo, sin test (§10 P1) |
| `overviewCache` | `org-structure.repository.ts` | 60s | global (fetch-all único, sin filtros/paginación) | No — correcto (catálogo compartido) | `invalidateOverviewCache()`, 12 mutadores, conjunto cerrado confirmado (14H.6) | Sí | Ninguno |
| `timeGridCatalogCache` | `employees.repository.ts` | 120s | global | No — correcto (catálogo compartido: `noveltyType`+`hourConcept` activos) | **Ninguna invalidación explícita encontrada** — expira sólo por TTL | No | **Caso aislado, sin invalidación en mutadores de `NoveltyType`/`HourConcept`** — ver §6.1 |

### 6.1 Caches duplicadas/inconsistentes — hallazgo consolidado

No son "4 patrones" como dice `PERFORMANCE_STANDARDS.md` §15 en sentido literal — son **2 formas** replicadas de manera inconsistente:

1. **Forma A — `createTtlCache` (factory compartida, extraída)**: usada en 8 archivos `.cache.ts` + 7 controllers inline. Consistente, testeada, el patrón "correcto" del proyecto.
2. **Forma B — `listCache` a nivel repositorio (`let listCache: {data, expiresAt} | null`, nunca extraída a un helper)**: copiada a mano, idéntica, en **5 módulos**: `positions`, `hour-concepts`, `novelty-types`, `document-categories`, `salary-categories`. Funciona bien en los 5 (invalidación verificada en cada uno), pero es código duplicado literal — candidato real a extraer a `backend/src/shared/cache/listCache.ts` (mismo espíritu que `createTtlCache`/`runInBatches`).
3. **Apilamiento de A+B sobre el mismo recurso** en 3 de esos 5 módulos (`hour-concepts`, `novelty-types`, `salary-categories`) — funciona (sin bug), pero es la deuda arquitectónica repetida 3 veces documentada en 14H.5/14H.6/14H.8, nunca consolidada a propósito ("sería un refactor sin un bug detrás que lo justifique").
4. **`timeGridCatalogCache` (`employees.repository.ts`)** — variante C, un one-off que reinventa la Forma B sin ni siquiera extraer `hasActiveFilters`/paginación (es sólo un fetch-all cacheado). Único caso de las 22 caches **sin ninguna invalidación explícita** — si se crea/edita/desactiva un `NoveltyType` o `HourConcept`, el catálogo embebido en `GET /employees/:id/time-grid` puede quedar desactualizado hasta 120s. No es un bug de seguridad (no hay leak entre usuarios, el dato es un catálogo compartido) — es una ventana de staleness no acotada por ningún mutador, sólo por el TTL. **Candidato real** a que `noveltyTypes.service.ts`/`hourConcepts.service.ts` invaliden este cache en sus `create`/`update`, o a documentar explícitamente por qué no hace falta (mismo criterio que "conjunto cerrado" de 14G.8).

### 6.2 Corrección a `docs/PERFORMANCE_STANDARDS.md` (documentación desactualizada, error objetivo)

- **§17** dice: *"Sin cache, deliberado... queda sin cachear ni en frontend ni en backend, **igual que `closures()` en 9C**."* — Falso hoy: `closuresCache` existe desde 14G.8 (`workforce.cache.ts:60-61`), y `notificationsListCache` existe desde 14G.6 (`workforce.cache.ts:37`). Ambas afirmaciones de §17 quedaron desactualizadas cuando esas 2 etapas agregaron cache (con TTL corto, aceptando el hueco de invalidación como riesgo documentado — no es que "no se cacheó", es que se cacheó con mitigación explícita).
- **§15** ("4 patrones de cache backend distintos") — impreciso: son 2 formas (ver §6.1), no 4; y omite el caso nuevo de `salary-categories` (nunca auditado hasta hoy).

No se corrigió el archivo en esta etapa (Parte 5 permite "actualizar documentación si se encuentra error objetivo" — se deja como recomendación explícita para no mezclar el diagnóstico con una edición en el mismo commit; ver §18).

## 7. Inventario de endpoints críticos sin cache backend

Cruzando los journeys 14D.1/14G.1/14H.1 con el inventario de §6:

| Endpoint | Medido en journey | Cache frontend | Cache backend | ¿Es problema real? | Prioridad |
|---|---|---|---|---|---|
| `GET /workforce/shift-templates` | 14G.1/14H.1, sin cache frontend | No (`apiCache:false`) | Sí, 30s | Gap real es frontend, no backend — ya documentado (14H.1/14H.3) | P2 (frontend, fuera de este diagnóstico backend) |
| `GET /workforce/double-hour-rules` | idem | No | Sí, 30s | idem | P2 (frontend) |
| `GET /org-structure` | recurrente en todos los journeys | Sí, 10min | Sí, 60s | No — doble cache funcionando | Ninguna |
| `GET /users` | nunca medido por ningún journey (fuera del alcance de 14D/14G/14H) | Desconocido, no auditado | **Sí ya tiene** (`usersListCache`, 30s) — pero paga el `$transaction` en cada miss | El `$transaction` es el problema real, no la ausencia de cache | Ver §4.2 #2 |
| `GET /novelties` | nunca medido por ningún journey (Novedades fuera de alcance de 14G, confirmado en 14G.9 §6) | `noveltiesCatalog`/similar (no confirmado en este diagnóstico — fuera de alcance frontend) | **Sí ya tiene** (`noveltiesListCache`, 15s) | El `$transaction` es el problema real | Ver §4.2 #1 |
| `GET /employees/:id/time-grid` (catálogo embebido) | duplicado x3 detectado en 14G.9, nunca corregido (Legajos fuera de alcance de 14G) | No auditado en este diagnóstico | Sí (`timeGridCatalogCache`, 120s, sin invalidación — §6.1) | Sí — duplicado StrictMode confirmado y documentado como candidato "limpio para 14H" en 14G.9, nunca tomado por ninguna etapa 14H (14H se enfocó en Configuración/Puestos, no en Legajos) | **P1** (candidato real, con evidencia de journey, nunca cerrado) |

No se encontró ningún endpoint verdaderamente crítico (alto tráfico, medido lento) que hoy no tenga ninguna cache backend en absoluto — el estado real del proyecto es mejor de lo que el propio `PERFORMANCE_STANDARDS.md` §15 sugiere (ver corrección en §6.2).

## 8. Inventario de over-fetching

| Hallazgo | Archivo:función | Estado | Prioridad |
|---|---|---|---|
| `startPunch`/`endPunch` completos en observaciones de asistencia | `timeEntries.repository.ts::attendanceObservations` | Documentado 14G.3, no corregido (cambiaría el shape) | P2 (requiere autorización de contrato) |
| `include: {hourConcept: true}` completo (2 lugares) | `timeEntries.repository.ts::findMany` (Bandeja) y `workforce.service.ts::corrections` | Documentado 14G.7/14G.8, no corregido | P2 (requiere autorización de contrato) |
| `getTimeGridCatalogs()` trae `finnegansLinks`/rules completos aunque el grid sólo necesita id/nombre | `employees.repository.ts:711-735` | **Nuevo, no documentado antes** — bajo impacto real (catálogo pequeño, ver 14H.8 §6/§16), pero es el mismo patrón que si estuviera en `novelty-types`/`hour-concepts` propios | P2 (bajo impacto, no justifica tocar `employees`) |
| `GET /positions` endpoint principal (`positionInclude` con `_count`) | `positions.repository.ts::findMany`/`findById` | Ya diagnosticado por 14D.4 (Puestos sí necesita esos campos) y por 14D.7 (bloqueado para `relationJoins` por el `_count`) — no es sobre-fetch real, es el shape correcto para su consumidor | No aplica (falso positivo descartado con evidencia) |
| `employeeOrgChartSelect` (cadena de 4 niveles `sector→area→establishment→businessUnit`) usada por `findOrgChart`, que es un **listado**, no un detalle | `employees.repository.ts:755-783` | **Nuevo, no documentado antes** — mismo patrón que hizo lento a `GET /positions` antes de 14D.4 (cadena profunda repetida por fila de un listado), pero en Legajos, nunca auditado desde ese ángulo | **P1** — requiere autorización explícita para tocar `employees` (Legajos), pero es el hallazgo de over-fetch de mayor impacto potencial de todo este diagnóstico |
| `timeEntryInclude` (3 niveles, `timeSegment→specialHourRuleApplications→doubleHourRule`) reusada idéntica entre `findMany` (listado) y `findById` (detalle) | `time-entries/timeEntries.repository.ts:26-36`, usada en línea 501 (`findMany`) y 961 (`findById`) | **Nuevo, no documentado antes** — candidato a confirmar contra qué columnas realmente pinta la tabla de listado antes de recortar | P2 (requiere confirmar consumidor frontend antes de decidir; cambiaría shape si se recorta) |
| `noveltyInclude.noveltyType.finnegansLinks` fetcheado también en `approve`/`reject`/`remove`, que sólo leen `approvalRoles`/`setsWorkedHoursToZero`/`exportsToFinnegans`/`employee.legajo` | `novelties/novelties.repository.ts:6-31`, cruzado contra `novelties.service.ts:142-210` | **Nuevo, no documentado antes** — mismo `include` que el listado se reusa en 3 mutaciones que nunca leen `finnegansLinks` | P2 (bajo impacto individual, pero se paga en cada aprobar/rechazar/eliminar) |
| Módulos sin over-fetch confirmado (verificado, no supuesto) | `work-regimes`, `holiday-work`, `hour-concepts` (empleados/reglas), `document-categories`, `audit-parameters`, `novelty-types`, `documents` (`findById` sí necesita su `include` completo, verificado contra `download()`), `users`, `salary-categories`, `org-structure`, `workforce-management`, `shifts` (alert/assignment) | Todos usan `select` explícito, 1-2 niveles, sin relación pesada de más | Ninguna acción |

## 9. Hallazgos por módulo (resumen)

| Módulo | `$transaction` | Cache | Over-fetch | Tests | Estado |
|---|---|---|---|---|---|
| `novelties` | 1 remanente, P0 | Correcta, sin test de aislamiento | Ninguno | Sólo servicio | **Nunca auditado por ninguna etapa 14G/14H** |
| `users` | 1 remanente, P0 | Correcta, sin test | Ninguno | **Ninguno** | **Nunca auditado** |
| `documents` | 1 remanente, P0/P1 | Correcta, sin test de aislamiento | Ninguno | Sólo servicio | Nunca auditado |
| `salary-categories` | 1 remanente (condicional), P2 | Doble capa nueva, sin test | Ninguno | **Ninguno** | **Nunca auditado** |
| `hour-concepts` | 1 remanente confirmado (`hourConceptRules`, sin caller), P2 | Doble capa documentada | Ninguno | Sí | Auditado 14H.5 |
| `positions` | Ninguno (ya corregido 14H.7) | Sana | Ninguno nuevo | Sí | Auditado 14H.7 |
| `novelty-types` | Ninguno (ya corregido 14H.8) | Doble capa documentada | Ninguno | Sí | Auditado 14H.8 |
| `document-categories`/`audit-parameters` | Ninguno | Doble capa (doc-cat) / capa única (audit-param) | Ninguno | Sí | Auditado 14H.6 |
| `work-regimes` | Ninguno | Sana | Ninguno | Sí | Auditado 14H.2 |
| `shifts` (alert/assignment/holiday) | Ninguno | Sana, 2 huecos de invalidación cross-módulo ya aceptados | Ninguno | Sí | Auditado 14G.5/14H.3/14H.4 |
| `workforce-management` | Ninguno | Sana, 1 hueco de invalidación aceptado | Ninguno | Sí | Auditado 14G.6/14G.8 |
| `time-entries` | Ninguno remanente | Sana (6 caches) | 2 documentados, no corregidos | Sí | Auditado 14G.2/14G.3/14G.7 |
| `employees` | Ninguno remanente | 7 caches (6 en `employees.controller.ts` + `timeGridCatalogCache` en repo) — 1 sin invalidación, 6 sin test de hit/miss propio | 2, uno de alto impacto potencial (`employeeOrgChartSelect` en listado) | Sí (servicio), no en las 6 caches de controller | Auditado 14C/14D, gaps nuevos en §6/§8 tras cruce con segundo agente |
| `org-structure` | Ninguno (nunca tuvo) | Sana | Ninguno | Sí | Auditado 14H.6 |
| `dashboard` | Ninguno | Sana | Ninguno | Sí | Auditado 14E.1/14E.2 |
| `audit` | Ninguno | Sana (verificado sin scope necesario) | Ninguno | No auditado en este diagnóstico | Nunca auditado, sin hallazgos |
| `pending`, `finnegans-export`, `storage`, `auth`, `health` | Ninguno encontrado | Sin cache (no crítico) / export ya documentado como excepción de diseño | Ninguno | No auditado en este diagnóstico | Bajo riesgo, sin hallazgos que ameriten priorizar |

## 10. Priorización P0/P1/P2/P3

**P0 — alto impacto / bajo riesgo (candidatos directos para 14I.4):**
1. `novelties.repository.ts:166` `findMany` — `$transaction([...])` → `Promise.all([...])`. Caller real siempre ejercitado, RBAC sin cambios, contrato sin cambios, mismo patrón aplicado 15 veces antes.
2. `users.repository.ts:41` `findMany` — idem.
3. `documents.repository.ts:72` `findMany` — idem (mitigado parcialmente por cache, pero el fix es igual de trivial y de menor riesgo que dejarlo).

**P1 — impacto medio / bajo riesgo (requieren tests nuevos, sin caller ambiguo):**
4. `timeEntries.repository.ts:977` `attendanceSummary` — `$transaction(async (tx) => {...})` sin ninguna escritura adentro, misma clase de antipatrón que la forma array. Caller real (`AttendancePage.tsx`). Requiere el mismo cuidado que cualquier cambio a `time-entries`.
5. `employeeOrgChartSelect` (`employees.repository.ts:755-783`) — cadena de 4 niveles repetida por fila en el listado `findOrgChart`, nunca auditada desde este ángulo. El hallazgo de over-fetch de mayor impacto potencial de este diagnóstico, pero vive en Legajos (requiere autorización explícita).
6. `timeGridCatalogCache` (`employees.repository.ts`) sin invalidación — agregar invalidación desde `noveltyTypesService.create/update` y `hourConceptsService.create/update` (o documentar explícitamente por qué no hace falta, si el volumen lo justifica).
7. Duplicado StrictMode de `GET /employees/:id/time-grid` (x3) y `GET /novelties` (x2) al abrir edición de horas de un empleado — candidato "limpio" ya nombrado por 14G.9, nunca tomado.
8. Tests de aislamiento de cache faltantes en `documentsListCache`/`noveltiesListCache` y en las 6 caches de `employees.controller.ts` (todas correctas por lectura de código, ninguna con test de hit/miss real propio).
9. Extraer la Forma B (`listCache` repositorio) a un helper compartido (`backend/src/shared/cache/listCache.ts`) — 5 copias idénticas hoy.

**P2 — deuda documentada, sin caller actual (documentar, no tocar todavía):**
10. `salaryCategories.repository.ts:52` `$transaction` en rama filtrada — sin caller real.
11. `hourConceptRules.repository.ts:23` `$transaction` — sin caller real, confirmado sin cambios desde 14H.5.
12. Doble capa de cache en `hour-concepts`/`novelty-types`/`document-categories`/`salary-categories` — consolidar sólo si aparece un bug real.
13. Over-fetch de `startPunch`/`endPunch` y `hourConcept` completo en `time-entries`/`workforce.service.ts`; `timeEntryInclude` reusada entre listado/detalle; `noveltyInclude.finnegansLinks` fetcheado sin usar en `approve`/`reject`/`remove` de Novedades — todos requieren autorización de cambio de contrato o confirmación de consumidor frontend antes de recortar.
14. Corrección de `PERFORMANCE_STANDARDS.md` §15/§17 (documentación desactualizada).
15. Módulos `users`/`salary-categories` sin ningún test — agregar cobertura mínima antes o junto con cualquier fix.
16. `ttlCache.ts` sin invalidación por key individual (sólo `.clear()` completo) — característica de diseño consistente, no un bug; mencionar sólo si se extrae un helper nuevo en 14I.3.

**P3 — no tocar (riesgo alto o fuera de alcance explícito):**
17. Fichador (`clockInResolved`/`clockOutResolved`/`expireOpenWorkShifts` sin auditoría, `linkClockPunchThumbnail` y demás `$transaction` interactivos del módulo `time-entries`) — deuda ya documentada (9G/`PERFORMANCE_STANDARDS.md` §10), requiere etapa dedicada y autorizada explícitamente al Fichador.
18. Hueco de invalidación de `shiftAlertListCache` (requiere tocar `workShiftEvaluationRunner.ts`/`clockPunchMaintenance.ts`, ambos Fichador-adyacentes).
19. Hueco de invalidación de `notificationsListCache` (5+ módulos generadores, conjunto no cerrado).
20. `relationJoins` en `GET /positions` principal (bloqueado por `_count`, riesgo no probado) o en queries paginadas/`$transaction` — requiere su propia etapa de diagnóstico dedicada, nunca "extender silenciosamente" (mandato explícito de 14D.7 §11).
21. Paginación real de `GET /workforce/closures` y filtro server-side de `GET /workforce/corrections` — cambia contrato (`{data}`→`{data,meta}`), requiere autorización explícita de producto.
22. `MonthlyClosuresPage` paginación — decisión de producto pendiente (9E/9G), no mecánica.

## 11. Candidatos recomendados para 14I.2 — relationJoins quirúrgico

**No se recomienda una etapa de `relationJoins` amplia.** El único candidato con evidencia real y nombrado explícitamente por 14D.7 es:

- **Objetivo**: evaluar `relationLoadStrategy: "join"` en `GET /positions` (endpoint principal, `positionInclude` con `_count.employees`) de forma aislada del `_count`, o confirmando primero si la combinación es segura en la versión de Prisma actual.
- **Alcance**: sólo `positions.repository.ts::findMany`/`findById`, con benchmark aislado (script temporal, no commiteado) antes de tocar código real — mismo protocolo que 14D.6.
- **Riesgo**: medio — combinación nunca probada en este proyecto; requiere medir explícitamente si `_count` sigue siendo correcto (no sólo rápido).
- **Validación**: benchmark con datos reales de staging + `npm test` completo + comparación de shape byte-a-byte, igual que 14D.6/14D.7.
- **¿Feature flag?**: no necesario — mismo patrón de rollback trivial ya usado (quitar la opción, `prisma generate`, sin migración).
- **¿Journey nuevo?**: no, `perf:journey:admin-config` ya mide `GET /positions` en la zona L.

No hay más candidatos con evidencia suficiente — no proponer relationJoins en `novelties`/`documents`/`users`/`salary-categories` (relaciones planas, sin cadena que colapsar, confirmado en §5).

## 12. Candidatos recomendados para 14I.3 — consolidación de patrón de cache backend

- **Objetivo**: extraer la Forma B (`listCache` de repositorio) a un helper compartido en `backend/src/shared/cache/`, análogo a `ttlCache.ts`/`runInBatches.ts`, sin cambiar el comportamiento de ninguno de los 5 módulos que ya lo usan.
- **Alcance**: `positions`, `hour-concepts`, `novelty-types`, `document-categories`, `salary-categories` — reemplazar el `let listCache`/`hasActiveFilters` copiado por una llamada al helper nuevo. Cero cambios de contrato, cero cambios de TTL.
- **Alcance opcional, separado**: agregar invalidación a `timeGridCatalogCache` (`employees.repository.ts`) desde los mutadores de `NoveltyType`/`HourConcept` — módulo `employees`, requiere justificar explícitamente por ser Legajos (dependencia directa inevitable, ya que el cache vive en `employees.repository.ts`).
- **Beneficios**: elimina 5 copias del mismo código; una sola implementación para testear/mantener.
- **Riesgos**: bajo si se hace con tests de regresión por módulo antes/después (mismos tests ya existentes en 4 de los 5 deben seguir pasando sin cambios).
- **Validaciones**: `npm test` completo backend, sin cambios de comportamiento esperados (mismos TTL, misma lógica de filtrado).
- **¿Feature flag?**: no necesario, es un refactor mecánico sin cambio de comportamiento.
- **¿Journey nuevo?**: no.

## 13. Candidatos recomendados para 14I.4 — limpieza de `$transaction` restantes

- **Objetivo**: aplicar el fix `$transaction([...])`/`$transaction(async (tx) => {...})` → `Promise.all([...])` a los 3 candidatos P0 de §10 (`novelties`, `users`, `documents`), exactamente el mismo patrón mecánico ya aplicado 15 veces. `timeEntries.repository.ts::attendanceSummary` (§4.3) puede sumarse a la misma etapa si se decide tocar `time-entries` con el cuidado correspondiente, o dejarse para una 14I.4.1 separada si se prefiere no mezclar módulos con distinto nivel de sensibilidad.
- **Alcance**: 3-4 archivos de repositorio, sus tests correspondientes (agregar tests dedicados de repositorio en `users`/`salary-categories`, que hoy no tienen ninguno — mínimo viable: el mismo test que ya existe en `positions.repository.test.ts`/`auditParameters.repository.test.ts` para confirmar `$transaction` no se llama).
- **Beneficios**: mismo tipo de mejora ya medida en 14H (30-88% según el caso, dominado por la profundidad de la cadena de relaciones involucrada — `novelties`/`documents` tienen `include` de 2 niveles, mejora esperada moderada, no del orden de Puestos).
- **Riesgos**: mínimos — mismo patrón ya validado 15 veces sin ninguna regresión.
- **Validaciones**: `npx prisma validate`, `npm run typecheck`, `npm test`, `npm run build` (backend); no requiere tocar frontend ni journeys existentes salvo medir el efecto si se decide (Novedades/Usuarios/Documentos no están cubiertos por ningún journey activo hoy — sería necesario decidir si vale la pena crear uno, o medir manualmente).
- **¿Feature flag?**: no necesario.
- **¿Journey nuevo?**: **si se quiere medir el efecto real**, ninguno de los 3 módulos (`novelties`, `users`, `documents`) está cubierto por `perf:journey:admin-config`/`workforce`/`employees` — habría que decidir si se justifica un journey nuevo o si el fix se aplica sin medición de journey (mismo criterio que `salaryCategories`/`hourConceptRules`: fix correcto documentado sin caller de journey que lo mida).

## 14. Qué NO se recomienda tocar

- Fichador y todo lo `$transaction`-interactivo de `time-entries` (escrituras atómicas legítimas) — fuera de alcance explícito, requiere etapa dedicada autorizada.
- `relationJoins` en cualquier query paginada, con `$transaction`, o con relaciones to-many de alta cardinalidad — riesgo no probado, prohibido "extender silenciosamente" por mandato de 14D.7.
- Consolidación de cache que toque TTL o comportamiento observable — sólo refactor mecánico sin cambio de conducta.
- Huecos de invalidación cross-módulo de `shiftAlertListCache`/`notificationsListCache` — requieren tocar Fichador o auditar 5+ módulos generadores, ambos fuera de alcance sin autorización explícita.
- Sobre-fetch de `startPunch`/`endPunch`/`hourConcept` en `time-entries`/`workforce.service.ts` — cambia el shape de la respuesta, prohibido sin autorización.
- Paginación real de `closures`/filtro server-side de `corrections` — cambia contrato, decisión de producto.
- Cualquier migración de Prisma o cambio de schema.

## 15. Riesgos

- Los 3 candidatos P0 de §13 no tienen ningún journey que los mida hoy — el "antes/después" de una futura 14I.4 tendrá que ser sin comparación automatizada de journey, o requerirá crear uno nuevo (decisión a tomar en esa etapa, no en ésta).
- `users`/`salary-categories` no tienen ningún test hoy — cualquier cambio ahí debe venir acompañado de cobertura mínima nueva, no sólo el fix.
- La consolidación de cache (14I.3) toca 5 módulos a la vez — mayor superficie que las etapas quirúrgicas de un solo módulo de la serie 14H; conviene hacerla en sub-etapas (una por módulo) si se prioriza.
- El hallazgo de `timeGridCatalogCache` sin invalidación vive en `employees.repository.ts` (Legajos) — cualquier fix ahí, aunque sea sólo agregar una invalidación, técnicamente "toca Legajos"; requiere la misma autorización explícita que cualquier cambio a ese módulo.

## 16. Validaciones necesarias para futuras etapas

Para 14I.2 (relationJoins): benchmark aislado con datos reales + `npm test` + comparación de shape + los 3 journeys (`admin-config`/`workforce`/`employees`) en verde.

Para 14I.3 (consolidación de cache): `npm test` completo backend (los tests existentes de los 5 módulos no deben cambiar de comportamiento) + tests nuevos del helper extraído + `npm run build`.

Para 14I.4 (`$transaction` restantes): `npx prisma validate`, `npm run typecheck`, `npm test`, `npm run build` (backend) — tests nuevos de repositorio en `users`/`salary-categories` (módulos sin ninguno hoy) antes de tocarlos.

General para cualquier etapa siguiente: `git diff --check`, `git status --short`, `git diff --stat`, sin commitear hasta revisión final — mismo protocolo que toda la serie.

## 17. Conclusión

El backend de este proyecto está en mejor estado del que su propia documentación sugiere: `docs/PERFORMANCE_STANDARDS.md` §15/§17 describe una situación (notificaciones y `closures()` sin cache) que 2 etapas posteriores (14G.6, 14G.8) ya corrigieron sin actualizar el documento — un hallazgo de "deuda documental", no de código. El patrón `$transaction`→`Promise.all` (array o callback), aplicado ya 15 veces con éxito, tiene sólo 3 instancias P0 restantes (todas triviales, mismo fix mecánico, sin riesgo de contrato), 1 instancia P1 en forma callback (`attendanceSummary`) y 2 instancias P2 correctamente dejadas sin tocar por falta de caller real, replicando el criterio ya establecido en 14H.5. `relationJoins` está en un estado maduro y quirúrgico, con exactamente 1 candidato adicional razonable (`GET /positions` principal) y una lista explícita de exclusiones que debe respetarse — aunque este diagnóstico también identificó, sin recomendarlo todavía, que `employeeOrgChartSelect` (Legajos) reusa una cadena de 4 niveles en un listado, el mismo tipo de patrón que sí justificó una etapa dedicada para Puestos. La cache backend es consistentemente segura (0 leaks de usuario/rol encontrados en ~34 caches auditadas tras cruzar 2 pasadas independientes) — el problema real es duplicación de código (Forma B copiada 5 veces) y cobertura de test desigual (6 caches de `employees` y 2 módulos completos sin ningún test), no un riesgo de seguridad.

## 18. Recomendación final

Orden sugerido, por relación impacto/riesgo:

1. **14I.4 primero** (limpieza de `$transaction` P0: `novelties`, `users`, `documents`) — el fix más barato, más probado, con evidencia más sólida.
2. **Actualizar `PERFORMANCE_STANDARDS.md` §15/§17** como parte de esa misma etapa o una etapa de documentación separada (0 riesgo, error objetivo confirmado).
3. **14I.3** (consolidar la Forma B de cache) — beneficio de mantenibilidad, no de performance medible; hacerlo cuando haya disponibilidad para una etapa "de limpieza" sin presión de journey.
4. **14I.2** (relationJoins en `GET /positions` principal) — el único con riesgo técnico real (combinación con `_count` nunca probada); requiere su propio benchmark dedicado antes de decidir si vale la pena.
5. Los ítems P1 sueltos (invalidación de `timeGridCatalogCache`, tests de aislamiento en `documents`/`novelties`, duplicado StrictMode de `time-grid`) pueden absorberse en cualquiera de las etapas anteriores si tocan el mismo archivo, o quedar como una 14I.5 liviana si se prefiere aislarlos.

No se propone relationJoins masivo. No se propone refactor masivo de caches sin pruebas. No se toca Fichador. Todo lo anterior queda documentado, priorizado y con evidencia — listo para que 14I.2 en adelante decida por dónde empezar.
