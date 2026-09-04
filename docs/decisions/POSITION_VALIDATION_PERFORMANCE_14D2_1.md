# Etapa 14D.2.1 — Cierre de performance de position-validation (Legajos › Datos Laborales)

Fecha: 2026-09-06
Estado: diagnóstico completo, implementado, validado, **pendiente de aprobación para commitear**
Alcance: exclusivamente `GET /employees/:id/position-validation` y `SalaryRangeValidationCard` (`frontend/src/components/employees/EmployeeLaborFields.tsx`). Construye sobre 14D.2 (select liviano, ya commiteado). Sin cambios de schema/migraciones, sin cambios de reglas funcionales, sin cambios de permisos/RBAC, sin eliminar la validación.

---

## 1. Diagnóstico (Parte 1 del pedido, 21 puntos)

### 1.1 Qué datos exactos necesita `SalaryRangeValidationCard`

Del empleado: `businessUnit`, `establishment`, `sector` (strings), `internalCategory`, `positionId`. Del puesto: `derivedBusinessUnitName`/`derivedEstablishmentName`/`derivedSectorName`, `salaryCategories` (rango ordenado). De un catálogo de categorías salariales, para ubicar `internalCategory` dentro de ese rango.

### 1.2 Qué datos ya tiene `employee` desde `overview-details`

`employee.businessUnit`/`establishment`/`sector`/`internalCategory`/`positionId` — los 5, ya presentes sin ningún fetch adicional (confirmado leyendo `employeeOverviewDetailsCoreSelect`/`findOverviewDetailsById`, `employees.repository.ts`).

### 1.3 Qué datos ya tiene `GET /positions`

`derivedBusinessUnitName`/`derivedEstablishmentName`/`derivedSectorName` **y** `salaryCategories` (vía `PositionSalaryCategory`, mismo join que usa el backend de `position-validation`) — confirmado en `positions.repository.ts` (`positionInclude`) y `positionApiService.ts`. Esta pestaña ya llama `GET /positions` de todos modos (vía `usePositions()`/`useActivePositions()`, usado por `EmployeePositionField`) — no es un fetch nuevo.

### 1.4 Qué trae `getPositionValidation` actualmente (después de 14D.2)

`internalCategory` (escalar) + `sector` (cadena de 4 niveles) + `position.sector` (cadena de 4 niveles) + `position.salaryCategories` — el select liviano de 14D.2, sin ninguna de las 6 relaciones batch del detalle completo.

### 1.5 Qué parte del select sigue generando lentitud

Las **2 cadenas relacionales de 4 niveles** (`sector→area→establishment→businessUnit`, una del empleado y otra del puesto) dentro de un único `findFirst` anidado. Sin `previewFeatures=["relationJoins"]`, Prisma resuelve cada nivel de cada cadena como un round-trip separado — mismo diagnóstico exacto que ya explicaba la lentitud de `overview-details` en 14C.1.

### 1.6 Si la validación local es equivalente o sólo aproximada

**Investigado a fondo esta etapa (no se había hecho antes con este nivel de detalle).** Resultado: **parcialmente equivalente, con una divergencia real confirmada, no sólo teórica.**

- **Estructura (unidad de negocio/establecimiento/sector)**: equivalente. `employee.businessUnit/establishment/sector` se arman en el frontend (`employeeApiService.ts`, `mapEmployeeFromApi`) con la expresión `item.sector?.area?.establishment?.businessUnit?.name` — carácter por carácter la misma que usa el backend en `getPositionValidation`. `Employee` en el schema (`schema.prisma`) sólo tiene `sectorId` como FK — no hay columnas `businessUnit`/`establishment`/`sector` denormalizadas que puedan quedar desactualizadas; se derivan siempre en el momento de la lectura. Lo mismo para `position.derived*Name` (calculado en `positionApiService.ts` desde el mismo `sectorId→area→establishment→businessUnit` de la Position, confirmado contra el saneamiento de Puestos del 2026-08-18). **Conclusión: el chequeo estructural local nunca puede divergir del oficial.**
- **Categoría salarial (rango)**: **NO equivalente — divergencia real confirmada.**
  - El backend usa un array `salaryOrder` hardcodeado (`employees.service.ts`) con un orden fijo de categorías.
  - El frontend usa `salaryCategoryApiService.getGroups()` → reagrupa las categorías por "familia" (`salaryRangeMockService.ts`, `getOrderedCategories`), descartando el orden global `SalaryCategory.order` que sí respeta el backend.
  - **Caso de falla real, no hipotético**: en el primer render, antes de que `getGroups()` resuelva, el frontend usa un catálogo hardcodeado de respaldo (`salaryFamilies`, `salaryRangeMockService.ts`) que **no incluye las categorías Gerente/Jefe/Coordinador/Supervisor** — un empleado con esas categorías vería `UNKNOWN_CATEGORY` (o un estado distinto) del lado local, aunque el backend sepa perfectamente ubicarlo.
  - El orden en que se evalúan los criterios también difiere (frontend chequea rango antes que categoría, backend al revés) — en el caso borde de "sin categoría interna Y sin rango configurado", el backend devuelve `UNKNOWN_CATEGORY` (tone `danger`) y el local devolvería `NO_RANGE` (tone `warning`) para la MISMA situación real.
  - **Esto confirma por qué el pedido prohíbe explícitamente "cambiar criterios de comparación" y "mostrar success si no se puede validar"**: promover la validación local a única fuente (sin el backend) arriesgaría exactamente eso en un caso real, no de laboratorio.

### 1.7-1.9 Si el backend es realmente necesario al montar / si sólo debería consultarse al editar / si se puede eliminar la llamada inicial

**El backend sigue siendo necesario como fuente autoritativa** — no se puede eliminar la llamada inicial reemplazándola por sólo-local sin arriesgar mostrar un semáforo incorrecto en escenarios reales (§1.6). Evaluado explícitamente diferirla a "sólo al editar" (Opción A del pedido, en su variante más estricta) y **descartado**: la mayoría de las visitas a un legajo son de sólo lectura (un RRHH revisando el estado del legajo, no editándolo) — si el backend sólo se consultara al abrir un editor, esas visitas de sólo lectura se quedarían mostrando indefinidamente una validación que puede estar mal en los casos de §1.6, violando "no mostrar success si no se puede validar" de forma silenciosa. Se mantiene la consulta automática al montar, pero optimizada (§2) y cacheada (§2) para que su costo real y su frecuencia bajen sin sacrificar corrección.

### 1.10-1.13 Si se puede usar `GET /positions` para validar en frontend / si ya trae todo / si falta algo / si conviene enriquecerlo

`GET /positions` ya trae todo lo necesario para el chequeo **estructural** (§1.3). Para el chequeo de **categoría salarial**, técnicamente también trae `salaryCategories` (el rango), pero el problema no es la disponibilidad del dato — es que el frontend usa una fuente/orden distinta para UBICAR la categoría del empleado dentro de ese rango (§1.6). Enriquecer `GET /positions` no resuelve esto: el defecto está en `salaryRangeMockService`/`salaryCategoryApiService`, un servicio de frontend completamente aparte que ya tiene su propio catálogo — unificar esas 2 fuentes (backend `salaryOrder` vs frontend `getGroups()`/`salaryFamilies`) sería un cambio de alcance mucho mayor (tocaría lógica de negocio de comparación salarial, fuera de lo permitido esta etapa: "no cambiar reglas funcionales"). Documentado como candidato futuro (§9), no resuelto acá.

### 1.14-1.15 Si conviene incluir position-validation dentro de `overview-details` / si eso empeoraría `overview-details`

Evaluado y **descartado**. `overview-details` ya es el endpoint más pesado medido del módulo (3.8-4.7s, ver 14C.1/14C.3) — agregarle 2 cadenas relacionales más (la del puesto, que hoy `overview-details` no trae) lo empeoraría directamente, y acoplaría un endpoint de uso constante (se llama SIEMPRE al abrir cualquier legajo) a un cálculo que sólo hace falta en la pestaña Datos Laborales. Mantenerlos separados es la decisión correcta.

### 1.16-1.17 Si se puede cachear por employeeId+positionId+sectorId+internalCategory / riesgo de dato viejo

Sí — implementado (§2, Opción B). Riesgo de dato viejo: bajo y acotado. La caché tiene TTL de 60s y vive en la familia `"employees"` de `services/cache`, la misma que **ya se invalida automáticamente** en cualquier guardado de datos del empleado (`invalidateEmployeeDependentCaches`, ya existente, no tocado). Si el usuario edita puesto/categoría/sector y guarda, la caché completa de esa familia se invalida — el siguiente fetch de `position-validation` es fresco. El único caso de "dato viejo" tolerado es: 2 pestañas del mismo navegador editando el mismo legajo en simultáneo sin refrescar — riesgo preexistente compartido por TODAS las cachés `services/cache` del proyecto, no específico de este cambio.

### 1.18 Si el endpoint puede usar caché backend TTL corto

Evaluado (Opción C) y **descartado a favor de la caché frontend (Opción B)**: cachear en el backend por usuario+rol+employeeId+positionId+sector+internalCategory es estrictamente más complejo (clave compuesta de 5 dimensiones, invalidación acoplada a 3 tipos de guardado distintos) para lograr exactamente el mismo resultado observable que ya logra la caché de `services/cache` del lado del frontend, que además evita el round-trip de red por completo (no sólo el trabajo de DB) en cache-hit. No se agregó una caché nueva en el backend.

### 1.19 Si puede usarse caché frontend por sesión

Sí — implementado (§2).

### 1.20-1.21 Si se puede bajar de 1500ms sin `relationJoins` / si `relationJoins` es realmente necesario

Con el cambio de esta etapa (paralelizar cadena de empleado + cadena de puesto vía `Promise.all`, aprovechando que el frontend ya conoce `positionId`), el tiempo medido baja significativamente (ver §7 para el número real) pero **no se garantiza bajar de 1500ms de forma consistente** — cada cadena sigue siendo 4 niveles sin `relationJoins`, y aunque ahora corren en paralelo, la más lenta de las 2 sigue marcando el piso. Bajar de forma confiable por debajo de 1500ms **sí requeriría** `relationJoins` (colapsar cada cadena en 1 sola consulta SQL con `JOIN`, en vez de 4 round-trips secuenciales) — evaluado y descartado activarlo en esta etapa por ser un cambio de infraestructura de Prisma con radio de impacto global (afecta cualquier query con relaciones anidadas en todo el backend), no algo para decidir dentro de una etapa quirúrgica de un solo endpoint. Documentado como candidato ya 3 veces (14C.1, 14C.3, acá) — sigue pendiente de una etapa dedicada.

---

## 2. Solución elegida

**Combinación de Opción B (caché frontend por sesión) + Opción E (paralelizar en el backend) + transparencia de UI mínima — explícitamente NO la variante más estricta de Opción A ("sólo consultar al editar").**

Justificación: la Opción A estricta fue evaluada y descartada porque el hallazgo de §1.6 (la validación local puede genuinamente diferir de la oficial en el chequeo de categoría salarial, no sólo en teoría) hace que dejar de consultar el backend automáticamente arriesgue mostrar un semáforo incorrecto a usuarios que sólo están mirando el legajo, no editándolo — exactamente lo que el pedido prohíbe ("no mostrar success si no se puede validar", "no cambiar criterios de comparación"). En cambio, B+E preservan la llamada automática (mismo significado funcional, backend sigue siendo la fuente autoritativa) mientras atacan las 2 causas reales del costo: (1) se repetía innecesariamente en cada revisita a la pestaña con los mismos datos — resuelto con caché de sesión; (2) el cálculo en sí era más lento de lo necesario — resuelto paralelizando 2 consultas que ya eran independientes una vez que el `positionId` es conocido de antemano (el frontend ya lo tiene). Se agregó además una leyenda mínima ("Validación preliminar (local)" / aviso si el backend falla) para cumplir explícitamente "debe quedar claro si la validación visible es local o backend" y "no ocultar errores reales".

---

## 3. Qué cambió

### 3.A Backend

1. **`employees.schemas.ts`**: nuevo `positionValidationQuerySchema` — `positionId` opcional (string, 1-64 chars).
2. **`employees.routes.ts`**: la ruta `GET /:id/position-validation` ahora valida query con `validateQuery(positionValidationQuerySchema)` (antes no validaba query en absoluto).
3. **`employees.controller.ts`**: `getPositionValidation` lee `positionId` de `req.query` y lo pasa al service.
4. **`employees.service.ts`**: `getPositionValidation(id, user, positionId?)` — pasa `positionId` al repositorio.
5. **`employees.repository.ts`**:
   - `positionValidationSectorSelect`/`positionValidationPositionSelect` — fragmentos de select extraídos (evita triplicar la cadena de 4 niveles dentro del archivo).
   - Nueva `findPositionValidationByIdParallel(id, accessWhere, hintedPositionId)`: `Promise.all` de 2 consultas de nivel superior — la del empleado (`internalCategory`+`positionId`+`sector`, con `accessWhere`) y la del puesto (`prisma.position.findUnique`, por el `positionId` que mandó el cliente). **Nunca confía ciegamente en el `positionId` del cliente**: compara contra el `positionId` real leído en la misma consulta del empleado — si no coincide (dato desactualizado del lado del cliente), vuelve a pedir el puesto correcto (1 round-trip extra sólo en ese caso borde, nunca un resultado incorrecto).
   - `findPositionValidationById(id, accessWhere, positionId?)`: si `positionId` viene, usa el camino paralelo; si no, usa el `findFirst` único de 14D.2 (compatibilidad hacia atrás exacta, ningún otro caller se tocó).

### 3.B Frontend

1. **`cachePolicy.ts`**: nueva política `employeePositionValidation` (familia `"employees"`, TTL 60s, no persistida) — misma familia que ya invalida `invalidateEmployeeDependentCaches` en cada guardado de datos laborales (sin tocar esa invalidación, ya cubre este caso).
2. **`employeeApiService.ts`**: `getPositionValidation(id, { positionId?, sector?, internalCategory? })` — envuelto en `cachedData` (misma utilidad que usan `list`/`getSummary`/etc.). `positionId` viaja como query param real al backend; `sector`/`internalCategory` **no** viajan (el backend los vuelve a derivar de la fuente real) — sólo entran en la clave de caché, para que un cambio en cualquiera de las 4 dimensiones dispare un fetch nuevo.
3. **`EmployeeLaborFields.tsx`** (`SalaryRangeValidationCard`): pasa `positionId`/`sector`/`internalCategory` al llamar `getPositionValidation`; nuevo estado `backendStatus` (`"loading" | "success" | "error" | "disabled"`) que controla una leyenda mínima: mientras carga, "Validación preliminar (local) — confirmando con el servidor..."; si falla, "No pudimos confirmar la validación oficial. Mostrando una aproximación local — no reemplaza la validación del servidor." (nunca oculto); si confirma o si `useBackendValidation=false` (pantalla de alta), sin leyenda.

### 3.C Journey

Se agregaron 2 acciones nuevas en la pestaña Datos Laborales: salir a "Contacto y Domicilio" y volver a "Datos Laborales", para poder demostrar en el reporte que la revisita **no** vuelve a disparar `position-validation` (servida desde la caché de sesión).

### 3.D Documentación

Este documento. Corregida la fecha de `docs/decisions/EMPLOYEE_LABOR_DATA_PERFORMANCE_14D2.md` (2026-09-05 → 2026-09-04, Parte 5 del pedido).

---

## 4. Qué NO cambió

- El significado de la validación: mismos criterios de comparación, backend sigue siendo la fuente autoritativa (`validation = backendValidation || localValidation`, sin tocar).
- RBAC: `employeeAccessWhere(user)` se sigue aplicando idéntico en la consulta del empleado; la consulta del puesto (`prisma.position.findUnique`) no necesita alcance propio — el `positionId` sólo puede venir de un legajo al que el usuario ya tiene acceso (validado en la misma llamada), y `GET /positions` (catálogo compartido) ya expone las mismas posiciones sin ese alcance desde antes, confirmado en el diagnóstico de esta etapa.
- El contrato de la respuesta: mismo shape exacto (`tone`/`title`/`categoryText`/`checks`/`category`).
- Ningún caller existente del endpoint sin `positionId` se rompe (camino de respaldo idéntico a 14D.2).
- No se tocó `salaryRangeMockService`/`salaryCategoryApiService` ni la divergencia de categorías encontrada en §1.6 — documentada como candidato futuro (§9), no corregida (cambiaría lógica de comparación, fuera de alcance de "no cambiar reglas funcionales").
- No se tocó `overview-details`, ni ningún otro endpoint del módulo.

---

## 5. Riesgos

- **Consistencia eventual de la caché de sesión (60s)**: si el usuario edita el puesto de OTRO legajo en otra pestaña del navegador dentro de esos 60s, no afecta a este legajo (la clave incluye `employeeId`). Si edita ESTE legajo y el guardado no pasa por los flujos que invalidan la familia `"employees"` (todos los guardados de Legajos sí lo hacen, confirmado en 14C.3/14D.2), podría ver un resultado de hasta 60s de antigüedad — mismo criterio de riesgo ya aceptado para `employeesSummary`/`employeesOrgChart`.
- **Divergencia de categoría salarial entre validación local y backend (§1.6) sigue sin resolver** — mitigada (no eliminada) por la leyenda de transparencia nueva: mientras el backend no confirmó, el usuario ve explícitamente que es una aproximación preliminar.
- **El camino paralelo agrega 1 round-trip extra en el caso borde de `positionId` desactualizado** (§3.A.5) — aceptado: es estrictamente más lento que el caso feliz, pero nunca más lento que el camino de respaldo de 14D.2, y nunca incorrecto.

## 6. Qué quedó pendiente

- Unificar la fuente de verdad de categorías salariales entre frontend (`salaryRangeMockService`) y backend (`salaryOrder`) — el defecto real detrás de §1.6, fuera de alcance de una etapa de sólo-performance.
- `relationJoins` de Prisma como solución de fondo para bajar de forma confiable por debajo de 1500ms (§1.20-1.21) — candidato de una etapa de infraestructura dedicada, no de este endpoint puntual.
- `GET /positions` (3-4s medido en 14D.1/14D.2) sigue sin optimizar — fuera de las prioridades explícitas de 14D.2/14D.2.1.

---

## 7. Antes/después

Medido corriendo `npm run perf:journey:employees` después de aplicar todos los cambios, comparado contra el reporte guardado de la Etapa 14D.2 (mismo entorno local, staging real vía Neon).

| Caso | Antes (14D.2) | Después (14D.2.1) | Mejora | Comentario |
|---|---|---|---|---|
| `GET .../position-validation` — duración | 3812ms / 6112ms (2 llamadas) | **3292ms (1 llamada)** | ~46% vs. la más lenta de 14D.2; **~74% acumulado** desde el 12825ms original de 14D.1 | El camino paralelo (Promise.all de cadena empleado + cadena puesto) baja el tiempo real; la caché de sesión colapsa lo que antes eran 2 llamadas (incluido el doble-montaje de React StrictMode en dev) en 1 sola. |
| Cantidad de llamadas a `position-validation` en todo el recorrido | 2 | **1** | 50% menos tráfico | La caché de sesión (`services/cache`, familia `employees`) sirve la segunda petición sin ir a la red — incluso el doble montaje de StrictMode ahora colapsa en 1 sola llamada real gracias al dedupe de `cachedData`. |
| Revisitar Datos Laborales (salir y volver a entrar) | no medido antes (acción no existía en el journey) | **0 requests de `position-validation`** en la acción de revisita | — | Prueba directa y explícita de que la caché de sesión funciona: revisitar la pestaña con los mismos datos no dispara ninguna llamada nueva. |
| `position-validation` en el Top 10 de acciones/requests más lentas | Sí (2do lugar en requests más lentas: 12825ms/6112ms en distintas corridas) | **No aparece en el Top 10 de acciones más lentas**; en requests más lentas queda 4to lugar (3292ms, detrás de `dashboard/metrics` y 2 `overview-details`, ninguno de Legajos/Datos Laborales) | Cumple el objetivo explícito de esta etapa | "Que entrar a Datos Laborales ya no deje position-validation crítico en acciones posteriores" — confirmado con el reporte real. |
| `GET .../field-history` — cantidad total en el recorrido | 8 | 8 | Sin cambios (no era el alcance de esta etapa) | Confirma que el fix de 14D.2 sigue intacto — esta etapa no lo tocó. |
| Errores HTTP / consola (todo el recorrido) | 0 / 0 | 0 / 0 | Sin cambios | Confirmado. |
| Sanitización de rutas/UUIDs en el reporte | Sin UUIDs | Sin UUIDs | Sin cambios | Verificado con `grep` sobre el `.md`/`.json` generados. |

**Lo que no se resolvió, con total transparencia**: `position-validation` sigue sin bajar de 1500ms de forma consistente (§1.20-1.21) — el residual son las 2 cadenas de 4 niveles sin `relationJoins`, corriendo ahora en paralelo pero cada una todavía paga varios round-trips. No se inventó un número más favorable; 3292ms es el real medido.
