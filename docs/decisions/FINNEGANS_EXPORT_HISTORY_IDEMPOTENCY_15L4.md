# Etapa 15L.4 — Historial, versionado e idempotencia de exportaciones Finnegans

## 1. Motivo

15L.3A/15L.3B.1 dejaron la exportación Finnegans normalizada, con gate de
cierre mensual y con selección mensual única por `fromDate`, pero sin
ninguna evidencia persistente de que una exportación definitiva haya
ocurrido — cada `POST`/`GET` definitivo sólo dejaba un `AuditLog` genérico
(`action: EXPORT`), sin snapshot de lo exportado, sin versión, sin forma de
saber si una reexportación cambió algo. Esta etapa agrega esa trazabilidad
real, sin tocar selección mensual, Valor 1, vigencia ni cierres.

## 2. Modelo — por qué NO `Novelty.exportedAt`

Un campo `exportedAt` en `Novelty` es insuficiente: una novedad puede
exportarse más de una vez (reexportación), puede borrarse y recrearse (hard
delete existente, sin tocar en esta etapa), y no hay forma de saber *qué*
datos exactos salieron en cada exportación si algo cambia después. Se
implementó en cambio un modelo de **batch + items snapshot**:

```prisma
model FinnegansExportBatch {
  id, period, version, format, hash, rowCount, reason?, idempotencyKey,
  createdByUserId?, createdAt, previousBatchId?
}

model FinnegansExportBatchItem {
  id, batchId, noveltyId?, employeeId,
  legajo, employeeName, noveltyCode, detail, costCenter, value1,
  applicationDate, validFrom, validTo, createdAt
}
```

Migración: `prisma/migrations/20260916150000_add_finnegans_export_history/`
(sólo `CREATE TABLE`/`CREATE INDEX`/`CREATE TYPE`/`ADD CONSTRAINT` — cero
`ALTER`/`DROP` sobre tablas existentes, cero riesgo de pérdida de datos).
Igual que en 15L.2A: el único `DATABASE_URL` disponible en este entorno
apunta a la base Neon real compartida — la migración se generó (vía
`prisma migrate diff --from-url ... --to-schema-datamodel ... --script`,
sólo lectura de introspección, sin escribir nada) pero **no se aplicó**
(`prisma migrate dev`/`deploy`). `prisma migrate status` confirma la
migración como pendiente, sin error.

## 3. Snapshot — por qué son `String`, no `DateTime`/`Decimal`

Los 7 campos de `FinnegansExportBatchItem` (`legajo`, `noveltyCode`,
`costCenter`, `value1`, `applicationDate`, `validFrom`, `validTo`) se
guardan como **el string exacto que salió en la fila exportada** (ej.
`"05/09/2026"`, no un `Date`) — la misma representación que ya arma
`finnegansExport.service.ts::buildRow`. Esto evita cualquier riesgo de que
una reformulación futura de `formatDate`/`resolveValue1` cambie
retroactivamente cómo se lee un snapshot histórico: el snapshot es texto
congelado, no un dato para recalcular. `employeeName`/`detail` se agregan
además de las 7 columnas oficiales — no son parte del archivo exportado,
son ayuda de lectura para RRHH en el historial (para no tener que
adivinar quién es cada legajo).

`noveltyId`/`employeeId` son referencias técnicas internas (§17 del
pedido: "se pueden guardar... pero NO mostrarlos al usuario final") — no
se incluyó `noveltyTypeId` (evaluado y descartado: el snapshot ya guarda
`noveltyCode`, la referencia funcionalmente relevante; un tercer FK sin
caller real hubiera sido complejidad sin necesidad).

## 4. Versionado

`version` es el correlativo por `period` (`@@unique([period, version])`,
constraint real de base, no sólo una validación de aplicación — protege
contra dos `version=2` simultáneas). Se calcula dentro de
`finnegansExportBatchRepository::createBatchWithItems`:
`MAX(version) + 1` para el período, dentro de un intento con reintento
ante colisión (hasta 5 intentos) — mismo patrón que
`noveltyTypesRepository::generateNextCode` (Etapa 15L.2A): si dos
exportaciones casi simultáneas compiten por la misma versión, la segunda
recibe `P2002`, recalcula `MAX(version)+1` (ya avanzado por la primera) y
reintenta. Batch + items se crean en una única transacción
(`prisma.$transaction`) — todo o nada.

## 5. Reexportación — explícita, nunca bloqueada para siempre

No existe ninguna regla "el período ya fue exportado, no se puede volver a
exportar". Cualquier período puede reexportarse indefinidamente — la única
exigencia es que sea **explícito**: `finnegansExportBatchRepository::hasAnyBatch(period)`
decide si la exportación en curso es la primera (`reason` opcional) o una
reexportación (`reason` **obligatorio**, exigido por el backend en
`finnegansExport.service.ts::assertReexportReason`, no sólo por el
frontend). El schema (`finnegansExportRequestSchema`) ya exige mínimo 5
caracteres *si* `reexportReason` viene presente; el backend decide *si*
tiene que venir.

## 6. `previousBatchId`

Se resuelve en el mismo cálculo que la versión: el batch con
`version = actual - 1` para ese período, si existe. `v1 → previousBatchId
null`; `v2 → id de v1`; `v3 → id de v2`. Permite navegar el historial y es
la base de `diffBatchItems` (§9).

## 7. Hash — determinismo

`finnegansExport.hash.ts::computeExportHash`: SHA-256 sobre la
representación canónica de las 7 columnas exportadas (nunca ids, nunca
`employeeName`/`detail`) de cada fila, **ordenadas antes de unir** — mismo
contenido en distinto orden de filas da el mismo hash; cualquier cambio
real en algún campo da un hash distinto. Se calcula tanto en preview
(sobre las filas candidatas actuales, listas o no) como en definitivo
(sobre las filas ya validadas) — la MISMA función en los dos casos, así
que son comparables entre sí.

## 8. Comparación de versiones — diff mínimo

`finnegansExport.diff.ts::diffBatchItems(previous, current)`: sólo
conteos (`added`/`removed`/`modified`), sin diff celda por celda (fuera de
alcance explícito). Key de emparejamiento: `noveltyId` cuando está
presente en ambos lados; si no, `legajo+noveltyCode+applicationDate`. Este
fallback es lo que resuelve el caso de **novedad borrada y recreada**
(§16 del pedido): si `v1` exportó una novedad y luego RRHH la borra
(hard delete existente, `onDelete: SetNull` en
`FinnegansExportBatchItem.novelty`) y crea una corregida, el item viejo
de `v1` queda con `noveltyId = null` — al comparar contra `v2` (que sí
trae un `noveltyId` nuevo), el emparejamiento cae al fallback por
snapshot y, si `legajo+noveltyCode+applicationDate` coinciden, se muestra
como **una fila modificada** (no como "una eliminada + una agregada sin
relación") — la fila vieja nunca se pierde porque el snapshot nunca
depende de que la `Novelty` original siga existiendo.

`getHistory` calcula el diff de **cada versión contra su anterior
inmediata** en una sola consulta (`findManyForPeriodWithItems`, con
`items` de todas las versiones del período a la vez) — evita N+1 queries
para un historial con varias reexportaciones.

## 9. Idempotencia técnica

`idempotencyKey` (UUID, generado por el frontend con
`crypto.randomUUID()` una vez por click de "Exportar"/"Reexportar",
`@unique` en la base): si llega una key ya usada,
`finnegansExportService::exportDefinitive` la busca primero
(`findByIdempotencyKey`) y, si existe, **reconstruye la misma respuesta
desde el snapshot ya persistido** — sin revalidar readiness/cierre, sin
crear una versión nueva, sin volver a auditar. Esto es explícitamente
distinto de una reexportación voluntaria, que siempre manda una key
nueva. Una colisión real de concurrencia (dos requests con la misma key
llegando casi a la vez, ambas pasando el chequeo proactivo antes de que
cualquiera termine) queda cubierta por la constraint `@unique` de la base:
la segunda transacción falla con `P2002` sobre `idempotencyKey` y el
repositorio responde devolviendo el batch que la primera ya creó, en vez
de propagar el error.

## 10. Doble click

Frontend: el botón usa `useAsyncAction` (mismo hook ya usado en
`AttendancePage.tsx`/`ShiftAlertsPage.tsx`) — bloquea sincrónicamente un
segundo click mientras el primero sigue en vuelo, antes incluso de que
React vuelva a renderizar el botón deshabilitado. La combinación con
`idempotencyKey` cubre tanto el caso frontend (click doble bloqueado acá)
como el caso backend (si por lo que sea la request igual se duplicó).

## 11. Formato (`XLSX`/`CSV`)

`FinnegansExportFormat` (enum Prisma nuevo) se guarda en el batch, puramente
informativo — no cambia selección, Valor 1 ni ninguna regla. El endpoint
único (`POST /novelties/export`) recibe `format` en el body; XLSX se sigue
generando en el frontend (sin cambios en esa lógica) a partir de las
`rows` que devuelve la respuesta. `format: "CSV"` queda soportado
end-to-end en el backend (validado, persistido, recuperable en historial)
aunque en esta etapa no se agregó un botón "Exportar CSV" nuevo en la UI —
no había pedido explícito de una pantalla nueva y el endpoint anterior
`.novelties.csv` no tenía ningún caller real (confirmado por grep en
15L.3A). `finnegansExport.service.ts::toCsv` se mantiene (no se eliminó):
sigue siendo la función que armaría el archivo CSV si en el futuro se
agrega esa vía, sin tener que rediseñar el formato/escaping desde cero.

## 12. Endpoints — contrato nuevo

```txt
GET  /finnegans-export/novelties?period=YYYY-MM&preview=true
  → preview (sin cambios de comportamiento respecto a 15L.3A/15L.3B.1);
    ahora también trae `hash` y `lastExport` (resumen de la última
    exportación definitiva del período, con `sameAsCurrent` ya resuelto).
    NO exige cierre, NO audita, NO crea batch.

POST /finnegans-export/novelties/export
  body: { period, employeeId?, format: "XLSX"|"CSV", reexportReason?, idempotencyKey }
  → operación definitiva. Reemplaza el GET sin `preview` y a
    `.novelties.csv` (retirados — sin caller real, confirmado por grep;
    ninguna URL vieja quedó funcionando en paralelo). Revalida todo,
    exige motivo en toda reexportación, exige readiness + cierre
    aprobado (sin cambios de esas reglas), y sólo si autoriza crea el
    batch + AuditLog.

GET  /finnegans-export/history?period=YYYY-MM
  → listado de batches del período, más nueva primero, con el diff de
    cada versión contra la anterior.

GET  /finnegans-export/history/:batchId
  → detalle de un batch: metadata + snapshot de filas + diff contra el
    anterior.
```

Los cuatro exigen el mismo rol (RRHH) que ya exigía el módulo — sin
ampliar acceso (§35 del pedido).

## 13. Readiness y cierre — sin cambios de regla

Una reexportación revalida exactamente lo mismo que una primera
exportación: readiness actual (vínculo/unidad/cantidad/vigencia) y cierre
mensual `APROBADO` de cada empleado incluido. Que `v1` haya sido válida no
autoriza `v2` automáticamente — si algo dejó de cumplirse entre versiones,
`v2` se bloquea con el mismo `409` que ya existía (`FINNEGANS_EXPORT_NOT_READY`/
`FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED`), sin crear ningún batch. Si
coexisten un blocker de datos y de cierre, sigue ganando el de datos
(precedencia ya establecida en 15L.3A, sin cambios).

## 14. AuditLog vs. batch — ninguno sustituye al otro

`AuditLog` (`action: EXPORT`, `entity: FinnegansExport`, ahora también con
`entityId: batch.id`) sigue registrándose en cada exportación definitiva
exitosa — es el evento global de auditoría del sistema, igual que
cualquier otra acción. El batch es el **historial funcional de negocio**
(versiones, snapshot, diff, reexportación) — un concepto de dominio propio
de Finnegans, no genérico. Ninguno reemplaza al otro.

## 15. Cuándo se considera "exportado"

El backend **no genera el XLSX/CSV**. `POST /novelties/export` significa
*"el backend autorizó y dejó registrado el dataset definitivo"* — el
archivo se genera después, en el navegador (`exportFinnegansExcel`, sin
cambios). No hay ninguna garantía de que el usuario haya efectivamente
guardado el archivo en disco en el momento en que se crea el batch. Esta
distinción ya estaba documentada desde 15L.3A (§15 de ese decision doc) y
se mantiene igual — la etapa 15L.4 no agrega trazabilidad de "se descargó
de verdad", sólo de "el backend autorizó esta versión". Si se necesita esa
trazabilidad exacta en el futuro, requeriría un evento nuevo (ej. un
segundo `POST` de confirmación desde el frontend tras `XLSX.writeFile`) —
no se inventa en esta etapa.

## 16. Frontend — `FinnegansExportPage.tsx`

- **Estado del período**: el banner de readiness (15L.3A) ahora también
  informa si el período nunca fue exportado, o la versión/fecha de la
  última exportación y si el contenido actual coincide con ella
  (`sameAsCurrent`, resuelto por el backend comparando hashes) — todo
  desde la misma llamada a preview, sin ningún batch creado.
- **Botón dinámico**: "Exportar Excel Finnegans" (sin historial, exporta
  directo) vs. "Reexportar Excel Finnegans" (con historial, abre el modal
  de confirmación).
- **Modal de reexportación** (`Modal` compartido, mismo componente que
  `AttendancePage.tsx`): muestra última versión/fecha/cantidad de filas y
  si hay o no cambios; motivo obligatorio (mínimo 5 caracteres, el botón
  de confirmar queda deshabilitado hasta entonces — el backend igual lo
  revalida, el frontend es sólo ayuda visual).
- **Historial** (`Section` + `.timeline`, mismo patrón visual que
  `PuestoHistoryTab.tsx`): versión, formato, fecha, cantidad de filas,
  motivo (si hay), resumen de diff (`+N novedades · -N novedad · ~N
  modificadas`) — sin ningún UUID visible. Se recarga automáticamente
  después de una exportación exitosa.
- `idempotencyKey`: se genera con `crypto.randomUUID()` en el momento del
  click — una key nueva por cada intento de exportación real; el doble
  click queda bloqueado antes de llegar a generar una segunda key
  (`useAsyncAction`).

## 17. Qué NO se tocó

Selección mensual por `fromDate` (15L.3B.1, sin cambios), Valor 1
(`finnegansValueUnit`, sin cambios), vigencia (`finnegansRequiresValidity`,
sin cambios), política de cierre mensual (`shared/monthlyClosure/closureLock.ts`,
sin cambios), `TimeEntry`, Conceptos Horarios/Horas Especiales, fichador,
columnas legacy de `NoveltyType` (siguen existiendo, sin tocar),
`FinnegansNoveltyLink` (sigue 1:N, sin tocar salvo lo imprescindible — que
fue nada: no se tocó su schema ni su lectura).

## 18. Riesgos

- La migración generada **no fue aplicada** contra la base real (mismo
  motivo que 15L.2A) — hasta que se aplique, ningún código de esta etapa
  puede ejecutarse contra datos reales. Los tests mockean el repositorio,
  no tocan la base.
- El diff por snapshot (`legajo+noveltyCode+applicationDate`) puede, en un
  caso extremo, emparejar dos novedades genuinamente distintas si
  coinciden exactamente en esos 3 campos para el mismo período — mismo
  tipo de límite ya aceptado por el gate de duplicados de 15G.3 (que ya
  previene esa combinación exacta para novedades activas del mismo tipo).
- `format: CSV` queda soportado en el backend sin ningún botón de UI que
  lo ejercite todavía — riesgo bajo (código testeado, sin uso real hasta
  que se decida agregar la UI).
- No se verificó manualmente en navegador (esta etapa no aplicó la
  migración a una base real ni corrió el servidor con datos reales) — la
  cobertura de esta entrega es de tests automatizados (backend + frontend)
  y `build`/`typecheck`, no de una sesión interactiva real.

## 19. Tests agregados

Backend (nuevos): `finnegansExport.hash.test.ts` (6),
`finnegansExport.diff.test.ts` (8),
`finnegansExport.batch.repository.test.ts` (9, incluye colisión de
versión con reintento y colisión de `idempotencyKey`),
`finnegansExport.service.test.ts` (ampliado: versionado A/B/D, motivo
C, snapshot E, hash G/H/I a nivel de integración, idempotencia J/K,
formato O/P, historial + diff Q, detalle R, sin UUIDs S, gate de
readiness/cierre L/M sin regresión, preview nunca crea batch N).

Frontend: `FinnegansExportPage.test.tsx` reescrito — historial por
período, estado vacío, última versión, Exportar vs. Reexportar, modal +
motivo obligatorio, advertencia de mismo dataset, resumen de diff,
loading, doble click bloqueado, idempotencyKey distinta entre
exportaciones separadas, éxito genera xlsx, los tres códigos `409`/`400`
no generan archivo, historial se refresca tras exportar.

## 20. Validaciones ejecutadas

```txt
Backend:
npx prisma validate      → OK
npx prisma generate      → OK
npx prisma migrate status → 1 migración pendiente detectada (§2), 0 aplicadas por esta sesión
npm run typecheck         → OK
npm test (vitest run)     → 114 archivos / 1716 tests OK (incluye 3 archivos nuevos del módulo:
                             finnegansExport.hash.test.ts, finnegansExport.diff.test.ts,
                             finnegansExport.batch.repository.test.ts, más
                             finnegansExport.service.test.ts ampliado a 29 casos)
npm run build              → OK

Frontend:
npx tsc -p tsconfig.app.json --noEmit → OK
npx tsc -b                             → OK
npx tsc -p tsconfig.e2e.json --noEmit → OK
npm test (vitest run)                  → 91 archivos / 940 tests OK
npm run build                           → OK

General:
git diff --check → sin errores
```

No se hizo commit. No se hizo push.
