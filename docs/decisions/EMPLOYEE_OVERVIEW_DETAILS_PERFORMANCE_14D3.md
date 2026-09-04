# Etapa 14D.3 — Optimización de overview-details (Legajos)

Fecha: 2026-09-07
Estado: diagnóstico completo, implementado, validado, **pendiente de aprobación para commitear**
Alcance: exclusivamente `GET /employees/:id/overview-details` (`employeesRepository.findOverviewDetailsById`, `employeeOverviewDetailsCoreSelect`). Sin cambios de schema/migraciones, sin cambios de reglas funcionales, sin cambios de permisos/RBAC, sin cambios de contrato de API, sin cambios de frontend (no hicieron falta — ver §6).

---

## 1. Diagnóstico (Parte 1 del pedido, 34 puntos)

### 1.1-1.2 Qué componente llama `overview-details` y cuándo

`EmployeeDetailPage.tsx` — un único `useEffect` (deps `[id, loadRetry]`) que dispara `employeeApiService.getOverviewById` **y** `getOverviewDetailsById` en paralelo, apenas se monta la página del detalle (no condicionado por pestaña activa — decisión ya tomada y documentada en 14C.1 §1.12, no revisitada acá).

### 1.3-1.4 Si se llama 1 o 2 veces en dev (StrictMode) / si se llama más de una vez en producción

**2 veces en dev, 1 vez en producción** — ya diagnosticado y documentado en 14C.1 §4.B/14A: React 18 `StrictMode` (activo sólo en `npm run dev`/tests, `frontend/src/main.tsx`) monta-desmonta-remonta cada componente una vez al desarrollar, duplicando cualquier `useEffect` de solo-montaje. Confirmado que NO ocurre en el build de producción (`StrictMode` no tiene efecto en producción). No se tocó — mismo criterio ya aceptado 2 veces antes en este proyecto (14A, 14C.1).

### 1.5-1.14 Qué datos consume cada pestaña (relevado leyendo cada componente, no supuesto)

| Pestaña | Datos de `overview-details` que usa | Evidencia |
|---|---|---|
| Cabecera (todas las pestañas) | `company` (derivado de `companies`), `costCenter`, `laborMovements` (estado calculado) | `EmployeeDetailPage.tsx` — hero: `[cuil, company, costCenter].join(...)`, `calculateEmployeeStatus` usa `laborMovements` |
| 0. Información General | ninguno de `overview-details` (sólo escalares de `overview`, ya liviano) | `EmployeeDetailPage.tsx` tab 0 |
| 1. Contacto y Domicilio | `address` | `AddressEditBlock` (`EmployeeDetailBlocks.tsx`) |
| 2. Datos Laborales | `sector` (business unit/establishment/sector flatten), `position` (`.id`/`.name`), `companies`, `internalCategory` | `DerivedLaborField`, `FieldWithHistory field="sector"`, `MultiCompanyField`, `EmployeePositionField`, `SalaryRangeValidationCard` |
| 3. Responsables/Asignaciones | `assignments` (→ `directManager(s)`/`timeResponsible(s)`) | `AssignmentBlock` (`EmployeeDetailBlocks.tsx`) |
| 4. Transporte | `transport` | `TransportBlock` |
| 5. Configuración Horaria | `hourConcepts` (→ `enabledHourConcepts`) | `HoursSpecialBlock` |
| 6. Ausentismo/Novedades | ninguno — `EmployeeNoveltiesPanel` fetchea su propia data | confirmado, fuera de alcance de Legajos de todas formas |
| 7. Gestión Documental | ninguno — `EmployeeDocumentsPanel` fetchea `GET /documents?employeeId=` | confirmado |
| 8/10. Historial de Eventos/Auditoría | ninguno — `GET /audit`, endpoint aparte | confirmado |
| 9. Turnos | ninguno — `EmployeeShiftsPanel` sólo usa `employee.id` (de `overview`, ya cargado) para llamar `shiftAssignmentApiService`/`workforceApiService` | confirmado con grep del componente completo |
| 11. Régimen Laboral | ninguno — `EmployeeWorkRegimePanel` sólo usa `employee.id` para `workRegimeApiService` | confirmado |

**Conclusión clave**: `documents`/`novelties`/`audit`/datos de Turnos/Régimen **nunca estuvieron en `overview-details`** (esos endpoints ya son y siempre fueron independientes) — no hay nada "de más" en ese sentido para sacar.

### 1.15-1.16 Qué trae `overview-details` actualmente / qué relaciones de más

Antes de esta etapa: escalares de `overview` + `address` + `transport` + `sector` (con cadena de 4 niveles `area→establishment→businessUnit`) + `costCenter` + `position` (**registro Position COMPLETO** — todos sus escalares, incluidos `mission`/`description`/`responsibilities`/`internalRelations`/`externalRelations`/`competencies`/`workConditions`/`performanceIndicators`/`evaluationCriteria`, varios de texto/JSON potencialmente largos) + `companies`/`laborMovements`/`assignments`/`hourConcepts` (ya en `Promise.all` separado desde 14C.1).

**Hallazgo nuevo de esta etapa**: `position: true` traía el registro completo de Position, pero `mapEmployeeFromApi` (`employeeApiService.ts`) **sólo lee `.id` y `.name`** — confirmado leyendo el mapper completo (4 usos, ambos sólo esos 2 campos). Todo lo demás del Position (9+ campos, algunos JSON/texto largo) viajaba por la red y nunca se usaba en Legajos.

### 1.17-1.21 Qué se puede diferir por pestaña / bajo demanda / qué ya se pide aparte / qué duplica / qué hace falta por compatibilidad

- `companies`/`laborMovements`/`assignments`/`hourConcepts`: **evaluado explícitamente y descartado diferirlos por pestaña** — ver razonamiento en §2 (no reducirían el tiempo real, sólo la cuenta de queries).
- `documents`/`novelties`/`audit`/Turnos/Régimen: ya se piden aparte, siempre (§1.5-1.14) — no hay nada que diferir, no están en este endpoint.
- `position` completo: no se puede "diferir" (es una relación to-one simple, no una lista) — se **recortó** en vez de diferirse (§1.15-1.16).
- `sector` con su cadena: necesaria para pintar Datos Laborales apenas se abre esa pestaña (sin fetch propio hoy) — no se puede eliminar sin refactor de frontend; se **reestructuró** (movida a consulta paralela, §4) en vez de eliminada o diferida.

### 1.22-1.26 Queries Prisma / round-trips / secuenciales / cadenas profundas / select amplio

Antes de esta etapa: 1 `findFirst` (núcleo: ~8 relaciones/niveles — `address`, `transport`, `sector`+`area`+`establishment`+`businessUnit` [4 niveles], `costCenter`, `position` completo) + 1 `Promise.all` de 4 `findMany` (companies/laborMovements/assignments/hourConcepts). Sin `previewFeatures=["relationJoins"]` (confirmado, no activado — mismo estado que 14C.1/14C.3), cada nivel del núcleo se resuelve como un round-trip separado y **secuencial** dentro del mismo `findFirst` — la cadena `sector→area→establishment→businessUnit` (4 niveles) es la más profunda y la causa principal de que el núcleo por sí solo tomara la mayor parte del tiempo total medido (4499-4875ms en 14D.1/14D.2).

### 1.27 Datos pesados como documents/novelties/audit que no hacen falta al abrir

Confirmado: **ninguno de los tres está en `overview-details`** (§1.15) — nada que sacar ahí.

### 1.28-1.29 Select por pestaña / partir en overview inicial + detalles lazy

Evaluado (Opción C del pedido) y **descartado** por el mismo motivo que 14C.1 ya documentó para la cabecera: `company`/`costCenter`/`laborMovements` (cabecera, visible en TODAS las pestañas) y `sector`/`position` (Datos Laborales, pestaña 2) vienen del mismo `findFirst` — partir el núcleo por pestaña exigiría un endpoint nuevo o cambiar cuándo se dispara cada fetch (afecta directamente cuándo aparece la cabecera con datos reales) — un refactor de contrato/UX más grande que el pedido explícitamente pide evitar ("no hacer esto si implica refactor grande sin necesidad"), y sin el beneficio de tiempo que sí tiene mover la cadena de sector a paralelo (§4).

### 1.30-1.31 Cache frontend / backend

**Ninguna de las dos se agregó.** Evaluadas y descartadas: agregar caché (frontend o backend) sobre un endpoint que abre datos operativos de un legajo específico (visitado una vez por sesión de revisión, no repetidamente como position-validation) no resolvería el problema real — el pedido explícitamente lo señala ("no usar cache para esconder endpoint mal diseñado"). El endpoint se optimiza en su fuente (§4), no se enmascara.

### 1.32-1.34 Invalidaciones existentes / riesgo de dato viejo / riesgo de romper guardados

No aplica — no se agregó ninguna caché nueva sobre este endpoint, así que no hay invalidación que revisar ni riesgo de dato viejo que introducir. Los guardados existentes (`invalidateEmployeeDependentCaches`, ya usado por todos los flujos de Legajos) siguen sin tocarse.

---

## 2. Opciones consideradas y opción elegida

**Elegidas: A (reducir select) + B (paralelizar mejor) — descartadas C, D, E explícitamente.**

- **Opción A (reducir select)**: `position: true` → `position: { select: { id, name } }`. Único recorte de campos de esta etapa — evidencia directa de que nada más se pierde (§1.16).
- **Opción B (paralelizar mejor)**: la cadena `sector→area→establishment→businessUnit` (la pieza más cara del núcleo) se sacó del `findFirst` secuencial y se resuelve como una consulta de nivel superior aparte (`prisma.sector.findUnique`), **en el mismo `Promise.all`** que ya usan `companies`/`laborMovements`/`assignments`/`hourConcepts` — mismo patrón ya validado 4+ veces en este módulo (14C.1, 14C.3, 14D.2.1).
- **Opción C (dividir por pestaña)**: descartada (§1.28-1.29) — refactor de contrato/UX más grande de lo necesario, sin garantía de mejor impacto que B.
- **Opción D/E (caché frontend/backend)**: descartadas (§1.30-1.31) — enmascararía el problema real en vez de resolverlo.
- **Opción F (reusar datos ya cargados)**: evaluada para `businessUnit`/`establishment` (¿podría el frontend derivarlos del catálogo `org-structure` ya cacheado, en vez de que el backend arme la cadena?) y **descartada por alcance**: `mapEmployeeFromApi` es una función pura compartida por TODAS las pantallas que consumen `Employee` (lista, alta, horas, etc.), no sólo el detalle — darle acceso a un catálogo externo cambiaría su firma en un radio de impacto mucho mayor al de esta etapa, por una ganancia no garantizada (sigue haciendo falta resolver la cadena en algún lado). Documentado como candidato futuro (§9), no implementado.

**Por qué no diferir `companies`/`laborMovements`/`assignments`/`hourConcepts` por pestaña** (razonamiento explícito, ítems 1.17/1.28 del pedido): estas 4 ya corren en un único `Promise.all` desde 14C.1 — su tiempo total está determinado por la MÁS LENTA de las 4, no por la CANTIDAD. Sacar 2 de las 4 (por ejemplo `assignments`/`hourConcepts`, usadas sólo en pestañas 3/5) del `Promise.all` **no reduciría el tiempo de pared** de esa ventana paralela (seguiría dominada por la más lenta de las que queden) — sólo reduciría el número de queries totales contra la base, sin beneficio medible en la latencia percibida por el usuario al abrir el legajo. Diferirlas SÍ tendría sentido si alguna fuera desproporcionadamente más lenta que las demás — no se encontró evidencia de eso en los journeys reales (14D.1/14D.2), así que no se hizo.

---

## 3. Shape de respuesta — tabla completa

| Campo/relación | Usado por componente | Pestaña | Necesario al abrir detalle | Puede ser lazy | Acción tomada |
|---|---|---|---|---|---|
| `companies` | `EmployeeDetailPage.tsx` (hero: `company`), `MultiCompanyField` | Cabecera + 2 | Sí (cabecera, siempre visible) | No | Sin cambios — ya en `Promise.all` |
| `laborMovements` | `EmployeeDetailPage.tsx` (hero: estado laboral calculado) | Cabecera | Sí (cálculo de estado, regla de negocio protegida) | No | Sin cambios — ya en `Promise.all` |
| `assignments` | `AssignmentBlock` | 3 | Sólo si se abre la pestaña 3, pero diferirlo no ahorra tiempo de pared (§2) | Técnicamente sí, sin beneficio medible | Sin cambios — ya en `Promise.all` |
| `hourConcepts` | `HoursSpecialBlock` | 5 | Igual que `assignments` | Técnicamente sí, sin beneficio medible | Sin cambios — ya en `Promise.all` |
| `novelties` | — | — | No — no está en `overview-details` | N/A | N/A (nunca estuvo acá) |
| `documents` | — | — | No — no está en `overview-details` | N/A | N/A (nunca estuvo acá) |
| `address` | `AddressEditBlock` | 1 | Sí (relación to-one simple, sin cadena profunda) | Bajo impacto de diferir (no es la causa de lentitud) | Sin cambios |
| `transport` | `TransportBlock` | 4 | Sí (igual que `address`) | Bajo impacto de diferir | Sin cambios |
| `costCenter` | `EmployeeDetailPage.tsx` (hero) | Cabecera | Sí | No | Sin cambios (ya liviano, 3 escalares) |
| `sector` (cadena `area→establishment→businessUnit`) | `DerivedLaborField`, `FieldWithHistory`, `SalaryRangeValidationCard` | 2 | Sí (cabecera NO lo usa directamente, pero pestaña 2 sí y sin fetch propio) | No sin refactor de frontend (§1.28) | **Movida a consulta paralela** (Opción B) — mismo shape final, menos tiempo secuencial |
| `position` (registro completo → recortado) | `EmployeePositionField` (`.name`/`.id` solamente, vía `mapEmployeeFromApi`) | 2 | Sí, pero sólo 2 campos | N/A (ya liviano tras el recorte) | **Recortada a `{id, name}`** (Opción A) |
| `audit`/`historyEvents` | `SectionChangeHistory`, tab Historial de Eventos | 0/1/8/10 | No — viene de `GET /audit`, endpoint aparte | N/A | N/A (nunca estuvo acá) |
| `enabledHours` (derivado de `hourConcepts`) | `HoursSpecialBlock` (resumen) | 5 | Igual que `hourConcepts` | Igual que `hourConcepts` | Sin cambios |
| `workRegimes` | `EmployeeWorkRegimePanel` | 11 | No — fetch propio (`workRegimeApiService`) | N/A | N/A (nunca estuvo acá) |
| Asignaciones de turno | `EmployeeShiftsPanel` | 9 | No — fetch propio (`shiftAssignmentApiService`) | N/A | N/A (nunca estuvo acá) |

---

## 4. Cambios backend

Archivo: `backend/src/modules/employees/employees.repository.ts`.

1. **`employeeOverviewDetailsCoreSelect`**: `position: true` → `position: { select: { id: true, name: true } }`. `sector: {...cadena...}` → eliminado del núcleo; se agrega `sectorId: true` (escalar, sin costo extra — viaja con la fila del empleado).
2. **Nuevo `overviewSectorChainSelect`**: el mismo select de la cadena `sector→area→establishment→businessUnit` que antes vivía anidado en el núcleo, ahora reusado por una consulta de nivel superior aparte.
3. **`findOverviewDetailsById`**: el `Promise.all` que ya resolvía `companies`/`laborMovements`/`assignments`/`hourConcepts` ahora incluye una 5ta consulta, `prisma.sector.findUnique({ where: { id: sectorId }, select: overviewSectorChainSelect })`, condicionada a que `sectorId` no sea null (si el empleado no tiene sector, no se dispara ninguna consulta de más). El resultado final se ensambla con `sector` como una clave más — **mismo shape exacto que antes** (el mismo objeto anidado `{id, name, code, area: {...}}` o `null`). `sectorId` (el escalar interno usado sólo para saber qué pedir) se descarta explícitamente antes de devolver el resultado — nunca queda expuesto en la respuesta.
4. **No se tocó**: `employeeOverviewCoreSelect` (usado por `GET /employees/:id/overview`, ya liviano, fuera de alcance), `employeeDetailCoreSelect`/`findEmployeeDetailById` (usado por `GET /employees/:id`, un endpoint DISTINTO, fuera del alcance exclusivo de esta etapa), `attachEmployeeDetailRelations` (pertenece al otro endpoint, no a `overview-details`), ninguna regla de negocio, ningún `accessWhere`.

---

## 5. Cambios frontend

**Ninguno.** El shape de la respuesta de `overview-details` es idéntico al de antes de esta etapa — `mapEmployeeFromApi` y todos los componentes consumidores siguen recibiendo exactamente los mismos campos con la misma forma. No hizo falta evitar un doble-fetch (ya no lo había fuera de StrictMode, §1.3-1.4), no hizo falta lazy por pestaña (descartado, §2), no hizo falta ningún ajuste de caché (no se agregó ninguna). Confirmado con la suite completa de tests de frontend en verde sin ningún cambio de código de UI.

---

## 6. Cambios al journey

Ninguno — el journey ya mide `GET /employees/:id/overview-details` como parte de la acción "Abrir primer legajo disponible" desde 14D.1, y esa medición sigue siendo válida y suficiente para esta etapa (mismo endpoint, mismo contrato, mismo punto de captura).

---

## 7. Riesgos

- **Consistencia de snapshot ligeramente más débil para `sector`**: antes, `sector` se leía dentro del mismo `findFirst` que el resto del núcleo; ahora es una consulta aparte, milisegundos después. Mismo criterio de riesgo ya aceptado y documentado en 14C.1/14C.2/14C.3 para el mismo tipo de split (es una lectura para mostrar el detalle, no una operación de negocio que dependa de esa atomicidad exacta).
- **`position` recortado a `{id, name}`**: si en el futuro algún componente de Legajos empieza a necesitar otro campo de Position desde `overview-details` (por ejemplo `code` o `status`), habrá que ampliar el select — documentado acá explícitamente para que quede claro por qué se recortó y qué se dejó afuera a propósito.
- **`companies`/`laborMovements`/`assignments`/`hourConcepts` sin diferir**: si en el futuro alguna de esas 4 se vuelve desproporcionadamente lenta (por volumen de datos, por ejemplo un legajo con cientos de movimientos laborales), sí valdría la pena reconsiderar diferirla — no es el caso hoy, según los journeys reales medidos.

## 8. Validación — antes/después con números reales

Medido corriendo `npm run perf:journey:employees` antes y después de aplicar los cambios (mismo entorno local, staging real vía Neon), comparado contra el reporte guardado de la Etapa 14D.2.1.

| Caso | Antes (14D.2.1) | Después (14D.3) | Mejora | Comentario |
|---|---|---|---|---|
| `GET .../overview-details` (2 llamadas, StrictMode) | 4499ms / 4875ms | **3517ms / 3519ms** | **~22-28%** | Real, medida, sin datos inventados. **No alcanza ninguna de las 2 metas** (ideal <1500ms, aceptable <2000ms) — ver causa exacta abajo. |
| Cantidad de llamadas a `overview-details` en el recorrido | 2 (StrictMode, dev) | 2 (sin cambios) | — | Mismo comportamiento ya diagnosticado como no-problema (§1.3-1.4) — no se tocó. |
| `overview-details` en Top 10 requests más lentas | 1er/2do lugar | 3er/4to lugar (detrás de `dashboard/metrics` y `/positions`, ninguno de Legajos) | Mejora relativa real | Ya no es el cuello de botella dominante de Legajos. |
| Acciones en rango "Lento" (2000-3000ms) del recorrido completo | 2 | **0** | — | `slowActions` bajó de 2 a 0 en el resumen del reporte. |
| Acciones en rango "Crítico" (>3000ms) | 3 | 3 (sin cambios — `overview-details` sigue ahí, sólo con un número menor) | — | Honesto: sigue en el rango más alto, no se "resolvió" del todo. |
| `Abrir primer legajo disponible` — tiempo visible / network idle | visible 840ms / idle 5455ms (14D.2) | visible 836ms / idle 4093ms | idle ~25% mejor | `visibleMs` prácticamente sin cambio (la cabecera ya pintaba rápido, mismo hallazgo de 14C.1 — lo lento siempre fue red/DB, no render). |
| `GET .../field-history` — cantidad total | 8 | 8 | Sin cambios | Confirma que el fix de 14D.2 sigue intacto. |
| `GET .../position-validation` — cantidad de llamadas | 1 | 1 | Sin cambios | Confirma que la caché de sesión de 14D.2.1 sigue intacta. |
| Alguna pestaña sin datos | No | No | — | 56/56 acciones cubiertas, 0 salteadas — todas las pestañas siguieron pintando con datos completos. |
| Alguna pestaña con carga lazy nueva medida | No aplica — no se agregó ninguna carga lazy nueva esta etapa (Opción C descartada) | — | — | — |
| Errores HTTP / consola | 0 / 0 | 0 / 0 | Sin cambios | Confirmado. |
| Sanitización de rutas/UUIDs en el reporte | Sin UUIDs | Sin UUIDs | Sin cambios | Verificado con `grep`. |

### Causa exacta de no alcanzar la meta, y próximo paso

Los ~3517-3519ms restantes se explican por 2 "olas" que siguen siendo mayormente secuenciales entre sí (aunque cada una ya está internamente paralelizada donde se pudo):
1. **Núcleo** (`findFirst`): escalares + `address` + `transport` + `costCenter` + `position` (ya recortado a 2 campos) — sigue siendo ~4-5 relaciones/niveles resueltos en serie dentro de un único `findFirst`, sin `relationJoins`.
2. **Lote paralelo** (`Promise.all` de 5): dominado por la consulta de la cadena de sector (`sector→area→establishment→businessUnit`, 3-4 niveles), que sigue pagando sus propios round-trips secuenciales DENTRO de esa única consulta (aunque ahora corre solapada con las otras 4, no después de ellas).

**Próximo paso, si se decide seguir invirtiendo en este endpoint**: activar `previewFeatures=["relationJoins"]` de Prisma (candidato ya señalado 4 veces: 14C.1, 14C.3, 14D.2.1, acá) colapsaría cada cadena en un único `JOIN` SQL, eliminando el resto de los round-trips secuenciales de una — pero es un cambio de infraestructura con radio de impacto global (afecta cualquier query con relaciones anidadas en TODO el backend, no sólo Legajos), que requiere su propia etapa de evaluación dedicada, medida en varios módulos antes de decidir activarlo. Fuera de alcance de una etapa quirúrgica de un solo endpoint.

## 9. Qué quedó pendiente

- `relationJoins` de Prisma sigue siendo el único camino para bajar de forma confiable por debajo de ~2000ms en endpoints con relaciones anidadas profundas — candidato ya señalado 4 veces (14C.1, 14C.3, 14D.2.1, acá), sigue fuera de alcance de una etapa quirúrgica de un solo endpoint.
- Derivar `businessUnit`/`establishment` en el frontend desde el catálogo `org-structure` ya cacheado (en vez de que el backend arme la cadena) — evaluado (Opción F) y descartado por el radio de impacto de tocar `mapEmployeeFromApi` (§2), documentado como candidato si una etapa futura decide invertir en ese refactor más grande.
