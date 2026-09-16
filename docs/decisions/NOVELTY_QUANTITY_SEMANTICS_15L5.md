# Etapa 15L.5 — Normalización de cantidades en Novedades (`quantityDays` / `quantityHours`)

## 1. Motivo

`Novelty.quantityDays` se calculaba en el frontend (`NoveltyModal.tsx::dateRange`,
`EmployeeHoursPage.tsx::noveltyRange`, lógica duplicada) filtrando
`current.getMonth() === start.getMonth()` — para una novedad `30/07/2026 →
02/08/2026` esto daba `2` (sólo 30 y 31 de julio) en vez de `4` (el rango
real completo). El backend nunca validaba ni recalculaba ese valor —
confiaba ciegamente en lo que mandara el cliente. Esta etapa hace al
backend la única autoridad del cálculo y elimina la lógica duplicada del
frontend.

## 2. Auditoría de consumidores (antes de modificar)

| Campo/consumidor | Tipo | Archivo |
| --- | --- | --- |
| Cálculo de `quantityDays` | Creación (buggy, recortado al mes) | `NoveltyModal.tsx::dateRange`, `EmployeeHoursPage.tsx::noveltyRange` |
| Envío en el payload de creación | Creación | `NoveltyModal.tsx`/`EmployeeHoursPage.tsx` → `noveltyApiService.create` |
| `createNoveltySchema` | Validación de forma (rango, positivo, máximos) — nunca de coherencia con las fechas | `novelties.schemas.ts` |
| `assertQuantityCoherence` | Validación (rechaza ambas cantidades a la vez) | `novelties.service.ts` |
| `NOVELTY_HOURS_NOT_ALLOWED` | Validación (`allowsHours=false` + `quantityHours` presente) | `novelties.service.ts::ensureNoveltyTypeReady` |
| Persistencia | Creación | `novelties.repository.ts::createMany` (pasaba lo que llegara, sin recalcular) |
| `resolveValue1` (Valor 1 = `quantityDays` si `finnegansValueUnit=DAYS`) | Exportación | `finnegansExport.service.ts` |
| `MISSING_DAYS_QUANTITY` / readiness | Exportación | `finnegansExport.readiness.ts` |
| `quantity: hours\|\|days\|\|null` | Visualización (bandeja de pendientes) | `pending.service.ts` |
| `quantityLabel` (`"N días"` / `"1 día"` default) | Visualización (listado de Novedades) | `noveltyApiService.ts::quantityLabel`/`mapNoveltyFromApi` |
| Tests | — | `novelties.service.test.ts`, `NoveltyModal.test.tsx` (ninguno afirmaba el valor exacto persistido antes de esta etapa) |

**Hallazgo clave** (no obvio antes de auditar): `quantityDays` **no es
exclusivo de la exportación Finnegans**. `pending.service.ts` (bandeja de
pendientes) y `noveltyApiService.ts::quantityLabel` (listado general de
Novedades, `"N días"`) lo muestran para **cualquier** novedad con
`allowsHours=false`, sin mirar `finnegansValueUnit` ni `exportsToFinnegans`.
Esto descarta la alternativa de "ligar `quantityDays` sólo a
`finnegansValueUnit=DAYS`" (evaluada en §7) — hay un consumidor operativo
real, independiente de Finnegans.

**Datos reales auditados** (sólo lectura, Neon): 1 `NoveltyType` real
(`allowsHours=true, exportsToFinnegans=true, finnegansValueUnit=HOURS`) y 7
`Novelty` reales, las 7 con `quantityHours` seteado y **ninguna** con
`quantityDays` seteado. Sin datos que backfillear ni combinaciones reales
de `allowsHours=true + finnegansValueUnit=DAYS` que justificaran tolerar
esa combinación (ver §6).

## 3. Semántica anterior vs. nueva

| | Antes | Ahora |
| --- | --- | --- |
| Quién calcula `quantityDays` | Frontend, al armar el payload | Backend, al crear la `Novelty` |
| Fórmula | Sólo días del mes de `fromDate` (bug) | Días calendario inclusivos del rango real completo |
| Cliente puede fijar el valor | Sí (el backend lo persistía tal cual) | No — el backend lo ignora y recalcula siempre |
| `quantityHours` | Manual (sin cambios) | Manual (sin cambios) |

## 4. `quantityDays` — significado

Cantidad de días calendario, **inclusive**, del rango real
`[fromDate, toDate]` de la novedad — sin recortar a ningún mes. `30/07 →
02/08` = 4 días. Se calcula **una sola vez**, al crear la novedad, sobre el
rango completo, independientemente de a qué período Finnegans pertenezca
esa novedad (que sigue siendo el mes de `fromDate`, Etapa 15L.3B.1, sin
tocar). Aplica siempre que `NoveltyType.allowsHours = false` — no depende
de `finnegansValueUnit` (ver §6/§7).

## 5. `quantityHours` — significado (sin cambios)

Dato 100% manual. Nunca se deriva de fechas, nunca se multiplica por
jornadas, nunca se relaciona con `TimeEntry`. Aplica siempre que
`NoveltyType.allowsHours = true`.

## 6. Fórmula — `calendarDaysInclusive`

`backend/src/shared/datetime/argentinaTime.ts::calendarDaysInclusive(fromDate, toDate)`
(agregado junto a `periodFromCalendarDate`/`dayOfMonthFromCalendarDate`,
que ya documentaban el mismo tipo de input — FECHA CALENDARIO ya
normalizada a medianoche UTC, ej. `Novelty.fromDate`/`toDate`, `@db.Date` —
cumple la regla del proyecto de no reimplementar aritmética de
fecha/hora fuera del único helper compartido):

```ts
if (!toDate) return 1;
const from = Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate());
const to = Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate());
if (to < from) throw new RangeError(...);
return Math.round((to - from) / MS_PER_DAY) + 1;
```

- Sin `toDate` (o `allowsDateRange=false`, que ya llega como `toDate=null`
  después de `normalizeCreateInput`): 1 día.
- Mismo día: 1.
- `30/07 → 02/08`: 4 (cruza de mes).
- `31/12 → 02/01`: 3 (cruza de año).
- Normaliza ambos extremos a medianoche UTC antes de restar — nunca usa la
  hora de día que traiga el `Date`, nunca depende de la zona horaria del
  proceso. El proyecto ya usa este mismo patrón (`Novelty.fromDate`/`toDate`
  llegan como `YYYY-MM-DD` desde el frontend, `z.coerce.date()` los parsea
  como medianoche UTC — confirmado, mismo criterio que cualquier otro
  `@db.Date` del sistema).

## 7. Cross-month / year boundary / timezone

Confirmado con tests explícitos (`argentinaTime.test.ts`): `30/07→02/08` =
4, `31/12→02/01` = 3, año bisiesto (`28/02/2028→01/03/2028` = 3, incluye el
29/02) vs. no bisiesto (`28/02/2026→01/03/2026` = 2), y que la hora-de-día
del `Date` de entrada no altera el resultado. No hay ningún caso especial
para cruce de mes/año: `Date.UTC` ya maneja el rollover de mes/año
correctamente sin código adicional.

## 8. Backend como autoridad — `resolveQuantities`

`novelties.service.ts::resolveQuantities` (nuevo), aplicado en `create()`
después de `normalizeCreateInput` (para que `allowsDateRange=false` calcule
sobre `toDate=null`, nunca sobre un rango que igual se iba a descartar):

```ts
if (type.allowsHours) return { ...input, quantityDays: null };
return { ...input, quantityHours: null, quantityDays: calendarDaysInclusive(input.fromDate, input.toDate) };
```

El cliente **ya no puede fijar `quantityDays`** — se ignora y se
recalcula siempre (preferencia explícita del pedido de esta etapa, en vez
de validar que coincida). `assertQuantityCoherence` (rechaza mandar
`quantityHours` y `quantityDays` a la vez) y `NOVELTY_HOURS_NOT_ALLOWED`
(rechaza `quantityHours` si `allowsHours=false`) se mantienen sin cambios —
siguen corriendo sobre el payload crudo, antes de `resolveQuantities`.

## 9. Frontend — sólo previsualización

`frontend/src/utils/noveltyDateRange.ts` (nuevo, único, sin duplicar en dos
componentes): mismo algoritmo que el backend, para previsualización
("Cantidad de días: 4") — nunca se envía como el valor definitivo.
`NoveltyModal.tsx` y `EmployeeHoursPage.tsx` ya no calculan nada: su
`resolveNoveltyQuantities`/payload mandan `quantityDays: null` siempre que
`allowsHours=false` (el backend lo va a recalcular igual). Se eliminó
`dateRange()`/`noveltyRange()` (la lógica duplicada con el bug de
`getMonth() === start.getMonth()`).

## 10. `allowsHours` — sin cambios de rol

Sigue siendo la única señal que decide qué campo aplica (capacidad
operativa) — mismo criterio ya establecido en la Etapa 15L.2B.1. No se
volvió a acoplar con `finnegansValueUnit` en ninguna dirección.

## 11. `finnegansValueUnit` — sin cambios de rol

Sigue siendo la única señal que decide cómo se interpreta Valor 1 al
exportar (`finnegansExport.service.ts::resolveValue1`, sin tocar). No
decide si `quantityDays` se calcula — eso lo decide `allowsHours` (§4,
hallazgo del §2).

## 12. Combinaciones reales auditadas

Un único `NoveltyType` real: `allowsHours=true, exportsToFinnegans=true,
finnegansValueUnit=HOURS` — la combinación "canónica" A del pedido (§17).
Cero casos reales de `allowsHours=false + finnegansValueUnit=DAYS` (B) ni
de `finnegansValueUnit=UNIT` (C) ni de la combinación ambigua
`allowsHours=true + finnegansValueUnit=DAYS` (§15/§16 del pedido).

## 13. Combinación incompatible — `allowsHours=true` + `finnegansValueUnit=DAYS`

Analizada explícitamente (§15 del pedido: "no ocultar este problema").
Con la regla nueva, `allowsHours=true` implica `quantityDays` **siempre**
`null` (nunca se calcula para un tipo que captura horas) — un `NoveltyType`
configurado así exportaría para siempre con Valor 1 vacío
(`MISSING_DAYS_QUANTITY`), sin ningún dato que pudiera completarlo. Sin
evidencia real de esta combinación (§12) y sin ningún caso de negocio
descrito que la justifique, se **prohíbe** en vez de tolerarla:
`noveltyTypes.service.ts::assertFinnegansConfigCoherent` rechaza
`allowsHours=true && finnegansValueUnit==="DAYS"` con
`400 NOVELTY_TYPE_HOURS_DAYS_CONFLICT`, tanto en `create()` como en
`update()` (mirando el estado resultante: fila actual + patch, mismo
criterio que las otras validaciones de coherencia Finnegans de esa
función). `quantityHours`/`quantityDays` **nunca coexisten** — la regla de
integridad que ya existía (`NOVELTY_QUANTITY_UNIT_CONFLICT`) se mantiene sin
cambios, y con la prohibición nueva tampoco puede darse el escenario donde
"ambos necesitarían existir a la vez" que planteaba el pedido: al no poder
configurarse `allowsHours=true + finnegansValueUnit=DAYS`, nunca hay un
tipo que necesite capturar horas manualmente Y exportar días calculados al
mismo tiempo.

## 14. Novedades de un solo día / `allowsDateRange=false`

`fromDate=15/07, toDate=null` → `quantityDays=1`. `fromDate=15/07,
toDate=15/07` → `1`. `allowsDateRange=false` → la novedad es de un solo
día por diseño (`normalizeCreateInput` fuerza `toDate=null` antes de
llegar a `resolveQuantities`) → `quantityDays=1` siempre, sin importar
cualquier `toDate` que el cliente intente mandar (ya se rechaza antes,
`NOVELTY_TO_DATE_NOT_ALLOWED`, sin cambios).

## 15. Exportador Finnegans — adaptación mínima real: ninguna

`finnegansExport.service.ts::resolveValue1` y
`finnegansExport.readiness.ts::evaluateNoveltyReadiness` **no se
modificaron** — ya leían `Novelty.quantityDays` tal cual, sin ningún
cálculo propio. Lo único que cambió es que ese valor, desde ahora, es
canónico (rango completo) en vez de estar recortado al mes de `fromDate`.
Confirmado con un test de integración explícito
(`finnegansExport.service.test.ts`): una novedad `30/07→02/08` con
`quantityDays=4` (ya canónico) exporta `Valor 1=4`, `Fecha desde=30/07/2026`,
`Fecha hasta=02/08/2026` — coherente entre sí, en el período de julio
(15L.3B.1, sin tocar).

## 16. Delete/recreate

Sin cambios de política (hard-delete existente, sin tocar). Si se borra y
recrea una novedad, `quantityDays` se recalcula con las fechas nuevas
(mismo `create()`, misma autoridad). El snapshot de un batch Finnegans ya
exportado (Etapa 15L.4) conserva su valor histórico — no se recalcula
retroactivamente.

## 17. Qué NO se tocó

Selección mensual por `fromDate` (15L.3B.1), historial/idempotencia de
exportaciones (15L.4), cierre mensual, `TimeEntry`, fichador, Conceptos
Horarios/Horas Especiales, columnas legacy de `NoveltyType`,
`FinnegansNoveltyLink`. No se creó ninguna migración de Prisma — no hizo
falta, ningún campo de schema cambió. No hubo backfill de datos existentes
(no había ninguna fila real con `quantityDays` que corregir, ver §2).

## 18. Tests agregados

Backend: `argentinaTime.test.ts` (+9, `calendarDaysInclusive`: mismo día,
cross-month, cross-year, bisiesto/no bisiesto, timezone, rango inválido);
`novelties.service.test.ts` (+9: `resolveQuantities` para las 3 unidades,
cross-month, cross-year, cliente manda un valor incorrecto y se ignora,
`allowsDateRange=false`, timezone, más el test de `createNoveltySchema`
rechazando `toDate < fromDate`); `noveltyTypes.service.test.ts` (+6:
`NOVELTY_TYPE_HOURS_DAYS_CONFLICT` en create/update, con las combinaciones
permitidas HOURS/UNIT/DAYS-sin-allowsHours); `finnegansExport.service.test.ts`
(+1: Valor 1 DAYS usa la cantidad canónica end-to-end).

Frontend: `noveltyDateRange.test.ts` (nuevo, 7 tests de la función pura);
`NoveltyModal.test.tsx` (+6: sin input manual de días, HOURS sigue con
input manual, mismo día, cross-month, cross-year, la previsualización se
actualiza al cambiar fechas; +1 test existente actualizado para reflejar
que ya no se envía ningún `quantityDays` calculado).

## 19. Validaciones ejecutadas

```txt
Backend:
npx prisma validate   → OK
npx prisma generate   → OK
npm run typecheck      → OK
npm test (vitest run)  → 114 archivos / 1741 tests OK
npm run build           → OK

Frontend:
npx tsc -p tsconfig.app.json --noEmit → OK
npx tsc -b                             → OK
npx tsc -p tsconfig.e2e.json --noEmit → OK
npm test (vitest run)                  → 92 archivos / 953 tests OK
npm run build                           → OK

General:
git diff --check → sin errores
```

Sin migración de Prisma (no hizo falta — ningún campo de schema cambió).
No se hizo commit. No se hizo push.
