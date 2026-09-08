# Etapa 14H.5 — Diagnóstico y optimización de Conceptos horarios

Fecha: 2026-09-08
Estado: implementado, validado, medido antes/después, **pendiente de aprobación para commitear**
Continúa: `docs/decisions/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md`, `docs/decisions/WORK_REGIMES_PERFORMANCE_AND_KEYS_14H2.md`, `docs/decisions/SHIFTS_AND_SPECIAL_HOURS_PERFORMANCE_14H3.md`, `docs/decisions/HOLIDAY_ASSIGNMENTS_PERFORMANCE_14H4.md` (mismo patrón de dedupe/cache/`$transaction`→`Promise.all` aplicado a un módulo distinto).
Alcance: exclusivamente Conceptos horarios — frontend (`hourConceptApiService.ts`, `hourConceptRuleApiService.ts`, `cachePolicy.ts`) y backend (`hourConcepts.repository.ts`). **No se tocó `HourConceptsPage.tsx`, `HourConceptRulesPanel.tsx`, `AssociatedEmployeesPanel.tsx`, `hourConceptClassification.ts`, `hourConcepts.service.ts`/`.controller.ts`, `hourConceptRules.repository.ts`/`.service.ts`/`.controller.ts` ni ningún otro archivo de UI, negocio o de otro módulo.** Se extendió además el journey de diagnóstico (`adminConfigurationPerformanceJourney.spec.ts` + su módulo de soporte) para poder medir por primera vez el detalle de este submódulo — ver §0.

---

## 0. Por qué esta etapa abre el editor inline (excepción a la política de 14H.1-14H.4)

Las etapas 14H.1-14H.4 establecieron deliberadamente que el journey macro **nunca** abre editores inline (`<Section>`, a diferencia del componente `Modal` compartido) para mantener una única política simple de riesgo. Conceptos horarios quedó así, con su listado medido pero su detalle (reglas + empleados asociados) **nunca ejercitado por ningún journey**. El pedido de esta etapa pide explícitamente diagnosticar "carga inicial, detalle, empleados asociados y filtros" — por eso 14H.5 amplía el alcance **sólo para este submódulo**: se agregó una acción que hace click en "Editar" sobre un concepto existente (100% local, sin request propio, confirmado leyendo `HourConceptsPage.tsx`) para poder medir los dos paneles hijos que monta, sin tocar nunca "Guardar"/"Guardar regla"/"Guardar cambios". El resto de los editores inline de Configuración (Horas especiales, Empresas y estructura, Categorías documentales, Parámetros de auditoría) siguen sin abrirse — la política no cambió para ellos.

---

## 1. Contexto y evidencia desde 14H.1-14H.4

14H.1 midió únicamente "Entrar a Conceptos horarios" (`GET /hour-concepts`) y lo marcó explícitamente como "el submódulo con más profundidad potencial de todo Configuración (reglas + empleados anidados) — candidato fuerte para una etapa dedicada". Ningún journey había medido `GET /hour-concepts/:id/rules` ni `GET /hour-concepts/:id/employees` hasta esta etapa — no hay una línea de base "antes" real para esos 2 endpoints (ver §12).

---

## 2. Diagnóstico Conceptos horarios (con evidencia)

### 2.1 Carga inicial

- **Endpoint**: `hourConceptApiService.getAll()` → `GET /hour-concepts` — único endpoint al entrar, ya cacheado desde antes de esta serie (familia `hour-concepts`, policy `hourConceptsCatalog`, 10min, persistido).
- **Principal vs. auxiliar**: es el único endpoint de la carga inicial — no hay auxiliares que paralelizar ni dependencias artificiales.
- **¿Bloquea primera pintura sin necesidad?**: no — es el único dato que la pantalla necesita para pintar la tabla.

### 2.2 Detalle / empleados asociados

- **¿Qué dispara "Editar"?**: `onClick={() => setEditing(item)}` — **100% estado local, cero request** (confirmado leyendo `HourConceptsPage.tsx`). Al quedar `isExistingConcept === true`, React monta dos componentes hijos nuevos:
  - `HourConceptRulesPanel` → `hourConceptRuleApiService.listByConcept(hourConceptId)` → `GET /hour-concepts/:id/rules` — **sólo si `loadMode !== "MANUAL"`** (si es `MANUAL`, el panel muestra un aviso informativo sin pedir nada).
  - `AssociatedEmployeesPanel variant="embedded"` → `hourConceptApiService.getHourConceptEmployees(id, filters)` → `GET /hour-concepts/:id/employees` — siempre, sin importar `loadMode`.
- **¿Usa `AssociatedEmployeesPanel`?**: sí, igual que Regímenes laborales (14H.2).
- **¿Necesita `rowKey` propio (protección de 14H.2)?**: **no** — confirmado con evidencia de tipo: `HourConceptEmployeeAssociation` (`{employeeId, employee}`) no tiene campo `id` ni vigencia/historial — a diferencia de `WorkRegimeEmployeeAssociation`, un empleado nunca puede aparecer dos veces en la lista de "empleados habilitados" de un concepto (`EmployeeHourConcept` es un simple on/off, sin filas históricas). El `rowKey` por defecto (`item.employeeId`) ya es único siempre — sin cambios en `AssociatedEmployeesPanel.tsx` ni en `HourConceptsPage.tsx` (que sigue usando `key={editing.id}` para forzar remount al cambiar de concepto, sin pasar `rowKey`).
- **Duplicados StrictMode**: ambos paneles son un **montaje fresco cada vez** que `editing` pasa a un concepto existente — mismo mecanismo StrictMode ya diagnosticado repetidas veces en esta serie. Confirmado con test unitario (dedupe in-flight, ver §12) — no se pudo confirmar con el journey en vivo (ver nota metodológica §12) porque ambos requests, reales pero relativamente lentos (~870-880ms), completaron después de que la ventana de medición de "Abrir detalle" ya había cerrado y quedaron atribuidos a la acción siguiente — artefacto de medición ya documentado en 14H.3/14H.4 (`GET /positions`, `GET /org-structure`), no un bug de esta etapa.
- **Cache backend**: ninguno de los 2 endpoints tenía cache backend antes de esta etapa (módulo `hour-concepts` no tiene ningún `*.cache.ts`) — **no se agregó** (ver §7).
- **Filtro de vigencia**: no aplica — `EmployeeHourConcept` no tiene vigencia/historial (a diferencia de `EmployeeWorkRegime`).
- **Paginación**: `getHourConceptEmployees` pagina correctamente (`page`/`take`, backend con `skip`/`take` reales) — sin cambios.

### 2.3 Backend

- **`$transaction` innecesario**: **encontrado y corregido en 2 lugares**:
  - `hourConceptsRepository.findMany` — rama con filtros activos (`hasActiveFilters`): `$transaction([hourConcept.findMany, hourConcept.count])`. Esta rama **no** la ejercita `HourConceptsPage.tsx` (filtra en memoria sobre un fetch-all sin mandar `kind`/`status`/`search` al backend), pero **sí un caller real**: `timeEntryApiService.ts:313` llama `hourConceptApiService.getAll({status:"ACTIVO"})` — confirmado con grep, no es código muerto.
  - `hourConceptsRepository.findEmployees` — el endpoint activamente usado por `AssociatedEmployeesPanel` embedded (`$transaction([employeeHourConcept.findMany, employeeHourConcept.count])`). Fix directamente análogo al ya aplicado a `workRegimesRepository.findEmployees` (14H.2).
  - **No corregido, documentado como hallazgo**: `hourConceptRulesRepository.findMany` (el listado GENERAL paginado de reglas, `GET /hour-concept-rules`, distinto de `getByConcept`/`GET /hour-concepts/:id/rules` que sí usa el panel) también usa `$transaction([...])` — pero **no tiene ningún caller en todo el frontend** (confirmado con grep exhaustivo sobre `hourConceptRuleApiService.list`/`.getById`). No se corrigió: sin ningún flujo real que lo ejercite, no hay forma de medir/validar el efecto del fix, y tocar código genuinamente inalcanzado desde la UI sería optimizar sin evidencia. Ver §14.
- **Includes/over-fetch**: `findEmployees` usa `select` (no `include`) con `associatedEmployeeSelect` — mismo select compartido y ya liviano confirmado en 14H.2/14H.4, sin cambios. `hourConceptRulesRepository.findByConceptId` (el que sí usa el panel, vía `getByConcept`) usa `include` acotado a `{hourConcept: {select: {id,code,name}}}` — 1 nivel, sin over-fetch.
- **Filtros en DB o frontend**: en DB para `findEmployees`/`findByConceptId`; en memoria (fetch-all) para el listado principal de conceptos — ya era correcto, sin cambios.
- **Cache backend existente**: `hourConceptsController.list` (`GET /hour-concepts`) **sí** tenía una cache propia (`hourConceptsReadCache`, TTL 60s, keyed por `req.originalUrl`, sin scope de usuario porque el catálogo no varía por usuario/rol — confirmado, `hourConceptsService.list` no recibe `user`) — sin cambios. Además existe un segundo cache, más antiguo, a nivel repositorio (`listCache`, 2min, sólo para la rama sin filtros) — dos capas superpuestas para el mismo dato, deuda de consistencia arquitectónica ya documentada explícitamente en `PERFORMANCE_STANDARDS.md` §15 ("4 patrones de cache backend distintos conviviendo") — **no se tocó**, consolidarlas sería un refactor no pedido sin un bug detrás que lo justifique.
- **Invalidaciones backend existentes**: `create`/`update`/`remove` limpian `hourConceptsReadCache`; `enableEmployees`/`disableEmployee` limpian `clearEmployeeReadCaches()` (cache de Legajos, correcto — `EmployeeHourConcept` es la misma fuente que lee `/employees/:id`) pero **no** tocan ninguna cache de `findEmployees`/`findByConceptId` porque, antes de esta etapa, ninguna existía a nivel backend para esos dos — no aplica agregar invalidación ahí porque no se agregó cache backend (ver §7).

### 2.4 Frontend

- **Blanking**: no aplica — ambos paneles hijos (reglas/empleados) son montajes frescos por diseño (al cambiar de concepto), no hay un "refetch" sobre datos ya visibles que pudiera blanquear nada distinto de lo ya esperado en un montaje nuevo.
- **Filtros que re-piden datos auxiliares innecesariamente**: no encontrado — cambiar el filtro Tipo/Estado del listado principal filtra en memoria, sin re-pedir nada.
- **Endpoints ya cacheados desde 14H.2/14H.3**: `orgStructureApiService.getCatalog()` (usado dentro de `AssociatedEmployeesPanel` para los selects de sector/costCenter/empresa) ya cacheado desde antes de esta serie — sin cambios.
- **Semántica Normal/adicional visible**: confirmado sin tocar — el subtítulo de la pantalla ("Horas normales representa el total trabajado. Los conceptos adicionales son desgloses...") y el editor ("No reemplaza ni incrementa Horas normales") siguen exactamente igual; `systemRole === "NORMAL_BASE"` sigue mostrando el badge "Protegido" sin acciones de editar/deshabilitar/eliminar — ningún archivo de UI tocado.

---

## 3. Endpoints detectados (mapa completo)

| Endpoint | Rol | Cache frontend (antes) | Cache backend | `$transaction` (antes) |
|---|---|---|---|---|
| `GET /hour-concepts` | Principal (listado) | Sí, ya existente | Sí (`hourConceptsReadCache`, 60s) + `listCache` interno (2min) | Sólo rama filtrada — corregido |
| `GET /hour-concepts/:id/rules` (`getByConcept`) | Detalle (reglas) | No — fix aplicado | No | No (usa `findByConceptId`, sin `$transaction`) |
| `GET /hour-concepts/:id/employees` | Detalle (empleados habilitados) | No — fix aplicado | No | Sí — corregido |
| `GET /hour-concept-rules` (listado general, sin caller frontend) | No usado por la UI | N/A | N/A | Sí — **no corregido**, ver §2.3/§14 |

---

## 4. Causa raíz

Dos causas, cada una con su fix:
1. **`GET /hour-concepts/:id/employees`**: antipatrón `$transaction` serializando `findMany`+`count` — mismo patrón corregido 11+ veces en las series 14G/14H.
2. **Falta de dedupe frontend** en `getHourConceptEmployees()`/`listByConcept()` — ambos disparados por montajes frescos de componentes hijos (`AssociatedEmployeesPanel`/`HourConceptRulesPanel`) al abrir "Editar" sobre un concepto existente, sin `cachedData()`.

`GET /hour-concepts/:id/rules` (`getByConcept`) no tenía ningún problema de backend (ya usaba `findByConceptId`, sin `$transaction`, `include` liviano) — sólo le faltaba el dedupe frontend.

---

## 5. Cambios aplicados

### 5.1 `frontend/src/services/api/hourConceptApiService.ts`

- `getHourConceptEmployees()`: ahora pasa por `cachedData()` (antes: `apiRequest` directo). Se corrigió además un comentario desactualizado que decía "sin cachedData, mismo criterio que workRegimeApiService.getWorkRegimeEmployees" — esa referencia quedó obsoleta desde que 14H.2 le agregó `cachedData` a ese mismo método.
- `enableEmployees()`/`disableEmployee()`: ahora invalidan la familia `"hour-concepts"` (antes: ninguna invalidación de esta familia — sólo invalidaban `employees`, la de Legajos, que sigue intacta).

### 5.2 `frontend/src/services/api/hourConceptRuleApiService.ts`

- `listByConcept()`: ahora pasa por `cachedData()` (antes: `apiRequest` directo, sin ningún cache).
- `create()`/`update()`/`updateStatus()`: ahora invalidan la familia `"hour-concepts"` (antes: ninguna invalidación, porque no había nada cacheado).

### 5.3 `frontend/src/services/cache/cachePolicy.ts`

2 policies nuevas, ambas familia `"hour-concepts"` (**reusada, ya existía — no se creó ninguna familia nueva**) — ver §11.

### 5.4 `backend/src/modules/hour-concepts/hourConcepts.repository.ts`

`findMany` (rama filtrada) y `findEmployees`: `$transaction([...])` → `Promise.all([...])`. `where`/`select`/`orderBy`/`skip`/`take` sin cambios — cero impacto de contrato.

### 5.5 `frontend/e2e/adminConfigurationPerformanceJourney.spec.ts` + `frontend/e2e/support/adminConfigurationJourney.ts`

Se agregó la secuencia "Abrir detalle de concepto horario (Editar)" → "Abrir/Cerrar modal Nueva regla horaria" (sólo si el concepto editado es `AUTOMATIC`/`BOTH` y editable) → "Cerrar detalle sin guardar" — ver §0. Se actualizaron `SUBMODULE_INVENTORY`/`COVERAGE_MATRIX`/el texto de la sección 14 del reporte generado para reflejar la nueva cobertura.

**No se tocó**: `HourConceptsPage.tsx`, `HourConceptRulesPanel.tsx`, `AssociatedEmployeesPanel.tsx`, `hourConceptClassification.ts` (motor de clasificación automática, usado por Turnos/carga horaria — no forma parte de esta pantalla), `hourConcepts.service.ts`/`.controller.ts`, `hourConceptRules.repository.ts`/`.service.ts`/`.controller.ts`, `hourConcepts.routes.ts`/`hourConceptRules.routes.ts` (RBAC intacto).

---

## 6. Qué NO se cambió (decisiones explícitas)

- **`hourConceptRulesRepository.findMany`** (el listado general de reglas, sin caller frontend) — `$transaction` no corregido, ver §2.3/§14. Documentado, no tocado, por falta de evidencia de uso real.
- **No se agregó cache backend** a `rules`/`employees` — evaluado y descartado con el mismo criterio que 14H.4 (Asignaciones de feriados): el `$transaction`→`Promise.all` de `employees` ya ataca la causa real medible; `rules` nunca tuvo el antipatrón; agregar cache backend a endpoints RBAC-scoped de bajo volumen (un concepto tiene, en la práctica, pocas reglas y pocos empleados habilitados) no está justificado sin evidencia de que sigan lentos tras el fix de concurrencia.
- **No se consolidaron los 2 caches backend superpuestos del listado** (`hourConceptsReadCache` + `listCache` interno) — deuda de consistencia arquitectónica ya documentada, no un bug, fuera de alcance (`PERFORMANCE_STANDARDS.md` §15).
- **`rowKey` de `AssociatedEmployeesPanel` en este caller** — sin cambios, confirmado innecesario (§2.2): `HourConceptEmployeeAssociation` nunca tiene employeeId duplicado.
- **RBAC/scope**: `hourConcepts.routes.ts`/`hourConceptRules.routes.ts` sin tocar.

---

## 7. Contrato API preservado

Sin cambios en `hourConcepts.schemas.ts`, `hourConceptRules.schemas.ts`, rutas, métodos HTTP, query params ni shape de respuesta de ningún endpoint.

## 8. RBAC/scope preservado

`GET /hour-concepts`: `requireAuth` sin rol adicional, sin cambios. `GET /:id/employees`: `[rrhh, supervision, cargaHoraria]`, sin cambios. `GET /:id/rules`: `requireAuth` sin rol adicional, sin cambios. Escrituras (`create`/`update`/`remove`/`enableEmployees`/`disableEmployee`/reglas): `adminRoles`, sin cambios. `employeeAccessWhere(user)` en `findEmployees` sin cambios.

## 9. Semántica preservada

- **Normal**: `HourConcept.systemRole === "NORMAL_BASE"` sigue siendo el único valor protegido (badge "Protegido", sin acciones de editar/deshabilitar/eliminar) — ningún archivo de negocio tocado.
- **Adicionales**: `HourConceptRule`/`EmployeeHourConcept` sin cambios de shape, cálculo ni relación — sólo se tocó CÓMO se leen (paralelización de 2 queries independientes), nunca QUÉ devuelven.
- **Real/liquidable**: no aplica a este módulo directamente — Conceptos horarios no calcula multiplicadores ni valores liquidables (eso es Horas Especiales, ver `SHIFTS_AND_SPECIAL_HOURS_PERFORMANCE_14H3.md`); esta etapa no tocó `hourConceptClassification.ts` ni ningún archivo de `time-entries`.
- **Fichador**: no consultado por esta etapa — el fichador no pregunta conceptos horarios (confirmado, sin cambios de código en esa dirección).
- **`loadMode` MANUAL/AUTOMATIC/BOTH**: sin cambios de comportamiento — `HourConceptRulesPanel` sigue sin pedir reglas cuando `loadMode === "MANUAL"`, exactamente igual que antes.

---

## 10. Cache/dedupe — detalle

| Policy | Family | TTL | Persist | Sensitive |
|---|---|---|---|---|
| `hourConceptEmployeesList` | `hour-concepts` | 15s | No | Sí (PII de empleados) |
| `hourConceptRulesByConceptId` | `hour-concepts` | 30s | No | No (sin PII) |

- **Family**: `"hour-concepts"` (reusada, ya existía desde antes de esta serie) — crear/editar/eliminar un concepto (`create`/`update`/`updateStatus`/`remove`, ya invalidaban esta familia) también invalida ambas caches nuevas sin código adicional.
- **Key**: `` `GET:${path}` `` en ambos casos — `hourConceptId` (vía path) + filtros de empleado (`sectorId`/`costCenterId`/`companyId`/`search`/`status`/`page`/`take`) para la de empleados; sólo `hourConceptId` para la de reglas.
- **Invalidaciones agregadas**: `enableEmployees`/`disableEmployee` (empleados) y `create`/`update`/`updateStatus` de reglas (antes, ninguno de los 5 invalidaba nada porque no había nada cacheado).
- **Riesgos**: hasta 15-30s de staleness si dos pestañas mutan/leen casi simultáneamente — mismo perfil ya aceptado para el resto de las caches de esta familia/serie.

---

## 11. Tests

### Backend

- `hourConcepts.repository.test.ts`: test de `findEmployees` actualizado (título + assert de `$transaction` no llamado, mismo criterio que 14H.2/14H.4); nuevo describe block para `findMany` (rama filtrada) — no tenía **ningún** test dedicado antes de esta etapa.
- Resto de la suite de `hour-concepts` (94 tests) sin cambios — no se tocó ninguna query ni lógica de servicio, sólo la capa de concurrencia.

### Frontend

- `hourConceptApiService.test.ts`: mock de `apiClient`/`../cache` agregado (mismo patrón ya usado 12+ veces en esta serie, verificado que no afecta los tests preexistentes de mapeo puro). Nuevos: dedupe in-flight, cache-hit, cache-miss al cambiar de concepto, contrato sin cambios, `it.each` de `enableEmployees`/`disableEmployee` invalidando `"hour-concepts"`, refetch tras invalidar.
- `hourConceptRuleApiService.test.ts`: mismo patrón — dedupe, cache-hit, cache-miss al cambiar de concepto, array vacío sigue siendo empty state real (no error), `it.each` de `create`/`update`/`updateStatus` invalidando, refetch tras invalidar.
- No se crearon tests dependientes de tiempos exactos.

Suite completa: backend **1243/1243** (79 archivos, +1 test nuevo neto); frontend **788/788** (78 archivos, +15 tests nuevos).

---

## 12. Métricas antes/después

`GET /hour-concepts/:id/rules` y `GET /hour-concepts/:id/employees` **nunca fueron medidos por ningún journey antes de esta etapa** (14H.1-14H.4 nunca abrían el editor inline de Conceptos horarios) — no existe una línea de base "antes" real basada en journey para estos 2 endpoints. Se reporta lo que sí es comparable:

| Métrica | Antes | Después |
|---|---|---|
| `GET /hour-concepts` (listado) | Ya cacheado, sin cambios de este módulo | Sin cambios — 827ms medido en esta corrida (variación normal de Neon, mismo endpoint sin tocar) |
| `GET /hour-concepts/:id/rules` — cobertura del journey | Nunca ejercitado | **Primera medición**: 880ms, 1 sola request (sin duplicar) |
| `GET /hour-concepts/:id/employees` — cobertura del journey | Nunca ejercitado | **Primera medición**: 872ms, 1 sola request (sin duplicar) — ya refleja el fix `$transaction`→`Promise.all` de esta misma etapa |
| Escrituras ejecutadas | 0 | 0 |
| HTTP errors | 0 | 0 |
| Console errors | 0 | 0 |

**Nota metodológica**: ambas requests (872ms/880ms) completaron después de que la ventana de medición de "Abrir detalle de concepto horario (Editar)" ya había cerrado (`networkIdleMs: 435ms` para esa acción) y quedaron atribuidas a la acción siguiente ("Cerrar detalle...") en el reporte — mismo artefacto de atribución por timing asíncrono ya documentado en `SHIFTS_AND_SPECIAL_HOURS_PERFORMANCE_14H3.md`/`HOLIDAY_ASSIGNMENTS_PERFORMANCE_14H4.md` (`GET /positions`, `GET /org-structure`). Lo relevante y confirmado con confianza: **cada endpoint disparó exactamente 1 request**, no 2 — la evidencia funcional del dedupe (in-flight vía `pendingRevalidations`) está además confirmada de forma directa y determinística por los tests unitarios de `hourConceptApiService.test.ts`/`hourConceptRuleApiService.test.ts` (`Promise.all` de 2 llamadas concurrentes → 1 solo `apiRequest`), que no dependen de timing real de red.

En este mismo entorno, el concepto editable encontrado por el journey resultó ser `loadMode: MANUAL` — por eso "Abrir modal Nueva regla horaria" se salteó (el botón "Nueva regla" no se renderiza para conceptos manuales, comportamiento correcto y esperado, no un fallo).

---

## 13. Validaciones ejecutadas

- Backend: `npx prisma validate` ✅, `npm run typecheck` ✅, `npm test` ✅ 1243/1243 (79 archivos), `npm run build` ✅.
- Frontend: `npx tsc -b --noEmit` ✅, `npx tsc -p tsconfig.e2e.json --noEmit` ✅, `npm test` ✅ 788/788 (78 archivos), `npm run build` ✅.
- `npm run perf:journey:admin-config` ✅ **passed** (0 HTTP/console errors, 0 escrituras; nueva cobertura de detalle funcionando).
- `npm run perf:journey:workforce` (14G.1, regresión transversal) ✅ passed, 1.1min.
- `npm run perf:journey:employees` (14D.1, regresión transversal) ✅ passed, 40.6s.
- `git diff --check` ✅ sin errores de espacios en blanco.

---

## 14. Riesgos pendientes

- **`hourConceptRulesRepository.findMany` sigue con `$transaction`** (§2.3) — sin caller frontend hoy, documentado como hallazgo no corregido; si en el futuro se agrega un consumidor real (ej. una vista "todas las reglas de todos los conceptos"), aplicar el mismo fix antes de exponerlo.
- **2 caches backend superpuestas para el listado principal** (`hourConceptsReadCache` 60s + `listCache` interno 2min) — deuda ya documentada en `PERFORMANCE_STANDARDS.md` §15, no es un bug, no se tocó.
- El artefacto de atribución de timing (§12) puede repetirse en corridas futuras — no afecta la validez de "0/1/2 requests por endpoint", sólo a qué acción del reporte quedan visualmente asociadas las duraciones.

## 15. Recomendación para 14H.6

Con Regímenes laborales, Turnos, Horas especiales, Asignaciones de feriados y ahora Conceptos horarios optimizados y diagnosticados con evidencia real, los 3 submódulos de Configuración que quedan sin ningún journey de detalle son **Empresas y estructura**, **Categorías documentales** y **Parámetros de auditoría** — los 3 con editor inline nunca abierto y sin hallazgos de backend confirmados todavía (sólo el listado principal fue medido). Recomendado: una etapa de relevamiento liviana que confirme si alguno de los 3 amerita el mismo tratamiento antes de dar por cerrada la serie 14H.

---

No se cambió contrato de API. No se cambió RBAC/scope. No se cambió diseño visual. No se cambió semántica Normal/adicional/real/liquidable/fichador. No se tocó Gestión horaria (más allá de la regresión transversal ya prevista), Fichador, Regímenes laborales, Turnos, Horas especiales, Asignaciones de feriados, Puestos, Empresas y estructura, Categorías documentales ni Parámetros de auditoría. No se creó ninguna migración. No se ejecutó ninguna escritura real. No commitear sin aprobación explícita del usuario. No hacer push.
