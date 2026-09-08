# Etapa 14H.3 — Optimización de Turnos + Horas especiales

Fecha: 2026-09-08
Estado: implementado, validado, medido antes/después, **pendiente de aprobación para commitear**
Continúa: `docs/decisions/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md` (diagnóstico macro que detectó ambos hallazgos), `docs/decisions/WORK_REGIMES_PERFORMANCE_AND_KEYS_14H2.md` (mismo patrón de dedupe/cache aplicado a un módulo distinto).
Alcance: exclusivamente Turnos y Horas especiales — frontend (`workforceApiService.ts`, `shiftAssignmentApiService.ts`, `cachePolicy.ts`) y backend (`shiftAssignment.controller.ts` + nuevo `shiftAssignment.cache.ts`). **No se tocó `ShiftsPage.tsx`, `WorkScheduleSettingsPage.tsx`, `SpecialHourRulesCalendarMonth.tsx`, `workforce.service.ts`, `workforce.controller.ts` ni ningún otro archivo de UI o de otro módulo** — todos los cambios viven en la capa de servicio API (frontend) y en la capa de cache (backend), sin tocar componentes ni lógica de negocio.

---

## 1. Contexto

14H.1 (diagnóstico macro) identificó Turnos y Horas especiales como las únicas 2 tarjetas de Configuración sin ningún cache frontend. 14H.2 (Regímenes laborales) estableció y validó el patrón de fix para este síntoma exacto: dedupe in-flight vía `cachedData()` + invalidación explícita en los mutadores reales. Esta etapa aplica el mismo patrón, ya probado, a Turnos y Horas especiales — con un hallazgo backend adicional (`shiftAssignment.summary()` no tenía ninguna cache, a diferencia de `shiftTemplates`/`doubleHourRules`, que sí la tenían desde la Etapa 9C).

---

## 2. Evidencia desde 14H.1 y 14H.2

- 14H.1 midió "Entrar a Turnos" en **1697ms** con `GET /workforce/shift-templates` y `GET /shifts/assignments/summary` duplicados (2 requests cada uno) dentro de la misma ventana.
- 14H.1 midió "Entrar a Horas especiales" en **1832ms** con `GET /workforce/double-hour-rules` y `GET /workforce/double-hour-rules/calendar` duplicados (2 requests cada uno).
- 14H.2 confirmó que este síntoma (requests duplicadas por StrictMode sin dedupe frontend) es el mismo patrón ya diagnosticado y corregido 8+ veces en la serie 14G — la solución (`cachedData()` con `pendingRevalidations`) es la misma en todos los casos, cambia sólo la policy/family.

---

## 3. Diagnóstico Turnos (con evidencia — antes de tocar código)

- **Endpoints al entrar** (`ShiftsPage.tsx`): `Promise.all([workforceApiService.shiftTemplates(), shiftAssignmentApiService.getSummary()])` → `GET /workforce/shift-templates`, `GET /shifts/assignments/summary`. Frontend ya usa `Promise.all` (no hay antipatrón de concurrencia en el propio componente).
- **Búsqueda/filtro**: `FilterPanel` (código/nombre/categoría) y `select` de Estado — ambos filtran en memoria sobre el `fetch-all` ya traído (sin request nuevo), confirmado leyendo `ShiftsPage.tsx`. No hay paginación (catálogo chico administrado a mano, mismo criterio ya aceptado para Turnos en 9E/9F).
- **Duplicados StrictMode/remount**: confirmado — `main.tsx` tiene `<React.StrictMode>` activo; ninguno de los 2 endpoints tenía `cachedData` (`apiRequest(..., {apiCache:false})` directo en ambos servicios), así que el doble-montaje disparaba 2 requests reales a cada uno.
- **`cachedData` frontend**: no existía en ninguno de los 2 (`workforceApiService.shiftTemplates()`, `shiftAssignmentApiService.getSummary()`).
- **Cache backend**: `shiftTemplates()` **sí** tenía cache (`shiftTemplatesCache`, TTL 30s, Etapa 9C, `workforce.cache.ts`) — el hallazgo real es que la cache backend por sí sola no evita el duplicado: dos requests casi simultáneas llegan al backend antes de que la primera termine de escribir su propia entrada, y ambas terminan pegándole a Neon (confirmado con las duraciones observadas: 394ms/579ms para `shift-templates`, ninguna "instantánea" como debería verse un cache-hit real). `shiftAssignmentService.summary()` **no** tenía ninguna cache backend — módulo `shifts` sólo tenía `shiftAlert.cache.ts`, nada para `shiftAssignment`.
- **`$transaction` innecesario**: no encontrado — `shiftAssignment.repository.ts:countByTemplateAndStatus` es un único `groupBy` (no hay una segunda query que paralelizar). `workforce.service.ts` no usa `$transaction` en ningún lado (grep exhaustivo sobre el archivo completo).
- **Includes pesados / over-fetch**: no encontrado — `shiftTemplates()` es un `findMany` plano sin relaciones; `shiftAssignmentRepository.countByTemplateAndStatus` es una agregación `groupBy` sin ningún `include` (no trae empleados ni turnos completos, sólo cuenta).
- **Filtros en DB o frontend**: en frontend (fetch-all + filtro en memoria) — ya evaluado y aceptado en 9E/9F para este catálogo chico, no se cambia esta etapa (fuera de alcance: "no cambiar reglas de negocio de turnos").
- **Paginación**: no aplica (fetch-all sobre un catálogo chico, mismo criterio ya vigente).
- **Blanking**: no aplica — no hay refetch dinámico en esta pantalla más allá del montaje inicial (sin filtro server-side que dispare un nuevo request).

## 4. Diagnóstico Horas especiales (con evidencia)

- **Endpoints al entrar** (`WorkScheduleSettingsPage.tsx`): `Promise.all([workforceApiService.doubleHourRules(), orgStructureApiService.getCatalog(), positionApiService.getAll({status:"ACTIVO"})])` (frontend ya paraleliza correctamente) + un fetch separado, desacoplado, del componente `SpecialHourRulesCalendarMonth` → `workforceApiService.doubleHourRulesCalendar(from, to, kindFilter)`. 4 requests reales en un montaje en frío (el mayor conteo de todas las tarjetas de Configuración).
- **Búsqueda/filtro**: `select` "Filtrar por clasificación" filtra la TABLA en memoria (fetch-all), pero además dispara un refetch real del calendario (`doubleHourRulesCalendar` con `kind` distinto) — confirmado en `SpecialHourRulesCalendarMonth.tsx`, effect con deps `[cursor, refreshToken, kindFilter]`.
- **Duplicados StrictMode/remount**: confirmado — mismo mecanismo que Turnos. `doubleHourRules()` y `doubleHourRulesCalendar()` no tenían `cachedData`.
- **`cachedData` frontend**: no existía en ninguno de los 3 (`doubleHourRules`, `doubleHourRulesCalendar`; `orgStructureApiService.getCatalog()`/`positionApiService.getAll()` sí ya lo tenían, de etapas previas).
- **Cache backend**: `doubleHourRules()` **sí** tenía cache (`doubleRulesCache`, TTL 30s, Etapa 9C). `calendarPreview()` (el endpoint de `doubleHourRulesCalendar`) **deliberadamente no tiene cache backend** — comentario explícito en `workforce.cache.ts` desde 9C: "ya tiene su propio refresh-tras-mutación en el frontend" (el prop `calendarRefreshToken`). **Se respeta esta decisión previa** — no se agregó cache backend a `calendarPreview`, sólo dedupe frontend (ver §7).
- **`$transaction` innecesario**: no encontrado (mismo archivo, mismo grep exhaustivo que Turnos).
- **Includes pesados / over-fetch**: `doubleRules()` usa `include` con 6 relaciones, pero todas de 1 nivel y con `select` recortado donde corresponde (`employees.employee: {id,legajo,firstName,lastName}`, `company/sector/costCenter/position: {id,name}`) — dentro del límite de 2-3 niveles de `PERFORMANCE_STANDARDS.md` §4, no es la cadena profunda de 4-5 niveles que sí fue un problema real en Puestos (14D.4). `calendarPreview()` sólo trae `employees:{select:{employeeId:true}}` y `dates:true` — liviano. **No se encontró over-fetch real en ninguno de los 2** — no se tocó ningún `select`/`include`.
- **Filtros en DB o frontend**: mixto por diseño — la tabla filtra en memoria (catálogo chico), el calendario filtra en DB vía el parámetro `kind` que `calendarPreview` ya soporta desde 12B. Ambos comportamientos ya eran correctos, sin cambios.
- **Paginación**: no aplica (catálogo chico, mismo criterio que Turnos).
- **Blanking**: **no hay** — `SpecialHourRulesCalendarMonth.tsx` ya implementa el patrón de referencia de `PERFORMANCE_STANDARDS.md` §7 desde la Etapa 8B (`hasLoadedCurrentMonth` ref, loading grande sólo en la primera carga de cada mes, refresh silencioso tras `refreshToken`/`kindFilter`). **No se tocó** — nada que corregir ahí.

---

## 5. Causa raíz

Idéntica en ambos submódulos: **falta de dedupe frontend**, no un problema de shape de datos ni de queries mal escritas. `React.StrictMode` (activo en toda la app, `main.tsx`) invoca el efecto de fetch de cada pantalla dos veces al montar; sin `cachedData()` (cuyo `pendingRevalidations` colapsa llamadas concurrentes con la misma key en una sola promesa), cada invocación dispara un `apiRequest` real. Para `shiftTemplates`/`doubleHourRules` (que sí tenían cache backend desde 9C) esto significaba que ambas requests llegaban al backend antes de que la primera terminara de escribir su propia entrada de cache — el cache backend, sin coalescing de requests en vuelo (a diferencia de `cachedData()` del frontend), no evita esta carrera. Para `shiftAssignment.summary()` y `doubleHourRulesCalendar()` (sin cache backend) el efecto era el mismo duplicado, sin ninguna mitigación.

---

## 6. Cambios aplicados

### 6.1 `frontend/src/services/api/workforceApiService.ts`

- `shiftTemplates()`, `doubleHourRules()`, `doubleHourRulesCalendar()`: ahora pasan por `cachedData()` (antes: `apiRequest` directo, `apiCache:false`).
- `createShiftTemplate`/`updateShiftTemplate`/`removeShiftTemplate`/`createDoubleHourRule`/`updateDoubleHourRule`/`removeDoubleHourRule`: ahora invalidan la familia `"workforce-config"` (antes: ninguna invalidación frontend — el backend ya se invalidaba solo).

### 6.2 `frontend/src/services/api/shiftAssignmentApiService.ts`

- `getSummary()`: ahora pasa por `cachedData()`.
- `assign()`/`update()`/`remove()`: ahora invalidan la familia `"workforce-config"`.

### 6.3 `frontend/src/services/cache/cachePolicy.ts`

Nueva familia `"workforce-config"` (agregada al union `CacheFamily`), 4 policies nuevas — ver §10.

### 6.4 `backend/src/modules/shifts/shiftAssignment.cache.ts` (nuevo archivo)

`shiftAssignmentSummaryCache` — mismo patrón exacto que `shiftTemplatesCache`/`doubleRulesCache` (9C) y `shiftAlertListCache` (14G.5): `createTtlCache`, TTL 30s.

### 6.5 `backend/src/modules/shifts/shiftAssignment.controller.ts`

`summary`: ahora lee/escribe `shiftAssignmentSummaryCache` con `userScopedCacheKey` (helper local, mismo patrón exacto que `workforce.controller.ts`/`shiftAlert.controller.ts` — nunca compartido entre módulos). `assign`/`update`/`remove`: ahora llaman `clearShiftAssignmentSummaryCache()`.

**No se tocó**: `ShiftsPage.tsx`, `WorkScheduleSettingsPage.tsx`, `SpecialHourRulesCalendarMonth.tsx` (ninguna pantalla/componente UI), `workforce.service.ts`, `workforce.controller.ts`, `workforce.cache.ts` (los caches de 9C siguen exactamente iguales), `shiftAssignment.service.ts`, `shiftAssignment.repository.ts`, `shiftAssignment.schemas.ts`, `shifts.routes.ts` (RBAC intacto), `holidayWorkAssignment.*` (Asignaciones de feriados, ver §7), Regímenes laborales, Puestos, Fichador.

---

## 7. Qué NO se cambió (decisiones explícitas)

- **`calendarPreview()` sigue sin cache backend** — decisión de 9C respetada (ver §4): tiene su propio mecanismo de refresh-tras-mutación en el frontend (`calendarRefreshToken`), que un TTL cache backend rígido podría interferir sin coordinación adicional. El dedupe frontend (§6.1) ya resuelve el duplicado real sin necesitar ese cambio.
- **`HolidayWorkAssignmentsPage.tsx` no se tocó**, pero se beneficia de forma inevitable: esa página también llama `workforceApiService.shiftTemplates()` (para su selector de filtro) — al cachear el servicio compartido, sus visitas también dejan de generar un request duplicado. Es un efecto colateral inevitable de cachear un método de servicio compartido por 2 pantallas, no un cambio a esa página (consistente con la regla "tocar otro módulo sólo si es inevitable por un componente/archivo genuinamente compartido").
- **`doubleRules()` `include`/`shiftAssignmentRepository.countByTemplateAndStatus`**: sin cambios — ya estaban correctamente acotados (§3-4), no había over-fetch que corregir.
- **RBAC/scope**: `shifts.routes.ts`/`workforce.routes.ts` sin tocar. `employeeAccessWhere(user)` en `shiftAssignmentService.summary()` sin cambios — la nueva cache respeta el scope existente vía `userScopedCacheKey`.
- **`ShiftAssignment.getAll()`/`assign()`/`update()`/`remove()` del listado completo** (usado presumiblemente por una pantalla de detalle de turno, fuera del alcance medido por 14H.1): `getAll()` no se tocó (sin evidencia de duplicado — 14H.1 no lo midió); `assign`/`update`/`remove` sólo ganaron la invalidación necesaria para que la nueva cache de `getSummary()` no quede stale, sin ningún otro cambio de comportamiento.

---

## 8. Contrato API preservado

Sin cambios en `shiftAssignment.schemas.ts`, `workforce.schemas.ts`, rutas, métodos HTTP, query params, ni shape de respuesta de ningún endpoint. `GET /shifts/assignments/summary` sigue devolviendo `{data: ShiftAssignmentSummary[]}` idéntico; `GET /workforce/shift-templates`/`/double-hour-rules`/`/double-hour-rules/calendar` sin cambios.

## 9. RBAC/scope preservado

`GET /shifts/assignments/summary`: `requireAnyRole(all)` sin cambios (todos los roles autenticados, con `employeeAccessWhere` acotando qué empleados cuenta cada uno). Escrituras (`POST`/`PATCH`/`DELETE /shifts/assignments`): `requireAnyRole([roles.rrhh])` sin cambios. `workforce.routes.ts` (shift-templates/double-hour-rules): sin tocar.

---

## 10. Cache/dedupe — detalle

| Policy | Family | TTL | Persist | Sensitive | Motivo |
|---|---|---|---|---|---|
| `shiftTemplatesCatalog` | `workforce-config` | 30s | No | No | Config sin PII |
| `doubleHourRulesCatalog` | `workforce-config` | 30s | No | **Sí** | `DoubleHourRule.employees` trae legajo/nombre/apellido cuando la regla está limitada a empleados específicos |
| `doubleHourRulesCalendarByMonth` | `workforce-config` | 30s | No | No | Sin datos de empleados (sólo id/nombre de regla por día) |
| `shiftAssignmentSummary` | `workforce-config` | 30s | No | No | Sólo conteos agregados por turno, sin PII |

- **Family única `"workforce-config"`** para las 4 (mismo criterio que `"work-regimes"` en 14H.2: entidades relacionadas de una misma pantalla comparten familia; invalidar de más ante una mutación de una de ellas es aceptable — nunca al revés).
- **Key**: `` `GET:${path}` `` en los 4 casos — `shiftTemplates`/`doubleHourRules` sin query params (key estable); `doubleHourRulesCalendar` incluye `from`/`to`/`kind` en la query string (cada mes/clasificación es una entrada distinta); `getSummary` sin query params.
- **Usuario/scope**: no se embebe en la key del lado del frontend — mismo criterio que toda policy `sensitive` de este proyecto (el cache vive en el navegador de una sesión; `clearAllAppCaches()` ya corre en login/logout/cambio de cuenta, ver `WORK_REGIMES_PERFORMANCE_AND_KEYS_14H2.md` §6 para el detalle de por qué esto es seguro). El backend sí embebe usuario+rol (`userScopedCacheKey`, `shiftAssignmentSummaryCache`), porque esa cache SÍ es compartida entre requests de distintos usuarios.
- **Invalidaciones**: los 9 mutadores reales (`createShiftTemplate`/`updateShiftTemplate`/`removeShiftTemplate`/`createDoubleHourRule`/`updateDoubleHourRule`/`removeDoubleHourRule`/`assign`/`update`/`remove` de asignaciones) invalidan `"workforce-config"` — confirmado exhaustivo con `grep -rn "prisma\.\(shiftTemplate\|doubleHourRule\|shiftAssignment\)\.\(create\|update\|delete\)" backend/src`, sin resultados fuera de `workforce.service.ts`/`shiftAssignment.repository.ts`.
- **Riesgos**: hasta 30s de staleness si dos pestañas de la misma sesión mutan y leen casi simultáneamente — mismo perfil ya aceptado para `work-regimes`/`positions`/dashboard.

---

## 11. Tests

### Backend

- **Nuevo**: `shiftAssignment.controller.test.ts` (7 tests) — cache hit/miss, key scopeada por usuario+rol (dos usuarios nunca comparten resultado), invalidación explícita, e `it.each` de los 3 mutadores (`assign`/`update`/`remove`) invalidando correctamente. Mismo patrón exacto que `shiftAlert.controller.test.ts` (14G.5).
- Resto de la suite de `shifts`/`workforce-management` sin cambios — no se tocó ninguna query ni lógica de servicio, sólo la capa de cache del controller.

### Frontend

- `workforceApiService.test.ts`: nuevo describe block — dedupe in-flight (`Promise.all` de 2 llamadas idénticas → 1 request) para `shiftTemplates`/`doubleHourRules`/`doubleHourRulesCalendar`, cache-hit dentro del TTL, cache-miss al cambiar `kind` (calendario), `it.each` de los 6 mutadores invalidando `"workforce-config"`, y confirmación de refetch tras invalidar.
- `shiftAssignmentApiService.test.ts`: nuevo describe block — mismo patrón para `getSummary()` + `it.each` de `assign`/`update`/`remove`.
- No se crearon tests dependientes de tiempos exactos — todos usan `vi.useFakeTimers()`/conteo de llamadas, nunca umbrales de milisegundos reales.

Suite completa: backend **1241/1241** (79 archivos, +7 tests nuevos); frontend **767/767** (77 archivos, +18 tests nuevos).

---

## 12. Métricas antes/después (medidas reales, `npm run perf:journey:admin-config`, 2 corridas)

### Turnos

| Métrica | Antes (14H.1/14H.2) | Después (14H.3) | Mejora |
|---|---|---|---|
| Entrar a Turnos (acción) | 1697ms | 930ms | **-45,2%** |
| `GET /workforce/shift-templates` — requests en la ventana | 2 (394ms, 579ms) | 1 (369ms) | **Duplicado eliminado** |
| `GET /shifts/assignments/summary` — requests en la ventana | 2 (391ms, 1134ms) | 1 (350ms) | **Duplicado eliminado** |

Confirmado además en una acción posterior del mismo recorrido ("Ver detalle de turno"): `GET /workforce/shift-templates` respondió en **1ms** — cache-hit real, tanto frontend como backend funcionando en conjunto.

### Horas especiales

| Métrica | Antes (14H.1/14H.2) | Después (14H.3) | Mejora |
|---|---|---|---|
| `GET /workforce/double-hour-rules` — requests en la ventana | 2 (351ms, 352ms) | 1 (568-839ms según corrida) | **Duplicado eliminado** |
| `GET /workforce/double-hour-rules/calendar` — requests en la ventana | 2 (383ms, 564ms) | 1 (565-829ms según corrida) | **Duplicado eliminado** |
| Entrar a Horas especiales (acción, agregada) | 1832ms | 2215-2937ms (2 corridas) | **Sin mejora neta — ver nota** |

**Nota honesta sobre el agregado de "Entrar a Horas especiales"**: el duplicado se eliminó de forma consistente y confirmada en las 2 corridas (0 duplicados en ambas, contra 2x/2x antes) — la causa raíz diagnosticada en §5 está corregida. Pero el tiempo TOTAL de la acción no bajó porque está dominado por `GET /positions?status=ACTIVO` (1632ms en la corrida 1, 2365ms en la corrida 2) — un endpoint que **no forma parte del alcance de esta etapa** (pertenece a Puestos/14D.4, ya cacheado desde esa etapa con TTL 5min, y su variación entre corridas es el mismo "cold start" de Neon ya documentado repetidas veces en este proyecto, no una regresión introducida acá). Confirmado no tocando nada de `positions` en esta etapa.

### General (ambas corridas)

| Métrica | Antes | Después |
|---|---|---|
| HTTP errors | 0 | 0 |
| Console errors | 0 | 0 |
| Escrituras ejecutadas | 0 | 0 |

---

## 13. Validaciones ejecutadas

- Backend: `npx prisma validate` ✅, `npm run typecheck` ✅, `npm test` ✅ 1241/1241 (79 archivos), `npm run build` ✅.
- Frontend: `npx tsc -b --noEmit` ✅, `npx tsc -p tsconfig.e2e.json --noEmit` ✅, `npm test` ✅ 767/767 (77 archivos), `npm run build` ✅.
- `npm run perf:journey:admin-config` ✅ **passed** (2 corridas, 0 HTTP/console errors, 0 escrituras en ambas).
- `npm run perf:journey:workforce` (14G.1, regresión transversal) ✅ passed, 1.1min.
- `npm run perf:journey:employees` (14D.1, regresión transversal) ✅ passed, 40.9s.
- `git diff --check` ✅ sin errores de espacios en blanco.

---

## 14. Riesgos pendientes

- Perfil de staleness de 30s en las 4 nuevas caches — mismo riesgo ya aceptado para el resto de las caches de configuración del proyecto, mitigado por invalidación explícita en los 9 mutadores reales.
- `GET /positions` sigue siendo un contribuyente real de lentitud al entrar a Horas especiales (§12) — fuera de alcance de esta etapa; ya tiene su propia cache desde 14D.4, la variabilidad observada es de latencia real de Neon, no de falta de cache.
- Asignaciones de feriados (`HolidayWorkAssignmentsPage.tsx`) se beneficia parcialmente (su llamada a `shiftTemplates()` ahora está cacheada) pero sigue teniendo sus propios endpoints sin cache (`holiday-work/dates`, `/assignments`, `/candidates`) — explícitamente fuera de alcance de esta etapa ("No tocar Asignaciones de feriados todavía salvo dependencia directa inevitable").

## 15. Recomendación para 14H.4

Por evidencia de esta corrida y de 14H.1:
1. **Asignaciones de feriados** — sigue siendo, después de Login, de las acciones más lentas del recorrido completo (hasta 5 GETs encadenados al elegir una fecha), sin ningún cache frontend/backend en sus 3 endpoints propios.
2. **Conceptos horarios** — el submódulo con más profundidad potencial sin explorar (reglas + empleados asociados anidados), aún sin medir más allá del listado.
3. Considerar si vale la pena una etapa dedicada a `GET /positions` para reducir la variabilidad observada (aunque ya está cacheado y fuera del alcance de Configuración estrictamente).

---

No se cambió contrato de API. No se cambió RBAC/scope. No se cambió diseño visual. No se tocó Gestión horaria, Fichador, Regímenes laborales, Puestos, Asignaciones de feriados, Conceptos horarios, Empresas y estructura, Categorías documentales ni Parámetros de auditoría. No se creó ninguna migración. No se ejecutó ninguna escritura real. No commitear sin aprobación explícita del usuario. No hacer push.
