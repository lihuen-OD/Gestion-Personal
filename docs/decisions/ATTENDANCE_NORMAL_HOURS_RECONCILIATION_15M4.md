# Etapa 15M.4 — Reconciliación histórica segura de Hora normal desde WorkShift/TimeSegment

Fecha: 2026-09-17
Estado: implementado, testeado, **repair ejecutado contra datos reales para legajo 30/2026-09 con aprobación explícita del usuario**; el resto de los empleados afectados queda pendiente de una corrida separada
Continúa: `docs/decisions/ATTENDANCE_TIME_GRID_REAL_DATA_FIX_15M3.md` (diagnóstico + fix de código), `docs/decisions/ATTENDANCE_AUTO_BREAKDOWN_SYNC_15M2.md`

## 1. Resumen ejecutivo

La Etapa 15M.3 corrigió el bug de código (Etapa 13F) que podía perder o duplicar minutos de `TimeEntry` NORMAL_BASE al cerrar una jornada con más de un `TimeSegment` por fecha. Esta etapa construyó y ejecutó la herramienta de reconciliación de los datos **ya corrompidos por ese bug antes del fix**: un dry-run global (sólo lectura) confirmó que el problema no era exclusivo de legajo 30 — **10 empleados con actividad en 2026-09, 12 de 26 fechas con alguna inconsistencia** (3 `UNDERCOUNT`, 1 `OVERCOUNT`, 8 `DUPLICATE`, 0 `MISSING_TIME_ENTRY`, 0 `MIXED_STATUS`, 0 `LEGACY_INCONSISTENT`). Con aprobación explícita del usuario tras revisar el dry-run, se ejecutó el **repair real sólo para legajo 30** (14/09, 15/09, 16/09) — el 16/09 pasó de 61 min (1.02h) a 250 min (4.17h) reales, y Motor B regeneró correctamente el desglose "Prueba" (120 min) para ese día. El resto de los empleados/fechas detectados quedan **sin tocar**, documentados acá, para una corrida separada cuando se apruebe explícitamente.

## 2. Estado Git

`main`, 0 ahead/0 behind. Etapas 15M.2 y 15M.3 seguían sin commitear al empezar esta etapa — se preservaron íntegras, sin `reset`. Esta etapa suma sus propios archivos nuevos sobre ese mismo estado sin tocar nada de lo anterior.

## 3. Fuente de verdad elegida

`expectedNormalMinutes(employeeId, date) = Σ TimeSegment.minutes` de todos los `TimeSegment` de ese `employeeId`/fecha calendario cuyo `WorkShift.status = "PROCESADO"` — exactamente el criterio pedido (§3 del encargo): ya respeta cross-midnight (cada `TimeSegment` tiene su propia fecha calendario), representa minutos reales persistidos, y es la misma fuente que ya usa Asistencia. **Nunca se usa el propio `TimeEntry` NORMAL_BASE actual como fuente** — sólo se lee para comparar `actual` vs `expected` (§4 del encargo).

## 4. Herramienta creada

Módulos nuevos (`backend/src/modules/time-entries/`):
- `normalHoursReconciliation.ts` — lógica pura: `classifyNormalHoursDiscrepancy`, `pickCanonicalEntry`, `rankApprovalStatus`, `requiresRepair`. Sin acceso a base, 100% unit-testeable.
- `normalHoursReconciliation.repository.ts` — lecturas Prisma (dry-run y resolución de alcance). El filtro `workShiftId: { not: null }` en la consulta de `TimeEntry` es deliberado: excluye por completo cualquier carga manual pura (sin turno asociado) — este módulo nunca toca ni siquiera lee esas filas.
- `normalHoursReconciliation.service.ts` — orquesta `dryRun`/`repair`: transacción por `employee+fecha`, control de concurrencia optimista, auditoría, recálculo de Motor B, invalidación de caché.
- `backend/scripts/reconcile-normal-hours.ts` — CLI (no HTTP): `--mode=dry-run|repair`, `--employee-legajo`, `--period`, `--date`, `--snapshot-dir`. Mismo patrón ya establecido en este repo por `scripts/reconcile-clock-orphans.ts` (guard `env.APP_ENV !== "staging"` para `--mode=repair`, salida JSON por stdout).
- `backend/src/shared/datetime/argentinaTime.ts` — nueva función exportada `periodCalendarBounds(period)`, límites UTC puros (sin corrimiento ART) para filtrar columnas `@db.Date` ya normalizadas (`TimeEntry.date`/`TimeSegment.date`) — distinta de `argentinaPeriodBounds` (que sí corrige +3h porque filtra `WorkShift.startAt`, un instante real).

No se creó ningún endpoint HTTP — es una herramienta técnica interna, no expuesta a usuarios operativos, tal como pedía el encargo.

## 5. Default seguro

Si `--mode` falta o tiene cualquier valor distinto de exactamente `"repair"`, el script cae en `dry-run` — nunca se asume repair por un flag mal escrito o ausente. El modo `repair` además exige `env.APP_ENV === "staging"` (mismo guard ya usado por `reconcile-clock-orphans.ts`) — se niega a correr en cualquier otro entorno.

## 6. Dry-run legajo 30 (real, ejecutado)

```
npx tsx scripts/reconcile-normal-hours.ts --mode=dry-run --employee-legajo=30 --period=2026-09
```

| Fecha | WorkShift/TimeSegment esperado | TimeEntry actual (filas) | Clasificación |
| --- | --- | --- | --- |
| 01/09 | 72 min | 72 min (1 fila) | OK |
| 02/09 | 0 min | 0 min (1 fila, `actualMinutes: null`, sin `timeSegmentId` — turno sin segmentos, legado, no requiere acción) | OK |
| 14/09 | 601 min | 601 min (**2 filas**: 421 + 180) | DUPLICATE |
| 15/09 | 443 min | 443 min (**2 filas**: 180 + 263) | DUPLICATE |
| **16/09** | **250 min** | **61 min (1 fila)** | **UNDERCOUNT** |

3 de 5 fechas requerían reparación — coincide exactamente con lo ya diagnosticado manualmente en la Etapa 15M.3.

## 7. Dry-run global septiembre 2026 (real, ejecutado)

```
npx tsx scripts/reconcile-normal-hours.ts --mode=dry-run --period=2026-09
```

10 empleados con actividad, 26 fechas evaluadas, **12 requieren reparación**:

| Legajo | Fecha | Clasificación | Expected | Current | Diferencia |
| --- | --- | --- | --- | --- | --- |
| 09 | 01/09 | OVERCOUNT | 643 | 660 | +17 |
| 09 | 02/09 | DUPLICATE | 432 | 432 | 0 |
| 10 | 02/09 | DUPLICATE | 662 | 662 | 0 |
| 10 | 03/09 | DUPLICATE | 433 | 433 | 0 |
| 27 | 02/09 | UNDERCOUNT | 961 | 523 | -438 |
| 27 | 03/09 | DUPLICATE | 435 | 435 | 0 |
| 29 | 16/09 | UNDERCOUNT | 247 | 57 | -190 |
| 30 | 14/09 | DUPLICATE | 601 | 601 | 0 |
| 30 | 15/09 | DUPLICATE | 443 | 443 | 0 |
| 30 | 16/09 | UNDERCOUNT | 250 | 61 | -189 |
| 32 | 02/09 | DUPLICATE | 651 | 651 | 0 |
| 32 | 03/09 | DUPLICATE | 433 | 433 | 0 |

Confirma que el bug de la Etapa 13F es **sistemático**: cualquier empleado que fichó jornadas con más de un `TimeSegment` de la misma fecha entre el 2026-09-02 (regresión) y la corrección de 15M.3 quedó potencialmente afectado. Legajo 29 tiene un patrón casi idéntico a legajo 30 (mismo día 16/09, misma magnitud de pérdida) — probablemente el mismo concepto "Prueba" habilitado. Legajo 09 y 27 muestran que el bug también produce `OVERCOUNT` (no sólo `UNDERCOUNT`/`DUPLICATE`) según el orden exacto en que los tramos se procesaron — consistente con el mecanismo "última escritura gana" documentado en 15M.3 §19.

## 8-11. Fechas afectadas de legajo 30

Ver tabla de §6. Las tres fechas (14, 15 y 16 de septiembre) fueron las únicas de legajo 30 que necesitaban reparación.

## 12. Expected vs current — resumen

Ver tabla de §6/§7. Todos los `DUPLICATE` de este dataset tienen `expected === current` (la suma de las filas duplicadas ya es correcta — el problema es estructural, no de minutos perdidos); los `UNDERCOUNT`/`OVERCOUNT` sí representan minutos realmente perdidos o de más.

## 13. Duplicados

8 grupos duplicados en el período, todos con exactamente 2 filas activas por fecha, todas `APROBADO` (nunca `MIXED_STATUS` en este dataset real). Ninguno se borró — ver política de consolidación en §16.

## 14. Mixed statuses

Cero casos reales de `MIXED_STATUS` en septiembre 2026 (todas las filas de fichador quedan `APROBADO` por diseño, ver 15M.3 §21). La lógica de clasificación/reparación para `MIXED_STATUS` existe y está testeada (mismo tratamiento que `DUPLICATE`), pero no tuvo ningún caso real que ejercitar en esta corrida.

## 15. Missing rows

Cero casos de `MISSING_TIME_ENTRY` en el dataset real de septiembre 2026 — no hubo ninguna fecha con `WorkShift`/`TimeSegment` válidos sin ningún `TimeEntry` NORMAL_BASE correspondiente. La lógica de creación (incluido el guard defensivo de §17) está implementada y testeada, sin caso real que la dispare todavía.

## 16. Política canonical

Implementada exactamente como pedía el encargo (§11):
1. Si ya existe **una sola** fila activa (`totalMinutes != 0`) entre las físicas de esa fecha, esa sigue siendo la canónica — preserva continuidad entre corridas sucesivas (idempotencia).
2. Si hay **más de una** fila activa (duplicado real, primera reparación), se elige por **estado más avanzado** (`CERRADO > APROBADO > EN_REVISION > DEVUELTO > PENDIENTE > BORRADOR > RECHAZADO`, ranking documentado en el código) y, en empate, por **`createdAt` más antiguo**.
3. La canónica se actualiza a `hours/totalMinutes/actualMinutes = expectedMinutes`, con `period`/`day` recalculados defensivamente desde la fecha — sin tocar `status`, `workShiftId` ni `timeSegmentId` propios (se preservan tal cual, ver §19).
4. Las filas no-canónicas se **retiran de cómputo, nunca se borran**: `hours = totalMinutes = actualMinutes = 0`, con una nota en `observation` referenciando el id de la fila canónica. Como ambas grillas (`period-employees`/`time-grid`) **suman** todas las filas que matchean el filtro de estado (nunca "una gana"), una fila en 0 no aporta nada al total — el resultado agregado queda correcto sin ningún riesgo de integridad referencial.

## 17. FKs/referencias auditadas antes de decidir

Se revisó el schema (`TimeEntry` es referenciado por `TimeCorrectionRequest.timeEntryId`, y por `workShiftId`/`timeSegmentId` en sentido inverso — nada más) antes de elegir la estrategia. Un hard-delete de la fila no-canónica podría romper un `TimeCorrectionRequest` histórico que la referencie, o dejar huérfano cualquier consumidor futuro que guarde su id. La estrategia de "retirar a 0, nunca borrar" evita este riesgo por completo — no se necesitó reasignar ninguna FK.

## 18. Implementación del repair

Transaccional **por employee+fecha**, nunca el mes completo en una única transacción (§15 del encargo): cada `repairEmployeeDate` abre su propio `prisma.$transaction`, relee `TimeSegment`/`TimeEntry` **frescos** (nunca confía en el snapshot del dry-run para el valor final), verifica concurrencia (compara ids/`updatedAt` contra el snapshot — si algo cambió en el medio, se salta esa fecha con `SKIPPED_CONCURRENT_MODIFICATION` en vez de sobreescribir a ciegas), reclasifica, y sólo entonces escribe.

## 19. Auditoría

Cada `UPDATE`/`CREATE` real pasa por `auditService.register` (`entity: "TimeEntry"`, `description: "Reconciliación histórica 15M.4 desde WorkShift/TimeSegment"` para la canónica, `"...retirada de cómputo (duplicado de <id>)"` para las retiradas), con `before`/`after` completos. En la corrida real de legajo 30 se registraron 5 entradas de auditoría (14/09: 1 update canónica + 1 retiro; 15/09: 1 update canónica + 1 retiro; 16/09: 1 update canónica).

## 20. Snapshot / backup lógico

`repair()` genera el snapshot (vía el callback que le pasa el CLI) **antes** de escribir, sólo si hay algo que reparar. El CLI lo guarda en `backend/.reconciliation-snapshots/normal-hours-<timestamp>.json` (agregado a `.gitignore`, nunca versionado). La corrida real de legajo 30 dejó `normal-hours-2026-09-17T13-33-37-999Z.json` con las 3 filas-antes de las 3 fechas reparadas, disponible localmente para un rollback manual si hiciera falta.

## 21. Idempotencia

Verificado con datos reales: se corrió `--mode=dry-run` de nuevo inmediatamente después del repair — **las 5 fechas de legajo 30 dieron `OK`**, incluidas 14/09 y 15/09 (`rowCount: 2` — las filas retiradas siguen físicamamente presentes, en 0, y ya no cuentan como `DUPLICATE`). Test unitario dedicado (`normalHoursReconciliation.service.test.ts`) corre `repair()` dos veces sobre el mismo estado mockeado y confirma que la segunda corrida no genera ningún `UPDATE`/`CREATE` adicional.

## 22. Motor B post-repair

`repair()` llama `automaticHourConceptBreakdownsService.recalculateForEmployeePeriod` (núcleo interno de la Etapa 15M.2, sin duplicar su lógica) una vez por cada `employeeId`+período realmente escrito. En la corrida real, para legajo 30/2026-09 devolvió `ok: true` — se verificó por lectura directa que `HourConceptBreakdown` para 16/09 ahora tiene una fila real: `{ hourConcept: "Prueba", minutes: 120, source: "AUTOMATIC", status: "BORRADOR" }`. Hora normal (250 min) y el desglose adicional (120 min) quedan correctamente separados — nunca sumados.

## 23. Caché

`repair()` invalida `clearEmployeeReadCaches()`/`clearTimeEntriesReadCaches()` sólo cuando hubo al menos una escritura real (nunca en dry-run, nunca si todo salió `SKIPPED_*`). **Limitación documentada explícitamente**: como esta herramienta corre como script standalone (`npx tsx`, un proceso Node separado), esa invalidación sólo limpia la memoria de ese proceso — no alcanza a un servidor real corriendo aparte. Si el backend real está desplegado y activo al momento del repair, su caché de grilla (`employeeTimeGridCache`, 60s) puede tardar hasta ese TTL en reflejar el cambio; no se intentó resolver esto con un mecanismo nuevo (evita inventar infraestructura de invalidación entre procesos fuera de alcance de esta etapa) — se documenta como deuda conocida, acotada a 60s.

## 24. Tests

`normalHoursReconciliation.test.ts` (16 tests, lógica pura): OK/UNDERCOUNT/OVERCOUNT/MISSING_TIME_ENTRY/DUPLICATE/MIXED_STATUS/LEGACY_INCONSISTENT, idempotencia de clasificación, ranking de canonical (estado + antigüedad + empate).

`normalHoursReconciliation.service.test.ts` (18 tests, repositorio y transacción mockeados): dry-run (alcance por legajo/global, reproducción exacta del caso legajo 30 14/15/16-09), repair (undercount, missing con creación, guard de fila manual sin `workShiftId`, duplicate con retiro, no-op sobre fechas OK, concurrencia, idempotencia end-to-end, Motor B invocado/aislado ante fallo, invalidación de caché condicional, snapshot condicional).

## 25. Validaciones

Backend: `prisma validate`/`generate` OK, `typecheck` limpio, `npm test` → **1774/1774** (114 archivos; 1740 previos + 34 nuevos de esta etapa), `build` limpio.
Frontend: sin cambios de código. `tsc -b`/`tsc -p tsconfig.e2e.json` limpios, `npm test` → **953/953**, `build` limpio.

## 26. Documentación

Este archivo. Actualizados `docs/PROJECT_CONTEXT.md` y `docs/decisions/ATTENDANCE_TIME_GRID_REAL_DATA_FIX_15M3.md` (nota de cierre: la deuda de datos legacy que 15M.3 dejó documentada ya tiene diagnóstico completo y reparación parcial ejecutada).

## 27. Datos reales modificados

**Sí — con aprobación explícita del usuario tras revisar el dry-run completo.** Alcance exacto: legajo 30, período 2026-09, fechas 14/09, 15/09 y 16/09. 5 filas de `TimeEntry` tocadas (3 `UPDATE` canónica + 2 `UPDATE` de retiro a 0), ninguna borrada. Ningún otro empleado ni fecha fue tocado.

## 28. ¿Se ejecutó repair?

Sí, ver §27. Comando ejecutado: `npx tsx scripts/reconcile-normal-hours.ts --mode=repair --employee-legajo=30 --period=2026-09`.

## 29. Resultado post-repair

| Fecha | Antes | Después |
| --- | --- | --- |
| 14/09 | 421 + 180 min en 2 filas | 601 min en la fila canónica, duplicado retirado en 0 |
| 15/09 | 180 + 263 min en 2 filas | 443 min en la fila canónica, duplicado retirado en 0 |
| 16/09 | 61 min (1.02h) | **250 min (4.17h)** |

Dry-run posterior: **las 5 fechas de legajo 30 quedaron `OK`**. `HourConceptBreakdown` "Prueba" del 16/09 quedó en 120 min (`AUTOMATIC`, generado por el recálculo de Motor B post-repair).

## 30. UI validada o pendiente

**Pendiente** — no se levantó el servidor local ni se abrió el navegador en esta sesión (fuera del alcance de esta etapa de backend/datos). Se validó el resultado equivalente por lectura directa de base (`TimeEntry`/`HourConceptBreakdown`), que es la misma fuente exacta que consumen `GET /time-entries/period-employees` y `GET /employees/:id/time-grid` (confirmado en 15M.3 §25 que ambos leen sin transformación adicional). Recomendado: abrir Asistencia y Carga Horaria para legajo 30/septiembre 2026 y confirmar visualmente 16/09 = 4.17h antes de dar por cerrada la validación funcional completa.

## 31. Hardening futuro (propuesta 15M.5, NO implementada)

Se evaluó un índice único parcial `(employeeId, date, hourConceptId)` para `TimeEntry` con `hourConceptId = NORMAL_BASE` (análogo al `HourConceptBreakdown_manual_unique` ya existente para desgloses manuales) — evitaría estructuralmente que este bug (o cualquier otro) vuelva a crear un duplicado. **No se implementó** porque: (a) siguen existiendo filas retiradas en 0 por esta misma etapa que, aunque ya no compiten por el cómputo, violarían un índice único real si se agregara sin antes decidir qué hacer con ellas (¿excluir por `totalMinutes=0` en el índice parcial, similar al patrón ya usado para `MANUAL`?); (b) los otros 9 empleados detectados en el dry-run global todavía no fueron reparados — agregar el constraint antes de terminar esa reparación bloquearía cualquier futuro cierre de jornada para esos empleados. Queda documentado como candidato a una etapa 15M.5, después de reparar el resto del dataset.

## 32. Riesgos

- Los 9 empleados restantes detectados en el dry-run global (legajos 09, 10, 27, 29, 32) siguen con datos inconsistentes hasta una corrida de repair separada y aprobada explícitamente.
- La invalidación de caché del script no alcanza a un servidor real corriendo aparte (§23) — mitigado por el TTL corto (60s) y por la recomendación de reiniciar el servidor o esperar ese margen antes de validar en UI.
- El guard `env.APP_ENV === "staging"` protege contra correr `--mode=repair` en otro entorno, pero no reemplaza una revisión humana del dry-run — por diseño, se exigió confirmación explícita antes de este primer repair.

## 33. Archivos modificados

- `backend/src/modules/time-entries/normalHoursReconciliation.ts` (nuevo)
- `backend/src/modules/time-entries/normalHoursReconciliation.repository.ts` (nuevo)
- `backend/src/modules/time-entries/normalHoursReconciliation.service.ts` (nuevo)
- `backend/src/modules/time-entries/normalHoursReconciliation.test.ts` (nuevo)
- `backend/src/modules/time-entries/normalHoursReconciliation.service.test.ts` (nuevo)
- `backend/scripts/reconcile-normal-hours.ts` (nuevo)
- `backend/src/shared/datetime/argentinaTime.ts` (agrega `periodCalendarBounds`)
- `backend/package.json` (2 scripts npm nuevos)
- `backend/.gitignore` (ignora `.reconciliation-snapshots/`)
- `docs/PROJECT_CONTEXT.md`, `docs/decisions/ATTENDANCE_TIME_GRID_REAL_DATA_FIX_15M3.md`, este archivo.
- **Datos reales** (Neon, `neondb`): 5 filas de `TimeEntry` (legajo 30, 14/15/16 de septiembre 2026) + 1 fila nueva de `HourConceptBreakdown` (generada por Motor B, no por este script directamente).

## 34. `git diff --check`

Sin errores de espacios en blanco.

## 35. Git status

`main`, 0 ahead/0 behind. Working tree con los cambios de 15M.2 + 15M.3 (preservados) + los de esta etapa, todos sin commitear.

## 36/37. No commit. No push.

Cumplido — nada fue commiteado ni pusheado. (La única acción real fue la escritura contra Neon descripta en §27-29, explícitamente aprobada y fuera del control de versiones de este repositorio.)

---

## Etapa 15M.4B — reparación global de septiembre 2026 (resto de los empleados)

Fecha: 2026-09-17
Estado: repair global ejecutado contra datos reales, con 0 inconsistencias remanentes confirmadas por dry-run

### 1. Alcance

Continuación directa de la Etapa 15M.4 — misma herramienta, sin rediseño ni cambio de política (`backend/scripts/reconcile-normal-hours.ts` + `normalHoursReconciliation.*` sin modificar, salvo un test nuevo — ver §9). Objetivo: terminar de reconciliar **todos** los `employee+date` de 2026-09 que el dry-run global seguía marcando como inconsistentes tras el repair de legajo 30.

### 2. Dry-run previo (no se confió en la corrida anterior)

Se corrió de nuevo `--mode=dry-run --period=2026-09` (sólo lectura) antes de escribir nada, para protegerse contra cualquier cambio ocurrido desde la última ejecución (nuevas fichadas, cierres, etc.):

```
OK: 17, UNDERCOUNT: 2, OVERCOUNT: 1, DUPLICATE: 6, MISSING_TIME_ENTRY: 0, MIXED_STATUS: 0, LEGACY_INCONSISTENT: 0
totalEmployees: 10, totalDatesChecked: 26, totalDatesNeedingRepair: 9
```

**Legajo 30 confirmado 100% OK en las 5 fechas** (01, 02, 14, 15 y 16 de septiembre, 16/09 exactamente en 250 min) — no fue necesario detener nada.

### 3. Inventario de inconsistencias detectadas (previo al repair)

| Legajo | Fecha | Clasificación | Expected (min) | Current (min) | Diferencia | Filas físicas |
| --- | --- | --- | --- | --- | --- | --- |
| 09 | 01/09 | OVERCOUNT | 643 | 660 | +17 | 1 |
| 09 | 02/09 | DUPLICATE | 432 | 432 | 0 | 2 |
| 10 | 02/09 | DUPLICATE | 662 | 662 | 0 | 2 |
| 10 | 03/09 | DUPLICATE | 433 | 433 | 0 | 2 |
| 27 | 02/09 | UNDERCOUNT | 961 | 523 | -438 | 1 |
| 27 | 03/09 | DUPLICATE | 435 | 435 | 0 | 2 |
| 29 | 16/09 | UNDERCOUNT | 247 | 57 | -190 | 1 |
| 32 | 02/09 | DUPLICATE | 651 | 651 | 0 | 2 |
| 32 | 03/09 | DUPLICATE | 433 | 433 | 0 | 2 |

Mismos 5 legajos que el dry-run anterior había detectado (09, 10, 27, 29, 32) — confirmado con el nuevo dry-run, no asumido.

### 4. Snapshot

Generado automáticamente por el propio `repair()` antes de escribir (mismo mecanismo de 15M.4): `backend/.reconciliation-snapshots/normal-hours-2026-09-17T13-48-55-642Z.json` (gitignored, contiene las 9 filas-antes de los 9 employee+date reparados).

### 5. Repair ejecutado

```
npx tsx scripts/reconcile-normal-hours.ts --mode=repair --period=2026-09
```

Sin `--employee-legajo`: se dejó que la propia herramienta determinara el alcance a partir del dry-run interno (§2 del pedido) — esto excluyó automáticamente a legajo 30 (ninguna de sus fechas requería reparación) sin necesidad de un caso especial en el código.

**Resultado: 9/9 casos procesados, 0 errores, 0 saltos por concurrencia.**

| Legajo | Fecha | Acción | Detalle |
| --- | --- | --- | --- |
| 09 | 01/09 | UPDATED_CANONICAL | 660 → 643 min |
| 09 | 02/09 | RETIRED_DUPLICATES | canónica a 432, duplicado retirado en 0 |
| 10 | 02/09 | RETIRED_DUPLICATES | canónica a 662, duplicado retirado en 0 |
| 10 | 03/09 | RETIRED_DUPLICATES | canónica a 433, duplicado retirado en 0 |
| 27 | 02/09 | UPDATED_CANONICAL | 523 → 961 min |
| 27 | 03/09 | RETIRED_DUPLICATES | canónica a 435, duplicado retirado en 0 |
| 29 | 16/09 | UPDATED_CANONICAL | 57 → 247 min |
| 32 | 02/09 | RETIRED_DUPLICATES | canónica a 651, duplicado retirado en 0 |
| 32 | 03/09 | RETIRED_DUPLICATES | canónica a 433, duplicado retirado en 0 |

**Ninguna fila fue hard-deleted** — las 6 filas retiradas por `DUPLICATE` siguen físicamente presentes con `totalMinutes=actualMinutes=hours=0`, igual criterio que legajo 30.

### 6. Auditoría

Cada `UPDATE` (9 en total: 3 canónicas + 6 retiros) quedó registrado vía `auditService.register` con `description: "Reconciliación histórica 15M.4 desde WorkShift/TimeSegment"` (misma descripción que usa el código — la etiqueta "15M.4B" es de esta documentación, el motivo persistido en la fila es el que ya tenía la herramienta desde 15M.4, sin cambios de código para esta corrida).

### 7. Motor B

`recalculateForEmployeePeriod` corrió una vez por cada uno de los 5 `employeeId` tocados (09, 10, 27, 29, 32), período "2026-09" — **las 5 corridas devolvieron `ok: true`**, sin ningún fallo silencioso.

### 8. Caché

Invalidada (`clearEmployeeReadCaches`/`clearTimeEntriesReadCaches`) una vez al final del repair, porque hubo escrituras reales — misma limitación ya documentada en 15M.4 (proceso Node separado del servidor real, si estuviera corriendo en paralelo esa invalidación no le llega; el TTL de 60s/20s sigue siendo la garantía real en ese escenario).

### 9. Tests

No se rediseñó la herramienta. Se agregó **un test nuevo** en `normalHoursReconciliation.service.test.ts` para el caso real de `OVERCOUNT` en repair (legajo 09, 660→643) — la clasificación `OVERCOUNT` ya tenía test puro desde 15M.4, pero el camino de `repair()` específico para esa dirección (reducir, no sólo aumentar, el total canónico) no tenía un test de servicio dedicado hasta que apareció el caso real. Resto de la suite sin cambios: **1775/1775 tests backend** (114 archivos), **953/953 frontend** (92 archivos).

### 10. Dry-run final (post-repair)

```
OK: 26, UNDERCOUNT: 0, OVERCOUNT: 0, DUPLICATE: 0, MISSING_TIME_ENTRY: 0, MIXED_STATUS: 0, LEGACY_INCONSISTENT: 0
totalDatesNeedingRepair: 0
```

**Las 26 fechas con actividad de septiembre 2026, en los 10 empleados activos, quedaron en `OK`.** Cero inconsistencias remanentes de ningún tipo.

### 11. Legajo 30 — intacto

Re-verificado después del repair global: 01/09, 02/09, 14/09, 15/09 y 16/09 siguen exactamente igual que al cierre de 15M.4 — **16/09 sigue en 250 min (4.17h)**, sin ningún cambio por haber reparado otros empleados (cada `employee+date` se repara en su propia transacción, sin tocar filas de otros empleados).

### 12. Validación de las dos grillas (por datos, sin levantar el servidor)

Se confirmó por lectura directa que la agregación que usan tanto `findPeriodEmployees` como `buildAdditiveTimeGrid` (mismo filtro `systemRole=NORMAL_BASE` + `status ∈ {APROBADO, EN_REVISION}`, mismo `Σ hours`) da el mismo resultado post-repair para un caso de cada tipo:

- **OVERCOUNT reparado** (legajo 09, 01/09): 1 fila, 643 min — coincide con lo esperado.
- **UNDERCOUNT reparado** (legajo 27, 02/09): 1 fila, 961 min — coincide con lo esperado.
- **DUPLICATE reparado** (legajo 10, 02/09): 2 filas físicas (662 + 0), suma 662 min — coincide con lo esperado; ambas grillas suman todas las filas que matchean el filtro, así que el 0 de la fila retirada no aporta ni resta nada.

### 13. Funcionamiento futuro (sin tocar nada)

Confirmado por lectura de código (`grep dailyNormalMinutes` en `timeEntries.repository.ts`): el fix de la Etapa 15M.3 (agrupar tramos por fecha calendario antes de escribir `TimeEntry`, un único `create`/`update` por fecha) sigue exactamente igual, sin ninguna modificación en esta etapa. Una jornada nueva con múltiples `TimeSegment` de la misma fecha (por ejemplo, un empleado con un concepto adicional `AUTOMATIC` que sólo cubre parte del turno) seguirá acumulando correctamente — el bug de la Etapa 13F no puede reproducirse con fichadas nuevas.

### 14. Deuda restante (sin cambios respecto a 15M.4)

- Constraint único parcial para `TimeEntry` NORMAL_BASE por `(employeeId, date)` — sigue como propuesta 15M.5, no implementada (mismo motivo: decidir primero qué hacer con las filas ya retiradas en 0 antes de agregar un índice único real).
- La invalidación de caché del script no alcanza a un servidor real corriendo aparte — limitación conocida, acotada al TTL.
- Ningún otro período (fuera de 2026-09) fue tocado ni evaluado en esta etapa.

### 15. Resultado

**Septiembre 2026 queda completamente reconciliado**: 26/26 fechas con actividad en `OK`, legajo 30 intacto, 0 inconsistencias de cualquier tipo en el dry-run final, ninguna fila borrada físicamente, Motor B regenerado para los 5 empleados tocados, auditoría completa de las 9 operaciones.
