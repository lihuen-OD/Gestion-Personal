# Etapa 14I.12 — Cierre documental de la serie 14I (infraestructura backend/performance)

Etapa **docs/json only**. Cero cambios de código productivo, cero cambios de test, cero cambios de frontend/backend. El único propósito de esta etapa es consolidar en un solo documento lo que hicieron las 11 etapas anteriores de la serie (14I.1 a 14I.11) y dejar la serie lista para cierre.

## 1. Resumen ejecutivo

14I empezó como un diagnóstico transversal de infraestructura backend (14I.1, commit `3abb3c4`) después de cerrar las series 14G (Gestión horaria) y 14H (Configuración + Puestos). El diagnóstico mapeó 3 familias de deuda: `$transaction` sobre lecturas independientes que sobrevivían al patrón ya aplicado 15 veces en 14C/14G/14H, duplicación literal de un patrón de cache de repositorio ("Forma B") en 5 módulos, y una lista de candidatos de over-fetch/cache nunca auditados desde ese ángulo (`employeeOrgChartSelect`, `timeGridCatalogCache`, doble capa controller+repository).

A partir de ahí, la serie se movió en el orden de impacto/riesgo que el propio 14I.1 recomendó:

- **Se cerraron 3 transacciones `$transaction` P0** en lecturas siempre ejecutadas y sin ningún riesgo de contrato (`novelties`, `users`, `documents` — 14I.2), y una cuarta P1 en forma callback (`attendanceSummary` de `time-entries` — 14I.4).
- **Se consolidó la cache duplicada de 5 repositorios** ("Forma B") en un helper compartido nuevo, `backend/src/shared/cache/repositoryListCache.ts` (14I.3), sin cambiar ningún comportamiento observable.
- **Se fortaleció la cobertura de test de infraestructura de cache**: 49 tests de aislamiento/hit-miss/invalidación (14I.6) + 27 tests del helper base `ttlCache.ts` y de los 2 módulos que no tenían ningún test (`users`/`salary-categories`, 14I.7) + 26 tests de la doble capa de cache de catálogos (14I.10).
- **Se investigaron 3 candidatos de over-fetch/cache sin tocarlos a ciegas**: `employeeOrgChartSelect` (14I.5) y la doble capa controller+repository (14I.10) se diagnosticaron con evidencia medida y se decidió explícitamente no tocarlos porque el diagnóstico mostró uso real/valor real. `timeGridCatalogCache` (14I.8, revisitado en 14I.11) se diagnosticó dos veces y quedó documentado como deuda de prioridad baja, sin consumidor real.
- **Se corrigieron 2 bugs reales, ninguno estaba en el inventario original de 14I.1**, ambos encontrados como hallazgo colateral de un diagnóstico que sí estaba planeado:
  - `includeDetails=false` se coercionaba a `true` por `z.coerce.boolean()` aplicando `Boolean("false")` (que en JS es `true`) — encontrado en 14I.8, corregido en 14I.9.
  - El duplicado x3 de `GET /employees/:id/time-grid` (nombrado desde 14G.9, nunca cerrado) tenía una causa raíz independiente del bug anterior: un guard `useRef(false)` de "primera ejecución" que no sobrevivía el doble-invoke de `StrictMode` — encontrado y corregido en 14I.11 (x3→x2; el x2 remanente es artefacto de desarrollo sin costo en producción).
- **Se decidió no tocar** los 2 `$transaction` P2 sin caller real (`salaryCategories`, `hourConceptRules`), siguiendo el mismo criterio ya establecido desde 14H.5 ("sólo se corrige lo que tiene un caller real, verificado por grep").

El backend terminó la serie con **1419 tests** (98 archivos, +154 desde el arranque de 14I.2) y el frontend con **802/802** (81 archivos, +1 desde 14I.11) — todo el crecimiento es cobertura nueva sobre comportamiento preexistente o corrección de los 2 bugs reales, sin ningún cambio de contrato, RBAC, schema de Prisma o lógica de negocio de Fichador/Gestión Horaria/Conceptos Horarios/Horas Especiales.

## 2. Línea de tiempo de commits

| Etapa | Commit | Mensaje | Tipo | Impacto | Código productivo |
|---|---|---|---|---|---|
| 14I.1 | `3abb3c4` | docs(performance): diagnosticar infraestructura backend | docs | Diagnóstico transversal — 6 `$transaction` remanentes, ~34 caches auditadas (0 leaks), Forma B duplicada en 5 módulos, 3 candidatos over-fetch/cache nuevos, desactualización objetiva de `PERFORMANCE_STANDARDS.md` §15/§17 | No |
| 14I.2 | `709b633` | perf(backend): limpiar transacciones p0 | perf | 3 `$transaction([findMany,count])` → `Promise.all` (`novelties`, `users`, `documents`); +12 tests de repositorio | Sí (backend) |
| 14I.3 | `66c84f4` | refactor(backend): consolidar cache de repositorios | refactor | Helper `repositoryListCache.ts` nuevo; 5 repositorios migrados (`positions`, `hour-concepts`, `novelty-types`, `document-categories`, `salary-categories`); +24 tests | Sí (backend) |
| 14I.4 | `e942feb` | perf(time-entries): quitar transaccion read-only de asistencia | perf | `attendanceSummary` deja de envolver 2 lecturas en `$transaction(async (tx)=>{...})`; +5 tests | Sí (backend) |
| 14I.5 | `4554558` | docs(performance): diagnosticar organigrama de empleados | docs | Diagnóstico de `employeeOrgChartSelect` — medido con datos reales, decisión explícita de no tocar; +1 test de regresión (fija el `select`) | No (sólo test de fijación, sin cambio de comportamiento) |
| 14I.6 | `c04c718` | test(backend): cubrir aislamiento de caches | test | +49 tests de hit/miss/aislamiento/invalidación en 12 caches (`employees` ×6, `documents`, `novelties`, `time-entries` ×4) | No |
| 14I.7 | `75775ab` | test(backend): cubrir caches restantes | test | +27 tests: helper base `ttlCache.ts` (10) + `users`/`salary-categories` (los 2 únicos módulos sin ningún test de controller) | No |
| 14I.8 | `6810a7b` | docs(performance): diagnosticar cache de grilla horaria | docs | Diagnóstico de `timeGridCatalogCache` (sin invalidación) — y hallazgo colateral real: bug de coerción de `includeDetails=false` | No |
| 14I.9 | `9299440` | fix(employees): parsear includeDetails=false correctamente | fix | `employees.schemas.ts` — `z.preprocess` corrige la coerción de `includeDetails`; +10 tests | Sí (backend) |
| 14I.10 | `266169e` | test(backend): diagnosticar doble cache de catalogos | test | Diagnóstico de la doble capa controller+repository en 4 módulos — decisión explícita de no consolidar, con evidencia nueva; +26 tests | No |
| 14I.11 | `7e6735c` | fix(frontend): evitar refetch extra de grilla horaria | fix | `EmployeeHoursPage.tsx` — guard de re-sincronización corregido (x3→x2 bajo StrictMode); +1 test | Sí (frontend) |

Los 12 hashes de esta tabla fueron verificados 1:1 contra `git log --oneline` del repositorio antes de escribir este documento — coinciden exactamente con el orden, hash y mensaje de commit provistos por el usuario, sin ninguna discrepancia.

## 3. Inventario inicial de 14I.1 vs. estado final

| Hallazgo | Prioridad original | Acción tomada | Etapa | Estado final |
|---|---|---|---|---|
| `$transaction` P0 en `novelties`/`users`/`documents` | P0 | `Promise.all([findMany, count])`, mismo `where`/`include`/`orderBy` | 14I.2 | **Cerrado** |
| `attendanceSummary` (`time-entries`) P1, forma callback | P1 | Quitado el wrapper `$transaction(async (tx)=>{...})`, mismas 2 lecturas sobre `prisma` global | 14I.4 | **Cerrado** |
| `salaryCategories`/`hourConceptRules` P2, sin caller real | P2 | Documentado, explícitamente no tocado (mismo criterio de 14H.5: "sólo se corrige lo que tiene caller real") | — (ninguna, por diseño) | **Deuda aceptada, sin cambios** |
| Cache "Forma B" duplicada en 5 repositorios (`positions`/`hour-concepts`/`novelty-types`/`document-categories`/`salary-categories`) | Deuda de consistencia arquitectónica | Extraída a `backend/src/shared/cache/repositoryListCache.ts`, 5 módulos migrados 1:1, sin cambio de TTL/comportamiento | 14I.3 | **Cerrado** |
| Caches backend sin test de hit/miss/aislamiento real (`employees` ×6, `documents`, `novelties`, `time-entries` ×4, `ttlCache.ts` base, `users`, `salary-categories`) | P1 (cobertura) | 49 + 27 tests nuevos, sin tocar ningún archivo productivo | 14I.6, 14I.7 | **Cerrado** |
| `employeeOrgChartSelect` (cadena jerárquica de 4 niveles en `findOrgChart`) | P1, mayor over-fetch potencial del diagnóstico | Medido contra datos reales (32 empleados, 1 sola sentencia SQL, 0ms de diferencia de query, 25% de payload sobre 8 sub-campos no usados) — decisión explícita de **no tocar** la cadena en sí; los 8 sub-campos quedan como candidato P3 cosmético | 14I.5 | **Cerrado sin acción (justificado con evidencia)** |
| `timeGridCatalogCache` sin invalidación explícita | P1 | Diagnosticado dos veces (14I.8, revisitado en 14I.11): sin consumidor real hoy — el único caller (`EmployeeHoursPage.tsx`) descarta siempre el dato, y tras el fix de `includeDetails` (14I.9) la función que la poblaría ya ni se ejecuta. **No tocada.** | 14I.8, 14I.11 | **Documentado, deuda de prioridad baja, sin acción** |
| Doble capa controller (`createTtlCache`) + repository (`repositoryListCache`) sobre el mismo recurso en `hour-concepts`/`novelty-types`/`document-categories`/`salary-categories` | Deuda arquitectónica documentada desde 14H.5/14H.6/14H.8 | Diagnosticada con evidencia nueva (test de "2 páginas sin filtros comparten la misma lectura de repositorio") — decisión explícita de **no consolidar**, valor real demostrado; se cerró el gap de test que quedaba | 14I.10 | **Cerrado sin acción (justificado con evidencia)** |
| `includeDetails=false` coercionado a `true` (`z.coerce.boolean()`) | No estaba en el inventario original de 14I.1 — hallazgo colateral de 14I.8 | Corregido con `z.preprocess` mínimo, autorizado explícitamente por el usuario tras el diagnóstico | 14I.8 (hallazgo) → 14I.9 (fix) | **Cerrado** |
| Duplicado x3 de `GET /employees/:id/time-grid` | P1, nombrado desde 14G.9, nunca cerrado por ninguna etapa 14H | Causa raíz real identificada (guard `useRef` que no sobrevive el doble-invoke de `StrictMode`, independiente del bug de `includeDetails`) — corregido, x3→x2 | 14I.11 | **Cerrado parcialmente** — el x2 remanente es artefacto de `StrictMode` (sólo desarrollo), sin costo en producción, documentado como deuda aceptada |

## 4. Cambios de código productivo realizados

### Backend

- **14I.2** — `backend/src/modules/novelties/novelties.repository.ts`, `backend/src/modules/users/users.repository.ts`, `backend/src/modules/documents/documents.repository.ts`: `findMany`, `prisma.$transaction([prisma.X.findMany(...), prisma.X.count(...)])` → `Promise.all([prisma.X.findMany(...), prisma.X.count(...)])`. Mismos `where`/`include`/`select`/`orderBy`/`skip`/`take`, byte a byte.
- **14I.3** — nuevo `backend/src/shared/cache/repositoryListCache.ts` (`createRepositoryListCache<T>(ttlMs)`, API `getOrLoad(loader, now?)`/`clear()`); repositorios de `positions`, `hour-concepts`, `novelty-types`, `document-categories`, `salary-categories` migrados de un `let listCache: {data, expiresAt} | null` a mano al helper nuevo. Mismos TTL (120s los 5), misma condición de cacheo (`hasActiveFilters`/`hasFilters`, sin tocar), mismos nombres de función de invalidación exportados.
- **14I.4** — `backend/src/modules/time-entries/timeEntries.repository.ts::attendanceSummary`: de `return prisma.$transaction(async (tx) => {...})` a `async attendanceSummary(...) { const [...] = await Promise.all([prisma.workShift.findMany(...), prisma.attendancePunch.findMany(...)]); return {...}; }`. Mismo `where`/`select`/`orderBy` en ambas queries.
- **14I.9** — `backend/src/modules/employees/employees.schemas.ts::employeeTimeGridQuerySchema`: `includeDetails: z.coerce.boolean().default(true)` → `includeDetails: z.preprocess((value) => (value === "false" ? false : value), z.coerce.boolean()).default(true)`.

### Frontend

- **14I.11** — `frontend/src/pages/EmployeeHoursPage.tsx`: el efecto de re-sincronización silenciosa post-guardado reemplazó su guard `const skippedFirstRefresh = useRef(false)` ("¿es la primera ejecución?") por `const lastSyncedRefresh = useRef(refresh)` + `if (lastSyncedRefresh.current === refresh) return;` ("¿cambió realmente `refresh` desde la última sincronización?") — mismo comportamiento observable para el caso real (guardar una hora/desglose dispara exactamente 1 fetch), sin el falso positivo bajo `StrictMode`.

### Qué NO cambió (explícito, verificado contra los 12 documentos de la serie)

- **Contratos de API**: ningún método, ruta, query param o shape de respuesta cambió en ningún endpoint tocado (`GET /novelties`, `GET /users`, `GET /documents`, `GET /positions`, `GET /hour-concepts`, `GET /novelty-types`, `GET /document-categories`, `GET /salary-categories`, `GET /time-entries/attendance`, `GET /employees/:id/time-grid`, `GET /employees/org-chart`).
- **RBAC/scope**: ningún middleware, `requireAnyRole`, `employeeAccessWhere` o regla de acceso fue modificada en ninguna etapa.
- **Prisma schema**: cero migraciones, cero cambios a `schema.prisma` en toda la serie 14I.
- **Fichador**: `clockInResolved`, `clockOutResolved`, `closeOpenWorkShift`, `expireOpenWorkShifts` y las demás 9 transacciones interactivas de escritura de `timeEntries.repository.ts` — ninguna tocada, confirmadas explícitamente como fuera de alcance en 14I.1 §4.4 y respetadas en cada etapa siguiente.
- **Cálculos de horas / conceptos horarios / horas especiales**: `buildAdditiveTimeGrid`, `doubleHourRuleMatching`, `automaticHourConceptBreakdowns` — ninguno tocado.
- **`relationJoins`**: sin ningún cambio a `relationLoadStrategy` ni a los 5 sitios donde ya está aplicado desde 14D.6/14D.7; el candidato nombrado por 14I.1 (`GET /positions` principal) nunca se tomó en esta serie.
- **`timeGridCatalogCache`**: sin ninguna línea tocada, ni siquiera para agregar invalidación — decisión explícita, documentada dos veces (14I.8, 14I.11).

## 5. Tests agregados

| Etapa | Tests agregados | Archivo(s) | Qué cubren |
|---|---|---|---|
| 14I.2 | 12 (4+4+4) | `novelties.repository.test.ts`, `users.repository.test.ts`, `documents.repository.test.ts` (los 3 nuevos) | `Promise.all` sin `$transaction`; mismo `where` (incluye `employeeAccessWhere`/filtros de rol); `orderBy`/`include`/`select` sin cambios |
| 14I.3 | 24 (8 helper + 6 hour-concepts + 11 salary-categories, con redondeo de conteo) | `repositoryListCache.test.ts` (nuevo), `hourConcepts.repository.test.ts` (+6), `salaryCategories.repository.test.ts` (nuevo, módulo sin tests previos) | Hit/miss/TTL/`clear()`/instancias independientes del helper; rama cacheada de `hour-concepts` nunca testeada antes; `salaryCategories` cubierto de punta a punta |
| 14I.4 | 5 nuevos + 4 modificados | `timeEntries.repository.test.ts` | Confirma que `attendanceSummary` no llama `$transaction`; preserva `employeeAccessWhere`, rango de fechas y `select` en ambas queries |
| 14I.5 | 1 | `employees.repository.test.ts` | Test de regresión que fija (`toEqual`) el `select` exacto de `findOrgChart`, incluida la cadena de 4 niveles — protege contra un cambio silencioso futuro |
| 14I.6 | 49 (24+5+6+14) | `employees.readCaches.test.ts`, `documents.controller.test.ts`, `novelties.controller.test.ts`, `timeEntries.readCaches.test.ts` (los 4 nuevos) | Hit/miss, aislamiento usuario/rol, variación por query, invalidación en 12 caches (6 de `employees`, `documentsListCache`, `noveltiesListCache`, 4 de `time-entries`) |
| 14I.7 | 27 (10+11+6) | `ttlCache.test.ts` (nuevo), `users.controller.test.ts` (nuevo), `salaryCategories.controller.test.ts` (nuevo) | El helper base `ttlCache.ts` en sí (hit/miss/expiración/`clear`/`maxEntries`); los 2 últimos módulos sin ningún test de controller/cache |
| 14I.9 | 10 (7+3) | `employees.schemas.test.ts` (nuevo), `employees.repository.test.ts` (+3) | `includeDetails: "false"` → `false` real; comportamiento del schema preservado en todos los demás casos; `findTimeGrid` respeta la rama liviana/pesada según el booleano ya correcto |
| 14I.10 | 26 (7+9+6+4×1) | `hourConcepts.readCache.test.ts` (nuevo), `noveltyTypes.controller.test.ts` (nuevo), `documentCategories.controller.test.ts` (nuevo), +1 en cada uno de los 4 `*.repository.test.ts` | Cierra el gap de test de controller-cache en 3 de los 4 módulos con doble capa; evidencia nueva de que 2 páginas sin filtros comparten la misma lectura de repositorio |
| 14I.11 | 1 | `EmployeeHoursPage.test.tsx` | Reproduce el double-invoke de `StrictMode` y fija que el resultado correcto es x2, no x3 (verificado revirtiendo el fix: el test falla sin él) |

Backend: de 1265 tests (antes de 14I.2) a **1419 tests / 98 archivos** al cierre de 14I.10 (+154 tests netos en la serie, 0 tests eliminados o debilitados). Frontend: **802/802 / 81 archivos** al cierre de 14I.11 (+1 test).

## 6. Decisiones de no tocar

- **`employeeOrgChartSelect` no se redujo** porque la cadena jerárquica (`sector→area→establishment→businessUnit`) se usa completa: sus 2 hojas terminales (`establishment.name`, `businessUnit.name`) se muestran directamente en `EmployeeOrgPopover.tsx` y alimentan 2 de los 11 filtros del organigrama — confirmado campo por campo en 14I.5, no supuesto. Sólo 8 sub-campos escalares quedaron identificados como no leídos (impacto medido: 0ms de query, 25% de un payload ya chico), documentados como candidato P3 cosmético para si se toca ese archivo por otro motivo.
- **`timeGridCatalogCache` no se tocó** porque no tiene impacto funcional real: el único caller (`EmployeeHoursPage.tsx`) siempre descartaba el dato embebido incluso antes del fix de `includeDetails` (14I.9), y después de ese fix la función `getTimeGridCatalogs()` que la puebla directamente **deja de ejecutarse** en el flujo real de la aplicación (el caller real ahora manda `includeDetails=false` de verdad). Agregar invalidación a una cache que no tiene consumidor real no se justificó.
- **La doble capa controller+repository no se consolidó** porque 14I.10 demostró, con un test nuevo por módulo, que la cache de repositorio sirve a cualquier `originalUrl` sin filtros activos desde una sola lectura real — un mecanismo que la cache de controller (keyeada por URL exacta) no puede replicar por sí sola. No hay ningún bug ni riesgo de stale que fuerce la consolidación; sería, en palabras del propio 14I.1, "un refactor sin un bug detrás que lo justifique".
- **El x2 remanente de `StrictMode` en `time-grid` no se tocó** porque no tiene costo real en producción: React sólo duplica la invocación de efectos en modo desarrollo, nunca en un build de producción — un usuario real siempre generó (y sigue generando) exactamente 1 llamada desde ese efecto.
- **`salaryCategories`/`hourConceptRules` P2 no se tocaron** porque no tienen caller real que ejercite su rama `$transaction` — mismo criterio ya establecido desde 14H.5 ("sólo se corrige lo que tiene un caller real, verificado por grep"), reafirmado sin excepción en cada etapa de la serie 14I que los revisitó (14I.2, 14I.3, 14I.7).
- **`relationJoins` no se amplió** porque ya fue tratado de forma limitada y quirúrgica desde 14D.6/14D.7 (5 sitios aplicados, con evidencia medida) — el único candidato nuevo con evidencia real (`GET /positions` principal, bloqueado por la combinación no probada con `_count`) requiere su propio benchmark dedicado y no era el siguiente paso seguro dentro de una serie que ya tenía suficiente superficie con `$transaction`/cache/over-fetch.

## 7. Riesgos pendientes / deuda baja

- **`timeGridCatalogCache` sin invalidación explícita** — baja prioridad, reforzada dos veces (14I.8, 14I.11): sin consumidor real hoy, la ventana de staleness (120s) nunca llega a manifestarse en la práctica.
- **x2 remanente de `StrictMode`** en el Effect A de carga inicial de `EmployeeHoursPage.tsx` — sin costo en producción; si se quisiera eliminar también, requeriría una etapa dedicada con dedupe in-flight (p. ej. `cachedData`) y tests explícitos de que un remount legítimo sigue trayendo datos frescos.
- **`salaryCategories.repository.ts` / `hourConceptRules.repository.ts`** siguen con su `$transaction` P2 en la rama filtrada, sin caller real — corregir sólo si aparece un caller real en el futuro.
- **Normalización cosmética futura**: `clearUsersReadCache()` y el `.clear()` inline de `salaryCategoriesReadCache` siguen sin exportarse como función nombrada, a diferencia de `employees`/`documents`/`novelties`/`time-entries` (que sí exportan la suya) — asimetría de diseño sin impacto funcional, nombrada como candidato en 14I.7 §14, no aplicada por estar fuera del patrón "sólo tests" de esas 2 etapas.
- **Monitoreo futuro de catálogos**: los 4 módulos con doble capa (`hour-concepts`/`novelty-types`/`document-categories`/`salary-categories`) y `employeeOrgChartSelect` siguen siendo "vocabulario cerrado chico"/volumen bajo (32 empleados reales hoy, techo de `take=1000` en org-chart) — si el volumen real creciera de forma sostenida, valdría la pena revisar paginación real server-side o el ahorro de payload de los 8 sub-campos no usados; no antes, sin evidencia de volumen real.
- **Push pendiente**: `main` sigue 17 commits ahead de `origin/main` (incluyendo esta etapa) — revisar si conviene publicar/push después de la validación final del usuario, no se ejecutó ningún push en ninguna etapa de la serie.

## 8. Recomendación final

**14I puede cerrarse.** Los 6 hallazgos P0/P1 accionables del inventario original de 14I.1 están cerrados con un fix real (3 `$transaction` P0, 1 `$transaction` P1, 1 bug de coerción, 1 duplicado de requests) o cerrados sin acción con evidencia medida que justifica no tocar (`employeeOrgChartSelect`, `timeGridCatalogCache`, doble capa de cache). Los 2 hallazgos P2 sin caller real quedan documentados como deuda aceptada, mismo criterio que el resto del proyecto desde 14H.5.

**No se recomienda seguir optimizando infraestructura backend/performance dentro de esta misma serie.** Cada diagnóstico sucesivo de 14I (14I.5, 14I.8, 14I.10, 14I.11) fue reduciendo la lista de candidatos reales con evidencia, no encontrando trabajo nuevo — la serie llegó a un punto de rendimientos decrecientes: seguir "cazando" hallazgos de performance sin una medición nueva que lo motive sería exactamente el antipatrón que `docs/PERFORMANCE_STANDARDS.md` §1 prohíbe ("no optimizar por optimizar").

El próximo trabajo debería ser, en este orden de preferencia:

- **A. Push controlado**, si el usuario lo autoriza — los 18 commits locales (17 previos + esta etapa) llevan validaciones verdes documentadas en cada uno de sus propios docs de decisión.
- **B. Volver a producto/funcionalidad** — la serie 14I fue puramente de infraestructura; no hay ningún backlog de performance abierto que justifique otra etapa 14I inmediata.
- **C. Abrir una nueva serie sólo si aparece una medición nueva** (telemetría real de producción, un incidente concreto, o un cambio de volumen real que active alguno de los "riesgos pendientes" de §7) — no por sospecha genérica.

## 9. Checklist final

- [x] **Contratos de API preservados** — ningún método/ruta/query param/shape de respuesta cambió en ningún endpoint tocado por la serie (ver §4).
- [x] **RBAC/scope preservado** — ningún middleware, `requireAnyRole` o `employeeAccessWhere` fue modificado en ninguna etapa.
- [x] **Prisma schema sin cambios** — cero migraciones en toda la serie 14I.
- [x] **Sin migraciones** — confirmado, ninguna etapa de 14I.1 a 14I.11 tocó `backend/prisma/`.
- [x] **Fichador no tocado** — las 9 transacciones interactivas de escritura de `timeEntries.repository.ts` (`clockInResolved`/`clockOutResolved`/`closeOpenWorkShift`/`expireOpenWorkShifts`/etc.) permanecen exactamente iguales.
- [x] **Gestión Horaria productiva sólo tocada en frontend de forma mínima** — único cambio: el guard de `EmployeeHoursPage.tsx` (14I.11), sin tocar cálculos de horas, conceptos horarios ni horas especiales; del lado backend, `attendanceSummary` (14I.4) y el fix de `includeDetails` (14I.9) son cambios de mecánica de ejecución/parseo, no de lógica de negocio horaria.
- [x] **Backend/frontend builds verdes según cada etapa** — `npx prisma validate`/`npm run typecheck`/`npm test`/`npm run build` en verde, documentado en la sección de validaciones de cada uno de los 11 docs de decisión (14I.1 a 14I.11).
- [x] **Journeys verdes cuando correspondió** — corridos y verificados en 14I.2, 14I.3, 14I.4, 14I.11 (los únicos que tocaron código productivo con superficie suficiente para justificarlo); con `git restore` inmediato de los reportes de journey regenerados como efecto colateral, mismo protocolo de toda la serie desde 14H.7.
- [x] **Sin escrituras reales** — ninguna etapa de la serie ejecutó una mutación real de datos de producción/staging; los scripts temporales de medición (14I.5) fueron sólo lectura y se borraron antes de cerrar su etapa.
- [x] **No push** — `main` permanece local, ahora 18 commits ahead de `origin/main` (17 previos + esta etapa de cierre), sin ningún `git push` ejecutado en ninguna etapa de 14I.

## 10. Validaciones ejecutadas en esta etapa (14I.12)

Como 14I.12 es docs/json only, no se ejecutó ninguna suite de backend/frontend (no había código productivo ni tests que tocar). Se ejecutaron únicamente las validaciones de forma:

- `python3 -m json.tool docs/performance/BACKEND_PERFORMANCE_INFRASTRUCTURE_CLOSURE_14I12.json` → `/tmp/backend-performance-infrastructure-closure-14i12-check.json` — JSON válido.
- `git diff --check` — sin errores de espacios en blanco.
- `git status --short` — sólo los 2 archivos nuevos de esta etapa.
- `git diff --stat` — sin cambios a archivos existentes (todo el cambio es aditivo, 2 archivos nuevos).

No se ejecutó ninguna escritura real. No se hizo commit ni push desde esta etapa — quedan pendientes de revisión final del usuario.
