# Etapa 14G.8 — Diagnóstico y optimización de Cierres mensuales (`/cierres`)

Fecha: 2026-09-08
Estado: **completa. Cache backend nueva + dedupe frontend (sin cambiar contrato/RBAC/reglas de negocio/diseño visual). Sin tocar Prisma schema, sin migraciones, sin escrituras ejecutadas, sin tocar `MonthlyClosuresPage.tsx` ni `employeeApiService.ts`.**
Alcance: backend del módulo `workforce-management` (`workforce.cache.ts`/`workforce.controller.ts`) para `GET /workforce/closures` y `GET /workforce/corrections`, y frontend (`workforceApiService.ts`/`cachePolicy.ts`) para los mismos 2 endpoints.

---

## 1. Contexto

14G.1 señaló Cierres mensuales como el único submódulo de Gestión horaria nunca medido antes de esa etapa diagnóstica, con dos hallazgos puntuales ya documentados: `closures` sin paginación real y `corrections` con `take:500` hardcodeado. Con Inicio, Asistencia, Carga de horas, Alertas de turnos, Notificaciones y Bandeja de revisión ya resueltos (14G.2-14G.7), esta etapa hace el diagnóstico y la optimización pendiente de Cierres mensuales.

## 2. Evidencia desde 14G.1-14G.7

- **14G.1** (`docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json`, corrida histórica): "Entrar a Cierres mensuales" nunca clasificó como Crítico/Lento en ninguna corrida — quedó consistentemente en rango Medio (1002-1567ms según la corrida), lo que explica por qué nunca apareció en el ranking prioritario de 14G.2-14G.7 (todos con Crítico/Lento más urgente en otros submódulos).
- **14G.5/14G.6/14G.7**: mismo patrón repetido con éxito 6 veces — endpoints sin `cachedData` frontend mostraban duplicado x2 por StrictMode en el journey. La corrida inmediatamente previa a esta etapa (generada en 14G.7) mostró exactamente eso para Cierres mensuales: `GET /workforce/closures` x2 (370ms/744ms) y `GET /workforce/corrections` x2 (370ms/741ms) dentro de la misma acción "Entrar a Cierres mensuales" — nunca corregido hasta ahora porque el submódulo no había tenido su propia etapa dedicada.
- **`docs/decisions/WORKFORCE_MANAGEMENT_PENDING_REVIEW_PERFORMANCE_14G7.md`** §14 (recomendación para 14G.8): señaló exactamente "Cierres mensuales (`GET /workforce/closures`/`GET /workforce/corrections`) — mostraron duplicado x2 en corridas anteriores (14G.1), nunca medidos antes de esa etapa ni revisados desde entonces" — el punto de partida directo de esta etapa.

## 3. Diagnóstico antes del cambio

**Endpoints disparados al entrar a `/cierres`** (confirmado leyendo `MonthlyClosuresPage.tsx` y el journey): `GET /workforce/notifications-unread-count` (AppShell, ajeno a este submódulo), `GET /employees/options`, `GET /workforce/closures?period=...`, `GET /workforce/corrections` — **los 3 propios del submódulo se disparan en paralelo**, ya desde antes de esta etapa: `load()` (Etapa 9B) usa `Promise.all([employeeApiService.getOptions(...), workforceApiService.closures(period), workforceApiService.corrections()])` — no hay ninguna secuencialidad ni dependencia artificial que remover.

- **`GET /workforce/closures`** (`workforceService.closures`): **una sola query** — `prisma.monthlyTimeClosure.findMany({ where: {period, employee: employeeAccessWhere(user)}, include: {employee:{select:...}, submittedBy:{select:{name}}, reviewedBy:{select:{name}}}, orderBy:{employee:{lastName:"asc"}} })`. **No usa `$transaction`** (ni forma array ni interactiva) — no hay nada que paralelizar dentro del propio endpoint. `include` ya recortado a los campos que la tabla muestra (legajo/nombre del empleado, nombre de quien envió/revisó) — sin over-fetch. Filtro por período y por scope, ambos en el `where` de Prisma, en DB.
- **`GET /workforce/corrections`** (`workforceService.corrections`): también **una sola query** — `prisma.timeCorrectionRequest.findMany({ where:{employee: employeeAccessWhere(user)}, include:{employee:{select:...}, timeEntry:{include:{hourConcept:true}}, createdBy:{select:{name}}}, orderBy:{createdAt:"desc"}, take:500 })`. Tampoco usa `$transaction`. `include: {hourConcept: true}` en `timeEntry` trae el modelo `HourConcept` completo (no sólo `name`, que es lo único que la tabla muestra) — over-fetch menor de **un solo registro relacionado** (no una lista, sin N+1) — mismo tipo de hallazgo ya identificado y explícitamente no tocado en 14G.7 para el mismo patrón en `time-entries`. No se corrigió acá tampoco: recortarlo a un `select` cambiaría el shape del JSON de esa sub-relación, prohibido sin autorización explícita.
- **¿`closures` trae todos los cierres del período sin paginar?** Confirmado — `findMany` sin `skip`/`take`, devuelve todos los `MonthlyTimeClosure` del período+scope. El volumen está acotado por la cantidad de legajos activos con cierre en un período dado (no crece con el tiempo como `TimeEntry`), así que el riesgo real es bajo hoy. Cambiar esto a paginado alteraría el contrato (`{data: MonthlyClosure[]}` → necesitaría `{data, meta}`), prohibido sin autorización explícita — queda documentado como candidato (§10), no aplicado.
- **¿`corrections` usa `take:500` hardcodeado y afecta la carga inicial?** Confirmado el `take:500` sin `skip`. El impacto medido en el journey (368-383ms por llamada) no lo señala como el cuello real de la acción — el filtro por período se aplica **en el frontend** (`pendingCorrections = corrections.filter(item => ... && item.timeEntry.date.slice(0,7) === period)`), así que el backend siempre trae hasta 500 correcciones de TODOS los períodos visibles para el usuario. Esto es candidato a mover el filtro de período al backend, pero **cambiaría el contrato** (nuevo query param `period` en `GET /workforce/corrections`) — no aplicado sin autorización explícita (§10).
- **Hallazgo real (causa raíz)**: **ninguno de los 2 endpoints tenía cache backend ni el frontend tenía dedupe in-flight** — `workforceApiService.closures`/`corrections` llamaban `apiRequest` directo (`{apiCache: false}`), sin pasar por `cachedData`. El doble-montaje de StrictMode disparaba 2 llamadas de red reales a cada uno, confirmado en el journey (§2 de este documento).
- **`corrections` no depende del período, pero se volvía a pedir en cada cambio de período** — `load()` está memoizado por `[period]` (`useCallback`), así que cambiar de período reinvoca la función completa, incluida la llamada a `corrections()` (que no tiene ningún parámetro) y a `employees/options` (`take:1000`, también sin relación con el período). Confirmado leyendo el componente línea por línea. No hacía falta reestructurar `MonthlyClosuresPage.tsx` para resolver esto — agregar cache frontend con TTL corto a `corrections()` logra el mismo resultado (un cambio de período dentro del TTL sirve el valor cacheado sin un request nuevo) sin tocar la arquitectura de efectos de la página — ver §5/§9.
- **`employees/options`**: confirmado que **ya tenía** dedupe/cache desde etapas previas de Legajos (14D.x) — ni un solo duplicado en el journey, ni antes ni después de esta etapa. No se tocó `employeeApiService.ts` (no era un cuello real, tal como advertía el alcance permitido del pedido).
- **¿Blanquea la tabla al cambiar de período?** No — confirmado que el guard de Etapa 9B (`if (!hasLoadedDataRef.current) setLoading(true)`) sigue intacto; cambiar de período o repetir `load()` tras aprobar/enviar/devolver no blanquea la sección.
- **¿Las invalidaciones actuales eran suficientes?** No existían (no había cache que invalidar). Se agregaron 6 invalidaciones nuevas en el backend y 5 en el frontend — ver §5/§9.

## 4. Causa raíz

**Ausencia total de cache backend y de dedupe frontend** en `GET /workforce/closures` y `GET /workforce/corrections` — ninguno de los 2 tenía el antipatrón `$transaction` (a diferencia de todos los endpoints corregidos en 14C.2/14G.2/14G.3/14G.5/14G.6/14G.7); el hallazgo real de esta etapa es distinto en naturaleza al de las etapas anteriores.

## 5. Cambios aplicados

### Backend — `backend/src/modules/workforce-management/`

1. **`workforce.cache.ts`** — `closuresCache`/`correctionsCache` (`createTtlCache`, 15s cada uno) + `clearMonthlyClosuresReadCaches()` que limpia ambos juntos.
2. **`workforce.controller.ts`** — `closures`/`corrections` ahora usan `userScopedCacheKey(req)` (helper local ya existente) + `get/set` sobre la cache correspondiente, mismo patrón que `shiftTemplates`/`doubleRules`/`notifications`. Los 6 write paths que tocan `MonthlyTimeClosure`/`TimeCorrectionRequest` (`submit`, `approve`, `returnClosure`, `createCorrection`, `approveCorrection`, `rejectCorrection`) ahora llaman `clearMonthlyClosuresReadCaches()` tras la escritura real — `approveCorrection` ya invalidaba `time-entries`/`employees` (Etapa 9B), se le agregó esta invalidación nueva.

### Frontend — `frontend/src/services/cache/cachePolicy.ts` y `frontend/src/services/api/workforceApiService.ts`

3. **`cachePolicy.ts`** — nueva familia `"monthly-closures"` y 2 políticas (`monthlyClosuresList`, `timeCorrectionsList`), ambas TTL 15s, misma familia a propósito (ver §9).
4. **`workforceApiService.closures`/`corrections`** — envueltos con `cachedData` (dedupe in-flight, mismo mecanismo que el resto del proyecto).
5. **`workforceApiService.submitClosures`/`approveClosures`/`returnClosure`/`createCorrection`/`reviewCorrection`** — ahora invalidan la familia `"monthly-closures"` tras la escritura real (además de la invalidación de `"dashboard"` que `reviewCorrection` ya tenía en su rama `approve`, sin cambios).

No se tocó `MonthlyClosuresPage.tsx` (diagnóstico confirmó que ya estaba correctamente estructurado: `Promise.all`, guard de loading correcto) ni `employeeApiService.ts` (`employees/options` no era un cuello real, ya deduplicado desde antes).

## 6. Qué NO se cambió

- Método, ruta, query params (`period` en `closures`; sin params en `corrections`) — sin cambios.
- Shape del JSON de respuesta en ambos endpoints — intacto (`{data: MonthlyClosure[]}` / `{data: TimeCorrection[]}`, sin envolver en `{data, meta}`).
- Estados de cierre (`ABIERTO`/`ENVIADO`/`APROBADO`/`DEVUELTO`/`CORRECCION_PENDIENTE`), reglas de aprobación/envío/devolución de cierres — sin cambios de lógica de negocio.
- Reglas de aprobación/rechazo de correcciones, incluida la actualización de `MonthlyTimeClosure.status` cuando corresponde (`approveCorrection`) — sin cambios.
- Período seleccionado, filtro de período de correcciones (sigue aplicado en el frontend, sin mover al backend) — sin cambios.
- Scope del usuario (`employeeAccessWhere`), permisos (`requireAnyRole`), visibilidad por nivel (RRHH ve todos los cierres del período; Nivel 2/3 ven sólo los propios vía `rows`) — sin cambios.
- Comportamiento de tablas/cards, loading/error/empty states — sin cambios (el guard de 9B ya era correcto).
- `include: {hourConcept: true}` en `corrections` (over-fetch menor identificado en §3) — no se tocó, cambiar a `select` alteraría el shape del JSON, prohibido sin autorización.
- Paginación de `closures` y filtro de período de `corrections` en backend (§10) — no se tocaron, cambiar cualquiera de los dos altera el contrato.
- **No se ejecutó ninguna escritura real** — todos los tests que ejercen `submit`/`approve`/`returnClosure`/`createCorrection`/`approveCorrection`/`rejectCorrection` lo hacen contra el service/repository mockeados, nunca contra la base real; el journey de performance sigue saltando esas 2 acciones explícitamente.
- Fichador, Inicio/home-summary, Asistencia, Carga de horas, Alertas de turnos, Notificaciones, Bandeja de revisión — ningún archivo de esos módulos se tocó.

## 7. Contrato de API preservado

Ruta, método, query params, estructura y campos del JSON de respuesta, status codes: **sin cambios** en ninguno de los 2 endpoints. Verificado con 5 tests nuevos de servicio (fijan `where`/`orderBy`/`take` exactos, sin transformar el shape) y 14 tests nuevos de controller (fijan que la respuesta cacheada es igual a la del service, en ambos endpoints).

## 8. RBAC/scope preservado

`requireAnyRole(operationalRoles)` sin cambios en ninguna de las 8 rutas del submódulo. `employeeAccessWhere(user)` se sigue calculando igual y se sigue pasando a ambas queries de lectura — verificado con tests que confirman el filtro de scope en el `where`. La cache está scopeada por `userScopedCacheKey` (`userId:role:originalUrl`) — verificado con tests que confirman que dos usuarios (incluso con el mismo período, en el caso de `closures`) nunca comparten el resultado cacheado del otro.

## 9. Cache/dedupe/loading

- **TTL**: 15.000ms (15s) en ambas capas (backend y frontend) — dentro del rango 10-20s pedido, mismo TTL ya usado por la mayoría de las listas operativas del proyecto.
- **Key backend**: `userScopedCacheKey(req)` = `${userId}:${role}:${originalUrl}` — el `period` de `closures` ya forma parte de `originalUrl`, así que cada período de cada usuario es una entrada distinta; `corrections` no tiene query params, así que su key es estable por usuario+rol (una sola entrada por usuario).
- **Key frontend**: `GET:/workforce/closures?period=<periodo>` / `GET:/workforce/corrections`, dentro de la familia `"monthly-closures"`, además scopeados automáticamente por usuario/rol/empresa/sector vía `buildCacheKey`/`currentUserHash()` (mecanismo ya existente).
- **Por qué la misma familia para los 2**: `corrections` no depende del período — compartir familia con `closures` no cambia su invalidación (sigue limpiándose junto con `closures` en cada escritura real), pero sobre todo logra el objetivo del candidato 5 del pedido ("si `corrections` no depende del período, evitar re-pedirlo al cambiar período") **sin tocar `MonthlyClosuresPage.tsx`**: dentro del TTL de 15s, cambiar de período vuelve a pedir `closures(nuevoPeriodo)` (cache miss real, correcto) pero `corrections()` sirve el valor cacheado (cache hit, sin request nuevo) — confirmado con un test dedicado (`workforceApiService.test.ts`, "corrections: no se vuelve a pedir aunque closures() cambie de período en el medio").
- **Invalidación — conjunto de escritura cerrado y verificado exhaustivamente**: a diferencia de `notificationsListCache` (14G.6) y `shiftAlertListCache` (14G.5) — donde el conjunto de write paths no era cerrado y quedó un hueco de invalidación aceptado como riesgo — acá **sí es un conjunto cerrado**: confirmado con `grep` exhaustivo en todo `backend/src` que las únicas 6 funciones de todo el backend que escriben `MonthlyTimeClosure`/`TimeCorrectionRequest` son `submitClosures`/`approveClosures`/`returnClosure`/`createCorrection`/`approveCorrection`/`rejectCorrection`, las 6 en este mismo archivo (`workforce.service.ts`). Las 6 invalidan `clearMonthlyClosuresReadCaches()` en el backend; los 5 métodos equivalentes de `workforceApiService.ts` (todos menos `approveCorrection`, que llama a `reviewCorrection`) invalidan la familia `"monthly-closures"` en el frontend. **Sin ningún hueco de invalidación aceptado como riesgo** — mejor cobertura que las 2 caches anteriores de esta serie.
- **No se cachean escrituras** — ninguno de los 6 write paths pasa por `closuresCache`/`correctionsCache`, sólo las invalidan.
- **Loading**: sin cambios — el guard de Etapa 9B (`hasLoadedDataRef`) sigue intacto, sin blanking.

## 10. Paginación

- **`GET /workforce/closures` sin paginación real**: confirmado (§3) — `findMany` sin `skip`/`take`. **No se corrigió**: el volumen está naturalmente acotado por la cantidad de legajos activos con cierre en un período (no crece indefinidamente como una tabla de eventos), y agregar paginación cambiaría el shape de la respuesta (`{data: MonthlyClosure[]}` → necesitaría un wrapper `{data, meta}` como el resto de los endpoints paginados del proyecto) — un cambio de contrato explícitamente prohibido sin autorización en esta etapa. **Diseño propuesto para una etapa futura** (si se autoriza): agregar `page`/`take` opcionales con default `take` alto (p. ej. 500, igual criterio que `corrections`) para no romper consumidores existentes, envolver en `{data, meta}` como `GET /time-entries`, y actualizar `MonthlyClosuresPage.tsx` para leer `result.items`/`result.meta` en vez de un array plano.
- **`GET /workforce/corrections` con `take:500` hardcodeado, sin filtro de período en backend**: confirmado (§3). **No se corrigió** por la misma razón — agregar un `period` query param sería aditivo (no rompe compatibilidad hacia atrás, ya que sería opcional), pero mover el filtro que hoy vive en el frontend (`pendingCorrections`) al backend es una decisión de contrato que excede "sólo cache/selects" y no se tomó sin autorización explícita. **Diseño propuesto para una etapa futura** (si se autoriza): agregar `period?: string` opcional a `listNotificationsQuerySchema`-equivalente para corrections, aplicarlo en el `where` de Prisma, y ajustar el `requestKey` de la cache frontend para incluirlo (ya sería automático si se pasa como query param, mismo patrón que `closures`).
- Como alternativa seguía y sin cambiar contrato, se optimizó cache/dedupe (§5/§9) — la mejora medida (§12) confirma que esto ya resuelve el problema real de esta etapa (duplicados) sin necesidad de tocar paginación.

## 11. Tests

Backend, **19 tests nuevos** en `workforce-management` (todos los tests del módulo pasando, 90/90 en los 2 archivos):
- `workforce.service.test.ts` (+5): `closures` filtra por período+scope, ordena por apellido, devuelve el shape sin transformar; `corrections` filtra por scope sin período, pide `take:500` ordenado por fecha de creación descendente.
- `workforce.controller.test.ts` (+14, cache real sin mockear): hit/miss de `closures` (por período) y `corrections`; key scopeada por usuario en ambos; invalidación real end-to-end desde los 6 handlers de escritura (`submit`/`approve`/`returnClosure`/`createCorrection`/`approveCorrection`/`rejectCorrection`); confirmación de que `approveCorrection` invalida `closuresCache` además de `correctionsCache` (por el efecto colateral sobre `MonthlyTimeClosure.status`).

Frontend, **12 tests nuevos/modificados** en `workforceApiService.test.ts`: dedupe in-flight de `closures`/`corrections` (2 llamadas concurrentes → 1 request real), cache dentro del TTL para ambos, cache-miss al cambiar de período en `closures`, confirmación explícita de que `corrections` **no** se vuelve a pedir aunque `closures` cambie de período en el medio (el objetivo real de compartir familia), invalidación de `"monthly-closures"` desde los 5 métodos de escritura del frontend, contrato preservado; se ajustó 1 test preexistente (`reviewCorrection` — "al rechazar, NO invalida..." pasó de "no invalida nada" a "no invalida específicamente dashboard", ya que ahora sí invalida `monthly-closures` correctamente).

No se agregaron tests nuevos en `MonthlyClosuresPage.test.tsx` — el componente no se tocó, y sus 2 tests existentes (Etapa 9B) mockean `workforceApiService` a nivel de módulo, así que no se ven afectados por el cambio de implementación interna; siguen pasando sin modificación.

Ningún test depende de tiempos exactos.

## 12. Métricas antes/después

Fuente: `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json`, 1 corrida antes del cambio (14G.7) + 2 corridas después (para confirmar estabilidad).

| Métrica | Antes (14G.7) | Después (14G.8, 2 corridas) | Mejora |
|---|---|---|---|
| "Entrar a Cierres mensuales" — `visibleMs` | 74-80ms | 79ms | ~igual (ya era rápido) |
| "Entrar a Cierres mensuales" — `networkIdleMs` | **1307ms (Medio, tope alto)** | **939-1122ms (Medio, tope bajo)** | **~14-28%** |
| `GET /workforce/closures` (por llamada) | 370ms y 744ms (x2, duplicado) | 353-366ms (x1, sin duplicado) | **~1 llamada eliminada por completo** |
| `GET /workforce/corrections` (por llamada) | 370ms y 741ms (x2, duplicado) | 368-383ms (x1, sin duplicado) | **~1 llamada eliminada por completo** |
| `GET /employees/options` | 371ms (x1, ya sin duplicado) | 369-558ms (x1) | Sin cambios — ya estaba deduplicado |
| Requests totales de la acción | 6 | 4 | ~33% menos tráfico |
| Duplicados en "Entrar a Cierres mensuales" | Sí (`closures` x2, `corrections` x2) | No (0 en ambas corridas) | Eliminados |
| "Cambiar período (Cierres mensuales)" | 0 requests capturados por el journey (99ms) en la corrida previa | 0 requests capturados (98-98ms) | Sin cambios visibles vía el journey — el propio journey no captura ninguna llamada de red distinguible en esta acción específica en ninguna corrida (antes ni después); no atribuible a este cambio |
| Ranking — submódulo "E. Cierres mensuales" | Medio (1307ms máx.) | Medio, tope más bajo (939-1122ms máx.) | Mejora dentro del mismo rango |
| HTTP errors / console errors / escrituras ejecutadas | — | 0 / 0 / 0 (ambas corridas) | — |

## 13. Riesgos pendientes

- **Ventana de cache de 15s** (frontend y backend) — mismo criterio ya aceptado para el resto de las listas operativas del proyecto; acá con cobertura de invalidación completa (§9), sin hueco aceptado.
- **`closures` sin paginación real** y **`corrections` con `take:500` sin filtro de período en backend** (§10) — riesgos ya documentados desde 14G.1, evaluados en esta etapa, no corregidos por requerir un cambio de contrato fuera de alcance sin autorización explícita. Diseño propuesto queda documentado para una etapa futura si se autoriza.
- **`include: {hourConcept: true}`** en `corrections` — over-fetch menor de un registro relacionado, mismo criterio ya aceptado en 14G.7 para un patrón equivalente.
- **"Cambiar período (Cierres mensuales)" no medible por el journey** — el propio journey no capturó ninguna llamada de red distinguible para esta acción específica, ni antes ni después de este cambio; no es atribuible a esta etapa (mismo comportamiento en la corrida de referencia).
- Journey de un solo usuario sin concurrencia — no reemplaza métricas de producción bajo carga real.

## 14. Recomendación para 14G.9

Con Inicio, Asistencia, Carga de horas, Alertas de turnos, Notificaciones, Bandeja de revisión y Cierres mensuales revisados, los candidatos con evidencia ya recolectada son:

1. **A. Inicio** (`GET /time-entries/home-summary`) — sigue mostrando duplicado x2 por StrictMode en corridas recientes (14G.7/14G.8), nunca corregido desde 14G.2 (esa etapa sólo resolvió el `$transaction`, dejando el dedupe frontend documentado como pendiente).
2. **B. Asistencia** — reapareció en rango Lento en la corrida de esta etapa (2056ms), con duplicados ya conocidos de `attendance/observations`/`attendance` desde 14G.1, parcialmente atendidos en 14G.3 pero con el dedupe de StrictMode todavía sin corregir en el `useEffect` de carga inicial.
3. Con estos 2 últimos candidatos de duplicados por StrictMode y los 10 submódulos de Gestión horaria ya revisados al menos una vez, sería razonable considerar 14G.9 como una etapa de "barrido final de duplicados" (aplicando el mismo patrón `cachedData` ya usado 7 veces en esta serie a los 2-3 endpoints que todavía los muestran) antes de cerrar la serie 14G completa.
