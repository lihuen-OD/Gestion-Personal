# Etapa 14D.5 — Deduplicación y carga inicial del detalle de Legajos

Fecha: 2026-09-04
Estado: diagnóstico completo, implementado, validado, **pendiente de aprobación para commitear**
Alcance: exclusivamente la apertura de `/legajos/:id` — específicamente `GET /employees/:id/overview` y `GET /employees/:id/overview-details` consumidos por `EmployeeDetailPage.tsx`. Sin cambios de schema/migraciones, sin cambios de reglas funcionales, sin cambios de permisos/RBAC, sin cambios de contrato de API, sin cambios de componente/UI.

---

## 1. Diagnóstico (Parte 1 del pedido, 35 puntos)

### 1.1-1.4 Quién llama cada endpoint, y desde dónde

Confirmado con grep sobre `getOverviewById|getOverviewDetailsById` en todo `frontend/src`: **un único call site para cada uno, ambos en el mismo componente, mismo `useEffect`** (`EmployeeDetailPage.tsx:105-127`, deps `[id, loadRetry]`). No hay hooks separados que carguen el mismo empleado — es literalmente el mismo bloque de efecto disparando ambas llamadas en paralelo (no encadenadas).

### 1.5 useEffect con dependencias inestables

**No.** Las deps son `[id, loadRetry]` — `id` viene de `useParams()` (string primitivo), `loadRetry` es un `number` de `useState`. Ninguna es un objeto/función recreado en cada render. Se descarta como causa.

### 1.6-1.8 StrictMode, y si el journey corre en dev con StrictMode activo

- `frontend/src/main.tsx:15` confirma `<React.StrictMode>` envolviendo toda la app.
- `frontend/vite.config.ts:7` fija `server.port: 5174` — el proceso realmente escuchando en `localhost:5174` durante esta sesión es `node .../node_modules/.bin/vite` (confirmado con `ps`), es decir **el dev server real, con StrictMode activo**, no un build. `playwright.config.ts` apunta por defecto a `http://localhost:5174` — confirma que el journey mide siempre contra dev.
- React 18 StrictMode monta→desmonta→remonta cada componente una vez en dev, duplicando cualquier disparo de efecto de sólo-montaje — comportamiento oficial de React, documentado y ya confirmado 3 veces antes en este proyecto (14A, 14C.1, 14D.3) como no reproducible en producción.

### 1.8 (cont.) Si en build/preview producción el duplicado también ocurre — verificado empíricamente, no asumido

Se intentó confirmar de forma directa (no sólo citar precedente): `npm run build` + `npm run preview -- --port 4174`, journey apuntado a ese puerto vía `PERF_JOURNEY_BASE_URL=http://localhost:4174`. **Resultado: no se pudo medir.** El login del build de preview quedó bloqueado por un problema de entorno no relacionado con esta etapa — el build de producción tiene horneada una URL de API distinta (`http://localhost:4002`) a la del backend real corriendo en esta sesión (`localhost:3001`), y además el backend no tiene habilitado CORS para el origen `localhost:4174`:

```
Access to fetch at 'http://localhost:4002/api/auth/login' from origin 'http://localhost:4174' has been
blocked by CORS policy: Response to preflight request doesn't pass access control check...
```

Sólo 2/9 acciones del journey se pudieron ejercitar (el resto se salteó porque nunca hubo sesión iniciada). Reconfigurar variables de entorno de build o CORS del backend para forzar esta medición está fuera del alcance quirúrgico de esta etapa (tocaría infraestructura de build/CORS, no Legajos) — se documenta la limitación honestamente en vez de forzarla. Lo que sí se sostiene, sin necesidad de esta medición directa, es el hecho ya establecido (documentación oficial de React + 3 confirmaciones previas en este mismo proyecto): StrictMode sólo se activa envuelto en `<React.StrictMode>` durante `npm run dev`/tests — no tiene ningún efecto en un build de producción real, con o sin este bug de entorno de por medio.

### 1.9 Doble render por routing/navegación

**No.** `App.tsx:76` registra `/legajos/:id` una única vez (`<Route path="/legajos/:id" element={...} />`), sin duplicación de rutas ni wrappers anidados que remonten el componente dos veces.

### 1.10 Doble request por `apiCache: false`

**No es la causa.** `apiCache` es un flag **deprecado** en `apiClient.ts` (`/** @deprecated Compatibilidad temporal: apiClient ya no implementa cache propia. */`) — no hace nada hoy, es un no-op mantenido por compatibilidad de firma. La causa real es que `getOverviewById`/`getOverviewDetailsById` nunca pasaban por el sistema de caché de la app (`services/cache`) — eran un `apiRequest` directo, sin ningún mecanismo de dedupe.

### 1.11 Si `cachedData` deduplica in-flight o sólo cachea después de resolver — **ambas cosas**

Leyendo `services/cache/cachedData.ts` completo: `revalidate()` guarda la Promise en curso en un `Map` (`pendingRevalidations`), keyed por `key` — una segunda llamada con la misma clave mientras la primera sigue en vuelo **recibe la misma Promise** (dedupe in-flight real, no una simulación). El cache en sí (`writeCached`) sólo se escribe **dentro del `.then()` de éxito** — un request fallido nunca queda cacheado, y el `.finally(() => pendingRevalidations.delete(key))` limpia el in-flight tanto en éxito como en error, así que un retry después de una falla siempre dispara un request real nuevo.

### 1.12 Si `requestKey` es estable

Sí — se usó `GET:/employees/${id}/overview` y `GET:/employees/${id}/overview-details`, strings determinísticos por `id`, mismo patrón que el resto de `employeeApiService.ts` (`getPositionValidation`, `list`, etc.).

### 1.13 Si alguna función crea objetos nuevos que invalidan dependencias

No aplica al efecto que dispara overview/overview-details (deps primitivas, §1.5). `useLaborSelectOptions(employee || undefined)`/`useStructureSelectOptions(...)` son hooks aparte, con sus propios efectos independientes — no afectan ni son afectados por la duplicación diagnosticada acá.

### 1.14-1.20 Overlap de datos entre overview/overview-details, y si se puede eliminar uno

Ya documentado en 14D.3 (`EMPLOYEE_OVERVIEW_DETAILS_PERFORMANCE_14D3.md`): `overview` es el snapshot liviano para la cabecera (nombre, legajo, DNI/CUIL, estado), `overview-details` trae lo necesario para las pestañas 1-5 (domicilio, sector/puesto, asignaciones, transporte, conceptos horarios). Medido en el estado committeado de 14D.4 (`git show HEAD`, antes de tocar nada de esta etapa): **`overview` responde en 389-390ms** (rápido, nunca apareció en el Top 10 de requests lentas de ninguna etapa) mientras que **`overview-details` responde en 3476-3825ms** (el cuello de botella real, mismo hallazgo que 14D.3, causa ya documentada ahí: cadena de relaciones sin `relationJoins`). Eliminar `overview` (Opción E del pedido) sólo ahorraría 1 request rápido — no toca la causa real de la lentitud, que es `overview-details`. Combinado con que el pedido marca la Opción E como "riesgo mayor, usar sólo si está claro" y prohíbe explícitamente "eliminar overview u overview-details sin comprobar usos": **se descartó**, sin tocar ningún componente ni contrato.

### 1.21-1.22 Loader global innecesario / blanqueo de pantalla al refetch

No se encontró loader global nuevo ni blanqueo nuevo — `loadStatus`/`detailsStatus` (estados ya existentes, sin tocar) siguen el mismo patrón: `"loading"` se reafirma al inicio del efecto en cada `[id, loadRetry]`, y las secciones muestran `LoadingState`/`ErrorState` localizados dentro del `<Section>`, nunca un overlay de página completa. Esto no cambió con esta etapa (el componente no se tocó) — se confirma con el journey (§10 "Dónde se blanquea pantalla" del reporte no incluye la apertura del detalle, ni antes ni después).

### 1.23-1.24 Caché frontend existente para `employees` / invalidación en mutaciones

Ya existía una familia `"employees"` usada por `list`/`getOptions`/`getSummary`/`getOrgChart`/`getPositionValidation` (`cachePolicy.ts`). Confirmado por grep: **8 mutadores** ya llaman `invalidateEmployeeDependentCaches()` (que invalida `"employees"` + `"dashboard"` + `"positions"`): `create`, `update`, `updateAddress`, `updateTransport`, `updateAssignments`, `updateHourConcepts`, labor movement creado, labor statuses sincronizados. Todos los flujos de guardado de Legajos (incluidos los que usan `FieldWithHistory`/bloques, que internamente llaman `update()`) ya pasan por acá.

### 1.25-1.27 Si cachear overview/overview-details por sesión es seguro, y si hay datos sensibles

**Sí, es seguro, con las mismas condiciones ya usadas para `employeePositionValidation`/`employeesList`/`employeesOptions`**: overview/overview-details traen PII real (DNI, CUIL, domicilio, datos laborales) — la política nueva usa `sensitive: true` (nunca persiste a IndexedDB, sólo memoria) y `persist: false`, con TTL corto (60s).

### 1.28-1.29 Reutilización al reabrir el mismo legajo / dedupe sin TTL largo

Confirmado con test (`reabrir el mismo legajo dentro del TTL no repite el request`): 3 llamadas secuenciales a `getOverviewById` con el mismo `id` dentro del TTL producen **1 sólo request real**. TTL de 60s (no "infinito" — el pedido prohíbe explícitamente cache que esconda errores reales de forma permanente).

### 1.30 Riesgo de datos viejos después de guardar

Mitigado por partida doble: (a) los 8 mutadores existentes ya invalidan la familia `"employees"` — `invalidateFamily` en `lruMemoryCache.ts` **elimina** la entrada (no la marca "stale"), así que el siguiente `getOverviewById` es un miss real, no un stale-hit; (b) `EmployeeDetailPage.tsx` ya actualiza el estado local (`setEmployee(updated)`) directamente con la respuesta del `PATCH`, sin depender de un refetch para reflejar el guardado.

### 1.31-1.34 Dónde debe vivir la solución

**En `employeeApiService.ts`, reusando `cachedData` (el sistema general ya existente) — no se tocó `cachedData.ts` ni ningún componente.** Se evaluó explícitamente el impacto de tocar el sistema de caché genérico (usado por 10+ familias en toda la app) versus corregir sólo los 2 consumidores puntuales — corregir sólo el consumidor tiene impacto acotado y cero riesgo de romper otras cachés; mejorar `cachedData` en sí no era necesario porque **ya tenía** el mecanismo de dedupe in-flight correcto (§1.11), sólo que estos 2 métodos nunca lo usaban.

### 1.35 Números exactos del journey antes de la corrección

Fuente: `git show HEAD:docs/performance/EMPLOYEES_PERFORMANCE_JOURNEY_14D1.json` — el estado realmente committeado al cerrar 14D.4, no una corrida propia posterior (ver nota metodológica al inicio de §8). Ver tabla completa en §8. Resumen: `overview` x2 (389ms/390ms), `overview-details` x2 (3476ms/3825ms), "Abrir primer legajo disponible": visible 827ms, network idle 4392ms, 8 requests, 0 errores en esta acción puntual, rango Crítico.

---

## 2. Causa del doble request

**Combinación, no un único factor**: React StrictMode (dev) es el disparador real de la duplicación (confirmado por el patrón de tiempos: 389ms/390ms para `overview`, prácticamente idénticos entre sí — consistente con 2 invocaciones casi simultáneas del mismo efecto, no 2 llamadas separadas en momentos distintos) — pero la causa raíz que permitió que esa duplicación se convirtiera en **2 requests de red reales** es que `getOverviewById`/`getOverviewDetailsById` nunca pasaban por el sistema de caché/dedupe de la app (a diferencia de prácticamente cualquier otro método de `employeeApiService.ts`). No es "sólo StrictMode" ni "sólo un bug" — es StrictMode exponiendo la ausencia de dedupe que ya existía como gap real (cualquier remount genuino, no sólo StrictMode, habría producido el mismo duplicado).

---

## 3. Opciones consideradas y opción elegida

**Elegida: combinación mínima de A + B (Opción F del menú del pedido)** — deduplicación in-flight **y** caché corta de sesión para `overview`/`overview-details`, reusando el sistema `cachedData` existente.

- **Opción A (dedupe in-flight)**: necesaria y suficiente para eliminar el duplicado de StrictMode/remounts genuinos.
- **Opción B (caché por sesión, TTL corto, familia `employees`)**: se sumó porque **viene gratis** con `cachedData` (no es trabajo extra) y aporta valor real más allá del dedupe — reabrir el mismo legajo en menos de 60s no repite las 2 llamadas.
- **Opción C (corregir deps inestables)**: descartada — ya se confirmó que las deps son estables (§1.5), no había nada que corregir ahí.
- **Opción D (unificar la carga en un solo lugar)**: descartada — ya está unificada, ambas llamadas salen del mismo efecto en el mismo componente (§1.1-1.4); no hay nada que centralizar.
- **Opción E (eliminar `overview` si `overview-details` alcanza)**: descartada explícitamente, con evidencia (§1.14-1.20) — `overview` es rápido (389ms) y no es la causa de lentitud; eliminarlo es el cambio de mayor riesgo del menú para el menor beneficio real.

---

## 4. Backend

**No se tocó backend porque el problema de esta etapa era duplicación/carga frontend.** `GET /employees/:id/overview` y `GET /employees/:id/overview-details` no cambiaron ni de shape ni de query ni de select — el diagnóstico (§1) confirmó que la causa está exclusivamente en que el frontend no deduplicaba/cacheaba estas 2 llamadas, no en el backend.

---

## 5. Cambios frontend

Archivos: `frontend/src/services/cache/cachePolicy.ts`, `frontend/src/services/api/employeeApiService.ts` (+ `employeeApiService.test.ts`).

1. **Nueva `CachePolicy` `employeeDetailCore`** (`cachePolicy.ts`): familia `"employees"` (misma que el resto de cachés de legajo — invalidación gratis, §1.23-1.24), `ttlMs: 60_000`, `persist: false`, `sensitive: true` (mismo criterio que `employeePositionValidation`/`employeesOptions`).
2. **`getOverviewById(id)`/`getOverviewDetailsById(id)`** (`employeeApiService.ts`): de un `apiRequest` directo a `cachedData({ requestKey: ..., policy: cachePolicies.employeeDetailCore, fetcher: ..., validate: isEmployeeDetail })` — mismo patrón exacto que `getPositionValidation`/`getOptions`/`list`, sin inventar ningún mecanismo nuevo.
3. **`isEmployeeDetail`**: validador mínimo nuevo (id/firstName/lastName string), mismo criterio que `isEmployeeOptionsResponse` ya existente.

**No se tocó**: `EmployeeDetailPage.tsx` (el componente sigue disparando ambas llamadas exactamente igual, en el mismo efecto — el fix vive enteramente en la capa de servicio), `cachedData.ts` (el sistema genérico no se modificó), ningún otro método de `employeeApiService.ts`, ningún otro componente de Legajos.

---

## 6. Cambios en cache/dedupe

- **Dedupe in-flight**: automático, provisto por `cachedData`/`pendingRevalidations` (mecanismo ya existente, sin cambios) — al envolver los 2 métodos con `cachedData`, quedan cubiertos igual que cualquier otro consumidor.
- **Caché de sesión**: nueva, 60s, familia `"employees"`, no persistida (dato sensible).
- **Invalidación**: ninguna línea de código nueva — los 8 mutadores existentes que ya invalidan `"employees"` cubren automáticamente las 2 nuevas entradas de caché, por compartir familia.

---

## 7. Riesgos

- **TTL de 60s**: si un usuario tiene 2 pestañas del navegador abiertas sobre el mismo legajo y edita en una, la otra puede mostrar datos desactualizados hasta por 60s si no se refresca manualmente — mismo riesgo ya aceptado para `employeePositionValidation`/`employeesOptions`, no es nuevo de esta etapa.
- **`getOverviewById`/`getOverviewDetailsById` ahora dependen de `services/cache`**: si en el futuro se cambia el `schemaVersion` global de caché sin que el shape de `Employee` realmente cambie, se invalidaría esta caché también (comportamiento esperado del sistema genérico, no específico de esta etapa).
- **La causa de fondo de la lentitud de `overview-details` (~3.5-3.9s) sigue sin resolver** — esta etapa elimina el duplicado, no la lentitud individual del request (ver §9, mismo candidato `relationJoins` ya señalado 5 veces).

---

## 8. Validación — antes/después con números reales

**Nota metodológica (corregida)**: la columna "Antes 14D.4" usa el estado **realmente committeado** al cerrar esa etapa (`git show HEAD:docs/performance/EMPLOYEES_PERFORMANCE_JOURNEY_14D1.json`, commit `f71d7e7`) — no una corrida propia adicional hecha después. Una primera versión de este documento había usado una corrida de diagnóstico propia (hecha al empezar 14D.5, antes de tocar código) como "antes", cuyos tiempos individuales diferían de los del commit real por la variación normal de latencia de Neon (mismo patrón de duplicación — 2/2 llamadas — pero milisegundos distintos). Se corrigió para comparar siempre contra el estado committeado, que es lo que `git diff` puede verificar.

Medido corriendo `npm run perf:journey:employees` (dev server real, `localhost:5174`, StrictMode activo — mismo entorno que mide el journey siempre, ver §1.6-1.8) — "antes" es el commit `f71d7e7` (14D.4), "después" es la corrida final que queda reflejada en los archivos que se commitean con esta etapa. Ambas corridas contra el mismo backend/datos de staging (Neon).

**Sobre el ruido de red en "network idle"**: durante la validación de esta etapa se corrió el journey varias veces después de implementar el fix (mismo código, sin cambios entre corridas) y el network idle de "Abrir primer legajo disponible" varió entre **4091ms y 4470ms** — por encima y por debajo del valor "antes" (4392ms) según la corrida. Esto confirma lo que dice la fila correspondiente más abajo: el idle de esta acción está dominado por la latencia real (variable) de la única llamada a `overview-details` que queda, no por la deduplicación en sí — **no es una métrica confiable para medir el efecto de esta etapa**. La tabla usa la última corrida (la que queda en los archivos commiteados) para "después", pero la conclusión sobre network idle se apoya en el rango completo observado, no en un solo número.

| Caso | Antes 14D.4 (commit `f71d7e7`) | Después 14D.5 | Mejora | Comentario |
|---|---|---|---|---|
| Cantidad de `GET /api/employees/:id/overview` al abrir detalle | 2 (389ms, 390ms) | **1** (426ms) | **-50%** | Ya no aparece en "Endpoints repetidos" (§9 del reporte) — confirma que no se repite ni una vez. |
| Cantidad de `GET /api/employees/:id/overview-details` al abrir detalle | 2 (3476ms, 3825ms) | **1** (3516ms) | **-50% en cantidad, ~0% en duración individual** | La duración de la única llamada que queda está en el mismo rango que las 2 que había antes — el endpoint no se tocó esta etapa (ver §9 pendiente). |
| Network idle de "Abrir primer legajo disponible" | 4392ms | 4091ms (rango observado entre corridas: 4091-4470ms) | **No concluyente / dentro del ruido normal de Neon** | **No se afirma una mejora confiable de network idle.** El idle de esta acción está dominado por la duración de la llamada individual (variable) a `overview-details` (~3.5-3.9s según la corrida), no por la cantidad de requests en paralelo — eliminar un duplicado que corría concurrente con el request "real" no acorta el camino crítico de forma determinística. La mejora real, determinística y verificable de esta etapa es la reducción de **cantidad** de requests (overview 2→1, overview-details 2→1, total 8→6), no el tiempo de red. |
| Visible ms de "Abrir primer legajo disponible" | 827ms | 834ms | Sin cambio significativo | Esperado — la cabecera ya pintaba rápido antes (mismo hallazgo repetido desde 14C.1), la duplicación no afectaba el render visible, sólo la red de fondo. |
| Requests totales de la acción "Abrir primer legajo disponible" | 8 | **6** | **-2 requests** | Exactamente los 2 duplicados eliminados (1 de `overview`, 1 de `overview-details`). Esta es la mejora central y verificable de la etapa, reproducida de forma idéntica en todas las corridas "después" hechas durante esta validación. |
| Deduplicación en dev StrictMode | — | Confirmada — el journey corre siempre contra dev (§1.6-1.8) y midió la reducción de 2→1 en ambos endpoints, en todas las corridas | — | — |
| Comportamiento en preview/build de producción | — | **No se pudo medir** (bloqueador de entorno ajeno a esta etapa, ver §1.8) | — | Documentado honestamente en vez de forzarlo o inventar el número. |
| Errores HTTP / consola en la acción "Abrir primer legajo disponible" | 0 / 0 | 0 / 0 | Sin cambios | Confirmado en todas las corridas — la acción en sí nunca tuvo errores. |
| Errores HTTP / consola del recorrido completo (56 acciones) | 1 / 1 | 0 / 0 | No comparable directamente | El commit `f71d7e7` tuvo un único error real, **no relacionado con esta etapa**: `GET /api/dashboard/metrics` devolvió 500 durante la acción "Login" (zona Login, módulo Dashboard — fuera de Legajos). No afecta ninguna de las conclusiones sobre `overview`/`overview-details` de esta tabla. Ninguna corrida "después" reprodujo ese error (transitorio, mismo tipo de variación de Neon ya documentado en otras etapas). |
| Sanitización de UUIDs en el reporte | Sin UUIDs | Sin UUIDs | Sin cambios | Verificado con `grep -E`, 0 coincidencias en `.md` y `.json`. |
| Acciones en rango Crítico/Lento del recorrido completo | 3 Crítico / 0 Lento | 3 Crítico / 1 Lento | Ruido de red, no regresión | La acción que cruzó a Lento (2000-3000ms) en las corridas "después" corresponde a otro endpoint (no `overview`/`overview-details`, no tocado esta etapa) — mismo tipo de variación de Neon ya documentado en corridas previas (14D.3 §8, 14D.4 §8). |

---

## 9. Qué quedó pendiente

- La lentitud individual de `GET /employees/:id/overview-details` (~3.5-3.9s) sigue sin resolver — no es causa de duplicación, es la misma cadena de relaciones sin `relationJoins` ya documentada en 14D.3. Candidato repetido ahora 6 veces (14C.1, 14C.3, 14D.2.1, 14D.3, 14D.4, acá).
- Confirmación directa de StrictMode-vs-producción en un build real: bloqueada por un mismatch de entorno (API URL horneada en el build + CORS del backend local) ajeno al alcance de esta etapa — se sostiene en la semántica oficial de React + 3 confirmaciones previas del proyecto en vez de una medición directa nueva.

---

## 10. Qué NO se tocó

Carga Horaria, Turnos, Fichador, Horas Especiales, Conceptos Horarios, schema/migraciones, reglas funcionales, RBAC, contrato público de `GET /employees/:id/overview`/`overview-details`, `EmployeeDetailPage.tsx`, `cachedData.ts` (sistema genérico), ningún otro método de `employeeApiService.ts`.
