# Etapa 14I.9 — Corrección del bug de coerción de `includeDetails`

## 1. Contexto

Etapa mecánica y quirúrgica, autorizada explícitamente por el usuario tras el diagnóstico de 14I.8 (commit pendiente): corrige el único hallazgo accionable real de ese diagnóstico — `employeeTimeGridQuerySchema.includeDetails` (`employees.schemas.ts:198`) usaba `z.coerce.boolean()`, que aplica `Boolean(valor)` de JavaScript. Como un query param HTTP siempre llega como string, `Boolean("false")` es `true` (cualquier string no vacío es *truthy*) — así que `?includeDetails=false` nunca desactivaba la rama pesada de `employeesRepository.findTimeGrid` (novedades del período + `getTimeGridCatalogs()`, la función detrás de `timeGridCatalogCache`), contrario a la intención documentada tanto en el código del único caller (`EmployeeHoursPage.tsx`, que siempre pide `includeDetails: false`) como en `docs/BACKEND_API_CONTRACTS.md:251`.

## 2. Relación con 14I.8

14I.8 (diagnóstico) confirmó, con una reproducción aislada y verificada contra el `zod@3.25.76` real instalado, que el bug es 100% real y reproducible, y que **nunca fue detectado en 6 auditorías previas** (14A, 9A, 14I.1, 14I.3, 14I.6, 14I.7) porque todas asumieron —sin verificarlo— que `includeDetails=false` funcionaba. 14I.8 identificó 2 acciones candidatas (corregir el bug de `includeDetails`, y agregar invalidación a `timeGridCatalogCache`) y las dejó pendientes de autorización explícita, sin tocar producción. El usuario autorizó la primera (este fix) al cerrar 14I.8; la segunda (invalidación de `timeGridCatalogCache`) queda **sin tocar**, documentada como de prioridad baja dado que hoy no tiene consumidor real (ver 14I.8 §11).

## 3. Cambio aplicado

`backend/src/modules/employees/employees.schemas.ts::employeeTimeGridQuerySchema`:

```ts
// Antes
includeDetails: z.coerce.boolean().default(true),

// Después
includeDetails: z.preprocess((value) => (value === "false" ? false : value), z.coerce.boolean()).default(true),
```

El `preprocess` mapea exactamente el string `"false"` a un booleano real `false` **antes** de que `z.coerce.boolean()` lo evalúe — para cualquier otro valor (incluido cualquier otro string, un booleano real, o `undefined`), el comportamiento es idéntico al de antes del fix. Es deliberadamente el cambio más chico posible: no reemplaza `z.coerce.boolean()` por un schema distinto, no introduce una nueva forma de declarar booleanos en el proyecto, sólo intercepta el único caso roto.

## 4. Por qué este fix y no otro

Se evaluó (y se descartó) `z.enum(["true", "false"]).default("true").transform((v) => v === "true")`: funciona igual de bien para el único caller real, pero es un cambio de comportamiento más amplio — rechazaría con 400 cualquier valor que hoy se acepta silenciosamente (p. ej. `?includeDetails=1`, que hoy da `true` igual que antes). El `preprocess` elegido preserva el comportamiento de "acepta cualquier cosa, coerciona de forma laxa" que ya tenía el endpoint, cambiando únicamente el caso puntual que estaba roto — más quirúrgico, menor superficie de riesgo, consistente con el criterio de toda la serie 14I ("cambio mínimo, evidencia campo por campo").

Verificado empíricamente antes de aplicarlo (mismo método que 14I.8, `node -e` contra el zod real instalado):

```
{"period":"2026-09","includeDetails":"false"} -> {"period":"2026-09","includeDetails":false}
{"period":"2026-09","includeDetails":"true"}  -> {"period":"2026-09","includeDetails":true}
{"period":"2026-09"}                          -> {"period":"2026-09","includeDetails":true}
{"period":"2026-09","includeDetails":"False"} -> {"period":"2026-09","includeDetails":true}
{"period":"2026-09","includeDetails":"0"}     -> {"period":"2026-09","includeDetails":true}
```

## 5. Qué NO se cambió

- `employees.repository.ts`, `employees.service.ts`, `employees.controller.ts`, `employees.routes.ts` — ninguno necesitaba cambios: la rama `query.includeDetails ? ... : Promise.resolve(...)` de `findTimeGrid` siempre estuvo bien escrita, el bug era exclusivamente de parseo del query param, antes de que el booleano llegara ahí (confirmado con los 3 tests nuevos de `findTimeGrid`, ver §6).
- `timeGridCatalogCache` — sin invalidación agregada (candidato B de 14I.8, explícitamente no autorizado en esta etapa; sigue documentado en 14I.8 como de prioridad baja dado que hoy no tiene consumidor real).
- `noveltyTypes.service.ts`, `hourConcepts.service.ts` — sin cambios.
- `EmployeeHoursPage.tsx`/`employeeApiService.ts` (frontend) — sin cambios; el fix es enteramente del lado del backend, transparente para el cliente (que ya envía `includeDetails=false` desde siempre, ahora simplemente empieza a funcionar como se esperaba).
- Contrato API, shape de respuesta — el shape no cambia (siguen siendo los mismos campos `novelties`/`noveltyTypes`/`hourConcepts`); lo único que cambia es que, cuando el caller realmente pide `includeDetails=false`, esos 3 campos ahora sí vienen vacíos (que es exactamente lo que `docs/BACKEND_API_CONTRACTS.md:251` ya documentaba como contrato esperado).
- RBAC/scope, `relationJoins`, Prisma schema, Fichador, Gestión Horaria productiva, Horas Especiales, Turnos/Regímenes — nada de esto se tocó.
- No se ejecutó ninguna escritura real, no se corrió ningún journey.

## 6. Tests agregados

**7 tests nuevos** en `backend/src/modules/employees/employees.schemas.test.ts` (archivo nuevo, primer test de schemas para este módulo):
1. `includeDetails: "false"` (string, como llega un query param real) → `false`.
2. `includeDetails: "true"` → `true`.
3. Sin el param → default `true` (comportamiento preservado).
4. `includeDetails: false` (booleano real, uso directo desde código) → `false`.
5. `includeDetails: true` (booleano real) → `true`.
6. El fix es deliberadamente acotado: `"False"` (mayúscula), `"0"`, `"no"` siguen coercionando a `true` — documenta explícitamente el límite exacto del cambio (§4).
7. `period` sigue validando el formato `YYYY-MM` sin cambios por este fix.

**3 tests nuevos** en `backend/src/modules/employees/employees.repository.test.ts` (nuevo describe `"employeesRepository.findTimeGrid — includeDetails (Etapa 14I.9)"`), que confirman que el repositorio en sí **nunca fue el bug** — ya se comportaba bien una vez que `query.includeDetails` llega como booleano real:
1. `includeDetails: true` → `novelty.findMany`/`noveltyType.findMany`/`hourConcept.findMany` (catálogo) se llaman, `novelties`/`noveltyTypes`/`hourConcepts` vienen con datos.
2. `includeDetails: false` → ninguna de esas 3 queries se llama, los 3 campos vienen `[]`.
3. `includeDetails: false` en llamadas sucesivas (2 períodos distintos) → sigue sin llamarlas — no es una cuestión de cache, la rama directamente no se ejecuta.

Se extendió el mock compartido de `prisma` en `employees.repository.test.ts` (agregando `noveltyType.findMany`, `workShift.count`, `attendancePunch.count`, `hourConceptBreakdown.findMany`, y las claves faltantes `hourConcept.findFirst`/`timeEntry.findMany`) — **sólo se agregaron claves nuevas o se extendieron objetos existentes, ninguna clave ya usada por otro test del archivo fue eliminada o renombrada**; los 35 tests preexistentes de ese archivo siguen pasando sin cambios (confirmado, ver §7).

Ningún test depende de tiempos reales. Ningún mock oculta el comportamiento bajo prueba.

## 7. Validaciones

- `npx prisma validate` ✅ schema válido, sin cambios.
- `npm run typecheck` ✅ sin errores.
- `npm test` ✅ **1393/1393** (95 archivos, +10 tests nuevos vs. los 1383 de cierre de 14I.7; los 35 tests preexistentes de `employees.repository.test.ts` y los de `employees.pii.test.ts`/`employeeApiService.test.ts` — que ya usaban `includeDetails: false` como booleano directo, sin pasar por el schema — siguen pasando sin cambios).
- `npm run build` ✅ sin errores.
- `git diff --check` ✅ sin errores de espacios en blanco.
- `git status --short` / `git diff --stat`: 2 archivos modificados (`employees.schemas.ts`, +9 líneas; `employees.repository.test.ts`, +73 líneas) + 1 archivo de test nuevo (`employees.schemas.test.ts`).
- No se corrió ningún journey — el fix está acotado a un schema Zod + tests unitarios, sin tocar frontend/e2e ni cambiar contrato observable para el único caller real (que ya enviaba `includeDetails=false`, ahora simplemente empieza a recibir lo que siempre pidió).
- No se ejecutó ninguna escritura real.

## 8. Riesgos pendientes

- Ninguno introducido — el fix es acotado (1 campo de 1 schema), verificado empíricamente antes y después, con tests que fijan tanto el caso roto como el límite exacto de lo que cambia.
- El `EmployeeHoursPage.tsx` empezará a recibir, en sus 2 llamadas reales, `novelties: []`, `noveltyTypes: []`, `hourConcepts: []` en vez de arrays potencialmente poblados — confirmado en 14I.8 que esto es exactamente el comportamiento que la página ya asume (los pisa con `setPeriodNovelties([])`/`setNoveltyTypes([])` incondicionalmente y nunca lee `grid.hourConcepts`), así que no hay ningún cambio observable de UI. Ahora además se ahorra el trabajo de servidor que antes se hacía y se descartaba (el objetivo real del fix).
- `timeGridCatalogCache` sigue sin invalidación — deuda ya documentada en 14I.8, no autorizada en esta etapa. Con este fix, su costo real de invocación baja (ya no se llama en cada carga/guardado de horas si el caller pide `includeDetails=false`, que es siempre hoy) — mitiga aún más el impacto de la falta de invalidación, sin eliminarlo del todo (si algún caller futuro pide `includeDetails=true` de verdad, el catálogo sigue sin invalidarse por mutaciones de `NoveltyType`/`HourConcept`).

## 9. Recomendación para 14I.10

- **Invalidación de `timeGridCatalogCache`** (candidato B de 14I.8, no autorizado en esta etapa) — sigue disponible si se quiere cerrar el hallazgo original de 14I.1 por completo, aunque su prioridad bajó más todavía tras este fix (el catálogo se pide con mucha menor frecuencia ahora).
- **Duplicado StrictMode de `GET /employees/:id/time-grid` (x3)** — nombrado por 14G.9, nunca cerrado, vive en el mismo caller (`EmployeeHoursPage.tsx`) que este fix — buen candidato para combinar en una futura etapa si se decide tocar ese archivo de nuevo.
- Ningún otro seguimiento urgente — el inventario de `$transaction`/over-fetch/cache de 14I.1 queda, con esta etapa, con todos sus hallazgos P0/P1 accionables cerrados o explícitamente documentados como de bajo impacto (P2/P3) con evidencia real, no supuesta.
