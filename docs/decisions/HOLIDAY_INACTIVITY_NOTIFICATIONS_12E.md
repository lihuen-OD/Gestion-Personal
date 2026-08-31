# Etapa 12E — "Sin actividad registrada" según asignaciones de feriado

Fecha: 2026-08-31
Estado: implementado, validado, pendiente de aprobación para commitear
Continúa: `docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_12A.md`, `docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_12B.md`, `docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_UX_12C.md`, `docs/decisions/HOLIDAY_WORK_ASSIGNMENTS_12D.md`, `docs/decisions/ATTENDANCE_SHIFT_ALERTS_NOTIFICATIONS_AUDIT_10E.md` (hallazgo original de este gap, §12 "riesgos pendientes")

## 1. Resumen ejecutivo

`detectAttendanceInactivity` (la función que genera la notificación `SIN_ACTIVIDAD_REGISTRADA`) ahora respeta la expectativa real de trabajo en fechas feriado. Antes de esta etapa, un empleado activo sin fichadas/horas/novedades generaba el incidente sin importar si el día era un feriado ni si alguien lo había convocado a trabajarlo. Ahora: si la fecha evaluada es un feriado (`DoubleHourRule.kind=FERIADO`, nunca por nombre de regla — 12B), sólo se evalúa a los empleados con una convocatoria `HolidayWorkAssignment` **ACTIVA** para esa fecha exacta (12D); quien no fue convocado nunca genera incidente ni notificación, sin importar que esté activo y sin actividad. En días no feriado, el comportamiento queda exactamente igual que antes. Cambio acotado a un solo archivo de producción (`attendanceInactivity.service.ts`, +2 queries condicionales, 0 nuevas tablas/migraciones) más un archivo de test nuevo (no existía antes). No se tocó el frontend — el renderizador de notificaciones ya muestra `message` tal cual llega del backend, sin ningún copy hardcodeado por tipo. +15 tests backend (901→916), todos verdes. No se tocó liquidación, fichador, Conceptos Horarios, carga horaria/grilla/export/bandeja, ni `HolidayWorkAssignment`.

## 2. El problema

`docs/decisions/ATTENDANCE_SHIFT_ALERTS_NOTIFICATIONS_AUDIT_10E.md` ya había dejado documentado (como hallazgo, sin corregirlo) que Asistencia/Alertas de Turnos no eran "régimen-conscientes"; y `docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_12A.md` §4.10 confirmó con evidencia de código que `detectAttendanceInactivity` notificaba a **todo** empleado activo sin actividad, sin ninguna noción de turno, régimen ni feriado. El caso concreto que esto rompía: un feriado sin convocatoria explícita generaba una alerta de "falta" para cada empleado activo de la empresa, aunque nadie esperara que trabajaran ese día — ruido sistemático, no una detección real de ausencia.

## 3. Contrato conceptual

```
DoubleHourRule.kind=FERIADO   → cuánto vale trabajar ese día (Horas Especiales, 12B) — liquidación, no expectativa.
HolidayWorkAssignment ACTIVA  → quién estaba convocado a trabajar ese feriado (Turnos, 12D) — expectativa, no liquidación.
"Sin actividad registrada"    → sólo debe existir si había expectativa real de actividad (12A regla 9).
```

En feriado, la expectativa la define exclusivamente `HolidayWorkAssignment` — nunca "tener turno habitual" (`ShiftAssignment`), nunca "estar activo" (`Employee.status`) por sí solos. Si alguien trabaja sin estar convocado, la liquidación x2 la sigue resolviendo Horas Especiales sin cambios — esta etapa no bloquea ni corrige eso, sólo evita ruido de notificación.

## 4. Diagnóstico actual (Parte 1 del pedido, con evidencia)

1. **Dónde se genera**: `backend/src/modules/time-entries/attendanceInactivity.service.ts`, función `detectAttendanceInactivity(dateKey)` — único punto de generación en todo el repo (confirmado por grep, ningún otro archivo crea incidentes de este tipo).
2. **Qué lo ejecuta**: `clockPunchMaintenance.ts` → `maintainClockPunchAttempts()`, dentro del mismo cron de mantenimiento de 60s que ya corre otras tareas (jornadas vencidas, riesgo de olvido de salida). La detección de inactividad en sí sólo corre **una vez por día operativo** (`lastInactivityDateKey !== inactivityDateKey`), después de una hora configurable (`env.ATTENDANCE_INACTIVITY_CHECK_HOUR/MINUTE`), evaluando siempre el día operativo **anterior** (`previousOperationalDateKey`).
3. **Cómo decide qué empleados evaluar (antes de esta etapa)**: un único `prisma.employee.findMany` con `status: ACTIVO` + 4 condiciones de exclusión (ver puntos 4-7).
4. **Condiciones que excluyen a un empleado (antes de esta etapa)**: `attendancePunches: { none: {...} }` (sin fichadas ese día), `workShifts: { none: {...} }` (sin ninguna jornada iniciada ese día), `timeEntries: { none: {...} }` (sin ninguna carga horaria ese día), `novelties: { none: {...} }` (sin ninguna novedad vigente no rechazada ese día).
5. **Fichadas**: `attendancePunches: { none: { timestamp: { gte: localStart, lt: localEnd } } }` — rango del día operativo en horario Argentina real (`argentinaDayRange`).
6. **Horas cargadas**: `timeEntries: { none: { date: { gte: operationalDate, lt: nextOperationalDate } } }` — cualquier `TimeEntry` (manual o de fichador) de esa fecha excluye.
7. **Novedades**: `novelties: { none: { status: { not: "RECHAZADO" }, ... } }` — cualquier novedad vigente ese día (no rechazada) excluye.
8. **¿Consulta `ShiftAssignment`?** No, en ningún punto — confirmado.
9. **¿Consulta `WorkRegime`?** No — confirmado. (Distinto del gap ya cerrado en la Etapa 10E, que sí conecta régimen con `POSIBLE_OLVIDO_SALIDA`; éste es un servicio completamente separado.)
10. **¿Consulta feriados/Horas Especiales?** No, antes de esta etapa — cero referencias a `DoubleHourRule` en todo el archivo.
11. **Control anti-duplicados**: dos capas — `AttendanceInactivityIncident.@@unique([employeeId, operationalDate])` + `skipDuplicates: true` en el `createMany` (un mismo empleado/fecha nunca genera dos incidentes); y `notifiedAt: null` como guardia de "ya se avisó" antes de crear las `SystemNotification` (un incidente ya notificado no vuelve a notificarse en una corrida posterior).
12. **Mensaje actual**: `"${apellido}, ${nombre} · Legajo ${legajo} no registra actividad para el ${dateKey}."`, título fijo `"Sin actividad registrada"`.
13. **Payload/metadata de la notificación**: `SystemNotification` (schema.prisma:1072) es de columnas fijas — `type`, `priority`, `title`, `message`, `entityType`, `entityId`, `link` — **no tiene ningún campo `metadata`/JSON genérico**. `entityType: "AttendanceInactivityIncident"`, `entityId: incident.id`.
14. **Cómo se testea hoy**: no existía ningún archivo de test para este servicio antes de esta etapa — confirmado (`find backend/src -iname "*attendanceInactivity*"` sólo devolvía el archivo de producción). Se creó `attendanceInactivity.service.test.ts` en esta etapa (ver §10).
15. **Dónde consultar `HolidayWorkAssignment` sin romper performance**: una sola consulta adicional, acotada a `date = operationalDate` exacta (índice `@@index([date, status])` ya existe desde 12D), **antes** de la consulta principal de empleados — nunca dentro de un loop.

## 5. Cambios implementados

Un solo archivo de producción tocado: [attendanceInactivity.service.ts](../../backend/src/modules/time-entries/attendanceInactivity.service.ts).

1. Import nuevo: `workforceService` (`workforce-management`) — mismo patrón cruzado ya usado por `timeEntries.repository.ts` (que ya importa `doubleHourRuleMatching.ts` del mismo módulo dueño de `DoubleHourRule`).
2. Al inicio de `detectAttendanceInactivity`: una consulta a `workforceService.holidayDatesInRange(operationalDate, operationalDate)` (la misma función fina de 12D, sin tocarla) determina `isHoliday`.
3. Si `isHoliday`, una consulta a `prisma.holidayWorkAssignment.findMany({ where: { date: operationalDate, status: "ACTIVA" }, select: { employeeId: true } })` — el `Set`/array de `employeeId` resultante es el único universo posible de candidatos ese día. Si viene vacío, corta inmediatamente (`return { detected: 0, notified: 0 }`) sin tocar la tabla `Employee` en absoluto.
4. La query principal de candidatos gana una condición más: `...(convokedEmployeeIds ? { id: { in: convokedEmployeeIds } } : {})` — en día normal (`convokedEmployeeIds === null`) esta condición no se agrega, el `where` queda **byte a byte igual** al de antes de esta etapa.
5. `observation` (del incidente) y `message` (de la notificación) ganan una rama condicional para el caso feriado — ver §8.

## 6. Regla de detección de feriado (Parte 3 del pedido)

La fecha es feriado si `workforceService.holidayDatesInRange(operationalDate, operationalDate)` devuelve al menos un resultado — esa función (12D, sin tocar en esta etapa) ya filtra exclusivamente por `DoubleHourRule.kind = FERIADO` (12B), reutilizando `calendarPreview` sin duplicar el cálculo de calendario. **Cero uso de `rule.name`, `.includes("feriado")`, texto visible ni labels traducidos** en todo el cambio — confirmado por lectura y por los tests 8/9 (§10), que prueban explícitamente que una regla llamada "Feriados" con `kind=OTRO` no activa nada, y una llamada "Pedro" con `kind=FERIADO` sí.

**Decisión de scope — V1 global por fecha (limitación documentada)**: `holidayDatesInRange` no resuelve el scope (empresa/sector/centro de costo/puesto) de la `DoubleHourRule` que originó el feriado — sólo dice "esta fecha del calendario tiene al menos una regla FERIADO activa que la alcanza". Se evaluó resolver ese scope acá (reutilizando `doubleHourRuleScopeWhere` de `timeEntries.repository.ts`) y se descartó por dos razones: (1) esa función no está exportada, vive acoplada al motor real de liquidación — exportarla/duplicarla para un job de notificaciones agrega superficie de cambio y riesgo sin necesidad confirmada; (2) **el scope de "quién debía trabajar" ya lo resuelve `HolidayWorkAssignment` de forma explícita y por persona** — es una decisión real de RRHH (12D), estrictamente más precisa que cualquier heurístico de scope de la regla de Horas Especiales. El único riesgo real de este V1: si dos reglas `FERIADO` con scope distinto (ej. una para Empresa A, otra para Empresa B, en fechas distintas) coincidieran, un empleado de la Empresa B sin convocatoria en la fecha de la Empresa A simplemente no genera incidente ese día — comportamiento correcto en ese caso puntual. El riesgo teórico real es el inverso: si una fecha es feriado sólo para una empresa/sector y un empleado de **otra** empresa que debía trabajar normalmente ese día no ficha, hoy tampoco generaría incidente (porque la fecha ya cuenta como "feriado" para todo el sistema). **Verificado contra datos reales**: hoy no existe ninguna `DoubleHourRule` con `kind=FERIADO` con scope configurado (las únicas reglas reales, "Domingos" y "Feriados", siguen en `kind=OTRO` — 12B/12C), así que este riesgo no tiene ningún caso real hoy. Documentado como limitación V1 explícita, no bloqueante, candidata a revisarse si aparece un caso real de reglas `FERIADO` con scope distinto por empresa/sector.

## 7. Relación con `HolidayWorkAssignment`

Se consulta, no se modifica — cero cambios en `holidayWorkAssignment.{repository,service,controller,schemas}.ts` ni en el modelo `HolidayWorkAssignment` (no apareció ningún bug real que lo requiriera). La consulta usa exactamente los 3 criterios pedidos: `date` exacta (`operationalDate`, mismo valor ya calculado por `ranges()` para todo lo demás), `status: "ACTIVA"` (una `CANCELADA` nunca aparece en el resultado — se trata como no-convocado sin ninguna rama especial, por construcción de la query), `employeeId` (proyectado con `select`, sin traer columnas de más). No se exige `shiftTemplateId` — un empleado convocado sin turno habitual (`shiftTemplateId: null`, caso explícitamente soportado desde 12D) entra al filtro igual que cualquier otro convocado, porque el filtro sólo mira `employeeId`.

**No hay N+1**: exactamente 2 consultas nuevas por corrida completa (`holidayDatesInRange` + `holidayWorkAssignment.findMany`), ambas antes del loop de empleados, nunca dentro de él — confirmado con test dedicado (§10, test 10) que corre el flujo completo con 3 empleados convocados y verifica que ambas funciones se llamaron exactamente una vez.

## 8. Mensaje de notificación

Se mantiene el `type: "SIN_ACTIVIDAD_REGISTRADA"` y el título `"Sin actividad registrada"` sin cambios. El `message`/`observation` ganan una rama sólo para el caso feriado+convocado:

- **Incidente** (`AttendanceInactivityIncident.observation`): *"La persona estaba convocada a trabajar el feriado del {fecha} y no se registraron fichadas, horas ni novedades. Requiere revisión."*
- **Notificación** (`SystemNotification.message`): *"{Apellido}, {Nombre} · Legajo {legajo} estaba convocado a trabajar el feriado del {fecha} y no registra actividad."*
- Día no feriado: mensaje idéntico al de siempre, sin cambios.

**Sin metadata nueva**: `SystemNotification` no tiene ningún campo `metadata`/JSON genérico (confirmado en el diagnóstico, §4.13) — el pedido pedía agregar `reason`/`holidayWorkAssignmentId`/`date` "si la notificación actual tiene metadata". Como no lo tiene, no se agregó ninguna migración ni columna nueva para esto: la distinción queda encodeada únicamente en el texto del `message`, que es lo mínimo necesario y no rompe ninguna compatibilidad (`entityType`/`entityId` siguen apuntando al incidente exactamente igual que antes, sin cambiar su semántica).

**Sin lenguaje técnico**: ni "HolidayWorkAssignment", ni "kind", ni "DoubleHourRule", ni "enum", ni "backend" aparecen en ningún texto — verificado con test (§10, test 14).

**Frontend**: no se tocó ningún archivo. `NotificationsPage.tsx` ya renderiza `item.title`/`item.message` tal cual llegan del backend (`<p>{item.message}</p>`), sin ningún mapeo ni copy hardcodeado por `type` — confirmado por lectura del componente. El mensaje nuevo se ve correctamente sin ningún cambio de frontend.

## 9. Casos funcionales (Parte 6 del pedido)

| # | Caso | Resultado |
|---|---|---|
| 1 | Administrativo no convocado, feriado, sin actividad | NO genera |
| 2 | Pañol convocado (`ACTIVA`), feriado, sin actividad | SÍ genera, mensaje de feriado |
| 3 | Pañol convocado, feriado, con fichada | NO genera (excluido por `attendancePunches`) |
| 4 | Convocado, feriado, sin fichada pero con `TimeEntry` | NO genera (excluido por `timeEntries`) |
| 5 | Convocado, feriado, con novedad válida | Mismo comportamiento que hoy (excluido por `novelties`, sin cambios de esa condición) |
| 6 | Convocación `CANCELADA`, feriado, sin actividad | NO genera (la query de asignaciones sólo trae `ACTIVA`) |
| 7 | No convocado, feriado, ficha | NO genera; no bloquea; liquidación sigue en Horas Especiales, sin tocar |
| 8 | Día normal, sin actividad | Comportamiento idéntico al de antes de esta etapa |
| 9 | Regla "Feriados" con `kind=OTRO` | NO se trata como feriado |
| 10 | Regla "Pedro" con `kind=FERIADO` | SÍ se trata como feriado |

Los 10 casos tienen test dedicado o cubierto explícitamente (ver §10).

## 10. Tests

**Backend** (+15 tests, nuevo archivo `attendanceInactivity.service.test.ts` — no existía ninguno antes de esta etapa; 901 → 916, todos verdes):

1. Feriado sin ningún convocado → no genera, corta antes de consultar `Employee`.
2. Feriado con un convocado sin actividad → genera el incidente.
3. Feriado: el `where` exige convocatoria activa **y** ausencia de fichadas (`attendancePunches: none`).
4. Feriado: el `where` también exige ausencia de `TimeEntry` (`timeEntries: none`).
5. Feriado: el `where` de novedades queda exactamente igual al de antes de esta etapa (regresión, comparación estructural completa).
6. `CANCELADA` se trata como no convocado — la query de asignaciones sólo pide `status: "ACTIVA"`, y sin ninguna activa no notifica.
7. Día normal — sin filtro `id` en el `where`, `holidayWorkAssignment.findMany` ni se llama.
8. Regla "Feriados" `kind=OTRO` no activa la lógica de feriado.
9. Regla "Pedro" `kind=FERIADO` sí la activa.
10. Sin N+1 — ambas consultas nuevas se llaman exactamente una vez con 3 empleados convocados.
11. No toca liquidación — el mock de Prisma sólo expone `employee`/`holidayWorkAssignment`/`attendanceInactivityIncident`/`user`/`$transaction`; cualquier intento de tocar `doubleHourRule`/`timeSegment` fallaría en el test en vez de pasar en silencio.
12. No crea fichadas ni `TimeEntry` — mismo argumento estructural.
13. Control anti-duplicado sigue funcionando — `createMany` con `skipDuplicates: true`, `findMany` de pendientes con `notifiedAt: null`.
14. Mensaje de feriado convocado exacto, sin lenguaje técnico.
    - Extra: regresión del mensaje genérico en día normal.

**Frontend**: ninguno agregado — no se tocó ningún archivo de frontend (ver §8, el renderizador ya es genérico). Cumple "no agregar tests frontend innecesarios si no hay cambios visibles".

## 11. Performance

- **1 consulta para saber si la fecha es feriado** (`holidayDatesInRange`, rango de un solo día — `from === to === operationalDate`).
- **1 consulta para las asignaciones activas de la fecha** (sólo si es feriado; corta antes si no hay ninguna).
- **Cero consultas por empleado** — ambas consultas nuevas van antes del loop principal, nunca dentro de él (verificado con test).
- **El job evalúa una sola fecha por corrida** (el día operativo anterior, una vez por día) — nunca un rango; se usó `from === to` tal como pide la Parte 9.
- **Ningún cache tocado** — `frontend/src/services/cache/` y `backend/src/shared/cache/` sin cambios; este servicio nunca tuvo cache (corre en un cron, no detrás de un endpoint HTTP) y sigue sin tenerlo.

## 12. Qué NO se tocó

- El motor de matching/prioridad/scope de Horas Especiales (`doubleHourRuleMatching.ts`) — sin cambios.
- `calendarPreview`/`holidayDatesInRange` (`workforce.service.ts`) — sin cambios, sólo consumidos.
- `HolidayWorkAssignment` (modelo, repositorio, servicio, controller, schemas, pantalla de Turnos) — sin cambios, sólo consultado en lectura.
- El fichador — ningún archivo tocado.
- Conceptos Horarios (`hour-concepts`) — ningún archivo tocado.
- Carga horaria / grilla / export / bandeja de revisión (`timeEntries.*`, `HoursPage.tsx`, `EmployeeHoursPage.tsx`) — ningún archivo tocado.
- `ShiftAssignment`/`WorkRegime` — no se consultaron ni se tocaron (a propósito — la expectativa en feriado es 100% de `HolidayWorkAssignment`, nunca de turno habitual ni de régimen).
- El resto de `clockPunchMaintenance.ts` (jornadas vencidas, riesgo de olvido de salida) — sin cambios, sólo se sigue llamando a `detectAttendanceInactivity` exactamente igual que antes.
- El control anti-duplicados existente (`@@unique`, `skipDuplicates`, `notifiedAt`) — sin cambios, sólo verificado que sigue funcionando.
- Frontend — ningún archivo tocado.
- Permisos — sin cambios (este servicio no expone ningún endpoint HTTP propio, corre en un cron interno).

## 13. Riesgos pendientes

- **V1 global por fecha, sin resolver scope de la regla FERIADO** (§6) — limitación documentada y aceptada; sin impacto real hoy (no hay reglas `FERIADO` con scope configurado en producción). Candidata a revisión si aparece un caso real de dos reglas `FERIADO` con scope distinto (empresa/sector) en fechas potencialmente superpuestas.
- **Sin reglas `FERIADO` reales todavía en producción** (mismo estado ya documentado en 12D) — este cambio no puede verse "en acción" contra datos reales hasta que RRHH reclasifique al menos una regla desde Horas Especiales y cree al menos una convocatoria desde Turnos.
- **`SystemNotification` sigue sin metadata estructurada** — la distinción feriado/no-feriado vive sólo en el texto del mensaje; si en el futuro se necesita filtrar/agrupar notificaciones por este motivo de forma estructurada (no sólo leyendo el texto), haría falta una migración (`reason`/columna nueva), fuera del alcance de esta etapa.
- Los riesgos ya documentados en 12A/12B/12C/12D siguen vigentes sin cambios — ninguno agravado ni resuelto por esta etapa.

## 14. Próximas etapas

- Si en el futuro se decide resolver el scope real de la regla `FERIADO` para la detección de "es feriado" (en vez del V1 global por fecha), evaluar exportar `doubleHourRuleScopeWhere` desde `timeEntries.repository.ts` o construir una versión de sólo lectura en `workforce-management`, sin duplicar la lógica de scope.
- Si se prioriza que otras superficies (Asistencia, Alertas de Turnos) también respeten `HolidayWorkAssignment` de la misma forma, evaluarlo como una etapa separada — esta etapa sólo tocó "Sin actividad registrada".

---

No se modificó `schema.prisma`, no se crearon migraciones, no se tocó el motor de liquidación, el fichador, Conceptos Horarios, carga horaria/grilla/export/bandeja, ni `HolidayWorkAssignment`. No commitear sin aprobación explícita del usuario.
