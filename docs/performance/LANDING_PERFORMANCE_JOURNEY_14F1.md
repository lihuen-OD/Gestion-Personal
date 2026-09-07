# Landing Performance Journey — Login → primer contenido (Etapa 14F.1)

Reporte generado automáticamente por `npm run perf:journey:landing`. No editar a mano — se sobreescribe en cada corrida.

Generado: 2026-09-07T13:15:05.973Z · Comando: `npm run perf:journey:landing (desde frontend/)` · Frontend: http://localhost:5174 · Backend: http://localhost:4002/api

Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.

## 1. Corridas

| Corrida | Login visible | Login network idle | Requests totales | HTTP errors | Console errors | Endpoint más lento | Observación |
|---|---|---|---|---|---|---|---|
| fría | 2238ms | 6359ms | 6 | 0 | 0 | GET /api/dashboard/metrics (4060ms) | 2 endpoint(s) duplicados: GET /api/workforce/notifications-unread-count x2, GET /api/audit x2 |
| tibia (logout + login inmediato — cache backend probablemente vigente) | 886ms | 3406ms | 6 | 0 | 0 | GET /api/audit (2014ms) | 2 endpoint(s) duplicados: GET /api/workforce/notifications-unread-count x2, GET /api/audit x2 |
| después de 16s (cache de audit vencido, cache de dashboard probablemente aún vigente — no es una corrida fría) | 1358ms | 3328ms | 6 | 0 | 0 | GET /api/dashboard/metrics (1677ms) | 2 endpoint(s) duplicados: GET /api/workforce/notifications-unread-count x2, GET /api/audit x2 |

## 2. Detalle — corrida "fría"

### Requests (orden de inicio)

| Método | Path | Status | Duración | Inicio (offset) | Fin (offset) |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | 200 | 1223ms | 542ms | 1765ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 737ms | 1785ms | 2522ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 918ms | 1786ms | 2704ms |
| GET | `/api/audit` | 200 | 3246ms | 1797ms | 5043ms |
| GET | `/api/dashboard/metrics` | 200 | 4060ms | 1798ms | 5858ms |
| GET | `/api/audit` | 200 | 3248ms | 1813ms | 5061ms |

### Duplicados

- **GET /api/workforce/notifications-unread-count** — 2 llamadas (737ms, 918ms)
- **GET /api/audit** — 2 llamadas (3246ms, 3248ms)

## 2. Detalle — corrida "tibia (logout + login inmediato — cache backend probablemente vigente)"

### Requests (orden de inicio)

| Método | Path | Status | Duración | Inicio (offset) | Fin (offset) |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | 200 | 769ms | 101ms | 870ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 898ms | 881ms | 1779ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 718ms | 882ms | 1600ms |
| GET | `/api/dashboard/metrics` | 200 | 1293ms | 891ms | 2184ms |
| GET | `/api/audit` | 200 | 2012ms | 891ms | 2903ms |
| GET | `/api/audit` | 200 | 2014ms | 891ms | 2905ms |

### Duplicados

- **GET /api/workforce/notifications-unread-count** — 2 llamadas (718ms, 898ms)
- **GET /api/audit** — 2 llamadas (2012ms, 2014ms)

## 2. Detalle — corrida "después de 16s (cache de audit vencido, cache de dashboard probablemente aún vigente — no es una corrida fría)"

### Requests (orden de inicio)

| Método | Path | Status | Duración | Inicio (offset) | Fin (offset) |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | 200 | 1054ms | 77ms | 1131ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 726ms | 1141ms | 1867ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 912ms | 1141ms | 2053ms |
| GET | `/api/audit` | 200 | 910ms | 1149ms | 2059ms |
| GET | `/api/audit` | 200 | 908ms | 1150ms | 2058ms |
| GET | `/api/dashboard/metrics` | 200 | 1677ms | 1150ms | 2827ms |

### Duplicados

- **GET /api/workforce/notifications-unread-count** — 2 llamadas (726ms, 912ms)
- **GET /api/audit** — 2 llamadas (908ms, 910ms)
