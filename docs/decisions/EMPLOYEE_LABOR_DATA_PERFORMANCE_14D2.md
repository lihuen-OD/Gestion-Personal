# Etapa 14D.2 — Optimización de Datos Laborales (Legajos)

Fecha: 2026-09-04
Estado: diagnóstico completo, implementado, validado, **pendiente de aprobación para commitear**
Alcance: exclusivamente `Legajos > Datos Laborales` — backend (`backend/src/modules/employees/`) y frontend (`frontend/src/components/employees/FieldHistoryControls.tsx`, `LaborTrackedFields.tsx`) más el journey de medición (`frontend/e2e/employeesPerformanceJourney.spec.ts`). Construye directamente sobre los hallazgos de la Etapa 14D.1 (`docs/performance/EMPLOYEES_PERFORMANCE_JOURNEY_14D1.md/.json`, ya commiteados). Sin cambios de schema/migraciones, sin cambios de reglas funcionales, sin cambios de permisos/RBAC, sin pérdida de historial ni auditoría, sin cambio de contrato de API.

---

## 1. Diagnóstico — `GET /employees/:id/position-validation`

### 1.1 Qué componente monta la pestaña Datos Laborales

`renderEmployeeTab(tab === 2, ...)` en `EmployeeDetailPage.tsx` — renderiza, entre otros: `LaborStatusCard`, `LaborMovementPanel`, `MultiCompanyField`, dos `DerivedLaborField` (Unidad de negocio, Establecimiento), 6 `FieldWithHistory` (Centro de costo, Sector, Categoría de recibo, Categoría interna, Convenio, Obra Social), `EmployeePositionField` y **`SalaryRangeValidationCard`**.

### 1.2 Qué componente dispara `position-validation`

`SalaryRangeValidationCard` (`EmployeeLaborFields.tsx:148-270`), usado sin props extra: `<SalaryRangeValidationCard employee={employee} />` (`EmployeeDetailPage.tsx:362`) — `useBackendValidation` no se pasa, así que usa su default `true`. Dispara `employeeApiService.getPositionValidation(employee.id)` en un `useEffect` (línea 222-249) con deps `[useBackendValidation, employee.id, employee.positionId, employee.internalCategory, employee.businessUnit, employee.establishment, employee.sector]` — se dispara al montar y cada vez que alguno de esos campos cambia (no en cada render).

### 1.3 Para qué se usa

Compara la estructura organizacional real del empleado (unidad de negocio/establecimiento/sector, vía la cadena `sector→area→establishment→businessUnit`) contra la del puesto asignado (misma cadena, vía `position.sector`), y la categoría interna del empleado contra el rango salarial del puesto (`PositionSalaryCategory`). Devuelve `tone`/`title`/`categoryText`/`checks`/`category` — se pinta como una card de semáforo (verde/amarillo/rojo) debajo de "Puesto / Categoría".

**Hallazgo importante, no documentado antes de esta etapa**: `SalaryRangeValidationCard` YA TENÍA una validación local de respaldo (`localValidation`, líneas 156-204) calculada con datos que el frontend ya tiene (`employee.businessUnit/establishment/sector/internalCategory` de `overview-details`, más `position.derivedBusinessUnitName/derivedEstablishmentName/derivedSectorName` de `GET /positions`, ya liviano) — y `const validation = backendValidation || localValidation` usa la local mientras la del backend no responde. Es decir: **el render nunca estuvo bloqueado por `position-validation`** — el problema medido en 14D.1 es puramente de costo de red/DB de fondo, no de UX bloqueada. Confirmado con test nuevo (`EmployeeLaborFields.test.tsx`).

### 1.4 Endpoint/backend que resuelve la petición

`GET /employees/:id/position-validation` → `employeesController.getPositionValidation` (`employees.controller.ts:170-173`) → `employeesService.getPositionValidation(id, user)` (`employees.service.ts`, antes de esta etapa: línea 581).

### 1.5-1.8 Queries Prisma / por qué tarda 10-12s / legajo completo / relaciones pesadas

Antes de esta etapa: `getPositionValidation` llamaba `employeesService.getById(id, user)` → `employeesRepository.findById` → `findEmployeeDetailById` (Etapa 14C.2/14C.3): 1 `findFirst` con el núcleo del legajo (escalares + `address`/`transport`/`sector` con cadena de 4 niveles/`costCenter`/`position` con su propia cadena de 4 niveles + `salaryCategories`) **más** `attachEmployeeDetailRelations` (6 `findMany` en paralelo: `companies`/`laborMovements`/`assignments`/`hourConcepts`/`novelties`/`documents`). De todo eso, `getPositionValidation` **sólo lee 3 cosas** (confirmado leyendo la función completa): `employee.internalCategory` (escalar), `employee.sector` (cadena) y `employee.position` (su cadena + `salaryCategories`). Las 6 relaciones batch y `address`/`transport`/`costCenter` del núcleo se descartaban sin usar — exactamente el mismo patrón de causa ya diagnosticado y corregido para `block-history`/`field-history` en la Etapa 14C.3, nunca aplicado acá porque en ese momento se lo evaluó como "uso legítimo del detalle completo" sin medir el costo real (14C.3 §1, "Qué NO se tocó" — evaluado, no medido).

### 1.9 Si puede usar select liviano

Sí — implementado (§2).

### 1.10 Si puede reutilizar datos ya cargados en `overview-details`

Parcialmente, y ya lo hacía del lado del **frontend** (la validación local, §1.3) — pero `overview-details` no incluye `position.sector`/`position.salaryCategories` (esos campos vienen de `GET /positions`, un catálogo aparte), así que el backend igual necesita su propia consulta para tener la cadena del PUESTO, no sólo la del empleado. No se encontró una forma segura de eliminar la consulta al backend sin arriesgar que la validación "oficial" (fuente de verdad del backend) diverja silenciosamente de la local (que es, explícitamente, un cálculo "de respaldo" — ver comentario en el propio código: `salaryRangeMockService`). Se descartó eliminar el fetch del backend por esta razón (§5).

### 1.11 Si puede calcular la validación en frontend con datos ya disponibles

Ya existe como fallback (§1.3), pero no se promovió a única fuente porque el pedido prohíbe explícitamente "cambiar el significado de la validación" — la local es una aproximación de respaldo documentada como tal en el propio código (`salaryRangeMockService`), no la fuente de verdad. Mantener el backend como fuente autoritativa, sólo que mucho más liviano, es el cambio de menor riesgo.

### 1.12-1.13 Si bloquea el render / si el usuario necesita la validación inmediatamente

No bloquea el render (§1.3, ya confirmado con test). El usuario ve una validación (la local) inmediatamente; la validación "oficial" del backend la reemplaza en cuanto llega, sin parpadeo de loading intermedio (no hay indicador visual de "cargando validación oficial", por diseño ya existente — no se tocó).

### 1.14-1.15 Riesgos de mover a lazy/deferred

No se difirió el disparo del fetch (sigue en el `useEffect` de montaje) porque ya no bloquea nada — diferirlo más allá no aportaría UX, sólo retrasaría cuándo el usuario ve la validación "oficial" reemplazar a la local, sin beneficio medible. El riesgo real no estaba en el timing del fetch sino en su costo — resuelto con el select liviano (§2).

---

## 2. Diagnóstico — `field-history` eager en Datos Laborales

### 2.1 Qué componente dispara los 8 `GET /field-history`

Dos mecanismos distintos, ambos con el mismo problema:
- **`FieldWithHistory`** (`FieldHistoryControls.tsx`) — usado 6 veces en Datos Laborales: `costCenter`, `sector`, `receiptCategory`, `internalCategory`, `agreement`, `healthInsurance` (`EmployeeDetailPage.tsx:353-364`).
- **`useBackendFieldHistory`** (hook interno de `LaborTrackedFields.tsx`) — usado por `MultiCompanyField` (`field="companies"`) y `EmployeePositionField` (`field="positionId"`).

Total: 6 + 2 = **8 campos trackeados**, cada uno con su propio `useEffect` disparando `employeeHistoryApiService.getFieldHistory`.

### 2.2 Por qué se disparaban automáticamente

Confirmado leyendo ambos componentes: el `useEffect` que llama a `getFieldHistory` **no dependía de `open`** (el estado que controla si el panel de historial está visible) — dependía sólo de `[employee.id, section, field, historyRetry]` (o `[employeeId, field, retry]` en el hook). Como esos componentes están SIEMPRE montados en el tab (no son condicionales), el efecto corría apenas la pestaña se pintaba, sin que el usuario tocara nada.

### 2.3 Qué campos disparan historial

Los 8 listados en §2.1. **Unidad de negocio** y **Establecimiento** (`DerivedLaborField`) NO tienen historial — son campos derivados de sólo lectura, confirmado en el código (sin `useEffect`, sin botón "Historial"). "Jornada/turno" no existe como campo de Datos Laborales (pertenece a la pestaña "Turnos", módulo Shifts, fuera de alcance).

### 2.4 Si se cargan por cada `FieldWithHistory` al montarse

Sí, confirmado (§2.2) — 6 de los 8.

### 2.5 Si esos historiales se muestran cerrados inicialmente

Sí — el panel (`<div className="tracked-history">`) sólo se renderiza si `open` es `true`, y `open` arranca en `false`. El problema no era qué se mostraba, era qué se **pedía** (el fetch corría igual aunque el panel nunca se mostrara).

### 2.6 Si se pueden cargar sólo cuando el usuario abre el historial

Sí — implementado (§3).

### 2.7 Si ya existe un patrón lazy reutilizable (`BlockHistoryTimeline`)

Sí. `BlockHistoryTimeline` (mismo archivo, usado por Domicilio/Responsables/Transporte/Configuración — ya optimizado desde antes de esta etapa) es un componente **separado**, montado condicionalmente (`{showHistory ? <BlockHistoryTimeline .../> : null}`) — su propio `useEffect` corre recién cuando el componente se monta, es decir, cuando el usuario abre el historial. Arquitectura distinta a `FieldWithHistory`/`useBackendFieldHistory` (que están siempre montados, con el panel condicionado por `open` pero el FETCH sin condicionar).

### 2.8 Si se puede agregar una opción lazy sin romper otros usos

Sí — se gateó el `useEffect` existente con `if (!open || <flag>) return;` en vez de reestructurar a un componente separado (cambio mínimo, mismo árbol de componentes, mismos props, mismo comportamiento de guardado/edición). Se evaluó extraer un hook compartido único para los 3 patrones (`FieldWithHistory`/`useBackendFieldHistory`/`BlockHistoryTimeline`) y se descartó por alcance — sería un refactor arquitectónico más grande sin beneficio de performance adicional (el objetivo, dejar de disparar 8 fetches al montar, ya se logra con el gate mínimo), con más riesgo de romper alguno de los 3 usos existentes sin necesidad.

### 2.9 Si hay caché por `field-history`

No existía antes (ni backend `createTtlCache` ni frontend `services/cache`) y no se agregó una — en su lugar, cada componente ahora guarda una bandera local `historyLoaded`/`loaded` (estado de React, no una caché genérica) que evita repetir el fetch si el usuario cierra y vuelve a abrir el mismo historial en la misma sesión de la pantalla — exactamente lo pedido en la Parte 3 ("puede usar caché local si ya se cargó"), sin introducir un mecanismo de caché nuevo (el pedido explícitamente lo permite sólo "si se implementa caché local", no exige un sistema de caché compartido).

### 2.10 Si las llamadas duplicadas son StrictMode o reales en producción

React StrictMode (activo sólo en `npm run dev`, nunca en el build de producción) — mismo fenómeno ya documentado y descartado como bug real en la Etapa 14A y confirmado de nuevo en 14C.1/14D.1. No se tocó (no es un problema real de producción).

### 2.11 Si el journey puede distinguir eager vs click real

Sí, y esa distinción es justamente la evidencia que motivó esta etapa: en 14D.1, la acción "Cambiar a pestaña Datos Laborales" mostraba 0 requests propios (el fetch eager completaba tarde y quedaba atribuido a la acción siguiente), mientras que las acciones "Revelar historial de X (ya precargado)" mostraban 0-16 requests sin relación clara con el campo abierto — la propia etiqueta "(ya precargado)" y las notas del journey documentaban explícitamente el patrón eager. Después de esta etapa, el journey se actualizó (§6) para que "Cambiar a pestaña Datos Laborales" no dispare ningún `field-history`, y cada "Abrir historial de X" dispare exactamente 1 request del campo correspondiente — la comparación directa entre el reporte de 14D.1 (antes) y el de esta etapa (después) es la prueba objetiva de que el fix funciona.

---

## 3. Componentes revisados

- `frontend/src/pages/EmployeeDetailPage.tsx` (monta la pestaña, `renderEmployeeTab` tab===2).
- `frontend/src/components/employees/EmployeeLaborFields.tsx` (`SalaryRangeValidationCard`, `positionAllowedValues`).
- `frontend/src/components/employees/FieldHistoryControls.tsx` (`FieldWithHistory`, `BlockHistoryTimeline` como referencia lazy).
- `frontend/src/components/employees/LaborTrackedFields.tsx` (`useBackendFieldHistory`, `MultiCompanyField`, `EmployeePositionField`).
- `frontend/src/services/api/employeeApiService.ts` (`getPositionValidation`).
- `frontend/src/services/api/employeeHistoryApiService.ts` (`getFieldHistory`).

## 4. Endpoints revisados

- `GET /employees/:id/position-validation` — optimizado (§5).
- `GET /employees/:id/field-history` — sin cambios de backend (ya filtraba correctamente por `employeeId`/`section`/`field`; el problema era 100% de cuándo el FRONTEND lo llamaba, no de qué hacía el backend al recibirlo).

## 5. Queries Prisma revisadas

- `employeesRepository.findById`/`findEmployeeDetailById` (usada antes por `getPositionValidation` vía `getById`) — confirmado que trae 6 relaciones batch + núcleo de 4 niveles, de las cuales `getPositionValidation` sólo usaba 2 campos del núcleo.
- `employeesRepository.findFieldHistory`/`findBlockHistory` — revisadas, sin cambios (ya filtran por `employeeId` siempre, `section`/`field`/`block` sólo si vienen en la query — confirmado con tests nuevos, ver §7).

## 6. Causa raíz

**Una sola causa raíz para los 2 problemas**: código escrito para leer 2-3 campos usaba el mecanismo "traer el legajo completo" (`getById`) en vez de un select dedicado (posición-validation) — y componentes de campo trackeado disparaban su fetch de historial en el momento de MONTARSE en vez de en el momento de ABRIRSE (field-history eager). Ninguno de los dos es un problema de "el backend es lento" en abstracto — es sobre-fetching estructural, exactamente el mismo patrón de causa que 14C.3 ya había corregido en otros 2 endpoints del mismo módulo (`block-history`/`field-history`'s pre-check de acceso).

---

## 7. Cambios aplicados

### 7.A Backend

1. **`employees.repository.ts`**: nuevo `employeePositionValidationSelect` (sólo `internalCategory`, `sector` con cadena de 4 niveles, `position` con su propia cadena de 4 niveles + `salaryCategories` — sin ninguna de las 6 relaciones batch, sin `address`/`transport`/`costCenter`) y `findPositionValidationById(id, accessWhere)` (`findFirst`, mismo `where: {AND:[{id}, accessWhere]}` que ya usan `findById`/`existsWithAccess`).
2. **`employees.service.ts`**: `getPositionValidation` — `getById` → `findPositionValidationById`; se agregó el mismo guard 404 (`AppError EMPLOYEE_NOT_FOUND`) que ya tenían `getById`/`assertAccessible`, ausente antes (antes, un `id` inexistente hacía que `getById` tirara su propio 404; ahora el 404 se lanza explícitamente en `getPositionValidation` mismo — mismo código/mensaje, mismo comportamiento observable).
3. **No se tocó**: `findFieldHistory`/`findBlockHistory` (ya filtraban bien), ningún select de detalle/overview, ninguna transacción, ningún `accessWhere`/RBAC.

### 7.B Frontend

1. **`FieldHistoryControls.tsx`** (`FieldWithHistory`): el `useEffect` que llama a `getFieldHistory` ahora es `if (!open || historyLoaded) return;` — sólo carga la primera vez que se abre; `historyLoaded` (nuevo estado) evita recargar en cierres/reaperturas subsiguientes.
2. **`LaborTrackedFields.tsx`** (`useBackendFieldHistory`): mismo gate (`if (!open || loaded) return;`), con `open` ahora como parámetro del hook — los 2 call sites (`MultiCompanyField`, `EmployeePositionField`) le pasan su propio estado `open` (ya existía, sólo se conectó).
3. **`EmployeeLaborFields.tsx`**: sin cambios de código — su comportamiento de "no bloquear" ya existía (§1.3); se agregaron tests para protegerlo (§9).

### 7.C Journey

Ver §6 del reporte generado (`docs/performance/EMPLOYEES_PERFORMANCE_JOURNEY_14D1.md`, sobreescrito en cada corrida): se actualizó la nota de "Cambiar a pestaña Datos Laborales" (ya no describe un patrón eager) y se renombraron las 8 acciones "Revelar historial de X (ya precargado)" → "Abrir historial de X" + "Cerrar historial de X" (mismo patrón de nombrado que los bloques lazy ya existentes), reflejando el comportamiento real nuevo.

### 7.D Documentación

Este documento.

---

## 8. Cambios descartados y por qué

- **Eliminar `GET /employees/:id/position-validation` y depender sólo de la validación local**: descartado — el pedido prohíbe explícitamente "cambiar el significado de la validación", y la validación local está documentada en el propio código como un cálculo de respaldo (`salaryRangeMockService`), no la fuente de verdad. El backend sigue siendo la validación oficial, ahora mucho más liviana.
- **Diferir el disparo de `position-validation` con un `setTimeout`/idle callback**: descartado — ya no bloquea nada (§1.3), diferirlo más no cambia la UX percibida, sólo agregaría complejidad sin beneficio medible.
- **Extraer un hook lazy compartido único para `FieldWithHistory`/`useBackendFieldHistory`/`BlockHistoryTimeline`**: descartado por alcance — mismo resultado (dejar de disparar al montar) logrado con un gate mínimo en cada uno, sin tocar la arquitectura de 3 componentes distintos innecesariamente.
- **Agregar una caché genérica (`services/cache`) para `field-history`**: descartado — el pedido explícitamente evita "usar cache para ocultar problemas de diseño" (mismo criterio que 14C.3); el estado local `historyLoaded`/`loaded` ya resuelve "no repetir el fetch al reabrir" sin ese riesgo.
- **Tocar `GET /positions`** (también lento en 14D.1: 3091-3954ms, se usa en esta misma pestaña vía `usePositions()`/`useActivePositions()`): descartado — fuera del alcance explícito de esta etapa (el pedido prioriza sólo `position-validation` y `field-history`); documentado como candidato pendiente (§12).

---

## 9. Riesgos

- **La etiqueta "Desde: {fecha}" del encabezado colapsado de cada `FieldWithHistory` pierde precisión hasta que el usuario abre el historial al menos una vez.** Antes, `currentFrom = history[0]?.effectiveFrom || effectiveFrom || employee.startDate` se resolvía con el dato real (fecha del último cambio de ESE campo) porque el historial ya estaba cargado; ahora, hasta que se abre, cae al fallback (`effectiveFrom` — no se pasa en ningún call site de Datos Laborales — o la fecha de alta del empleado, que no es lo mismo). Es un cambio de UX menor y deliberado, evaluado contra el beneficio (eliminar 8 requests innecesarios en cada visita a la pestaña) — se documenta acá con total transparencia, no se ocultó. No afecta ningún dato guardado, ninguna validación, ningún cálculo — sólo el texto mostrado en el encabezado antes de abrir el historial.
- **`position-validation` sigue con una cadena de 4 niveles (`sector→area→establishment→businessUnit`) sin `previewFeatures=["relationJoins"]`** (mismo motivo de fondo que `overview-details`, documentado desde 14C.1) — el select liviano elimina el 90%+ del costo (6 relaciones batch fuera), pero la cadena en sí sigue pagando varios round-trips. Ver §12 para el número real medido.
- **`GET /positions` no se tocó** y sigue apareciendo lento en el journey — riesgo de que quede como el próximo cuello de botella visible de esta pestaña una vez resueltos `position-validation`/`field-history`.

## 10. Qué NO se tocó

Ninguna regla de negocio, cálculo de estado laboral, responsable de carga/encargado directo, permisos/RBAC, historial/auditoría (los 4 métodos de historial ya protegidos desde 14C.3 no se tocaron), schema/migraciones, Carga Horaria, Turnos, Fichador, Horas Especiales (el módulo de reglas, no la pestaña "Configuración Horaria" de Legajos, que sí es parte de este módulo pero no se tocó tampoco), Conceptos Horarios, ni ningún otro módulo.

## 11. Plan de validación

Ver §13 (Validaciones ejecutadas) y §14 (comparación antes/después) de la entrega final en el mensaje de cierre — ejecutado: `npx prisma validate`, `typecheck`/`test`/`build` en backend y frontend, `typecheck:e2e`, `npm run perf:journey:employees` (antes ya medido en 14D.1, después medido en esta etapa), `git diff --check`.

## 12. Antes/después

Medido corriendo `npm run perf:journey:employees` después de aplicar todos los cambios de esta etapa, comparado contra el reporte ya commiteado de la Etapa 14D.1 (`docs/performance/EMPLOYEES_PERFORMANCE_JOURNEY_14D1.json`, guardado antes de sobreescribirlo) — mismo entorno local (staging real vía Neon), mismo mecanismo de medición, sin necesidad de un experimento de revert/restore (esta vez el "antes" ya estaba commiteado).

| Caso | Antes (14D.1) | Después (14D.2) | Mejora | Comentario |
|---|---|---|---|---|
| `GET /employees/:id/position-validation` (2 llamadas capturadas) | 7130ms / 12825ms | 3812ms / 6112ms | **~50-52%** | Select liviano elimina las 6 relaciones batch + `address`/`transport`/`costCenter`; el costo residual son las 2 cadenas de 4 niveles (`sector→area→establishment→businessUnit`, empleado y puesto) sin `relationJoins` — mismo límite ya documentado en 14C.1, no resuelto en esta etapa (ver §9/§13). |
| `GET /employees/:id/field-history` — cantidad de llamadas al entrar a Datos Laborales | 8 (16 con StrictMode) | **0** | **100%** | Confirmado en el journey: "Cambiar a pestaña Datos Laborales" no captura ningún `field-history` en ninguna corrida. |
| `GET /employees/:id/field-history` — cantidad total en toda la pestaña (entrar + abrir los 8 historiales) | 16 | 8 | **50%** (y ahora cada llamada es intencional, 1 por click real) | Antes: 16 llamadas sin que el usuario pidiera nada. Después: exactamente 1 por campo abierto — si el usuario abre 3 historiales, son 3 llamadas, no 16. |
| `GET /field-history` — costo de red total acumulado en el recorrido | 33620ms (16 llamadas) | 4117ms (8 llamadas) | **~87.7%** | Suma de todas las duraciones capturadas — mejora tanto por menos llamadas como porque cada una compite por menos conexiones simultáneas del pool. |
| "Abrir historial de Empresa" (la acción que en 14D.1 absorbía la mayoría de las 16 field-history por timing) | visible 2810ms / idle 2893ms, 17 requests capturados | visible 1303ms / idle 1387ms, **1 request** | **~54% más rápido, 16 requests menos** | Antes mezclaba 16 field-history + 1 real. Después: exactamente el request de Empresa, nada más. |
| Tiempo de abrir historial de Sector | 25ms (falso — dato ya estaba precargado, no reflejaba el costo real) | 795ms (2 requests: field-history propio + cola de otro request lento) | — (no es una regresión: antes "medía rápido" porque el costo real estaba escondido en otra acción) | Ver §2.11 — el número de "antes" no era representativo del costo real; el de "después" sí. |
| Tiempo de abrir historial de Puesto | 26ms (mismo motivo que Sector) | 810ms | — (mismo motivo) | ídem |
| Errores HTTP / consola (todo el recorrido) | 0 / 0 | 0 / 0 | Sin cambios | Confirmado — el cambio no introdujo ningún error nuevo. |
| Sanitización de rutas/UUIDs en el reporte | Sin UUIDs | Sin UUIDs | Sin cambios | Verificado con `grep` sobre el `.md`/`.json` generados — 0 coincidencias de UUID en ambas corridas. |

**Lo que no mejoró y por qué, con total transparencia**: `position-validation` bajó ~50%, no ~90%+ como `block-history` en 14C.3 — la diferencia es que `block-history` no necesitaba NINGUNA relación (sólo existencia), mientras que `position-validation` genuinamente necesita 2 cadenas relacionales de 4 niveles para hacer su comparación. No se inventó un número más favorable; se reporta el real. El límite residual (cadenas sin `relationJoins`) es el mismo ya documentado en 14C.1 como candidato de una etapa de infraestructura de Prisma dedicada, fuera de alcance de un cambio de sólo-select.
