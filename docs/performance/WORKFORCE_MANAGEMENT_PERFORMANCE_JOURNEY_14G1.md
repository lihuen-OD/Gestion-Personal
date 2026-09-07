# Performance Journey — Gestión horaria (Etapa 14G.1)

Reporte generado automáticamente por `npm run perf:journey:workforce`. No editar a mano — se sobreescribe en cada corrida.

**Etapa de diagnóstico/medición — no de optimización.** Ningún hallazgo de este reporte se corrigió en esta etapa; ver §15 para el orden recomendado de 14G.2 en adelante.

## 1. Resumen ejecutivo

Recorrido macro de los 10 submódulos de Gestión horaria: 37/65 acciones cubiertas, 28 salteadas (16 de ellas por ser de escritura, con motivo documentado cada una), 0 respuestas HTTP >= 400, 0 errores de consola. 2 acción(es) en rango Crítico (> 3000ms) y 5 en rango Lento (2000-3000ms). Cero escrituras ejecutadas — modo `read-only` en todo el recorrido.

## 2. Ambiente

- Generado: 2026-09-07T16:40:33.022Z
- Frontend: http://localhost:5174
- Backend: http://localhost:4002/api
- Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.
- Usuario: Nivel 1 - RRHH (acceso rápido demo — credenciales en docs/LOCAL_DEVELOPMENT.md, no se repiten en este reporte)
- Comando: `npm run perf:journey:workforce (desde frontend/)`

## 3. Cobertura general

| Submódulo | Acciones cubiertas | Acciones salteadas | Requests capturadas | Peor duración | Rango |
|---|---|---|---|---|---|
| Login | 1 | 0 | 4 | 6389ms | Crítico |
| A. Inicio | 2 | 0 | 3 | 2239ms | Lento |
| B. Asistencia | 5 | 4 | 10 | 2192ms | Lento |
| C. Alertas de turnos | 5 | 2 | 6 | 2509ms | Lento |
| D. Carga de horas | 9 | 4 | 15 | 3362ms | Crítico |
| E. Cierres mensuales | 2 | 2 | 7 | 1307ms | Medio |
| F. Bandeja de revisión | 3 | 6 | 7 | 1690ms | Medio |
| G. Novedades | 4 | 3 | 4 | 1701ms | Medio |
| H. Notificaciones | 3 | 1 | 3 | 2799ms | Lento |
| I. Fichador | 1 | 4 | 1 | 735ms | OK |
| J. Exportación | 2 | 2 | 4 | 1706ms | Medio |

## 4. Tabla de acciones

| Acción | Submódulo | Ruta | Visible | Network idle | Requests | Errores consola | Escritura |
|---|---|---|---|---|---|---|---|
| Login (acceso rápido RRHH) | Login | `/` | 626ms | 6389ms | 4 | 0 | No |
| Entrar a Inicio (Gestión horaria) | A. Inicio | `/gestion-horaria` | 82ms | 2239ms | 3 | 0 | No |
| Ver KPIs/resumen de Inicio | A. Inicio | `/gestion-horaria` | 3ms | 88ms | 0 | 0 | No |
| Entrar a Asistencia (carga inicial del día) | B. Asistencia | `/asistencia` | 76ms | 2192ms | 5 | 0 | No |
| Cambiar fecha del día | B. Asistencia | `/asistencia` | 26ms | 109ms | 0 | 0 | No |
| Buscar en problemas de fichada | B. Asistencia | `/asistencia` | 24ms | 427ms | 1 | 0 | No |
| Filtrar problemas de fichada por tipo | B. Asistencia | `/asistencia` | 22ms | 106ms | 1 | 0 | No |
| Limpiar filtros de problemas de fichada | B. Asistencia | `/asistencia` | 30ms | 115ms | 3 | 0 | No |
| Entrar a Alertas de turnos | C. Alertas de turnos | `/asistencia/alertas` | 67ms | 2509ms | 3 | 0 | No |
| Buscar alerta por texto | C. Alertas de turnos | `/asistencia/alertas` | 17ms | 420ms | 0 | 0 | No |
| Limpiar búsqueda de alertas | C. Alertas de turnos | `/asistencia/alertas` | 1822ms | 2227ms | 2 | 0 | No |
| Filtrar alertas por tipo | C. Alertas de turnos | `/asistencia/alertas` | 1313ms | 1397ms | 1 | 0 | No |
| Limpiar filtros de alertas | C. Alertas de turnos | `/asistencia/alertas` | 19ms | 101ms | 0 | 0 | No |
| Entrar a Carga de horas (período actual) | D. Carga de horas | `/horas` | 73ms | 3362ms | 4 | 0 | No |
| Cambiar período (Carga de horas) | D. Carga de horas | `/horas` | 50ms | 132ms | 0 | 0 | No |
| Buscar empleado (Carga de horas) | D. Carga de horas | `/horas` | 19ms | 421ms | 2 | 0 | No |
| Limpiar búsqueda (Carga de horas) | D. Carga de horas | `/horas` | 36ms | 438ms | 1 | 0 | No |
| Abrir edición de horas de un empleado (navega a /horas/:id) | D. Carga de horas | `/horas/:id` | 828ms | 1705ms | 7 | 0 | No |
| Ver total real/liquidable | D. Carga de horas | `/horas/:id` | 7ms | 89ms | 0 | 0 | No |
| Abrir edición de hora sin guardar | D. Carga de horas | `/horas/:id` | 49ms | 131ms | 0 | 0 | No |
| Cancelar edición de hora | D. Carga de horas | `/horas/:id` | 39ms | 122ms | 0 | 0 | No |
| Volver a Carga de horas | D. Carga de horas | `/horas` | 54ms | 136ms | 1 | 0 | No |
| Entrar a Cierres mensuales (período actual) | E. Cierres mensuales | `/cierres` | 54ms | 1307ms | 6 | 0 | No |
| Cambiar período (Cierres mensuales) | E. Cierres mensuales | `/cierres` | 17ms | 100ms | 1 | 0 | No |
| Entrar a Bandeja de revisión (Por registro) | F. Bandeja de revisión | `/pendientes` | 80ms | 1690ms | 4 | 0 | No |
| Cambiar a pestaña "Por persona" | F. Bandeja de revisión | `/pendientes` | 39ms | 121ms | 0 | 0 | No |
| Cambiar período (Bandeja de revisión) | F. Bandeja de revisión | `/pendientes` | 1310ms | 1393ms | 3 | 0 | No |
| Entrar a Novedades | G. Novedades | `/novedades` | 69ms | 1701ms | 3 | 0 | No |
| Buscar en Novedades | G. Novedades | `/novedades` | 13ms | 417ms | 0 | 0 | No |
| Abrir modal "Nueva novedad" sin guardar | G. Novedades | `/novedades` | 25ms | 108ms | 0 | 0 | No |
| Cancelar "Nueva novedad" | G. Novedades | `/novedades` | 23ms | 105ms | 1 | 0 | No |
| Entrar a Notificaciones (Todas) | H. Notificaciones | `/notificaciones` | 80ms | 2799ms | 3 | 0 | No |
| Filtrar por "No leídas" | H. Notificaciones | `/notificaciones` | 17ms | 101ms | 0 | 0 | No |
| Cargar más notificaciones | H. Notificaciones | `/notificaciones` | 28ms | 111ms | 0 | 0 | No |
| Entrar a Fichador (carga inicial) | I. Fichador | `/fichador` | 72ms | 735ms | 1 | 0 | No |
| Entrar a Exportación (período actual) | J. Exportación | `/configuracion/liquidacion` | 77ms | 1706ms | 3 | 0 | No |
| Cambiar período (Exportación) | J. Exportación | `/configuracion/liquidacion` | 804ms | 888ms | 1 | 0 | No |

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
- **Expandir hallazgos asociados de un grupo** (C. Alertas de turnos, lectura): ningún grupo de alertas tiene más de 1 hallazgo asociado en el entorno actual.
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
| Login (acceso rápido RRHH) | Login | 626ms | 6389ms | Crítico |
| Entrar a Carga de horas (período actual) | D. Carga de horas | 73ms | 3362ms | Crítico |
| Entrar a Notificaciones (Todas) | H. Notificaciones | 80ms | 2799ms | Lento |
| Entrar a Alertas de turnos | C. Alertas de turnos | 67ms | 2509ms | Lento |
| Entrar a Inicio (Gestión horaria) | A. Inicio | 82ms | 2239ms | Lento |
| Limpiar búsqueda de alertas | C. Alertas de turnos | 1822ms | 2227ms | Lento |
| Entrar a Asistencia (carga inicial del día) | B. Asistencia | 76ms | 2192ms | Lento |
| Entrar a Exportación (período actual) | J. Exportación | 77ms | 1706ms | Medio |
| Abrir edición de horas de un empleado (navega a /horas/:id) | D. Carga de horas | 828ms | 1705ms | Medio |
| Entrar a Novedades | G. Novedades | 69ms | 1701ms | Medio |

## 8. Top requests lentas

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/dashboard/metrics` | 200 | 4105ms |
| GET | `/api/workforce/notifications` | 200 | 2237ms |
| GET | `/api/audit` | 200 | 2156ms |
| GET | `/api/shifts/alerts` | 200 | 1958ms |
| GET | `/api/time-entries/home-summary` | 200 | 1671ms |
| GET | `/api/time-entries/home-summary` | 200 | 1669ms |
| GET | `/api/org-structure` | 200 | 1653ms |
| GET | `/api/time-entries/attendance` | 200 | 1625ms |
| GET | `/api/time-entries/attendance` | 200 | 1623ms |
| GET | `/api/shifts/alerts` | 200 | 1505ms |

## 9. Endpoints repetidos

Mismo endpoint (método+path) pedido más de una vez a lo largo de TODO el recorrido, sin importar desde qué submódulo — detecta catálogos/endpoints compartidos entre submódulos (ítem 13 de la Parte 6 del pedido).

| Endpoint | Llamadas totales |
|---|---|
| `GET /api/workforce/notifications-unread-count` | 12 |
| `GET /api/time-entries/attendance/observations` | 6 |
| `GET /api/shifts/alerts` | 5 |
| `GET /api/time-entries/summary` | 5 |
| `GET /api/novelties` | 4 |
| `GET /api/time-entries/attendance` | 3 |
| `GET /api/time-entries/period-employees` | 3 |
| `GET /api/employees/:id/time-grid` | 3 |
| `GET /api/workforce/corrections` | 3 |
| `GET /api/finnegans-export/novelties` | 3 |
| `GET /api/time-entries/home-summary` | 2 |
| `GET /api/workforce/closures` | 2 |
| `GET /api/pending` | 2 |
| `GET /api/time-entries` | 2 |
| `GET /api/workforce/notifications` | 2 |

## 10. Duplicados por acción

Mismo endpoint pedido más de una vez DENTRO de la ventana de una sola acción — señal de StrictMode (double-invoke en dev) o de un remount/refetch inesperado (ítems 1-2 de la Parte 6 del pedido).

- **Entrar a Inicio (Gestión horaria)** (A. Inicio): `GET /api/time-entries/home-summary` x2
- **Entrar a Asistencia (carga inicial del día)** (B. Asistencia): `GET /api/time-entries/attendance/observations` x2, `GET /api/time-entries/attendance` x2
- **Limpiar filtros de problemas de fichada** (B. Asistencia): `GET /api/time-entries/attendance/observations` x3
- **Entrar a Alertas de turnos** (C. Alertas de turnos): `GET /api/shifts/alerts` x2
- **Limpiar búsqueda de alertas** (C. Alertas de turnos): `GET /api/shifts/alerts` x2
- **Abrir edición de horas de un empleado (navega a /horas/:id)** (D. Carga de horas): `GET /api/employees/:id/time-grid` x3, `GET /api/novelties` x2
- **Entrar a Cierres mensuales (período actual)** (E. Cierres mensuales): `GET /api/workforce/closures` x2, `GET /api/workforce/corrections` x2
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
| 1 | H. Notificaciones | 0 | 1 | 2237ms |
| 2 | C. Alertas de turnos | 0 | 0 | 1958ms |
| 3 | A. Inicio | 0 | 0 | 1671ms |
| 4 | D. Carga de horas | 0 | 0 | 1653ms |
| 5 | B. Asistencia | 0 | 0 | 1625ms |
| 6 | F. Bandeja de revisión | 0 | 0 | 1241ms |
| 7 | G. Novedades | 0 | 0 | 1145ms |
| 8 | J. Exportación | 0 | 0 | 1144ms |
| 9 | E. Cierres mensuales | 0 | 0 | 766ms |
| 10 | I. Fichador | 0 | 0 | 188ms |

Contexto histórico relevante para esta priorización (no medido por este journey, ya documentado en etapas previas):
- `GET /shifts/alerts` (Alertas de turnos) fue medido en 3906ms (Crítico) por el journey general 14B.3 y nunca se revisó desde entonces.
- `findManyByEmployeeGrouped` (Bandeja de revisión, vista "Por persona") usa el mismo antipatrón `$transaction` ya corregido en otros endpoints por 14C.2 — documentado 2 veces como pendiente, nunca corregido.
- `GET /workforce/closures` y `GET /workforce/corrections` (Cierres mensuales) nunca fueron medidos por ningún journey anterior a 14G.1.
- Fichador queda deliberadamente fuera de cualquier ranking de optimización — ver `docs/PERFORMANCE_STANDARDS.md` §10 (categoría crítica D, no optimizar sin etapa dedicada).

## 16. Raw sanitized JSON

Idéntico al archivo `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json` generado en esta misma corrida.

```json
{
  "generatedAt": "2026-09-07T16:40:33.022Z",
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
    "coveredActions": 37,
    "skippedActions": 28,
    "slowActions": 5,
    "verySlowActions": 2,
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
      "maxDurationMs": 6389,
      "rank": "Crítico"
    },
    {
      "zone": "A. Inicio",
      "coveredActions": 2,
      "skippedActions": 0,
      "totalRequests": 3,
      "maxDurationMs": 2239,
      "rank": "Lento"
    },
    {
      "zone": "B. Asistencia",
      "coveredActions": 5,
      "skippedActions": 4,
      "totalRequests": 10,
      "maxDurationMs": 2192,
      "rank": "Lento"
    },
    {
      "zone": "C. Alertas de turnos",
      "coveredActions": 5,
      "skippedActions": 2,
      "totalRequests": 6,
      "maxDurationMs": 2509,
      "rank": "Lento"
    },
    {
      "zone": "D. Carga de horas",
      "coveredActions": 9,
      "skippedActions": 4,
      "totalRequests": 15,
      "maxDurationMs": 3362,
      "rank": "Crítico"
    },
    {
      "zone": "E. Cierres mensuales",
      "coveredActions": 2,
      "skippedActions": 2,
      "totalRequests": 7,
      "maxDurationMs": 1307,
      "rank": "Medio"
    },
    {
      "zone": "F. Bandeja de revisión",
      "coveredActions": 3,
      "skippedActions": 6,
      "totalRequests": 7,
      "maxDurationMs": 1690,
      "rank": "Medio"
    },
    {
      "zone": "G. Novedades",
      "coveredActions": 4,
      "skippedActions": 3,
      "totalRequests": 4,
      "maxDurationMs": 1701,
      "rank": "Medio"
    },
    {
      "zone": "H. Notificaciones",
      "coveredActions": 3,
      "skippedActions": 1,
      "totalRequests": 3,
      "maxDurationMs": 2799,
      "rank": "Lento"
    },
    {
      "zone": "I. Fichador",
      "coveredActions": 1,
      "skippedActions": 4,
      "totalRequests": 1,
      "maxDurationMs": 735,
      "rank": "OK"
    },
    {
      "zone": "J. Exportación",
      "coveredActions": 2,
      "skippedActions": 2,
      "totalRequests": 4,
      "maxDurationMs": 1706,
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
      "visibleMs": 626,
      "networkIdleMs": 6389,
      "requests": [
        {
          "method": "POST",
          "path": "/api/auth/login",
          "statusCode": 200,
          "durationMs": 1190
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 352
        },
        {
          "method": "GET",
          "path": "/api/audit",
          "statusCode": 200,
          "durationMs": 2156
        },
        {
          "method": "GET",
          "path": "/api/dashboard/metrics",
          "statusCode": 200,
          "durationMs": 4105
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
      "visibleMs": 82,
      "networkIdleMs": 2239,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 387
        },
        {
          "method": "GET",
          "path": "/api/time-entries/home-summary",
          "statusCode": 200,
          "durationMs": 1669
        },
        {
          "method": "GET",
          "path": "/api/time-entries/home-summary",
          "statusCode": 200,
          "durationMs": 1671
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
      "visibleMs": 76,
      "networkIdleMs": 2192,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "statusCode": 200,
          "durationMs": 844
        },
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "statusCode": 200,
          "durationMs": 844
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 865
        },
        {
          "method": "GET",
          "path": "/api/time-entries/attendance",
          "statusCode": 200,
          "durationMs": 1623
        },
        {
          "method": "GET",
          "path": "/api/time-entries/attendance",
          "statusCode": 200,
          "durationMs": 1625
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
      "visibleMs": 24,
      "networkIdleMs": 427,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/attendance",
          "statusCode": 200,
          "durationMs": 889
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
      "visibleMs": 22,
      "networkIdleMs": 106,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "statusCode": 200,
          "durationMs": 379
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
      "visibleMs": 30,
      "networkIdleMs": 115,
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
          "durationMs": 377
        },
        {
          "method": "GET",
          "path": "/api/time-entries/attendance/observations",
          "statusCode": 200,
          "durationMs": 4
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
      "visibleMs": 67,
      "networkIdleMs": 2509,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 178
        },
        {
          "method": "GET",
          "path": "/api/shifts/alerts",
          "statusCode": 200,
          "durationMs": 1253
        },
        {
          "method": "GET",
          "path": "/api/shifts/alerts",
          "statusCode": 200,
          "durationMs": 1958
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
      "visibleMs": 17,
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
      "visibleMs": 1822,
      "networkIdleMs": 2227,
      "requests": [
        {
          "method": "GET",
          "path": "/api/shifts/alerts",
          "statusCode": 200,
          "durationMs": 1505
        },
        {
          "method": "GET",
          "path": "/api/shifts/alerts",
          "statusCode": 200,
          "durationMs": 1429
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
      "visibleMs": 1313,
      "networkIdleMs": 1397,
      "requests": [
        {
          "method": "GET",
          "path": "/api/shifts/alerts",
          "statusCode": 200,
          "durationMs": 1220
        }
      ],
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
      "visibleMs": 19,
      "networkIdleMs": 101,
      "requests": [],
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
      "covered": false,
      "skippedReason": "ningún grupo de alertas tiene más de 1 hallazgo asociado en el entorno actual",
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
      "visibleMs": 73,
      "networkIdleMs": 3362,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 526
        },
        {
          "method": "GET",
          "path": "/api/time-entries/summary",
          "statusCode": 200,
          "durationMs": 550
        },
        {
          "method": "GET",
          "path": "/api/org-structure",
          "statusCode": 200,
          "durationMs": 1653
        },
        {
          "method": "GET",
          "path": "/api/time-entries/period-employees",
          "statusCode": 200,
          "durationMs": 1119
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
      "visibleMs": 50,
      "networkIdleMs": 132,
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
      "networkIdleMs": 421,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/summary",
          "statusCode": 200,
          "durationMs": 560
        },
        {
          "method": "GET",
          "path": "/api/time-entries/period-employees",
          "statusCode": 200,
          "durationMs": 765
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
      "visibleMs": 36,
      "networkIdleMs": 438,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/period-employees",
          "statusCode": 200,
          "durationMs": 757
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
      "visibleMs": 828,
      "networkIdleMs": 1705,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 401
        },
        {
          "method": "GET",
          "path": "/api/employees/:id/time-grid",
          "statusCode": 200,
          "durationMs": 389
        },
        {
          "method": "GET",
          "path": "/api/novelty-types",
          "statusCode": 200,
          "durationMs": 388
        },
        {
          "method": "GET",
          "path": "/api/employees/:id/time-grid",
          "statusCode": 200,
          "durationMs": 391
        },
        {
          "method": "GET",
          "path": "/api/employees/:id/time-grid",
          "statusCode": 200,
          "durationMs": 392
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "statusCode": 200,
          "durationMs": 1141
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "statusCode": 200,
          "durationMs": 752
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
      "visibleMs": 7,
      "networkIdleMs": 89,
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
      "visibleMs": 49,
      "networkIdleMs": 131,
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
      "visibleMs": 39,
      "networkIdleMs": 122,
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
      "visibleMs": 54,
      "networkIdleMs": 136,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries/summary",
          "statusCode": 200,
          "durationMs": 175
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
      "visibleMs": 54,
      "networkIdleMs": 1307,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 172
        },
        {
          "method": "GET",
          "path": "/api/workforce/closures",
          "statusCode": 200,
          "durationMs": 357
        },
        {
          "method": "GET",
          "path": "/api/employees/options",
          "statusCode": 200,
          "durationMs": 358
        },
        {
          "method": "GET",
          "path": "/api/workforce/corrections",
          "statusCode": 200,
          "durationMs": 359
        },
        {
          "method": "GET",
          "path": "/api/workforce/corrections",
          "statusCode": 200,
          "durationMs": 765
        },
        {
          "method": "GET",
          "path": "/api/workforce/closures",
          "statusCode": 200,
          "durationMs": 766
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
      "visibleMs": 17,
      "networkIdleMs": 100,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/corrections",
          "statusCode": 200,
          "durationMs": 189
        }
      ],
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
      "visibleMs": 80,
      "networkIdleMs": 1690,
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
          "durationMs": 190
        },
        {
          "method": "GET",
          "path": "/api/pending",
          "statusCode": 200,
          "durationMs": 385
        },
        {
          "method": "GET",
          "path": "/api/time-entries",
          "statusCode": 200,
          "durationMs": 1120
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
      "visibleMs": 39,
      "networkIdleMs": 121,
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
      "visibleMs": 1310,
      "networkIdleMs": 1393,
      "requests": [
        {
          "method": "GET",
          "path": "/api/time-entries",
          "statusCode": 200,
          "durationMs": 979
        },
        {
          "method": "GET",
          "path": "/api/time-entries/summary",
          "statusCode": 200,
          "durationMs": 1081
        },
        {
          "method": "GET",
          "path": "/api/pending",
          "statusCode": 200,
          "durationMs": 1241
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
      "visibleMs": 69,
      "networkIdleMs": 1701,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 368
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "statusCode": 200,
          "durationMs": 1143
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "statusCode": 200,
          "durationMs": 1145
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
      "visibleMs": 13,
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
      "visibleMs": 25,
      "networkIdleMs": 108,
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
      "visibleMs": 23,
      "networkIdleMs": 105,
      "requests": [
        {
          "method": "GET",
          "path": "/api/hour-concepts",
          "statusCode": 200,
          "durationMs": 563
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
      "visibleMs": 80,
      "networkIdleMs": 2799,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 290
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications",
          "statusCode": 200,
          "durationMs": 1328
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications",
          "statusCode": 200,
          "durationMs": 2237
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
      "visibleMs": 17,
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
      "visibleMs": 28,
      "networkIdleMs": 111,
      "requests": [],
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
      "visibleMs": 72,
      "networkIdleMs": 735,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 188
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
      "visibleMs": 77,
      "networkIdleMs": 1706,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 182
        },
        {
          "method": "GET",
          "path": "/api/finnegans-export/novelties",
          "statusCode": 200,
          "durationMs": 781
        },
        {
          "method": "GET",
          "path": "/api/finnegans-export/novelties",
          "statusCode": 200,
          "durationMs": 1144
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
      "visibleMs": 804,
      "networkIdleMs": 888,
      "requests": [
        {
          "method": "GET",
          "path": "/api/finnegans-export/novelties",
          "statusCode": 200,
          "durationMs": 547
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
      "durationMs": 4105
    },
    {
      "method": "GET",
      "path": "/api/workforce/notifications",
      "statusCode": 200,
      "durationMs": 2237
    },
    {
      "method": "GET",
      "path": "/api/audit",
      "statusCode": 200,
      "durationMs": 2156
    },
    {
      "method": "GET",
      "path": "/api/shifts/alerts",
      "statusCode": 200,
      "durationMs": 1958
    },
    {
      "method": "GET",
      "path": "/api/time-entries/home-summary",
      "statusCode": 200,
      "durationMs": 1671
    },
    {
      "method": "GET",
      "path": "/api/time-entries/home-summary",
      "statusCode": 200,
      "durationMs": 1669
    },
    {
      "method": "GET",
      "path": "/api/org-structure",
      "statusCode": 200,
      "durationMs": 1653
    },
    {
      "method": "GET",
      "path": "/api/time-entries/attendance",
      "statusCode": 200,
      "durationMs": 1625
    },
    {
      "method": "GET",
      "path": "/api/time-entries/attendance",
      "statusCode": 200,
      "durationMs": 1623
    },
    {
      "method": "GET",
      "path": "/api/shifts/alerts",
      "statusCode": 200,
      "durationMs": 1505
    }
  ],
  "slowestActions": [
    {
      "name": "Login (acceso rápido RRHH)",
      "zone": "Login",
      "visibleMs": 626,
      "networkIdleMs": 6389
    },
    {
      "name": "Entrar a Carga de horas (período actual)",
      "zone": "D. Carga de horas",
      "visibleMs": 73,
      "networkIdleMs": 3362
    },
    {
      "name": "Entrar a Notificaciones (Todas)",
      "zone": "H. Notificaciones",
      "visibleMs": 80,
      "networkIdleMs": 2799
    },
    {
      "name": "Entrar a Alertas de turnos",
      "zone": "C. Alertas de turnos",
      "visibleMs": 67,
      "networkIdleMs": 2509
    },
    {
      "name": "Entrar a Inicio (Gestión horaria)",
      "zone": "A. Inicio",
      "visibleMs": 82,
      "networkIdleMs": 2239
    },
    {
      "name": "Limpiar búsqueda de alertas",
      "zone": "C. Alertas de turnos",
      "visibleMs": 1822,
      "networkIdleMs": 2227
    },
    {
      "name": "Entrar a Asistencia (carga inicial del día)",
      "zone": "B. Asistencia",
      "visibleMs": 76,
      "networkIdleMs": 2192
    },
    {
      "name": "Entrar a Exportación (período actual)",
      "zone": "J. Exportación",
      "visibleMs": 77,
      "networkIdleMs": 1706
    },
    {
      "name": "Abrir edición de horas de un empleado (navega a /horas/:id)",
      "zone": "D. Carga de horas",
      "visibleMs": 828,
      "networkIdleMs": 1705
    },
    {
      "name": "Entrar a Novedades",
      "zone": "G. Novedades",
      "visibleMs": 69,
      "networkIdleMs": 1701
    }
  ],
  "repeatedEndpoints": [
    {
      "key": "GET /api/workforce/notifications-unread-count",
      "method": "GET",
      "path": "/api/workforce/notifications-unread-count",
      "count": 12,
      "avgDurationMs": 342,
      "maxDurationMs": 865,
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
      "avgDurationMs": 1670,
      "maxDurationMs": 1671,
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
      "avgDurationMs": 408,
      "maxDurationMs": 844,
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
      "avgDurationMs": 1379,
      "maxDurationMs": 1625,
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
      "count": 5,
      "avgDurationMs": 1473,
      "maxDurationMs": 1958,
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
      "key": "GET /api/time-entries/summary",
      "method": "GET",
      "path": "/api/time-entries/summary",
      "count": 5,
      "avgDurationMs": 473,
      "maxDurationMs": 1081,
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
      "avgDurationMs": 880,
      "maxDurationMs": 1119,
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
      "avgDurationMs": 391,
      "maxDurationMs": 392,
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
      "avgDurationMs": 1045,
      "maxDurationMs": 1145,
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
      "key": "GET /api/workforce/closures",
      "method": "GET",
      "path": "/api/workforce/closures",
      "count": 2,
      "avgDurationMs": 562,
      "maxDurationMs": 766,
      "statusCodes": [
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
      "count": 3,
      "avgDurationMs": 438,
      "maxDurationMs": 765,
      "statusCodes": [
        200,
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
      "avgDurationMs": 813,
      "maxDurationMs": 1241,
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
      "avgDurationMs": 1050,
      "maxDurationMs": 1120,
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
      "avgDurationMs": 1783,
      "maxDurationMs": 2237,
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
      "avgDurationMs": 824,
      "maxDurationMs": 1144,
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
            1669,
            1671
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
            844,
            844
          ]
        },
        {
          "method": "GET",
          "path": "/api/time-entries/attendance",
          "count": 2,
          "durationsMs": [
            1623,
            1625
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
            377,
            4
          ]
        }
      ]
    },
    {
      "name": "Entrar a Alertas de turnos",
      "zone": "C. Alertas de turnos",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/shifts/alerts",
          "count": 2,
          "durationsMs": [
            1253,
            1958
          ]
        }
      ]
    },
    {
      "name": "Limpiar búsqueda de alertas",
      "zone": "C. Alertas de turnos",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/shifts/alerts",
          "count": 2,
          "durationsMs": [
            1505,
            1429
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
            389,
            391,
            392
          ]
        },
        {
          "method": "GET",
          "path": "/api/novelties",
          "count": 2,
          "durationsMs": [
            1141,
            752
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
          "path": "/api/workforce/closures",
          "count": 2,
          "durationsMs": [
            357,
            766
          ]
        },
        {
          "method": "GET",
          "path": "/api/workforce/corrections",
          "count": 2,
          "durationsMs": [
            359,
            765
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
            1143,
            1145
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
            1328,
            2237
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
            781,
            1144
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
      "name": "Expandir hallazgos asociados de un grupo",
      "zone": "C. Alertas de turnos",
      "isWrite": false,
      "reason": "ningún grupo de alertas tiene más de 1 hallazgo asociado en el entorno actual"
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
