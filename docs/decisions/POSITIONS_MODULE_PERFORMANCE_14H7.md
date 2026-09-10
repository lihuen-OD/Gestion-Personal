# Etapa 14H.7 — Diagnóstico y optimización del módulo Puestos completo

## 1. Contexto

La serie 14G (Gestión horaria) cerró completa. La serie 14H ("Performance read-only de módulos administrativos/configuración") avanzó así: 14H.1 diagnóstico macro de Configuración + Puestos, 14H.2 Regímenes laborales, 14H.3 Turnos + Horas especiales, 14H.4 Asignaciones de feriados, 14H.5 Conceptos horarios, 14H.6 Empresas y estructura + Categorías documentales + Parámetros de auditoría. 14H.7 cierra el módulo **Puestos completo** — no sólo `GET /positions/options`, que ya había sido optimizado en la Etapa 14D.4 pero exclusivamente para su consumo desde **Legajos** (3 call sites: `usePositions`/`useActivePositions`/`resolveRelations`), dejando explícitamente sin tocar `PuestosPage.tsx`, `PuestoDetailPage.tsx` y `PuestoCreatePage.tsx` (confirmado leyendo `docs/decisions/POSITIONS_PERFORMANCE_FOR_EMPLOYEES_14D4.md` §1.1-1.4 y §5). Esta etapa cubre exactamente esos 3 puntos, más el endpoint de empleados vinculados y la relectura de "relaciones" que el módulo expone.

## 2. Evidencia heredada de 14D.4 y 14H.1-14H.6

- **14D.4**: confirmó el shape completo de `positionInclude` (14 escalares, 9 pesados: `mission/description` + 7 columnas JSON, más `sector→area→establishment→{businessUnit,company}` completo y `salaryCategories.salaryCategory` completo) y creó `GET /positions/options` con un `select` liviano (`positionOptionSelect`) — pero sólo cableado a los 3 consumidores de Legajos. El propio documento deja constancia expresa (§1.27-1.30) de que Puestos SÍ necesita los 9 campos pesados y `assignedCount` para su propia UI, así que no tocó `positionInclude`/`GET /positions` en sí.
- **14H.1** (diagnóstico macro): releyó `PuestosPage.tsx`/`PuestoDetailPage.tsx`/`PuestoCreatePage.tsx` y confirmó que Puestos seguía usando `GET /positions`/`GET /positions/:id` completos (no el catálogo liviano de 14D.4, que es un endpoint distinto para otro consumidor). Encontró y documentó explícitamente (§8, recomendación #5): *"Puesto (detalle) — 2 GETs secuenciales no paralelos (`getById` → `getAssignedEmployees`), mismo patrón ya optimizado para Legajos en 14D"*. También registró que Puestos es la única tarjeta de todo el journey con búsqueda **server-side paginada real** (el resto de Configuración filtra en memoria sobre un fetch-all).
- **14H.2-14H.6**: consolidaron el patrón `$transaction([...])` → `Promise.all([...])` para lecturas independientes, aplicado 12+ veces antes de esta etapa en `work-regimes`, `shiftAssignment`, `holidayWorkAssignment`, `hourConcepts`/`hourConceptRules`, `documentCategories`, `auditParameters`. `positions.repository.ts::findMany` (rama con filtros) tenía exactamente el mismo antipatrón, nunca corregido hasta ahora.

## 3. Diagnóstico — Puestos listado (`PuestosPage.tsx`)

Confirmado leyendo el archivo completo (222 líneas): 3 fetches independientes al montar, ninguno encadenado:

1. `orgStructureApiService.getCatalog()` — opciones de filtro (Unidad de negocio/Establecimiento/Área/Sector), cacheado 10min.
2. `positionApiService.getAll()` (antes de esta etapa) — universo completo de puestos (hasta 300) sólo para las 6 tarjetas resumen (`StatCard`) y las opciones de "Rango salarial" del filtro. **Nunca** pintaba la tabla.
3. `positionApiService.list({ page, take: 25, search, status, sectorId, areaId, establishmentId, businessUnitId, salaryRangeCategory })` — tabla paginada real (Etapa 9E), server-side.

**Búsqueda/filtros**: confirmado que `search` y los 6 filtros viajan como query params reales al backend (`toListQuery` en `positionApiService.ts`) — Puestos es la única pantalla de este journey con paginación y búsqueda 100% server-side, no fetch-all filtrado en memoria.

**Blanking**: no existe — `if (!items.length) setListStatus("loading")` (línea 140) sólo activa el loading grande cuando la tabla está vacía; cambiar de filtro/página o refrescar tras una mutación mantiene los datos visibles (mismo patrón ya establecido en 9B/9C).

**Sobre-fetch confirmado**: el fetch de tarjetas resumen/rango salarial (punto 2) usaba `getAll()` → `positionInclude` completo (9 columnas JSON pesadas + `establishment.company` completo + `salaryCategories.salaryCategory` completo), pero `summary()`/`options()` (líneas 65-75 y 52-63) sólo leen `status`, `assignedCount` y `salaryCategoryNames` — exactamente el mismo patrón de sobre-fetch que 14D.4 ya había diagnosticado y corregido para Legajos, nunca corregido para el propio Puestos.

**"Duplicado" reportado por 14H.1 — diagnóstico de causa exacta**: el journey (§10, antes de esta etapa) marcaba `GET /api/positions x2` dentro de la ventana de "Entrar a Puestos". Investigado a fondo: **no es un doble-montaje de StrictMode**. El detector de duplicados normaliza cada request con `sanitizeRequestPath()` (`new URL(...).pathname`, descarta el query string — confirmado en `frontend/e2e/support/sanitizePath.ts`), así que `GET /positions?take=300` (punto 2, tarjetas) y `GET /positions?page=1&take=25&...` (punto 3, tabla) — dos requests reales y legítimos, con propósitos distintos — colapsaban al mismo path sanitizado `/positions` y se contaban como "duplicado". Al mover el punto 2 a `GET /positions/options` (path distinto), el falso positivo desaparece — pero el problema real que sí ameritaba arreglo siempre fue el sobre-fetch del punto 2, no una llamada redundante.

## 4. Diagnóstico — Puesto detalle (`PuestoDetailPage.tsx`)

Confirmado leyendo el archivo completo (146 líneas): 2 fetches independientes al montar, ambos dependientes únicamente del `id` de ruta (ninguno depende del resultado del otro):

- `positionApiService.getById(id)` — detalle completo (`positionInclude`, sin cambios: Puestos sí necesita los 9 campos pesados para sus 11 pestañas).
- `positionApiService.getAssignedEmployees(id)` — empleados vinculados.

**Causa raíz del hallazgo de 14H.1**: antes de esta etapa, el segundo efecto dependía de `[position?.id, position?.name]` — un estado que sólo existe **después** de que `getById()` resuelve. Esto encadenaba ambas llamadas en serie aunque ninguna necesita el resultado de la otra (ambas sólo requieren el `id` de la URL, disponible desde el primer render). Mismo patrón compuesto ya optimizado para `EmployeeDetailPage` en la serie 14D.

**Efecto colateral real detectado al corregirlo**: al pasar la dependencia a `[id]` (disponible en el primer render), `getAssignedEmployees` quedó expuesto al doble-montaje de React StrictMode en desarrollo — **este sí es un duplicado real** (no un artefacto del sanitizador de paths, a diferencia de §3): 2 requests genuinos a la misma URL exacta `GET /positions/:id/employees` dentro de la ventana de "Ver detalle de puesto", porque el método no tenía ningún dedupe/cache frontend (era un `apiRequest` crudo). Corregido envolviéndolo en `cachedData` (ver §9).

**Relaciones/tabs**: no hay ningún fetch adicional para resolver nombres — el detalle no trae "empleados vinculados, jerarquía, relaciones y catálogos" en una sola respuesta pesada; son 2 respuestas separadas y livianas para lo que muestran. No hay N+1 (ver §5).

**Modal de editar**: no existe como modal — Puestos es 100% navegación de página completa (`/puestos`, `/puestos/nuevo`, `/puestos/:id`, confirmado en `App.tsx`, sin ninguna ruta `/puestos/:id/editar`). La edición es inline por pestaña dentro de `PuestoDetailPage`: cada tab recibe `setPosition` y muta estado local; sólo se persiste al hacer click explícito en "Guardar cambios" (`positionApiService.update`). Cambiar de pestaña o navegar fuera de la página **no ejecuta ninguna escritura** — es seguro para journey read-only sin necesidad de abrir/cerrar un modal.

## 5. Diagnóstico — Relaciones ("reporta a" / "supervisa a")

Hallazgo relevante para el alcance funcional pedido: **no existe una relación jerárquica real resoluble entre puestos**. Confirmado leyendo `backend/prisma/schema.prisma` (modelo `Position`, sin FK ni auto-relación de jerarquía), `positions.schemas.ts` (`internalRelations`/`externalRelations` son `z.array(z.unknown())`, JSON libre sin shape) y `PuestoRelationsTab.tsx` (renderiza dos listas editables de texto libre `{id, name, description?}`, "Relaciones internas"/"Relaciones externas" — nombre y descripción tipeados a mano, sin `positionId` de referencia). El tipo frontend `Position` sí declara `reportsTo?: string`/`supervises?: string` (`position.types.ts:29-30`), pero son campos **muertos**: no existen en el modelo Prisma, no se validan en `positions.schemas.ts`, no se mapean en `positionApiService.ts` (`mapFromApi`/`mapToApi`) y ningún componente vivo los lee — sólo aparecen en `PuestoFields.tsx` (`emptyPosition()`, inicializados a `""`) y en datos mock legacy (`data/mockPositions.ts`, usados por servicios `*MockService.ts` sin relación con las páginas reales de Puestos).

**Consecuencia para el diagnóstico de performance**: como "reporta a"/"supervisa a" nunca resuelven contra otro registro de `Position`, **no hay ningún riesgo de N+1** al mostrarlas (no se trae "todos los puestos para resolver nombres" porque no hay nombres que resolver — es texto tipeado). No se encontró ningún código muerto o UI rota que corregir; se documenta acá porque el pedido original asumía una relación resoluble que, verificado el código, no existe como feature implementada. `GET /positions/options` (14D.4, ampliado en §9) sigue siendo el catálogo liviano correcto para el día en que esto se implemente como relación real.

## 6. Diagnóstico — Empleados vinculados (`GET /positions/:id/employees`)

- **Existe** como panel dedicado (`PuestoAssignedPeopleTab.tsx`, pestaña 10 "Personas Asignadas").
- **Select liviano ya correcto antes de esta etapa**: `findAssignedEmployees()` (`positions.repository.ts`) usa un `select` explícito (`id, legajo, legajoFinnegans, cuil, dni, firstName, lastName, status, receiptCategory, internalCategory, position{id,name,code}, sector{id,name}, costCenter{id,name}, companies{...}`) — no el registro completo de `Employee`. Sin N+1: una sola query con relaciones incluidas.
- **Sin paginación de servidor**: `take: 500`, igual que los endpoints equivalentes ya existentes (`/work-regimes/:id/employees`, `/hour-concepts/:id/employees`) — no es un gap nuevo de esta etapa, es el mismo límite ya aceptado en el resto del proyecto; documentado como riesgo pendiente (§17), no corregido acá por no ser un caller con volumen real que lo justifique hoy.
- **RBAC preservado**: ruta protegida con `requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria])` (mismo criterio que los 2 endpoints equivalentes citados arriba) **más** `employeeAccessWhere(user)` aplicado dentro del `where` de la query — doble capa, sin cambios esta etapa.
- **Chequeo de existencia sobre-fetching**: `listAssignedEmployees()` (`positions.service.ts`) llamaba `positionsRepository.findById(id)` (positionInclude completo: 9 columnas JSON + cadena de 4-5 niveles) sólo para confirmar que el puesto existe y mapear un P2025 a 404 — el resultado se descartaba por completo. Corregido con `existsById()` (`select: { id: true }`).

## 7. Endpoints detectados (mapa completo del módulo)

| Endpoint | Usado por | Cambio en 14H.7 |
|---|---|---|
| `GET /positions` (paginado, `positionInclude`) | `PuestosPage.tsx` (tabla, vía `list()`) | `$transaction([findMany,count])` → `Promise.all([...])` en la rama con filtros (repositorio) |
| `GET /positions` (sin filtros, cacheado 120s en memoria) | Otros callers internos del `listCache` | Sin cambios |
| `GET /positions/:id` (`positionInclude`) | `PuestoDetailPage.tsx` (`getById`) | Sin cambios de select; efecto de fetch pasó a paralelo con el de abajo |
| `GET /positions/:id/employees` | `PuestoDetailPage.tsx` (`getAssignedEmployees`), pestaña "Personas Asignadas" | Nuevo dedupe/cache frontend (`positionsAssignedEmployees`, 15s); chequeo de existencia interno pasó de `findById` a `existsById` |
| `GET /positions/options` (14D.4) | Legajos (3 call sites, sin cambios) + **ahora también** `PuestosPage.tsx` (tarjetas/rango salarial) y `PuestoCreatePage.tsx` (próximo código) | Nuevo parámetro opcional `includeAssignedCount` (default `false`, no rompe a Legajos) |
| `POST/PATCH/DELETE /positions[/:id]` | Crear/editar/ocultar puesto | Sin cambios de contrato ni de lógica |

## 8. Causa raíz

1. **Listado**: sobre-fetch — el fetch de tarjetas resumen/rango salarial usaba el mismo `positionInclude` pesado que el detalle completo, cuando sólo lee 3 campos livianos ya cubiertos por el catálogo de 14D.4.
2. **Detalle**: acoplamiento innecesario — el segundo fetch dependía de un estado derivado del primero (`position?.id`) en vez del dato ya disponible desde el primer render (`id` de la URL), serializando 2 lecturas independientes.
3. **Empleados vinculados**: mismo antipatrón "descartar `positionInclude` completo para un chequeo de existencia" ya visto y corregido en otros módulos de esta serie; más ausencia de dedupe frontend en un endpoint que, al paralelizarse con `getById` (punto 2), quedó expuesto al doble-montaje de StrictMode.
4. **`$transaction` en `findMany`**: mismo antipatrón corregido 12+ veces antes en 14G/14H, nunca aplicado a `positions.repository.ts` hasta ahora.

## 9. Cambios aplicados

### 9.1 Backend

- **`backend/src/modules/positions/positions.repository.ts`**:
  - `findMany` (rama con filtros): `prisma.$transaction([findMany, count])` → `Promise.all([...])`. `where`/`orderBy`/`skip`/`take` sin cambios.
  - Nuevo `existsById(id)`: `findUniqueOrThrow({ where: { id }, select: { id: true } })`, mismo mapeo de error P2025 → 404 que `findById`.
  - `findOptions(query)`: nuevo parámetro opcional `includeAssignedCount` — agrega `_count: { select: { employees: true } }` al `select` liviano sólo cuando se pide (default `false`, sin efecto para los 3 callers de Legajos).
- **`backend/src/modules/positions/positions.schemas.ts`**: `listPositionOptionsQuerySchema` gana `includeAssignedCount: z.coerce.boolean().optional()`.
- **`backend/src/modules/positions/positions.service.ts`**: `listAssignedEmployees` usa `existsById` en vez de `findById` para el chequeo de existencia.

### 9.2 Frontend

- **`frontend/src/services/cache/cachePolicy.ts`**: nueva policy `positionsAssignedEmployees` — familia `"positions"`, TTL 15s, `persist: false`, `sensitive: true` (PII de empleados, nunca a IndexedDB).
- **`frontend/src/services/api/positionApiService.ts`**:
  - `getOptions(params?: { includeAssignedCount?: boolean })` — key de cache distinta según el parámetro, misma policy/familia `positionsCatalog`.
  - `getAssignedEmployees(id)` — pasó de `apiRequest` crudo a `cachedData` con la policy nueva.
- **`frontend/src/pages/PuestosPage.tsx`**: fetch de tarjetas/rango salarial `getAll()` → `getOptions({ includeAssignedCount: true })`.
- **`frontend/src/pages/PuestoCreatePage.tsx`**: fetch para calcular el próximo código `getAll()` → `getOptions()` (sin `includeAssignedCount`, no lo necesita).
- **`frontend/src/pages/PuestoDetailPage.tsx`**: el efecto de `getAssignedEmployees` pasó a depender de `[id]` (antes `[position?.id, position?.name]`), disparándose en paralelo con `getById`.

### 9.3 Journey / documentación generada

- **`frontend/e2e/support/adminConfigurationJourney.ts`**: `COVERAGE_MATRIX` (fila "Entrar a Puestos") y las 2 filas de la tabla de submódulos (L y M) actualizadas para reflejar los endpoints/caches reales post-14H.7; la observación estructural de §15 sobre "2 GETs secuenciales" en Puesto (detalle) se corrigió para reflejar que ya está resuelto (mismo criterio ya aplicado en 14D.4 §6 cuando un hallazgo de una etapa anterior queda obsoleto tras el fix).

## 10. Qué NO se cambió

- `GET /positions`/`GET /positions/:id` (`positionInclude` completo) — Puestos sigue necesitando los 9 campos pesados para sus 11 pestañas; no se tocó el select.
- `listCache` interno (120s, ruta sin filtros de `findMany`) — sin cambios.
- Ninguna ruta, método HTTP, query param existente, nombre de campo ni shape de respuesta.
- RBAC/scope de ningún endpoint (`/:id/employees` sigue restringido a `rrhh`/`supervision`/`cargaHoraria` + `employeeAccessWhere`; el resto sigue en `requireAuth`/`adminRoles` sin cambios).
- Ninguna regla de negocio: alta/edición/inactivación/ocultamiento de puestos, cálculo de `assignedCount`, ni la lógica de "no borrar si tiene empleados asignados" (`positionsService.remove`).
- `WorkScheduleSettingsPage.tsx` (Carga Horaria, fuera de alcance — sigue usando `getAll()`/`positionInclude` sin cambios, confirmado por grep).
- Legajos: los 3 call sites de 14D.4 no se tocaron (siguen llamando `getOptions()` sin `includeAssignedCount`, comportamiento idéntico).
- Prisma schema / migraciones — cero cambios, cero migraciones nuevas.
- Diseño visual — cero cambios de CSS/markup.
- No se ejecutó ninguna escritura real durante el diagnóstico ni la medición.

## 11. Contrato de API preservado

- `GET /positions/options`: el nuevo `includeAssignedCount` es **opcional y aditivo** (default `false`) — los 3 callers de Legajos siguen recibiendo exactamente el mismo shape que antes.
- `GET /positions/:id/employees`: mismo shape de respuesta, mismo comportamiento (404 si el puesto no existe) — sólo cambió cómo se implementa internamente el chequeo de existencia.
- `GET /positions` (paginado): mismo shape (`{ data, meta }`), mismos query params, mismo orden — sólo cambió `$transaction` → `Promise.all` (transparente para el caller).
- Ningún endpoint nuevo reemplaza a uno existente; ninguno cambia de método o ruta.

## 12. RBAC/scope preservado

Confirmado sin cambios en `positions.routes.ts`: `GET /positions`, `GET /positions/options`, `GET /positions/:id` siguen bajo `requireAuth` sin rol adicional (igual que antes de 14D.4/14H.7); `GET /positions/:id/employees` sigue exigiendo `[roles.rrhh, roles.supervision, roles.cargaHoraria]` más `employeeAccessWhere(user)`; `POST`/`PATCH`/`DELETE` siguen bajo `adminRoles`. La nueva cache frontend (`positionsAssignedEmployees`) es `sensitive: true` y `persist: false` — nunca se escribe a IndexedDB, y su familia (`"positions"`) ya se invalida en cualquier `create`/`update`/`removeOrHide` de puesto, igual que el resto de las caches del módulo.

## 13. Cache/dedupe/loading

| Cache | Family | TTL | Persist | Sensitive | Key incluye | Invalidación |
|---|---|---|---|---|---|---|
| `positionsCatalog` (existente, reusada por `getOptions`) | `positions` | 5-10min | Sí | No | URL completa (incluye `includeAssignedCount` cuando se pasa) | `invalidateCacheFamily("positions", ...)` en `create`/`update`/`removeOrHide` — sin código nuevo |
| `positionsAssignedEmployees` (**nueva**) | `positions` | 15s | No | Sí (PII de empleados) | `GET /positions/:id/employees` (id incluido en la URL) | Misma familia `"positions"` — cubierta automáticamente por las invalidaciones existentes, más `invalidateEmployeeDependentCaches()` en cada cambio de `Employee.positionId` (sin invalidación nueva que agregar) |
| `positionOptionsCache` (backend, existente desde 14D.4, sin cambios) | — | 60s | — | — | `req.originalUrl` (incluye `includeAssignedCount` cuando se pasa) | `.clear()` en `create`/`update`/`remove` del controller |

**Riesgos de esta sección**: TTL de 15s en `positionsAssignedEmployees` implica una ventana corta donde una reasignación de empleado hecha desde **otra pestaña/sesión** podría no reflejarse de inmediato en el panel de un puesto ya abierto — mitigado por ser el mismo TTL ya aceptado para `workRegimeEmployeesList`/`hourConceptEmployeesList`, y por la invalidación real vía `invalidateEmployeeDependentCaches()` cuando la reasignación ocurre en la misma sesión del navegador.

## 14. Journey ampliado

No se amplió cobertura nueva de acciones (14H.1 ya cubría listado/búsqueda/filtros/limpiar, detalle, cambio de pestaña, entrada/salida de creación sin guardar — 4+2+2 = 8 acciones sobre Puestos, todas ya read-only y seguras). Se corrigió la **precisión** de la documentación generada por el journey (`adminConfigurationJourney.ts`, ver §9.3) para que refleje los endpoints/caches reales post-fix, siguiendo el mismo criterio que 14D.4 §6 (corregir la fuente del generador, no sólo el `.md` de salida, para que la corrección sobreviva a la próxima corrida).

## 15. Tests

**Backend** (`positions.repository.test.ts`, `positions.service.test.ts`):
- `existsById` usa `select: { id: true }`, no `positionInclude` (verificado inspeccionando el mock call).
- `existsById` propaga el rechazo (P2025) igual que `findById`.
- `findMany` con filtros: `expect(prisma.$transaction).not.toHaveBeenCalled()`, `findMany`/`count` llamados con el mismo `where`.
- `findOptions` con `includeAssignedCount: true`: agrega `_count.employees`, sin tocar el resto del select liviano (ni `mission` ni la cadena `sector.area.establishment.company`).
- `findOptions` sin `includeAssignedCount` (default): sigue sin `_count`, comportamiento idéntico a antes de 14H.7.
- `listAssignedEmployees` usa `existsById`, no `findById`, para el chequeo de existencia (camino feliz).

**Frontend**:
- `positionApiService.test.ts` (nuevo): 2 llamadas concurrentes a `getAssignedEmployees` generan 1 solo request real (dedupe in-flight); una segunda llamada dentro del TTL usa cache; cambiar de puesto es cache-miss (el id forma parte de la key); el contrato de retorno no cambia; `create`/`update`/`removeOrHide` invalidan la familia `"positions"`; tras invalidar, `getAssignedEmployees` vuelve a pedirse.
- `PuestoDetailPage.test.tsx` (nuevo): `getById` y `getAssignedEmployees` se disparan con el mismo id sin que uno espere al otro; carga correcta cuando ambos resuelven; error de `getById` no rompe por el resultado de `getAssignedEmployees`.
- `PuestoCreatePage.test.tsx` (nuevo): el próximo código se calcula con `getOptions()`, no con `getAll()`.
- `PuestosPage.test.tsx`: nuevo caso confirmando que el resumen se pide con `getOptions({ includeAssignedCount: true })`, no con `getAll()`.

Ningún test depende de tiempos exactos (todas las aserciones de TTL usan `vi.useFakeTimers()`/`vi.setSystemTime()`, no `Date.now()` real).

## 16. Métricas antes/después

Medido con `npm run perf:journey:admin-config` contra el mismo entorno (frontend+backend locales, backend conectado a staging real vía Neon — no aislado). **Nota metodológica** (misma ya documentada en 14D.4/14H.1/14H.6): los ms de red contra Neon staging varían de corrida a corrida por ruido real (se observó hasta ±500ms en la misma acción, sin ningún cambio de código, corriendo el journey 3 veces durante esta etapa) — la señal confiable es estructural (cantidad de requests, duplicados, peso del payload confirmado por el `select`/`include` real), no el ms puntual de una sola corrida.

| Métrica | Antes (HEAD, commit `4cec76e`) | Después (14H.7) | Evidencia |
|---|---|---|---|
| "Entrar a Puestos" — duplicado `GET /api/positions` dentro de la acción | Sí, x2 (§10 del journey) | No — 0 duplicados de Puestos en §10 | Causa real: colisión de path sanitizado entre 2 requests distintos (§3); resuelto al mover el fetch de tarjetas a `/positions/options` |
| "Entrar a Puestos" — requests totales | 3 | 3 (sin cambio — son 3 fetches legítimos, no se eliminó ninguno, se aligeró uno) | Journey §4 |
| "Entrar a Puestos" — payload del fetch de tarjetas/rango salarial | `positionInclude` completo (9 columnas JSON + `company`/`businessUnit` completos, hasta 300 filas) | `positionOptionSelect` + `_count` opcional (sin las 9 columnas pesadas ni `company`) | Diff de `positions.repository.ts` (§9.1), mismo criterio ya medido/aprobado en 14D.4 (~32.8% de reducción de tiempo de red para el mismo tipo de recorte) |
| "Ver detalle de puesto" — patrón de carga | Secuencial (`getById` → `getAssignedEmployees`) | Paralelo (ambos por `id` de ruta) | Diff de `PuestoDetailPage.tsx` (§9.2); confirmado por test dedicado |
| "Ver detalle de puesto" — duplicado `GET /positions/:id/employees` dentro de la acción | No expuesto (efecto dependía de `position?.id`, un solo disparo por resolución tardía) | Expuesto al paralelizar (StrictMode), corregido con `cachedData` — 0 duplicados en el journey final | §4 (diagnóstico), §10 del journey final (sin duplicados de Puestos) |
| `listAssignedEmployees` — query de chequeo de existencia | `findById` (`positionInclude` completo, descartado) | `existsById` (`select: { id: true }`) | Diff de `positions.service.ts`/`positions.repository.ts` |
| `findMany` (rama con filtros) | `$transaction([findMany, count])` | `Promise.all([findMany, count])` | Diff de `positions.repository.ts` |
| HTTP errors / console errors (journey completo) | 0 / 0 | 0 / 0 | 3 corridas de `perf:journey:admin-config` durante esta etapa, todas en verde |
| Escrituras ejecutadas | 0 | 0 | Assert automático del journey (`isWrite` nunca ejecutado) |

### Rango de ms observado (3 corridas de esta etapa, mismo código final, ilustra el ruido de Neon)

| Acción | Corrida 1 | Corrida 2 | Corrida 3 (final, con generador corregido) |
|---|---|---|---|
| Entrar a Puestos (network idle) | 931ms | 1451ms | 1466ms |
| Ver detalle de puesto (network idle) | 1300ms | 1473ms | 1376ms |
| Entrar a Crear puesto (network idle) | 876ms | 984ms | 1113ms |

Comparado contra el valor único registrado en HEAD antes de esta etapa (una sola corrida, misma variabilidad esperada): Entrar a Puestos 1216ms, Ver detalle de puesto 1513ms, Entrar a Crear puesto 1246ms — todos dentro del mismo rango de ruido que las 3 corridas de esta etapa, sin una mejora de ms concluyente en ninguna dirección. **La mejora real y verificable es estructural** (§16 tabla superior), no de latencia de red bruta — mismo patrón ya documentado en 14D.4 cuando un recorte de payload correcto no bajó de categoría de rango por la latencia base de Neon sin `relationJoins`.

## 17. Riesgos pendientes

- **`relationJoins` de Prisma no activado** (candidato repetido 6 veces: 14C.1, 14C.3, 14D.2.1, 14D.3, 14D.4, acá): sigue siendo la única palanca para bajar de forma sostenida la latencia de `positionInclude`/`positionOptionSelect` por debajo de ~1500-2000ms — fuera de alcance de una etapa quirúrgica de un solo módulo.
- **`GET /positions/:id/employees` sin paginación de servidor** (`take: 500`): mismo límite ya aceptado en endpoints equivalentes (`work-regimes`, `hour-concepts`) — no es un gap nuevo, pero tampoco se corrigió; documentado para si algún puesto real supera ese volumen.
- **TTL de 15s en `positionsAssignedEmployees`**: ventana corta donde una reasignación hecha en otra sesión podría no reflejarse de inmediato (§13).
- **`reportsTo`/`supervises` en el tipo `Position`**: campos muertos (§5) — no representan un riesgo de performance, pero si en el futuro alguien intenta cablearlos esperando que ya funcionen (porque el tipo los declara), va a descubrir que nunca llegaron al backend. Candidato de limpieza de tipos para una etapa de mantenimiento, fuera de alcance de performance.
- **Latencia de red real de Neon staging**: como en toda la serie, los ms brutos siguen sujetos a variabilidad de ~500ms entre corridas — no es un riesgo nuevo de esta etapa.

## 18. Recomendación para 14H.8

Con 14H.7 cerrado, la serie 14H (Configuración + Puestos) queda completa según el alcance original de 14H.1. Candidatos para continuar, en orden de evidencia:

1. **`relationJoins` de Prisma** (evaluación dedicada, alcance global): único camino confiable para bajar la latencia base de todas las cadenas de relaciones anidadas del proyecto (Puestos, Legajos, Regímenes laborales, etc.) — candidato repetido 6 veces sin una etapa propia todavía.
2. **Limpieza de tipos muertos** (`reportsTo`/`supervises` en `Position`, mocks legacy en `data/mockPositions.ts` sin importadores reales de las páginas de Puestos) — mantenimiento, no performance.
3. Si el criterio de la serie 14H se considera agotado, evaluar si queda algún submódulo fuera de Configuración/Puestos/Gestión horaria/Legajos sin diagnóstico propio (p. ej. Usuarios, Auditoría general) antes de declarar cerrada toda la ronda de performance read-only.

## Validaciones ejecutadas

- Backend: `npx prisma validate` ✅, `npm run typecheck` ✅ sin errores, `npm test` ✅ **1259/1259** (81 archivos), `npm run build` ✅ sin errores.
- Frontend: `npx tsc -b` ✅ sin errores, `npx tsc -p tsconfig.e2e.json --noEmit` ✅ sin errores, `npm test -- --run` ✅ **801/801** (81 archivos), `npm run build` ✅ sin errores ni warnings nuevos.
- `npm run perf:journey:admin-config` ✅ 3 corridas durante esta etapa, todas en verde (0 HTTP errors, 0 console errors, 0 escrituras) — assert de consola estricto pasa (a diferencia de 14H.1, que quedaba en rojo por el hallazgo de key duplicada en `AssociatedEmployeesPanel.tsx`, ya corregido en una etapa posterior de la serie).
- `npm run perf:journey:workforce` (14G.1, regresión) ✅ passed, 1.1min.
- `npm run perf:journey:employees` (14D.1, regresión) ✅ passed, 40.9s.
- `git diff --check` ✅ sin errores de espacios en blanco.
- `git status --short` / `git diff --stat`: cambios acotados a `backend/src/modules/positions/*`, `frontend/src/{pages/Puesto*,services/api/positionApiService*,services/cache/cachePolicy}.ts`, `frontend/e2e/support/adminConfigurationJourney.ts` y los 2 reportes generados de `docs/performance/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.{md,json}`. Los reportes colaterales `EMPLOYEES_PERFORMANCE_JOURNEY_14D1.{md,json}` y `WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.{md,json}`, regenerados como efecto inevitable de correr esos 2 journeys para el control de regresión, se restauraron (`git restore`) — mismo protocolo de cierre ya documentado en 14H.1 §9.

No se commiteó. No se hizo push.
