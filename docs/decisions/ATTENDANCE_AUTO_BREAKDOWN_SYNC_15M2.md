# Etapa 15M.2 — Sincronización automática Asistencia → Carga Horaria

> Estado histórico: el gap documentado aquí donde Motor A podía sugerir un
> concepto `MANUAL` fue cerrado por 15M.7B. La política vigente admite en la
> clasificación automática únicamente conceptos `AUTOMATIC` o `BOTH` activos,
> no eliminados y habilitados para el empleado.

Fecha: 2026-09-17
Estado: implementado, pendiente de aprobación para commitear
Continúa: `docs/decisions/ATTENDANCE_HOURS_GRID_SYNC_AUDIT_15M1.md` (auditoría read-only previa, sin archivo propio — quedó documentada como respuesta de esa conversación), `docs/decisions/CONCEPTOS_HORARIOS_ADITIVOS.md` (Etapa 6I/6J/6L.4), `docs/decisions/ENABLED_HOUR_CONCEPT_CLASSIFICATION_15I.md`, `docs/decisions/TIME_CLOSURE_CONSISTENCY_15E.md`

## 1. Bug real corregido

La Etapa 15M.1 (auditoría read-only) confirmó la causa raíz exacta de por qué una jornada podía verse correcta en Asistencia pero no reflejarse en la grilla de Carga Horaria: **cerrar un `WorkShift` nunca disparaba el generador aditivo de `HourConceptBreakdown`** (Motor B). El único caller real era un endpoint administrativo explícito (`POST /employees/:id/hour-concept-breakdowns/recalculate-automatic`), y ese endpoint ya ni siquiera tenía un botón de UI que lo llamara desde la Etapa 6L.4 — quedó como "capacidad backend sin botón visible", sin que se agregara ningún disparo alternativo. Esta etapa cierra exactamente ese hueco: cuando una jornada real queda `PROCESADO`, el sistema ahora regenera automáticamente los `HourConceptBreakdown` `AUTOMATIC`/`BOTH` del empleado/período correspondiente, sin intervención manual.

## 2. Motor A vs Motor B — sin cambios en ninguno de los dos motores

- **Motor A** (`hourConceptClassification.ts`, invocado vía `classifySegmentsForEmployee` en `timeEntries.service.ts`) sigue exactamente igual: sigue clasificando `TimeSegment` como evidencia técnica de Asistencia/alertas de turno, sin filtrar por `HourConcept.loadMode` (sólo por concepto habilitado, Etapa 15I). No se tocó.
- **Motor B** (`automaticHourConceptBreakdownsService`/`automaticHourConceptBreakdownsRepository`/`automaticHourConceptBreakdowns.ts`) sigue siendo el único dueño de `HourConceptBreakdown`: misma elegibilidad (`EmployeeHourConcept` + `HourConcept.loadMode ∈ {AUTOMATIC, BOTH}` + `HourConceptRule` activa), mismo cálculo puro (`calculateAutomaticBreakdowns`), misma persistencia (`replaceAutomatic`, delete-then-insert por `employeeId+period+source=AUTOMATIC`, transacción `Serializable` con retry). Ningún archivo de estos módulos cambió su lógica de cálculo/elegibilidad/persistencia.
- Lo único nuevo es la **conexión** entre "una jornada queda `PROCESADO`" y "correr Motor B para ese empleado/período" — antes no existía ningún código que la hiciera, ahora sí.

## 3. Separación de autorización HTTP y núcleo funcional (Motor B)

`automaticHourConceptBreakdowns.service.ts` se dividió en:

- `recalculateForEmployeePeriod({ employeeId, period, createdByUserId?, audit? })`: el núcleo funcional completo (bloqueo por `MonthlyTimeClosure`, `findEligibleConcepts`/`findProcessedShifts`/`calculateAutomaticBreakdowns`/`replaceAutomatic` con retry, registro de auditoría). No recibe ni valida `Express.AuthUser` — no le corresponde: quien lo llama ya resolvió su propia autorización antes (el endpoint HTTP valida scope/rol; el cierre de jornada ya pasó por `employeeAccessWhere`/`assertCanAdminShift` según el camino).
- `recalculate(employeeId, period, user, audit?)`: sigue siendo el wrapper HTTP — valida scope (`findEmployee` + `employeeAccessWhere(user)`) y delega en `recalculateForEmployeePeriod`. Comportamiento observable idéntico al de antes de esta etapa (mismos tests existentes en verde sin modificar sus aserciones).

No se duplicó ninguna lógica: `findEligibleConcepts`, `findProcessedShifts`, `calculateAutomaticBreakdowns` y `replaceAutomatic` siguen viviendo exclusivamente en `automaticHourConceptBreakdowns.repository.ts`/`.ts`, invocados una única vez desde `recalculateForEmployeePeriod`.

## 4. Helper post-cierre en `timeEntries.service.ts`

Dos funciones nuevas, privadas del módulo:

- `syncAutomaticHourConceptBreakdownsSafely(employeeId, period, workShiftId?, audit?)`: llama a `recalculateForEmployeePeriod` dentro de un `try/catch` que **nunca propaga** — cualquier error (incluido `PERIOD_CLOSED`) se loguea (`console.error("AUTOMATIC_BREAKDOWN_SYNC_FAILED", { severity, employeeId, period, workShiftId, code, error })`, `severity: "warning"` para `PERIOD_CLOSED` y `"critical"` para cualquier otro) y se descarta. Mismo principio que `evaluateShiftExitSafely`, ya existente para las alertas de turno.
- `syncAutomaticBreakdownsAfterProcessedShift({ employeeId, workShiftId, segments, audit? })`: deriva el conjunto de períodos Argentina afectados por los `TimeSegment` ya clasificados (`periodFromCalendarDate(segment.date)` sobre un `Set`, nunca duplicando por segmento) y llama a `syncAutomaticHourConceptBreakdownsSafely` una vez por período distinto, en paralelo (`Promise.all`).

Ninguna de las dos funciones modifica `TimeEntry`/`TimeSegment` — sólo disparan el núcleo de Motor B.

## 5. Los 4 caminos conectados

Trazados por callers reales, no por nombre supuesto:

| Camino | Función | Status resultante | Sync agregado |
| --- | --- | --- | --- |
| Alta manual RRHH | `timeEntriesService.createWorkShift` → `timeEntriesRepository.createFromWorkShift` | `PROCESADO` siempre | Sí, tras `createFromWorkShift`, antes de `notifyClassificationAlerts` |
| Cierre manual RRHH/Supervisión | `timeEntriesService.closeWorkShiftManually` → `timeEntriesRepository.closeOpenWorkShift` | `PROCESADO` | Sí, tras `closeOpenWorkShift`, antes de `evaluateShiftExitSafely` |
| Fichador con foto, salida | `timeEntriesService.clockPhotoPunch` (rama `punchType === "OUT"`) → `closeOpenWorkShift` | `PROCESADO` | Sí, sólo en la rama de salida — la rama de ingreso (`punchType === "IN"`) retorna antes de llegar a este código y nunca lo alcanza |
| Fichador DNI/portal, salida | `timeEntriesService.clockOutResolved` (usado por `clockOut`/`clockOutByEmployee`) → `closeOpenWorkShift` | `PROCESADO` | Sí, tras `closeOpenWorkShift`, antes de `evaluateShiftExitSafely` |

Explícitamente **no** conectado (no corresponde, ninguno de estos deja el `WorkShift` en `PROCESADO`): `clockIn`/`clockInByEmployee`/`clockInResolved` (jornada queda `ABIERTO`), `rolloverExpiredOpenWorkShift` (deja el turno anterior en `FALTA_SALIDA`, no `PROCESADO`), cualquier intento que aborta antes de cerrar (ej. salida sin ingreso abierto, `CLOCK_NO_OPEN_SHIFT`).

## 6. `loadMode` — sin cambios de semántica

`AUTOMATIC`/`BOTH` siguen generando `HourConceptBreakdown` automático (vía Motor B, sin cambios); `MANUAL` sigue sin generarlo — el `where` de `findEligibleConcepts` (`loadMode: { in: ["AUTOMATIC", "BOTH"] }`) no se tocó. La divergencia ya documentada en 15M.1 (Motor A no filtra por `loadMode`, así que puede sugerir en `TimeSegment` un concepto que Motor B nunca generará si es `MANUAL`) **sigue existiendo, sin resolver** — queda fuera de alcance de esta etapa (ver §15).

## 7. Regla aditiva — sin cambios

`TimeEntry.hours`/`totalMinutes` (Hora normal) se siguen calculando exactamente igual que antes (Etapa 8F, sin tocar). `HourConceptBreakdown` sigue siendo un desglose que nunca se resta ni se suma al total real. Ejemplo verificado por test: jornada 07:50–11:59 (249 min reales) con concepto automático 09:00–11:00 (120 min) → `NORMAL_BASE = 249`, `ADDITIONAL = 120`, `totalWorkedMinutes = 249` (nunca 369).

## 8. Cross-midnight

Una jornada que cruza medianoche dentro del mismo mes calendario Argentina produce 2 `TimeSegment` (uno por día), pero como ambos `segment.date` mapean al mismo `period` (`periodFromCalendarDate`), el `Set` de períodos tiene tamaño 1 — Motor B se recalcula **una sola vez** para ese período, no dos. Verificado por test (18:00→03:00 ART, mismo mes).

## 9. Cross-month

Una jornada 31/08 22:00 ART → 01/09 06:00 ART genera 2 `TimeSegment` con `period` distinto (`2026-08`/`2026-09`) — el `Set` de períodos tiene tamaño 2, y `recalculateForEmployeePeriod` se llama exactamente una vez por cada uno (nunca dos veces el mismo). Verificado por test explícito.

## 10. Idempotencia

Sin cambios en la estrategia ya existente: `replaceAutomatic` reemplaza atómicamente todo el conjunto `AUTOMATIC` de `(employeeId, period)` en una transacción `Serializable`, con retry-once ante `P2034`. Disparar la sincronización automática no agrega ninguna vía nueva de escritura — sigue siendo la única función que crea filas `AUTOMATIC`. Dos cierres casi simultáneos del mismo empleado/período (o el mismo cierre reintentado) sólo producen, en el peor caso, dos reemplazos consecutivos del mismo conjunto final — nunca duplicados. Verificado por test (dos llamadas consecutivas a `recalculate`, mismo resultado).

## 11. Caché

15M.1 encontró un segundo bug de caché relacionado: `clockOut`/`clockOutByEmployee`/`clockPhotoPunch` y `createWorkShift`/`closeWorkShiftManually` (en `timeEntries.controller.ts`) sólo invalidaban `clearTimeEntriesReadCaches()`, nunca la caché de grilla por-legajo (`employeeTimeGridCache`, 60s TTL) — el mismo bug que la Etapa 6L.4 ya había corregido para `create`/`update` del guardado manual. Se agregó `clearEmployeeTimeGridCache()` a los 5 handlers (mismo criterio acotado de la Etapa 14C.2: sólo la grilla del empleado, no `clearEmployeeReadCaches()` completo). La invalidación ocurre siempre después de que el servicio retorna — como `syncAutomaticHourConceptBreakdownsSafely` nunca propaga, la caché se limpia tanto si Motor B tuvo éxito como si falló (Hora normal ya cambió en ambos casos).

## 12. Endpoint manual existente — conservado

`POST /employees/:id/hour-concept-breakdowns/recalculate-automatic` sigue existiendo, con los mismos permisos (`rrhh`/`supervision`/`cargaHoraria`) y el mismo contrato de respuesta — ahora reutiliza `recalculateForEmployeePeriod` como núcleo compartido con la sincronización automática. No se restauró ningún botón en `EmployeeHoursPage.tsx` (decisión explícita del pedido) — el endpoint queda como vía técnica/manual para correcciones puntuales (ej. tras reabrir un cierre mensual), mientras que el camino diario normal pasa a ser automático.

## 13. Performance

Motor B sigue recalculando el período completo del empleado en cada disparo (mismo diseño que ya tenía el endpoint manual desde la Etapa 6I) — no se optimizó a un cálculo incremental por turno. Se eligió deliberadamente por consistencia/idempotencia (reutilizar `replaceAutomatic` tal cual, sin inventar una semántica de merge parcial) y porque el costo es acotado: `findProcessedShifts` sólo trae los turnos `PROCESADO` de un empleado en un mes, no de toda la nómina. No se agregó ninguna infraestructura de medición nueva (no hay cron/queue en el backend, confirmado en 15M.1) — si a futuro las métricas reales muestran que el recálculo por período es costoso a la escala de producción, una estrategia incremental (Opción B de 15M.1 §24) queda como candidata separada, no implementada acá.

## 14. `PERIOD_CLOSED` — deuda pendiente, sin resolver en esta etapa

Sin cambios en la política de `MonthlyTimeClosure` (fuera de alcance explícito). Sigue existiendo la asimetría ya documentada en 15M.1 §26: los 4 caminos de cierre de jornada **no** verifican `MonthlyTimeClosure` antes de crear `TimeEntry` (a diferencia de la carga manual, bloqueada desde la Etapa 15E), pero Motor B **sí** bloquea su propio recálculo si el período está `ENVIADO`/`APROBADO`/`CORRECCION_PENDIENTE`. Consecuencia posible: una fichada tardía sobre un período ya cerrado puede actualizar Hora normal (`TimeEntry`) mientras el `HourConceptBreakdown` automático de ese período queda sin regenerar hasta que el cierre se reabra o se dispare un recálculo manual. Cubierto por test explícito (`Motor B lanza PERIOD_CLOSED (409): ... igual se confirma, sin propagar el 409 al cliente`) que prueba el aislamiento, no una corrección de la política. Candidata a etapa futura (15M.3/15M.4) si el negocio decide resolverlo.

## 15. Divergencia Motor A / `loadMode` — no resuelta, documentada

Igual que en 15M.1: Motor A no filtra por `HourConcept.loadMode`, así que puede seguir sugiriendo en `TimeSegment` un concepto `MANUAL` que Motor B nunca convertirá en `HourConceptBreakdown` automático (por diseño, ese concepto requiere carga manual). Esta etapa no la toca — queda como candidata a una etapa futura separada (15M.3) si se decide alinear ambos motores.

## 16. Qué no se tocó

`schema.prisma`, migraciones, reglas de `HourConcept`/`HourConceptRule`, `HourConcept.loadMode`, Motor A, Novedades, Finnegans, Horas Especiales (`DoubleHourRule`/`SpecialHourRuleApplication`), política de `MonthlyTimeClosure`, el fichador UX/cámara/storage, la carga manual de `TimeEntry`, y ningún archivo de frontend.

## 17. Archivos modificados

- `backend/src/modules/employees/automaticHourConceptBreakdowns.service.ts` — split `recalculateForEmployeePeriod`/`recalculate`.
- `backend/src/modules/time-entries/timeEntries.service.ts` — helpers `syncAutomaticHourConceptBreakdownsSafely`/`syncAutomaticBreakdownsAfterProcessedShift`, conectados en los 4 caminos de cierre.
- `backend/src/modules/time-entries/timeEntries.controller.ts` — `clearEmployeeTimeGridCache()` agregado a `clockOut`/`clockOutByEmployee`/`clockPhotoPunch`/`createWorkShift`/`closeWorkShiftManually`.
- Tests: `automaticHourConceptBreakdowns.service.test.ts`, `timeEntries.service.test.ts`, `timeEntries.controller.test.ts`, `employees.service.test.ts`.
- Documentación: este archivo, `docs/PROJECT_CONTEXT.md`, `docs/decisions/CONCEPTOS_HORARIOS_ADITIVOS.md`.

## 18. Validaciones

Backend: `npx prisma validate` OK, `npx prisma generate` OK, `npm run typecheck` limpio, `npm test` → 1737/1737 (112 archivos), `npm run build` limpio.
Frontend (sin cambios de código, verificado igual): `npx tsc -b` limpio, `npx tsc -p tsconfig.e2e.json --noEmit` limpio, `npm test` → 953/953 (92 archivos), `npm run build` limpio.
`git diff --check`: sin errores de espacios en blanco.

## 19. Riesgos

- Motor B ahora corre en el camino en vivo del fichador (salida) — mitigado con aislamiento total de errores (nunca revierte ni convierte en 5xx una salida ya persistida) y sin bloquear la respuesta al cliente más allá de lo que ya tardaba el propio recálculo (no se paralelizó fuera del `await`, ver §13 sobre performance no optimizada).
- La deuda de `PERIOD_CLOSED` (§14) puede generar una inconsistencia visible (Hora normal actualizada, breakdown no) si una fichada tardía cae sobre un período ya cerrado — comportamiento documentado, no nuevo (ya podía pasar antes con el recálculo manual, ahora también con el automático).
- La divergencia Motor A/`loadMode` (§15) sigue viva — un concepto `MANUAL` puede seguir viéndose "sugerido" en Asistencia sin nunca aparecer como breakdown automático en la grilla.

## 20. Deuda restante / próximo paso recomendado

1. **15M.3** (opcional, si el negocio lo prioriza): alinear el filtro de `loadMode` entre Motor A y Motor B, o documentar explícitamente en la UI de Asistencia que un concepto `MANUAL` sugerido no se autogenera.
2. **15M.4** (opcional): decidir una política explícita para `PERIOD_CLOSED` en el camino automático (¿reabrir el cierre dispara un recálculo retroactivo? ¿se notifica a RRHH que quedó pendiente?) — hoy sólo queda documentado como deuda, sin mecanismo de recuperación automática.
3. Si en producción se observa que recalcular el período completo en cada punch es costoso, evaluar la Opción B de 15M.1 (generación incremental por turno) con datos reales de performance como justificación.

---

No commitear sin aprobación explícita del usuario.
