# PERF-5G — runbook de medición en public staging

Fecha: 2026-10-16. Estado: **listo para ejecutar** una vez que public staging esté operativo ([PUBLIC_STAGING_PLAN.md](PUBLIC_STAGING_PLAN.md)). El gate y su motivación están en [F12_PERF_5.md](F12_PERF_5.md) ("Cierre local y gate PERF-5G").

Objetivo: medir la latencia real de la fichada con el backend junto a la base y decidir el gate de producto, sin optimizar nada durante la corrida.

| Gate (cliente, clase WARM) | IN | OUT |
|---|---|---|
| p50 | ≤ 1,5 s | ≤ 1,5 s |
| p95 | ≤ 2,0 s | ≤ 2,0 s |

No se asume que se vaya a cumplir. Si no se cumple, **no se optimiza automáticamente** (§9).

## 1. Prerrequisitos (todos obligatorios)

- [ ] Public staging operativo en **fase D** (`AUTOMATIC_JOBS_ENABLED=true`, `CLOCK_POSTPROCESS_WORKER_ENABLED=true`). Logs `CLOCK_POSTPROCESS_WORKER_STARTED` y ticks de mantenimiento sin errores.
- [ ] Una sola instancia del backend y **ningún** otro backend con workers o schedulers contra la rama `development` (incluido el local).
- [ ] Migraciones al día: `prisma migrate status` "up to date" y diff contra `schema.prisma` vacío.
- [ ] Los 14 archive jobs de [PUBLIC_STAGING_PLAN.md](PUBLIC_STAGING_PLAN.md) §13 `COMPLETED`, y backlog 0: ningún `ClockPunchPostProcessJob` ni `StorageArchiveJob` en estado distinto de `COMPLETED` (§6.3).
- [ ] HTTPS válido en API, admin y fichador; CORS exacto; CSP del fichador con `connect-src` = origin de la API.
- [ ] `TRUST_PROXY_HOPS` medido y validado (con spoofing) y la sonda de IP apagada (404).
- [ ] `PERFORMANCE_LOGGING_ENABLED=true` y `PERFORMANCE_LOGGING_SAMPLE_RATE=1`.
- [ ] Dos `ClockDevice` de prueba **ACTIVE**, enrolados por pairing real desde el admin.
- [ ] Legajos de prueba 29, 30, 31 y 32 sin jornada abierta. Aceptadas las alertas y avisos de prueba que van a generar: jornadas de un par de minutos y, en el 32, sin turno.
- [ ] SHA desplegado anotado; ningún deploy ni reinicio no planificado durante la corrida.

Si falta cualquiera, no se empieza.

## 2. Clases de muestra

| Clase | Definición | Mínimo |
|---|---|---|
| **COLD PROCESS** | Primera fichada de un proceso nuevo, después de un deploy o un "Restart service" de Render, con el health ya en 200. Pool, prepared statements, conexión TLS al storage y JIT están fríos. No incluye el arranque del hosting: la instancia ya está escuchando | ≥ 3 IN y ≥ 3 OUT |
| **COLD STORAGE** | Proceso tibio, pero 5 min o más sin ninguna request a `/api/clock/*`. La conexión al storage está cerrada (undici cierra los sockets ociosos a ~4 s). La DB sigue despierta por el polling de los workers | ≥ 3 IN y ≥ 3 OUT |
| **WARM** | Menos de 60 s desde la fichada anterior en ese proceso. Proceso, pool y prepared statements ya usados | **≥ 20 IN y ≥ 20 OUT** |
| **BURST** | Segunda fichada de un par lanzado con menos de 4 s de diferencia (otro legajo), para observar si se reutiliza la conexión al storage | 3 pares |

Cada muestra se clasifica **antes** de mandarla y la clase no se corrige después. Las clases no se mezclan en las métricas.

## 3. Herramienta de cliente

Un driver HTTP fuera del repo, con el mismo contrato que la PWA, que corre **desde la red real del cliente** (Argentina), no desde el datacenter.

- **Request:** `POST https://<api-staging>/api/clock/photo-punch` con:
  - `Authorization: ClockDevice <id>.<secret>` y `X-Clock-App-Version`;
  - un `requestId` UUID nuevo por intención;
  - foto JPEG real de ~35 KB (canvas 800×600, calidad 0,84) más thumbnail (240×180, calidad 0,76), `faceValidationStatus: "VALID"`.
- **Flujo del kiosco antes de cada fichada:** `GET /api/clock/employees` y `POST /api/clock/status`. No entran en la duración de la fichada, pero cuentan para los rate limits.
- **`clientTotal`:** desde justo antes del `fetch` hasta leer el body de la respuesta. Timeout de 20 s, como la PWA. Si el resultado es incierto (timeout, red, 5xx), se recupera por `GET /api/clock/attempts/:requestId` y la muestra se descarta de las métricas de latencia (se reporta aparte).
- **Por muestra se registra:** `requestId`, `punchType`, clase, legajo, dispositivo, instante de inicio, `clientTotal`, status HTTP y código de error.
- **Secretos:** el secreto del dispositivo nunca se imprime ni se guarda en el repo (archivo local con permisos 0600).

## 4. Ritmo y rate limits

Los límites **no se relajan**. Con 2 dispositivos y 4 legajos en rotación:

- una fichada cada ~22 s, alternando dispositivo;
- cada legajo alterna IN/OUT y ficha cada ~88 s, por encima del cooldown de 60 s;
- por dispositivo: 3 requests cada ~44 s ≈ 21 cada 5 min, bajo el cupo de 30;
- desde la IP del driver: ≈ 125 requests cada 15 min, bajo el global de 300;
- la corrida WARM (40 fichadas) dura ~15 min.

Cualquier 429 aborta la corrida (§7).

## 5. Procedimiento

1. **Contexto de red.** Registrar fecha y hora, SHA desplegado, región e instancia de Render, y tipo de red del cliente (ISP o datos móviles).
   - **Cliente → API:** 10 veces
     `curl -s -o /dev/null -w 'dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' https://<api-staging>/api/health`
   - **Backend → DB:** 10 llamadas a `/api/health` y leer `queryTimeMs` en los logs `http_request` (el health hace un único `SELECT 1`).
2. **COLD PROCESS** (6 reinicios): "Restart service" en Render. Esperar el log `Backend API listening`, `CLOCK_POSTPROCESS_WORKER_STARTED` y health 200. Mandar una sola fichada y anotar los segundos transcurridos desde el arranque. Alternar IN y OUT con legajos distintos.
3. **WARM:** con el proceso ya usado, ≥ 20 IN y ≥ 20 OUT al ritmo de §4.
4. **BURST:** 3 pares de fichadas con menos de 4 s entre sí, con legajos distintos y respetando el cooldown de cada uno.
5. **COLD STORAGE:** 6 ventanas de 5 min o más sin requests al fichador. Después de cada ventana, una sola fichada, alternando IN y OUT.
6. **Cierre:** ningún legajo de prueba queda con jornada abierta (la última fichada de cada uno es un OUT). Esperar a que el backlog de jobs llegue a 0 y recolectar (§6). Revocar los dos dispositivos desde el admin **al terminar la recolección**. No se borra nada.

## 6. Recolección

### 6.1 Por request (logs del backend, por `requestId`)

Desde los eventos `clock_punch_timing` (un JSON por fase) y `clock_punch_query_budget`:

| Campo | Fuente |
|---|---|
| `auth`, `parse` | Fases `auth` y `parse` |
| `primary_upload` (STORAGE) | Fase `primary_upload` |
| `transaction_acquire`, `transaction_core` | Fases homónimas. TX = suma de ambas |
| `response_write` | Fase `http_response_write`: desde la entrada al controller hasta el `finish` de la respuesta |
| `serverTotal` | `auth + parse + http_response_write` |
| `pre` | `serverTotal − TX − post_commit` (incluye contexto, intento, upload y lecturas previas) |
| `post_commit` | Fase `post_commit` (debe ser ~0) |
| Query count | `clock_punch_query_budget`: `pre`, `tx`, `post` (operaciones Prisma; **post = 0**) |

Si la retención de logs de Render no alcanza, exportar los de la ventana de la corrida a un archivo apenas termina.

### 6.2 Post-proceso y archivo (DB, sólo lectura)

En una sesión de sólo lectura contra la rama `development`:

```sql
SET default_transaction_read_only = on;

SELECT substring(sf."storageKey" FROM '([0-9a-f-]{36})\.[a-z]+$') AS request_id,
       j.kind,
       j.status                                              AS postprocess_status,
       j."attemptCount"                                      AS postprocess_attempts,
       EXTRACT(EPOCH FROM (j."completedAt" - j."createdAt")) * 1000 AS postprocess_lag_ms,
       a.status                                              AS archive_status,
       a."attemptCount"                                      AS archive_attempts,
       EXTRACT(EPOCH FROM (a."completedAt" - a."createdAt")) * 1000 AS archive_lag_ms
FROM "StorageFile" sf
JOIN "ClockPunchPostProcessJob" j ON j."attendancePunchId" = sf."attendancePunchId"
LEFT JOIN "StorageArchiveJob" a ON a."sourceStorageFileId" = sf.id
WHERE sf.module = 'FICHADAS'
  AND sf."createdAt" BETWEEN '<inicio UTC>' AND '<fin UTC>'
ORDER BY sf."createdAt";
```

### 6.3 Backlog (antes y después de la corrida)

```sql
SET default_transaction_read_only = on;
SELECT kind, status, count(*) FROM "ClockPunchPostProcessJob" WHERE status <> 'COMPLETED' GROUP BY 1, 2;
SELECT status, count(*) FROM "StorageArchiveJob" WHERE status <> 'COMPLETED' GROUP BY 1;
```

Antes de empezar las dos consultas tienen que dar vacío. Después, deben volver a vacío sin `FAILED`.

## 7. Criterios de aborto

La corrida se detiene y se analiza, sin optimizar, si ocurre cualquiera de estos eventos:

- un 5xx o un 429 en cualquier request del driver;
- un `CLOCK_POSTPROCESS_FAILED` o un `STORAGE_ARCHIVE_FAILED`, o un job que no llega a `COMPLETED`;
- `post ≠ 0` en `clock_punch_query_budget`;
- cantidad de fichadas distinta de la cantidad de jobs de post-proceso o de archivo;
- un deploy o reinicio fuera de lo planificado (revisar los logs de arranque);
- una fichada duplicada para la misma intención.

## 8. Reporte

Por **IN** y **OUT**, y por clase (WARM, COLD PROCESS, COLD STORAGE, BURST):

| Métrica | n | min | p50 | p90 | p95 | max |
|---|---|---|---|---|---|---|
| CLIENT TOTAL | | | | | | |
| SERVER TOTAL | | | | | | |
| PRE | | | | | | |
| STORAGE (`primary_upload`) | | | | | | |
| TX | | | | | | |

- **Query count:** min, mediana y max de `pre` / `tx` / `post`.
- **Post-proceso:** p50, p95 y max de lag; intentos; cantidad de `FAILED`.
- **Archivo:** p50, p95 y max de lag; intentos; cantidad de `FAILED`.
- **Contexto:** RTT cliente→API (`connect`/`tls`/`ttfb`), RTT backend→DB (`queryTimeMs`), SHA, región, instancia y red del cliente.

**Cálculo de percentiles:** interpolación lineal entre rangos (con n = 20, p95 queda entre el 19.º y el 20.º valor ordenado). p95 sólo se informa con n ≥ 20; con n < 20 se informan p50, p90 y max. Si el p95 WARM queda a menos del 10 % del umbral, ampliar a 40 por tipo antes de decidir.

## 9. Decisión

- **PASS:** en la clase WARM, medida desde el cliente, p50 ≤ 1,5 s **y** p95 ≤ 2,0 s, tanto en IN como en OUT. Se cierra F12-PERF.
- **COLD PROCESS y COLD STORAGE** se reportan aparte y no deciden el gate. Como en un kiosco la fichada después de varios minutos sin uso es habitual, un p50 de COLD STORAGE > 2,0 s se marca **OBSERVAR** aunque el gate dé PASS.
- **FAIL:** no se optimiza automáticamente. Se determina qué fase domina:
  - red del cliente (`clientTotal − serverTotal`);
  - PRE;
  - STORAGE;
  - TX;
  - post-proceso compitiendo con la fichada siguiente (se compara con los tiempos de los jobs).

  Posibles etapas siguientes, sólo como ejemplos y **cada una con aprobación propia**:
  - precalentar la conexión al storage (propuesta de PERF-5E);
  - reducir round trips de la transacción;
  - revisar la topología de la DB o del pool de conexiones;
  - revisar la región del hosting.

## 10. Después de PERF-5G

El mismo public staging sirve para la validación física: la matriz de [FICHADOR_F12_LOCAL_CLOSURE_AND_DEVICE_COMPATIBILITY.md](FICHADOR_F12_LOCAL_CLOSURE_AND_DEVICE_COMPATIBILITY.md) con la checklist de §31.9 del plan del fichador. Incluye:

- tablet Android, teléfono Android, iPad/iPadOS y iPhone si aplica;
- PWA instalada y navegador normal;
- cámara;
- background/foreground;
- offline/recovery.

No bloquea PERF-5G.
