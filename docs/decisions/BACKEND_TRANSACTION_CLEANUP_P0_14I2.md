# Etapa 14I.2 — Limpieza de `$transaction` P0 en lecturas independientes

## 1. Contexto

Etapa mecánica y quirúrgica: corrige exactamente los 3 hallazgos **P0** identificados por el diagnóstico transversal 14I.1 (`docs/decisions/BACKEND_PERFORMANCE_INFRASTRUCTURE_DIAGNOSTIC_14I1.md`), sin tocar ningún otro hallazgo (P1/P2/P3), sin tocar `relationJoins`, sin tocar Prisma schema, sin cambiar contratos.

## 2. Relación con 14I.1

14I.1 (commit `3abb3c4`) inventarió 6 instancias remanentes de `$transaction([findMany, count])`/`$transaction(async (tx) => {...})` sobre lecturas independientes en todo el backend, clasificándolas P0-P2 según si tenían caller real y si vivían en un módulo Gestión-Horaria-adyacente. Los 3 P0 —`novelties`, `users`, `documents`— son idénticos en forma (array, incondicional, con caller real siempre ejercitado) y sin ningún factor de riesgo adicional. Los otros 3 (`attendanceSummary` en `time-entries`, `salaryCategories` y `hourConceptRules` sin caller real) quedan explícitamente fuera de esta etapa.

## 3. Alcance exacto

Sólo `findMany` en:
- `backend/src/modules/novelties/novelties.repository.ts`
- `backend/src/modules/users/users.repository.ts`
- `backend/src/modules/documents/documents.repository.ts`

Más los tests correspondientes. Nada más.

## 4. Diagnóstico previo (por módulo)

### Novelties
1. **Endpoint**: `GET /novelties` → `noveltiesController.list` → `noveltiesService.list` → `noveltiesRepository.findMany`.
2. **Caller real**: sí — `NoveltiesPage.tsx`, y `EmployeeHoursPage.tsx` vía `noveltyApiService.getAll({employeeId})` (confirmado en 14I.1 §4.2).
3. **Cache backend**: sí — `noveltiesListCache` (`novelties.cache.ts`, 15s, `userScopedCacheKey`), invalidada en `create`/`approve`/`approveMany`/`reject`/`remove` (`novelties.controller.ts:25,32,39,44,51`) + `clearTimeEntriesReadCaches()` cruzado.
4. **Cache frontend**: fuera de alcance de este diagnóstico (no se tocó).
5. **`findMany`/`count` independientes**: sí — mismo `where` (`buildWhere(query, employeeAccessWhere)`), ninguno depende del resultado del otro.
6. **Por qué no hace falta `$transaction`**: son 2 lecturas puras sobre el mismo `where` en un instante cercano; no hay ninguna escritura involucrada ni necesidad de snapshot estricto (una fila creada/eliminada entre ambas llamadas produciría, como máximo, un `total` desviado en 1 durante una fracción de segundo — mismo tipo de inconsistencia ya aceptada en las 15 correcciones previas de la serie).
7. **Riesgo esperado**: mínimo — mismo patrón mecánico aplicado 15 veces sin ninguna regresión.
8. **Tests existentes**: `novelties.service.test.ts` (mockea el repositorio completo, nunca ejercita el `findMany` real) — sin `novelties.repository.test.ts`. Se agregó.

### Users
1. **Endpoint**: `GET /users` → `usersController.list` → `usersService.list` → `usersRepository.findMany`.
2. **Caller real**: sí — `UsersPage.tsx`, única pantalla de administración de usuarios.
3. **Cache backend**: sí — `usersListCache` (`users.controller.ts`, 30s, `req.originalUrl`, sin scope de usuario — correcto, verificado en 14I.1: `list(query)` no recibe `user` y la ruta ya es `adminRoles`-only).
4. **Cache frontend**: fuera de alcance.
5. **`findMany`/`count` independientes**: sí.
6. **Por qué no hace falta `$transaction`**: mismo motivo que Novelties.
7. **Riesgo esperado**: mínimo.
8. **Tests existentes**: **ninguno** — el módulo `users` no tenía ni un solo archivo de test. Se creó cobertura mínima nueva.

### Documents
1. **Endpoint**: `GET /documents` → `documentsController.list` → `documentsService.list` → `documentsRepository.findMany`.
2. **Caller real**: sí — `DocumentsPage.tsx`.
3. **Cache backend**: sí — `documentsListCache` (`documents.cache.ts`, 20s, `userScopedCacheKey`), invalidada desde `employees.controller.ts` (creación de documentos).
4. **Cache frontend**: fuera de alcance.
5. **`findMany`/`count` independientes**: sí.
6. **Por qué no hace falta `$transaction`**: mismo motivo.
7. **Riesgo esperado**: mínimo.
8. **Tests existentes**: `documents.service.test.ts` (mockea el repositorio) — sin `documents.repository.test.ts`. Se agregó. No se tocó `findById`/`download` (storage/Google Drive), fuera de alcance.

## 5. Por qué eran seguros de corregir

Los 3 son exactamente la misma forma que las 15 correcciones previas de 14C/14G/14H: `$transaction([findMany, count])` con el mismo `where` en ambas llamadas, sin ninguna escritura, sin necesidad de consistencia transaccional (no son datos críticos categoría D de `PERFORMANCE_STANDARDS.md` §2). `Promise.all` produce el mismo resultado (ambas queries se ejecutan igual, sólo dejan de pinarse a una única conexión en serie) — cero cambio de comportamiento observable, sólo de concurrencia real contra Neon.

## 6. Qué se cambió en Novelties

`backend/src/modules/novelties/novelties.repository.ts::findMany`: `prisma.$transaction([prisma.novelty.findMany(...), prisma.novelty.count(...)])` → `Promise.all([prisma.novelty.findMany(...), prisma.novelty.count(...)])`. `where`/`include`/`orderBy`/`skip`/`take` sin ningún cambio — mismos argumentos, mismo orden.

## 7. Qué se cambió en Users

`backend/src/modules/users/users.repository.ts::findMany`: mismo cambio mecánico. `where`/`select` (`userSelect`)/`orderBy`/`skip`/`take` sin cambios.

## 8. Qué se cambió en Documents

`backend/src/modules/documents/documents.repository.ts::findMany`: mismo cambio mecánico. `where`/`include` (`documentListInclude`)/`orderBy`/`skip`/`take` sin cambios. `findById`/`download` (storage) sin tocar.

## 9. Qué NO se cambió

- `attendanceSummary` (`time-entries.repository.ts:977`) — P1, explícitamente fuera de esta etapa.
- `salaryCategories.repository.ts` / `hourConceptRules.repository.ts` — P2, sin caller real, sin cambios.
- `relationJoins`/`relationLoadStrategy` — cero cambios.
- Prisma schema — cero cambios, cero migraciones.
- Controllers/services de los 3 módulos — cero cambios de lógica (sólo el repositorio).
- Caches (`noveltiesListCache`, `usersListCache`/`usersDetailCache`, `documentsListCache`) — cero cambios de TTL/key/invalidación.
- `findById`/`findByEmail`/`create`/`update`/`updatePassword` (users), `findById`/`download` (documents), `createMany`/`approve`/`reject`/`remove`/`findNoveltyType`/`countEmployees` (novelties) — ninguno tocado.
- Frontend — cero archivos tocados.
- Ningún otro módulo backend.

## 10. Contrato API preservado

`GET /novelties`, `GET /users`, `GET /documents` — mismos métodos, mismas rutas, mismos query params, mismo shape de respuesta (`{data, meta: {total, page, pageSize, hasMore}}`). El cambio es transparente para el caller: mismo resultado, sólo cambia cómo Prisma ejecuta las 2 queries internamente.

## 11. RBAC/scope preservado

- `novelties`: `requireAnyRole([rrhh, supervision, cargaHoraria])` en la ruta + `employeeAccessWhere(user)` dentro de `buildWhere` — sin cambios.
- `users`: `requireAnyRole(adminRoles)` en toda la ruta — sin cambios.
- `documents`: `requireAnyRole([rrhh, supervision])` en la ruta + `assertCanAccessDocuments` en el servicio + `employeeAccessWhere(user)` en `buildWhere` — sin cambios.

## 12. Cache/invalidation preservada

Ninguna cache fue tocada. `noveltiesListCache`/`usersListCache`/`documentsListCache` siguen con el mismo TTL, la misma key y las mismas invalidaciones ya verificadas en 14I.1 (ninguna requería cambios — el problema nunca fue de cache, fue de concurrencia de queries).

## 13. Tests agregados/modificados

**Nuevos (12 tests, 3 archivos, ninguno existía antes de esta etapa):**
- `novelties.repository.test.ts` (4 tests): `Promise.all` sin `$transaction`; `findMany`/`count` con el mismo `where` (incluye `employeeAccessWhere` y filtros); búsqueda libre; `orderBy`/`include` sin cambios.
- `users.repository.test.ts` (4 tests): `Promise.all` sin `$transaction`; mismo `where` con filtros de rol/estado/búsqueda; usa `userSelect` (nunca expone `passwordHash`); sin filtros, `where` vacío y paginación por defecto respetada.
- `documents.repository.test.ts` (4 tests): `Promise.all` sin `$transaction`; mismo `where` (incluye `employeeAccessWhere` y filtros); `include`/`orderBy` sin cambios; búsqueda libre.

Ningún test depende de tiempos exactos. Ningún mock oculta el comportamiento validado (los mocks de `prisma.$transaction` están presentes y se verifica explícitamente que **no** se llaman). No se tocó ningún test no relacionado.

## 14. Validaciones

- `npx prisma validate` ✅ schema válido, sin cambios.
- `npm run typecheck` ✅ sin errores (1 error de tipo detectado y corregido en el propio test nuevo de `documents` — `status: "ACTIVO"` no existe en `documentStatusSchema`, corregido a `"VIGENTE"`).
- `npm test` ✅ **1277/1277** (85 archivos, +12 tests nuevos).
- `npm run build` ✅ sin errores.
- `npm run perf:journey:admin-config` ✅ passed (52.1s) — smoke de regresión transversal (ninguno de los 3 módulos tocados está cubierto por este journey, corre como control de que nada más se rompió).
- `npm run perf:journey:workforce` ✅ passed (1.1min) — smoke de regresión.
- `npm run perf:journey:employees` ✅ passed (42.4s) — smoke de regresión.
- Los 3 journeys regeneraron como efecto colateral `docs/performance/{ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1,EMPLOYEES_PERFORMANCE_JOURNEY_14D1,WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1}.{md,json}` — restaurados (`git restore`) de inmediato, mismo protocolo ya establecido en 14H.7/14H.8, para no regenerar reportes 14D/14G/14H fuera de alcance.
- `git diff --check` ✅ sin errores de espacios en blanco.
- `git status --short` / `git diff --stat`: cambios acotados a los 3 repositorios (`novelties`/`users`/`documents`, 18 inserciones/3 eliminaciones) + 3 archivos de test nuevos.

## 15. Riesgos pendientes

- Ninguno introducido por este cambio — mismo patrón mecánico validado 15 veces antes, 0 regresiones históricas.
- `novelties`/`users`/`documents` no están cubiertos por ningún journey activo hoy — el "antes/después" de este fix no tiene medición automatizada de latencia real; la mejora esperada es del mismo orden que la ya medida en módulos con `include`/`select` de complejidad similar (14H: 30-80% según profundidad de relaciones, típicamente en el extremo bajo de ese rango para estos 3 casos, que tienen `include`/`select` de 1-2 niveles).
- `users`/`salary-categories` seguían sin tests de servicio/controller (sólo se agregó cobertura de repositorio en `users` para esta etapa) — riesgo de regresión futura en esas capas si se tocan sin agregar tests propios primero.

## 16. Qué queda para 14I.3

Según el roadmap de 14I.1: **14I.3 — consolidación del patrón de cache backend** (extraer la Forma B de `listCache` repositorio, copiada a mano en 5 módulos, a un helper compartido). Los P1 sueltos (`attendanceSummary`, `employeeOrgChartSelect`, invalidación de `timeGridCatalogCache`) siguen documentados y sin tocar, disponibles para una etapa dedicada futura.
