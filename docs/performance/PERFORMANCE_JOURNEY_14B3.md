# Performance Journey — Etapa 14B.3

Reporte generado automáticamente. No editar a mano — se sobreescribe en cada corrida de `npm run perf:journey`.

## 1. Fecha/hora

2026-09-03T16:36:25.885Z

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
| Login | `/` | 378ms | 6990ms | 6 | 0 |
| Dashboard | `/` | 88ms | 1130ms | 5 | 0 |
| Legajos / Empleados | `/legajos` | 80ms | 4865ms | 5 | 0 |
| Detalle de un legajo existente | `/legajos/:id` | 828ms | 6052ms | 8 | 0 |
| Conceptos Horarios | `/configuracion/conceptos-horarios` | 78ms | 1722ms | 3 | 0 |
| Tipos de Novedades | `/configuracion/tipos-novedades` | 72ms | 1309ms | 3 | 0 |
| Categorías Documentales | `/configuracion/categorias-documentales` | 77ms | 930ms | 3 | 0 |
| Horas Especiales | `/configuracion/turnos-horas-especiales` | 78ms | 4987ms | 7 | 0 |
| Turnos | `/configuracion/turnos` | 79ms | 1351ms | 6 | 0 |
| Regímenes Laborales | `/configuracion/regimenes-laborales` | 73ms | 2017ms | 3 | 0 |
| Alertas | `/asistencia/alertas` | 74ms | 4342ms | 4 | 0 |
| Auditoría | `/auditoria` | 68ms | 2614ms | 4 | 0 |
| Carga Horaria | `/horas` | 71ms | 7333ms | 4 | 0 |
| Documentos | `/documentacion` | 75ms | 1943ms | 4 | 0 |
| Logout | `(acción de sidebar, no una pantalla)` | 31ms | — | 0 | 0 |

## 6. Pantallas no cubiertas y motivo

Ninguna — las 14 pantallas mínimas pedidas se recorrieron.

## 7. Errores frontend encontrados

Ninguno — sin errores de consola ni `pageerror` durante todo el recorrido.

## 8. Requests backend detectadas por pantalla

### Login

| Método | Path | Status | Duración |
|---|---|---|---|
| POST | `/api/auth/login` | 200 | 1070ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 772ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 952ms |
| GET | `/api/audit` | 200 | 3003ms |
| GET | `/api/audit` | 200 | 3005ms |
| GET | `/api/dashboard/metrics` | 200 | 5028ms |

### Dashboard

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/audit` | 200 | 1ms |
| GET | `/api/dashboard/metrics` | 200 | 1ms |
| GET | `/api/audit` | 200 | 2ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 389ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 582ms |

### Legajos / Empleados

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 666ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 841ms |
| GET | `/api/employees/summary` | 200 | 1939ms |
| GET | `/api/org-structure` | 200 | 2724ms |
| GET | `/api/employees` | 200 | 4294ms |

### Detalle de un legajo existente

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 400ms |
| GET | `/api/employees/:id/overview` | 200 | 375ms |
| GET | `/api/salary-categories` | 200 | 383ms |
| GET | `/api/employees/:id/overview` | 200 | 554ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 948ms |
| GET | `/api/audit` | 200 | 1453ms |
| GET | `/api/employees/:id/overview-details` | 200 | 5477ms |
| GET | `/api/employees/:id/overview-details` | 200 | 5479ms |

### Conceptos Horarios

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/hour-concepts` | 200 | 729ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 917ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 1171ms |

### Tipos de Novedades

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 224ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 397ms |
| GET | `/api/novelty-types` | 200 | 748ms |

### Categorías Documentales

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 195ms |
| GET | `/api/document-categories` | 200 | 354ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 383ms |

### Horas Especiales

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 249ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 437ms |
| GET | `/api/workforce/double-hour-rules/calendar` | 200 | 1310ms |
| GET | `/api/workforce/double-hour-rules` | 200 | 1448ms |
| GET | `/api/workforce/double-hour-rules` | 200 | 1651ms |
| GET | `/api/workforce/double-hour-rules/calendar` | 200 | 2161ms |
| GET | `/api/positions` | 200 | 4420ms |

### Turnos

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/shifts/assignments/summary` | 200 | 421ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 434ms |
| GET | `/api/workforce/shift-templates` | 200 | 425ms |
| GET | `/api/workforce/shift-templates` | 200 | 427ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 617ms |
| GET | `/api/shifts/assignments/summary` | 200 | 786ms |

### Regímenes Laborales

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 450ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 630ms |
| GET | `/api/work-regimes` | 200 | 1457ms |

### Alertas

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 192ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 376ms |
| GET | `/api/shifts/alerts` | 200 | 2364ms |
| GET | `/api/shifts/alerts` | 200 | 3782ms |

### Auditoría

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 458ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 643ms |
| GET | `/api/audit` | 200 | 2062ms |
| GET | `/api/audit` | 200 | 2064ms |

### Carga Horaria

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 432ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 676ms |
| GET | `/api/time-entries/summary` | 200 | 2652ms |
| GET | `/api/time-entries/period-employees` | 200 | 6767ms |

### Documentos

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 348ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 563ms |
| GET | `/api/documents` | 200 | 1368ms |
| GET | `/api/documents` | 200 | 1370ms |

### Logout

Sin requests a la API capturadas en esta pantalla.

## 9. Endpoints más lentos

| Endpoint | Máx. | Promedio | Llamadas |
|---|---|---|---|
| `GET /api/time-entries/period-employees` | 6767ms | 6767ms | 1 |
| `GET /api/employees/:id/overview-details` | 5479ms | 5478ms | 2 |
| `GET /api/dashboard/metrics` | 5028ms | 2515ms | 2 |
| `GET /api/positions` | 4420ms | 4420ms | 1 |
| `GET /api/employees` | 4294ms | 4294ms | 1 |
| `GET /api/shifts/alerts` | 3782ms | 3073ms | 2 |
| `GET /api/audit` | 3005ms | 1656ms | 7 |
| `GET /api/org-structure` | 2724ms | 2724ms | 1 |
| `GET /api/time-entries/summary` | 2652ms | 2652ms | 1 |
| `GET /api/workforce/double-hour-rules/calendar` | 2161ms | 1736ms | 2 |

## 10. Endpoints llamados más veces

| Endpoint | Llamadas | Promedio | Máx. |
|---|---|---|---|
| `GET /api/workforce/notifications-unread-count` | 28 | 548ms | 1171ms |
| `GET /api/audit` | 7 | 1656ms | 3005ms |
| `GET /api/dashboard/metrics` | 2 | 2515ms | 5028ms |
| `GET /api/employees/:id/overview` | 2 | 465ms | 554ms |
| `GET /api/employees/:id/overview-details` | 2 | 5478ms | 5479ms |
| `GET /api/workforce/double-hour-rules/calendar` | 2 | 1736ms | 2161ms |
| `GET /api/workforce/double-hour-rules` | 2 | 1550ms | 1651ms |
| `GET /api/shifts/assignments/summary` | 2 | 604ms | 786ms |
| `GET /api/workforce/shift-templates` | 2 | 426ms | 427ms |
| `GET /api/shifts/alerts` | 2 | 3073ms | 3782ms |

## 11. Endpoints con status >= 400

Ninguno — todas las respuestas capturadas fueron < 400.

## 12. Ranking preliminar de optimización

Umbrales usados (mismos defaults que `PERFORMANCE_SLOW_REQUEST_MS`/`PERFORMANCE_VERY_SLOW_REQUEST_MS` de la Etapa 14B.2): slow=1000ms, verySlow=3000ms.

### Crítico

- `GET /api/audit` — máx 3005ms, promedio 1656ms, 7 llamada(s)
- `GET /api/dashboard/metrics` — máx 5028ms, promedio 2515ms, 2 llamada(s)
- `GET /api/employees` — máx 4294ms, promedio 4294ms, 1 llamada(s)
- `GET /api/employees/:id/overview-details` — máx 5479ms, promedio 5478ms, 2 llamada(s)
- `GET /api/positions` — máx 4420ms, promedio 4420ms, 1 llamada(s)
- `GET /api/shifts/alerts` — máx 3782ms, promedio 3073ms, 2 llamada(s)
- `GET /api/time-entries/period-employees` — máx 6767ms, promedio 6767ms, 1 llamada(s)

### Alto

- `POST /api/auth/login` — máx 1070ms, promedio 1070ms, 1 llamada(s)
- `GET /api/workforce/notifications-unread-count` — máx 1171ms, promedio 548ms, 28 llamada(s)
- `GET /api/employees/summary` — máx 1939ms, promedio 1939ms, 1 llamada(s)
- `GET /api/org-structure` — máx 2724ms, promedio 2724ms, 1 llamada(s)
- `GET /api/workforce/double-hour-rules/calendar` — máx 2161ms, promedio 1736ms, 2 llamada(s)
- `GET /api/workforce/double-hour-rules` — máx 1651ms, promedio 1550ms, 2 llamada(s)
- `GET /api/work-regimes` — máx 1457ms, promedio 1457ms, 1 llamada(s)
- `GET /api/time-entries/summary` — máx 2652ms, promedio 2652ms, 1 llamada(s)
- `GET /api/documents` — máx 1370ms, promedio 1369ms, 2 llamada(s)

### Medio

- `GET /api/hour-concepts` — máx 729ms, promedio 729ms, 1 llamada(s)
- `GET /api/novelty-types` — máx 748ms, promedio 748ms, 1 llamada(s)
- `GET /api/shifts/assignments/summary` — máx 786ms, promedio 604ms, 2 llamada(s)

### Bajo

- `GET /api/employees/:id/overview` — máx 554ms, promedio 465ms, 2 llamada(s)
- `GET /api/salary-categories` — máx 383ms, promedio 383ms, 1 llamada(s)
- `GET /api/document-categories` — máx 354ms, promedio 354ms, 1 llamada(s)
- `GET /api/workforce/shift-templates` — máx 427ms, promedio 426ms, 2 llamada(s)

## 13. Recomendación de próxima etapa

Priorizar los 7 endpoint(s) marcados Crítico arriba antes de cualquier otra optimización — confirmar contra los logs JSON de 14B.2 en el backend real (buscar el mismo `path` con `slow:true`/`error:true`) antes de decidir la causa.

Este reporte mide un recorrido puntual con un solo usuario, sin concurrencia — es un complemento del logging real de producción/staging (Etapa 14B.2), no un reemplazo. Antes de decidir una etapa de optimización (14C+), cruzar estos hallazgos con logs reales acumulados en el tiempo.
