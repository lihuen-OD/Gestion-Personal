# Etapa 14D.4 — Optimización de GET /api/positions consumido por Legajos

Fecha: 2026-09-04
Estado: diagnóstico completo, implementado, validado, **pendiente de aprobación para commitear**
Alcance: exclusivamente el consumo de `positions` DENTRO de Legajos (`usePositions`/`useActivePositions`/`resolveRelations`). Sin cambios de schema/migraciones, sin cambios de reglas funcionales de Puestos, sin cambios de permisos/RBAC, sin romper el módulo Puestos ni Datos Laborales. El endpoint principal `GET /positions` (`positionsService.list`/`getAll`), `GET /positions/:id`, y todo el resto del módulo Puestos quedan sin tocar.

---

## 1. Diagnóstico (Parte 1 del pedido, 40 puntos)

### 1.1-1.4 Quién llama `positionApiService.getAll()` hoy, y desde dónde

Relevado con grep sobre `positionApiService\.(getAll|list|getById)` en todo `frontend/src` (no supuesto): **8 call sites totales**, de los cuales **3 son de Legajos** (alcance de esta etapa) y **5 son de Puestos/Carga Horaria** (fuera de alcance, confirmados sin tocar):

| Call site | Módulo | Hook/función | En alcance |
|---|---|---|---|
| `EmployeeLaborFields.tsx` | Legajos | `usePositions(activeOnly)` — usado por `EmployeePositionCreateField` y `SalaryRangeValidationCard` | Sí |
| `LaborTrackedFields.tsx` | Legajos | `useActivePositions()` — usado por `EmployeePositionField` | Sí |
| `employeeApiService.ts` | Legajos | `resolveRelations()` — resuelve `positionId` por nombre (`puestoNombre`) al guardar un legajo | Sí |
| `PuestoCreatePage.tsx` | Puestos | alta de puesto | No |
| `PuestosPage.tsx` (×2) | Puestos | listado (`getAll` + `list` paginado) | No |
| `WorkScheduleSettingsPage.tsx` | Carga Horaria | selector de puesto para configurar jornada | No |
| `PuestoDetailPage.tsx` | Puestos | usa `getById`, no `getAll` — no aplica | No |

### 1.5-1.8 Qué trae hoy `GET /positions` (`positionInclude`) — shape completo

`positions.repository.ts` usa `include` (no `select`) sobre `Position`, lo que trae **todos** los escalares del modelo más las relaciones anidadas completas. Confirmado leyendo el modelo Prisma (`schema.prisma:542-568`) y `positionInclude`:

- **14 escalares de `Position`**: `id, code, name, status, mission, description, lastUpdatedAt, responsibilities, internalRelations, externalRelations, competencies, workConditions, performanceIndicators, evaluationCriteria, sectorId, createdAt, updatedAt`. De estos, **9 son pesados** (2 de texto libre + 7 columnas JSON): `mission, description, responsibilities, internalRelations, externalRelations, competencies, workConditions, performanceIndicators, evaluationCriteria`.
- **`sector.area.establishment`**: `include` completo, incluyendo `businessUnit: true` (registro completo) y **`company: true`** (registro completo de `Company` — nunca usado por Legajos, ver 1.9-1.12).
- **`salaryCategories.salaryCategory`**: registro completo de `SalaryCategory` (no sólo `id/name/order`).
- **`_count.employees`**: cuenta de empleados asignados (`assignedCount` en el frontend).

### 1.9-1.14 Qué de todo eso lee realmente Legajos — relevado leyendo `mapFromApi` y los 3 call sites completos

`mapFromApi` (`positionApiService.ts`) lee **todos** los campos de arriba para construir el tipo `Position` del frontend (es un mapper compartido por Puestos y Legajos). Pero grepeando los 3 call sites de Legajos por los campos que efectivamente usan (`derivedCompany`, `assignedCount`, `.mission`, `.responsibilities`, `.internalRelations`, `.externalRelations`, `.competencies`, `.workConditions`, `.performanceIndicators`, `.evaluationCriteria`) el resultado es **cero coincidencias** — ninguno de los 3 componentes de Legajos lee ninguno de esos campos. Lo que sí leen, confirmado línea por línea:

- `usePositions`/`selectedEmployeePosition`/`positionAllowedValues` (`EmployeeLaborFields.tsx`): `.id`, `.name`, `.status`, `.derivedBusinessUnitName`, `.derivedEstablishmentName`, `.derivedSectorName`.
- `EmployeePositionField`/`useActivePositions` (`LaborTrackedFields.tsx`): `.id`, `.name`, `.status` (filtro `activeOnly`), `.derivedAreaName`, `.derivedSectorName`.
- `resolveRelations` (`employeeApiService.ts`): sólo `.id` y `.name` (resolución de `positionId` por `puestoNombre` al guardar).

**Conclusión**: Legajos nunca necesitó `mission/description/responsibilities/internalRelations/externalRelations/competencies/workConditions/performanceIndicators/evaluationCriteria` (9 campos pesados), ni `company` (registro completo), ni `assignedCount` (`_count`). Todo eso viaja por red y se descarta sin usar en los 3 flujos de Legajos.

### 1.15-1.18 Cuántas veces se llama por sesión de Legajos, si hay duplicados, si ya hay caché

- `usePositions()` (sin `activeOnly`, usado por `SalaryRangeValidationCard`) y `usePositions(true)` (usado por `EmployeePositionCreateField`, sólo en alta) y `useActivePositions()` (usado por `EmployeePositionField`, sólo en detalle) pueden coexistir en la misma sesión de "abrir un legajo y entrar a Datos Laborales" — pero **ya existía caché frontend** (`cachePolicies.positionsCatalog`, familia `"positions"`, TTL 5 min, `cachedData` con dedup de requests concurrentes vía `pendingRevalidations`) desde antes de esta etapa — confirmado en el journey: `GET /api/positions` (ahora `/positions/options`) aparece **una sola vez** en todo el recorrido de 56 acciones (§9 del reporte), pese a tener 2-3 consumidores potenciales. El problema nunca fue "se llama muchas veces", fue "la única llamada trae de más".
- No había caché backend sobre `GET /positions` en sí (sólo sobre el listado paginado interno, `listCache`/`POSITION_CACHE_TTL_MS`, usado por `positionsService.list`, un código de ruta distinto — confirmado leyendo el repositorio completo, no se toca esta etapa).

### 1.19-1.22 Root cause exacto de los 3739ms medidos en 14D.2.1/14D.3

Sin `previewFeatures=["relationJoins"]` (no activado en este proyecto, mismo estado ya diagnosticado 4 veces: 14C.1, 14C.3, 14D.2.1, 14D.3), cada nivel de relación anidada de un `include`/`select` se resuelve como un round-trip separado y mayormente secuencial contra Neon (latencia real ~500-900ms por round-trip). `positionInclude` tiene una cadena de **4-5 niveles** (`sector → area → establishment → {businessUnit, company}`) más `salaryCategories.salaryCategory`, sobre **todas las filas de `Position`** (hasta 300, `take` por defecto) — el volumen de columnas pesadas (9 campos JSON/texto por fila) también añade transferencia de datos real, no sólo round-trips.

### 1.23-1.26 Se puede diferir por pestaña / lazy / lo pide otro flujo

- No aplica "diferir por pestaña": los 3 consumidores de Legajos necesitan el catálogo completo de puestos apenas montan (son selects/validación, no un detalle que se abre bajo demanda) — no hay ventana de "usuario todavía no lo pidió" que explotar, a diferencia de field-history (14D.2).
- La única palanca real es **qué tan pesado es cada registro que se trae**, no cuándo se trae.

### 1.27-1.30 Riesgo de romper Puestos si se toca el endpoint principal

Confirmado leyendo `PuestosPage.tsx`, `PuestoDetailPage.tsx`, `PuestoCreatePage.tsx`, `PuestoWorkConditionsTab.tsx` (vía búsqueda de campos usados): Puestos SÍ necesita `mission/responsibilities/internalRelations/externalRelations/competencies/workConditions/performanceIndicators/evaluationCriteria` (se editan y muestran ahí) y `assignedCount` (se muestra en la tabla de `PuestosPage`). **Recortar `positionInclude`/`GET /positions` directamente habría roto Puestos** — descartado explícitamente, ver §2.

### 1.31-1.34 Caché existente a reusar / invalidación

- Frontend: `cachePolicies.positionsCatalog` (familia `"positions"`) ya existe y ya se invalida en cualquier create/update/remove de puesto vía `invalidateCacheFamily("positions", ...)` en `positionApiService` — confirmado antes de agregar nada. El nuevo `getOptions()` reusa **la misma policy y familia**, así que queda invalidado automáticamente por el mismo mecanismo, sin código nuevo de invalidación en el frontend.
- Backend: no existía caché sobre `GET /positions`. Se agregó una nueva (mismo patrón que `employees.controller.ts`, ver §4) **con invalidación explícita** en `create`/`update`/`remove` — cumple la restricción explícita del pedido de no meter caché que sobreviva a cambios sin invalidación.

### 1.35-1.40 Contrato de API / breaking changes / permisos

- `GET /positions` (endpoint principal) **no cambia contrato** — sigue devolviendo el shape completo, sin tocar.
- Nuevo endpoint `GET /positions/options` es **aditivo**, no reemplaza ni modifica ningún endpoint existente.
- Confirmado en `positions.routes.ts`: `GET /positions` y `GET /positions/:id` sólo requieren `requireAuth` (ningún rol específico) — el nuevo endpoint sigue el mismo criterio, sin `requireAnyRole` agregado (no hay razón para ser más restrictivo que el endpoint que reemplaza para este consumo).
- Orden de registro de rutas: `/options` se registró ANTES de `/:id` (si quedara después, Express interpretaría `"options"` como un `:id` literal) — cubierto con test dedicado (§4).

---

## 2. Opciones consideradas y opción elegida

**Elegida: Opción A — endpoint nuevo y liviano `GET /positions/options`**, devolviendo un subconjunto `select` (no `include`) del mismo shape que ya consume `mapFromApi`, calculado a partir de lo que Legajos realmente lee (§1.9-1.14).

Alternativas evaluadas y descartadas:

- **Recortar `positionInclude`/`GET /positions` directamente**: descartada — Puestos SÍ necesita los 9 campos pesados y `assignedCount` (§1.27-1.30). Habría violado la prohibición explícita de no romper el módulo Puestos.
- **Caché frontend más agresiva sin endpoint nuevo**: descartada — ya existía caché de 5 min (§1.15-1.18) y el problema no era la cantidad de llamadas (ya era 1 por sesión) sino el peso de esa única llamada. Cachear una respuesta pesada sigue pagando el costo completo en el primer request de cada sesión/expiración — no resuelve la causa, la esconde parcialmente (prohibido explícitamente por el pedido: "no usar caché para esconder endpoint mal diseñado").
- **Parámetro de "campos" (`?fields=id,name,...`) sobre el endpoint existente**: evaluada y descartada por alcance — requeriría tocar `positionsService.list`/`findAll`, usado también por Puestos, con riesgo de regresión ahí (mismo motivo que la primera opción) para un beneficio que un endpoint nuevo consigue sin ese riesgo.
- **Derivar el catálogo liviano en el frontend a partir de `getAll()` ya cacheado**: descartada — el costo pesado ya ocurrió en el backend/red antes de llegar al frontend; filtrar campos del lado del cliente no reduce el payload de la respuesta ni el tiempo de las queries Prisma.

---

## 3. Shape de Position — tabla completa (Parte 3 del pedido)

| Campo de `Position` | Usado en Legajos | Componente | Necesario al montar | Puede ser lazy | Acción tomada |
|---|---|---|---|---|---|
| `id`, `name` | Sí | los 3 call sites | Sí | No | Incluido (liviano) |
| `code` | No (ningún call site de Legajos lo lee) | — | — | — | Incluido igual — escalar barato, permite reusar `mapFromApi` sin modificarlo |
| `status` | Sí | `usePositions`/`useActivePositions` (filtro `activeOnly`) | Sí | No | Incluido |
| `lastUpdatedAt`/`updatedAt`/`createdAt` | No directamente, pero `mapFromApi` usa `updatedAt` como fallback obligatorio de `lastUpdatedAt` | — | Sí (dependencia del mapper) | No | Incluidos (escalares baratos) |
| `sectorId` | No directamente | — | — | — | Incluido — escalar, sin costo extra |
| `derivedSectorName`/`derivedAreaName`/`derivedEstablishmentName`/`derivedBusinessUnitName` (vía `sector→area→establishment→businessUnit`, sólo `id`/`name` por nivel) | Sí | `positionAllowedValues`, `EmployeePositionField` | Sí | No | Cadena **recortada a `{id, name}` por nivel** — antes traía el registro completo de cada nivel |
| `derivedCompanyId`/`derivedCompanyName` (vía `establishment.company`) | No (0 coincidencias en grep) | — | — | — | **Excluido** — `company` completo no se selecciona; el mapper produce `undefined`/`""` (fallback seguro ya existente en `mapFromApi`) |
| `salaryCategoryIds`/`salaryCategoryNames` (vía `salaryCategories.salaryCategory`) | Sí (indirectamente, vía `salaryRangeMockService` en `SalaryRangeValidationCard`) | `SalaryRangeValidationCard` | Sí | No | Incluido, pero **recortado a `{id, name, order}`** por categoría (antes: registro completo de `SalaryCategory`) |
| `assignedCount` (vía `_count.employees`) | No (0 coincidencias) | — | — | — | **Excluido** — mapper produce `0` (mismo fallback `|| 0` ya existente) |
| `mission`, `description` | No | — | — | — | **Excluido** |
| `responsibilities`, `internalRelations`, `externalRelations`, `competencies` | No | — | — | — | **Excluido** |
| `workConditions`, `performanceIndicators`, `evaluationCriteria` | No | — | — | — | **Excluido** |

**Nota de riesgo explícita** (no oculta): si en el futuro algún consumidor de `usePositions`/`useActivePositions` empieza a necesitar `derivedCompanyName`/`derivedCompanyId`/`assignedCount`, va a recibir `""`/`undefined`/`0` silenciosamente (mismo comportamiento que "sin cargar" en el resto del mapper) en vez de un error — porque el shape de salida es idéntico (mismo tipo `Position`), sólo que esos campos vienen vacíos. Documentado en el código (`positionApiService.ts`, comentario sobre `getOptions()`) y acá para que quede explícito.

---

## 4. Cambios backend

Archivos: `backend/src/modules/positions/{positions.schemas,positions.repository,positions.service,positions.controller,positions.routes}.ts` (+ sus `*.test.ts`).

1. **`listPositionOptionsQuerySchema`** (`positions.schemas.ts`): `status` (opcional) + `take` (default 300, máx 500). No se agregó `search` — ningún caller de Legajos lo usa hoy (confirmado, §1.1-1.4), y agregar un parámetro sin caller real habría sido especulativo.
2. **`positionOptionSelect`** + **`findOptions(query)`** (`positions.repository.ts`): `select` explícito (no `include`) — ver shape exacto en §3. Orden estable `[{status:"asc"},{name:"asc"}]`, igual que `findAll`.
3. **`listOptions(query)`** (`positions.service.ts`): passthrough puro al repositorio.
4. **`listOptions` handler + `positionOptionsCache`** (`positions.controller.ts`): caché TTL de 60s a nivel controller (mismo patrón que `employees.controller.ts`), clave = `req.originalUrl` (no user-scoped — `GET /positions` tampoco lo está). `positionOptionsCache.clear()` se agrega en `create`/`update`/`remove`, dentro del controller (evita import circular: el service no conoce al controller).
5. **`GET /positions/options`** (`positions.routes.ts`): registrado **antes** de `/:id/employees` y `/:id` (razón: orden de matcheo de Express, ver §1.35-1.40). Mismo nivel de auth que `GET /positions` (`requireAuth`, sin rol adicional).

**No se tocó**: `positionInclude`, `findAll`/`list`, `getById`, `create`/`update`/`remove` (más allá de la línea de invalidación de caché), ninguna regla de negocio, ningún `accessWhere`/RBAC, el `listCache` interno de paginación (`POSITION_CACHE_TTL_MS`, código de ruta distinto).

**Tests backend agregados**: 7 en `positions.repository.test.ts` (select vs include, exclusión de los 9 campos pesados + `_count`/`company`, presencia de escalares baratos + cadena + `salaryCategories`, orden estable, filtro `status` presente/ausente, `take` custom), 1 en `positions.service.test.ts` (passthrough), 1 en `positions.routes.test.ts` (orden de registro `/options` antes de `/:id`, inspeccionando `positionsRouter.stack` directamente).

---

## 5. Cambios frontend

Archivos: `positionApiService.ts`, `EmployeeLaborFields.tsx`, `LaborTrackedFields.tsx`, `employeeApiService.ts` (+ sus `*.test.tsx`/`.test.ts`).

1. **`positionApiService.getOptions()`**: nuevo método, mismo `mapFromApi`/`ApiListResponse`/`isPositionList` que `getAll()` (sin duplicar lógica de mapeo). Misma cache policy `positionsCatalog` (familia `"positions"`) — se invalida junto con `getAll()` por el mismo `invalidateCacheFamily`, sin código de invalidación nuevo.
2. **`usePositions()`** (`EmployeeLaborFields.tsx`): `positionApiService.getAll()` → `getOptions()`.
3. **`useActivePositions()`** (`LaborTrackedFields.tsx`): `positionApiService.getAll()` → `getOptions()`.
4. **`resolveRelations()`** (`employeeApiService.ts`): `positionApiService.getAll()` → `getOptions()`.

**No se tocó**: `PuestoCreatePage.tsx`, `PuestosPage.tsx` (×2), `PuestoDetailPage.tsx`, `WorkScheduleSettingsPage.tsx` — siguen usando `getAll()`/`list()`/`getById()` sin ningún cambio.

**Tests frontend agregados**: 1 en `EmployeeLaborFields.test.tsx` (`SalaryRangeValidationCard`/`usePositions` llama `getOptions()`, no `getAll()`), 1 en `LaborTrackedFields.test.tsx` (`EmployeePositionField`/`useActivePositions` llama `getOptions()`, no `getAll()`).

---

## 6. Cambios al journey

El journey ya medía `GET /api/positions` como parte de la acción "Entrar a Datos Laborales" desde 14D.1 — sigue midiendo el mismo punto del recorrido, ahora contra `GET /api/positions/options` (URL nueva, misma acción). No hizo falta ningún cambio de lógica de captura.

**Se encontró y corrigió un problema real de infraestructura del journey**, dentro del alcance permitido de esta etapa (Parte 6: "actualizar el journey si hace falta"): `frontend/e2e/support/performanceEmployeesJourney.ts` tenía **texto hardcodeado** (no generado dinámicamente) afirmando que "visitar Datos Laborales dispara 8 GET .../field-history en paralelo de forma automática" — ese hallazgo era real en 14D.1 pero **fue corregido en 14D.2** (field-history ya es lazy desde esa etapa). El `.md` de salida ya se había corregido a mano en un commit anterior (`cdfdd88`), pero como el texto vivía hardcodeado en el generador (no en el `.md` en sí, que se regenera en cada corrida), **volvió a aparecer la afirmación vieja al correr el journey de nuevo para medir esta etapa** — se corrigió la fuente (2 strings estáticos en el generador, líneas ~270 y ~507) con el mismo texto "Corregido en 14D.2" ya aprobado, para que no vuelva a regresar en futuras corridas.

---

## 7. Riesgos

- **`derivedCompanyId`/`derivedCompanyName`/`assignedCount` vacíos en el catálogo liviano** (§3): si un futuro consumidor de `usePositions`/`useActivePositions` empieza a necesitarlos, va a recibir valores vacíos silenciosamente en vez de un error — documentado explícitamente acá y en el código.
- **Dos selects de Position coexistiendo** (`positionInclude` para Puestos, `positionOptionSelect` para Legajos): si el modelo `Position` gana un campo nuevo en el futuro y Legajos llega a necesitarlo, hay que acordarse de agregarlo a `positionOptionSelect` también — no hay un mecanismo automático que lo detecte. Mismo tipo de riesgo ya aceptado en otros selects livianos de este proyecto (`employeeOptionsCache`, etc.).
- **`status` como filtro del nuevo endpoint no usado hoy por Legajos**: `usePositions`/`useActivePositions` siguen filtrando `activeOnly` del lado del cliente (traen todo, filtran en JS) en vez de pasar `?status=ACTIVO` al backend — se implementó el soporte en el schema/repositorio por consistencia con `listPositionsQuerySchema`, pero no se cableó desde los hooks porque no era parte del pedido y hacerlo agrega otro punto de cambio de comportamiento sin pedido explícito. Documentado como candidato de una futura micro-optimización (§9).
- **Caché backend nueva** (`positionOptionsCache`, 60s): mismo criterio de riesgo ya aceptado para `employeeOptionsCache` — una ventana de hasta 60s donde un puesto recién creado/editado podría no reflejarse si la invalidación fallara; mitigado con `positionOptionsCache.clear()` explícito en los 3 handlers de escritura (cubierto, no solo documentado).

---

## 8. Validación — antes/después con números reales

Medido corriendo `npm run perf:journey:employees` antes (reporte guardado de esta sesión, previo a 14D.4) y después de aplicar los cambios (mismo entorno local, staging real vía Neon).

| Caso | Antes 14D.3 | Después 14D.4 | Mejora | Comentario |
|---|---|---|---|---|
| `GET /api/positions` → `GET /api/positions/options` | 3739ms | **2514ms** | **~32.8%** | Real, medida, sin datos inventados. **No alcanza ninguna de las 2 metas** (ideal <1000ms, aceptable <1500ms) — ver causa exacta abajo. |
| Cantidad de llamadas al endpoint en el recorrido | 1 | 1 | Sin cambios | Ya estaba deduplicado por caché frontend antes de esta etapa (§1.15-1.18) — no hay nada más que deduplicar. |
| Endpoint en rango Crítico (>3000ms) | Sí (3er lugar del ranking) | **No — ahora en rango Lento (2000-3000ms)** | Mejora real de categoría | Bajó de 3 a 2 los endpoints en rango Crítico del recorrido completo (§16 del reporte). |
| `GET .../overview-details` (fuera de alcance, control de que no se rompió nada) | 3517ms/3519ms | 3763ms/3762ms | Sin cambios significativos (~7%, ruido normal de red real) | No se tocó esta etapa — la variación está dentro del ruido esperado de Neon (mismo criterio de variación ya visto entre corridas en etapas previas). |
| `GET .../position-validation` (control) | 2987ms, 1 llamada | 2688ms, 1 llamada | Sin cambios de comportamiento | Confirma que la caché de sesión de 14D.2.1 sigue intacta. |
| `GET .../field-history` — cantidad total (control) | 8 | 8 | Sin cambios | Confirma que el fix lazy de 14D.2 sigue intacto. |
| Acciones cubiertas / salteadas | 56/56, 0 salteadas | 56/56, 0 salteadas | Sin cambios | — |
| Errores HTTP / consola | 0 / 0 | 0 / 0 | Sin cambios | Confirmado. |
| Sanitización de UUIDs en el reporte | Sin UUIDs | Sin UUIDs | Sin cambios | Verificado con `grep -E` sobre `.md` y `.json`, 0 coincidencias. |

### Causa exacta de no alcanzar la meta, y próximo paso

Los ~2400-2500ms restantes se explican por la misma causa raíz que 14D.2.1/14D.3 ya documentaron y no resolvieron por ser una inversión de infraestructura más grande: sin `relationJoins`, la cadena `sector → area → establishment → businessUnit` (3-4 niveles) más `salaryCategories.salaryCategory` siguen resolviéndose como round-trips mayormente secuenciales contra Neon (~500-900ms cada uno), incluso ya con el select recortado a sólo `id`/`name` por nivel — el recorte de columnas (Opción A) redujo el volumen de datos transferido y el trabajo de la base por fila, pero no puede eliminar el número de saltos de red que exige resolver una relación anidada sin `JOIN` nativo.

**Próximo paso, si se decide seguir invirtiendo en este endpoint**: activar `previewFeatures=["relationJoins"]` de Prisma — candidato ya señalado 5 veces (14C.1, 14C.3, 14D.2.1, 14D.3, acá). Sigue siendo un cambio de infraestructura de alcance global (afecta cualquier query con relaciones anidadas en todo el backend), fuera del alcance de una etapa quirúrgica de un solo endpoint — requiere su propia etapa de evaluación dedicada.

---

## 9. Qué quedó pendiente

- `relationJoins` de Prisma — único camino confiable para bajar de forma sostenida por debajo de ~1500-2000ms en endpoints con cadenas de relaciones profundas (candidato repetido 5 veces, ver §8).
- Cablear `status=ACTIVO` como filtro de backend en `useActivePositions()` (en vez de traer todo y filtrar client-side) — soporte ya existe en el schema/repositorio (§7), no cableado esta etapa por no ser parte del pedido explícito.
- Si en el futuro `derivedCompanyId`/`derivedCompanyName`/`assignedCount` pasan a ser necesarios en Legajos, hay que ampliar `positionOptionSelect` — documentado en §3/§7 para que quede claro por qué se excluyeron y qué haría falta agregar.
