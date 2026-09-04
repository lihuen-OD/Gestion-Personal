# Etapa 14D.6 — Diagnóstico controlado de Prisma `relationJoins`

Fecha: 2026-09-04
Estado: **diagnóstico completo, con experimento controlado y revertido. Ningún cambio de código queda en el working tree.**
Alcance: exclusivamente diagnóstico técnico — determinar si `previewFeatures = ["relationJoins"]` + `relationLoadStrategy: "join"` conviene para este proyecto, con evidencia real medida en este mismo entorno (Neon). **No se activó de forma definitiva. No se modificaron reglas funcionales, RBAC ni contratos de API.**

---

## 1. Relevamiento (Parte 1 del pedido, 15 puntos)

### 1.1-1.2 Versión de Prisma y `@prisma/client`

`backend/package.json` declara `"@prisma/client": "^6.9.0"` y `"prisma": "^6.9.0"`. La versión realmente instalada (confirmada con `npx prisma --version`) es **6.19.3** para ambos paquetes — Node.js v24.18.0, Query Engine (Node-API), Schema Engine.

### 1.3-1.4 `schema.prisma` actual / `previewFeatures` ya activas

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**No hay `previewFeatures` declaradas** — confirmado, este es el estado real del archivo antes y después de esta etapa (revertido).

### 1.5-1.7 Disponibilidad de `relationJoins` en esta versión, si requiere el flag, y providers soportados

Verificado contra la documentación oficial de Prisma versionada para v6 (`prisma.io/docs/orm/v6/reference/preview-features/client-preview-features`, consultada durante esta etapa): **`relationJoins` está listado explícitamente entre las "Currently active Preview features" de Prisma 6** — introducido en la versión 5.7.0, **todavía no promovido a General Availability** en ninguna versión 6.x documentada. Esto se confirma también empíricamente: `npx prisma validate`/`generate` con `previewFeatures = ["relationJoins"]` agregado corrieron limpio, sin ningún warning de "feature desconocida/deprecada" (sí aparece el warning, no relacionado, sobre `package.json#prisma` de cara a Prisma 7).

Sí requiere el flag: sin `previewFeatures = ["relationJoins"]` en el `generator client`, la opción `relationLoadStrategy` no existe para TypeScript ni en runtime — confirmado con el experimento (§3): sin el flag, las mismas queries no tienen forma de pedir `"join"` como estrategia.

Soportado en: **PostgreSQL, CockroachDB y MySQL** (no en SQLite/SQL Server según la misma documentación) — este proyecto usa PostgreSQL (Neon), así que aplica sin reservas de compatibilidad de provider.

### 1.8 Provider actual de DB

`datasource db { provider = "postgresql" }`, `DATABASE_URL` apunta a **Neon** (pooled, `*-pooler.c-4.us-east-1.aws.neon.tech`, `sslmode=require&channel_binding=require`) — mismo entorno remoto ya caracterizado en 14C.1-14D.5 como la fuente de la latencia por round-trip (~150-900ms según la corrida, variable).

### 1.9-1.10 Uso actual de Prisma en el backend / endpoints con includes/selects profundos

Todo el backend usa `@prisma/client` a través de una capa de repositorio por módulo (`*.repository.ts`), consistente con `docs/ARCHITECTURE_STANDARDS.md`. Relevados con grep los repositorios de `employees`, `positions` y `org-structure` — confirmado que el patrón de "cadena profunda anidada dentro de una sola consulta" (candidato real para `relationJoins`) existe en **exactamente 4 lugares**, todos ya identificados en etapas previas (14C.1-14D.4) y reconfirmados acá con lectura directa del código (ver tabla completa en §2).

### 1.11-1.12 Endpoints ya diagnosticados con cadenas profundas / endpoints críticos en 14D.1-14D.5

Ya documentado repetidamente: `overview-details` (14C.1, 14D.3), `position-validation` (14D.1, 14D.2.1), `positions/options` (14D.4). Los reportes de 14D.1-14D.5 (`docs/performance/EMPLOYEES_PERFORMANCE_JOURNEY_14D1.md`) muestran estos 3 en el Top 10/rango Crítico de forma consistente en casi todas las corridas.

### 1.13 Logs de performance de 14B.2

No se encontraron logs persistentes de producción de la Etapa 14B.2 disponibles en este entorno local (esa etapa instrumentó `slow:true`/`error:true` en logs de aplicación, no en un almacén consultable desde acá) — la comparación de esta etapa se basa en mediciones directas nuevas (§3), no en esos logs históricos. Documentado como limitación, no inventado.

### 1.14 Tests existentes que podrían detectar shape roto

`employees.repository.test.ts` y `positions.repository.test.ts` — ambos usan mocks de `prisma.*` con aserciones **estrictas** de argumentos (`toHaveBeenCalledWith(objetoExacto)`), lo que los hace sensibles a CUALQUIER cambio en el objeto de opciones pasado a Prisma Client, incluida la sola presencia de una clave nueva `relationLoadStrategy` — confirmado en el experimento (§3, §5.4): son exactamente el tipo de test que detecta este cambio, aunque el dato real devuelto sea idéntico.

### 1.15 Zonas más sensibles a RBAC/PII

`employees.repository.ts` es el módulo con más superficie RBAC/PII de todo el backend (DNI, CUIL, domicilio, datos laborales, con `accessWhere` distinto por rol) — es también donde viven 2 de los 3 candidatos con cadenas profundas (`overview-details`, `position-validation`). Análisis de impacto RBAC/PII específico en §5.

---

## 2. Endpoints candidatos — tabla (Parte 2 del pedido)

| Endpoint | Usa relaciones profundas | Cadena crítica | Cantidad aprox. de queries | Tiempo actual (medido, HTTP, journey 14D.5) | Podría beneficiarse de `relationJoins` | Riesgo |
|---|---|---|---|---|---|---|
| `GET /employees/:id/overview-details` | Sí (parcial) | `sector→area→establishment→businessUnit`, en una query **separada** (`prisma.sector.findUnique`) dentro de un `Promise.all` de 5 | 1 `findFirst` núcleo + 5 en paralelo (companies/laborMovements/assignments/hourConcepts/sector) | ~3.5-3.9s (commit `fea4d59`) | **Sí** — específicamente la query del sector | Bajo — cambio acotado a 1 query de las 6 |
| `GET /employees/:id/position-validation` | Sí | `sector→area→establishment→businessUnit`, anidada **dentro de 2 queries distintas** (`employee.findFirst` y `position.findUnique`, ambas en `Promise.all`) | 2 (camino paralelo de 14D.2.1) | ~1.4-3.4s (variable entre corridas) | **Sí** — en ambas queries | Bajo — 2 queries acotadas |
| `GET /employees/:id/block-history` | No | `createdBy` (1 nivel) | 1 `findMany` | ~1.3-2.0s (medido en journeys previos) | No / beneficio mínimo | N/A — no hay cadena que colapsar |
| `GET /employees/:id/field-history` | No | `createdBy` (1 nivel) | 1 `findMany` por campo (8 en paralelo cuando se abren todos) | ~0.8-1.3s cada uno | No / beneficio mínimo | N/A |
| `GET /positions/options` | Sí | `sector→area→establishment→businessUnit`, anidada dentro de **una sola** `findMany` | 1 `findMany` | ~1.4-3.2s (variable, 14D.4/14D.5) | **Sí** | Bajo |
| `GET /org-structure` | **No** | Ninguna — 6 `findMany` **ya planos** (escalares + IDs de FK, sin `include`/`select` anidado real) corridos en `Promise.all`, con caché backend de 60s ya existente | 6 en paralelo | ~2.1-3.1s en cache-miss | **No** — no hay nada que colapsar, ya es tan plano como puede ser | N/A |
| `GET /dashboard/metrics` (sólo identificar, no optimizar) | No (relaciones shallow, 1 nivel: `sector.name`, `companies.company.name`, `address.city`, `transport.locality`) | Ninguna cadena de 3+ niveles | 15 en paralelo (`Promise.all`, mezcla de counts/aggregates + 2 `findMany` livianos) | ~5.0-6.7s, consistentemente el endpoint más lento de todo el journey general | **No** — sus relaciones ya son planas; la lentitud tiene otra causa (volumen de 15 queries concurrentes y/o costo de los counts/aggregates), fuera de diagnóstico de esta etapa | Fuera de alcance — no se optimiza Dashboard acá, sólo se confirma que `relationJoins` no es la palanca correcta para este endpoint |

**Conclusión de §2**: de los 7 candidatos pedidos, sólo **3 tienen una cadena de relaciones profunda genuina anidada dentro de una única consulta** (`overview-details`-sector, `position-validation` ×2, `positions/options`) — son los únicos donde `relationJoins` puede tener efecto. Los otros 4 (`block-history`, `field-history`, `org-structure`, `dashboard/metrics`) ya son planos o de 1 nivel — confirmado por lectura de código, no supuesto.

---

## 3. Medición antes/después experimental (Parte 3 del pedido)

### Metodología

Se midió con un script temporal (`tmp-relationjoins-bench.ts`, backend, ejecutado con `npx tsx`, **eliminado al terminar, nunca commiteado**) que importa y llama **directamente las funciones reales del repositorio** (`employeesRepository.findOverviewDetailsById`, `employeesRepository.findPositionValidationById`, `positionsRepository.findOptions`) contra el mismo empleado/puesto real (con `sectorId`/`positionId` asignados) en Neon — 3 corridas por endpoint, en cada uno de los 2 estados. Se eligió medir a nivel de repositorio (no HTTP) para aislar el efecto de la estrategia de carga de relaciones, sin el ruido de autenticación/Express/red del navegador — **es una medición más precisa que el journey para esta pregunta específica**, aunque no reemplaza al journey para medir la experiencia end-to-end (por eso también se corrió el journey completo como validación, §8).

Procedimiento real ejecutado:
1. **Antes**: estado committeado (`fea4d59`), sin `previewFeatures`. Corrida del bench (2 veces, independientes).
2. **Cambio experimental**: `previewFeatures = ["relationJoins"]` en `schema.prisma` + `npx prisma generate` + `relationLoadStrategy: "join"` agregado a las 4 queries candidatas identificadas en §2 (`employees.repository.ts` ×3, `positions.repository.ts` ×1). **Nunca commiteado.**
3. **Después**: bench corrido de nuevo (2 veces, independientes) contra el mismo empleado/puesto.
4. **Validación de correctness**: `npm test` (backend completo) corrido con el cambio experimental activo.
5. **Diff de shape**: resultado real (JSON completo) de cada una de las 3 funciones, capturado en ambos estados, comparado con `diff` — **idéntico byte a byte en los 3 casos**.
6. **Revertido**: `git checkout -- prisma/schema.prisma src/modules/employees/employees.repository.ts src/modules/positions/positions.repository.ts` + `npx prisma generate` — working tree limpio, confirmado con `git status`.

### Tabla obligatoria — tiempos reales (ms), repositorio directo, 3 corridas por estado

| Endpoint | Antes min | Antes prom | Antes max | Después min | Después prom | Después max | Mejora (prom) | Riesgo | Recomendación |
|---|---|---|---|---|---|---|---|---|---|
| `overview-details` (función completa, incluye sector chain) | 2482 | 4292 | 7100 | 652 | 1739 | 3677 | **~59-60%** | Bajo | Activar `relationLoadStrategy: "join"` en la query de sector |
| `position-validation` (camino paralelo, 2 queries) | 1442 | 1851-2049 | 3160 | 182 | 314-337 | 406 | **~83-84%** | Bajo | Activar en ambas queries |
| `positions/options` | 1413 | 1939-2123 | 3122 | 180 | 246-345 | 524 | **~85-87%** | Bajo | Activar en esta query |

Nota honesta sobre el patrón de las 3 corridas: en **ambos** estados (antes y después) la 1ª de las 3 corridas del script es consistentemente la más lenta (ej. 7100ms/3677ms) — esto es un efecto de "cold start" de la conexión a Neon al arrancar el proceso `tsx` (no relacionado con `relationJoins` en sí, mismo efecto ya documentado informalmente en corridas de journey anteriores). Por eso la comparación relevante es el **mínimo** y el **promedio de las 2 corridas siguientes**, no sólo el promedio crudo de 3 — con ese criterio la mejora es aún más marcada (mínimos: 2482→652ms, 1442→182ms, 1413→180ms).

Se midió cada endpoint **2 veces completas** (no sólo 1), en cada estado, para confirmar que el patrón se repite y no es ruido de una sola corrida — **se repitió de forma consistente en las 2 corridas independientes** de "antes" y en las 2 de "después".

No se pudo/necesitó medir `block-history`/`field-history`/`org-structure`/`dashboard/metrics` en este experimento porque §2 ya determinó, por lectura de código, que no tienen cadenas profundas que `relationJoins` pudiera acelerar — medirlos habría sido ruido sin hipótesis que probar. Esto se documenta explícitamente en vez de inventar números para completar la tabla.

---

## 4. Resultados funcionales / correctness

- **Shape**: idéntico, verificado con `diff` byte a byte del JSON completo devuelto por las 3 funciones, en ambos estados. Ningún campo apareció, desapareció ni cambió de tipo/valor.
- **Orden de arrays**: no aplica cambio — ninguna de las 3 queries candidatas tiene una relación *to-many* anidada dentro de la cadena profunda (todas las cadenas tocadas son *to-one*: `sector→area→establishment→businessUnit`, cada nivel es una FK única). `salaryCategories` (to-many, pero de baja cardinalidad, 1-3 categorías por puesto) no mostró cambio de orden en el diff.
- **Tests backend**: `npm test` con el cambio experimental activo → **1112/1113 pasaron, 1 falló**. El único test que falló (`employees.repository.test.ts` — "Etapa 14C.1: resuelve companies/laborMovements/assignments/hourConcepts en paralelo") usa `expect(prisma.sector.findUnique).toHaveBeenCalledWith({ where: {...}, select: {...} })` — una aserción **estricta de argumentos**. Al agregar `relationLoadStrategy: "join"` como una clave más en el objeto de opciones, el objeto real ya no es "exactamente" el esperado por el test, aunque el `where`/`select` en sí no cambiaron. **No es un cambio de comportamiento ni de dato — es un mock desactualizado**, trivialmente corregible (agregar `relationLoadStrategy: "join"` al objeto esperado en el test) si se decide implementar de verdad. Confirmado el detalle exacto del diff de la aserción en la corrida real (ver commit del experimento, ya revertido).
- **Build/typecheck**: `npm run typecheck` y `npm run build` pasaron limpio con el cambio experimental activo (la opción `relationLoadStrategy` está correctamente tipada por `@prisma/client` una vez regenerado con el previewFeature).

---

## 5. Impacto en RBAC / PII

1. **RBAC**: `relationLoadStrategy` es una opción de **ejecución** de la consulta (cómo se resuelven las relaciones ya seleccionadas), no un parámetro de filtrado — el `where`/`accessWhere` de cada query se evalúa exactamente igual, combinado de la misma forma (`AND: [{ id }, accessWhere]`), sin importar la estrategia de carga elegida para las relaciones. No hay ningún mecanismo por el cual cambiar de estrategia "query" a "join" pueda alterar qué filas pasan un filtro de acceso — sólo cambia cómo se traen los datos de las filas que YA pasaron el filtro. Este experimento se corrió con `accessWhere = {}` (sin restricción, para aislar la variable relevante) — **no se probó explícitamente con los 3 `accessWhere` reales de RRHH/Supervisión/Admin Carga**, pero el argumento estructural de arriba (RBAC se resuelve en el `where`, no en la carga de relaciones) sostiene que el comportamiento es el mismo — documentado como validación pendiente si se avanza a una etapa de implementación real (§7).
2. **PII**: confirmado con el diff de shape (§4) — ningún campo nuevo se expone, ninguno deja de exponerse. El `select` es literalmente el mismo objeto de código, sólo con una opción de ejecución agregada.
3. **Caché no persistente**: no aplica ningún cambio — `relationJoins` es una capa de Prisma/SQL, no toca `services/cache` (frontend) ni los cachés TTL de controller (backend), ninguno de los dos se tocó ni se vería afectado por este cambio.

---

## 6. Riesgos a evaluar (Parte 6 del pedido, respuesta explícita a cada pregunta)

- **¿Mejora todos los casos o sólo algunos?** Sólo los que tienen cadenas profundas anidadas dentro de una única consulta (3 de los 7 candidatos, §2). Los otros 4 no tienen nada que ganar — aplicarlo ahí sería un cambio sin beneficio, no dañino pero innecesario.
- **¿Puede empeorar endpoints con muchas relaciones grandes (to-many de alta cardinalidad)?** Riesgo teórico real (documentado en la comunidad de Prisma): un JOIN duplica la fila "padre" por cada fila "hija" en relaciones *to-many* antes de que Prisma la reconstruya del lado del cliente — para relaciones *to-many* con MUCHAS filas anidadas, esto puede generar un resultset más grande que el de queries separadas. **Ninguno de los 3 candidatos probados tiene esa forma** (todas las cadenas profundas tocadas son *to-one*). No probado con relaciones *to-many* de alto volumen — riesgo abierto si una futura etapa quisiera aplicarlo a, por ejemplo, `laborMovement.findMany` con cientos de registros por empleado.
- **¿Puede aumentar payload o memoria?** Mismo razonamiento — bajo para cadenas *to-one* (nuestro caso), potencialmente real para *to-many* anchas (no nuestro caso).
- **¿Puede empeorar queries con filtros (`where`) complejos?** No probado — los 3 candidatos usan `where` simples (por `id` o `status`). Riesgo abierto, a validar caso por caso antes de aplicar a queries con `where` anidados profundos.
- **¿Puede afectar paginación?** No probado — ninguno de los 3 candidatos usa `skip`/paginación offset real (`positions/options` usa sólo `take`). Riesgo abierto para `positionsRepository.findMany` (el endpoint paginado, no tocado en este experimento).
- **¿Puede afectar `orderBy` anidado (sobre campos de una relación)?** No probado — los 3 candidatos ordenan sólo por campos propios (`status`, `name`), nunca por un campo de una relación anidada.
- **¿Puede afectar `include`/`select` con `_count`?** **Riesgo real y explícitamente señalado en la comunidad de Prisma** (combinaciones de `relationLoadStrategy: "join"` con `_count` han tenido reportes de comportamiento inconsistente en algunas versiones). Relevante porque `positions.repository.ts` tiene un `_count.employees` en `positionInclude` (el endpoint **principal** `GET /positions`, explícitamente **no tocado** en este experimento) — si una futura etapa quisiera extender `relationJoins` a ese endpoint, este es un punto a probar con especial cuidado antes de asumir que funciona igual.
- **¿Puede afectar transacciones (`$transaction`)?** No probado — `positionsRepository.findMany` (el endpoint paginado con filtros) usa `prisma.$transaction([...])` (forma array). No se combinó `relationLoadStrategy` con `$transaction` en este experimento.
- **¿Puede generar SQL demasiado grande?** Con cadenas de sólo 3-4 niveles *to-one* (nuestro caso), el SQL generado (`LATERAL JOIN` en cascada) se mantiene acotado — no se observó ningún error ni timeout en las 4 corridas del experimento. Podría crecer si se aplicara a selects con muchas relaciones simultáneas en la MISMA query (ej. si se intentara meter las 5 relaciones de `overview-details` — hoy repartidas en `Promise.all` — dentro de un único `findFirst` con todo anidado) — no se intentó ese escenario, sería un cambio de arquitectura mayor, no sólo activar el flag.
- **¿Depende de la versión exacta de Prisma?** Sí — es un *preview feature*, su comportamiento y disponibilidad pueden cambiar entre versiones de Prisma hasta que llegue a *General Availability*. Riesgo de mantenimiento si el proyecto sube de versión mayor de Prisma en el futuro (revisar el *changelog* de `relationJoins` en cada upgrade).
- **¿Es seguro en Neon/PostgreSQL?** Sí — soportado oficialmente para PostgreSQL, y este experimento lo corrió contra el Neon real de este proyecto (no un mock/simulación) en 4 corridas independientes, sin errores.
- **¿Hay plan de rollback simple?** **Sí, extremadamente simple** — ya demostrado en esta misma etapa: `git checkout -- prisma/schema.prisma <archivos tocados>` + `npx prisma generate`. No hay migración de base de datos, no hay cambio de schema de tablas, no hay dato persistido en un formato distinto — es 100% reversible sin ningún riesgo de pérdida de datos.

---

## 7. Recomendación final

### **Resultado C — Recomendado parcial/experimental, con evidencia fuerte a favor**

No es un Resultado A puro porque quedan preguntas abiertas sin probar (RBAC con los 3 `accessWhere` reales, `_count`, `$transaction`, paginación, `orderBy` anidado, relaciones *to-many* de alta cardinalidad — todas señaladas en §6) — activarlo hoy de forma amplia sin probar esos casos sería prematuro. Pero tampoco es un Resultado B: la evidencia medida es contundente (mejoras de 60-87% en los 3 candidatos reales, shape idéntico, 1112/1113 tests, único fallo mecánico y trivial de corregir, rollback comprobado en 1 comando) — descartarlo del todo también sería ignorar la evidencia.

**Se propone una Etapa 14D.7 de implementación limitada, no un rollout global**: activar `previewFeatures = ["relationJoins"]` y `relationLoadStrategy: "join"` **únicamente en las 4 queries ya identificadas y medidas acá** (sector chain de `overview-details`, las 2 de `position-validation`, `positions/options`) — exactamente el mismo alcance de este diagnóstico, no extendido a `_count`/paginación/`$transaction` hasta probarlos por separado.

### Plan de implementación para 14D.7 (si se aprueba)

1. Agregar `previewFeatures = ["relationJoins"]` al `generator client` de `schema.prisma`.
2. Correr `npx prisma generate`.
3. Agregar `relationLoadStrategy: "join"` a las 4 queries exactas de este diagnóstico (§3) — mismo diff ya probado acá.
4. Corregir el único test que rompe (`employees.repository.test.ts`, agregar `relationLoadStrategy: "join"` al objeto esperado de la aserción).
5. Correr la suite completa de backend (`npx prisma validate`, `typecheck`, `test`, `build`) — debe quedar en 1113/1113.
6. Re-correr `npm run perf:journey:employees` (frontend) para confirmar la mejora end-to-end (HTTP completo, no sólo repositorio) y actualizar `docs/performance/EMPLOYEES_PERFORMANCE_JOURNEY_14D1.md`/`.json`.
7. Validar explícitamente los 3 `accessWhere` de RBAC (RRHH/Supervisión/Admin Carga) contra `overview-details`/`position-validation` con datos reales de cada rol — pendiente de esta etapa, requisito antes de considerar 14D.7 cerrada.
8. Commit específico y acotado a estos archivos (`schema.prisma` + 2 repositorios + 1 test), con su propio documento de decisión referenciando este diagnóstico.

### Plan de rollback (si algo sale mal en 14D.7 o después)

1. Quitar `relationLoadStrategy: "join"` de las queries tocadas (o revertir el commit específico de 14D.7 completo).
2. Quitar `previewFeatures = ["relationJoins"]` de `schema.prisma`.
3. Correr `npx prisma generate`.
4. Revertir el ajuste del test de `employees.repository.test.ts`.
5. Sin migración de datos involucrada — rollback de sólo código, tan simple como el commit que lo introdujo.

### Alternativas si NO se avanza a 14D.7

- Seguir con selects livianos/queries manuales por endpoint (patrón ya usado en 14D.2.1/14D.3/14D.4) — funciona, pero cada mejora exige tocar un endpoint a la vez y sigue pagando N round-trips por cadena.
- Índices de base de datos — no diagnosticado en esta etapa (fuera de alcance), candidato a revisar si algún endpoint sigue lento incluso con `relationJoins`.
- Endpoints por pestaña / cache-dedupe (patrón ya usado en 14D.2/14D.5) — complementario, no sustituye la ganancia de colapsar round-trips.

---

## 8. Validaciones ejecutadas (estado final, limpio, sin cambios experimentales)

- Backend: `npx prisma validate` ✓, `npm run typecheck` ✓, `npm test` (1113/1113) ✓, `npm run build` ✓.
- Frontend: `npm run typecheck:e2e` ✓, `npm test` (607/607) ✓, `npm run build` ✓, `npm run perf:journey:employees` ✓ (corrida de confirmación post-revert — 56/56 acciones, 0 errores HTTP, 0 errores de consola; el archivo de reporte generado por esa corrida se revirtió también, ver §9, porque no aporta datos nuevos a esta etapa — la evidencia real de esta etapa es la tabla de §3).
- General: `git diff --check` limpio, `git status` limpio (sin cambios pendientes salvo el documento nuevo de esta etapa).

---

## 9. Qué quedó en el working tree / qué se revirtió

**Working tree final: sólo este documento nuevo.** Todo lo demás quedó exactamente igual a `HEAD` (commit `fea4d59`):

- `backend/prisma/schema.prisma`: modificado durante el experimento (`previewFeatures = ["relationJoins"]`), **revertido** con `git checkout --`.
- `backend/src/modules/employees/employees.repository.ts`: modificado durante el experimento (3 × `relationLoadStrategy: "join"`), **revertido**.
- `backend/src/modules/positions/positions.repository.ts`: modificado durante el experimento (1 × `relationLoadStrategy: "join"`), **revertido**.
- `backend/tmp-relationjoins-bench.ts` y sus 6 archivos de salida `tmp-bench-*.json`: script y capturas temporales de medición, **nunca commiteados, eliminados** al terminar.
- `docs/performance/EMPLOYEES_PERFORMANCE_JOURNEY_14D1.md`/`.json`: se regeneraron una vez como corrida de confirmación post-revert (§8) — **revertidos** también, porque esa corrida no mide nada nuevo de esta etapa (no hubo cambio de código que el journey deba reflejar) y dejarlos habría sido ruido sin valor agregado.

`git status` al momento de entregar esta etapa muestra únicamente: `docs/decisions/PRISMA_RELATION_JOINS_DIAGNOSTIC_14D6.md` (nuevo, sin trackear).
