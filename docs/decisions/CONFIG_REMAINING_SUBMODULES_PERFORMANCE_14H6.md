# Etapa 14H.6 — Diagnóstico y optimización liviana de Empresas y estructura + Categorías documentales + Parámetros de auditoría

## 1. Contexto

Última etapa de la serie 14H ("Performance read-only de módulos administrativos/configuración") que quedaba sin una medición de "detalle" real: hasta esta etapa, el journey `perf:journey:admin-config` sólo entraba a la tarjeta de estos 3 submódulos (mount + búsqueda/filtro 100% client-side), sin abrir nunca su editor. A diferencia de Turnos (14H.2), Asignaciones de feriados (14H.3), Horas especiales (14H.3) y Conceptos horarios (14H.5) — que ya habían recibido optimización dedicada — Empresas y estructura, Categorías documentales y Parámetros de auditoría nunca fueron objeto de una etapa propia. El pedido de 14H.6 fue diagnosticar los 3 con evidencia antes de tocar nada, y sólo corregir lo seguro y medible.

## 2. Evidencia heredada de 14H.1-14H.5

- 14H.1 (diagnóstico macro) relevó el inventario inicial de los 10 submódulos de Configuración + Puestos, incluyendo estos 3 — pero ese relevamiento resultó **parcialmente desactualizado** para 2 de los 3: tanto `orgStructure` (F) como `documentCategories` (J) fueron anotados como `backendCache: No`, cuando en realidad ambos ya tenían cache backend antes de esta etapa (ver §3). Sólo el hallazgo de `auditParameters` (K, `backendCache: No`) resultó correcto.
- 14H.2-14H.4 establecieron y consolidaron el patrón `$transaction([...])` → `Promise.all([...])` para lecturas independientes, ya aplicado 12+ veces en la serie antes de esta etapa.
- 14H.5 (Conceptos horarios) estableció el precedente de abrir un editor inline en modo lectura cuando aporta valor diagnóstico real (paneles anidados con fetch propio) y estableció el criterio de "sólo se corrige lo que tiene un caller real, verificado por grep" — ambos criterios se reutilizan acá.

## 3. Diagnóstico — F. Empresas y estructura

- **Carga inicial**: `OrgStructurePage.tsx` hace un único `orgStructureApiService.getCatalog()` al montar, ya envuelto en `cachedData()` (política `orgStructureCatalog`, 10min, persistida) — confirmado leyendo el archivo completo (224 líneas).
- **Estructura de árbol / 6 pestañas**: Empresas/UN/Establecimientos/Áreas/Sectores/Centros de costo se renderizan todas sobre el mismo catálogo ya cargado — cambiar de pestaña no dispara ningún request nuevo (confirmado por el journey, ver §13).
- **Duplicados StrictMode**: ninguno — `cachedData()` con `pendingRevalidations` ya coalesce el double-invoke.
- **Backend**: `orgStructure.repository.ts` — `fetchOverview()` **ya usaba `Promise.all([...6 findMany independientes...])`**, nunca tuvo el antipatrón `$transaction`. Tiene además un cache backend propio (`overviewCache`, 60s, in-memory) que 14H.1 no había detectado. `createCostCenter`/`updateCostCenter` usan `$transaction(async (tx) => ...)` interactivo de forma legítima (escritura atómica padre+hijo con dependencia real de `id`) — no se toca.
- **`$transaction` en lecturas**: ninguno detectado.
- **Over-fetch / filtros / paginación**: no aplica — es un catálogo chico, sin paginación de servidor.
- **Blanking**: no observado; `cachedData()` sirve el valor cacheado mientras revalida en segundo plano.

**Conclusión: submódulo ya óptimo en ambos lados. Cero cambios de código.**

## 4. Diagnóstico — J. Categorías documentales

- **Carga inicial**: `DocumentCategoriesPage.tsx` hace un único `documentCategoryApiService.getAll()` al montar, ya envuelto en `cachedData()` (política `documentCategoriesCatalog`, 10min, persistida). Búsqueda y filtro por Tipo son 100% client-side (`getFiltered`/`getFilterOptions` sobre el array ya cargado) — confirmado leyendo el archivo completo (138 líneas).
- **Backend**: `documentCategories.controller.ts` **ya tenía** `documentCategoriesReadCache` (60s, `createTtlCache`, keyed por `req.originalUrl`) — 14H.1 lo había anotado como `No`, corregido en esta etapa (ver §3 del reporte macro actualizado).
- **`$transaction`**: `documentCategories.repository.ts` tiene la misma estructura `hasActiveFilters()` que `hourConcepts.repository.ts` (14H.5): rama sin filtros usa un `listCache` en memoria (2min, sin `$transaction`); rama CON filtros activos usaba `prisma.$transaction([findMany, count])` — el antipatrón, sólo en esa rama.
- **Caller real de la rama filtrada**: confirmado por grep — `documentCategoryApiService.getAll({ status: "ACTIVO", scope: "NOVEDAD" })` desde `EmployeeHoursPage.tsx:414` (Gestión Horaria). Ese caller **no se toca** — sólo la función de repositorio compartida.
- **Nota importante**: ni el mount de `DocumentCategoriesPage` ni su búsqueda/filtro (ambos client-side, sin filtros de servidor) ejercitan la rama filtrada — sólo el caller de Gestión Horaria la ejercita. Por eso el journey `admin-config` no puede mostrar el efecto del fix en la acción "Entrar a Categorías documentales" (ver §15).

**Conclusión: 1 fix backend real (rama filtrada), evidenciado por un caller externo genuino.**

## 5. Diagnóstico — K. Parámetros de auditoría

- **Carga inicial**: `AuditParametersPage.tsx` hace un único `auditParameterApiService.getAll()` al montar, ya envuelto en `cachedData()` (política `auditParametersCatalog`, 10min, persistida). Búsqueda y filtro por Módulo son 100% client-side (inline en el componente) — confirmado leyendo el archivo completo (143 líneas). Único caller de `getAll()`: la propia página, siempre sin filtros (confirmado por grep).
- **Backend**: `auditParameters.controller.ts` **no tenía ninguna cache backend** — a diferencia de F y J, este hallazgo de 14H.1 sí era correcto.
- **`$transaction`**: `auditParameters.repository.ts::findMany` **no tiene ninguna rama `hasActiveFilters()`** — a diferencia de `hourConcepts`/`documentCategories`, usa `$transaction([findMany, count])` **siempre**, sin una rama alternativa sin filtros. Es el único camino de `findMany`.
- **RBAC**: `auditParametersRouter.use(requireAuth, requireAnyRole(adminRoles))` aplica a TODO el router, incluido el GET — a diferencia de `hourConcepts`/`documentCategories` (GET abierto a cualquier autenticado). Confirma que una cache no scopeada por usuario es segura acá (no hay variación de datos entre usuarios, y `list()` no recibe `user`).

**Conclusión: el fix con mayor alcance de los 3 (se ejercita en cada carga real de la pantalla) + único submódulo que genuinamente necesitaba una cache backend nueva.**

## 6. Endpoints detectados (mapa completo)

| Submódulo | Endpoint | Cache frontend (antes de 14H.6) | Cache backend (antes de 14H.6) | `$transaction` en lectura (antes) |
|---|---|---|---|---|
| F. Empresas y estructura | `GET /org-structure` | Sí (`orgStructureCatalog`, 10min) | Sí (`overviewCache`, 60s) — 14H.1 decía "No" | No — ya usaba `Promise.all` |
| J. Categorías documentales | `GET /document-categories` | Sí (`documentCategoriesCatalog`, 10min) | Sí (`documentCategoriesReadCache`, 60s) — 14H.1 decía "No" | Sí, sólo en rama filtrada (caller: Gestión Horaria) |
| K. Parámetros de auditoría | `GET /audit-parameters` | Sí (`auditParametersCatalog`, 10min) | No | Sí, siempre (único camino) |

Ninguno de los 3 tiene endpoints auxiliares/anidados (a diferencia de Conceptos horarios en 14H.5) — sus editores inline no montan paneles hijos con fetch propio.

## 7. Causa raíz

- F: ninguna — falso hallazgo de 14H.1 (no había antipatrón que corregir).
- J: `$transaction([...])` en la rama filtrada de `findMany` pinaba 2 lecturas independientes (`findMany`+`count`) a una única conexión Neon en serie, sin ganar concurrencia real — mismo antipatrón ya corregido 13 veces antes en la serie 14G/14H, ejercitado acá por un caller real de Gestión Horaria.
- K: el mismo antipatrón, pero en el ÚNICO camino de `findMany` (sin rama alternativa) — se paga en cada visita a la pantalla — y ausencia total de cache backend, forzando una consulta Neon completa (2 queries en serie) en cada carga, incluso sin cambios entre visitas consecutivas.

## 8. Cambios aplicados

### 8.1 `backend/src/modules/audit-parameters/auditParameters.repository.ts`
`findMany`: `prisma.$transaction([findMany, count])` → `Promise.all([findMany, count])`. `where`/`orderBy`/`skip`/`take` sin cambios.

### 8.2 `backend/src/modules/audit-parameters/auditParameters.controller.ts`
Nueva cache inline `auditParametersReadCache` (`createTtlCache`, 60s, keyed por `req.originalUrl`, sin scope de usuario — justificado en §5/§10). Wireada en `list` (get/set) y `.clear()` en `create`/`update`.

### 8.3 `backend/src/modules/document-categories/documentCategories.repository.ts`
`findMany`, rama `hasActiveFilters()`: `prisma.$transaction([findMany, count])` → `Promise.all([findMany, count])`. Rama sin filtros (`listCache`) sin cambios. `where`/`orderBy`/`skip`/`take` sin cambios.

### 8.4 `frontend/e2e/adminConfigurationPerformanceJourney.spec.ts` + `frontend/e2e/support/adminConfigurationJourney.ts`
Ver §12 (Journey ampliado).

## 9. Qué NO se cambió (decisiones explícitas)

- **F. Empresas y estructura**: cero cambios de código — ya óptimo (§3).
- **Editor inline de F no se abre en el journey**: sin botón de cierre limpio (sólo se cierra cambiando de pestaña, un efecto colateral de las Tabs, no un control pensado para esto) y, a diferencia de Conceptos horarios, abrirlo no revelaría ningún request nuevo (catálogo ya cargado, edición 100% local) — sin valor diagnóstico que justifique salirse de la política de sólo abrir editores con cierre limpio.
- **`hourConceptRulesRepository.findMany`** (hallazgo de 14H.5, sin caller frontend encontrado): sigue sin corregirse — no forma parte del alcance de 14H.6, no se revisó de nuevo.
- **Los 4 patrones de cache backend distintos** (documentados en `PERFORMANCE_STANDARDS.md` §15) no se consolidaron — la nueva cache de K sigue el patrón inline `createTtlCache` (igual que `hourConceptsReadCache`/`documentCategoriesReadCache`), no el patrón `.cache.ts` + `userScopedCacheKey` (que hubiera sido incorrecto acá, ver §11).
- Ningún endpoint cambia de ruta, método, query params, forma de respuesta ni nombre de campo.
- Ninguna acción de escritura se ejecutó en ningún momento (crear/editar Empresa/UN/Establecimiento/Área/Sector/Centro de costo, categoría documental, parámetro de auditoría) — todas quedan como `skip(...)` con `isWrite: true`.
- No se tocó Gestión horaria/Fichador/Regímenes laborales/Turnos/Horas especiales/Asignaciones de feriados/Conceptos horarios/Puestos/Tipos de novedades/Exportación Finnegans — el único cruce (`documentCategoryApiService.getAll` desde `EmployeeHoursPage.tsx`) se documentó y no se tocó ese archivo, sólo la función de repositorio compartida.
- No se tocó `schema.prisma` ni se crearon migraciones.

## 10. Contrato API preservado

- `GET /org-structure`, `GET /document-categories`, `GET /audit-parameters`: mismas rutas, mismos query params, misma forma de respuesta (`{ data, meta }` donde aplica), mismos nombres de campo. `POST`/`PATCH` de los 3 dominios sin cambios de firma.
- La nueva cache de `auditParametersController.list` responde exactamente `{ data: result.items, meta: result.meta }`, idéntico a la respuesta sin cache (mismo shape que ya devolvía antes de 14H.6).

## 11. RBAC/scope preservado

- `auditParametersRouter` sigue exigiendo `requireAuth` + `requireAnyRole(adminRoles)` en TODO el router, sin cambios — la nueva cache no introduce ninguna variación de acceso.
- La cache de K se decidió **sin scope de usuario** (key = `req.originalUrl` puro) precisamente porque el router ya bloquea el acceso a nivel de rol antes de llegar al controller, y `auditParametersService.list()` nunca recibió ni recibe un parámetro `user` — no hay dato que varíe por usuario que se pudiera filtrar por compartir la key entre usuarios. Se verificó explícitamente que esto sea así antes de implementar (no se asumió).
- Ningún cambio en `org-structure.routes.ts` ni `documentCategories.routes.ts` — sus RBAC existentes (GET abierto a cualquier autenticado, escrituras con `adminRoles`) quedan intactos.

## 12. Cache/dedupe/loading — detalle

- **Frontend**: no se agregó ni se modificó ningún `cachePolicy` — los 3 submódulos ya usaban `cachedData()` correctamente con invalidación en sus métodos de escritura (`writeAndRefresh`/equivalente). Ninguna familia nueva de `CacheFamily` fue necesaria en 14H.6.
- **Backend — K (nueva)**: `auditParametersReadCache`, TTL 60s, key = `req.originalUrl` (sin scope de usuario, justificado en §11), invalidada por `.clear()` completo en `create`/`update` (mismo patrón que `hourConceptsReadCache`/`documentCategoriesReadCache` — un `clear()` total, no invalidación selectiva por key, consistente con el resto de la familia de caches "simples" de Configuración).
- **Backend — J**: cache backend ya existente, sin cambios; el fix de esta etapa es en el repositorio (rama filtrada), una capa por debajo de esa cache — ambas capas siguen coexistiendo como deuda arquitectónica ya documentada (`PERFORMANCE_STANDARDS.md` §15), no se tocó esa duplicidad.
- **Backend — F**: cache backend ya existente (`overviewCache`), sin cambios.
- **Loading/blanking**: ninguno de los 3 mostró pantalla vacía inesperada durante los 3 runs del journey (`emptyScreen: false/null` en todas las acciones cubiertas) — cada uno usa su propio `DataTable` con estado `loading/error/empty/ready` local, sin loading global.

## 13. Journey ampliado

`frontend/e2e/adminConfigurationPerformanceJourney.spec.ts` + `frontend/e2e/support/adminConfigurationJourney.ts`:

- **J. Categorías documentales**: 2 acciones nuevas — "Abrir detalle de categoría documental (Editar)" y "Cerrar detalle de categoría documental sin guardar". Mismo criterio de riesgo que Conceptos horarios (14H.5): botón "Editar" 100% local (`setEditing(item)`, sin request propio) confirmado leyendo el código, botón "Cerrar" explícito confirmado. A diferencia de Conceptos horarios, este editor no anida ningún panel con fetch propio — las 2 acciones se cubrieron en los 3 runs del journey con **0 requests** cada una, confirmando exactamente lo que el diagnóstico predijo (§4).
- **K. Parámetros de auditoría**: mismas 2 acciones nuevas, mismo criterio, mismo resultado (0 requests en los 3 runs).
- **F. Empresas y estructura**: evaluado y descartado explícitamente (ver §9) — se documentó la razón en el `skip(...)` del propio spec en vez de dejarlo implícito.
- Las filas de escritura "Crear/Editar categoría documental" y "Crear/Editar parámetro de auditoría" se renombraron a "Crear categoría documental / Guardar cambios de categoría" y "Crear parámetro de auditoría / Guardar cambios de parámetro" para distinguirlas de las nuevas acciones de sólo-lectura "Abrir detalle" — siguen sin ejecutarse (`isWrite: true`, `skip(...)`).
- `SUBMODULE_INVENTORY` (Matriz 1) y `COVERAGE_MATRIX` (Matriz 2) en el módulo de soporte se actualizaron: filas F y J corrigen el hallazgo de cache backend de 14H.1; fila K documenta la cache nueva; se agregaron 4 filas nuevas a `COVERAGE_MATRIX` (2 por cada uno de J y K). El párrafo de política de §14 del reporte markdown se reescribió para reflejar que ahora son 3 (no 1) los submódulos que abren su editor inline como excepción documentada.
- Test dedicado (`adminConfigurationJourney.test.ts`, ya existente) sigue verde con 28/28 — valida que `COVERAGE_MATRIX` cubre las 15 zonas y que ninguna fila de tipo Escritura queda marcada como medida.

## 14. Tests

### Backend
- `backend/src/modules/audit-parameters/auditParameters.repository.test.ts`: 2 tests nuevos (`findMany` con `Promise.all`, sin `$transaction`; armado de `where`) — 5/5 pasando.
- `backend/src/modules/audit-parameters/auditParameters.controller.test.ts` (**archivo nuevo**): 5 tests — cache miss inicial, cache hit en pedido idéntico, cache miss en URL distinta, invalidación completa tras `create`/`update` (`it.each`). Cada test usa una `originalUrl` única (no reutiliza la URL default entre tests) porque `auditParametersReadCache` es un singleton de módulo no exportado que persiste entre los `it()` del mismo archivo (vitest aísla módulos por archivo, no por test) — sin esto, tests posteriores heredarían resultados cacheados de tests anteriores y fallarían sus aserciones de "primer pedido"/"cache miss". 5/5 pasando.
- `backend/src/modules/document-categories/documentCategories.repository.test.ts` (**archivo nuevo** — el módulo no tenía ningún test hasta esta etapa): 4 tests — rama filtrada con `Promise.all`/sin `$transaction`, armado del `where`, rama sin filtros no usa `$transaction` ni pide `count` (paginación en memoria sobre `listCache`), segunda llamada sin filtros reutiliza el `listCache` (no vuelve a pegarle a la base). 4/4 pasando.
- Ningún test depende de tiempos exactos (no hay `sleep`/umbral de duración real en ninguno de los tests nuevos).
- Suite completa backend: **1254/1254 pasando** (81 archivos).

### Frontend
- Sin cambios de código frontend — no se necesitaron tests nuevos ahí (los 3 submódulos ya usaban `cachedData()` correctamente).
- `frontend/e2e/support/adminConfigurationJourney.test.ts`: sigue verde, **28/28 pasando**, sin cambios de aserciones (las nuevas filas de `COVERAGE_MATRIX` satisfacen las mismas invariantes ya cubiertas).
- Suite completa frontend: **788/788 pasando** (78 archivos).

## 15. Métricas antes/después

Baseline "antes" = último reporte commiteado (`git show HEAD:docs/performance/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.json`, generado al cerrar 14H.5). "Después" = 3 corridas de `npm run perf:journey:admin-config` ejecutadas en esta etapa, todas contra el mismo backend local (proceso persistente, sin reiniciar entre corridas).

| Acción | Antes (14H.5) | Después run 1 | Después run 2 | Después run 3 |
|---|---|---|---|---|
| Entrar a Empresas y estructura (networkIdle) | 829ms | 718ms | — | 980ms |
| Entrar a Categorías documentales (networkIdle) | 1003ms | 732ms | — | 891ms |
| Entrar a Parámetros de auditoría (networkIdle) | 2081ms | 1137ms | — | 900ms |

(Run 2 se ejecutó para confirmar estabilidad general del journey — 0 HTTP errors, 0 console errors, todas las acciones cubiertas — pero sus métricas individuales por acción no se extrajeron antes de que la corrida siguiente sobrescribiera el reporte; no cambia la lectura de abajo.)

**Lectura honesta, no sobre-interpretada:**
- **F (Empresas y estructura)**: sin cambio de código, la variación (829→718→980) es ruido normal de Neon entre corridas — consistente con la conclusión de que este submódulo no necesitaba ningún fix.
- **J (Categorías documentales)**: la mejora observada en "Entrar a Categorías documentales" (1003→732→891) **no es atribuible al fix aplicado** — ese fix corrige la rama FILTRADA de `findMany`, y el mount de esta página siempre llama `getAll()` sin filtros (rama `listCache`, no tocada). El journey `admin-config` no tiene ninguna acción que ejercite la rama filtrada (la búsqueda/filtro de esta página son 100% client-side); tampoco el journey `perf:journey:workforce` ejercita hoy el caller real de `EmployeeHoursPage.tsx` que sí dispara esa rama (confirmado revisando su reporte — cero requests a `/document-categories` en esa corrida). El fix queda validado por el test unitario nuevo (§14), no por una métrica de journey — documentado acá en vez de reclamar una mejora que no se puede atribuir con evidencia.
- **K (Parámetros de auditoría)**: mejora real y atribuible — `GET /audit-parameters` pasó de 2081ms a 1137ms (run 1) y 900ms (run 3), monótonamente decreciente en las 2 corridas medidas, consistente con eliminar el `$transaction` que serializaba `findMany`+`count` en una única conexión, en el único camino de esta función (se ejercita en cada visita, a diferencia de J). Las duraciones individuales de la request (`GET /api/audit-parameters`: 591ms run1, 349ms run3) sugieren que estas mediciones son mayormente cache MISSES de `auditParametersReadCache` (un cache HIT sería casi instantáneo, sin roundtrip a Neon) — el TTL de 60s probablemente expira entre corridas separadas de `npm run`, así que la ganancia medida acá es atribuible al fix de `$transaction`→`Promise.all`, no (todavía) a la cache nueva. La cache sí aporta valor real para visitas repetidas dentro de los 60s (no cubierto por este journey, que sólo visita cada pantalla una vez por corrida).

Resumen agregado del journey (3 corridas, backend persistente sin reiniciar): `httpErrors: 0`, `consoleErrors: 0` en las 3; `coveredActions` pasó de 43 (antes) a 47 (después, +4 = las 2 acciones nuevas de J + las 2 de K); `slowActions` (rango Lento) bajó de 3 a 1-2 según la corrida — ninguna de las 2 nuevas acciones ("Abrir detalle"/"Cerrar detalle" de J y K) apareció nunca en el top-5 de acciones más lentas en ninguna corrida (0 requests, resuelven casi instantáneo).

## 16. Riesgos pendientes

- El fix de J (`documentCategories.repository.ts`, rama filtrada) queda sin cobertura de journey — sólo test unitario. Si en el futuro `EmployeeHoursPage.tsx` cambia su forma de pedir categorías documentales, este fix seguiría siendo correcto pero su impacto real seguiría sin poder medirse end-to-end sin ampliar `perf:journey:workforce` para visitar esa sección específica (fuera del alcance de 14H.6 — Gestión horaria está cerrada).
- `hourConceptRulesRepository.findMany` (hallazgo de 14H.5, sin caller encontrado) sigue sin corregir — deuda documentada, no ampliada ni resuelta en esta etapa.
- Los 4 patrones de cache backend distintos conviviendo en Configuración (incluyendo el nuevo de K, que replica el patrón inline en vez de consolidar) siguen como deuda arquitectónica documentada en `PERFORMANCE_STANDARDS.md` §15 — no se tocó.
- `readOnly={false}` hardcodeado en `<Rows>` de `OrgStructurePage.tsx` (código vestigial, ya que usuarios no-Nivel-1 son redirigidos antes de llegar a ese render) — detectado en el diagnóstico de F, no corregido por no ser un riesgo real ni estar en el alcance de "optimización liviana".

## 17. Recomendación para 14H.7

Con el cierre de 14H.6, los 10 submódulos de Configuración + Puestos (14H.1-14H.6) y los de Gestión horaria (serie 14G) ya tienen diagnóstico y, donde correspondía, optimización liviana con evidencia. Candidatos para una eventual 14H.7, en orden sugerido de impacto/costo:

1. **Ampliar `perf:journey:workforce`** para visitar la sección de documentación de `EmployeeHoursPage.tsx` con al menos un filtro activo — es el único punto ciego de medición que dejó esta etapa (§15, §16), y permitiría por fin cuantificar el fix de J con evidencia end-to-end.
2. **Tipos de novedades — ruta de detalle** (`/configuracion/tipos-novedades/:id`): identificada en 14H.1 como candidata de profundización, nunca medida por ningún journey de esta serie.
3. **Puestos (detalle)**: único submódulo de todo `admin-config` con 2 GETs secuenciales dependientes (`getById` → `getAssignedEmployees`) — mismo patrón ya optimizado para Legajos en 14D, candidato si el volumen de asignaciones por puesto crece.
4. Si ninguno de los anteriores resulta rentable, la serie 14H puede darse por cerrada y evaluar si conviene abrir una serie nueva enfocada en consolidar los 4 patrones de cache backend distintos (deuda arquitectónica documentada, nunca abordada por ninguna etapa de performance hasta ahora).
