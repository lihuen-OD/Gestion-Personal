# Etapa 15M.19E — Reconciliación histórica de notificaciones automáticas

Fecha: 2026-09-21
Estado: auditoría completa + 1 fix implementado, validado (typecheck/tests/build verdes en ambos repos, `prisma validate`/`migrate status` verdes — sin migración nueva), pendiente de aprobación para commitear — no commiteado, no pusheado
Continúa: `docs/decisions/DURABLE_ATTENDANCE_INACTIVITY_SCHEDULER_15M19A.md`, `MISSING_EXPECTED_ENTRY_15M19B.md`, `NOTIFICATIONS_PAGE_LIVE_REFRESH_15M19C.md`, `NOTIFICATIONS_END_TO_END_ACCEPTANCE_15M19D.md`, `ATTENDANCE_SHIFT_ALERTS_NOTIFICATIONS_AUDIT_10E.md`

## 1. Resumen ejecutivo

El pedido pide que, si el backend estuvo apagado mientras había empleados trabajando, ninguna notificación automática cuya condición sea reconstruible a partir de datos persistidos se pierda. Exige explícitamente auditar antes de tocar código y no asumir que todo debe backfillearse.

La auditoría (§3-§4) encontró que **el problema descrito ya está resuelto** para todo evento automático real *time-driven*: la familia `AttendanceInactivityIncident` tiene watermark durable desde 15M.19A + obligación real correcta desde 15M.19B, con el escenario exacto del pedido (fin de semana sin backend) ya cubierto como regresión end-to-end en 15M.19D; y la familia `ShiftAlert` no necesita ningún mecanismo de recuperación nuevo porque 10 de sus 14 valores son estrictamente event-driven (atados a una fichada real — imposible perderlos por un apagón, ver §3.2) y el único con generador programado (`POSIBLE_OLVIDO_SALIDA`) ya es auto-recuperable por construcción.

Se investigó puntualmente una sospecha de hueco real en `expireOpenWorkShifts` (una jornada que pasa de "sin riesgo" a "vencida" *durante* un apagón podría cerrarse sin haber sido nunca marcada como `POSIBLE_OLVIDO_SALIDA`) — **se descartó**: es diseño intencional, ya auditado en Etapa 10E §7 (ver §5 de este documento).

**El único hueco real encontrado y corregido**: `SystemNotification` no distinguía "cuándo ocurrió el hecho de negocio" de "cuándo se creó la fila" (sólo `createdAt`). Esto ya afectaba, en producción, al propio catch-up de 15M.19A/B — una ausencia del sábado recuperada el lunes mostraba `createdAt = lunes` sin ninguna pista del día real. Fix mínimo, aditivo, sin migración: exponer la fecha de negocio que ya está persistida en la entidad de origen (`ShiftAlert.actualAt`, `WorkShift.startAt`, `AttendanceInactivityIncident.operationalDate`) a través del enriquecimiento que `workforce.service.ts::notifications()` ya hacía para resolver `employee`.

**Archivos modificados**: `backend/src/modules/workforce-management/workforce.service.ts` (+1 campo `eventDate` en la respuesta), `frontend/src/services/api/workforceApiService.ts` (+2 campos en el tipo), `frontend/src/pages/NotificationsPage.tsx` (usa `eventDate` para mostrar la fecha, con fallback a `createdAt`). **Sin cambios de schema, sin migración, sin scheduler nuevo, sin `JobCheckpoint` nuevo.**

## 2. Método de auditoría

Dos rondas: (1) lectura completa de los 4 documentos de la serie 15M.19 + lectura directa de `workShiftEvaluationRunner.ts`, `workShiftEvaluation.service.ts`, `openShiftMonitor.service.ts`, `clockPunchMaintenance.ts`, `timeEntries.repository.ts`, `workforce.service.ts`; (2) revisión adversarial independiente (un segundo análisis, sin ver las conclusiones de la primera ronda, instruido específicamente para buscar huecos) — que encontró y corrigió un error real en la primera ronda: la sospecha sobre `expireOpenWorkShifts` (§5) era incorrecta. Se verificó la corrección leyendo directamente `ATTENDANCE_SHIFT_ALERTS_NOTIFICATIONS_AUDIT_10E.md`.

## 3. Matriz completa — cada productor automático real

### 3.1 `AttendanceInactivityIncident` (dos señales, mismo modelo)

| Evento | Automático | Reconstruible | Catch-up | Resultado |
|---|---|---|---|---|
| `SIN_ACTIVIDAD_REGISTRADA` (chequeo diario, día completo) | Sí (time-driven) | Sí | **Sí — watermark durable** (`JobCheckpoint` + `attendanceInactivityScheduler.ts`, 15M.19A) | Sin trabajo nuevo. Regresión end-to-end en `NOTIFICATIONS_END_TO_END_ACCEPTANCE_15M19D.md` filas 1-3, 20-21 |
| `FALTA_INGRESO` (chequeo intradía, tolerancia vencida) | Sí (time-driven) | Sí | No necesita watermark propio — corre en cada tick de 60s re-evaluando "hoy"; si el proceso está apagado toda la ventana, el chequeo diario (con watermark) termina cubriendo la misma ausencia al día siguiente, con mensaje genérico en vez del específico (documentado y aceptado en 15M.19B §21) | Sin trabajo nuevo |

### 3.2 `ShiftAlertType` — los 14 valores del enum (`prisma/schema.prisma`)

| Tipo | Trigger | Automático (time-driven) | Reconstruible por diseño | Resultado |
|---|---|---|---|---|
| `INGRESO_TARDE` | Fichada de ingreso (`evaluateShiftEntry`) | No — event-driven | — no puede perderse: si no hubo backend, no hubo fichada | Sin trabajo |
| `INGRESO_ANTICIPADO` | ídem | No | — | Sin trabajo |
| `SALIDA_ANTICIPADA` | Fichada de salida (`evaluateShiftExit`) | No | — | Sin trabajo |
| `SALIDA_TARDIA` | ídem | No | — | Sin trabajo |
| `TURNO_NO_IDENTIFICADO` | Fichada de ingreso | No | — | Sin trabajo |
| `SHIFT_NOT_ENABLED_FOR_EMPLOYEE` | Fichada de ingreso | No | — | Sin trabajo |
| `POSSIBLE_SHIFT_CONFIGURATION_MISSING` | — | — | **Legacy** (Etapa 13E.1) — ningún código lo genera; se conserva sólo para no romper filas históricas | Sin trabajo |
| `JORNADA_INSUFICIENTE` | Fichada de salida | No | — | Sin trabajo |
| `JORNADA_EXTENDIDA` | Fichada de salida | No | — | Sin trabajo |
| `DESCANSO_INSUFICIENTE` | — | — | **Legacy** (Etapa 13I) — umbral hardcodeado sin respaldo, desactivado; se conserva sólo para filas históricas | Sin trabajo |
| `POSIBLE_OLVIDO_SALIDA` | **`checkMissingOutRisk`, cron 60s** (`openShiftMonitor.service.ts`, único generador programado de toda la familia) | **Sí** | **Auto-recuperable por construcción** — re-escanea TODAS las jornadas `ABIERTO` cada tick, sin depender de cuándo corrió el tick anterior. Caso límite investigado y descartado — ver §5 | Sin trabajo (hueco sospechado, descartado con evidencia) |
| `CONCEPTO_NO_HABILITADO` | Fichada de salida / carga manual | No | — | Sin trabajo |
| `SEGMENTO_SIN_CLASIFICAR` | — | — | **Legacy** (Etapa 15M.7A) — el fallback universal ("Hora normal") reemplazó este hallazgo; se conserva sólo para filas históricas | Sin trabajo |
| `JORNADA_FUERA_DE_TURNO` | Fichada de salida | No | — | Sin trabajo |

**Por qué los 10 tipos event-driven no necesitan reconciliación** (verificado por grep exhaustivo de los únicos 8 call sites de `evaluateShiftEntry`/`evaluateShiftExit`, todos en `backend/src/modules/time-entries/timeEntries.service.ts`, todos dentro de un handler HTTP en vivo — kiosco público o acción admin — ninguno desde `clockPunchMaintenance.ts` ni ningún otro scheduler): la condición que los dispara es, por definición, una fichada (o acción admin) que llegó a este backend. Si el backend estaba apagado, esa fichada no pudo llegar — no hay nada que "reconciliar" porque el evento que la generaría literalmente no pudo ocurrir contra este sistema. Cuando el empleado ficha (aunque sea después, al volver el backend), la evaluación corre normal y correctamente — es un evento tardío normal, no uno recuperado.

### 3.3 Otros productores de `SystemNotification` (fuera de `ShiftAlert`/`AttendanceInactivityIncident`)

| Tipo | Sitio (`notifyUsers`/`notifyRrhh`) | Automático (time-driven) | Resultado |
|---|---|---|---|
| `FALTA_SALIDA` | `notifyMissingExit`, invocado desde `expireOpenWorkShifts` (cron 60s) **y** desde el camino de rollover en vivo | Sí (parcialmente — el camino de cron) | **Auto-recuperable por construcción** — mismo re-scan de `WorkShift.status=ABIERTO` que `checkMissingOutRisk`, sin watermark necesario (ver §5) |
| `NOVEDAD_PENDIENTE` | `novelties.service.ts` | No — acción humana (crear novedad) | Fuera de alcance (familia event-driven, §2A del pedido) |
| `CIERRE_MENSUAL` | `workforce.service.ts` | No — acción humana (enviar a revisión) | Fuera de alcance |
| `CORRECCION_HORARIA` | `workforce.service.ts` | No — acción humana (solicitar corrección) | Fuera de alcance |
| `INTENTO_INGRESO_JORNADA_ABIERTA` | `notifyOpenShiftAttempt`, sólo en vivo (fichada) | No | Fuera de alcance (además, no tiene fecha de negocio distinta del propio intento) |

## 4. Criterio aplicado — cuándo algo necesita reconciliación

Un evento automático necesita un mecanismo de recuperación sólo si **(a)** es time-driven (su condición depende del paso del tiempo, no de una acción humana) **y (b)** su generador corre en un proceso que puede no haber estado vivo en el momento exacto en que la condición se volvió verdadera **y (c)** no se re-evalúa espontáneamente la próxima vez que el generador corre. Verificado contra cada fila de las matrices de arriba: los 10 tipos event-driven fallan (a); las 3 entradas legacy no tienen generador; `AttendanceInactivityIncident` cumple (a)+(b) pero ya tiene watermark (15M.19A); `POSIBLE_OLVIDO_SALIDA`/`FALTA_SALIDA` cumplen (a)+(b) pero fallan (c) — se re-evalúan solos cada 60s contra el estado actual de la base, sin necesitar memoria de qué tick corrió cuándo.

## 5. Hueco investigado y descartado — `expireOpenWorkShifts`/`POSIBLE_OLVIDO_SALIDA`

**Hipótesis inicial**: si una jornada pasa directo de "sin riesgo" a "ya vencida" (`> maxAllowedMinutes`) *durante* un apagón largo, el primer tick al volver el backend la encuentra ya vencida y la cierra en `expireOpenWorkShifts` (rama sin régimen / `ROLLOVER`) a `FALTA_SALIDA` — sin haber pasado nunca por `checkMissingOutRisk` (que ignora explícitamente cualquier jornada ya en nivel `EXPIRED`, ese es trabajo de `expireOpenWorkShifts`). Conclusión inicial: nunca se crea la `ShiftAlert` `POSIBLE_OLVIDO_SALIDA`, RRHH pierde esa señal.

**Por qué es incorrecta** (confirmado leyendo `ATTENDANCE_SHIFT_ALERTS_NOTIFICATIONS_AUDIT_10E.md` directamente, Etapa auditada el 2026-08-28, con este mismo caso ya analizado por nombre):

- §7 de ese documento: *"`expireOpenWorkShifts` ... si no (ROLLOVER/sin régimen, el default) → cierra en 0h, `status=FALTA_SALIDA`, y resuelve automáticamente cualquier `POSIBLE_OLVIDO_SALIDA` pendiente"* — el cierre automático **es** el desenlace de negocio esperado para este caso, no un cierre "silencioso" sin contexto.
- Comentario en `timeEntries.repository.ts` (línea previa al loop de resolución): la jornada que se auto-cierra en 0h puede tener una alerta previa — se resuelve ahí "para que no quede pendiente indefinidamente".
- Comentario en `workShiftEvaluationRunner.ts` sobre `resolveOpenShiftOverflowAlert`: una vez que la jornada se cerró, el riesgo que `POSIBLE_OLVIDO_SALIDA` advertía ya dejó de existir — la jornada tiene un desenlace definitivo, revisable por su propio estado (`FALTA_SALIDA`, visible en Asistencia → "Problemas de fichada", una cola independiente que **no** consulta `ShiftAlert` — arquitectura deliberada, confirmada en 10E §3).
- 10E §11 (bugs encontrados) confirma explícitamente: *"No se encontraron bugs en: ... resolución de alertas al cerrar jornada (10B), rollover dejando huérfanas (10B)"*.
- Además, `notifyMissingExit` (la notificación `FALTA_SALIDA`) ya se dispara **incondicionalmente** para toda jornada auto-cerrada, desde el mismo re-scan de 60s (`clockPunchMaintenance.ts`) — RRHH sí recibe aviso, sólo que con el tipo `FALTA_SALIDA` en vez de `POSIBLE_OLVIDO_SALIDA` (que dejó de ser relevante porque la jornada ya no está "en riesgo", está cerrada).

**Por qué el fix que se había considerado (forzar `flagOpenShiftOverflowForReview` también en la rama `ROLLOVER`) sería contraproducente**: `expireOpenWorkShifts` ya resuelve automáticamente cualquier alerta `PENDIENTE` de la jornada que cierra, en la misma función — agregar una creación justo antes generaría una alerta que la misma función resuelve en el acto (nunca visible en el filtro por defecto de "Alertas de Turnos", que muestra `PENDIENTE`), y una segunda notificación (`ALERTA_FICHADA`) para el mismo cierre que ya dispara `FALTA_SALIDA` — violando la política de "una sola notificación por evento de salida" (Etapa 13G).

**Conclusión**: no se modifica `expireOpenWorkShifts`, `flagOpenShiftOverflowForReview`, ni ningún archivo de `openShiftMonitor.service.ts`. El resultado final para este escenario ya es correcto y ya es visible (Asistencia → "Problemas de fichada" + notificación `FALTA_SALIDA`) — exactamente el principio que pide el propio enunciado de esta etapa: reconstruir el resultado final relevante, no cada alerta transitoria del camino.

## 6. El fix implementado — fecha real del evento en notificaciones

### 6.1 Backend

`backend/src/modules/workforce-management/workforce.service.ts::notifications()` ya hacía, para cada notificación de la página pedida, un enriquecimiento por `entityType`/`entityId` para resolver `employee` (`ShiftAlert`/`WorkShift`/`Employee`/`AttendanceInactivityIncident`). Se extendió cada `select` ya existente para traer también la fecha real de negocio:

- `ShiftAlert` → `actualAt` (instante real del hecho).
- `WorkShift` → `startAt` (inicio de la jornada — deliberadamente no `closedAt`/`endAt`: para una jornada auto-cerrada por el mantenimiento, esa sería justamente la fecha "equivocada", días después, que esta etapa busca dejar de mostrar).
- `AttendanceInactivityIncident` → `operationalDate` (día operativo de la ausencia).
- `Employee` → sin cambios (no hay fecha de negocio natural para `INTENTO_INGRESO_JORNADA_ABIERTA`).

Cada item de la respuesta gana un campo `eventDate` (mismo patrón exacto que ya usaba `employee`, un mapa `id → fecha` por tipo). **Cero cambios de schema, cero migración** — son columnas que ya existían.

### 6.2 Frontend

`frontend/src/services/api/workforceApiService.ts`: el tipo `SystemNotification` gana `entityType?: string | null` (el backend ya lo devolvía; no estaba tipado ni se usaba) y `eventDate?: string | null`.

`frontend/src/pages/NotificationsPage.tsx`: nueva función `notificationEventDateLabel(item)` — si `eventDate` existe, la formatea según el tipo de origen: `formatCalendarDate` (`utils/date.ts`, ya existente) cuando `entityType === "AttendanceInactivityIncident"` (campo `@db.Date`, calendario puro — nunca `new Date(...).toLocaleDateString()`, que corre la fecha un día para atrás en Argentina, el mismo riesgo ya corregido esta semana en la Etapa 15M.20 para este mismo tipo de campo), o como instante Argentina (fecha + hora) para `ShiftAlert`/`WorkShift`. Si no hay `eventDate` (notificaciones `Employee`-typed, o cualquier fila anterior a este cambio), cae al comportamiento de siempre (`createdAt`).

**Orden de la lista sin cambios** (`createdAt desc`, "más reciente primero" — sigue siendo el orden correcto para saber qué mirar primero). Sólo cambia el texto de fecha mostrado, evitando el riesgo de una reordenación confusa.

## 7. Trazabilidad "detectado en vivo vs. por reconciliación" — sin campo nuevo

El pedido pide (§39) poder distinguir si una alerta fue detectada en tiempo real o por reconciliación histórica, "si el modelo ya tiene metadata apropiada... sin sobreingeniería". Ya la tiene: `AttendanceInactivityIncident.detectedAt` (instante de inserción) vs. `operationalDate` (día real) — la brecha entre ambos ya distingue "detectado el mismo día" de "recuperado después"; mismo razonamiento con `ShiftAlert.createdAt` vs. `actualAt`. No se agregó ningún campo nuevo para esto — no hace falta.

## 8. Tests

- Backend (`workforce.service.test.ts`): 2 aserciones existentes actualizadas (el `select` exacto ahora incluye el nuevo campo de fecha) + 5 tests nuevos (`eventDate` por cada `entityType`, incluyendo el caso que motiva la etapa — `operationalDate` muy anterior a `createdAt` simulando una recuperación por catch-up — y la ausencia de `eventDate` cuando no hay entidad con fecha de negocio o no hay `entityId`).
- Frontend (`NotificationsPage.test.tsx`): 3 tests nuevos — `eventDate` de `AttendanceInactivityIncident` se muestra como fecha calendario sin corrimiento de huso horario, `eventDate` de `ShiftAlert` se muestra como instante, y sin `eventDate` se preserva el comportamiento anterior (`createdAt`).

## 9. Validación

- Backend: tests focalizados ✅, suite completa ✅, `typecheck` ✅, `build` ✅, `prisma validate` ✅, `prisma migrate status` ✅ (sin migración nueva).
- Frontend: tests focalizados ✅, suite completa ✅, `tsc -b` ✅, `build` ✅.
- `git diff --check` ✅ en ambos repos.

## 10. Qué NO se tocó

`expireOpenWorkShifts`, `flagOpenShiftOverflowForReview`, `openShiftMonitor.service.ts`, `attendanceInactivityScheduler.ts`, `missingEntry.service.ts`, `workObligation.service.ts`, `schema.prisma` (ninguna migración), ningún scheduler/cron nuevo, ningún `JobCheckpoint` nuevo.

## 11. Riesgos pendientes

- Los mismos riesgos ya documentados y aceptados en 15M.19A/B (concurrencia multi-instancia bajo Postgres real, no ejercida contra una base real en este entorno de test) — sin agravarse ni resolverse por esta etapa.
- `markMissingOut` (acción admin manual "marcar como olvido de salida") no resuelve ninguna `POSIBLE_OLVIDO_SALIDA` `PENDIENTE` asociada — hallazgo menor encontrado durante esta auditoría, fuera del alcance de "reconciliación por apagón" (es un camino en vivo, no automático), documentado acá para que no se pierda, no corregido en esta etapa.

---

No se commiteó, no se pusheó, no se aplicó ninguna migración (no hubo ninguna que aplicar). No se modificó `expireOpenWorkShifts`, `openShiftMonitor.service.ts`, ni el scheduler durable de 15M.19A.
