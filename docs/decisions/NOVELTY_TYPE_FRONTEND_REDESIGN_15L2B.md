# Etapa 15L.2B — Rediseño frontend de Tipos de Novedad

## 1. UX anterior y problemas

Confirmado en la auditoría 15L.1 y corregido en esta etapa sobre el modelo
normalizado de 15L.2A (`docs/decisions/NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md`):

- **Identificación** mostraba `origin`, redundante con `exportsToFinnegans`
  y sin ningún consumidor real de negocio.
- **Reglas operativas** exponía 3 campos legacy
  (`blocksTimeEntry`/`setsWorkedHoursToZero`/`timeImpact`) describiendo el
  mismo comportamiento, editables por separado y desincronizables entre sí
  desde la propia UI.
- **Finnegans** exponía una lista completa de `FinnegansNoveltyLink[]` con
  `priority`/`status`/`exportConcept`/`notes` — conceptos técnicos que
  RRHH no necesita entender para configurar una exportación.
- **"Valor 1"** no tenía ninguna unidad explícita — dependía del legacy
  `allowsHours` sin ningún control visible.
- **Historial** mostraba siempre el estado vacío (`history` hardcodeado en
  el mapper) — una pestaña que nunca tuvo ni podía tener contenido.
- **Observaciones internas** se editaba en pantalla pero nunca se
  guardaba (bug corregido en 15L.2A, ver §12 de ese documento).
- El picker de color tenía una validación de "color ya usado" rota
  (`usedColors` nunca se poblaba).
- `NoveltyModal` (creación de novedades) no filtraba el catálogo por rol,
  mostrando tipos que el backend luego rechazaba con 403.

## 2. UX nueva

**Creación** (`/configuracion/tipos-novedades/nuevo`) en 3 secciones:

1. **Identificación**: código (sólo lectura), nombre, categoría, estado,
   color, descripción, observaciones internas. Sin `origin`.
2. **Reglas operativas**: requiere aprobación, requiere documentación,
   permite rango de fechas, permite cantidad de horas, **un único**
   selector "Comportamiento" (`timeEntryBehavior`), roles que cargan/aprueban.
3. **Finnegans**: toggle "Exportar esta novedad a Finnegans"; si está
   apagado, se oculta toda la configuración (sin borrar nada). Si está
   prendido: código Finnegans, nombre Finnegans, unidad de Valor 1,
   requiere vigencia.

**Detalle** (`/configuracion/tipos-novedades/:id`): mismos 3 bloques como
pestañas ("General", "Reglas", "Finnegans"), header con badge "Finnegans"
cuando `exportsToFinnegans=true`, **sin pestaña "Historial"** (ver §9).

**Listado**: columnas Código/Novedad/Categoría/Estado/Finnegans/Aprobación/Acciones
(sin "Origen"); tarjetas resumen Total/Activos/Exportables a
Finnegans/Requieren aprobación.

## 3. Campos ocultados (siguen existiendo, sólo dejan de mostrarse)

`origin`, `blocksTimeEntry`, `setsWorkedHoursToZero`, `timeImpact`,
`hasValidity` (a nivel de `NoveltyType` y de `FinnegansNoveltyLink`),
`allowsDateTo` (legacy), `FinnegansNoveltyLink.priority`/`status`/
`exportConcept`/`notes`, botón "Agregar vínculo Finnegans", pestaña
"Historial".

## 4. Compatibilidad legacy

Todo lo oculto se mantiene sincronizado por el backend
(`noveltyTypes.sync.ts`, Etapa 15L.2A) — la UI nueva sólo escribe los
campos nuevos (`timeEntryBehavior`, `allowsDateRange`,
`finnegansValueUnit`, `finnegansRequiresValidity`); el backend fuerza los
legacy correspondientes a la combinación coherente en cada create/update.
`findBlockingNovelty` (`time-entries`) y `finnegansExport.service.ts` no
se tocaron — siguen leyendo exclusivamente los campos legacy, que quedan
correctos gracias a la sincronización.

## 5. Vínculo principal Finnegans

`FinnegansNoveltyLink[]` sigue siendo 1:N en el modelo — no se tocó (fuera
de alcance explícito de esta etapa). La UI trabaja con un **vínculo
principal** (helper compartido `findPrincipalLinkIndex`,
`NoveltyTypeFields.tsx`): el link `ACTIVO` de mayor prioridad, o el primero
existente si ninguno está activo, o uno nuevo en memoria
(`priority:1, status:"ACTIVO"`) si no existe ninguno al activar el toggle.
Sólo se edita `code`/`name` de ese vínculo; `priority`/`status`/
`exportConcept`/`notes` quedan como estaban (o con esos defaults si es
nuevo) — nunca se piden en pantalla.

`link.hasValidity` del vínculo principal se sincroniza con
`finnegansRequiresValidity` al guardar (`NoveltyTypeFinnegansTab.tsx::setRequiresValidity`):
es necesario porque `finnegansExport.service.ts::toExportRow` hace un OR
entre `NoveltyType.hasValidity` y `link.hasValidity` — sin este paso,
apagar "Requiere vigencia" en la UI nueva no tendría efecto real si el
vínculo ya tenía `hasValidity=true` de antes.

## 6. Múltiples vínculos legacy

Si un tipo tiene más de un `FinnegansNoveltyLink`, la pantalla muestra un
aviso no técnico ("Este tipo tiene configuraciones Finnegans adicionales
creadas anteriormente...") sin exponer ningún UUID ni id técnico. Al
guardar, el array completo de links se reenvía tal cual salvo el
principal (que sí puede cambiar) — los secundarios nunca se editan ni se
borran desde esta pantalla (confirmado con test,
`NoveltyTypeDetailPage.test.tsx`).

## 7. `exportConcept`

Deja de pedirse en la UI. Backend (`noveltyTypes.schemas.ts`): pasa de
`min(2)` obligatorio a `.optional().default("")`. La UI sigue espejando el
nombre Finnegans en ese campo al construir el vínculo principal
(`mapLinkToApi`, `noveltyTypeApiService.ts`) para que, si algún día se lee,
tenga un valor legible en vez de vacío — sin exigírselo al usuario.

## 8. `priority`/`status` del vínculo

No se muestran. Para un vínculo nuevo creado desde la UI: `priority: 1`,
`status: "ACTIVO"`, fijos, sin que el usuario tenga que entenderlos. Para
uno existente, se preservan tal cual.

## 9. Historial

Se quita la pestaña del detalle (`NoveltyTypeDetailPage.tsx`) — `history`
sigue hardcodeado vacío en `noveltyTypeApiService.ts` (el backend audita
en `AuditLog`, entity `NoveltyType`, pero esta pantalla no lo consulta).
No se conectó a `AuditLog` en esta etapa (no había un endpoint reusable a
la vista sin diseñar uno nuevo) — queda para 15L.2C si se decide.

## 10. `finnegansValueUnit`

Selector con 3 opciones (Horas/Días/Unidad) + copy explicativo de qué
representa Valor 1 en cada caso. "Reglas operativas" conserva un control
independiente "Permite cantidad de horas" (`allowsHours`) para tipos que
necesitan esa metadata sin exportar a Finnegans (caso real: "Llegada
tarde", `exportsToFinnegans=false`, `allowsHours=true`).

> **Corrección — Etapa 15L.2B.1** (docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md,
> esta misma sección, reemplaza el texto original de 15L.2B): la primera
> versión de esta etapa sincronizaba `finnegansValueUnit` con `allowsHours`
> en ambas direcciones (`noveltyTypes.sync.ts::resolveFinnegansValueUnitSync`)
> y decidía en `NoveltyModal.tsx` qué cantidad enviar mirando
> `finnegansValueUnit` en vez de `allowsHours`. Eso era conceptualmente
> incorrecto: son dos decisiones distintas (`allowsHours` = ¿la novedad
> permite cargar una cantidad de horas como dato operativo?;
> `finnegansValueUnit` = si se exporta a Finnegans, ¿qué representa Valor
> 1?). El síntoma real: tildar "Permite cantidad de horas" en Reglas podía
> pisar en silencio la unidad elegida en Finnegans (y viceversa), y un tipo
> con `allowsHours=true` + `finnegansValueUnit=UNIT` descartaba la cantidad
> de horas que el usuario veía y completaba en pantalla. Ver
> `docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md` §19 para el
> detalle completo de la corrección — ambos campos son independientes
> desde esta corrección, en ambas direcciones, sin excepción.

## 11. Vigencia

La UI usa únicamente `finnegansRequiresValidity` (nunca los dos
`hasValidity` legacy). El backend sincroniza `NoveltyType.hasValidity`
automáticamente (15L.2A); el link principal se sincroniza en el frontend
(ver §5).

## 12. Observaciones internas

Confirmado end-to-end con test: `NoveltyTypeCreatePage.test.tsx` (edición
del campo) + `noveltyTypeApiService.ts` (persistencia, ya corregida en
15L.2A) + `NoveltyTypeDetailPage.test.tsx` (edición y guardado en
detalle). No se agregó un test de integración real contra el backend
(fuera de alcance — se valida con mocks, mismo patrón que el resto del
frontend).

## 13. Colores

Auditado en 15L.2A (ver ese documento §13, sin cambios de código en esta
etapa salvo la limpieza descripta abajo): el enum de colores del backend
ya se alineó 1:1 con el del frontend (`purple` agregado, `indigo`
retirado, confirmado sin datos reales usando `indigo`). En esta etapa se
retiró además el workaround `mapColorToApi`/`ApiNoveltyUiColor` en
`noveltyTypeApiService.ts` (ya no hace falta ningún mapeo especial) y se
eliminó la validación de "color único" de `NoveltyColorField`
(`usedColors` vivía siempre vacía, ver 15L.1 §18/§25) — auditado: no hay
ninguna regla de negocio real que exija unicidad de color, es sólo ayuda
visual. Ahora permite colores repetidos, sin ninguna lógica muerta.

## 14. `NoveltyModal` (creación de novedades)

- **Cantidad a enviar**: `resolveNoveltyQuantities()` decide qué cantidad
  enviar (`quantityHours`/`quantityDays`) mirando exclusivamente
  `allowsHours` — nunca `finnegansValueUnit` (corregido en la Etapa
  15L.2B.1, ver §10 y §19; la primera versión de esta etapa miraba
  `finnegansValueUnit`, lo que podía descartar en silencio una cantidad de
  horas que el usuario veía y completaba en pantalla). Sólo metadato de la
  novedad/exportación, confirmado que no toca `TimeEntry`.
- **Filtro por rol**: el catálogo mostrado se filtra por
  `allowedLoadRoles` del usuario actual (RRHH mantiene autoridad global,
  mismo criterio que `assertCanLoad` en el backend) — evita mostrar una
  opción que el backend rechazaría con `403 NOVELTY_LOAD_FORBIDDEN`.
- **Documentación**: sin cambios de flujo (se mantiene la limitación
  documentada en 15L.2A §11 — el enforcement de backend no es posible
  porque el documento se sube después de crear la novedad).
- Se limpió el panel informativo del tipo seleccionado: ya no muestra
  `Origen: {enum}` sin traducir; usa `timeEntryBehavior` en vez de
  `timeImpact`/`blocksTimeEntry` legacy para el texto de comportamiento.

## 15. Ajustes de backend (mínimos, para sostener el frontend nuevo)

- `noveltyTypes.schemas.ts`: `exportConcept` deja de ser obligatorio
  (§7); `noveltyColorSchema` alineado 1:1 con el frontend (§13, ya
  aplicado en el mismo cambio de esta etapa).
- `noveltyTypes.sync.ts`: `resolveFinnegansValueUnitSync` ahora también
  sincroniza `allowsHours` cuando `finnegansValueUnit` viene explícito
  (§10) — necesario para que la UI nueva no rompa `NOVELTY_HOURS_NOT_ALLOWED`.
- `noveltyTypes.service.ts`: nueva validación
  `assertFinnegansConfigCoherent` — si `exportsToFinnegans=true`, exige
  al menos un vínculo (código+nombre) y una `finnegansValueUnit` definida,
  tanto en `create` como en `update` (mirando el estado resultante:
  fila actual + patch). No se agregó ninguna validación de
  `allowedLoadRoles`/`approvalRoles` no vacíos — auditado: ambos
  guards (`assertCanLoad`/`assertCanApprove`) ya dejan a RRHH como
  autoridad universal sin importar esos arrays, así que un array vacío
  nunca hace "imposible" cargar/aprobar una novedad (sólo restringe a
  RRHH exclusivamente, una configuración legítima) — se documenta en vez
  de bloquear una configuración que puede ser intencional; la UI sólo
  muestra un aviso informativo (no bloqueante) cuando queda vacío.

Nada de esto tocó `finnegansExport.*`, `MonthlyTimeClosure`, `closureLock`,
`timeEntries` (export ni `findBlockingNovelty`), horas reales, Conceptos
Horarios, Horas Especiales, fichador, ni ninguna columna/tabla de Prisma.

## 16. Qué queda para 15L.2C

- Migrar `finnegansExport.service.ts`/`.repository.ts` a leer
  `finnegansValueUnit`/`finnegansRequiresValidity` en vez de los campos
  legacy (Fase B de la migración descripta en 15L.2A §5).
- Relación 1:1 real con Finnegans (retirar `FinnegansNoveltyLink[]` como
  tabla 1:N), una vez confirmado que ningún tipo real necesita más de un
  vínculo.
- Conectar la pestaña "Historial" a `AuditLog` (§9).
- Gate de cierre mensual para la exportación Finnegans y demás gaps P0/P1
  ya documentados en la Etapa 15L (auditoría original).
- Retirar las columnas legacy del schema (Fase C de 15L.2A), sólo después
  de migrar sus lectores reales.

## 17. Tests agregados

Backend: `noveltyTypes.sync.test.ts` (ampliado, comportamiento nuevo de
`resolveFinnegansValueUnitSync`), `noveltyTypes.service.test.ts`
(ampliado, `assertFinnegansConfigCoherent` en create/update).

Frontend: `NoveltyTypeCreatePage.test.tsx` (nuevo, 10 tests),
`NoveltyTypeDetailPage.test.tsx` (nuevo, 5 tests), `NoveltyTypesPage.test.tsx`
(ampliado, 4 tests de listado), `NoveltyModal.test.tsx` (ampliado, 7 tests
de unidad de valor y filtro por rol), más los ajustes de fixtures
(`mockNoveltyTypes.ts`, `AttendancePage.test.tsx`, `NotificationsPage.test.tsx`)
para que sigan compilando con los campos nuevos del modelo.

## 18. Validaciones ejecutadas

```txt
Backend:
npx prisma validate   → OK
npx prisma generate   → OK
npm run typecheck      → OK
npm test (vitest run)  → 107 archivos / 1626 tests OK
npm run build           → OK

Frontend:
npx tsc -p tsconfig.app.json --noEmit → OK
npx tsc -p tsconfig.e2e.json --noEmit → OK
npx tsc -b                             → OK
npm test (vitest run)                  → 91 archivos / 904 tests OK
npm run build                           → OK

General:
git diff --check → sin errores
```

No se aplicó ninguna migración nueva (no hizo falta: todos los campos ya
existían desde 15L.2A). No se hizo commit. No se hizo push.

## 19. Corrección puntual — Etapa 15L.2B.1: desacoplar `finnegansValueUnit` de `allowsHours`

**Decisión explícita**: `allowsHours` y `finnegansValueUnit` son conceptos
totalmente independientes, en ambas direcciones, sin excepción.

- **`allowsHours`**: captura operativa — ¿este tipo de novedad permite
  registrar una cantidad de horas como dato de la novedad? Es lo único que
  decide si `NoveltyModal` puede enviar `quantityHours`, y lo único que
  siguen leyendo `NOVELTY_HOURS_NOT_ALLOWED` (backend) y el input
  "Cantidad de horas" (frontend).
- **`finnegansValueUnit`**: interpretación de Valor 1 en la exportación —
  si esta novedad se exporta a Finnegans, ¿qué representa Valor 1?
  (`HOURS`/`DAYS`/`UNIT`). No decide nada sobre qué se puede cargar.

**Dónde estaba el acoplamiento (auditado, confirmado con cita exacta):**

- `backend/src/modules/novelty-types/noveltyTypes.sync.ts::resolveFinnegansValueUnitSync`
  — sincronizaba en las dos direcciones: `finnegansValueUnit` explícito
  forzaba `allowsHours = (unit === "HOURS")`; `allowsHours=true` sin
  `finnegansValueUnit` explícito inferá `finnegansValueUnit = "HOURS"`.
  **Eliminada por completo** — no se dejó como función identidad porque no
  hacía falta ninguna (Prisma ya preserva por sí solo el campo que un
  PATCH parcial no menciona).
- `backend/src/modules/novelties/novelties.service.ts::assertQuantityCoherence`
  — calculaba una "unidad efectiva" (`type.finnegansValueUnit ??
  (type.allowsHours ? "HOURS" : null)`) y rechazaba `quantityHours`/
  `quantityDays` según esa unidad mixta. Se simplificó a la única regla
  que es genuinamente de integridad de datos, independiente de cualquier
  unidad: no se puede cargar horas y días a la vez
  (`NOVELTY_QUANTITY_UNIT_CONFLICT`). La capacidad operativa de cargar
  horas sigue dependiendo únicamente de `allowsHours`
  (`NOVELTY_HOURS_NOT_ALLOWED`, guard preexistente, no tocado).
- `frontend/src/components/novelties/NoveltyModal.tsx` — `effectiveValueUnit()`
  decidía la unidad efectiva igual que el backend, y `resolveNoveltyQuantities()`
  usaba esa unidad (no `allowsHours`) para decidir qué cantidad enviar.
  Corregido: `resolveNoveltyQuantities()` ahora recibe `allowsHours`
  directamente; `effectiveValueUnit()` se eliminó.
- **Confirmado que NO había acoplamiento en**: `NoveltyTypeRulesTab.tsx`
  (el checkbox "Permite cantidad de horas" siempre sólo tocó
  `rules.allowsHours`) y `NoveltyTypeFinnegansTab.tsx` (el selector
  "Unidad de Valor 1" siempre sólo tocó `rules.finnegansValueUnit`) — el
  acoplamiento vivía enteramente en el backend (`noveltyTypes.sync.ts`) y
  en `NoveltyModal.tsx`, nunca en los componentes de edición del catálogo.
  El síntoma visible sí llegaba a esas pantallas de forma indirecta: al
  guardar, `NoveltyTypeDetailPage.tsx::save` hace `setItem(saved)` con la
  respuesta del backend — como esa respuesta venía con `allowsHours` ya
  pisado por el sync, el checkbox podía aparecer tildado/destildado sin
  que el usuario lo hubiera tocado, recién después de guardar.

**Cómo queda `allowsHours`**: fuente de verdad única de la capacidad
operativa. Create/update: si el request lo manda, se persiste tal cual;
si no lo manda, PATCH preserva el valor existente. Nunca lo modifica un
cambio de `finnegansValueUnit`.

**Cómo queda `finnegansValueUnit`**: fuente de verdad única de la
interpretación de exportación. Create/update: mismo criterio simétrico —
se persiste si viene, se preserva si no viene en un PATCH. Nunca lo
modifica un cambio de `allowsHours`.

**Create**: `applyNoveltyTypeCompatibilitySync` ya no toca ninguno de los
dos campos — simplemente los deja pasar tal cual llegaron en el body
(default `false`/`null` de zod si no vienen, igual que cualquier otro
campo del contrato).

**Update/PATCH**: mismo criterio — un PATCH que sólo manda `allowsHours`
nunca incluye `finnegansValueUnit` en la data que llega al repositorio (y
viceversa), así que Prisma preserva el valor ya persistido de forma
nativa, sin necesitar ninguna función de sincronización.

**Frontend**: sin cambios de código en `NoveltyTypeRulesTab.tsx` ni
`NoveltyTypeFinnegansTab.tsx` (ya eran independientes, ver arriba). El
estado local (`item.rules`) es un único objeto compartido por ambas
secciones/pestañas — cualquier cambio se refleja de inmediato en el otro
control dentro del mismo render, sin necesitar recarga (confirmado con
test en `NoveltyTypeCreatePage.test.tsx`).

**`NoveltyModal`**: `resolveNoveltyQuantities(allowsHours, hoursImpact,
daysInRange)` — si `allowsHours` es `true`, envía `quantityHours` (nunca
`quantityDays`); si es `false`, envía `quantityDays` calculado del rango
de fechas (mismo criterio que el código previo a toda la serie 15L.2B,
antes de que existiera `finnegansValueUnit`). `finnegansValueUnit` ya no
se lee en absoluto dentro de este archivo.

**Combinaciones analizadas** (pedidas explícitamente):

| `allowsHours` | `finnegansValueUnit` | ¿Válida? | Qué pasa hoy |
| --- | --- | --- | --- |
| `true` | `null` (no exporta) | Sí | Envía `quantityHours`. Caso real: "Llegada tarde". |
| `true` | `UNIT` | Sí | Envía `quantityHours` igual (dato operativo); el exportador (no tocado) todavía puede no ignorarlo del todo, ver gap abajo. |
| `true` | `DAYS` | Sí | Envía `quantityHours` igual — el exportador leería `quantityHours` primero (`resolveValue1`), no `quantityDays`, ver gap abajo. |
| `false` | `HOURS` | Técnicamente aceptada por el modelo, pero **imposible de cargar desde `NoveltyModal` hoy** | El input "Cantidad de horas" no se muestra (`allowsHours=false`); `quantityHours` nunca llega desde este formulario. `NOVELTY_HOURS_NOT_ALLOWED` seguiría rechazando un intento directo por API. Confirmado con test explícito. |
| `false` | `null`/`DAYS`/`UNIT` | Sí | Envía `quantityDays` (siempre calculado del rango de fechas, sin gate propio). |

**Combinaciones todavía ambiguas / gaps para 15L.2C (no resueltos a
propósito en esta corrección puntual):**

- **`finnegansValueUnit=UNIT` o `DAYS` con `allowsHours=true` y el usuario
  sí completa una cantidad de horas**: el exportador (`finnegansExport.service.ts::resolveValue1`,
  no tocado) sigue el orden `quantityHours → quantityDays → "1"` — es
  decir, si `quantityHours` quedó seteado, el export lo va a usar aunque
  `finnegansValueUnit` diga `UNIT`/`DAYS`. El modelo de `Novelty` no tiene
  hoy ninguna forma de decir "esta cantidad es sólo para uso interno, no
  para exportar" — necesitaría una regla nueva (¿ignorar `quantityHours`
  en el exportador cuando `finnegansValueUnit !== "HOURS"`?) que **no se
  inventa en esta corrección puntual**, queda documentada para 15L.2C
  junto con la migración del exportador ya prevista.
- **`allowsHours=false` + `finnegansValueUnit=HOURS`**: confirmado
  imposible de ejercitar desde `NoveltyModal` (no hay ningún camino de UI
  para que `quantityHours` llegue a existir en una `Novelty` de un tipo
  así). Si el negocio realmente necesita esta combinación (el valor
  exportable sale de `quantityHours` pero el usuario nunca lo tipea a
  mano — por ejemplo, calculado automáticamente desde otro lado), hace
  falta diseñar explícitamente de dónde saldría ese dato — no se inventa
  acá.
- **`DAYS` sin ninguna capacidad operativa explícita**: no existe un
  `allowsDays` (ni se creó uno — instrucción explícita de no introducir
  "otro booleano improvisado"). Hoy `quantityDays` se calcula siempre del
  rango de fechas para cualquier tipo con `allowsHours=false`, sin ningún
  gate propio — mismo comportamiento que ya existía antes de toda la
  serie 15L.2B. Documentado como gap de diseño: si en el futuro se
  necesita una capacidad operativa explícita para "días" (independiente
  de "no permite horas"), es una decisión de 15L.2C, no de esta corrección.

**Tests**: ver §17 (actualizado) — se quitaron/reescribieron los tests que
afirmaban la sincronización eliminada y se agregaron los que confirman la
independencia en ambas direcciones, a nivel de función pura
(`noveltyTypes.sync.test.ts`), de servicio
(`noveltyTypes.service.test.ts`, `novelties.service.test.ts`) y de UI
(`NoveltyModal.test.tsx`, `NoveltyTypeCreatePage.test.tsx`).

**No se tocó**: `finnegansExport.*`, `MonthlyTimeClosure`, `closureLock`,
`TimeEntry`, columnas legacy de Prisma, `FinnegansNoveltyLink` como tabla.
No se creó ninguna migración (no hizo falta — ningún campo cambió de
tipo/estructura, sólo cambió qué código los sincroniza).
