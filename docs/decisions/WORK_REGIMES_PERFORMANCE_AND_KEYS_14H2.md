# Etapa 14H.2 — Optimización y saneamiento de Regímenes laborales

Fecha: 2026-09-08
Estado: implementado, validado, medido antes/después, **pendiente de aprobación para commitear**
Continúa: `docs/decisions/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md` (diagnóstico macro que detectó ambos hallazgos), `docs/decisions/WORK_REGIME_ASSIGNMENT_CONSISTENCY_13J.md` (diseño del modal "Empleados asociados", incluida la decisión intencional de remount al cambiar de filtro de vigencia, que esta etapa respeta).
Alcance: exclusivamente Regímenes laborales — frontend (`WorkRegimesPage.tsx`, `AssociatedEmployeesPanel.tsx` compartido, `workRegimeApiService.ts`, `cachePolicy.ts`) y backend (`workRegimes.repository.ts`). No se tocó Gestión horaria, Fichador, Puestos, ni ningún otro submódulo de Configuración.

---

## 1. Contexto

14H.1 (diagnóstico macro de Configuración + Puestos) midió `npm run perf:journey:admin-config` y encontró, dentro de Regímenes laborales:
- 4 warnings de consola de React ("two children with the same key") al filtrar vigencia a "Todos" en el modal "Empleados asociados".
- La acción más lenta de todo Configuración/Puestos: "Filtrar vigencia de empleados asociados", **2878ms** (rango Lento), con **4 requests duplicadas** a `GET /work-regimes/:id/employees` dentro de la misma ventana de medición (1736ms/1607ms/2811ms/2613ms).

Esta etapa corrige ambos hallazgos con evidencia de código, sin cambiar contrato, RBAC, diseño ni reglas de negocio.

---

## 2. Diagnóstico (Parte 1 del pedido, con evidencia — antes de tocar código)

### 2.1 Qué endpoints se disparan al entrar a Regímenes laborales

`WorkRegimesPage.tsx` monta y llama `workRegimeApiService.getAll()` → `GET /work-regimes?page=1&take=200` — un único endpoint, cacheado frontend (familia `work-regimes`, `workRegimesCatalog`, 10min, persistido). Confirmado en el código, sin llamadas adicionales al catálogo.

### 2.2 Qué endpoints se disparan al abrir "Empleados asociados"

Click en "Ver empleados asociados" (icon `Users`) abre el `Modal` compartido con `AssociatedEmployeesPanel`, que monta y llama `workRegimeApiService.getWorkRegimeEmployees(regimeId, {...filtros, status: employeesVigencyFilter})` → `GET /work-regimes/:id/employees?status=current&page=1&take=20` (default `status=current`, ver 13J). Sin cache frontend ni backend antes de esta etapa (`apiRequest(..., {apiCache:false})` directo).

### 2.3 Qué endpoints se disparan al filtrar vigencia a "Todos"

`WorkRegimesPage.tsx:379` pasa `key={\`${viewingEmployeesFor.id}-${employeesVigencyFilter}\`}` a `<AssociatedEmployeesPanel>` — cambiar `employeesVigencyFilter` cambia esa `key`, lo que hace que **React desmonte el panel anterior y monte una instancia completamente nueva** (decisión intencional de 13J: "fuerza un remount del panel para no arrastrar página/búsqueda de un filtro al otro" — no se cambia esta etapa, ver §7). El nuevo montaje dispara `getWorkRegimeEmployees(regimeId, {status: "all", ...})` de nuevo — mismo endpoint, query distinta.

### 2.4 Cuál endpoint explica los 2878ms medidos

`GET /work-regimes/:id/employees` — confirmado en el JSON del reporte 14H.1: 4 llamadas a ese endpoint dentro de la ventana de la acción, con duraciones individuales de 1607-2811ms cada una. El `networkIdleMs` de la acción (2878ms) es prácticamente el máximo de esas 4 llamadas solapadas, no una suma — consistente con requests **concurrentes** compitiendo por el pool de conexiones de Neon, no secuenciales.

### 2.5 ¿Hay duplicados por StrictMode/remount?

Sí, confirmado en dos niveles:
- `main.tsx` confirma `<React.StrictMode>` activo en toda la app (incluido el entorno del journey, que corre contra el dev server real).
- El propio patrón de remount de 13J (§2.3) crea una instancia NUEVA del panel en cada cambio de filtro — cada montaje, en StrictMode, invoca el efecto de fetch dos veces (mount → cleanup simulado → mount real). De las 4 requests observadas, la evidencia es consistente con: 2 de una llamada tardía que quedó pendiente de la acción anterior ("Ver empleados asociados", `status=current`, que la propia medición 14H.1 mostró con `networkIdleMs` bajo — 128ms — porque esas 2 requests no habían terminado todavía cuando esa acción cerró su ventana) + 2 de esta acción (`status=all`). Mismo artefacto de medición ya documentado en 14G ("una request lenta de la acción anterior cae en la ventana de la siguiente").

### 2.6 ¿Hay `$transaction` innecesario?

**Sí, en los 2 únicos puntos de lectura paginada del módulo** (`workRegimes.repository.ts`):
- `findMany` (catálogo de regímenes): `prisma.$transaction([workRegime.findMany(...), workRegime.count(...)])`.
- `findEmployees` (empleados asociados — el endpoint de §2.4): `prisma.$transaction([employeeWorkRegime.findMany(...), employeeWorkRegime.count(...)])`.

Ambas son lecturas **independientes** (`count` no depende del resultado de `findMany`) — el mismo antipatrón ya diagnosticado y corregido 6+ veces en la serie 14G (`$transaction` array-form pina ambas queries a una única conexión de Neon en serie; con 2-4 requests concurrentes al mismo endpoint, esa serialización interna se multiplica por la contención del pool). Sin `$transaction`, `Promise.all` sobre el cliente global sí logra concurrencia real.

### 2.7 ¿Hay includes pesados / se trae más de lo necesario?

**No** — ya estaba optimizado desde la Etapa 8G. `findEmployees` usa `select` explícito (`associatedEmployeeSelect`, `backend/src/shared/prisma/employeeAssociationQuery.ts`), no `include`: sólo `{id, legajo, cuil, firstName, lastName, status, sector:{id,name}, costCenter:{id,name}, companies:{company:{id,name}}}` — el comentario en el propio archivo documenta explícitamente que se decidió NO reusar el select completo de `employees.repository.ts` por ser más pesado de lo necesario para esta vista. Cadena de relaciones de 1-2 niveles (dentro del límite de 2-3 de `PERFORMANCE_STANDARDS.md` §4), no la cadena de 4-5 niveles que sí fue un problema real en Puestos (14D.4). **No se tocó este select.**

### 2.8 ¿El filtro de vigencia se aplica en DB o en frontend?

**En DB**, ya desde 8G/13J — `vigencyWhere(status, referenceDate)` arma un `where` real de Prisma (`effectiveFrom`/`effectiveTo`) según el valor de `status`; `"all"` no agrega condición (unión de las 3 vigencias). Confirmado leyendo `workRegimes.repository.ts` — no hay fetch-all + filtro en memoria. **No se tocó.**

### 2.9 ¿Se pagina o se trae todo?

Se pagina — `take` (default 50, máx 200 vía `listWorkRegimeEmployeesQuerySchema`) + `skip`, con `count` real para `meta.total/hasMore`. **No se tocó.**

### 2.10 ¿Hay cache backend/frontend?

- Backend: **no había ninguna** sobre `GET /work-regimes` ni `GET /work-regimes/:id/employees` (el módulo `work-regimes` no tiene ningún `*.cache.ts`, a diferencia de `workforce-management`). **No se agregó cache backend esta etapa** — el fix aplicado (quitar `$transaction`) ataca la causa real sin necesitar una capa de cache nueva en el servidor; agregar TTL cache backend sobre un endpoint RBAC-scoped (`employeeAccessWhere`) sería más riesgo (cache key tendría que incluir el scope del usuario) para un beneficio ya cubierto por el fix de paralelización + el dedupe frontend.
- Frontend: `getAll()` (catálogo) ya cacheaba (`workRegimesCatalog`); `getWorkRegimeEmployees()` **no** — confirmado en el propio comentario del código anterior ("sin cachedData, mismo criterio que getAssignmentHistory/getCurrentAssignment"). **Se agregó** — ver §6.

### 2.11 ¿Hay blanking o loading incorrecto?

Sí, pero es **intencional y documentado desde 13J** (§2.3): el remount vía `key` reinicia `AssociatedEmployeesPanel` a `status: "loading"` en cada cambio de filtro, mostrando el skeleton completo (`LoadingState variant="table"`) en vez de mantener los datos anteriores visibles. Evaluado y **no corregido** esta etapa — ver §7 (riesgo/decisión explícita).

### 2.12 Por qué se produce el duplicate key

`AssociatedEmployeesPanel.tsx` (componente compartido con `HourConceptsPage`) usaba `key={item.employeeId}` en la fila de la tabla (línea ~414) y en la card de mobile (línea ~462). Con `status=all`, un mismo empleado puede tener más de una fila de `EmployeeWorkRegime` para el mismo régimen (una histórica + una vigente, cada una con su propio `id` de asignación pero el mismo `employeeId`) — exactamente el escenario de datos reales que `WORK_REGIME_ASSIGNMENT_CONSISTENCY_13J.md` ya documentó (09/10 Granja). Con `key={item.employeeId}` repetido, React emite el warning y no garantiza qué fila se renderiza/actualiza.

### 2.13 Cuál es la key segura para filas históricas + vigentes del mismo empleado

`item.id` — el id propio de la fila `EmployeeWorkRegime` (`WorkRegimeEmployeeAssociation.id`, ya presente en el tipo y ya usado por el propio `WorkRegimesPage.tsx` para `closeAssignment(item.employeeId, item.id, ...)`), único sin importar el filtro de vigencia. **No existe este campo en el tipo genérico `T` del panel** (`HourConceptEmployeeAssociation`, el otro consumidor, no tiene `id` — no tiene vigencia, un empleado nunca aparece dos veces ahí) — por eso el fix es un prop `rowKey` opcional, no un campo obligatorio en `T` (ver §5).

---

## 3. Reglas funcionales que NO cambiaron (Parte 2 del pedido)

Confirmado sin cambios: rutas (`/work-regimes`, `/work-regimes/:id/employees`, `/employees/:employeeId/work-regimes[/:assignmentId][/close]`), métodos HTTP, query params (`status`/`search`/`sectorId`/`costCenterId`/`companyId`/`page`/`take`/`date`), shape de respuesta (`{data, meta}` con los mismos campos por fila), nombres de campos, filtros de vigencia (`current`/`historical`/`future`/`all`, mismo `where` de Prisma), qué empleados se muestran (mismo `vigencyWhere` + `accessWhere`), historial (nunca se borra, `updateAssignment` sigue siendo un `UPDATE`, nunca `DELETE`), reglas de asignación (solapamiento, `effectiveTo >= effectiveFrom`), RBAC/scope (`requireAnyRole([rrhh, supervision, cargaHoraria])` en el GET, `adminRoles` en los POST/PATCH — sin tocar `workRegimes.routes.ts`), permisos, diseño visual (ningún cambio de CSS/markup visible), modales (mismo componente `Modal`, mismos textos), y las acciones de crear/editar/eliminar/asignar (ninguna se ejecutó — todas quedaron como `skip()` en el journey, igual que en 14H.1). Sin migraciones. Sin escrituras reales ejecutadas en ningún momento de esta etapa.

---

## 4. Causa raíz — resumen

- **Duplicate key**: `AssociatedEmployeesPanel.tsx` usaba `item.employeeId` como key de fila, que deja de ser único cuando el filtro de vigencia es "Todos" y un empleado tiene más de una asignación (histórica + vigente) al mismo régimen.
- **Lentitud (2878ms)**: combinación de (a) 4 requests concurrentes al mismo endpoint dentro de una sola acción del usuario (StrictMode + el remount intencional de 13J, sin dedupe frontend) y (b) cada una de esas requests pagaba de más porque `findEmployees`/`findMany` usaban `$transaction([...])`, serializando `findMany`+`count` en una sola conexión — con 2-4 requests concurrentes compitiendo por conexiones, esa serialización se agrava. Ninguna de las dos causas es "la query es lenta por sí sola" (el `select` ya era liviano, el filtro ya era server-side, ya paginaba) — es un problema de concurrencia/duplicación, no de shape de datos.

---

## 5. Cambios aplicados

### 5.1 `frontend/src/components/shared/AssociatedEmployeesPanel.tsx`

Nuevo prop opcional `rowKey?: (item: T) => string`, default `(item) => item.employeeId` (preserva exactamente el comportamiento anterior para cualquier caller que no lo pase — `HourConceptsPage.tsx` no lo pasa, cero cambio de comportamiento ahí). Aplicado a las 2 keys reales de fila (`<tr>` de la tabla y `<div className="associated-employees-card">` de mobile) — las demás `key={...}` del archivo (opciones de `<select>`, headers de columna) no correspondían a filas de datos y no se tocaron.

### 5.2 `frontend/src/pages/WorkRegimesPage.tsx`

`<AssociatedEmployeesPanel rowKey={(item) => item.id} ... />` — usa el id de la propia asignación (`EmployeeWorkRegime.id`), único siempre.

### 5.3 `backend/src/modules/work-regimes/workRegimes.repository.ts`

`findMany` y `findEmployees`: `prisma.$transaction([findMany, count])` → `Promise.all([prisma.workRegime.findMany(...), prisma.workRegime.count(...)])` (mismo patrón en `findEmployees` con `employeeWorkRegime`). `where`/`select`/`orderBy`/`skip`/`take` sin cambios — cero impacto de contrato.

### 5.4 `frontend/src/services/api/workRegimeApiService.ts`

`getWorkRegimeEmployees()` ahora pasa por `cachedData()` (antes: `apiRequest` directo, `apiCache:false`). `assign()`/`updateAssignment()`/`closeAssignment()` ahora invalidan la familia `"work-regimes"` (antes: ninguna invalidación en estos 3 métodos).

### 5.5 `frontend/src/services/cache/cachePolicy.ts`

Nueva policy `workRegimeEmployeesList`: familia `"work-regimes"` (reusada — mismo criterio que `positions`/`positionsList` en 14D.4), TTL 15s, `persist: false`, `sensitive: true`.

**No se tocó**: `workRegimes.controller.ts`, `workRegimes.routes.ts`, `workRegimes.schemas.ts`, `workRegimes.service.ts`, `employeeAssociationQuery.ts` (el `select`), `HourConceptsPage.tsx`, ni el patrón de remount por `key` de 13J (ver §7).

---

## 6. Cache/dedupe — detalle (Parte 4.3 del pedido)

- **TTL**: 15s — mismo rango que `shiftAlertsList`/`monthlyClosuresList`/`timeCorrectionsList` (listas operativas RBAC-scoped con escrituras frecuentes, `PERFORMANCE_STANDARDS.md` §5).
- **Key**: `` `GET:/work-regimes/${workRegimeId}/employees${query}` ``, donde `query` (armado por `associatedEmployeesQuery`, sin cambios) ya incluye `page`/`take`/`search`/`sectorId`/`costCenterId`/`companyId`/`status` (vigencia) — dos combinaciones distintas de régimen/filtro/página nunca comparten cache key (verificado con tests, §8).
- **Usuario/scope**: no se embebe el id de usuario en la key — mismo criterio que **todas** las demás policies `sensitive: true` de este proyecto (`employeesList`, `timeEntriesAggregates`, `pendingQueue`, `notificationsList`, `shiftAlertsList`, `monthlyClosuresList`, ninguna embebe el usuario). El cache vive en el navegador de una única sesión; `AuthContext.tsx` ya llama `clearAllAppCaches()` en `login failure`, `logout` **y `account switch`** (el mecanismo de "acceso rápido demo" que permite cambiar de rol en el mismo navegador) — no hay ventana real de fuga entre usuarios/roles distintos.
- **Filtros incluidos**: ver "Key" arriba — status de vigencia y todos los filtros de empleado forman parte de la key.
- **Invalidaciones**: `assign`/`updateAssignment`/`closeAssignment` (los 3 únicos mutadores de `EmployeeWorkRegime` en todo el backend — confirmado con `grep -rn "employeeWorkRegime\.\(create\|update\|delete\)" backend/src`, sin resultados fuera de `workRegimes.repository.ts`) invalidan la familia `"work-regimes"` completa (mismo criterio que `positions`: una familia por dominio, no una invalidación quirúrgica por fila).
- **Riesgos**: hasta 15s de staleness si dos pestañas/sesiones del mismo usuario asignan/finalizan una vigencia — mismo perfil de riesgo ya aceptado para el resto de las listas operativas de este proyecto, acotado por el TTL corto (nunca "para siempre desactualizado").
- **No se cachean escrituras** — `assign`/`updateAssignment`/`closeAssignment` siguen llamando `apiRequest` directo, sin `cachedData`.

---

## 7. Qué NO se cambió (decisiones explícitas, con motivo)

- **El patrón de remount por `key`** (`WorkRegimesPage.tsx:379`, `key={\`${id}-${filtro}\`}`): es una decisión intencional de 13J para resetear página/búsqueda al cambiar de filtro de vigencia. Cambiarlo (p. ej. a `refreshKey` sin remount) evitaría el blanking de la tabla, pero también cambiaría ese comportamiento ya documentado y aprobado — fuera del alcance de "no cambiar reglas de negocio". Además, el `networkIdleMs` medido refleja mayormente el tiempo real de red, no el tiempo de render del skeleton — el fix de dedupe+paralelización (§5) ataca la causa que realmente explica los 2878ms.
- **Cache backend** sobre `GET /work-regimes/:id/employees`: evaluado y descartado — el fix de `$transaction`→`Promise.all` ya resuelve la causa raíz sin necesitar una capa nueva con el riesgo adicional de cachear una respuesta RBAC-scoped en el servidor (`employeeAccessWhere` varía por rol).
- **`findMany`/`findEmployees` select/where/orderBy**: sin cambios — ya estaban correctamente acotados (§2.7-2.9).
- **`HourConceptsPage.tsx`**: `rowKey` es opcional con default idéntico al comportamiento previo — cero cambio de comportamiento ahí, confirmado por su suite de tests sin modificar.
- **Índice de `EmployeeWorkRegime.workRegimeId`**: deuda ya documentada desde 8G (comentario en `schema.prisma`) — no se agregó ninguna migración esta etapa (no autorizado explícitamente, y el fix de paralelización ya logró una mejora real medible sin necesitarlo).

---

## 8. Tests

### Backend (`workRegimes.repository.test.ts`)

2 tests existentes actualizados (`findMany`/`findEmployees` — ahora confirman `expect(mockedPrisma.$transaction).not.toHaveBeenCalled()` en vez de `toHaveBeenCalledTimes(1)`); el resto de los 66 tests del módulo (incluidos los que verifican `where`/`orderBy`/`skip`/`take` exactos) sin cambios — siguen pasando porque `findMany`/`count` se siguen llamando con los mismos argumentos, sólo cambió el mecanismo de espera (`$transaction` → `Promise.all`).

### Frontend

- `AssociatedEmployeesPanel.test.tsx`: 2 tests nuevos — (1) confirma que, SIN `rowKey`, dos filas con el mismo `employeeId` siguen generando el warning de React (documenta el comportamiento previo, no se rompe el default); (2) confirma que CON `rowKey` único por fila, dos filas con el mismo `employeeId` se renderizan ambas sin warning.
- `WorkRegimesPage.associatedEmployees.test.tsx`: 1 test nuevo — reproduce el escenario real (`status=all`, mismo empleado con una fila histórica y una vigente) contra la página completa (no un componente aislado), confirma ambas filas visibles y cero warning de key duplicada.
- `workRegimeApiService.test.ts`: mock de `apiClient`/`../cache` agregado (mismo patrón que `attendanceApiService.test.ts`/`timeEntryApiService.test.ts`, 14G.9 — verificado que no afecta ningún test preexistente de mapeo puro). Nuevos: dedupe in-flight (`Promise.all` de 2 llamadas idénticas → 1 request real), cache dentro del TTL, cache-miss al cambiar régimen/filtro/página (la key incluye las 3 cosas), contrato de respuesta sin cambios, invalidación de `"work-regimes"` en `assign`/`updateAssignment`/`closeAssignment` (`it.each`), y que tras invalidar vuelve a pedirse.
- No se crearon tests dependientes de tiempos exactos (ninguno usa `Date.now()` real ni umbrales de milisegundos — todos usan `vi.useFakeTimers()`/conteo de llamadas).

Suite completa: backend 1234/1234 verdes (78 archivos); frontend 749/749 verdes (77 archivos, +13 tests nuevos).

---

## 9. Métricas antes/después (medidas reales, `npm run perf:journey:admin-config`)

| Métrica | Antes (14H.1) | Después (14H.2) | Mejora |
|---|---|---|---|
| Entrar a Regímenes laborales (acción) | 1690ms | 1148ms | **-32,1%** |
| `GET /work-regimes` (request) | 1098ms | 537ms | **-51,1%** |
| Filtrar vigencia de empleados asociados (acción) | 2878ms | 1376ms | **-52,2%** — pasa de rango Lento a Medio |
| `GET /work-regimes/:id/employees` — cantidad de requests en la ventana | 4 (1607-2811ms c/u) | 2 (911ms/935ms) | **-50% de requests, -~55 a -67% de duración individual** |
| Console warnings (duplicate key) | 4 | **0** | **-100%** |
| HTTP errors (todo el recorrido) | 0 | 0 | Sin cambios (ya estaba en 0) |
| Console errors (todo el recorrido) | 4 | **0** | **-100%** |
| Escrituras ejecutadas | 0 | 0 | Sin cambios (modo read-only) |
| Acciones cubiertas/salteadas | 41/63, 22 salteadas | 41/63, 22 salteadas | Sin cambios (misma cobertura) |

**Riesgo pendiente sobre el "2" residual** (no se investiga más a fondo esta etapa, evidencia insuficiente para intervenir con confianza): las 2 requests restantes en "Filtrar vigencia" podrían ser (a) un par de StrictMode que `cachedData()` no llegó a colapsar por una ventana de carrera entre los 2 `await` internos (`buildCacheKey`/`readCached`) antes de registrar la promesa en `pendingRevalidations`, o (b) dos filtros de vigencia distintos cuyo path sanitizado (sin query string) los reporta como "iguales" en la sección de duplicados del reporte sin serlo realmente. Documentado como candidato de investigación de 14H.3, no como un bug confirmado.

---

## 10. Validaciones ejecutadas

- Backend: `npx prisma validate` ✅, `npm run typecheck` ✅, `npm test` ✅ 1234/1234 (78 archivos), `npm run build` ✅.
- Frontend: `npx tsc -b --noEmit` ✅, `npx tsc -p tsconfig.e2e.json --noEmit` ✅, `npm test` ✅ 749/749 (77 archivos), `npm run build` ✅.
- `npm run perf:journey:admin-config` ✅ **passed** (antes, en 14H.1, fallaba por los 4 console errors reales — ahora 0/0 HTTP/console errors, 0 escrituras).
- `npm run perf:journey:workforce` (14G.1, regresión transversal) ✅ passed, 1.1min.
- `npm run perf:journey:employees` (14D.1, regresión transversal) ✅ passed, 40.5s.
- `git diff --check` ✅ sin errores de espacios en blanco.

---

## 11. Riesgos pendientes

- El "2" residual de §9 (investigar en 14H.3 si se decide).
- TTL de 15s en `workRegimeEmployeesList`: staleness acotada, mismo perfil que el resto de las listas operativas — no es un dato crítico (categoría D).
- El blanking intencional del remount por filtro (§7) sigue presente — mitigado en la práctica por el nuevo cache (revisitar el mismo filtro dentro de 15s ya no dispara ni el blanking ni un request real).
- Turnos y Horas especiales (otras tarjetas de Configuración) siguen sin cache frontend y con duplicados reales por StrictMode (`GET /shifts/assignments/summary` x2, `GET /workforce/shift-templates` x2, `GET /workforce/double-hour-rules` x2/`calendar` x2, confirmado en esta misma corrida) — **fuera de alcance de esta etapa** (sólo Regímenes laborales), candidato explícito para una etapa 14H.3/14H.4 dedicada a esas 2 tarjetas.

---

## 12. Recomendación para 14H.3

Por evidencia de esta misma corrida (`docs/performance/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md`, §7/§9/§10 actualizados):
1. **Turnos** — 2 endpoints duplicados por request (`shift-templates` x2, `assignments/summary` x2) y ningún cache frontend/backend.
2. **Horas especiales** — mismo patrón (`double-hour-rules` x2, `.../calendar` x2), y el mayor conteo de GETs en el montaje (4) de toda Configuración.
3. **Asignaciones de feriados** — sigue siendo la acción más lenta del recorrido después de Login (2267ms al entrar, 1735ms al seleccionar fecha), con hasta 5 GETs encadenados.
4. El "2" residual de Regímenes laborales (§9), si se decide investigar el mecanismo exacto de `cachedData()` bajo StrictMode.

---

No se cambió contrato de API. No se cambió RBAC/scope. No se cambió diseño visual. No se tocaron otros submódulos de Configuración, Puestos, Gestión horaria ni Fichador. No se creó ninguna migración. No se ejecutó ninguna escritura real. No commitear sin aprobación explícita del usuario. No hacer push.
