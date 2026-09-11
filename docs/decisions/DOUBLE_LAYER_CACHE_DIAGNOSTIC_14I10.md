# Etapa 14I.10 — Diagnóstico de la doble capa de cache controller + repository

## 1. Resumen ejecutivo

Los 4 módulos candidatos (`hour-concepts`, `novelty-types`, `document-categories`, `salary-categories`) tienen, confirmado por lectura de código, **exactamente la misma doble capa**: una cache Forma A (`createTtlCache`, controller-layer, TTL 60s, key = `req.originalUrl`/`id`) envolviendo una cache Forma B (`createRepositoryListCache`, repository-layer, TTL 120s, sin key — una sola entrada global para la rama "sin filtros"). Ambas capas se invalidan **siempre juntas**, de forma síncrona, en el mismo `create`/`update`/`remove` — confirmado por grep exhaustivo que no existe ningún mutador indirecto ni ningún caller que escriba estas 4 tablas fuera de su propio módulo.

**La doble capa no es redundancia accidental**: se demostró con 4 tests nuevos (uno por módulo, ver §13) que la cache de repositorio sirve, desde una única lectura real a la base, a **cualquier `originalUrl` que no dispare `hasActiveFilters`** — incluyendo distintas páginas/`take` de la misma lista sin filtros, que la cache de controller (keyeada por `originalUrl` exacto) trataría como entradas separadas. Es un mecanismo real, no cosmético. Su impacto práctico HOY es modesto porque los 4 catálogos son fetch-all de un solo tiro desde el frontend (`take` fijo, sin paginación real en la UI) y además tienen su propia cache de 5-10 minutos en el cliente — pero el mecanismo backend sigue siendo la defensa real contra picos de tráfico concurrente (muchos usuarios entrando casi al mismo tiempo) o contra cualquier futuro cambio de UI que sí pagine.

**Conclusión**: Resultado A — doble capa justificada, con valor real y demostrado, impacto práctico bajo dado el volumen/uso actual. No se recomienda consolidar. Se agregaron 26 tests nuevos (0 tocan producción) cerrando el gap de cobertura de controller-cache que quedaba en 3 de los 4 módulos.

## 2. Contexto 14I.1 / 14I.3 / 14I.6 / 14I.7

- **14I.1** (`3abb3c4`) documentó por primera vez el "apilamiento de A+B sobre el mismo recurso" en `hour-concepts`/`novelty-types`/`document-categories`/`salary-categories` (§6.1 punto 3), como deuda de consistencia arquitectónica — "funciona (sin bug), pero es la deuda repetida 3 veces (14H.5/14H.6/14H.8), nunca consolidada a propósito ('sería un refactor sin un bug detrás que lo justifique')".
- **14I.3** (`66c84f4`) extrajo la Forma B a `createRepositoryListCache` (helper compartido) en los 5 módulos que la tenían copiada a mano (los 4 de acá + `positions`), **sin tocar la Forma A de controller ni consolidar la doble capa** — explícitamente fuera de alcance ("habría sido tocar caches controller-layer").
- **14I.6** (`c04c718`) agregó tests reales de cache a `employees`/`documents`/`novelties` — no tocó ninguno de estos 4 módulos.
- **14I.7** (`75775ab`) agregó tests reales a `ttlCache.ts` (helper base) + `users`/`salary-categories` — cerró el gap de controller-cache de `salary-categories`, pero dejó `hour-concepts`/`novelty-types`/`document-categories` sin ningún test de controller-cache.

Esta etapa es la primera en diagnosticar la doble capa en sí (no sólo nombrarla), con evidencia nueva (los 4 tests de "páginas comparten cache", §13) que ninguna etapa anterior había producido.

## 3. Módulos auditados

Los 4 nombrados por el pedido: `hour-concepts`, `novelty-types`, `document-categories`, `salary-categories`. Se confirmó por grep que son los únicos 4 con la doble capa exacta (Forma A controller + Forma B repositorio sobre el mismo recurso) — `positions` tiene Forma B en el repositorio pero su única cache de controller (`positionOptionsCache`) cachea un endpoint **distinto** (`/positions/options`, no el listado principal), así que no está apilada sobre el mismo recurso; `audit-parameters` tiene sólo Forma A (sin Forma B, endpoint siempre paginado/filtrado). Confirmado, no se auditó ningún módulo adicional.

## 4. Tabla por módulo

| Módulo | Cache controller | TTL controller | Key controller | Invalidación controller | Cache repositorio | TTL repo | Key repo | Invalidación repo | Tests antes | Tests después | Callers reales del repo fuera del controller |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `hour-concepts` | `hourConceptsReadCache` | 60s | `req.originalUrl` | `.clear()` inline en `create`/`update`/`remove` (controller.ts) | `listCache` (`createRepositoryListCache`) | 120s | ninguna (entrada única) | `invalidateHourConceptsCache()` desde `service.create`/`update`/`remove` | 0 (el único test de controller existente cubre otra cosa) | +7 | Ninguno — único caller: `hourConceptsService.list` |
| `novelty-types` | `noveltyTypesListCache` + `noveltyTypesDetailCache` | 60s c/u | `req.originalUrl` / `id` | `.clear()` de ambas inline en `create`/`update` | `listCache` | 120s | ninguna | `invalidateNoveltyTypesCache()` desde `service.create`/`update` | 0 (sin archivo de controller) | +9 | Ninguno — único caller: `noveltyTypesService.list` |
| `document-categories` | `documentCategoriesReadCache` | 60s | `req.originalUrl` | `.clear()` inline en `create`/`update` | `listCache` | 120s | ninguna | `invalidateDocumentCategoriesCache()` desde `service.create`/`update` | 0 (sin archivo de controller) | +6 | Ninguno — único caller: `documentCategoriesService.list` |
| `salary-categories` | `salaryCategoriesReadCache` | 60s | `req.originalUrl` | `.clear()` inline en `create`/`update` | `listCache` | 120s | ninguna | `invalidateSalaryCategoriesCache()` desde `service.create`/`update` | 6 (14I.7) | 6 (sin cambios) | Ninguno — único caller: `salaryCategoriesService.list` |

## 5. Endpoint/caller por módulo

| Módulo | Ruta | Controller→Service→Repository | Caller frontend real | Cache frontend | Dedupe frontend |
|---|---|---|---|---|---|
| `hour-concepts` | `GET /hour-concepts` | `hourConceptsController.list` → `hourConceptsService.list` → `hourConceptsRepository.findMany` | `hourConceptApiService.getAll()` — fetch-all, `take=200` fijo, sin paginación en la UI; llamado desde `HourConceptsPage.tsx`, `NoveltyModal.tsx`, `timeEntryApiService.ts`, `employeeApiService.ts` | `cachePolicies.hourConceptsCatalog`, 10min, persistida en IndexedDB | Sí, vía `cachedData` |
| `novelty-types` | `GET /novelty-types` | `noveltyTypesController.list`/`getById` → `noveltyTypesService` → `noveltyTypesRepository` | `noveltyTypeApiService.getAll()` — fetch-all, `take=200` fijo; llamado desde `NoveltyTypesPage.tsx`, `NoveltyModal.tsx`, `NoveltyTypeDetailPage.tsx`, `NoveltyTypeCreatePage.tsx`, `EmployeeHoursPage.tsx` | `cachePolicies.noveltyTypesCatalog`, 10min, persistida | Sí |
| `document-categories` | `GET /document-categories` | `documentCategoriesController.list` → `documentCategoriesService.list` → `documentCategoriesRepository.findMany` | `documentCategoryApiService.getAll()` — fetch-all, `take=300` fijo; llamado desde `DocumentCategoriesPage.tsx`, `EmployeeHoursPage.tsx` | `cachePolicies.documentCategoriesCatalog`, 10min, persistida | Sí |
| `salary-categories` | `GET /salary-categories` | `salaryCategoriesController.list` → `salaryCategoriesService.list` → `salaryCategoriesRepository.findMany` | `salaryCategoryApiService.getAll()` — fetch-all, `take=300` fijo; llamado desde `PuestoSalaryRangeTab.tsx`, `laborOptions.ts` | `cachePolicies.salaryCategoriesCatalog`, 5min, persistida | Sí |

**Nota transversal**: los 4 frontends usan `take` fijo, hard-codeado en el propio `apiService`, sin exponer paginación en la UI (mismo patrón "fetch-all de vocabulario cerrado" documentado desde `9E`). Ningún caller pasa `page`/`take` distinto — la única forma real de variar el `originalUrl` de la rama sin filtros hoy es que 2 módulos distintos del frontend llamen a `getAll()` en momentos distintos (ambos producen el mismo `originalUrl` exacto, así que en la práctica caen en la MISMA entrada de ambas caches, no en entradas distintas).

## 6. Flujo actual de cache

```
GET /hour-concepts (sin filtros)
  → hourConceptsController.list
      → hourConceptsReadCache.get(originalUrl)
          HIT  → responde inmediatamente, NUNCA llega al service/repositorio/DB
          MISS → hourConceptsService.list(query)
              → hourConceptsRepository.findMany(query)
                  → hasActiveFilters(query)? 
                      SÍ  → Promise.all([findMany, count]) directo a la DB, sin ninguna cache
                      NO  → listCache.getOrLoad(() => prisma.hourConcept.findMany({take:500}))
                              HIT  → devuelve el array cacheado (120s), pagina en memoria
                              MISS → pega a la DB, guarda en listCache, pagina en memoria
              ← [items, total]
          ← {items, meta}
      → hourConceptsReadCache.set(originalUrl, result)
  ← res.json({data, meta})
```

Mismo flujo, mismos 2 escalones, en los 4 módulos.

## 7. Valor real de la cache de controller

- Evita entrar al service/repositorio por completo en un hit — el camino más corto posible (1 `Map.get()`, sin ninguna otra ejecución).
- Cachea el shape HTTP final ya armado (`{items, meta}`), aunque en estos 4 módulos ese armado es trivial (sin transformación/redacción — confirmado leyendo los 4 `service.list()`, ninguno hace más que envolver `[items, total]` en `{items, meta}`).
- Es el mismo patrón (`createTtlCache`) que usan ~30 caches más del proyecto — consistencia arquitectónica, no un caso especial.
- **No cachea por usuario/rol** en ninguno de los 4 (confirmado correcto: ninguno de los 4 `service.list()` recibe `user`, el dato es un catálogo global) — coherente con lo ya verificado en 14I.1.

## 8. Valor real de la cache de repositorio

- **Confirmado con evidencia nueva (4 tests, uno por módulo, ver §13)**: sirve múltiples `originalUrl` distintos (cualquier combinación de `page`/`take` que no dispare `hasActiveFilters`) desde una única lectura real a la base — algo que la cache de controller, keyeada por `originalUrl` exacto, no puede lograr por sí sola.
- **No tiene ningún caller fuera del controller de su propio módulo** (confirmado por grep exhaustivo, §4) — a diferencia de lo que 14I.1 dejaba abierto como posibilidad ("puede servir a services internos"), en la práctica ninguno de los 4 repositorios es consumido por otro módulo.
- Su valor real hoy, dado que los 4 frontends piden siempre el mismo `originalUrl` exacto (§5), se reduce a: **extender la ventana efectiva de cache de 60s (controller) a 120s (repositorio)** para tráfico concurrente/repetido — cuando la cache de controller expira, la de repositorio todavía puede estar vigente, evitando la query a la DB en ~la mitad de esas expiraciones.

## 9. Riesgo de stale

- **TTL máximo real con doble capa**: 120s (el de repositorio) — no se suman ni se multiplican, porque ambas se invalidan siempre juntas (§10). El TTL más largo sólo importa si la invalidación fallara, lo cual no ocurre en el código actual.
- **¿Una capa puede renovar sobre datos viejos de la otra?** No — se rastreó la secuencia exacta de cada mutador (`await service.create()` completa TODAS sus escrituras + `invalidateXCache()` + auditoría ANTES de que el controller ejecute su propio `.clear()`) — no hay ninguna ventana donde una capa se repueble con el dato viejo de la otra.
- **¿El stale efectivo puede ser mayor al TTL declarado?** No — confirmado, ambas capas se limpian siempre en la misma cadena síncrona de cada mutación real.
- **¿Puede un usuario ver datos viejos después de mutar?** No, en el flujo normal — la única ventana de inconsistencia posible es la misma que tiene cualquier cache TTL bajo concurrencia real (una request GET que ya estaba "en vuelo" cuando llega un POST/PATCH concurrente puede recibir la respuesta que empezó a construir antes de la mutación) — no es un defecto de la doble capa, es inherente a cualquier cache en memoria bajo concurrencia, igual en los otros ~30 casos del proyecto.

## 10. Riesgo de invalidación

Ninguno confirmado. Se auditaron los 3 mutadores de cada uno de los 4 módulos (`create`/`update`, más `remove` en `hour-concepts`) y se confirmó, por lectura directa de código:
- Cada mutador invalida **ambas** capas, siempre, en el mismo call chain síncrono (repo primero, vía el service; controller después, vía el propio handler).
- **Cero mutadores indirectos**: grep exhaustivo de `prisma.hourConcept.update/create/delete`, `prisma.noveltyType.*`, `prisma.documentCategory.*`, `prisma.salaryCategory.*` en **todo** `backend/src` confirma que ninguna de las 4 tablas se escribe desde ningún módulo que no sea el suyo propio.
- **Cero bypass del service**: grep de `hourConceptsRepository.create/update/delete/softDelete` (y equivalentes en los otros 3) confirma que sólo el service de cada módulo llama a esas funciones — no hay ningún otro caller que pueda mutar sin disparar `invalidateXCache()`.

## 11. Riesgo de seguridad/scope

Ninguno. Los 4 `service.list()` no reciben `user` — ninguna de las 8 entradas de cache (4 controller + 4 repositorio) tiene una dimensión de usuario/rol que pueda "mezclarse". Mismo catálogo para todos los roles que acceden a cada endpoint (confirmado ya en 14I.1, re-confirmado acá).

## 12. Impacto performance

- **¿La doble capa mejora algo real?** Sí, de forma modesta hoy: extiende la ventana efectiva de protección de la DB de 60s a 120s bajo tráfico concurrente/repetido, y (mecanismo demostrado, aunque no ejercitado por el frontend actual) protegería contra un futuro cambio de UI que sí pagine estos catálogos.
- **¿La cache de repositorio aporta cuando la de controller ya existe?** Sí — protege específicamente el escenario "la cache de controller expiró pero la de repositorio todavía no", y el escenario (hoy teórico) de `originalUrl` distintos sobre el mismo dataset sin filtros.
- **¿Hay callers no-HTTP que aprovechen la cache de repositorio?** No, confirmado — cero callers fuera del propio controller (§4/§8).
- **¿Eliminar la cache de repositorio aumentaría las queries a la DB?** Sí, medible: cada expiración de la cache de controller (cada 60s bajo tráfico sostenido) volvería a pagar el `findMany({take:500})`/`{take:100}`/`{take:300}` completo, en vez de servirse de memoria hasta la mitad de esas veces.
- **¿Eliminar la cache de controller aumentaría el trabajo del service?** Mínimamente — el `service.list()` de los 4 módulos no hace ninguna transformación pesada (sólo arma `{items, meta}`), así que el costo adicional de siempre pasar por el service/repositorio (con la cache de repositorio todavía protegiendo la DB) sería un `Map.get()` extra + una función de armado trivial — no medible en la práctica.
- **Volumen real**: sigue siendo el mismo "vocabulario cerrado chico" documentado desde `9E` (HourConcept/NoveltyType/DocumentCategory de pocas decenas de filas) — el impacto absoluto de cualquiera de las 2 capas, presente o ausente, es bajo en términos absolutos hoy.

## 13. Impacto mantenibilidad

- **Código duplicado**: sí, literal — los 4 módulos repiten la misma estructura (`createTtlCache` en controller + `createRepositoryListCache` en repositorio + `.clear()` inline + función `invalidateXCache()` exportada) sin ninguna variación real entre ellos. Ya extraído a helpers compartidos (`ttlCache.ts`/`repositoryListCache.ts`) desde 14I.3 — lo que queda duplicado es el **patrón de uso** (2 capas sobre el mismo recurso), no la implementación del cache en sí.
- **Dificultad de entender invalidaciones**: baja-media — un desarrollador nuevo tiene que mirar 2 archivos (controller + service, a veces repositorio) para confirmar que un mutador invalida TODO lo necesario, en vez de 1 solo lugar. Mitigado por el patrón siendo idéntico en los 4 módulos (una vez que se entiende uno, se entienden los 4).
- **Dificultad de testear**: confirmada como el costo real más concreto — antes de esta etapa, 3 de los 4 módulos (`hour-concepts`/`novelty-types`/`document-categories`) no tenían NINGÚN test de la capa de controller, mientras que la capa de repositorio sí estaba bien testeada desde 14I.3. Cerrado en esta misma etapa (§14).
- **Costo de eliminar una capa**: bajo técnicamente (ambas capas son independientes, ninguna depende de la otra para funcionar) — el costo real sería de **decisión de producto/arquitectura** (cuál conservar, ver §15), no de esfuerzo de implementación.

## 14. Cambios aplicados

**Cero cambios de código productivo.** Se agregaron **26 tests nuevos**, en 7 archivos (3 nuevos, 4 modificados de forma puramente aditiva):

- `backend/src/modules/hour-concepts/hourConcepts.readCache.test.ts` (**nuevo**, 7 tests): hit/miss, query variance, invalidación vía `create`/`update`/`remove` de `hourConceptsReadCache` — mismo patrón que `salaryCategories.controller.test.ts` (14I.7). No se tocó `hourConcepts.controller.test.ts` (ya existía, cubre otra cosa — invalidación cruzada de `employeeDetailCache` vía router HTTP real — estilo distinto, se dejó intacto).
- `backend/src/modules/novelty-types/noveltyTypes.controller.test.ts` (**nuevo**, 9 tests, el módulo no tenía ninguno): hit/miss + query variance de `noveltyTypesListCache`, hit/miss + id variance de `noveltyTypesDetailCache`, invalidación de ambas vía `create`/`update`.
- `backend/src/modules/document-categories/documentCategories.controller.test.ts` (**nuevo**, 6 tests, el módulo no tenía ninguno): hit/miss, query variance, invalidación vía `create`/`update` de `documentCategoriesReadCache`.
- `backend/src/modules/hour-concepts/hourConcepts.repository.test.ts`, `noveltyTypes.repository.test.ts`, `documentCategories.repository.test.ts`, `salaryCategories.repository.test.ts` (**modificados, +1 test cada uno, 4 en total**): confirman con evidencia real que 2 llamadas con `page` distinto (`page:1` y `page:2`, ambas sin filtros activos) comparten el `listCache` de repositorio — una sola lectura real a la base para ambas. Es la evidencia central del hallazgo de §8/§12.

Todos los tests mockean sólo el service (nunca la cache bajo prueba) o usan el mock de `prisma` ya existente en cada archivo — ninguno mockea `ttlCache`/`repositoryListCache`.

## 15. Qué NO se cambió

- Ningún `*.controller.ts`, `*.service.ts`, `*.repository.ts` de los 4 módulos — cero líneas de producción tocadas.
- TTL (60s/120s), keys (`originalUrl`/`id`/ninguna), invalidaciones (`.clear()` inline, `invalidateXCache()` exportada) — sin cambios en ninguna de las 8 caches.
- `hourConcepts.controller.test.ts` (existente) — no se tocó, se mantuvo intacto.
- El `$transaction` P2 de la rama filtrada de `salaryCategories.repository.ts` (sin caller real, documentado desde 14I.1/14I.2/14I.3/14I.7) — sin cambios, no forma parte de esta etapa.
- `timeGridCatalogCache`, `includeDetails` (14I.8/14I.9) — no se tocaron, explícitamente fuera de alcance.
- Contrato API, shape de respuesta, RBAC/scope — sin cambios en ninguno de los 4 módulos.
- Frontend (`HourConceptsPage.tsx`, `NoveltyTypesPage.tsx`, `DocumentCategoriesPage.tsx`, `PuestoSalaryRangeTab.tsx`, y los 4 `*ApiService.ts`) — sólo leídos para confirmar caller/cache/dedupe, cero archivos modificados.
- Prisma schema, `relationJoins`, Fichador, Gestión/Carga Horaria, Legajos, Puestos — nada de esto se tocó ni se ejerció.
- No se ejecutó ninguna escritura real, no se creó ningún dato, no se corrió ningún journey.

## 16. Recomendación final

**Conservar la doble capa en los 4 módulos, sin consolidar.** No es redundancia accidental: la cache de repositorio demuestra un mecanismo real (compartir el dataset sin filtros entre distintos `originalUrl`, extender la ventana efectiva de protección de la DB de 60s a 120s) que la cache de controller sola no puede replicar, y su costo de mantenimiento — una vez que ambas están bien testeadas (esta etapa cierra ese gap) — es bajo y uniforme entre los 4 módulos. No se identificó ningún escenario real de stale peligroso, mezcla de scope, ni invalidación inconsistente.

- **No eliminar la cache de controller**: es el patrón estándar del proyecto (~30 casos), y sin ella se pierde el camino más corto de respuesta (aunque el costo de no tenerla sería bajo dado que el service es liviano).
- **No eliminar la cache de repositorio**: es la que realmente protege contra escaneos de `originalUrl` variable y contra cualquier futuro cambio de frontend que pagine estos catálogos — eliminarla reintroduciría el riesgo que 14I.3 ya se tomó el trabajo de consolidar en un helper compartido.
- **No cambiar TTLs**: 60s/120s ya están en el rango recomendado por `PERFORMANCE_STANDARDS.md` para "configuración con escritura ocasional".
- **Sólo documentar** (esta etapa) + cerrar el gap de tests que quedaba (hecho, §14). No se recomienda una etapa de refactor futura para consolidar — sería, en palabras de la propia 14I.1, "un refactor sin un bug detrás que lo justifique".

## 17. Plan recomendado para 14I.11

No hay una etapa de refactor de doble capa que recomendar (ver §16). Candidatos alternativos, en orden de evidencia, para una futura 14I.11:

1. **Invalidación de `timeGridCatalogCache`** (candidato B de 14I.8, todavía no autorizado) — sigue siendo el único hallazgo de cache verdaderamente pendiente del inventario original de 14I.1.
2. **Duplicado StrictMode de `GET /employees/:id/time-grid` (x3)** — nombrado por 14G.9, nunca cerrado, mismo caller que el fix de 14I.9.
3. **Cobertura de test de expiración real de TTL** (`ttlCache.test.ts` ya cubre esto desde 14I.7, pero `repositoryListCache` podría beneficiarse de un test explícito de "2 originalUrl distintos comparten cache" a nivel del propio helper, no sólo por módulo — bajo impacto, cosmético).
4. Si en algún momento se decide que el volumen real de alguno de estos 4 catálogos crece más allá de "vocabulario cerrado chico" (ver `PERFORMANCE_STANDARDS.md` §15 deudas pendientes), recién ahí valdría la pena revisar si la doble capa necesita evolucionar (p. ej. paginación real server-side) — no antes, sin evidencia de volumen real.

## 18. Validaciones

- `npx prisma validate` ✅ schema válido, sin cambios.
- `npm run typecheck` ✅ sin errores.
- `npm test` ✅ **1419/1419** (98 archivos, +26 tests nuevos vs. los 1393 de cierre de 14I.9).
- `npm run build` ✅ sin errores.
- `git diff --check` ✅ sin errores de espacios en blanco.
- `git status --short` / `git diff --stat`: 3 archivos nuevos + 4 archivos modificados de forma puramente aditiva (+66 líneas en total en los 4 archivos de repositorio, sin ninguna línea eliminada).
- No se corrieron journeys de Playwright ni se tocó frontend/e2e — no hacía falta, sólo se agregaron tests unitarios de backend con servicios mockeados o con el mock de `prisma` ya existente en cada archivo.
- No se ejecutó ninguna escritura real en ningún momento de esta etapa.
