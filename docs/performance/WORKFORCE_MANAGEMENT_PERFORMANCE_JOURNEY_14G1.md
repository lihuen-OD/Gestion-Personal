# Performance Journey — Gestión horaria (Etapa 14G.1)

Reporte generado automáticamente por `npm run perf:journey:workforce`. No editar a mano — se sobreescribe en cada corrida.

**Etapa de diagnóstico/medición — no de optimización.** Ningún hallazgo de este reporte se corrigió en esta etapa; ver §15 para el orden recomendado de 14G.2 en adelante.

## 1. Resumen ejecutivo

Recorrido macro de los 10 submódulos de Gestión horaria: 38/65 acciones cubiertas, 27 salteadas (16 de ellas por ser de escritura, con motivo documentado cada una), 0 respuestas HTTP >= 400, 0 errores de consola. 1 acción(es) en rango Crítico (> 3000ms) y 5 en rango Lento (2000-3000ms). Cero escrituras ejecutadas — modo `read-only` en todo el recorrido.

## 2. Ambiente

- Generado: 2026-09-08T13:16:15.251Z
- Frontend: http://localhost:5174
- Backend: http://localhost:4002/api
- Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.
- Usuario: Nivel 1 - RRHH (acceso rápido demo — credenciales en docs/LOCAL_DEVELOPMENT.md, no se repiten en este reporte)
- Comando: `npm run perf:journey:workforce (desde frontend/)`

## 3. Cobertura general

| Submódulo | Acciones cubiertas | Acciones salteadas | Requests capturadas | Peor duración | Rango |
|---|---|---|---|---|---|
| Login | 1 | 0 | 4 | 6235ms | Crítico |
| A. Inicio | 2 | 0 | 2 | 2146ms | Lento |
| B. Asistencia | 5 | 4 | 6 | 2229ms | Lento |
| C. Alertas de turnos | 6 | 1 | 4 | 1106ms | Medio |
| D. Carga de horas | 9 | 4 | 15 | 2280ms | Lento |
| E. Cierres mensuales | 2 | 2 | 4 | 950ms | OK |
| F. Bandeja de revisión | 3 | 6 | 7 | 1389ms | Medio |
| G. Novedades | 4 | 3 | 4 | 1744ms | Medio |
| H. Notificaciones | 3 | 1 | 3 | 931ms | OK |
| I. Fichador | 1 | 4 | 1 | 877ms | OK |
| J. Exportación | 2 | 2 | 4 | 2279ms | Lento |

## 4. Tabla de acciones

| Acción | Submódulo | Ruta | Visible | Network idle | Requests | Errores consola | Escritura |
|---|---|---|---|---|---|---|---|
| Login (acceso rápido RRHH) | Login | `/` | 536ms | 6235ms | 4 | 0 | No |
| Entrar a Inicio (Gestión horaria) | A. Inicio | `/gestion-horaria` | 87ms | 2146ms | 2 | 0 | No |
| Ver KPIs/resumen de Inicio | A. Inicio | `/gestion-horaria` | 3ms | 87ms | 0 | 0 | No |
| Entrar a Asistencia (carga inicial del día) | B. Asistencia | `/asistencia` | 83ms | 2229ms | 3 | 0 | No |
| Cambiar fecha del día | B. Asistencia | `/asistencia` | 27ms | 111ms | 0 | 0 | No |
| Buscar en problemas de fichada | B. Asistencia | `/asistencia` | 20ms | 424ms | 1 | 0 | No |
| Filtrar problemas de fichada por tipo | B. Asistencia | `/asistencia` | 16ms | 98ms | 1 | 0 | No |
| Limpiar filtros de problemas de fichada | B. Asistencia | `/asistencia` | 23ms | 107ms | 1 | 0 | No |
| Entrar a Alertas de turnos | C. Alertas de turnos | `/asistencia/alertas` | 65ms | 1106ms | 2 | 0 | No |
| Buscar alerta por texto | C. Alertas de turnos | `/asistencia/alertas` | 16ms | 419ms | 0 | 0 | No |
| Limpiar búsqueda de alertas | C. Alertas de turnos | `/asistencia/alertas` | 27ms | 430ms | 1 | 0 | No |
| Filtrar alertas por tipo | C. Alertas de turnos | `/asistencia/alertas` | 15ms | 99ms | 0 | 0 | No |
| Limpiar filtros de alertas | C. Alertas de turnos | `/asistencia/alertas` | 64ms | 146ms | 1 | 0 | No |
| Expandir hallazgos asociados de un grupo | C. Alertas de turnos | `/asistencia/alertas` | 33ms | 117ms | 0 | 0 | No |
| Entrar a Carga de horas (período actual) | D. Carga de horas | `/horas` | 76ms | 2280ms | 4 | 0 | No |
| Cambiar período (Carga de horas) | D. Carga de horas | `/horas` | 44ms | 127ms | 0 | 0 | No |
| Buscar empleado (Carga de horas) | D. Carga de horas | `/horas` | 17ms | 419ms | 2 | 0 | No |
| Limpiar búsqueda (Carga de horas) | D. Carga de horas | `/horas` | 35ms | 438ms | 0 | 0 | No |
| Abrir edición de horas de un empleado (navega a /horas/:id) | D. Carga de horas | `/horas/:id` | 839ms | 2220ms | 7 | 0 | No |
| Ver total real/liquidable | D. Carga de horas | `/horas/:id` | 4ms | 88ms | 0 | 0 | No |
| Abrir edición de hora sin guardar | D. Carga de horas | `/horas/:id` | 46ms | 129ms | 0 | 0 | No |
| Cancelar edición de hora | D. Carga de horas | `/horas/:id` | 41ms | 125ms | 0 | 0 | No |
| Volver a Carga de horas | D. Carga de horas | `/horas` | 70ms | 152ms | 2 | 0 | No |
| Entrar a Cierres mensuales (período actual) | E. Cierres mensuales | `/cierres` | 76ms | 950ms | 4 | 0 | No |
| Cambiar período (Cierres mensuales) | E. Cierres mensuales | `/cierres` | 15ms | 98ms | 0 | 0 | No |
| Entrar a Bandeja de revisión (Por registro) | F. Bandeja de revisión | `/pendientes` | 75ms | 943ms | 4 | 0 | No |
| Cambiar a pestaña "Por persona" | F. Bandeja de revisión | `/pendientes` | 28ms | 112ms | 0 | 0 | No |
| Cambiar período (Bandeja de revisión) | F. Bandeja de revisión | `/pendientes` | 1305ms | 1389ms | 3 | 0 | No |
| Entrar a Novedades | G. Novedades | `/novedades` | 71ms | 1744ms | 3 | 0 | No |
| Buscar en Novedades | G. Novedades | `/novedades` | 12ms | 416ms | 0 | 0 | No |
| Abrir modal "Nueva novedad" sin guardar | G. Novedades | `/novedades` | 27ms | 109ms | 0 | 0 | No |
| Cancelar "Nueva novedad" | G. Novedades | `/novedades` | 35ms | 117ms | 1 | 0 | No |
| Entrar a Notificaciones (Todas) | H. Notificaciones | `/notificaciones` | 76ms | 931ms | 2 | 0 | No |
| Filtrar por "No leídas" | H. Notificaciones | `/notificaciones` | 18ms | 102ms | 0 | 0 | No |
| Cargar más notificaciones | H. Notificaciones | `/notificaciones` | 26ms | 109ms | 1 | 0 | No |
| Entrar a Fichador (carga inicial) | I. Fichador | `/fichador` | 52ms | 877ms | 1 | 0 | No |
| Entrar a Exportación (período actual) | J. Exportación | `/configuracion/liquidacion` | 74ms | 2279ms | 3 | 0 | No |
| Cambiar período (Exportación) | J. Exportación | `/configuracion/liquidacion` | 803ms | 888ms | 1 | 0 | No |

## 5. Tabla por submódulo

Relevada leyendo el código real (router, navegación, cada página y sus servicios API) antes de escribir el journey — ver Matriz 1 (Inventario de submódulos) en `docs/decisions/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md`.

| Submódulo | Ruta real | Página | Cache frontend | Cache backend | Escribe datos | Medible seguro |
|---|---|---|---|---|---|---|
| A. Inicio | /gestion-horaria | HourlyManagementHomePage.tsx | No | No | No | Sí |
| B. Asistencia | /asistencia | AttendancePage.tsx | No (apiCache:false en ambos) | Sí — attendanceSummaryCache TTL 10s (sólo /attendance; /observations no tiene cache backend) | Sí (cerrar jornada, olvido de salida, observar, resolver) — no ejecutado esta etapa | Sí |
| C. Alertas de turnos | /asistencia/alertas | ShiftAlertsPage.tsx | No | No (módulo shifts no tiene shifts.cache.ts) | Sí (resolver alerta) — no ejecutado esta etapa | Sí |
| D. Carga de horas | /horas, /horas/:id | HoursPage.tsx, EmployeeHoursPage.tsx | Sí — cachePolicies.timeEntriesAggregates 30s (period-employees/summary) | Sí — TTL 20s (period-employees, summary), 15s (list) | Sí (guardar hora, desglose manual, submit) — no ejecutado esta etapa | Sí |
| E. Cierres mensuales | /cierres | MonthlyClosuresPage.tsx | No | No | Sí (aprobar/enviar/devolver cierre, aprobar/rechazar corrección) — no ejecutado esta etapa | Sí |
| F. Bandeja de revisión | /pendientes | HoursPage.tsx (prop pendingOnly) | Sí — cachePolicies.pendingQueue 30s (sólo /pending) | No | Sí (aprobar/rechazar/devolver registro, novedad y desglose manual — 3 flujos distintos) — no ejecutado esta etapa | Sí, con cuidado: los botones Aprobar/Rechazar/Devolver comparten aria-label genérico entre registro/novedad/desglose — el journey nunca usa un locator de rol sin scope (ver hallazgo en el reporte). |
| G. Novedades | /novedades | NoveltiesPage.tsx | No (mutaciones invalidan family "novelties") | Sí — noveltiesListCache TTL 15s | Sí (crear, aprobar, aprobar en lote, rechazar, eliminar) — no ejecutado esta etapa | Sí (modal de creación se abre y cierra sin guardar) |
| H. Notificaciones | /notificaciones | NotificationsPage.tsx | No en el listado (el contador de AppShell sí cachea 20s, endpoint distinto) | No | Sí (marcar como leída) | Parcial |
| I. Fichador | /fichador | TimeClockPage.tsx | No | No | Sí (marcar ingreso/salida, foto-punch) | Parcial (sólo carga inicial) |
| J. Exportación | /configuracion/liquidacion | FinnegansExportPage.tsx | No | No | No (el endpoint es de sólo lectura — el .xlsx se arma 100% client-side) | Sí (navegación/filtros); no descargar por defecto |

## 6. Acciones no cubiertas y motivo

- **Abrir detalle de tramos de una jornada cerrada** (B. Asistencia, lectura): no se encontró el disparador de este modal en el estado actual del entorno.
- **Cerrar detalle de tramos** (B. Asistencia, lectura): depende de la acción anterior, salteada.
- **Cerrar jornada manualmente / Marcar olvido de salida / Observar jornada** (B. Asistencia, escritura): Prohibido por defecto (Parte 4 del pedido) — modifica jornadas reales de asistencia..
- **Resolver problema de fichada** (B. Asistencia, escritura): Prohibido por defecto — cierra un caso de revisión real..
- **Resolver alerta de turno** (C. Alertas de turnos, escritura): Prohibido por defecto — cierra una alerta real..
- **Abrir conceptos adicionales sin guardar** (D. Carga de horas, lectura): no se encontró el disparador de este modal en el estado actual del entorno.
- **Cancelar conceptos adicionales** (D. Carga de horas, lectura): depende de la acción anterior, salteada.
- **Guardar hora / Guardar desglose manual / Enviar a revisión** (D. Carga de horas, escritura): Prohibido por defecto — cargaría horas reales, posiblemente asociadas a liquidación..
- **Exportar horas** (D. Carga de horas, lectura): El endpoint es GET, pero el click dispara una descarga de archivo con datos de horas — prohibido por defecto (Parte 4: no generar exportación sensible / no descarga por defecto)..
- **Aprobar seleccionados / Enviar cierre a RH / Devolver cierre** (E. Cierres mensuales, escritura): Prohibido por defecto — cierra/reabre un período real de liquidación..
- **Aprobar/Rechazar corrección** (E. Cierres mensuales, escritura): Prohibido por defecto..
- **Buscar en Bandeja de revisión** (F. Bandeja de revisión, lectura): no hay ninguna fila en Bandeja de revisión en el entorno actual para tomar un término real de búsqueda.
- **Abrir detalle (Ver detalle, Por persona)** (F. Bandeja de revisión, lectura): no hay ninguna fila en la vista Por persona en el entorno actual, o la pestaña no está disponible.
- **Volver a Bandeja de revisión** (F. Bandeja de revisión, lectura): depende de la acción anterior, salteada.
- **Aprobar/Rechazar/Devolver registro** (F. Bandeja de revisión, escritura): Prohibido por defecto..
- **Aprobar/Rechazar novedad (desde Bandeja)** (F. Bandeja de revisión, escritura): Prohibido por defecto..
- **Aprobar/Rechazar/Devolver desglose manual** (F. Bandeja de revisión, escritura): Prohibido por defecto..
- **Guardar nueva novedad** (G. Novedades, escritura): Prohibido por defecto — crearía una novedad real (licencia/ausencia) para un empleado real..
- **Aprobar/Rechazar/Eliminar novedad** (G. Novedades, escritura): Prohibido por defecto..
- **Aprobar pendientes visibles (bulk)** (G. Novedades, escritura): Prohibido por defecto..
- **Marcar como leída / Ver detalle** (H. Notificaciones, escritura): Prohibido por defecto — ambos disparan POST /workforce/notifications/:id/read (el link "Ver detalle" también, como efecto colateral de su onClick)..
- **Buscar empleado en Fichador** (I. Fichador, lectura): Fuera del alcance mínimo pedido para Fichador (Parte 6, Zona I sólo pide "entrar" y "medir carga inicial", dado el perfil de riesgo del kiosco: sin auth de usuario, cámara, rate-limit compartido con uso real de 30/5min)..
- **Marcar ingreso** (I. Fichador, escritura): Prohibido por defecto — fichada real de un empleado real..
- **Marcar salida** (I. Fichador, escritura): Prohibido por defecto..
- **Capturar foto / enviar punch** (I. Fichador, escritura): Prohibido por defecto — el pedido prohíbe explícitamente aceptar permisos de cámara o ejecutar la acción..
- **Buscar en Exportación** (J. Exportación, lectura): no hay ningún registro para el período elegido en el entorno actual.
- **Exportar Excel Finnegans** (J. Exportación, lectura): No es una escritura de API (build 100% client-side), pero genera y descarga un archivo con datos de novedades reales — prohibido por defecto (Parte 4: no generar exportación sensible / no descarga por defecto)..

## 7. Top acciones lentas

| Acción | Submódulo | Visible | Network idle | Rango |
|---|---|---|---|---|
| Login (acceso rápido RRHH) | Login | 536ms | 6235ms | Crítico |
| Entrar a Carga de horas (período actual) | D. Carga de horas | 76ms | 2280ms | Lento |
| Entrar a Exportación (período actual) | J. Exportación | 74ms | 2279ms | Lento |
| Entrar a Asistencia (carga inicial del día) | B. Asistencia | 83ms | 2229ms | Lento |
| Abrir edición de horas de un empleado (navega a /horas/:id) | D. Carga de horas | 839ms | 2220ms | Lento |
| Entrar a Inicio (Gestión horaria) | A. Inicio | 87ms | 2146ms | Lento |
| Entrar a Novedades | G. Novedades | 71ms | 1744ms | Medio |
| Cambiar período (Bandeja de revisión) | F. Bandeja de revisión | 1305ms | 1389ms | Medio |
| Entrar a Alertas de turnos | C. Alertas de turnos | 65ms | 1106ms | Medio |
| Entrar a Cierres mensuales (período actual) | E. Cierres mensuales | 76ms | 950ms | OK |

## 8. Top requests lentas

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/dashboard/metrics` | 200 | 4034ms |
| GET | `/api/audit` | 200 | 3283ms |
| GET | `/api/finnegans-export/novelties` | 200 | 1718ms |
| GET | `/api/org-structure` | 200 | 1702ms |
| GET | `/api/time-entries/attendance` | 200 | 1660ms |
| GET | `/api/novelty-types` | 200 | 1655ms |
| GET | `/api/time-entries/home-summary` | 200 | 1572ms |
| GET | `/api/novelties` | 200 | 1380ms |
| GET | `/api/finnegans-export/novelties` | 200 | 1277ms |
| GET | `/api/novelties` | 200 | 1186ms |

## 9. Endpoints repetidos

Mismo endpoint (método+path) pedido más de una vez a lo largo de TODO el recorrido, sin importar desde qué submódulo — detecta catálogos/endpoints compartidos entre submódulos (ítem 13 de la Parte 6 del pedido).

| Endpoint | Llamadas totales |
|---|---|
| `GET /api/workforce/notifications-unread-count` | 12 |
| `GET /api/time-entries/summary` | 5 |
| `GET /api/novelties` | 4 |
| `GET /api/time-entries/attendance/observations` | 3 |
| `GET /api/shifts/alerts` | 3 |
| `GET /api/time-entries/period-employees` | 3 |
| `GET /api/employees/:id/time-grid` | 3 |
| `GET /api/finnegans-export/novelties` | 3 |
| `GET /api/time-entries/attendance` | 2 |
| `GET /api/time-entries` | 2 |
| `GET /api/pending` | 2 |
| `GET /api/workforce/notifications` | 2 |

## 10. Duplicados por acción

Mismo endpoint pedido más de una vez DENTRO de la ventana de una sola acción — señal de StrictMode (double-invoke en dev) o de un remount/refetch inesperado (ítems 1-2 de la Parte 6 del pedido).

- **Abrir edición de horas de un empleado (navega a /horas/:id)** (D. Carga de horas): `GET /api/employees/:id/time-grid` x3, `GET /api/novelties` x2
- **Entrar a Novedades** (G. Novedades): `GET /api/novelties` x2
- **Entrar a Exportación (período actual)** (J. Exportación): `GET /api/finnegans-export/novelties` x2

## 11. HTTP errors

Ninguna respuesta >= 400 en todo el recorrido.

## 12. Console errors

Ninguna acción cubierta generó errores de consola.

## 13. Loading/error/empty states

- Pantallas vacías detectadas: Entrar a Bandeja de revisión (Por registro), Entrar a Exportación (período actual).
- Loading global detectado: ninguno — cada submódulo usa su propio LoadingState/skeleton local, sin bloquear el resto de la app (Suspense de code-splitting entre rutas aparte).
- Loading localizado detectado: sin datos suficientes en esta corrida.

## 14. Seguridad/no escrituras

Cero acciones de escritura ejecutadas en todo el recorrido (modo `read-only`). 16 acción(es) de escritura identificadas y explícitamente NO ejecutadas:

- **Cerrar jornada manualmente / Marcar olvido de salida / Observar jornada** (B. Asistencia): Prohibido por defecto (Parte 4 del pedido) — modifica jornadas reales de asistencia.
- **Resolver problema de fichada** (B. Asistencia): Prohibido por defecto — cierra un caso de revisión real.
- **Resolver alerta de turno** (C. Alertas de turnos): Prohibido por defecto — cierra una alerta real.
- **Guardar hora / Guardar desglose manual / Enviar a revisión** (D. Carga de horas): Prohibido por defecto — cargaría horas reales, posiblemente asociadas a liquidación.
- **Aprobar seleccionados / Enviar cierre a RH / Devolver cierre** (E. Cierres mensuales): Prohibido por defecto — cierra/reabre un período real de liquidación.
- **Aprobar/Rechazar corrección** (E. Cierres mensuales): Prohibido por defecto.
- **Aprobar/Rechazar/Devolver registro** (F. Bandeja de revisión): Prohibido por defecto.
- **Aprobar/Rechazar novedad (desde Bandeja)** (F. Bandeja de revisión): Prohibido por defecto.
- **Aprobar/Rechazar/Devolver desglose manual** (F. Bandeja de revisión): Prohibido por defecto.
- **Guardar nueva novedad** (G. Novedades): Prohibido por defecto — crearía una novedad real (licencia/ausencia) para un empleado real.
- **Aprobar/Rechazar/Eliminar novedad** (G. Novedades): Prohibido por defecto.
- **Aprobar pendientes visibles (bulk)** (G. Novedades): Prohibido por defecto.
- **Marcar como leída / Ver detalle** (H. Notificaciones): Prohibido por defecto — ambos disparan POST /workforce/notifications/:id/read (el link "Ver detalle" también, como efecto colateral de su onClick).
- **Marcar ingreso** (I. Fichador): Prohibido por defecto — fichada real de un empleado real.
- **Marcar salida** (I. Fichador): Prohibido por defecto.
- **Capturar foto / enviar punch** (I. Fichador): Prohibido por defecto — el pedido prohíbe explícitamente aceptar permisos de cámara o ejecutar la acción.

Hallazgo de seguridad adicional: en Notificaciones, el link "Ver detalle" dispara `POST /workforce/notifications/:id/read` como efecto colateral de un click de navegación — no es sólo un botón explícito de "Marcar leída" lo que escribe. El journey evita todo click de fila en esa pantalla (ver Matriz 1, fila H).

## 15. Recomendación de orden para 14G.2+

Ningún submódulo mostró endpoints en rango Crítico/Lento en esta corrida puntual — no hay evidencia suficiente para priorizar. Repetir la corrida antes de decidir 14G.2.

Contexto histórico relevante para esta priorización (no medido por este journey, ya documentado en etapas previas):
- `GET /shifts/alerts` (Alertas de turnos) fue medido en 3906ms (Crítico) por el journey general 14B.3 y nunca se revisó desde entonces.
- `findManyByEmployeeGrouped` (Bandeja de revisión, vista "Por persona") usa el mismo antipatrón `$transaction` ya corregido en otros endpoints por 14C.2 — documentado 2 veces como pendiente, nunca corregido.
- `GET /workforce/closures` y `GET /workforce/corrections` (Cierres mensuales) nunca fueron medidos por ningún journey anterior a 14G.1.
- Fichador queda deliberadamente fuera de cualquier ranking de optimización — ver `docs/PERFORMANCE_STANDARDS.md` §10 (categoría crítica D, no optimizar sin etapa dedicada).

## 16. Raw sanitized JSON

Idéntico al archivo `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json` generado en esta misma corrida.

```json
{
  "generatedAt": "2026-09-08T13:16:15.251Z",
  "environment": "Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.",
  "baseUrl": "http://localhost:5174",
  "apiBaseUrl": "http://localhost:4002/api",
  "user": "Nivel 1 - RRHH (acceso rápido demo — credenciales en docs/LOCAL_DEVELOPMENT.md, no se repiten en este reporte)",
  "command": "npm run perf:journey:workforce (desde frontend/)",
  "mode": "read-only",
  "thresholds": {
    "okThresholdMs": 1000,
    "mediumThresholdMs": 2000,
    "slowThresholdMs": 3000
  },
  "summary": {
    "totalActions": 65,
    "coveredActions": 38,
    "skippedActions": 27,
    "slowActions": 5,
    "verySlowActions": 1,
    "writesSkipped": 16,
    "httpErrors": 0,
    "consoleErrors": 0
  },
  "submoduleRollup": [
    {
      "zone": "Login",
      "coveredActions": 1,
      "skippedActions": 0,
      "totalRequests": 4,
      "maxDurationMs": 6235,
      "rank": "Crítico"
    },
    {
      "zone": "A. Inicio",
      "coveredActions": 2,
      "skippedActions": 0,
      "totalRequests": 2,
      "maxDurationMs": 2146,
      "rank": "Lento"
    },
    {
      "zone": "B. Asistencia",
      "coveredActions": 5,
      "skippedActions": 4,
      "totalRequests": 6,
      "maxDurationMs": 2229,
      "rank": "Lento"
    },
    {
      "zone": "C. Alertas de turnos",
      "coveredActions": 6,
      "skippedActions": 1,
      "totalRequests": 4,
      "maxDurationMs": 1106,
      "rank": "Medio"
    },
    {
      "zone": "D. Carga de horas",
      "coveredActions": 9,
      "skippedActions": 4,
      "totalRequests": 15,
      "maxDurationMs": 2280,
      "rank": "Lento"
    },
    {
      "zone": "E. Cierres mensuales",
      "coveredActions": 2,
      "skippedActions": 2,
      "totalRequests": 4,
      "maxDurationMs": 950,
      "rank": "OK"
    },
    {
      "zone": "F. Bandeja de revisión",
      "coveredActions": 3,
      "skippedActions": 6,
      "totalRequests": 7,
      "maxDurationMs": 1389,
      "rank": "Medio"
    },
    {
      "zone": "G. Novedades",
      "coveredActions": 4,
      "skippedActions": 3,
      "totalRequests": 4,
      "maxDurationMs": 1744,
      "rank": "Medio"
    },
    {
      "zone": "H. Notificaciones",
      "coveredActions": 3,
      "skippedActions": 1,
      "totalRequests": 3,
      "maxDurationMs": 931,
      "rank": "OK"
    },
    {
      "zone": "I. Fichador",
      "coveredActions": 1,
      "skippedActions": 4,
      "totalRequests": 1,
      "maxDurationMs": 877,
      "rank": "OK"
    },
    {
      "zone": "J. Exportación",
      "coveredActions": 2,
      "skippedActions": 2,
      "totalRequests": 4,
      "maxDurationMs": 2279,
      "rank": "Lento"
    }
  ],
  "actions": [
    {
      "name": "Login (acceso rápido RRHH)",
      "zone": "Login",
      "submodule": "Login",
      "route": "/",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 536,
      "networkIdleMs": 6235,
      "requests": [
        {
          "method": "POST",
          "path": "/api/auth/login",
          "statusCode": 200,
          "durationMs": 1142
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 360
        },
        {
          "method": "GET",
          "path": "/api/audit",
          "statusCode": 200,
          "durationMs": 3283
        },
        {
          "method": "GET",
          "path": "/api/dashboard/metrics",
          "statusCode": 200,
          "durationMs": 4034
        }
      ],
      "consoleErrors": [],
      "notes": [
        "Nivel 1 aterriza en / (DashboardPage) — dispara GET /dashboard/metrics como efecto colateral inevitable del login, fuera del alcance de Gestión horaria (ver docs/decisions/DASHBOARD_METRICS_PERFORMANCE_14E1.md para ese endpoint)."
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Inicio (Gestión horaria)",
      "zone": "A. Inicio",
      "submodule": "A. Inicio",
      "route": "/gestion-horaria",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 87,
      "networkIdleMs": 2146,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 357
        },
        {
          "method": "GET",
          "path": "/api/time-entries/home-summary",
          "statusCode": 200,
          "durationMs": 1572
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Ver KPIs/resumen de Inicio",
      "zone": "A. Inicio",
      "submodule": "A. Inicio",
      "route": "/gestion-horaria",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 3,
      "networkIdleMs": 87,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "no dispara endpoint propio — los StatLink son <Link>, se confirma ausencia de requests nuevos en la ventana de esta acción"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Asistencia (carga inicial del día)",
      "zone": "B. Asistencia",
      "submodule": "B. Asistencia",
      "route": "/asistencia",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 83,
      "networkIdleMs": 2229,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 696
        },
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "statusCode": 200,
          "durationMs": 936
        },
        {
          "method": "GET",
          "path": "/api/time-entries/attendance",
          "statusCode": 200,
          "durationMs": 1660
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cambiar fecha del día",
      "zone": "B. Asistencia",
      "submodule": "B. Asistencia",
      "route": "/asistencia",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 27,
      "networkIdleMs": 111,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Buscar en problemas de fichada",
      "zone": "B. Asistencia",
      "submodule": "B. Asistencia",
      "route": "/asistencia",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 20,
      "networkIdleMs": 424,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/attendance",
          "statusCode": 200,
          "durationMs": 915
        }
      ],
      "consoleErrors": [],
      "notes": [
        "término tomado de un problema de fichada real — no se registra el valor buscado en este reporte"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Filtrar problemas de fichada por tipo",
      "zone": "B. Asistencia",
      "submodule": "B. Asistencia",
      "route": "/asistencia",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 16,
      "networkIdleMs": 98,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "statusCode": 200,
          "durationMs": 393
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Limpiar filtros de problemas de fichada",
      "zone": "B. Asistencia",
      "submodule": "B. Asistencia",
      "route": "/asistencia",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 23,
      "networkIdleMs": 107,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "statusCode": 200,
          "durationMs": 374
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Abrir detalle de tramos de una jornada cerrada",
      "zone": "B. Asistencia",
      "submodule": "B. Asistencia",
      "route": "/asistencia",
      "covered": false,
      "skippedReason": "no se encontró el disparador de este modal en el estado actual del entorno",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cerrar detalle de tramos",
      "zone": "B. Asistencia",
      "submodule": "B. Asistencia",
      "route": "/asistencia",
      "covered": false,
      "skippedReason": "depende de la acción anterior, salteada",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cerrar jornada manualmente / Marcar olvido de salida / Observar jornada",
      "zone": "B. Asistencia",
      "submodule": "B. Asistencia",
      "route": "/asistencia",
      "covered": false,
      "skippedReason": "Prohibido por defecto (Parte 4 del pedido) — modifica jornadas reales de asistencia.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Resolver problema de fichada",
      "zone": "B. Asistencia",
      "submodule": "B. Asistencia",
      "route": "/asistencia",
      "covered": false,
      "skippedReason": "Prohibido por defecto — cierra un caso de revisión real.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Alertas de turnos",
      "zone": "C. Alertas de turnos",
      "submodule": "C. Alertas de turnos",
      "route": "/asistencia/alertas",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 65,
      "networkIdleMs": 1106,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 355
        },
        {
          "method": "GET",
          "path": "/api/shifts/alerts",
          "statusCode": 200,
          "durationMs": 558
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": false
    },
    {
      "name": "Buscar alerta por texto",
      "zone": "C. Alertas de turnos",
      "submodule": "C. Alertas de turnos",
      "route": "/asistencia/alertas",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 16,
      "networkIdleMs": 419,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "término tomado de una alerta real — no se registra el valor buscado en este reporte"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Limpiar búsqueda de alertas",
      "zone": "C. Alertas de turnos",
      "submodule": "C. Alertas de turnos",
      "route": "/asistencia/alertas",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 27,
      "networkIdleMs": 430,
      "requests": [
        {
          "method": "GET",
          "path": "/api/shifts/alerts",
          "statusCode": 200,
          "durationMs": 568
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Filtrar alertas por tipo",
      "zone": "C. Alertas de turnos",
      "submodule": "C. Alertas de turnos",
      "route": "/asistencia/alertas",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 15,
      "networkIdleMs": 99,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Limpiar filtros de alertas",
      "zone": "C. Alertas de turnos",
      "submodule": "C. Alertas de turnos",
      "route": "/asistencia/alertas",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 64,
      "networkIdleMs": 146,
      "requests": [
        {
          "method": "GET",
          "path": "/api/shifts/alerts",
          "statusCode": 200,
          "durationMs": 377
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Expandir hallazgos asociados de un grupo",
      "zone": "C. Alertas de turnos",
      "submodule": "C. Alertas de turnos",
      "route": "/asistencia/alertas",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 33,
      "networkIdleMs": 117,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Resolver alerta de turno",
      "zone": "C. Alertas de turnos",
      "submodule": "C. Alertas de turnos",
      "route": "/asistencia/alertas",
      "covered": false,
      "skippedReason": "Prohibido por defecto — cierra una alerta real.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Carga de horas (período actual)",
      "zone": "D. Carga de horas",
      "submodule": "D. Carga de horas",
      "route": "/horas",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 76,
      "networkIdleMs": 2280,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 369
        },
        {
          "method": "GET",
          "path": "/api/time-entries/summary",
          "statusCode": 200,
          "durationMs": 577
        },
        {
          "method": "GET",
          "path": "/api/time-entries/period-employees",
          "statusCode": 200,
          "durationMs": 768
        },
        {
          "method": "GET",
          "path": "/api/org-structure",
          "statusCode": 200,
          "durationMs": 1702
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": false
    },
    {
      "name": "Cambiar período (Carga de horas)",
      "zone": "D. Carga de horas",
      "submodule": "D. Carga de horas",
      "route": "/horas",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 44,
      "networkIdleMs": 127,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Buscar empleado (Carga de horas)",
      "zone": "D. Carga de horas",
      "submodule": "D. Carga de horas",
      "route": "/horas",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 17,
      "networkIdleMs": 419,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/summary",
          "statusCode": 200,
          "durationMs": 567
        },
        {
          "method": "GET",
          "path": "/api/time-entries/period-employees",
          "statusCode": 200,
          "durationMs": 761
        }
      ],
      "consoleErrors": [],
      "notes": [
        "término tomado de la primera fila real de la grilla — no se registra el valor buscado en este reporte"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Limpiar búsqueda (Carga de horas)",
      "zone": "D. Carga de horas",
      "submodule": "D. Carga de horas",
      "route": "/horas",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 35,
      "networkIdleMs": 438,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Abrir edición de horas de un empleado (navega a /horas/:id)",
      "zone": "D. Carga de horas",
      "submodule": "D. Carga de horas",
      "route": "/horas/:id",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 839,
      "networkIdleMs": 2220,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 179
        },
        {
          "method": "GET",
          "path": "/api/employees/:id/time-grid",
          "statusCode": 200,
          "durationMs": 659
        },
        {
          "method": "GET",
          "path": "/api/employees/:id/time-grid",
          "statusCode": 200,
          "durationMs": 661
        },
        {
          "method": "GET",
          "path": "/api/employees/:id/time-grid",
          "statusCode": 200,
          "durationMs": 666
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "statusCode": 200,
          "durationMs": 1380
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "statusCode": 200,
          "durationMs": 713
        },
        {
          "method": "GET",
          "path": "/api/novelty-types",
          "statusCode": 200,
          "durationMs": 1655
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Ver total real/liquidable",
      "zone": "D. Carga de horas",
      "submodule": "D. Carga de horas",
      "route": "/horas/:id",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 4,
      "networkIdleMs": 88,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "\"Horas trabajadas\" (total real) siempre presente; \"Valor liquidable\" sólo si el empleado tiene horas especiales adicionales este período — sin request propio, ya incluido en time-grid"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Abrir edición de hora sin guardar",
      "zone": "D. Carga de horas",
      "submodule": "D. Carga de horas",
      "route": "/horas/:id",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 46,
      "networkIdleMs": 129,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "se abrió el modal y se cerró sin guardar (modo lectura de esta etapa)"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cancelar edición de hora",
      "zone": "D. Carga de horas",
      "submodule": "D. Carga de horas",
      "route": "/horas/:id",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 41,
      "networkIdleMs": 125,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Abrir conceptos adicionales sin guardar",
      "zone": "D. Carga de horas",
      "submodule": "D. Carga de horas",
      "route": "/horas/:id",
      "covered": false,
      "skippedReason": "no se encontró el disparador de este modal en el estado actual del entorno",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cancelar conceptos adicionales",
      "zone": "D. Carga de horas",
      "submodule": "D. Carga de horas",
      "route": "/horas/:id",
      "covered": false,
      "skippedReason": "depende de la acción anterior, salteada",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Volver a Carga de horas",
      "zone": "D. Carga de horas",
      "submodule": "D. Carga de horas",
      "route": "/horas",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 70,
      "networkIdleMs": 152,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/period-employees",
          "statusCode": 200,
          "durationMs": 2
        },
        {
          "method": "GET",
          "path": "/api/time-entries/summary",
          "statusCode": 200,
          "durationMs": 2
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Guardar hora / Guardar desglose manual / Enviar a revisión",
      "zone": "D. Carga de horas",
      "submodule": "D. Carga de horas",
      "route": "/horas",
      "covered": false,
      "skippedReason": "Prohibido por defecto — cargaría horas reales, posiblemente asociadas a liquidación.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Exportar horas",
      "zone": "D. Carga de horas",
      "submodule": "D. Carga de horas",
      "route": "/horas",
      "covered": false,
      "skippedReason": "El endpoint es GET, pero el click dispara una descarga de archivo con datos de horas — prohibido por defecto (Parte 4: no generar exportación sensible / no descarga por defecto).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Cierres mensuales (período actual)",
      "zone": "E. Cierres mensuales",
      "submodule": "E. Cierres mensuales",
      "route": "/cierres",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 76,
      "networkIdleMs": 950,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 343
        },
        {
          "method": "GET",
          "path": "/api/workforce/corrections",
          "statusCode": 200,
          "durationMs": 347
        },
        {
          "method": "GET",
          "path": "/api/workforce/closures",
          "statusCode": 200,
          "durationMs": 380
        },
        {
          "method": "GET",
          "path": "/api/employees/options",
          "statusCode": 200,
          "durationMs": 382
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cambiar período (Cierres mensuales)",
      "zone": "E. Cierres mensuales",
      "submodule": "E. Cierres mensuales",
      "route": "/cierres",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 15,
      "networkIdleMs": 98,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Aprobar seleccionados / Enviar cierre a RH / Devolver cierre",
      "zone": "E. Cierres mensuales",
      "submodule": "E. Cierres mensuales",
      "route": "/cierres",
      "covered": false,
      "skippedReason": "Prohibido por defecto — cierra/reabre un período real de liquidación.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Aprobar/Rechazar corrección",
      "zone": "E. Cierres mensuales",
      "submodule": "E. Cierres mensuales",
      "route": "/cierres",
      "covered": false,
      "skippedReason": "Prohibido por defecto.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Bandeja de revisión (Por registro)",
      "zone": "F. Bandeja de revisión",
      "submodule": "F. Bandeja de revisión",
      "route": "/pendientes",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 75,
      "networkIdleMs": 943,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/summary",
          "statusCode": 200,
          "durationMs": 2
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 175
        },
        {
          "method": "GET",
          "path": "/api/time-entries",
          "statusCode": 200,
          "durationMs": 370
        },
        {
          "method": "GET",
          "path": "/api/pending",
          "statusCode": 200,
          "durationMs": 378
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": true
    },
    {
      "name": "Cambiar a pestaña \"Por persona\"",
      "zone": "F. Bandeja de revisión",
      "submodule": "F. Bandeja de revisión",
      "route": "/pendientes",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 28,
      "networkIdleMs": 112,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Buscar en Bandeja de revisión",
      "zone": "F. Bandeja de revisión",
      "submodule": "F. Bandeja de revisión",
      "route": "/pendientes",
      "covered": false,
      "skippedReason": "no hay ninguna fila en Bandeja de revisión en el entorno actual para tomar un término real de búsqueda",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cambiar período (Bandeja de revisión)",
      "zone": "F. Bandeja de revisión",
      "submodule": "F. Bandeja de revisión",
      "route": "/pendientes",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 1305,
      "networkIdleMs": 1389,
      "requests": [
        {
          "method": "GET",
          "path": "/api/pending",
          "statusCode": 200,
          "durationMs": 916
        },
        {
          "method": "GET",
          "path": "/api/time-entries",
          "statusCode": 200,
          "durationMs": 1088
        },
        {
          "method": "GET",
          "path": "/api/time-entries/summary",
          "statusCode": 200,
          "durationMs": 1102
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Abrir detalle (Ver detalle, Por persona)",
      "zone": "F. Bandeja de revisión",
      "submodule": "F. Bandeja de revisión",
      "route": "/pendientes",
      "covered": false,
      "skippedReason": "no hay ninguna fila en la vista Por persona en el entorno actual, o la pestaña no está disponible",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Volver a Bandeja de revisión",
      "zone": "F. Bandeja de revisión",
      "submodule": "F. Bandeja de revisión",
      "route": "/pendientes",
      "covered": false,
      "skippedReason": "depende de la acción anterior, salteada",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Aprobar/Rechazar/Devolver registro",
      "zone": "F. Bandeja de revisión",
      "submodule": "F. Bandeja de revisión",
      "route": "/pendientes",
      "covered": false,
      "skippedReason": "Prohibido por defecto.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Aprobar/Rechazar novedad (desde Bandeja)",
      "zone": "F. Bandeja de revisión",
      "submodule": "F. Bandeja de revisión",
      "route": "/pendientes",
      "covered": false,
      "skippedReason": "Prohibido por defecto.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Aprobar/Rechazar/Devolver desglose manual",
      "zone": "F. Bandeja de revisión",
      "submodule": "F. Bandeja de revisión",
      "route": "/pendientes",
      "covered": false,
      "skippedReason": "Prohibido por defecto.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Novedades",
      "zone": "G. Novedades",
      "submodule": "G. Novedades",
      "route": "/novedades",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 71,
      "networkIdleMs": 1744,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 180
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "statusCode": 200,
          "durationMs": 1184
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "statusCode": 200,
          "durationMs": 1186
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Buscar en Novedades",
      "zone": "G. Novedades",
      "submodule": "G. Novedades",
      "route": "/novedades",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 12,
      "networkIdleMs": 416,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "término tomado de una novedad real — no se registra el valor buscado en este reporte"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Abrir modal \"Nueva novedad\" sin guardar",
      "zone": "G. Novedades",
      "submodule": "G. Novedades",
      "route": "/novedades",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 27,
      "networkIdleMs": 109,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "se abrió el modal y se cerró sin guardar (modo lectura de esta etapa)"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cancelar \"Nueva novedad\"",
      "zone": "G. Novedades",
      "submodule": "G. Novedades",
      "route": "/novedades",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 35,
      "networkIdleMs": 117,
      "requests": [
        {
          "method": "GET",
          "path": "/api/hour-concepts",
          "statusCode": 200,
          "durationMs": 371
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Guardar nueva novedad",
      "zone": "G. Novedades",
      "submodule": "G. Novedades",
      "route": "/novedades",
      "covered": false,
      "skippedReason": "Prohibido por defecto — crearía una novedad real (licencia/ausencia) para un empleado real.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Aprobar/Rechazar/Eliminar novedad",
      "zone": "G. Novedades",
      "submodule": "G. Novedades",
      "route": "/novedades",
      "covered": false,
      "skippedReason": "Prohibido por defecto.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Aprobar pendientes visibles (bulk)",
      "zone": "G. Novedades",
      "submodule": "G. Novedades",
      "route": "/novedades",
      "covered": false,
      "skippedReason": "Prohibido por defecto.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Notificaciones (Todas)",
      "zone": "H. Notificaciones",
      "submodule": "H. Notificaciones",
      "route": "/notificaciones",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 76,
      "networkIdleMs": 931,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 176
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications",
          "statusCode": 200,
          "durationMs": 370
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Filtrar por \"No leídas\"",
      "zone": "H. Notificaciones",
      "submodule": "H. Notificaciones",
      "route": "/notificaciones",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 18,
      "networkIdleMs": 102,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cargar más notificaciones",
      "zone": "H. Notificaciones",
      "submodule": "H. Notificaciones",
      "route": "/notificaciones",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 26,
      "networkIdleMs": 109,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications",
          "statusCode": 200,
          "durationMs": 557
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Marcar como leída / Ver detalle",
      "zone": "H. Notificaciones",
      "submodule": "H. Notificaciones",
      "route": "/notificaciones",
      "covered": false,
      "skippedReason": "Prohibido por defecto — ambos disparan POST /workforce/notifications/:id/read (el link \"Ver detalle\" también, como efecto colateral de su onClick).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Fichador (carga inicial)",
      "zone": "I. Fichador",
      "submodule": "I. Fichador",
      "route": "/fichador",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 52,
      "networkIdleMs": 877,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 348
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Buscar empleado en Fichador",
      "zone": "I. Fichador",
      "submodule": "I. Fichador",
      "route": "/fichador",
      "covered": false,
      "skippedReason": "Fuera del alcance mínimo pedido para Fichador (Parte 6, Zona I sólo pide \"entrar\" y \"medir carga inicial\", dado el perfil de riesgo del kiosco: sin auth de usuario, cámara, rate-limit compartido con uso real de 30/5min).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Marcar ingreso",
      "zone": "I. Fichador",
      "submodule": "I. Fichador",
      "route": "/fichador",
      "covered": false,
      "skippedReason": "Prohibido por defecto — fichada real de un empleado real.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Marcar salida",
      "zone": "I. Fichador",
      "submodule": "I. Fichador",
      "route": "/fichador",
      "covered": false,
      "skippedReason": "Prohibido por defecto.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Capturar foto / enviar punch",
      "zone": "I. Fichador",
      "submodule": "I. Fichador",
      "route": "/fichador",
      "covered": false,
      "skippedReason": "Prohibido por defecto — el pedido prohíbe explícitamente aceptar permisos de cámara o ejecutar la acción.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Exportación (período actual)",
      "zone": "J. Exportación",
      "submodule": "J. Exportación",
      "route": "/configuracion/liquidacion",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 74,
      "networkIdleMs": 2279,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 183
        },
        {
          "method": "GET",
          "path": "/api/finnegans-export/novelties",
          "statusCode": 200,
          "durationMs": 1277
        },
        {
          "method": "GET",
          "path": "/api/finnegans-export/novelties",
          "statusCode": 200,
          "durationMs": 1718
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": true
    },
    {
      "name": "Cambiar período (Exportación)",
      "zone": "J. Exportación",
      "submodule": "J. Exportación",
      "route": "/configuracion/liquidacion",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 803,
      "networkIdleMs": 888,
      "requests": [
        {
          "method": "GET",
          "path": "/api/finnegans-export/novelties",
          "statusCode": 200,
          "durationMs": 430
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Buscar en Exportación",
      "zone": "J. Exportación",
      "submodule": "J. Exportación",
      "route": "/configuracion/liquidacion",
      "covered": false,
      "skippedReason": "no hay ningún registro para el período elegido en el entorno actual",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Exportar Excel Finnegans",
      "zone": "J. Exportación",
      "submodule": "J. Exportación",
      "route": "/configuracion/liquidacion",
      "covered": false,
      "skippedReason": "No es una escritura de API (build 100% client-side), pero genera y descarga un archivo con datos de novedades reales — prohibido por defecto (Parte 4: no generar exportación sensible / no descarga por defecto).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    }
  ],
  "slowestRequests": [
    {
      "method": "GET",
      "path": "/api/dashboard/metrics",
      "statusCode": 200,
      "durationMs": 4034
    },
    {
      "method": "GET",
      "path": "/api/audit",
      "statusCode": 200,
      "durationMs": 3283
    },
    {
      "method": "GET",
      "path": "/api/finnegans-export/novelties",
      "statusCode": 200,
      "durationMs": 1718
    },
    {
      "method": "GET",
      "path": "/api/org-structure",
      "statusCode": 200,
      "durationMs": 1702
    },
    {
      "method": "GET",
      "path": "/api/time-entries/attendance",
      "statusCode": 200,
      "durationMs": 1660
    },
    {
      "method": "GET",
      "path": "/api/novelty-types",
      "statusCode": 200,
      "durationMs": 1655
    },
    {
      "method": "GET",
      "path": "/api/time-entries/home-summary",
      "statusCode": 200,
      "durationMs": 1572
    },
    {
      "method": "GET",
      "path": "/api/novelties",
      "statusCode": 200,
      "durationMs": 1380
    },
    {
      "method": "GET",
      "path": "/api/finnegans-export/novelties",
      "statusCode": 200,
      "durationMs": 1277
    },
    {
      "method": "GET",
      "path": "/api/novelties",
      "statusCode": 200,
      "durationMs": 1186
    }
  ],
  "slowestActions": [
    {
      "name": "Login (acceso rápido RRHH)",
      "zone": "Login",
      "visibleMs": 536,
      "networkIdleMs": 6235
    },
    {
      "name": "Entrar a Carga de horas (período actual)",
      "zone": "D. Carga de horas",
      "visibleMs": 76,
      "networkIdleMs": 2280
    },
    {
      "name": "Entrar a Exportación (período actual)",
      "zone": "J. Exportación",
      "visibleMs": 74,
      "networkIdleMs": 2279
    },
    {
      "name": "Entrar a Asistencia (carga inicial del día)",
      "zone": "B. Asistencia",
      "visibleMs": 83,
      "networkIdleMs": 2229
    },
    {
      "name": "Abrir edición de horas de un empleado (navega a /horas/:id)",
      "zone": "D. Carga de horas",
      "visibleMs": 839,
      "networkIdleMs": 2220
    },
    {
      "name": "Entrar a Inicio (Gestión horaria)",
      "zone": "A. Inicio",
      "visibleMs": 87,
      "networkIdleMs": 2146
    },
    {
      "name": "Entrar a Novedades",
      "zone": "G. Novedades",
      "visibleMs": 71,
      "networkIdleMs": 1744
    },
    {
      "name": "Cambiar período (Bandeja de revisión)",
      "zone": "F. Bandeja de revisión",
      "visibleMs": 1305,
      "networkIdleMs": 1389
    },
    {
      "name": "Entrar a Alertas de turnos",
      "zone": "C. Alertas de turnos",
      "visibleMs": 65,
      "networkIdleMs": 1106
    },
    {
      "name": "Entrar a Cierres mensuales (período actual)",
      "zone": "E. Cierres mensuales",
      "visibleMs": 76,
      "networkIdleMs": 950
    }
  ],
  "repeatedEndpoints": [
    {
      "key": "GET /api/workforce/notifications-unread-count",
      "method": "GET",
      "path": "/api/workforce/notifications-unread-count",
      "count": 12,
      "avgDurationMs": 310,
      "maxDurationMs": 696,
      "statusCodes": [
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/time-entries/attendance/observations",
      "method": "GET",
      "path": "/api/time-entries/attendance/observations",
      "count": 3,
      "avgDurationMs": 568,
      "maxDurationMs": 936,
      "statusCodes": [
        200,
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/time-entries/attendance",
      "method": "GET",
      "path": "/api/time-entries/attendance",
      "count": 2,
      "avgDurationMs": 1288,
      "maxDurationMs": 1660,
      "statusCodes": [
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/shifts/alerts",
      "method": "GET",
      "path": "/api/shifts/alerts",
      "count": 3,
      "avgDurationMs": 501,
      "maxDurationMs": 568,
      "statusCodes": [
        200,
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/time-entries/summary",
      "method": "GET",
      "path": "/api/time-entries/summary",
      "count": 5,
      "avgDurationMs": 450,
      "maxDurationMs": 1102,
      "statusCodes": [
        200,
        200,
        200,
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/time-entries/period-employees",
      "method": "GET",
      "path": "/api/time-entries/period-employees",
      "count": 3,
      "avgDurationMs": 510,
      "maxDurationMs": 768,
      "statusCodes": [
        200,
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/employees/:id/time-grid",
      "method": "GET",
      "path": "/api/employees/:id/time-grid",
      "count": 3,
      "avgDurationMs": 662,
      "maxDurationMs": 666,
      "statusCodes": [
        200,
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/novelties",
      "method": "GET",
      "path": "/api/novelties",
      "count": 4,
      "avgDurationMs": 1116,
      "maxDurationMs": 1380,
      "statusCodes": [
        200,
        200,
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/time-entries",
      "method": "GET",
      "path": "/api/time-entries",
      "count": 2,
      "avgDurationMs": 729,
      "maxDurationMs": 1088,
      "statusCodes": [
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/pending",
      "method": "GET",
      "path": "/api/pending",
      "count": 2,
      "avgDurationMs": 647,
      "maxDurationMs": 916,
      "statusCodes": [
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/workforce/notifications",
      "method": "GET",
      "path": "/api/workforce/notifications",
      "count": 2,
      "avgDurationMs": 464,
      "maxDurationMs": 557,
      "statusCodes": [
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/finnegans-export/novelties",
      "method": "GET",
      "path": "/api/finnegans-export/novelties",
      "count": 3,
      "avgDurationMs": 1142,
      "maxDurationMs": 1718,
      "statusCodes": [
        200,
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    }
  ],
  "duplicatesByAction": [
    {
      "name": "Abrir edición de horas de un empleado (navega a /horas/:id)",
      "zone": "D. Carga de horas",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/employees/:id/time-grid",
          "count": 3,
          "durationsMs": [
            659,
            661,
            666
          ]
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "count": 2,
          "durationsMs": [
            1380,
            713
          ]
        }
      ]
    },
    {
      "name": "Entrar a Novedades",
      "zone": "G. Novedades",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/novelties",
          "count": 2,
          "durationsMs": [
            1184,
            1186
          ]
        }
      ]
    },
    {
      "name": "Entrar a Exportación (período actual)",
      "zone": "J. Exportación",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/finnegans-export/novelties",
          "count": 2,
          "durationsMs": [
            1277,
            1718
          ]
        }
      ]
    }
  ],
  "coverageGaps": [
    {
      "name": "Abrir detalle de tramos de una jornada cerrada",
      "zone": "B. Asistencia",
      "isWrite": false,
      "reason": "no se encontró el disparador de este modal en el estado actual del entorno"
    },
    {
      "name": "Cerrar detalle de tramos",
      "zone": "B. Asistencia",
      "isWrite": false,
      "reason": "depende de la acción anterior, salteada"
    },
    {
      "name": "Cerrar jornada manualmente / Marcar olvido de salida / Observar jornada",
      "zone": "B. Asistencia",
      "isWrite": true,
      "reason": "Prohibido por defecto (Parte 4 del pedido) — modifica jornadas reales de asistencia."
    },
    {
      "name": "Resolver problema de fichada",
      "zone": "B. Asistencia",
      "isWrite": true,
      "reason": "Prohibido por defecto — cierra un caso de revisión real."
    },
    {
      "name": "Resolver alerta de turno",
      "zone": "C. Alertas de turnos",
      "isWrite": true,
      "reason": "Prohibido por defecto — cierra una alerta real."
    },
    {
      "name": "Abrir conceptos adicionales sin guardar",
      "zone": "D. Carga de horas",
      "isWrite": false,
      "reason": "no se encontró el disparador de este modal en el estado actual del entorno"
    },
    {
      "name": "Cancelar conceptos adicionales",
      "zone": "D. Carga de horas",
      "isWrite": false,
      "reason": "depende de la acción anterior, salteada"
    },
    {
      "name": "Guardar hora / Guardar desglose manual / Enviar a revisión",
      "zone": "D. Carga de horas",
      "isWrite": true,
      "reason": "Prohibido por defecto — cargaría horas reales, posiblemente asociadas a liquidación."
    },
    {
      "name": "Exportar horas",
      "zone": "D. Carga de horas",
      "isWrite": false,
      "reason": "El endpoint es GET, pero el click dispara una descarga de archivo con datos de horas — prohibido por defecto (Parte 4: no generar exportación sensible / no descarga por defecto)."
    },
    {
      "name": "Aprobar seleccionados / Enviar cierre a RH / Devolver cierre",
      "zone": "E. Cierres mensuales",
      "isWrite": true,
      "reason": "Prohibido por defecto — cierra/reabre un período real de liquidación."
    },
    {
      "name": "Aprobar/Rechazar corrección",
      "zone": "E. Cierres mensuales",
      "isWrite": true,
      "reason": "Prohibido por defecto."
    },
    {
      "name": "Buscar en Bandeja de revisión",
      "zone": "F. Bandeja de revisión",
      "isWrite": false,
      "reason": "no hay ninguna fila en Bandeja de revisión en el entorno actual para tomar un término real de búsqueda"
    },
    {
      "name": "Abrir detalle (Ver detalle, Por persona)",
      "zone": "F. Bandeja de revisión",
      "isWrite": false,
      "reason": "no hay ninguna fila en la vista Por persona en el entorno actual, o la pestaña no está disponible"
    },
    {
      "name": "Volver a Bandeja de revisión",
      "zone": "F. Bandeja de revisión",
      "isWrite": false,
      "reason": "depende de la acción anterior, salteada"
    },
    {
      "name": "Aprobar/Rechazar/Devolver registro",
      "zone": "F. Bandeja de revisión",
      "isWrite": true,
      "reason": "Prohibido por defecto."
    },
    {
      "name": "Aprobar/Rechazar novedad (desde Bandeja)",
      "zone": "F. Bandeja de revisión",
      "isWrite": true,
      "reason": "Prohibido por defecto."
    },
    {
      "name": "Aprobar/Rechazar/Devolver desglose manual",
      "zone": "F. Bandeja de revisión",
      "isWrite": true,
      "reason": "Prohibido por defecto."
    },
    {
      "name": "Guardar nueva novedad",
      "zone": "G. Novedades",
      "isWrite": true,
      "reason": "Prohibido por defecto — crearía una novedad real (licencia/ausencia) para un empleado real."
    },
    {
      "name": "Aprobar/Rechazar/Eliminar novedad",
      "zone": "G. Novedades",
      "isWrite": true,
      "reason": "Prohibido por defecto."
    },
    {
      "name": "Aprobar pendientes visibles (bulk)",
      "zone": "G. Novedades",
      "isWrite": true,
      "reason": "Prohibido por defecto."
    },
    {
      "name": "Marcar como leída / Ver detalle",
      "zone": "H. Notificaciones",
      "isWrite": true,
      "reason": "Prohibido por defecto — ambos disparan POST /workforce/notifications/:id/read (el link \"Ver detalle\" también, como efecto colateral de su onClick)."
    },
    {
      "name": "Buscar empleado en Fichador",
      "zone": "I. Fichador",
      "isWrite": false,
      "reason": "Fuera del alcance mínimo pedido para Fichador (Parte 6, Zona I sólo pide \"entrar\" y \"medir carga inicial\", dado el perfil de riesgo del kiosco: sin auth de usuario, cámara, rate-limit compartido con uso real de 30/5min)."
    },
    {
      "name": "Marcar ingreso",
      "zone": "I. Fichador",
      "isWrite": true,
      "reason": "Prohibido por defecto — fichada real de un empleado real."
    },
    {
      "name": "Marcar salida",
      "zone": "I. Fichador",
      "isWrite": true,
      "reason": "Prohibido por defecto."
    },
    {
      "name": "Capturar foto / enviar punch",
      "zone": "I. Fichador",
      "isWrite": true,
      "reason": "Prohibido por defecto — el pedido prohíbe explícitamente aceptar permisos de cámara o ejecutar la acción."
    },
    {
      "name": "Buscar en Exportación",
      "zone": "J. Exportación",
      "isWrite": false,
      "reason": "no hay ningún registro para el período elegido en el entorno actual"
    },
    {
      "name": "Exportar Excel Finnegans",
      "zone": "J. Exportación",
      "isWrite": false,
      "reason": "No es una escritura de API (build 100% client-side), pero genera y descarga un archivo con datos de novedades reales — prohibido por defecto (Parte 4: no generar exportación sensible / no descarga por defecto)."
    }
  ]
}
```
