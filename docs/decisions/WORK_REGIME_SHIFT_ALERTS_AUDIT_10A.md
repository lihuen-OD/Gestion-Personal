# Etapa 10A — Auditoría de Régimen Laboral, Turnos, Fichador y Notificaciones

Fecha: 2026-08-27
Estado: auditoría completa, sin cambios de código (etapa explícitamente diagnóstica)
Alcance: relación funcional entre Régimen Laboral, Turnos, Fichador, Alertas (`ShiftAlert`), Notificaciones (`SystemNotification`) y Legajos

## 1. Resumen ejecutivo

**Hallazgo central, y el más importante de esta auditoría: el mecanismo que este pedido buscaba diseñar ya existe en el código, construido en una etapa reciente y deliberada (identificada en el propio código como "Etapa 5", confirmada de forma independiente en dos módulos distintos: `timeEntries.repository.test.ts:216` y el historial de commits de `work-regimes`).** No es una propuesta a implementar desde cero — es infraestructura real, con tests, que resuelve exactamente el caso de negocio descripto (cosecha con horario variable):

- `WorkRegime.alertOnOutOfShift` (booleano) — si está en `false` para el régimen vigente de un empleado, **suprime** las 3 alertas de "fuera de turno" (`TURNO_NO_IDENTIFICADO`, `SHIFT_NOT_ENABLED_FOR_EMPLOYEE`, `POSSIBLE_SHIFT_CONFIGURATION_MISSING`) — `backend/src/modules/shifts/workShiftEvaluationRunner.ts:147-160,174`.
- `WorkRegime.openShiftOverflowAction` (`ROLLOVER | ALERT_ONLY`) — decide si una jornada abierta que excede el límite absoluto se cierra sola en 0 horas (comportamiento histórico) o queda abierta con una alerta crítica para revisión de RRHH — `backend/src/modules/time-entries/timeEntries.repository.ts:1146-1160`, `timeEntries.service.ts:1146-1147,1345-1346`.

Es decir: **Régimen Laboral hoy sí impacta la operación real** (fichador y alertas), no es un dato decorativo de legajo, y ya distingue "sin turno permitido" (régimen flexible) de "sin turno problemático" (régimen que exige alertar, o sin régimen asignado — que es el comportamiento por defecto y conservador).

Lo que la auditoría sí encontró como brechas reales, con evidencia concreta:

1. **La cobertura es parcial.** Sólo 3 de los 12 tipos de `ShiftAlert` son suprimibles por régimen. `JORNADA_EXTENDIDA` — el tipo más relevante para "jornada muy larga" en cosecha/pañol — **no** es suprimible ni configurable por régimen hoy; depende únicamente de `ShiftTemplate.maximumInformativeMinutes` (o un default de 600 min si no hay turno asignado). Un empleado de cosecha con régimen bien configurado (`alertOnOutOfShift=false`) igual va a generar `JORNADA_EXTENDIDA` en una jornada de 16 horas.
2. **Bug real de alertas huérfanas/contradictorias**, confirmado con código: cuando una jornada abierta se cierra automáticamente (`expireOpenWorkShifts`), ningún código actualiza/resuelve las alertas `POSIBLE_OLVIDO_SALIDA` que ya existían para esa jornada — quedan `PENDIENTE` indefinidamente en `/turnos/alertas` aunque el sistema ya resolvió el problema por su cuenta. Además se generan **dos notificaciones distintas** (`ALERTA_FICHADA` + `FALTA_SALIDA`) para el mismo hecho de negocio.
3. **Enum drift real**: `CONCEPTO_NO_HABILITADO` y `SEGMENTO_SIN_CLASIFICAR` existen en el schema y se generan en producción, pero faltan en el schema Zod de filtro (`shiftAlert.schemas.ts` — bloquea el filtro con 400), en los tipos del frontend, y en `TYPE_LABELS` de `ShiftAlertsPage.tsx` (deja la celda de tipo en blanco).
4. **Régimen y Turno no se conectan visualmente en el Legajo.** Son dos tabs separados (9 y 11, con "Auditoría" interpuesto) sin ningún cross-link. Un usuario no puede ver de un vistazo si un empleado es de régimen flexible al mirar su tab de Turnos.
5. **Régimen no es obligatorio ni se sugiere al alta de un legajo** — un empleado puede quedar creado y operando sin ningún régimen asignado, lo cual activa el comportamiento por defecto (alertar siempre), incluyendo para empleados de cosecha que en teoría deberían ser flexibles.
6. **`WorkRegime.kind` es semi-decorativo** — no rama ninguna lógica de negocio directamente (sólo `alertOnOutOfShift`/`openShiftOverflowAction` lo hacen), así que un régimen puede quedar con `kind=SIN_TURNO` pero `alertOnOutOfShift=true` (el default), contradiciendo su propio nombre, sin que nada en la UI lo impida o lo advierta.

**Conclusión de la auditoría**: no hace falta un rediseño conceptual ni cambios de schema. La separación conceptual que pedía el objetivo (Régimen = modalidad general, Turno = horario concreto, Fichador = registra lo real, Motor de alertas = decide una alerta coherente) **ya está implementada correctamente a nivel de arquitectura**. El trabajo que falta es: cerrar la brecha de cobertura de `JORNADA_EXTENDIDA`, arreglar el bug de alertas huérfanas/notificaciones duplicadas, corregir el enum drift, y mejorar la visibilidad/obligatoriedad del régimen en el flujo de Legajos. Ver §15-18 para el plan concreto.

## 2. Estado actual de Régimen Laboral

Módulo: `backend/src/modules/work-regimes/` (controller/service/repository/routes/schemas, cada uno con su `*.test.ts`). Frontend: `frontend/src/pages/WorkRegimesPage.tsx` (catálogo) + `frontend/src/components/employees/EmployeeWorkRegimePanel.tsx` (asignación, colgado del legajo).

**Modelo `WorkRegime`** (`backend/prisma/schema.prisma:1147-1167`):
```prisma
model WorkRegime {
  id                      String                  @id @default(uuid())
  code                    String                  @unique
  name                    String
  kind                    WorkRegimeKind
  alertOnOutOfShift       Boolean                 @default(true)
  openShiftOverflowAction OpenShiftOverflowAction @default(ROLLOVER)
  description             String?
  status                  RecordStatus            @default(ACTIVO)
  createdByUserId         String?
  updatedByUserId         String?
  createdAt               DateTime                @default(now()) @db.Timestamptz(3)
  updatedAt               DateTime                @updatedAt @db.Timestamptz(3)
  createdBy           User?                @relation("WorkRegimeCreatedBy", ...)
  updatedBy           User?                @relation("WorkRegimeUpdatedBy", ...)
  employeeAssignments EmployeeWorkRegime[]
  @@index([status])
  @@index([kind])
}
```
Enum `WorkRegimeKind` (`schema.prisma:262-266`): `TURNO_OBLIGATORIO | TURNO_FLEXIBLE | SIN_TURNO`, con comentario explícito en el schema: *"Comportamientos genéricos, no nombres de cliente. Instancias concretas (Cosecha, Riego, Campaña, Jornada libre controlada, etc.) son datos configurables de `WorkRegime`, nunca valores de este enum."* Enum `OpenShiftOverflowAction` (`schema.prisma:274-277`): `ROLLOVER | ALERT_ONLY`.

Tabla de asignación con vigencia, `EmployeeWorkRegime` (`schema.prisma:1174-1195`) — `employeeId`, `workRegimeId`, `effectiveFrom`/`effectiveTo` (`@db.Date`), `assignedByUserId`. No hay tolerancia horaria en `WorkRegime` — eso vive exclusivamente en `ShiftTemplate`.

**Backend**: no es CRUD completo — no hay `DELETE`, sólo `GET /`, `GET /:id`, `GET /:id/employees`, `POST /`, `PATCH /:id`, `PATCH /:id/status` (soft toggle) (`workRegimes.routes.ts:26-38`), más el sub-router de asignación (`GET/POST /employees/:employeeId/work-regimes`, `PATCH .../:assignmentId`, `PATCH .../:assignmentId/close`, `workRegimes.routes.ts:44-70`). Valida: empleado existente, **no permite dos asignaciones vigentes solapadas** (`assertNoOverlap`, `workRegimes.service.ts:84-93`), `code` único.

**Frontend**: el modal de creación/edición de `WorkRegime` (`WorkRegimesPage.tsx:259-300`) completa todos los campos del modelo, incluyendo los dos campos de comportamiento con labels literales: *"Alertar si el empleado no tiene turno compatible"* (`alertOnOutOfShift`) y *"Acción ante jornada abierta excedida"* (`openShiftOverflowAction`). La propia pantalla se autodefine con un texto explícito: *"El régimen laboral define cómo se comporta el sistema frente al empleado. No es el horario del turno."* (`WorkRegimesPage.tsx:184-187`).

**Asignación a empleado**: únicamente desde el Legajo (tab "Régimen Laboral", índice 11 de `EmployeeDetailPage.tsx`), 1x1. Desde `WorkRegimesPage.tsx` sólo se puede **ver** qué empleados tienen asignado un régimen (`AssociatedEmployeesPanel` en modo solo lectura, `WorkRegimesPage.tsx:302-321`) — no hay asignación/desasignación en bulk desde el catálogo (el componente compartido sí soporta esa capacidad, pero `WorkRegimesPage` no la activa).

**Historial**: doble mecanismo — (a) la propia tabla `EmployeeWorkRegime` con vigencias actúa como historial de negocio, mostrado como tabla en el panel del legajo; (b) `auditService.register()` genérico con `entity: "EmployeeWorkRegime"`, pero con un bug de trazabilidad (ver §11).

**Uso real fuera del propio módulo** (grep exhaustivo confirmado por 3 agentes independientes desde ángulos distintos — Régimen, Turnos, Fichador): `alertOnOutOfShift` y `openShiftOverflowAction` se leen en `workShiftEvaluationRunner.ts` y en `timeEntries.service.ts`/`timeEntries.repository.ts`. **No** se leen en cálculo de horas/liquidación, dashboard/reportes, ni en `hour-concepts`/`finnegans-export`/`novelties`. El campo `kind` no rama ninguna lógica de producción — sólo se usa para mostrar la etiqueta.

## 3. Estado actual de Turnos

Módulo: `backend/src/modules/shifts/` (matching, alertas) + `backend/src/modules/workforce-management` (`ShiftTemplate` CRUD). Frontend: `ShiftsPage.tsx`, `ShiftDetailPage.tsx`, `ShiftAlertsPage.tsx`.

**`ShiftTemplate`** (`schema.prisma:1073-1110`): horarios concretos (`startTime`/`endTime`/`crossesMidnight`), tolerancias (`entryToleranceBeforeMinutes`/`AfterMinutes`, `exitToleranceBeforeMinutes`/`AfterMinutes`), umbrales (`minimumMinutesForCompliance`, `maximumInformativeMinutes`, `missingOutAlertAfterMinutes`, `absoluteOpenShiftLimitMinutes` default 1200 min), y 3 campos declarados pero **sin consumidor real** (`warningThresholdMinutes`/`reviewThresholdMinutes`/`criticalThresholdMinutes` — ver §9).

**`ShiftAssignment`** (`schema.prisma:1112-1140`): asignación de plantilla a empleado con vigencia (`effectiveFrom`/`effectiveTo`, `@db.Date`) y `weekdays Int[]` (vacío = todos los días). Constraint `@@unique([employeeId, shiftTemplateId])` — reactivar en vez de duplicar.

**Matching turno↔fichada**: `matchShiftForEmployee` (`backend/src/modules/shifts/workShiftEvaluation.service.ts:121-146`), cascada de 3 pasos sobre la fecha calendario Argentina: (1) turnos propios vigentes del empleado ese día → `ENABLED`/`DISABLED_FOR_EMPLOYEE`; (2) turnos generales del sistema (no asignados a ese empleado) dentro de tolerancia → `GENERAL_UNASSIGNED`; (3) si nada matchea → `NO_MATCH`.

**Fichar sin turno compatible**: la `WorkShift` **se crea siempre**, incondicionalmente, antes de evaluar el match — el matching nunca bloquea el fichaje. `evaluateShiftEntry` (`workShiftEvaluationRunner.ts:162-191`) mapea `NO_MATCH → TURNO_NO_IDENTIFICADO`, `GENERAL_UNASSIGNED → POSSIBLE_SHIFT_CONFIGURATION_MISSING`, `DISABLED_FOR_EMPLOYEE → SHIFT_NOT_ENABLED_FOR_EMPLOYEE`, **salvo que el régimen vigente del empleado tenga `alertOnOutOfShift=false`** (ver §2/§11 para el detalle exacto de la condición). Existe una función `hasNoShiftAssignments` (`workShiftEvaluation.service.ts:109-111`) que en teoría podría usarse como señal alternativa ("este empleado nunca tuvo turno asignado") pero **está muerta en producción** — no la invoca ningún flujo real, sólo su propio test.

**Jornada abierta / cierre automático**: cron `startClockPunchMaintenance` (`clockPunchMaintenance.ts`), corre `expireOpenWorkShifts` (`timeEntries.repository.ts:1137-1210`) y `checkMissingOutRisk` (`openShiftMonitor.service.ts:23-50`). El primero, para cada jornada que excede `maxAllowedMinutes`, resuelve el régimen del empleado: `ALERT_ONLY` → la deja abierta + alerta crítica; si no (default/`ROLLOVER`) → la cierra con `hours: 0` explícito, `status: FALTA_SALIDA`, observación textual "0 h — Falta registrar la salida...". **Nunca inventa una hora de salida.**

**Notificación a RRHH**: toda alerta de turno (`createShiftAlert`) dispara `notifyUsers(await attendanceRecipients(...))` — RRHH + responsable de asistencia (`EmployeeAssignment` tipo `TIME_RESPONSIBLE`) del empleado.

**Tolerancias**: inventario completo con consumidor real documentado en §9 de la investigación (tabla completa por campo, todas usadas salvo los 3 thresholds ya mencionados).

## 4. Estado actual del Fichador

Módulo: `backend/src/modules/time-entries/` (`timeEntries.service.ts`, `timeEntries.repository.ts`, `clockPunchMaintenance.ts`, `attendanceInactivity.service.ts`). Frontend: `TimeClockPage.tsx` (fichador operativo) + `AttendancePage.tsx` (bandeja de revisión de RRHH, pantalla separada, ruta `/asistencia`).

**Clock-in**: crea la `WorkShift` (`status: ABIERTO`) inmediatamente, sin esperar a saber si hay turno compatible; el matching (`evaluateShiftEntry`) corre en el mismo request, después de persistir la jornada, y sólo adjunta `shiftTemplateId` si matchea — **la fichada de entrada nunca depende de encontrar turno**.

**Clock-out**: calcula minutos/segmentos reales entre `startAt` (real) y `endAt = new Date()` (instante real del clock-out) — el turno no se usa para calcular horas, sólo para comparar contra lo esperado y generar alertas informativas (`JORNADA_INSUFICIENTE`/`JORNADA_EXTENDIDA`) después de cerrar.

**¿Inventa horas?** No, en ningún camino. Confirmado con evidencia exhaustiva: todo camino sin salida real confirmada (jornada abierta vencida, olvido de salida, ingreso duplicado sobre jornada vieja) persiste explícitamente `hours: 0`/`totalMinutes: 0`, `status: FALTA_SALIDA`, con observación textual "requiere revisión del encargado" — nunca estima ni interpola.

**Umbral duro**: `MAX_SHIFT_MINUTES = 1200` (20h, hardcodeado en `timeEntries.service.ts:166`, coincide con el default de schema). Umbral informativo por turno: `maximumInformativeMinutes` (default aplicado 600 min = 10h cuando no hay turno asociado) — **este es el umbral que dispara `JORNADA_EXTENDIDA` para un empleado de cosecha sin turno propio, y no es configurable por régimen** (ver §11, hallazgo central para el caso de negocio de este pedido).

**Régimen Laboral influye hoy en el fichador** en exactamente 2 puntos: (1) política de rollover cuando una jornada abierta supera el umbral duro (`openShiftOverflowAction`); (2) supresión de las 3 alertas "fuera de turno" (`alertOnOutOfShift`). No influye en el cálculo de horas en sí.

**Bandeja de revisión**: `AttendancePage.tsx` (`GET /attendance`, separa jornadas abiertas por riesgo, cerradas, observadas) + `GET /attendance/observations` (unifica `SHIFT`/`PUNCH`/`INACTIVITY` pendientes) + resolución manual (`rrhh`/`supervision`).

## 5. Estado actual de Alertas

`ShiftAlert` — modelo (`schema.prisma:1197-1218`), único punto de escritura: `createShiftAlert()` (`workShiftEvaluationRunner.ts:97-117`), que hace `upsert` por `@@unique([workShiftId, type])` (dedupe real a nivel de fila) y **siempre**, incondicionalmente, dispara además una `SystemNotification` tipo `ALERTA_FICHADA` en la misma función (acoplamiento 1:1 por diseño).

**Enum real, 12 tipos** (`schema.prisma:221-234`) — confirmado que la lista de 10 que traía el contexto previo estaba incompleta, faltan `CONCEPTO_NO_HABILITADO` y `SEGMENTO_SIN_CLASIFICAR`: ver tabla completa en §10.

**Resolución/descarte**: `ShiftAlertsPage.tsx`, sólo roles RRHH/Supervisión, exige `resolution` (`RESUELTA`/`DESCARTADA`) + `reason` (texto libre obligatorio). No existe ningún campo estructurado tipo "esta alerta era esperada, no un error" — sólo texto libre cada vez.

**Deduplicación**: real a nivel de fila (`upsert` + constraint único), pero con un efecto secundario documentado en §11 — una segunda ocurrencia del mismo `[workShiftId, type]` **reabre** la alerta (`status: PENDIENTE`) aunque hubiera sido resuelta/descartada antes, sin ninguna señal de "esto ya se había descartado".

## 6. Estado actual de Notificaciones

`SystemNotification` — modelo completamente genérico y desacoplado (`type`/`entityType`/`entityId` son `String` libres, sin FK a `WorkShift`/`ShiftTemplate`/`WorkRegime`). Generadas vía `notifyUsers`/`notifyRrhh` (`backend/src/modules/workforce-management/workforce.service.ts:34-44`), con una excepción que bypasea esa capa (`attendanceInactivity.service.ts:96`, llama `tx.systemNotification.createMany` directo).

**7 tipos reales en uso**: `ALERTA_FICHADA` (toda `ShiftAlert`), `FALTA_SALIDA`, `INTENTO_INGRESO_JORNADA_ABIERTA`, `SIN_ACTIVIDAD_REGISTRADA`, `NOVEDAD_PENDIENTE`, `CIERRE_MENSUAL`, `CORRECCION_HORARIA` — ver tabla completa en §10.

`SystemNotification` **no decide nada** — es una capa de entrega/bandeja pura; el contenido (`title`/`message`) puede derivar de datos de turno, pero el modelo en sí no tiene lógica de negocio propia. Esto es correcto y deseable (confirma que la "fuente de verdad" de la decisión vive en `ShiftAlert`/régimen, no en notificaciones — ver §14).

**`notifyUsers` no es idempotente** — no hay ningún chequeo de "ya existe una notificación sin leer de este tipo/entidad" antes de crear una nueva (única excepción: `AttendanceInactivityIncident.notifiedAt`, mecanismo propio de ese módulo, no reutilizado en general).

## 7. Estado actual de Legajos

`Employee` (`schema.prisma:560-627`) **no tiene** FK directa a régimen ni a turno — ambas son relaciones inversas hacia tablas de asociación (`ShiftAssignment[]`, `EmployeeWorkRegime[]`).

**Asignación**: ambos (régimen y turno) se asignan exclusivamente desde el Legajo, en tabs separados y no contiguos de `EmployeeDetailPage.tsx`: tab 9 "Turnos" (`EmployeeShiftsPanel.tsx`) y tab 11 "Régimen Laboral" (`EmployeeWorkRegimePanel.tsx`), con el tab 10 "Auditoría" interpuesto entre ambos. **No** se asignan desde `EmployeeCreatePage.tsx` (no existe ningún tab ni referencia a régimen/turno en el alta) — **un legajo puede quedar creado y activo sin régimen ni turno asignado**.

**Datos Laborales** (tab 2): no menciona régimen ni turno en absoluto — sólo `LaborMovementPanel`, empresa/sector/centro de costo, puesto, categoría, convenio, obra social.

**Listado** (`EmployeesPage.tsx`): columnas Legajo/CUIL/Apellido/Nombre/Centro de costo/Estado — sin régimen ni turno. **No se puede filtrar por régimen** (confirmado también en el schema Zod del backend, `listEmployeesQuerySchema` sólo acepta `search`/`companyId`/`sectorId`/`costCenterId`).

**"Turno actual"**: a diferencia de régimen (que tiene `getCurrent()`/`findActiveEmployeeWorkRegime`), no existe una función equivalente para resolver "el turno vigente hoy" — el tab de Turnos simplemente lista todas las asignaciones agrupadas en habilitadas/deshabilitadas, sin resolver cuál aplica en la fecha actual.

**Sin cross-link visual ni funcional entre régimen y turno** — confirmado por grep: ningún archivo de un panel referencia al otro. Único puente textual: una nota informativa dentro del panel de régimen aclarando que "no es el horario del turno" — aclaración, no integración.

**Bug de trazabilidad**: los eventos de auditoría de `EmployeeWorkRegime`/`ShiftAssignment` se registran con `entityId` = id de la fila de asignación, **no** `employeeId` (a diferencia del resto de los campos del legajo, que sí usan `employee.id`) — como consecuencia, los cambios de régimen/turno **no aparecen** en el tab "Historial de Eventos" ni "Auditoría" del propio legajo (que filtran por `entityId=employee.id`), aunque sí queden en el log de auditoría global.

## 8. Mapa de relaciones actuales entre módulos

```
Employee ──< EmployeeWorkRegime >── WorkRegime (kind, alertOnOutOfShift, openShiftOverflowAction)
Employee ──< ShiftAssignment >── ShiftTemplate (horarios, tolerancias, umbrales)

TimeClockPage (clock-in) ──▶ timeEntries.service.ts ──▶ crea WorkShift (ABIERTO)
                                        │
                                        ▼
                          evaluateShiftEntry (workShiftEvaluationRunner.ts)
                                        │
                    matchShiftForEmployee (ShiftAssignment × ShiftTemplate)
                                        │
                    resolveActiveWorkRegime(employeeId) ── ¿alertOnOutOfShift?
                                        │
                         [suprimida] o createShiftAlert(type, ...)
                                        │
                                        ▼
                          ShiftAlert (upsert por workShiftId+type)
                                        │
                                        ▼
                        notifyUsers(attendanceRecipients) ──▶ SystemNotification("ALERTA_FICHADA")

clockPunchMaintenance (cron) ──▶ expireOpenWorkShifts / checkMissingOutRisk
                                        │
                    resolveActiveWorkRegime(employeeId) ── ¿openShiftOverflowAction?
                                        │
              ROLLOVER: cierra WorkShift en 0h (FALTA_SALIDA) ──▶ notifyMissingExit ──▶ SystemNotification("FALTA_SALIDA")
              ALERT_ONLY: flagOpenShiftOverflowForReview ──▶ ShiftAlert(POSIBLE_OLVIDO_SALIDA, CRITICA) ──▶ SystemNotification("ALERTA_FICHADA")

EmployeeDetailPage (Legajo)
  tab 9  "Turnos"          → EmployeeShiftsPanel (ShiftAssignment) ─┐
  tab 10 "Auditoría"                                                 │  sin cross-link
  tab 11 "Régimen Laboral" → EmployeeWorkRegimePanel (EmployeeWorkRegime) ─┘
```

El punto de acoplamiento real entre Turnos y Régimen es **exclusivamente** `resolveActiveWorkRegime()` (`work-regimes/workRegimes.service.ts:29-38`), consumido desde 2 lugares del motor de evaluación (`workShiftEvaluationRunner.ts`, `timeEntries.service.ts`/`repository.ts`). Fuera de esos 2 puntos, los módulos son independientes — no hay ninguna otra ruta donde Turnos y Régimen se "pisen" o compitan por la misma decisión.

## 9. Campos de Régimen Laboral: usados/no usados

| Campo | ¿Usado? | Dónde | Nota |
|---|---|---|---|
| `code`, `name` | Sí | Identidad de catálogo, mostrado en toda la UI | — |
| `kind` | Parcial — sólo display | `WorkRegimesPage.tsx`, `EmployeeWorkRegimePanel.tsx` (label) | **No rama ninguna lógica de negocio** — riesgo de inconsistencia con `alertOnOutOfShift`/`openShiftOverflowAction` (ver §11) |
| `alertOnOutOfShift` | **Sí, con efecto real** | `workShiftEvaluationRunner.ts:156-160,174` | Suprime 3 de 12 tipos de `ShiftAlert` |
| `openShiftOverflowAction` | **Sí, con efecto real** | `timeEntries.repository.ts:1146-1160`, `timeEntries.service.ts:1146-1147,1345-1346` | Decide rollover automático vs. dejar abierta para revisión |
| `description` | Sí | Display únicamente | — |
| `status` (ACTIVO/INACTIVO) | Sí | Soft toggle de catálogo | — |
| `EmployeeWorkRegime.assignedByUserId` | **No, campo muerto en UI** | Se persiste y se mapea en el frontend pero no se renderiza en ningún lado | Candidato a mostrar (auditoría) o documentar como redundante con `AuditLog` |
| `ShiftTemplate.warningThresholdMinutes` | **No, sin consumidor** | Declarado en schema, sin ningún uso en `shifts`/`time-entries` | El propio comentario del schema dice que es preparatorio para graduar `JORNADA_EXTENDIDA` — nunca implementado |
| `ShiftTemplate.reviewThresholdMinutes` | **No, sin consumidor** | Ídem | Ídem |
| `ShiftTemplate.criticalThresholdMinutes` | **No, sin consumidor** | Ídem | Ídem |

**Respuesta directa a B/C del pedido**: ambos campos (`alertOnOutOfShift`/"Alertar si..." y `openShiftOverflowAction`/"Acción ante jornada abierta excedida") **sí se usan realmente**, con efecto funcional confirmado en código y tests. No son campos muertos ni preparatorios — son la pieza central del mecanismo que este pedido buscaba auditar.

## 10. Alertas actuales y quién las genera

### `ShiftAlert` (12 tipos reales)

| Tipo | Disparador | Condición | ¿Suprimible por régimen? |
|---|---|---|---|
| `INGRESO_TARDE` | `evaluateShiftEntry` | Turno propio habilitado, llega fuera de tolerancia de entrada | No |
| `SALIDA_ANTICIPADA` | `evaluateShiftExit` | Turno propio habilitado, sale antes de tolerancia | No |
| `SALIDA_TARDIA` | `evaluateShiftExit` | Ídem, sale después de tolerancia | No |
| `TURNO_NO_IDENTIFICADO` | `evaluateShiftEntry`, `matchShiftForEmployee` → `NO_MATCH` | Ninguna plantilla matchea | **Sí** |
| `SHIFT_NOT_ENABLED_FOR_EMPLOYEE` | Ídem → `DISABLED_FOR_EMPLOYEE` | Turno propio pero asignación deshabilitada | **Sí** |
| `POSSIBLE_SHIFT_CONFIGURATION_MISSING` | Ídem → `GENERAL_UNASSIGNED` | Matchea turno general no asignado | **Sí** |
| `JORNADA_INSUFICIENTE` | `evaluateShiftExit` | `totalMinutes < minimumMinutesForCompliance` | No |
| `JORNADA_EXTENDIDA` | `evaluateShiftExit` | `totalMinutes > (maximumInformativeMinutes ?? 600)` | **No — brecha central, ver §11** |
| `DESCANSO_INSUFICIENTE` | `evaluateShiftEntry` | Descanso `< 480 min` desde el turno anterior | No |
| `POSIBLE_OLVIDO_SALIDA` | `checkMissingOutRisk` (cron) / `flagOpenShiftOverflowForReview` | Riesgo `MISSING_OUT` / régimen `ALERT_ONLY` excedido | Indirecto (vía `openShiftOverflowAction`) |
| `CONCEPTO_NO_HABILITADO` | `notifyClassificationAlerts` | Segmento con concepto horario no habilitado | No |
| `SEGMENTO_SIN_CLASIFICAR` | Ídem | Segmento sin concepto compatible | No |

Todas vía `createShiftAlert()` (`workShiftEvaluationRunner.ts:97-117`), `upsert` por `[workShiftId, type]`.

### `SystemNotification` (7 tipos reales en uso)

| Tipo | Disparador | Condición |
|---|---|---|
| `ALERTA_FICHADA` | `createShiftAlert` (siempre) | Cualquiera de los 12 tipos de arriba |
| `FALTA_SALIDA` | `notifyMissingExit` | Auto-cierre de jornada por vencimiento (régimen no `ALERT_ONLY`) |
| `INTENTO_INGRESO_JORNADA_ABIERTA` | `notifyOpenShiftAttempt` | Nuevo ingreso con jornada previa ya abierta |
| `SIN_ACTIVIDAD_REGISTRADA` | `attendanceInactivity.service.ts` (bypasea `notifyUsers`) | Empleado activo sin fichadas/horas/novedades el día anterior |
| `NOVEDAD_PENDIENTE` | `novelties.service.ts` | Novedad pendiente de aprobación |
| `CIERRE_MENSUAL` | `workforce.service.ts` | Cierres recibidos para aprobación |
| `CORRECCION_HORARIA` | `workforce.service.ts` | Corrección posterior al cierre |

## 11. Riesgos de duplicación o contradicción

Ordenados por relevancia para el caso de negocio de esta auditoría:

**11.1 — Brecha central: `JORNADA_EXTENDIDA` no es suprimible/configurable por régimen.** Es el hallazgo más relevante para el caso de negocio planteado (cosecha con jornadas de 16h). Un empleado con régimen `TURNO_FLEXIBLE`/`alertOnOutOfShift=false` correctamente configurado igual va a generar `JORNADA_EXTENDIDA` (severidad `INFO`) en cualquier jornada que supere `maximumInformativeMinutes` del turno (si tiene uno) o el default de 600 min (10h) si no tiene turno asignado — que es exactamente el caso de un empleado de cosecha sin turno fijo. El mecanismo de supresión de régimen sólo cubre las 3 alertas "fuera de turno", no las de duración.

**11.2 — Alertas huérfanas confirmadas con código.** Cuando `expireOpenWorkShifts` cierra automáticamente una jornada (`FALTA_SALIDA`, régimen `ROLLOVER`), **ningún código actualiza/resuelve** los `ShiftAlert` tipo `POSIBLE_OLVIDO_SALIDA` que ya existían para ese `workShiftId` (los únicos `update` de `ShiftAlert` en todo el repo están en `resolve()`, acción manual de RRHH). Consecuencia: RRHH ve en `/turnos/alertas` una alerta `PENDIENTE` indefinidamente aunque el sistema ya resolvió el problema por su cuenta. Mismo hueco en el cierre manual de RRHH (`closeWorkShiftManually`).

**11.3 — Notificaciones duplicadas para el mismo hecho de negocio.** El mismo evento "jornada quedó abierta y venció" puede producir hasta 2 notificaciones distintas y no correlacionadas: `ALERTA_FICHADA` (del `ShiftAlert POSIBLE_OLVIDO_SALIDA` creado por el chequeo de riesgo periódico) + `FALTA_SALIDA` (del cierre automático posterior en la misma corrida de mantenimiento) — con textos distintos, apuntando a entidades distintas (`ShiftAlert.id` vs. `WorkShift.id`), sin ningún vínculo entre ambas.

**11.4 — Enum drift.** `CONCEPTO_NO_HABILITADO`/`SEGMENTO_SIN_CLASIFICAR` existen en el schema y se generan en producción, pero faltan en `shiftAlert.schemas.ts` (Zod — el filtro por API los rechaza con 400), en los tipos del frontend, y en `TYPE_LABELS` de `ShiftAlertsPage.tsx` (columna "Tipo" en blanco para esas alertas).

**11.5 — `notifyUsers` no idempotente / reapertura silenciosa.** El `upsert` de `createShiftAlert` **reabre** (`status: PENDIENTE`) una alerta ya resuelta/descartada si el mismo `[workShiftId, type]` se vuelve a disparar, y **siempre** notifica de nuevo — sin ninguna señal de "esto ya se había descartado antes". Riesgo de ruido para RRHH en jornadas con incidencias recurrentes.

**11.6 — `kind` puede quedar inconsistente con el comportamiento real.** Nada en la UI acopla `kind=SIN_TURNO`/`TURNO_FLEXIBLE` con `alertOnOutOfShift=false` — son campos independientes en el mismo formulario. Es posible crear un régimen "Cosecha" con `kind=SIN_TURNO` pero dejar `alertOnOutOfShift` en su default `true`, contradiciendo el propósito declarado del régimen, sin ninguna advertencia.

**11.7 — `SIN_ACTIVIDAD_REGISTRADA` es un sistema paralelo desconectado.** Usa un modelo propio (`AttendanceInactivityIncident`), bypasea `notifyUsers`/`notifyRrhh` llamando `prisma` directo, y no pasa por `ShiftAlert` en absoluto — no aparece en `/turnos/alertas`, sólo en la campanita. No es un bug en sí, pero es una tercera vía de "algo para revisar" fuera del circuito principal, a tener en cuenta si se centraliza el motor de alertas.

**11.8 — Sin granularidad por empleado/turno.** La supresión de régimen es "todo o nada" a nivel de régimen — no hay forma de decir "este empleado puntual de cosecha sí quiero que alerte" sin sacarlo del régimen entero.

**11.9 — `hasNoShiftAssignments()` código muerto.** Existe una función que podría usarse como señal alternativa ("empleado sin ningún turno asignado nunca") pero no está wireada a nada — riesgo de que alguien la "active" en el futuro sin darse cuenta de que ya existe el mecanismo de régimen, generando dos fuentes de verdad compitiendo.

**11.10 — Legajo sin conexión visual/funcional entre régimen y turno** (detalle completo en §7) — no es un riesgo de contradicción de datos, pero sí de error humano: nada impide asignar un turno fijo a un empleado con régimen `SIN_TURNO`, ni alertar quien mira el legajo de que ambos conceptos conviven sin relación.

## 12. Casos de negocio

| Caso | Comportamiento hoy | ¿Cubierto? |
|---|---|---|
| **Turno fijo** (administrativo) | Régimen por defecto (`alertOnOutOfShift=true` o sin régimen asignado) + turno asignado → alerta si ficha sin turno compatible | ✅ Ya funciona, sin cambios necesarios |
| **Cosecha / flexible** | Si se le asigna un `WorkRegime` con `kind=TURNO_FLEXIBLE`/`SIN_TURNO` y `alertOnOutOfShift=false`: no genera `TURNO_NO_IDENTIFICADO`/`SHIFT_NOT_ENABLED_FOR_EMPLOYEE`/`POSSIBLE_SHIFT_CONFIGURATION_MISSING`. **Pero** una jornada de 16h igual genera `JORNADA_EXTENDIDA` (§11.1), y si no se le asignó régimen al alta, sigue alertando como un empleado fijo (§7) | ⚠️ Parcialmente — mecanismo existe, cobertura incompleta y no es automática/obligatoria |
| **Nocturno / sereno** | `ShiftTemplate.crossesMidnight` existe en el schema para turnos que cruzan medianoche — **no fue trazado explícitamente en esta ronda de auditoría** (ninguno de los 5 agentes lo relevó en profundidad) | ❓ Pendiente de verificación explícita en una etapa futura si se prioriza este caso |
| **Pañol / jornada larga** | Mismo mecanismo y misma brecha que cosecha — `JORNADA_EXTENDIDA` no configurable por régimen; si tiene turno asignado, depende de `ShiftTemplate.maximumInformativeMinutes` de ese turno específico | ⚠️ Mismo gap que cosecha |
| **Eventual sin jornada esperada** | Mismo mecanismo que cosecha/flexible si se le asigna el régimen correcto | ⚠️ Mismo gap que cosecha |

## 13. Propuesta conceptual de funcionamiento correcto

**No hace falta rediseñar la separación conceptual — ya está bien implementada.** El pedido original definía 4 responsabilidades (Régimen = modalidad general, Turno = horario concreto, Fichador = registra lo real sin inventar, Motor de alertas = decide una alerta coherente evitando duplicados) y las 4 ya existen así en el código, con el acoplamiento correcto: el motor de alertas consulta régimen antes de decidir, el fichador nunca decide horas por su cuenta, y turno/régimen no se pisan (cada uno gobierna una dimensión distinta — horario concreto vs. política de alertas/jornada abierta).

Lo que sí conviene ajustar, sin tocar la arquitectura:

1. **Extender la cobertura del motor de alertas a `JORNADA_EXTENDIDA`** — es la pieza que falta para que el caso de negocio (jornadas largas legítimas en cosecha) quede realmente resuelto. Requiere una decisión de producto explícita antes de implementar: ¿se suprime del todo para régimen flexible, o se usa un umbral distinto (más alto) en vez de silenciarla completamente? Esto mapea directamente al campo que el pedido sugería (`maxHorasJornadaAntesDeAlerta`) — pero como refinamiento de lo existente, no como campo nuevo aislado.
2. **Cerrar el ciclo de vida de `ShiftAlert` con el cierre de la jornada** — resolver/actualizar automáticamente las alertas de una `WorkShift` cuando se cierra (auto o manual), para que RRHH nunca vea una alerta "pendiente" sobre algo que el sistema ya resolvió.
3. **Consolidar la notificación de "olvido de salida"** — un solo evento de negocio, una sola notificación (hoy son 2 con contenido no correlacionado).
4. **Corregir el enum drift** (mecánico, bajo riesgo).
5. **Dar visibilidad cruzada en el Legajo** entre régimen y turno, sin fusionar los conceptos — por ejemplo, mostrar el régimen vigente como contexto dentro del tab de Turnos (o viceversa), sin mover ningún campo de un módulo al otro.
6. **Acoplar `kind` con los defaults de comportamiento** en el formulario de régimen (UX, no schema) — al elegir `SIN_TURNO`/`TURNO_FLEXIBLE`, sugerir/prellenar `alertOnOutOfShift=false` en vez de dejarlo en su default `true`.

## 14. Qué debería ser fuente única de verdad

- **`WorkRegime`** — única fuente de verdad para "¿debe alertar si ficha sin turno?" y "¿qué hacer si la jornada abierta se excede?". Ya lo es.
- **`ShiftTemplate`/`ShiftAssignment`** — única fuente de verdad para horario concreto, tolerancias y a qué turno pertenece una fichada. Ya lo es.
- **`ShiftAlert`** — única fuente de verdad de "hay algo para revisar" sobre una jornada puntual. Ya lo es en diseño; necesita el fix de ciclo de vida de §13.2 para serlo también en la práctica (hoy puede quedar desactualizada respecto al estado real de la jornada).
- **`SystemNotification`** — nunca debe decidir nada, sólo entregar. Confirmado que hoy cumple ese rol correctamente (no tiene lógica de negocio propia) — mantenerlo así.
- **`Employee`/Legajo** — debería ser el punto de **visibilidad** consolidada (no de decisión) de régimen + turno vigentes, algo que hoy no ofrece (§7, §13.5).

## 15. Qué cambios recomienda implementar

- **10B (ajustes mínimos)**: corregir enum drift (Zod + tipos frontend + `TYPE_LABELS`); corregir el bug de `entityId` en el registro de auditoría de `EmployeeWorkRegime`/`ShiftAssignment` para que aparezca en el historial del propio legajo; documentar u ocultar los 3 campos de `ShiftTemplate` sin consumidor (`warningThresholdMinutes`/`reviewThresholdMinutes`/`criticalThresholdMinutes`); acoplar `kind` con el default sugerido de `alertOnOutOfShift` en el formulario de régimen (UX).
- **10C (integración de régimen con alertas)**: decisión de producto + implementación para que `JORNADA_EXTENDIDA` sea configurable/suprimible por régimen (cierra la brecha central de §11.1); resolver automáticamente `ShiftAlert` al cerrar una `WorkShift` (auto o manual); consolidar la notificación duplicada de "olvido de salida".
- **10D (vista de personas asignadas al régimen)**: mostrar régimen vigente como contexto en el tab de Turnos del legajo (o cross-link); permitir filtrar el listado de legajos por régimen; agregar un resolver de "turno vigente hoy" equivalente al `getCurrent()` de régimen, para simetría visual.
- **10E (QA de fichador/turnos/notificaciones)**: tests end-to-end de los 5 casos de negocio de §12, con foco en cosecha/flexible y jornada larga; verificación explícita del caso nocturno/sereno (`crossesMidnight`) que esta auditoría dejó pendiente.

## 16. Qué cambios NO recomienda implementar

- **No agregar los campos nuevos sugeridos en el pedido original** (`requiereTurnoAsignado`, `permiteFichadaSinTurno`, `accionJornadaAbierta`, `tipoModalidad`) — todos ya existen bajo otro nombre y con la misma semántica (`kind` ≈ `tipoModalidad`, `alertOnOutOfShift` ≈ inverso de `permiteFichadaSinTurno`, `openShiftOverflowAction` ≈ `accionJornadaAbierta`). Agregarlos duplicaría el mecanismo existente y crearía una segunda fuente de verdad — el único campo genuinamente nuevo a evaluar es un umbral de horas para `JORNADA_EXTENDIDA` por régimen (§15, 10C), y sólo después de una decisión de producto explícita.
- **No mover ningún campo entre Régimen Laboral y Turnos** — la separación actual ya es la correcta; no hay "pisada" de reglas que resolver con un movimiento de campos.
- **No introducir un campo booleano nuevo tipo "alerta esperada/falso positivo" en `ShiftAlert`** sin antes confirmar que el mecanismo de régimen (que previene la alerta antes de que se cree) no alcanza — evitar un segundo mecanismo redundante para el mismo problema.
- **No tocar fichador, turnos ni notificaciones en esta etapa** — por instrucción explícita del pedido; todos los hallazgos quedan documentados para las etapas 10B-10E.
- **No consolidar `SIN_ACTIVIDAD_REGISTRADA` dentro de `ShiftAlert`** todavía — es una decisión de alcance mayor (¿debe RRHH verlo en `/turnos/alertas` también?) que merece su propia discusión de producto, no un cambio mecánico colgado de esta auditoría.

## 17. Riesgos pendientes

- **Caso "nocturno/sereno" no verificado explícitamente en esta ronda** — `ShiftTemplate.crossesMidnight` existe pero ningún agente trazó su consumo en profundidad; antes de tocar este caso en una etapa futura, hace falta una pasada dedicada.
- **La brecha de `JORNADA_EXTENDIDA` (§11.1) es la única pieza que impide decir que el caso de negocio de cosecha está 100% resuelto hoy** — mientras no se implemente 10C, un empleado de cosecha bien configurado seguirá generando alertas informativas por jornadas largas legítimas.
- **El bug de alertas huérfanas (§11.2/11.3) ya existe en producción hoy**, independientemente de esta auditoría — no es nuevo, pero se hizo visible al trazar el flujo completo. Vale la pena priorizarlo en 10C por su impacto en la confianza de RRHH en la bandeja de alertas.
- **Esta auditoría es 100% de lectura de código** — no se midieron volúmenes reales de `ShiftAlert`/`SystemNotification` ni se verificó en runtime ningún escenario; toda la evidencia es de código y tests existentes, no de comportamiento observado en producción.
- **No se auditó el rol de `EmployeeAssignment` tipo `TIME_RESPONSIBLE`** en profundidad (quién recibe las notificaciones además de RRHH) — mencionado sólo de paso por los agentes, podría ameritar su propia revisión si se toca el circuito de notificaciones en 10C.

## 18. Plan por etapas

- **10B — Ajustes mínimos de modelo/campos**: enum drift, bug de `entityId` en auditoría, documentar/ocultar campos muertos de `ShiftTemplate`, UX de acoplamiento `kind`↔`alertOnOutOfShift` en el formulario.
- **10C — Integración de régimen con alertas**: cerrar la brecha de `JORNADA_EXTENDIDA`, ciclo de vida de `ShiftAlert` al cerrar jornada, consolidar notificación duplicada de olvido de salida.
- **10D — Vista de personas asignadas al régimen / visibilidad en Legajo**: cross-link régimen↔turno en el legajo, filtro de listado por régimen, resolver de "turno vigente".
- **10E — QA de fichador/turnos/notificaciones**: tests end-to-end de los 5 casos de negocio, incluida la verificación pendiente de nocturno/sereno.

## 19. Validaciones realizadas

Etapa exclusivamente documental — no se tocó ningún archivo de código. Validaciones ejecutadas:
- `git status` — sólo este documento nuevo aparece como untracked; ningún archivo de código modificado.
- `git diff --stat` — sin cambios (no hay diff sobre archivos trackeados relacionados a esta etapa).
- `git diff --check` — sin errores de espacios en blanco.

## 20. Aprobación pendiente

No commitear sin aprobación explícita del usuario.
