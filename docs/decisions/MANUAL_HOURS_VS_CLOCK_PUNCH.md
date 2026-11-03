# Horas cargadas a mano + fichada en la misma jornada

**Estado:** implementado en `fix/manual-hours-vs-clock-punch` (2026-11-03). Migración `20261103180000_add_shift_alert_manual_hours_conflict` (un valor de enum, aditiva) validada sólo contra PostgreSQL local desechable. **No aplicada** en Neon `development`, demo ni producción.

## 1. Problema reproducido

Legajo 11 (Neon `development`, `ClockPunchAttempt` y `AuditLog`):

| Momento | Hecho |
|---|---|
| 29/10 14:17 | Carga manual de 8 h para el 30/10 (`source` nulo), enviada a revisión (`EN_REVISION`) |
| 30/10 07:26 | Ingreso aceptado (`201`) |
| 30/10 10:43, 10:44, 10:46 | Tres salidas rechazadas: `409 CLOCK_LOCKED_TIME_ENTRY` |
| 02/11 | El vencimiento de jornadas creó al lado una segunda fila de 0 h (`KIOSK`, `APROBADO`) |

## 2. Causa exacta

Recorrido: PWA → `POST /api/clock/photo-punch` → `timeEntriesService` (salida) → `timeEntriesRepository.closeOpenWorkShift`.

- El **ingreso** sólo crea `AttendancePunch` + `WorkShift` abierto. No mira `TimeEntry`.
- La **salida**, dentro de su transacción:
  1. inserta la fichada de salida y cierra la jornada;
  2. crea los `TimeSegment`;
  3. por cada fecha, busca la fila de Horas base (`NORMAL_BASE`) existente y le **suma** los minutos fichados.
- Hay **una sola fila de Horas base por persona y fecha** (`EMPLOYEE_DAY_OFF.md` §7.1).
- Si la fila existente no estaba `APROBADO` ni en un estado editable (`BORRADOR`, `PENDIENTE`, `DEVUELTO`, `RECHAZADO`), se lanzaba `TIME_ENTRY_LOCKED`. El servicio lo traducía a `409 CLOCK_LOCKED_TIME_ENTRY` y la transacción entera se revertía.
- `EN_REVISION` no estaba en ninguna de las dos listas: por eso fallaba la salida del legajo 11.

**El caso silencioso, peor:** con la carga manual en cualquier otro estado, la salida **sí pasaba**, pero:

- sumaba 8 h manuales + 6 h 42 min fichadas = 14 h 42 min;
- pasaba la fila a `source` del fichador y a `APROBADO`.

Una carga manual en borrador quedaba aprobada y duplicada sin ningún aviso.

**Vencimiento y rollover:** `expireOpenWorkShifts` y el rollover creaban siempre una fila de 0 h, aunque ya existiera la manual. Sin efecto en horas, pero rompía la regla de una sola fila por fecha.

## 3. Regla

- El fichador **siempre** registra ingreso y salida, y conserva fichadas, fotos, jornada y tramos.
- Una fichada **nunca** modifica ni borra horas fijadas por una persona.
- Si una jornada del fichador cae en una fecha con horas manuales, se crea una **revisión**:
  - mientras está pendiente, computan las horas manuales;
  - la fichada queda como evidencia;
  - un responsable decide:
    - **"Usar horas fichadas":** la fila de esa fecha pasa a valer lo fichado, exactamente lo que la salida habría escrito;
    - **"Mantener carga manual":** no cambia ninguna hora.
- No se usa lenguaje de falta ni de incumplimiento.

**Distinción manual / automática:** el único criterio es `workedTimeAccounting.isAutomaticTimeEntrySource` (el de Francos).

- `source` nulo (carga manual) o `ADMIN` (corrección): horas fijadas por una persona.
- Cualquier canal del fichador: automática.

**Única regla de conflicto:** `manualHoursConflict.manualHoursDateKeys`. Hay conflicto si alguna fecha de los tramos de la jornada, o su **fecha operativa** (`workShiftOperationalDateKey`, la de Francos), tiene una fila manual en cualquier estado.

## 4. Modelo de datos

**Sin tabla ni columna nueva.** La revisión **es** una `ShiftAlert` de tipo nuevo `ACTIVIDAD_SOBRE_CARGA_MANUAL`. Ya trae todo lo necesario:

- la jornada (`workShiftId`);
- `@@unique([workShiftId, type])`, que impide duplicar;
- estado pendiente o resuelta;
- `resolvedBy`, `resolvedAt` y `resolutionNote`;
- notificaciones y la pantalla Alertas de turnos.

El único cambio de esquema es ese valor de enum. Ningún tipo existente describe este caso, y reutilizar uno lo rotularía mal.

**Dónde vive cada dato:**

| Dato | Dónde |
|---|---|
| Decisión | `resolutionNote` igual a una de dos constantes. Mismo criterio que `DAY_OFF_CANCELED_ALERT_NOTE` |
| Horas que vio quien decidió | `before.days` de su `AuditLog`, escrito en la misma transacción. Una revisión resuelta muestra esos valores, porque si se usaron las fichadas la carga manual ya no existe como fila |
| Jornada en revisión | `WorkShift` `OBSERVADO`, igual que una salida en período cerrado. Motor B (desgloses automáticos) sólo toma jornadas `PROCESADO`, así que no hay desgloses automáticos que dupliquen |

## 5. Comportamiento

**Salida** (`closeOpenWorkShift`, también el cierre manual de RRHH):

1. Toma el lock persona+día de las fechas candidatas (las de los tramos y el día anterior y el siguiente al ingreso). Es el mismo lock de Francos.
2. Lee las filas de esas fechas.
3. Si hay horas manuales:
   - no escribe ninguna fila en **ninguna** fecha de la jornada (una nocturna 23:00→07:00 es **una** revisión);
   - deja la jornada `OBSERVADO` con una nota;
   - crea la alerta sin avisar (`notify:false`).
4. El aviso lo manda el paso `manual-hours-notice` del post-proceso durable. En el cierre manual, sale después del commit.
5. Las filas automáticas del mismo día (otra jornada fichada) se siguen acumulando como siempre.

**Carga manual** (`POST /time-entries`):

- Repite la verificación de duplicado dentro de su transacción, con el mismo lock. Una carga y una salida simultáneas nunca dejan dos filas ni horas sumadas.
- Si la fila existente es del fichador, responde `409 TIME_ENTRY_CLOCK_HOURS_EXIST`, con mensaje claro. Ese es el caso 3 (ingreso → salida → carga manual posterior).
- La vía para reemplazar horas ya fichadas sigue siendo la corrección explícita de esa carga: RRHH con motivo, queda `source = ADMIN` y auditoría.

**Vencimiento y rollover:** si la fecha del ingreso tiene horas manuales, la jornada queda `FALTA_SALIDA` sin la fila de 0 h. Esta lectura no toma lock: una carrera sólo podría dejar esa fila de 0 h, que no cambia horas.

**Resolución** (`POST /time-entries/manual-hours-conflicts/:id/resolve`):

- Corre en una transacción, con el lock persona+día y la auditoría adentro (`registerWithin`).
- "Usar horas fichadas":
  - para cada fecha, reemplaza la fila manual por lo fichado; si la fecha no tiene fila, la crea;
  - usa los mismos builders (`clockNormalEntryCreateData` / `clockNormalEntryUpdateData`) y el mismo motor de Horas Especiales que la salida;
  - la carga reemplazada queda en la observación y en la auditoría;
  - la jornada pasa a `PROCESADO`;
  - reconstruye los snapshots de cierres no protegidos y, después del commit, Motor B.
- "Mantener carga manual" no toca horas ni jornada.
- Período enviado o aprobado:
  - Nivel 2/3 → `409 PERIOD_CLOSED`;
  - RRHH sin motivo → `400 MANUAL_HOURS_CORRECTION_REASON_REQUIRED`;
  - "Mantener" siempre se permite.
- Reintento de la misma decisión: sin cambios ni nueva auditoría. Otra decisión: `409 MANUAL_HOURS_CONFLICT_ALREADY_RESOLVED`.
- La resolución genérica de alertas (`/shifts/alerts/:id/resolve`) rechaza este tipo con `409 SHIFT_ALERT_REQUIRES_HOURS_DECISION`: la cerraría sin decisión.

**Contabilidad:** no hay fórmula nueva. Todos los consumidores leen la fila de Horas base como siempre:

| Momento | Fila de esa fecha | Computa |
|---|---|---|
| Pendiente | La manual | La manual (p. ej. 8 h) |
| Usar fichada | Lo fichado (p. ej. 6 h 42 min, `source` del fichador) | Lo fichado |
| Mantener manual | Sin cambios | La manual |

**Permisos:**

- RRHH, Supervisión y Carga horaria, siempre dentro de `employeeAccessWhere`.
- Un id fuera del alcance → `403 EMPLOYEE_SCOPE_FORBIDDEN`; uno inexistente → `404`.

**Francos y feriados:** no cambian. Lo único que se reemplaza es el párrafo final de `EMPLOYEE_DAY_OFF.md` §7.1, donde una fichada nueva fusionaba sus minutos sobre una fila reconocida (`ADMIN`). Ahora esa fecha queda en revisión y la fila reconocida no se toca.

## 6. Rendimiento del fichador

El `201` de la salida suma **una** sentencia en la transacción (el lock persona+día). Va antes de leer las filas, en su propia sentencia: una lectura en la misma sentencia usaría la foto previa al lock.

En el caso con horas manuales, suma además el `UPDATE` de la jornada y el upsert de la alerta. Esta alerta sí se escribe dentro de la transacción, porque es la marca durable de la retención. Lo derivado, el aviso, va al job (`F12_PERF_5.md` §10).

Techos del fixture actualizados: OUT 15/18/0 y ROLLOVER 5/17/0.

## 7. API

Ver `docs/BACKEND_API_CONTRACTS.md`, sección "Fichadas sobre horas cargadas a mano".

## 8. UI (Carga de horas)

- **Listado del período:** "Fichadas sobre horas cargadas manualmente". Sólo aparece si hay revisiones o si falló su carga, con las pendientes primero.
- **Celda de la fecha operativa:** marca de anillo y detalle con "Revisar".
- **Modal de revisión:**
  - muestra horas cargadas, horas fichadas, ingreso, salida y diferencia;
  - en una nocturna, también el detalle por fecha;
  - acciones: "Mantener carga manual" y "Usar horas fichadas";
  - pide motivo si RRHH corrige un período cerrado.
- Después de decidir, la revisión se actualiza en el acto y la grilla se vuelve a pedir sin recargar la página.
- **Alertas de turnos:** muestra el tipo y enlaza a Carga de horas en lugar de "Resolver".

## 9. Validación (2026-11-03)

- **Backend:**
  - unitarios (`manualHoursConflict.test.ts`, `manualHoursConflict.service.test.ts`, casos nuevos de `timeEntries.repository.test.ts`, `shiftAlert.service.test.ts` y `clockPunchPostProcess.worker.test.ts`), más la suite completa;
  - integración contra PostgreSQL real, `manualHoursConflict.integration.test.ts` (10/10), sumada al CI;
  - las 7 integraciones existentes (fichador, procesamiento posterior, presupuesto, dispositivos, Francos y borrado controlado) en verde.
- **Frontend:** tests del modal, del servicio y de `HoursPage`, más la suite completa, typecheck y build.
- **QA visual real:**
  - backend y Vite locales contra una base desechable, con Playwright;
  - en 1440, 1366, 1920, 820 y 390: sin scroll horizontal de página ni errores de consola;
  - estados probados: pendiente, resuelta, nocturna, guardando, error al resolver, error del listado y período sin revisiones.

## 10. Rollback

Ver `backend/prisma/migrations/20261103180000_add_shift_alert_manual_hours_conflict/ROLLBACK.md`.

## 11. Límites conocidos

- **Desgloses manuales:** "Usar horas fichadas" no toca los desgloses manuales que se hayan cargado para esa fecha. Si declaraban más minutos que lo fichado, la contabilidad los acota a la base, como siempre, y conviene revisarlos.
- **Fecha de las filas de 0 h:** el vencimiento y el rollover siguen fechando su fila de 0 h con el instante de ingreso (`date: startAt`). Es previo a esta etapa y no se tocó.
- **Otros bloqueos de la salida:**
  - una fila **automática** en `EN_REVISION` (por ejemplo, una carga del fichador enviada a revisión) sigue bloqueando la salida, igual que antes. Es el mismo defecto de origen, para otra etapa;
  - una novedad aprobada que bloquea el día (`TIME_ENTRY_DAY_BLOCKED_BY_NOVELTY`) también sigue rechazando la salida, con su propio comportamiento previo.
