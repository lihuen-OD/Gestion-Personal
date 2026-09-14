# Etapa 15G.1 — Novedades como justificación administrativa (fichador/carga horaria son la fuente de verdad)

> Este documento **reemplaza** a una versión previa de esta misma etapa
> (`docs/decisions/NOVELTY_TIME_EFFECTS_SAFETY_15G1.md`, ya eliminada) que
> dejaba un mecanismo de "efecto horario seguro" — una novedad `APROBADO`
> con `setsWorkedHoursToZero` todavía podía escribir `TimeEntry` en 0,
> validando antes el cierre mensual y que la hora no estuviera ya aprobada.
> Una decisión funcional posterior del usuario cambió el criterio: **ese
> mecanismo se elimina por completo**, no se deja como "seguro" — Novedades
> no debe tocar horas bajo ningún caso. No debe quedar ninguna referencia a
> la versión anterior como vigente; este documento es la única fuente de
> verdad sobre el tema desde ahora.

## 1. Contexto

La Etapa 15G (auditoría, sólo lectura) mapeó cómo funciona Novedades y su
relación con Carga Horaria, disparada por el caso: una novedad de "Llegada
tarde" de 1h, aprobada, no descuenta esa hora en Carga Horaria. La primera
versión de 15G.1 cerró un riesgo P0 real (una novedad podía escribir
`TimeEntry` saltando el gate de `MonthlyTimeClosure` de la Etapa 15E, y una
novedad `PENDIENTE` podía zerar horas antes de aprobación) pero mantuvo un
camino — ahora "seguro" — para que una novedad `APROBADO` con
`setsWorkedHoursToZero` siguiera escribiendo `TimeEntry` en 0.

El usuario definió, después de esa primera versión, el criterio funcional
final: **el fichador y la carga horaria manual son la única fuente de
verdad de horas reales**; Novedades es **justificación administrativa** —
se registra, se aprueba/rechaza, se ve en Carga Horaria y eventualmente se
exporta a Finnegans o dispara desde una alerta del fichador, pero **nunca**
crea, modifica, ni pone en 0 un `TimeEntry`, y nunca recalcula horas
trabajadas.

## 2. Decisión

1. **Crear una novedad nunca crea ni modifica `TimeEntry`.** Esto aplica
   siempre: `status` `PENDIENTE` o `APROBADO`, la cree RRHH o cualquier otro
   rol, y sin importar los campos horarios del `NoveltyType`
   (`setsWorkedHoursToZero`, `blocksTimeEntry`, `timeImpact = BLOQUEA_CARGA_DIA`).
2. **Aprobar una novedad nunca crea ni modifica `TimeEntry`.** `approve`
   sólo cambia `status`/`approvedByUserId`/`approvedAt` + registra
   auditoría — ningún campo del tipo dispara ninguna escritura sobre horas.
3. **Rechazar sigue sin tocar `TimeEntry`** (ya era así, y ahora es
   trivialmente cierto porque nunca hubo nada que escribir).
4. **`setsWorkedHoursToZero` queda neutralizado como mecanismo de
   escritura**, hacia adelante: el campo se sigue persistiendo y
   exponiéndose (viene del catálogo de tipos, no se tocó el schema), pero
   **no existe ningún código productivo que lo lea para escribir
   `TimeEntry`**. No se dejó como "deprecated pero invocable" — se eliminó
   la función que lo hacía (`applyNoveltyZeroHoursEffect`/
   `novelties.timeEffects.ts`, junto con el `options.createZeroTimeEntries`
   que la disparaba desde `createMany`, y el `effect` que `approve` armaba y
   pasaba al repositorio). No queda ninguna puerta productiva para volver a
   escribir horas desde Novedades por accidente.
5. **`blocksTimeEntry` / `timeImpact = BLOQUEA_CARGA_DIA` (y también
   `setsWorkedHoursToZero`, que ya formaba parte del mismo `OR`) siguen
   pudiendo bloquear la creación de una hora manual NUEVA** — esto es
   "bloqueo de carga futura", nunca modificación de una hora existente.
   Sigue siendo el comportamiento ya soportado y testeado desde la primera
   versión de 15G.1: `timeEntries.repository.ts::findBlockingNovelty` sólo
   bloquea si la `Novelty` está `status = APROBADO` — una `PENDIENTE` no
   bloquea. No se amplió ni se tocó esta regla en este ajuste.
6. **`MonthlyTimeClosure`**: como Novedades ya no escribe `TimeEntry` en
   ningún caso, no hay ninguna escritura horaria desde Novedades que pueda
   violar un cierre — el riesgo P0 original queda cerrado por eliminación
   del mecanismo, no por una validación adicional. `time-entries` sigue
   siendo el único módulo que consulta `MonthlyTimeClosure` para
   crear/editar horas (Etapa 15E, sin cambios).
7. **Carga Horaria sigue mostrando Novedades** — la etiqueta/badge/color por
   día (`timeEntries.repository.ts`, `noveltyCoversDay`) no se tocó: sigue
   siendo 100% informativo, nunca resta del total.
8. **Llegada tarde**: se registra, se aprueba/rechaza, se ve en Carga
   Horaria — no descuenta, no toca `TimeEntry`. Más adelante podrá
   originarse desde una alerta de puntualidad del fichador (Alertas → Crear
   Novedad, fuera de alcance todavía).

## 3. Qué NO se implementó en esta etapa

- Descuento parcial de horas (llegada tarde restando 1h del total real o
  liquidable). Sigue sin existir ningún mecanismo de descuento — ni
  todo-o-nada ni parcial.
- Alertas → Crear Novedad.
- Cambios a Finnegans (el módulo `finnegans-export` no se tocó).
- Migraciones ni cambios de `schema.prisma`/DB — `NoveltyType.setsWorkedHoursToZero`
  sigue existiendo en el modelo (se dejó de leer para escribir horas, no se
  quitó del schema).
- Nuevos tipos de novedades ni cambios al seed.
- Solapamiento/duplicado entre novedades (deuda ya documentada en
  `docs/PROJECT_CONTEXT.md`, sin cambios).

## 4. Riesgo residual

- **Resuelto en este ajuste:** `noveltiesService.remove()` ya no tiene el
  guard `409 NOVELTY_DELETE_HAS_TIME_IMPACT` ("Novelty generated time
  entries") para tipos con `setsWorkedHoursToZero`. Ese bloqueo sólo tenía
  sentido cuando ese campo efectivamente generaba un `TimeEntry` (antes de
  esta etapa); como ya nunca es el caso, se eliminó por completo en vez de
  renombrarlo — no quedaba ninguna razón administrativa real para bloquear
  el borrado sólo por ese campo. El guard de `NOVELTY_DELETE_HAS_DOCUMENTS`
  (documentos relacionados) y el de `NOVELTY_DELETE_EXPORTABLE_APPROVED`
  (novedad `APROBADO` y `exportsToFinnegans`) siguen intactos — ese segundo
  sigue siendo el único motivo real para no dejar borrar una novedad ya
  aprobada. El frontend (`frontend/src/services/api/apiClient.ts`) todavía
  tiene el mapeo de mensaje para `NOVELTY_DELETE_HAS_TIME_IMPACT` — queda
  como código inerte (el backend ya nunca devuelve ese código), no se tocó
  por estar fuera de alcance del backend en esta etapa.
- El frontend (`EmployeeHoursPage.tsx::isBlocked`) sigue decidiendo
  visualmente si un día está "bloqueado" mirando cualquier novedad que lo
  cubra sin filtrar por `status` — no se tocó frontend en esta etapa (sigue
  siendo un desfasaje visual menor con el backend, ya señalado en la
  primera versión de 15G.1).
- El descuento parcial de horas y la relación con Finnegans/liquidación
  siguen siendo decisiones de negocio abiertas.

## 5. Tests

- Se eliminó `novelties.timeEffects.test.ts` junto con el módulo que
  testeaba (`novelties.timeEffects.ts`, ya no existe).
- `novelties.repository.test.ts`: los `describe` de `createMany`/`approve`
  se reescribieron para fijar que ninguno de los dos acepta ya un parámetro
  de "efecto horario" (`createMany.length === 3`, `approve.length === 2`) y
  que sólo tocan el modelo `Novelty` (el `tx` mockeado en los tests ni
  siquiera expone `timeEntry`/`monthlyTimeClosure` — si el código intentara
  usarlos, el test fallaría por `TypeError`).
- `novelties.service.test.ts`: nuevo `it.each` que cubre las 4
  combinaciones sensibles (PENDIENTE/APROBADO × setsWorkedHoursToZero
  true/false) confirmando que `createMany` siempre se llama con exactamente
  3 argumentos; tests explícitos para `timeImpact = REGISTRA_HORAS_NO_TRABAJADAS`
  (caso "llegada tarde") y `timeImpact = BLOQUEA_CARGA_DIA` sin ningún
  efecto horario; `approve()` con un tipo `setsWorkedHoursToZero=true` llama
  a `repo.approve` con la misma firma de 2 argumentos que cualquier otro
  tipo.
- `timeEntries.repository.test.ts`: sin cambios respecto a la primera
  versión de 15G.1 — el test de `findBlockingNovelty` (sólo `APROBADO`
  bloquea carga futura) sigue vigente y vale tal cual.
- `novelties.service.test.ts` (ajuste de residual): nuevo
  `describe("noveltiesService.remove")` — `remove()` no tenía ningún test
  antes. Cubre: borrado exitoso sin documentos/exportable; un tipo con
  `setsWorkedHoursToZero=true` **ya no** bloquea el borrado (regresión
  directa del fix); el guard de documentos relacionados sigue intacto; el
  guard de novedad `APROBADO` + `exportsToFinnegans` sigue intacto; una
  novedad exportable pero todavía `PENDIENTE` sí se puede borrar; 404 si no
  existe/está fuera de alcance.

Suite completa: `npm test` (backend) — 105 archivos, 1539 tests, todos en
verde. `npx tsc -p tsconfig.json --noEmit`, `npx prisma validate` y
`npm run build` sin errores.
