# Etapa 14I.3 — Consolidación de la "Forma B" de cache backend en un helper compartido

## 1. Contexto

Etapa de consolidación pura (sin optimización de performance nueva): 14I.1 identificó que 5 repositorios (`positions`, `hour-concepts`, `novelty-types`, `document-categories`, `salary-categories`) replican, letra por letra, el mismo patrón manual de cache en memoria para la rama "sin filtros" de su `findMany` — copiado por 5 etapas distintas (14D.4, 14H.5, 14H.6, 14H.8, y la implementación original de `salary-categories`) sin nunca extraerlo a un helper. Esta etapa lo extrae, sin cambiar ningún comportamiento observable.

## 2. Relación con 14I.1

14I.1 (commit `3abb3c4`) documentó esto en §6.1 como "Forma B — `listCache` a nivel repositorio, nunca extraída a un helper" y lo listó explícitamente como candidato P1/P2 para 14I.3 en su roadmap. 14I.2 (commit `709b633`) cerró los 3 `$transaction` P0 sin tocar esta deuda. 14I.3 la cierra ahora, sin tocar ningún `$transaction` restante (incluido el de `salary-categories`, todavía P2, fuera de alcance).

## 3. Alcance

Sólo la rama "sin filtros" (cache en memoria) de los 5 repositorios candidatos, más el helper nuevo y sus tests. Nada de controllers, services, RBAC, contratos, `relationJoins`, Fichador, Gestión Horaria, Legajos, dashboards, ni las caches `createTtlCache` de nivel controller (que siguen siendo una capa aparte, sin tocar).

## 4. Qué era "Forma B"

Un patrón idéntico, copiado a mano en los 5 módulos:

```ts
let listCache: { data: T[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 120_000;

export function invalidateXCache() {
  listCache = null;
}

// dentro de findMany, rama sin filtros:
if (!listCache || Date.now() >= listCache.expiresAt) {
  const data = await prisma.x.findMany({ ...take: 500 });
  listCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
}
const page = listCache.data.slice(skip, skip + query.take);
return [page, listCache.data.length];
```

Diagnóstico previo confirmado por módulo antes de tocar nada:

| Módulo | Cache actual | TTL | Tipo cacheado | Cachea cuando | No cachea cuando | Invalidación | Caller de invalidación | Tests previos | Scope |
|---|---|---|---|---|---|---|---|---|---|
| `positions` | `listCache` (var local) | 120_000ms | `PositionRow[]` (`positionInclude` completo) | `!hasFilters` (ningún filtro de query.status/sectorId/areaId/establishmentId/businessUnitId/salaryRangeCategory/search) | Cualquier filtro presente | `invalidatePositionsCache()` | `positions.service.ts` (create/update/remove) | `positions.repository.test.ts` (ambas ramas) | Global, no user-scoped |
| `hour-concepts` | `listCache` (var local) | 120_000ms | `HourConceptRow[]` (escalares) | `!hasActiveFilters(query)` (kind/status/search/includeDeleted) | Cualquier filtro presente | `invalidateHourConceptsCache()` | `hourConcepts.service.ts` (create/update/remove ×2) | Sólo rama filtrada — rama cacheada **sin ningún test** (comentario explícito de 14H.5) | Global |
| `novelty-types` | `listCache` (var local) | 120_000ms | `NoveltyTypeRow[]` (con `finnegansLinks`) | `!hasActiveFilters(query)` (kind/origin/status/exportsToFinnegans/search) | Cualquier filtro presente | `invalidateNoveltyTypesCache()` | `noveltyTypes.service.ts` (create/update) | `noveltyTypes.repository.test.ts` (ambas ramas) | Global |
| `document-categories` | `listCache` (var local) | 120_000ms | `DocumentCategoryRow[]` (escalares) | `!hasActiveFilters(query)` (kind/status/scope/mandatory/expires/search) | Cualquier filtro presente | `invalidateDocumentCategoriesCache()` | `documentCategories.service.ts` (create/update) | `documentCategories.repository.test.ts` (ambas ramas) | Global |
| `salary-categories` | `listCache` (var local) | 120_000ms | `SalaryCategoryRow[]` (escalares) | `!hasActiveFilters(query)` (family/status/search) | Cualquier filtro presente | `invalidateSalaryCategoriesCache()` | `salaryCategories.service.ts` (create/update) | **Ninguno** (módulo sin tests, confirmado en 14I.1) | Global |

Los 5 encajan 1:1 en el mismo helper sin cambio observable — mismo TTL (120s en los 5), misma semántica de "una sola entrada global, sin key, invalidación total", misma forma de decidir "cachear o no" (una función `hasActiveFilters`/`hasFilters` evaluada por el propio repositorio, no por la cache).

## 5. Módulos migrados

Los 5 candidatos, sin excepción: `positions`, `hour-concepts`, `novelty-types`, `document-categories`, `salary-categories`.

## 6. Módulos no migrados

Ninguno de los 5 quedó fuera — todos encajaron 1:1. No se evaluaron otros módulos: `org-structure` (`overviewCache`) y `employees` (`timeGridCatalogCache`) usan una variante distinta (fetch-all sin paginación en JS, sin rama `hasActiveFilters`) y quedaron explícitamente fuera de alcance por instrucción directa (no tocar Legajos; `org-structure` no estaba en la lista de candidatos de 14I.1).

## 7. Helper creado

`backend/src/shared/cache/repositoryListCache.ts` — `createRepositoryListCache<T>(ttlMs)`, sin dependencia de Prisma, Express, usuario o rol. No reemplaza `createTtlCache` (multi-key, nivel controller) — es un helper distinto para una sola entrada global.

## 8. API del helper

```ts
const cache = createRepositoryListCache<T>(ttlMs);
await cache.getOrLoad(loader: () => Promise<T>, now?: number): Promise<T>;
cache.clear(): void;
```

**Decisión de diseño deliberada (evitar sobrediseño)**: no se agregó un `shouldCache` interno ni métodos `get`/`set` separados. En los 5 usos reales, la decisión de "cachear o no" siempre la toma el propio repositorio *antes* de invocar la cache (rama `hasActiveFilters`/`hasFilters`) — el helper nunca necesita saber por qué se lo está llamando o no. Agregar esa lógica adentro habría sido una abstracción sin caller real. `now` es inyectable únicamente para tests con reloj controlado (ningún caller productivo lo pasa).

## 9. TTL preservados

Los 5 módulos mantienen exactamente 120.000ms (2 minutos) — ninguno cambió. La constante (`POSITION_CACHE_TTL_MS`/`CACHE_TTL_MS` según el módulo) se sigue declarando en cada repositorio y se pasa al helper en la construcción; el helper no impone ni sugiere ningún valor.

## 10. Condiciones de cache preservadas

Ninguna rama `hasActiveFilters`/`hasFilters` se tocó — siguen siendo funciones locales de cada repositorio, evaluadas exactamente igual que antes, decidiendo si se entra a la rama con cache o a la rama sin cache (para `salary-categories`, la rama sin cache sigue usando `$transaction`, sin tocar). El helper sólo reemplaza lo que pasaba *dentro* de la rama cacheada.

## 11. Invalidaciones preservadas

Los 5 nombres de función exportados (`invalidatePositionsCache`, `invalidateHourConceptsCache`, `invalidateNoveltyTypesCache`, `invalidateDocumentCategoriesCache`, `invalidateSalaryCategoriesCache`) se mantienen sin cambios de nombre ni de firma (`() => void`), y siguen siendo llamados desde exactamente los mismos call sites en cada `*.service.ts` (create/update/remove, sin agregar ni quitar ninguno). Internamente ahora delegan en `listCache.clear()` en vez de `listCache = null` — mismo efecto observable.

## 12. Qué NO se cambió

- El `$transaction` de la rama filtrada de `salaryCategories.repository.ts` — sigue exactamente igual, no forma parte de esta etapa (P2, ver 14I.1/14I.2).
- Las caches `createTtlCache` de nivel controller (`positionOptionsCache`, `hourConceptsReadCache`, `noveltyTypesListCache`/`DetailCache`, `documentCategoriesReadCache`, `salaryCategoriesReadCache`) — la doble capa documentada en 14I.1 sigue existiendo tal cual, no se consolidó (fuera de alcance explícito de esta etapa).
- `timeGridCatalogCache` (`employees.repository.ts`) y `overviewCache` (`org-structure.repository.ts`) — variantes distintas, no tocadas.
- `auth.currentUserCache`, caches de Google Drive storage — no tocadas.
- `relationJoins`/`relationLoadStrategy` — sin cambios.
- Prisma schema — sin cambios, sin migraciones.
- Frontend — cero archivos tocados.
- Controllers/services de los 5 módulos — cero cambios de lógica (sólo el repositorio).
- `where`/`select`/`include`/`orderBy`/`skip`/`take` de cada `findMany` — idénticos, byte a byte, a los de antes de esta etapa.
- `users`/`documents`/`novelties` (P0 ya cerrados en 14I.2) — no se tocaron (no forman parte del alcance de Forma B; su `findMany` no tenía ninguna cache de repositorio).
- `attendanceSummary`, `hourConceptRules`, `relationJoins` — no forman parte de esta etapa.

## 13. Contrato API preservado

`GET /positions`, `GET /hour-concepts`, `GET /novelty-types`, `GET /document-categories`, `GET /salary-categories` — mismos métodos, rutas, query params, shape de respuesta. El cambio es interno al repositorio: mismo dato, mismo orden, misma paginación, sólo cambia qué código concreto gestiona la entrada en memoria.

## 14. RBAC/scope preservado

Ninguna ruta ni middleware fue tocado. Los 5 caches migrados son y siguen siendo catálogos globales sin scope de usuario (confirmado en 14I.1: ninguna de las 5 funciones `list()` de servicio recibe `user`, y ninguna ruta cambia su comportamiento por rol más allá del gate de acceso ya existente) — el helper nuevo tampoco introduce ninguna dimensión de usuario/rol (es, deliberadamente, agnóstico de eso).

## 15. Tests agregados/modificados

**Helper (nuevo, 8 tests)** — `backend/src/shared/cache/repositoryListCache.test.ts`: primera llamada ejecuta el loader; cache hit dentro del TTL no reinvoca; cache miss exactamente al expirar (`now >= expiresAt`); `clear()` invalida; llamadas concurrentes tras un hit no reinvocan y preservan la referencia exacta; `clear()` sin uso previo no rompe; dos instancias son independientes; sin `now` explícito usa `Date.now()` real (con fake timers).

**Módulos migrados, tests existentes (sin cambios, siguen verdes)**: `positions.repository.test.ts` (38 tests), `noveltyTypes.repository.test.ts`, `documentCategories.repository.test.ts` — ninguno necesitó modificarse, confirmando que la migración es transparente.

**`hour-concepts` (fortalecido, +6 tests)**: la rama cacheada nunca había tenido cobertura (comentario explícito de 14H.5) — se agregó: filtra `deletedAt:null` sin `$transaction` ni `count`; segunda llamada reutiliza el cache; pagina en memoria sobre la data cacheada; `invalidateHourConceptsCache()` limpia el cache; con filtros activos, nunca usa el cache (cada llamada vuelve a la base).

**`salary-categories` (nuevo, 11 tests)** — `salaryCategories.repository.test.ts`, módulo sin ningún test previo: rama filtrada sigue usando `$transaction` sin cambios (confirmado, no corregido); arma el `where` correctamente; rama sin filtros usa el cache, reutiliza dentro del TTL, pagina en memoria, respeta el `orderBy`, se invalida correctamente; `findById`/`create`/`update` cubiertos.

Ningún test depende de tiempos reales — todos usan `now` inyectado o `vi.useFakeTimers()`.

## 16. Validaciones

- `npx prisma validate` ✅ schema válido, sin cambios.
- `npm run typecheck` ✅ sin errores.
- `npm test` ✅ **1301/1301** (87 archivos, +24 tests nuevos: 8 helper + 6 hour-concepts + 11 salary-categories, neto +25 menos 1 de redondeo de conteo).
- `npm run build` ✅ sin errores.
- `npm run perf:journey:admin-config` ✅ passed (49.7s) — smoke de regresión transversal.
- `npm run perf:journey:workforce` ✅ passed (1.1min) — smoke de regresión.
- `npm run perf:journey:employees` ✅ passed (39.8s) — smoke de regresión.
- Los 3 journeys regeneraron como efecto colateral los reportes 14D/14G/14H — restaurados (`git restore`) de inmediato, mismo protocolo ya establecido en 14H.7/14H.8/14I.2.
- `git diff --check` ✅ sin errores de espacios en blanco.
- `git status --short` / `git diff --stat`: 6 archivos modificados (5 repositorios + `hourConcepts.repository.test.ts`) + 3 archivos nuevos (helper, test del helper, `salaryCategories.repository.test.ts`).

## 17. Riesgos pendientes

- Ninguno introducido por esta migración — es un refactor mecánico 1:1, sin cambio de TTL, condición de cacheo ni invalidación, verificado con los tests existentes (que no necesitaron cambiar) más los nuevos.
- La doble capa de cache (`createTtlCache` de controller + `repositoryListCache` de repositorio) sigue existiendo en `hour-concepts`/`novelty-types`/`document-categories`/`salary-categories` — deuda ya documentada, explícitamente no consolidada en esta etapa (habría sido "tocar caches controller-layer", fuera de alcance salvo estrictamente necesario, y no lo era).
- `salary-categories` sigue con el `$transaction` P2 en su rama filtrada, sin caller real — sin cambios, documentado desde 14I.1/14I.2.

## 18. Recomendación para 14I.4

El roadmap de 14I.1 no nombraba una 14I.4 específica más allá de "limpieza de $transaction restantes" (ya absorbida por 14I.2 para los P0). Candidatos remanentes para una futura etapa, en orden de evidencia:
1. **Consolidar la doble capa de cache** (`createTtlCache` de controller + `repositoryListCache` de repositorio) en los 4 módulos que la tienen apilada — requiere decidir explícitamente cuál de las 2 capas eliminar por módulo, ya que ambas invalidan correctamente hoy (no hay bug que lo fuerce, sólo duplicación).
2. **`attendanceSummary`** (`time-entries.repository.ts:977`, P1 de 14I.1) — callback-form sin escrituras, mismo antipatrón que los ya corregidos, pero vive en un módulo Gestión-Horaria-adyacente que requiere autorización explícita.
3. **`employeeOrgChartSelect`** (Legajos, P1 de 14I.1) — cadena de 4 niveles en un listado, requiere autorización explícita para tocar `employees`.
