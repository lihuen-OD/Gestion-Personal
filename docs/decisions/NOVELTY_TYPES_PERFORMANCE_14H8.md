# Etapa 14H.8 — Diagnóstico y optimización de Tipos de novedades

## 1. Contexto

Última etapa de la serie 14H sobre Configuración: 14H.1 (diagnóstico macro), 14H.2 (Regímenes laborales), 14H.3 (Turnos + Horas especiales), 14H.4 (Asignaciones de feriados), 14H.5 (Conceptos horarios), 14H.6 (Empresas y estructura + Categorías documentales + Parámetros de auditoría), 14H.7 (Puestos completo). 14H.8 cierra el último submódulo de Configuración pendiente de revisión con detalle: **Tipos de novedades** (`/configuracion/tipos-novedades`, `/configuracion/tipos-novedades/nuevo`, `/configuracion/tipos-novedades/:id`), explícitamente dejado como "candidato de profundización" por 14H.1 y re-listado como pendiente en las recomendaciones de 14H.6 y 14H.7.

## 2. Evidencia desde 14H.1-14H.7

- **14H.1** midió sólo el listado (`GET /novelty-types`, búsqueda/filtro 100% client-side) y dejó "Ver detalle de tipo de novedad" explícitamente fuera del alcance macro, anotando además `backendCache: "No"` para el módulo.
- **14H.5/14H.6** establecieron dos criterios reutilizados acá: (a) `$transaction([findMany,count])` → `Promise.all([...])` es la corrección estándar para lecturas independientes, aplicada ya 13+ veces; (b) **"sólo se corrige lo que tiene un caller real, verificado por grep"** — no optimizar una rama de código sin confirmar que algo la ejercita.
- **14H.6** corrigió 2 falsos negativos de 14H.1 sobre cache backend (`org-structure`, `document-categories`, que sí tenían cache backend pese a estar anotados como "No"). Esta etapa encuentra un tercer caso idéntico: **`novelty-types` también tenía cache backend desde antes de toda la serie 14H** (confirmado por `git log`, ver §4).
- **14H.7** estableció el patrón de journey de "3 rutas" (listado/detalle/creación) para un submódulo con página de detalle real, incluyendo cómo insertar zonas nuevas al final del recorrido sin reordenar las existentes.

## 3. Diagnóstico Tipos de novedades — resumen

A diferencia de Puestos (14H.7), este submódulo **no tenía sobre-fetch estructural ni fetches secuenciales dependientes** — el `include` (`{ finnegansLinks }`) es liviano desde siempre (nunca tuvo una cadena de relaciones profunda tipo `sector→area→establishment→businessUnit→company`), y tanto el listado como el detalle usan `cachedData` correctamente desde antes de esta etapa. El único hallazgo de código real es un `$transaction` en una rama que hoy no tiene ningún caller.

## 4. Carga inicial (`NoveltyTypesPage.tsx`)

- Un único fetch al montar: `noveltyTypeApiService.getAll()` (sin filtros), ya envuelto en `cachedData` (familia `novelty-types`, TTL 10min, persistido).
- Búsqueda y los 2 filtros (Tipo, Finnegans) son **100% client-side** (`matchesFilters`/`useMemo`) sobre el mismo fetch-all — mismo patrón ya documentado y aprobado en `docs/PERFORMANCE_STANDARDS.md` §6 para "vocabularios cerrados" (NoveltyType quedó fetch-all en la Etapa 9E con volumen confirmado, no supuesto). **No es un hallazgo a corregir** — coincide con el criterio ya establecido para catálogos administrados a mano de bajo volumen.
- Las 6 tarjetas resumen (`NoveltyTypeSummaryCards`) reusan el mismo array `all` del único fetch — a diferencia de Puestos antes de 14H.7, **nunca hubo un segundo fetch separado para las tarjetas**. No hay sobre-fetch que corregir acá.
- **Blanking**: no existe — `if (!apiItems) setIsLoadingApi(true)` sólo activa el loading grande en la carga inicial; un `refresh` (tras activar/inactivar) mantiene `apiItems` visible.
- **StrictMode/duplicados**: `getAll()` ya pasa por `cachedData` (dedupe de revalidaciones concurrentes) desde antes de esta etapa — confirmado en el journey: 0 duplicados para "Entrar a Tipos de novedades" en las 2 corridas de esta etapa.
- Sin paginación de servidor (fetch-all, `take=200` fijo) — correcto para este dato por la razón de §6 arriba, documentado, no un gap.

## 5. Detalle/modal (`NoveltyTypeDetailPage.tsx` / `NoveltyTypeCreatePage.tsx`)

- **No es un modal** — 100% navegación de página completa (`/configuracion/tipos-novedades/nuevo`, `/configuracion/tipos-novedades/:id`), confirmado en `App.tsx`. Editar es inline por pestaña (Identificación/Reglas operativas/Finnegans/Historial), sólo se persiste con "Guardar cambios" — abrir/navegar/cambiar de pestaña no ejecuta ninguna escritura.
- **Detalle**: un único fetch (`getById(id)`), **ya cacheado** vía `cachedData` (misma familia/policy que el listado) desde antes de esta etapa — a diferencia de `positionApiService.getAssignedEmployees` (antes de 14H.7), acá nunca hubo un `apiRequest` crudo. **No hay segundo fetch** — este módulo no tiene panel de "empleados vinculados" ni ningún otro dato anidado, así que no hay patrón secuencial que paralelizar (a diferencia de Puestos).
- Ninguna de las 4 pestañas dispara fetch propio (todas leen/mutan el mismo `item` ya cargado) — confirmado leyendo los 4 componentes de tab completos. Sin N+1, sin sobre-fetch, sin llamada auxiliar.
- **Creación**: un único fetch (`getAll()`, ya cacheado) usado sólo para calcular el próximo código correlativo — mismo patrón que `PuestoCreatePage.tsx` antes de 14H.7, pero acá **no hay una versión más liviana a la que migrar** (el `include` de este módulo ya es liviano; crear un endpoint "options" adicional para 1-2 columnas de diferencia sería sobre-ingeniería para un catálogo de este volumen).
- "Ocultar" (`Trash2` en el detalle) **no es un hard-delete** — no existe ninguna ruta `DELETE` en este módulo (`noveltyTypes.routes.ts`); es el mismo `PATCH` de status que "Activar/Inactivar". No hay lógica de "no borrar si tiene novedades asociadas" que revisar porque nunca se intenta un borrado real.

## 6. Uso transversal / call sites

Confirmado por grep sobre `noveltyTypeApiService\.` en todo `frontend/src` — **4 call sites reales**, ninguno pasa filtros a `getAll()`:

| Call site | Módulo | Método | Filtros pasados |
|---|---|---|---|
| `NoveltyTypesPage.tsx` | Tipos de novedades | `getAll()` | Ninguno |
| `NoveltyTypeCreatePage.tsx` | Tipos de novedades | `getAll()` (sólo para `getNextCode`) | Ninguno |
| `NoveltyModal.tsx` | **Novedades** (`/novedades`) | `getAll()`, dentro de `Promise.all([getAll(), hourConceptApiService.getAll()])` | Ninguno |
| `EmployeeHoursPage.tsx` | **Gestión Horaria** | `getAll()`, dentro de `Promise.all([noveltyApiService.getAll({employeeId}), getAll()])` | Ninguno |

**Ningún caller pasa `kind`/`origin`/`status`/`search`/`exportsToFinnegans`** — la rama filtrada del backend (`hasActiveFilters`) es, en la práctica, inalcanzable hoy desde el frontend. `NoveltyModal.tsx` y `EmployeeHoursPage.tsx` sí traen el catálogo completo (incluido `finnegansLinks`) sólo para un `<select>`/cross-reference — over-fetch real pero de bajo impacto dado el volumen confirmado del catálogo (vocabulario cerrado, §4) — **no se creó un endpoint liviano nuevo** para esto: el ahorro sería marginal (unas pocas filas, no cientos) y tocar `EmployeeHoursPage.tsx` requiere justificación explícita por estar en Gestión horaria (prohibido por defecto salvo caller real y cambio justificado) — no se consideró justificado dado el volumen.

**Nota separada, no tocada**: `employeeApiService.ts::getTimeGrid()` embebe su propio array `noveltyTypes` (reusa sólo el *mapper* `mapNoveltyTypeFromApi`, no el servicio de red) proveniente de una query Prisma **directa** en `backend/src/modules/employees/employees.repository.ts` que bypasea el módulo `novelty-types` por completo. Es un endpoint distinto (`employees`), fuera de alcance de esta etapa (Legajos, no tocar salvo dependencia directa inevitable) — documentado como observación arquitectónica, no como hallazgo a corregir acá.

**Invalidación**: `create()`/`update()` en `noveltyTypeApiService.ts` invalidan `invalidateCacheFamily("novelty-types", ...)` — cubre la única familia de cache existente, usada por los 4 call sites de arriba. Sin huecos de invalidación detectados.

## 7. Endpoints detectados

| Endpoint | Uso | Cambio en 14H.8 |
|---|---|---|
| `GET /novelty-types` (sin filtros) | Listado, Novedades, Gestión Horaria (todos fetch-all) | Sin cambios — ya usa `listCache` en memoria, sin `$transaction` |
| `GET /novelty-types` (con filtros) | Sin caller real hoy | `$transaction([findMany,count])` → `Promise.all([...])` |
| `GET /novelty-types/:id` | Detalle | Sin cambios — ya cacheado en ambos lados |
| `POST /novelty-types` | Alta | Sin cambios de contrato |
| `PATCH /novelty-types/:id` | Edición, activar/inactivar, ocultar | Sin cambios de contrato |

Sin `DELETE /novelty-types/:id` (no existe, confirmado en `noveltyTypes.routes.ts`).

## 8. Causa raíz

Único hallazgo real de código: `noveltyTypesRepository.findMany` usaba `prisma.$transaction([findMany, count])` en su rama con filtros — mismo antipatrón corregido 13+ veces en la serie, aquí sin ningún caller real que lo ejercite hoy (a diferencia de `documentCategories` en 14H.6, que sí tenía un caller real desde Gestión Horaria). El resto del diagnóstico (carga inicial, detalle, uso transversal, cache) no encontró ningún problema real — el módulo ya seguía los patrones correctos desde antes de esta etapa.

## 9. Cambios aplicados

### 9.1 Backend

- **`backend/src/modules/novelty-types/noveltyTypes.repository.ts`**: `findMany` (rama con filtros) — `prisma.$transaction([findMany, count])` → `Promise.all([...])`. `where`/`orderBy`/`skip`/`take` sin cambios. Aplicado por consistencia con el resto de la serie y porque el endpoint sigue siendo API pública validada (`GET /novelty-types?kind=...`), **no** porque un caller real lo ejercite hoy — ver §6 y §16 para la transparencia sobre este punto.
- Se agregó `backend/src/modules/novelty-types/noveltyTypes.repository.test.ts` (nuevo — el módulo no tenía ningún test hasta esta etapa): 6 tests cubriendo ambas ramas de `findMany` (con/sin filtros, `Promise.all` vs `$transaction`, cache en memoria) y `findById`.

### 9.2 Journey (`frontend/e2e/support/adminConfigurationJourney.ts` + `.test.ts` + `adminConfigurationPerformanceJourney.spec.ts`)

- Corregida la entrada de `SUBMODULE_INVENTORY` para "G. Tipos de novedades": `backendCache` pasó de `"No"` a describir la cache real de doble capa (repo `listCache` 120s + controller `noveltyTypesListCache`/`noveltyTypesDetailCache` 60s), y se documentó por qué no se corrigió el `$transaction` de la rama filtrada (sin caller real).
- Ampliado `SUBMODULE_INVENTORY`/`COVERAGE_MATRIX` con 2 zonas nuevas: **"O. Tipo de novedad (detalle)"** y **"P. Tipo de novedad (creación, sólo navegación)"** — mismo patrón que "M./N. Puesto" en 14H.1/14H.7, insertadas al final del recorrido (después de "N. Puesto (creación)") sin reordenar ninguna zona existente.
- Actualizado el test de invariantes (`adminConfigurationJourney.test.ts`): `SUBMODULE_INVENTORY` pasa de 14 zonas (A-N) a 16 (A-P); `COVERAGE_MATRIX` exige también las 2 zonas nuevas.
- Agregadas las acciones reales al spec: "Ver detalle de tipo de novedad" (dejó de estar `skip`eada en la zona G y pasó a medirse de verdad en la zona O), "Cambiar de pestaña en detalle de Tipo de novedad" (confirma que las pestañas no re-disparan requests), "Entrar a Crear tipo de novedad (sólo navegación, sin guardar)" y "Salir de Crear tipo de novedad sin guardar" (zona P) — todas read-only, ninguna toca "Guardar cambios"/"Guardar tipo"/"Activar/Inactivar/Ocultar".

## 10. Qué NO se cambió

- `NoveltyTypesPage.tsx`, `NoveltyTypeDetailPage.tsx`, `NoveltyTypeCreatePage.tsx`, ningún componente de tab — cero cambios de código frontend (el módulo ya estaba óptimo).
- `noveltyTypeApiService.ts`, `cachePolicy.ts` — sin cambios (la cache/dedupe ya existía y era correcta).
- `NoveltyModal.tsx` (Novedades) y `EmployeeHoursPage.tsx` (Gestión horaria) — ambos siguen llamando `getAll()` sin filtros, sin ningún endpoint liviano nuevo (evaluado y descartado, §6).
- `employeeApiService.ts::getTimeGrid()` / `employees.repository.ts` (Legajos) — fuera de alcance, sólo documentado como observación (§6).
- El resto de los submódulos ya cerrados: Regímenes laborales, Turnos, Horas especiales, Asignaciones de feriados, Conceptos horarios, Empresas y estructura, Categorías documentales, Parámetros de auditoría, Puestos — ninguno tocado.
- La rama sin filtros de `findMany` (`listCache`) — sin cambios, ya correcta.
- Prisma schema / migraciones — cero cambios.
- Diseño visual — cero cambios.
- RBAC/scope — cero cambios.
- No se ejecutó ninguna escritura real.

## 11. Contrato API preservado

`GET /novelty-types`, `GET /novelty-types/:id`, `POST /novelty-types`, `PATCH /novelty-types/:id` — mismos métodos, mismas rutas, mismos query params, mismo shape de respuesta. El único cambio de código (`$transaction`→`Promise.all`) es transparente para el caller (mismo resultado, mismo orden).

## 12. RBAC/scope preservado

Sin cambios en `noveltyTypes.routes.ts`: `GET /` y `GET /:id` siguen bajo `requireAuth` sin rol adicional; `POST`/`PATCH` siguen bajo `requireAnyRole(adminRoles)`. Sin `DELETE`. Ninguna cache es user-scoped (correcto, dado que ninguna respuesta varía por usuario — mismo criterio ya validado para `positions`/`auditParameters` en 14H.6/14H.7).

## 13. Cache/dedupe/loading

Sin cambios de cache — ambas capas (frontend `noveltyTypesCatalog` 10min/persistido; backend `listCache` 120s + `noveltyTypesListCache`/`noveltyTypesDetailCache` 60s) ya existían y ya invalidan correctamente en cada mutación real. No se agregó ninguna cache nueva ni se tocó ninguna existente — el hallazgo de esta sección es puramente de **documentación** (14H.1 tenía el dato de cache backend incorrecto, corregido en §9.2/§16).

**Riesgo pre-existente, no introducido por esta etapa**: doble capa de cache backend (repo + controller) sobre el mismo recurso — mismo tipo de deuda arquitectónica ya señalada en `PERFORMANCE_STANDARDS.md` §15 (4 patrones de cache backend distintos coexistiendo en el proyecto); no se consolidó, mismo criterio que 14H.6/14H.7 (consolidar los patrones de cache queda fuera de alcance de una etapa de un solo módulo).

## 14. Journey ampliado

Sí — 2 zonas nuevas (O, P), 4 acciones nuevas read-only, cerrando el candidato de profundización que 14H.1 había dejado explícitamente pendiente. Ver §9.2 y §16 para el detalle y los resultados reales.

## 15. Tests

**Backend** (`noveltyTypes.repository.test.ts`, nuevo, 6 tests):
- `findMany` con filtros: `$transaction` no se llama; `findMany`/`count` reciben el mismo `where`; `skip`/`take` correctos.
- `findMany` arma el `where` con `kind`/`origin`/`status`/`exportsToFinnegans`/`search`.
- `findMany` sin filtros: usa el `listCache` en memoria, nunca `$transaction` ni una query de `count` separada.
- `findMany` sin filtros, segunda llamada dentro del TTL: reusa el cache, no vuelve a golpear la base.
- `findById`: usa `findUniqueOrThrow` con el `include` completo; propaga el rechazo (P2025) cuando no existe.

**Frontend**: ningún cambio de código de producción, así que no se agregaron tests de página nuevos — el journey ampliado (§9.2/§14) cubre el comportamiento real end-to-end (detalle/creación, sin duplicados, sin escrituras). Los 28 tests existentes del generador del journey (`adminConfigurationJourney.test.ts`) se extendieron para validar las 2 zonas nuevas.

Ningún test depende de tiempos exactos.

## 16. Métricas antes/después

Medido con `npm run perf:journey:admin-config` contra el mismo entorno (frontend+backend locales, backend contra staging real vía Neon). A diferencia de 14H.7, **no hay comparación antes/después de latencia** para el listado/detalle porque no se tocó ningún código de carga de datos de esas rutas — sólo se **amplió la cobertura** (nunca se habían medido detalle/creación antes) y se corrigió una rama de código sin caller real.

| Acción | Resultado (única medición, primera vez que se mide) |
|---|---|
| Entrar a Tipos de novedades | 929ms network idle, 2 requests, 0 duplicados |
| Ver detalle de tipo de novedad (nuevo) | 931ms network idle, 2 requests, 0 duplicados |
| Cambiar de pestaña en detalle (nuevo) | 250ms network idle, **0 requests nuevos** — confirma que las pestañas no re-disparan red |
| Entrar a Crear tipo de novedad (nuevo) | 720ms network idle, 1 request |
| Salir de Crear tipo de novedad sin guardar (nuevo) | 152ms network idle, 0 requests (cache hit — ya se había visitado el listado en el mismo recorrido) |

HTTP errors: 0. Console errors: 0. Escrituras ejecutadas: 0. Duplicados de Tipos de novedades en §10 del journey: 0 (ninguna corrida de esta etapa detectó ninguno).

**Nota de transparencia sobre el fix de `$transaction`**: el cambio a `Promise.all` no tiene ningún efecto medible en este journey porque ningún caller real de hoy ejercita esa rama (§6) — el journey (búsqueda/filtro son client-side) nunca la toca. La corrección es de código, no de latencia observable; documentado explícitamente para no reclamar una mejora que no se puede medir.

## 17. Riesgos pendientes

- **Doble capa de cache backend** (repo `listCache` + controller `noveltyTypesListCache`/`noveltyTypesDetailCache`) sobre el mismo recurso — deuda arquitectónica pre-existente, no introducida ni corregida esta etapa (§13).
- **Rama filtrada de `findMany` sin caller real** — si en el futuro se agrega búsqueda/filtro server-side a `NoveltyTypesPage.tsx` o a `NoveltyModal.tsx`, esa rama ya está corregida (`Promise.all`) y lista para usarse.
- **Sobre-fetch marginal en `NoveltyModal.tsx`/`EmployeeHoursPage.tsx`** (traen el catálogo completo, incluido `finnegansLinks`, sólo para un `<select>`) — de bajo impacto dado el volumen confirmado (vocabulario cerrado), no corregido por no ser justificado (§6).
- **`employeeApiService.ts::getTimeGrid()`** consulta `NoveltyType` directamente desde el módulo `employees`, bypaseando `novelty-types` — arquitectura duplicada, fuera de alcance de esta etapa (Legajos).

## 18. Recomendación para etapa siguiente

Con 14H.8 cerrado, los 10 submódulos de Configuración más Puestos quedan todos diagnosticados con evidencia (14H.1-14H.8). Recomendación, en orden:

1. **Evaluación dedicada de `previewFeatures=["relationJoins"]` de Prisma** — candidato repetido 6+ veces en la serie (14C.1, 14C.3, 14D.2.1, 14D.3, 14D.4, 14H.7) como el único camino sostenible para bajar la latencia base de cadenas de relaciones anidadas en todo el backend — alcance global, requiere su propia etapa.
2. **Consolidación de los 4-5 patrones de cache backend coexistentes** (`PERFORMANCE_STANDARDS.md` §15) — deuda documentada repetidamente (14H.6, 14H.7, 14H.8) pero nunca abordada por ser explícitamente fuera de alcance de etapas de un solo módulo.
3. Si se considera agotada la ronda de performance read-only de Configuración/Puestos, evaluar submódulos aún sin diagnóstico propio fuera de este perímetro (p. ej. Usuarios, Auditoría general).

## Validaciones ejecutadas

- Backend: `npx prisma validate` ✅, `npm run typecheck` ✅ sin errores, `npm test` ✅ **1265/1265** (82 archivos, +6 tests nuevos), `npm run build` ✅ sin errores.
- Frontend: `npx tsc -b` ✅ sin errores, `npx tsc -p tsconfig.e2e.json --noEmit` ✅ sin errores, `npm test -- --run` ✅ **801/801** (81 archivos), `npm run build` ✅ sin errores ni warnings nuevos.
- `npm run perf:journey:admin-config` ✅ passed (49.3s) — 51/80 acciones cubiertas, 0 HTTP errors, 0 console errors, 0 escrituras, 0 duplicados de Tipos de novedades.
- `npm run perf:journey:workforce` (14G.1, regresión) ✅ passed, 1.1min.
- `npm run perf:journey:employees` (14D.1, regresión) ✅ passed, 41.2s.
- `git diff --check` ✅ sin errores de espacios en blanco.
- `git status --short` / `git diff --stat`: cambios acotados a `backend/src/modules/novelty-types/*`, `frontend/e2e/{adminConfigurationPerformanceJourney.spec.ts,support/adminConfigurationJourney{.ts,.test.ts}}` y `docs/performance/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.{md,json}`. Los reportes colaterales `EMPLOYEES_PERFORMANCE_JOURNEY_14D1.{md,json}` y `WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.{md,json}`, regenerados como efecto inevitable de correr esos 2 journeys para el control de regresión, se restauraron (`git restore`) — mismo protocolo de cierre ya documentado en 14H.1/14H.7.

No se commiteó. No se hizo push.
