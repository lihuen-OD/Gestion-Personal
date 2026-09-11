# Etapa 14I.6 — Tests de aislamiento/hit-miss/invalidación de caches backend

## 1. Contexto

Etapa de cobertura pura: agrega tests reales (sin mockear la cache bajo prueba) a caches backend que 14I.1 confirmó **correctas por lectura de código** pero sin ningún test que ejercite su comportamiento real de hit/miss, aislamiento por usuario/rol o invalidación. Cero cambios de comportamiento productivo — sólo se agregaron 4 archivos de test nuevos.

## 2. Relación con 14I.1

14I.1 (commit `3abb3c4`, §6 "Inventario caches backend" y §10 P1 punto 8) señaló explícitamente: *"Tests de aislamiento de cache faltantes en `documentsListCache`/`noveltiesListCache` y en las 6 caches de `employees.controller.ts` (todas correctas por lectura de código, ninguna con test de hit/miss real propio)"*, y en §6 nota de matiz: *"varias caches de `time-entries` que la primera pasada marcó como `hasTest:true` en realidad están **mockeadas** en su test de controller... Sólo `homeSummaryCache` y `attendanceObservationsCache` tienen test de cache real end-to-end en ese módulo"*. 14I.5 (commit `4554558`) volvió a nombrar este mismo gap en su recomendación para 14I.6. Esta etapa cierra exactamente esos 3 hallazgos, en el orden de prioridad que el propio 14I.1/14I.5 sugirieron.

## 3. Caches auditadas

Las 12 caches nombradas explícitamente como candidatas por el pedido:

| Cache | Módulo | ¿Tenía test real antes? |
|---|---|---|
| `employeeDetailCache` | `employees.controller.ts` | No (sólo lectura de código) |
| `employeeTimeGridCache` | `employees.controller.ts` | No |
| `employeeListCache` | `employees.controller.ts` | No |
| `employeeSummaryCache` | `employees.controller.ts` | No |
| `employeeOrgChartCache` | `employees.controller.ts` | No |
| `employeeOptionsCache` | `employees.controller.ts` | No |
| `documentsListCache` | `documents.cache.ts` | No (módulo sin ningún test de controller) |
| `noveltiesListCache` | `novelties.cache.ts` | No (módulo sin ningún test de controller) |
| `timeEntriesListCache` | `timeEntries.cache.ts` | Mockeada únicamente (`{get,set}` stub en `timeEntries.controller.test.ts`) |
| `timeEntriesSummaryCache` | `timeEntries.cache.ts` | Mockeada únicamente |
| `timeEntriesPeriodEmployeesCache` | `timeEntries.cache.ts` | Mockeada únicamente |
| `attendanceSummaryCache` | `timeEntries.cache.ts` | Mockeada únicamente |

## 4. Caches con tests agregados

Las 12 de la tabla anterior — sin excepción, ninguna quedó fuera del alcance pedido.

## 5. Caches ya cubiertas antes (no duplicadas)

`homeSummaryCache` y `attendanceObservationsCache` (`time-entries`) ya tenían test real end-to-end propio (`timeEntries.homeSummary.test.ts`, `timeEntries.attendanceObservations.test.ts`, ambos de la serie 14G) — usados acá como **referencia de patrón**, no tocados ni duplicados. También quedaron sin tocar (ya cubiertas o fuera del alcance nombrado por el pedido): `shiftAlertListCache`, `shiftAssignmentSummaryCache`, `notificationsListCache`, `closuresCache`/`correctionsCache`, `positionOptionsCache`, `hourConceptsReadCache`, `noveltyTypesListCache`/`DetailCache`, `documentCategoriesReadCache`, `auditParametersReadCache`, `overviewCache`.

## 6. Caches no cubiertas y motivo

- **`usersListCache`/`usersDetailCache`** (`users.controller.ts`) y **`salaryCategoriesReadCache`** (`salary-categories`) — módulos sin ningún test hoy (confirmado por 14I.1), pero **no estaban en la lista de áreas candidatas de este pedido** (que nombró explícitamente sólo `employees`/`documents`/`novelties`/`time-entries`). Quedan como candidato para una futura etapa (ver §18).
- **`timeGridCatalogCache`** (`employees.repository.ts`) — variante distinta (fetch-all sin scope de usuario, sin invalidación explícita), fuera del alcance nombrado, y tocarla requeriría autorización explícita para `employees.repository.ts` (Legajos) — no forma parte de "caches controller-layer" del pedido.
- **`auth.currentUserCache`, caches de `googleDriveStorage.provider.ts`** — no nombradas por el pedido, infraestructura/auth, fuera de alcance.

## 7. Patrón de test usado

Se replicó exactamente el patrón ya establecido por `timeEntries.homeSummary.test.ts`/`timeEntries.attendanceObservations.test.ts` (serie 14G): **archivo de test nuevo y separado**, uno por área, en vez de agrandar los archivos `*.controller.test.ts` existentes:

- `backend/src/modules/employees/employees.readCaches.test.ts` (nuevo)
- `backend/src/modules/documents/documents.controller.test.ts` (nuevo — el módulo no tenía ninguno)
- `backend/src/modules/novelties/novelties.controller.test.ts` (nuevo — el módulo no tenía ninguno)
- `backend/src/modules/time-entries/timeEntries.readCaches.test.ts` (nuevo)

**Por qué archivos separados y no ampliar `employees.controller.test.ts`/`timeEntries.controller.test.ts` existentes**: ambos archivos existentes mockean por completo la capa de cache (`vi.mock("./timeEntries.cache", () => ({..., timeEntriesListCache: {get: vi.fn(), set: vi.fn()}, ...}))` en el caso de `time-entries`) para poder probar sólo invalidación cruzada entre módulos sin acoplarse al comportamiento real de la cache — exactamente lo opuesto de lo que esta etapa necesita probar. Mezclar ambos estilos en el mismo archivo (`vi.mock` real para una cache y `{get: vi.fn()}` para otra) es frágil y confuso; la propia serie 14G ya había resuelto este conflicto separando `homeSummaryCache`/`attendanceObservationsCache` a sus propios archivos en su momento. Esta etapa sigue exactamente ese precedente ya validado en el código, en vez de introducir un estilo nuevo.

Cada archivo nuevo:
- Mockea sólo la capa de **servicio** (`employeesService`/`documentsService`/`noveltiesService`/`timeEntriesService`) — nunca la cache bajo prueba.
- Usa el controller real, importado sin mock.
- `beforeEach`: `vi.clearAllMocks()` + limpia la(s) cache(s) reales bajo prueba (`clearEmployeeReadCaches()`/`clearEmployeeTimeGridCache()`, `documentsListCache.clear()`, `noveltiesListCache.clear()`, `clearTimeEntriesReadCaches()`) — mismo criterio que `timeEntries.homeSummary.test.ts:48-51`.
- `fakeReq`/`fakeRes` locales al archivo (mismo patrón ya usado en 7+ archivos de test del proyecto — no existe un helper compartido en el repo, no se creó uno nuevo).

## 8. Aislamiento usuario/rol

Probado explícitamente (dos usuarios reales, `NIVEL_1_RRHH` vs `NIVEL_2_SUPERVISION`/`NIVEL_3_CARGA_HORARIA`, mismo `originalUrl`) en:
- `employeeListCache`, `employeeOrgChartCache`, `employeeSummaryCache`, `employeeDetailCache`, `employeeTimeGridCache` (5 de las 6 caches de `employees` — `employeeOptionsCache` sólo tiene hit/miss + invalidación, ver §10 nota).
- `documentsListCache`.
- `noveltiesListCache`.
- `timeEntriesListCache`, `timeEntriesSummaryCache`, `attendanceSummaryCache` (3 de las 4 de `time-entries` — `timeEntriesPeriodEmployeesCache` sólo tiene hit/miss + query variance + invalidación).

En todos los casos: 2 usuarios distintos con la misma URL disparan 2 llamadas al service (nunca comparten resultado), y repetir el pedido del primer usuario sigue siendo cache hit de **su propia** entrada — nunca la del otro usuario. Supera el mínimo pedido ("al menos 2 caches").

## 9. Variación por query params

Probado explícitamente (mismo usuario, distinto `originalUrl`) en: `employeeListCache`, `employeeOrgChartCache`, `employeeTimeGridCache`, `documentsListCache`, `noveltiesListCache`, `timeEntriesListCache`, `timeEntriesPeriodEmployeesCache`, `attendanceSummaryCache` — 8 caches, supera el mínimo pedido ("al menos 2 caches"). `employeeSummaryCache`/`employeeOptionsCache`/`timeEntriesSummaryCache` no tienen query variance real que probar de forma significativa en sus casos de uso actuales (endpoints sin filtros variables en la práctica) — se cubrieron con hit/miss + aislamiento/invalidación en su lugar.

## 10. Invalidaciones testeadas

- `clearEmployeeReadCaches()` — sobre las 6 caches de `employees` (incluye una prueba específica de que también alcanza a `employeeTimeGridCache`, la invalidación "amplia").
- `clearEmployeeTimeGridCache()` — invalidación **narrow**: se agregó una prueba dedicada que puebla `employeeDetailCache` Y `employeeTimeGridCache`, invalida sólo la segunda, y confirma que la primera **sigue siendo cache hit** (documenta en test el comportamiento ya explicado en el comentario de la Etapa 14C.2 del propio código).
- `getOverviewById`/`getOverviewDetailsById`/`getById` — prueba adicional de que las 3 usan keys distintas (`:overview`, `:overview-details`, sin sufijo) para el mismo legajo/usuario, nunca sirven la vista de una desde la cache de otra.
- `clearDocumentsReadCaches()` — invocada directamente (mismo mecanismo que usa `employees.controller.ts::createDocument`, el único call site real de producción; se optó por invocar la función exportada en vez de acoplar el test a `employeesController` de otro módulo, alternativa explícitamente permitida por el pedido).
- `clearNoveltiesReadCaches()` — probada **indirectamente, vía los mutadores reales** (`create`, `approve`, `reject`, `remove`) en vez de sólo la función exportada — mayor cobertura de regresión: confirma que el call site de producción sigue invalidando, no sólo que la función en sí funciona.
- `clearTimeEntriesReadCaches()` — sobre las 4 caches objetivo (`timeEntriesListCache`, `timeEntriesSummaryCache`, `timeEntriesPeriodEmployeesCache`, `attendanceSummaryCache`).

## 11. Qué NO se cambió

- Ningún archivo de producción — `employees.controller.ts`, `documents.controller.ts`, `documents.cache.ts`, `novelties.controller.ts`, `novelties.cache.ts`, `timeEntries.controller.ts`, `timeEntries.cache.ts`, `ttlCache.ts` — cero líneas tocadas.
- Ningún `*.service.ts`/`*.repository.ts` — sólo se mockearon en los tests nuevos, nunca se modificó su código real.
- TTL, keys, condiciones de scope, invalidaciones — ninguna cambió; los tests nuevos **confirman** el comportamiento existente, no lo alteran.
- `employees.controller.test.ts`, `timeEntries.controller.test.ts` (los archivos existentes que mockean la cache) — ninguno de los dos se tocó; sus tests de invalidación cruzada entre módulos (HourConceptBreakdown, clock in/out) siguen exactamente igual.
- Contrato API, shape de respuesta, RBAC/scope — sin cambios.
- Frontend, Prisma schema, `relationJoins`, Fichador, Gestión Horaria productiva, Puestos, Configuración — nada de esto se tocó.
- No se ejecutó ninguna escritura real ni se corrió ningún journey (no hacía falta — sólo se agregaron tests unitarios de backend con servicios mockeados).

## 12. Contrato API preservado

Sin cambios — los 4 archivos nuevos son tests unitarios que llaman directamente a las funciones de controller ya existentes (`employeesController.list`, etc.) con un `req`/`res` simulados; no se tocó ninguna ruta, ni el shape de `{data, meta}`/`{data}` que cada handler ya devolvía.

## 13. RBAC/scope preservado

Sin cambios — los tests usan usuarios fake con roles reales del sistema (`roles.rrhh`/`roles.supervision`/`roles.cargaHoraria`, vía sus valores string `NIVEL_1_RRHH`/`NIVEL_2_SUPERVISION`/`NIVEL_3_CARGA_HORARIA`) sólo para variar la key de cache — el middleware de autorización real (`requireAnyRole`) no interviene en estos tests (se llama al handler del controller directamente, como en todo el resto de la suite de este proyecto), y no se modificó ninguna regla de acceso.

## 14. TTL/key/invalidation preservados

Ningún valor de TTL, ninguna función de construcción de key (`userScopedCacheKey`/`detailCacheKey`) ni ninguna función de invalidación fue modificada — los tests nuevos ejercitan exactamente las mismas funciones que ya existían, sin parámetros nuevos ni comportamiento condicional agregado.

## 15. Tests agregados/modificados

**49 tests nuevos, 4 archivos nuevos, 0 archivos modificados:**

- `employees.readCaches.test.ts` — **24 tests**: `employeeListCache` (4: miss/hit, query variance, invalidación), `employeeOrgChartCache` (5: miss/hit, query variance, aislamiento usuario/rol, invalidación), `employeeOptionsCache` (2: hit/miss, invalidación), `employeeSummaryCache` (3: hit/miss, aislamiento, invalidación), `employeeDetailCache` (5: hit/miss, aislamiento usuario/rol, ids distintos, keys distintas overview/overview-details/detail, invalidación), `employeeTimeGridCache` (5: hit/miss, query variance, aislamiento, invalidación narrow que confirma que detail NO se invalida, invalidación amplia).
- `documents.controller.test.ts` — **5 tests** (archivo nuevo, módulo sin test de controller previo): hit/miss, query variance, aislamiento usuario/rol, invalidación vía `clearDocumentsReadCaches()`.
- `novelties.controller.test.ts` — **6 tests** (archivo nuevo, módulo sin test de controller previo): hit/miss, query variance, aislamiento usuario/rol, invalidación vía `create()` y vía `approve()`/`reject()`/`remove()` (call sites reales).
- `timeEntries.readCaches.test.ts` — **14 tests**: `timeEntriesListCache` (4), `timeEntriesSummaryCache` (3), `timeEntriesPeriodEmployeesCache` (3), `attendanceSummaryCache` (4).

Ningún test depende de tiempos reales/TTL expirando (no se probó el vencimiento del TTL en sí, que ya usa `Date.now()` interno sin reloj inyectable en `ttlCache.ts` — fuera del alcance de este pedido, que pidió hit/miss/aislamiento/invalidación, no expiración). Ningún mock oculta el comportamiento de la cache bajo prueba en ningún archivo nuevo.

## 16. Validaciones

- `npx prisma validate` ✅ schema válido, sin cambios.
- `npm run typecheck` ✅ sin errores (se ajustó `userA`/`userB` a `Express.AuthUser` explícito con `email`/`name` en los 4 archivos nuevos — el tipo real de `Express.AuthUser` los exige, detectado por el propio `tsc`).
- `npm test` ✅ **1356/1356** (91 archivos, +49 tests nuevos vs. los 1307 de cierre de 14I.5).
- `npm run build` ✅ sin errores.
- `git diff --check` ✅ sin errores de espacios en blanco.
- `git status --short` / `git diff --stat`: 4 archivos nuevos, 0 modificados (todo el cambio es aditivo).
- No se corrieron journeys de Playwright ni se tocó frontend/e2e — no hacía falta, sólo se agregaron tests unitarios de backend con servicios mockeados (mismo criterio ya usado en 14I.2/14I.3/14I.4 para cambios acotados a tests+backend).
- No se ejecutó ninguna escritura real en ningún momento de esta etapa.

## 17. Riesgos pendientes

- Ninguno introducido — los 49 tests nuevos son puramente aditivos, no cambian ningún comportamiento productivo, y ya corren en verde junto con el resto de la suite.
- `usersListCache`/`usersDetailCache`/`salaryCategoriesReadCache` siguen sin ningún test (módulos completos sin cobertura, ya documentado desde 14I.1) — no estaban en el alcance nombrado de esta etapa.
- `timeGridCatalogCache` (`employees.repository.ts`) sigue sin invalidación explícita y sin test — requiere autorización explícita para tocar `employees` (Legajos), fuera de alcance de 14I.6 (que es sólo tests de cache controller-layer).
- El vencimiento real de TTL (`Date.now()` sin reloj inyectable en `ttlCache.ts`) sigue sin ningún test, ni en esta etapa ni antes — **confirmado**: `backend/src/shared/cache/ttlCache.ts` no tiene un archivo `ttlCache.test.ts` (a diferencia de `repositoryListCache.ts`, que sí tiene el suyo desde 14I.3). No pedido explícitamente por este pedido (que pidió hit/miss/aislamiento/invalidación, no expiración), pero es el hueco de cobertura más antiguo y transversal que queda — afecta a las ~34 caches que usan `createTtlCache`, no sólo a las 12 de esta etapa.

## 18. Recomendación para 14I.7

Con los 3 gaps de cobertura de cache nombrados por 14I.1/14I.5 cerrados, candidatos razonables para una futura etapa, en orden de evidencia:
1. **Cobertura de cache para `users`/`salary-categories`** — únicos 2 módulos backend sin ningún test hoy (confirmado desde 14I.1), incluye sus caches `usersListCache`/`usersDetailCache`/`salaryCategoriesReadCache` — mismo patrón exacto ya aplicado en esta etapa, extendido a esos 2 módulos.
2. **Invalidación de `timeGridCatalogCache`** (`employees.repository.ts`, P1 de 14I.1) — sin ninguna invalidación explícita hoy; requiere autorización explícita para tocar `employees`.
3. **Consolidar la doble capa de cache** (`createTtlCache` de controller + `repositoryListCache` de repositorio) en `hour-concepts`/`novelty-types`/`document-categories`/`salary-categories` — deuda ya documentada desde 14I.3, sin bug que la fuerce, ahora con más confianza de test en las caches vecinas ya cubiertas.
4. **`ttlCache.test.ts`** (el helper compartido en sí, `backend/src/shared/cache/ttlCache.ts`) — hoy sin ningún test propio, a diferencia de `repositoryListCache.test.ts` (14I.3); un test ahí (hit/miss/expiración/`stats()`/`evictIfNeeded`, con `vi.useFakeTimers()`) cubriría de una sola vez el mecanismo base de las ~34 caches que lo usan, en vez de repetir un test de expiración por cada cache individual — bajo impacto inmediato, alto apalancamiento de cobertura.
