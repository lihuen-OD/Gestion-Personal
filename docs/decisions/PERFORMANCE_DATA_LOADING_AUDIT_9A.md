# Etapa 9A — Auditoría de performance, consumo de datos y experiencia de carga

Fecha: 2026-08-27
Estado: auditoría completa, sin cambios de código (etapa explícitamente diagnóstica)
Alcance: frontend + backend de las ~20 pantallas en uso hoy

## 1. Resumen ejecutivo

La app tiene, hoy, **más infraestructura de performance de la que su propio equipo parece estar usando de forma consistente**. Ya existen: un cache real en frontend con stale-while-revalidate (`frontend/src/services/cache/`), un cache TTL en backend con invalidación explícita por escritura (`backend/src/shared/cache/ttlCache.ts` + 5 wrappers de módulo), un hook de debounce compartido, un componente de paginación estandarizado, una cobertura de índices Prisma amplia y bien alineada a los filtros reales, y un endpoint de dashboard ya agregado correctamente (`GET /metrics`, una sola llamada, `Promise.all` interno). El problema no es "no hay arquitectura de performance" — es que se aplica de forma inconsistente entre pantallas, y esa inconsistencia sí genera lentitud percibida real en algunos puntos concretos.

Con los volúmenes de datos actuales (Employee=12, AuditLog≈515, y el resto de tablas "de catálogo" en un dígito), **ningún problema encontrado es un incidente de performance hoy**. Todo lo que se documenta acá es: (a) deuda estructural que se sentirá cuando el volumen crezca, o (b) lentitud percibida por UX (pantallas que se blanquean sin necesidad), que sí es un problema real y presente aunque el backend responda en milisegundos.

Se auditaron 23 pantallas/vistas (backend + frontend) mediante 5 sub-investigaciones paralelas que trazaron código real (no estimaron), más verificación puntual propia (conteos de filas de sólo lectura contra la base conectada, mismo criterio ya usado en etapas 8B/8F/8C). Se encontró **un bug real de invalidación de cache** (correcciones posteriores a un cierre pueden mostrar horas desactualizadas hasta 20s), un patrón sistemático de "blanquear la pantalla en cada refetch aunque ya haya datos" en 6+ pantallas, y el archivo de mayor riesgo estructural de la app (`HoursPage.tsx`, 1147 líneas, un único efecto con 10 dependencias). También se confirmaron explícitamente varias cosas que **no** son problemas pese a parecerlo a primera vista (debounce del fichador, ausencia de optimistic update en las fichadas, el cap `take:5000` del export). Ningún cambio de código se aplicó en esta etapa, por instrucción explícita del pedido de auditoría.

## 2. Diagnóstico general

### 2.1 Infraestructura ya existente (no reinventar)

**Frontend:**
- `frontend/src/services/cache/` — cache real: `cachedData()` (stale-while-revalidate, dedup de revalidaciones concurrentes), `cachePolicy.ts` (TTL por familia, 30s–10min), LRU en memoria (100 entradas) + IndexedDB persistente (50 entradas, sólo si `persist && !sensitive`), eventos y métricas de hit/miss.
- El flag `apiCache`/`cacheTtlMs` en `apiClient.ts` está **deprecado e inerte** (`@deprecated`, confirmado por su propio test) — decenas de call sites lo siguen pasando como boilerplate muerto. No es la cache real; no confundir.
- `frontend/src/utils/useDebouncedValue.ts` (350ms) — hook compartido de debounce.
- `frontend/src/components/ui/Pagination.tsx` — convención: estado `page` + param de request `take` + respuesta `meta:{total,page,pageSize,hasMore}`.
- Patrón "mantener datos viejos durante refresh silencioso" — existe, pero **sólo en un lugar**: `WorkScheduleSettingsPage.tsx` (`calendarRefreshToken`) + `SpecialHourRulesCalendarMonth.tsx` (`hasLoadedCurrentMonth` ref). `EmployeesPage.tsx` implementa una variante propia igual de válida (guarda `if (!all.length)` antes de mostrar skeleton, más `peekList()` para pintar instantáneo desde snapshot en memoria). Ninguno de los dos está extraído a un hook reusable.
- `LoadingState.tsx` (block/table/inline), `EmptyState.tsx`/`ErrorState.tsx` (default/compact) — ya distinguen carga de página completa vs. embebida.
- `useAsyncAction.ts` — guarda de doble-submit en mutaciones.
- Sin librería de data-fetching (React Query/SWR/etc.) — confirmado ausente. No se recomienda introducir una: el cache casero ya cubre lo esencial y migrar sería un cambio grande sin un problema real que lo justifique.

**Backend:**
- `backend/src/shared/cache/ttlCache.ts` — factory TTL+LRU genérica, con wrappers explícitos por módulo (`dashboard.cache.ts` 30s, `time-entries.cache.ts` 4 caches 10-20s, `novelties.cache.ts` 15s, `audit.cache.ts` 15s, `documents.cache.ts` 20s), cada uno invalidado explícitamente desde el `.service.ts`/`.controller.ts` correspondiente en cada escritura.
- **Además existen otros 2 patrones de cache bespoke, no el factory compartido**: `positions.repository.ts`/`hour-concepts.repository.ts` ("fetch hasta 500 filas + slice en JS" para el path sin filtros, TTL 120s, invalidación verificada exhaustiva) y `novelty-types.repository.ts`/`document-categories.repository.ts` (`listCache` propio, TTL 2min, invalidación también verificada exhaustiva). Y un cuarto caso aislado: `employees.repository.ts:461-480` (`timeGridCatalogCache`, variable de módulo con `Date.now() < expiresAt` manual). **Los 4 patrones funcionan correctamente hoy** (no se encontró ningún write path sin invalidar) — el problema es de consistencia arquitectónica, no de correctness.
- La mayoría de los endpoints de listado paginan de verdad (`$transaction([findMany({skip,take}),count])`): employees, time-entries, documents, users, novelties, audit, hour-concept-rules.
- Cobertura de índices Prisma amplia y bien alineada a los filtros reales usados. Gap confirmado: `EmployeeDocument.[status,expiresAt]` no lo usa ninguna query de lectura hoy (verificado con grep exhaustivo) — índice sin consumidor, no un problema de performance (no ralentiza lecturas, sólo agrega costo de escritura marginal).
- Dashboard ya es el patrón correcto: un endpoint agregado, una consulta `Promise.all` de ~15 queries, cacheado.

### 2.2 Matriz de clasificación de datos (A–E)

Esta es la lente que usan las secciones 3, 6 y 10 para decidir la estrategia recomendada por pantalla/dato.

| Categoría | Ejemplos confirmados en esta app | Estrategia esperada | Estado real hoy |
|---|---|---|---|
| **A) Estáticos/casi estáticos** | Empresas, sectores, centros de costo, puestos (catálogo `org-structure`) | Cachear, reutilizar entre pantallas, invalidar sólo al editar | ✅ Correcto — `cachedData` familia `org-structure`, TTL 10min, persistido en IndexedDB, invalidación verificada exhaustiva, reusado por 5+ pantallas sin refetch redundante (confirmado leyendo `cachedData.ts`: dedupe de revalidaciones concurrentes) |
| **B) Configuración** | Turnos (plantillas), Conceptos Horarios, Horas Especiales (reglas), Tipos de novedad, Categorías de documento | Cache por pantalla/módulo, refresh tras mutación, nunca refetch global | ⚠️ Mixto — Conceptos Horarios/Puestos sí cachean (bespoke, correcto); Turnos y Horas Especiales **no cachean nada** (`apiCache:false` boilerplate muerto, sin `cachedData`); Tipos de novedad/Categorías de documento sí cachean en backend (bespoke `listCache`) |
| **C) Operativos** | Fichadas, carga horaria, novedades, documentos | Traer por período/filtro, refresh puntual, mantener datos anteriores durante refresh | ⚠️ Mixto — Carga horaria (`HoursPage`) trae por período correctamente pero **no** mantiene datos anteriores (blanquea 3 secciones en cada refetch); Novedades/Documentos tienen cache backend pero no frontend, y tampoco mantienen datos viejos durante refresh; Asistencia sí filtra por fecha/período correctamente pero su poll de 60s genera parpadeo |
| **D) Críticos** | Fichador (entrada/salida), cierre mensual, aprobación de corrección, exportación | Nunca optimistic update riesgoso, siempre confirmar con backend, trazabilidad | ✅ Correcto donde se verificó con más cuidado — el fichador está 100% confirmado sin ningún optimistic update, cada confirmación espera respuesta real del servidor (ver §4.7). Único hallazgo real de esta categoría: `approveCorrection` no invalida el cache de lectura de horas (ver §4.1) — no es un optimistic update indebido, es un olvido de invalidación |
| **E) Agregados** | Dashboard/métricas | Endpoint agregado, cache corto, refresh manual o al entrar | ✅ Correcto — único endpoint, `Promise.all` interno, cache 30s en backend Y frontend (doble cache con el mismo TTL, ver §4.9 — no es un bug, pero es redundante y no tiene botón de refresh manual) |

### 2.3 Volúmenes reales confirmados (lectura de sólo lectura, sin escritura, contra la base conectada — mismo criterio que 8B/8F/8C)

```
Employee=12          AuditLog≈515-517 (crece continuamente, ya paginado)
ShiftTemplate=2       DoubleHourRule=2        Position=4
HourConcept=5         NoveltyType=1            MonthlyTimeClosure=0
Company=2             Sector=4                 CostCenter=2
EmployeeDocument=0    DocumentCategory=1       User=3
```

**Lectura honesta de estos números**: prácticamente todo lo "fetch-all sin paginar" de la app hoy mueve payloads de pocos KB. Esto significa que la severidad de casi todos los hallazgos de "falta paginación" debe leerse como **riesgo estructural futuro**, no como problema actual — con la única excepción real de `MonthlyTimeClosure`, que crece con el tiempo transcurrido (≈12 filas/mes con la plantilla actual de empleados) en vez de con configuración manual, y por lo tanto sí tiene una trayectoria de crecimiento predecible a vigilar.

## 3. Mapa de pantallas y endpoints

Tabla completa, pantalla por pantalla. "Cantidad estimada de llamadas" separa mount / cambio de filtro / mutación. Todas las filas fueron trazadas leyendo el código real (no estimadas), salvo donde se indica explícitamente "inventario superficial".

### 3.1 Legajos, Novedades, Documentos, Auditoría (patrón de referencia)

| Pantalla | Endpoints al entrar | Endpoints al filtrar | Endpoints al crear/editar/eliminar | Llamadas estimadas | ¿Bloquea pantalla completa? | ¿Mantiene datos viejos en refresh? | ¿Cache? | ¿Duplicadas? | Riesgo | Prioridad |
|---|---|---|---|---|---|---|---|---|---|---|
| **EmployeesPage** (Legajos) | `GET /employees` + `/employees/summary` + catálogo org-structure (3, en paralelo) | 1 por filtro debounced | 1 write (`syncLaborStatuses`) + 2 reload | 3 mount / 1 filtro / 2 mutación | **No** — sólo si `!all.length` | **Sí**, explícito + `peekList()` para pintar instantáneo | Sí — `cachedData`, TTLs 30-60s, invalidación exhaustiva | No | Baja | Baja — ya es el patrón a copiar |
| **NoveltiesPage** (Novedades) | `GET /novelties` (1) | 1 por filtro debounced | 1-2 write + reload condicional | 1 mount / 1 filtro / 1-2 mutación | **Sí**, incondicional, en cada corrida del efecto | No — sin guarda de "ya hay datos" | Backend sí (TTL 15s, invalidación exhaustiva: create/approve/approveMany/reject/remove); **frontend no** — `list()` no usa `cachedData` pese a existir la familia `"novelties"` (sólo se usa para invalidar) | No | Media | Media |
| **DocumentsPage** (Documentos) | `GET /documents` (1) | 1 por filtro debounced | 1 write + reload condicional | 1 mount / 1 filtro / 1-2 mutación | **Sí**, incondicional | No | Backend sí (TTL 20s, único write path invalida correctamente); **frontend no** — ni siquiera existe familia `"documents"` en `cachePolicy.ts` | No | Media | Media |
| **AuditPage** (Auditoría) | `GET /audit` (1) | 1 por página (sin filtros de UI) | N/A (sólo lectura) | 1 mount / 1 por página | **Sí**, incondicional | No | Backend sí (TTL 15s, invalidado centralmente en `auditService.register()`, punto único usado por todos los módulos); frontend no (razonable, es un log casi en tiempo real) | No | Baja | Baja/Media |

### 3.2 Horas y liquidación (mayor riesgo)

| Pantalla | Endpoints al entrar | Endpoints al filtrar | Endpoints al crear/editar/eliminar | Llamadas estimadas | ¿Bloquea pantalla completa? | ¿Mantiene datos viejos en refresh? | ¿Cache? | ¿Duplicadas? | Riesgo | Prioridad |
|---|---|---|---|---|---|---|---|---|---|---|
| **HoursPage** (Carga de horas) | catálogo org-structure + `Promise.all(getPeriodEmployees, getSummary)` | **Un único efecto con 10 dependencias** (`costCenter, debouncedSearch, groupByPerson, page, pendingOnly, period, refresh, reviewPage, user, costCenterOptionsReady`) re-dispara 2-4 llamadas cada vez, varias sin relación real con lo que cambió (ver tabla dedicada abajo) | 1 write + reload compartido (2-3 llamadas) | 3-4 mount / 2-4 por filtro / 1+2-3 mutación | **Sí** — un solo flag `loading` blanquea 3 secciones simultáneamente aunque sólo una tenga datos nuevos | **No** — se blanquea siempre, incluso cuando el cambio no afecta esa sección | Parcial — `getSummary`/`getPeriodEmployees` cacheados (FE 30s + BE 20s); **cola de revisión (`list`/`listByEmployee`) sin cache frontend** | No literal (TTL absorbe la mayoría), pero re-invoca llamadas cuyo resultado no pudo haber cambiado | **Alta** — archivo más grande y riesgoso de la app (1147 líneas) | **Alta — necesita cambio revisado propio, no un quick win** |
| **HoursPage** (Bandeja de revisión, mismo archivo, `pendingOnly=true`) | `getSummary` + `list`/`listByEmployee` + `pendingApiService.getAll` | Mismo efecto compartido — ver arriba | Aprobar/rechazar/devolver → 1 write + reload compartido | Igual que arriba | Igual que arriba | Igual que arriba | `pendingApiService.getAll`: cache frontend sí (30s), backend no | No | Alta (comparte el mismo efecto de arriba) | Alta |
| **EmployeeHoursPage** (grilla individual) | `getTimeGrid` (bloqueante) + novedades del período (background) | Sólo `[id,period]` | Guardado: **actualización optimista local + resync silencioso en segundo plano, sin bloquear** (patrón ya documentado en el propio código) | 3 mount / 3 por período / 1 write + 3 background | Sólo en mount/cambio de id-período | Sí para mutaciones (por diseño); no para cambio de período (muestra placeholder) | `getTimeGrid`: no; catálogo de tipos de novedad: sí (10min) | No | Baja — el mejor comportado de este cluster | Baja |
| **EmployeeDetailPage** (Detalle de legajo, incl. "Datos laborales") | `getOverviewById` + `getOverviewDetailsById` en paralelo (confirmado order-safe, no hay race) + audit (si la tab inicial lo requiere) | Cambio de tab es 100% client-side salvo primera visita a una tab de auditoría | Guardado: 2 duplicate-checks + 1 update, aplicado con `setEmployee` directo (sin refetch del overview) | 2-3 mount / 0 filtro / 3 (+1 si tab de auditoría) mutación | Sólo `loadStatus` bloquea toda la página; `detailsStatus` sólo bloquea las tabs que lo necesitan (render progresivo) | Sí, salvo reintento explícito | No — ninguna de las 2 llamadas de overview usa `cachedData` | No | Baja-Media (sin cache, cada visita repite ambas llamadas desde cero) | Baja |
| **FinnegansExportPage** (exportación) | `getNoveltyRows(period)` (1) | Búsqueda es 100% client-side, 0 llamadas | N/A (sólo lectura + export XLSX client-side) | 1 mount / 1 por período / 0 | Sí, pero es 1 sola llamada | No | No | No | Baja | Baja |

**Tabla de dependencias del mega-efecto de HoursPage** (el hallazgo más importante de esta etapa en términos de UX):

| Dependencia | Llamadas que sí necesitan re-ejecutar | Llamadas que re-ejecutan sin necesidad |
|---|---|---|
| `period` | Todas (parámetro real en las 4) | — |
| `debouncedSearch` | `getPeriodEmployees`, `list`/`listByEmployee` | `getSummary` (no recibe `search`), `pendingApiService.getAll` (no recibe `search`) |
| `costCenter` | `getPeriodEmployees`, `list`/`listByEmployee` | `getSummary`, `pendingApiService.getAll` |
| `page` | `getPeriodEmployees` (sólo si `!pendingOnly`) | `getSummary` |
| `reviewPage` | `list`/`listByEmployee` (sólo si `pendingOnly`) | `getSummary`, `pendingApiService.getAll` (ni siquiera acepta parámetro de página) |
| `groupByPerson` | `list`/`listByEmployee` — **no es un toggle visual puro**, cambia de endpoint (`listByEmployee` vs `.list`), la llamada real es legítima | `getSummary`, `pendingApiService.getAll` |
| `pendingOnly` | Gatilla casi todo el cuerpo | En la práctica nunca cambia en una instancia montada — `/horas` y `/pendientes` son rutas separadas, cada una remonta el componente |
| `refresh` | Todas (única dependencia donde todo lo disparado está justificado) | — |

## 4. Problemas encontrados

Ordenados de mayor a menor relevancia real (no por severidad de volumen, sino por impacto combinado de probabilidad × consecuencia).

**4.1 — Bug real de invalidación de cache (el hallazgo más importante).** `workforce.controller.ts` (`approveCorrection`) mutea `TimeEntry.hours`/`totalMinutes` dentro de una transacción en `workforce.service.ts:141`, pero **nunca llama** `clearTimeEntriesReadCaches()`/`clearEmployeeReadCaches()` — a diferencia de cada escritura equivalente en `timeEntries.controller.ts`, que sí lo hace siempre. Consecuencia: después de aprobar una corrección de horas posterior a un cierre, la grilla de carga horaria, el resumen y el time-grid de legajo pueden mostrar el valor viejo hasta que expire el cache (15-20s). No es un bug de negocio (el dato en la base es correcto), es un bug de lectura stale — pero es exactamente la clase de bug que esta auditoría existe para encontrar. **Candidato de fix limpio para 9B** (agregar las mismas 2 llamadas de invalidación ya usadas en el resto del código — sin cambio de schema, sin cambio de lógica, sin cambio de permisos).

**4.2 — Blanqueo de pantalla en refetch, patrón sistemático.** `NoveltiesPage`, `DocumentsPage`, `AuditPage`, `ShiftsPage`, la tabla de reglas de `WorkScheduleSettingsPage`, y `MonthlyClosuresPage` resetean su flag de loading incondicionalmente en cada corrida de su efecto de carga — cada tecla de búsqueda (post-debounce), cada cambio de página, cada mutación blanquea la tabla completa y muestra el skeleton, aunque ya haya datos visibles en pantalla. `EmployeesPage` ya resuelve esto correctamente (guarda `if (!all.length)`) y es el patrón a copiar. Hoy es principalmente un problema de "se siente entrecortado", no de latencia real — pero es exactamente lo que el pedido original describe como "pantallas que se borran al actualizar".

**4.3 — HoursPage: mega-efecto de 10 dependencias.** Ver tabla dedicada en §3.2. El archivo de mayor riesgo de la app — no se recomienda tocarlo en esta etapa ni en un "quick win", necesita su propio cambio revisado con tests (ver §8).

**4.4 — AttendancePage: parpadeo cada 60 segundos.** El resumen de asistencia hace polling automático cada 60s, y cada ciclo reactiva `loading=true`, reemplazando la tabla por un skeleton — un parpadeo visible mientras el usuario está mirando la pantalla, no sólo en la carga inicial.

**4.5 — Cache de lectura frontend ausente en Novedades/Documentos/Auditoría.** El backend ya cachea estas listas (15-20s TTL), pero el frontend nunca envuelve esas llamadas en `cachedData()` — se pierde el beneficio de "pintar instantáneo" en navegaciones repetidas dentro de la ventana de cache, y ni siquiera existen las familias `"documents"`/`"audit"` declaradas en `cachePolicy.ts`.

**4.6 — UsersPage bloquea la pantalla esperando datos que sólo necesita un modal.** Carga 3 llamadas en paralelo (`users`, catálogo org-structure, `employeeApiService.getOptions({take:1000})`) y bloquea toda la pantalla hasta que las 3 resuelven — pero el catálogo y los 1000 empleados sólo los usa el modal de crear/editar usuario, no la tabla inicial. Además, `userApiService.getAll()` es el único de este cluster que no usa `cachedData`.

**4.7 — Confirmado: el fichador no tiene ningún optimistic update.** Verificación explícita, no asumida: `clockIn()`/`clockOut()` en `TimeClockPage.tsx` sólo abren el modal de cámara, nunca tocan `status`/`result`. La única función que sí llama al backend (`confirmPhotoPunch`) espera la respuesta (`await`) y sólo entonces aplica el resultado, siempre con los datos que vinieron del servidor (`response.employee`, `response.workShift`), nunca con un valor adivinado en el cliente. Si la red falla, hace polling a un endpoint de sólo lectura hasta obtener un estado terminal real, o le informa al usuario que no pudo confirmarse — nunca asume éxito. Esto es exactamente lo que pedía la regla de dominio del fichador. **No es un hallazgo a corregir, es una confirmación positiva.**

**4.8 — Confirmado: TimeClockPage sí tiene debounce.** Una primera pasada de inventario había marcado esto como "sin debounce"; la verificación directa del código encontró un debounce inline correcto (`window.setTimeout(...,250)` con guard `cancelled`), sólo que no reutiliza el hook compartido `useDebouncedValue`. Es un detalle de estilo (código duplicado), no un bug de performance — se documenta acá justamente para dejar constancia de que se verificó y no hace falta ningún fix.

**4.9 — Dashboard: doble cache con el mismo TTL, sin botón de refresh manual.** El backend cachea `/metrics` 30s y el frontend cachea la misma respuesta otros 30s — funcionalmente correcto pero significa que un manager puede tardar hasta ~60s en ver una métrica actualizada después de una mutación real, sin ninguna forma de forzar un refresh. No es un bug, es una oportunidad de UX (botón "Actualizar").

**4.10 — WorkScheduleSettingsPage (Horas Especiales) refetchea catálogos casi estáticos en cada mutación de regla.** Cada vez que se crea/edita/activa/elimina una regla, se vuelve a pedir el catálogo de organización y la lista de puestos completa — datos que casi nunca cambian. El cache absorbe la mayoría de estas llamadas (no genera tráfico de red real dentro del TTL), pero sí genera renders y trabajo innecesario.

**4.11 — ShiftDetailPage trae la lista completa de plantillas de turno para mostrar un solo registro.** No existe un `GET /workforce/shift-templates/:id` — la pantalla de detalle pide la lista entera y filtra por id en el cliente. Con 2 plantillas hoy es intrascendente; escala linealmente con la cantidad de plantillas configuradas y bloquea toda la pantalla mientras tanto.

**4.12 — `positions.repository.ts`: include de 4 niveles, una rama sin consumidor confirmado.** `positionInclude` anida sector→area→establishment→{businessUnit, company} en cada fila. De esas 5 relaciones, 4 se usan en la tabla de Puestos; `establishment.company` se mapea a un campo derivado que un grep completo del frontend confirma que **no se renderiza en ningún lado**. Payload desperdiciado en cada llamada, aunque hoy insignificante (Position=4).

**4.13 — 4 patrones de cache distintos conviviendo en el backend.** El factory compartido `ttlCache.ts` (5 módulos), el patrón "fetch≤500+slice" (positions/hour-concepts), el patrón `listCache` propio (novelty-types/document-categories), y un cuarto caso aislado (`employees.repository.ts`'s `timeGridCatalogCache`). Los 4 funcionan correctamente hoy (invalidación verificada exhaustiva en los 4), pero es deuda de consistencia arquitectónica — un desarrollador nuevo no tiene forma de saber cuál copiar.

**4.14 — `workforce-management` no tiene capa de repository** (Prisma directo en `workforce.service.ts`), y es el único módulo relevante a esta auditoría **sin ningún cache** — `shiftTemplates()`/`closures()`/`doubleRules()` golpean la base en cada llamada, sin `take` en absoluto en 2 de los 3 casos. Se enumeraron exhaustivamente los write paths (ver §6, fila de Horas Especiales/Turnos) — `shiftTemplates()` y `doubleRules()` tienen un conjunto de escrituras cerrado y trivial de enganchar a `ttlCache.ts`; `closures()` tiene 5 puntos de escritura (2 de ellos efectos laterales de flujos de corrección) y requiere más cuidado.

**4.15 — N+1 confirmado, pero fuera del camino de request de las pantallas auditadas.** `clockPunchMaintenance.ts` (`expireOpenWorkShifts`) hace una consulta por cada jornada abierta vencida (acotado a 100) más un loop secuencial de notificaciones — corre en un `setInterval` de mantenimiento en background, nunca disparado sincrónicamente por ninguna de las 4 pantallas del cluster de fichador/asistencia. No afecta la latencia percibida por el usuario hoy, pero es un N+1 real dentro del mismo módulo.

**4.16 — Confirmado, no es un bug: `timeEntries.repository.ts:681` (`take:5000`, sin skip).** Es `findForExport`, ya acotado por período+empleado+estado, cambio deliberado documentado en comentarios de etapas anteriores (8F/6M). Se verificó explícitamente para no dejarlo como un falso positivo en el radar.

**4.17 — `EmployeeDocument.[status, expiresAt]`: índice sin consumidor confirmado.** Ninguna query de lectura actual (ni en `documents/`, ni en `dashboard/`) filtra por `expiresAt`. No ralentiza nada — es trabajo de escritura marginal sin beneficio de lectura hoy. Probablemente pensado para una función de "documentos por vencer" que todavía no se implementó.

## 5. Clasificación por severidad

| # | Hallazgo | Severidad | Por qué |
|---|---|---|---|
| 4.1 | `approveCorrection` no invalida cache de horas | **Media-Alta** | Es el único hallazgo con un vector de dato-stale real y confirmado en producción, aunque acotado a una ventana de 15-20s en un flujo de baja frecuencia (correcciones post-cierre) |
| 4.3 | Mega-efecto de HoursPage | **Alta (estructural)** | No es un bug puntual — es el diseño de la pantalla de mayor uso y mayor superficie de la app; la UX se siente peor de lo necesario en el día a día, aunque no hay pérdida de datos ni de corrección |
| 4.2 | Blanqueo de pantalla sistemático (6 pantallas) | **Media** | UX, no performance real — pero es exactamente el síntoma que el pedido original describe como prioritario ("pantallas que se borran al actualizar") |
| 4.4 | Parpadeo de AttendancePage cada 60s | **Media** | Visible y molesto para uso continuo (supervisión de asistencia en vivo), fix acotado |
| 4.5, 4.6 | Cache frontend ausente (Novedades/Documentos/Auditoría/Usuarios) | **Baja-Media** | El backend ya amortigua la mayoría del impacto; es una optimización de "instantaneidad", no de corrección |
| 4.9, 4.10 | Dashboard sin refresh manual, refetch de catálogo redundante en Horas Especiales | **Baja** | Cosmético/UX, sin riesgo |
| 4.11, 4.12, 4.13, 4.14 | Deuda estructural (ShiftDetailPage sin GET/:id, include profundo, 4 patrones de cache, módulo sin repository/cache) | **Baja hoy / Media futura** | Ninguno es un problema con los volúmenes actuales; todos se vuelven relevantes si el volumen de datos o el número de desarrolladores tocando el código crece |
| 4.15, 4.17 | N+1 de mantenimiento, índice sin consumidor | **Baja** | Sin impacto en la experiencia de usuario hoy |
| 4.7, 4.8, 4.16 | — | **N/A — confirmados como correctos, no son hallazgos** | Documentados para que quede constancia de que se verificaron explícitamente |

## 6. Recomendaciones por pantalla (vista accionable, ordenada por prioridad)

**Alta:**
- **HoursPage (Carga de horas + Bandeja de revisión)**: no tocar en esta etapa. Reservar una etapa propia (9F) para dividir el efecto en 2-3 efectos scoped por dependencia real (ver tabla de §3.2) y desacoplar el flag de `loading` por sección. Requiere tests dedicados dado que alimenta datos payroll-adjacent.

**Media:**
- **workforce.controller.ts (`approveCorrection`)**: agregar `clearTimeEntriesReadCaches()`/`clearEmployeeReadCaches()`, mismo patrón ya usado en el resto del código. Candidato limpio para 9B.
- **NoveltiesPage / DocumentsPage / AuditPage / ShiftsPage / tabla de reglas de WorkScheduleSettingsPage / MonthlyClosuresPage**: copiar el guard `if (!data.length)` de `EmployeesPage` antes de mostrar skeleton en refetch. Candidato limpio para 9B, uno por uno (no un cambio masivo simultáneo).
- **AttendancePage**: el poll de 60s no debería resetear `loading=true` si ya hay datos — mismo patrón que arriba.
- **NoveltiesPage / DocumentsPage / AuditPage**: envolver `list()` en `cachedData()`, declarar familias `"documents"`/`"audit"` en `cachePolicy.ts` (ya existe `"novelties"`, sólo falta usarla para lectura).
- **UsersPage**: diferir la carga del catálogo org-structure y `getOptions({take:1000})` a cuando se abre el modal de crear/editar, en vez de bloquear la tabla inicial. Envolver `getAll()` en `cachedData` como el resto de sus pares.

**Baja (documentar, no priorizar todavía):**
- Turnos/Horas Especiales sin cache backend (`shiftTemplates`/`doubleRules` — write paths ya enumerados como cerrados, ver §10 9C).
- ShiftDetailPage sin `GET /:id` dedicado.
- Dashboard sin botón de refresh manual.
- Consolidar los 4 patrones de cache backend en uno solo (arquitectónico, sin bug detrás).
- Include de 4 niveles en `positions.repository.ts` (evaluar recortar `establishment.company` ya que no se consume).

## 7. Quick wins seguros (documentados, **ninguno implementado en esta etapa**)

Por instrucción explícita del pedido de esta ronda ("ejecutar como auditoría solamente"), **no se aplicó ningún cambio de código**, incluyendo el único candidato que se había pre-aprobado condicionalmente en el plan original (envolver `shiftTemplates()` en cache). Quedan documentados acá, listos para una etapa 9B, en orden de valor/riesgo:

1. **`approveCorrection` — agregar invalidación de cache** (§4.1). El más valioso: cierra un bug real, mínimo blast radius, mismo patrón ya probado en 6 lugares del código.
2. **Guard "no blanquear si ya hay datos"** en Novelties/Documents/Audit/Shifts/WorkScheduleSettingsPage/MonthlyClosures (§4.2). Mecánico, mismo patrón ya probado en `EmployeesPage`, se puede aplicar pantalla por pantalla con su propio test.
3. **AttendancePage — no resetear loading en el poll de 60s** (§4.4).
4. **Cache frontend para Novedades/Documentos/Auditoría** (§4.5) — envolver en `cachedData()`, declarar familias faltantes.
5. **`shiftTemplates()`/`doubleRules()` — envolver en `ttlCache.ts`** (§4.14) — write paths confirmados como conjunto cerrado y enumerable (ver §10, 9C), seguro de implementar cuando se decida tocar backend de nuevo. `closures()` queda deliberadamente afuera de este quick win (5 write paths, 2 de ellos efectos laterales de correcciones — necesita más cuidado).
6. **UsersPage — diferir catálogo/employee-options al abrir el modal** (§4.6).
7. **ShiftDetailPage — endpoint `GET /:id` dedicado** (§4.11) — este sí requiere un cambio de backend (nuevo endpoint), por eso queda como candidato de una etapa futura y no un "quick win" de una sola pantalla.

## 8. Cambios que NO conviene hacer

- **No dividir el mega-efecto de HoursPage como parte de un "quick win".** Cada dependencia individual parece mecánica de resolver, pero el archivo es el de mayor riesgo de la app (payroll-adjacent, review/approve actions) — necesita su propio cambio revisado con tests dedicados, no un parche dentro de una auditoría.
- **No agregar un `take` defensivo a `shiftTemplates()`/`closures()`/`doubleRules()` como "fix de performance".** Un cap silencioso sin paginación real de UI haría desaparecer filas reales sin ningún aviso al usuario — eso es una regresión de negocio disfrazada de mejora de performance, exactamente lo que el pedido original prohíbe.
- **No recortar el include de 4 niveles de `positions.repository.ts` todavía.** Aunque técnicamente no cambia el schema, sí cambia la forma de la respuesta — requiere auditar cada consumidor (tabla, selects, formularios, organigrama) antes de tocarlo con confianza.
- **No consolidar los 4 patrones de cache del backend en uno solo ahora.** Los 4 funcionan correctamente hoy (invalidación verificada exhaustiva en los 4) — es una refactorización de consistencia, no una corrección de bug, y merece su propio cambio revisado, no colgarse de una auditoría.
- **No introducir React Query/SWR ni ninguna librería de data-fetching.** El cache casero (`services/cache/`) ya resuelve lo esencial (stale-while-revalidate, dedup, TTL por familia, persistencia); no hay ningún problema encontrado en esta auditoría que una librería nueva resuelva mejor que extender lo que ya existe.
- **No tocar nada del fichador.** Confirmado explícitamente correcto (§4.7/4.8) — cualquier cambio ahí, incluso "de performance", es el tipo de riesgo que el pedido original pidió evitar por completo.
- **No estimar volúmenes de datos futuros a partir de datos de seed/demo.** Todos los conteos de esta auditoría son lecturas reales contra la base conectada, no estimaciones — donde no se pudo confirmar un dato, se documentó como "no confirmado" en vez de inventarlo.

## 9. Riesgos

- **El mega-efecto de HoursPage es deuda que crece con cada feature nueva que se agregue a esa pantalla.** Cuanto más se tarde en abordarlo (9F), más dependencias nuevas es probable que se agreguen al mismo efecto compartido, aumentando el costo de separarlo después.
- **`MonthlyTimeClosure` es la única tabla de esta auditoría con una trayectoria de crecimiento clara** (≈12 filas/mes) — aunque hoy está en 0, es la candidata más predecible a necesitar paginación real primero, antes que cualquier catálogo administrado a mano.
- **La falta de invalidación en `approveCorrection` (§4.1) es del tipo de bug que no se nota en desarrollo/QA con pocos datos y sólo se hace visible con uso real concurrente** (dos personas mirando la misma grilla mientras se aprueba una corrección) — vale la pena priorizarlo en 9B aunque el volumen actual no lo haga urgente.
- **Ninguna validación de código corrió en esta etapa** porque no se tocó ningún archivo de código — la próxima etapa que sí toque código debe correr el set completo de validaciones (prisma validate/generate/migrate status, typecheck, vitest, build, ambos lados) antes de considerar cualquier fix terminado.
- **Esta auditoría se basó en lectura de código + conteos de filas reales, no en profiling en vivo ni en métricas de producción.** Si existiera telemetría real de tiempos de respuesta o de frecuencia de uso por pantalla, algunas prioridades acá podrían reordenarse — se documenta como limitación conocida, no se inventó ningún dato de esa naturaleza.

## 10. Plan de implementación por etapas

- **9B — Quick wins seguros**: los 6 ítems de §7.1-7.6 (fix de invalidación de `approveCorrection`, guard de "no blanquear" en las 6 pantallas listadas, fix del parpadeo de AttendancePage, cache frontend para Novedades/Documentos/Auditoría, cache backend para `shiftTemplates`/`doubleRules`, diferir catálogos de UsersPage). Cada uno con su propio test, cada uno revisable/aprobable por separado — no un solo commit gigante.
- **9C — Cache/catálogos**: extender cache a los módulos que hoy no tienen ninguno donde tenga sentido sin violar la regla de fichador (`attendanceApiService`/`shiftAlertApiService`/`shiftAssignmentApiService` donde el dato no sea timestamp-sensible — confirmar caso por caso, nunca `timeClockApiService`). Decidir explícitamente si se consolidan los 4 patrones de cache backend en uno solo, o si se documenta y se acepta la convivencia.
- **9D — Calendarios**: hoy sólo hay un calendario real en la app (Horas Especiales), que ya implementa la estrategia recomendada por defecto para cualquier calendario futuro: **mes visible + invalidación tras mutaciones** (opción "e" del pedido original), no precarga de año completo (no se justifica con los volúmenes actuales de ninguna tabla de esta auditoría). Extraer el patrón `refreshToken`+`hasLoadedRef` a un hook reusable (`useSilentRefresh` o similar) para que el próximo calendario no lo reinvente desde cero.
- **9E — Tablas y filtros**: paginación real (server-side, con `Pagination.tsx`) para las pantallas fetch-all identificadas (Puestos, Turnos, Horas Especiales, Conceptos Horarios, Tipos de novedad, Categorías de documento), priorizadas por trayectoria de crecimiento (`MonthlyTimeClosure`-adjacent primero) más que por volumen actual.
- **9F — Carga horaria**: la etapa dedicada al mega-efecto de HoursPage (§4.3) — la única pieza de este documento que requiere diseño propio antes de tocar código, no un quick win.
- **9G — Dashboards/reportes**: evaluar si `MonthlyClosuresPage`/`ReportsPage` deberían adoptar el patrón de endpoint agregado que ya usa `/metrics`; agregar botón de refresh manual al Dashboard.

## 11. Reglas de arquitectura frontend para futuro

### 11.1 Casos específicos

**Calendarios.** Estrategia por defecto: mes visible + invalidación tras mutación (patrón ya implementado en `SpecialHourRulesCalendarMonth.tsx`/`WorkScheduleSettingsPage.tsx` — `refreshToken` prop + ref de "ya cargué este mes" para distinguir primera carga de refresh silencioso). No precargar mes anterior/siguiente ni año completo salvo que un caso concreto con volumen alto lo justifique explícitamente.

**Catálogos.** Empresas/sectores/centros de costo/puestos/conceptos/reglas: cachear con `cachedData()` de `frontend/src/services/cache/`, TTL 5-10min, invalidar sólo al escribir esa entidad. Nunca refetch global al navegar entre pantallas — el cache ya deduplica llamadas concurrentes y sirve desde memoria/IndexedDB dentro del TTL (verificado leyendo `cachedData.ts`, no asumido).

**Tablas.** Paginación server-side real (`Pagination.tsx` + `take`/`page`/`meta`) para cualquier tabla cuyo dato escale con empleados, tiempo transcurrido, o uso operativo diario. Fetch-all-con-cap (`take:500`) sólo aceptable para catálogos administrados a mano con expectativa de bajo volumen (decenas de filas, no cientos).

**Formularios.** Catálogos usados por selects deben venir de `cachedData()`, nunca refetch en cada apertura de formulario. Guardado exitoso debe actualizar estado local (`setState` con la respuesta del backend) en vez de recargar toda la lista, salvo que la lista realmente necesite reordenarse/refiltrarse por el cambio.

**Dashboard.** Un endpoint agregado por dashboard, cache corto (30s), sin refetch por card individual. Considerar refresh manual explícito si el dashboard se usa para monitoreo frecuente.

**Fichador.** Regla no negociable, confirmada correcta hoy: sin optimistic update en confirmaciones de fichada, sin cachear ningún dato sensible al timestamp (estado de fichada, hora de entrada/salida). Cualquier cambio futuro a este módulo debe re-verificar explícitamente que esto se mantiene así.

**Carga horaria.** Edición de celda: preferir actualización optimista local + resync silencioso en segundo plano (patrón ya implementado en `EmployeeHoursPage.tsx`) sólo para ediciones de bajo riesgo (no aprobación/cierre). Invalidación de cache por período+persona, nunca invalidación global. No bloquear la grilla completa por el guardado de una sola celda.

### 11.2 Reglas futuras (pedidas verbatim, con nota de qué hallazgo de esta auditoría las ilustra donde aplica)

1. No bloquear toda la pantalla salvo carga inicial real. *(Violado hoy en §4.2, §4.6.)*
2. Después de una mutación, invalidar sólo datos relacionados. *(Violado hoy en §4.1.)*
3. Mantener datos anteriores durante refresh silencioso. *(Violado hoy en §4.2, §4.4; bien implementado en `EmployeesPage`/`EmployeeHoursPage`/calendario de Horas Especiales.)*
4. Cachear catálogos. *(Bien implementado para org-structure/positions/hour-concepts; ausente para Turnos/Horas Especiales — §4.14.)*
5. Usar debounce en búsquedas. *(Ya aplicado consistentemente donde hay búsqueda — único caso con implementación duplicada en vez de compartida es TimeClockPage, §4.8, no es un bug.)*
6. Usar paginación en tablas grandes. *(Ausente en 6 pantallas de configuración — §3, sin urgencia hoy por volumen, ver §2.3.)*
7. No traer años completos salvo que el volumen sea bajo y esté justificado. *(No se encontró ningún caso de esto en la app hoy — cumplido.)*
8. En calendarios, usar mes visible + cache/precarga o año completo según volumen. *(Ver §11.1 — cumplido en el único calendario real de la app.)*
9. No hacer optimistic update en acciones críticas. *(Confirmado cumplido en fichador — §4.7. Sí se usa optimistic update, correctamente, en `EmployeeHoursPage` para ediciones no críticas.)*
10. No consultar lo mismo dos veces en montaje inicial. *(No se encontró ningún caso de duplicación literal en mount en las 23 pantallas auditadas — cumplido.)*
11. No refrescar toda la app después de guardar una entidad. *(Cumplido — cada mutación recarga sólo su propia lista/pantalla, nunca dispara un refresh global.)*
12. No mostrar loading global para cambios locales. *(Violado en §4.2, §4.4, §4.6.)*
13. Separar loading inicial de refreshing. *(Bien implementado en `EmployeesPage`/`EmployeeHoursPage`/calendario de Horas Especiales — patrón a generalizar, ver §10 9D.)*
14. Manejar errores localmente por sección. *(Ya implementado ampliamente vía `ErrorState`/`EmptyState` con variantes default/compact — sin hallazgos de errores "gigantes fuera de contexto" en esta auditoría.)*
15. Medir antes de reescribir. *(Principio rector de esta propia etapa 9A — todos los conteos de §2.3 son mediciones reales, no estimaciones, y ningún hallazgo de este documento se tradujo en un cambio de código sin evidencia de código trazado.)*

## 12. Reglas de arquitectura backend para futuro

- Todo módulo de lectura frecuente (≥1 pantalla que lo consulta en cada mount/filtro) debe tener una capa de cache explícita, preferentemente `backend/src/shared/cache/ttlCache.ts` (el patrón ya usado en 5 módulos) en vez de inventar un patrón nuevo — hoy conviven 4 estilos distintos (§4.13), evitar agregar un quinto.
- Toda función de escritura sobre una entidad cacheada debe invalidar su cache de lectura en el mismo commit que la introduce — el hallazgo de §4.1 es exactamente el costo de no hacerlo de forma sistemática/revisable.
- Antes de agregar un cache nuevo, enumerar exhaustivamente todos los write paths de la(s) tabla(s) involucradas (grep de `prisma.<model>.` en todo `backend/src`, no sólo en el módulo "dueño") — si el conjunto de escrituras no es cerrado y enumerable con confianza, no cachear todavía (criterio aplicado en esta auditoría para separar `shiftTemplates()`/`doubleRules()`, seguros, de `closures()`, que necesita más análisis).
- No agregar un `take` defensivo sin paginación real de UI como "fix de performance" — es una regresión de negocio disfrazada (§8).
- Todo módulo nuevo con lista/detalle debe seguir el patrón ya establecido (`$transaction([findMany({skip,take}), count])`) desde el día uno, no como una migración posterior.
- Preferir un endpoint agregado (`Promise.all` interno) sobre que el frontend dispare N llamadas pequeñas cuando los datos se muestran juntos en una sola vista — el patrón de `/dashboard/metrics` es el ejemplo a copiar.
- Un include de más de 2-3 niveles de profundidad en una query de listado es una señal de alerta — confirmar que cada nivel se consume en el frontend antes de aceptarlo (§4.12).
- `workforce-management` debería eventualmente ganar una capa de repository propia (hoy tiene Prisma directo en el service) — no es un problema de performance en sí, pero es la causa raíz de por qué ese módulo quedó afuera del patrón de cache compartido que sí tienen sus pares.

## 13. Checklist para prompts futuros

Antes de dar por terminada cualquier pantalla/feature nueva que cargue datos, confirmar:

- [ ] ¿Qué catálogos usa? ¿Ya existen cacheados en `frontend/src/services/cache/`? Reusar, no reinventar.
- [ ] ¿El fetch inicial bloquea toda la pantalla o sólo la sección que realmente depende de ese dato?
- [ ] ¿El efecto de carga tiene más de 3-4 dependencias? Si sí, ¿todas las llamadas dentro del efecto realmente dependen de todas esas dependencias, o hay llamadas que se re-disparan sin necesidad? (ver §3.2 como ejemplo de cómo mapear esto)
- [ ] ¿Un refetch (filtro, paginación, refresh tras mutación) blanquea datos ya visibles, o los mantiene mientras llega la respuesta nueva?
- [ ] ¿La búsqueda de texto usa `useDebouncedValue`?
- [ ] ¿La tabla puede crecer más allá de unas pocas decenas de filas con uso normal? Si sí, paginación server-side desde el día uno, no fetch-all.
- [ ] ¿La mutación invalida exactamente los caches relacionados (frontend y backend), ni más ni menos? Enumerar los write paths antes de decidir qué invalidar.
- [ ] ¿Es un dato crítico/timestamp-sensible (fichador, cierre, aprobación)? Si sí: sin cache, sin optimistic update, siempre confirmar con el backend.
- [ ] ¿Se está agregando un cache nuevo? ¿Se enumeraron todos los write paths de esa tabla en todo el backend, no sólo en el módulo actual?
- [ ] ¿Se está por reescribir algo "porque parece lento"? ¿Hay una medición real (conteo de filas, lectura de código trazando llamadas) detrás, o es una suposición?

## 14. Etapa 9B — Quick wins implementados

Fecha: 2026-08-27. Alcance ejecutado: exactamente los 3 puntos de código habilitados por el pedido de 9B (bug de invalidación de `approveCorrection`, blanqueo de pantalla en refetch, parpadeo de 60s de Asistencia) — nada de paginación estructural, nada de cache backend nuevo para `workforce-management`, nada de catálogos diferidos en `UsersPage`, sin tocar Conceptos Horarios/Turnos/Dashboard, sin cambios de schema/permisos/contratos de API, sin librerías nuevas.

### 14.1 Bug corregido: `approveCorrection` no invalidaba el cache de horas (§4.1)

`backend/src/modules/workforce-management/workforce.controller.ts` — el handler `approveCorrection` ahora llama `clearTimeEntriesReadCaches()` y `clearEmployeeReadCaches()` después de que el service confirme la corrección, mismo patrón exacto ya usado en los ~10 write paths de `timeEntries.controller.ts`. Sin cambios en `workforce.service.ts` (la lógica de negocio no se tocó), sin cambio de contrato de la respuesta. Test nuevo: `workforce.controller.test.ts` (4 casos — invalida ambos caches, en el orden correcto respecto del service, y sin cambiar la respuesta).

### 14.2 Blanqueo de pantalla en refetch — corregido en 5 de las 6 pantallas de §4.2

Se copió el guard `if (!data.length) setLoading(true)` de `EmployeesPage` (la referencia que la propia 9A identificó como correcta) a:

- `NoveltiesPage.tsx` — guard sobre `novelties.length`.
- `DocumentsPage.tsx` — guard sobre `docs.length`.
- `AuditPage.tsx` — guard sobre `audits.length`.
- `WorkScheduleSettingsPage.tsx` — guard sobre `rules.length`, sólo en la sección "Reglas configuradas"; el calendario de la misma pantalla no se tocó (ya tenía su propio refresh silencioso desde la Etapa 8B).
- `MonthlyClosuresPage.tsx` — mismo guard, pero implementado con un `useRef` (`hasLoadedDataRef`) en vez de leer `closures.length`/`employees.length` directo: `load()` está memoizado con `useCallback([period])` y se invoca también desde `execute()` (fuera del efecto de montaje), así que leer el estado por closure hubiera sido un valor stale entre renders donde `period` no cambió — el mismo bug que motivó el fix de §14.1, pero del lado del frontend. El test de esta pantalla ejercita exactamente ese camino (aprobar un cierre, que dispara `load()` desde `execute()`, no desde el montaje) para confirmar que el fix es real y no un guard que nunca se ejercita.

**Pendiente, no tocada: `ShiftsPage.tsx` (Turnos).** Es la sexta pantalla listada en §4.2/§7.2, y el mismo guard mecánico aplicaría igual de simple que en las otras 5 — pero el pedido de esta etapa excluyó explícitamente el módulo Turnos sin excepción (a diferencia de Horas Especiales, que sí tenía una excepción explícita para tocar justamente este patrón ya auditado). Queda documentada para una etapa futura, sin ningún cambio de código.

### 14.3 Parpadeo de Asistencia cada 60s — corregido (§4.4)

`AttendancePage.tsx` — el efecto que trae el resumen (`getSummary`, dependencias `[date, refreshKey]`) ahora sólo muestra el loading grande cuando todavía no hay `summary` en memoria (`if (!summary) setLoading(true)`). El poll automático de 60s sigue funcionando exactamente igual (no se tocó el `setInterval` ni su lógica), pero cada ciclo ahora es silencioso: las tablas de jornadas abiertas/cerradas no se reemplazan por el skeleton, y como el estado `date`/filtros no se toca en ningún punto de este cambio, tampoco se pierden. El manejo de errores del poll ya era correcto antes de este cambio (no borraba `summary` en el catch, sólo mostraba un banner chico) — no hizo falta tocar esa parte. Test nuevo: `AttendancePage.test.tsx` (2 casos — loading grande en la carga inicial, y con `vi.useFakeTimers()` avanzando 60s: confirma que la fila anterior sigue visible, que no aparece el skeleton, y que el input de fecha conserva su valor).

### 14.4 Patrón adoptado (referencia para desarrollo futuro)

- **Loading inicial vs. refreshing**: un flag de loading que bloquea una sección sólo debe encenderse cuando esa sección todavía no tiene datos (`if (!data.length) setLoading(true)`, o un `useRef` equivalente si la función de carga está memoizada y se invoca fuera del efecto que la creó — ver §14.2). Nunca `setLoading(true)` incondicional al principio de una función de carga que también se usa para refrescos.
- **Mantener datos anteriores**: al no re-encender el loading grande, la UI sigue mostrando lo último renderizado hasta que el nuevo `setState` con la respuesta la reemplaza — no hace falta ningún estado ni componente adicional para "conservar" los datos, es una consecuencia directa de no blanquear.
- **Invalidar sólo caches relacionados**: cada escritura debe invalidar exactamente los caches de lectura que su propia tabla afecta (ver el patrón ya establecido en `timeEntries.controller.ts`, replicado ahora en `workforce.controller.ts` para `approveCorrection` — §14.1). Antes de escribir una función que mute una entidad cacheada, grepear quién más cachea esa lectura y confirmar que se invalida ahí también.
- **No blanquear pantalla durante refetch**: aplicado en 5 pantallas esta etapa (§14.2); la sexta (`ShiftsPage`) queda con el mismo patrón documentado y pendiente de aplicar en una etapa futura sin necesidad de rediseño.
- **Errores localizados por sección**: no se tocó nada acá — ya estaba bien implementado en las 5 pantallas modificadas (`ErrorState`/`div.form-error` embebidos, no un error de página completa) y se confirmó que ninguno de los cambios de 9B lo rompió (los 12 tests nuevos cubren tanto el camino feliz como que el error sigue contenido).
- **No optimistic update en acciones críticas**: no aplica a ninguno de los 3 cambios de esta etapa (ninguno toca fichador ni ninguna acción crítica) — se mantiene la regla ya confirmada en 9A §4.7, sin cambios.

### 14.5 Tests agregados

Backend: `workforce.controller.test.ts` (4 tests nuevos, archivo nuevo). Total backend: 685 tests (681 + 4).

Frontend: `NoveltiesPage.test.tsx` (2, archivo nuevo), `DocumentsPage.test.tsx` (2, archivo nuevo), `AuditPage.test.tsx` (2, archivo nuevo), `MonthlyClosuresPage.test.tsx` (2, archivo nuevo), `AttendancePage.test.tsx` (2, archivo nuevo), `WorkScheduleSettingsPage.test.tsx` (+2 sobre el archivo existente). Total frontend: 343 tests (331 + 12).

### 14.6 Validaciones ejecutadas tras 9B

Backend: `npx prisma validate` ✅, `npx prisma generate` ✅, `npx prisma migrate status` ✅ (45 migraciones, sin cambios — ninguna migración nueva en esta etapa), `npm run typecheck` ✅, `npx vitest run` ✅ 685/685, `npm run build` ✅.
Frontend: `npx tsc -b` ✅, `npx vitest run` ✅ 343/343, `npm run build` ✅.
General: `git diff --check` sin errores de espacios en blanco.

### 14.7 Siguiente etapa recomendada

9C (extender cache a módulos que hoy no tienen ninguno — `shiftTemplates`/`doubleRules`, con los write paths ya enumerados en §4.14/§10 — más el guard pendiente de `ShiftsPage` documentado en §14.2), o cualquiera de 9D-9G según prioridad de negocio.

## 15. Etapa 9C — Cache backend seguro y refresh silencioso pendiente

Fecha: 2026-08-27. Alcance ejecutado: los 3 puntos habilitados por el pedido (cache de `shiftTemplates`, evaluación + cache de `doubleRules`, guard pendiente de `ShiftsPage`) — nada de paginación estructural, sin tocar fichador/carga horaria/Conceptos Horarios/dashboard/usuarios/documentos/novedades/legajos, sin schema, sin migraciones, sin librerías nuevas, sin cambio de contratos de API ni permisos.

### 15.1 Cache backend implementado: `shiftTemplates`

Nuevo `backend/src/modules/workforce-management/workforce.cache.ts` — mismo patrón que `dashboard.cache.ts`/`novelties.cache.ts`/`documents.cache.ts` (`createTtlCache` de `backend/src/shared/cache/ttlCache.ts`, TTL 30s). `workforce.controller.ts` — el handler `shiftTemplates` ahora hace lectura pasante por cache (clave `usuario:rol:URL`, mismo `userScopedCacheKey` ya duplicado en 4 controllers — se replicó el mismo helper acá en vez de extraerlo a un util compartido, para no exceder el alcance de esta etapa); `createShiftTemplate`/`updateShiftTemplate`/`removeShiftTemplate` invalidan el cache tras escribir. **Write paths verificados exhaustivamente** (grep de `.shiftTemplate.create/update/delete/upsert/updateMany/deleteMany` en todo `backend/src`, no sólo en el módulo): exactamente 4 llamadas, las 4 dentro de esas 3 funciones de `workforce.service.ts`, ningún mutador externo. Sin cambio de shape de respuesta (`{data: [...]}` idéntico a antes). Tests: 4 casos nuevos en `workforce.controller.test.ts` (primera lectura golpea el service, segunda usa cache, cada uno de los 3 mutadores invalida y la siguiente lectura vuelve a golpear el service).

### 15.2 `doubleRules` — evaluado y sí implementado, con evidencia

Se enumeraron exhaustivamente (grep en todo `backend/src`, no sólo `workforce-management`) los write paths de las 3 tablas involucradas:

- **`DoubleHourRule`**: 4 llamadas (`create`, 2×`update`, `delete`), las 4 dentro de `createDoubleRule`/`updateDoubleRule`/`removeDoubleRule` en `workforce.service.ts`. Conjunto cerrado.
- **`DoubleHourRuleEmployee`**: **cero** llamadas directas en todo el backend — sólo se escribe como write anidado dentro de `doubleHourRule.create`/`update` (`employees: {create:...}` / `employees: {deleteMany:{}, create:...}`), ya cubierto por invalidar en esas mismas 2 funciones.
- **`SpecialHourRuleDate`**: **cero** llamadas directas — mismo caso, sólo anidado dentro de `doubleHourRule.create`/`update` (`dates: {create:...}` / `dates: {deleteMany:{}, create:...}`). No existe un endpoint separado de "agregar fecha"/"quitar fecha"/"activar fecha" — el frontend siempre manda el array completo de `dates` en el mismo `PATCH` de la regla (así quedó diseñado desde la Etapa 8B), así que no hay ningún mutador de fechas por fuera de `updateDoubleRule` que pudiera quedar sin invalidar.

Con eso confirmado — conjunto de escritura cerrado, enumerable, sin mutadores externos, igual de simple que `shiftTemplates` — se implementó: mismo archivo `workforce.cache.ts` (`doubleRulesCache`, TTL 30s), lectura pasante en `doubleRules` del controller, invalidación en `createDoubleRule`/`updateDoubleRule`/`removeDoubleRule`.

**Por qué no queda stale el calendario ni el motor de cálculo** (los dos riesgos que el pedido pidió confirmar explícitamente antes de cachear):
- El **motor** (`timeEntries.repository.ts`, `createFromWorkShift`/`closeOpenWorkShift`) consulta `tx.doubleHourRule.findMany(...)` directo contra Prisma dentro de su propia transacción — un código completamente separado de `workforceService.doubleRules()`. El cache nuevo sólo envuelve la lectura de la tabla de reglas de `WorkScheduleSettingsPage.tsx`; el motor nunca pasa por ahí, así que sigue viendo siempre el estado real de la base al fichar, sin ningún cambio de comportamiento.
- El **calendario visual** (`GET /workforce/double-hour-rules/calendar` → `calendarPreview()`) es otra función distinta, con su propia query (filtro por `status`/`fromDate`/`toDate`, sin relación con `doubleRules()`), y no se tocó — sigue sin cache, tal como ya lo confirmó 9A, y sigue recibiendo el refresh-tras-mutación que ya tenía desde la Etapa 8B (`refreshToken`/`hasLoadedCurrentMonth`).

Tests nuevos en `workforce.controller.test.ts`, además de los 3 genéricos (primera lectura/cache hit/shape de respuesta): un test por cada escenario específico pedido — actualizar las fechas de una regla de feriado (`updateDoubleRule` con `dates`), cambiar la prioridad (`updateDoubleRule` con `priority`), y activar/desactivar una regla (`updateDoubleRule` con `status`, más `removeDoubleRule`) — cada uno confirma que la siguiente lectura de `doubleRules` vuelve a golpear el service en vez de servir el valor cacheado.

### 15.3 ShiftsPage — guard de refresh silencioso aplicado (pendiente de 9B)

`frontend/src/pages/ShiftsPage.tsx` — mismo guard `if (!templates) setLoadStatus("loading")` ya usado en las 5 pantallas de 9B, aplicado sobre el único efecto de carga (dependencia `[refresh]`, se dispara también tras activar/inactivar un turno). Los filtros (`search`/`status`) ya vivían en estado separado, sin relación con el efecto de carga, así que no hacía falta ningún cambio adicional para "no perder filtros" — es una consecuencia directa de no tocar ese estado. Sin cambios de lógica, de backend, ni de diseño. Tests nuevos: `ShiftsPage.test.tsx` (3 casos — loading grande en la carga inicial, activar/inactivar un turno ya cargado no blanquea la tabla ni pierde un filtro de búsqueda ya tipeado y la acción de toggle sigue funcionando igual, y el filtro de estado sigue funcionando correctamente después de un refresh).

### 15.4 Qué quedó pendiente

- `calendarPreview()` (calendario de Horas Especiales) sigue sin cache — deliberado, ver §15.2.
- El resto de los módulos sin cache identificados en 9A (`attendanceApiService`, `shiftAlertApiService`, `shiftAssignmentApiService` del lado backend) siguen sin tocar — fuera del alcance explícito de esta etapa.
- La duplicación del helper `userScopedCacheKey` (ahora en 5 controllers) sigue sin extraerse a un util compartido — es deuda de consistencia ya señalada en 9A §4.13, no se resuelve acá para no exceder el alcance de "cambios chicos".

### 15.5 Reglas futuras (agregadas a las de §11/§12)

- **Cache sólo con invalidación explícita**: nunca agregar un cache de lectura sin, en el mismo cambio, agregar la invalidación en cada mutador — y sin antes enumerar exhaustivamente esos mutadores con un grep en todo el backend, no sólo en el módulo dueño (criterio aplicado en §15.1/§15.2, el mismo que ya pedía §12).
- **Datos críticos no se cachean si puede afectar trazabilidad**: si un dato alimenta el motor de cálculo de horas, el fichador, o cualquier flujo donde una lectura stale pudiera traducirse en una decisión de negocio incorrecta (aprobar, liquidar, fichar), no se cachea esa lectura — o, si se cachea una lectura *adyacente* (como acá con `doubleRules`), hay que confirmar y documentar explícitamente que el motor real no pasa por ese mismo cache (§15.2).
- **Configuración puede cachearse con TTL e invalidación**: turnos, horas especiales, conceptos horarios, catálogos — mientras el conjunto de mutadores sea cerrado y enumerable, un TTL corto (20-30s, igual que el resto de los módulos ya cacheados) más invalidación en cada escritura es seguro.
- **Refresh silencioso sin borrar datos**: todo efecto de carga que también se reutiliza para refrescos (tras una mutación, un poll, un cambio de filtro) debe encender el loading grande sólo si todavía no hay datos — nunca incondicional (patrón ya establecido en 9B §14.4, aplicado de nuevo acá a `ShiftsPage`).

## 16. Etapa 9E — Paginación real y reducción de fetch-all

Fecha: 2026-08-27. Alcance ejecutado: las 7 pantallas listadas en el pedido, cada una diagnosticada antes de decidir si se paginaba, se difería un catálogo, o se documentaba como fetch-all justificado. Sin rediseño visual, sin cambiar reglas de negocio, sin permisos, sin schema, sin migraciones, sin librerías nuevas — el fichador y Carga de horas no se tocaron en absoluto (ni siquiera para verificar), Conceptos Horarios/Turnos/Dashboard tampoco.

### 16.1 Diagnóstico por pantalla

| Pantalla | ¿Fetch-all hoy? | Endpoint | ¿Backend soporta page/take/search? | ¿Frontend usa `Pagination.tsx`? | ¿Búsqueda/filtro? | ¿Necesita debounce? | ¿Operativo o catálogo chico? | Decisión |
|---|---|---|---|---|---|---|---|---|
| **Puestos** | Sí — hasta 300, filtrado 100% client-side | `GET /positions` | Sí (search/status/sectorId ya andaban; areaId/establishmentId/businessUnitId/salaryRangeCategory se aceptaban en la query pero **nunca se traducían a un `where` real** — gap cerrado en esta etapa) | No (antes) | Sí, 6 dimensiones (texto + 5 selects) | Sí, ya tenía `useDebouncedValue` disponible en el resto de la app | Operativo — puede crecer con la complejidad organizacional | **Paginar ahora** — implementado |
| **Usuarios** | Parcial — la tabla de usuarios sí pagina en backend, pero el catálogo (empresas/sectores) y hasta 1000 empleados se cargaban en el montaje de la página, bloqueándola, para un modal que ni siquiera estaba abierto | `GET /users`, `GET /org-structure`, `GET /employees/options` | Ya soportaba | N/A (no aplica paginación a la tabla, User=3 hoy — cuentas de acceso, no crece con headcount) | No hay buscador en esta pantalla (confirmado en 9A) | No aplica | Catálogo chico (usuarios de sistema) — la tabla en sí no necesitaba paginar | **Diferir el catálogo del modal** — implementado |
| **Conceptos Horarios** | Sí — hasta 500, con cache bespoke (TTL 120s) | `GET /hour-concepts` | **Sí, ya soporta paginación real** (`findMany` con path filtrado `skip/take/count`, igual patrón que Puestos tenía antes de esta etapa) — sólo el frontend no lo usa | No | No (`HourConceptsPage` no tiene buscador) | No aplica | Catálogo chico — vocabulario fijo de conceptos (Normal, Nocturna, Guardia, Sereno, etc.), HourConcept=5 hoy, jamás se espera que supere unas pocas decenas | **Fetch-all justificado** — documentado, no tocado |
| **Tipos de novedad** | Sí — hasta 500, cache bespoke (TTL) | `GET /novelty-types` | **Sí, ya soporta paginación real** (mismo patrón dual filtrado/cacheado) | No | No | No aplica | Catálogo chico — vocabulario fijo (Vacaciones, Licencia médica, etc.), NoveltyType=1 hoy | **Fetch-all justificado** — documentado, no tocado |
| **Categorías de documento** | Sí — hasta 500, cache bespoke (TTL) | `GET /document-categories` | **Sí, ya soporta paginación real** (mismo patrón dual) | No | Cliente (`getFiltered`) | No aplica | Catálogo chico — vocabulario fijo (DNI, CUIL, Certificado laboral, etc.), DocumentCategory=1 hoy | **Fetch-all justificado** — documentado, no tocado |
| **Cierres mensuales** | Sí — `closures()` sin `take` en absoluto, `corrections()` con `take:500` fijo | `GET /workforce/closures`, `GET /workforce/corrections` | No (nunca se agregó) | No | Sólo por período (mes) | No aplica | **Operativo, categoría D (crítico) de la matriz 9A §2.2** — cierre/aprobación, crece con el tiempo (~12 filas/mes), MonthlyTimeClosure=0 hoy | **Diferir — no por volumen, por diseño** (ver §16.5) |
| **Organigrama / Estructura organizacional** | `OrganigramasPage`: hasta 1000 empleados, con aviso de límite ya visible al usuario si se alcanza. `OrgStructurePage`: hasta 500, cacheado 10min | `GET /employees/org-chart`, `GET /org-structure` | N/A (por diseño: un organigrama/catálogo jerárquico completo es el caso de uso correcto, no una lista para paginar) | No aplica | No | No aplica | Estructural — Company=2, Sector=4, CostCenter=2 hoy, crecimiento lento y acotado | **Ya correcto — auditado, sin cambios** |

### 16.2 Puestos — paginación real implementada

**Backend** (`backend/src/modules/positions/`):
- `positions.schemas.ts` — `listPositionsQuerySchema` gana `areaId`/`establishmentId`/`businessUnitId` (uuid, opcionales). `salaryRangeCategory` ya existía en el schema.
- `positions.repository.ts` — `buildWhere()` ahora traduce los 3 filtros nuevos navegando la relación `sector→area→establishment→businessUnit` que `positionInclude` ya usaba para mostrar los derivados (sin agregar ninguna columna ni relación nueva), y **`salaryRangeCategory`, que ya se aceptaba en la query pero nunca se aplicaba como filtro real, ahora sí filtra** (`salaryCategories: { some: { salaryCategory: { name } } }`) — un bug de corrección necesario para que la paginación combinada con ese filtro no devolviera resultados incompletos ("paginación frontend falsa", exactamente lo que el pedido de esta etapa prohíbe). `hasFilters` se actualizó para incluir los 3 filtros nuevos.
- Nada de esto cambia el contrato de `GET /positions` para los callers existentes — todos los filtros son opcionales, `meta` sigue con la misma forma (`{total,page,pageSize,hasMore}`).

**Frontend** (`frontend/src/services/api/positionApiService.ts`, `frontend/src/pages/PuestosPage.tsx`):
- Nuevo método `list(filters)` — paginado real, `{items, meta}`, cacheado con la nueva policy `positionsList` (30s TTL, misma familia `"positions"` que `positionsCatalog`, así que un create/update/delete invalida ambos). **`getAll()` queda sin tocar** — lo siguen usando `WorkScheduleSettingsPage.tsx` y otros selects/catálogos que necesitan "todos los puestos activos" de una sola vez, sin ningún cambio de comportamiento para ellos.
- `PuestosPage.tsx` — la tabla pasa a usar `list()` + `Pagination.tsx` + `useDebouncedValue` en la búsqueda + el guard de no-blanquear-si-ya-hay-datos (mismo patrón de 9B/9C). Las tarjetas resumen y las opciones de "Rango salarial" del filtro siguen alimentándose de un fetch aparte con `getAll()` (sin cambios, hasta 300, sin filtrar) porque necesitan el universo completo, no sólo la página visible. `matches()`/`options()` (funciones puras exportadas, con su propio test suite en `PuestosPage.filters.test.ts`) quedan intactas — `matches()` ya no se usa en el render (el filtrado ahora es 100% server-side) pero se mantiene exportada para no romper su cobertura de test existente.

### 16.3 Usuarios — catálogo diferido implementado

`frontend/src/pages/UsersPage.tsx` — el efecto de montaje ahora sólo pide `userApiService.getAll()`. El catálogo de empresas/sectores (`orgStructureApiService.getCatalog()`) y las opciones de empleado (`employeeApiService.getOptions({take:1000})`) se piden recién al abrir el modal de crear/editar (`ensureCatalogLoaded()`), no en el montaje de la pantalla — ambos servicios ya estaban cacheados desde antes (`services/cache`), así que abrir el modal una segunda vez dentro del TTL no vuelve a golpear la red. Mientras la primera carga del catálogo está en vuelo, los 3 selects que dependen de él (Empresa, Sector, Empleado vinculado) quedan deshabilitados con un texto chico explicando por qué; el resto del formulario (nombre/email/contraseña/rol/estado) queda usable de inmediato. De paso se sacó `usesBackend`, un estado del efecto reescrito que ya no se leía en ningún lado (confirmado con grep, no tenía otro consumidor).

### 16.4 Conceptos Horarios / Tipos de novedad / Categorías de documento — fetch-all justificado

Los 3 backends (`hour-concepts.repository.ts`, `noveltyTypes.repository.ts`, `documentCategories.repository.ts`) **ya tienen el mismo patrón dual que tenía `positions.repository.ts`** antes de esta etapa (path filtrado con `skip/take/count` real, path sin filtros con cache bespoke de hasta 500) — confirmado leyendo cada uno, no asumido. Es decir: si algún día hace falta paginar estas 3 pantallas, **el trabajo es 100% frontend** (igual que se hizo con Puestos), sin tocar el backend.

No se hizo ahora porque los 3 son vocabularios cerrados y administrados a mano por RRHH (tipos de concepto horario, tipos de novedad, categorías de documento) — HourConcept=5, NoveltyType=1, DocumentCategory=1 hoy, y ninguno tiene una razón de negocio para crecer más allá de unas pocas decenas (no escalan con headcount ni con tiempo transcurrido, a diferencia de Puestos o MonthlyTimeClosure). Coincide exactamente con la regla del pedido: "si un catálogo es estructural y casi siempre tendrá menos de 50 registros, puede quedar como fetch-all documentado". **Riesgo futuro**: si alguna de estas 3 listas creciera de forma inesperada (ej. una configuración multi-empresa con decenas de conceptos horarios distintos por convenio), la condición para reabrir es simple de verificar (un conteo de filas) y la implementación, dado que el backend ya está listo, sería un cambio chico y acotado al frontend.

### 16.5 Cierres mensuales — diferido, no por volumen sino por diseño

`workforce.service.ts` — `closures(period)` no tiene `take` en absoluto; `corrections()` tiene un `take:500` fijo (no paginación real). Ninguno de los dos se tocó en esta etapa.

**Por qué no se paginó, aunque el pedido lo mencione explícitamente como candidato**: `MonthlyClosuresPage.tsx` es una pantalla de **selección múltiple para acciones en lote** — el checkbox "Seleccionar pendientes" marca `selectable` (derivado de `rows`, que hoy es la lista *completa* de cierres/correcciones del período) y el botón "Aprobar seleccionados"/"Enviar cierre a RH" opera sobre esa selección. Si se paginara la lectura sin rediseñar el modelo de selección, "Seleccionar pendientes" pasaría a significar "seleccionar los pendientes de esta página" en vez de "seleccionar todos los pendientes del período" — un cambio de comportamiento real en un flujo de aprobación (categoría D, crítica, de la matriz de 9A §2.2), no una mejora de performance transparente. Decidir si "seleccionar todos" debe operar sobre la página visible o sobre todo el período filtrado es una decisión de producto, no algo para resolver mecánicamente dentro de una etapa de paginación — por eso se documenta como pendiente en vez de implementarse.

**Volumen esperado y condición de reapertura**: `MonthlyTimeClosure` es, según 9A/9B/9C, la única tabla de esta auditoría con una trayectoria de crecimiento predecible por tiempo transcurrido (no por configuración manual) — aproximadamente 12 filas/mes con la plantilla de empleados actual (Employee=12). Hoy está en 0 filas. Reabrir esta pantalla cuando la lista de un solo período supere ~1 página (o cuando el `take:500` de `corrections()` empiece a acercarse a su límite) — en ese momento, definir primero el alcance de "seleccionar todos" (página visible vs. todo el período) antes de tocar el backend.

### 16.6 Organigrama / Estructura organizacional — ya correcto, sin cambios

Confirmado releyendo el código actual (no sólo citando 9A):
- `OrganigramasPage.tsx` usa `employeeApiService.getOrgChart()` (cache 60s), acotado a 1000 empleados, con un aviso visible al usuario si se alcanza ese límite (`reachedEmployeeLimit`) — ya es "fetch acotado + aviso de límite", el patrón correcto para un organigrama completo (no tiene sentido paginar un árbol jerárquico).
- `OrgStructurePage.tsx` usa `orgStructureApiService.getCatalog()` (cache 10min, persistido en IndexedDB), acotado a 500 por tabla (empresas/sectores/áreas/etc.) — con los volúmenes reales de hoy (Company=2, Sector=4, CostCenter=2), lejísimos del límite.

Cumple exactamente lo que pedía la instrucción ("si ya está cacheado 10min y limitado a 500 por diseño, documentar y no tocar si no corresponde") — no se tocó ningún archivo de esta pantalla.

### 16.7 Reglas adoptadas

- Antes de paginar una pantalla con múltiples filtros, confirmar que **todos** los filtros expuestos en la UI se resuelven server-side — paginar mientras un filtro sólo funciona client-side produce resultados incompletos ("paginación frontend falsa"), no una mejora.
- Un catálogo administrado a mano (vocabulario cerrado, editado ocasionalmente por RRHH) no necesita paginación aunque el backend ya la soporte — la paginación es para datos que escalan con headcount, tiempo transcurrido o uso operativo, no para listas de configuración de un puñado de opciones.
- Datos que alimentan un modal (selects de un formulario de creación/edición) se cargan al abrir ese modal, no en el montaje de la pantalla que lo contiene — si el servicio ya está cacheado, el costo de pedirlo de nuevo en cada apertura es mínimo.
- Una pantalla con selección múltiple para acciones en lote no se pagina mecánicamente — primero hay que decidir qué significa "seleccionar todos" bajo paginación (alcance de producto), después implementar.
- Antes de decidir "no paginar por bajo volumen", verificar si el backend ya soporta paginación real (puede que sólo falte enchufar el frontend) — eso cambia la severidad del riesgo futuro de "requiere trabajo de backend" a "es un cambio chico cuando haga falta".

### 16.8 Riesgos futuros

- `MonthlyClosuresPage`/`corrections()`/`closures()` seguirán sin paginar hasta que se resuelva la pregunta de diseño de §16.5 — vigilar el conteo de `MonthlyTimeClosure` por período.
- Si Puestos, alguna vez, necesita un filtro server-side adicional que hoy no existe, replicar el mismo criterio: navegar relaciones existentes (`sector→area→establishment→businessUnit`), nunca duplicar datos derivados en columnas nuevas.
- El resto de los hallazgos de 9A/9B/9C sin relación con esta etapa siguen vigentes sin cambios (mega-efecto de `HoursPage`, patrones de cache backend no consolidados, etc.).

### 16.9 Tests agregados

Backend: `positions.repository.test.ts` (+8 casos — pagina con/sin filtros, cada uno de los 3 filtros de jerarquía nuevos, `salaryRangeCategory` real, combinación de filtros, caso sin resultados), `positions.service.test.ts` (+3 casos — meta.total/page/pageSize/hasMore, hasMore=false en la última página, caso sin resultados). Total backend: 709 tests (698 + 11).

Frontend: `PuestosPage.test.tsx` (6, archivo nuevo — carga inicial, paginación, debounce, refresh sin blanquear, empty state, eliminar/ocultar), `UsersPage.test.tsx` (6, archivo nuevo — catálogo diferido en mount, se pide al abrir crear, se pide al abrir editar, selects deshabilitados mientras carga, crear usuario sigue funcionando, empty state). Total frontend: 358 tests (346 + 12).

### 16.10 Validaciones ejecutadas

Backend: `npx prisma validate` ✅, `npx prisma generate` ✅, `npx prisma migrate status` ✅ (45 migraciones, sin cambios — ninguna migración nueva), `npm run typecheck` ✅, `npx vitest run` ✅ 709/709, `npm run build` ✅.
Frontend: `npx tsc -b` ✅, `npx vitest run` ✅ 358/358, `npm run build` ✅.
General: `git diff --check` sin errores de espacios en blanco.

## 17. Etapa 9F — Saneamiento del mega-efecto de HoursPage

Fecha: 2026-08-27. La pantalla que 9A marcó como "Alta — necesita cambio revisado propio, no un quick win" (§4.3, §8) y que 9B dejó deliberadamente sin tocar. Sin rediseño visual, sin cambiar reglas de negocio/permisos/schema/contratos de API, sin librerías nuevas, sin tocar fichador — Conceptos Horarios y Horas Especiales sólo se verificaron (no se tocó ningún archivo de esos módulos).

### 17.1 Problema original

Un único `useEffect` (`frontend/src/pages/HoursPage.tsx`, antes líneas 237-290) con **10 dependencias** (`costCenter, costCenterOptionsReady, debouncedSearch, groupByPerson, page, pendingOnly, period, refresh, reviewPage, user`) hacía un `Promise.all` de 4 llamadas (`getPeriodEmployees`, `getSummary`, `list`/`listByEmployee`, `pendingApiService.getAll`) cada vez que **cualquiera** de esas 10 dependencias cambiaba, aunque la mayoría de las llamadas no usan la mayoría de esos parámetros. Un único flag `loading` compartido blanqueaba **4 secciones distintas** de la pantalla en cada corrida (Novedades pendientes, Horas en revisión, Desgloses manuales pendientes, Personas habilitadas para carga), sin importar si la sección tenía algo que ver con lo que había cambiado.

### 17.2 Qué disparaba refetch (diagnóstico, verificado leyendo el código real, no sólo citando 9A)

| Dependencia | Se usa en | No se usa en, pero igual disparaba |
|---|---|---|
| `period` | Las 4 llamadas (parámetro real siempre) | — |
| `debouncedSearch` | `getPeriodEmployees`, `list`/`listByEmployee` | `getSummary` (sólo recibe `period`), `pendingApiService.getAll` (sólo recibe `period`+`kind`+`take` fijo) |
| `costCenter` (→ `costCenterId`) | `getPeriodEmployees`, `list`/`listByEmployee` | `getSummary`, `pendingApiService.getAll` |
| `page` | `getPeriodEmployees` (sólo si `!pendingOnly`) | `getSummary` |
| `reviewPage` | `list`/`listByEmployee` (sólo si `pendingOnly`) | `getSummary`, `pendingApiService.getAll` (ni acepta página) |
| `groupByPerson` | Cambia de endpoint dentro de `list`/`listByEmployee` (real, no es un toggle visual puro) | `getSummary`, `pendingApiService.getAll` |
| `pendingOnly` | Gatilla casi todo el cuerpo | En la práctica nunca cambia dentro de un mismo montaje — `/horas` y `/pendientes` son rutas separadas (`HoursPage`/`HoursPage pendingOnly`), cada una remonta el componente |
| `costCenterOptionsReady` | `getPeriodEmployees`/`list`/`listByEmployee` (necesitan `costCenterId` resuelto) | `getSummary`, `pendingApiService.getAll` (ninguno de los dos recibe `costCenterId`) — igual bloqueaba su primera carga detrás del catálogo de centros de costo sin necesidad |
| `refresh` | Las 4 llamadas (única dependencia donde todo lo disparado estaba justificado — es la señal de "algo se guardó, invalidar") | — |
| `user` | Guard de autenticación en las 4 | — |

Confirmado con lectura directa del código (no sólo el resumen de 9A): `getSummary(period)` y `pendingApiService.getAll({period, kind:"all", take:300})` **nunca** reciben `search`/`costCenterId`/`reviewPage`/`groupByPerson` como parámetro — cualquier cambio en esos 4 campos los volvía a llamar igual, sin ninguna razón funcional.

### 17.3 Qué se separó

El único efecto se dividió en **3 efectos**, cada uno con exactamente las dependencias que sus llamadas realmente usan (más un 4° efecto de catálogo que ya estaba correctamente aislado desde antes y no se tocó):

- **A) Grilla — "Personas habilitadas para carga"** (`getPeriodEmployees`). Sólo corre si `!pendingOnly`. Depende de `period, debouncedSearch, costCenterId, page, refresh, user, costCenterOptionsReady`. Loading/error propios: `gridLoading`/`gridError`.
- **B) Bandeja de revisión — "Horas enviadas a revisión"** (`list`/`listByEmployee`). Sólo corre si `pendingOnly`. Depende de `period, debouncedSearch, costCenterId, reviewPage, groupByPerson, refresh, user, costCenterOptionsReady`. Loading/error propios: `reviewLoading`/`reviewError`.
- **C) Resumen (tarjetas, ambos modos) + pendientes de novedades/desgloses** (`getSummary` + `pendingApiService.getAll`, combinados en un mismo efecto porque comparten exactamente las mismas dependencias reales). Depende únicamente de `period, refresh, user, pendingOnly` — **no depende de `costCenterOptionsReady`**, así que ahora carga en paralelo al catálogo de centros de costo en vez de esperarlo (mejora real de latencia de la primera pintura de las tarjetas, no un cambio de comportamiento). Loading propio: `pendingLoading` (usado por Novedades pendientes y Desgloses manuales, que comparten la misma fuente de datos).
- **D) Catálogo de centros de costo** (`orgStructureApiService.getCatalog()`) — ya estaba aislado en su propio efecto desde antes de esta etapa; no se tocó.

`loadError` (el banner superior) queda derivado como `gridError || reviewError` — nunca estado propio — así ningún efecto puede pisar el error de otro por accidente (riesgo documentado en §17.6). `getSummary`/`pendingApiService.getAll` siguen haciendo `catch` a un valor por defecto cada uno (exactamente como antes de esta etapa, sin cambios) — nunca "duro"-fallan ese efecto combinado.

`costCenterId` se extrajo como un `const` derivado una sola vez por render (`costCenterOptions.find(...)`), en vez de recalcularse dentro de cada efecto por separado.

### 17.4 Qué endpoints dejaron de llamarse innecesariamente

- Cambiar la búsqueda, el centro de costo, la página de revisión o el toggle "Por registro/Por persona" **ya no vuelve a llamar** `getSummary` ni `pendingApiService.getAll` — antes sí, siempre, en cada una de esas 4 interacciones.
- Cambiar la página de revisión (`reviewPage`) o el centro de costo/búsqueda **ya no vuelve a llamar** `getPeriodEmployees` cuando el cambio ocurrió en modo Bandeja (y viceversa) — estructuralmente imposible ahora, cada efecto sólo existe en su propio modo.
- Las tarjetas resumen y los pendientes ya no esperan a que el catálogo de centros de costo termine de cargar (no lo necesitan) — se pintan más rápido en la carga inicial.
- Verificado con tests de conteo de llamadas (no sólo revisado a ojo, ver §17.8): en la carga inicial de cada modo, cada endpoint relevante se llama exactamente una vez y ninguno de los endpoints del otro modo se llama nunca.

### 17.5 Cómo queda el patrón de carga inicial vs refresh

Cada uno de los 3 efectos nuevos sigue el mismo guard ya usado en 9B/9C/9E: `if (!data.length) setXLoading(true)` antes de la llamada — el skeleton de carga completo sólo aparece cuando esa sección todavía no tiene datos en pantalla. Un cambio de filtro/página/mutación con datos ya cargados **no blanquea la sección** — el usuario sigue viendo la tabla anterior hasta que la respuesta nueva la reemplaza. Verificado con tests que dejan una promesa "en vuelo" a propósito y confirman que la fila anterior sigue visible y el skeleton no aparece mientras tanto (§17.8).

### 17.6 Cómo se comportan las mutaciones

Ninguna de las 8 mutaciones existentes (aprobar/rechazar/devolver carga horaria, aprobar/rechazar novedad, aprobar/rechazar/devolver desglose manual) cambió su lógica — todas siguen llamando exactamente al mismo endpoint con los mismos parámetros, y todas siguen terminando en `setRefresh((value) => value + 1)`, igual que antes. Como `refresh` sigue siendo dependencia compartida de los 3 efectos, una mutación sigue invalidando **todo lo relacionado** (grilla, bandeja y resumen/pendientes) — no se intentó adivinar "esta mutación sólo necesita refrescar X" para no arriesgar sub-refrescar algo que dependa de una regla de negocio no evidente desde el frontend. Como cada mutación sólo se renderiza en el modo donde tiene sentido (aprobar/rechazar/devolver carga horaria y desgloses sólo existen en `pendingOnly`), el efecto del modo contrario (Grilla) nunca llega a disparar una llamada real aunque comparta la dependencia `refresh` — su propio guard `if (pendingOnly) return;` lo corta antes de tocar la red. Período/centro de costo seleccionados no se pierden durante ese refresh (son estado de UI separado, nunca tocado por los efectos de carga) — verificado con un test dedicado.

### 17.7 Qué quedó sin tocar y por qué

- El JSX/render de las 4 secciones — ninguna se rediseñó, sólo cambió qué variable de loading/error lee cada una.
- Las 8 funciones de mutación (`approve`, `confirmReview`, `approveNovelty`, `confirmNoveltyReject`, `approveBreakdown`, `confirmBreakdownReview`, etc.) — mismo cuerpo, mismos endpoints, mismos parámetros.
- `usesBackend` — se mantiene como un único booleano (no se separó por efecto) porque sus dos únicos usos (fallback de exportación, texto del empty-state de Novedades) están en ramas de render mutuamente excluyentes por `pendingOnly`, así que nunca hay conflicto entre quién lo escribe.
- Conceptos Horarios y Horas Especiales — no se tocó ningún archivo de esos módulos; se verificó (test dedicado, ver §17.8) que "Normales"/"Especiales"/"Total" siguen viniendo de `getPeriodEmployees` como 3 campos separados (`summary.normal`/`summary.special`/`summary.total`), nunca mezclados.
- No se extrajeron hooks (`useHoursGridData`, etc.) a archivos separados — los 3 efectos quedaron inline en el mismo componente, con comentarios explicando cada uno. Se evaluó extraerlos y se decidió que, para 3 efectos ya cortos y con dependencias claras, un hook por efecto habría agregado una capa de indirección (pasar/devolver 6-8 valores cada uno) sin reducir el riesgo ni mejorar la legibilidad lo suficiente para justificarlo en esta etapa — "no crear abstracciones complejas ni generalizar" fue la guía explícita del pedido.
- No se tocó el bug técnicamente pre-existente de que `loadError` (ahora `gridError || reviewError`) puede, en un caso muy angosto, no reflejar un error de un efecto si el otro efecto relevante al mismo modo tuvo éxito en el mismo ciclo de `refresh` — ver riesgo en §17.8. Antes de esta etapa esto no podía pasar (era una única promesa atómica); ahora es estructuralmente posible pero de probabilidad muy baja (ambos efectos pegan al mismo backend, que normalmente está arriba o abajo para los dos a la vez) y no se intentó resolver con más estado para no exceder "cambios chicos".

### 17.8 Tests agregados

`HoursPage.test.tsx` — 11 tests nuevos (los 19 preexistentes siguen pasando sin ningún cambio, confirmando que el comportamiento visible no se rompió): carga inicial en Bandeja (3 endpoints exactos, `getPeriodEmployees` nunca), carga inicial en Carga de horas (2 endpoints exactos, los 3 de Bandeja nunca), cambiar página de revisión sólo repite `list`, cambiar página de grilla sólo repite `getPeriodEmployees`, una mutación sí repite los 3 (refresh sigue invalidando todo lo relacionado), cambiar de página de revisión con datos ya cargados no blanquea la tabla, período/centro de costo no se pierden durante un refresh, empty state y error state (con retry) siguen funcionando en Carga de horas, Normales/Especiales/Total se muestran separados (regresión Horas Especiales/Conceptos), sin texto técnico visible. Se agregó también el mock de `timeEntryApiService.listByEmployee` (no existía) y helpers `renderGrid()`/`buildEmployee()`/`buildPeriodRow()` para poder testear por primera vez el modo `!pendingOnly` (ningún test preexistente lo cubría). Total frontend: 369 tests (358 + 11).

### 17.9 Validaciones ejecutadas

Frontend: `npx tsc -b` ✅, `npx vitest run` ✅ 369/369, `npm run build` ✅.
Backend (sin cambios, corrido igual por seguridad): `npx prisma validate` ✅, `npx prisma generate` ✅, `npx prisma migrate status` ✅ (45 migraciones, sin cambios), `npm run typecheck` ✅, `npx vitest run` ✅ 709/709, `npm run build` ✅.
General: `git diff --check` sin errores de espacios en blanco.

### 17.10 Riesgos pendientes

- **Banner de error compartido entre 2 efectos** (`gridError || reviewError`, o dentro de C, entre `getSummary`/`pendingApiService.getAll`): en el caso angosto de que dos efectos relevantes al mismo modo fallen y tengan éxito en el mismo ciclo de `refresh`, el banner podría mostrar sólo uno de los dos estados. Ver §17.7 — se documenta como aceptado, no se resolvió con estado adicional.
- La Bandeja de revisión (`reviewLoading`) sigue sin un `ErrorState` dedicado (con botón de reintentar) — igual que antes de esta etapa, un fallo ahí sólo se ve en el banner superior + la tabla mostrando "sin resultados". No se agregó una UI de error nueva para no exceder "no rediseñar".
- El resto de los hallazgos de HoursPage documentados en 9A (paginación de la grilla ya existía, exportación con fallback client-side) sin cambios.
- El resto de los riesgos de 9A/9B/9C/9E sin relación con esta etapa siguen vigentes sin cambios.

### 17.11 Reglas futuras para pantallas complejas

- Antes de tocar un efecto con muchas dependencias, mapear **qué llamada usa qué dependencia real** (una tabla como la de §17.2) — no asumir que "todas las dependencias son necesarias para todas las llamadas" sólo porque hoy conviven en el mismo `Promise.all`.
- Un prop que nunca cambia dentro de un mismo montaje (como `pendingOnly`, dos rutas separadas) puede tratarse como una bifurcación estructural — separar el código en efectos que cada uno haga su propio `if (propX) return;`/`if (!propX) return;`, en vez de forzar todo a convivir en un único cuerpo condicional.
- Combinar 2 llamadas en el mismo efecto sólo cuando comparten **exactamente** las mismas dependencias reales — combinarlas "porque van juntas visualmente" (ej. tarjetas + pendientes, que se ven en momentos distintos de la pantalla) es válido si además comparten dependencias; si no, separarlas.
- Loading/error por sección, no uno global compartido por 3+ secciones — cada sección debe poder cargar/fallar sin afectar visualmente a las demás.
- Extraer hooks (`useXData`) sólo cuando el número de efectos/estados crece lo suficiente como para que la indirección realmente reduzca la carga cognitiva de leer el componente — con 3 efectos cortos y bien comentados, mantenerlos inline puede ser la opción de menor riesgo.
- Medir antes de asumir "esto va a mejorar" — los 11 tests nuevos existen específicamente para demostrar con evidencia (conteo de llamadas) que el refetch se redujo, no para documentar una intención.
