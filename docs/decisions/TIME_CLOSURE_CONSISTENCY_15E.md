# Etapa 15E — Consistencia de Cierres / Carga Horaria

## 1. Contexto 15A

La auditoría funcional 15A detectó un P0 en Carga Horaria / Cierres:
`timeEntriesService.create()` no consultaba `MonthlyTimeClosure` en
absoluto — cualquier rol operativo (RRHH incluido) podía cargar una hora
**nueva** sobre un período ya enviado/aprobado/con corrección pendiente,
sin ningún control ni auditoría de excepción. `update()` sí tenía más
controles (correctamente implementados, ver §3), pero create() los
ignoraba por completo. El resto de 15A también señaló que los flujos de
corrección post-cierre y la bandeja/cierres estaban "separados" (a
confirmar en el diagnóstico) y que la exportación ignora el estado de
cierre.

## 2. Decisiones de usuario

1. No se puede crear una hora nueva por flujo normal sobre un período
   cerrado/enviado/aprobado — debe bloquearse (no hay "corrección" posible
   para algo que todavía no existe).
2. RRHH es el nivel máximo: si corrige horas sobre un período cerrado, esa
   corrección queda aprobada/cerrada directamente, sin aprobación de
   terceros.
3. Todo cambio de RRHH sobre un período cerrado debe quedar auditado y con
   motivo obligatorio.
4. Esta etapa prioriza integridad de datos de liquidación por sobre
   flexibilidad operativa.

## 3. Problema detectado (diagnóstico completo)

Confirmado contra el código real, no contra suposiciones:

- **`create()` (`timeEntries.service.ts`)**: cero consultas a
  `MonthlyTimeClosure`. Confirmado el P0 tal cual lo describía 15A.
- **`update()` (`timeEntries.service.ts`)**: **ya estaba bien implementado**
  antes de esta etapa — consulta `MonthlyTimeClosure` por
  `(employeeId, period)`, bloquea a no-RRHH con
  `409 PERIOD_CLOSED_REQUIRES_CORRECTION` si el cierre está
  `ENVIADO`/`APROBADO`/`CORRECCION_PENDIENTE`, y exige `correctionReason`
  (400 si falta) tanto para no-RRHH como para RRHH cuando corresponde. RRHH
  queda auto-aprobado (`autoApprovedByUserId = user.id`). No hizo falta
  ningún cambio de comportamiento acá — sólo un refactor puro (ver §4).
- **`TimeCorrectionRequest` (`workforce.service.ts`)**: flujo COMPLETO y ya
  correctamente cerrado por rol a nivel de ruta —
  `POST /corrections` (crear) es exclusivo de Supervisión/Nivel 3 (RRHH
  queda afuera a propósito, porque RRHH corrige directo vía `update()`);
  `POST /corrections/:id/approve|reject` son exclusivos de RRHH.
  `createCorrection` ya exigía que el cierre estuviera bloqueado antes de
  aceptar una solicitud (`400 PERIOD_NOT_CLOSED` si el período todavía
  permite edición directa) — el mecanismo inverso y complementario a
  `update()`. No hizo falta ningún cambio de comportamiento, sólo el mismo
  refactor puro.
- **`HourConceptBreakdown` manual (`employees.service.ts`,
  `validateManualBreakdownContext`)**: la inconsistencia real que pedía
  Parte 4.B — bloqueaba a **todos** los roles, RRHH incluido, sin ninguna
  vía de corrección, a diferencia de `TimeEntry.update()` que sí dejaba a
  RRHH corregir con motivo. Corregido (ver §5).
- **Recálculo automático de breakdowns** (`automaticHourConceptBreakdowns.service.ts`):
  también bloqueaba a todos, RRHH incluido, sin excepción — pero es una
  regeneración masiva derivada de `WorkShift`, no una corrección puntual
  con motivo documentado. Se dejó **deliberadamente sin cambios de
  comportamiento** (sólo el mismo refactor de consolidación), ver §9.
- **Exportación** (`exportByPerson`): filtra `TimeEntry.status = APROBADO`
  (o `APROBADO`+`EN_REVISION` con `includeInReview=true`), pero nunca
  consulta `MonthlyTimeClosure`. Un `TimeEntry` puede estar `APROBADO`
  (auto-aprobado por RRHH) sin que el cierre mensual del período haya sido
  formalmente enviado/aprobado — la exportación no distingue eso. Ver §8.
- **Estados de `MonthlyClosureStatus`**: `ABIERTO`, `ENVIADO`, `APROBADO`,
  `DEVUELTO`, `CORRECCION_PENDIENTE`. **No existe un estado `CERRADO`
  separado** — `APROBADO` es el estado terminal real de un cierre.
  (`TimeEntry.status`/`HourConceptBreakdown.status` sí usan
  `ApprovalStatus.CERRADO`, pero eso describe el estado de una FILA
  individual, no del cierre mensual — son conceptos distintos, no hay
  ningún código que escriba `MonthlyTimeClosure.status = "CERRADO"` porque
  ese valor no existe en el enum.)
- **Eliminar `TimeEntry`**: no existe ningún endpoint `DELETE` para
  `TimeEntry` — confirmado en `timeEntries.routes.ts`. No hay nada que
  alinear ahí.

## 4. Estados de cierre que bloquean

`ENVIADO`, `APROBADO`, `CORRECCION_PENDIENTE` — exactamente los mismos tres
que `update()` ya usaba, ahora consolidados en un único helper puro y
testeado: `isMonthlyClosureLocked` (`backend/src/shared/monthlyClosure/closureLock.ts`).
`ABIERTO` y `DEVUELTO` quedan afuera a propósito (`DEVUELTO` = RRHH
reabrió el cierre explícitamente).

## 5. Reglas para create/update/delete

- **`create()`**: bloqueo **total, sin excepción de rol** (ni siquiera
  RRHH) cuando el cierre del período (derivado de `input.date` vía
  `periodFromCalendarDate`, mismo empleado) está bloqueado —
  `409 MONTHLY_CLOSURE_LOCKED`. No hay vía de "corrección" para algo que
  todavía no existe; si RRHH necesita agregar algo a un período ya cerrado,
  el camino seguro con las piezas que ya existen es reabrirlo primero
  (`POST /closures/:id/return`, deja el cierre en `DEVUELTO`) y recién ahí
  cargar por flujo normal — no se inventó ningún mecanismo nuevo.
- **`update()`**: sin cambio de comportamiento — refactor puro (reemplaza
  el array inline por `isMonthlyClosureLocked`). RRHH corrige directo con
  `correctionReason` obligatorio; no-RRHH usa `TimeCorrectionRequest`.
- **`delete`**: no existe endpoint — nada que alinear.

## 6. Reglas para HourConceptBreakdown manual

`validateManualBreakdownContext` (`employees.service.ts`) ahora recibe el
`observation` del request como motivo de corrección (sin agregar ningún
campo nuevo — reutiliza el campo ya existente en
`upsertManualHourConceptBreakdownSchema`):

- Cierre no bloqueado: sin cambios.
- Cierre bloqueado + no-RRHH: `409 PERIOD_CLOSED` (código y mensaje sin
  cambios — cero impacto en el frontend existente, que ya lo maneja en
  `manualBreakdownSaveErrorMessage`).
- Cierre bloqueado + RRHH + `observation` presente: permite la corrección
  directa (aplicada/aprobada, igual que ya hacía con cierre abierto).
- Cierre bloqueado + RRHH + sin `observation`:
  `400 HOUR_CONCEPT_BREAKDOWN_CORRECTION_REASON_REQUIRED` (código nuevo,
  mensaje propio en español — no existía este camino antes, así que no
  rompe nada del frontend actual).

Recálculo automático (`automaticHourConceptBreakdowns.service.ts`): sin
cambios de comportamiento, ver §3 y §9.

## 7. Qué pasó con TimeCorrectionRequest

Nada — ya estaba bien diseñado e implementado (ver §3). Se aplicó
únicamente el mismo refactor de consolidación
(`isMonthlyClosureLocked` en vez del array inline) en `createCorrection`,
sin cambiar ningún comportamiento observable.

## 8. Qué pasó con exportación

Diagnóstico confirmado: `exportByPerson`/`GET /time-entries/export(.csv)`
no consulta `MonthlyTimeClosure` — sólo filtra por `TimeEntry.status`. Se
evaluó agregar una señal (bloqueo o advertencia) y se decidió **no
implementar código en esta etapa**:

- Bloquear exportación de períodos no cerrados podría interrumpir un uso
  legítimo de RRHH (Supervisión también puede exportar) para previsualizar
  números antes del cierre formal — no hay una decisión de producto
  explícita sobre si eso debe impedirse.
- Cualquier variante (bloquear del todo, advertir con un campo nuevo,
  advertir distinto por rol) implica decisiones de producto que esta etapa
  no tiene mandato para tomar sin confirmación previa ("no implementar
  cambios grandes sin confirmar el flujo exacto").
- El formato CSV/JSON actual no debía tocarse salvo necesidad clara, y
  ninguna opción evaluada era claramente "acotada" en ese sentido.

**Queda documentado como pendiente — Etapa 15E.2**: decidir si
`exportByPerson` debe advertir (campo adicional en la respuesta JSON,
sin tocar columnas CSV) o bloquear cuando el `MonthlyTimeClosure` del
período no está `APROBADO` para alguno de los empleados exportados.

## 9. Qué no cambió

- Modelo aditivo de Conceptos Horarios (Horas normales + desgloses) — no
  se tocó ningún cálculo.
- Horas Especiales / `DoubleHourRule` — no se tocaron.
- Storage, Documentos, Cloudinary — no se tocaron.
- Prisma schema / migraciones — no hizo falta ninguna; todo lo necesario
  ya existía en el modelo.
- DB, seed, login.
- `automaticHourConceptBreakdowns.service.ts`: comportamiento **sin
  cambios** — sigue bloqueando a todos los roles, RRHH incluido, sin
  excepción. Es una regeneración masiva derivada de `WorkShift`, no una
  corrección puntual con motivo documentado, así que no encaja en el
  patrón `correctionReason` — decisión deliberada, no un olvido.
- Frontend: un único cambio de una línea (mensaje para
  `MONTHLY_CLOSURE_LOCKED` en `EmployeeHoursPage.tsx`, mismo patrón que
  los mensajes ya existentes ahí). Nada de layout ni rediseño.
- Exportación: sin cambios de código — ver §8.

## 10. Tests agregados

- `shared/monthlyClosure/closureLock.test.ts` (nuevo): los 5 estados +
  `null`/`undefined`, helper puro.
- `modules/time-entries/timeEntries.service.test.ts`: nuevo describe
  `create — bloqueo por MonthlyTimeClosure` — bloquea para
  RRHH/Supervisión/Nivel 3 en `ENVIADO`/`APROBADO`/`CORRECCION_PENDIENTE`,
  permite en `ABIERTO`/`DEVUELTO`/sin cierre, y confirma que la consulta
  usa `employeeId` + período derivado de la fecha de la carga.
- `modules/employees/employees.service.test.ts`: reemplaza el test que
  probaba el bloqueo total (ya no existe) por dos tests — RRHH corrige con
  motivo (éxito) y RRHH sin motivo (`HOUR_CONCEPT_BREAKDOWN_CORRECTION_REASON_REQUIRED`).
  El test de Nivel 2/3 bloqueados sigue intacto (comportamiento sin
  cambios ahí).

## 11. Riesgo residual

- **Exportación** sin señal de cierre — documentado como 15E.2, pendiente
  de decisión de producto.
- **`automaticHourConceptBreakdowns`** sigue sin vía de corrección para
  RRHH sobre período cerrado — si el negocio lo pide, es una etapa
  separada (no encaja en el patrón `correctionReason` sin más diseño).
- El único camino para que RRHH agregue una hora **nueva** a un período
  cerrado es reabrir el cierre completo del empleado (`DEVUELTO`), no hay
  una vía más quirúrgica (p. ej. "permitir esta fila específica"). Es una
  limitación aceptada, no un bug — evita inventar un mecanismo nuevo sin
  confirmación de producto.

## 12. Validaciones

Backend:

```txt
npx prisma validate   → OK
npm run typecheck     → OK
npm test              → 105 archivos / 1499 tests OK (1482 previos + 17 nuevos de esta etapa)
npm run build         → OK
```

Frontend (se tocó `EmployeeHoursPage.tsx`, un solo mensaje de error nuevo):

```txt
npm test                                  → 83 archivos / 807 tests OK
npx tsc -p tsconfig.e2e.json --noEmit     → OK
npm run build                             → OK
```

No se corrieron journeys de Playwright: el único cambio de frontend es un
mensaje de texto dentro de una función de mapeo de errores ya existente,
sin impacto visual ni de flujo verificable por un journey.

General: `git diff --check` sin errores.
