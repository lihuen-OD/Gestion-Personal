# Etapa 12B — Backend/schema/API de clasificación `kind` en Horas Especiales

Fecha: 2026-08-31
Estado: implementado, validado, pendiente de aprobación para commitear
Continúa: `docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_12A.md` (diagnóstico y diseño aprobados; esta etapa los implementa)

## 1. Resumen ejecutivo

Se agregó el campo estructurado `DoubleHourRule.kind` (enum `DoubleHourRuleKind`: `FERIADO | DOMINGO | JORNADA_ESPECIAL | OTRO`, default `OTRO`, `NOT NULL`) exactamente como quedó diseñado y aprobado en 12A. Migración aditiva aplicada contra la base real (Neon staging) con el mismo criterio ya usado en las Etapas 8B/10D (generar SQL con `prisma migrate diff`, aplicar con `migrate deploy`, validar con `migrate status`, sin tocar migraciones históricas). Las dos reglas reales existentes ("Domingos" y "Feriados") quedaron en `OTRO` — verificado por lectura directa post-migración — sin ninguna inferencia por nombre, ni siquiera para la regla llamada literalmente "Feriados". `calendarPreview` ganó un filtro opcional por `kind`, sin cambiar su comportamiento por default. El motor de liquidación (`doubleHourRuleMatching.ts`, `timeEntries.repository.ts`) no se tocó y sigue ignorando `kind` por construcción — confirmado con evidencia de código y un test dedicado. Frontend actualizado con los tipos mínimos y un campo de formulario discreto ("Tipo de día especial"), sin rediseñar la pantalla. +21 tests backend, +5 tests frontend, todos verdes junto con los preexistentes (835→856 backend, 429→434 frontend). No se tocó Turnos, asignaciones de feriado, notificaciones de "Sin actividad registrada", Conceptos Horarios ni el fichador.

## 2. Qué se implementó

### 2.1 Prisma schema

[schema.prisma](../../backend/prisma/schema.prisma):
- Nuevo enum `DoubleHourRuleKind` (`FERIADO`, `DOMINGO`, `JORNADA_ESPECIAL`, `OTRO`), agregado junto a `RecurrenceType` — mismo patrón `<Modelo>Kind` que `HourConceptKind`/`WorkRegimeKind` ya usan en este schema.
- Nuevo campo `DoubleHourRule.kind DoubleHourRuleKind @default(OTRO)` (`NOT NULL` en base), agregado junto a `priority`.
- No se tocó ninguna otra tabla. `HourConceptKind.FERIADO` (Conceptos Horarios, dominio no relacionado) y `TimeSegment.isHoliday` (campo muerto de otro modelo, deuda documentada desde 8A) quedaron exactamente igual.

### 2.2 Backend — schemas Zod

[workforce.schemas.ts](../../backend/src/modules/workforce-management/workforce.schemas.ts):
- Nuevo `doubleHourRuleKindSchema = z.enum(["FERIADO", "DOMINGO", "JORNADA_ESPECIAL", "OTRO"])`, exportado y reutilizado en los dos puntos de entrada.
- `doubleRuleBaseSchema` (create/update) gana `kind: doubleHourRuleKindSchema.default("OTRO")` — sin mandarlo, la request queda con `kind: "OTRO"` antes de llegar al service; un valor fuera del enum se rechaza con 400 (no acepta texto libre).
- `calendarRangeQuerySchema` gana `kind: doubleHourRuleKindSchema.optional()` — sin mandarlo, `undefined`, comportamiento idéntico al de antes de esta etapa.

### 2.3 Backend — service/controller

[workforce.service.ts](../../backend/src/modules/workforce-management/workforce.service.ts):
- `createDoubleRule`/`updateDoubleRule`: **sin cambios de código** — ambos ya spreadean `...data` (todo el body validado, sin destructurar `kind`) directo a Prisma, así que el campo se persiste/actualiza automáticamente en cuanto el schema Zod lo acepta. `doubleRules()` (listado) también expone `kind` automáticamente — Prisma incluye todos los scalars por default en cualquier `findMany`/`include`, no hace falta agregarlo a ningún `select`.
- `calendarPreview(from, to, kind?)`: nuevo tercer parámetro opcional. Si viene, se agrega `kind` al `where` del `findMany` (`...(kind ? { kind } : {})`); sin él, el `where` es idéntico al de antes de esta etapa (verificado con test dedicado, ver §7). Cada entrada de `day.rules[]` ahora incluye `kind: rule.kind`.

[workforce.controller.ts](../../backend/src/modules/workforce-management/workforce.controller.ts):
- `doubleRulesCalendar` reenvía `req.query.kind` a `calendarPreview` — ya validado/coercido por `validateQuery(calendarRangeQuerySchema)` (mismo mecanismo que `from`/`to`), así que llega como `DoubleHourRuleKind | undefined` sin parseo adicional en el controller.

### 2.4 Frontend — tipos y UI mínima

[workforceApiService.ts](../../frontend/src/services/api/workforceApiService.ts): nuevo tipo `DoubleHourRuleKind`; `kind` agregado a `DoubleHourRule` (requerido, el backend siempre lo devuelve), `DoubleHourRuleInput` (opcional, el backend lo defaultea) y `DoubleHourRuleCalendarDay["rules"]`; `doubleHourRulesCalendar(from, to, kind?)` gana el filtro opcional (sin usar todavía desde ninguna pantalla — es el punto de extensión para la futura pantalla de Turnos).

[WorkScheduleSettingsPage.tsx](../../frontend/src/pages/WorkScheduleSettingsPage.tsx) — cambio mínimo, sin rediseño:
- Nuevo campo "Tipo de día especial" (`<select>` con las 4 opciones) en la sección "Datos principales", junto a Multiplicador/Prioridad — mismo patrón visual (`field`, `<small>` de ayuda) ya usado en el resto del formulario.
- Copy exacto del diseño aprobado en 12A: *"El tipo se usa para que otros módulos sepan cómo interpretar estas fechas. El nombre de la regla es sólo descriptivo."*
- `RuleFormState.kind`, default `"OTRO"`; se manda en el payload de create/update; `editRule` lo precarga desde la regla real.
- Nueva columna "Tipo" en la tabla de reglas, con un `Badge` reutilizando el componente ya existente (`tone="neutral"`), mostrando la clasificación real de cada regla — nunca el nombre.
- No se tocó el calendario visual (`SpecialHourRulesCalendarMonth.tsx`), ninguna otra pantalla, ni se creó ninguna pantalla nueva.

## 3. Migración

Generada con `prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --script` contra la base real (mismo criterio que 8B/10D — `prisma migrate dev` no se usó porque la migración histórica `20260824170000_normalize_hour_concepts` sigue fallando contra una shadow database vacía, problema preexistente y no tocado acá). El diff generado coincidió exactamente con el SQL esperado del diseño 12A:

```sql
-- CreateEnum
CREATE TYPE "DoubleHourRuleKind" AS ENUM ('FERIADO', 'DOMINGO', 'JORNADA_ESPECIAL', 'OTRO');

-- AlterTable
ALTER TABLE "DoubleHourRule" ADD COLUMN     "kind" "DoubleHourRuleKind" NOT NULL DEFAULT 'OTRO';
```

Guardado en `backend/prisma/migrations/20260831140000_add_double_hour_rule_kind/migration.sql` y aplicado con `npx prisma migrate deploy` (no usa shadow database) — "All migrations have been successfully applied." Confirmado después con `npx prisma migrate status`: 47 migraciones, "Database schema is up to date!".

## 4. Por qué default `OTRO`

Mismo razonamiento aprobado en 12A: sin cadena de fallback de 3 niveles (a diferencia de `WorkRegime.extendedShiftAlertMinutes`, Etapa 10D), un valor plano `NOT NULL DEFAULT 'OTRO'` es más simple que nullable y evita la ambigüedad "¿`null` es lo mismo que `OTRO`?". El `DEFAULT` en la misma sentencia `ALTER TABLE` hace que Postgres backfillee automáticamente **todas** las filas existentes sin ningún script separado ni heurística de texto.

**Verificación directa contra la base real, post-migración** (lectura de sólo lectura, sin escribir nada):

```json
[
  { "id": "c96b0fe1-...", "name": "Domingos", "kind": "OTRO" },
  { "id": "4ad12e97-...", "name": "Feriados", "kind": "OTRO" }
]
```

Confirma el punto central del diseño: la regla llamada literalmente **"Feriados"** quedó en `OTRO`, no en `FERIADO` — el sistema no adivinó nada por el nombre, ni siquiera en el caso más "obvio". Ambas reglas requieren que RRHH las reclasifique explícitamente desde la UI si corresponde.

## 5. Confirmación: `rule.name` no se usa para lógica

No se tocó `doubleHourRuleMatching.ts` (`ruleMatchesDate`, `resolveWinningRules`, `scopesCouldOverlap`) ni ninguna de las tres consultas a `DoubleHourRule` del motor real en `timeEntries.repository.ts` (`createFromWorkShift`, `closeOpenWorkShift`, `resolveDoubleHourMultiplierForManualEntry`) — ninguna de las seis funciones lee `name` para decidir nada, exactamente como estaba confirmado en el diagnóstico de 12A. El único cambio de esta etapa relacionado con `name` es que sigue siendo, sin excepción, texto de presentación: en `calendarPreview` (`day.rules[].name`), en el texto de observación de `timeEntries.repository.ts:1975` y en la UI (input/columna del formulario). El nuevo test de §7.3 (`doubleHourRuleMatching.test.ts`) prueba explícitamente que una regla "Pedro" clasificada `FERIADO` liquida exactamente igual que si estuviera clasificada `OTRO` — el `kind` no cambia el resultado del motor.

## 6. Confirmación: `kind` no afecta la liquidación

- **Estructuralmente ignorado por el motor real**: las tres queries de `timeEntries.repository.ts` que traen `DoubleHourRule` candidatas (`createFromWorkShift`/`closeOpenWorkShift`/`resolveDoubleHourMultiplierForManualEntry`) pasan el resultado completo de Prisma a `matchingDoubleHourRules`/`resolveWinningRules` — funciones puras tipadas explícitamente (`DoubleHourRuleForMatching`/`DoubleHourRuleForEngine`) que sólo desestructuran `recurrenceType`/`fromDate`/`toDate`/`weekdays`/`priority`/`multiplier`/`id`. `kind` viaja en el objeto (Prisma lo incluye como scalar por default) pero ningún punto del pipeline lo lee.
- **Test de no-regresión agregado** (`doubleHourRuleMatching.test.ts`, ver §7.3): dos reglas idénticas en todo salvo `kind` (una `FERIADO`, otra `OTRO`) producen exactamente el mismo resultado en `ruleMatchesDate` y `resolveWinningRules` (mismo `multiplier`, mismo `conflicting`, misma cantidad de ganadoras).
- **`hours`/`totalMinutes`/`actualMinutes`/`appliedMultiplier`**: ningún archivo de cálculo de horas reales/liquidables fue tocado en esta etapa — invariante desde la Etapa 8F, sin cambios.

## 7. Comportamiento de `calendarPreview` con y sin filtro

- **Sin `kind`** (comportamiento preexistente): `where` idéntico al de antes de esta etapa — verificado con un test que confirma `where.kind === undefined` cuando no se pasa el tercer argumento. Los 6 tests preexistentes de `calendarPreview` (Etapa 8B, overlap/conflict/payload chico/múltiples fechas) siguen pasando sin ninguna modificación.
- **Con `kind`**: se agrega al `where` de Prisma (`{ ..., kind: "FERIADO" }`) — verificado con un test que confirma el argumento exacto pasado a `prisma.doubleHourRule.findMany`.
- **Comportamiento end-to-end simulado**: un test con `findMany` mockeado para responder según el `where.kind` recibido (igual que respondería Postgres con el índice/filtro real) confirma: una regla **"Pedro"** con `kind=FERIADO` aparece en el filtro `FERIADO`; una regla **"Feriados"** con `kind=OTRO` **no** aparece; sin filtro, ambas aparecen sin importar el nombre. Un test separado confirma que una regla **"Domingo"** con `kind=DOMINGO` tampoco aparece en el filtro `FERIADO`.
- Cada entrada de `day.rules[]` incluye `kind` — el futuro consumidor de Turnos (no implementado en esta etapa) podría, si se decide reutilizar esta misma forma de respuesta, confiar en ese campo sin tener que volver a consultar la regla.

## 8. Tests agregados

**Backend** (+21 tests, 835 → 856, todos verdes):
- `workforce.schemas.test.ts` (+10): `kind` default `OTRO` sin mandarlo; acepta cada uno de los 4 valores válidos (`it.each`); rechaza un valor fuera del enum; `updateDoubleRuleSchema` permite reclasificar sólo `kind`; `calendarRangeQuerySchema` acepta `kind` opcional (ausente/`FERIADO`), rechaza uno inválido.
- `workforce.service.test.ts` (+9): crea con `kind` FERIADO/DOMINGO/JORNADA_ESPECIAL/OTRO (4 tests); `updateDoubleRule` reclasifica sin tocar el resto; `calendarPreview` sin `kind` no agrega filtro al `where` (regresión); `calendarPreview` con `kind` lo pasa exacto al `where`; caso "Pedro FERIADO aparece / Feriados OTRO no aparece" con filtro y sin filtro; caso "Domingo (kind=DOMINGO) no aparece en el filtro FERIADO".
- `doubleHourRuleMatching.test.ts` (+2): `ruleMatchesDate` matchea igual sin importar `kind` (la función ni lo lee); `resolveWinningRules` resuelve prioridad/multiplicador/conflicto igual para una regla "Pedro" sea `FERIADO` o `OTRO`.

**Frontend** (+5 tests, 429 → 434, todos verdes), en `WorkScheduleSettingsPage.test.tsx`:
- El formulario arranca con "Tipo de día especial" = Otro (default seguro, sin regla creada).
- El copy no usa lenguaje técnico (sin "kind"/"enum"/nombres de modelo visibles).
- Seleccionar "Feriado" y crear manda `kind: "FERIADO"` en el payload.
- Editar una regla existente precarga su clasificación real (no el default).
- La tabla muestra la clasificación de cada regla sin depender del nombre — una regla llamada "Domingo" pero clasificada `FERIADO` se lista con el badge "Feriado", no "Domingo".

**Corrección de un efecto colateral en tests preexistentes** (no un bug de producción): agregar el `<option>Domingo</option>`/`<option>Feriado</option>` al nuevo `<select>` introdujo coincidencias de texto ambiguas contra 14 aserciones preexistentes que usaban `screen.findByText("Domingo")`/`getByText("Domingo")` sin acotar (porque esos textos ya existían en la tabla). Se corrigieron acotando la búsqueda al elemento real (`{ selector: "b" }` para el nombre en la tabla, `{ selector: "span" }` para el badge nuevo), sin cambiar ninguna aserción de negocio — mismo criterio de accesibilidad ya aplicado en la Etapa 10D para el campo "Prioridad" (`exact: false` cuando el `<small>` de ayuda vive dentro del mismo `<label>`), aplicado acá también al nuevo campo "Tipo de día especial".

## 9. Validaciones ejecutadas

| Validación | Resultado |
| --- | --- |
| `npx prisma validate` (backend) | ✅ schema válido |
| `npx prisma generate` (backend) | ✅ |
| `npx prisma migrate status` (backend) | ✅ "Database schema is up to date!" (47 migraciones) |
| `npm run typecheck` (backend, `tsc --noEmit`) | ✅ sin errores |
| `npx vitest run` (backend) | ✅ 856/856 tests, 62 archivos |
| `npm run build` (backend) | ✅ |
| `npx tsc -b` (frontend) | ✅ sin errores |
| `npx vitest run` (frontend) | ✅ 434/434 tests, 56 archivos |
| `npm run build` (frontend) | ✅ |
| `git diff --check` | ✅ sin errores de espacios en blanco |

## 10. Qué NO se tocó

- El motor de matching/prioridad/scope (`doubleHourRuleMatching.ts`) — código de producción sin cambios; sólo se agregaron tests que prueban que ignora `kind`.
- `createFromWorkShift`/`closeOpenWorkShift`/`resolveDoubleHourMultiplierForManualEntry` (`timeEntries.repository.ts`) — el fichador y la carga manual, sin cambios.
- `TimeEntry.hours`/`totalMinutes`/`actualMinutes`/`appliedMultiplier` — invariante de horas reales vs. liquidables (Etapa 8F) intacto.
- Conceptos Horarios (`hour-concepts`) — ningún archivo tocado; `HourConceptKind.FERIADO` sigue siendo un enum paralelo sin relación de datos con `DoubleHourRuleKind`.
- `TimeSegment.isHoliday` — sigue muerto, sin escritor, tal como estaba documentado desde la Etapa 8A.
- Turnos (`backend/src/modules/shifts/`) — ningún archivo tocado. No se creó ninguna pantalla ni endpoint de "asignaciones de trabajo en feriados".
- Notificaciones "Sin actividad registrada" (`attendanceInactivity.service.ts`) — el hallazgo documentado en 12A §4.10 sigue sin corregir, a propósito.
- El calendario visual (`SpecialHourRulesCalendarMonth.tsx`) — no se le agregó ningún indicador de `kind`; sigue mostrando exactamente lo mismo que antes.
- Permisos/RBAC de `double-hour-rules*` — sin cambios (lectura RRHH/Supervisión/Carga Horaria, escritura sólo RRHH).
- Cache (`workforce.cache.ts`, `doubleRulesCache`, TTL 30s) — sin cambios; el conjunto de escrituras que invalida sigue siendo el mismo (create/update/remove de `DoubleHourRule`), agregar un campo más a esas escrituras no abre ningún hueco nuevo.

## 11. Riesgos pendientes

- Las 2 reglas reales existentes ("Domingos", "Feriados") quedaron en `OTRO` y **no se reclasificaron automáticamente** — es la decisión de diseño correcta (nunca adivinar por nombre), pero significa que, hasta que RRHH las reclasifique manualmente desde la UI, el futuro filtro `kind=FERIADO` de Turnos no las va a encontrar aunque sus nombres lo sugieran. Acción de seguimiento recomendada: avisar a RRHH para que reclasifique esas 2 reglas una vez que esta etapa se apruebe.
- El campo `kind` todavía no lo consume ningún endpoint real de Turnos — el filtro en `calendarPreview` queda listo pero sin usar hasta 12D.
- El nuevo campo del formulario no fue validado visualmente en un navegador real (sólo tests automatizados) — recomendable una revisión visual rápida antes de dar por cerrada la etapa, dado que `CLAUDE.md`/`AGENTS.md` piden confirmar calidad visual en cambios de UI.
- Los riesgos ya documentados en 12A (§10 de ese doc) siguen vigentes sin cambios — ninguno fue agravado ni resuelto por esta etapa, salvo los puntos 1 ("romper liquidación") y 4 ("clasificar mal reglas existentes"), que quedaron confirmados mitigados con evidencia real de esta implementación.

## 12. Próximos pasos sugeridos

- **12C** — Frontend UX completa, si se prioriza ampliar más allá del campo mínimo agregado acá (por ejemplo, indicador visual de `kind` en el calendario mensual `SpecialHourRulesCalendarMonth.tsx`).
- **12D** — Pantalla de Turnos → Asignaciones de trabajo en feriados, consumiendo el filtro `kind=FERIADO` ya preparado en `calendarPreview`/`doubleHourRulesCalendar`, sin duplicar el cálculo de calendario (contrato ya diseñado en 12A §12).
- **12E** — Notificación "Sin actividad registrada" según expectativa real de actividad (hallazgo documentado en 12A §4.10 y reconfirmado acá, sin tocar) — candidata a etapa dedicada una vez que 12D exista, para poder distinguir "no vino un feriado sin convocatoria" de "no vino un día común".

---

No commitear sin aprobación explícita del usuario.
