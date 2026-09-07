# Etapa 14G.4 — Diagnóstico fino y optimización de "Entrar a Carga de horas" (`/horas`)

Fecha: 2026-09-07
Estado: **completa. Optimización 100% frontend (sin tocar backend/Prisma/RBAC/contrato de API), con un fix de dedupe inevitablemente compartido con Bandeja de revisión (mismo componente `HoursPage.tsx`) — documentado en detalle en §10. Sin cambios de diseño visual.**
Alcance: `/horas` (`HoursPage.tsx`, modo grilla) y, por composición inevitable del mismo componente, `/pendientes` (`HoursPage.tsx`, modo `pendingOnly`).

---

## 1. Contexto

14G.1 midió "Entrar a Carga de horas (período actual)" en **3362ms** de `networkIdleMs`, rango **Crítico** (> 3000ms) — el peor de los 10 submódulos de Gestión horaria en esa corrida, pero sin que ningún endpoint individual cruzara el umbral Crítico por sí solo (el más lento, `GET /org-structure`, medía 1653ms — Medio). 14G.2 y 14G.3 resolvieron Inicio (`home-summary`) y Asistencia (`attendance/observations`) respectivamente, dejando a Carga de horas como el candidato más claro por **tiempo de acción compuesto** (ver §15 de `docs/decisions/WORKFORCE_MANAGEMENT_ATTENDANCE_OBSERVATIONS_PERFORMANCE_14G3.md`). Esta etapa diagnostica y optimiza específicamente esa composición.

## 2. Evidencia de 14G.1/14G.2/14G.3

De `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json` (corrida previa a esta etapa, post-14G.3):

- "Entrar a Carga de horas (período actual)": `networkIdleMs` **3362ms** (Crítico), 4 requests, **sin duplicados** dentro de la ventana de la acción (a diferencia de Inicio/Asistencia, que sí tenían duplicados por StrictMode — ver §9/§10 de 14G.1).
- Requests de esa acción: `GET /workforce/notifications-unread-count` 526ms, `GET /time-entries/summary` 550ms, `GET /org-structure` 1653ms, `GET /time-entries/period-employees` 1119ms.
- Tabla de submódulos de 14G.1 (§5): Carga de horas ya tenía cache frontend (`cachePolicies.timeEntriesAggregates`, 30s, sólo `period-employees`/`summary`) y cache backend (`period-employees`/`summary` 20s TTL) desde 14C.2 — no era un módulo sin optimizar, sino uno con un problema de **composición**.
- `docs/decisions/WORKFORCE_MANAGEMENT_ATTENDANCE_OBSERVATIONS_PERFORMANCE_14G3.md` §13 confirma que ningún request individual de Carga de horas cruzaba el umbral Crítico esta corrida, y recomienda D. Carga de horas como el siguiente candidato específicamente por tiempo de acción compuesto (no por endpoint).

## 3. Diagnóstico fino de la acción `/horas`

Lectura completa de `HoursPage.tsx` (componente compartido entre `/horas` y `/pendientes` vía la prop `pendingOnly`) antes de tocar nada:

- El componente tiene **4 efectos independientes** (separados en Etapa 9F): (A) grilla de período (`getPeriodEmployees`, sólo `!pendingOnly`), (B) bandeja de revisión (`list`/`listByEmployee`, sólo `pendingOnly`), (C) resumen (`getSummary`, ambos modos) + pendientes de novedades/desgloses (sólo `pendingOnly`), (D) catálogo de centros de costo (`orgStructureApiService.getCatalog()`, ambos modos, sin dependencias).
- **Causa encontrada**: los efectos A y B tenían un guard `if (!user || !costCenterOptionsReady) return;` — `costCenterOptionsReady` se pone en `true` recién cuando el efecto D (catálogo de org-structure) resuelve. Es decir, **la grilla/bandeja esperaban a que `GET /org-structure` completara antes de siquiera empezar a pedir `period-employees`/`list`**, aunque summary (efecto C) sí corría en paralelo sin ese gate.
- **Por qué el gate era artificial**: `costCenterId` (el único dato que la grilla/bandeja realmente necesitan del catálogo) sale de `costCenterOptions.find((item) => item.name === costCenter)`. Antes de que el catálogo cargue, `costCenterOptions` está vacío, así que `costCenterId` es `undefined` — exactamente el mismo valor que representa "Todos los centros de costo" (el filtro por default). El usuario no puede elegir un centro de costo específico antes de que el `<select>` tenga opciones, así que esperar a `costCenterOptionsReady` nunca cambiaba qué se iba a pedir — sólo demoraba cuándo se pedía.
- **Confirmado con el journey**: `GET /org-structure` (1653ms) + `GET /time-entries/period-employees` (1119ms) ≈ 2772ms, más el resto de overhead de scheduling/conexión, explica el `networkIdleMs` de 3362ms observado — consistente con una cadena **org-structure → period-employees** en vez de en paralelo.
- **¿org-structure bloquea la tabla?** Sí, indirectamente — no porque la tabla necesite esos datos (el catálogo sólo alimenta el `<select>` de centro de costo), sino por el gate artificial de arriba.
- **¿summary bloquea la tabla?** No — el efecto C nunca tuvo el gate de `costCenterOptionsReady` (confirmado leyendo el código; ya corría en paralelo antes de esta etapa).
- **¿period-employees sigue siendo el verdadero cuello?** No de forma aislada — su duración (1119-1547ms en las 3 corridas de esta etapa) nunca cruza el umbral Crítico por sí sola; el problema era 100% de composición (secuencial en vez de paralelo).
- **¿El problema es backend, frontend o composición?** Composición, 100% frontend. Se revisó el backend de los 3 endpoints (`findPeriodEmployees`, `summary`, `orgStructureRepository.getOverview`) y los 3 ya están optimizados desde 14C.2/etapas previas: `Promise.all` sobre el cliente `prisma` global (no `$transaction`), `select` recortado a lo que la grilla renderiza (`periodEmployeeSelect`, comentario de 14C.2), y cache backend con TTL razonable (`period-employees`/`summary` 20s vía `timeEntries.cache.ts`; `org-structure` 60s vía un cache in-memory dedicado en `orgStructure.repository.ts`, no sensible/no scopeado por usuario porque es un catálogo compartido, no PII). No se encontró ningún antipatrón de `$transaction`, ningún over-fetch nuevo, ninguna cache faltante o mal invalidada — ver §4.
- **¿Duplicados/StrictMode en la acción de entrada?** No para "Entrar a Carga de horas" (confirmado en 14G.1 y en las 3 corridas de esta etapa) — `getSummary`/`getPeriodEmployees`/`getCatalog` ya pasan por `cachedData` (`frontend/src/services/cache/cachedData.ts`), que dedupea llamadas concurrentes con la misma `requestKey` vía `pendingRevalidations` (un `Map` de promesas en vuelo) — el doble-montaje de StrictMode en dev coalesce a una sola llamada de red real.
- **Hallazgo nuevo (efecto colateral de remover el gate)**: al remover el gate de los efectos A y B, "Entrar a Carga de horas" (efecto A) siguió sin duplicados (protegido por `cachedData`), pero **"Entrar a Bandeja de revisión" (efecto B, `/pendientes`) empezó a mostrar `GET /api/time-entries` x2** en una corrida intermedia — porque `list`/`listByEmployee` (a diferencia de `getSummary`/`getPeriodEmployees`) **nunca pasaban por `cachedData`**, así que no tenían dedupe in-flight. Antes de esta etapa esto estaba enmascarado por el propio gate (el gate absorbía el doble-montaje de StrictMode, ver §10). Se corrigió en el mismo cambio — ver §6 y §10.
- **¿Catálogos que podrían cargarse lazy?** El catálogo de centros de costo (`org-structure`) ya se carga en paralelo (nunca bloqueó la primera pintura visual — sólo demoraba el fetch de datos por el gate); no hace falta lazy-load adicional, alcanza con no bloquear el fetch detrás de él.
- **¿Cache existente mal usada / invalidaciones excesivas?** No se encontró ninguna invalidación por lecturas; todas las invalidaciones de `time-entries`/`org-structure` siguen disparándose sólo desde mutaciones reales (aprobar/rechazar/devolver, crear/actualizar hora, etc.), sin cambios en esta etapa.

## 4. Endpoints involucrados

| Endpoint | Rol en `/horas` | Backend ya optimizado (antes de 14G.4) |
|---|---|---|
| `GET /time-entries/period-employees` | Grilla principal (única fuente de datos de la tabla) | Sí — `Promise.all`, select recortado (14C.2), cache 20s |
| `GET /time-entries/summary` | Tarjetas de resumen (KPIs) | Sí — `Promise.all` (14C.2), cache 20s |
| `GET /org-structure` | Catálogo del filtro "Centro de costo" (secundario, no bloqueante para la tabla) | Sí — `Promise.all` (6 queries), cache in-memory 60s |
| `GET /workforce/notifications-unread-count` | Badge del AppShell (ajeno a Carga de horas, se dispara en toda la app) | Fuera de alcance — no tocado |

No se encontró ningún endpoint adicional disparado al entrar a `/horas` que no estuviera ya documentado en 14G.1.

## 5. Causa raíz

**Dependencia artificial de dos efectos de React (grilla y bandeja) contra el catálogo de `org-structure`**, vía un guard (`costCenterOptionsReady`) que no reflejaba ninguna dependencia de datos real: el valor derivado que sí importa (`costCenterId`) es `undefined` de cualquier forma hasta que el usuario elige un centro de costo específico, algo que sólo puede pasar después de que el catálogo ya cargó. El guard convertía una acción que podía resolverse en `max(org-structure, summary, period-employees)` en una que se resolvía en `org-structure + period-employees` (secuencial), sin ninguna razón funcional.

Causa secundaria (encontrada al remover la causa raíz, no preexistente en el journey): `list`/`listByEmployee` (usados exclusivamente por la Bandeja de revisión, mismo componente) no tenían dedupe in-flight — un gap ya conocido en el proyecto para otras pantallas antes de pasar por `cachedData` (ver comentario de 14D.5 en `cachePolicy.ts`), que quedaba enmascarado en Bandeja por el propio gate de la causa raíz.

## 6. Cambios aplicados

### Frontend — `frontend/src/pages/HoursPage.tsx`

1. **Efecto A (grilla, `getPeriodEmployees`)**: se quita `!costCenterOptionsReady` del guard de entrada y de su arreglo de dependencias. Ahora arranca en cuanto hay `user`, sin esperar al catálogo de centros de costo.
2. **Efecto B (bandeja, `list`/`listByEmployee`)**: mismo cambio, mismo criterio — inevitable porque comparte el componente y el mismo patrón de gate que la grilla (ver §10).
3. **Efecto D (catálogo de `org-structure`)**: se quita `setCostCenterOptionsReady(true)` (en `.then` y en `.catch`) y se elimina el estado `costCenterOptionsReady` por completo — quedaba sin ningún otro consumidor tras los cambios 1-2 (confirmado con `grep` en todo `frontend/src`), así que mantenerlo habría sido estado muerto.
4. Comentarios actualizados en los 3 efectos explicando el criterio de 14G.4 (por qué el gate era artificial, por qué sacarlo no cambia qué se pide).

### Frontend — `frontend/src/services/api/timeEntryApiService.ts`

5. **`list()` y `listByEmployee()`**: se envuelven con `cachedData` (mismo mecanismo compartido que ya usan `getSummary`/`getPeriodEmployees`/`getCatalog`), usando la política existente `cachePolicies.timeEntriesAggregates` (familia `"time-entries"`, TTL 30s, no persistida, sensible). Esto agrega dedupe in-flight (vía `pendingRevalidations`) para el doble-montaje de StrictMode, que quedó expuesto en Bandeja al sacar el gate del efecto B (ver §3/§10). Se agregó un validador mínimo `isTimeEntryListResponse` (mismo criterio que `isEmployeePeriodRowsResponse`, ya existente para `listByEmployee`).

No se tocó ningún endpoint backend, ningún schema de Prisma, ninguna migración, ningún otro submódulo (Fichador, Inicio, Asistencia, Alertas de turnos, Cierres mensuales no se tocaron).

## 7. Qué NO se cambió

- Método, rutas, query params de `period-employees`/`summary`/`org-structure`/`list`/`listByEmployee` — sin cambios.
- Shape de las respuestas — sin cambios (los mismos `mapTimeEntryFromApi`/`mapEmployeeFromApi`/`mapCatalog` de siempre, sólo se movió CUÁNDO se llama al fetcher, no qué construye).
- Campos de grilla, filtros, búsqueda, período, paginación — sin cambios.
- Scope/RBAC, visibilidad por nivel, `employeeAccessWhere`, `requireAnyRole` — sin cambios (no se tocó ningún archivo backend).
- Estados de carga horaria, cálculo real/liquidable, conceptos horarios, Horas Especiales — sin cambios (no se tocó ningún archivo de dominio de horas).
- Navegación a `/horas/:id`, acciones de guardar/enviar a revisión, aprobar/rechazar/devolver — sin cambios (ni siquiera se tocó `EmployeeHoursPage.tsx`).
- Diseño visual — cero cambios de JSX/CSS; el único archivo de UI tocado (`HoursPage.tsx`) sólo cambió lógica de efectos (líneas de `useEffect`), nada de markup.
- Backend de `time-entries`/`org-structure` — no se tocó ningún archivo `backend/src/modules/time-entries/*` ni `backend/src/modules/org-structure/*`. Ya estaban optimizados desde etapas previas (14C.2 y anteriores) y no se encontró ningún hallazgo nuevo que justificara tocarlos (ver §3).
- Prisma schema — no se tocó, no se creó ninguna migración.

## 8. Contrato de API

Sin cambios: ningún endpoint backend se tocó en esta etapa — todos los cambios son de orquestación frontend (cuándo se llama a cada servicio, y agregar dedupe de cache al mismo mecanismo ya usado en el resto del módulo). Verificado con `timeEntryApiService.test.ts` (9/9, sin cambios) y con los tests nuevos de `HoursPage.test.tsx` (§9) que fijan que las mismas llamadas, con los mismos parámetros, siguen ocurriendo.

## 9. RBAC/scope

Sin cambios — no se tocó ningún archivo backend, ningún middleware de autorización, ningún `employeeAccessWhere`. Los tests existentes de `HoursPage.test.tsx` que cubren visibilidad por rol (RRHH ve Aprobar/Rechazar/Devolver, Nivel 2/3 ven "Solo lectura") siguen pasando sin modificación (44/44 tests previos intactos, ver §9).

## 10. Impacto en Bandeja de revisión (`/pendientes`)

**Se tocó, de forma inevitable, porque `HoursPage.tsx` es el mismo componente para `/horas` y `/pendientes`** (prop `pendingOnly`), documentado explícitamente acá como pide el pedido:

- El efecto B (bandeja: `list`/`listByEmployee`) tenía el **mismo gate artificial** que el efecto A (grilla) — mismo `costCenterOptionsReady`, mismo razonamiento de causa raíz (§5). Corregirlo en la grilla sin corregirlo en la bandeja habría dejado el mismo bug sin resolver del otro lado del mismo componente.
- **Efecto positivo esperado**: la Bandeja también deja de esperar a `GET /org-structure` para pedir `list`/`listByEmployee`/`getSummary`/`pendingApiService.getAll` — mismo tipo de mejora que en la grilla, aunque no era el objetivo de esta etapa (Bandeja ya estaba en rango Medio, no Crítico).
- **Efecto colateral encontrado y corregido**: al remover el gate, una corrida intermedia mostró que "Entrar a Bandeja de revisión" pasó a disparar `GET /api/time-entries` **x2** (duplicado nuevo, por StrictMode) — porque `list()`/`listByEmployee()` no tenían dedupe in-flight (a diferencia de `getSummary`/`getPeriodEmployees`, que sí lo tienen desde antes vía `cachedData`). Se corrigió envolviendo ambos métodos con el mismo mecanismo (`cachedData` + `cachePolicies.timeEntriesAggregates`, ver §6.5) — confirmado en la corrida final: sin duplicados, `networkIdleMs` de "Entrar a Bandeja de revisión" en 1759ms (vs. 1690ms del baseline de 14G.1 — misma orden de magnitud, dentro del margen de variancia del entorno).
- **Verificado que nada más de Bandeja se rompió**: los 44 tests preexistentes de `HoursPage.test.tsx` (que cubren extensamente Bandeja: aprobar/rechazar/devolver registro/novedad/desglose manual, RBAC por rol, indicador de Horas Especiales en las 3 vistas, no-blanqueo de tabla en paginación, período/centro de costo preservados durante refresh) siguen pasando sin modificación. Se agregaron 3 tests nuevos específicos de 14G.4 (uno de ellos cubre explícitamente Bandeja, ver §9 más abajo).
- Ninguna regla de negocio, RBAC, ni comportamiento de aprobar/rechazar/devolver de Bandeja se tocó.

## 11. Cache/dedupe/loading

- **Frontend**: `getSummary`/`getPeriodEmployees`/`getCatalog` ya usaban `cachedData` (dedupe in-flight + TTL 30s/10min respectivamente) desde antes de esta etapa — sin cambios en su política. Se agrega `list()`/`listByEmployee()` a `cachedData` con la política ya existente `cachePolicies.timeEntriesAggregates` (familia `"time-entries"`, TTL 30s, no persiste, sensible) — **ninguna política de cache nueva**, se reusó la que ya existía (Parte 3.3/3.4 del pedido). La única llamada real a `list()`/`listByEmployee()` en toda la app es la Bandeja de revisión (`HoursPage.tsx`); el fallback interno de `save()` (`getByEmployee` → `getAll` → `list`) nunca se ejecuta en producción porque su único llamador (`EmployeeHoursPage.tsx`) siempre pasa `knownExistingId` (ver comentario de 14C.2 ampliada) — sin riesgo de servir un resultado de creación/edición stale.
- **Invalidación**: sin cambios — toda mutación de horas ya invalidaba la familia `"time-entries"` completa vía `invalidateTimeEntryDependentCaches` (que ahora también limpia la cache nueva de `list`/`listByEmployee`, al ser la misma familia). Confirmado con el test "una mutación (aprobar) sí vuelve a pedir list... — refresh sigue invalidando todo lo relacionado" (preexistente, sigue pasando).
- **Backend**: sin cambios — `period-employees`/`summary` (20s TTL, `timeEntries.cache.ts`) y `org-structure` (60s TTL, cache in-memory en `orgStructure.repository.ts`) ya existían y ya usan `Promise.all` (no `$transaction`) desde 14C.2 y antes. No se encontró ninguna cache faltante que agregar ni ninguna invalidación excesiva o por lecturas.
- **Loading**: sin cambios de comportamiento — `gridLoading`/`reviewLoading` ya tenían la guarda "no blanquear si ya hay datos" desde Etapa 9F (`if (!periodRows.length) setGridLoading(true)`), no tocada en esta etapa. No se detectó blanking de tabla durante refresh en ninguna de las 3 corridas del journey.
- **Filtro inicial**: no dispara doble fetch — `costCenterId` es `undefined` en el primer render (antes y después de esta etapa) y sólo cambia cuando el usuario elige un centro de costo real (test nuevo, ver §9, confirma que cuando el catálogo resuelve después sin que el usuario haya tocado el filtro, `getPeriodEmployees` NO se vuelve a pedir).

## 12. Métricas antes/después

Fuente: `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json`, 1 corrida antes del cambio + 3 corridas después (para confirmar estabilidad frente a la variancia normal del entorno, ya documentada en 14G.1/14G.2/14G.3 — backend local contra la base real de staging, sin aislamiento).

| Métrica | Antes (14G.1/14G.3) | Después (14G.4, 3 corridas) | Mejora |
|---|---|---|---|
| "Entrar a Carga de horas" — `visibleMs` | 73ms | 70-81ms | ~igual (ya era rápido) |
| "Entrar a Carga de horas" — `networkIdleMs` | **3362ms (Crítico)** | **2110-2267ms (Lento)**, promedio ~2214ms | **~34%** |
| `GET /org-structure` | 1653ms | 718-1686ms (variancia del entorno, sin cambios de código en este endpoint) | — |
| `GET /time-entries/period-employees` | 1119ms | 939-1547ms (variancia del entorno) | — |
| `GET /time-entries/summary` | 550ms | 544-728ms (variancia del entorno) | — |
| Duplicados en "Entrar a Carga de horas" | 0 | 0 | Sin cambios (ya estaba libre de duplicados, protegido por `cachedData`) |
| "Entrar a Bandeja de revisión" — `networkIdleMs` | 1690ms (Medio) | 1722-1759ms (Medio) | Sin cambios significativos (dentro de la variancia del entorno) |
| Duplicados en "Entrar a Bandeja de revisión" | 0 | 0 (una corrida intermedia mostró `GET /api/time-entries` x2 tras remover el gate; corregido en el mismo cambio antes de la corrida final, ver §10) | Sin duplicados nuevos en el estado final |
| Ranking — submódulo "D. Carga de horas" | 1653ms máx. individual, acción en Crítico | 1547-1686ms máx. individual, acción en Lento | Sale del rango Crítico |
| HTTP errors / console errors / escrituras ejecutadas | — | 0 / 0 / 0 (las 3 corridas) | — |

## 13. Validaciones ejecutadas

Frontend (no se tocó backend en esta etapa, así que no aplican validaciones backend):

- `npx tsc -p tsconfig.e2e.json --noEmit` → sin errores.
- `npm run test` (vitest) → **75 archivos, 669 tests, todos pasando** (incluye 47/47 de `HoursPage.test.tsx` — 44 preexistentes intactos + 3 nuevos de 14G.4, y 9/9 de `timeEntryApiService.test.ts`).
- `npm run build` (`tsc -b && vite build`) → build exitoso, sin errores de tipos.
- `npm run perf:journey:workforce` → **3 corridas**, todas en verde, 0 HTTP errors, 0 console errors, 0 escrituras ejecutadas.
- `npm run perf:journey:employees` → verde, sin regresión transversal (0 HTTP errors, 0 console errors).
- `git diff --check` → sin errores de espacios en blanco.

Ningún test nuevo depende de tiempos exactos — los 3 tests de 14G.4 controlan manualmente cuándo resuelve la promesa de `getCatalog()` (con una promesa controlada, no `setTimeout`) para simular "el catálogo todavía no cargó" de forma determinística.

## 14. Riesgos pendientes

- La variancia del entorno (backend local contra base real de staging, sin aislamiento — ya documentada en 14G.1/14G.2/14G.3) hace que las duraciones de requests individuales (`org-structure`, `period-employees`, `summary`) varíen bastante entre corridas (ver §12); la mejora medida es sobre el `networkIdleMs` de la acción completa, que es la métrica que "Entrar a Carga de horas" necesitaba bajar de Crítico, y se mantuvo estable en las 3 corridas.
- `list()`/`listByEmployee()` ahora tienen TTL de 30s (antes: sin cache) — durante esa ventana, dos pestañas/usuarios distintos viendo la Bandeja con exactamente los mismos filtros podrían no ver un cambio hecho por un tercero hasta que expire el TTL o hasta la próxima mutación real (mismo criterio ya aceptado para `getSummary`/`getPeriodEmployees` desde 14C.2 — no es un riesgo nuevo, es extender un patrón ya aprobado).
- `GET /org-structure` (718-1686ms) sigue siendo, en algunas corridas, el request individual más lento de la acción — ya no bloquea el camino crítico (corre en paralelo), pero si su latencia empeorara de forma sostenida, seguiría siendo visible en `networkIdleMs`. Está fuera de alcance de 14G.4 tocar su implementación (backend ya optimizado, ver §3) — candidato a revisar sólo si una etapa futura dedicada a org-structure encuentra algo nuevo.
- Consistencia entre-queries no atómica en los 3 endpoints backend (`Promise.all` en vez de `$transaction`) — riesgo ya aceptado desde 14C.2/14G.2/14G.3, no reintroducido ni agravado por esta etapa.
- El módulo `shifts`/Alertas de turnos (`GET /shifts/alerts`) sigue sin revisar desde 14B.3 (medido en 3906ms entonces) y apareció en rango Crítico en una de las 3 corridas de esta etapa (3044ms) — no es un hallazgo de 14G.4 (no se tocó ese módulo), pero refuerza la recomendación de §15.

## 15. Recomendación para 14G.5

Con Inicio, Asistencia y Carga de horas resueltos (los 3 candidatos que estaban en rango Crítico por acción compuesta o por endpoint), los candidatos que quedan en rango Lento con evidencia ya recolectada en 14G.1 y confirmada en las 3 corridas de esta etapa son:

1. **C. Alertas de turnos** (`GET /shifts/alerts`) — sin cache backend, medido repetidamente en rango Lento/Crítico desde 14B.3 (3906ms) hasta esta etapa (3044ms en una corrida), nunca revisado. Mismo perfil de antipatrón a confirmar (posible `$transaction` o queries no paralelizadas) que ya se corrigió en `time-entries` (14C.2) y `home-summary`/`attendance-observations` (14G.2/14G.3).
2. **H. Notificaciones** (`GET /workforce/notifications`) — sin cache backend, consistentemente en rango Lento (2237-2799ms según la corrida) desde 14G.1.
3. **F. Bandeja de revisión, vista "Por persona"** (`findManyByEmployeeGrouped`) — señalado en 14G.1 §15 como pendiente de revisar (mismo antipatrón `$transaction` ya corregido en otros endpoints por 14C.2, documentado 2 veces, nunca corregido). Como esta etapa ya tocó `HoursPage.tsx`/Bandeja de forma inevitable (§10), podría ser una continuación natural, aunque sigue siendo un endpoint distinto (`view=byEmployee`) no tocado en 14G.4.
