# Etapa 14D.7 — Aplicación acotada de Prisma `relationJoins` en queries medidas

Fecha: 2026-09-07
Estado: **implementado, validado, pendiente de aprobación para commitear**
Referencia obligatoria: `docs/decisions/PRISMA_RELATION_JOINS_DIAGNOSTIC_14D6.md` — este documento aplica exactamente el alcance que 14D.6 recomendó (Resultado C: aplicación acotada, no rollout global), sin extenderlo a ninguna query no medida ahí.

---

## 1. Qué decía 14D.6 y qué se aplicó ahora

14D.6 diagnosticó (experimento controlado, luego revertido) que `relationLoadStrategy: "join"` mejora 60-87% en 3 queries con cadena profunda `sector→area→establishment→businessUnit`, con shape byte-idéntico y 1112/1113 tests (el único roto era una aserción mecánica de mock). Recomendó una Etapa 14D.7 de implementación **permanente pero acotada**, limitada exactamente a esas mismas queries.

Esta etapa aplica ese mismo diff de forma **permanente** (no revertido esta vez), corrige el test mecánico, agrega verificación de shape y RBAC, mide antes/después con el journey real (HTTP end-to-end, no sólo repositorio) y documenta todo.

---

## 2. Versión de Prisma y cambio exacto en `schema.prisma`

Prisma / `@prisma/client`: **6.19.3** (sin cambios respecto a 14D.6).

```diff
 generator client {
-  provider = "prisma-client-js"
+  provider        = "prisma-client-js"
+  previewFeatures = ["relationJoins"]
 }
```

Confirmado explícitamente (Parte 1 del pedido):
- `npx prisma validate` y `npx prisma generate` corren limpio con este cambio.
- **No se generó ningún archivo de migración** — `git status backend/prisma/migrations/` queda vacío antes y después de `prisma generate`. Este cambio afecta únicamente cómo el **cliente** de Prisma arma las queries (JOIN vs. múltiples round-trips) — no toca ninguna tabla, columna, índice ni constraint de la base de datos. `datasource db` no se tocó.

---

## 3. Queries exactas donde se aplicó `relationLoadStrategy: "join"`

Las mismas 4 queries medidas en 14D.6, ni una más:

### 3.1 `backend/src/modules/employees/employees.repository.ts`

**a) `findOverviewDetailsById`** — la consulta de `sector` por `sectorId` (cadena `sector→area→establishment→businessUnit`), dentro del `Promise.all` de 5 queries hijas:

```ts
sectorId
  ? prisma.sector.findUnique({ where: { id: sectorId }, select: overviewSectorChainSelect, relationLoadStrategy: "join" })
  : Promise.resolve(null),
```

Las otras 4 queries de ese mismo `Promise.all` (`companies`, `laborMovements`, `assignments`, `hourConcepts`) **no se tocaron** — no tienen cadena profunda (§2 de 14D.6).

**b) `findPositionValidationByIdParallel`** — las 3 llamadas de esta función (empleado + puesto sugerido, más el fallback si el `positionId` del cliente no coincide con el real):

```ts
const [employeeCore, hintedPosition] = await Promise.all([
  prisma.employee.findFirst({
    where: { AND: [{ id }, accessWhere] },
    select: { internalCategory: true, positionId: true, sector: { select: positionValidationSectorSelect } },
    relationLoadStrategy: "join",
  }),
  prisma.position.findUnique({
    where: { id: hintedPositionId },
    select: positionValidationPositionSelect,
    relationLoadStrategy: "join",
  }),
]);
// ...
? await prisma.position.findUnique({ where: { id: employeeCore.positionId }, select: positionValidationPositionSelect, relationLoadStrategy: "join" })
```

- La cadena del empleado actual (`employee → sector → area → establishment → businessUnit`) y la del puesto (`position → sector → area → establishment → businessUnit`) quedan cubiertas, tal como pedía la Parte "Queries candidatas permitidas" del pedido.
- **La lógica de no confiar en el `positionId` del cliente no se tocó**: si `employeeCore.positionId !== hintedPositionId`, se sigue pidiendo el puesto real con una tercera consulta (ahora también con `relationLoadStrategy: "join"`, mismo criterio). Confirmado con el test ya existente "si el positionId del cliente está desactualizado... vuelve a pedir el puesto correcto" (sigue pasando, ver §6).
- **`accessWhere` se mantiene exactamente igual** — mismo `where: { AND: [{ id }, accessWhere] }`, sin ningún cambio de forma ni de combinación.

### 3.2 `backend/src/modules/positions/positions.repository.ts`

**`findOptions`** (catálogo liviano de `GET /positions/options`, consumido por Legajos desde 14D.4):

```ts
findOptions(query: ListPositionOptionsQuery) {
  return prisma.position.findMany({
    where: query.status ? { status: query.status } : {},
    select: positionOptionSelect,
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take: query.take,
    relationLoadStrategy: "join",
  });
},
```

- `positionOptionSelect` (la cadena `position → sector → area → establishment → businessUnit` + `salaryCategories`) **no se modificó** — mismos campos, mismo orden de declaración.
- `where`/`orderBy`/`take` sin cambios.

---

## 4. Queries explícitamente NO modificadas

Cumpliendo la lista de prohibiciones del pedido, al pie de la letra:

| Query / endpoint | Motivo de exclusión |
|---|---|
| `positionsRepository.findMany`/`findById` (`GET /positions` **principal**) | Usa `positionInclude`, que tiene `_count.employees` — riesgo señalado explícitamente en 14D.6 §6 (combinación `relationLoadStrategy`+`_count` no probada). Prohibido explícitamente en el pedido. |
| `GET /dashboard/metrics` | Sus relaciones ya son planas (1 nivel) — 14D.6 §2 confirmó que no tiene cadena profunda que `relationJoins` pueda acelerar. Prohibido explícitamente. |
| `GET /org-structure` | 6 queries ya planas, sin `include`/`select` anidado real (14D.6 §2). Nada que colapsar. Prohibido explícitamente. |
| `GET /employees/:id/block-history`, `GET /employees/:id/field-history` | Sólo 1 nivel de `include` (`createdBy`) — sin cadena profunda. Prohibido explícitamente. |
| Documentos, Turnos, Carga Horaria, Fichador, Horas Especiales, Conceptos Horarios | Fuera del alcance de Legajos/candidatos medidos — no se tocó ningún archivo de esos módulos (confirmado con `git status`, ver §14). |
| `positionsRepository.findMany` con filtros (usa `prisma.$transaction([...])`) | Riesgo señalado en 14D.6 §6 (`relationLoadStrategy` + `$transaction` no probado) — no se tocó. |

No hubo ningún caso donde TypeScript rechazara `relationLoadStrategy` en una query candidata — las 4 aceptaron la opción sin necesidad de `as any` ni ningún otro escape de tipos (confirmado con `npm run typecheck`, limpio).

---

## 5. Tests ajustados

**1 test corregido** (el mismo identificado en 14D.6 §4): `backend/src/modules/employees/employees.repository.test.ts`, describe `"employeesRepository.findOverviewDetailsById — Etapa 6L.1 / 14C.1 / 14D.3"`, test `"Etapa 14C.1: resuelve companies/laborMovements/assignments/hourConcepts en paralelo..."`.

```diff
-    expect(prisma.sector.findUnique).toHaveBeenCalledWith({ where: { id: "sec-1" }, select: expect.objectContaining({ id: true, name: true, code: true, area: expect.anything() }) });
+    expect(prisma.sector.findUnique).toHaveBeenCalledWith({
+      where: { id: "sec-1" },
+      select: expect.objectContaining({ id: true, name: true, code: true, area: expect.anything() }),
+      relationLoadStrategy: "join",
+    });
```

**No se relajó la aserción** — se agregó `relationLoadStrategy: "join"` como una expectativa explícita más (no se cambió a `objectContaining` en el nivel superior, que hubiera permitido cualquier clave adicional futura sin detectarla). El test sigue verificando exactamente lo mismo que antes:
- `where` correcto (`{ id: "sec-1" }`, literal).
- `select` correcto (`objectContaining` ya existía desde antes, para no tener que enumerar cada campo de la cadena completa — no se relajó más de lo que ya estaba).
- Ausencia de campos pesados: no aplica a esta query (nunca tuvo campos pesados, es la cadena de sector).
- Shape final esperado: la aserción siguiente en el mismo test (`expect(result).toEqual({...})`) sigue intacta, sin cambios — verifica el objeto completo devuelto por `findOverviewDetailsById`.

**No se tocó ningún otro test** — las 3 queries restantes (`findPositionValidationById` ×2 y `positionsRepository.findOptions`) tienen tests que acceden a propiedades específicas del objeto de llamada (`call.where`, `call.select.sector`, etc.) en vez de comparar el objeto completo con `toHaveBeenCalledWith` — por diseño, esos tests son insensibles a que se agregue una clave hermana nueva, así que no rompieron y no había nada que ajustar (confirmado: 1112/1113 antes del fix, 1113/1113 después de este único cambio).

---

## 6. Validación RBAC real (Parte 4 del pedido)

**Limitación explícita, documentada en vez de inventada**: este entorno no tiene una forma simple de loguearse como los 3 roles reales (RRHH/Supervisión/Admin Carga) y navegar Legajos de punta a punta de forma automatizada dentro del alcance de esta etapa — el journey de Playwright usa un único acceso rápido de RRHH (`Login (acceso rápido RRHH)`), no ejercita Supervisión ni Admin Carga. No se inventó una validación manual que no se hizo.

**Validación real ejecutada, vía los tests unitarios existentes de `accessWhere`** (los 3 roles sí están cubiertos ahí):

1. **`employeeAccess.test.ts`** (`describe("employeeAccessWhere")`) — cubre los 3 roles de forma directa e independiente de esta etapa: "RRHH ve lo que corresponde: sin ninguna restricción (where vacío)", "Supervisión ve sólo empleados asignados: filtra por TIME_RESPONSIBLE + userId propio", "Carga horaria ve sólo empleados asignados: mismo filtro que Supervisión, con su propio userId", más "roles desconocidos deniegan por defecto". Esta función genera el `where` que después se pasa como `accessWhere` a las 3 queries tocadas — es completamente independiente de `relationLoadStrategy` (no llama a Prisma en absoluto, es lógica pura de armado de `where`) y **no se tocó, sigue pasando sin cambios**.
2. **`employees.repository.test.ts`**, `findOverviewDetailsById`: `"Etapa 14C.1 — permisos: si el core no existe/no es accesible, nunca dispara las 4 consultas hijas ni la del sector"` — simula un `accessWhere` que excluye al empleado (`{ sectorId: { in: ["sec-ajeno"] } }`) y confirma que `prisma.sector.findUnique` (la query con `relationLoadStrategy: "join"`) **nunca se llama** — el filtro de acceso sigue cortando ANTES de llegar a la relación con join. Sigue pasando.
3. **`employees.repository.test.ts`**, `findPositionValidationById` (camino sin `positionId` y camino paralelo con `positionId`): dos tests, `"devuelve null si el legajo no existe o está fuera de alcance"` y `"...( mismo comportamiento que el camino sin positionId)"` — mismo patrón, `accessWhere` restrictivo → `null`, sin llamar a las queries con `relationLoadStrategy`. Ambos siguen pasando.
4. **Argumento estructural** (ya documentado en 14D.6 §5, reconfirmado acá con evidencia de test real, no sólo teoría): `relationLoadStrategy` es una opción de **ejecución** (cómo se resuelven relaciones ya seleccionadas), nunca de **filtrado** — el `where`/`accessWhere` se evalúa exactamente igual sin importar la estrategia de carga. Los 3 tests de arriba lo confirman empíricamente: cuando `accessWhere` excluye al empleado, la query con join **ni se ejecuta**.
5. **PII**: sin cambio — el `select` de las 3 queries es el mismo objeto de código de antes, sólo con `relationLoadStrategy` agregado. Confirmado también con el diff de shape byte a byte (§7).
6. **Status codes**: no se tocó ningún controller/ruta — los status codes de éxito/error de `overview-details`, `position-validation` y `positions/options` no cambiaron (mismo manejo de errores de siempre, `asyncHandler` sin modificar).

No se inventó ninguna prueba con usuarios reales que no se haya hecho — esta es la validación real disponible, documentada con honestidad.

---

## 7. Validación de shape / correctness (Parte 5 del pedido)

Se repitió la metodología de 14D.6, esta vez sobre el código PERMANENTE de esta etapa (no un experimento a revertir): un script temporal (`tmp-14d7-shape-check.ts`, backend, ejecutado con `npx tsx`) llamó a las 3 funciones reales del repositorio contra el mismo empleado/puesto de 14D.6, capturando el JSON completo devuelto.

Procedimiento: se capturó el resultado con el código actual ("después"), luego se hizo `git stash` de los 4 archivos tocados (volviendo al estado sin `relationLoadStrategy`), `prisma generate`, se capturó "antes", y se restauró con `git stash pop` + `prisma generate` de nuevo.

**Resultado: `diff` byte a byte idéntico en los 3 casos** (`overview-details`, `position-validation`, `positions/options`) — mismos campos, mismos valores, mismo orden de arrays (todas las cadenas tocadas son relaciones *to-one*, sin reordenamiento posible), mismos `null`, sin campos nuevos ni faltantes, sin ningún dato sensible expuesto de más.

**El script se eliminó al terminar** (`tmp-14d7-shape-check.ts` y sus 6 `tmp-shape-*.json`) — era puramente diagnóstico, no queda commiteado, cumpliendo la Parte 5 del pedido ("si es sólo diagnóstico, revertirlo antes de entregar").

---

## 8. Performance antes/después (Parte 6 del pedido)

### 8.1 Medición a nivel repositorio (3 corridas directas, mismo criterio que 14D.6)

| Endpoint | Antes (14D.6, sin `relationJoins`) | Después 14D.7 (repositorio directo, 3 corridas) |
|---|---|---|
| `overview-details` | min 2482 / avg 4292 / max 7100 | min 548 / avg 1590 / max 3422 |
| `position-validation` | min 1442 / avg ~1851-2049 / max 3160 | min 184 / avg 256 / max 392 |
| `positions/options` | min 1413 / avg ~1939-2123 / max 3122 | min 180 / avg 277 / max 464 |

Consistente con lo medido en 14D.6 (mismo diff de código, mismo entorno Neon) — sirve como confirmación de reproducibilidad, no como el número principal de esta etapa (ver 8.2, que es HTTP end-to-end real).

### 8.2 Medición end-to-end real (`npm run perf:journey:employees`) — la medición principal de esta etapa

**Nota metodológica importante**: se detectó que el backend de desarrollo llevaba corriendo desde antes de esta sesión y había pasado por varios reinicios de `tsx watch` durante el experimento de shape-check (§7, `git stash`/`stash pop`) — existía riesgo real de que el proceso vivo tuviera el código fuente ya actualizado pero el `@prisma/client` regenerado en un momento distinto (desincronizados). Se reinició el backend de forma explícita (`kill` + `npm run dev` de nuevo) inmediatamente antes de correr el journey, para garantizar que la medición reflejara exactamente el estado final del código + cliente Prisma, sin ambigüedad. Se confirmó además que el journey/frontend apuntan al puerto correcto del backend real de este proyecto (`http://localhost:4002/api`, según `VITE_API_URL` en `frontend/.env`) — no a otro proceso que pudiera estar escuchando en un puerto distinto.

| Endpoint | Antes 14D.6/14D.5 (HTTP, referencia) | Después 14D.7 (HTTP, journey real) | Mejora | Cantidad de llamadas | Comentario |
|---|---|---|---|---|---|
| `GET /employees/:id/overview-details` | ~3.5-3.9s (commit `fea4d59`, 14D.5) | **737-774ms** (2 corridas) | **~78-81%** | 1 (antes y después — ya deduplicado desde 14D.5) | Sale por completo del Top 10 de requests más lentas del journey; deja de estar en rango Crítico. |
| `GET /employees/:id/position-validation` | ~1.4-3.4s (variable, 14D.2.1-14D.6) | **376-402ms** (2 corridas) | **~71-89%** según la corrida de referencia | 1 | Cae de Crítico/Medio a rango OK (&lt;1000ms). |
| `GET /positions/options` | ~1.4-3.2s (variable, 14D.4-14D.6) | **377-402ms** (2 corridas) | **~72-88%** según la corrida de referencia | 1 | Igual que arriba — cae a rango OK. |
| `GET /employees/:id/overview` (control, no tocado) | 352-390ms | 352ms | Sin cambio (esperado) | 1 | Confirma que no se tocó nada fuera de las 3 queries candidatas. |

Nota honesta sobre la variación: los rangos "antes" citados arriba son variables entre corridas anteriores (14D.2.1 a 14D.6) por el ruido normal de latencia de Neon, ya documentado repetidamente en esta serie — no se promedia un único número "antes" definitivo porque nunca hubo uno estable; se cita el rango real observado en cada etapa anterior. La comparación **cualitativa** (Crítico/Lento → OK, desaparición del Top 10) es más sólida que cualquier porcentaje puntual y se sostiene en todas las corridas hechas en 14D.6 y 14D.7 sin excepción.

### 8.3 Impacto en el journey completo

- **"Abrir primer legajo disponible"**: network idle **4392-4470ms → 1356-1794ms** (2 corridas de verificación), visible ms sin cambio significativo (835-839ms, igual que siempre — la cabecera ya pintaba rápido, esto es puramente una mejora de red de fondo). **Clasificación de severidad: Crítico → Medio** (1000-2000ms) en ambas corridas. La corrida final que queda reflejada en `docs/performance/EMPLOYEES_PERFORMANCE_JOURNEY_14D1.md`/`.json` es la de idle 1356ms (la 2ª de la verificación pre-commit, §8.4).
- **Top 10 requests más lentas**: ninguno de los 3 candidatos aparece — sólo queda `GET /api/dashboard/metrics` (500, no relacionado, ver §8.4).
- **Acciones en rango Crítico de todo el recorrido**: 3 (14D.5) → **1** (sólo `dashboard/metrics`, fuera de alcance).
- **56/56 acciones cubiertas, 0 salteadas** — sin cambios.

**Separación explícita pedida por la Parte 6**: la mejora está basada en **requests individuales** (737-774ms / 376-402ms / 377-402ms medidos directamente por endpoint en 2 corridas), no sólo en el network idle global de la acción — el network idle de "Abrir primer legajo disponible" (1356-1794ms) es la "sensación de pantalla" agregada, reportada aparte y coherente con la suma de sus componentes, pero no es la métrica primaria de esta tabla.

### 8.4 Hallazgo no relacionado, confirmado y descartado como regresión

El journey registró 1 respuesta HTTP ≥ 400 y 1 error de consola: `GET /api/dashboard/metrics` → 500, durante la acción "Login". **Mismo error exacto ya documentado en el commit `fea4d59`** (14D.5, §8 de ese documento) — transitorio, del módulo Dashboard, explícitamente fuera de alcance de esta etapa (ni se tocó `dashboard.repository.ts` ni `dashboard.service.ts`). No es una regresión de 14D.7.

**Reverificado antes de commitear, con causa raíz identificada en el log del backend**: se corrió el journey 2 veces más como verificación final pre-commit. La 1ª corrida falló temprano (2/9 acciones) por un error distinto y también ajeno a 14D.7 — `POST /api/auth/login` devolvió 500 por `PrismaClientKnownRequestError P1017` ("Server has closed the connection"), un corte de conexión de Neon tras inactividad del proceso, resuelto solo en la siguiente request (confirmado en el log: los requests inmediatamente posteriores ya respondían 200 con normalidad). La 2ª corrida (la que queda reflejada en los archivos de esta entrega) corrió completa: 56/56 acciones, y **`dashboard/metrics` volvió a fallar con 500** — confirmado. Causa raíz visible en el log del backend (`grep` sobre el log de `tsx watch`): `dashboard/metrics` dispara 15-16 queries Prisma concurrentes vía `Promise.all` (`calculateMetrics`, `dashboard.service.ts`); en ambas corridas del error (esta etapa y la de `fea4d59`) el fallo ocurre dentro de ese mismo lote de 15-16 queries paralelas contra el pool de conexiones de Neon (visto con modelos distintos cada vez — `EmployeeDocument` en una corrida, `Employee` en otra — consistente con agotamiento/timeout del pool bajo ese fan-out, no con un modelo específico roto). **Siguiendo la instrucción explícita de esta etapa, no se tocó ningún archivo de `dashboard/*`** — se documenta la causa raíz observada para una futura etapa dedicada a Dashboard, no se intenta corregir acá.

### 8.5 Si el journey no permitió aislar bien alguna medición

Sí permitió aislar las 3 mediciones con precisión — cada endpoint candidato aparece como un request HTTP individual con su propia duración en el JSON del reporte, sin necesidad de inferencia. La única limitación real es la ya mencionada: el "antes" no es un único número estable sino un rango observado en corridas anteriores (ruido de Neon, no del journey).

---

## 9. Rollback (Parte 8 del pedido)

1. Quitar `relationLoadStrategy: "join"` de las 4 llamadas tocadas (`employees.repository.ts` ×3, `positions.repository.ts` ×1).
2. Quitar `previewFeatures = ["relationJoins"]` de `schema.prisma` (ninguna otra query del proyecto lo usa, confirmado con grep — es seguro quitarlo sin dejar nada roto).
3. Ejecutar `npx prisma generate`.
4. Revertir el ajuste del test en `employees.repository.test.ts` (quitar `relationLoadStrategy: "join"` de la aserción).
5. Re-correr `npm test` (backend) y `npm run perf:journey:employees` (frontend) para confirmar el estado previo.

Sin migración de base de datos involucrada en ningún paso — mismo rollback de sólo código ya validado en 14D.6.

---

## 10. Riesgos

Los mismos de 14D.6 §6, sin novedades — esta etapa no amplió el alcance a ninguno de los casos marcados como "no probado" ahí (`_count`, `$transaction`, paginación offset, `orderBy` anidado, relaciones *to-many* de alta cardinalidad). Riesgo residual explícito:

- **Dependencia de versión de Prisma**: sigue siendo *preview feature*, no GA — revisar en cualquier futura actualización mayor de Prisma.
- **Mantenimiento**: cualquier query nueva que en el futuro necesite la misma cadena de sector deberá decidir explícitamente si suma `relationLoadStrategy: "join"` o no — no hay un default global, es opt-in por query (confirmado en la práctica: las queries no tocadas siguen usando la estrategia clásica sin ningún cambio de comportamiento).

---

## 11. Recomendación para próximos pasos

- Si se decide ampliar el alcance más allá de estas 4 queries (por ejemplo al endpoint principal `GET /positions` con su `_count`, o a queries con paginación), debe ser una etapa nueva y acotada, con su propio diagnóstico — no extender este cambio silenciosamente.
- El endpoint `GET /dashboard/metrics` sigue siendo el único en rango Crítico del journey — confirmado (14D.6 y acá) que `relationJoins` no es la palanca correcta ahí (relaciones ya planas); su causa raíz (15 queries en paralelo, posible costo de aggregates/counts) queda como candidato de una etapa de Dashboard dedicada, fuera de esta serie de Legajos.
- Mantener este documento y `docs/decisions/PRISMA_RELATION_JOINS_DIAGNOSTIC_14D6.md` como referencia obligatoria antes de tocar cualquier query con relaciones anidadas en el futuro.

---

## 12. Qué NO se tocó

Carga Horaria, Turnos, Fichador, Horas Especiales, Conceptos Horarios, Documentos, `GET /positions` principal, `PuestosPage`/`PuestoDetailPage`/`PuestoCreatePage`, `org-structure`, `dashboard`, `block-history`, `field-history`, schema de base de datos/migraciones, reglas funcionales, RBAC (lógica de `employeeAccessWhere` sin cambios), contratos de API (mismos shapes, mismos status codes), frontend (ningún componente/servicio de React tocado — sólo se regeneró el reporte del journey).
