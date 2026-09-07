# Performance Journey — Gestión horaria (Etapa 14G.1)

Reporte generado automáticamente por `npm run perf:journey:workforce`. No editar a mano — se sobreescribe en cada corrida.

**Etapa de diagnóstico/medición — no de optimización.** Ningún hallazgo de este reporte se corrigió en esta etapa; ver §15 para el orden recomendado de 14G.2 en adelante.

## 1. Resumen ejecutivo

Recorrido macro de los 10 submódulos de Gestión horaria: 38/65 acciones cubiertas, 27 salteadas (16 de ellas por ser de escritura, con motivo documentado cada una), 0 respuestas HTTP >= 400, 0 errores de consola. 1 acción(es) en rango Crítico (> 3000ms) y 2 en rango Lento (2000-3000ms). Cero escrituras ejecutadas — modo `read-only` en todo el recorrido.

## 2. Ambiente

- Generado: 2026-09-07T18:01:17.924Z
- Frontend: http://localhost:5174
- Backend: http://localhost:4002/api
- Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.
- Usuario: Nivel 1 - RRHH (acceso rápido demo — credenciales en docs/LOCAL_DEVELOPMENT.md, no se repiten en este reporte)
- Comando: `npm run perf:journey:workforce (desde frontend/)`

## 3. Cobertura general

| Submódulo | Acciones cubiertas | Acciones salteadas | Requests capturadas | Peor duración | Rango |
|---|---|---|---|---|---|
| Login | 1 | 0 | 4 | 3569ms | Crítico |
| A. Inicio | 2 | 0 | 3 | 1118ms | Medio |
| B. Asistencia | 5 | 4 | 10 | 2055ms | Lento |
| C. Alertas de turnos | 6 | 1 | 4 | 1092ms | Medio |
| D. Carga de horas | 9 | 4 | 16 | 1845ms | Medio |
| E. Cierres mensuales | 2 | 2 | 6 | 1381ms | Medio |
| F. Bandeja de revisión | 3 | 6 | 7 | 1896ms | Medio |
| G. Novedades | 4 | 3 | 4 | 1715ms | Medio |
| H. Notificaciones | 3 | 1 | 4 | 2760ms | Lento |
| I. Fichador | 1 | 4 | 1 | 719ms | OK |
| J. Exportación | 2 | 2 | 4 | 1643ms | Medio |

## 4. Tabla de acciones

| Acción | Submódulo | Ruta | Visible | Network idle | Requests | Errores consola | Escritura |
|---|---|---|---|---|---|---|---|
| Login (acceso rápido RRHH) | Login | `/` | 308ms | 3569ms | 4 | 0 | No |
| Entrar a Inicio (Gestión horaria) | A. Inicio | `/gestion-horaria` | 86ms | 1118ms | 3 | 0 | No |
| Ver KPIs/resumen de Inicio | A. Inicio | `/gestion-horaria` | 3ms | 88ms | 0 | 0 | No |
| Entrar a Asistencia (carga inicial del día) | B. Asistencia | `/asistencia` | 84ms | 2055ms | 5 | 0 | No |
| Cambiar fecha del día | B. Asistencia | `/asistencia` | 26ms | 109ms | 0 | 0 | No |
| Buscar en problemas de fichada | B. Asistencia | `/asistencia` | 23ms | 426ms | 1 | 0 | No |
| Filtrar problemas de fichada por tipo | B. Asistencia | `/asistencia` | 24ms | 106ms | 1 | 0 | No |
| Limpiar filtros de problemas de fichada | B. Asistencia | `/asistencia` | 24ms | 106ms | 3 | 0 | No |
| Entrar a Alertas de turnos | C. Alertas de turnos | `/asistencia/alertas` | 68ms | 1092ms | 2 | 0 | No |
| Buscar alerta por texto | C. Alertas de turnos | `/asistencia/alertas` | 16ms | 420ms | 0 | 0 | No |
| Limpiar búsqueda de alertas | C. Alertas de turnos | `/asistencia/alertas` | 23ms | 427ms | 1 | 0 | No |
| Filtrar alertas por tipo | C. Alertas de turnos | `/asistencia/alertas` | 16ms | 101ms | 0 | 0 | No |
| Limpiar filtros de alertas | C. Alertas de turnos | `/asistencia/alertas` | 52ms | 136ms | 1 | 0 | No |
| Expandir hallazgos asociados de un grupo | C. Alertas de turnos | `/asistencia/alertas` | 34ms | 117ms | 0 | 0 | No |
| Entrar a Carga de horas (período actual) | D. Carga de horas | `/horas` | 80ms | 1349ms | 4 | 0 | No |
| Cambiar período (Carga de horas) | D. Carga de horas | `/horas` | 48ms | 129ms | 0 | 0 | No |
| Buscar empleado (Carga de horas) | D. Carga de horas | `/horas` | 19ms | 422ms | 2 | 0 | No |
| Limpiar búsqueda (Carga de horas) | D. Carga de horas | `/horas` | 35ms | 436ms | 1 | 0 | No |
| Abrir edición de horas de un empleado (navega a /horas/:id) | D. Carga de horas | `/horas/:id` | 831ms | 1845ms | 7 | 0 | No |
| Ver total real/liquidable | D. Carga de horas | `/horas/:id` | 8ms | 92ms | 0 | 0 | No |
| Abrir edición de hora sin guardar | D. Carga de horas | `/horas/:id` | 57ms | 140ms | 0 | 0 | No |
| Cancelar edición de hora | D. Carga de horas | `/horas/:id` | 35ms | 119ms | 0 | 0 | No |
| Volver a Carga de horas | D. Carga de horas | `/horas` | 80ms | 161ms | 2 | 0 | No |
| Entrar a Cierres mensuales (período actual) | E. Cierres mensuales | `/cierres` | 64ms | 1381ms | 6 | 0 | No |
| Cambiar período (Cierres mensuales) | E. Cierres mensuales | `/cierres` | 16ms | 99ms | 0 | 0 | No |
| Entrar a Bandeja de revisión (Por registro) | F. Bandeja de revisión | `/pendientes` | 83ms | 1672ms | 4 | 0 | No |
| Cambiar a pestaña "Por persona" | F. Bandeja de revisión | `/pendientes` | 24ms | 107ms | 0 | 0 | No |
| Cambiar período (Bandeja de revisión) | F. Bandeja de revisión | `/pendientes` | 1812ms | 1896ms | 3 | 0 | No |
| Entrar a Novedades | G. Novedades | `/novedades` | 70ms | 1715ms | 3 | 0 | No |
| Buscar en Novedades | G. Novedades | `/novedades` | 12ms | 417ms | 0 | 0 | No |
| Abrir modal "Nueva novedad" sin guardar | G. Novedades | `/novedades` | 33ms | 115ms | 0 | 0 | No |
| Cancelar "Nueva novedad" | G. Novedades | `/novedades` | 39ms | 121ms | 1 | 0 | No |
| Entrar a Notificaciones (Todas) | H. Notificaciones | `/notificaciones` | 79ms | 2760ms | 3 | 0 | No |
| Filtrar por "No leídas" | H. Notificaciones | `/notificaciones` | 18ms | 101ms | 0 | 0 | No |
| Cargar más notificaciones | H. Notificaciones | `/notificaciones` | 19ms | 103ms | 1 | 0 | No |
| Entrar a Fichador (carga inicial) | I. Fichador | `/fichador` | 71ms | 719ms | 1 | 0 | No |
| Entrar a Exportación (período actual) | J. Exportación | `/configuracion/liquidacion` | 75ms | 1643ms | 3 | 0 | No |
| Cambiar período (Exportación) | J. Exportación | `/configuracion/liquidacion` | 805ms | 889ms | 1 | 0 | No |

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
| Login (acceso rápido RRHH) | Login | 308ms | 3569ms | Crítico |
| Entrar a Notificaciones (Todas) | H. Notificaciones | 79ms | 2760ms | Lento |
| Entrar a Asistencia (carga inicial del día) | B. Asistencia | 84ms | 2055ms | Lento |
| Cambiar período (Bandeja de revisión) | F. Bandeja de revisión | 1812ms | 1896ms | Medio |
| Abrir edición de horas de un empleado (navega a /horas/:id) | D. Carga de horas | 831ms | 1845ms | Medio |
| Entrar a Novedades | G. Novedades | 70ms | 1715ms | Medio |
| Entrar a Bandeja de revisión (Por registro) | F. Bandeja de revisión | 83ms | 1672ms | Medio |
| Entrar a Exportación (período actual) | J. Exportación | 75ms | 1643ms | Medio |
| Entrar a Cierres mensuales (período actual) | E. Cierres mensuales | 64ms | 1381ms | Medio |
| Entrar a Carga de horas (período actual) | D. Carga de horas | 80ms | 1349ms | Medio |

## 8. Top requests lentas

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications` | 200 | 2196ms |
| GET | `/api/time-entries` | 200 | 2112ms |
| GET | `/api/dashboard/metrics` | 200 | 1630ms |
| GET | `/api/time-entries/attendance` | 200 | 1486ms |
| GET | `/api/time-entries/summary` | 200 | 1409ms |
| GET | `/api/pending` | 200 | 1397ms |
| GET | `/api/time-entries/attendance` | 200 | 1305ms |
| GET | `/api/workforce/notifications` | 200 | 1262ms |
| GET | `/api/novelties` | 200 | 1156ms |
| GET | `/api/novelties` | 200 | 1154ms |

## 9. Endpoints repetidos

Mismo endpoint (método+path) pedido más de una vez a lo largo de TODO el recorrido, sin importar desde qué submódulo — detecta catálogos/endpoints compartidos entre submódulos (ítem 13 de la Parte 6 del pedido).

| Endpoint | Llamadas totales |
|---|---|
| `GET /api/workforce/notifications-unread-count` | 12 |
| `GET /api/time-entries/attendance/observations` | 6 |
| `GET /api/time-entries/summary` | 5 |
| `GET /api/time-entries/period-employees` | 4 |
| `GET /api/novelties` | 4 |
| `GET /api/time-entries/attendance` | 3 |
| `GET /api/shifts/alerts` | 3 |
| `GET /api/employees/:id/time-grid` | 3 |
| `GET /api/workforce/notifications` | 3 |
| `GET /api/finnegans-export/novelties` | 3 |
| `GET /api/time-entries/home-summary` | 2 |
| `GET /api/workforce/corrections` | 2 |
| `GET /api/workforce/closures` | 2 |
| `GET /api/pending` | 2 |
| `GET /api/time-entries` | 2 |

## 10. Duplicados por acción

Mismo endpoint pedido más de una vez DENTRO de la ventana de una sola acción — señal de StrictMode (double-invoke en dev) o de un remount/refetch inesperado (ítems 1-2 de la Parte 6 del pedido).

- **Entrar a Inicio (Gestión horaria)** (A. Inicio): `GET /api/time-entries/home-summary` x2
- **Entrar a Asistencia (carga inicial del día)** (B. Asistencia): `GET /api/time-entries/attendance/observations` x2, `GET /api/time-entries/attendance` x2
- **Limpiar filtros de problemas de fichada** (B. Asistencia): `GET /api/time-entries/attendance/observations` x3
- **Abrir edición de horas de un empleado (navega a /horas/:id)** (D. Carga de horas): `GET /api/employees/:id/time-grid` x3, `GET /api/novelties` x2
- **Entrar a Cierres mensuales (período actual)** (E. Cierres mensuales): `GET /api/workforce/corrections` x2, `GET /api/workforce/closures` x2
- **Entrar a Novedades** (G. Novedades): `GET /api/novelties` x2
- **Entrar a Notificaciones (Todas)** (H. Notificaciones): `GET /api/workforce/notifications` x2
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

Submódulos ordenados por cantidad de endpoints Crítico/Lento detectados en este recorrido (desempate por la duración máxima observada):

| Orden | Submódulo | Endpoints Crítico | Endpoints Lento | Duración máxima |
|---|---|---|---|---|
| 1 | H. Notificaciones | 0 | 1 | 2196ms |
| 2 | F. Bandeja de revisión | 0 | 1 | 2112ms |
| 3 | B. Asistencia | 0 | 0 | 1486ms |
| 4 | G. Novedades | 0 | 0 | 1156ms |
| 5 | J. Exportación | 0 | 0 | 1083ms |
| 6 | D. Carga de horas | 0 | 0 | 1067ms |
| 7 | E. Cierres mensuales | 0 | 0 | 832ms |
| 8 | C. Alertas de turnos | 0 | 0 | 644ms |
| 9 | A. Inicio | 0 | 0 | 546ms |
| 10 | I. Fichador | 0 | 0 | 172ms |

Contexto histórico relevante para esta priorización (no medido por este journey, ya documentado en etapas previas):
- `GET /shifts/alerts` (Alertas de turnos) fue medido en 3906ms (Crítico) por el journey general 14B.3 y nunca se revisó desde entonces.
- `findManyByEmployeeGrouped` (Bandeja de revisión, vista "Por persona") usa el mismo antipatrón `$transaction` ya corregido en otros endpoints por 14C.2 — documentado 2 veces como pendiente, nunca corregido.
- `GET /workforce/closures` y `GET /workforce/corrections` (Cierres mensuales) nunca fueron medidos por ningún journey anterior a 14G.1.
- Fichador queda deliberadamente fuera de cualquier ranking de optimización — ver `docs/PERFORMANCE_STANDARDS.md` §10 (categoría crítica D, no optimizar sin etapa dedicada).

## 16. Raw sanitized JSON

Idéntico al archivo `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json` generado en esta misma corrida.

```json
{
  "generatedAt": "2026-09-07T18:01:17.924Z",
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
    "slowActions": 2,
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
      "maxDurationMs": 3569,
      "rank": "Crítico"
    },
    {
      "zone": "A. Inicio",
      "coveredActions": 2,
      "skippedActions": 0,
      "totalRequests": 3,
      "maxDurationMs": 1118,
      "rank": "Medio"
    },
    {
      "zone": "B. Asistencia",
      "coveredActions": 5,
      "skippedActions": 4,
      "totalRequests": 10,
      "maxDurationMs": 2055,
      "rank": "Lento"
    },
    {
      "zone": "C. Alertas de turnos",
      "coveredActions": 6,
      "skippedActions": 1,
      "totalRequests": 4,
      "maxDurationMs": 1092,
      "rank": "Medio"
    },
    {
      "zone": "D. Carga de horas",
      "coveredActions": 9,
      "skippedActions": 4,
      "totalRequests": 16,
      "maxDurationMs": 1845,
      "rank": "Medio"
    },
    {
      "zone": "E. Cierres mensuales",
      "coveredActions": 2,
      "skippedActions": 2,
      "totalRequests": 6,
      "maxDurationMs": 1381,
      "rank": "Medio"
    },
    {
      "zone": "F. Bandeja de revisión",
      "coveredActions": 3,
      "skippedActions": 6,
      "totalRequests": 7,
      "maxDurationMs": 1896,
      "rank": "Medio"
    },
    {
      "zone": "G. Novedades",
      "coveredActions": 4,
      "skippedActions": 3,
      "totalRequests": 4,
      "maxDurationMs": 1715,
      "rank": "Medio"
    },
    {
      "zone": "H. Notificaciones",
      "coveredActions": 3,
      "skippedActions": 1,
      "totalRequests": 4,
      "maxDurationMs": 2760,
      "rank": "Lento"
    },
    {
      "zone": "I. Fichador",
      "coveredActions": 1,
      "skippedActions": 4,
      "totalRequests": 1,
      "maxDurationMs": 719,
      "rank": "OK"
    },
    {
      "zone": "J. Exportación",
      "coveredActions": 2,
      "skippedActions": 2,
      "totalRequests": 4,
      "maxDurationMs": 1643,
      "rank": "Medio"
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
      "visibleMs": 308,
      "networkIdleMs": 3569,
      "requests": [
        {
          "method": "POST",
          "path": "/api/auth/login",
          "statusCode": 200,
          "durationMs": 1111
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 363
        },
        {
          "method": "GET",
          "path": "/api/audit",
          "statusCode": 200,
          "durationMs": 890
        },
        {
          "method": "GET",
          "path": "/api/dashboard/metrics",
          "statusCode": 200,
          "durationMs": 1630
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
      "visibleMs": 86,
      "networkIdleMs": 1118,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 184
        },
        {
          "method": "GET",
          "path": "/api/time-entries/home-summary",
          "statusCode": 200,
          "durationMs": 544
        },
        {
          "method": "GET",
          "path": "/api/time-entries/home-summary",
          "statusCode": 200,
          "durationMs": 546
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
      "networkIdleMs": 88,
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
      "visibleMs": 84,
      "networkIdleMs": 2055,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 368
        },
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "statusCode": 200,
          "durationMs": 580
        },
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "statusCode": 200,
          "durationMs": 583
        },
        {
          "method": "GET",
          "path": "/api/time-entries/attendance",
          "statusCode": 200,
          "durationMs": 1305
        },
        {
          "method": "GET",
          "path": "/api/time-entries/attendance",
          "statusCode": 200,
          "durationMs": 1486
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
      "visibleMs": 26,
      "networkIdleMs": 109,
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
      "visibleMs": 23,
      "networkIdleMs": 426,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/attendance",
          "statusCode": 200,
          "durationMs": 974
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
      "visibleMs": 24,
      "networkIdleMs": 106,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "statusCode": 200,
          "durationMs": 387
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
      "visibleMs": 24,
      "networkIdleMs": 106,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "statusCode": 200,
          "durationMs": 2
        },
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "statusCode": 200,
          "durationMs": 402
        },
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "statusCode": 200,
          "durationMs": 3
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
      "visibleMs": 68,
      "networkIdleMs": 1092,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 346
        },
        {
          "method": "GET",
          "path": "/api/shifts/alerts",
          "statusCode": 200,
          "durationMs": 539
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
      "networkIdleMs": 420,
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
      "visibleMs": 23,
      "networkIdleMs": 427,
      "requests": [
        {
          "method": "GET",
          "path": "/api/shifts/alerts",
          "statusCode": 200,
          "durationMs": 456
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
      "visibleMs": 16,
      "networkIdleMs": 101,
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
      "visibleMs": 52,
      "networkIdleMs": 136,
      "requests": [
        {
          "method": "GET",
          "path": "/api/shifts/alerts",
          "statusCode": 200,
          "durationMs": 644
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
      "visibleMs": 34,
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
      "visibleMs": 80,
      "networkIdleMs": 1349,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 181
        },
        {
          "method": "GET",
          "path": "/api/time-entries/summary",
          "statusCode": 200,
          "durationMs": 383
        },
        {
          "method": "GET",
          "path": "/api/org-structure",
          "statusCode": 200,
          "durationMs": 574
        },
        {
          "method": "GET",
          "path": "/api/time-entries/period-employees",
          "statusCode": 200,
          "durationMs": 780
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
      "visibleMs": 48,
      "networkIdleMs": 129,
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
      "visibleMs": 19,
      "networkIdleMs": 422,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/summary",
          "statusCode": 200,
          "durationMs": 371
        },
        {
          "method": "GET",
          "path": "/api/time-entries/period-employees",
          "statusCode": 200,
          "durationMs": 569
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
      "networkIdleMs": 436,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/period-employees",
          "statusCode": 200,
          "durationMs": 887
        }
      ],
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
      "visibleMs": 831,
      "networkIdleMs": 1845,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 189
        },
        {
          "method": "GET",
          "path": "/api/novelty-types",
          "statusCode": 200,
          "durationMs": 357
        },
        {
          "method": "GET",
          "path": "/api/employees/:id/time-grid",
          "statusCode": 200,
          "durationMs": 561
        },
        {
          "method": "GET",
          "path": "/api/employees/:id/time-grid",
          "statusCode": 200,
          "durationMs": 564
        },
        {
          "method": "GET",
          "path": "/api/employees/:id/time-grid",
          "statusCode": 200,
          "durationMs": 565
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "statusCode": 200,
          "durationMs": 1067
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "statusCode": 200,
          "durationMs": 720
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
      "visibleMs": 8,
      "networkIdleMs": 92,
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
      "visibleMs": 57,
      "networkIdleMs": 140,
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
      "visibleMs": 35,
      "networkIdleMs": 119,
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
      "visibleMs": 80,
      "networkIdleMs": 161,
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
      "visibleMs": 64,
      "networkIdleMs": 1381,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/corrections",
          "statusCode": 200,
          "durationMs": 222
        },
        {
          "method": "GET",
          "path": "/api/workforce/closures",
          "statusCode": 200,
          "durationMs": 400
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 414
        },
        {
          "method": "GET",
          "path": "/api/workforce/corrections",
          "statusCode": 200,
          "durationMs": 402
        },
        {
          "method": "GET",
          "path": "/api/employees/options",
          "statusCode": 200,
          "durationMs": 403
        },
        {
          "method": "GET",
          "path": "/api/workforce/closures",
          "statusCode": 200,
          "durationMs": 832
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
      "visibleMs": 16,
      "networkIdleMs": 99,
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
      "visibleMs": 83,
      "networkIdleMs": 1672,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/summary",
          "statusCode": 200,
          "durationMs": 1
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 186
        },
        {
          "method": "GET",
          "path": "/api/pending",
          "statusCode": 200,
          "durationMs": 369
        },
        {
          "method": "GET",
          "path": "/api/time-entries",
          "statusCode": 200,
          "durationMs": 1106
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
      "visibleMs": 24,
      "networkIdleMs": 107,
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
      "visibleMs": 1812,
      "networkIdleMs": 1896,
      "requests": [
        {
          "method": "GET",
          "path": "/api/pending",
          "statusCode": 200,
          "durationMs": 1397
        },
        {
          "method": "GET",
          "path": "/api/time-entries/summary",
          "statusCode": 200,
          "durationMs": 1409
        },
        {
          "method": "GET",
          "path": "/api/time-entries",
          "statusCode": 200,
          "durationMs": 2112
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
      "visibleMs": 70,
      "networkIdleMs": 1715,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 188
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "statusCode": 200,
          "durationMs": 1154
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "statusCode": 200,
          "durationMs": 1156
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
      "networkIdleMs": 417,
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
      "visibleMs": 33,
      "networkIdleMs": 115,
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
      "visibleMs": 39,
      "networkIdleMs": 121,
      "requests": [
        {
          "method": "GET",
          "path": "/api/hour-concepts",
          "statusCode": 200,
          "durationMs": 387
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
      "visibleMs": 79,
      "networkIdleMs": 2760,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 265
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications",
          "statusCode": 200,
          "durationMs": 1262
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications",
          "statusCode": 200,
          "durationMs": 2196
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
      "networkIdleMs": 101,
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
      "visibleMs": 19,
      "networkIdleMs": 103,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications",
          "statusCode": 200,
          "durationMs": 674
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
      "visibleMs": 71,
      "networkIdleMs": 719,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 172
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
      "visibleMs": 75,
      "networkIdleMs": 1643,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 173
        },
        {
          "method": "GET",
          "path": "/api/finnegans-export/novelties",
          "statusCode": 200,
          "durationMs": 713
        },
        {
          "method": "GET",
          "path": "/api/finnegans-export/novelties",
          "statusCode": 200,
          "durationMs": 1083
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
      "visibleMs": 805,
      "networkIdleMs": 889,
      "requests": [
        {
          "method": "GET",
          "path": "/api/finnegans-export/novelties",
          "statusCode": 200,
          "durationMs": 615
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
      "path": "/api/workforce/notifications",
      "statusCode": 200,
      "durationMs": 2196
    },
    {
      "method": "GET",
      "path": "/api/time-entries",
      "statusCode": 200,
      "durationMs": 2112
    },
    {
      "method": "GET",
      "path": "/api/dashboard/metrics",
      "statusCode": 200,
      "durationMs": 1630
    },
    {
      "method": "GET",
      "path": "/api/time-entries/attendance",
      "statusCode": 200,
      "durationMs": 1486
    },
    {
      "method": "GET",
      "path": "/api/time-entries/summary",
      "statusCode": 200,
      "durationMs": 1409
    },
    {
      "method": "GET",
      "path": "/api/pending",
      "statusCode": 200,
      "durationMs": 1397
    },
    {
      "method": "GET",
      "path": "/api/time-entries/attendance",
      "statusCode": 200,
      "durationMs": 1305
    },
    {
      "method": "GET",
      "path": "/api/workforce/notifications",
      "statusCode": 200,
      "durationMs": 1262
    },
    {
      "method": "GET",
      "path": "/api/novelties",
      "statusCode": 200,
      "durationMs": 1156
    },
    {
      "method": "GET",
      "path": "/api/novelties",
      "statusCode": 200,
      "durationMs": 1154
    }
  ],
  "slowestActions": [
    {
      "name": "Login (acceso rápido RRHH)",
      "zone": "Login",
      "visibleMs": 308,
      "networkIdleMs": 3569
    },
    {
      "name": "Entrar a Notificaciones (Todas)",
      "zone": "H. Notificaciones",
      "visibleMs": 79,
      "networkIdleMs": 2760
    },
    {
      "name": "Entrar a Asistencia (carga inicial del día)",
      "zone": "B. Asistencia",
      "visibleMs": 84,
      "networkIdleMs": 2055
    },
    {
      "name": "Cambiar período (Bandeja de revisión)",
      "zone": "F. Bandeja de revisión",
      "visibleMs": 1812,
      "networkIdleMs": 1896
    },
    {
      "name": "Abrir edición de horas de un empleado (navega a /horas/:id)",
      "zone": "D. Carga de horas",
      "visibleMs": 831,
      "networkIdleMs": 1845
    },
    {
      "name": "Entrar a Novedades",
      "zone": "G. Novedades",
      "visibleMs": 70,
      "networkIdleMs": 1715
    },
    {
      "name": "Entrar a Bandeja de revisión (Por registro)",
      "zone": "F. Bandeja de revisión",
      "visibleMs": 83,
      "networkIdleMs": 1672
    },
    {
      "name": "Entrar a Exportación (período actual)",
      "zone": "J. Exportación",
      "visibleMs": 75,
      "networkIdleMs": 1643
    },
    {
      "name": "Entrar a Cierres mensuales (período actual)",
      "zone": "E. Cierres mensuales",
      "visibleMs": 64,
      "networkIdleMs": 1381
    },
    {
      "name": "Entrar a Carga de horas (período actual)",
      "zone": "D. Carga de horas",
      "visibleMs": 80,
      "networkIdleMs": 1349
    }
  ],
  "repeatedEndpoints": [
    {
      "key": "GET /api/workforce/notifications-unread-count",
      "method": "GET",
      "path": "/api/workforce/notifications-unread-count",
      "count": 12,
      "avgDurationMs": 252,
      "maxDurationMs": 414,
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
      "key": "GET /api/time-entries/home-summary",
      "method": "GET",
      "path": "/api/time-entries/home-summary",
      "count": 2,
      "avgDurationMs": 545,
      "maxDurationMs": 546,
      "statusCodes": [
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
      "count": 6,
      "avgDurationMs": 326,
      "maxDurationMs": 583,
      "statusCodes": [
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
      "key": "GET /api/time-entries/attendance",
      "method": "GET",
      "path": "/api/time-entries/attendance",
      "count": 3,
      "avgDurationMs": 1255,
      "maxDurationMs": 1486,
      "statusCodes": [
        200,
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
      "avgDurationMs": 546,
      "maxDurationMs": 644,
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
      "avgDurationMs": 433,
      "maxDurationMs": 1409,
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
      "count": 4,
      "avgDurationMs": 560,
      "maxDurationMs": 887,
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
      "key": "GET /api/employees/:id/time-grid",
      "method": "GET",
      "path": "/api/employees/:id/time-grid",
      "count": 3,
      "avgDurationMs": 563,
      "maxDurationMs": 565,
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
      "avgDurationMs": 1024,
      "maxDurationMs": 1156,
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
      "key": "GET /api/workforce/corrections",
      "method": "GET",
      "path": "/api/workforce/corrections",
      "count": 2,
      "avgDurationMs": 312,
      "maxDurationMs": 402,
      "statusCodes": [
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/workforce/closures",
      "method": "GET",
      "path": "/api/workforce/closures",
      "count": 2,
      "avgDurationMs": 616,
      "maxDurationMs": 832,
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
      "avgDurationMs": 883,
      "maxDurationMs": 1397,
      "statusCodes": [
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
      "avgDurationMs": 1609,
      "maxDurationMs": 2112,
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
      "count": 3,
      "avgDurationMs": 1377,
      "maxDurationMs": 2196,
      "statusCodes": [
        200,
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
      "avgDurationMs": 804,
      "maxDurationMs": 1083,
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
      "name": "Entrar a Inicio (Gestión horaria)",
      "zone": "A. Inicio",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/time-entries/home-summary",
          "count": 2,
          "durationsMs": [
            544,
            546
          ]
        }
      ]
    },
    {
      "name": "Entrar a Asistencia (carga inicial del día)",
      "zone": "B. Asistencia",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "count": 2,
          "durationsMs": [
            580,
            583
          ]
        },
        {
          "method": "GET",
          "path": "/api/time-entries/attendance",
          "count": 2,
          "durationsMs": [
            1305,
            1486
          ]
        }
      ]
    },
    {
      "name": "Limpiar filtros de problemas de fichada",
      "zone": "B. Asistencia",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "count": 3,
          "durationsMs": [
            2,
            402,
            3
          ]
        }
      ]
    },
    {
      "name": "Abrir edición de horas de un empleado (navega a /horas/:id)",
      "zone": "D. Carga de horas",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/employees/:id/time-grid",
          "count": 3,
          "durationsMs": [
            561,
            564,
            565
          ]
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "count": 2,
          "durationsMs": [
            1067,
            720
          ]
        }
      ]
    },
    {
      "name": "Entrar a Cierres mensuales (período actual)",
      "zone": "E. Cierres mensuales",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/workforce/corrections",
          "count": 2,
          "durationsMs": [
            222,
            402
          ]
        },
        {
          "method": "GET",
          "path": "/api/workforce/closures",
          "count": 2,
          "durationsMs": [
            400,
            832
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
            1154,
            1156
          ]
        }
      ]
    },
    {
      "name": "Entrar a Notificaciones (Todas)",
      "zone": "H. Notificaciones",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications",
          "count": 2,
          "durationsMs": [
            1262,
            2196
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
            713,
            1083
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
