# Performance Journey — Etapa 14B.3

Reporte generado automáticamente. No editar a mano — se sobreescribe en cada corrida de `npm run perf:journey`.

## 1. Fecha/hora

2026-09-03T17:08:29.857Z

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
| Login | `/` | 544ms | 7055ms | 6 | 0 |
| Dashboard | `/` | 74ms | 1055ms | 5 | 0 |
| Legajos / Empleados | `/legajos` | 78ms | 2979ms | 5 | 0 |
| Detalle de un legajo existente | `/legajos/:id` | 831ms | 4815ms | 8 | 0 |
| Conceptos Horarios | `/configuracion/conceptos-horarios` | 75ms | 935ms | 3 | 0 |
| Tipos de Novedades | `/configuracion/tipos-novedades` | 76ms | 1313ms | 3 | 0 |
| Categorías Documentales | `/configuracion/categorias-documentales` | 71ms | 1386ms | 3 | 0 |
| Horas Especiales | `/configuracion/turnos-horas-especiales` | 75ms | 4638ms | 7 | 0 |
| Turnos | `/configuracion/turnos` | 67ms | 1069ms | 6 | 0 |
| Regímenes Laborales | `/configuracion/regimenes-laborales` | 77ms | 1931ms | 3 | 0 |
| Alertas | `/asistencia/alertas` | 76ms | 4107ms | 4 | 0 |
| Auditoría | `/auditoria` | 75ms | 2528ms | 4 | 0 |
| Carga Horaria | `/horas` | 72ms | 7014ms | 4 | 0 |
| Documentos | `/documentacion` | 74ms | 1896ms | 4 | 0 |
| Logout | `(acción de sidebar, no una pantalla)` | 33ms | — | 0 | 0 |

## 6. Pantallas no cubiertas y motivo

Ninguna — las 14 pantallas mínimas pedidas se recorrieron.

## 7. Errores frontend encontrados

Ninguno — sin errores de consola ni `pageerror` durante todo el recorrido.

## 8. Requests backend detectadas por pantalla

### Login

| Método | Path | Status | Duración |
|---|---|---|---|
| POST | `/api/auth/login` | 200 | 1200ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 730ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 1003ms |
| GET | `/api/audit` | 200 | 2133ms |
| GET | `/api/audit` | 200 | 2135ms |
| GET | `/api/dashboard/metrics` | 200 | 4788ms |

### Dashboard

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/audit` | 200 | 1ms |
| GET | `/api/dashboard/metrics` | 200 | 2ms |
| GET | `/api/audit` | 200 | 2ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 342ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 517ms |

### Legajos / Empleados

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 736ms |
| GET | `/api/employees/summary` | 200 | 714ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 903ms |
| GET | `/api/employees` | 200 | 2394ms |
| GET | `/api/org-structure` | 200 | 2390ms |

### Detalle de un legajo existente

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 391ms |
| GET | `/api/salary-categories` | 200 | 369ms |
| GET | `/api/employees/:id/overview` | 200 | 371ms |
| GET | `/api/employees/:id/overview` | 200 | 373ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 577ms |
| GET | `/api/audit` | 200 | 1374ms |
| GET | `/api/employees/:id/overview-details` | 200 | 3903ms |
| GET | `/api/employees/:id/overview-details` | 200 | 4243ms |

### Conceptos Horarios

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 208ms |
| GET | `/api/hour-concepts` | 200 | 366ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 383ms |

### Tipos de Novedades

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 170ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 339ms |
| GET | `/api/novelty-types` | 200 | 751ms |

### Categorías Documentales

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/document-categories` | 200 | 382ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 396ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 844ms |

### Horas Especiales

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 543ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 720ms |
| GET | `/api/workforce/double-hour-rules/calendar` | 200 | 1615ms |
| GET | `/api/workforce/double-hour-rules` | 200 | 1615ms |
| GET | `/api/workforce/double-hour-rules` | 200 | 1617ms |
| GET | `/api/workforce/double-hour-rules/calendar` | 200 | 2525ms |
| GET | `/api/positions` | 200 | 4070ms |

### Turnos

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 174ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 351ms |
| GET | `/api/shifts/assignments/summary` | 200 | 347ms |
| GET | `/api/workforce/shift-templates` | 200 | 353ms |
| GET | `/api/workforce/shift-templates` | 200 | 355ms |
| GET | `/api/shifts/assignments/summary` | 200 | 513ms |

### Regímenes Laborales

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 430ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 598ms |
| GET | `/api/work-regimes` | 200 | 1369ms |

### Alertas

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 226ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 402ms |
| GET | `/api/shifts/alerts` | 200 | 2261ms |
| GET | `/api/shifts/alerts` | 200 | 3546ms |

### Auditoría

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 440ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 608ms |
| GET | `/api/audit` | 200 | 1964ms |
| GET | `/api/audit` | 200 | 1966ms |

### Carga Horaria

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 339ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 565ms |
| GET | `/api/time-entries/summary` | 200 | 2250ms |
| GET | `/api/time-entries/period-employees` | 200 | 6447ms |

### Documentos

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/workforce/notifications-unread-count` | 200 | 558ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 728ms |
| GET | `/api/documents` | 200 | 1331ms |
| GET | `/api/documents` | 200 | 1333ms |

### Logout

Sin requests a la API capturadas en esta pantalla.

## 9. Endpoints más lentos

| Endpoint | Máx. | Promedio | Llamadas |
|---|---|---|---|
| `GET /api/time-entries/period-employees` | 6447ms | 6447ms | 1 |
| `GET /api/dashboard/metrics` | 4788ms | 2395ms | 2 |
| `GET /api/employees/:id/overview-details` | 4243ms | 4073ms | 2 |
| `GET /api/positions` | 4070ms | 4070ms | 1 |
| `GET /api/shifts/alerts` | 3546ms | 2904ms | 2 |
| `GET /api/workforce/double-hour-rules/calendar` | 2525ms | 2070ms | 2 |
| `GET /api/employees` | 2394ms | 2394ms | 1 |
| `GET /api/org-structure` | 2390ms | 2390ms | 1 |
| `GET /api/time-entries/summary` | 2250ms | 2250ms | 1 |
| `GET /api/audit` | 2135ms | 1368ms | 7 |

## 10. Endpoints llamados más veces

| Endpoint | Llamadas | Promedio | Máx. |
|---|---|---|---|
| `GET /api/workforce/notifications-unread-count` | 28 | 508ms | 1003ms |
| `GET /api/audit` | 7 | 1368ms | 2135ms |
| `GET /api/dashboard/metrics` | 2 | 2395ms | 4788ms |
| `GET /api/employees/:id/overview` | 2 | 372ms | 373ms |
| `GET /api/employees/:id/overview-details` | 2 | 4073ms | 4243ms |
| `GET /api/workforce/double-hour-rules/calendar` | 2 | 2070ms | 2525ms |
| `GET /api/workforce/double-hour-rules` | 2 | 1616ms | 1617ms |
| `GET /api/shifts/assignments/summary` | 2 | 430ms | 513ms |
| `GET /api/workforce/shift-templates` | 2 | 354ms | 355ms |
| `GET /api/shifts/alerts` | 2 | 2904ms | 3546ms |

## 11. Endpoints con status >= 400

Ninguno — todas las respuestas capturadas fueron < 400.

## 12. Ranking preliminar de optimización

Umbrales usados (mismos defaults que `PERFORMANCE_SLOW_REQUEST_MS`/`PERFORMANCE_VERY_SLOW_REQUEST_MS` de la Etapa 14B.2): slow=1000ms, verySlow=3000ms.

### Crítico

- `GET /api/dashboard/metrics` — máx 4788ms, promedio 2395ms, 2 llamada(s)
- `GET /api/employees/:id/overview-details` — máx 4243ms, promedio 4073ms, 2 llamada(s)
- `GET /api/positions` — máx 4070ms, promedio 4070ms, 1 llamada(s)
- `GET /api/shifts/alerts` — máx 3546ms, promedio 2904ms, 2 llamada(s)
- `GET /api/time-entries/period-employees` — máx 6447ms, promedio 6447ms, 1 llamada(s)

### Alto

- `POST /api/auth/login` — máx 1200ms, promedio 1200ms, 1 llamada(s)
- `GET /api/workforce/notifications-unread-count` — máx 1003ms, promedio 508ms, 28 llamada(s)
- `GET /api/audit` — máx 2135ms, promedio 1368ms, 7 llamada(s)
- `GET /api/employees` — máx 2394ms, promedio 2394ms, 1 llamada(s)
- `GET /api/org-structure` — máx 2390ms, promedio 2390ms, 1 llamada(s)
- `GET /api/workforce/double-hour-rules/calendar` — máx 2525ms, promedio 2070ms, 2 llamada(s)
- `GET /api/workforce/double-hour-rules` — máx 1617ms, promedio 1616ms, 2 llamada(s)
- `GET /api/work-regimes` — máx 1369ms, promedio 1369ms, 1 llamada(s)
- `GET /api/time-entries/summary` — máx 2250ms, promedio 2250ms, 1 llamada(s)
- `GET /api/documents` — máx 1333ms, promedio 1332ms, 2 llamada(s)

### Medio

- `GET /api/employees/summary` — máx 714ms, promedio 714ms, 1 llamada(s)
- `GET /api/novelty-types` — máx 751ms, promedio 751ms, 1 llamada(s)

### Bajo

- `GET /api/salary-categories` — máx 369ms, promedio 369ms, 1 llamada(s)
- `GET /api/employees/:id/overview` — máx 373ms, promedio 372ms, 2 llamada(s)
- `GET /api/hour-concepts` — máx 366ms, promedio 366ms, 1 llamada(s)
- `GET /api/document-categories` — máx 382ms, promedio 382ms, 1 llamada(s)
- `GET /api/shifts/assignments/summary` — máx 513ms, promedio 430ms, 2 llamada(s)
- `GET /api/workforce/shift-templates` — máx 355ms, promedio 354ms, 2 llamada(s)

## 13. Recomendación de próxima etapa

Priorizar los 5 endpoint(s) marcados Crítico arriba antes de cualquier otra optimización — confirmar contra los logs JSON de 14B.2 en el backend real (buscar el mismo `path` con `slow:true`/`error:true`) antes de decidir la causa.

Este reporte mide un recorrido puntual con un solo usuario, sin concurrencia — es un complemento del logging real de producción/staging (Etapa 14B.2), no un reemplazo. Antes de decidir una etapa de optimización (14C+), cruzar estos hallazgos con logs reales acumulados en el tiempo.
