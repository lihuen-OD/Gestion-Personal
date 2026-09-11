# Etapa 14I.5 — Diagnóstico quirúrgico de `employeeOrgChartSelect`

## 1. Resumen ejecutivo

**No hay over-fetch real en la cadena jerárquica.** `employeeOrgChartSelect` (`backend/src/modules/employees/employees.repository.ts:755-783`) trae `sector→area→establishment→businessUnit` porque el frontend **la consume completa y de forma visible**: `EmployeeOrgPopover.tsx` muestra "Unidad de negocio" y "Establecimiento" como filas del panel de detalle al hacer click en cualquier nodo, y `organizationChartMockService.ts` usa ambos campos para poblar 2 de los 11 filtros del organigrama (`businessUnit`, `establishment`). Confirmado campo por campo (§9), no por suposición.

Sí se encontró un hallazgo real pero **de impacto insignificante**: 8 sub-campos escalares (`sector.id`, `sector.code`, `area.name`, `costCenter.id`, `costCenter.code`, `position.code`, `company.id`, `company.code`) se seleccionan pero nunca se leen del lado del frontend. Medido directamente contra Neon (script temporal, borrado, ver §10): quitarlos ahorraría **~25% de payload** (7.1KB sobre 32 empleados reales hoy) pero **0ms de diferencia en duración de query** (ambas variantes, current y lean, corren en 178-227ms en caliente — ruido de medición, no señal) — porque son columnas gratis sobre relaciones que igual hay que traer para los campos que sí se usan, no relaciones ni joins adicionales. No se tocó el select en esta etapa (instrucción explícita de la etapa: diagnóstico primero, no optimizar el select todavía).

También se confirmó, con `$on("query")` sobre un cliente Prisma crudo, que `findOrgChart` ejecuta **exactamente 1 sentencia SQL** por llamada — sin N+1, sin ronda adicional por relación. El volumen real de producción/staging hoy es **32 empleados** (32 activos, 0 inactivos) — muy por debajo de los escenarios hipotéticos de 200/1000 que motivaron el diagnóstico original de 14I.1.

**Conclusión**: Resultado A (no tocar) para la cadena jerárquica en sí, con una nota Resultado B (candidato de limpieza de bajo impacto, diferido) para los 8 sub-campos no leídos, y una nota Resultado D (gap de cobertura de journey, ya documentado desde 14C.3, sigue sin cerrarse) sin acción en esta etapa dado el volumen real actual.

## 2. Contexto 14I.1

14I.1 (commit `3abb3c4`, §8 "Inventario de over-fetching") listó `employeeOrgChartSelect`/`findOrgChart` (`employees.repository.ts:755-783`) como **P1 — "el hallazgo de over-fetch de mayor impacto potencial de todo el diagnóstico"**, explícitamente sin confirmar (`"parece traer una cadena jerárquica profunda... esto puede ser correcto o puede ser over-fetching"`), y remitido a una etapa dedicada por vivir en Legajos (requiere autorización explícita para tocar `employees`). 14I.2 (P0 `$transaction`), 14I.3 (helper de cache) y 14I.4 (`attendanceSummary`) dejaron este hallazgo explícitamente fuera de su alcance. Esta es esa etapa dedicada — y, a diferencia de 14I.2/14I.4, el mandato es diagnosticar primero, no aplicar el fix mecánico automáticamente.

## 3. Por qué se eligió `employeeOrgChartSelect`

Es el único hallazgo P1 restante del inventario original de 14I.1 que:
- No requiere tocar Fichador, Gestión Horaria, Carga Horaria, Conceptos Horarios, Horas Especiales, Puestos ni Configuración.
- Tiene un caller frontend único y acotado (`OrganigramasPage.tsx`), fácil de auditar campo por campo sin ambigüedad de múltiples consumidores.
- Nunca fue medido por ningún journey (`EMPLOYEES_FULL_PERFORMANCE_14C3.md` §9/§16/§18 ya lo documentó como gap, nunca cerrado desde entonces).
- Es exactamente el tipo de pregunta que 14I.1 dejó abierta a propósito ("puede ser correcto o puede ser over-fetching... la etapa NO debe asumirlo").

## 4. Endpoint/caller

- **Ruta HTTP**: `GET /employees/org-chart` (`employees.routes.ts:77-82`).
- **RBAC**: `requireAnyRole([roles.rrhh, roles.supervision])` — **`cargaHoraria` no tiene acceso a esta ruta**, por eso `listOrgChart` no llama `redactPiiForRole` (verificado: ese helper sólo actúa sobre el rol `cargaHoraria`, que nunca llega acá — comportamiento correcto, no un gap).
- **Controller**: `employeesController.listOrgChart` (`employees.controller.ts:58-65`) — lee/escribe `employeeOrgChartCache` antes/después de delegar.
- **Service**: `employeesService.listOrgChart(query, user)` (`employees.service.ts:427-438`) — resuelve `employeeAccessWhere(user)` y arma `{ items, meta }`.
- **Repository**: `employeesRepository.findOrgChart(query, accessWhere)` (`employees.repository.ts:1032-1045`) — `Promise.all([findMany, count])`, ya sin `$transaction` desde 14C.3.
- **Query params** (`listEmployeeOrgChartQuerySchema`, `employees.schemas.ts:15-24`): `search`, `status`, `companyId`, `sectorId`, `positionId`, `costCenterId`, `page` (default 1, máx 10000), `take` (**default 500, máx 1000**).
- **Caller frontend real**: `employeeApiService.getOrgChart()` (`employeeApiService.ts:681-691`) → `OrganigramasPage.tsx:63-64` (único caller en todo el frontend, confirmado por grep).

## 5. Contrato API actual

`GET /employees/org-chart` → `{ data: EmployeeOrgChartItem[], meta: { total, page, pageSize, hasMore } }` — mismo shape que el resto de los listados paginados del proyecto. No se tocó en esta etapa.

## 6. RBAC/scope actual

`employeeAccessWhere(user)` (`employeeAccess.ts`): RRHH ve todos los empleados (`{}`); Supervisión (y Carga Horaria, aunque no puede llegar a esta ruta) ve sólo empleados donde tiene una asignación `TIME_RESPONSIBLE` activa y vigente por fecha. El frontend agrega una restricción adicional puramente de UI para roles "Nivel 2" (`scopedEmployeesFrom`, filtra por `user.sector` sobre los datos ya recibidos) — redundante con el `where` del backend, no un mecanismo de seguridad (la seguridad real ya la impone `employeeAccessWhere` en el servidor). No se tocó nada de esto.

## 7. Cache frontend/backend actual

**Backend**: `employeeOrgChartCache` (`employees.controller.ts:15`, `createTtlCache`, TTL 20s), key = `userScopedCacheKey` (`userId:role:originalUrl` — incluye los query params vía `originalUrl`, así que dos combinaciones de filtros distintas no colisionan). Invalidado por `clearEmployeeReadCaches()` (`employees.controller.ts:26-33`), la misma función de 6 caches que ya invalidan ~15+ mutadores across `employees`/`hour-concepts`/`novelties`/`workforce.approveCorrection`. **Sin test dedicado de hit/miss** — mismo gap ya señalado por 14I.1 §6 para las 6 caches de `employees.controller.ts`, no nuevo de esta etapa, no corregido acá (fuera del alcance quirúrgico de 14I.5, que es sobre el select, no sobre cache).

**Frontend**: `cachePolicies.employeesOrgChart` (`cachePolicy.ts:184-189`) — familia `employees`, TTL 60s, `persist:false` (no IndexedDB, sólo memoria de sesión), `sensitive:true`. Servido vía `cachedData`, que da dedupe in-flight automático (mismo mecanismo que el resto de la app desde 14D.5/14G.9 — no hay duplicado de StrictMode sin resolver acá, a diferencia de otros endpoints que lo tuvieron antes de adoptar `cachedData`).

## 8. Select actual, campo por campo

`employeeOrgChartSelect` (`employees.repository.ts:755-783`):

| Campo | Tipo | Nota |
|---|---|---|
| `id` | escalar | |
| `legajo` | escalar | |
| `legajoFinnegans` | escalar | |
| `cuil` | escalar | |
| `dni` | escalar | |
| `firstName` | escalar | |
| `lastName` | escalar | |
| `status` | escalar | |
| `receiptCategory` | escalar | |
| `internalCategory` | escalar | |
| `companies` | to-many → `company: { id, name, code }` | |
| `sector` | to-one → `{ id, name, code, area: { name, establishment: { name, businessUnit: { name } } } }` | cadena de 4 niveles completa |
| `costCenter` | to-one → `{ id, name, code }` | |
| `position` | to-one → `{ id, name, code }` | |
| `assignments` | to-many → `{ type, personName }` | ya liviano (no trae `userId`/`role`/fechas/`notes`) |

## 9. Uso frontend, campo por campo

Verificado leyendo `employeeApiService.ts::mapEmployeeFromApi` (líneas 265-339), `organizationChartMockService.ts` completo, `OrganigramasPage.tsx` completo, `EmployeeOrgPopover.tsx`, `CategoryOrgChart.tsx`/`FunctionalOrgChart.tsx` — no supuesto.

| Campo | ¿Usado? | Dónde |
|---|---|---|
| `id` | Sí — UI visible | Key de nodo/edge, link "Ver legajo" (`/legajos/:id`) en el popover |
| `legajo` | Sí — UI visible + filtro | Búsqueda (`employeeMatches`), export "Legajo", fallback en `displayLegajo` del popover |
| `legajoFinnegans` | Sí — UI visible + filtro | Búsqueda, fallback en `displayLegajo` del popover |
| `cuil` | Sí — UI visible + filtro | Popover "CUIL", export "CUIL", búsqueda |
| `dni` | Sí — **sólo filtro** | Búsqueda (`employeeMatches`), nunca se muestra en el popover ni en el export |
| `firstName`/`lastName` | Sí — UI visible | Nombre en cada nodo, popover, ordenamiento (`buildCategoryModel`) |
| `status` | Sí — filtro + export | Filtro "Estado", columna "Estado" del export; **no aparece en el popover ni en la tarjeta de nodo** |
| `receiptCategory` | Sí — UI visible + filtro | Fallback de categorización (columna del organigrama), filtro, export, popover "Categoría" |
| `internalCategory` | Sí — UI visible + jerarquía | **Determina la columna** en la vista "Por categoría" (`categoryKey`/`categoryFor`), filtro, export, popover |
| `companies.company.name` | Sí — UI visible + filtro | "Empresa" en nodo funcional/popover/export, filtro "Empresa" |
| `companies.company.isPrimary` | Sí | Determina la empresa primaria mostrada |
| `companies.company.id`/`.code` | **No** | Nunca leídos por `mapEmployeeFromApi` |
| `sector.name` | Sí — UI visible + filtro + scope | "Sector" en nodo/popover/export, filtro "Sector", scoping Nivel 2 en frontend |
| `sector.id`/`.code` | **No** | El filtro de sector matchea por nombre, no por id; `.code` nunca se lee |
| `sector.area.name` (el nombre del área en sí) | **No** | Sólo se atraviesa `area` para llegar a `establishment` — el propio `area.name` nunca se lee |
| `sector.area.establishment.name` | Sí — **UI visible** + filtro | Popover **"Establecimiento"**, filtro "Establecimiento" |
| `sector.area.establishment.businessUnit.name` | Sí — **UI visible** + filtro | Popover **"Unidad de negocio"**, filtro "Unidad de negocio" |
| `costCenter.name` | Sí — UI visible + filtro | Popover "Centro de costo", export, filtro "Centro de costo" |
| `costCenter.id`/`.code` | **No** | Nunca leídos |
| `position.name` | Sí — UI visible + filtro | Nodo funcional, popover "Puesto", export, fallback de categorización |
| `position.id` | Sí — filtro | El filtro de puesto matchea por id **o** por nombre |
| `position.code` | **No** | Nunca leído |
| `assignments` (`type`+`personName`) | Sí — **core del organigrama** | Arma `directManagers`/`timeResponsibles`; usado para las líneas de conexión jerárquica (`buildCategoryModel`/edges), filtros "Encargado directo"/"Responsable de carga", export |

**Separación pedida por la consigna**:
- **Usados en UI visible**: `id`, `legajo`, `legajoFinnegans`, `cuil`, `firstName`, `lastName`, `receiptCategory`, `internalCategory`, `companies.company.name`, `sector.name`, `establishment.name`, `businessUnit.name`, `costCenter.name`, `position.name`, `assignments`.
- **Usados sólo para filtros** (no aparecen en ningún texto/columna visible): `dni`.
- **Usados para construir jerarquía**: `internalCategory`/`receiptCategory` (columna), `assignments` (edges manager→subordinado), `status` (segmentación implícita del volumen visible vía filtro).
- **No usados en absoluto**: `sector.id`, `sector.code`, `sector.area.name` (el propio), `costCenter.id`, `costCenter.code`, `position.code`, `companies.company.id`, `companies.company.code`.

## 10. Medición actual

Sin escrituras, sin datos creados/modificados. Método: script temporal `backend/scripts/tmp-orgchart-measure.ts` (`npx tsx`, ejecutado contra la misma base Neon de staging que usa el backend corriendo, **borrado inmediatamente después**, nunca commiteado — `git status` confirmado limpio antes y después).

- **Volumen real hoy**: `prisma.employee.count()` → **32 empleados totales, 32 activos, 0 inactivos**. Muy por debajo de los escenarios de 200/1000 planteados como hipótesis en el pedido — no hay hoy un dataset real de ese tamaño en este entorno para medir directamente; los números de payload de abajo se extrapolan linealmente a partir de la medición real de 32 filas.
- **Cantidad de sentencias SQL**: capturado con `$on("query")` sobre un `PrismaClient` crudo (mismo `DATABASE_URL`) — **exactamente 1 sentencia SQL** para todo `findOrgChart` (incluida la cadena de 4 niveles y las 2 relaciones to-many). Sin N+1, sin ronda adicional por relación ni por fila.
- **Duración de query, select actual vs. select reducido (sin los 8 sub-campos no usados de §9)**, 3 corridas cada uno con conexión ya caliente: actual `182/183/189ms`, reducido `184/178/179ms` — **diferencia dentro del ruido de medición** (no hay señal de que el ancho del select afecte el tiempo de query; el costo está dominado por el round-trip a Neon, no por cuántas columnas escalares extra se piden sobre relaciones ya necesarias).
- **Payload**, 32 filas reales: actual **28.614 bytes** (~894 bytes/empleado), reducido **21.447 bytes** (~670 bytes/empleado) — diferencia de **7.167 bytes (25.05%)**.
- **Nota de contexto**: el backend no tiene middleware de compresión gzip/brotli habilitado (`app.ts`, sólo `helmet`/`cors`) — esto es transversal a **todos** los endpoints del proyecto, no específico de `org-chart`; no se toca ni se recomienda acá (fuera de alcance de esta etapa), pero es relevante para no sobreestimar cuánto ayudaría reducir el select: sin compresión, el ahorro de payload de §12 se traduce 1:1 en bytes de red; con compresión (si se agregara alguna vez a nivel de app), el ahorro real sería bastante menor (JSON repetitivo comprime bien).

## 11. Payload/volumen estimado

Extrapolación lineal desde la medición real de 32 filas (Postgres/Prisma no cambia de estrategia de query por volumen en este rango, así que el costo por fila es constante salvo el propio transfer):

| Empleados | Payload actual (estimado) | Payload sin los 8 sub-campos no usados (estimado) |
|---|---|---|
| 32 (real hoy) | 28,6 KB | 21,4 KB |
| 200 | ~179 KB | ~134 KB |
| 1000 (tope `take`) | ~894 KB | ~670 KB |

`take` máximo del schema es 1000 (`listEmployeeOrgChartQuerySchema`) y el frontend siempre pide exactamente `take=1000` (`ORG_CHART_EMPLOYEE_LIMIT`) sin paginar — es, a propósito, un fetch-all acotado a un techo duro, con un aviso visible en la UI ("Se alcanzó el límite de 1000 empleados...") si `hasMore` o `items.length >= 1000`. Incluso en el escenario límite de 1000 empleados reales, ~894KB de JSON (sin comprimir) es un tamaño razonable para una carga única cacheada 60s en frontend — no es indicio de un problema de escalabilidad urgente, aunque si la plantilla de empleados creciera sostenidamente más allá de ese techo, el patrón fetch-all (no paginación real) sí se volvería el cuello de botella real, no el select.

## 12. Diagnóstico

- **¿Hay over-fetch?** Sí, pero mínimo y aislado: 8 sub-campos escalares nunca leídos por el frontend (`sector.id`/`.code`, `area.name`, `costCenter.id`/`.code`, `position.code`, `companies.company.id`/`.code`). **La cadena jerárquica en sí (`sector→area→establishment→businessUnit`) no es over-fetch** — se confirmó campo por campo que sus 2 hojas terminales (`establishment.name`, `businessUnit.name`) se muestran directamente en la UI (`EmployeeOrgPopover.tsx`) y alimentan 2 filtros reales.
- **¿Dónde está el costo real?** No está en la DB (1 sola sentencia SQL, sin N+1) ni en el ancho del select (0ms de diferencia medida en caliente). El único costo real y medible es **payload de red**, y es pequeño en términos absolutos hoy (7KB sobre 32 filas) y moderado incluso en el peor caso hipotético (~224KB de diferencia sobre 1000 filas, sin comprimir).
- **¿DB, payload, frontend o cache?** Payload, en un grado bajo — no DB (1 query, sin N+1), no frontend (el filtrado/agrupado client-side sobre 32-1000 objetos es trivial para cualquier navegador moderno), no cache (ambas capas de cache ya están bien configuradas y scopeadas, sólo les falta test de aislamiento — gap ya conocido, no nuevo).

## 13. Cambios aplicados

**Ninguno en código productivo.** Se agregó exactamente **1 test de regresión** (no funcional, no cambia comportamiento) en `backend/src/modules/employees/employees.repository.test.ts`: fija (`toEqual`) el `select` exacto que `findOrgChart` pasa hoy a `prisma.employee.findMany`, incluyendo la cadena completa de 4 niveles — protege contra un cambio de campos silencioso a futuro y documenta en código el inventario de §8. No modifica `employeeOrgChartSelect`, no cambia ningún valor devuelto, no toca ningún otro archivo backend ni frontend.

## 14. Qué NO se cambió

- `employeeOrgChartSelect` (`employees.repository.ts:755-783`) — sin ninguna modificación, ni siquiera de los 8 sub-campos identificados como no usados.
- `findOrgChart`, `buildOrgChartWhere`, `listOrgChart` (service/controller), `employees.routes.ts` — sin cambios.
- `employeeOrgChartCache`, `clearEmployeeReadCaches()` — sin cambios de TTL/key/invalidación.
- Contrato API, shape de respuesta, RBAC/scope, `employeeAccessWhere` — sin cambios.
- `relationLoadStrategy`/`relationJoins` — no se aplicó a esta query (queda documentado como no necesario, ver §16).
- Frontend: `OrganigramasPage.tsx`, `organizationChartMockService.ts`, `EmployeeOrgPopover.tsx`, `CategoryOrgChart.tsx`, `FunctionalOrgChart.tsx`, `employeeApiService.ts` — todos sólo leídos, ninguno modificado.
- `perf:journey:employees` (u otro journey) — no se amplió (ver justificación en §16/§19).
- Fichador, Gestión Horaria, Carga Horaria, Conceptos Horarios, Horas Especiales, Puestos, Configuración, Prisma schema — nada de esto se tocó, ni falta relación con el alcance de esta etapa.
- No se ejecutó ninguna escritura real — el script temporal de medición (§10) sólo hizo `count()`/`findMany()`, y fue borrado antes de cerrar la etapa.

## 15. Riesgos de optimizar

- **Riesgo de tocar el select ahora**: bajo pero no cero — aunque los 8 sub-campos parecen inequívocamente no usados por el único caller conocido (`OrganigramasPage.tsx`), no se descarta con certeza absoluta que algún flujo de exportación/reporte futuro o un consumidor no auditado dependa de ellos; el ahorro medido (25% de un payload ya chico, 0ms de query) no justifica ese riesgo hoy sin una etapa explícitamente autorizada para tocar el select.
- **Riesgo de aplicar `relationLoadStrategy: "join"`**: no evaluado en esta etapa (fuera de alcance explícito — "no aplicar relationJoins"); dado que ya se mide 1 sola sentencia SQL sin la preview feature, no hay evidencia de que aportaría algo acá (a diferencia de `positions/options`/`overview-details`/`position-validation`, donde 14D.6 sí midió una mejora real con un shape distinto).
- **Riesgo de crear un endpoint liviano nuevo**: bajo esfuerzo, pero agrega superficie de mantenimiento (2 endpoints a mantener en sync) para un ahorro de payload que hoy es de 7KB — no se justifica con el volumen real actual.
- **Riesgo de no hacer nada**: ninguno identificado a corto plazo — el volumen real (32) está muy lejos del techo de `take=1000`; si la plantilla de empleados creciera 10-30x, el primer síntoma sería el `hasMore`/límite de 1000 (fetch-all sin paginación real), no el ancho del select.

## 16. Opciones futuras

1. **No tocar** (recomendado para el select en sí, ver §17) — la cadena jerárquica está justificada por uso real, medido y confirmado.
2. **Endpoint liviano**: no se justifica hoy — el mismo endpoint ya sirve bien al único caller, y el ahorro de payload de un endpoint separado (sin los 8 sub-campos) sería el mismo 25% ya medido, sin beneficio adicional de arquitectura.
3. **Query param opcional** (p. ej. `?slim=1` para omitir `id`/`code` de las relaciones): técnicamente posible, pero over-engineering para un caller único y un ahorro de 7KB — no recomendado sin un segundo consumidor real que lo necesite.
4. **Select reducido** (quitar los 8 sub-campos de §9 directamente de `employeeOrgChartSelect`): el candidato más simple si alguna vez se decide actuar — bajo riesgo técnico (confirmado sin impacto de query time, sin ningún caller que los lea), pero explícitamente **no aplicado en esta etapa** por instrucción directa ("no cambiar selects/includes todavía"). Documentado como candidato de limpieza P3 (cosmético/mantenibilidad, no performance) para una futura etapa que decida tocar el select con autorización explícita.
5. **`relationJoins`**: no aplica — ya se ejecuta en 1 sola sentencia SQL sin la preview feature; no hay evidencia de beneficio (a diferencia de los 4 sitios donde 14D.7 sí lo aplicó con datos que lo justificaban).
6. **Paginación/filtros server-side reales**: el endpoint YA soporta filtros server-side completos (`search`/`status`/`companyId`/`sectorId`/`positionId`/`costCenterId`) y paginación (`page`/`take`) — el frontend simplemente elige no usarlos (pide `take=1000` fijo y filtra client-side). Cambiar esto sería un rediseño de `OrganigramasPage.tsx` (mover los 11 filtros a server-side), fuera de alcance de un diagnóstico backend y sin ningún síntoma real que lo justifique con 32 empleados.
7. **Ampliar `perf:journey:employees` para cubrir Organigramas**: gap real, documentado desde 14C.3, todavía abierto — no se cerró en esta etapa porque, con 32 empleados reales, una medición de journey no aportaría una señal distinta a la ya obtenida directamente contra la DB (§10); más valioso hacerlo cuando el volumen real se acerque a un rango donde el fetch-all de 1000 empiece a importar, o si se prefiere tenerlo como regresión de latencia independientemente del volumen (opción D, ver §19).

## 17. Recomendación final

**No optimizar `employeeOrgChartSelect` ahora.** La cadena jerárquica de 4 niveles está justificada por consumo real, visible y confirmado en la UI — no es el antipatrón que 14I.1 temía. El único hallazgo real (8 sub-campos no leídos) tiene impacto insignificante (0ms de query, 7KB de payload sobre el volumen real actual) y no justifica el riesgo de tocar un select de un módulo sensible (Legajos/RBAC) sin una necesidad concreta. Queda documentado como candidato P3 de limpieza cosmética para cuando se decida tocar este archivo por otro motivo, no como una etapa propia.

## 18. Validaciones

Sólo se tocó 1 archivo de test backend (ningún cambio de comportamiento productivo) — validaciones backend completas igual, por tratarse de TypeScript:

- `npx prisma validate` ✅ schema válido, sin cambios.
- `npm run typecheck` ✅ sin errores.
- `npm test` ✅ **1307/1307** (87 archivos, +1 test nuevo vs. los 1306 de cierre de 14I.4).
- `npm run build` ✅ sin errores.
- `git diff --check` ✅ sin errores de espacios en blanco.
- `git status --short` / `git diff --stat`: 1 archivo modificado (`employees.repository.test.ts`, +42 líneas) + esta documentación (2 archivos nuevos en `docs/`).
- No se tocó frontend/e2e — no aplican `tsc -b`/`tsc -p tsconfig.e2e.json`/`npm run perf:journey:employees` (sólo requeridos si se toca ese código, ver consigna Parte 7).
- Script temporal de medición: ejecutado con `npx tsx`, resultado capturado en este documento, **borrado** antes de cerrar la etapa — confirmado con `git status` limpio antes y después de su ejecución.
- No se ejecutó ninguna escritura real en ningún momento de esta etapa.

## 19. Recomendación para 14I.6

Con el único P1 restante del inventario original de 14I.1 (`employeeOrgChartSelect`) diagnosticado y cerrado sin necesidad de tocar código productivo, el inventario de over-fetch/`$transaction` de 14I.1 queda así:
- **Cerrados**: 3 `$transaction` P0 (14I.2), Forma B de cache (14I.3), `attendanceSummary` P1 (14I.4), `employeeOrgChartSelect` P1 (14I.5, sin acción necesaria).
- **Sin tocar, documentados, sin caller real (P2)**: `salaryCategories.repository.ts`, `hourConceptRules.repository.ts`.
- **Candidatos nuevos, bajo impacto (P3)**: los 8 sub-campos de `employeeOrgChartSelect` (§16.4), sólo si se toca ese archivo por otro motivo.

Candidatos razonables para una futura 14I.6, en orden de evidencia (ninguno urgente):
1. **Tests de aislamiento de cache faltantes** en `documentsListCache`/`noveltiesListCache` y en las 6 caches de `employees.controller.ts` (incluida `employeeOrgChartCache`) — bajo impacto, cobertura pura, sin tocar comportamiento.
2. **Invalidación de `timeGridCatalogCache`** (`employees.repository.ts`, P1 de 14I.1) — sin ninguna invalidación explícita hoy; requiere autorización explícita para tocar `employees`.
3. **Consolidar la doble capa de cache** (`createTtlCache` de controller + `repositoryListCache` de repositorio) en los 4 módulos que la tienen apilada (`hour-concepts`/`novelty-types`/`document-categories`/`salary-categories`) — deuda ya documentada desde 14I.3, sin bug que la fuerce.
4. **Ampliar `perf:journey:employees` para cubrir Organigramas** (Resultado D, ver §16.7) — sólo si se prioriza cerrar el gap de cobertura por sí mismo, independientemente del volumen real actual.

No se recomienda ninguna etapa de performance nueva motivada por `employeeOrgChartSelect` — el diagnóstico cierra el hallazgo sin encontrar una razón real para actuar.
