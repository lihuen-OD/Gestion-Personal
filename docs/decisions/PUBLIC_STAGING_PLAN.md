# Public staging — plan canónico

Fecha: 2026-10-16. Estado: **preparado en el repositorio**. Ningún servicio fue creado ni desplegado.

Este documento es la referencia para crear y operar public staging. Para public staging reemplaza §15, la parte de infraestructura de §20 y §31.3, §31.6 y §31.8 de [FICHADOR_STANDALONE_PWA_PLAN.md](FICHADOR_STANDALONE_PWA_PLAN.md). Siguen vigentes:

- §31.7: medición de `TRUST_PROXY_HOPS`, aplicada acá en §8;
- §31.9: checklist física por dispositivo;
- §31.10: base del rollback, ampliada acá en §16.

La medición de performance que corre sobre este entorno está en [PERF_5G_RUNBOOK.md](PERF_5G_RUNBOOK.md). El gate que la motiva está en [F12_PERF_5.md](F12_PERF_5.md) ("Cierre local y gate PERF-5G").

## 1. Alcance

Public staging es un entorno público con HTTPS real que sirve, en este orden, para:

1. medir PERF-5G con el backend junto a la base;
2. después, validar la compatibilidad física de los dispositivos ([FICHADOR_F12_LOCAL_CLOSURE_AND_DEVICE_COMPATIBILITY.md](FICHADOR_F12_LOCAL_CLOSURE_AND_DEVICE_COMPATIBILITY.md)).

**No es producción.** Usa exclusivamente:

- la rama Neon `development` (la base de staging/testing vigente; no se crea otra);
- el bucket privado de Neon Object Storage de staging (`gestion-personal-fichadas-staging`);
- la carpeta y service account de Google Drive de prueba;
- credenciales, legajos y dispositivos de prueba;
- URLs y subdominios de staging.

Nunca usa la base, el bucket, la carpeta de Drive, los usuarios ni los dispositivos de producción.

Fuera de alcance: producción, F13, reconocimiento facial, cambios de storage, migraciones nuevas y limpieza de datos.

## 2. Arquitectura

```text
Kioscos / RRHH ──HTTPS──> Fichador PWA (Netlify, CDN) ──┐
               ──HTTPS──> Admin (Netlify, CDN) ─────────┤ fetch HTTPS, CORS exacto
                                                        ▼
            Backend staging · Render Web Service Starter · región virginia
            una instancia: HTTP + workers en el mismo proceso
               ├─ TLS ───> Neon PostgreSQL, rama development (aws-us-east-1)
               │           pooled en runtime; directa sólo para migrate
               ├─ HTTPS ─> Neon Object Storage staging (bucket privado; primary de fotos)
               └─ HTTPS ─> Google Drive de prueba (documentos + copia async de fotos)
```

| Componente | Proveedor | Región | Responsabilidad | Secretos | Workers |
|---|---|---|---|---|---|
| Backend | Render, Web Service **Starter** | `virginia` (Virginia, USA) | API, auth, fichadas, jobs | Todos los del backend (§5) | Sí, en el mismo proceso (§11) |
| Fichador | Netlify (sitio propio, base `fichador`) | CDN global | PWA de kiosco: cámara, IndexedDB, service worker | Ninguno (todo `VITE_*` es público) | No |
| Admin | Netlify (sitio propio, base `frontend`) | CDN global | RRHH, pairing, asistencia | Ninguno | No |
| Base | Neon, rama `development` | `aws-us-east-1` (N. Virginia) | Datos | Connection strings | — |
| Fotos | Neon Object Storage | us-east-1 | Primary de evidencia de fichadas | Access key / secret | — |
| Archivo y documentos | Google Drive de prueba | Global | Documentos y copia async de fotos (`StorageArchiveJob`) | Service account | Lo procesa el backend |

**Por qué Render Starter en Virginia.** Neon `aws-us-east-1` está en N. Virginia, y una fichada OUT hace unas 40 sentencias en el camino crítico, así que cada milisegundo de RTT backend→DB se multiplica. Render Virginia es su región más cercana; Ohio sumaría unos 10–15 ms por round trip (~0,4–0,6 s por OUT, estimado). Render no documenta qué datacenter usa, por eso el RTT se mide después del deploy (§12, paso 8).

La región no se puede cambiar una vez creado el servicio. Se descartaron:

- **Render Free:** se apaga a los 15 min sin tráfico entrante, y el polling de los workers no cuenta como tráfico. Tarda ~1 min en volver, no tiene pre-deploy y Render puede reiniciarlo en cualquier momento.
- **Railway:** la elección de región depende del plan.
- **Fly.io:** requiere Dockerfile y apaga con SIGINT y 5 s por defecto.

**Una sola instancia.** Los rate limits y los cachés viven en memoria y los schedulers asumen un único proceso. Escalar exige antes un store compartido (§25.3 del plan del fichador).

## 3. URLs y dominio

| Recurso | URL conceptual |
|---|---|
| API | `https://<api-staging>/api`, p. ej. `https://<servicio>.onrender.com/api` o `https://api-staging.<dominio>/api` |
| Fichador | `https://<fichador-staging>`, p. ej. `https://<sitio>.netlify.app` |
| Admin | `https://<admin-staging>`, p. ej. `https://<sitio>.netlify.app` |

Los subdominios de los proveedores sirven: son estables y tienen HTTPS válido. El dominio se decide **antes** de enrolar dispositivos, porque cambiar el origin del fichador obliga a:

- re-enrolar cada dispositivo (el IndexedDB es por origin);
- actualizar `CORS_ORIGIN`;
- rebuildear el fichador (su CSP fija el origin de la API).

Nunca usar URLs de deploy previews.

## 4. Backend en Render

| Ajuste | Valor |
|---|---|
| Tipo | Web Service, instancia Starter (paga, siempre activa), **1 instancia** |
| Región | `virginia` |
| Repositorio / rama | `main`, deploy **manual** de un SHA con CI verde (auto-deploy apagado). **Pendiente desde el 2026-11-03:** con el flujo de [GIT_WORKFLOW.md](../GIT_WORKFLOW.md) `main` es producción, y staging pasa a seguir `development` (§6.2–§6.3 de ese documento). Se reconfigura en el panel de Render |
| Root directory | `backend` |
| Build command | `npm ci --include=dev && npx prisma generate && npm run build` |
| Pre-deploy command | `DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy` |
| Start command | `npm start` (= `node dist/src/server.js`) |
| Node | `NODE_VERSION=22` en el entorno del servicio (sin esa variable Render usa su default, hoy 24.x) |
| Puerto | Render inyecta `PORT`; no definirla |
| Health check | TCP (el default de Render) al principio; ver §9 |

- **`--include=dev`:** `typescript` y el CLI `prisma` son devDependencies. Con `NODE_ENV=production` en el entorno, un `npm ci` simple no los instala y el build o el pre-deploy fallan.
- **Pre-deploy:** corre después del build, en una instancia aparte y antes de liberar el código nuevo. Si falla, el deploy se cancela y sigue la versión anterior. Usa `DIRECT_URL` porque las migraciones no deben pasar por el pooler (el schema no define `directUrl`). Es exclusivo de instancias pagas.
- **Prohibido en public staging:** `prisma migrate dev`, `prisma db push` y `prisma migrate reset`. `prisma migrate resolve` sólo con aprobación explícita y un análisis previo de `_prisma_migrations`.
- **Deploys:** Render levanta la instancia nueva, le pasa el tráfico y manda SIGTERM a la vieja 60 s después (con 30 s de shutdown delay por defecto). El backend no tiene handler de SIGTERM (§17), así que durante esos ~60 s hay dos procesos con workers y schedulers. Desplegar lejos de la 01:00 ART (chequeo diario de inactividad).

## 5. Variables del backend

Se cargan sólo en el panel de Render. No se registran valores en el repo ni en este documento. Reglas:

- **Nada vacío.** Ninguna variable con `=` y sin valor. Un enum, URL o texto obligatorio vacío impide el arranque; un booleano vacío se lee como `false`; un número vacío, como `0` (ver `backend/.env.example`).
- **JWT propios.** Secretos nuevos y exclusivos de public staging; nunca reutilizar los locales.

| Variable | Valor en staging | Secreto | Origen | Riesgo si falta o está mal |
|---|---|---|---|---|
| `NODE_ENV` | `production` | No | Equipo | Corre con defaults de desarrollo |
| `APP_ENV` | `staging` | No | Equipo | Default `local`; los scripts de verificación abortan |
| `NODE_VERSION` | `22` | No | Equipo | Node distinto del de CI |
| `TZ` | `America/Argentina/Cordoba` | No | Equipo | Defensa en profundidad |
| `API_PREFIX` | `/api` | No | Equipo | Rutas incorrectas |
| `DATABASE_URL` | Neon `development`, pooled | **Sí** | Consola Neon | No arranca |
| `DIRECT_URL` | Neon `development`, directa | **Sí** | Consola Neon | El pre-deploy falla o migra por el pooler |
| `CORS_ORIGIN` | `https://<admin-staging>,https://<fichador-staging>` | No | URLs de Netlify | Admin y fichador bloqueados |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Aleatorios nuevos (32 bytes o más) | **Sí** | Se generan para staging | No arranca (mínimo 16) |
| `TRUST_PROXY_HOPS` | Medido (§8); `0` sólo hasta medir | No | Medición | Rate limit agrupado o IP falsificable |
| `CLIENT_IP_DIAGNOSTICS_ENABLED` | `true` sólo durante la medición; después `false` | No | Equipo | Sonda expuesta |
| `STORAGE_PROVIDER` | `google_drive` (documentos) | No | Equipo | Default `local`, efímero en el host |
| `PUNCH_PHOTO_STORAGE_PROVIDER` | `neon_object_storage` | No | Equipo | Las fotos irían a otro provider |
| `NEON_OBJECT_STORAGE_ENDPOINT` / `_REGION` / `_BUCKET` | Staging; bucket `gestion-personal-fichadas-staging` | Endpoint sensible | Neon | Fichadas en 503 |
| `NEON_OBJECT_STORAGE_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | Credenciales de staging (lectura/escritura del bucket) | **Sí** | Neon | Fichadas en 503 |
| `GOOGLE_DRIVE_ENABLED` | `true` | No | Equipo | Sin documentos ni archivo |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` / `_SERVICE_ACCOUNT_EMAIL` / `_PROJECT_ID` | Carpeta y cuenta **de prueba** | Semi | Google Cloud | No se reclaman archive jobs |
| `GOOGLE_DRIVE_PRIVATE_KEY` | PEM en una línea con `\n` escapados | **Sí** | Google Cloud | Igual que la fila anterior |
| `AUTOMATIC_JOBS_ENABLED` | `false` en fases A–C, `true` en fase D (§11) | No | Equipo | Mantenimiento y archivo parados |
| `CLOCK_POSTPROCESS_WORKER_ENABLED` | `false` en la fase A, `true` desde la B (siempre explícita) | No | Equipo | Alertas, avisos y Motor B nunca corren |
| `CLOCK_POSTPROCESS_INTERVAL_MS` | `5000` | No | Default | — |
| `PERFORMANCE_LOGGING_ENABLED` | `true` (con `NODE_ENV=production` viene apagado) | No | Equipo | Sin logs `http_request` para PERF-5G |
| `PERFORMANCE_LOGGING_SAMPLE_RATE` / `PERFORMANCE_LOG_INCLUDE_QUERY_METRICS` | `1` / `true` | No | Equipo | Vacía = 0 / false |

- **Con sus defaults** (no hace falta definirlas; si se definen, nunca vacías):
  - `JWT_*_EXPIRES_IN`;
  - `RATE_LIMIT_*`, `LOGIN_RATE_LIMIT_*`, `REFRESH_RATE_LIMIT_*`, `CLOCK_RATE_LIMIT_*`, `CLOCK_IP_RATE_LIMIT_MAX`;
  - `CLOCK_PUNCH_COOLDOWN_SECONDS` (60), `CLOCK_ATTEMPT_*`, `NEON_OBJECT_STORAGE_TIMEOUT_MS`, `MAX_*_SIZE_MB`;
  - los catch-ups y `PERFORMANCE_*_REQUEST_MS`.
- **No definir:**
  - `PORT` (lo inyecta Render);
  - `DEFAULT_STORAGE_PROVIDER` y `DOCUMENT_STORAGE_PROVIDER` (vacías no arrancan);
  - `CLOUDINARY_*`;
  - `CLOCK_DEVICE_TOKEN` y `JSON_BODY_LIMIT` (retiradas);
  - `DEMO_SEED_PASSWORD` (no se corre el demo seed).

## 6. Sitios estáticos (Netlify)

### Admin

- **Sitio:** propio, con base directory `frontend`. La configuración versionada es `frontend/netlify.toml`:
  - build `npm run build`, publish `dist`, Node 22;
  - deploy previews y branch deploys apagados;
  - SPA fallback `/* → /index.html 200` (el admin usa `BrowserRouter` con rutas profundas);
  - headers HSTS, `nosniff`, `X-Frame-Options: DENY` y `Referrer-Policy`;
  - cache inmutable de `/assets/*`.
- **Variables:** sólo `VITE_API_URL=https://<api-staging>/api` y `VITE_DEMO_MODE=false`. **Nunca** definir `VITE_DEMO_*`.
- **Build sólo en Netlify.** Nunca publicar un `dist/` local: `frontend/.env.local` puede activar el modo demo y `runtimeMode.ts` pasa `import.meta.env` completo, así que esas credenciales terminarían en el bundle (§18).
- **CSP diferida.** El admin carga Google Fonts, tiles de OpenTopoMap, Georef (`apis.datos.gob.ar`), imágenes `blob:` y la API, cuyo origin cambia por entorno. Una CSP correcta debe generarse en el build y verificarse en un navegador antes de forzarla (§18).

### Fichador

- **Sitio:** propio, con base directory `fichador`. Usa `fichador/netlify.toml` sin cambios: build, publish `dist`, Node 22, previews y branch deploys apagados y SPA fallback.
- **Headers:** el build los genera en `dist/_headers`:
  - CSP enforced con `connect-src` igual al origin exacto de la API;
  - HSTS, `Permissions-Policy: camera=(self)`;
  - `no-cache` en el documento, `sw.js` y el manifest; `immutable` en `/assets`.
- **Variables:**
  - `VITE_API_URL=https://<api-staging>/api` (en Netlify el build falla si no es HTTPS);
  - `VITE_APP_VERSION=<SHA corto>` (opcional, lo ve RRHH);
  - `VITE_CLOCK_DEVICE_TOKEN` está prohibida y hace fallar el build.

### Créditos de Netlify

En el plan Free cada deploy de producción cuesta créditos (15 de 300 por mes en cuentas nuevas), y un push a `main` dispara el build de los dos sitios. Hay que apagar los builds automáticos (Build settings → Stop builds) y desplegar con "Trigger deploy" sólo cuando haga falta. Verificar en el panel el plan y los límites vigentes de la cuenta.

## 7. CORS y HTTPS

- **CORS:** `CORS_ORIGIN` lleva exactamente los dos origins HTTPS: sin path, sin barra final, sin `localhost`, sin previews y sin comodines.
- **Autenticación:** el admin usa Bearer, con el refresh en el body; el fichador, `Authorization: ClockDevice <id>.<secret>`. Ninguno usa cookies, así que el `credentials: true` del backend no cambia nada.
- **Preflight:** tiene que aceptar `Authorization`, `Content-Type`, `X-Clock-App-Version` y `X-Clock-Maintenance-Session` (modo mantenimiento, [FICHADOR_MAINTENANCE_MODE.md](FICHADOR_MAINTENANCE_MODE.md)). El `cors()` del backend refleja los headers pedidos y no tiene lista fija, así que no hace falta cambiar la configuración.
- **HTTPS en todo.** Eso da contexto seguro, con lo que funcionan `getUserMedia`, el service worker, IndexedDB y la instalación de la PWA. No puede haber mixed content: `VITE_API_URL` es siempre `https://`.

## 8. `TRUST_PROXY_HOPS` y rate limits

Es el procedimiento de §31.7 del plan del fichador, aplicado a Render. **Bloqueante antes de cualquier fichada.**

1. Desplegar con `TRUST_PROXY_HOPS=0` y `CLIENT_IP_DIAGNOSTICS_ENABLED=true`.
2. Pedir `GET https://<api-staging>/api/health/client-ip` desde una red con IP pública conocida y guardar:
   - `ip`, `remoteAddress` y `xForwardedFor`, con la cantidad y el orden de sus entradas;
   - si aparecen, `cfConnectingIp`, `trueClientIp`, `xRealIp` y `forwarded`.
3. Repetir desde una segunda red real (por ejemplo, datos móviles).
4. Repetir con `-H "X-Forwarded-For: 203.0.113.7"`: esa entrada falsa nunca debe terminar como `req.ip`.
5. Contar desde la derecha sólo los proxies de la plataforma y configurar ese número exacto (0–5).
6. Reiniciar y repetir las dos redes más el spoofing. **PASS:** `req.ip` coincide con cada cliente real, cambia entre redes y nunca toma el valor falso.
7. Poner `CLIENT_IP_DIAGNOSTICS_ENABLED=false`, reiniciar y confirmar que la sonda responde 404.

Nunca usar un valor "conocido" de Render sin medirlo: uno mayor al real permite falsificar la IP.

**Rate limits** (no se relajan para PERF-5G):

- el cupo por `ClockDevice` (30 / 5 min) es independiente por dispositivo, aunque varios compartan red;
- el cupo por IP previo a la autenticación (300 / 5 min) sigue frenando el pairing y la fuerza bruta;
- el límite global (300 / 15 min por IP, todas las rutas) también se comparte entre los kioscos de un mismo NAT. Se revisa con el uso real (§17);
- login: 10 / 15 min por IP; refresh: 30 / 15 min.

## 9. Health

- **`GET /api/health`:** público. Hace `SELECT 1` y devuelve `status`, `appEnv`, `nodeEnv` y `database`. Es la verificación del smoke.
- **`GET /api/health/performance`:** con `NODE_ENV=production` responde 404.
- **`GET /api/health/client-ip`:** sólo existe mientras dura la medición.
- **Health check de Render.** Arrancar con el check TCP por defecto. Un check HTTP a `/api/health` llega "cada pocos segundos", consulta la DB y pasa por el limitador global por IP. Si llegara a 429, Render daría el servicio por caído y lo reiniciaría a los 60 s. Pasar a HTTP sólo después de verificar en los logs la frecuencia y que no hay 429.

## 10. Migraciones

La rama `development` tiene 69 migraciones aplicadas, incluida `20261016150000_add_clock_punch_postprocess_job` (su checksum coincide con el archivo). `prisma migrate diff` contra `schema.prisma` da vacío (verificado el 2026-10-16).

- **Antes del primer deploy,** contra `development` y desde una máquina de confianza:
  - `npx prisma migrate status` debe decir "up to date";
  - el diff contra `schema.prisma`, vacío;
  - confirmar la ventana de restore (PITR) de Neon o tomar un snapshot.
- **Migraciones del modo mantenimiento y de francos (actualizado el 2026-11-03).** `20261026120000_add_clock_device_maintenance_access` (columnas aditivas y CHECKs en `ClockDevice`) y `20261103120000_add_employee_day_off` (tabla `EmployeeDayOff` y valor `ACTIVIDAD_EN_FRANCO`) ya están aplicadas en la rama Neon `development`. Se verificó en sólo lectura: `prisma migrate status` dice "up to date" con 71 migraciones, y `migrate diff` contra el `schema.prisma` de la rama `development` da vacío. Producción no tiene ninguna de las dos: las aplica el pre-deploy del primer despliegue autorizado de ese código. Rollbacks manuales en `backend/prisma/rollbacks/` y en `20261103120000_add_employee_day_off/ROLLBACK.md`.
- **Migración antes que el código, siempre.** El código de PERF-5D escribe `ClockPunchPostProcessJob` dentro de la transacción de cada fichada: sin la migración, toda fichada responde 503. El pre-deploy de §4 lo garantiza en cada deploy. Hoy no tiene nada que aplicar.

## 11. Workers: arranque gradual

`AUTOMATIC_JOBS_ENABLED` no controla sólo el archivo. Habilita el tick de 60 s de `clockPunchMaintenance`, que escribe en la DB compartida:

- vencimiento de jornadas abiertas y su aviso `FALTA_SALIDA`;
- riesgo de olvido de salida;
- falta de ingreso intradía;
- vencimiento de intentos `PROCESSING` y retención (borra intentos viejos);
- limpieza de dispositivos `PENDING` abandonados;
- detección de evidencia huérfana;
- catch-ups de inactividad diaria y de falta de ingreso (por checkpoint, hasta 14 fechas por tick);
- el archivo a Drive (`StorageArchiveJob`).

`CLOCK_POSTPROCESS_WORKER_ENABLED` controla el worker de `ClockPunchPostProcessJob` (alertas, avisos, adopción de turno y Motor B).

| Fase | `AUTOMATIC_JOBS_ENABLED` | `CLOCK_POSTPROCESS_WORKER_ENABLED` | Qué corre | Para qué |
|---|---|---|---|---|
| **A** | `false` | `false` | Sólo HTTP | Health, `TRUST_PROXY_HOPS`, CORS, sitios y pairing. No se ficha |
| **B** | `false` | `true` | HTTP + post-proceso | Smoke de fichadas con sus derivados. El archivo no drena y el mantenimiento no corre (el estado de un intento se resuelve igual al consultarlo) |
| **C** | `false` | `true` | Igual que B | Auditoría read-only de lo que haría el mantenimiento (abajo). Sin escrituras |
| **D** | `true` | `true` | Todo | Drenado del archivo (§13), mantenimiento y PERF-5G |

**Auditoría de la fase C** (sólo lectura, contra `development`). Se cuantifica cada tarea antes de habilitarla:

- jornadas `ABIERTO` ya vencidas, que se cerrarían como `FALTA_SALIDA` con aviso;
- intentos `PROCESSING` con más antigüedad que el TTL, que pasarían a `FAILED`;
- intentos con más antigüedad que `CLOCK_ATTEMPT_RETENTION_DAYS`, que se **borrarían**;
- dispositivos `PENDING` abandonados, que se **borrarían**;
- checkpoints (`JobCheckpoint`) de inactividad y de falta de ingreso: última fecha procesada, cuántas fechas de catch-up quedan y cuántos avisos se esperan;
- evidencia huérfana (sólo genera un log);
- `StorageArchiveJob`: los 14 `PENDING` conocidos, más los que hayan dejado las fichadas del smoke, y 0 `FAILED`.

Si algún número no es el esperado (por ejemplo, un catch-up largo que generaría una ráfaga de avisos), se frena antes de la fase D y se decide.

**Una sola instancia con jobs por base.** Mientras public staging esté en la fase B o posterior, ningún otro backend con workers o schedulers puede correr contra `development`; eso incluye el backend local con `AUTOMATIC_JOBS_ENABLED=true` en su `.env`. Los outbox se protegen con lease, pero los checkpoints y las notificaciones pueden duplicarse, y un worker local además "roba" jobs y distorsiona PERF-5G. Por la misma razón, nunca correr dos instancias del servicio.

## 12. Orden de despliegue

1. CI verde del SHA a desplegar.
2. Confirmar el restore point de Neon `development` (§10).
3. `prisma migrate status` y diff contra `development`: al día y vacío.
4. Apagar los backends locales con jobs contra `development`.
5. Crear el Web Service de Render con la configuración de §4 y el entorno de §5 en **fase A**, con la sonda de IP activada.
6. Deploy. El pre-deploy debe informar "No pending migrations to apply".
7. `GET /api/health` → 200 con `appEnv=staging` y `database=ok`.
8. Medir el RTT backend→DB: 10 llamadas a `/api/health` y leer `queryTimeMs` en los logs `http_request`. Se esperan pocos milisegundos; si no, se registra como riesgo antes de PERF-5G.
9. Medir y fijar `TRUST_PROXY_HOPS` (§8), apagar la sonda y confirmar 404.
10. Crear el sitio del admin y el del fichador (§6), con su `VITE_API_URL`.
11. Fijar `CORS_ORIGIN` con los dos origins y reiniciar. Verificar headers, CSP y `connect-src` en las respuestas reales.
12. Login RRHH en el admin y enrolar los dispositivos de prueba por pairing real (PENDING → aprobación → ACTIVE → heartbeat).
13. **Fase B:** `CLOCK_POSTPROCESS_WORKER_ENABLED=true` y reiniciar.
14. Smoke (§14).
15. **Fase C:** auditoría read-only de §11.
16. **Fase D:** `AUTOMATIC_JOBS_ENABLED=true` y reiniciar. Drenar los archive jobs (§13).
17. Prerrequisitos de [PERF_5G_RUNBOOK.md](PERF_5G_RUNBOOK.md) y luego PERF-5G.

## 13. Los 14 archive jobs

En la rama `development` quedaron 14 `StorageArchiveJob` `PENDING`, todos válidos (auditoría del 2026-10-16):

- 0 intentos, `nextAttemptAt` vencido, sin lease y sin error;
- fuente `NEON_OBJECT_STORAGE` `ACTIVE` del módulo `FICHADAS`, con checksum, el objeto presente en Neon y vinculado a su fichada;
- target Google Drive, todavía sin copia.

**No se borran.** Los drena el primer backend en fase D, a razón de 5 por tick de 60 s:

1. En la fase C se registran sus ids y se confirma 14 `PENDING` / 0 `FAILED`.
2. Al pasar a la fase D se observa `PENDING → PROCESSING → COMPLETED` en logs (`STORAGE_ARCHIVE_COMPLETED`) y en la tabla.
3. Por cada job:
   - `COMPLETED` en un intento, con `targetStorageKey`;
   - exactamente una copia en Drive para ese `sourceStorageFileId`;
   - el primary sigue existiendo en Neon (HEAD);
   - ningún `FAILED`.

   El worker ya compara el sha256 de la fuente con `StorageFile.checksum` antes de subir. Opcionalmente, descargar la copia y comparar.
4. Cualquier `STORAGE_ARCHIVE_RETRY` o `FAILED` frena PERF-5G hasta entenderlo.

## 14. Smoke previo a PERF-5G

Con legajos de prueba y dispositivos de prueba:

- health, login RRHH, listado de dispositivos y pairing;
- búsqueda, status, IN, cooldown (409 con cuenta regresiva) y OUT;
- recovery: el mismo `requestId` reintentado devuelve lo guardado; una respuesta perdida se recupera consultando el intento;
- una sola fichada y una sola auditoría por intención, con el intento `COMPLETED`;
- foto en el bucket de staging, descarga protegida y un `StorageArchiveJob` por fichada;
- jobs de post-proceso `COMPLETED`, con alertas y avisos que aparecen segundos después del 201.

Al terminar no se borra nada. Los dispositivos de prueba quedan para PERF-5G y se revocan al final del runbook.

## 15. Observabilidad

Los logs son JSON por stdout y se ven en el panel de Render. La retención y la exportación (CLI/API) del plan contratado se verifican al crear el servicio. Si la retención no cubre el análisis, se exporta a archivo al terminar cada corrida.

| Señal | Para qué |
|---|---|
| `clock_punch_timing` (por `requestId` y fase) | Desglose de cada fichada (PERF-5G) |
| `clock_punch_query_budget` | Operaciones Prisma por fase. POST debe ser 0 |
| `CLOCK_PHOTO_PUNCH_TOTAL_TIMING` / `CLOCK_PHOTO_PUNCH_PHASE_TIMING` | Totales por fichada |
| `CLOCK_POSTPROCESS_COMPLETED` / `RETRY` / `FAILED` / `LEASE_LOST` / `WORKER_STARTED` | Post-proceso |
| `STORAGE_ARCHIVE_COMPLETED` / `RETRY` / `FAILED` | Archivo a Drive |
| `http_request` / `slow_http_request` | Rutas, estados (401/403/409/429/5xx), duración y `queryTimeMs`. Requiere `PERFORMANCE_LOGGING_ENABLED=true` |
| `CLOCK_ATTEMPT_FAILED`, `CLOCK_PUNCH_POST_COMMIT_STEP_FAILED`, `CLOCK_STORAGE_ORPHAN_EVIDENCE_DETECTED` | Errores del fichador |

- **Contenido:** los logs no llevan foto, base64, `Authorization`, secretos del dispositivo, JWT ni URLs o credenciales de DB y storage. Sólo identificadores técnicos (UUIDs).
- **Correlación de fichadas:** por el `requestId` del cliente.
- **Lag de los jobs:** se lee de la DB en sólo lectura (fichada → `StorageFile` → job).

## 16. Rollback

| Falla | Acción |
|---|---|
| El backend no arranca | Render mantiene el último deploy sano. En el primero no hay anterior: leer el error de validación del entorno en los logs, corregir y redeployar. La DB no se toca |
| Falla la migración | El pre-deploy cancela el deploy y sigue la versión anterior. Analizar `_prisma_migrations`; nunca reset; `resolve` sólo con aprobación. La migración de 5D es aditiva y ya está aplicada |
| Falla un worker | Volver a la fase anterior (`CLOCK_POSTPROCESS_WORKER_ENABLED=false` y/o `AUTOMATIC_JOBS_ENABLED=false`) y reiniciar. Los jobs quedan `PENDING` (son durables), las fichadas siguen funcionando y el envío de cierres procesa en línea. Nunca borrar jobs |
| Falla CORS | Corregir `CORS_ORIGIN` con el origin exacto y reiniciar |
| El fichador no conecta | Revisar `VITE_API_URL`, `connect-src` en `_headers` y CORS. Rebuildear el sitio; Netlify permite volver a publicar un deploy anterior |
| Falla el storage | Las fichadas responden 503 sin escrituras parciales. Revisar `NEON_OBJECT_STORAGE_*` y el bucket. Cambiar de provider es un cambio de storage que requiere aprobación: hasta entonces se frena PERF-5G |
| Problema general | Revocar los `ClockDevice` desde RRHH, suspender el servicio de Render y conservar DB, auditoría, intentos, fichadas y `StorageFile` para el análisis. Restaurar desde snapshot sólo ante corrupción confirmada |

## 17. Riesgos

1. **Datacenter de Render:** el de Virginia no está documentado; se valida midiendo el RTT backend→DB (paso 8).
2. **Red del cliente:** el tramo Argentina→Virginia (RTT ~150–200 ms, estimado) se suma a la latencia percibida; PERF-5G lo mide aparte. Acercar backend y base a los usuarios implicaría otra región de Neon: fuera de alcance.
3. **Sin graceful shutdown:** con ~60 s de solape por deploy hay dos procesos con schedulers. Los outbox se recuperan por lease (≤ 2 min de demora); los checkpoints pueden duplicar avisos.
4. **Base compartida** con el backend local: aplica la regla de §11.
5. **Health check HTTP:** el limitador global por IP puede devolver 429 y provocar reinicios (§9).
6. **Créditos de Netlify Free** (§6).
7. **Límite global por IP** compartido por kioscos detrás de un mismo NAT: aceptable para el piloto, a dimensionar antes de producción.
8. **Logs de Render:** retención y exportación sin verificar.
9. **Admin sin CSP** (§18).
10. **Fichador:** `GET /clock/attempts` no tiene timeout; un pedido colgado demora el recovery. Se observa en la matriz de dispositivos.

## 18. Seguimientos de seguridad (SECURITY FOLLOW-UPS)

- **`frontend/src/config/runtimeMode.ts`** pasa `import.meta.env` completo a `resolveDemoLoginProfiles`. Así, cualquier `VITE_*` definida en el build, incluidas las credenciales demo de un `.env.local`, termina en el bundle. Ningún secreto está versionado (`frontend/.env.example` trae `VITE_DEMO_MODE=false` y las `VITE_DEMO_*` vacías). Se mitiga buildeando sólo en Netlify con las dos variables permitidas. Corrección pendiente: leer sólo las variables necesarias.
- **CSP del admin:** generarla en el build con el origin de la API de cada entorno, como hace el fichador, y validarla en navegador.
- **Device secret del fichador** en IndexedDB en texto plano: aceptado para el kiosco, porque el dispositivo es revocable desde RRHH. Revisar antes de producción.
- **Headers del backend:** `CORS` no expone `Content-Disposition`; preexistente, afecta sólo el nombre sugerido de descargas cross-origin.

## 19. Costo aproximado

Sujeto a los paneles vigentes al momento de crear los servicios:

| Componente | Tipo | Estimado |
|---|---|---|
| Backend: Render Web Service Starter | Pago | ~US$7/mes; el workspace Hobby no tendría costo fijo (verificar) |
| Admin + fichador: Netlify | Free, potencialmente pago | 300 créditos/mes en cuentas nuevas; con builds manuales alcanza |
| Neon (DB y Object Storage) | Existente, potencialmente pago | Según el plan de la cuenta; tráfico de staging bajo |
| Google Drive de prueba | Existente | — |
| Dominio | Opcional | US$0 con subdominios de los proveedores |
