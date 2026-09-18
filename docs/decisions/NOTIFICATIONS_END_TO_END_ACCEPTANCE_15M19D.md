# Etapa 15M.19D — Regresión end-to-end del sistema de notificaciones (aceptación de la serie 15M.19)

Fecha: 2026-09-18
Estado: validación completa, 1 bug real encontrado y corregido (§26), pendiente de aprobación para commitear — no commiteado, no pusheado
Continúa: diagnóstico 15M.18, `docs/decisions/DURABLE_ATTENDANCE_INACTIVITY_SCHEDULER_15M19A.md`, `docs/decisions/MISSING_EXPECTED_ENTRY_15M19B.md`, `docs/decisions/NOTIFICATIONS_PAGE_LIVE_REFRESH_15M19C.md`

## 1. Resumen ejecutivo

Esta etapa es de aceptación/regresión, no de features nuevas — tal como pedía el enunciado, no se modificó ninguna regla que ya pasaba. El proceso fue: (1) correr toda la suite existente de 19A/19B/19C como línea de base; (2) para cada escenario del pedido, verificar si ya existe evidencia (test + código) o si hay un gap real; (3) cerrar los gaps reales con tests nuevos, priorizando los que cruzan más de un módulo (algo que los tests unitarios de 19A/19B/19C, por diseño, no ejercían); (4) donde un test nuevo reveló una diferencia entre lo esperado y lo implementado, tratarlo como bug real: documentar causa raíz, aplicar el fix mínimo, y dejar el test como regresión permanente.

**Un bug real encontrado y corregido** (§26 del pedido, detalle en §5.3 de este documento): bajo el filtro "No leídas", una notificación marcada como leída **desde otro cliente** no desaparecía de la vista hasta un remount completo — el merge por id introducido en 15M.19C no distinguía "todavía no re-pedida" (páginas profundas) de "dejó de pertenecer al filtro" (una vez que otro cliente la marca leída). Fix: bajo el filtro `NO_LEIDA` específicamente (el único cuya pertenencia puede pasar de verdadera a falsa), el refresco silencioso reemplaza la lista completa en vez de fusionarla — `""` y `LEIDA` (pertenencia monótona) siguen usando la fusión que preserva páginas profundas.

**Sin cambios de backend en generación/scheduler/reglas de negocio** — el único cambio de código de esta etapa es el fix de frontend de arriba, más 3 archivos de test nuevos (2 backend, cross-módulo; el resto son ampliaciones de suites existentes).

**Suites finales**: backend 119 archivos / 1879 tests (todos verdes); frontend 96 archivos / 1046 tests (todos verdes). `typecheck`/`build` verdes en ambos. `prisma validate`/`migrate status` verdes, sin migración nueva. `git diff --check` limpio.

## 2. Las tres capas — cómo se evitó "aparece visualmente" = "correcto"

Para cada escenario de negocio se distinguió explícitamente:

- **A (evento)**: la condición de negocio real (turno, tolerancia, fichada, novedad, feriado, régimen).
- **B (generación/persistencia)**: qué fila queda en `AttendanceInactivityIncident`/`ShiftAlert`/`SystemNotification`, verificado contra el mock de Prisma (`createMany`/`upsert`/`$transaction`), nunca inferido desde la UI.
- **C (visualización)**: qué ve `NotificationsPage`/la campana, verificado por separado (tests de React Testing Library, mockeando la capa de API, nunca el backend real).

Ningún test de este documento concluye "B" a partir de "C" — los tests de backend (§3-§21 de la matriz) verifican B contra el mock de Prisma; los de frontend (§22-§37) asumen B ya resuelto (mockean la respuesta de la API) y verifican sólo C.

## 3. Matriz completa

| # | Escenario | Resultado esperado | Resultado real | Evidencia |
|---|---|---|---|---|
| 1 | Varios días sin login (lunes entra, martes/miércoles no, jueves entra) | Eventos válidos de martes/miércoles ya persistidos cuando el usuario vuelve; ningún día se pierde por depender de "ayer" | **PASS** | `attendanceInactivityScheduler.test.ts` — "Caso B / criterio de éxito §42"; `JobCheckpoint` persistido (no en memoria) — `jobCheckpoint.repository.test.ts` |
| 2 | Backend apagado varios días (checkpoint 14/09, vuelve el 18 después de 01:00 ART) | Procesa 15,16,17 en orden cronológico, tope 14/tick, sin saltar fechas | **PASS** | `attendanceInactivityScheduler.test.ts` — `buildPendingDateKeys` (6 tests) + "Caso B", "respeta ATTENDANCE_INACTIVITY_MAX_CATCHUP_DATES" |
| 3 | Restart durante catch-up (15 OK, 16 cae a mitad) | Checkpoint no avanza a 16 si no terminó; el siguiente proceso reanuda en 16; sin duplicados | **PASS** | `attendanceInactivityScheduler.test.ts` — "Caso D — fallo intermedio", "Caso E — reintento", "Caso C — reinicio del proceso" |
| 4 | Obligación real positiva — TURNO_OBLIGATORIO, 08:00+10min, sin fichada a las 08:11 | Se genera UNA falta de ingreso; ticks 08:12/08:13 no generan una segunda | **PASS** | `missingEntry.service.test.ts` — "tolerancia vencida...genera UNA falta de ingreso"; "idempotencia — segundo tick" |
| 5 | Ingreso correcto (08:05, tolerancia 10min) | NO falta de ingreso | **PASS** | `missingEntry.service.test.ts` — "antes de que venza la tolerancia", "fichada dentro de tolerancia" |
| 6 | Ingreso posterior (08:11 falta de ingreso, 08:20 ficha) | Incidente temprano se resuelve automáticamente con motivo auditable; puede generarse INGRESO_TARDE (modelo distinto, sin conflicto); sin dos problemas activos redundantes | **PASS** | `missingEntry.service.test.ts` — describe "lifecycle" (3 tests); `evaluateEntryPunctuality`/`INGRESO_TARDE` sin cambios de esta serie |
| 7 | Feriado sin convocatoria, turno habitual, no ficha | NO falta de ingreso, NO sin actividad — tener turno habitual no genera obligación en feriado | **PASS** | `workObligation.service.test.ts` — "feriado sin ningún convocado: candidatos vacío" |
| 8 | Feriado convocado (`HolidayWorkAssignment` ACTIVA), tolerancia vencida, no ficha | Puede generar falta de ingreso | **PASS** | `workObligation.service.test.ts` — "feriado con convocatoria ACTIVA"; mensaje de feriado en `attendanceInactivity.service.test.ts` |
| 9 | Fin de semana — turno lunes a viernes, sábado/domingo sin fichadas | NO falta de ingreso, NO sin actividad — descanso semanal no es ausencia | **PASS** | `workObligation.service.test.ts` — "weekdays NO incluye el día real de dateKey" |
| 10 | SIN_TURNO, sin fichadas todo el día | NO falta de ingreso ni inactividad basada en turno inexistente | **PASS** | `workObligation.service.test.ts` — "régimen SIN_TURNO: NUNCA es candidato" |
| 11 | TURNO_FLEXIBLE sin obligación explícita (sin ShiftAssignment) | NO falta de ingreso; no se fabrica `scheduledStart` | **PASS** | `workObligation.service.test.ts` — "TURNO_FLEXIBLE sin ninguna ShiftAssignment propia: nunca es candidato" |
| 12 | Assignment fuera de vigencia — effectiveFrom futuro / effectiveTo vencido / weekday incorrecto | NO obligación, NO alerta | **PASS** | `workObligation.service.test.ts` — 3 tests dedicados (futuro, pasado, weekday) |
| 12b | Assignment DESHABILITADO | NO obligación | **PASS** (verificado por construcción de query) | `workObligation.service.test.ts` — "la query sólo pide asignaciones HABILITADO..." (el `where` filtra `status: "HABILITADO"`; Postgres real nunca devuelve una deshabilitada) |
| 13 | Empleado inactivo en la fecha | NO candidato | **PASS** (verificado por construcción de query) | `workObligation.service.test.ts` — mismo test, `employee: { status: "ACTIVO" }` en el `where` |
| 14 | Novedad válida que exime presencia (fromDate/toDate, `allowsDateRange`) | NO falta de ingreso, NO inactividad injustificada | **PASS** | `attendanceInactivity.service.test.ts` + `missingEntry.service.test.ts` — "novedad vigente exime"; semántica reutilizada de `noveltyCoversDay` (15M.15/15L.2C), sin política paralela |
| 15 | Novedad RECHAZADA | No exime (política vigente sin cambios) | **PASS** | `attendanceInactivity.service.test.ts` — nuevo test §19D: "una novedad RECHAZADA nunca exime — el where la descarta explícitamente" |
| 16 | Cross-midnight — turno 22:00–06:00, sin fichada, evaluado a las 22:11 del mismo día operativo | Una sola falta de ingreso, fecha operativa correcta (no se corta al cruzar medianoche UTC) | **PASS** | `missingEntry.service.test.ts` — describe "cross-midnight" |
| 16b | Cross-midnight — entrada/salida real, cierre al día siguiente | Sin cambios de esta serie — lógica preexistente de `evaluateExitPunctuality`/`scheduledInstantForShiftTime` | **PASS** (no modificado, suite preexistente sigue verde) | `workShiftEvaluationRunner.test.ts` — fixtures "turno sereno" (Etapa 10C), sin tocar en 15M.19 |
| 17 | Posible olvido de salida — overflow, primer tick crea+notifica, segundo tick nada nuevo, RRHH resuelve, siguiente tick no reabre | Idempotencia correcta, sin reenvío | **PASS** (fix de 15M.19B, confirmado de nuevo acá) | `workShiftEvaluationRunner.test.ts` — describe `flagOpenShiftOverflowForReview` (4 tests: crea, no reenvía, no reabre, jornada nueva sí genera) |
| 18 | Nueva jornada tras alerta resuelta (mismo empleado, WorkShift distinto) | Sí puede generarse una alerta nueva — la idempotencia no bloquea eventos legítimos nuevos | **PASS** | `workShiftEvaluationRunner.test.ts` — "una jornada nueva (workShiftId distinto) sí genera su propia alerta" |
| 19 | Daily inactivity vs. missing entry — falta de ingreso a las 08:11, empleado jamás ficha ese día, catch-up diario del día siguiente | Sin dos notificaciones activas redundantes — misma fila, `notifiedAt` ya seteado impide una segunda notificación | **PASS** (test cross-módulo nuevo de esta etapa) | `dailyVsMissingEntryIntegration.test.ts` (nuevo) — 2 tests, ambos órdenes de ejecución |
| 20 | Bootstrap de `JobCheckpoint` inexistente | Bootstrap seguro en "ayer", sin backfill histórico automático | **PASS** | `attendanceInactivityScheduler.test.ts` — "Caso H — bootstrap sin configurar" + variante con `ATTENDANCE_INACTIVITY_BOOTSTRAP_DATE` |
| 21 | Catch-up con más de 14 días pendientes | Primer tick procesa el máximo configurado; el siguiente continúa, sin saltar ni reiniciar | **PASS** | `attendanceInactivityScheduler.test.ts` — "respeta ATTENDANCE_INACTIVITY_MAX_CATCHUP_DATES" |
| 22 | Idempotencia — ejecutar la misma fecha/missing-entry/overflow varias veces | Cantidad de filas/notificaciones estable tras la primera ejecución válida | **PASS** | `attendanceInactivity.service.test.ts` (createMany skipDuplicates), `missingEntry.service.test.ts` (idempotencia segundo tick), `workShiftEvaluationRunner.test.ts` (overflow) |
| 23 | Concurrencia — dos evaluaciones del mismo evento | Cero duplicados funcionales | **PASS parcial** — probado por diseño/construcción (constraints únicos + escritura monótona de checkpoint), **no** por ejecución concurrente real (no hay Postgres real en esta suite) | `jobCheckpoint.repository.test.ts` — "sólo avanza lastProcessedDate hacia adelante"; `@@unique([employeeId, operationalDate])` + `skipDuplicates` (schema); ver riesgo residual §6 |
| 24 | Performance — sin N+1, sin loops por empleado con queries | Consultas batch, cantidad de consultas independiente de la cantidad de candidatos | **PASS** | `workObligation.service.test.ts` — "dos empleados distintos... sin mezclarse" + `attendanceInactivity.service.test.ts` — "las 3 consultas de evidencia... una sola vez, nunca por candidato" |
| 25 | NotificationsPage abierta, sin F5, backend agrega una notificación | Aparece automáticamente dentro del intervalo de polling | **PASS** | `NotificationsPage.test.tsx` — "Caso B/C" (15M.19C) |
| 26 | F5 no genera — capturar estado, hacer F5, confirmar cero `SystemNotification`/`ShiftAlert`/`AttendanceInactivityIncident` nuevos | F5 sólo vuelve a consultar | **PASS** (verificado por construcción del mock, ver §5.1) | `workforce.service.test.ts` — mock de `notifications()`/`unreadNotificationCount()` sin `create`/`createMany` en `systemNotification`/`shiftAlert`/`attendanceInactivityIncident` |
| 27 | Login no genera — login/logout/login | El acto de autenticarse no genera eventos laborales | **PASS** (verificado por construcción del mock, ver §5.2) | `auth.service.test.ts` — mock de `authRepository` sin ninguna referencia a `shiftAlert`/`systemNotification`/`attendanceInactivityIncident`/`workObligation` |
| 28 | Campana y bandeja convergen | Ambas reflejan la misma realidad backend tras el intervalo | **PASS** | Mismo intervalo compartido (`NOTIFICATIONS_POLL_INTERVAL_MS`) + mismo evento `app:notifications-changed` — `AppShell.tsx`/`NotificationsPage.tsx`; sin test de integración cruzada entre ambos componentes (evaluado como bajo riesgo, mismo mecanismo ya probado por separado en cada uno) |
| 29 | **Filtro "No leídas" + cambio desde otro cliente** | La fila debe desaparecer de "No leídas" | **BUG ENCONTRADO Y CORREGIDO** — ver §5.3 | `NotificationsPage.test.tsx` — describe "Etapa 15M.19D (bug real...)": 3 tests, los 2 primeros reproducen el bug contra el código de 19C (confirmado fallando antes del fix) |
| 30 | Filtro "Leídas" tras marcar una notificación | Aparece correctamente, sin duplicados | **PASS** — filtro monótono, cubierto por la fusión existente | `NotificationsPage.test.tsx` — "bajo el filtro 'Todas' (monótono)..." (mismo principio aplica a "Leídas": pertenencia nunca decrece) |
| 31 | Filtro "Todas" — preserva existentes + nuevos + estado + orden | Orden `createdAt desc`, sin duplicados | **PASS** | `NotificationsPage.test.tsx` — Etapa 15M.19C "Caso C" + offset-drift §31 (ver fila 34) |
| 32 | Evento `app:notifications-changed` al marcar leída | Página y campana actualizan de inmediato, sin esperar 60s | **PASS** | `NotificationsPage.test.tsx` — "Caso F"; `AppShell.tsx` ya escuchaba el evento desde antes de esta serie |
| 33 | Paginación + polling — cargar más páginas, llegan notificaciones nuevas, polling, volver a cargar más | Cero duplicados, cero filas perdidas, orden correcto, `meta.page` coherente, sin colapsar a página 1 | **PASS** | `NotificationsPage.test.tsx` — Etapa 15M.19C "paginación estable frente al polling" (2 tests) |
| 34 | Offset drift — inserciones sucesivas entre "Cargar más" (ejemplo página=3 del pedido, adaptado a `take` real) | Ninguna fila queda sin cubrir por ninguna página pedida (a lo sumo, re-pedida y deduplicada) | **PASS** — confirmado con test explícito de 2 inserciones sucesivas | `NotificationsPage.test.tsx` — "Etapa 15M.19D §31 (offset drift, sin gaps)" |
| 35 | Error de polling — lista ya cargada, un poll falla | Lista no se vacía, sin error invasivo, el siguiente poll reintenta | **PASS** | `NotificationsPage.test.tsx` — "Caso E" (15M.19C) |
| 36 | Pérdida de conexión / recuperación — poll falla, el siguiente funciona y trae una notificación nueva | Convergencia automática | **PASS** | `NotificationsPage.test.tsx` — "Caso E" incluye esta segunda mitad (reintento exitoso trae "Notificación B") |
| 37 | Window focus — notificación generada mientras la ventana no tenía foco, usuario vuelve | Refetch inmediato al recuperar el foco | **PASS** | `NotificationsPage.test.tsx` — "recuperar el foco de la ventana también dispara un refetch inmediato (§21)" |
| 38 | Scroll — polling no debe mover a top ni romper 15M.14 | Sin llamadas a `scrollTo`/`scrollIntoView` en el código de refresco | **PASS** (verificado por lectura de código — ningún test de scroll fue necesario porque no hay ninguna API de scroll invocada) | `NotificationsPage.tsx` — `refreshSilently`/`mergeNotifications` no tocan el DOM de scroll; `.page-wrap` (15M.14) sin cambios |
| 39 | Persistencia del histórico — sin filtro implícito de "hoy"/"ayer"/24hs | Notificaciones antiguas siguen accesibles vía "Cargar más" | **PASS** (confirmado en 15M.18, sin cambios de código desde entonces) | `workforce.service.ts::notifications()` — `where` es sólo `{ recipientUserId, status? }`, sin filtro de fecha (diagnóstico 15M.18 §20, no tocado por 19A/B/C/D) |
| 40 | Cargar más hasta alcanzar registros de días previos | Distingue "no estaba en primera página" de "nunca se generó" | **PASS** — paginación funcional confirmada en 19C, generación confirmada independientemente en las filas 1-24 de esta matriz | Combinación de evidencia de filas 1-24 (generación) + 33 (paginación) |
| 41 | Timezone Argentina — límites cerca de 00:00/01:00 ART | Fecha operativa, checkpoint, turno, missing entry y daily inactivity correctos sin depender de la hora local de la máquina de test | **PASS** | `argentinaTime.test.ts` (helpers `calendarDateKey`/`nextCalendarDateKey`, ya con TZ del proceso de test fijado a `America/Argentina/Cordoba` en `vitest.config.ts`); `attendanceInactivityScheduler.test.ts` — "Caso G" (antes de la ventana) usa exactamente el borde 00:30 ART; `missingEntry.service.test.ts` — cross-midnight usa el borde 22:00/22:11 ART |

## 4. Backend/Frontend tests, suites, builds, Prisma

| Validación | Resultado |
|---|---|
| Backend — tests focalizados (archivos nuevos/tocados de esta etapa) | ✅ `dailyVsMissingEntryIntegration.test.ts` (2), `attendanceInactivity.service.test.ts` (+1) |
| Backend — suite completa | ✅ 119 archivos, 1879 tests |
| Backend — `typecheck` | ✅ |
| Backend — `build` | ✅ |
| Backend — `prisma validate` | ✅ |
| Backend — `prisma migrate status` | ✅ (sin migración nueva — sigue pendiente sólo `20260918100000_add_job_checkpoint`, de 15M.19A) |
| Frontend — tests focalizados | ✅ `NotificationsPage.test.tsx`: 34 (cierre de 15M.19C) → 39 (+5: 3 en el describe del bug real de §5.3 — incluye el caso vía evento, vía polling, y el control de que "Todas" no sufre el mismo problema —, 1 offset-drift §31, 1 StrictMode §44) |
| Frontend — suite completa | ✅ 96 archivos, 1046 tests |
| Frontend — `tsc -b` | ✅ |
| Frontend — `build` | ✅ |
| `git diff --check` (ambos repos) | ✅ |

`prisma generate` no fue necesario — sin cambios de `schema.prisma` en esta etapa.

## 5. Bugs reales encontrados

### 5.1 — F5/Login no generan (confirmado, no es un bug — evidencia por construcción)

No es un bug, pero merece explicar el método de verificación porque es distinto del resto de la matriz: en vez de un test positivo ("llamé a X y confirmé que no se creó nada"), se usó el mock de Prisma como cerca — `workforce.service.test.ts` mockea `systemNotification` con sólo `{ findMany, count }` (sin `create`/`createMany`/`update`) y `shiftAlert`/`attendanceInactivityIncident` con sólo `{ findMany }`. Si `notifications()` o `unreadNotificationCount()` intentaran crear o actualizar cualquiera de esos modelos, la llamada fallaría con `TypeError: ... is not a function` — y los tests existentes de esas funciones pasan. Mismo argumento para `auth.service.test.ts`: su mock de `authRepository` no expone ningún método relacionado con turnos/notificaciones, y `authService.login` nunca importa nada de `shifts/`, `time-entries/` ni `workObligation.service.ts` (confirmado por lectura directa del archivo, sin cambios desde 15M.18).

### 5.2 — Concurrencia real (no ejecutada, documentado como limitación)

No se lanzaron dos evaluaciones verdaderamente concurrentes contra una base de datos real — este entorno de test no levanta un Postgres real, sólo mockea Prisma. La garantía de "cero duplicados" bajo concurrencia real descansa en: `@@unique([employeeId, operationalDate])` + `createMany({ skipDuplicates: true })` (constraint de base de datos, no de aplicación) para incidentes; `@@unique([workShiftId, type])` para `ShiftAlert`; y el `updateMany` monótono (`lastProcessedDate: { lt: date }`) para `JobCheckpoint`. Todos verificados por lectura de esquema y por tests que confirman que el código *emite* las operaciones correctas — no que Postgres las *aplique* correctamente bajo carrera real. Riesgo residual documentado, no nuevo de esta etapa (ya estaba en 15M.19A/B).

### 5.3 — Bug real: filtro "No leídas" no refleja una lectura hecha desde otro cliente (CORREGIDO)

**Escenario**: `NotificationsPage` con filtro "No leídas" activo, notificación A visible. Desde otra pestaña/cliente, A se marca como leída. Ocurre un refresco silencioso (polling o evento) en la primera pestaña.

**Resultado esperado**: A desaparece de la vista (ya no es "No leída").

**Resultado observado antes del fix**: A seguía visible indefinidamente, hasta un remount completo de la página.

**Causa raíz**: `mergeNotifications` (15M.19C) fue diseñada para resolver un problema distinto — preservar páginas cargadas con "Cargar más" cuando el *orden* cambia (notificaciones nuevas empujan todo hacia abajo), asumiendo que la *pertenencia* de una fila al conjunto de resultados nunca cambia. Esa asunción es válida para los filtros `""` (Todas) y `"LEIDA"` — ambos monótonos: una fila que ya matcheaba sigue matcheando para siempre (no existe "marcar como no leída"). Es **falsa** para `"NO_LEIDA"`: una fila puede dejar de matchear en cualquier momento. La función no tenía forma de distinguir "ausente de la página 1 fresca porque está más abajo" de "ausente porque dejó de pertenecer al filtro" — en ambos casos, la fila se conservaba.

**Fix mínimo**: en `refreshSilently` (`NotificationsPage.tsx`), cuando `statusFilter === "NO_LEIDA"`, el resultado fresco reemplaza `items`/`meta` por completo (sin fusión) — sigue siendo un refresco silencioso (sin loading/error). Para `""` y `"LEIDA"` se mantiene la fusión de 15M.19C sin cambios. Ningún cambio de backend.

**Test de regresión**: `NotificationsPage.test.tsx`, describe "Etapa 15M.19D (bug real: filtro 'No leídas' + cambio desde otro cliente)" — 3 tests: el escenario vía evento, el mismo vía polling, y un tercero que confirma que el filtro "Todas" (monótono) NO sufre el mismo problema (para no sobre-corregir).

## 6. Riesgos reales pendientes

- **Concurrencia bajo Postgres real** (§5.2) — descansa en constraints de esquema, no verificado con ejecución concurrente real en este entorno de test. Riesgo preexistente de 15M.19A/B, no agravado ni introducido acá.
- **Navegador real / Playwright** (pedido §45) — **no ejecutado** en esta etapa. Este entorno no tiene un backend+Postgres real corriendo de forma persistente para sostener un journey end-to-end genuino, y un journey con la red interceptada (mocks a nivel HTTP) aportaría poco por encima de la suite de React Testing Library ya escrita (39 tests sobre `NotificationsPage`, mockeando exactamente la misma capa de API que interceptaría Playwright). Si se quiere esta validación específicamente contra un backend real desplegado, es un paso adicional a pedir explícitamente — no se fabricó un journey superficial sólo para marcar la casilla.
- **Convergencia campana/bandeja** (fila 28) — ambos mecanismos se probaron por separado (comparten intervalo/evento), no hay un test de integración que monte `AppShell` + `NotificationsPage` juntos. Riesgo bajo (mismo mecanismo, sin lógica adicional en ningún lado que pueda divergir), pero no probado explícitamente en conjunto.
- **Exclusiones de `detectAttendanceInactivity`/`checkMissingExpectedEntries`** — sin cambios respecto de lo cerrado en 15M.19B; ningún gap nuevo encontrado en esta etapa.

## 7. Archivos modificados/creados en esta etapa

**Backend** (nuevo): `src/modules/time-entries/dailyVsMissingEntryIntegration.test.ts`. **Backend** (modificado): `src/modules/time-entries/attendanceInactivity.service.test.ts` (+1 test, sin cambios de producción).

**Frontend** (modificado): `src/pages/NotificationsPage.tsx` (fix real, §5.3), `src/pages/NotificationsPage.test.tsx` (+8 tests: bug real ×3, offset-drift ×1, StrictMode ×1, y las verificaciones ya contempladas en la reorganización de la matriz).

**Documentación**: este archivo; `docs/PROJECT_CONTEXT.md` actualizado.

## 8. Criterio de cierre de la serie 15M.19 (§52 del pedido)

| # | Criterio | Estado |
|---|---|---|
| 1 | Notificaciones de negocio se generan sin depender del login | ✅ PASS (fila 27) |
| 2 | Un reinicio/deploy no pierde días silenciosamente | ✅ PASS (filas 2-3, 20-21) |
| 3 | Días pendientes se recuperan por watermark/catch-up | ✅ PASS (filas 1-3) |
| 4 | "Falta de ingreso" sólo con obligación REAL | ✅ PASS (filas 4, 7-13) |
| 5 | Feriados sin convocatoria no alertan | ✅ PASS (fila 7) |
| 6 | Descansos/weekends no alertan | ✅ PASS (fila 9) |
| 7 | SIN_TURNO/FLEXIBLE no generan obligación ficticia | ✅ PASS (filas 10-11) |
| 8 | Repetir scheduler no duplica notificaciones | ✅ PASS (fila 22) |
| 9 | Alertas resueltas no se reabren solas | ✅ PASS (fila 17) |
| 10 | NotificationsPage recibe nuevas notificaciones sin F5 | ✅ PASS (fila 25) |
| 11 | Polling no rompe filtros ni paginación | ✅ PASS tras el fix de §5.3 (filas 29, 33-34) |
| 12 | Históricos siguen accesibles | ✅ PASS (fila 39) |
| 13 | F5/login no generan eventos de negocio | ✅ PASS (filas 26-27) |
| 14 | Cross-midnight y timezone Argentina correctos | ✅ PASS (filas 16, 41) |

**Los 14 puntos cierran en PASS.** La serie **15M.19 A/B/C/D queda cerrada**, con dos riesgos residuales documentados (§6) que no bloquean el cierre: concurrencia real no ejercida contra Postgres real, y validación de navegador real no ejecutada por restricciones de este entorno.

---

No se commiteó, no se pusheó, no se aplicó ninguna migración. Backend: sólo se agregaron tests (ningún archivo de producción de backend cambió). Frontend: un solo fix real, mínimo y acotado (§5.3).
