# Etapa 14I.7 — Tests faltantes de `ttlCache` base + `users`/`salary-categories`

## 1. Contexto

Etapa de cobertura pura, cierre del último gap de test de infraestructura de cache nombrado por 14I.1 y reiterado por 14I.6: el helper base `ttlCache.ts` (usado por ~34 caches del proyecto) nunca tuvo un test propio, y `users`/`salary-categories` eran los únicos 2 módulos backend sin ningún test de controller. Cero cambios de comportamiento productivo — 3 archivos de test nuevos, 0 archivos modificados.

## 2. Relación con 14I.1 y 14I.6

14I.1 (commit `3abb3c4`) documentó ambos módulos como "sin ningún test" (`users` y `salary-categories`, §9 "Hallazgos por módulo") y clasificó esto como parte de la deuda P2/P3 general de cobertura. 14I.6 (commit `c04c718`) cerró el gap de aislamiento/hit-miss para las 6 caches de `employees.controller.ts`, `documentsListCache` y `noveltiesListCache`, y explícitamente dejó fuera de su alcance nombrado (§6/§18 de su propio doc) a `usersListCache`/`usersDetailCache`/`salaryCategoriesReadCache` y al helper `ttlCache.ts` en sí — nombrándolos como la recomendación #1 y #4 para "14I.7". Esta etapa cierra exactamente esos 2 hallazgos.

## 3. Gaps cubiertos

| Gap (nombrado por 14I.1/14I.6) | Estado antes | Estado después |
|---|---|---|
| `ttlCache.ts` sin test propio | 0 tests — sólo se ejercitaba indirectamente vía los tests de controller de otros módulos | 10 tests directos (`ttlCache.test.ts`) |
| `usersListCache`/`usersDetailCache` sin test de controller | 0 tests de controller (sólo `users.repository.test.ts` de 14I.2) | 11 tests (`users.controller.test.ts`, archivo nuevo) |
| `salaryCategoriesReadCache` sin test de controller | 0 tests de controller (sólo `salaryCategories.repository.test.ts` de 14I.3, que cubre una capa distinta — la Forma B de repositorio) | 6 tests (`salaryCategories.controller.test.ts`, archivo nuevo) |

## 4. `ttlCache` tests

**Diagnóstico previo** (`backend/src/shared/cache/ttlCache.ts`, sin cambios):
1. **API pública**: `get(key)`, `set(key, value)`, `clear()`, `stats()`. Constructor: `createTtlCache<T>(ttlMs, { maxEntries? })`.
2. **TTL**: fijo por instancia (`ttlMs` del constructor), aplicado por entrada en `set()` (`expiresAt = Date.now() + ttlMs`) — no hay TTL por key distinto dentro de la misma instancia.
3. **`Date.now()`**: usado directamente en `get()` (chequeo de expiración) y `set()` (cálculo de `expiresAt`) — **sin reloj inyectable**, a diferencia de `createRepositoryListCache` (14I.3), que sí acepta un `now` opcional. Por eso el test usa `vi.useFakeTimers()`/`vi.setSystemTime()`, no un parámetro.
4. **get/set/clear**: `get()` devuelve `undefined` si no hay entrada o si expiró (y en ese caso la borra inmediatamente — "self-healing" en la lectura, no espera a un barrido); `set()` siempre sobrescribe (nueva key o existente) y reinicia la expiración; `clear()` vacía todo el `Map` de una sola vez.
5. **¿Cachea errores?**: `ttlCache.ts` no tiene ningún concepto de "error" — sólo almacena lo que se le pasa a `set()`. En **todos** los callers reales del proyecto (`employees`/`documents`/`novelties`/`time-entries`/`users`/`salary-categories`), el patrón es `const result = await service.x(...); cache.set(key, result);` — si el `await` rechaza, la ejecución nunca llega a `.set()`, así que un error nunca se cachea **por construcción del patrón de uso**, no por una lógica interna del helper. Confirmado explícitamente con tests en `users.controller.test.ts`/`salaryCategories.controller.test.ts` (§5/§6).
6. **Delete por key**: no existe — sólo `clear()` total (confirmado con un test que verifica que `delete`/`evict`/`remove`/`invalidate` no son funciones del objeto devuelto). Mismo "ttlCacheDesignNote" ya documentado en 14I.1 §6.
7. **Módulos que lo usan**: 8 archivos `*.cache.ts` (`dashboard`, `audit`, `documents`, `novelties`, `workforce-management`, `shiftAlert`, `shiftAssignment`, `time-entries`) + 7 controllers inline (`employees` ×6 caches, `positions`, `hour-concepts`, `novelty-types`, `document-categories`, `audit-parameters`, `salary-categories`, `users`) — ~34 caches en total, confirmado por 14I.1.

**Tests agregados** (`backend/src/shared/cache/ttlCache.test.ts`, 10 tests, con `vi.useFakeTimers()`/`vi.setSystemTime()`, sin depender de tiempo real):
1. `get()` antes de cualquier `set()` → `undefined`.
2. `set()` + `get()` dentro del TTL → devuelve exactamente el valor guardado (misma referencia).
3. Expira exactamente al llegar al TTL (`expiresAt <= now`) — vigente 1ms antes, miss en el instante exacto.
4. `clear()` borra todas las entradas.
5. Keys distintas no se cruzan.
6. Sobrescribir una key existente actualiza el valor Y reinicia su expiración (la entrada vieja hubiera expirado, la nueva no).
7. Dos instancias del helper no comparten estado.
8. Sólo soporta invalidación total — no expone `delete`/`evict`/`remove`/`invalidate`.
9. `stats()` refleja `hits`/`misses`/`sets`/`entries`/`hitRate` acumulados correctamente.
10. `maxEntries` evict la entrada menos usada recientemente al superar el límite (LRU-ish vía `touch()` en cada hit).

## 5. `users` cache tests

**Diagnóstico previo** (`backend/src/modules/users/{users.controller.ts,users.service.ts,users.repository.ts}`, sin cambios):
1. **Caches reales**: `usersListCache` (`createTtlCache`, 30s) y `usersDetailCache` (`createTtlCache`, 30s) — ambas declaradas inline en `users.controller.ts`, **no exportadas** (a diferencia de `documents`/`novelties`/`time-entries`, que tienen `*.cache.ts` con exports).
2. **TTL**: 30.000ms ambas.
3. **Key**: `usersListCache` usa `req.originalUrl` directo; `usersDetailCache` usa `id` (`requireParam(req, "id")`) directo — **ninguna de las 2 incluye `userId`/`role`**.
4. **¿Incluye query params?**: sí, `req.originalUrl` ya contiene el querystring completo (page/take/search/role/status).
5. **¿Necesita user/role en la key?**: no.
6. **Por qué no lo necesita**: `usersService.list(query)`/`getById(id)` no reciben `user` como parámetro — el resultado no varía según quién pregunta. La ruta ya está gateada `adminRoles`-only (`usersRouter.use(requireAuth, requireAnyRole(adminRoles))`, y `adminRoles = [roles.rrhh]`) — sólo un rol puede llegar acá, así que ni siquiera hay un segundo rol con el que compararse. Confirmado correcto por 14I.1, re-confirmado acá.
7. **Invalidaciones**: una única función interna `clearUsersReadCache()` (limpia ambas cachés juntas), llamada desde `create`, `update` y `resetPassword` — **no exportada** desde `users.controller.ts`.
8. **Tests existentes antes**: sólo `users.repository.test.ts` (14I.2) — cero tests de controller/cache.
9. **Qué faltaba cubrir**: exactamente lo que se agregó (§ siguiente).

**Restricción real encontrada durante la implementación**: al no estar exportada `clearUsersReadCache()`, y estando prohibido modificar `users.controller.ts` para exportarla, no hay forma de resetear las 2 cachés (singletons de módulo) entre tests. Solución aplicada, sin tocar ningún archivo de producción: **cada test usa una key (`originalUrl`/`id`) exclusiva, nunca reutilizada por otro test del archivo** — evita cualquier colisión entre tests sin necesitar un `clear()` externo. La invalidación real (`create`/`update`/`resetPassword`) se prueba igual, porque esos 3 mutadores SÍ llaman a `clearUsersReadCache()` internamente — se ejercita el mutador real del controller, no la función privada.

**Tests agregados** (`backend/src/modules/users/users.controller.test.ts`, 11 tests):
- `list`: cache miss inicial (1 test), cache hit mismo `originalUrl` (1), query variance (1), un rechazo del service no se cachea (1).
- `getById`: cache miss inicial (1), cache hit mismo id (1), id variance (1), un rechazo del service no se cachea (1).
- Invalidación: `create()` limpia list+detail (1), `update()` limpia list+detail (1), `resetPassword()` limpia list+detail (1).

## 6. `salary-categories` cache tests

**Diagnóstico previo** (`backend/src/modules/salary-categories/{salaryCategories.controller.ts,salaryCategories.service.ts,salaryCategories.repository.ts}`, sin cambios):
1. **Cache real**: `salaryCategoriesReadCache` (`createTtlCache`, 60s) — declarada inline en `salaryCategories.controller.ts`, no exportada. Es una capa **distinta** de la Forma B de `repositoryListCache` que 14I.3 ya migró en `salaryCategories.repository.ts` (esa vive en el repositorio, para la rama "sin filtros" de `findMany`; ésta vive en el controller, cachea la respuesta HTTP completa `{items, meta}` ya armada por el service) — es la doble capa ya documentada como deuda desde 14I.1/14I.3, **no consolidada acá** (fuera de alcance explícito).
2. **TTL**: 60.000ms.
3. **Key**: `req.originalUrl` directo.
4. **¿Necesita user/role en la key?**: no.
5. **Por qué no lo necesita**: `salaryCategoriesService.list(query)` no recibe `user` — catálogo global sin scope de usuario, mismo criterio que `positions`/`hour-concepts`/`novelty-types`/`document-categories` (confirmado por 14I.1/14I.3).
6. **Invalidaciones**: `.clear()` inline en `create`/`update` (no hay una función nombrada como en otros módulos, se llama directo sobre la constante del closure) — no exportada.
7. **Tests existentes antes**: sólo `salaryCategories.repository.test.ts` (14I.3, cubre la Forma B de repositorio, no esta cache de controller) — cero tests de controller.
8. **Qué faltaba cubrir**: exactamente lo agregado (§ siguiente).

**Mismo hallazgo de restricción que en `users`**: `salaryCategoriesReadCache` tampoco está exportada — mismo mecanismo de keys exclusivas por test, mismo criterio de probar invalidación vía los mutadores reales (`create`/`update`).

**El `$transaction` P2 de la rama filtrada de `salaryCategories.repository.ts` (sin caller real, documentado desde 14I.1/14I.2/14I.3) queda exactamente igual — no se tocó, no forma parte de esta etapa** (instrucción explícita del pedido).

**Tests agregados** (`backend/src/modules/salary-categories/salaryCategories.controller.test.ts`, 6 tests):
- `list`: cache miss inicial + contrato `{data, meta}` verificado (1 test), cache hit mismo `originalUrl` (1), query variance por `family` (1), un rechazo del service no se cachea (1).
- Invalidación: `create()` limpia la cache (1), `update()` limpia la cache (1).

## 7. Qué NO se cambió

- `ttlCache.ts`, `users.controller.ts`, `users.service.ts`, `users.repository.ts`, `salaryCategories.controller.ts`, `salaryCategories.service.ts`, `salaryCategories.repository.ts` — cero líneas tocadas en ningún archivo de producción.
- `clearUsersReadCache()`/`salaryCategoriesReadCache` — ninguna se exportó (se evaluó y se descartó explícitamente por instrucción directa de no modificar `controller.ts`; se resolvió con keys exclusivas por test en su lugar, ver §5/§6).
- El `$transaction` P2 de `salaryCategories.repository.ts` (rama filtrada, sin caller real) — sin cambios, documentado desde 14I.1.
- La doble capa de cache de `salary-categories` (`createTtlCache` de controller + `repositoryListCache` de repositorio) — sigue existiendo tal cual, no consolidada (fuera de alcance explícito).
- `timeGridCatalogCache` (`employees.repository.ts`) — no tocada, no forma parte de esta etapa.
- `auth.currentUserCache` — no se tocó ni se documentó nada nuevo sobre ella en esta etapa (el pedido permitía diagnóstico/documentación, no hizo falta ninguno adicional al ya existente en 14I.1).
- Caches de Google Drive storage — no tocadas.
- `relationJoins`, Prisma schema, Fichador, Gestión Horaria productiva, frontend — nada de esto se tocó.
- No se ejecutó ninguna escritura real ni se corrió ningún journey.

## 8. Contrato API preservado

Sin cambios — los 3 archivos nuevos son tests unitarios que llaman directamente a funciones de controller ya existentes; ninguna ruta, shape de respuesta (`{data, meta}`/`{data}`) o código de estado HTTP fue modificado. El test de `salaryCategoriesController.list` incluye una aserción explícita del shape completo de respuesta (`{data: [...], meta: {...}}`) como confirmación del contrato, tal como pedía la consigna.

## 9. RBAC/scope preservado

Sin cambios — no se tocó ningún middleware (`requireAuth`/`requireAnyRole`/`adminRoles`), ninguna ruta, ni la lógica de `employeeAccessWhere`/scope. Los tests llaman a los handlers de controller directamente (mismo patrón que toda la suite del proyecto), sin pasar por el middleware real, que no forma parte de lo que se está probando acá.

## 10. TTL/key/invalidation preservados

Ningún valor de TTL (30s `users` ×2, 60s `salary-categories`), ninguna función de construcción de key, ninguna invalidación fue modificada — los tests nuevos ejercitan exactamente el código ya existente, sin agregar parámetros ni ramas de comportamiento nuevas.

## 11. Tests agregados/modificados

**27 tests nuevos, 3 archivos nuevos, 0 archivos modificados:**
- `backend/src/shared/cache/ttlCache.test.ts` — 10 tests.
- `backend/src/modules/users/users.controller.test.ts` — 11 tests.
- `backend/src/modules/salary-categories/salaryCategories.controller.test.ts` — 6 tests.

Ningún test depende de tiempo real (`ttlCache.test.ts` usa `vi.useFakeTimers()`; los otros 2 no necesitan reloj, sólo keys exclusivas por test). Ninguna cache bajo prueba fue mockeada en ningún archivo nuevo — se mockeó únicamente la capa de servicio (`usersService`/`salaryCategoriesService`) en los 2 archivos de controller.

## 12. Validaciones

- `npx prisma validate` ✅ schema válido, sin cambios.
- `npm run typecheck` ✅ sin errores.
- `npm test` ✅ **1383/1383** (94 archivos, +27 tests nuevos vs. los 1356 de cierre de 14I.6).
- `npm run build` ✅ sin errores.
- `git diff --check` ✅ sin errores de espacios en blanco.
- `git status --short` / `git diff --stat`: 3 archivos nuevos, 0 modificados (todo el cambio es aditivo).
- No se corrieron journeys de Playwright ni se tocó frontend/e2e — no hacía falta, sólo se agregaron tests unitarios de backend con servicios mockeados (mismo criterio ya usado en 14I.6).
- No se ejecutó ninguna escritura real en ningún momento de esta etapa.

## 13. Riesgos pendientes

- Ninguno introducido — los 27 tests nuevos son puramente aditivos.
- `usersListCache`/`usersDetailCache`/`salaryCategoriesReadCache` siguen sin exportar su función de invalidación — no es un riesgo funcional (los mutadores reales sí la usan y quedaron probados), pero mantiene una asimetría de diseño frente a `employees`/`documents`/`novelties`/`time-entries` (que sí exportan la suya). No se corrigió por estar explícitamente prohibido modificar `controller.ts` en esta etapa.
- El `$transaction` P2 de `salaryCategories.repository.ts` (rama filtrada, sin caller real) sigue sin corregir — deuda ya aceptada desde 14I.1, documentada de nuevo acá sin tocar.
- `timeGridCatalogCache` sigue sin invalidación explícita y sin test — requiere autorización explícita para tocar `employees` (Legajos), fuera de alcance de 14I.7.
- La doble capa de cache en `hour-concepts`/`novelty-types`/`document-categories`/`salary-categories` sigue sin consolidar — deuda documentada, sin bug que la fuerce.

## 14. Recomendación para 14I.8

Con el helper base (`ttlCache.ts`) y los 2 últimos módulos sin test de controller (`users`/`salary-categories`) cubiertos, el inventario de gaps de cobertura de cache de 14I.1 queda cerrado en su totalidad para lo que es "tests, sin tocar comportamiento". Candidatos remanentes, todos requieren tocar código productivo (fuera del patrón "sólo tests" de 14I.6/14I.7):
1. **Exportar `clearUsersReadCache()`/`salaryCategoriesReadCache.clear` como función nombrada** — cambio cosmético de consistencia (alinear con el patrón de `employees`/`documents`/`novelties`/`time-entries`), requiere autorización explícita para tocar `controller.ts` de esos 2 módulos.
2. **Invalidación de `timeGridCatalogCache`** (`employees.repository.ts`, P1 de 14I.1) — sin ninguna invalidación explícita hoy; requiere autorización explícita para tocar `employees`.
3. **Consolidar la doble capa de cache** (`createTtlCache` de controller + `repositoryListCache` de repositorio) en `hour-concepts`/`novelty-types`/`document-categories`/`salary-categories` — deuda documentada desde 14I.3, sin bug que la fuerce, ahora con cobertura de test completa en las 4 caches de controller involucradas (incluida `salaryCategoriesReadCache`, cerrada en esta etapa) que reduce el riesgo de una futura consolidación.
4. **`salaryCategories.repository.ts` $transaction P2** — sigue sin caller real; sólo corregir si aparece uno (mismo criterio ya establecido desde 14H.5).
