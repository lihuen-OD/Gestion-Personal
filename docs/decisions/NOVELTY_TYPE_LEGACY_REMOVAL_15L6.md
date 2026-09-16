# Etapa 15L.6 — Retiro controlado de campos legacy en Tipos de Novedad

## 1. Objetivo

Las etapas 15L.2A/B/C introdujeron un modelo nuevo de `NoveltyType`
(`timeEntryBehavior`, `allowsDateRange`, `finnegansValueUnit`,
`finnegansRequiresValidity`) manteniendo los campos legacy que reemplazaba
(`origin`, `allowsDateTo`, `hasValidity`, `blocksTimeEntry`,
`setsWorkedHoursToZero`, `timeImpact`) sincronizados por compatibilidad. Esta
etapa audita, con evidencia real, si esos campos (y la relación 1:N
`FinnegansNoveltyLink`) siguen gobernando algún comportamiento productivo y,
si no, los elimina del modelo — dejando el schema entendible sin conocer la
historia del proyecto.

## 2. Auditoría — un campo por fila

| Campo | Clasificación | Consumidor productivo real | Decisión |
| --- | --- | --- | --- |
| `NoveltyType.origin` | A/B → ninguno | Ninguno (ni backend ni frontend leían el valor para decidir nada; el filtro `listNoveltyTypesQuerySchema.origin` nunca lo usaba ningún caller real) | **Eliminado**, sin reemplazo |
| `NoveltyType.allowsDateTo` | B (legacy sincronizado) | Ninguno — `novelties.service.ts`/`novelties.dateRange.ts`/`timeEntries.repository.ts::findClosedShiftNovelties` ya leían sólo `allowsDateRange` desde 15L.2C | **Eliminado**, fuente única: `allowsDateRange` |
| `NoveltyType.hasValidity` | B (legacy sincronizado) | Ninguno — `novelties.service.ts::ensureNoveltyTypeReady` ya leía sólo `finnegansRequiresValidity` desde 15L.2C | **Eliminado**, fuente única: `finnegansRequiresValidity` |
| `NoveltyType.blocksTimeEntry` | B (legacy sincronizado) | Ninguno — `timeEntries.repository.ts::findBlockingNovelty` ya leía sólo `timeEntryBehavior` desde 15L.2C | **Eliminado**, fuente única: `timeEntryBehavior` |
| `NoveltyType.setsWorkedHoursToZero` | B, sin efecto desde 15G.1 | Ninguno (documentado como sin efecto productivo desde la Etapa 15G.1) | **Eliminado**, sin reemplazo |
| `NoveltyType.timeImpact` (enum `NoveltyTimeImpact`) | B (legacy sincronizado) + F (ver §3) | `NoveltyModal.tsx`/`EmployeeHoursPage.tsx` leían `timeImpact === "REGISTRA_HORAS_NO_TRABAJADAS"` como parte de `requiresTargetHour`/`conceptNovelties` (ver §3) | **Eliminado** (campo y enum `NoveltyTimeImpact`), branch de UI reescrita sin ese valor |
| `FinnegansNoveltyLink` (tabla 1:N) | F (activa) | `finnegansExport.repository.ts`/`.service.ts` (vínculo principal para exportar), `noveltyTypes.repository.ts` (CRUD), UI de catálogo | **Migrado a 1:1 físico** (ver §4) — no eliminado sin reemplazo, sustituido por columnas propias |
| `noveltyTypes.sync.ts` (`applyNoveltyTypeCompatibilitySync` y las 3 funciones que combina) | E (dead code tras la eliminación de arriba) | Ninguno — su única razón de ser era sincronizar los campos ya eliminados | **Eliminado** el archivo completo, junto con su test |

Ningún campo sobrevivió por tener un consumidor productivo real sin
reemplazo — todos los eliminados ya eran, en la práctica, sólo el "lado
legacy" de una sincronización 1:1 hacia el modelo nuevo (15L.2A/15L.2C ya
habían migrado toda la lectura productiva).

## 3. `timeImpact = REGISTRA_HORAS_NO_TRABAJADAS` — por qué se pudo eliminar sin inventar reemplazo

Antes de esta etapa, `NoveltyModal.tsx`/`EmployeeHoursPage.tsx` usaban
`timeImpact === "REGISTRA_HORAS_NO_TRABAJADAS"` como una condición adicional
(en `or` con `allowsHours`) para decidir `requiresTargetHour` — pedir a qué
concepto horario aplica la novedad. Auditado contra el único `NoveltyType`
real con ese valor histórico (`NOV-LLEGADA-TARDE`): tiene `allowsHours=true`.
Es decir, la condición `timeImpact === "REGISTRA_HORAS_NO_TRABAJADAS"` nunca
agregaba un caso que `allowsHours` no cubriera ya — era redundante en todos
los datos reales. Se eliminó la rama por completo (`requiresTargetHour =
Boolean(selectedType?.rules.allowsHours)`), y de la misma forma en
`EmployeeHoursPage.tsx::conceptNovelties` (se retiró el fallback `conceptName
=== "Hora normal"` que dependía de `timeImpact`, sin agregar ninguna regla
nueva en su lugar — si `targetHourConceptName` no está seteado, la novedad
simplemente no matchea ningún concepto específico, igual que cualquier otro
caso sin concepto asociado).

## 4. `FinnegansNoveltyLink` → 1:1 físico — evidencia y migración

**Instrucción explícita del pedido**: no eliminar la tabla automáticamente,
auditar con datos reales antes de decidir.

**Evidencia recolectada** (script de sólo lectura, sin escribir nada,
ejecutado contra Neon y borrado inmediatamente después):

```
NoveltyType NOV-LLEGADA-TARDE exportsToFinnegans=true linksCount=1
   link: code=LLEGADA-TARDE name=Llegada tarde exportConcept="Llegada tarde" priority=1 status=ACTIVO hasValidity=false notes=null
Total FinnegansNoveltyLink rows: 1
```

Un único `NoveltyType` real en toda la base, con un único `FinnegansNoveltyLink`
activo — nunca más de 1 vínculo por tipo. La regla de desempate existente
(`resolvePrincipalFinnegansLink`: menor `priority`, empate por `code`) nunca
se ejercita con más de un candidato en los datos reales.

**Campos del vínculo auditados uno por uno**:

| Campo de `FinnegansNoveltyLink` | ¿Necesario tras la migración? |
| --- | --- |
| `code` | Sí — es lo que exporta `finnegansExport.service.ts::buildRow` como columna "Novedad". Migra a `NoveltyType.finnegansCode`. |
| `name` | Sí — se usa como nombre visible del vínculo en la UI. Migra a `NoveltyType.finnegansName`. |
| `exportConcept` | No — auditado ya en la Etapa 15L.2B: ningún exportador real lo lee (`finnegansExport.service.ts` sólo usa `code`). Se descarta sin reemplazo. |
| `priority` | No — sólo servía para desempatar entre vínculos 1:N. Sin sentido en un modelo 1:1. Se descarta. |
| `status` (del vínculo, distinto de `NoveltyType.status`) | No — con un único vínculo por tipo, un vínculo "inactivo" no tiene sentido distinto de simplemente no tener `finnegansCode` cargado (`null`). Se descarta. |
| `hasValidity` (del vínculo, distinto de `NoveltyType.hasValidity`) | No — el exportador ya usa exclusivamente `NoveltyType.finnegansRequiresValidity` desde la Etapa 15L.3A (`finnegansExport.service.ts::buildRow`, comentario explícito: "fuente única finnegansRequiresValidity"). El campo del vínculo nunca se leía ahí. Se descarta. |
| `notes` | No — sin ningún consumidor real (ni exportador ni UI mostraban este campo del vínculo). Se descarta. |

Con evidencia de cardinalidad 1:1 real y de que sólo 2 de los 6 campos del
vínculo (`code`/`name`) tenían un consumidor real, se implementó la
simplificación física propuesta por el pedido: `NoveltyType.finnegansCode` y
`NoveltyType.finnegansName` (ambos `String?`, nullable — un tipo sin
exportación configurada no tiene ninguno de los dos), exactamente el mismo
patrón ya usado por `finnegansValueUnit`/`finnegansRequiresValidity`
(campos planos en `NoveltyType`, no una tabla aparte). La tabla
`FinnegansNoveltyLink` se eliminó por completo.

## 5. Migración de datos (antes del DROP)

`prisma/migrations/20260916160000_remove_novelty_type_legacy_fields/migration.sql`,
en este orden exacto (destructiva pero segura — nada se pierde antes de
copiarse):

1. `ALTER TABLE "NoveltyType" ADD COLUMN "finnegansCode" TEXT, ADD COLUMN "finnegansName" TEXT;`
2. `UPDATE "NoveltyType" ... FROM (SELECT DISTINCT ON ("noveltyTypeId") ... FROM "FinnegansNoveltyLink" WHERE status = 'ACTIVO' ORDER BY "noveltyTypeId", priority ASC, code ASC) AS principal WHERE nt.id = principal."noveltyTypeId";` — copia el vínculo principal de cada tipo (mismo desempate que `resolvePrincipalFinnegansLink`, ya retirado del código) antes de tocar nada más.
3. `DROP CONSTRAINT "FinnegansNoveltyLink_noveltyTypeId_fkey"`.
4. `ALTER TABLE "NoveltyType" DROP COLUMN "allowsDateTo", DROP COLUMN "blocksTimeEntry", DROP COLUMN "hasValidity", DROP COLUMN "origin", DROP COLUMN "setsWorkedHoursToZero", DROP COLUMN "timeImpact";`
5. `DROP TABLE "FinnegansNoveltyLink";`
6. `DROP TYPE "NoveltyTimeImpact";` y `DROP TYPE "NoveltyTypeOrigin";`

Generada combinando el diff automático de Prisma
(`prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`,
introspección de sólo lectura) con el paso 2 insertado manualmente en la
posición correcta. **No se aplicó** contra la base compartida de Neon —
`npx prisma migrate status` la reporta pendiente (`20260916160000_remove_novelty_type_legacy_fields`
"have not yet been applied"), siguiendo el mismo patrón conservador de las
etapas 15L.2A–15L.5 (única `DATABASE_URL` configurada, real y compartida —
no hay una base de dev/test aislada para correr `migrate dev`/`deploy`
automáticamente).

## 6. Esquema final de `NoveltyType`

```prisma
model NoveltyType {
  id                        String                   @id @default(uuid())
  code                      String                   @unique
  name                      String
  uiColor                   String
  kind                      NoveltyTypeKind
  status                    RecordStatus             @default(ACTIVO)
  description               String?
  notes                     String?
  exportsToFinnegans        Boolean                  @default(false)
  requiresApproval          Boolean                  @default(true)
  requiresDocumentation     Boolean                  @default(false)
  allowsHours               Boolean                  @default(false)
  allowsDateRange           Boolean                  @default(true)
  timeEntryBehavior         NoveltyTimeEntryBehavior @default(NO_BLOQUEA)
  finnegansValueUnit        FinnegansValueUnit?
  finnegansRequiresValidity Boolean                  @default(false)
  finnegansCode             String?
  finnegansName             String?
  allowedLoadRoles          Json                     @default("[]")
  approvalRoles             Json                     @default("[]")
  createdAt                 DateTime                 @default(now()) @db.Timestamptz(3)
  updatedAt                 DateTime                 @updatedAt @db.Timestamptz(3)

  novelties Novelty[]

  @@index([status])
}
```

Cada campo que sobrevive tiene una justificación funcional explícita:
`notes`/`requiresApproval`/`requiresDocumentation`/`allowsHours` (captura y
flujo operativo), `allowsDateRange` (única fuente de rango de fechas),
`timeEntryBehavior` (única fuente de bloqueo de carga horaria),
`finnegansValueUnit`/`finnegansRequiresValidity`/`finnegansCode`/
`finnegansName` (única configuración de exportación, ahora 1:1 físico
completo).

## 7. Backend — cambios de código

- `noveltyTypes.schemas.ts`: se retiran `noveltyTypeOriginSchema`,
  `noveltyTimeImpactSchema`, `finnegansNoveltyLinkSchema`, el filtro `origin`
  de `listNoveltyTypesQuerySchema` y los 6 campos legacy de
  `createNoveltyTypeSchema`. `allowsDateRange`/`timeEntryBehavior`/
  `finnegansRequiresValidity` pasan de `.optional()` (con sincronización
  externa) a `.default(...)` real — el propio schema es ahora la única
  fuente del valor por defecto. Se agregan `finnegansCode`/`finnegansName`
  (`string` opcional/nullable).
- `noveltyTypes.sync.ts` y su test: **eliminados** por completo (dead code,
  ver §2).
- `noveltyTypes.service.ts`: ya no importa ni llama a
  `applyNoveltyTypeCompatibilitySync` — `create()`/`update()` pasan el input
  validado directo al repositorio. `assertFinnegansConfigCoherent` ahora
  exige `finnegansCode`/`finnegansName` (en vez de `finnegansLinks.length`)
  cuando `exportsToFinnegans=true`.
- `noveltyTypes.repository.ts`: se retira `noveltyTypeInclude` (ya no hay
  relación anidada que incluir), `findMany`/`findById` quedan sin `include`,
  `create()`/`update()` son llamadas directas a Prisma sobre columnas
  escalares (ya no hace falta `$transaction` en `update()` — no hay una
  tabla relacionada que reemplazar). `buildWhere` deja de filtrar por
  `origin`; la búsqueda por texto usa `finnegansCode` en vez de
  `finnegansLinks.some`.
- `novelties.repository.ts`/`employees.repository.ts` (`noveltyInclude`/
  `timeGridNoveltyInclude`): se retiran los 6 campos legacy del `select`
  anidado de `noveltyType` y el `finnegansLinks` anidado, reemplazado por
  `finnegansCode`/`finnegansName` planos. De paso, `timeGridNoveltyInclude`
  (usado por la grilla horaria de `EmployeeHoursPage`) queda alineado con
  `timeEntryBehavior`/`allowsDateRange`/`finnegansRequiresValidity` — antes
  de esta etapa no los traía (omisión de la migración de consumidores de
  15L.2C que quedó sin corregir hasta ahora).
- `finnegans-export/finnegansExport.principalLink.ts` y su test:
  **eliminados** — sin la tabla 1:N no hay ningún vínculo entre el que
  desempatar.
- `finnegansExport.repository.ts`: `findExportableNovelties` incluye
  `noveltyType: true` (sin el `include` anidado de `finnegansLinks`).
- `finnegansExport.service.ts::buildRow`: lee `item.noveltyType.finnegansCode`
  directo, sin resolver ningún vínculo principal.
- `finnegansExport.readiness.ts`: el campo de entrada `hasPrincipalLink` pasa
  a llamarse `hasFinnegansCode` (el código `MISSING_LINK` y su mensaje se
  mantienen como contrato de API estable, sólo se actualizó el texto de
  "vínculo Finnegans activo" a "código Finnegans configurado").

## 8. Frontend — cambios de código

- `types/noveltyType.types.ts`: se retiran `NoveltyTypeOrigin`,
  `NoveltyTimeImpact`, la interfaz `FinnegansNoveltyLink` y
  `NoveltyTypeHistoryRecord`; `NoveltyType.origin`/`.finnegansLinks`/
  `.history` desaparecen; se agregan `finnegansCode`/`finnegansName`
  (`string | null`) planos en `NoveltyType`.
- `types/index.ts` (`Novelty`): se retiran `origin`, `timeImpact`,
  `hasValidity`, `blocksTimeEntry`, `setsWorkedHoursToZero` y
  `affectsSettlement` (ver §9).
- `noveltyTypeApiService.ts`: mapper reescrito para el contrato plano
  (sin `finnegansLinks`, sin campos legacy); `mapToApi` deja de mandar los 6
  campos legacy y agrega `finnegansCode`/`finnegansName`.
- `noveltyApiService.ts`: el mapper deja de resolver un `activeLink` desde
  un array — lee `item.noveltyType.finnegansCode`/`.finnegansName` directo.
- `NoveltyTypeFields.tsx`: se retiran `noveltyOrigins`, `noveltyTimeImpacts`
  y sus labels/descriptions, `findPrincipalLinkIndex`, `newPrincipalLink`;
  `validateNoveltyType` valida `item.finnegansCode`/`item.finnegansName`
  directo en vez de resolver un vínculo principal.
- `NoveltyTypeFinnegansTab.tsx`: reescrito — de gestionar un array de
  vínculos (con lógica de "vínculo principal" y aviso de "configuraciones
  adicionales") a dos inputs directos sobre `item.finnegansCode`/
  `item.finnegansName`.
- `NoveltyModal.tsx`: se retira la resolución de `activeLink`
  (`selectedType?.finnegansCode` directo); `requiresTargetHour` se
  simplifica a `Boolean(selectedType?.rules.allowsHours)` (ver §3).
- `EmployeeHoursPage.tsx::conceptNovelties`: se retira el fallback basado en
  `timeImpact` (ver §3).
- `NoveltyTable.tsx`: se elimina la columna "Origen" por completo (sin
  reemplazo, tal como pide el hallazgo del §2); la columna "Impacto horas"
  usa sólo `noveltyTimeEntryBehaviorLabel` + `targetHourConceptName`, sin
  `noveltyTimeImpactLabel`/`timeImpact`.
- `NoveltyTypesPage.tsx`: la búsqueda por texto usa `finnegansCode`/
  `finnegansName` en vez de iterar `finnegansLinks`.
- `data/mockNoveltyTypes.ts`/`data/mockData.ts`: fixtures actualizados al
  modelo plano (sin `origin`/`finnegansLinks`/`history`/`affectsSettlement`).

## 9. `affectsSettlement` — auditado y eliminado

`Novelty.affectsSettlement` (frontend) se poblaba exclusivamente como
`item.noveltyType.exportsToFinnegans` (`noveltyApiService.ts`) — un alias
sin ningún significado propio. Grep confirmó cero componentes reales
(no-test) leyendo `.affectsSettlement`. Coherente con que la app no liquida
sueldos (`docs/NOVEDADES_HORAS_FINNEGANS.md`): no hay ningún concepto de
"afecta la liquidación" que este campo represente aparte de
`exportsToFinnegans`, que ya está expuesto directamente. Se eliminó sin
reemplazo.

## 10. `history` (placeholder muerto) — eliminado

`NoveltyType.history`/`NoveltyTypeHistoryRecord` (frontend) estaba
hardcodeado a `[]` en el mapper real (`noveltyTypeApiService.ts`) desde la
Etapa 15L.2B, que ya había quitado la pestaña "Historial" de la UI
(`NoveltyTypeDetailPage.tsx`, comentario explícito). Sin ningún endpoint
backend ni consumidor de UI real. Se eliminó el campo y el tipo — no se
conectó a `AuditLog` (que sí registra CREATE/UPDATE de `NoveltyType`, ver
`noveltyTypes.service.ts::auditChange`) porque conectar un historial real es
una decisión de producto fuera del alcance de esta etapa de limpieza.

## 11. Términos auditados sin cambios (fuera del dominio `NoveltyType`)

`settlementConcept`/`affectsSettlement` (backend)/`settlementImpact`: cero
hits — nunca existieron como campos reales. `hourConceptName`: pertenece al
dominio de `TimeEntry`/`HourConcept` (Conceptos Horarios/Horas Especiales,
Etapas 8-11), no a `NoveltyType` — no se tocó. `priority`: usado en más de
50 archivos para conceptos no relacionados (notificaciones, parámetros de
auditoría, reglas de hora especial) — sólo se eliminó el `priority` de
`FinnegansNoveltyLink` (§4).

## 12. Grep final — hits remanentes (todos comentarios/tests/docs, cero código productivo)

Tras el retiro, `blocksTimeEntry`/`setsWorkedHoursToZero`/`timeImpact`/
`allowsDateTo`/`hasValidity`/`FinnegansNoveltyLink`/`origin` (de
`NoveltyType`) sólo aparecen en: (a) comentarios que documentan
explícitamente la historia de la migración (en `schema.prisma`,
`noveltyTypes.schemas.ts`, `timeEntries.repository.ts`, etc. — todos
verificados uno por uno, ninguno referencia un campo que siga existiendo),
(b) títulos de tests que describen qué se dejó de exponer, y (c) los
documentos de decisión de las etapas 15L.2A/B/C que documentan el estado
_anterior_ a esta etapa (registro histórico, no se reescriben). Cero
ocurrencias en código de producción ejecutable.

## 13. Riesgos y deuda remanente

- La migración SQL no se aplicó contra Neon — hasta que se aplique
  (`prisma migrate deploy` en un mantenimiento coordinado), el código nuevo
  (que ya no escribe ni lee los 6 campos legacy ni `FinnegansNoveltyLink`)
  convive con columnas/tabla todavía presentes físicamente en la base, sin
  usarse. Sin riesgo funcional (nada las lee), pero el schema físico queda
  desalineado del `schema.prisma` hasta aplicarla.
- `noveltyTypes.repository.ts::update()` dejó de necesitar `$transaction`
  (ya no hay tabla relacionada que reemplazar) — la creación de un
  `NoveltyType` puede reintentar hasta 3 veces por colisión de código
  (sin cambios, comportamiento preexistente de 15L.2A).
- El único `NoveltyType` real (`NOV-LLEGADA-TARDE`) hoy no exporta a
  Finnegans (`exportsToFinnegans=false` en los datos auditados) — el campo
  `finnegansCode`/`finnegansName` quedará `null` para ese registro tras la
  migración (no había ningún `FinnegansNoveltyLink` real asociado a
  exportación activa que copiar en la práctica, más allá del que confirma
  la evidencia del §4).

## 14. Validaciones ejecutadas

```txt
Backend:
npx prisma validate      → OK
npx prisma generate      → OK
npx prisma migrate status → 1 migración pendiente (20260916160000_remove_novelty_type_legacy_fields), no aplicada
npm run typecheck (tsc)  → OK
npm test (vitest run)    → 112 archivos / 1712 tests OK
npm run build            → OK

Frontend:
npx tsc -b                             → OK
npx tsc -p tsconfig.e2e.json --noEmit  → OK
npm test (vitest run)                  → 92 archivos / 953 tests OK
npm run build                          → OK

General:
git diff --check → sin errores
```

No se hizo commit. No se hizo push.
