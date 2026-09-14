# Etapa 15E.2 — Exportación y estado de cierre

## 1. Contexto 15A / 15E

15A detectó que la exportación de horas (`exportByPerson`) ignoraba
`MonthlyTimeClosure` por completo — sólo filtraba por `TimeEntry.status`. 15E
cerró el P0 de `create()` de `TimeEntry` sobre períodos cerrados, y dejó
explícitamente documentado (`docs/decisions/TIME_CLOSURE_CONSISTENCY_15E.md`
§8) que la exportación quedaba pendiente como subetapa separada — no se
implementó ahí porque bloquear/advertir requería una decisión de negocio que
esa etapa no tenía mandato para tomar. Esa decisión ya está tomada para
15E.2 (ver §3).

## 2. Problema detectado

`timeEntriesService.exportByPerson()` (`GET /api/time-entries/export(.csv)`)
filtraba `TimeEntry` por `status` (`APROBADO`, o `APROBADO`+`EN_REVISION` con
`includeInReview=true`) pero nunca consultaba `MonthlyTimeClosure`. Un
`TimeEntry` puede quedar `APROBADO` sin que el cierre MENSUAL del período
haya sido formalmente enviado/aprobado (p. ej. RRHH carga/corrige directo,
que auto-aprueba la fila individual — ver 15E — sin que nadie haya pasado
por `POST /workforce/closures/submit` ni `.../approve`). Eso permitía
exportar para liquidación datos de un período todavía `ABIERTO`, `ENVIADO`,
`DEVUELTO` o `CORRECCION_PENDIENTE`, sin ninguna señal de que el número
podía seguir cambiando.

## 3. Decisión de negocio

Exportación **definitiva** de horas (para liquidación) sólo se permite si
`MonthlyTimeClosure.status = APROBADO`. Cualquier otro estado — incluida la
ausencia total de cierre — bloquea la exportación definitiva completa.

## 4. Estados de cierre permitidos/bloqueados

| Estado | Exportación definitiva |
| --- | --- |
| `APROBADO` | Permitida |
| `ABIERTO` | Bloqueada |
| `ENVIADO` | Bloqueada |
| `DEVUELTO` | Bloqueada |
| `CORRECCION_PENDIENTE` | Bloqueada |
| Sin `MonthlyTimeClosure` | Bloqueada |

Implementado en `isMonthlyClosureApproved`
(`backend/src/shared/monthlyClosure/closureLock.ts`) — deliberadamente más
estricto que `isMonthlyClosureLocked` (de 15E): ese helper trata `ENVIADO`/
`CORRECCION_PENDIENTE` como "bloqueado para edición directa" (pero
igualmente vivo/en curso), mientras que acá esos mismos estados **tampoco**
habilitan la exportación definitiva — el número todavía puede cambiar hasta
que el cierre llegue a `APROBADO`.

## 5. Qué exportaciones se afectan

Sólo `GET /api/time-entries/export` y `GET /api/time-entries/export.csv`
(ambos llaman al mismo `exportByPerson`, así que el gate aplica a los dos
por igual). El gate corre **antes** de consultar `HourConceptBreakdown` y de
armar las filas — si bloquea, no se genera ningún archivo, ni completo ni
parcial.

Export multi-empleado (sin `employeeId` en el query, o un período con
varios legajos): se valida el cierre de **cada** empleado que aparecería en
el resultado; si **cualquiera** no está `APROBADO`, se rechaza el export
completo con un único error — nunca se exportan sólo los empleados que sí
están aprobados. Un período sin ninguna fila que exportar (`grouped` vacío)
no dispara la consulta de cierres ni el bloqueo — no hay nada que proteger.

## 6. Qué pasó con Finnegans

Diagnóstico confirmado contra el código y contra
`docs/NOVEDADES_HORAS_FINNEGANS.md` (documento preexistente, ya explícito
en este punto): el módulo `finnegans-export`
(`GET /api/finnegans-export/novelties[.csv]`) exporta **exclusivamente
novedades** (`finnegansExportRepository.findExportableNovelties`,
`FinnegansExportRow` son todos campos de `Novelty`) — nunca `TimeEntry` ni
`HourConceptBreakdown`. No exporta horas ni liquidación. Por lo tanto **no
se tocó**: el requisito de cierre `APROBADO` no aplica a este módulo. Esto
ya estaba documentado explícitamente antes de esta etapa; 15E.2 sólo agrega
una referencia cruzada en `docs/NOVEDADES_HORAS_FINNEGANS.md` confirmando
el diagnóstico, sin cambiar la sustancia del documento.

## 7. Qué pasó con preview

No se creó un parámetro nuevo. El query param `includeInReview` ya existía
(incluye filas `EN_REVISION` además de `APROBADO` a nivel de `TimeEntry`) y
hoy el frontend nunca lo pasa en `true` (`HoursPage.tsx` llama
`getPeriodExportRows(period)` sin ese argumento — usa siempre el default
`false`), así que reutilizarlo como la vía de "preview" no cambia ningún
comportamiento observado hasta ahora. Con `includeInReview=true`, el gate de
cierre **no** se exige (aunque no haya ningún `MonthlyTimeClosure` para el
período), y la respuesta queda marcada explícitamente como no definitiva
(`definitive: false` en el JSON — campo aditivo, no toca las columnas del
`.csv`, que sólo lee `rows`). Con `includeInReview=false` (el export normal,
ahora con el gate aplicado), la respuesta trae `definitive: true`.

## 8. Qué no cambió

- Separación horas reales/liquidables, `normalLiquidable`/`conceptEquivalent`/
  `totalLiquidable`, modelo aditivo de Conceptos Horarios, Horas Especiales
  (`appliedMultiplier`, `DoubleHourRule`, `SpecialHourRuleApplication`) —
  cero cambios; todos los tests de las Etapas 6M/8F/11B siguen pasando
  exactamente igual, sin tocarlos.
- Columnas del CSV/JSON de `exportByPerson` — sin cambios; `definitive` es
  un campo nuevo a nivel de respuesta, no una columna de fila.
- Storage, Documentos, Cloudinary — no se tocaron.
- Login, seed, DB — no se tocaron.
- Prisma schema / migraciones — no hizo falta ninguna; todo lo necesario
  (`MonthlyTimeClosure.employeeId`/`period`/`status`) ya existía.
- Finnegans — sin cambios de código, ver §6.
- Auditoría: sin cambios en el registro de éxito (`action: "EXPORT"`); al
  bloquear por cierre no aprobado, el `throw` ocurre antes de llegar a
  `auditService.register(...)`, así que no queda un registro de "export
  exitoso" — no existía ni se inventó un patrón de auditoría de intento
  fallido para este endpoint.

## 9. Tests agregados

- `shared/monthlyClosure/closureLock.test.ts`: `isMonthlyClosureApproved`
  (los 5 estados + sin cierre) y `findUnapprovedEmployeeIdsForExport` (todos
  aprobados, algunos no, lista vacía de empleados).
- `modules/time-entries/timeEntries.repository.test.ts`: `findClosuresForExport`
  (vacío no consulta Prisma; filtra por `employeeId`/`period`, `select`
  mínimo).
- `modules/time-entries/timeEntries.service.test.ts`: nuevo describe con
  cierre `APROBADO` (permite, `definitive: true`), sin cierre (bloquea),
  `ABIERTO`/`ENVIADO`/`DEVUELTO`/`CORRECCION_PENDIENTE` (bloquea cada uno),
  multi-empleado con uno no aprobado (bloquea completo, nunca parcial), sin
  auditoría cuando bloquea, `includeInReview=true` (permite sin cierre,
  `definitive: false`), período vacío (no consulta cierres). Los ~10 tests
  preexistentes de `exportByPerson` (Etapas 6M/8F/11B) se dejaron intactos
  — ahora pasan gracias a un default seguro en el `beforeEach` global que
  resuelve cualquier `employeeId` consultado como `APROBADO`.

## 10. Riesgo residual

- El frontend (`HoursPage.tsx`) tenía un fallback que, ante **cualquier**
  error del export backend, generaba igual un archivo a partir de los datos
  ya visibles en pantalla (`getPeriodExportRowsFromEntries`, diseñado
  originalmente para modo mock/fallas de red) — eso hubiera anulado
  completamente este gate. Se agregó un caso explícito para
  `MONTHLY_CLOSURE_NOT_APPROVED` que corta ese fallback y muestra el mensaje
  de bloqueo sin generar archivo; el resto de los errores conserva el
  fallback existente sin cambios. No se agregó un test de componente nuevo
  para esta rama (cambio mecánico, mismo patrón ya probado en
  `EmployeeHoursPage.test.tsx`) — validado por el suite de frontend
  completo, `tsc` e2e y `build`.
- Se detectó (no relacionado a este cambio, confirmado corriendo el mismo
  test contra `main` sin mis cambios vía `git stash`) que
  `src/services/salaryRangeMockService.test.ts` falla de forma
  preexistente e independiente de esta etapa — no se tocó, no bloquea esta
  entrega.
- No existe todavía una UI que muestre `definitive`/motive el bloqueo con
  detalle por empleado — el mensaje es genérico ("el período debe estar
  aprobado"), sin enumerar qué legajo específico falta, a propósito (evita
  complejizar el contrato y cualquier filtración de estado entre roles).

## 11. Validaciones

Backend:

```txt
npx prisma validate   → OK
npm run typecheck     → OK
npm test              → 105 archivos / 1520 tests OK (1499 previos de 15E + 21 nuevos de esta etapa)
npm run build         → OK
```

Frontend (se tocó `HoursPage.tsx`, un solo `if` nuevo en el manejador de
error de exportación):

```txt
npm test                                  → 82 archivos OK / 1 archivo con 1 falla preexistente y no relacionada (ver §10)
npx tsc -p tsconfig.e2e.json --noEmit     → OK
npm run build                             → OK
```

No se corrieron journeys de Playwright — el cambio de frontend es un
manejador de error puntual, sin impacto visual/de flujo verificable por un
journey existente.

General: `git diff --check` sin errores.
