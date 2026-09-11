# Etapa 14I.8 — Diagnóstico quirúrgico de `timeGridCatalogCache`

## 1. Resumen ejecutivo

`timeGridCatalogCache` (`employees.repository.ts:715`, TTL 120s, sin key/scope, catálogo global de `NoveltyType`+`HourConcept` activos) sigue siendo, tal como documentó 14I.1 (y antes 14A/9A), el único cache backend del proyecto sin ninguna función de invalidación explícita. **Pero el hallazgo central de esta etapa es otro, más importante y nunca detectado en 6+ auditorías previas (14A, 9A, 14I.1, 14I.3, 14I.6, 14I.7):** el query param que controla si esta cache se usa (`includeDetails`) está definido como `z.coerce.boolean().default(true)` (`employees.schemas.ts:198`), y **`z.coerce.boolean()` sobre el string `"false"` de un querystring da `true`** (`Boolean("false")` es `true` en JavaScript — verificado empíricamente, ver §15). El único caller real del proyecto (`EmployeeHoursPage.tsx`) siempre pide explícitamente `includeDetails: false`, con la intención documentada en `docs/BACKEND_API_CONTRACTS.md:251` de que eso desactive la rama pesada (novedades del período + catálogo) — pero por este bug, **el backend siempre ejecuta esa rama, en cada carga y en cada guardado de horas**, sin que la UI lo sepa.

La buena noticia, confirmada leyendo `EmployeeHoursPage.tsx` completo: el resultado de esa rama (`novelties`, `noveltyTypes`, `hourConcepts` embebidos en la respuesta) **se descarta por completo del lado del frontend** — la página arma su propio estado desde llamadas separadas (`noveltyTypeApiService.getAll()`, `grid.employee.hourConcepts`), nunca desde los campos embebidos. Por eso, aunque `timeGridCatalogCache` nunca se invalida y el bug de `includeDetails` la activa siempre, **el impacto funcional hoy es nulo** — nadie muestra ese dato. El impacto real es de **performance/trabajo desperdiciado**: 2-3 queries extra (novedades del período + catálogo global) corren en cada carga/guardado de la grilla horaria sin que el resultado se use nunca.

**No se tocó código productivo en esta etapa** (diagnóstico puro, como fue pedido). Se documenta todo con evidencia y se deja explícitamente para autorización del usuario si se quiere corregir el bug de `includeDetails` (que es el hallazgo accionable real) y/o agregar la invalidación de `timeGridCatalogCache` (que, dado lo anterior, es de prioridad baja).

## 2. Contexto 14I.1

14I.1 (commit `3abb3c4`, §6/§6.1/§10) catalogó `timeGridCatalogCache` como "variante C... único caso de las 22/34 caches sin ninguna invalidación explícita", P1, remitido explícitamente a una etapa dedicada por vivir en `employees.repository.ts` (Legajos, requiere autorización). 14I.3, 14I.6 y 14I.7 lo dejaron fuera de su alcance a propósito, nombrándolo cada vez como candidato para "la próxima etapa" — esta es esa etapa. A diferencia de las anteriores, el mandato acá es **diagnóstico primero, sin aplicar fix**, y eso permitió llegar más profundo que en las 6 auditorías previas (14A/9A/14I.1/14I.3/14I.6/14I.7), todas las cuales asumieron — sin verificarlo — que `includeDetails=false` efectivamente desactiva la rama pesada.

## 3. Ubicación de la cache

`backend/src/modules/employees/employees.repository.ts:711-736`:

```ts
type TimeGridCatalogs = {
  noveltyTypes: Awaited<ReturnType<typeof prisma.noveltyType.findMany>>;
  hourConcepts: Awaited<ReturnType<typeof prisma.hourConcept.findMany>>;
};
let timeGridCatalogCache: { data: TimeGridCatalogs; expiresAt: number } | null = null;
const TIME_GRID_CATALOG_CACHE_MS = 120_000;

async function getTimeGridCatalogs() {
  if (timeGridCatalogCache && Date.now() < timeGridCatalogCache.expiresAt) return timeGridCatalogCache.data;
  const [noveltyTypes, hourConcepts] = await Promise.all([
    prisma.noveltyType.findMany({ where: { status: "ACTIVO" }, include: { finnegansLinks: {...} }, orderBy: [...], take: 500 }),
    prisma.hourConcept.findMany({ where: { status: "ACTIVO" }, orderBy: [...], take: 100 }),
  ]);
  const data = { noveltyTypes, hourConcepts };
  timeGridCatalogCache = { data, expiresAt: Date.now() + TIME_GRID_CATALOG_CACHE_MS };
  return data;
}
```

Variable de módulo (no exportada), patrón manual `{data, expiresAt}` — mismo "one-off" ya descrito por 14I.1/14I.3 (no usa `createTtlCache` ni `createRepositoryListCache`). `getTimeGridCatalogs()` tampoco está exportada — sólo la llama `findTimeGrid` (línea 1215), dentro del mismo archivo.

## 4. Endpoint/caller

1. **Ruta**: `GET /employees/:id/time-grid` (`employees.routes.ts:116-121`), `requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria])`.
2. **Query params**: `period` (`YYYY-MM`, obligatorio), `includeDetails` (booleano, **default `true`** en el schema — ver §6/§15).
3. **Controller**: `employeesController.getTimeGrid` (`employees.controller.ts:112-119`) — cachea la respuesta completa en `employeeTimeGridCache` (cache **distinta**, controller-layer, `createTtlCache` 60s, key `${userId}:${role}:${id}:time-grid:${originalUrl}` — ya testeada en 14I.6, sin cambios acá).
4. **Service**: `employeesService.getTimeGrid(id, query, user)` (`employees.service.ts:479-488`) — arma `rows` vía `buildAdditiveTimeGrid(grid.normalConcept, grid.employee.hourConcepts, grid.entries, grid.breakdowns)` y aplica `redactPiiForRole`.
5. **Repository**: `employeesRepository.findTimeGrid(id, query, accessWhere)` (`employees.repository.ts:1191-1260`) — acá vive el `Promise.all` con la rama gateada por `query.includeDetails` (novedades del período + `getTimeGridCatalogs()`).
6. **Caller frontend real**: `employeeApiService.getTimeGrid(id, period, options)` (`employeeApiService.ts:718-733`) → **único consumidor en todo el frontend**: `EmployeeHoursPage.tsx`, en **2 lugares** (línea 151, carga inicial al montar/cambiar legajo o período; línea 208, re-sincronización silenciosa después de guardar una hora o un desglose manual) — **ambos pasan explícitamente `{ includeDetails: false }`**.

## 5. Datos cacheados

`timeGridCatalogCache` guarda exactamente 2 arrays, sin relación con ningún empleado/período/usuario puntual:
- `noveltyTypes`: **todos** los `NoveltyType` con `status: "ACTIVO"` (hasta 500), con su relación `finnegansLinks` completa incluida, ordenados por `status`,`name`.
- `hourConcepts`: **todos** los `HourConcept` con `status: "ACTIVO"` (hasta 100), ordenados por `kind`,`name`.

No contiene empleados, responsables, turnos, regímenes ni centros de costo — es puramente el catálogo compartido de "tipos de novedad" y "conceptos horarios" habilitados en el sistema, el mismo tipo de dato que ya sirven (con su propio cache, propia invalidación) `noveltyTypesController`/`hourConceptsController`.

## 6. TTL/key

- **TTL**: 120.000ms (120s) fijo.
- **Key**: ninguna — una única entrada global compartida por toda la aplicación (todos los empleados, todos los períodos, todos los usuarios reciben el mismo objeto cacheado mientras esté vigente).
- **¿Incluye usuario/rol/query/scope/fecha?**: no, ninguno — ni falta, porque el dato en sí no varía por ninguna de esas dimensiones (ver §5).

## 7. Scope/RBAC

Sin scope de usuario/rol, y **correctamente así**: `noveltyType.findMany`/`hourConcept.findMany` no reciben ningún `where` de acceso ni de empleado — es el mismo catálogo para RRHH, Supervisión y Carga Horaria (los 3 roles que pueden llegar a este endpoint). No hay ninguna dimensión de scope que pueda "mezclarse" entre usuarios porque el dato nunca varía por usuario. Sin riesgo de seguridad/PII (no hay DNI/CUIL/domicilio ni ningún dato personal en este catálogo).

## 8. Invalidaciones actuales

**Ninguna.** Confirmado por grep exhaustivo (`grep -rn "timeGridCatalogCache" backend/src`): las únicas 4 apariciones en todo el backend son la declaración, el chequeo de vigencia, la asignación en cache-miss y el único call site (`getTimeGridCatalogs()` dentro de `findTimeGrid`) — todas dentro de `employees.repository.ts`. No existe ninguna función exportada para limpiarla, y ningún otro módulo la referencia. Expira exclusivamente por TTL (120s).

## 9. Mutadores auditados

Se auditó completo el código real (no supuesto) de los 2 módulos cuyos datos alimentan esta cache:

- **`noveltyTypesService`** (`noveltyTypes.service.ts:58-70`): `create()` y `update()` — ambos llaman `invalidateNoveltyTypesCache()` (repositorio + controller-layer de **su propio módulo**, correcto desde 14I.3), pero ninguno de los dos tiene forma de alcanzar `timeGridCatalogCache` (que vive en otro módulo y no expone ninguna función de invalidación).
- **`hourConceptsService`** (`hourConcepts.service.ts:84-216`): `create()`, `update()` y `remove()` (tanto el delete físico sin uso como la baja lógica `status: INACTIVO` con `force: true`) — los 3 llaman `invalidateHourConceptsCache()` (mismo criterio, sólo su propio módulo). Ninguno alcanza `timeGridCatalogCache`.

**Conclusión**: si se crea un `NoveltyType`, se cambia su `status`/`finnegansLinks`, se crea/edita/desactiva un `HourConcept`, el catálogo embebido en `GET /employees/:id/time-grid` puede quedar desactualizado hasta 120s — exactamente lo que 14I.1 ya había señalado. Lo que 14I.1 (y las 5 etapas siguientes) no verificaron es si ese catálogo embebido **se usa realmente** — ver §10-§11.

## 10. Gaps reales encontrados

### 10.1 — Gap nombrado por el pedido: sin invalidación (confirmado, bajo impacto real)

Confirmado exactamente como lo describía 14I.1: sin invalidación, sólo TTL. Impacto: ver §11.

### 10.2 — Hallazgo nuevo, más significativo: `includeDetails` nunca se puede poner en `false` desde el cliente

`employees.schemas.ts:196-199`:
```ts
export const employeeTimeGridQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  includeDetails: z.coerce.boolean().default(true),
});
```

`z.coerce.boolean()` aplica `Boolean(valor)` de JavaScript. Un query param siempre llega como **string** (Express: `?includeDetails=false` → `req.query.includeDetails === "false"`, un string no vacío). `Boolean("false")` es **`true`** — cualquier string no vacío es *truthy* en JS, sin importar su contenido literal. Verificado empíricamente (§15) contra la versión real instalada (`zod@3.25.76`) y contra `validateQuery` (`schema.safeParse(req.query)`, sin ninguna transformación previa) — el bug es 100% reproducible en el código real, no una hipótesis.

**Consecuencia**: el único caller (`EmployeeHoursPage.tsx`) pide `includeDetails: false` en sus 2 llamadas, con la intención documentada en `docs/BACKEND_API_CONTRACTS.md:251` de desactivar la rama pesada — pero `query.includeDetails` **siempre** termina siendo `true` en el backend. La rama `query.includeDetails ? ... : Promise.resolve(...)` (3 sitios: select de empleado pesado vs. liviano, `novelty.findMany` del período vs. `[]`, `getTimeGridCatalogs()` vs. `null`) **siempre toma la rama pesada**, en cada uno de los 2 call sites de la página (carga inicial y re-sincronización silenciosa post-guardado).

## 11. Riesgo funcional

- **De la falta de invalidación en sí (§10.1)**: **ninguno hoy**. Se verificó leyendo `EmployeeHoursPage.tsx` completo: los 3 campos que dependen de `includeDetails` (`novelties`, `noveltyTypes`, `hourConcepts` en el nivel superior de la respuesta) se **descartan siempre** — la página los pisa con `setPeriodNovelties([])`/`setNoveltyTypes([])` y los repuebla desde una llamada **separada y correctamente cacheada/invalidada** (`fetchPeriodNovelties()` → `noveltyApiService.getAll()` + `noveltyTypeApiService.getAll()`), y arma las filas de conceptos horarios (`rows`) desde `grid.employee.hourConcepts` (los conceptos habilitados de ESE empleado) + `grid.normalConcept`, nunca desde el catálogo global embebido. Ningún componente lee `grid.hourConcepts`/`grid.noveltyTypes` del resultado de `getTimeGrid()`. Por lo tanto, aunque el catálogo esté desactualizado hasta 120s, **nadie lo ve, nadie lo usa para cargar/validar horas**. No puede afectar carga de horas, liquidación ni Fichador (no comparte código con ninguno de los tres).
- **Del bug de `includeDetails` (§10.2)**: es un problema de **trabajo desperdiciado**, no de corrección de datos. En cada carga inicial de la página Y en cada guardado de una hora/desglose manual (la re-sincronización silenciosa), el backend ejecuta 2-3 queries extra que su resultado nunca se usa: `novelty.findMany` (hasta 200 filas, con `include` completo) del período de ESE empleado — sin cache, corre siempre; y `getTimeGridCatalogs()` — con cache, así que sólo paga el costo real 1 vez cada 120s para toda la aplicación (las siguientes llamadas dentro de esa ventana son cache-hit, aunque el resultado se siga descartando).

## 12. Riesgo de seguridad/scope

Ninguno. Confirmado en §7 — catálogo sin ninguna dimensión de usuario/rol/scope, mismo dato para los 3 roles que acceden al endpoint. No hay PII ni dato sensible en `NoveltyType`/`HourConcept` activos.

## 13. Riesgo de performance

- El costo del catálogo (`getTimeGridCatalogs()`) está acotado por su propio TTL de 120s — es compartido globalmente, así que su costo marginal real es bajo (2 queries cada 120s como máximo para toda la app, no por request).
- El costo de `novelty.findMany` del período (sin ningún cache) **sí se paga en cada carga y en cada guardado**, por el bug de §10.2 — es el costo real y recurrente, no acotado por ningún TTL. No se midió con datos reales en esta etapa (fuera del alcance read-only pedido: no se ejecutó ninguna medición HTTP autenticada), pero es deducible directamente del código: es exactamente la misma query que ya corre cuando `includeDetails` sí se necesita de verdad, ejecutándose de más en un path que se diseñó para evitarla.
- Ninguno de los dos afecta el patrón de `$transaction`/N+1 ya auditado en 14I.1/14I.2 — ambas son queries `Promise.all` ya paralelas, sin problema de forma, sólo de necesidad.

## 14. Tests existentes/faltantes

- **Existentes**: `employees.pii.test.ts` (`"time-grid conserva datos operativos..."`) mockea `employeesRepository.findTimeGrid` completo — no ejercita `getTimeGridCatalogs()`/`timeGridCatalogCache` en absoluto, sólo prueba redacción de PII a nivel de servicio. `employeeApiService.test.ts` prueba el mapeo de la respuesta con `includeDetails: false` pasado por el cliente, pero mockea la respuesta HTTP directamente — no ejercita el schema de Zod real ni el bug de coerción.
- **Faltantes**: no existe ningún test que (a) confirme hit/miss/TTL/scope de `timeGridCatalogCache` en sí (mismo gap que 14I.1 nombró), (b) confirme qué pasa realmente con `query.includeDetails` cuando se le pasa `"false"` como string vía el schema real (`employeeTimeGridQuerySchema`) — este último es el que hubiera detectado el bug de §10.2 antes, si hubiera existido.

## 15. Medición o evidencia

Reproducción directa, read-only, sin tocar la base de datos ni el código productivo — ejecutada contra el `zod` real instalado en `backend/node_modules` (`zod@3.25.76`, confirmado con `node -e "console.log(require('zod/package.json').version)"`):

```
$ node -e "
const { z } = require('zod');
const schema = z.object({ includeDetails: z.coerce.boolean().default(true) });
console.log('query includeDetails=false ->', schema.parse({ includeDetails: 'false' }));
console.log('query includeDetails=true ->', schema.parse({ includeDetails: 'true' }));
console.log('query omitted ->', schema.parse({}));
console.log('Boolean(\"false\") raw JS ->', Boolean('false'));
"
query includeDetails=false -> { includeDetails: true }
query includeDetails=true -> { includeDetails: true }
query omitted -> { includeDetails: true }
Boolean("false") raw JS -> true
```

Confirmado además que `validateQuery` (`shared/validation/validateQuery.ts`) llama `schema.safeParse(req.query)` sin ninguna transformación previa — `req.query.includeDetails` en Express es exactamente el string `"false"` cuando la URL trae `?includeDetails=false`, idéntico al caso probado arriba. No se hizo ninguna llamada HTTP real al servidor corriendo ni se generó ningún dato — sólo se ejecutó el propio schema de Zod ya instalado, de forma aislada.

## 16. Qué NO se cambió

- `employees.repository.ts`, `employees.service.ts`, `employees.controller.ts`, `employees.schemas.ts`, `employees.routes.ts` — **cero líneas tocadas**, ni siquiera el bug de `includeDetails` encontrado en §10.2 (queda documentado, no corregido, a la espera de autorización explícita — ver §17).
- `noveltyTypes.service.ts`, `hourConcepts.service.ts` (ni sus repositorios/controllers) — sólo leídos para auditar sus mutadores, sin ninguna modificación.
- `timeGridCatalogCache`, `employeeTimeGridCache` (la cache controller-layer, ya testeada en 14I.6) — sin cambios de TTL/key/invalidación en ninguna de las dos.
- Doble capa de cache, `relationJoins`, Prisma schema — nada de esto se tocó.
- `EmployeeHoursPage.tsx`/`employeeApiService.ts` (frontend) — sólo leídos para confirmar el caller real y el uso (o no) de los campos embebidos, cero archivos modificados.
- Fichador, Gestión Horaria productiva (carga/aprobación/cierre real), Horas Especiales, Turnos/Regímenes — nada de esto se tocó ni se ejerció (sólo se leyó código de `hourConcepts`/`noveltyTypes` para entender la dependencia de datos, como pedía la consigna).
- No se ejecutó ninguna escritura real, ninguna migración, ningún dato de prueba creado. La única "ejecución" de esta etapa fue correr el propio `zod` instalado, de forma aislada, sin tocar la base de datos ni el servidor.

## 17. Recomendación final

**No aplicar ningún fix en esta etapa** (instrucción explícita: diagnóstico primero). Se identifican 2 acciones candidatas, de prioridad e impacto muy distintos, ambas requieren autorización explícita del usuario antes de tocar producción:

1. **(Prioridad real, alto valor, riesgo bajo) Corregir `includeDetails: z.coerce.boolean().default(true)`** en `employees.schemas.ts:198` — el fix típico es reemplazar el coerce ingenuo por un parseo consciente de strings de querystring, p. ej. `z.enum(["true", "false"]).default("true").transform((v) => v === "true")` (o equivalente), de forma que `?includeDetails=false` efectivamente desactive la rama pesada tal como el frontend ya intenta y como `docs/BACKEND_API_CONTRACTS.md:251` ya documenta como contrato. Esto reduciría trabajo real y recurrente (ver §11/§13) sin cambiar el contrato observable (el shape de la respuesta no cambia, sólo dejan de venir vacíos los 3 campos cuando `includeDetails=true` de verdad, y se ahorra el trabajo cuando el caller real pide `false`). **Requiere autorización explícita antes de tocar `employees.schemas.ts`** (producción, fuera del alcance de "sólo diagnóstico" de esta etapa).
2. **(Prioridad baja, dado el hallazgo de §11) Agregar invalidación a `timeGridCatalogCache`** desde `noveltyTypesService.create/update` y `hourConceptsService.create/update/remove` — técnicamente cierra el hallazgo original de 14I.1, pero su impacto real hoy es nulo (nadie consume el dato cacheado). Vale la pena hacerlo de todas formas si en algún momento se corrige (1) y/o si un futuro cambio de frontend empieza a leer los campos embebidos — pero no es urgente por sí solo. Alternativa igual de válida: **documentar explícitamente por qué no hace falta** (mismo criterio ya usado para "conjunto cerrado" en 14G.8), dado que hoy no tiene consumidor real.

Si el usuario autoriza (1), se recomienda hacerlo en una etapa separada y acotada (mismo patrón mecánico ya usado en toda la serie 14I: leer, cambiar 1 línea, agregar tests que confirmen `includeDetails=false` efectivamente da `false` y que la rama liviana se ejecuta, correr validaciones completas, documentar). Si además se autoriza (2), puede ir en la misma etapa (ambas tocan el mismo archivo/vecindario) o en una separada, a preferencia del usuario.

## 18. Recomendación para 14I.9

- Si no se autoriza ningún fix en el corto plazo: 14I.9 puede enfocarse en otro P1/P2 pendiente del inventario de 14I.1 (p. ej. `employeeOrgChartSelect` ya cerrado en 14I.5 sin acción, duplicado StrictMode de `time-grid`/`org-chart` nombrado por 14G.9 y nunca tomado, o el over-fetch de `finnegansLinks`/`timeEntryInclude` documentado como P2 en 14I.1 §8).
- Si se autoriza el fix de `includeDetails` (§17.1): 14I.9 debería ser exactamente esa etapa — acotada a `employees.schemas.ts` (1 línea) + tests nuevos que fijen el comportamiento correcto (`includeDetails=false` → rama liviana real, `includeDetails=true`/omitido → rama pesada real) + validaciones completas + medición antes/después si el entorno lo permite (confirmar con un `curl` autenticado o un test de integración que el payload de `novelties`/`noveltyTypes`/`hourConcepts` efectivamente viene vacío cuando se pide `false`).
- El duplicado StrictMode de `GET /employees/:id/time-grid` (x3, nombrado por 14G.9, nunca cerrado, mencionado de nuevo por 14I.1 §7) sigue sin diagnosticar — sería una etapa natural para combinar con el fix de `includeDetails` si se decide tocar este endpoint, ya que ambos hallazgos viven en el mismo caller (`EmployeeHoursPage.tsx`).
