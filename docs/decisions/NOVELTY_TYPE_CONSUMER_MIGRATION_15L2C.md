# Etapa 15L.2C — Migración de consumidores al modelo normalizado de Tipos de Novedad

## 1. Objetivo

Hacer que el código productivo lea `timeEntryBehavior`/`allowsDateRange`/
`finnegansRequiresValidity` en vez de los 3 campos horarios legacy
(`blocksTimeEntry`/`setsWorkedHoursToZero`/`timeImpact`) y de
`allowsDateTo`/`hasValidity`, sin eliminar ninguna columna, sin tocar el
exportador Finnegans y sin cambiar ninguna regla de negocio nueva.

## 2. Inventario de consumidores legacy (antes de modificar)

Clasificación: **A** productivo (decide algo real) · **B**
compatibilidad/sync · **C** test legacy · **D** frontend residual
(display, sin decisión) · **E** exportación Finnegans · **F** docs.

| Campo | A. Productivo (antes de esta etapa) | E. Finnegans | D. Residual |
| --- | --- | --- | --- |
| `blocksTimeEntry` | `timeEntries.repository.ts::findBlockingNovelty` (OR) | no | badges/DTO |
| `setsWorkedHoursToZero` | mismo `findBlockingNovelty` (ya sin efecto de escritura desde 15G.1) | no | DTO |
| `timeImpact` | mismo `findBlockingNovelty` (rama `BLOQUEA_CARGA_DIA`) + `NoveltyModal.tsx`/`EmployeeHoursPage.tsx` (rama `REGISTRA_HORAS_NO_TRABAJADAS`, sin equivalente) + `NoveltyTable.tsx` (label informativo) | no | — |
| `allowsDateTo` | `novelties.service.ts` (2 validaciones), `novelties.dateRange.ts::noveltyCoversDay`, `attendanceInactivity.service.ts` (where), `NoveltyModal.tsx`/`EmployeeHoursPage.tsx` (4 lecturas) | no | — |
| `hasValidity` | `novelties.service.ts` (1 validación), `NoveltyModal.tsx`/`EmployeeHoursPage.tsx` (1 lectura c/u) | **sí** — `finnegansExport.service.ts::toExportRow` | — |
| `origin` | **ninguno** (confirmado por grep exhaustivo, ya era así antes de esta etapa) | no | `NoveltyTable.tsx` badge (display, no decisión) |

Cada uno de estos, además, aparece en B (sync)/C (tests)/F (docs) — no se
repite en la tabla por brevedad.

## 3-4-5. `blocksTimeEntry` / `setsWorkedHoursToZero` / `timeImpact` — migrados

Único consumidor productivo real de los 3: `findBlockingNovelty`
(`backend/src/modules/time-entries/timeEntries.repository.ts`). Migrado
de:
```ts
noveltyType: {
  OR: [
    { blocksTimeEntry: true },
    { setsWorkedHoursToZero: true },
    { timeImpact: "BLOQUEA_CARGA_DIA" },
  ],
},
```
a:
```ts
noveltyType: { timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" },
```
`status: "APROBADO"` (ya existía) y el rango de fechas (`fromDate`/`toDate`
OR) no se tocaron. Una novedad `PENDIENTE`/`RECHAZADA` sigue sin bloquear
porque el filtro de `status` es independiente y no cambió.

**Excepción documentada, no migrada**: `NoveltyModal.tsx::requiresTargetHour`,
`EmployeeHoursPage.tsx::conceptNovelties` (rama de "aplica sobre Hora
normal") y `NoveltyTable.tsx` (label `noveltyTimeImpactLabel`) siguen
leyendo `timeImpact === "REGISTRA_HORAS_NO_TRABAJADAS"` — este valor **no
tiene equivalente** en el enum nuevo de 2 valores
(`NO_BLOQUEA`/`BLOQUEA_NUEVA_CARGA`); migrarlo perdería la distinción real
que hoy separa "Llegada tarde" (registra horas no trabajadas, no bloquea)
de un `NO_AFECTA_HORAS` genérico. No se inventó un tercer valor para el
enum nuevo (fuera de alcance de esta etapa) — queda documentado como el
único caso legítimamente tolerado.

## 6. Tests de bloqueo

`timeEntries.repository.test.ts` (nuevo describe): confirma que el `where`
enviado a Prisma para `noveltyType` es exactamente
`{ timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" }`, sin ningún campo legacy —
por diseño, esto ya prueba la regresión pedida (un tipo con legacy
contradictorio no puede influir en la consulta, porque la consulta ya no
los referencia). El filtro `status: "APROBADO"` (que excluye
PENDIENTE/RECHAZADO) ya tenía test propio desde la Etapa 15G.1, sin
cambios. `EmployeeHoursPage.test.tsx` (nuevo describe, sin cobertura
previa de `isBlocked`/`conceptNovelties` antes de esta etapa): dos tests
end-to-end con fixtures de `Novelty` explícitamente contradictorias
(`timeEntryBehavior=BLOQUEA_NUEVA_CARGA` + legacy todo en `false`/`NO_AFECTA_HORAS`
→ bloquea; `timeEntryBehavior=NO_BLOQUEA` + legacy todo en `true`/`BLOQUEA_CARGA_DIA`
→ no bloquea) — confirman que el consumidor frontend también migró de
verdad, no sólo por casualidad de fixtures.

## 7-8. `allowsDateTo` → `allowsDateRange`

Migrados: `novelties.service.ts::ensureNoveltyTypeReady` (rechazo de
`toDate` no permitido, exigencia de vigencia) y `::normalizeCreateInput`;
`novelties.dateRange.ts::noveltyCoversDay` (firma cambiada a
`{ allowsDateRange: boolean }`, único caller
`timeEntries.repository.ts` actualizado junto con su `select`);
`attendanceInactivity.service.ts` (mismo criterio, expresado como filtro
Prisma); `NoveltyModal.tsx` (3 lecturas) y `EmployeeHoursPage.tsx` (4
lecturas). `allowsDateTo` sigue existiendo en el modelo, sincronizada 1:1
por `noveltyTypes.sync.ts` desde la Etapa 15L.2A — ningún código
productivo nuevo la vuelve a leer.

## 9. Validación de fecha hasta

Comportamiento preservado exactamente: `allowsDateRange=false` rechaza un
`toDate` distinto de `fromDate` (`NOVELTY_TO_DATE_NOT_ALLOWED`);
`allowsDateRange=true` permite el rango. Tests nuevos en
`novelties.service.test.ts` confirman ambos casos con legacy
contradictorio (`allowsDateTo=true` + `allowsDateRange=false` → rechaza;
`allowsDateTo=false` + `allowsDateRange=true` → permite) — prueba directa
de que sólo el campo nuevo decide.

## 10. `hasValidity` → `finnegansRequiresValidity`

**Uso fuera del exportador** (migrado): `novelties.service.ts::ensureNoveltyTypeReady`
(`type.hasValidity && type.allowsDateTo && !input.toDate` →
`type.finnegansRequiresValidity && type.allowsDateRange && !input.toDate`);
`NoveltyModal.tsx`/`EmployeeHoursPage.tsx` (1 lectura c/u, misma
migración). Test nuevo en `novelties.service.test.ts` con
`hasValidity`/`allowsDateTo` legacy explícitos junto a los nuevos, para
dejar constancia de que la fuente real es la nueva.

**Uso dentro del exportador** (NO tocado, explícitamente fuera de
alcance): `finnegans-export/finnegansExport.service.ts::toExportRow` —
`item.noveltyType.hasValidity || link?.hasValidity` sigue igual.
`FinnegansNoveltyLink.hasValidity` tampoco se tocó.

**Observación de diseño (no una acción de esta etapa)**: usar un campo
llamado `finnegansRequiresValidity` para una validación que hoy es
puramente operativa (exigir `toDate` al crear la novedad, sin relación
con si se exporta o no) es un residuo de nomenclatura heredado de 15L.2A
— el nombre sugiere "requerido para Finnegans" pero la validación migrada
aplica siempre, exporte o no el tipo. Se migró así porque la Etapa
15L.2C lo pide explícitamente (punto 9 del pedido) y porque hoy son
numéricamente el mismo valor (sincronizados 1:1) — se documenta como
candidato a renombrar en una etapa futura si la distinción
operativa/exportación se vuelve relevante en la práctica.

## 11. `origin`

Confirmado por grep exhaustivo (antes y después de esta etapa): **cero
consumidores productivos** — ninguna rama de código decide algo distinto
según `INTERNA`/`FINNEGANS`/`MIXTA`. Los únicos usos que quedan son: el
filtro de listado en `noveltyTypes.repository.ts` (inalcanzable desde el
frontend, ya documentado desde la Etapa 14H.8), el DTO/mapper, y el badge
de sólo lectura en `NoveltyTable.tsx` (pantalla operativa de Novedades,
no de Tipos). No se cambió el schema. El badge de `NoveltyTable.tsx` no
es una decisión de negocio (no bifurca ningún comportamiento) — se deja
documentado como candidato de limpieza de UX para una etapa dedicada al
rediseño de esa pantalla (fuera de alcance de una migración de
consumidores).

## 12. `allowsHours`/`finnegansValueUnit`

Sin cambios de código en esta etapa (ya desacoplados desde 15L.2B.1) —
confirmado por grep dirigido: no aparece ninguna lectura cruzada nueva.
`assertQuantityCoherence`/`resolveNoveltyQuantities` no se tocaron.

## 13. Datos legacy existentes

No se ejecutó ningún `UPDATE` masivo. Se corrió una lectura read-only
sobre la base real (Neon): **1 fila total** (`NOV-LLEGADA-TARDE`, la
única del seed), **0 inconsistencias** entre `timeEntryBehavior` y el OR
legacy, entre `allowsDateRange`/`allowsDateTo`, ni entre
`finnegansRequiresValidity`/`hasValidity`. El backfill de 15L.2A sigue
siendo válido; no hizo falta ninguna corrección.

## 14. `requiresApproval`

Sin cambios — ya migrado y con efecto real desde la Etapa 15L.2A
(`noveltiesService.create`). Confirmado sin regresión (suite completa en
verde, sin tocar ese archivo en esta etapa salvo la migración de
`allowsDateTo`/`hasValidity` descripta arriba).

## 15. Historial

`NoveltyTypeHistoryTab.tsx` estaba completamente huérfano (cero imports,
cero tests, ya sin uso desde que 15L.2B quitó la pestaña "Historial" del
detalle) — **eliminado** en esta etapa. `NoveltyTypeHistoryRecord`/
`history` (el tipo y el campo en `NoveltyType`) se mantienen: siguen
siendo parte legítima del contrato (poblados como `[]` por el mapper,
candidatos a conectarse a `AuditLog` en una etapa futura) — no son código
muerto de la misma manera que el componente sin importar.

## 16. Tipos/DTOs marcados

`frontend/src/types/noveltyType.types.ts::NoveltyTypeRules` — JSDoc
`@deprecated` en `allowsDateTo`/`hasValidity`/`blocksTimeEntry`/
`setsWorkedHoursToZero`/`timeImpact`, y en `NoveltyType.origin`. Los
campos nuevos (`timeEntryBehavior`/`allowsDateRange`/
`finnegansValueUnit`/`finnegansRequiresValidity`) quedan sin marca,
confirmando que son los preferidos. `backend/prisma/schema.prisma` ya
tenía las mismas marcas desde la Etapa 15L.2A (sin cambios en esta
etapa). Contrato de API sin cambios rotos — sólo aditivo (`novelties.repository.ts::noveltyInclude`
ahora también selecciona los 3 campos nuevos para el DTO de `Novelty`).

## 17. Archivos modificados

Backend: `time-entries/timeEntries.repository.ts` (+test),
`time-entries/attendanceInactivity.service.ts` (+test),
`novelties/novelties.dateRange.ts` (+test), `novelties/novelties.service.ts`
(+test), `novelties/novelties.repository.ts`.

Frontend: `types/index.ts`, `types/noveltyType.types.ts`,
`services/api/noveltyApiService.ts`, `pages/EmployeeHoursPage.tsx` (+test),
`components/novelties/NoveltyModal.tsx`, `components/novelties/NoveltyTable.tsx`.
Eliminado: `components/novelty-types/NoveltyTypeHistoryTab.tsx` (huérfano).

## 18. Qué queda legacy (sin tocar, deliberado)

`blocksTimeEntry`, `setsWorkedHoursToZero`, `timeImpact` (salvo el valor
`REGISTRA_HORAS_NO_TRABAJADAS`, sin equivalente), `allowsDateTo`,
`hasValidity` (dentro de `finnegans-export` y en `FinnegansNoveltyLink`),
`origin` — todos siguen existiendo como columnas de Prisma, siguen
sincronizados 1:1 por `noveltyTypes.sync.ts`, y siguen expuestos en los
DTOs por compatibilidad. `FinnegansNoveltyLink` sigue siendo 1:N.
`finnegans-export/*` no se tocó en absoluto.

## 19. Riesgos

- El nombre `finnegansRequiresValidity` usado ahora para una validación
  puramente operativa (§10) es un residuo de nomenclatura — riesgo bajo
  (mismo valor sincronizado hoy), documentado para 15L.3.
- `timeImpact=REGISTRA_HORAS_NO_TRABAJADAS` queda como el único valor
  legacy con lectura productiva real y sin plan de migración concreto —
  si el negocio necesita representarlo en el modelo nuevo, hace falta
  decidir un 3er valor de `timeEntryBehavior` o un campo separado, fuera
  de alcance de esta etapa.
- `NoveltyTable.tsx` sigue mostrando `origin` sin ninguna decisión real
  detrás — candidato de limpieza UX, no un riesgo funcional.

## 20. Criterio de fase de eliminación (para 15L.3+)

Antes de borrar cualquier columna legacy del schema, deben cumplirse:
(a) el exportador Finnegans migrado a `finnegansRequiresValidity`/
`finnegansValueUnit` (Fase B pendiente, ver `NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md` §5);
(b) `FinnegansNoveltyLink` resuelto a 1:1 o confirmado que sigue haciendo
falta 1:N con evidencia real; (c) `timeImpact=REGISTRA_HORAS_NO_TRABAJADAS`
con una decisión tomada (nuevo valor de `timeEntryBehavior` o aceptado
como deuda permanente); (d) cero resultados en un grep de los campos
legacy fuera de `noveltyTypes.sync.ts`/tests/docs. Sólo entonces
correspondería una migración de Prisma que los retire (Fase C).

## 21. Validaciones ejecutadas

```txt
Backend:
npx prisma validate   → OK
npx prisma generate   → OK
npm run typecheck      → OK
npm test (vitest run)  → 107 archivos / 1629 tests OK
npm run build           → OK

Frontend:
npx tsc -p tsconfig.app.json --noEmit → OK
npx tsc -p tsconfig.e2e.json --noEmit → OK
npx tsc -b                             → OK
npm test (vitest run)                  → 91 archivos / 910 tests OK
npm run build                           → OK

General:
git diff --check → sin errores
```

Sin migración de Prisma (no hizo falta — ningún campo cambió de tipo ni
se agregó ninguno). No se hizo commit. No se hizo push.
