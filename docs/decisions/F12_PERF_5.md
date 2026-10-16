# F12-PERF — PERF-5: camino crítico de la fichada

Fecha: 2026-10-16. Continúa `docs/decisions/F12_PERF_3_4.md`. Plan aprobado: PERF-5A → 5B → 5C → 5D en commits separados; 5E sólo diagnóstico; 5F benchmark local; 5G diferido a public staging.

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

En producción, `clock_punch_query_budget` (`shared/observability/clockPunchQueryBudget.ts`) emite por fichada la cantidad de **operaciones Prisma** por fase. Usa AsyncLocalStorage, cuesta un contador por operación y nunca registra SQL, parámetros ni datos personales.

## PERF-5A — duplicados obvios

- **Evidencia vinculada desde el inicio:** el id del `AttendancePunch` se genera antes de insertarlo, y el `StorageFile` se crea con su `attendancePunchId`. El `UPDATE StorageFile` posterior desaparece en IN, OUT y rollover. `StorageFile.attendancePunchId` no tiene FK y el punch sigue apuntando al archivo con `photoFileId`.
- **TimeEntry sin relectura:** el fichador pide `returnEntries: false`, porque no usa los TimeEntry devueltos. Así cada `create`/`update` es una sola sentencia, sin el `SELECT` del `include`. El cierre manual de RRHH no cambia: sigue devolviéndolos para su respuesta y su auditoría. Los TimeEntry existentes del día se leen con `select` mínimo.
- **Kind del concepto desde lo ya cargado:** `findActiveRules` trae el `kind` del concepto de cada regla, y `classifySegmentsForEmployee` marca cada tramo con el kind de su concepto (regla candidata o respaldo). Si todos los tramos lo traen, `closeOpenWorkShift` no vuelve a leer `HourConcept` para `isNight`.
- **Evaluación de salida con la jornada a mano:** `evaluateShiftExit` acepta la jornada que devolvió la transacción del cierre y no la relee.
- **Descartado:** memoizar los destinatarios de notificación por evaluación. Por diseño (13G en la salida; caminos excluyentes en la entrada), una evaluación nunca notifica más de una alerta, así que no ahorraba nada.
- **Hermeticidad:** los tests de política de upload de `storage.service.test.ts` vaciaban sólo algunas variables. Con `PUNCH_PHOTO_STORAGE_PROVIDER` ya activo en el `.env` local, uno fallaba. Ahora cada test fija explícitamente todas las variables de upload.
