# Etapa 15L.3B.1 — Propiedad mensual única de novedades en exportación Finnegans

## 1. Motivo

15L.3A migró el exportador Finnegans al modelo normalizado
(`finnegansValueUnit`/`finnegansRequiresValidity`) y agregó un gate de
cierre mensual propio, pero dejó explícitamente sin resolver la semántica
de pertenencia mensual (`docs/decisions/FINNEGANS_EXPORT_NORMALIZED_15L3A.md`
§3/§19). La auditoría de la Etapa 15L.3B (no implementada, sólo propuesta)
confirmó el problema con cita exacta de código y diseñó la corrección — esta
etapa (15L.3B.1) la implementa.

## 2. Problema anterior

`finnegansExport.repository.ts::buildWhere` usaba un filtro de
**solapamiento**:

```ts
fromDate: { lte: finMes },
OR: [{ toDate: null }, { toDate: { gte: inicioMes } }],
```

Cualquier novedad cuyo rango `[fromDate, toDate]` tocara el mes pedido era
candidata — sin importar cuántos meses más tocara. Dos consecuencias
confirmadas:

- **Cross-month**: `30/07/2026 → 02/08/2026` cumplía la condición tanto
  para julio (`fromDate(30/07) <= 31/07`) como para agosto
  (`fromDate(30/07) <= 31/08 AND toDate(02/08) >= 01/08`) — la misma fila de
  `Novelty` podía exportarse dos veces, sin ningún registro de que ya se
  había exportado antes.
- **Open-ended**: `fromDate=15/07, toDate=null` — la rama `toDate IS NULL`
  del `OR` es verdadera para cualquier mes futuro, así que la novedad
  reaparecía indefinidamente en agosto, septiembre, etc.

## 3. Regla nueva

> El período de exportación de una novedad se determina por su Fecha desde
> (`fromDate`). Una novedad se exporta en un único período, aunque su Fecha
> hasta pertenezca a otro mes.

`toDate` deja de participar en la selección mensual. Sigue siendo el dato
real de vigencia/"Fecha hasta" exportada y lo que usa la grilla horaria
(`novelties.dateRange.ts::noveltyCoversDay`, módulo distinto, no tocado) para
decidir qué días cubre la novedad en pantalla — dos usos completamente
independientes de "a qué período Finnegans pertenece".

## 4. Cross-month con la regla nueva

`30/07 → 02/08`: julio → `30/07` está en `[01/07, 31/07]` ✓ candidata.
Agosto → `30/07` NO está en `[01/08, 31/08]` ✗ nunca candidata. Se exporta
una sola vez, en julio. Confirmado con test de comportamiento observable
(`finnegansExport.repository.test.ts`, §7 más abajo).

## 5. Open-ended con la regla nueva

`15/07 → null`: julio → `15/07` está en rango ✓. Agosto/septiembre →
`15/07` nunca vuelve a estar en esos rangos ✗ — `toDate=null` deja de tener
cualquier efecto sobre la selección. Se exporta una sola vez, en julio.

## 6. Query anterior → query nueva

`finnegansExport.repository.ts::buildWhere` — único cambio de código de
esta etapa:

```diff
-    fromDate: { lte: range.to },
-    OR: [{ toDate: null }, { toDate: { gte: range.from } }],
+    fromDate: { gte: range.from, lte: range.to },
```

`periodRange()` (cálculo de límites del mes vía `Date.UTC`) no cambió — ya
resolvía correctamente el borde de año (confirmado con test explícito,
§9). El resto del WHERE (`status: "APROBADO"`, `noveltyType.status:
"ACTIVO"`, `noveltyType.exportsToFinnegans: true`) no cambió.

## 7. Rango exportado — se mantiene REAL completo

**Decisión explícita, sin ambigüedad**: no se recorta ninguna fecha. Para
`fromDate=30/07, toDate=02/08`, exportado en julio:

```txt
Fecha desde = 30/07/2026
Fecha hasta = 02/08/2026
```

`finnegansExport.service.ts::buildRow` no se tocó — sigue usando
`fromDate`/`toDate` reales, sin ningún recorte al fin del mes dueño. Motivo
(ya fundamentado en la auditoría 15L.3B, sin evidencia en contrario): no hay
ninguna documentación, comentario ni test que indique que Finnegans espera
fechas recortadas al período; recortar inventaría un dato (la novedad
realmente termina el 02/08, no el 31/07); y como la novedad ya pertenece a
un único período gracias a la regla nueva, mantener el rango completo no
genera ningún riesgo de duplicación. Confirmado con test
(`finnegansExport.service.test.ts`: "el rango exportado se mantiene REAL
completo — sin recortar Fecha hasta al fin del mes dueño").

## 8. Impacto en preview / definitivo / CSV

Sin cambios de código en `finnegansExport.service.ts` ni
`finnegansExport.controller.ts` — los tres (`getPreview`, `getDefinitive`,
`.novelties.csv`) siguen compartiendo exactamente
`buildDataset()` → `finnegansExportRepository.findExportableNovelties()` →
`buildWhere()`. El único cambio de código está en `buildWhere`, así que se
propaga automáticamente a los tres endpoints sin ningún riesgo de que
"preview use una regla y definitivo otra" — esa garantía arquitectónica ya
la daba el diseño de 15L.3A.

## 9. Impacto en cierre mensual

Sin cambios de código en `shared/monthlyClosure/closureLock.ts` ni en la
lógica de gate de `finnegansExport.service.ts::getDefinitive`. La
coherencia es automática: `findClosuresForExport(employeeIds, period)` ya
filtraba `MonthlyTimeClosure.period = period` (un único período por
llamada); como con la query nueva una novedad `30/07→02/08` sólo puede
aparecer en el resultado de julio, el `employeeId` de esa persona sólo entra
al set "a verificar cierre" cuando se pide julio — nunca cuando se pide
agosto. Confirmado con test explícito (§10 más abajo).

## 10. Tests — cross-month

`finnegansExport.repository.test.ts` (nuevo describe "pertenencia mensual
única"):

- Comportamiento observable: assert directo, con `Date` nativo, de que
  `fromDate=30/07` satisface el `where.fromDate.gte/lte` armado para
  `period="2026-07"` y NO satisface el armado para `period="2026-08"` — no
  se conforma con verificar sólo la forma del objeto.
- Forma exacta del `where` de julio: sin ninguna cláusula `OR`, con
  `fromDate: { gte: 01/07 00:00, lte: 31/07 23:59:59.999 }`.

`finnegansExport.service.test.ts` (nuevo describe "pertenencia mensual
única"):

- Julio: con la novedad como única candidata devuelta por el repositorio,
  `getDefinitive({period:"2026-07"})` exporta 1 fila y llama a
  `findClosuresForExport(["employee-1"], "2026-07")`.
- Agosto: con el repositorio devolviendo `[]` (tal como ya prueba el test
  de repositorio que ocurriría con la query nueva), `getDefinitive({period:
  "2026-08"})` devuelve `rows: []` y **nunca** llama a
  `findClosuresForExport` — ningún cierre de agosto queda exigido por esa
  novedad.

## 11. Tests — open-ended

`finnegansExport.repository.test.ts`: `fromDate=15/07, toDate=null`
satisface el rango de julio y NO satisface los de agosto ni septiembre —
tres asserts consecutivos sobre el mismo `fromDate`, confirmando que
`toDate=null` no tiene ningún efecto remanente.

## 12. Tests — bordes

`finnegansExport.repository.test.ts`:

- `01/08 → 01/08`: candidata sólo en agosto, no en julio (confirma que el
  límite inferior del rango funciona, no sólo el superior).
- `31/12/2026 → 02/01/2027`: candidata sólo en diciembre de 2026, nunca en
  enero de 2027 — confirma que `periodRange()` calcula correctamente el
  cambio de año (usa `Date.UTC`, sin ningún caso especial necesario).

## 13. Tests de regresión general — sin cambios de comportamiento

Todos preexistentes de 15L.3A, sin tocar, en verde: selección por
`status`/`exportsToFinnegans`/tipo `ACTIVO`, vínculo principal, Valor 1
(HOURS/DAYS/UNIT), vigencia, Legajo, Centro de costo, Fecha Aplicación,
gate de cierre (todos los estados, multi-empleado, precedencia de errores),
`toCsv` sin columna `estado`. Ninguno necesitó modificarse — la única
edición fuera del WHERE fue actualizar la forma esperada del `where` en el
test que ya afirmaba su contenido exacto (ya no tiene `OR`, ahora `fromDate`
tiene `gte`).

## 14. `quantityDays` — hallazgo documentado, NO modificado

Auditado en 15L.3B (confirmado, sin cambios en esta etapa): el frontend
(`NoveltyModal.tsx::dateRange()` y `EmployeeHoursPage.tsx::noveltyRange()`,
lógica duplicada en ambos archivos) calcula `quantityDays` para tipos con
`allowsHours=false` iterando el rango `fromDate→toDate` pero **filtrando por
`current.getMonth() === start.getMonth()`** — es decir, ya recorta el
conteo al mes de `fromDate`, silenciosamente, desde antes de esta etapa y
sin ningún comentario que lo explique.

**No se debe asumir que esto define la semántica definitiva.** Deuda técnica
explícita para una etapa futura:

- Lógica duplicada entre `NoveltyModal.tsx` y `EmployeeHoursPage.tsx` —
  candidata a extraerse a un helper compartido.
- `getMonth()` compara sólo el índice de mes (0–11), sin año — en un rango
  hipotético de más de ~12 meses podría volver a contar un mes "coincidente"
  de otro año (caso extremo, no observado en el uso real de novedades
  cortas).
- El backend (`novelties.service.ts::assertQuantityCoherence`) no valida
  `quantityDays` contra `fromDate`/`toDate` en ningún punto — sólo rechaza
  mandar horas y días a la vez. Nada impide, hoy, que un valor de
  `quantityDays` quede desalineado del rango real si se crea por un camino
  distinto al de estos dos componentes (API directa, importación futura).
- Como no existe ningún endpoint de edición de `Novelty` (sólo
  `create`/`approve`/`reject`/`delete`), el valor calculado al crear queda
  fijo para siempre — no hay forma de recalcularlo si el rango se "corrige"
  (lo que en la práctica hoy sólo puede pasar borrando y recreando la
  novedad).

## 15. `quantityHours` — sin cambios

Confirmado (sin cambios en esta etapa): `quantityHours` es 100% manual —
un único input numérico que el usuario tipea una vez por novedad
(`hours`, default `"1"`/`"8"`), completamente independiente de
`fromDate`/`toDate`. Cross-month no genera ninguna ambigüedad para HOURS: el
valor exportado en el mes dueño es exactamente lo que RRHH escribió, sin
ninguna parte "de julio" ni "de agosto" que repartir.

## 16. Qué NO se tocó

`finnegansValueUnit`, `finnegansRequiresValidity`, `FinnegansNoveltyLink`
(modelo y relación), política de `MonthlyTimeClosure`
(`shared/monthlyClosure/closureLock.ts`), `AuditLog`/auditoría
(`finnegansExport.service.ts::getDefinitive` sigue auditando exactamente
igual), historial/idempotencia de exportaciones (sigue sin implementar,
15L.4), generación de `.xlsx` en el frontend
(`FinnegansExportPage.tsx`, sin cambios — el contrato de API
`{period, rows, readiness}` no cambió), `TimeEntry`, Conceptos
Horarios/Horas Especiales, fichador. Sin migración de Prisma — no hizo
falta, ningún campo de schema cambió.

## 17. Validaciones ejecutadas

```txt
Backend:
npx prisma validate    → OK
npx prisma generate    → OK
npm run typecheck       → OK
npm test (vitest run)   → 111 archivos / 1697 tests OK (1689 previos + 8 nuevos)
npm run build            → OK

Frontend (regresión, sin ningún archivo modificado):
npx tsc -b                             → OK
npx tsc -p tsconfig.e2e.json --noEmit → OK
npm test (vitest run)                  → 91 archivos / 923 tests OK (sin cambios)
npm run build                           → OK

General:
git diff --check → sin errores
```

No se hizo commit. No se hizo push.
