# Etapa 15L.2A — Normalización aditiva del modelo de Tipos de Novedad

## 1. Motivo

Las Etapas 15L (auditoría Novedades/Exportación Finnegans) y 15L.1 (auditoría
+ rediseño funcional de Tipos de Novedad) encontraron, con cita exacta de
código, que `NoveltyType` tiene tres campos describiendo el mismo
comportamiento horario (`blocksTimeEntry`, `setsWorkedHoursToZero`,
`timeImpact`), desincronizables entre sí desde la propia UI; un campo
(`origin`) redundante con `exportsToFinnegans`; dos campos `hasValidity`
duplicados (`NoveltyType` y `FinnegansNoveltyLink`); un campo
(`exportConcept`) validado y editable pero nunca leído por el exportador
real; y un bug concreto de pérdida de datos: el textarea "Observaciones
internas" se editaba en pantalla pero nunca se enviaba al backend
(`notes` no existía en el modelo). También encontró que la validación de
`quantityHours`/`quantityDays` y de `requiresDocumentation` sólo vivía en
el frontend, y que `requiresApproval` no tenía ningún efecto real (el
estado inicial de una `Novelty` dependía sólo del rol de quien la creaba).

Esta etapa implementa la primera fase de la migración propuesta en 15L.1
(Fase A: "agregar sin romper") — prepara el modelo y el backend para el
rediseño definitivo sin tocar todavía la UI de configuración, la
exportación Finnegans, ni ningún campo legacy existente.

## 2. Modelo previo (sin cambios de comportamiento de lectura)

`NoveltyType` seguía usando `origin`, `allowsDateTo`, `hasValidity`,
`blocksTimeEntry`, `setsWorkedHoursToZero`, `timeImpact` y `allowsHours`
como única fuente de verdad. `findBlockingNovelty`
(`backend/src/modules/time-entries/timeEntries.repository.ts`) sigue
leyendo exactamente esos mismos tres campos legacy (`blocksTimeEntry`,
`setsWorkedHoursToZero`, `timeImpact = BLOQUEA_CARGA_DIA`) sin ningún
cambio — no se tocó ese módulo.

## 3. Modelo nuevo aditivo

Campos agregados a `NoveltyType` (migración
`20260916120000_add_novelty_type_normalization_fields`):

| Campo nuevo | Tipo | Reemplaza (en la práctica) a |
| --- | --- | --- |
| `notes` | `String?` | — (no existía, bug de pérdida de datos) |
| `timeEntryBehavior` | enum `NoveltyTimeEntryBehavior` (`NO_BLOQUEA` \| `BLOQUEA_NUEVA_CARGA`) | `blocksTimeEntry` + `setsWorkedHoursToZero` + `timeImpact` |
| `allowsDateRange` | `Boolean` (default `true`) | `allowsDateTo` |
| `finnegansValueUnit` | enum `FinnegansValueUnit?` (`HOURS` \| `DAYS` \| `UNIT`) | ambigüedad de "Valor 1" (`quantityHours`→`quantityDays`→`"1"`) |
| `finnegansRequiresValidity` | `Boolean` (default `false`) | `hasValidity` (a nivel de `NoveltyType`) |

Ninguna columna legacy se eliminó ni cambió de tipo. `origin` y
`FinnegansNoveltyLink` (relación 1:N) tampoco se tocaron en esta etapa —
ver §8.

## 4. Backfill de datos existentes

Ejecutado dentro de la propia migración (`migration.sql`), por fila
existente:

- `allowsDateRange` = copia directa de `allowsDateTo`.
- `finnegansRequiresValidity` = copia directa de `hasValidity`.
- `timeEntryBehavior` = `BLOQUEA_NUEVA_CARGA` si `blocksTimeEntry = true`
  OR `setsWorkedHoursToZero = true` OR `timeImpact = BLOQUEA_CARGA_DIA`;
  `NO_BLOQUEA` en cualquier otro caso.
- `finnegansValueUnit` = `HOURS` si `allowsHours = true`; **`NULL` en
  cualquier otro caso** — no se infiere `DAYS` ni `UNIT` sin evidencia
  (instrucción explícita de la etapa). Los tipos con `allowsHours = false`
  quedan con `finnegansValueUnit = NULL` ("sin determinar") hasta que se
  revisen manualmente o se resuelvan en 15L.2B.

## 5. Estrategia de migración A/B/C (de 15L.1, situada en esta etapa)

- **Fase A (esta etapa)**: campos nuevos agregados, backfill aplicado,
  legacy intacto, service sincroniza ambos modelos en cada write.
- **Fase B (futura, no en esta etapa)**: migrar los consumidores reales
  (`findBlockingNovelty`, `finnegansExport.service.ts`) para leer los
  campos nuevos en vez de los legacy.
- **Fase C (futura, no en esta etapa)**: eliminar las columnas legacy del
  schema, sólo después de confirmar cero lecturas activas.

## 6. Sincronización — única fuente de verdad por write

Implementada en `backend/src/modules/novelty-types/noveltyTypes.sync.ts`
(funciones puras, testeadas en `noveltyTypes.sync.test.ts`) y aplicada en
`noveltyTypesService.create`/`update` antes de llegar al repositorio:

- Si el request manda el campo **nuevo**, es la fuente de verdad y fuerza
  los campos legacy correspondientes a la combinación canónica.
- Si no manda el nuevo pero sí toca cualquiera de los legacy asociados, se
  deriva el campo nuevo desde ahí y **también se fuerzan los demás legacy**
  del mismo grupo a la combinación canónica (evita, por ejemplo,
  `blocksTimeEntry=true` conviviendo con `timeImpact=NO_AFECTA_HORAS`).
- Si el request no toca ninguno de los campos de un grupo, no se escribe
  nada de ese grupo (no pisa el valor ya persistido).
- **`setsWorkedHoursToZero` nunca vuelve a quedar `true` escrito desde
  código nuevo** — ambas combinaciones canónicas (`BLOQUEA_NUEVA_CARGA` y
  `NO_BLOQUEA`) lo fijan en `false` explícitamente. Sigue existiendo sólo
  por compatibilidad de lectura (`findBlockingNovelty`, que lo sigue
  tratando como equivalente a `blocksTimeEntry` — sin cambios en ese
  archivo).

`finnegansValueUnit`: si el request no lo manda pero prende
`allowsHours=true`, se infiere `HOURS`. Apagar `allowsHours` **no** borra
un `finnegansValueUnit` ya elegido — no hay evidencia segura de a qué
debería volver (mismo criterio conservador que el backfill).

## 7. Reglas de aprobación (`requiresApproval`)

`noveltiesService.create()` (`backend/src/modules/novelties/novelties.service.ts`):
RRHH sigue creando siempre `APROBADO`, sin excepción — es la autoridad
final, sin cambios. Para Nivel 2/3, `NoveltyType.requiresApproval` ahora
decide de verdad: `false` autoaprueba (`APROBADO` directo, sin notificar a
RH); cualquier otro valor, incluido ausente/`undefined` (default seguro),
sigue exigiendo aprobación (`PENDIENTE`, notifica a RH) — mismo
comportamiento que ya existía antes de esta etapa. No se agregó ningún
estado nuevo al enum `ApprovalStatus`.

## 8. Valor 1 — `finnegansValueUnit`

`novelties.service.ts::assertQuantityCoherence` (nuevo), corrido dentro de
`ensureNoveltyTypeReady` antes de crear la `Novelty`:

- `quantityHours` y `quantityDays` a la vez → siempre rechazado
  (`409` → en realidad `400 NOVELTY_QUANTITY_UNIT_CONFLICT`), sin importar
  la unidad configurada.
- Unidad efectiva = `NoveltyType.finnegansValueUnit` si está definida, si
  no `HOURS` cuando `allowsHours=true`, si no `null` ("sin determinar").
- `HOURS` → sólo permite `quantityHours`; `quantityDays` presente rechaza
  con `NOVELTY_QUANTITY_UNIT_MISMATCH`.
- `DAYS` → sólo permite `quantityDays`; `quantityHours` presente rechaza.
- `UNIT` → ninguna cantidad permitida; cualquiera presente rechaza.
- `null` (sin determinar, típicamente un tipo legacy con `allowsHours=false`
  sin migrar explícitamente) → **no se agrega ninguna restricción nueva**
  más allá de la que ya existía (`NOVELTY_HOURS_NOT_ALLOWED` si
  `allowsHours=false` y llega `quantityHours`) — instrucción explícita de
  no inventar una regla de `DAYS`/`UNIT` sin evidencia.

Esto es **sólo metadato de la novedad/exportación** — no cambia en nada que
Novedades nunca crea, modifica ni pone en 0 un `TimeEntry` (Etapa 15G.1,
sin cambios).

## 9. Generación de `code`

`POST /novelty-types` ahora acepta `code` opcional. Si se omite, el
backend genera el próximo correlativo (`noveltyTypesRepository::generateNextCode`,
mismo formato `NOV-XXX` que ya calculaba el frontend) y reintenta hasta 3
veces si una colisión de concurrencia (`P2002`) lo invalida antes de
insertar. Si el caller manda `code` explícito (como sigue haciendo el
frontend actual, sin cambios), un `P2002` se propaga directo, igual que
antes de esta etapa.

## 10. Compatibilidad — qué NO cambió

- `origin`: se mantiene, se documenta `@deprecated` en el schema
  (comentario Prisma), sin ningún cambio de contrato ni de lectura.
- `FinnegansNoveltyLink` sigue siendo 1:N — no se migró a 1:1 (decisión
  explícita de esta etapa, la UX 1:1 se resuelve en 15L.2B).
  `finnegansValueUnit`/`finnegansRequiresValidity` viven, por ahora, en
  `NoveltyType` (no en el link), tal como pedía el alcance de esta etapa.
- `finnegansExport.service.ts`/`finnegansExport.repository.ts`: sin ningún
  cambio de código — siguen leyendo exclusivamente los campos legacy
  (`hasValidity`, `finnegansLinks[0]`, `quantityHours`/`quantityDays` sin
  la validación nueva del lado de creación). El exportador sigue
  funcionando exactamente igual.
- `findBlockingNovelty` (`time-entries`): sin cambios — sigue leyendo
  `blocksTimeEntry`/`setsWorkedHoursToZero`/`timeImpact`, que la
  sincronización de esta etapa mantiene siempre coherentes.
- `MonthlyTimeClosure`, cierres mensuales, fichador: no tocados.
- Frontend: sólo se tocó `noveltyTypeApiService.ts` (mapper de `notes`,
  ver §11) — ningún componente de UI, página ni test de UI se modificó.
  El frontend actual sigue enviando siempre los campos legacy tal como
  antes; la sincronización del lado del backend absorbe eso sin que el
  frontend necesite saber que existen los campos nuevos todavía.

## 11. `requiresDocumentation` — auditado, no implementado (ver 15L.1 §16)

Se confirmó durante esta etapa (leyendo `NoveltyModal.tsx` y
`EmployeeDocument.noveltyId String?`) que el documento se sube **después**
de que la `Novelty` ya existe — `EmployeeDocument.noveltyId` referencia un
`Novelty.id` que todavía no existe en el momento del `POST /novelties`. Por
lo tanto, exigir el documento en el `create` es estructuralmente imposible
sin inventar un flujo transaccional nuevo (fuera de alcance explícito de
esta etapa: "no inventar arquitectura"). **No se implementó ninguna
validación de backend para `requiresDocumentation`** — sigue siendo sólo
una validación de frontend (`NoveltyModal.tsx`, sin cambios). Propuesta
para una etapa futura, sin implementar: bloquear `approve()` (no `create()`)
si `requiresDocumentation=true` y la novedad no tiene ningún
`EmployeeDocument` asociado — para entonces sí existe la `Novelty` y el
documento pudo haberse subido en el medio.

## 12. `notes` — bug corregido

`NoveltyType.notes` ahora existe en el modelo (`String?`, nullable, sin
default). Backend: `createNoveltyTypeSchema`/`updateNoveltyTypeSchema`
aceptan `notes` (mismo patrón que `description`). Frontend
(`noveltyTypeApiService.ts`): `mapToApi` ahora incluye `notes` en el body
(antes no lo mandaba en absoluto) y `mapNoveltyTypeFromApi` lee
`item.notes || ""` (antes hardcodeaba `""` siempre, descartando lo que
hubiera en la API). El textarea "Observaciones internas"
(`NoveltyTypeIdentificationTab.tsx`) no se tocó — ya estaba conectado a
`item.notes`, sólo le faltaba esta plomería en el mapper para persistir de
verdad.

## 13. Color (`uiColor`) — auditado, sin cambios (ver 15L.1 §18)

Se re-auditó la discrepancia entre el enum de colores del backend
(`noveltyColorSchema`, incluye `"indigo"`, no `"purple"`) y el del frontend
(`NoveltyUiColor`, incluye `"purple"`, no `"indigo"`). Confirmado: **no hay
ningún bug activo en el camino de escritura real** — el frontend siempre
mapea `"purple"→"violet"` antes de enviar (`mapColorToApi`), y los 14
colores restantes que el frontend puede enviar están todos aceptados por
el enum del backend. El único riesgo es latente (si algún día algo escribe
`"indigo"` directo por API, el frontend lo absorbe con un fallback
determinístico sin romper, sólo mostrando un color distinto al guardado) y
no lo ejercita nada del producto actual. Se decide **no tocarlo en esta
etapa** — cualquier unificación de ambos enums implica decidir si se
recorta el backend (riesgo de romper una fila real que ya tenga `"indigo"`
en una base que no puedo inspeccionar desde aquí) o se ensancha el
frontend (cambio visual, aunque menor) — se posterga a 15L.2B junto con el
resto del rediseño de UI, según lo autorizaba explícitamente el pedido de
esta etapa.

## 14. Qué queda pendiente para frontend (15L.2B)

- UI para elegir `finnegansValueUnit` explícitamente (hoy sólo se infiere
  desde `allowsHours=true`; los tipos con `allowsHours=false` quedan con
  la unidad sin determinar hasta que un humano la fije).
- UI para `timeEntryBehavior` como selector único (reemplazando los 3
  controles legacy de `NoveltyTypeRulesTab.tsx`).
- Persistencia visual de `allowsDateRange`/`finnegansRequiresValidity`
  como los campos primarios en pantalla (hoy siguen mostrándose los
  legacy; el backend ya sincroniza correctamente cualquiera de los dos que
  se edite).
- Corrección del picker de color (`NoveltyColorField`, `usedColors` vive
  vacío por diseño incompleto — bug ya documentado en 15L.1 §18/§25, no
  tocado en esta etapa por ser estrictamente de UI).
- Relación 1:1 con Finnegans (§10).

## 15. Qué queda pendiente para exportación Finnegans

`finnegansExport.service.ts`/`.repository.ts` no se tocaron. Cuando se
decida migrar (Fase B, §5), deberían pasar a leer
`noveltyType.finnegansValueUnit` (en vez de `quantityHours` →
`quantityDays` → `"1"`) y `noveltyType.finnegansRequiresValidity` (en vez
de `hasValidity` del tipo o del link) — sin ningún `if` por nombre de tipo,
tal como ya quedó diseñado conceptualmente en 15L.1 §24. Los gaps P0/P1 de
15L (sin gate de cierre mensual, sin idempotencia, "Centro de costo"
siempre vacío) tampoco se tocaron — siguen abiertos, fuera de alcance de
esta etapa.

## 16. Tests agregados

- `noveltyTypes.sync.test.ts` (nuevo, 17 tests): las 4 funciones puras de
  sincronización + el combinador, incluyendo el caso "gana el campo nuevo
  aunque el legacy diga lo contrario" y "un update que no toca nada no
  agrega nada".
- `noveltyTypes.service.test.ts` (nuevo, el módulo no tenía tests de
  `create`/`update` hasta esta etapa): confirma que el service llama al
  repositorio ya con los campos sincronizados, para create y para update
  parcial.
- `noveltyTypes.repository.test.ts` (ampliado): generación de código sin
  colisión, con colisión (reintento), agotamiento de reintentos, y `code`
  explícito sin ningún reintento.
- `novelties.service.test.ts` (ampliado): las 6 combinaciones de
  `requiresApproval` × rol (RRHH/Nivel 2/Nivel 3, con y sin
  `requiresApproval`) y 9 casos de `assertQuantityCoherence`
  (HOURS/DAYS/UNIT permiten y rechazan lo que corresponde, `null` no
  agrega restricción nueva, ambas cantidades juntas siempre rechazan).

## 17. Validaciones ejecutadas

```txt
Backend:
npx prisma validate     → OK
npx prisma generate     → OK
npx prisma migrate status → 1 migración pendiente detectada (ver §18), 0 aplicadas por esta sesión
npm run typecheck        → OK
npm test (vitest run)    → 107 archivos / 1617 tests OK
npm run build             → OK

Frontend:
npx tsc -p tsconfig.app.json --noEmit → OK
npx tsc -p tsconfig.e2e.json --noEmit → OK
npm test (vitest run)                  → 89 archivos / 878 tests OK
npm run build                           → OK

General:
git diff --check → sin errores
```

## 18. Riesgo pendiente — migración NO aplicada a la base real

El único `DATABASE_URL` configurado en este entorno apunta a una base
Postgres remota real (Neon, `backend/.env`), no a una base de
desarrollo/test separada — mismo entorno ya señalado como compartido en
etapas previas (15K). Por eso esta etapa **generó la migración
(`prisma/migrations/20260916120000_add_novelty_type_normalization_fields/migration.sql`)
pero deliberadamente no ejecutó `prisma migrate dev`/`deploy` contra esa
base** — sólo se corrió `prisma migrate status` (lectura, sin aplicar
nada), que confirma la migración como pendiente. Aplicarla requiere una
decisión explícita del usuario (o un pipeline de deploy autorizado) antes
de que el código nuevo pueda leer/escribir estas columnas contra datos
reales. Hasta que se aplique, el código de esta etapa es válido y
compila/testea correctamente (los tests mockean el repositorio, no tocan
la base real), pero **no debe desplegarse a un entorno que use esta misma
base sin aplicar antes la migración**.

## 19. Qué NO se tocó

`TimeEntry`, lógica real de horas, `findBlockingNovelty`, Conceptos
Horarios/Horas Especiales, `MonthlyTimeClosure`, cierres mensuales,
fichador, exportación Finnegans (código), `FinnegansNoveltyLink` (modelo y
relación), `origin` (comportamiento), UI de Tipos de Novedad, UI de
Novedades, seeds. No se hizo commit. No se hizo push.
