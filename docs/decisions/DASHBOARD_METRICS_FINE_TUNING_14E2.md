# Etapa 14E.2 — Optimización fina de `GET /api/dashboard/metrics` en frío

Fecha: 2026-09-07
Estado: implementado, validado, **pendiente de aprobación para commitear**
Referencia obligatoria: `docs/decisions/DASHBOARD_METRICS_PERFORMANCE_14E1.md` (14E.1 cerró la inestabilidad/500; esta etapa continúa desde ahí, sin reabrir esa parte). Commit base: `3101f59`.
Alcance: exclusivamente `GET /api/dashboard/metrics` (`dashboard.service.ts`/`dashboard.repository.ts`). Sin cambios de schema, contrato, reglas funcionales ni RBAC.

---

## 1. Diagnóstico (Parte 1 del pedido)

Revisados antes de tocar código: `dashboard.service.ts`, `dashboard.repository.ts`, `dashboard.service.test.ts`, `dashboard.repository.test.ts`, `dashboard.cache.ts`, `DASHBOARD_METRICS_PERFORMANCE_14E1.md`, `PERFORMANCE_STANDARDS.md`.

**La sospecha inicial del pedido no se confirmó.** Se midieron las 14 queries de `calculateMetrics` de forma individual y aislada (no en batch, para no mezclar costo propio con espera de lote), con un script temporal (`tmp-14e2-query-bench.ts`, eliminado al terminar) contra el mismo `accessWhere`/período reales, **2 corridas independientes**:

| Query interna | Corrida A (min/avg/max) | Corrida B (min/avg/max) | Comentario |
|---|---|---|---|
| `Employee.groupBy(status)` | 164/675/1642 | 164/690/1703 | Outlier siempre en el 1er llamado del proceso — efecto de conexión fría, no del costo real de la query (mismo patrón ya documentado en 14D.6/14D.7/14E.1). |
| `Novelty.count(pending)` | 166/274/460 | 162/230/347 | — |
| `Employee.findMany(transportedEmployees)` | 169/259/395 | 200/273/412 | 12 filas, 2 relaciones (1 nivel c/u). |
| `Employee.count(missingTimeResponsible)` | 164/257/433 | 206/254/350 | — |
| `Novelty.findMany(absenceRanges)` | 167/255/392 | 163/262/439 | 0 filas en el período probado. |
| `EmployeeDocument.count(expired)` | 169/251/372 | 168/275/412 | — |
| `Employee.count(inReview)` | 172/245/340 | 165/225/340 | — |
| `Employee.count(exitsThisYear)` | 161/235/383 | 176/249/382 | — |
| **`Employee.findMany(activeDashboardEmployees)`** | **177/235/350** | **173/270/428** | 32 filas, 3 relaciones (1 nivel c/u) — **la "sospecha inicial", no resultó ser la más pesada en ninguna de las 2 corridas.** |
| `Employee.count(withEntries)` | 163/230/342 | 167/223/335 | — |
| `Employee.count(transported)` | 168/227/344 | 163/232/366 | — |
| `TimeEntry.aggregate(loadedHours)` | 165/227/348 | 163/226/339 | — |
| `Employee.count(withoutEntries)` | 166/226/344 | 197/275/374 | Eliminada en esta etapa (ver §3). |
| `EmployeeDocument.count(expiring)` | 167/180/206 | 161/202/239 | La más rápida en ambas corridas — sin explicación estructural clara, dentro del mismo rango de ruido que el resto. |

**Conclusión honesta**: excluyendo el outlier de conexión fría del primer query, **las 14 queries caen todas en el mismo rango de ~160-430ms**, sin ningún query consistentemente 2x o 3x más lento que el resto en ninguna de las 2 corridas. `findActiveDashboardEmployees` (la sospecha inicial) terminó **en el medio de la tabla**, no en el extremo — el volumen real (32 filas activas, 12 transportadas, en este entorno de staging) es demasiado bajo para que el costo de sus relaciones domine sobre la latencia fija de red a Neon (que es el verdadero piso de cada query individual, confirmado en toda la serie 14C-14E). No se fuerza una optimización de "reducir select" (Opción A) sobre una query que ya está en el select mínimo que usa (verificado campo por campo contra `dashboard.service.ts`, ver §2) y que no es la más lenta.

### 1.1 Verificación de que no hay campos de más

`findActiveDashboardEmployees` — 5 escalares + 3 relaciones de 1 nivel cada una, **todos usados**: `birthDate` (edad/cumpleaños), `laborMovements[0].effectiveFrom`/`createdAt` (antigüedad), `sector.name` (breakdown por sector), `companies` (breakdown por empresa), `id`/`firstName`/`lastName` (lista de cumpleaños). `findTransportedEmployees` — 2 relaciones de 1 nivel, ambas usadas (`address.city`/`transport.locality` para transportByCity, `transport.busLine` para transportRoutes). **No había select de más que recortar** — Opción A descartada por falta de evidencia, no por pereza.

### 1.2 `relationLoadStrategy: "join"` probado y descartado (con evidencia)

Dado que 14D.7 ya dejó `previewFeatures=["relationJoins"]` activo en `schema.prisma`, se probó temporalmente `relationLoadStrategy: "join"` en los 2 `findMany` con relaciones (`findActiveDashboardEmployees`, `findTransportedEmployees`) — **sin mejora medible**: `findActiveDashboardEmployees` pasó de 270ms a 255ms de promedio (dentro del ruido), `findTransportedEmployees` de 273ms a 276ms (sin cambio). A diferencia de la cadena `sector→area→establishment→businessUnit` de Legajos (3-4 niveles, ganancia de 60-87% en 14D.6/14D.7), estas relaciones de dashboard son de **1 solo nivel cada una** (hermanas, no encadenadas) — Prisma ya las resuelve de forma eficiente sin join a este volumen. **Cambio revertido, no aplicado** — no hay evidencia que lo justifique.

---

## 2. Query interna más pesada encontrada

**Ninguna, de forma concluyente.** Es el hallazgo central de esta etapa: a este volumen de datos (staging), el costo está dominado por la latencia fija de red a Neon (~160-400ms por round-trip), no por la complejidad de ninguna query individual. Esto es consistente con — y refuerza — el diagnóstico de 14E.1 (el problema real nunca fue el costo de una query puntual, sino la cantidad de round-trips concurrentes).

---

## 3. Solución aplicada

**Opción B (evidencia matemática, no heurística): `countEmployeesWithoutEntries` era exactamente el complemento lógico de `countEmployeesWithEntries`.**

Ambas queries parten del **mismo** `activeWhere(accessWhere)` y filtran por el **mismo** `timeEntries` anidado (`period` + `status: {in: [APROBADO, EN_REVISION]}`) — una con `some`, la otra con `none`. Para cualquier conjunto de empleados activos, "al menos uno" y "ninguno" sobre el mismo filtro son mutuamente excluyentes y conjuntamente exhaustivos — es decir, **`withEntries + withoutEntries === active` siempre**, no como aproximación sino como identidad matemática.

Verificado dos veces contra Neon real (no sólo en teoría): con el período actual (`withEntries=14, withoutEntries=18, active=32` → `14+18=32` ✓) y con un período sin ninguna carga (`withEntries=0, withoutEntries=32, active=32` → `0+32=32` ✓).

**Cambio**: se eliminó `dashboardRepository.countEmployeesWithoutEntries` y se derivó `pendingLoads = Math.max(0, active - employeesWithEntries)` en `calculateMetrics`, sin ninguna query adicional. Reduce el fan-out de **14 a 13** queries.

El `Math.max(0, ...)` es un piso defensivo (no un ocultamiento de error): estas 2 lecturas (`active` vía `countTotalAndActive`, `employeesWithEntries` vía `countEmployeesWithEntries`) siguen sin `$transaction` entre sí (mismo criterio ya aceptado en 14C-14E para datos de sólo lectura) — en una ventana de milisegundos entre ambas, un cambio de estado real simultáneo es teóricamente posible aunque nunca observado; el piso evita mostrar un número negativo sin sentido en ese caso extremo, sin fabricar un valor incorrecto (0 sigue siendo una lectura plausible, no inventada).

**Opciones evaluadas y descartadas**:
- **A (reducir select)**: sin evidencia, ver §1.1.
- **C (separar cálculo pesado)**: no aplica — ninguna query es "la pesada" a aislar.
- **D (ajustar batches)**: no hace falta más allá de lo ya hecho — al quitar 1 ítem de 14, la distribución de los 2 `findMany` en lotes distintos (1 y 3) se mantiene igual sin tocar nada.
- **E (cache interno de subresultado)**: no hay subresultado repetido dentro del mismo request que cachear.
- **F (índices)**: sin evidencia de que ninguna query individual sea lenta por falta de índice — no se diagnosticó ningún candidato concreto. Ver §7.

---

## 4. Archivos revisados

`dashboard.service.ts`, `dashboard.repository.ts`, `dashboard.service.test.ts`, `dashboard.repository.test.ts`, `dashboard.cache.ts` (sin cambios), `DASHBOARD_METRICS_PERFORMANCE_14E1.md`, `PERFORMANCE_STANDARDS.md` (sin cambios — no apareció ninguna regla transversal nueva que documentar ahí).

---

## 5. Cambios backend

- `dashboard.repository.ts`: eliminada `countEmployeesWithoutEntries` (con comentario explicando la redundancia matemática, referenciado desde `countEmployeesWithEntries`).
- `dashboard.service.ts`: `calculateMetrics` pasa de 14 a 13 tareas en el batch; `pendingLoads` se deriva después del batch (`active - employeesWithEntries`, con piso en 0). Comentario actualizado explicando el hallazgo de esta etapa (ninguna query desproporcionadamente pesada, relationLoadStrategy probado sin éxito, única reducción real aplicada).

## 6. Cambios frontend

Ninguno — no hizo falta (mismo shape, mismo contrato, cache/loading/error state de `DashboardPage.tsx` sin tocar).

---

## 7. Cantidad de queries antes/después

**14 → 13** (2 queries `countTotal`/`countActive` ya habían sido colapsadas en 1 `groupBy` en 14E.1; esta etapa elimina `countEmployeesWithoutEntries` por redundancia matemática).

## 8. Concurrencia antes/después

Sin cambios de fondo: sigue en lotes de máximo `DASHBOARD_METRICS_BATCH_SIZE` = **5** (`runInBatches`, sin tocar). Con 13 queries, la distribución de lotes queda 5+5+3 (antes 5+5+4) — los 2 `findMany` con relaciones siguen en lotes distintos (1 y 3), verificado con test (`nunca dispara más de 5 queries del repositorio en simultáneo`, sigue pasando con la lista de 13).

---

## 9. Shape / correctness (Parte 4 del pedido)

Comparación end-to-end real contra Neon (no sólo mocks): script temporal que llama `dashboardService.metrics()` con el mismo usuario/momento, capturando el JSON completo **antes** (`git stash`, código de `3101f59`) y **después** (código de esta etapa).

**Resultado: `diff` byte a byte idéntico.** Mismos 24 campos, mismos tipos, mismos valores (incluido `pendingLoads`, que dio el mismo número exacto derivado que el que la query eliminada habría devuelto), mismos arrays, mismo `period`. Script y JSON temporales eliminados al terminar.

---

## 10. RBAC / scope (Parte 5 del pedido)

Sin cambios — `employeeAccessWhere(user)` no se tocó, se sigue pasando igual a las 13 queries restantes. Cubierto por los tests ya existentes de 14E.1 (`RBAC/scope real pasado a las queries`, sin modificar, siguen pasando) que verifican que RRHH recibe `{}` y Supervisión recibe el `where` scopeado por `TIME_RESPONSIBLE`+`userId`. Misma limitación ya documentada en 14E.1: no hay sesiones reales de los 3 roles en este entorno — cubierto con tests unitarios de `employeeAccessWhere`/mocks, no con usuarios reales.

---

## 11. Tests agregados/modificados

`dashboard.repository.ts`: sin tests nuevos (la función eliminada no tenía test propio — sólo se ejercitaba indirectamente vía `dashboard.service.test.ts`).

`dashboard.service.test.ts`:
- Actualizado el mock/tipo/lista de funciones del repositorio (quitada `countEmployeesWithoutEntries`).
- Título y aserciones de la suite "13 queries en lotes" (antes decía 14).
- Corregida la aserción de `pendingLoads` en el test de "cada métrica llega al campo correcto" (ya no mockea la función eliminada, calcula el valor esperado a partir de `active - withEntries`).
- **Nueva suite dedicada** `pendingLoads derivado de active - employeesWithEntries` (6 tests): confirma que ya no se llama a `countEmployeesWithoutEntries`; caso normal; 0 empleados activos (no da negativo ni `NaN`); todos los activos con carga (`pendingLoads=0`); ningún activo con carga (`pendingLoads=active`); período sin ninguna carga registrada.

Total: **1148/1148 tests backend** (1142 previos de 14E.1 + 6 nuevos, netos tras corregir 2 en el lugar), 74 archivos.

---

## 12. Performance — antes/después (Parte 7 del pedido)

**Antes** = commit `3101f59` (14E.1, cerrado). **Después** = 3 corridas consecutivas de esta etapa, dev server reiniciado en frío antes de la primera.

| Métrica | Antes (`3101f59`) | Después (3 corridas) | Mejora | Comentario |
|---|---|---|---|---|
| `GET /api/dashboard/metrics` — status | 200 | 200 en 3/3 | Se mantiene la estabilidad de 14E.1 | Ninguna corrida devolvió 500. |
| `GET /api/dashboard/metrics` — duración | 4108ms (Crítico) | 2700ms / 1667ms / 1907ms (min 1667, avg 2091, max 2700) | **~34-59%** según la corrida | Pasa de Crítico (&gt;3000ms) a **Medio/Lento**, nunca Crítico en las 3 corridas — cumple el resultado ideal del pedido ("baja de Crítico a Lento o Medio"). |
| Cantidad de queries Prisma | 14 | 13 | -1 (-7%) | Ver §7. |
| Concurrencia máxima | 5 | 5 | Sin cambios | Se mantiene el batching de 14E.1. |
| "Login" — network idle | 6410ms (Crítico) | 4319ms (corrida 3, capturada completa) | **~33%** | Sigue en rango Crítico (&gt;3000ms) — el aterrizaje sigue sumando varios requests de ~900-1500ms cada uno (document-categories, auth/login, block-history, hour-concepts, audit, novelties), ninguno dominante por sí solo; no es atribuible sólo a dashboard/metrics. |
| Errores HTTP del recorrido completo | 0 | 0 en 3/3 | Sin cambios | 56/56 acciones cubiertas en las 3 corridas. |
| Errores de consola | 0 | 0 en 3/3 | Sin cambios | — |
| `dashboard/metrics` en Top 10 requests | 1er lugar (con 500 en corridas previas a 14E.1) | Sigue 1er lugar en 2/3 corridas, siempre 200 | Ya no es un error, sigue siendo de los más lentos | Consistente con que el piso de latencia de Neon domina — no hay más margen sin atacar esa latencia de base (fuera de alcance de esta etapa quirúrgica). |

No se inventó ningún número — los 3 valores de "después" están tal cual salieron de las 3 corridas reales, sin promediar para mostrar un resultado más prolijo. La variación entre 1667ms y 2700ms es ruido real de Neon, documentado igual que en toda la serie 14C-14E.

**Clasificación según Parte 7 del pedido**: **Resultado aceptable, tendiendo a ideal** — baja 34-59% (supera el mínimo de 20-30% pedido), sigue sin 500 en las 3 corridas, no cambia shape, y en 2/3 corridas queda en rango Medio (no Crítico ni Lento); la 3ª corrida (2700ms) queda en el borde de Lento. No se fuerza una mejora mayor inventando una optimización sin evidencia — el hallazgo honesto (§1-2) es que no hay más margen fácil de ganar sin atacar la latencia base de Neon (índices, o una infraestructura de conexión distinta), fuera del alcance quirúrgico de esta etapa.

---

## 13. Impacto en Login

Ver fila correspondiente en §12 — mejora real (~33%) pero la acción "Login" en su conjunto sigue en rango Crítico por la suma de varios requests del aterrizaje, no por dashboard/metrics en particular (que ya no es el dominante exclusivo, comparte el Top 10 con `document-categories`/`audit`/`block-history`/`hour-concepts`).

---

## 14. Riesgos

- **`pendingLoads` depende de una identidad matemática que asume que `activeWhere` es idéntico entre `countTotalAndActive` y `countEmployeesWithEntries`** — si alguna de las 2 funciones cambiara su `where` de forma independiente en el futuro sin actualizar la otra, la derivación dejaría de ser válida silenciosamente (no fallaría, daría un número sutilmente incorrecto). Mitigado con el comentario explícito en el código y con los 6 tests dedicados que fijan el comportamiento — pero es una dependencia implícita entre 2 funciones que un cambio futuro descuidado podría romper sin que ningún test lo capture si también se cambiara el test de forma incorrecta a la vez.
- **La mejora de tiempo (34-59%) no está atada a una causa estructural corregida** (a diferencia de 14E.1, que sí eliminó una causa concreta de saturación) — es principalmente el resultado de 1 round-trip menos más la variación normal de Neon. Una corrida futura podría mostrar un número dentro del mismo rango que antes de esta etapa, sin que eso sea una regresión.
- **`relationLoadStrategy` en dashboard queda descartado con evidencia de esta etapa, pero no re-evaluado si el volumen de datos crece sustancialmente** (más empleados activos/transportados) — el hallazgo de "no ayuda" es válido para el volumen actual de staging, no necesariamente para un headcount mucho mayor.

---

## 15. Rollback

1. Revertir `dashboard.repository.ts`/`dashboard.service.ts` a su estado de `3101f59` (o `git revert` de esta etapa).
2. Revertir `dashboard.service.test.ts` al mismo estado.
3. Sin migración de base de datos, sin cambio de cache, sin cambio de contrato — rollback de sólo código, igual de simple que en 14E.1.

---

## 16. Qué quedó pendiente

- Ningún índice candidato concreto — no se encontró evidencia de que alguna query específica sea lenta por falta de índice (todas caen en el mismo rango de latencia base). Si una futura medición con volumen de datos más alto muestra una query consistentemente más lenta que el resto, ahí sí correspondería un `EXPLAIN` dirigido — no en esta etapa.
- La latencia base de red a Neon (~160-400ms por round-trip) sigue siendo el piso real de este endpoint y de prácticamente todo el proyecto — no es atacable desde el código de una query individual; requeriría una etapa de infraestructura (pooling, ubicación de la base, etc.) fuera del alcance de Dashboard.
- "Login" (la acción del journey) sigue en rango Crítico por la suma de varios requests del aterrizaje — ninguno de ellos es dashboard/metrics de forma dominante; si se quisiera seguir bajando ese número, la próxima etapa debería mirar el conjunto de requests de esa acción (auth/login, document-categories, audit, hour-concepts, block-history), no sólo dashboard — explícitamente fuera del alcance "exclusivo de Dashboard" de esta etapa.

## 17. Qué NO se tocó

Legajos, Carga Horaria, Fichador, Turnos, Horas Especiales, Conceptos Horarios, Puestos, schema/migraciones, contrato público de `GET /dashboard/metrics`, reglas funcionales de métricas, RBAC, `dashboard.cache.ts`, frontend (`DashboardPage.tsx`, `dashboardMetricsApiService.ts`, `cachePolicies.dashboardMetrics`), el batching de 14E.1 (`runInBatches`, tamaño 5, sin tocar), `docs/PERFORMANCE_STANDARDS.md` (sin regla transversal nueva que agregar).
