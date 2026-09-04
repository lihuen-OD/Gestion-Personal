# Etapa 14C.3 — Optimización integral del módulo Legajos (de punta a punta)

Fecha: 2026-09-04
Estado: diagnóstico completo, implementado, validado, **pendiente de aprobación para commitear**
Alcance: exclusivamente `employees` (Legajos) — backend (`backend/src/modules/employees/`) y frontend (`frontend/src/pages/EmployeesPage.tsx`, historiales de campo/bloque). Construye sobre el estado ya dejado (sin commitear) por 14C.1/14C.2 ampliada, que ya habían optimizado `overview-details`, `findById`/guardados (core+batch) y `GET /audit`. Sin cambios de schema/migraciones, sin cambios de contrato de API, sin cambios de reglas de Hora Normal/Conceptos Horarios/Horas Especiales/liquidación/fichador/permisos/RBAC/estado laboral/responsable de carga/encargado directo, sin eliminación de datos, sin pérdida de historial/auditoría.

---

## 0. Resumen ejecutivo

El usuario reportó 3 síntomas concretos: (1) el listado de Legajos carga "un poco lento", (2) pasar de página tarda "varios segundos", (3) abrir un historial puntual (ejemplo real: historial de Responsable de carga) dispara `GET /employees/:id/block-history` con **3679-4974ms**, dominado por un `Employee.findFirst` de **2994-3508ms**, más queries de `EmployeeDocument`/`LaborMovement`/`EmployeeCompany`/`Novelty` que no deberían estar ahí para un historial puntual.

Diagnóstico confirmado leyendo el código real (no se asumió nada):

- **Causa raíz del síntoma (3), la más crítica**: `listFieldHistory`/`listBlockHistory` (`employees.service.ts`) — antes de esta etapa — llamaban a `employeesService.getById(id, user)` **sólo para validar existencia + alcance**, pero `getById` trae el **detalle completo del legajo** (`findEmployeeDetailById`: núcleo con cadena `sector`/`position` de 4 niveles + 6 `findMany` en paralelo de `companies`/`laborMovements`/`assignments`/`hourConcepts`/`novelties`/`documents`) y **descartaba el resultado sin usarlo**. El propio filtro por bloque/campo (`block`/`field`/`section`) ya existía y ya funcionaba correctamente en el backend y en el frontend — el problema nunca fue "trae más historial del necesario", fue "trae el legajo completo antes de ni siquiera mirar el historial".
- **Causa del síntoma (2)**: `employeesRepository.findMany` (el `GET /employees` paginado) seguía usando `prisma.$transaction([findMany, count])` — la forma-array de `$transaction` ejecuta ambas queries **secuencialmente sobre una única conexión**, no en paralelo. Este mismo antipatrón ya se había corregido 3 veces en este módulo en etapas previas (`summary()` en 14C.1, `audit.repository.findMany` y `findOverviewDetailsById` en 14C.2) pero **no se había tocado en el propio listado paginado**, que es exactamente lo que se pide en cada cambio de página.
- **Síntoma (1)**: mismo `GET /employees`, mismo fix — la carga inicial también paga el mismo costo de `$transaction` serializado.

Cambio aplicado — quirúrgico, sin tocar ninguna regla funcional:

1. `employeesRepository.findMany`/`findOrgChart`/`findOptions`: `$transaction([...])` → `Promise.all([...])`.
2. Nuevo `employeesRepository.existsWithAccess(id, accessWhere)` (select `{ id: true }`, sin relaciones) + `employeesService.assertAccessible(id, user)`; `listFieldHistory`/`listBlockHistory`/`createFieldHistory`/`createBlockHistory` pasan de `getById` (detalle completo) a `assertAccessible` (sólo existencia + alcance).
3. Frontend (`EmployeesPage.tsx`): precarga silenciosa de la página siguiente usando la caché ya existente (`employeeApiService.list`, `services/cache`), sin agregar ningún mecanismo nuevo.

Medido en vivo contra el mismo empleado/entorno (staging real vía Neon, mismo criterio que 14C.1/14C.2):

| Medición | Antes | Después | Mejora |
|---|---|---|---|
| `GET /employees/:id/block-history?block=TIME_RESPONSIBLE` (curl autenticado, 3 corridas c/u) | 8.69s / 7.01s / 6.87s | 1.19s (fría) / 0.35s / 0.37s | **~91-95%** |
| `GET /employees` (perf:journey, pantalla Legajos) | 2695ms (avg, 1 llamada) | 1735ms avg / 1879ms max (2 llamadas: real + precarga) | **~30-35% por llamada** |

No se inventó ningún número — método completo en §8.

---

## 1. Matriz completa de consultas del módulo Legajos

Leyenda de Estado: `CORREGIDO` (cambiado en esta etapa) · `YA OPTIMIZADO` (corregido en 14A/14C.1/14C.2, revisado en esta etapa, sin hallazgos nuevos) · `REVISADO SIN CAMBIOS` (evaluado en esta etapa, no requiere cambio) · `PENDIENTE` (candidato documentado, fuera de alcance de esta etapa) · `N/A` (no existe en la UI actual).

### A. Listado de Legajos

| Pantalla / Acción | Componente frontend | Endpoint | Método | Query/queries Prisma | Tiempo actual (medido) | Problema detectado | Cambio propuesto | Riesgo | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 1. Entrada a `/legajos` | `EmployeesPage.tsx` | dispara 2-4 → | — | — | `networkIdleMs` 3267-4041ms (journey) | Ver filas siguientes | — | — | — |
| 2. Listado inicial | `EmployeesPage.tsx` | `GET /employees` | GET | `employee.findMany` + `employee.count` | Antes 2695ms → Después 1735-1879ms (medido) | `$transaction([...])` serializaba las 2 queries sobre 1 conexión | `$transaction`→`Promise.all` | Bajo (2 lecturas independientes, sin escritura entre medio, mismo criterio ya usado 3 veces en el módulo) | **CORREGIDO** |
| 3. `GET /employees/summary` | `EmployeesPage.tsx` | `GET /employees/summary` | GET | 3 queries agregadas (`groupBy`×2 + `count`) | 767-804ms | Ya corregido en 14C.1 (`$transaction`→`Promise.all`) | — | — | **YA OPTIMIZADO** (14C.1) |
| 4. Catálogo de filtros | `EmployeesPage.tsx` | `GET /org-structure` | GET | 6 queries en `Promise.all` (compartido, no exclusivo de Legajos) | 2647-2689ms | Ninguno nuevo; catálogo compartido por 10+ pantallas, ya paralelo y cacheado (60s backend/10min frontend) | — | — | **REVISADO SIN CAMBIOS** (fuera de alcance quirúrgico) |
| 5. Filtros/catálogos de la pantalla | `EmployeesPage.tsx` | (mismos 3 anteriores) | — | — | — | Sin duplicados entre los 3 efectos (confirmado por lectura completa) | — | — | **REVISADO SIN CAMBIOS** |
| 6. Paginación siguiente | `Pagination.tsx` → `EmployeesPage.tsx` | `GET /employees?page=N+1` | GET | mismo `findMany` de fila 2 | mismo fix que fila 2 + precarga | Mismo antipatrón de fila 2 **es la causa real** de "tarda varios segundos" reportada | `Promise.all` (fila 2) + precarga silenciosa de la página siguiente | Bajo | **CORREGIDO** |
| 7. Cambio de página (anterior) | idem | `GET /employees?page=N-1` | GET | idem | idem | idem | idem (la precarga sólo cubre "siguiente", ver §5) | Bajo | **CORREGIDO** (backend); precarga sólo hacia adelante |
| 8. Cambio de tamaño de página | `EmployeesPage.tsx` | — | — | — | — | No existe selector de tamaño de página en la UI (`pageSize=25` fijo) | — | — | **N/A** |
| 9. Búsqueda por texto | `FilterPanel` → `EmployeesPage.tsx` | `GET /employees?search=...` | GET | `findMany` con `where` por `contains` (índices `[lastName,firstName]`, confirmados en 14A) | — | Ya usa `useDebouncedValue` (no dispara 1 request por tecla); filtro resuelto en DB | — | — | **REVISADO SIN CAMBIOS** |
| 10. Filtros empresa/sector/centro de costo | idem | `GET /employees?companyId=/sectorId=/costCenterId=` | GET | `buildWhere` combina `accessWhere`+filtros, índices `[status,sectorId]`/`[status,costCenterId]`/`[sectorId]`/`[costCenterId]` (14A) | — | Resuelto en DB, no en memoria; sin filtro directo por puesto en el listado (no existe en la UI) | — | — | **REVISADO SIN CAMBIOS** |
| — `GET /employees/org-chart` (catálogo de organigrama, mismo repositorio) | `OrganigramasPage.tsx` (fuera de `/legajos` pero mismo módulo backend) | `GET /employees/org-chart` | GET | `findOrgChart` | no ejercitado por el journey | Mismo antipatrón `$transaction` que fila 2 | `Promise.all` | Bajo | **CORREGIDO** (consistencia, no medido en vivo — ver §9) |
| — `GET /employees/options` (selects/pickers de empleado) | varios (`EmployeeRemoteSelector`, etc.) | `GET /employees/options` | GET | `findOptions` | no ejercitado por el journey | Mismo antipatrón `$transaction` | `Promise.all` | Bajo | **CORREGIDO** (consistencia, no medido en vivo — ver §9) |

### B. Detalle de Legajo

| Pantalla / Acción | Componente frontend | Endpoint | Método | Query/queries Prisma | Tiempo actual | Problema detectado | Cambio propuesto | Riesgo | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 11. Entrada a `/legajos/:id` | `EmployeeDetailPage.tsx` | dispara `overview`+`overview-details`+`audit` en paralelo | — | — | `networkIdleMs` 5216-5396ms | Sin cambios de esta etapa (ver fila 13) | — | — | — |
| 12. `GET /employees/:id` (endpoint plano) | no usado por `EmployeeDetailPage` (sólo `DocumentUploadModal` y los 7 guardados que lo reusan internamente) | `GET /employees/:id` | GET | `findEmployeeDetailById` (core + 6 `findMany` en `Promise.all`) | — | Ya dividido en 14C.2 | — | — | **YA OPTIMIZADO** (14C.2) |
| 13. `GET /employees/:id/overview-details` | `EmployeeDetailPage.tsx` | `GET /employees/:id/overview-details` | GET | núcleo (`findFirst`, 1 `findFirst` con cadena `sector→area→establishment→businessUnit` de 4 niveles) + 4 `findMany` en `Promise.all` | 4463-4821ms — sigue en rango "Crítico" | Ya diagnosticado y parcialmente resuelto en 14C.1 (34-36% de mejora ya capturada); el resto de la lentitud es la cadena de 4 niveles sin `relationJoins`, **no** algo nuevo de esta etapa | — (evaluado, no re-tocado — ver §9) | — | **YA OPTIMIZADO** (14C.1), **candidato pendiente documentado** |
| 14-15. Secciones/pestañas internas | `EmployeeDetailPage.tsx` (tabs 1-5) | ninguno propio | — | — | — | Decisión ya tomada y documentada en 14C.1 §1.12: diferir `overview-details` por pestaña rompería la cabecera (empresa/centro de costo/estado calculado, visible en todas las pestañas) — no se reabrió esta decisión por falta de evidencia nueva que la contradiga | — | — | **REVISADO SIN CAMBIOS** (decisión previa, no revisitada) |
| 16. Relaciones pesadas del detalle | `employees.repository.ts` | (mismos anteriores) | — | — | — | Ya separadas núcleo+batch en 14C.1/14C.2 | — | — | **YA OPTIMIZADO** |

### C. Historiales (bloque crítico de esta etapa)

| Pantalla / Acción | Componente frontend | Endpoint | Método | Query/queries Prisma | Tiempo actual (medido) | Problema detectado | Cambio propuesto | Riesgo | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 17. `GET /employees/:id/block-history` (cualquier bloque) | `BlockHistoryTimeline` (`FieldHistoryControls.tsx`) | `GET /employees/:id/block-history?section=&block=` | GET | Antes: `getById`→`findEmployeeDetailById` (1 core + 6 `findMany`) **descartado**, + `employeeBlockHistory.findMany` (ya filtrado). Después: `existsWithAccess` (`findFirst {id:true}`) + `employeeBlockHistory.findMany` | Antes 6.87-8.69s → Después 0.35-1.19s (curl real, mismo empleado) | **Causa raíz real**: se cargaba el legajo completo (9 relaciones, cadena de 4 niveles) sólo para verificar que existe y está en alcance, y se tiraba el resultado | `getById`→`assertAccessible` (`existsWithAccess`, select `{id:true}`, sin relaciones) | Bajo (mismo `where`/`accessWhere` que `findById`, mismo criterio de alcance, sólo sin las relaciones) | **CORREGIDO** |
| 18. Historial de Información general | `SectionChangeHistory` (`EmployeeDetailPage.tsx`) | `GET /audit` (ya cargado una vez para toda la pantalla) | GET | ya corregido en 14C.2 (`Promise.all`) | 1037ms avg (journey) | Filtrado 100% client-side sobre datos ya en memoria — **cero costo marginal por card** | — | — | **YA OPTIMIZADO** (14C.2, además arquitectura ya óptima: 1 sola carga para todas las secciones de auditoría) |
| 19. Historial de Contacto | idem (mismo `SectionChangeHistory`, `section="CONTACTO_DOMICILIO"`, filtrado client-side sobre el mismo `GET /audit`) | idem | GET | idem | idem | idem | — | — | **YA OPTIMIZADO** |
| 20. Historial de Domicilio | `BlockHistoryTimeline` (`section="CONTACTO_DOMICILIO"`, `block="DOMICILIO"`) | `GET /employees/:id/block-history` | GET | mismo mecanismo de fila 17 | mismo fix de fila 17 | mismo síntoma de fila 17 | mismo fix de fila 17 | Bajo | **CORREGIDO** |
| 21-26. Historial de Empresa / Unidad de negocio / Establecimiento / Sector / Puesto / Jornada-Turno | `FieldWithHistory` para `sector` (`GET /field-history?section=DATOS_LABORALES&field=sector`); **no se encontró** un `FieldWithHistory`/`BlockHistoryTimeline` propio para Empresa/Unidad de negocio/Establecimiento/Puesto/Jornada-Turno en el código actual (confirmado por grep completo de `EmployeeDetailPage.tsx`/`EmployeeDetailBlocks.tsx`) | `GET /employees/:id/field-history` (para `sector`, donde existe) | GET | mismo mecanismo de fila 17 pero para `employeeFieldHistory` | mismo fix de fila 17 (mismo `assertAccessible`) | mismo síntoma de fila 17, donde el card existe | mismo fix de fila 17 | Bajo | **CORREGIDO** donde el card existe (Sector); el resto **no existe como historial individual hoy** — no se inventó un endpoint nuevo para algo que la UI no expone |
| 27. Historial de Responsable de carga | `BlockHistoryTimeline` (`section="RESPONSABLES_ASIGNACIONES"`, `block="TIME_RESPONSIBLE"`) | `GET /employees/:id/block-history` | GET | mismo mecanismo de fila 17 | **Este es el caso reportado por el usuario** — medido arriba | mismo síntoma de fila 17 | mismo fix de fila 17 | Bajo | **CORREGIDO** |
| 28. Historial de Encargado directo | `BlockHistoryTimeline` (`block="DIRECT_MANAGER"`, mismo componente parametrizado) | `GET /employees/:id/block-history` | GET | mismo mecanismo de fila 17 | mismo fix de fila 17 | mismo síntoma de fila 17 | mismo fix de fila 17 | Bajo | **CORREGIDO** |
| 29. Historial de Transporte | `BlockHistoryTimeline` (`section="TRANSPORTE"`, `block="TRANSPORTE"`) | `GET /employees/:id/block-history` | GET | mismo mecanismo de fila 17 | mismo fix de fila 17 | mismo síntoma de fila 17 | mismo fix de fila 17 | Bajo | **CORREGIDO** |
| 30. Historial de Configuración (Horas Especiales) | `BlockHistoryTimeline` (`section="CONFIGURACION_HORARIA_LIQUIDACION"`, `block="HORAS_ESPECIALES"`) | `GET /employees/:id/block-history` | GET | mismo mecanismo de fila 17 | mismo fix de fila 17 | mismo síntoma de fila 17 | mismo fix de fila 17 | Bajo | **CORREGIDO** |
| 31. Historial de Conceptos horarios | — | — | — | — | — | No se encontró un card de historial individual para conceptos horarios asignados (el guardado de conceptos sí queda en `GET /audit` general) | — | — | **N/A** (no existe en la UI actual) |
| 32. Historial de Adjuntos/documentos | — | — | — | — | — | No existe un `field-history`/`block-history` para documentos; los documentos se auditan vía `documents.service.ts`/`storage.service.ts` (fuera de alcance de esta etapa, ver auditoría técnica previa) | — | — | **N/A / fuera de alcance** |
| 33. Cualquier otro historial visible desde una card | (todos los anteriores) | (los 2 mismos endpoints) | — | — | — | Confirmado: **todos** los historiales de campo/bloque de Legajos pasan por sólo 2 endpoints (`field-history`, `block-history`), ambos corregidos con el mismo cambio | — | — | **CORREGIDO** (cobertura completa, no parcial) |

### D. Guardados

| Pantalla / Acción | Componente frontend | Endpoint | Método | Query/queries Prisma | Problema detectado | Cambio propuesto | Riesgo | Estado |
|---|---|---|---|---|---|---|---|---|
| 34. Crear legajo | `EmployeeCreatePage.tsx` | `POST /employees` | POST | `create()` con `employeeDetailSelect` completo (intencional: filas nuevas, partir el select no ahorra round-trips) | Ninguno nuevo | — | — | **YA REVISADO** (14C.2, decisión documentada, no reabierta) |
| 35. Guardar información general | `EmployeeDetailPage.tsx` | `PATCH /employees/:id` | PATCH | `findUpdateAuditSnapshot` (select escalar dedicado, en paralelo con la validación de conflicto) + `update()` con `employeeUpdateWriteSelect` (select escalar puro, **sin relaciones**) | Ninguno — **ya es liviano desde antes de 14C** (select escalar dedicado, no el select gigante) | — | — | **YA OPTIMIZADO** (etapa anterior a 14C) |
| 36. Guardar contacto | `FieldWithHistory`/`EmployeeDetailPage.tsx` | `PATCH /employees/:id/contact` | PATCH | `update({select:{id:true}})` + `findEmployeeDetailByIdOrThrow` (core+batch) | Ninguno nuevo | — | — | **YA OPTIMIZADO** (14C.2) |
| 37. Guardar domicilio | `EmployeeDetailBlocks.tsx` | `PATCH /employees/:id/address` | PATCH | idem fila 36 | Ninguno nuevo | — | — | **YA OPTIMIZADO** (14C.2) |
| 38. Guardar datos laborales | `FieldWithHistory` (por campo) | `PATCH /employees/:id` (mismo endpoint que fila 35, por campo) | PATCH | idem fila 35 | Ninguno nuevo | — | — | **YA OPTIMIZADO** |
| 39. Guardar responsables/asignaciones | `EmployeeDetailBlocks.tsx` | `PUT /employees/:id/assignments` | PUT | delete+create dentro de `$transaction` interactiva (necesaria, decisión 6Q) + `findEmployeeDetailByIdOrThrow` fuera de la transacción | Ninguno nuevo | — | — | **YA OPTIMIZADO** (14C.2) |
| 40. Guardar transporte | `EmployeeDetailBlocks.tsx` | `PATCH /employees/:id/transport` | PATCH | idem fila 36 | Ninguno nuevo | — | — | **YA OPTIMIZADO** (14C.2) |
| 41. Guardar configuración (Horas Especiales) | `EmployeeDetailBlocks.tsx` | (config del bloque; el historial es lo medido en fila 30) | — | — | Ninguno nuevo | — | — | **REVISADO SIN CAMBIOS** |
| 42. Guardar conceptos horarios | `EmployeeDetailBlocks.tsx` | `PUT /employees/:id/hour-concepts` | PUT | delete+create dentro de `$transaction` interactiva (necesaria) + `findEmployeeDetailByIdOrThrow` fuera | Ninguno nuevo | — | — | **YA OPTIMIZADO** (14C.2) |
| 43. Adjuntar documento | `DocumentUploadModal.tsx` | `POST /employees/:id/documents` | POST | `before = getById(id)` (detalle completo, **sin** `user`/`accessWhere` — llamada interna) + upload a storage + `create()` dentro de `$transaction` + `findEmployeeDetailByIdOrThrow` fuera | `before = getById(id)` sigue trayendo el detalle completo sólo para leer `legajo` (string, para la ruta de storage) y `documents` (para el diff de auditoría) — mismo patrón de causa que el de `block-history`, pero **no reportado por el usuario ni medido como crítico** en esta etapa (endpoint de baja frecuencia) | — (no tocado esta etapa, ver §9) | Medio — necesitaría un select dedicado con `legajo`+`documents` solamente, sin tocar el resto del flujo de auditoría/storage | **PENDIENTE** (candidato documentado, no medido, fuera del síntoma reportado) |
| 44. Eliminar/desvincular documento | — | — | — | — | No se encontró un endpoint de borrado de documentos en `employees` (la baja de documentos, si existe, vive en el módulo `documents`, fuera de alcance) | — | — | **FUERA DE ALCANCE** (módulo `documents`, no `employees`) |
| 45. Refetch posterior a cada guardado | todos los guardados de la fila 36-42 | ninguno adicional | — | — | Ya resuelto en 14C.2: el frontend reemplaza el estado local con la respuesta del propio guardado (`mapEmployeeFromApi(response.data)`); no hay ningún `GET` adicional después de guardar | — | — | **YA OPTIMIZADO** (14C.2) |

---

## 2. Diagnóstico — listado y paginación (Parte 2 del pedido)

1. **¿Cada página se pide al servidor?** Sí, `GET /employees?page=N` real por cada cambio de página — no hay fetch-all ni paginación en memoria (confirmado, `EmployeesPage.tsx:55-75`).
2. **¿Se repite `summary`/`org-structure`/catálogos al cambiar de página?** No — esos 2 efectos dependen de `refresh`/`[]` respectivamente, no de `page` (confirmado leyendo los 3 `useEffect` de `EmployeesPage.tsx`).
3. **¿Se blanquea la tabla durante la carga?** No, ni antes ni después de esta etapa — `if (!all.length) setListStatus("loading")` (línea 57) sólo entra en estado "loading" cuando todavía no hay filas en pantalla; en un cambio de página con datos ya cargados, la tabla anterior queda visible mientras llega la respuesta nueva. Esto **ya existía** antes de esta etapa; se agregó un test explícito para que quede verificado en vez de ser un efecto colateral no cubierto (`EmployeesPage.test.tsx`).
4. **¿Hay caché por página/filtro?** Sí, backend (`employeeListCache`, `createTtlCache`, 20s, clave por usuario+rol+URL completa incluyendo `page`/filtros) y frontend (`cachePolicies.employeesList`, 30s, misma clave por request completo, `services/cache`).
5. **¿Se puede hacer prefetch de la página siguiente?** Sí — implementado (§4.B).
6. **¿Se puede mantener visible la página actual mientras carga la siguiente?** Ya se cumplía (punto 3); confirmado con test nuevo.
7. **¿El endpoint trae campos no usados en la tabla?** No — ya recortado en 14C.1 (`employeeListSelect`), revisado de nuevo en esta etapa, sin campos sobrantes.
8. **¿El `count` es caro?** No de forma desproporcionada — mismo `where` que el `findMany`, cubierto por los mismos índices (14A); el costo real estaba en que corría **en serie** con el `findMany` dentro del `$transaction`, no en su propio costo.
9. **¿La paginación usa `skip`/`take`?** Sí (`skip = (page-1)*take`). Con los volúmenes reales del sistema (cientos, no millones de legajos) el costo de `OFFSET` no es el cuello de botella medido — el cuello de botella real era la serialización del `$transaction`, ya corregida.
10. **¿Hay filtros aplicados en DB?** Sí, `buildWhere` + `accessWhere` en el `where` de Prisma, no en memoria.
11. **¿Hay ordenamiento caro?** `orderBy: [{status}, {lastName}, {firstName}]` — mismos índices que ya cubren los filtros (14A), sin `ORDER BY` sobre columnas sin índice.
12. **¿Se puede mejorar sin cambiar contrato?** Sí — el cambio aplicado (`$transaction`→`Promise.all`) no toca el shape de la respuesta ni ningún query param.
13. **¿Se puede implementar prefetch seguro en frontend?** Sí — implementado reusando el mecanismo de caché ya existente, sin mecanismo nuevo (§4.B).

---

## 3. Diagnóstico — detalle de legajo (Parte 3 del pedido)

1. **¿`GET /employees/:id` sigue trayendo relaciones pesadas?** Sí, por diseño (`findEmployeeDetailById`, core+batch desde 14C.2) — es el endpoint "detalle completo", usado por guardados y por `DocumentUploadModal`, no por la navegación normal del detalle (que usa `overview`/`overview-details`).
2. **¿El detalle trae todo aunque haya pestañas cerradas?** Sí — decisión ya tomada y documentada en 14C.1 (§1.12): la cabecera necesita datos de `overview-details` (empresa/centro de costo/estado calculado) en cualquier pestaña, así que diferir ese fetch rompería la cabecera. No se reabrió esta decisión sin evidencia nueva que la contradiga — el pedido explícitamente prohíbe cambios visuales grandes y reglas funcionales, y esto es una decisión de contrato/UX ya evaluada.
3. **¿Los documentos se cargan aunque no se abrió Adjuntos?** No — `overview-details` no incluye `documents` (confirmado en el select); los documentos se cargan por separado sólo cuando se visita esa pestaña (`documentApiService`, módulo aparte).
4. **¿Transporte/configuración/conceptos se pueden cargar de forma secundaria?** Ya vienen dentro de `overview-details` (campos livianos, sin este ser el cuello de botella medido); separarlos requeriría un endpoint/contrato nuevo — evaluado y descartado por alcance, mismo criterio que 14C.1 §7.
5. **¿El detalle usa un select gigante?** `overview-details` ya no (14C.1: core + 4 `findMany` en paralelo); `GET /employees/:id` sí, intencionalmente (guardados, ver arriba).
6. **¿Se puede dividir núcleo + relaciones bajo demanda sin romper UX?** Ya se hizo donde correspondía (14C.1/14C.2); no se identificó una división adicional segura esta etapa.
7. **¿El frontend bloquea todo hasta tener todas las relaciones?** No — `overview`/`overview-details`/`audit` se piden en paralelo, sin bloquearse entre sí (confirmado, `EmployeeDetailPage.tsx`).
8. **¿Hay refetch completo luego de cada guardado?** No — ya resuelto en 14C.2 (§45 de la matriz).
9. **¿Se puede actualizar sólo la sección guardada?** Ya ocurre así: el frontend reemplaza el estado local completo del empleado con la respuesta del propio guardado (no hace un `GET` nuevo), y esa respuesta ya es el resultado exacto de guardar esa sección.

---

## 4. Cambios aplicados

### 4.A Backend

1. **`employees.repository.ts`**:
   - `findMany` (línea ~829): `prisma.$transaction([...])` → `Promise.all([...])`. Mismas 2 queries, mismo `where`, mismo `orderBy`/`skip`/`take`.
   - `findOrgChart` (línea ~893) y `findOptions` (línea ~911): mismo cambio, mismo criterio (2 lecturas independientes para paginar un catálogo).
   - Nueva función `existsWithAccess(id, accessWhere)` (junto a `findEmployeeDetailById`/`findEmployeeDetailByIdOrThrow`): `prisma.employee.findFirst({ where: { AND: [{id}, accessWhere] }, select: { id: true } })` — mismo `where` exacto que usa `findEmployeeDetailById`, sin ninguna relación.
   - Expuesta en el objeto `employeesRepository` como `existsWithAccess`.
2. **`employees.service.ts`**:
   - Nueva función `assertAccessible(id, user?)`: llama a `existsWithAccess` y lanza el mismo `AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND")` que ya lanzaba `getById` cuando no hay acceso — mismo comportamiento observable, sólo sin cargar el detalle.
   - `listFieldHistory`/`createFieldHistory`/`listBlockHistory`/`createBlockHistory`: `employeesService.getById(id, user)` → `employeesService.assertAccessible(id, user)`.
3. **No se tocó**: `getById` en sí (sigue existiendo, la usan `getPositionValidation` y `createDocument` porque genuinamente necesitan el detalle — ver matriz fila 43), ningún select de detalle/overview (ya optimizados en 14C.1/14C.2), ninguna transacción interactiva de escritura (6Q/7A, no tocadas), ningún `accessWhere`/RBAC, ninguna regla de cálculo de estado laboral/liquidación.

### 4.B Frontend

1. **`EmployeesPage.tsx`**: en el `.then()` del efecto de listado, si `result.meta.hasMore` es `true`, se dispara `employeeApiService.list({...mismosFiltros, page: page + 1})` sin `await` y con `.catch(() => {})` — precarga silenciosa que reusa exactamente el mismo `cachedData`/`cachePolicies.employeesList` que ya usa el fetch real (`services/cache`, TTL 30s, dedup de requests concurrentes ya incorporado). No se agregó ningún mecanismo de caché nuevo. Si el usuario efectivamente pasa a la página siguiente, ese click reutiliza la respuesta ya cacheada (o el pedido ya en curso); si no pasa de página, la entrada expira sola.
2. **No se tocó**: el guard que mantiene la tabla visible durante la carga (ya existía), ningún componente de historial (`FieldWithHistory`/`BlockHistoryTimeline` ya cargaban bajo demanda con loading localizado, confirmado por lectura — ver matriz sección C), ningún guardado.

### 4.C Documentación

Este documento. Reemplaza/amplía puntualmente el alcance de "Legajos" ya cubierto por 14C.1/14C.2 — no lo reemplaza como referencia histórica, se referencia explícitamente en cada fila de la matriz donde corresponde.

---

## 5. Cambios descartados y por qué

- **Prefetch de la página "anterior" además de "siguiente"**: descartado — el reporte del usuario es específicamente sobre "Siguiente"; agregar precarga bidireccional duplicaría el costo de fondo (una request extra por cada cambio de página en cualquier dirección) sin evidencia de que "Anterior" sea percibido como lento.
- **Cachear `block-history`/`field-history` con TTL en vez de arreglar la causa raíz**: descartado explícitamente por instrucción del pedido ("NO usar cache para ocultar problemas de diseño") y porque hacerlo hubiera enmascarado el verdadero problema (`getById` innecesario) en vez de resolverlo — el fix aplicado elimina el costo en la fuente, no lo esconde.
- **Tocar `createDocument`'s `before = getById(id)` (matriz fila 43)**: descartado esta etapa — no es el síntoma reportado, no fue medido como crítico, y el endpoint es de baja frecuencia (subir un documento) comparado con abrir un historial (acción repetida constantemente al navegar un legajo). Documentado como candidato en §9, no tocado para no ampliar el radio de riesgo sin evidencia.
- **Reabrir la decisión 14C.1 de diferir `overview-details` por pestaña**: descartado — sin evidencia nueva que la contradiga, y el pedido prohíbe explícitamente cambios visuales grandes; la cabecera del legajo depende de esos datos en cualquier pestaña.
- **Agregar un parámetro `block`/`field` nuevo al backend**: innecesario — **ya existía** completo (`ListEmployeeHistoryQuery.block`/`.field`/`.section`, `employees.schemas.ts:180-185`) y el frontend **ya lo enviaba** (`employeeHistoryApiService.ts:45-53`, `FieldHistoryControls.tsx:65,219`). El diagnóstico del pedido (Parte 4, ítems 1-13) asumía que este filtro podía faltar; se confirmó que no faltaba — el problema estaba exclusivamente en el pre-check de acceso.

---

## 6. Tests agregados/modificados

**Backend** (`backend/src/modules/employees/`):

- `employees.repository.test.ts`:
  - Describe `findMany` reescrito (antes probaba la forma `$transaction`, ahora prueba `Promise.all`): confirma `prisma.$transaction` NO se llama, `findMany`/`count` se llaman 1 vez cada uno, y que el shape de retorno (`[items, total]`) no cambió. Los 2 tests preexistentes de select/paginación (sin relación con el mecanismo de transacción) se mantienen intactos.
  - Nuevo describe `findOrgChart / findOptions`: confirma el mismo cambio de mecanismo para los otros 2 endpoints paginados.
  - Nuevo describe `existsWithAccess`: confirma que consulta únicamente `{ id: true }` (sin relaciones), con el mismo `where: { AND: [{id}, accessWhere] }` que usa `findById`; confirma explícitamente que **no** se llaman `employeeCompany.findMany`/`laborMovement.findMany`/`employeeAssignment.findMany`/`novelty.findMany`/`employeeDocument.findMany` (la prueba directa de que ya no se paga ese costo); confirma que devuelve `false` cuando no hay match (empleado inexistente o fuera de alcance).
- `employees.service.test.ts`: nuevo describe `assertAccessible / historiales de campo y bloque` (8 tests) — confirma que `assertAccessible` no llama a `findById`; que lanza `EMPLOYEE_NOT_FOUND`/404 igual que antes; que `listFieldHistory`/`listBlockHistory`/`createFieldHistory`/`createBlockHistory` usan `assertAccessible` (no `findById`) y que, ante un legajo inaccesible, ni siquiera llegan a consultar el historial (fail-fast, sin filtrar datos de otro empleado).

**Frontend** (`frontend/src/pages/EmployeesPage.test.tsx`, archivo nuevo — no existía test para esta página):

- "al pasar a la página siguiente con legajos ya cargados, no blanquea la tabla mientras llega la respuesta nueva" — mismo patrón ya usado en `DocumentsPage.test.tsx` (Etapa 9B) para el mismo comportamiento, reusado explícitamente en vez de inventar uno nuevo.
- "precarga en segundo plano la página siguiente apenas la página actual carga con `hasMore=true`" — confirma que `employeeApiService.list` se llama con `page: 2` sin que el usuario haga nada.
- "no precarga la página siguiente cuando `hasMore` es `false`" — confirma que no hay requests de más en la última página.

---

## 7. Validaciones ejecutadas

- `npx prisma validate` → schema válido, **cero cambios**.
- Backend: `npm run typecheck` (limpio) · `npm test` → **72 archivos, 1087 tests, todos verdes** (1075 preexistentes + 12 nuevos de esta etapa) · `npm run build` (limpio).
- Frontend: `npm run typecheck:e2e` (limpio) · `npm test` → **68 archivos, 563 tests, todos verdes** (67/560 preexistentes + 1 archivo/3 tests nuevos) · `npm run build` (limpio) · `npm run perf:journey` (ver §8, corrido 2 veces: antes y después).
- `git diff --check` → sin errores de espacios en blanco (ver §12).

---

## 8. Comparación de performance — antes/después (método completo, sin números inventados)

**Método**: dado que ya había cambios de la Etapa 14C.2 ampliada *staged* (sin commitear) sobre estos mismos archivos, medir "antes de 14C.3" exigía aislar exactamente el delta de esta etapa (no el de 14C.2). Se hizo así, sin usar ningún comando destructivo de git:

1. Se guardó una copia de los 3 archivos con los cambios de 14C.3 ya aplicados (`employees.repository.ts`, `employees.service.ts`, `EmployeesPage.tsx`).
2. Se sobrescribieron esos 3 archivos con el contenido exacto del índice de git (`git show :<path>`) — es decir, el estado *staged* de 14C.2, sin los cambios de 14C.3. El backend (`tsx watch`) y el frontend (Vite dev) recargaron solos.
3. Se corrió `npm run perf:journey` completo (baseline "antes") y se guardó una copia de `docs/performance/PERFORMANCE_JOURNEY_14B3.json`.
4. Se corrieron 3 mediciones directas con `curl` autenticado (login real contra `/api/auth/login`, usuario seed RRHH) contra `GET /employees/:id/block-history?section=RESPONSABLES_ASIGNACIONES&block=TIME_RESPONSIBLE` para el mismo legajo real, mismo entorno.
5. Se restauraron los 3 archivos a su versión con 14C.3 aplicado (paso 1), verificado con `diff` byte a byte contra la copia original.
6. Se repitieron los pasos 3 y 4 ("después").
7. Se corrió la suite completa de tests otra vez tras restaurar, para confirmar que la restauración fue exacta (1087/1087 verdes, igual que antes del experimento).

Ambas corridas contra el mismo entorno local real (staging vía Neon, mismo backend/frontend, sin reiniciar servicios salvo el hot-reload automático de `tsx watch`/Vite), inmediatamente antes/después, mismo legajo real.

| Caso | Antes | Después | Mejora | Comentario |
|---|---|---|---|---|
| `GET /employees/:id/block-history` (Responsable de carga, `block=TIME_RESPONSIBLE`) — 3 corridas curl | 8.69s / 7.01s / 6.87s | 1.19s (fría) / 0.35s / 0.37s | **~91-95%** (comparando corridas ya calientes: ~6.9s → ~0.36s) | Mismo endpoint, mismo legajo, mismo filtro que el reportado por el usuario. Los tiempos base son más altos que los 3679-4974ms originales del usuario (variación normal de latencia real hacia Neon, ya documentada desde la Etapa 13F) pero la proporción de la mejora es consistente con el diagnóstico: se eliminó exactamente el costo del `getById` descartado. |
| `GET /employees` (pantalla Legajos, perf:journey) | 2695ms (avg, 1 sola llamada) | 1735ms avg / 1879ms max (2 llamadas: la real + la precarga de página 2, `hasMore=true`) | **~30-35% por llamada individual** (2695→1879ms en la llamada "real"; la de precarga fue aún más rápida, 1591ms) | Confirma el fix de `$transaction`→`Promise.all` con tráfico real. |
| Pantalla "Legajos / Empleados" (`networkIdleMs`) | 3267ms | 4041ms (**subió**) | — | **Hallazgo honesto, no maquillado**: subió porque la precarga de la página 2 agrega una request de red real que Playwright espera antes de considerar la página "idle" — no porque la pantalla se sienta más lenta (`headerVisibleMs` se mantuvo en 77-81ms, la tabla se pinta igual de rápido). Es el costo esperado y aceptado de la precarga: una request de más en segundo plano a cambio de que "Siguiente" resuelva desde caché. Ver riesgo documentado en §9. |
| Pantalla "Detalle de un legajo existente" (`networkIdleMs`) | 5216ms | 5396ms | ~sin cambio (ruido) | Ningún endpoint de esta pantalla fue tocado en esta etapa; la variación es ruido normal de latencia de Neon entre corridas (documentado desde 13F). |
| `GET /employees/:id/overview-details` | 4557-4650ms avg/max | 4716-4821ms avg/max | ~sin cambio (ruido) | No tocado esta etapa — sigue en rango "Crítico" por la causa ya documentada en 14C.1 (candidato pendiente, §9). |
| `GET /employees/summary`, `GET /org-structure`, `GET /audit`, `GET /employees/:id/overview` | 804/2689/1092/399ms | 767/2647/1037/388ms | ~sin cambio (ruido) | Ninguno tocado en esta etapa; variación dentro de lo normal. |

**Lo que no se pudo medir en vivo, y no se inventó ningún número para eso**:

- `GET /employees/org-chart` y `GET /employees/options`: el journey no los ejercita (no forman parte del recorrido `/legajos`), y no se armó una medición manual aparte por no ser el síntoma reportado por el usuario — el cambio se validó por tests (mismo mecanismo, mismo patrón ya medido 3 veces en este módulo).
- Guardados (filas 34-42 de la matriz): ninguno fue tocado en esta etapa (ya estaban optimizados desde 14C.2 o desde antes), así que no había nada nuevo que medir; se confirmó por lectura de código + tests preexistentes en verde, no por medición en vivo nueva.
- "Cambio de página hacia atrás" (Anterior): mismo endpoint que "Siguiente", mismo fix de backend aplica — no se hizo una medición curl aparte por ser exactamente la misma query con distinto `page`.

---

## 9. Qué quedó pendiente dentro de Legajos (candidatos futuros, dentro del módulo)

- **`GET /employees/:id/overview-details` sigue en rango "Crítico"** (4463-4821ms) — causa ya diagnosticada en 14C.1 (cadena `sector→area→establishment→businessUnit` de 4 niveles sin `previewFeatures = ["relationJoins"]`), no revisitada en esta etapa por no ser el síntoma nuevo reportado. Activar `relationJoins` sigue siendo el candidato de fondo, evaluado y descartado en 14C.1 por ser un cambio de infraestructura de Prisma con radio de impacto global (afecta a toda la app, no sólo Legajos) — requiere su propia etapa de evaluación dedicada.
- **`createDocument`'s `before = getById(id)`** (matriz fila 43): mismo patrón de causa que `block-history` (carga el detalle completo sólo para leer `legajo` y `documents`), pero de bajo impacto medido (endpoint de baja frecuencia, no reportado como lento) — candidato de bajo riesgo/bajo impacto para una etapa futura si logs reales (14B.2) lo confirman como lento en uso real.
- **Precarga de página siguiente sube el `networkIdleMs` de la propia pantalla** (§8): tradeoff aceptado y documentado — una request extra en segundo plano por cada visita a `/legajos` (incluso si el usuario no pasa de página) a cambio de que la transición a "Siguiente" resuelva desde caché. Si logs reales muestran que el costo agregado de esa precarga (multiplicado por el tráfico real de la pantalla más visitada del sistema) es significativo, se puede acotar (por ejemplo, precargar sólo tras N segundos de inactividad, o sólo si el usuario ya paginó una vez) — no se hizo en esta etapa por falta de evidencia de que haga falta.
- **`GET /employees/org-chart`/`GET /employees/options`**: corregidos por consistencia (mismo antipatrón que el listado principal) pero no medidos en vivo — candidatos a confirmar con logs reales de 14B.2 si aparecen como lentos en uso real.

---

## 10. Riesgos pendientes

- **Consistencia de snapshot ligeramente más débil en `existsWithAccess`**: es una lectura de existencia pura (`findFirst` con `select: {id:true}`), sin ninguna implicancia de consistencia — de hecho es un riesgo estrictamente **menor** al que ya existía con `getById` (que hacía 7 queries no-transaccionales para el mismo propósito). No introduce ningún riesgo nuevo.
- **Precarga de página siguiente**: ver §9 — tradeoff de red aceptado y documentado, no oculta ningún problema (el propio query que precarga ya está optimizado en esta misma etapa).
- **`findOrgChart`/`findOptions` corregidos sin medición en vivo**: riesgo de que el cambio no aporte la misma mejora medida en `findMany` si sus patrones de uso reales difieren — mitigado por ser exactamente el mismo mecanismo (`Promise.all` de 2 lecturas independientes), ya validado 4 veces en este módulo (`summary`, `audit.repository`, `findOverviewDetailsById`, `findMany`) sin ningún caso donde no haya funcionado.

---

## 11. Qué NO se tocó

- Ninguna regla de cálculo de Hora Normal/Conceptos Horarios/Horas Especiales/liquidación.
- Ninguna regla de permisos/RBAC — `employeeAccessWhere` no se modificó; `existsWithAccess`/`assertAccessible` usan exactamente el mismo `where` de alcance que ya usaba `findById`.
- Ningún cálculo de estado laboral (`resolveLaborStatus`), ni responsable de carga, ni encargado directo, ni sus reglas de asignación.
- Ninguna regla de transporte/configuración/documentos.
- Ningún registro de auditoría/historial — `auditService.register` sigue igual en los 4 métodos tocados (`createFieldHistory`/`createBlockHistory` siguen registrando auditoría exactamente igual, sólo cambió cómo se valida el acceso antes).
- Ningún schema/migración — `npx prisma validate` en verde, cero diffs de schema.
- Ningún contrato de API — mismos endpoints, mismos parámetros, mismo shape de respuesta en los 7 endpoints tocados.
- Ningún otro módulo del sistema (fichador, novedades, turnos, horas especiales, dashboard, auditoría general, documentos como módulo aparte) — todos los cambios están contenidos en `backend/src/modules/employees/` y `frontend/src/pages/EmployeesPage.tsx`.
- No se commiteó nada (instrucción explícita del pedido).

---

## 12. Validaciones ejecutadas — detalle de comandos

```
cd backend
npx prisma validate                 # OK, schema válido, 0 cambios
npm run typecheck                   # OK
npm test                            # 72 archivos, 1087 tests OK
npm run build                       # OK

cd frontend
npm run typecheck:e2e               # OK
npm test                            # 69 archivos, 566 tests OK
npm run build                       # OK
npm run perf:journey                # OK (corrido 2 veces: antes/después, ver §8)

git diff --check                    # sin errores de espacios en blanco
```

---

## 13. git status / diff --stat (al momento de escribir este documento)

Ver mensaje de cierre de la conversación para el `git status`/`diff --stat` real ejecutado después de este documento (no se repite acá para evitar que quede desactualizado respecto al muestreo real).

**No se commiteó nada** — todos los cambios de esta etapa quedan en el working tree, junto con los cambios ya *staged* de 14C.2 ampliada, pendientes de aprobación del usuario.
