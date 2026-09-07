# Etapa 14G.1 — Diagnóstico macro de performance del módulo Gestión horaria

Fecha: 2026-09-07
Estado: **diagnóstico completo. Sin cambios funcionales — sólo instrumentación de medición nueva (journey `perf:journey:workforce`), sin tocar backend, Prisma schema, RBAC ni contratos de API.**
Alcance: mapear con precisión los 10 submódulos de Gestión horaria (Inicio, Asistencia, Alertas de turnos, Carga de horas, Cierres mensuales, Bandeja de revisión, Novedades, Notificaciones, Fichador, Exportación) para decidir el orden real de optimización en 14G.2 y siguientes. **No se optimizó nada esta etapa.**

---

## 0. Qué NO es Gestión horaria (fuera de alcance, confirmado leyendo `App.tsx`/`navigation.tsx`)

Legajos, Puestos, Organigramas, Usuarios y Roles, Conceptos Horarios (`/configuracion/conceptos-horarios`) y Regímenes Laborales/Horas Especiales (`/configuracion/regimenes-laborales`, `/configuracion/turnos-horas-especiales`) como módulos maestros, Turnos (`/configuracion/turnos`) como configuración, Dashboard general (`/`, salvo el aterrizaje inevitable del login) y Documentos fuera del módulo (`/documentacion`) son ítems de navegación **separados** de "Gestión horaria" — no se tocaron ni se incluyeron en el journey, aunque algunos de sus servicios (`employeeApiService`, `orgStructureApiService`, `noveltyTypeApiService`, `hourConceptApiService`) sean consumidos *desde* Gestión horaria como catálogos de apoyo.

---

## 1. Rutas reales y submódulos (Parte 1 del pedido)

Router: `frontend/src/App.tsx`. Navegación: `frontend/src/app/navigation.tsx` (función `hourlyManagement(level)`, grupo `"Gestión horaria"`, icono `Clock3`).

| # | Submódulo (label de navegación) | Ruta real | Visibilidad por nivel |
|---|---|---|---|
| A | Inicio | `/gestion-horaria` | Todos |
| B | Asistencia | `/asistencia` | Todos |
| C | Alertas de turnos | `/asistencia/alertas` | Todos |
| D | Carga de horas | `/horas` (+ `/horas/:id` detalle) | Todos |
| E | Cierres mensuales | `/cierres` | Todos |
| F | Bandeja de revisión | `/pendientes` | Todos excepto Nivel 3 |
| G | Novedades (`"Novedades horarias"` en Nivel 3) | `/novedades` | Todos |
| H | Notificaciones | `/notificaciones` | Todos |
| I | Fichador | `/fichador` | Todos (además, accesible sin login) |
| J | Exportación | `/configuracion/liquidacion` | Sólo Nivel 1 (RRHH) |

`/pendientes` es el **mismo componente** que `/horas` (`HoursPage.tsx`, prop `pendingOnly`) — no una página separada. `/gestion-horaria` (Inicio) **es** un dashboard propio (`HourlyManagementHomePage.tsx`), no un redirect: Nivel 3 aterriza ahí después del login (`App.tsx`: `level === 3 ? <Navigate to="/gestion-horaria" /> : <DashboardPage />`).

---

## Matriz 1 — Inventario de submódulos

Relevada leyendo router, navegación, cada página, cada servicio API y el backend de cada dominio (routes/controller/service/repository) — sin tocar ningún archivo. Fuente canónica (para no desincronizar dos copias): `frontend/e2e/support/workforceManagementJourney.ts` → `SUBMODULE_INVENTORY`.

| Submódulo | Ruta real | Página/componente | Servicios API | Endpoints iniciales | Cache frontend | Cache backend | Escribe datos | Medible seguro | Observación |
|---|---|---|---|---|---|---|---|---|---|
| A. Inicio | `/gestion-horaria` | `HourlyManagementHomePage.tsx` | `timeEntryApiService.ts` | `GET /time-entries/home-summary` | No | No | No | Sí | KPIs son `<Link>` sin fetch propio. |
| B. Asistencia | `/asistencia` | `AttendancePage.tsx` | `attendanceApiService.ts` | `GET /time-entries/attendance?date=`, `GET /time-entries/attendance/observations?...` | No (`apiCache:false`) | Sí — `attendanceSummaryCache` TTL 10s (sólo `/attendance`; `/observations` no tiene cache backend) | Sí (cerrar jornada, olvido de salida, observar, resolver) — no ejecutado | Sí | Poll silencioso cada 60s sin blanquear tablas (Etapa 9B); debounce 300ms en búsqueda de observaciones. |
| C. Alertas de turnos | `/asistencia/alertas` | `ShiftAlertsPage.tsx` | `shiftAlertApiService.ts` | `GET /shifts/alerts?...` | No | No (`shifts` no tiene `shifts.cache.ts`) | Sí (resolver alerta) — no ejecutado | Sí | Agrupación por `workShiftId` 100% client-side (13H). Medido en 3906ms (Crítico) por 14B.3 y nunca revisado — candidato fuerte. |
| D. Carga de horas | `/horas`, `/horas/:id` | `HoursPage.tsx`, `EmployeeHoursPage.tsx` | `timeEntryApiService.ts`, `orgStructureApiService.ts`, `employeeApiService.ts`, `noveltyApiService.ts` | `GET /time-entries/period-employees`, `/time-entries/summary`, `/org-structure` (grilla); `GET /employees/:id/time-grid`, `/novelties?employeeId=` (detalle) | Sí — `cachePolicies.timeEntriesAggregates` 30s | Sí — TTL 20s (`period-employees`, `summary`), 15s (`list`) | Sí (guardar hora, desglose manual, submit) — no ejecutado | Sí | `period-employees` optimizado en 14C.2 (6447→4138ms) pero sigue Crítico. Silent refresh ya implementado (Etapa 9F). |
| E. Cierres mensuales | `/cierres` | `MonthlyClosuresPage.tsx` | `workforceApiService.ts`, `employeeApiService.ts` | `GET /workforce/closures?period=`, `/workforce/corrections`, `/employees/options` | No | No | Sí (aprobar/enviar/devolver cierre, aprobar/rechazar corrección) — no ejecutado | Sí | `closures` sin paginación; `corrections` con `take:500` hardcodeado sin skip real. Nunca medido por ningún journey previo. |
| F. Bandeja de revisión | `/pendientes` | `HoursPage.tsx` (prop `pendingOnly`) | `timeEntryApiService.ts`, `pendingApiService.ts`, `noveltyApiService.ts`, `employeeApiService.ts`, `orgStructureApiService.ts` | `GET /time-entries?status=EN_REVISION&view=...`, `/time-entries/summary`, `/pending`, `/org-structure` | Sí — `cachePolicies.pendingQueue` 30s (sólo `/pending`) | No | Sí (aprobar/rechazar/devolver registro, novedad y desglose manual — 3 flujos) — no ejecutado | Sí, con cuidado (aria-label genérico compartido entre acciones de escritura — ver §6) | `findManyByEmployeeGrouped` (vista "Por persona") documentado 2 veces en 14C.2 como pendiente ($transaction antipattern), nunca corregido. |
| G. Novedades | `/novedades` | `NoveltiesPage.tsx` | `noveltyApiService.ts` (+ `noveltyTypeApiService.ts`, `hourConceptApiService.ts` en el modal) | `GET /novelties?page=&take=&search=` | No (mutaciones invalidan family `"novelties"`) | Sí — `noveltiesListCache` TTL 15s | Sí (crear, aprobar, aprobar en lote, rechazar, eliminar) — no ejecutado | Sí (modal se abre/cierra sin guardar) | `bulk-approve` tiene N+1 secuencial explícito en backend (`novelties.service.ts`). |
| H. Notificaciones | `/notificaciones` | `NotificationsPage.tsx` | `workforceApiService.ts` | `GET /workforce/notifications?page=&take=&status=` | No en el listado (el contador de `AppShell` sí cachea 20s, endpoint distinto) | No | Sí (marcar como leída) | Parcial | **HALLAZGO**: el link "Ver detalle" dispara `markRead()` (`POST /workforce/notifications/:id/read`) como efecto colateral de un click de navegación — ver §6. |
| I. Fichador | `/fichador` | `TimeClockPage.tsx` | `timeClockApiService.ts` | Ninguno al montar (sólo reloj en vivo, sin red) | No | No | Sí (marcar ingreso/salida, foto-punch) | Parcial (sólo carga inicial) | Categoría D de `PERFORMANCE_STANDARDS.md` — crítica, nunca cachear/optimizar sin etapa dedicada. Ruta pública protegida por `x-clock-device-token` + rate limit (30/5min). |
| J. Exportación | `/configuracion/liquidacion` | `FinnegansExportPage.tsx` | `finnegansExportApiService.ts` | `GET /finnegans-export/novelties?period=` | No | No | No (el `.xlsx` se arma 100% client-side) | Sí (navegación/filtros); no descargar por defecto | Backend con `take:10000` hardcodeado sin paginación (`finnegansExport.repository.ts`). |

---

## Matriz 2 — Cobertura del journey

Fuente canónica: `frontend/e2e/support/workforceManagementJourney.ts` → `COVERAGE_MATRIX` (68 filas, verificada por test en `workforceManagementJourney.test.ts`). Agrupada por zona para legibilidad — cada tabla mantiene las columnas pedidas (Acción, Ruta, Componente, Endpoint esperado, Tipo, Medible, Se mide, Motivo si no se mide, Riesgo, Observación); la Zona/Submódulo es el título de cada bloque.

### Login

| Acción | Ruta | Componente | Endpoint esperado | Tipo | Medible | Se mide | Motivo si no | Riesgo | Observación |
|---|---|---|---|---|---|---|---|---|---|
| Login (acceso rápido RRHH) | `/` | `LoginPage.tsx` | `POST /auth/login` (vía `loginAs`) | Lectura | Sí | Sí | — | Bajo | Mismo mecanismo que 14D.1/14F.1 — acceso rápido demo Nivel 1. |

### A. Inicio

| Acción | Ruta | Componente | Endpoint esperado | Tipo | Medible | Se mide | Motivo si no | Riesgo | Observación |
|---|---|---|---|---|---|---|---|---|---|
| Entrar a Inicio | `/gestion-horaria` | `HourlyManagementHomePage.tsx` | `GET /time-entries/home-summary` | Lectura | Sí | Sí | — | Bajo | — |
| Ver KPIs/resumen de Inicio | `/gestion-horaria` | `.stat-grid` | sin endpoint propio | Lectura | Sí | Sí | — | Bajo | Los `StatLink` son `<Link>`, no disparan un request nuevo. |

### B. Asistencia

| Acción | Ruta | Componente | Endpoint esperado | Tipo | Medible | Se mide | Motivo si no | Riesgo | Observación |
|---|---|---|---|---|---|---|---|---|---|
| Entrar a Asistencia | `/asistencia` | `AttendancePage.tsx` | `GET /time-entries/attendance?date=` | Lectura | Sí | Sí | — | Bajo | — |
| Cambiar fecha del día | `/asistencia` | input date | `GET /time-entries/attendance?date=` | Lectura | Sí | Sí | — | Bajo | — |
| Buscar en problemas de fichada | `/asistencia` | `observedQuery` | `GET /time-entries/attendance/observations?search=` | Lectura | Sí | Sí | — | Bajo | Debounce 300ms; término real, no logueado. |
| Filtrar problemas de fichada por tipo | `/asistencia` | select `observedType` | `GET .../observations?type=` | Lectura | Sí | Sí | — | Bajo | — |
| Limpiar filtros de problemas de fichada | `/asistencia` | botón Limpiar | `GET .../observations` | Lectura | Sí | Sí | — | Bajo | Sólo aparece con algún filtro activo. |
| Abrir/cerrar detalle de tramos | `/asistencia` | Modal `WorkShiftSegmentsPanel` | sin endpoint propio | Lectura | Sí | Parcial | Se saltea sin jornada cerrada con tramos el día consultado | Bajo | — |
| Cerrar jornada / Olvido de salida / Observar jornada | `/asistencia` | Modal `shiftAction` | `POST .../work-shifts/:id/close-manual\|missing-out\|observe` | Escritura | Sí | No | Prohibido por defecto — modifica jornadas reales | Alto si se ejecutara | 3 endpoints agrupados. |
| Resolver problema de fichada | `/asistencia` | Modal `reviewAction` | `POST .../observations/:kind/:id/resolve` | Escritura | Sí | No | Prohibido por defecto | Alto si se ejecutara | — |

### C. Alertas de turnos

| Acción | Ruta | Componente | Endpoint esperado | Tipo | Medible | Se mide | Motivo si no | Riesgo | Observación |
|---|---|---|---|---|---|---|---|---|---|
| Entrar a Alertas de turnos | `/asistencia/alertas` | `ShiftAlertsPage.tsx` | `GET /shifts/alerts?status=PENDIENTE&take=20` | Lectura | Sí | Sí | — | Bajo | Medido en 3906ms (Crítico) por 14B.3, nunca revisado. |
| Buscar/limpiar búsqueda | `/asistencia/alertas` | `FilterPanel` | `GET /shifts/alerts?search=` | Lectura | Sí | Sí | — | Bajo | Debounce 300ms. |
| Filtrar por tipo | `/asistencia/alertas` | select `type` | `GET /shifts/alerts?type=` | Lectura | Sí | Sí | — | Bajo | — |
| Limpiar filtros | `/asistencia/alertas` | `FilterPanel onClear` | `GET /shifts/alerts?status=PENDIENTE` | Lectura | Sí | Sí | — | Bajo | — |
| Expandir hallazgos asociados | `/asistencia/alertas` | toggle client-side | sin endpoint propio (13H) | Lectura | Sí | Parcial | Se saltea sin grupos con >1 alerta | Bajo | — |
| Resolver alerta de turno | `/asistencia/alertas` | Modal `resolveTarget` | `POST /shifts/alerts/:id/resolve` | Escritura | Sí | No | Prohibido por defecto | Alto si se ejecutara | — |

### D. Carga de horas

| Acción | Ruta | Componente | Endpoint esperado | Tipo | Medible | Se mide | Motivo si no | Riesgo | Observación |
|---|---|---|---|---|---|---|---|---|---|
| Entrar (período actual) | `/horas` | `HoursPage.tsx` | `GET /time-entries/period-employees`, `/summary`, `/org-structure` | Lectura | Sí | Sí | — | Bajo | Crítico desde 14C.2 (4138ms) — candidato fuerte. |
| Cambiar período | `/horas` | input month | `GET .../period-employees?period=` | Lectura | Sí | Sí | — | Bajo | — |
| Buscar empleado / limpiar búsqueda | `/horas` | `SearchInput` | `GET .../period-employees?search=` | Lectura | Sí | Sí | — | Bajo | Término real de la grilla, no logueado. |
| Abrir edición de horas (navega a `/horas/:id`) | `/horas` → `/horas/:id` | link "Cargar / Ver" → `EmployeeHoursPage.tsx` | `GET /employees/:id/time-grid`, `/novelties?employeeId=` | Lectura | Sí | Sí | — | Bajo | — |
| Ver total real/liquidable | `/horas/:id` | `StatCard` | sin endpoint propio | Lectura | Sí | Parcial | "Valor liquidable" sólo con horas especiales adicionales el período | Bajo | "Horas trabajadas" siempre presente. |
| Abrir/cancelar edición de hora | `/horas/:id` | Modal día | sin endpoint propio | Lectura | Sí | Sí | — | Bajo | Se abre y cierra sin tocar "Guardar". |
| Abrir/cancelar conceptos adicionales | `/horas/:id` | Modal desglose | sin endpoint propio | Lectura | Sí | Parcial | Se saltea sin fila de concepto editable manualmente | Bajo | — |
| Volver a Carga de horas | `/horas/:id` → `/horas` | back-link | `GET .../period-employees` (revisita) | Lectura | Sí | Sí | — | Bajo | — |
| Guardar hora / desglose / enviar a revisión | `/horas/:id` | botones Guardar* | `POST/PATCH /time-entries`, `PUT .../hour-concept-breakdowns/manual` | Escritura | Sí | No | Prohibido por defecto — cargaría horas reales | Alto si se ejecutara | 3 endpoints agrupados. |
| Exportar horas | `/horas` | botón "Exportar horas" | `GET /time-entries/export` (sólo lectura) | Lectura | Sí | No | Endpoint GET, pero dispara descarga de datos de horas — prohibido por defecto | Medio (descarga, no persiste) | Candidato para etapa futura detrás de flag explícito. |

### E. Cierres mensuales

| Acción | Ruta | Componente | Endpoint esperado | Tipo | Medible | Se mide | Motivo si no | Riesgo | Observación |
|---|---|---|---|---|---|---|---|---|---|
| Entrar (período actual) | `/cierres` | `MonthlyClosuresPage.tsx` | `GET /workforce/closures`, `/corrections`, `/employees/options` | Lectura | Sí | Sí | — | Bajo | Nunca medido antes; `closures` no pagina. |
| Cambiar período | `/cierres` | input month | `GET /workforce/closures?period=` | Lectura | Sí | Sí | — | Bajo | `corrections`/`employees/options` se re-piden igual (no dependen del período). |
| Aprobar/Enviar/Devolver cierre | `/cierres` | botones bulk | `POST /workforce/closures/approve\|submit\|:id/return` | Escritura | Sí | No | Prohibido por defecto — cierra/reabre un período real | Alto si se ejecutara | 3 endpoints agrupados. |
| Aprobar/Rechazar corrección | `/cierres` | botones fila | `POST /workforce/corrections/:id/approve\|reject` | Escritura | Sí | No | Prohibido por defecto | Alto si se ejecutara | — |

### F. Bandeja de revisión

| Acción | Ruta | Componente | Endpoint esperado | Tipo | Medible | Se mide | Motivo si no | Riesgo | Observación |
|---|---|---|---|---|---|---|---|---|---|
| Entrar (Por registro) | `/pendientes` | `HoursPage.tsx` (`pendingOnly`) | `GET /time-entries?status=EN_REVISION&view=byEmployee`, `/summary`, `/pending`, `/org-structure` | Lectura | Sí | Sí | — | Bajo | — |
| Cambiar a "Por persona" | `/pendientes` | `Tabs` | `GET /time-entries?view=byEmployee` (`findManyByEmployeeGrouped`) | Lectura | Sí | Sí | — | Bajo | `$transaction` antipattern documentado 2x en 14C.2, nunca corregido — candidato fuerte. |
| Buscar / cambiar período | `/pendientes` | `SearchInput` / input month | `GET /time-entries?search=\|period=` | Lectura | Sí | Sí | — | Bajo | — |
| Abrir detalle (Ver detalle, Por persona) | `/pendientes` → `/horas/:id` | link "Ver detalle" | `GET /employees/:id/time-grid` | Lectura | Sí | Parcial | Sólo existe en "Por persona" con al menos 1 fila | Bajo | — |
| Volver a Bandeja de revisión | `/horas/:id` → `/pendientes` | back-link | `GET /time-entries?view=byEmployee` (revisita) | Lectura | Sí | Parcial | Depende de la acción anterior | Bajo | — |
| Aprobar/Rechazar/Devolver registro | `/pendientes` | `aria-label="Aprobar"\|"Rechazar"\|"Devolver"` | `POST /time-entries/:id/approve\|reject\|return` | Escritura | Sí | No | Prohibido por defecto | Alto si se ejecutara | **Aria-label genérico compartido con novedad/desglose — el journey nunca usa un locator de rol sin scope.** |
| Aprobar/Rechazar novedad (desde Bandeja) | `/pendientes` | `aria-label="...novedad"` | `POST /novelties/:id/approve\|reject` | Escritura | Sí | No | Prohibido por defecto | Alto si se ejecutara | — |
| Aprobar/Rechazar/Devolver desglose manual | `/pendientes` | `aria-label="...desglose"` | `POST /employees/:id/hour-concept-breakdowns/manual/:id/approve\|reject\|return` | Escritura | Sí | No | Prohibido por defecto | Alto si se ejecutara | — |

### G. Novedades

| Acción | Ruta | Componente | Endpoint esperado | Tipo | Medible | Se mide | Motivo si no | Riesgo | Observación |
|---|---|---|---|---|---|---|---|---|---|
| Entrar / Buscar | `/novedades` | `NoveltiesPage.tsx` | `GET /novelties?page=&take=&search=` | Lectura | Sí | Sí | — | Bajo | — |
| Abrir/cancelar "Nueva novedad" | `/novedades` | `NoveltyModal.tsx` | `GET /novelty-types`, `/hour-concepts` (catálogos lazy) | Lectura | Sí | Sí | — | Bajo | Se cierra sin guardar. |
| Guardar nueva novedad | `/novedades` | `NoveltyModal.tsx` | `POST /novelties` | Escritura | Sí | No | Prohibido por defecto — crearía una novedad real | Alto si se ejecutara | — |
| Aprobar/Rechazar/Eliminar novedad | `/novedades` | `NoveltyTable.tsx` | `POST .../approve\|reject`, `DELETE /novelties/:id` | Escritura | Sí | No | Prohibido por defecto | Alto si se ejecutara | 3 endpoints agrupados. |
| Aprobar pendientes visibles (bulk) | `/novedades` | botón bulk | `POST /novelties/bulk-approve` | Escritura | Sí | No | Prohibido por defecto | Alto si se ejecutara | N+1 secuencial en backend — no medible sin ejecutarlo. |

### H. Notificaciones

| Acción | Ruta | Componente | Endpoint esperado | Tipo | Medible | Se mide | Motivo si no | Riesgo | Observación |
|---|---|---|---|---|---|---|---|---|---|
| Entrar (Todas) | `/notificaciones` | `NotificationsPage.tsx` | `GET /workforce/notifications?page=1&take=20` | Lectura | Sí | Sí | — | Bajo | — |
| Filtrar por "No leídas" | `/notificaciones` | select Estado | `GET .../notifications?status=NO_LEIDA` | Lectura | Sí | Sí | — | Bajo | — |
| Cargar más notificaciones | `/notificaciones` | botón "Cargar X más" | `GET .../notifications?page=2` | Lectura | Sí | Parcial | Se saltea sin segunda página | Bajo | — |
| Marcar como leída / Ver detalle | `/notificaciones` | botón/link de fila | `POST .../notifications/:id/read` | Escritura | Sí | No | Prohibido por defecto | Alto si se ejecutara | **"Ver detalle" es un `<Link>` cuyo `onClick` también llama `markRead()` — no sólo el botón explícito escribe.** |

### I. Fichador

| Acción | Ruta | Componente | Endpoint esperado | Tipo | Medible | Se mide | Motivo si no | Riesgo | Observación |
|---|---|---|---|---|---|---|---|---|---|
| Entrar (carga inicial) | `/fichador` | `TimeClockPage.tsx` | ninguno al montar | Lectura | Sí | Sí | — | Bajo | — |
| Buscar empleado | `/fichador` | input búsqueda | `GET /time-entries/clock/employees?search=` | Lectura | Sí | No | Fuera del alcance mínimo pedido para esta zona (perfil de riesgo del kiosco) | Bajo pero fuera de alcance | — |
| Marcar ingreso / salida | `/fichador` | botones | `POST /time-entries/clock/photo-punch` | Escritura | Sí | No | Prohibido por defecto — fichada real | Alto si se ejecutara | — |
| Capturar foto / enviar punch | `/fichador` | `FaceCaptureModal.tsx` | `POST /time-entries/clock/photo-punch` | Escritura | Sí | No | Prohibido explícitamente (cámara) | Alto si se ejecutara | Nunca se abre porque no se clickea Marcar ingreso/salida. |

### J. Exportación

| Acción | Ruta | Componente | Endpoint esperado | Tipo | Medible | Se mide | Motivo si no | Riesgo | Observación |
|---|---|---|---|---|---|---|---|---|---|
| Entrar / Cambiar período | `/configuracion/liquidacion` | `FinnegansExportPage.tsx` | `GET /finnegans-export/novelties?period=` | Lectura | Sí | Sí | — | Bajo | Sólo Nivel 1. |
| Buscar | `/configuracion/liquidacion` | `FilterPanel` | sin endpoint propio (filtro en memoria) | Lectura | Sí | Sí | — | Bajo | — |
| Exportar Excel Finnegans | `/configuracion/liquidacion` | botón | sin request — build client-side | Lectura | Sí | No | No es escritura de API, pero descarga datos reales — prohibido por defecto | Medio (descarga, no persiste) | — |

---

## 2. Hallazgos principales (evidencia de código, sin ejecutar escrituras)

1. **Notificaciones — "Ver detalle" escribe.** El link de navegación de cada fila llama `markRead()` en su `onClick`, además del botón explícito "Marcar leída". Cualquier automatización o usuario que abra el detalle desde esta lista genera una escritura sin que sea obvio por el rol del elemento (`<Link>` vs `<button>`).
2. **Aria-label ambiguo en Bandeja de revisión.** Los botones "Aprobar"/"Rechazar"/"Devolver" se repiten idénticos entre registros de horas, novedades y desgloses manuales — un locator de rol sin scope exacto en un test automatizado (o un atajo de teclado/lector de pantalla mal armado) puede accionar el flujo equivocado.
3. **`GET /shifts/alerts` (Alertas de turnos)** fue medido una sola vez, por el journey general 14B.3, en 3906ms (Crítico) — nunca se revisó backend ni se volvió a medir desde entonces pese a que 13H/13H.1 sí tocaron esta página (sólo agrupación client-side).
4. **`findManyByEmployeeGrouped` (Bandeja de revisión, vista "Por persona")** usa el mismo antipatrón `$transaction` que 14C.2 ya identificó y corrigió en `period-employees`/`summary`/`attendance` — documentado 2 veces como pendiente, nunca corregido.
5. **Cierres mensuales nunca medido.** Ni el journey general (14B.3) ni ningún journey de módulo lo incluyó — es el único submódulo de escritura crítica (categoría D de `PERFORMANCE_STANDARDS.md`, junto con Fichador) sin ningún dato de performance histórico.
6. **Paginación con topes hardcodeados, no reales**, en 3 lugares fuera de Carga de horas: `workforce.service.ts` (`corrections`, `take:500`), `timeEntries.repository.ts` (`findForExport`, `take:5000`), `finnegansExport.repository.ts` (`take:10000`). Documentado ya en `PERFORMANCE_NETWORK_OPTIMIZATION_PLAN.md` como excepción de diseño para exports, pero `corrections` no es un export — es una lista operativa sin paginación real.
7. **Fichador queda deliberadamente fuera del alcance de medición** más allá de la carga inicial: es la única zona donde el pedido explícitamente restringe hasta la búsqueda de empleados (no sólo las escrituras), en línea con `PERFORMANCE_STANDARDS.md` §10 (categoría D, no optimizar sin etapa dedicada) y el rate-limit compartido con uso real (`x-clock-device-token`, 30 req/5min).
8. **Endpoints compartidos entre submódulos**: `GET /org-structure` (Carga de horas y Bandeja de revisión), `GET /time-entries/summary` (Carga de horas y Bandeja de revisión), `GET /employees/:id/time-grid` (Carga de horas y Bandeja de revisión, mismo componente `EmployeeHoursPage.tsx`) — cualquier optimización a estos endpoints beneficia más de un submódulo a la vez.
9. **Cache backend inconsistente entre submódulos del mismo módulo**: `time-entries`/`novelties` tienen TTL cache (15-20s); `shifts`, `workforce` (closures/corrections/notifications), `pending` y `finnegans-export` no tienen ninguno — 4 patrones de cache backend coexistiendo, deuda ya reconocida en `PERFORMANCE_STANDARDS.md` §15.

---

## 3. Resultados de la corrida automatizada

Ver `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md` y `.json` (generados por `npm run perf:journey:workforce`, corridos localmente contra el backend conectado a la base real de staging — ver `docs/LOCAL_DEVELOPMENT.md`) para: tabla de acciones, top acciones/requests lentas, endpoints repetidos, duplicados por acción (StrictMode), HTTP errors, console errors y la recomendación de orden para 14G.2+ calculada sobre datos reales de esta corrida.

---

## 4. Riesgos

- Journey de un solo usuario, sin concurrencia — no reemplaza logs de producción/staging bajo uso real ni el `GET /health/performance` de la Etapa 14B.2.
- Corrida contra la base real de staging (Neon): disponibilidad de jornadas cerradas con tramos, alertas agrupables, empleados con desglose manual editable, segunda página de notificaciones/exportación, etc. varía según el estado real de la base — varias acciones quedan marcadas `Parcial` en la Matriz 2 por este motivo, no por un bug del journey.
- `visibleMs`/`networkIdleMs` son proxies aproximados (mismo criterio que 14B.3/14D.1), no mediciones exactas de percepción de usuario.
- Una corrida completa de los 10 submódulos puede tardar varios minutos contra Neon (confirmado en la corrida real de esta etapa) — el journey no reemplaza un smoke test rápido de CI, es una herramienta de diagnóstico puntual.
- Cero escrituras ejecutadas — los tiempos reales de guardar/aprobar/rechazar/fichar/exportar siguen sin medición en vivo por esta etapa, documentados como pendientes en la Matriz 2.

## 5. Qué NO se tocó

Backend funcional, Prisma schema, migraciones, RBAC, contratos de API, diseño visual, Legajos, Dashboard general (salvo el aterrizaje inevitable del login), Puestos, Conceptos Horarios/Horas Especiales como módulos maestros, Organigrama, Documentos fuera de Gestión horaria. No se ejecutó ninguna escritura (ver Matriz 2, columna "Tipo" = Escritura → "Se mide" = No en el 100% de los casos).

## 6. Archivos creados

- `frontend/e2e/support/workforceManagementJourney.ts` (+ `.test.ts`)
- `frontend/e2e/workforceManagementPerformanceJourney.spec.ts`
- `frontend/package.json` — script `perf:journey:workforce`
- `docs/decisions/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md` (este documento)
- `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md` y `.json` (generados por el journey)

## 7. Próximos pasos

Ver §15 ("Recomendación de orden para 14G.2+") del reporte generado en `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md` para el ranking basado en datos reales de esta corrida. Como guía cualitativa independiente de la corrida puntual (hallazgos §2 de este documento): **Bandeja de revisión** (vista "Por persona", antipatrón conocido y no corregido) y **Alertas de turnos** (único endpoint ya confirmado Crítico y nunca revisado) son los candidatos más sólidos para 14G.2, seguidos de **Cierres mensuales** (nunca medido, sin paginación) en 14G.3. Fichador se mantiene fuera de cualquier ranking de optimización general por política explícita del proyecto.
