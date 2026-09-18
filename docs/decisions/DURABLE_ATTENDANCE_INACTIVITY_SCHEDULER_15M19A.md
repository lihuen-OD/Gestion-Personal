# Etapa 15M.19A — Scheduler durable + watermark persistido + catch-up

Fecha: 2026-09-18
Estado: implementado, validado (typecheck/tests/build verdes, `prisma validate`/`generate`/`migrate status` verdes contra Neon), pendiente de aprobación para commitear — no commiteado, no pusheado, migración no aplicada
Continúa: diagnóstico de la etapa 15M.18 (auditoría end-to-end del sistema de notificaciones, sin nombre de archivo propio — entregado en conversación, §§4-14), `docs/decisions/HOLIDAY_INACTIVITY_NOTIFICATIONS_12E.md`, `docs/decisions/HOLIDAY_WORK_ASSIGNMENTS_12D.md`

## 1. Resumen ejecutivo

El diagnóstico 15M.18 encontró que `detectAttendanceInactivity` (la única lógica time-driven que puede detectar "empleado activo sin ninguna actividad ese día") sólo recordaba "cuál fue el último día procesado" en una variable de Node en memoria (`lastInactivityDateKey`, en `clockPunchMaintenance.ts`). Un restart, deploy o cold start de Render en cualquier momento alrededor de la ventana diaria (`ATTENDANCE_INACTIVITY_CHECK_HOUR`, 01:00 ARG por defecto) perdía ese día **para siempre** — no había ningún backfill posible, porque el job sólo sabía preguntar por "ayer respecto a ahora", nunca por un rango.

Esta etapa reemplaza esa variable en memoria por un watermark persistido en Postgres/Neon (`JobCheckpoint`, una fila por job) y un algoritmo de catch-up que procesa, en orden ascendente y con un tope por tick, todas las fechas operativas completas pendientes entre el checkpoint y "ayer". Un reinicio del proceso ya no pierde días: retoma exactamente donde había quedado.

**Alcance estrictamente acotado, tal como pidió la etapa**: no se tocó `detectAttendanceInactivity` en sí (sus exclusiones pendientes — descanso semanal, `ShiftAssignment` vigente, `WorkRegime` `SIN_TURNO`/`FLEXIBLE` — quedan explícitamente para 15M.19B), no se tocó el frontend, no se tocó `flagOpenShiftOverflowForReview` (bug de re-notificación ya detectado en 15M.18, también para 15M.19B), no se cambió el `setInterval` de 60s, no se agregó infraestructura nueva (sin colas, sin Redis, sin worker separado).

**Archivos de producción tocados**: 4 (`schema.prisma`, `config/env.ts`, `datetime/argentinaTime.ts`, `time-entries/clockPunchMaintenance.ts`) + 1 migración nueva + 2 archivos nuevos de producción (`shared/jobs/jobCheckpoint.repository.ts`, `time-entries/attendanceInactivityScheduler.ts`) + 3 archivos de test nuevos/ampliados (+29 tests). Suite completa: 116 archivos, 1849 tests, todos verdes (ver §20 para el desglose). `typecheck`/`build` verdes.

## 2. Arquitectura anterior (qué se reemplaza)

```ts
// clockPunchMaintenance.ts (ANTES)
let lastInactivityDateKey: string | undefined; // vive en memoria del proceso Node

const current = new Date();
const inactivityDateKey = previousOperationalDateKey(current); // siempre "ayer respecto a ahora"
if (lastInactivityDateKey !== inactivityDateKey && isInactivityCheckDue(current, hour, minute)) {
  const result = await detectAttendanceInactivity(inactivityDateKey);
  lastInactivityDateKey = inactivityDateKey; // se pierde en cualquier restart
}
```

Problema exacto: si el proceso no estaba vivo (o no había llegado a la hora de corte) el día que le tocaba evaluar una fecha dada, esa fecha nunca vuelve a evaluarse — no hay ningún registro persistido de "hasta dónde llegué" que sobreviva un restart/deploy/cold start de Render.

## 3. Diseño nuevo

### 3.1 `JobCheckpoint` (Prisma)

```prisma
model JobCheckpoint {
  key               String    @id
  lastProcessedDate DateTime? @db.Date
  createdAt         DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime  @updatedAt @db.Timestamptz(3)
}
```

Una sola fila por job (`key = "attendance-inactivity-daily"` para este job), sin tabla de historial — no hace falta más para un solo watermark. `lastProcessedDate` es `@db.Date` (no instante) porque el job trabaja por día operativo Argentina, igual que `AttendanceInactivityIncident.operationalDate`. Ubicado en `schema.prisma` justo después de `ClockPunchAttempt` — ambos son infra operativa del mismo job de mantenimiento, no modelos de negocio.

Sin `@@map`: el proyecto no usa mapeo de nombres de tabla en ningún modelo existente (confirmado, 0 usos de `@@map` en todo `schema.prisma`) — se mantuvo la misma convención.

### 3.2 `jobCheckpointRepository` (`backend/src/shared/jobs/jobCheckpoint.repository.ts`)

Acceso puro, sin lógica de negocio — deliberadamente en `shared/`, no dentro de `time-entries/`, porque un checkpoint de job es infraestructura transversal (mismo criterio que `shared/monthlyClosure/closureLock.ts`, que también es una pieza de infraestructura compartida sin ser un módulo de negocio propio). Dos funciones:

- `findLastProcessedDateKey(key)`: `findUnique` + conversión a `"YYYY-MM-DD"` vía el nuevo helper `calendarDateKey` (ver §3.3). `null` si no hay fila o si `lastProcessedDate` es `null`.
- `advance(key, dateKey)`: `upsert` (crea la fila si no existe) + `updateMany` con `lastProcessedDate: { lt: date }` — **nunca mueve el checkpoint hacia atrás**. Ver §12 (concurrencia) para por qué.

### 3.3 Dos helpers nuevos en `argentinaTime.ts`

`CLAUDE.md`/`AGENTS.md` exigen que toda matemática de fecha/hora pase por este único módulo — no reimplementar por archivo. Se agregaron dos funciones, mismo criterio ya usado por `periodFromCalendarDate`/`dayOfMonthFromCalendarDate` (fechas-calendario ya normalizadas, sin corrimiento de huso horario):

- `calendarDateKey(dateOnly: Date): string` — inversa exacta de `argentinaCalendarDate`, "YYYY-MM-DD" sin offset.
- `nextCalendarDateKey(dateKey: string): string` — día calendario siguiente, reutilizando `calendarDateKey` + `argentinaCalendarDate` + la constante `MS_PER_DAY` ya existente en el archivo (no se reimplementó ninguna aritmética de milisegundos nueva).

### 3.4 `attendanceInactivityScheduler.ts` (nuevo, `time-entries/`)

Separación de responsabilidades pedida explícitamente por la etapa (§31): `attendanceInactivity.service.ts` sigue siendo exclusivamente el procesamiento de una fecha (sin cambios — ya recibía `dateKey` explícito, no hizo falta ningún refactor de firma); este archivo nuevo es sólo la orquestación (qué fechas están pendientes, en qué orden, con qué tope); `clockPunchMaintenance.ts` vuelve a ser sólo el coordinador del tick de 60s, sin conocer el detalle de watermark/catch-up.

Dos funciones exportadas:

- **`buildPendingDateKeys(lastProcessedDateKey, targetDateKey, limit): string[]`** — función pura, sin Prisma, sin I/O. Fechas pendientes entre `lastProcessedDateKey` (exclusivo) y `targetDateKey` (inclusive), ascendente, topeadas a `limit`. Comparación por string funciona directo porque `"YYYY-MM-DD"` ordena igual lexicográfica y cronológicamente.
- **`runAttendanceInactivityCatchUp(reference = new Date())`** — reemplaza el bloque inline que antes vivía en `clockPunchMaintenance.ts`. Ver §7 para el algoritmo completo.

## 4. Migración

`prisma/migrations/20260918100000_add_job_checkpoint/migration.sql` — aditiva, un solo `CREATE TABLE`, sin tocar ninguna tabla existente:

```sql
CREATE TABLE "JobCheckpoint" (
    "key" TEXT NOT NULL,
    "lastProcessedDate" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JobCheckpoint_pkey" PRIMARY KEY ("key")
);
```

**Cómo se generó, y por qué no se corrió `prisma migrate dev`**: el `.env` local apunta a un Neon real y alcanzable (confirmado — `prisma migrate status` conectó sin problema). `prisma migrate dev` (incluso con `--create-only`) crea una shadow database contra ese mismo servidor para calcular el diff, y la etapa pide explícitamente no tocar ninguna base remota, ni siquiera transitoriamente. Se escribió el SQL a mano, verificado campo por campo contra el patrón exacto que Prisma ya generó para el modelo aditivo más reciente y comparable (`HolidayWorkAssignment`, sin FKs relevantes para esta comparación de tipos): `String @id` sin `@default` → columna sin `DEFAULT`; `DateTime? @db.Date` → `DATE` nullable sin `NOT NULL`; `DateTime @default(now()) @db.Timestamptz(3)` → `TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`; `DateTime @updatedAt @db.Timestamptz(3)` → `TIMESTAMPTZ(3) NOT NULL` sin `DEFAULT` (Prisma aplica `@updatedAt` en el cliente, no en la columna). Se corrieron `prisma validate` (✅) y `prisma generate` (✅, regenera el cliente TS local) — ambos de sólo lectura/local. `prisma migrate status` (de sólo lectura) confirma que Prisma reconoce la migración como válida y pendiente: `"Following migration have not yet been applied: 20260918100000_add_job_checkpoint"`. **No se ejecutó `migrate dev` ni `migrate deploy`** — la tabla no existe todavía en Neon; aplicarla es una decisión explícita del usuario, fuera de esta etapa.

## 5. Bootstrap (primer deploy, tabla/fila todavía sin datos)

**Opción elegida: A — inicializar en "ayer", sin backfill histórico**, tal como la etapa pidió como preferencia inicial ("no generar de golpe cientos/miles de notificaciones históricas al desplegar esta migración").

Implementación en `runAttendanceInactivityCatchUp`: si `findLastProcessedDateKey` devuelve `null` (no existe fila para ese `key` — primer arranque real), se llama `jobCheckpointRepository.advance(key, bootstrapDateKey)` **sin procesar ninguna fecha todavía**, se loguea `ATTENDANCE_INACTIVITY_CHECKPOINT_BOOTSTRAPPED`, y recién desde el próximo tick el catch-up real arranca desde la fecha siguiente. `bootstrapDateKey = env.ATTENDANCE_INACTIVITY_BOOTSTRAP_DATE ?? targetDateKey("ayer")`.

Se agregó `ATTENDANCE_INACTIVITY_BOOTSTRAP_DATE` (opcional, `"YYYY-MM-DD"`, validado por regex en `env.ts`) para el caso excepcional en que se sepa con certeza que hubo una caída puntual justo antes de este deploy y se quiera recuperar ese rango explícitamente — **nunca hardcodeado en código**, sólo por variable de entorno documentada. Si se configura, el bootstrap parte de esa fecha en vez de "ayer", y el catch-up procesa normalmente desde ahí (incluyendo, si corresponde, en el mismo tick del bootstrap) — comportamiento cubierto por test dedicado (§14).

Primer deploy real (18/09/2026 o cuando se aplique la migración): sin configurar la variable, el primer tick post-deploy sólo inicializa el checkpoint en "ayer" y no genera ningún incidente nuevo por este cambio — comportamiento observable idéntico al de antes de esta etapa hasta el día siguiente, donde el catch-up ya empieza a operar con watermark real.

## 6. Fecha operativa Argentina — sin cambios de fondo

Toda la matemática de "qué día es" sigue pasando por `argentinaTime.ts`. `previousOperationalDateKey`/`isInactivityCheckDue` (`attendanceInactivity.service.ts`) no se tocaron — siguen siendo las mismas funciones puras de antes, ahora reutilizadas tal cual por el orquestador nuevo. Los dos helpers agregados (`calendarDateKey`/`nextCalendarDateKey`, §3.3) siguen exactamente el mismo criterio ya documentado en el archivo para "fecha-calendario ya normalizada, sin corrimiento de huso horario" — ningún cálculo nuevo de offset, ninguna dependencia de la zona horaria del proceso Node.

## 7. Algoritmo de catch-up

```
1. ¿isInactivityCheckDue(reference, hour, minute)? Si no, retornar sin tocar la DB (§9 abajo).
2. targetDateKey = previousOperationalDateKey(reference)      // "ayer", siempre
3. lastProcessedDateKey = jobCheckpointRepository.findLastProcessedDateKey(key)
4. Si lastProcessedDateKey === null → bootstrap (§5), sin procesar nada este tick.
5. pendingDateKeys = buildPendingDateKeys(lastProcessedDateKey, targetDateKey, MAX_CATCHUP_DATES)
6. Si no hay pendientes → retornar (nada que hacer).
7. Para cada fecha, en orden ascendente:
   a. detectAttendanceInactivity(fecha)
   b. si no lanza: jobCheckpointRepository.advance(key, fecha); continuar
   c. si lanza: loguear, retornar inmediatamente (no seguir con fechas más nuevas, no avanzar el checkpoint)
```

## 8. Orden de fechas

Estrictamente ascendente (día más antiguo → más reciente) — `buildPendingDateKeys` construye el array ya ordenado, y el `for` de `runAttendanceInactivityCatchUp` lo recorre en ese mismo orden. Verificado con test que corrobora tanto el orden de las llamadas a `detectAttendanceInactivity` como el de `jobCheckpointRepository.advance`.

## 9. Límite por tick

`ATTENDANCE_INACTIVITY_MAX_CATCHUP_DATES`, default **14** (dos semanas). Justificación (no arbitraria): cualquier fin de semana o feriado largo real (2-4 días) se drena completo en un solo tick; una caída extrema (ej. 60 días, el ejemplo de la propia etapa) se drena en ~5 ticks de 60s = tiempo total despreciable, sin bloquear el event loop con una corrida sin límite en un solo tick. Si el límite se alcanza, el resto queda pendiente y el próximo tick (60s después) continúa exactamente donde el checkpoint quedó — sin ninguna lógica adicional, es la misma consulta de "pendientes" de siempre.

## 10. Atomicidad — checkpoint vs. procesamiento de la fecha

**Decisión: no se envolvieron ambos pasos en una única transacción Prisma**, documentando en su lugar la ventana de fallo exacta y por qué la idempotencia existente ya la cubre (tal como la propia etapa habilita como alternativa válida en su §14: *"Si no: documentar exactamente la ventana de fallo y demostrar que la reejecución sigue siendo idempotente"*).

Por qué no: `detectAttendanceInactivity` ya abre **una transacción por incidente** (no una por fecha completa) al notificar — envolver "toda la fecha + el avance del checkpoint" en una transacción más grande implicaría reestructurar esa función (fuera de alcance: la etapa pide explícitamente no tocarla) y mantener una transacción abierta más tiempo del necesario mientras se recorren N empleados.

**Ventana de fallo real**: si el proceso muere entre el `await detectAttendanceInactivity(fecha)` que ya terminó bien y el `await jobCheckpointRepository.advance(...)` que le sigue, el checkpoint queda una fecha "atrás" de lo que en realidad ya se procesó. **Consecuencia demostrada segura**: el próximo tick vuelve a pedir esa misma fecha. `detectAttendanceInactivity` ya es idempotente para una reejecución completa (§11) — los incidentes no se duplican (`skipDuplicates`) y los ya notificados no se renotifican (`notifiedAt: null` como filtro) — así que reprocesar la misma fecha una segunda vez es indistinguible, en resultado, de no haber fallado. Cubierto por test (§14, "reintento").

## 11. Idempotencia

Sin cambios en `AttendanceInactivityIncident`/`SystemNotification` — se preserva íntegramente el mecanismo ya existente:
- `@@unique([employeeId, operationalDate])` + `createMany({ skipDuplicates: true })` → nunca duplica el incidente.
- `findMany({ where: { notifiedAt: null } })` + `update` dentro de la misma `$transaction` por incidente → un incidente ya notificado no vuelve a notificarse en una reejecución posterior.

El único mecanismo nuevo de idempotencia es el de `jobCheckpointRepository.advance` (§12): el `updateMany` con `lastProcessedDate: { lt: date }` hace que reintentar `advance` con la misma fecha (o una anterior, por una escritura vieja que llega tarde) sea un no-op seguro.

## 12. Reinicios del proceso

Cubierto por diseño, no por un caso especial: `runAttendanceInactivityCatchUp` no lee ni escribe ningún estado de módulo — todo lo que necesita (`lastProcessedDateKey`) se lee de `JobCheckpoint` en cada invocación. Un "proceso nuevo" (post-restart/deploy/cold start) que llama a esta función ve exactamente el mismo checkpoint que dejó el proceso anterior. `lastInactivityDateKey` (la variable module-level que causaba el bug original) se **eliminó** de `clockPunchMaintenance.ts` — ya no existe ningún checkpoint en memoria en paralelo al de la base, evitando la divergencia que la propia etapa pedía evitar explícitamente (§17: "no mantener dos checkpoints").

## 13. Concurrencia

Render corre hoy una sola instancia (confirmado por el usuario) — no se implementó ningún lock distribuido, tal como la etapa pide evitar mientras no haga falta. Análisis igual, por si se escala a más de una instancia en el futuro:

- **Lectura de checkpoint**: sin protección — dos instancias podrían leer el mismo `lastProcessedDateKey` y calcular el mismo rango pendiente. No es un problema de corrección por sí solo, ver siguiente punto.
- **Doble procesamiento de la misma fecha**: `attendanceInactivityIncident.createMany({ skipDuplicates: true })` ya lo cubre sin cambios — dos instancias creando el mismo incidente no duplican filas.
- **Riesgo real identificado (preexistente, no introducido por esta etapa)**: el patrón "leer incidentes con `notifiedAt: null` → notificar → marcar `notifiedAt`" (`attendanceInactivity.service.ts`) no es atómico contra una lectura concurrente de OTRA instancia — en teoría, dos instancias podrían leer el mismo incidente antes de que cualquiera de las dos marque `notifiedAt`, y notificar dos veces. Esto ya existía antes de esta etapa (no es parte del scope de 19A) — se deja documentado como riesgo teórico, sólo relevante el día que Render corra más de una instancia.
- **Protección barata agregada, porque no cuesta nada implementarla bien** (no es un lock distribuido, es sólo una escritura monótona): `jobCheckpointRepository.advance` usa `upsert` + `updateMany(... lastProcessedDate: { lt: date })` en vez de un `upsert` con `update` incondicional — una escritura "vieja" que llegue después de una más nueva nunca pisa el avance ya hecho.

## 14. Fallo parcial y retry

Ejemplo exacto pedido por la etapa (pendientes 12, 13, 14; 12 OK, 13 falla, 14 no debe procesarse; checkpoint final 12; próximo tick reintenta 13) — implementado literalmente en `runAttendanceInactivityCatchUp` (el `catch` corta el loop y retorna `failedDate` sin seguir) y cubierto por test dedicado (`attendanceInactivityScheduler.test.ts`, casos "Caso D" y "Caso E").

## 15. Observabilidad

Logs nuevos, todos sin PII (sólo `dateKey`, contadores, y el propio `key` del job — nunca legajo/nombre/UUID de empleado):

```
ATTENDANCE_INACTIVITY_CHECKPOINT_BOOTSTRAPPED { dateKey }
ATTENDANCE_INACTIVITY_CATCHUP_STARTED { from, to, count }
ATTENDANCE_INACTIVITY_CATCHUP_DATE_PROCESSED { dateKey, detected }
ATTENDANCE_INACTIVITY_CATCHUP_DATE_FAILED { severity: "critical", dateKey, error }
ATTENDANCE_INACTIVITY_CATCHUP_FAILED { severity: "critical", error }   // en clockPunchMaintenance.ts, fallo inesperado fuera del loop de fechas
ATTENDANCE_INACTIVITY_DETECTED { ranDates, detectedTotal, bootstrapped, failedDate? }  // resumen, sólo si hubo algo que loguear
```

Mismo criterio de severidad/formato ya usado por el resto de `clockPunchMaintenance.ts` (`CLOCK_WORK_SHIFTS_MISSING_EXIT`, `CLOCK_MISSING_OUT_RISK_CHECK_FAILED`, etc.) — objeto estructurado, sin interpolar datos sensibles en el mensaje.

## 16. Feriados — sin cambios

`HolidayWorkAssignment`/12D/12E no se tocaron. `detectAttendanceInactivity` sigue siendo la única función que los consulta, y esta etapa no modificó ni una línea de esa función — el catch-up simplemente la llama una vez por fecha pendiente, exactamente como antes se la llamaba una vez por día.

## 17. Exclusiones pendientes — explícitamente para 15M.19B

Sin cambios, tal como pidió la etapa. Siguen faltando en `detectAttendanceInactivity` (ya documentado por 15M.18): descanso semanal (`ShiftAssignment.weekdays`), vigencia de `ShiftAssignment`, y régimen `SIN_TURNO`/`TURNO_FLEXIBLE` (`WorkRegime`). **Esta etapa no amplía el universo de notificaciones existente** — el catch-up llama exactamente a la misma función, con las mismas reglas, para cada fecha; sólo garantiza que ninguna fecha que ya debía procesarse se pierda.

## 18. Bug `flagOpenShiftOverflowForReview` — explícitamente para 15M.19B

Sin tocar. El bug de re-notificación/reversión a `PENDIENTE` cada 60s (detectado en 15M.18) es un problema de idempotencia de un flujo completamente distinto (`ShiftAlert` de tipo `POSIBLE_OLVIDO_SALIDA` por overflow, dentro de `workShiftEvaluationRunner.ts`/`expireOpenWorkShifts`) — no comparte código con `attendanceInactivity.service.ts` ni con el checkpoint nuevo, y mezclarlo acá habría ampliado el alcance de la etapa.

## 19. Frontend — no tocado

Ningún archivo de `frontend/` se modificó en esta etapa. `NotificationsPage` sigue sin polling propio (eso es 15M.19C) — es esperado que, hasta esa etapa, siga haciendo falta F5/renavegar para ver una `SIN_ACTIVIDAD_REGISTRADA` que el catch-up recién generó.

## 20. Tests

**Backend, todos nuevos o ampliados** (suite completa: 116 archivos, 1849 tests, todos verdes):

`argentinaTime.test.ts` (+7 tests) — `calendarDateKey` (inversa exacta de `argentinaCalendarDate`, sin corrimiento de huso) y `nextCalendarDateKey` (suma simple, fin de mes, fin de año, año bisiesto/no bisiesto).

`jobCheckpoint.repository.test.ts` (nuevo, 5 tests) — `findLastProcessedDateKey` (sin fila → `null`; fila con `lastProcessedDate: null` → `null`; fila con fecha → clave correcta) y `advance` (crea si no existe; sólo avanza hacia adelante, `lt: date`).

`attendanceInactivityScheduler.test.ts` (nuevo, 17 tests) — cubre explícitamente los casos A-H pedidos por 15M.18/19A:
- `buildPendingDateKeys` puro (6 tests): un día, tres días, nada pendiente, checkpoint por delante del objetivo (defensivo), límite por tick, cruce de fin de mes.
- Caso G (antes de la ventana diaria: cero llamadas a la DB).
- Caso F (nada pendiente: no reprocesa).
- Caso A (un día pendiente).
- Caso B / criterio de éxito §42 de la etapa (viernes procesado, sábado y domingo perdidos, el lunes procesa ambos en orden).
- Caso D (fallo intermedio: no avanza más allá del fallo, no procesa la fecha siguiente).
- Caso E (reintento: retoma exactamente en la fecha que había fallado).
- Caso C (reinicio: sin ningún estado compartido entre dos invocaciones sucesivas).
- Caso H (bootstrap sin configurar: inicializa en "ayer", no reprocesa histórico) + bootstrap con `ATTENDANCE_INACTIVITY_BOOTSTRAP_DATE` configurado.
- Límite por tick real (`ATTENDANCE_INACTIVITY_MAX_CATCHUP_DATES` mutado en el test) drenando una caída larga en varias corridas.
- Una fecha sin incidentes no infla `detectedTotal` ni genera un `advance` de más.

`attendanceInactivity.service.test.ts` — sin cambios (la función no se tocó); sus 24 tests existentes siguen verdes, confirmando que 15M.19A no alteró ninguna de sus reglas.

**Validación de infraestructura** (todas de sólo lectura/local, sin tocar Neon):
- `prisma validate` → ✅
- `prisma generate` → ✅ (cliente TS regenerado localmente)
- `prisma migrate status` → ✅ (conecta a Neon, confirma la migración nueva como válida y pendiente — no la aplica)
- `npm run typecheck` → ✅
- `npm run test` → ✅ (116 archivos, 1849 tests)
- `npm run build` → ✅
- `git diff --check` → sin errores de espacio en blanco

**Frontend**: sin cambios, sin tests nuevos (no se tocó ningún archivo de frontend).

## 21. Qué NO se tocó

- `detectAttendanceInactivity` (`attendanceInactivity.service.ts`) — ni una línea; sigue con las mismas exclusiones y el mismo mensaje de siempre.
- `HolidayWorkAssignment`/12D/12E — sin cambios.
- `flagOpenShiftOverflowForReview`/`workShiftEvaluationRunner.ts`/`openShiftMonitor.service.ts` — sin cambios (bug de re-notificación queda para 15M.19B).
- El resto de `clockPunchMaintenance.ts` (jornadas vencidas, riesgo de olvido de salida, limpieza de `ClockPunchAttempt`, storage huérfano) — sin cambios, sigue corriendo en el mismo `setInterval` de 60s.
- El fichador, Conceptos Horarios, carga horaria/grilla/export/bandeja, liquidación — ningún archivo tocado.
- Frontend completo — ningún archivo tocado.
- Permisos/rutas HTTP — `JobCheckpoint` no se expone por ningún endpoint (es infraestructura interna, tal como pidió la etapa).

## 22. Riesgos pendientes

- **Concurrencia multi-instancia de `SystemNotification`** (§13) — riesgo teórico preexistente, sin impacto mientras Render corra una sola instancia; documentado, no corregido en esta etapa.
- **El watermark no hace que el job corra mientras el proceso está apagado** — sólo garantiza que, cuando vuelve, recupera lo pendiente. Si el proceso queda apagado indefinidamente, ningún catch-up ocurre hasta que alguien lo reinicie (esto es una limitación de "no hay proceso corriendo en absoluto", no del diseño del watermark — está fuera del alcance de lo que un scheduler in-process puede resolver sin agregar infraestructura nueva, algo que la etapa pidió explícitamente evitar).
- Las exclusiones pendientes (§17) y el bug de `flagOpenShiftOverflowForReview` (§18) siguen exactamente como los dejó el diagnóstico 15M.18 — ninguno agravado ni resuelto por esta etapa.

## 23. Próximas etapas

- **15M.19B** — regla de "no fichó al inicio del turno" (tolerancia vencida, intradía) + exclusiones faltantes de `detectAttendanceInactivity` (descanso semanal, `ShiftAssignment` vigente, régimen `SIN_TURNO`/`FLEXIBLE`) + corrección del bug de `flagOpenShiftOverflowForReview`.
- **15M.19C** — refresco en vivo del frontend (extender a `NotificationsPage` el mismo polling que ya tiene la campana del topbar).
- **15M.19D** — regresión fin de semana / recuperación, usando los escenarios A-I originales como suite de aceptación end-to-end.

---

No se commiteó, no se pusheó, no se aplicó la migración a Neon (`migrate dev`/`migrate deploy` no se ejecutaron). No se modificó `detectAttendanceInactivity`, `HolidayWorkAssignment`, el fichador, ni ningún archivo de frontend.
