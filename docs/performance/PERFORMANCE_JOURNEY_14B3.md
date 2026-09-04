# Performance Journey — Etapa 14B.3

Reporte generado automáticamente. No editar a mano — se sobreescribe en cada corrida de `npm run perf:journey`.

## 1. Fecha/hora

2026-09-04T10:44:30.232Z

## 2. Ambiente

- Frontend: http://localhost:5174
- Backend: http://localhost:4002/api
- Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.

## 3. Usuario usado

Nivel 1 - RRHH (acceso rápido demo — credenciales en docs/LOCAL_DEVELOPMENT.md, no se repiten en este reporte)

## 4. Comando ejecutado

```bash
npm run perf:journey (desde frontend/)
```

## 5. Pantallas recorridas

| Pantalla | Ruta | Header visible | Network idle | Requests | Errores consola |
|---|---|---|---|---|---|
| Login | `/` | 444ms | 7014ms | 6 | 0 |
| Dashboard | `/` | 84ms | 1141ms | 5 | 0 |
| Legajos / Empleados | `/legajos` | 81ms | 4041ms | 6 | 0 |
| Detalle de un legajo existente | `/legajos/:id` | 835ms | 5396ms | 8 | 0 |
| Conceptos Horarios | `/configuracion/conceptos-horarios` | 79ms | 1158ms | 3 | 0 |
| Tipos de Novedades | `/configuracion/tipos-novedades` | 76ms | 1612ms | 3 | 0 |
| Categorías Documentales | `/configuracion/categorias-documentales` | 81ms | 1181ms | 3 | 0 |
| Horas Especiales | `/configuracion/turnos-horas-especiales` | 72ms | 4951ms | 7 | 0 |
| Turnos | `/configuracion/turnos` | 76ms | 1405ms | 6 | 0 |
| Regímenes Laborales | `/configuracion/regimenes-laborales` | 76ms | 1797ms | 3 | 0 |
| Alertas | `/asistencia/alertas` | 75ms | 4662ms | 4 | 0 |
| Auditoría | `/auditoria` | 77ms | 1355ms | 4 | 0 |
| Carga Horaria | `/horas` | 71ms | 4904ms | 4 | 0 |
| Documentos | `/documentacion` | 57ms | 2159ms | 4 | 0 |
| Logout | `(acción de sidebar, no una pantalla)` | 41ms | — | 0 | 0 |

## 6. Pantallas no cubiertas y motivo

Ninguna — las 14 pantallas mínimas pedidas se recorrieron.

## 7. Errores frontend encontrados

Ninguno — sin errores de consola ni `pageerror` durante todo el recorrido.

## 8. Requests backend detectadas por pantalla

### Login

| Método | Path | Status | Duración |
|---|---|---|---|
| POST | `/api/auth/login` | 200 | 1127ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 847ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 1021ms |
| GET | `/api/audit` | 200 | 2446ms |
| GET | `/api/audit` | 200 | 2448ms |
| GET | `/api/dashboard/metrics` | 200 | 4927ms |

### Dashboard

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/audit` | 200 | 2ms |
| GET | `/api/dashboard/metrics` | 200 | 2ms |
| GET | `/api/audit` | 200 | 3ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 409ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 595ms |

### Legajos / Empleados

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 759ms |
| GET | `/api/employees/summary` | 200 | 767ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 929ms |
| GET | `/api/employees` | 200 | 1879ms |
| GET | `/api/org-structure` | 200 | 2647ms |
| GET | `/api/employees` | 200 | 1591ms |

### Detalle de un legajo existente

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 174ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 355ms |
| GET | `/api/employees/:id/overview` | 200 | 387ms |
| GET | `/api/employees/:id/overview` | 200 | 389ms |
| GET | `/api/salary-categories` | 200 | 395ms |
| GET | `/api/audit` | 200 | 776ms |
| GET | `/api/employees/:id/overview-details` | 200 | 4611ms |
| GET | `/api/employees/:id/overview-details` | 200 | 4821ms |

### Conceptos Horarios

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/hour-concepts` | 200 | 392ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 416ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 609ms |

### Tipos de Novedades

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 430ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 622ms |
| GET | `/api/novelty-types` | 200 | 1049ms |

### Categorías Documentales

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 412ms |
| GET | `/api/document-categories` | 200 | 409ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 629ms |

### Horas Especiales

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 598ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 785ms |
| GET | `/api/workforce/double-hour-rules/calendar` | 200 | 1341ms |
| GET | `/api/workforce/double-hour-rules/calendar` | 200 | 1955ms |
| GET | `/api/workforce/double-hour-rules` | 200 | 1956ms |
| GET | `/api/workforce/double-hour-rules` | 200 | 1957ms |
| GET | `/api/positions` | 200 | 4391ms |

### Turnos

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 196ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 379ms |
| GET | `/api/workforce/shift-templates` | 200 | 372ms |
| GET | `/api/shifts/assignments/summary` | 200 | 381ms |
| GET | `/api/workforce/shift-templates` | 200 | 641ms |
| GET | `/api/shifts/assignments/summary` | 200 | 846ms |

### Regímenes Laborales

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 224ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 417ms |
| GET | `/api/work-regimes` | 200 | 1228ms |

### Alertas

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 413ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 634ms |
| GET | `/api/shifts/alerts` | 200 | 2422ms |
| GET | `/api/shifts/alerts` | 200 | 4103ms |

### Auditoría

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 430ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 617ms |
| GET | `/api/audit` | 200 | 792ms |
| GET | `/api/audit` | 200 | 793ms |

### Carga Horaria

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 353ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 529ms |
| GET | `/api/time-entries/summary` | 200 | 572ms |
| GET | `/api/time-entries/period-employees` | 200 | 4339ms |

### Documentos

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 849ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 1041ms |
| GET | `/api/documents` | 200 | 1613ms |
| GET | `/api/documents` | 200 | 1615ms |

### Logout

Sin requests a la API capturadas en esta pantalla.

## 9. Endpoints más lentos

| Endpoint | Máx. | Promedio | Llamadas |
|---|---|---|---|
| `GET /api/dashboard/metrics` | 4927ms | 2465ms | 2 |
| `GET /api/employees/:id/overview-details` | 4821ms | 4716ms | 2 |
| `GET /api/positions` | 4391ms | 4391ms | 1 |
| `GET /api/time-entries/period-employees` | 4339ms | 4339ms | 1 |
| `GET /api/shifts/alerts` | 4103ms | 3263ms | 2 |
| `GET /api/org-structure` | 2647ms | 2647ms | 1 |
| `GET /api/audit` | 2448ms | 1037ms | 7 |
| `GET /api/workforce/double-hour-rules` | 1957ms | 1957ms | 2 |
| `GET /api/workforce/double-hour-rules/calendar` | 1955ms | 1648ms | 2 |
| `GET /api/employees` | 1879ms | 1735ms | 2 |

## 10. Endpoints llamados más veces

| Endpoint | Llamadas | Promedio | Máx. |
|---|---|---|---|
| `GET /api/workforce/notifications-unread-count` | 28 | 560ms | 1041ms |
| `GET /api/audit` | 7 | 1037ms | 2448ms |
| `GET /api/dashboard/metrics` | 2 | 2465ms | 4927ms |
| `GET /api/employees` | 2 | 1735ms | 1879ms |
| `GET /api/employees/:id/overview` | 2 | 388ms | 389ms |
| `GET /api/employees/:id/overview-details` | 2 | 4716ms | 4821ms |
| `GET /api/workforce/double-hour-rules/calendar` | 2 | 1648ms | 1955ms |
| `GET /api/workforce/double-hour-rules` | 2 | 1957ms | 1957ms |
| `GET /api/workforce/shift-templates` | 2 | 507ms | 641ms |
| `GET /api/shifts/assignments/summary` | 2 | 614ms | 846ms |

## 11. Endpoints con status >= 400

Ninguno — todas las respuestas capturadas fueron < 400.

## 12. Ranking preliminar de optimización

Umbrales usados (mismos defaults que `PERFORMANCE_SLOW_REQUEST_MS`/`PERFORMANCE_VERY_SLOW_REQUEST_MS` de la Etapa 14B.2): slow=1000ms, verySlow=3000ms.

### Crítico

- `GET /api/dashboard/metrics` — máx 4927ms, promedio 2465ms, 2 llamada(s)
- `GET /api/employees/:id/overview-details` — máx 4821ms, promedio 4716ms, 2 llamada(s)
- `GET /api/positions` — máx 4391ms, promedio 4391ms, 1 llamada(s)
- `GET /api/shifts/alerts` — máx 4103ms, promedio 3263ms, 2 llamada(s)
- `GET /api/time-entries/period-employees` — máx 4339ms, promedio 4339ms, 1 llamada(s)

### Alto

- `POST /api/auth/login` — máx 1127ms, promedio 1127ms, 1 llamada(s)
- `GET /api/workforce/notifications-unread-count` — máx 1041ms, promedio 560ms, 28 llamada(s)
- `GET /api/audit` — máx 2448ms, promedio 1037ms, 7 llamada(s)
- `GET /api/employees` — máx 1879ms, promedio 1735ms, 2 llamada(s)
- `GET /api/org-structure` — máx 2647ms, promedio 2647ms, 1 llamada(s)
- `GET /api/novelty-types` — máx 1049ms, promedio 1049ms, 1 llamada(s)
- `GET /api/workforce/double-hour-rules/calendar` — máx 1955ms, promedio 1648ms, 2 llamada(s)
- `GET /api/workforce/double-hour-rules` — máx 1957ms, promedio 1957ms, 2 llamada(s)
- `GET /api/work-regimes` — máx 1228ms, promedio 1228ms, 1 llamada(s)
- `GET /api/documents` — máx 1615ms, promedio 1614ms, 2 llamada(s)

### Medio

- `GET /api/employees/summary` — máx 767ms, promedio 767ms, 1 llamada(s)
- `GET /api/workforce/shift-templates` — máx 641ms, promedio 507ms, 2 llamada(s)
- `GET /api/shifts/assignments/summary` — máx 846ms, promedio 614ms, 2 llamada(s)
- `GET /api/time-entries/summary` — máx 572ms, promedio 572ms, 1 llamada(s)

### Bajo

- `GET /api/employees/:id/overview` — máx 389ms, promedio 388ms, 2 llamada(s)
- `GET /api/salary-categories` — máx 395ms, promedio 395ms, 1 llamada(s)
- `GET /api/hour-concepts` — máx 392ms, promedio 392ms, 1 llamada(s)
- `GET /api/document-categories` — máx 409ms, promedio 409ms, 1 llamada(s)

## 13. Recomendación de próxima etapa

Priorizar los 5 endpoint(s) marcados Crítico arriba antes de cualquier otra optimización — confirmar contra los logs JSON de 14B.2 en el backend real (buscar el mismo `path` con `slow:true`/`error:true`) antes de decidir la causa.

Este reporte mide un recorrido puntual con un solo usuario, sin concurrencia — es un complemento del logging real de producción/staging (Etapa 14B.2), no un reemplazo. Antes de decidir una etapa de optimización (14C+), cruzar estos hallazgos con logs reales acumulados en el tiempo.
