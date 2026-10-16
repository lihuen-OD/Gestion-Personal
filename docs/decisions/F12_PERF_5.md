# F12-PERF — PERF-5: camino crítico de la fichada

Fecha: 2026-10-16. Continúa `docs/decisions/F12_PERF_3_4.md`. Plan aprobado: PERF-5A → 5B → 5C → 5D en commits separados; 5E sólo diagnóstico; 5F benchmark local; 5G diferido a public staging.

**Estado:** F12-PERF local cerrado. PERF-1 a PERF-5D están terminados y PERF-5G espera public staging; ver "Cierre local y gate PERF-5G" al final.

## Línea base

Trace real en staging (backend local → Neon us-east-1, RTT ≈ 204 ms), 1 IN + 1 OUT del legajo de prueba 30:

| | Sentencias SQL | Post-commit en el request | Cliente |
| --- | ---: | ---: | ---: |
| IN | 27 | 10 / 4,15 s | 11,45 s |
| OUT | 71 (67 críticas) | 31 / 7,82 s | 21,21 s |

## Presupuesto de sentencias (regresión)

`backend/src/modules/clock/clockPunchPerf.integration.test.ts` corre IN, OUT y rollover contra PostgreSQL real (opt-in `CLOCK_PERF_IT_DATABASE_URL`). El fixture incluye un concepto automático nocturno con regla de día completo, una regla de horas especiales ×2 sin alcance y un usuario RRHH. Con eso ejercita clasificación, `isNight`, horas especiales, Motor B, alertas y notificaciones. El test verifica dos cosas:

- **Paridad funcional:** un snapshot normalizado, sin ids ni instantes, de jornada, fichadas y evidencia, tramos, horas, aplicaciones de reglas, AuditLog, alertas, notificaciones y desgloses. Se grabó con el código previo a PERF-5 y no se modifica en ninguna etapa.
- **Techos de sentencias SQL por fase:** PRE = antes del `BEGIN` de la transacción que inserta el `AttendancePunch`; TX = ese `BEGIN..COMMIT`; POST = lo que el request todavía ejecuta antes de responder.

Este fixture tiene menos destinatarios y alertas que staging, así que sus números no son los de staging. Sirven para comparar etapas entre sí.

| Etapa | IN (pre/tx/post) | OUT (pre/tx/post) | ROLLOVER (pre/tx/post) |
| --- | --- | --- | --- |
| Antes de PERF-5 | 5 / 11 / 9 = 25 | 17 / 19 / 23 = 59 | 6 / 16 / 17 = 39 |
| PERF-5A | 5 / 10 / 9 = 24 | 16 / 17 / 22 = 55 | 6 / 15 / 17 = 38 |
| PERF-5B | 4 / 10 / 9 = 23 | 15 / 17 / 22 = 54 | 5 / 15 / 17 = 37 |
| PERF-5C | 4 / 10 / 9 = 23 | 15 / 16 / 22 = 53 | 5 / 15 / 17 = 37 |
| PERF-5D | 4 / 11 / 0 = 15 | 15 / 17 / 0 = 32 | 5 / 16 / 0 = 21 |

PERF-5D suma una sentencia a cada TX (el `INSERT` del job) y deja POST en 0. Lo que salió del request lo ejecuta el worker: en este fixture, 16 sentencias para el job del IN, 32 para el del OUT y 28 para el del rollover. Esas cifras incluyen el claim, el lock, la marca y el cierre de cada paso, y no forman parte del `201`.

En producción, `clock_punch_query_budget` (`shared/observability/clockPunchQueryBudget.ts`) emite por fichada la cantidad de **operaciones Prisma** por fase. Usa AsyncLocalStorage, cuesta un contador por operación y nunca registra SQL, parámetros ni datos personales.

## PERF-5A — duplicados obvios

- **Evidencia vinculada desde el inicio:** el id del `AttendancePunch` se genera antes de insertarlo, y el `StorageFile` se crea con su `attendancePunchId`. El `UPDATE StorageFile` posterior desaparece en IN, OUT y rollover. `StorageFile.attendancePunchId` no tiene FK y el punch sigue apuntando al archivo con `photoFileId`.
- **TimeEntry sin relectura:** el fichador pide `returnEntries: false`, porque no usa los TimeEntry devueltos. Así cada `create`/`update` es una sola sentencia, sin el `SELECT` del `include`. El cierre manual de RRHH no cambia: sigue devolviéndolos para su respuesta y su auditoría. Los TimeEntry existentes del día se leen con `select` mínimo.
- **Kind del concepto desde lo ya cargado:** `findActiveRules` trae el `kind` del concepto de cada regla, y `classifySegmentsForEmployee` marca cada tramo con el kind de su concepto (regla candidata o respaldo). Si todos los tramos lo traen, `closeOpenWorkShift` no vuelve a leer `HourConcept` para `isNight`.
- **Evaluación de salida con la jornada a mano:** `evaluateShiftExit` acepta la jornada que devolvió la transacción del cierre y no la relee.
- **Descartado:** memoizar los destinatarios de notificación por evaluación. Por diseño (13G en la salida; caminos excluyentes en la entrada), una evaluación nunca notifica más de una alerta, así que no ahorraba nada.
- **Hermeticidad:** los tests de política de upload de `storage.service.test.ts` vaciaban sólo algunas variables. Con `PUNCH_PHOTO_STORAGE_PROVIDER` ya activo en el `.env` local, uno fallaba. Ahora cada test fija explícitamente todas las variables de upload.

## PERF-5B — contexto por request y lecturas en paralelo

`ClockPunchPrefetch` (`timeEntries.service.ts`): lo que el camino idempotente resuelve una sola vez por fichada, en la misma ronda que su contexto. Vive sólo durante el request y no es un cache.

- **Cooldown preliminar en la consulta del contexto:** `findClockValidationContext(employeeId, cooldownSince)` trae la última fichada relevante desde `cooldownSince`, con el mismo criterio que `findLatestClockPunchSince`. `cooldownSince` se calcula un instante antes que la ventana real, y la fichada se filtra con `windowStart`, así que la decisión es la misma. La autoritativa sigue siendo `guardClockPunchCooldown` dentro de la transacción. `clockStatusByEmployee` y los demás llamadores no pasan `cooldownSince` y reciben la relación vacía.
- **Concepto en paralelo con el contexto:** el `findDefaultHourConcept` que la fichada necesita (NORMAL_BASE, o el concepto que pide un IN de un cliente viejo) corre en la misma ronda. `shiftConceptFrom` aplica exactamente las validaciones de `resolveShiftConcept`, en el mismo punto y con los mismos errores.
- **Lecturas del OUT en paralelo con el upload:** cuando ya pasaron todos los chequeos preliminares que pueden rechazar (cooldown, jornada, novedades, horas bloqueadas), la clasificación (`findActiveRules`/`findEnabledConceptIds`) y `resolveSpecialHourRulesByDate` (historia laboral, reglas, convocatorias) arrancan mientras la foto sube a Neon. `closeOpenWorkShift` recibe `specialHours` ya resueltas para las mismas fechas. Son ≤ 10 consultas concurrentes (`PERFORMANCE_STANDARDS.md` §4).
- **Errores:** `runAhead` marca esas lecturas como manejadas, así que un fallo mientras se espera el upload no queda como rechazo sin manejar; el error aparece igual al consumirlas. Si falla el upload, se responde `CLOCK_PHOTO_STORAGE_FAILED` como antes. Si fallan las Horas Especiales (p. ej. `SPECIAL_HOUR_SCOPE_HISTORY_MISSING`), se compensa la foto y se propaga el mismo error, igual que cuando se resolvían después del upload.
- **Rollover:** el régimen de una jornada vencida se resuelve en paralelo con el upload.
- No hay `Promise.all` dentro de ninguna transacción interactiva.

## PERF-5C — transacción del OUT

- **Claim y salida en una sola escritura de la jornada:** la salida (`AttendancePunch`) se inserta primero. Después, un único `workShift.updateManyAndReturn` condicionado a `ABIERTO`/`endAt: null` cierra la jornada, le asigna `endPunchId` y devuelve la fila. Antes eran `updateMany` (claim) y `update(endPunchId)`. Si el claim no devuelve fila, se lanza `WORK_SHIFT_ALREADY_CLOSED` y la transacción revierte también la salida recién insertada. Con dos cierres concurrentes, el segundo espera el lock de fila del primero y re-evalúa la condición con la jornada ya cerrada. Aplica igual al cierre manual de RRHH.
- **Se mantienen deliberadamente, por atomicidad:**
  - el lock del cooldown + su lectura, y el lock del cierre mensual + su lectura: dos sentencias cada uno, porque unidas la lectura usaría el snapshot previo al lock;
  - el lote `StorageFile` + `StorageArchiveJob`, la salida, el `TimeEntry` existente del día (no hay clave única para hacer upsert), `TimeSegment`, `TimeEntry`, aplicaciones de reglas, `AuditLog` e intento.
- **Sin cambios:** el rollover (la lectura de la jornada vencida decide la nota del cierre protegido antes del claim) y la transacción del IN.
- **Concurrencia real en PostgreSQL** (`clockPunchPerf.integration.test.ts`):
  - dos cierres simultáneos de la misma jornada sin cooldown → uno escribe y el otro se revierte entero (1 SALIDA, 1 TimeEntry, 1 TimeSegment, `endPunchId` correcto);
  - cerrar una jornada ya cerrada no deja ninguna salida;
  - dos OUT HTTP simultáneos con `requestId` distintos → 201 + 409 y una sola salida y carga de horas.

## PERF-5D — outbox durable del post-proceso

El `201` espera sólo lo que confirma la fichada: `AttendancePunch`, `WorkShift`, `TimeEntry`, `TimeSegment`, aplicaciones de Horas Especiales, evidencia, `AuditLog` e intento `COMPLETED`. Todo eso queda en la transacción, como antes. Lo derivado pasa a un job durable y aparece segundos después:

- alertas de turno y sus avisos;
- adopción del turno en el ingreso;
- aviso `FALTA_SALIDA` y resolución de `POSIBLE_OLVIDO_SALIDA` del rollover;
- Motor B.

La respuesta del endpoint no cambia.

### Modelo

`ClockPunchPostProcessJob` (migración `20261016150000_add_clock_punch_postprocess_job`, sólo aditiva):

- **Columnas:** `attendancePunchId` (único), `workShiftId`, `employeeId`, `kind` (`ENTRY` | `ROLLOVER_ENTRY` | `EXIT`), `status` (`PENDING` | `PROCESSING` | `COMPLETED` | `FAILED`), `periods text[]`, `payload jsonb`, `stepsCompleted text[]`, `attemptCount`, `nextAttemptAt`, `leaseExpiresAt`, `lastErrorCode`, `lastErrorMessage`, `startedAt`, `completedAt`. Todos los instantes son `TIMESTAMPTZ(3)`.
- **Índices:** `(status, nextAttemptAt)`, `(status, leaseExpiresAt)`, `(workShiftId, createdAt)` y `(employeeId, status)`.
- **FKs:** `ON DELETE RESTRICT` hacia `AttendancePunch`, `WorkShift` y `Employee`, igual que el resto de la historia de un legajo.
- **Aplicación:** aplicada a staging (rama `development`) el 2026-10-16. Producción y demo no están migradas.

### Garantías

- **Nace con la fichada.** `timeEntries.repository` recibe un writer `postProcess` y escribe el job dentro de la transacción del IN, del rollover y del OUT. Si el `INSERT` del job falla, la fichada se revierte entera (503 `CLOCK_TEMPORARY_FAILURE` y evidencia compensada). Nunca queda una fichada confirmada sin su job. El cierre manual de RRHH no encola: sigue evaluando en línea.
- **No depende del proceso.** La garantía es la fila, nunca un `setTimeout`, una promesa suelta o un evento en memoria. El controller hace un `kick` al terminar la respuesta, pero sólo adelanta el tick si el worker corre en ese proceso. El worker (`clockPunchPostProcess.worker.ts`) arranca con `startAutomaticJobs`, sigue a `AUTOMATIC_JOBS_ENABLED` salvo que `CLOCK_POSTPROCESS_WORKER_ENABLED` lo fije, y tiene un intervalo de respaldo `CLOCK_POSTPROCESS_INTERVAL_MS` (5 s). En el primer tick recoge lo que una instancia anterior dejó `PENDING` o tomado con lease vencido.
- **Orden ENTRY→EXIT por jornada.** Un job `EXIT` sólo se reclama cuando ningún job de entrada de su jornada está sin `COMPLETED`. Lo decide la misma sentencia del claim (`UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)` con `NOT EXISTS`), así que el orden sobrevive reinicios, reintentos, backoff, leases vencidos y workers concurrentes. La evaluación de salida relee la jornada en la transacción de su paso, con el turno que adoptó el ingreso.
- **Pasos idempotentes.** Cada paso abre una transacción y hace tres cosas:
  1. Bloquea la fila del job y verifica que el lease siga siendo de su claim (fencing por `attemptCount`).
  2. Ejecuta sus efectos.
  3. Agrega su marca a `stepsCompleted` y renueva el lease.

  Efectos y marca se confirman juntos: un reintento retoma desde el primer paso sin marca y nunca duplica alertas, avisos, desgloses ni auditoría. Los pasos son:
  - `ENTRY`: `entry-evaluation`.
  - `ROLLOVER_ENTRY`: `overflow-resolution`, `missing-exit-notice` y `entry-evaluation`.
  - `EXIT`: `breakdowns:<período>` y `exit-evaluation`.

  Mantienen el orden del post-commit anterior. Para escribir en la transacción del paso, `createShiftAlert`, `notifyUsers`, `evaluateShiftEntry`, `evaluateShiftExit`, `resolveOpenShiftOverflowAlert` y `notifyMissingExit` aceptan `db`. Dentro de un paso un fallo se propaga (`rethrow`) en vez de quedar sólo logueado.
- **Motor B.** `recalculateForEmployeePeriod({ withinTransaction })` corre el hook dentro de su transacción serializable (`replaceAutomatic(…, afterWrite)`). La auditoría del recálculo (`registerWithin`) y la marca del paso se confirman con los desgloses, y se reintentan juntas ante P2034. Sin el hook, la llamada al repositorio y la auditoría quedan como antes. `PERIOD_CLOSED` conserva el criterio de 15M.1 §26: no se regenera, se loguea como warning y el paso se da por cumplido.
- **Fallos.** La fichada nunca se invalida por su post-proceso. Un error vuelve el job a `PENDING` con backoff (5 s·2^(n-1), techo 15 min). Al intento 12, o con un payload inválido, queda `FAILED`, con `lastErrorCode`, `lastErrorMessage` (última línea, ≤ 500) y log crítico `CLOCK_POSTPROCESS_FAILED`. Un lease perdido no escribe nada (`CLOCK_POSTPROCESS_LEASE_LOST`). Al completar se borra del payload el contexto de auditoría (IP y user agent), que sólo hacía falta para los pasos.
- **Cachés.** El request sigue limpiando lo necesario para ver la fichada: time-entries, grilla por legajo y auditoría. Al terminar el job se limpian los derivados: auditoría, alertas, notificaciones, time-entries y grilla. Lo que confirmó un paso ya se invalida aunque el job reintente.

### Cierre mensual y exportaciones

El snapshot del cierre lee `HourConceptBreakdown`, así que el cierre nunca debe congelar desgloses incompletos:

1. `POST /workforce/closures/submit` procesa en línea, antes del snapshot, lo pendiente de esos legajos (`drainClockPunchPostProcess`). Cada job se intenta una vez, incluidos `FAILED` y en backoff. Sólo se espera, hasta 10 s, a los que otro worker tiene tomados.
2. Dentro de la transacción, con el lock EXCLUSIVO de los períodos, `assertClockPunchPostProcessSettled` responde `409 CLOCK_POSTPROCESS_PENDING` si queda algún job sin terminar de ese período. Un OUT nuevo del período toma el lock SHARED y espera al envío, así que el conteo es definitivo.
3. El drenado llega como hook desde el controller. Así `workforce.service` no importa el worker y no se agregan ciclos de imports.

Las exportaciones definitivas exigen un cierre `APROBADO`, que pasó por esa guarda. La vista previa ya está marcada como no definitiva. El cierre manual de RRHH drena antes el post-proceso pendiente de su jornada (hasta 5 s), para evaluar la salida con el turno adoptado.

### Residuales

- Un IN concurrente con el envío del cierre no toma el lock del período, así que su job `ENTRY` puede quedar fuera del conteo. Sólo escribe alertas de una jornada todavía abierta, que el snapshot no lee.
- Los jobs `COMPLETED` no se purgan todavía. La retención queda como deuda, igual que con `StorageArchiveJob`.
- En un despliegue con varias instancias, los cachés en memoria siguen siendo por instancia. Esto ya pasaba antes y está acotado por los TTL.

### Validación

- **Unidad:**
  - worker (pasos, orden, saltos por marca, reintento, `FAILED`, payload inválido, lease perdido, fencing al completar, `PERIOD_CLOSED`, drenado, kick y arranque);
  - Motor B (hook dentro de la transacción, reintento P2034 con el mismo hook);
  - envío del cierre (drenado después del alcance, 409);
  - servicio de fichada (job encolado por tipo, períodos de una salida que cruza de mes, nada derivado en el request);
  - `startAutomaticJobs`.
- **PostgreSQL real** (`clockPunchPostProcess.integration.test.ts`):
  - backend caído después del 201 y procesado por el próximo arranque;
  - orden ENTRY→EXIT con el ingreso pendiente, en backoff o tomado (la salida anticipada sólo se detecta con el turno adoptado);
  - crash en `PROCESSING`, lease vencido y fencing del worker viejo;
  - falla de notificación (sin alerta huérfana; al reintentar, una alerta y un aviso por destinatario; re-entrega sin duplicados);
  - falla de Motor B (desgloses y auditoría una sola vez);
  - `FAILED` → cierre 409 → cierre OK al recuperarse;
  - job tomado → 409 sin esperar de más;
  - job imposible de encolar → fichada revertida;
  - mismo `requestId` → un solo job;
  - tres workers concurrentes → cada job una vez.
- **Paridad funcional:** el snapshot de `clockPunchPerf.integration.test.ts` no cambió. Ese test procesa los jobs antes de tomar el snapshot.

## Validación en staging (2026-10-16)

Backend aislado local (`:4003`, `AUTOMATIC_JOBS_ENABLED=false`, `CLOCK_POSTPROCESS_WORKER_ENABLED=true`) contra la rama `development` de Neon (us-east-1). En el momento de la medición, un `SELECT 1` tardaba 188 ms de mediana (175–313 ms) y una transacción interactiva con una sola sentencia, 540–640 ms. Se usaron los legajos de prueba 29, 30 y 31 y un dispositivo de prueba enrolado por el flujo real y revocado al final. La validación generó alertas en esos legajos (aceptado). Producción no se tocó.

### Regresión de sentencias (trace real, 1 IN + 1 OUT del legajo 30)

Mismo trace por preload que la línea base (verbo, tablas y origen; sin SQL ni parámetros):

| | Línea base | AUTH | PRE | TX | POST en el request | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| IN | 27 | 3 | 4 | 11 | **0** | 18 |
| OUT | 71 (67 críticas) | 3 | 19 | 18 | **0** | 40 |

`clock_punch_query_budget`: IN 3/8/0 y OUT 14/12/0 (operaciones Prisma pre/tx/post). Los jobs `ENTRY` y `EXIT` terminaron en el primer intento, 5,9 s y 10,7 s después de su fichada. El ingreso adoptó el turno y las alertas y avisos quedaron como antes.

### PERF-5E — conexiones del PUT al primary (sólo diagnóstico)

Seis PUT reales de 34,6 KB por modo, con keys de prueba que se borraron al final. Se midió con `diagnostics_channel` de undici:

| Idle previo | Conexión nueva | PUT (body sin consumir / consumido) |
| --- | --- | ---: |
| primero | sí | 1.378 / 1.047 ms |
| 0 s | sí | 1.029 / 1.023 ms |
| 2 s | **no** | **331 / 337 ms** |
| 5 s | sí | 1.056 / 987 ms |
| 30 s | sí | 1.102 / 1.136 ms |
| 60 s | sí | 1.412 / 1.381 ms |

- **Body sin consumir:** no tiene efecto medible. La respuesta del PUT viene vacía y undici libera el socket igual.
- **Conexión nueva:** cuesta 520–890 ms (TCP ≈ 180 ms y TLS ≈ 400 ms, más DNS ≈ 235 ms si no está en cache). Undici cierra los sockets ociosos a los ~4 s, así que, con fichadas separadas por más de unos segundos, casi todo PUT paga una conexión nueva.
- **Relevancia después de 5D:** sigue siendo relevante. En el IN, el upload está en el camino crítico y la conexión es ~0,5–0,9 s de sus ~1,1–1,5 s. En el OUT se superpone en parte con las lecturas de la salida.
- **Mejora propuesta (no implementada):** abrir la conexión al primary en paralelo con las lecturas de contexto de la fichada, por ejemplo con un `HEAD` firmado a una key inexistente. El PUT llegaría con el socket ya abierto (dentro de los ~4 s) y ahorraría ~0,5–0,9 s por fichada, sin librerías nuevas. Cuesta una request más al storage por fichada y conviene medirla con el backend en la misma región que el storage (PERF-5G). Subir el keep-alive necesitaría un `Agent` de undici (librería nueva), así que quedó descartado.

### PERF-5F — benchmark (5 IN + 5 OUT)

Backend sin trace. "Cold" es la primera fichada de un proceso recién arrancado (pool, prepared statements y TLS al storage vacíos). "Warm" es el resto. Con n = 5 se reportan p50, p90 y máximo; no hay p95 confiable.

| | Cliente p50 | p90 | máx | Upload p50 | PRE p50 | TX p50 | Post-commit en el request | Post-proceso completo p50 / máx |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| IN (todas) | 5,8 s | 7,8 s | 8,8 s | 1,14 s | 2,1 s | 3,5 s | 0 ms | 4,5 s / 5,5 s |
| IN cold (1) | 8,8 s | | | 1,46 s | 4,7 s | 4,0 s | 0 ms | 5,5 s |
| IN warm (4) | 5,0 s | 6,2 s | 6,4 s | 1,10 s | 2,1 s | 2,8 s | 0 ms | 4,0 s / 4,8 s |
| OUT (todas) | 8,3 s | 9,8 s | 10,4 s | 1,20 s | 2,8 s | 5,5 s | 0 ms | 10,3 s / 11,9 s |
| OUT cold (1) | 10,4 s | | | 1,39 s | 4,6 s | 5,8 s | 0 ms | 10,6 s |
| OUT warm (4) | 8,1 s | 8,7 s | 8,8 s | 1,17 s | 2,6 s | 5,4 s | 0 ms | 9,7 s / 11,9 s |

- **Requests:** las 10 fichadas respondieron 201. Operaciones Prisma por fase: IN 3/8/0 y OUT 14/12/0 en todas.
- **Post-proceso:** los 10 jobs terminaron `COMPLETED` en el primer intento.
- **Comparación con PERF-3/4** (mismo entorno): IN 5,6–10,6 s y OUT 16–21 s. El OUT bajó a la mitad. El IN mejora sobre todo en la cola.
- **Objetivo ≤ 2 s:** no se alcanza en esta topología. Con ~190–300 ms por round trip, el TX del OUT (18 sentencias) ya cuesta ~5,5 s, sólo de red. Lo que queda en el request es upload, lecturas previas y la transacción, todo proporcional al RTT. Validar el objetivo requiere backend y base en la misma región (PERF-5G, public staging).
- **Archive jobs:** quedaron 14 `StorageArchiveJob` `PENDING` (los 2 del diagnóstico de PERF-5 y uno por cada fichada de esta validación). Este backend no corría el scheduler del archivo; los procesa cualquier backend con schedulers.

## Cierre local y gate PERF-5G

### Auditoría de cierre (2026-10-16)

- **Código:** en `main` y en `origin/main` (`c4ac9b4`). Los commits de PERF-5 son `a7a9beb` (5A), `629e0ba` (5B), `b05c3e1` (5C), `712d3d0` (5D) y `c4ac9b4` (validación). La CI #174 sobre `c4ac9b4` está en verde.
- **Tests locales:** typecheck y build OK. La suite completa pasa (3171 tests, con los cuatro suites de integración del fichador sobre PostgreSQL local). El snapshot de paridad funcional no cambió desde que se grabó en 5A.
- **Schema y migraciones en staging:**
  - `prisma migrate status` dice "up to date" (69 migraciones).
  - El checksum guardado de `20261016150000_add_clock_punch_postprocess_job` coincide con el archivo (`b33df410…9de8d`). Ninguna migración quedó sin terminar ni revertida.
  - `prisma migrate diff` entre la base y `schema.prisma` da vacío.
  - Producción y demo no fueron migradas ni consultadas.
- **Secretos:** ningún `.env` está versionado (`backend/.env` está ignorado). Ningún valor de credencial ni el endpoint del storage aparecen en archivos versionados.
- **Storage:** `PUNCH_PHOTO_STORAGE_PROVIDER=neon_object_storage` sólo aplica al módulo `FICHADAS`. Los documentos siguen en `STORAGE_PROVIDER` (Google Drive). En la fichada no hay llamadas a Drive ni fallback: el upload va al primary y la copia a Drive se encola en la transacción.
- **Post-proceso:** los 12 jobs de la validación en staging están `COMPLETED`, sin `FAILED` ni pendientes.
- **Archivo:** hay 14 `StorageArchiveJob` en `PENDING`, ninguno `FAILED`. Cada uno tiene target `GOOGLE_DRIVE`, 0 intentos, `nextAttemptAt` vencido, sin lease ni error, y fuente `NEON_OBJECT_STORAGE` `ACTIVE` del módulo `FICHADAS` con checksum. Cada fichada apunta a su archivo y el objeto existe en Neon (verificado con HEAD). Todavía no hay copia en Drive, y Drive está configurado. Los procesa el tick de mantenimiento (`processStorageArchiveBatch`, 5 por minuto) de cualquier backend con `AUTOMATIC_JOBS_ENABLED`. No se borran.

### Riesgos abiertos

1. **Latencia:** el objetivo ≤ 2 s no está validado. Desde el backend local, cada round trip a us-east-1 cuesta ~190–300 ms (IN p50 5,8 s, OUT p50 8,3 s). Ver PERF-5G.
2. **Conexión nueva al storage:** después de unos segundos de inactividad, cada PUT abre una conexión nueva, que cuesta ~0,5–0,9 s (5E). La mejora propuesta no se implementó y se evalúa con datos de PERF-5G.
3. **Orden de despliegue:** el código de 5D escribe el job dentro de la transacción de la fichada. Desplegarlo en un entorno sin la migración `20261016150000` hace fallar todas las fichadas (503). La migración va primero.
4. **Worker:** sin un worker activo en algún proceso (`AUTOMATIC_JOBS_ENABLED`, o `CLOCK_POSTPROCESS_WORKER_ENABLED=true`), las alertas, los avisos y Motor B no aparecen. El envío del cierre igual procesa en línea lo pendiente de sus legajos.
5. **Observabilidad de `FAILED`:** hoy es la fila del job más el log crítico `CLOCK_POSTPROCESS_FAILED`. Todavía no hay una alerta operativa.
6. **Datos derivados:** alertas, avisos y desgloses aparecen segundos después del 201 (staging: ENTRY ~3–6 s, EXIT ~8–12 s). El cierre mensual está protegido por la guarda.
7. **Residuales de 5D:** un IN concurrente con el envío del cierre puede quedar fuera del conteo (sin efecto en el snapshot). Los jobs `COMPLETED` no se purgan, igual que los de `StorageArchiveJob`. Los cachés en memoria siguen siendo por instancia.
8. **Deuda previa:** `expireOpenWorkShifts` sigue sin auditoría (9G, `PERFORMANCE_STANDARDS.md` §10), documentada y sin tocar.

### Gate PERF-5G

No se hacen más optimizaciones locales de performance, ni la del keep-alive, sin evidencia de public staging. PERF-5G corre sólo cuando estén todas estas condiciones:

- backend desplegado en la misma región que Neon (us-east-1), como public staging y nunca producción;
- HTTPS real de punta a punta, con la PWA del fichador servida por public staging y `TRUST_PROXY_HOPS` correcto;
- el mismo schema y las mismas migraciones: `prisma migrate status` al día, incluida `20261016150000`, y `prisma migrate diff` contra `schema.prisma` vacío;
- Object Storage de staging (bucket privado) como primary de fichadas;
- archivo a Drive operativo, con los jobs `PENDING` drenando a `COMPLETED`;
- worker del post-proceso operativo;
- observabilidad habilitada: logs `clock_punch_timing`, `clock_punch_query_budget`, `CLOCK_POSTPROCESS_*` y `STORAGE_ARCHIVE_*` capturados, y lectura de las tablas de jobs;
- legajos de prueba y un dispositivo enrolado por el flujo real (pairing → RRHH), que se revoca al terminar.

PERF-5G mide:

- **Fichadas:** IN y OUT por separado, cold y warm. Cold es la primera fichada después de un deploy o reinicio, y la primera después de varios minutos sin uso. Para que p95 signifique algo, hacen falta al menos 20 por tipo.
- **Latencia:** p50, p90 y p95 de la latencia percibida por el cliente.
- **Fases:** PRE (auth, contexto e intento), STORAGE (`primary_upload`), TX (`transaction_acquire` + `transaction_core`) y RESPONSE (total del servidor y del cliente).
- **Query count** por fase (`clock_punch_query_budget`; POST debe seguir en 0).
- **Por separado, fuera del 201:**
  - post-proceso: lag hasta `COMPLETED`, intentos y `FAILED`;
  - archivo: lag hasta `COMPLETED`, intentos y fallos.
- **Contexto de red:** el RTT backend→DB y backend→storage al momento de medir.

**Objetivo de producto:** p50 ≤ 1,5 s y p95 ≤ 2,0 s de latencia del cliente. No se asume que se vaya a alcanzar. Si se cumple, F12-PERF se cierra. Si no, el desglose por fase decide la siguiente etapa, que se aprueba por separado (por ejemplo, la mejora de conexión al storage de 5E o la transacción del OUT).

