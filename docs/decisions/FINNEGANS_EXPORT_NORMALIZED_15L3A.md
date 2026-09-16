# Etapa 15L.3A — Exportación Finnegans sobre modelo normalizado + gate de cierre mensual

## 1. Motivo

15L.2A/B/C normalizaron el modelo de `NoveltyType` (`timeEntryBehavior`,
`allowsDateRange`, `finnegansValueUnit`, `finnegansRequiresValidity`) pero
dejaron explícitamente sin tocar `finnegans-export/*`
(`docs/decisions/NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md` §15,
`docs/decisions/NOVELTY_TYPE_CONSUMER_MIGRATION_15L2C.md` §10/§20) — el
exportador seguía leyendo exclusivamente los campos legacy
(`hasValidity`, `quantityHours`→`quantityDays`→`"1"`) y, a diferencia de
`GET /time-entries/export` (Etapa 15E.2), nunca exigía cierre mensual
aprobado, porque hasta ahora exportaba únicamente novedades (nunca horas) y
15E.2 dejó eso fuera de alcance a propósito. Esta etapa (15L.3A) cierra esa
brecha: migra el exportador al modelo normalizado y agrega un gate de cierre
mensual propio, sin tocar todavía nada de lo declarado explícitamente fuera
de alcance (columnas legacy, `FinnegansNoveltyLink` 1:N, semántica
cross-month, historial/idempotencia).

## 2. Exportador anterior (auditado antes de modificar)

`backend/src/modules/finnegans-export/{finnegansExport.service,repository,controller,schemas}.ts`,
sin ningún test previo (0% de cobertura, confirmado por ausencia de
`*.test.ts` en el módulo).

- **Filtros**: `employeeId` opcional; `status` = `APROBADO`, o
  `{APROBADO, PENDIENTE, EN_REVISION}` si `includePending=true`; `fromDate <=
  finMes` y `(toDate IS NULL OR toDate >= inicioMes)`; `noveltyType.status =
  ACTIVO`, `exportsToFinnegans = true`, y **exigía** al menos un
  `finnegansLinks` con `status: "ACTIVO"` (si no había ninguno, la `Novelty`
  ni siquiera llegaba de Prisma).
- **Campos legacy leídos**: `NoveltyType.hasValidity`,
  `FinnegansNoveltyLink.hasValidity` (OR entre ambos), `quantityHours`,
  `quantityDays`.
- **Vínculo**: `finnegansLinks: { where: { status: "ACTIVO" }, orderBy:
  [{priority:"asc"},{code:"asc"}], take: 1 }` — ya eligiera el de menor
  `priority` con empate por `code`, pero como filtro de Prisma dentro del
  `include`, no como una función propia reutilizable/testeada.
- **Valor 1**: `quantityHours || quantityDays || "1"` — fallback ambiguo,
  sin mirar ninguna unidad declarada.
- **Vigencia**: `noveltyType.hasValidity || link?.hasValidity` — OR legacy
  entre dos campos redundantes; si daba `true` y `toDate` era `null`,
  `formatDate(null)` devolvía `""` — la fila salía con "Fecha desde" llena y
  "Fecha hasta" vacía, sin ningún aviso.
- **Centro de costo**: siempre `""`, aunque el repositorio ya traía
  `employee.costCenter.code` (no usado). Documentado desde antes de esta
  etapa (`docs/NOVEDADES_HORAS_FINNEGANS.md`: "Si queda vacío, Finnegans
  toma el del legajo") — no hay evidencia de una regla distinta.
- **Período**: `period=YYYY-MM` o `from`/`to` libres (alternativa sin
  ningún caller real, confirmado por grep — sólo
  `FinnegansExportPage.tsx` llama a este servicio, y sólo con `period`).
- **Auditoría**: el propio `GET /novelties` (JSON) registraba
  `AuditLog(action: EXPORT)` en **cada** llamada, incluida cualquier carga
  de la pantalla de preview — no existía ninguna distinción entre "mirar la
  pantalla" y "exportar de verdad".
- **JSON**: `{ data: { total, rows } }`; filas sin `Novedad` (sin vínculo
  activo) se descartaban en silencio (`.filter((row) => row.Novedad)`) —
  jamás quedaba visible que una novedad exportable en teoría no tenía
  configuración Finnegans completa.
- **CSV**: mismo `getRows` que el JSON, mismos filtros, mismo `toCsv` con
  7 columnas fijas.
- **XLSX**: se generaba enteramente en `FinnegansExportPage.tsx` (frontend,
  librería `xlsx`), a partir de las filas ya en pantalla — el botón
  "Exportar" nunca volvía a pedirle nada al backend; si esas filas ya
  estaban en el navegador, deshabilitar el botón visualmente no era ningún
  gate real.
- **Cierre mensual**: no se consultaba en absoluto. Confirmado
  explícitamente ya desde `docs/decisions/TIME_EXPORT_CLOSURE_GATE_15E2.md`
  §6 (diagnóstico de 15E.2): como el exportador sólo movía novedades, el
  gate de 15E.2 se aplicó sólo a `GET /time-entries/export`.

## 3. Riesgo de semántica mensual — confirmado, NO resuelto en esta etapa

> **Resuelto en la Etapa 15L.3B.1**
> (`docs/decisions/FINNEGANS_EXPORT_MONTHLY_OWNERSHIP_15L3B.md`): la consulta
> ya no usa un criterio de solapamiento — la pertenencia mensual de una
> novedad depende exclusivamente de `fromDate`, sin ningún efecto de
> `toDate` sobre la selección. Cross-month y open-ended quedaron cerrados,
> con tests de comportamiento observable. El resto de esta sección se
> conserva como registro histórico del diagnóstico original.

La consulta sigue usando exactamente el mismo criterio de solapamiento que
tenía antes (`fromDate <= finMes AND (toDate IS NULL OR toDate >=
inicioMes)`), sin recortar rangos, sin dividir la novedad, sin mover nada al
mes de `fromDate`. Una novedad `30/01 → 02/02` puede seguir apareciendo
tanto en la exportación de enero como en la de febrero — cada mes vuelve a
correr la misma consulta contra la misma fila de `Novelty`, sin ningún
registro de "esto ya se exportó antes". Una novedad open-ended
(`toDate = null`) sigue pudiendo aparecer en todos los meses posteriores a
`fromDate`, indefinidamente. Ninguno de los dos casos se decide en 15L.3A —
queda para 15L.3B (ver `finnegansExport.repository.test.ts` y
`finnegansExport.repository.ts` para el comentario explícito que deja esto
documentado en el código, no sólo acá).

## 4. Selección de novedades candidatas (§3 del pedido)

`finnegansExport.repository.ts::findExportableNovelties` — WHERE:

```ts
status: "APROBADO",
fromDate: { lte: finMes },
OR: [{ toDate: null }, { toDate: { gte: inicioMes } }],
noveltyType: { status: "ACTIVO", exportsToFinnegans: true },
```

**Cambio deliberado respecto al exportador anterior**: ya NO exige
`finnegansLinks: { some: { status: "ACTIVO" } }` en el WHERE. Una novedad de
un tipo con `exportsToFinnegans=true` pero sin ningún vínculo activo
configurado sigue siendo "candidata" — sólo que su readiness la marca
`MISSING_LINK` (bloqueada) en vez de desaparecer en silencio de la consulta.
Esto es lo que permite que la preview pueda informar "tipo exportable sin
link activo" (pedido explícito, §17) sin que la fila deje de existir. `PENDIENTE`,
`EN_REVISION` y `RECHAZADO` nunca son candidatas — `includePending` (que
antes permitía colarlas) se retiró (ver §12).

## 5. `exportsToFinnegans` / `origin`

`exportsToFinnegans` sigue siendo la única condición que decide si un tipo
se exporta (WHERE de arriba). `origin` no se lee en ningún punto del
exportador nuevo — confirmado por grep dirigido sobre
`finnegansExport.*.ts`; sigue existiendo físicamente en el schema
(`@deprecated`, sin tocar).

## 6. Vínculo principal — helper compartido

`finnegansExport.principalLink.ts::resolvePrincipalFinnegansLink` (nuevo,
testeado en `finnegansExport.principalLink.test.ts`): recibe los vínculos ya
filtrados por `status: "ACTIVO"` (el repositorio los trae así,
`finnegansExport.repository.ts`) y elige el de menor `priority`, empate
estable por `code` — misma regla, en sustancia, que
`findPrincipalLinkIndex` del frontend (`NoveltyTypeFields.tsx`, Etapa
15L.2B), acotada al pool ACTIVO porque el exportador nunca debe usar un
vínculo inactivo (a diferencia de la UI de edición, que sí necesita poder
mostrar un vínculo único aunque esté inactivo). Antes, esta lógica vivía
implícita en un `orderBy + take: 1` de Prisma, sin ninguna función propia ni
test. Nunca se usa más de un vínculo por fila — confirmado con test explícito
(`finnegansExport.service.test.ts`: "un vínculo secundario nunca genera una
segunda fila"). Los vínculos secundarios no se tocan ni se borran.

## 7. `finnegansValueUnit` — Valor 1

`finnegansExport.service.ts::resolveValue1` — depende **exclusivamente** de
`NoveltyType.finnegansValueUnit`, sin ningún fallback:

| `finnegansValueUnit` | Valor 1 |
| --- | --- |
| `HOURS` | `quantityHours` (si falta: `""`, fila bloqueada) |
| `DAYS` | `quantityDays` (si falta: `""`, fila bloqueada) |
| `UNIT` | `"1"`, siempre — ignora `quantityHours`/`quantityDays` aunque tengan datos |
| `null` | `""`, fila bloqueada (`MISSING_VALUE_UNIT`) — tipo no configurado para el exportador nuevo |

No se inventa `0`, no se usa la otra cantidad como sustituto, y `null` nunca
se interpreta como `DAYS`/`UNIT` sin evidencia — instrucción explícita del
pedido de esta etapa (§9/§10), consistente con la misma postura conservadora
ya tomada en 15L.2A/§4 para el backfill.

## 8. Datos faltantes para Valor 1 — readiness, no exportación silenciosa

`finnegansExport.readiness.ts::evaluateNoveltyReadiness` (pura, testeada en
`finnegansExport.readiness.test.ts`) calcula, por fila, una lista de
`reasonCodes` (`MISSING_LINK`, `MISSING_VALUE_UNIT`,
`MISSING_HOURS_QUANTITY`, `MISSING_DAYS_QUANTITY`,
`MISSING_VALIDITY_TO_DATE`, `CLOSURE_NOT_APPROVED`) y un `estado` agregado
para la UI (`LISTO`/`FALTA_CANTIDAD`/`FALTA_CONFIGURACION`/
`CIERRE_PENDIENTE`). Ninguna de estas condiciones se resuelve inventando un
valor — la fila simplemente queda `ready: false`. La preview la muestra
igual (con su `estado`); la exportación definitiva la bloquea por completo
(ver §11).

## 9. Vigencia (`finnegansRequiresValidity`)

`finnegansExport.service.ts::buildRow` usa exclusivamente
`NoveltyType.finnegansRequiresValidity` — **ya no** el OR legacy
`NoveltyType.hasValidity || link.hasValidity` que usaba el exportador
anterior. `FinnegansNoveltyLink.hasValidity` no se lee en ningún punto del
exportador nuevo (queda como columna legacy intacta, sin ningún lector
productivo).

- `finnegansRequiresValidity = false` → "Fecha desde" = "Fecha hasta" = `""`
  (sin cambio respecto a antes, salvo la fuente del booleano).
- `finnegansRequiresValidity = true` → "Fecha desde" = `fromDate` siempre;
  "Fecha hasta" = `toDate` si existe. Si falta `toDate`, **no se inventa
  ninguna fecha** — antes el exportador dejaba "Fecha hasta" vacía en
  silencio (mismo síntoma que Valor 1 con fallback ambiguo); ahora la fila
  queda `MISSING_VALIDITY_TO_DATE` (bloqueada para exportación definitiva,
  visible en preview). Éste es el único cambio de comportamiento
  identificado en la migración de vigencia — documentado explícitamente
  porque el pedido de esta etapa (§12) exigía auditar cualquier diferencia.

## 10. Fecha Aplicación / Centro de costo — sin cambios

`Fecha Aplicación = fromDate`, sin evidencia de un comportamiento distinto
(§13 del pedido). `Centro de costo` sigue `""` siempre — auditado: el
repositorio trae `employee.costCenter.code` pero nunca se usó, y
`docs/NOVEDADES_HORAS_FINNEGANS.md` ya documentaba, desde antes de esta
etapa, que un valor vacío hace que "Finnegans toma el del legajo". No hay
ningún caso real que exija enviarlo — se mantiene vacío, sin inventar una
regla nueva (§14 del pedido).

## 11. Preview vs. definitivo — contrato

```txt
GET /finnegans-export/novelties?period=YYYY-MM&preview=true
  → NO exige cierre aprobado, NO audita, informa readiness (incluido cierre
    pendiente como blocker, sin bloquear la pantalla).

GET /finnegans-export/novelties?period=YYYY-MM   (preview=false, default)
  → revalida todo desde cero, exige readiness.ready === true (datos +
    cierre), audita (AuditLog EXPORT/FinnegansExport) recién si autoriza.

GET /finnegans-export/novelties.csv?period=YYYY-MM
  → siempre corre la rama definitiva — nunca lee `preview` de la query, así
    que no existe ningún camino por CSV que evite el gate.
```

`finnegansExportController.noveltiesJson` decide entre `getPreview`/
`getDefinitive` según `query.preview`; `noveltiesCsv` llama directo a
`getDefinitive`. `finnegansExportService.getPreview` y `.getDefinitive`
comparten `buildDataset()` (candidatas + readiness) — la única diferencia es
que `getDefinitive` revisa `readiness.ready` y, si es falso, tira `409` en
vez de devolver filas; y que sólo `getDefinitive` llama a
`auditService.register(...)`.

Respuesta (ambos): `{ data: { period, rows, readiness } }`. `readiness`:

```ts
{ ready: boolean, totalRows: number, readyRows: number, blockedRows: number, reasons: string[] }
```

`reasons` son frases humanas ya armadas en el backend
(`finnegansExport.readiness.ts::buildReadinessSummary`), sin ningún id
técnico — ejemplo: `"2 novedades sin cantidad de días"`,
`"1 persona con cierre mensual pendiente"`. `CLOSURE_NOT_APPROVED` cuenta
personas distintas; el resto cuenta filas (novedades).

## 12. Query — `from`/`to`/`includePending` retirados

`finnegansExport.schemas.ts`: `period` pasa a ser obligatorio (antes,
`period` o `from`+`to`); `from`/`to` se eliminaron (sin ningún caller real,
confirmado por grep — sólo `finnegansExportApiService.ts` llama a este
endpoint, y sólo con `period`). `includePending` también se eliminó: dejaba
entrar `PENDIENTE`/`EN_REVISION` como si fueran exportables, lo que
contradice la regla de selección de esta etapa (§3 del pedido: sólo
`APROBADO`, sin excepción). `preview` lo reemplaza con un significado
distinto (§11) — no cambia qué novedades son candidatas, sólo si se exige
cierre y si se audita.

## 13. Gate de cierre mensual

`shared/monthlyClosure/closureLock.ts` (Etapa 15E.2) ya expone
`isMonthlyClosureApproved`/`findUnapprovedEmployeeIdsForExport` como
**política** reutilizable. `finnegansExport.service.ts` reutiliza
`isMonthlyClosureApproved` (misma definición de "aprobado" que
`time-entries/export`); `finnegansExport.repository.ts::findClosuresForExport`
reimplementa la consulta trivial a `MonthlyTimeClosure` (mismo patrón que
`timeEntriesRepository.findClosuresForExport`, sin importarla desde
`time-entries` — se comparte la política de qué estado cuenta como
"aprobado", no el flujo del exportador de horas, tal como pedía
explícitamente el punto 21 del pedido de esta etapa).

- **Empleados evaluados**: sólo los que tienen al menos una novedad
  candidata en el resultado base (antes de aplicar readiness de datos) —
  nunca toda la nómina. Un empleado con 0 novedades candidatas en el
  período no dispara ninguna consulta de cierre y nunca bloquea nada
  (confirmado con test: "empleado con cierre pendiente pero SIN novedad
  exportable no bloquea").
- **Sin ninguna fila candidata**: `getDefinitive` ni siquiera consulta
  `MonthlyTimeClosure` (`employeeIds.length === 0` corta antes) y devuelve
  `readiness.ready = true` con `rows: []` — no hace falta proteger nada.
- **Multi-empleado**: si un solo empleado incluido no tiene cierre
  `APROBADO`, se bloquea el export **completo** — nunca una exportación
  parcial (mismo criterio que 15E.2, confirmado con test).
- **Preview**: consulta los mismos cierres (para poder informarlos como
  blocker) pero nunca los exige — un cierre `ABIERTO`/inexistente no impide
  ver la pantalla.

## 14. Errores 409

- `FINNEGANS_EXPORT_NOT_READY` — alguna fila tiene un blocker de datos
  (vínculo, unidad, cantidad o vigencia), sin importar el estado de los
  cierres. Mensaje: *"Hay novedades que necesitan completar su
  configuración antes de exportar."*
- `FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED` — todos los datos están listos,
  pero algún cierre mensual no está `APROBADO`. Mensaje: *"El período tiene
  cierres pendientes para personas incluidas en la exportación."*

**Precedencia, cuando coexisten ambos tipos de blocker**: `getDefinitive`
siempre reporta `FINNEGANS_EXPORT_NOT_READY` primero
(`finnegansExport.service.ts::getDefinitive`, ver test "cuando hay blocker
de datos Y de cierre a la vez, prioriza FINNEGANS_EXPORT_NOT_READY") —
corregir la configuración de una novedad no depende de que además se
apruebe un cierre, así que no tenía sentido devolver el código de cierre
cuando el problema real es de datos. Ninguno de los dos mensajes incluye
UUIDs ni ids técnicos.

## 15. Auditoría

`getPreview` **nunca** llama a `auditService.register` (antes, el propio GET
JSON auditaba en cada carga de pantalla — corregido). `getDefinitive` audita
sólo si `readiness.ready === true`, después de decidir autorizar el
resultado (`AuditLog`, `action: EXPORT`, `entity: FinnegansExport`,
`after: { period, totalRows }`). Como el `.xlsx` todavía se genera después,
en el frontend, este evento significa **"backend autorizó/generó el dataset
definitivo"**, no "se generó el archivo" — no hay ninguna garantía de que el
navegador haya terminado de escribir el `.xlsx` en el momento en que se
audita. No se implementó ningún historial formal de batches/idempotencia
(eso es 15L.4, fuera de alcance).

## 16. CSV / XLSX

CSV (`GET /novelties.csv`) llama siempre a `getDefinitive` — mismo gate,
misma auditoría, sin ningún camino paralelo. XLSX se sigue generando en el
frontend (`FinnegansExportPage.tsx::exportFinnegansExcel`), pero ahora se
llama **sólo** con el resultado de `finnegansExportApiService.getDefinitive()`
— nunca con las filas de preview ni con el subconjunto filtrado por
búsqueda en pantalla. El click en "Exportar Excel" siempre vuelve a pedirle
al backend el resultado definitivo antes de tocar la librería `xlsx`; un
`409` nunca genera archivo.

**Columnas**: sin cambios de nombre ni de orden (§27 del pedido). Se auditó
la discrepancia entre el backend (`"Fecha Aplicación"`, con acento, en JSON
y CSV desde siempre) y el array de encabezados hardcodeado del XLSX en
`FinnegansExportPage.tsx` (`"Fecha Aplicacion"`, sin acento) — **se decide
NO tocarlo**: no hay evidencia de qué encabezado exacto espera el importador
real de Finnegans, y el pedido de esta etapa (§27) exige no arriesgar
compatibilidad sin esa evidencia. Queda documentado como inconsistencia
conocida, no como bug a resolver acá.

**Legajo**: sigue `legajoFinnegans || legajo`, siempre como `string` —
confirmado con test que preserva ceros a la izquierda (`"00042"` no se
convierte a `42`).

## 17. UX — readiness

`FinnegansExportPage.tsx`:

- Al entrar o cambiar de período: llama a `getPreview(period)` (con
  `preview=true`), muestra `rows` + un banner de estado
  (`✓ Listo para exportar` / `⚠ Exportación pendiente de completar` +
  lista de motivos humanos, o un aviso neutro si no hay filas). Nunca
  exporta con estas filas.
- Tabla de preview: agrega una columna **Estado** (`Listo`/`Falta
  cantidad`/`Falta configuración`/`Cierre pendiente`, un `Badge` por fila) —
  visible sólo en pantalla, nunca en el `.xlsx`/CSV.
- Botón "Exportar Excel Finnegans": deshabilitado visualmente si
  `readiness.ready === false` o si no hay filas — pero la autoridad real
  sigue siendo el backend (`getDefinitive` revalida todo igual). Al hacer
  click: estado de carga (`"Generando..."`), vuelve a pedir
  `getDefinitive(period)` (sin `preview=true`); si responde OK, genera el
  `.xlsx`; si responde `409`, no genera nada y muestra el mensaje humano
  correspondiente cerca del botón (mismo patrón ya usado en
  `HoursPage.tsx` para `MONTHLY_CLOSURE_NOT_APPROVED`, Etapa 15E.2).
- No se muestran `employeeId`/`noveltyId`/UUIDs en ningún texto visible.

CSS: se agregaron dos variantes de `.info-note` (`.readiness-ready`/
`.readiness-blocked`, `frontend/src/styles.css`), mismo patrón ya usado para
`.info-note.special-hour` (Etapa 11B) — ninguna clase nueva desde cero.

## 18. Tests agregados

Backend (60 tests nuevos, `backend/src/modules/finnegans-export/`, módulo
sin ningún test antes de esta etapa):

- `finnegansExport.principalLink.test.ts` (5): sin vínculos, único vínculo,
  menor `priority`, empate estable por `code`, nunca más de un resultado.
- `finnegansExport.readiness.test.ts` (18): las 3 unidades (HOURS/DAYS/UNIT)
  con/sin cantidad correcta e incorrecta, `finnegansValueUnit=null`,
  vigencia requerida con/sin `toDate`, vínculo faltante, cierre no
  aprobado, precedencia de `estado` cuando hay múltiples blockers, y
  `buildReadinessSummary` (vacío, todo listo, conteo por persona vs. por
  fila, singular/plural, orden estable de motivos).
- `finnegansExport.repository.test.ts` (5): WHERE exacto (sin exigir
  vínculo activo), `employeeId` opcional, sólo trae vínculos `ACTIVO`,
  `findClosuresForExport` (vacío no consulta, filtra por `employeeId in`/
  `period`).
- `finnegansExport.service.test.ts` (30): selección/Valor 1/vigencia/
  Legajo/Centro de costo/Fecha Aplicación (definitivo), preview (no exige
  cierre, no audita, informa cierre pendiente sin tirar error), gate de
  cierre (1 empleado aprobado, sin cierre, los 4 estados no-aprobado,
  multi-empleado con uno pendiente bloquea todo, empleado sin novedad
  exportable no bloquea, sin filas no consulta cierres, precedencia de
  errores), `toCsv` nunca incluye `estado`.

Frontend (`FinnegansExportPage.test.tsx`, reescrito, 16 tests): preview usa
`preview=true`, preview no dispara descarga, refresh silencioso al cambiar
de período (Etapa 9G, preservado), empty state, Estado por fila, motivos
humanos sin UUIDs, botón deshabilitado/habilitado según `readiness.ready`,
click reconsulta el endpoint definitivo (sin `preview=true`), éxito genera
`.xlsx`, ambos códigos `409` no generan archivo y muestran el mensaje,
estado de carga ("Generando...").

## 19. Deuda pendiente — explícita

- **Cross-month** (§3 de este documento): ~~sin resolver. 15L.3B decide.~~
  **Resuelto en la Etapa 15L.3B.1** — la pertenencia mensual depende
  exclusivamente de `fromDate` (`docs/decisions/FINNEGANS_EXPORT_MONTHLY_OWNERSHIP_15L3B.md`).
- **Open-ended** (`toDate = null`): ~~sin resolver, misma nota que
  cross-month. 15L.3B decide.~~ **Resuelto en la Etapa 15L.3B.1**, misma
  corrección que cross-month.
- **Historial/idempotencia de exportaciones**: no implementado — el evento
  de auditoría de esta etapa no es un batch formal. 15L.4.
- **Relación 1:1 física con Finnegans**: `FinnegansNoveltyLink` sigue siendo
  1:N; no se tocó el schema. El helper de vínculo principal (§6) es la
  preparación funcional para cuando se decida migrar, no la migración en sí.
- **Columnas legacy** (`hasValidity`, `blocksTimeEntry`,
  `setsWorkedHoursToZero`, `timeImpact`, `allowsDateTo`, `origin`,
  `FinnegansNoveltyLink.hasValidity`): siguen físicamente en el schema,
  sincronizadas por `noveltyTypes.sync.ts` (15L.2A) — el exportador nuevo ya
  no las lee, pero no se eliminan todavía (criterio de fase de eliminación:
  `docs/decisions/NOVELTY_TYPE_CONSUMER_MIGRATION_15L2C.md` §20).

## 20. Qué NO se tocó

`TimeEntry`, horas reales, fichador, `MonthlyTimeClosure` (schema — sólo se
lee, no se escribe), Conceptos Horarios/Horas Especiales,
`FinnegansNoveltyLink` (modelo, sigue 1:N), columnas legacy de `NoveltyType`
(siguen existiendo, sincronizadas), `noveltyTypes.service.ts`/`.sync.ts`
(sin cambios). No se creó ninguna migración de Prisma — no hizo falta,
ningún campo nuevo. No se hizo commit. No se hizo push.

## 21. Validaciones ejecutadas

```txt
Backend:
npx prisma validate    → OK
npx prisma generate    → OK
npm run typecheck       → OK
npm test (vitest run)   → 111 archivos / 1689 tests OK (1629 previos + 60 nuevos)
npm run build            → OK

Frontend:
npx tsc -p tsconfig.app.json --noEmit → OK
npx tsc -p tsconfig.e2e.json --noEmit → OK
npx tsc -b                             → OK
npm test (vitest run)                  → 91 archivos / 923 tests OK (910 previos + 13 nuevos)
npm run build                           → OK

General:
git diff --check → sin errores
```
