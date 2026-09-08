# Etapa 14H.4 — Optimización de Asignaciones de feriados

Fecha: 2026-09-08
Estado: implementado, validado, medido antes/después (3 corridas), **pendiente de aprobación para commitear**
Continúa: `docs/decisions/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md`, `docs/decisions/WORK_REGIMES_PERFORMANCE_AND_KEYS_14H2.md`, `docs/decisions/SHIFTS_AND_SPECIAL_HOURS_PERFORMANCE_14H3.md` (mismo patrón de dedupe/cache/`$transaction`→`Promise.all` aplicado a un módulo distinto), `docs/decisions/HOLIDAY_WORK_ASSIGNMENTS_12D.md` (implementación original de la pantalla y sus 4 endpoints), `docs/decisions/HOLIDAY_INACTIVITY_NOTIFICATIONS_12E.md` (consumidor read-only de `HolidayWorkAssignment`, no tocado).
Alcance: exclusivamente Asignaciones de feriados — frontend (`holidayWorkAssignmentApiService.ts`, `cachePolicy.ts`) y backend (`holidayWorkAssignment.repository.ts`). **No se tocó `HolidayWorkAssignmentsPage.tsx`, `ShiftsPage.tsx`, `WorkScheduleSettingsPage.tsx`, `SpecialHourRulesCalendarMonth.tsx`, `workforce.service.ts`/`.controller.ts`/`.cache.ts`, `shiftAssignment.*`, `attendanceInactivity.service.ts` (12E) ni ningún otro archivo de UI, negocio o de otro módulo.**

---

## 1. Contexto

14H.1 midió "Entrar a Asignaciones de feriados" como una de las acciones más lentas de Configuración, con "hasta 5 GETs en cascada al elegir una fecha". 14H.3 estableció que Turnos/Horas especiales compartían un mismo endpoint (`GET /workforce/shift-templates`), y que cachearlo beneficiaría también a esta pantalla de forma inevitable (confirmado en esta etapa: `shift-templates` aparece en **1ms** — cache-hit real). 14H.2/14H.3 establecieron el patrón de fix ya probado 9+ veces: dedupe in-flight vía `cachedData()` + `$transaction`→`Promise.all` cuando corresponde.

---

## 2. Evidencia desde 14H.1-14H.3

- 14H.1: "Entrar a Asignaciones de feriados" — 2253ms; "Seleccionar fecha de feriado" — 2248ms.
- Medición más reciente antes de esta etapa (post-14H.3, capturada al iniciar el diagnóstico de esta etapa): "Entrar a Asignaciones de feriados" — **1133ms** con `GET /shifts/holiday-work/dates` **duplicado** (2 requests, 380ms/552ms) — la mejora parcial ya observada frente a 14H.1 se debe casi enteramente al cache de `shift-templates` ganado en 14H.3 (1ms, cache-hit), no a ningún cambio en este módulo. "Seleccionar fecha de feriado" — **1738ms**, con `GET /shifts/holiday-work/candidates` en **811ms** (sin duplicar) — el endpoint individual más lento de toda la pantalla.

---

## 3. Diagnóstico Asignaciones de feriados (con evidencia)

### 3.1 Carga inicial

- **Endpoints al entrar** (`HolidayWorkAssignmentsPage.tsx`): 2 `useEffect` independientes, ambos en el montaje:
  - Efecto A (`[cursor, datesRetryToken]`): `holidayWorkAssignmentApiService.getHolidayDates(from, to)` → `GET /shifts/holiday-work/dates` — el único dato necesario para pintar "Feriados disponibles".
  - Efecto B (`[]`, sólo mount): `Promise.all([orgStructureApiService.getCatalog(), workforceApiService.shiftTemplates()])` — sólo alimenta los `<select>` de filtro (Turno/Sector) dentro del panel de convocatoria, que ni siquiera se renderiza hasta que hay una fecha elegida.
- **Principales vs. auxiliares**: `dates` es el único endpoint principal de la carga inicial (bloquea la sección "Feriados disponibles"). `org-structure`/`shift-templates` son auxiliares — alimentan filtros que el usuario puede no llegar a usar nunca en esa visita, y **no bloquean la primera pintura** (ver 3.1.2).
- **¿Paralelo o secuencial?**: paralelo — ambos efectos se disparan en el mismo ciclo de render de React, sin que uno espere al otro (confirmado leyendo el código: ninguno depende del estado que setea el otro).
- **¿Dependencias artificiales?**: ninguna encontrada. Los efectos C (`getAssignmentsByDate`) y D (`getCandidates`) sólo corren cuando `selectedDate` está seteado — esto **no es una dependencia artificial**, es la dependencia real e inevitable del flujo (no se puede mostrar la convocatoria de una fecha sin que el usuario la haya elegido primero). No se encontró ningún catálogo bloqueando innecesariamente la sección de feriados.
- **¿Algo bloquea primera pintura sin necesidad?**: no — `org-structure`/`shift-templates` ya corren en paralelo con `dates`, nunca antes; su resultado sólo se usa dentro del panel condicional (`{selectedDate ? <Section>...` ), que ni siquiera existe en el DOM hasta elegir fecha.

### 3.2 Duplicados

- **StrictMode/remount**: confirmado — `GET /shifts/holiday-work/dates` aparecía 2 veces (380ms/552ms) en la ventana de "Entrar a Asignaciones de feriados", 3 mediciones independientes antes de esta etapa (14H.1, y 2 lecturas post-14H.3). `getHolidayDates()` no tenía `cachedData`.
- **¿Cache backend sin coalescing frontend?**: no aplica acá — a diferencia de `shiftTemplates`/`doubleHourRules` (14H.3), `holidayDatesInRange`/`calendarPreview` **nunca tuvieron cache backend** (decisión de 9C, respetada — ver `SHIFTS_AND_SPECIAL_HOURS_PERFORMANCE_14H3.md` §4/§7). El duplicado acá es 100% de falta de dedupe frontend.
- **`getAssignmentsByDate`/`getCandidates`**: **sin duplicados** en ninguna de las 3 mediciones — consistente con que StrictMode sólo dobla los efectos que corren en el **montaje** del componente; estos 2 corren en respuesta a un click del usuario (`selectedDate` cambia bien después de que el montaje ya estabilizó), nunca en el montaje mismo. **No se agregó `cachedData` a estos 2** — no hay evidencia de duplicado que lo justifique (ver Riesgos, §14, sobre por qué no se especula con cachearlos "por si acaso").
- **¿Real o metodológico?**: real — confirmado en 3 corridas independientes, mismo patrón exacto (2 requests idénticas a `dates`, nunca a los otros 3 endpoints).

### 3.3 Backend

- **`$transaction` innecesario**: **encontrado y corregido** — `holidayWorkAssignmentRepository.findCandidates` (el endpoint de 811ms, el más lento de la pantalla) envolvía `employee.findMany`+`employee.count` (lecturas independientes) en `prisma.$transaction([...])`. Mismo antipatrón ya corregido 9+ veces en las series 14G/14H. `findByDate` (el endpoint `assignments`) y `holidayDates`/`calendarPreview` **no** usan `$transaction` (grep exhaustivo sobre `workforce.service.ts` y `holidayWorkAssignment.repository.ts`, sin resultados fuera del ya corregido).
- **Includes pesados / over-fetch**: no encontrado — `findCandidates` usa `select` explícito (no `include`): `employeeSelect` (`id,legajo,firstName,lastName,status`) + `sector:{id,name}` + `shiftAssignments` recortado a `{shiftTemplate:{id,code,name}}` sólo de las `HABILITADO`. `findByDate` usa `include` pero con `select` recortado en ambas relaciones (`employee`/`shiftTemplate`, ambos 1 nivel). Ninguno trae datos completos de empleado/turno — ya estaban correctamente acotados desde 12D. **No se tocó ningún `select`/`include`.**
- **Filtros en DB o frontend**: en DB — `candidatesWhere` arma el `where` real de Prisma (sectorId/shiftTemplateId/withoutShift/search), confirmado leyendo el repositorio. Ya era correcto.
- **Paginación**: sí, desde el diseño original (12D) — `page`/`take` con `skip`/`take` reales, `take` máximo 500 en el schema. El frontend pide `take=300` fijo (límite V1 ya documentado explícitamente en 12D §10, sin UI de "cargar más") — **no es un bug de paginación faltante, es una decisión de alcance ya tomada y documentada**; no se cambia esta etapa (fuera de "no cambiar reglas de negocio"/"si ya existen query params, usarlos correctamente" — ya se usan correctamente).
- **Cache backend**: no existía ninguna para los 3 endpoints de lectura (`dates`/`candidates`/`assignments`) — módulo `shifts` sólo tiene `.cache.ts` para `shiftAlert` y (desde 14H.3) `shiftAssignment`, ninguno para `holidayWorkAssignment`. **No se agregó** — ver §7 para la justificación de por qué no era necesario/seguro agregar una acá.

### 3.4 Frontend

- **Blanking**: no hay — confirmado en el código (`if (!candidates) setCandidatesStatus("loading")`, guardia idéntica a la ya documentada y validada en 12D §10) y en el propio 12D §10 ("No blanquea la tabla durante un refetch por filtro"). **No se tocó.**
- **Filtros que re-piden datos auxiliares innecesariamente**: no — cambiar un filtro (búsqueda/turno/sector/sin turno) sólo dispara `getCandidates` (correcto, es lo único que ese filtro debe re-pedir); nunca vuelve a pedir `dates`/`org-structure`/`shift-templates`/`assignments` (confirmado por los arrays de dependencias de cada efecto).
- **Catálogos que podrían no bloquear primera pintura**: ya no bloquean — confirmado en 3.1 (Efecto B corre en paralelo con Efecto A, nunca antes).
- **Endpoints ya cacheados desde 14H.3**: `shiftTemplates()` — confirmado con evidencia real (1ms en las 3 corridas de esta etapa, cache-hit). `org-structure` ya tenía cache propia (familia `org-structure`, anterior a esta serie).

---

## 4. Endpoints detectados (mapa completo)

| Endpoint | Rol | Cache frontend (antes) | Cache backend | `$transaction` (antes) |
|---|---|---|---|---|
| `GET /shifts/holiday-work/dates` | Principal (carga inicial) | No | No (decisión de 9C respetada) | No |
| `GET /workforce/shift-templates` | Auxiliar (filtro) | **Sí, desde 14H.3** | Sí, desde 9C | No |
| `GET /org-structure` | Auxiliar (filtro) | Sí, ya existente | No | No |
| `GET /shifts/holiday-work/assignments` | Principal (al elegir fecha) | No | No | No |
| `GET /shifts/holiday-work/candidates` | Principal (al elegir fecha) | No | No | **Sí — corregido esta etapa** |

---

## 5. Causa raíz

Dos causas distintas, cada una con su propio fix:
1. **`dates`**: falta de dedupe frontend ante el doble-montaje de StrictMode — mismo patrón exacto ya diagnosticado y corregido en 14H.2/14H.3.
2. **`candidates`**: antipatrón `$transaction` serializando 2 lecturas independientes (`findMany`+`count`) en una sola conexión — mismo patrón exacto ya corregido 9+ veces en las series 14G/14H.

`assignments` no tenía ninguna causa raíz que corregir (ni duplicado, ni `$transaction`, ni over-fetch) — se dejó exactamente igual.

---

## 6. Cambios aplicados

### 6.1 `frontend/src/services/api/holidayWorkAssignmentApiService.ts`

- `getHolidayDates()`: ahora pasa por `cachedData()` (antes: `apiRequest` directo, `apiCache:false`). Familia `"workforce-config"` (reusada, ver §10) — **no se agregó ninguna invalidación nueva** en `saveAssignments()`, porque guardar una convocatoria no cambia qué fechas son feriado (ver §10).
- `getCandidates()`/`getAssignmentsByDate()`/`saveAssignments()`: **sin cambios** — sin evidencia de duplicado que justifique tocarlos.

### 6.2 `backend/src/modules/shifts/holidayWorkAssignment.repository.ts`

`findCandidates`: `prisma.$transaction([employee.findMany, employee.count])` → `Promise.all([...])` sobre el cliente global. `where`/`select`/`orderBy`/`skip`/`take` sin cambios — cero impacto de contrato.

### 6.3 `frontend/src/services/cache/cachePolicy.ts`

Nueva policy `holidayDatesByMonth`, familia `"workforce-config"` (reusada, no se creó una familia nueva) — ver §10.

**No se tocó**: `HolidayWorkAssignmentsPage.tsx` (ninguna línea de UI), `holidayWorkAssignment.service.ts`/`.controller.ts`/`.schemas.ts`, `shifts.routes.ts` (RBAC intacto), `workforce.service.ts`/`.controller.ts`/`.cache.ts` (Turnos/Horas especiales, 14H.3), `attendanceInactivity.service.ts` (12E, consumidor read-only de `HolidayWorkAssignment` vía Prisma directo — no pasa por `holidayWorkAssignmentRepository`, confirmado no afectado por ningún cambio de esta etapa).

---

## 7. Qué NO se cambió (decisiones explícitas)

- **No se agregó cache backend** a `candidates`/`assignments`/`dates` — evaluado y descartado: el `$transaction`→`Promise.all` de `candidates` ya ataca la causa real medida (811ms→~370ms típico, ver §12); `dates` ya resuelve su duplicado en el frontend sin necesitar una capa backend nueva (mismo criterio que `calendarPreview`, 9C); `assignments` no mostró ningún problema. Agregar cache backend a un endpoint filtrado por texto libre (`candidates`, con `search` variable) tendría baja tasa de acierto real y el riesgo de una key mal formada — no justificado sin evidencia de que el `$transaction` fix por sí solo sea insuficiente.
- **`getCandidates()`/`getAssignmentsByDate()` sin `cachedData`** — sin duplicados medidos, no se tocan (ver §3.2).
- **Límite `take=300` sin paginación real en la UI** (documentado desde 12D) — sin cambios, decisión de alcance ya tomada, no forma parte de esta etapa.
- **`saveAssignments()`** — sin cambios, es el único write path de este módulo y no se ejecutó ninguna escritura real en esta etapa.
- **RBAC/scope**: `shifts.routes.ts` sin tocar.

---

## 8. Contrato API preservado

Sin cambios en `holidayWorkAssignment.schemas.ts`, rutas, métodos HTTP, query params ni shape de respuesta de ningún endpoint.

## 9. RBAC/scope preservado

`GET /shifts/holiday-work/{dates,candidates,assignments}`: `requireAnyRole(all)` sin cambios (RRHH/Supervisión/Carga Horaria). `PUT /shifts/holiday-work/assignments`: `requireAnyRole([roles.rrhh])` sin cambios. `employeeAccessWhere(user)` en `candidates`/`assignments` sin cambios.

---

## 10. Cache/dedupe — detalle

| Policy | Family | TTL | Persist | Sensitive |
|---|---|---|---|---|
| `holidayDatesByMonth` | `workforce-config` | 30s | No | No |

- **Family**: `"workforce-config"` (reusada, mismo criterio que 14H.3: `dates` sale de `DoubleHourRule.kind=FERIADO` — la MISMA entidad que ya vive en esa familia vía `doubleHourRulesCatalog`/`doubleHourRulesCalendarByMonth`). Esto significa que crear/editar/eliminar una regla de Horas Especiales (los 3 mutadores de `workforceApiService.ts`, ya invalidando `"workforce-config"` desde 14H.3) **también invalida esta cache automáticamente, sin código nuevo** — confirmado con test (§11).
- **Key**: `` `GET:${path}` ``, con `from`/`to` en la query string — cada mes visible es una entrada distinta.
- **Filtros incluidos**: `from`/`to` (únicos params del endpoint).
- **Invalidaciones**: ninguna agregada en `holidayWorkAssignmentApiService.ts` — se invalida "gratis" vía la familia compartida. Confirmado explícitamente con test que `saveAssignments()` (el único write de este módulo) **no** invalida `"workforce-config"` — es correcto, porque convocar/cancelar gente para un feriado no cambia qué fechas son feriado.
- **Riesgos**: hasta 30s de staleness si dos pestañas mutan/leen casi simultáneamente reglas de Horas Especiales — mismo perfil ya aceptado para el resto de `workforce-config`.

---

## 11. Tests

### Backend

- `holidayWorkAssignment.repository.test.ts`: nuevo test confirmando `$transaction` no se llama más; los 12 tests preexistentes (filtros/paginación/scope) sin cambios — el mock de `$transaction` ya delegaba en `Promise.all` internamente, así que ningún assert existente se vio afectado.

### Frontend

- **Nuevo** `holidayWorkAssignmentApiService.test.ts` (este servicio no tenía ningún test antes de esta etapa): dedupe in-flight (`Promise.all` de 2 llamadas idénticas → 1 request), cache-hit dentro del TTL, cache-miss al cambiar de mes, contrato de respuesta sin cambios, invalidación cruzada desde `"workforce-config"` (confirma la integración con `workforceApiService`, no reimplementa nada), y confirmación explícita de que `saveAssignments()` **no** invalida la familia.
- `HolidayWorkAssignmentsPage.test.tsx` (18 tests preexistentes): sin cambios, todos verdes — confirma que ningún comportamiento de UI se modificó.
- No se crearon tests dependientes de tiempos exactos.

Suite completa: backend **1242/1242** (79 archivos, +1 test nuevo); frontend **773/773** (78 archivos, +6 tests nuevos).

---

## 12. Métricas antes/después (medidas reales, `npm run perf:journey:admin-config`, 3 corridas)

| Métrica | Antes (post-14H.3) | Después (14H.4, 3 corridas) | Lectura |
|---|---|---|---|
| `GET /shifts/holiday-work/dates` — requests en la ventana | 2 (380ms, 552ms) | 1 en las 3 corridas (767ms, 376ms, 351ms) | **Duplicado eliminado, consistente en 3/3 corridas** |
| `GET /shifts/holiday-work/candidates` | 811ms (sin duplicar) | 364ms / 4383ms (outlier) / 371ms | **Mediana ~370ms, -54,4%** (ver nota) |
| Entrar a Asignaciones de feriados (acción) | 1133ms | 2277ms (outlier, `org-structure` 1694ms) / 1120ms / 1089ms | **Mediana ~1105ms, -2,5%** (ver nota) |
| Seleccionar fecha de feriado (acción) | 1738ms | 1232ms / 5283ms (outlier, arrastra el de `candidates`) / 1212ms | **Mediana ~1222ms, -29,7%** |
| Requests totales en la ventana de "Entrar a..." | 5 | 4 (una menos: el duplicado de `dates`) | -20% |

**Nota sobre los outliers**: 1 de las 3 corridas mostró `GET /org-structure` en 1694ms (vs. 518-559ms en las otras 2) y otra corrida mostró `GET /shifts/holiday-work/candidates` en 4383ms (vs. 364-371ms en las otras 2) — ninguno de los dos endpoints tiene relación causal con el cambio del otro (son corridas distintas), y ambos son consistentes con el mismo patrón de latencia variable de Neon ya documentado repetidas veces en esta serie (`GET /positions` en 14H.3, `GET /org-structure` acá). Se optó por reportar la mediana de 3 corridas en vez de una sola, precisamente para no reportar un outlier como si fuera el resultado típico — mismo criterio de honestidad ya aplicado en `SHIFTS_AND_SPECIAL_HOURS_PERFORMANCE_14H3.md` §12.

### General (las 3 corridas)

| Métrica | Antes | Después |
|---|---|---|
| HTTP errors | 0 | 0 |
| Console errors | 0 | 0 |
| Escrituras ejecutadas | 0 | 0 |

---

## 13. Validaciones ejecutadas

- Backend: `npx prisma validate` ✅, `npm run typecheck` ✅, `npm test` ✅ 1242/1242 (79 archivos), `npm run build` ✅.
- Frontend: `npx tsc -b --noEmit` ✅, `npx tsc -p tsconfig.e2e.json --noEmit` ✅, `npm test` ✅ 773/773 (78 archivos), `npm run build` ✅.
- `npm run perf:journey:admin-config` ✅ **passed** (3 corridas, 0 HTTP/console errors, 0 escrituras en las 3).
- `npm run perf:journey:workforce` (14G.1, regresión transversal) ✅ passed, 1.1min.
- `npm run perf:journey:employees` (14D.1, regresión transversal) ✅ passed, 44.7s.
- `git diff --check` ✅ sin errores de espacios en blanco.

---

## 14. Riesgos pendientes

- `GET /org-structure`/`GET /shifts/holiday-work/candidates` siguen mostrando latencia variable en corridas puntuales (§12) — no atribuible a esta etapa, mismo patrón de variabilidad de Neon ya documentado en 14H.3.
- Límite `take=300` sin "cargar más" (12D) sigue siendo deuda documentada, fuera de esta etapa.
- Si en el futuro se agregan más filtros dinámicos a `candidates` con alta tasa de cambio, reconsiderar si amerita cache backend — no justificado hoy con la evidencia disponible.

## 15. Recomendación para 14H.5

Con Turnos, Horas especiales, Regímenes laborales y ahora Asignaciones de feriados optimizados, los submódulos de Configuración restantes sin ninguna medición de journey más allá del listado básico son **Conceptos horarios** (el de mayor profundidad potencial sin explorar — reglas + empleados asociados anidados) y, en menor medida, **Categorías documentales**/**Parámetros de auditoría** (ambos con editor inline no explorado, sin evidencia de problema real todavía). Recomendado: una etapa de relevamiento dedicada a Conceptos Horarios antes de decidir si amerita optimización.

---

No se cambió contrato de API. No se cambió RBAC/scope. No se cambió diseño visual. No se tocó Gestión horaria, Fichador, Regímenes laborales, Turnos (salvo el beneficio inevitable ya ganado en 14H.3), Horas especiales, Puestos, Conceptos horarios, Empresas y estructura, Categorías documentales ni Parámetros de auditoría. No se creó ninguna migración. No se ejecutó ninguna escritura real. No commitear sin aprobación explícita del usuario. No hacer push.
