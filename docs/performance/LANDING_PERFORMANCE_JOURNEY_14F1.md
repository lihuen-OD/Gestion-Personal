# Landing Performance Journey — Login → primer contenido (Etapa 14F.1)

Reporte generado automáticamente por `npm run perf:journey:landing`. No editar a mano — se sobreescribe en cada corrida.

Generado: 2026-09-07T13:51:49.436Z · Comando: `npm run perf:journey:landing (desde frontend/)` · Frontend: http://localhost:5174 · Backend: http://localhost:4002/api

Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.

## 1. Corridas

| Corrida | Login visible | Login network idle | Requests totales | HTTP errors | Console errors | Endpoint más lento | Observación |
|---|---|---|---|---|---|---|---|
| fría | 1900ms | 6460ms | 4 | 0 | 0 | GET /api/dashboard/metrics (4190ms) | sin duplicados |
| tibia (logout + login inmediato — cache backend probablemente vigente) | 1371ms | 3580ms | 4 | 0 | 0 | GET /api/audit (2089ms) | sin duplicados |
| después de 16s (cache de audit vencido, cache de dashboard probablemente aún vigente — no es una corrida fría) | 1366ms | 3562ms | 4 | 0 | 0 | GET /api/dashboard/metrics (1992ms) | sin duplicados |

## 2. Detalle — corrida "fría"

### Requests (orden de inicio)

| Método | Path | Status | Duración | Inicio (offset) | Fin (offset) |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | 200 | 1144ms | 592ms | 1736ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 776ms | 1761ms | 2537ms |
| GET | `/api/dashboard/metrics` | 200 | 4190ms | 1769ms | 5959ms |
| GET | `/api/audit` | 200 | 2053ms | 1770ms | 3823ms |

### Duplicados

Sin duplicados en esta corrida.

## 2. Detalle — corrida "tibia (logout + login inmediato — cache backend probablemente vigente)"

### Requests (orden de inicio)

| Método | Path | Status | Duración | Inicio (offset) | Fin (offset) |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | 200 | 879ms | 88ms | 967ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 729ms | 979ms | 1708ms |
| GET | `/api/dashboard/metrics` | 200 | 1489ms | 990ms | 2479ms |
| GET | `/api/audit` | 200 | 2089ms | 990ms | 3079ms |

### Duplicados

Sin duplicados en esta corrida.

## 2. Detalle — corrida "después de 16s (cache de audit vencido, cache de dashboard probablemente aún vigente — no es una corrida fría)"

### Requests (orden de inicio)

| Método | Path | Status | Duración | Inicio (offset) | Fin (offset) |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | 200 | 970ms | 84ms | 1054ms |
| GET | `/api/workforce/notifications-unread-count` | 200 | 722ms | 1060ms | 1782ms |
| GET | `/api/audit` | 200 | 880ms | 1069ms | 1949ms |
| GET | `/api/dashboard/metrics` | 200 | 1992ms | 1069ms | 3061ms |

### Duplicados

Sin duplicados en esta corrida.
