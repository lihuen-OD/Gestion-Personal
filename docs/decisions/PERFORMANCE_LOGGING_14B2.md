# Etapa 14B.2 — Logging seguro de performance para requests y endpoints críticos

Fecha: 2026-09-03
Estado: implementado, validado (typecheck/tests/build backend en verde), pendiente de aprobación para commitear
Alcance: instrumentación pasiva de backend únicamente. No se tocó frontend, schema, migraciones, fichador (funcionalmente), liquidación, Horas Especiales, Conceptos Horarios, alertas (funcionalmente), permisos ni contratos de API.

---

## 1. Resumen ejecutivo

La Etapa 14A había detectado que `requestLogger.ts` corta incondicionalmente en producción (`if (isProduction) return next();`), así que no existía ninguna telemetría real de duración por endpoint en el ambiente que importa. El diagnóstico de esta etapa encontró algo mejor de lo esperado: **la infraestructura de medición de queries Prisma ya existía y ya era segura para concurrencia** (`shared/observability/requestMetrics.ts`, basada en `AsyncLocalStorage`, aislada por request) — sólo estaba, igual que el logger, apagada de forma hardcodeada en producción (`shared/prisma/client.ts`).

Se implementó logging estructurado (JSON) y sanitizado, controlado por 5 variables de entorno nuevas, reutilizando toda la infraestructura de métricas ya existente en vez de reconstruirla. El logger sigue sin correr por defecto en producción (mismo comportamiento seguro de hoy), pero ahora es un **opt-in explícito y controlado** en vez de un bloqueo permanente en el código. +45 tests backend nuevos, 1051/1051 verdes (71 archivos). Sin cambios de schema, sin migraciones, sin tocar frontend, sin cambiar ningún contrato de API.

---

## 2. Problema detectado

Confirmado exactamente como lo describía 14A: `backend/src/middlewares/requestLogger.ts` (antes de esta etapa) tenía, como primera línea del handler, `if (isProduction) return next();` — sin ninguna variable de entorno que permitiera activarlo de forma controlada. El mismo patrón se repetía, sin que 14A lo hubiera detectado explícitamente, en `backend/src/shared/prisma/client.ts`: el conteo de queries por request (`recordPrismaQuery`) también estaba condicionado a `!isProduction`, así que aunque se hubiera forzado el logger a correr en producción, el conteo de queries habría quedado en `0` de todas formas.

---

## 3. Diagnóstico del logger actual (Parte 1 del pedido)

1. **Dónde está definido**: `backend/src/middlewares/requestLogger.ts`.
2. **¿Montado en Express?**: sí — `backend/src/app.ts:31` (`app.use(requestLogger)`), global, montado después del parser de JSON y antes de montar `apiRouter`. Aplica a **toda** request, no sólo a un subconjunto de rutas.
3. **¿En qué ambientes corre hoy (antes de esta etapa)?**: `development`, `test` y `demo` — cualquier valor de `NODE_ENV` distinto de `"production"`. Nunca en `production`.
4. **¿Por qué está deshabilitado en producción?**: no había ningún comentario en el código que lo explicara — es un `if` sin justificación documentada. La lectura más razonable es precaución no verbalizada (evitar overhead/exposición en el ambiente real sin haberlo pensado explícitamente), pero no hay evidencia de una decisión de producto detrás. Es exactamente el hallazgo #5 del resumen ejecutivo de 14A.
5. **¿Qué datos loguea hoy (antes de esta etapa)?**: `method`, `path` — pero `path` era `req.originalUrl`, es decir **incluía el query string completo sin sanitizar** —, `statusCode`, `durationMs`, `queryCount`, `queryDurationMs` (redondeado), tamaño de respuesta en KB (vía un monkey-patch de `res.write`/`res.end`), y `userId`+`role` si el request estaba autenticado. Formato: texto plano interpolado en un template string, no JSON.
6. **¿Loguea datos sensibles actualmente?**: no se encontró ningún caso de `Authorization`, cookies, tokens, body ni passwords en el log — el código nunca los tocaba. **Sí había un hallazgo real**: el query string completo del `path` no se sanitizaba, así que un filtro como `?search=Juan+Perez` habría quedado en el log tal cual. Corregido en esta etapa (ver §7).
7. **¿Mide duración total del request?**: sí, `Date.now() - startedAt` sobre el evento `res.on("finish")`.
8. **¿Mide status code?**: sí, `res.statusCode`.
9. **¿Mide path/method?**: sí (ver punto 6 sobre el hueco de sanitización).
10. **¿Mide userId/role de forma segura?**: usa el ID interno (`req.user.id`, nunca email) y el rol — mismos valores que ya usa `auditService` en todo el resto del sistema, nunca expuestos al frontend. Razonablemente seguro en el sentido de qué campo se usa; lo que no existía era control de si debía loguearse en absoluto en cada ambiente.
11. **¿Hay requestId/correlationId?**: no existía ninguno a nivel de request HTTP. El único "requestId" del código es `ClockPunchAttempt.requestId` — una clave de idempotencia de aplicación generada por el **cliente** del fichador, conceptualmente distinta (no es un correlation id de logging, y no cubre el resto de los endpoints). Se agregó un `requestId` de logging nuevo, generado en el propio middleware (ver §6).
12. **¿Existe contador de queries Prisma por request?**: sí, y ya era seguro para concurrencia — `backend/src/shared/observability/requestMetrics.ts` usa `AsyncLocalStorage` (aislamiento nativo de Node por contexto asíncrono, no una variable global compartida). `backend/src/shared/prisma/client.ts` ya lo conectaba vía `$extends`/`$allOperations`, interceptando cada query real. **Pero sólo si `!isProduction`** — el mismo apagado hardcodeado que el logger, en un archivo distinto.
13. **¿Hay logs de queries lentas?**: sí, ya existían (`SLOW_QUERY`, threshold `SLOW_QUERY_THRESHOLD_MS`, default 250ms, leído directo de `process.env` en `requestMetrics.ts` — **no** a través del esquema Zod centralizado de `env.ts`, una inconsistencia menor preexistente que esta etapa no corrige por estar fuera de alcance). El texto logueado por cada query lenta es sólo `"Model.operation"` (p. ej. `"Employee.findMany"`) — **nunca SQL crudo ni parámetros**: confirmado leyendo `client.ts`, donde `recordPrismaQuery` se llama con `` `${model}.${operation}` ``, no con el texto de la query. La configuración `log: [{ emit: "event", level: "query" }, ...]` del `PrismaClient` existe pero **no tiene ningún `.$on("query", ...)` suscrito** (confirmado por grep en todo `backend/src`) — es configuración inerte, no una segunda vía de logging de SQL real. No se tocó (fuera de alcance, no es un riesgo real al no tener ningún consumidor).
14. **¿Hay logger centralizado?**: no — todo el proyecto usa `console.info`/`console.warn`/`console.error` directo, sin una librería de logging estructurado (pino/winston) ni un formateador JSON central antes de esta etapa. Confirmado: no hay ninguna dependencia de logging en `package.json`.
15. **¿Qué tests existen?**: ninguno para `requestLogger.ts` ni para `requestMetrics.ts` antes de esta etapa (confirmado, sin archivos `*.test.ts` para ninguno de los dos). Se tomó como referencia de patrón `clockDeviceAuth.test.ts` (mutación directa del objeto `env` en caliente, sin reiniciar el proceso, porque los middlewares leen `env.*` en cada llamada en vez de cachear un valor al importar).
16. **Riesgos de activar logging** (evaluados y resueltos en el diseño, ver §9):
    - Path con query string sin sanitizar → resuelto: se descarta el query string por completo.
    - Sin `requestId` → difícil correlacionar múltiples líneas del mismo request en un agregador de logs real → resuelto: se genera un `requestId` propio de logging por request.
    - Sin muestreo → activar en producción con tráfico alto podría generar mucho volumen → resuelto: `PERFORMANCE_LOGGING_SAMPLE_RATE`, con la garantía explícita de que una request lenta/con error nunca se descarta por muestreo.
    - `slowEndpointStats` (el `Map` module-level que alimenta `GET /health/performance`) crece con la cantidad de combinaciones método+ruta normalizada distintas, no con el volumen de tráfico — acotado por diseño, no es una fuga de memoria real. Sin cambios en esta etapa.

---

## 4. Diseño implementado (Parte 2 del pedido)

Cada línea de log es un único objeto JSON (`console.info`/`console.warn`, un `JSON.stringify` por línea — fácil de parsear con cualquier agregador de logs basado en líneas).

**Campos incluidos siempre**: `level`, `event`, `timestamp`, `environment`, `requestId`, `method`, `path` (ya sanitizado), `statusCode`, `durationMs`, `slow`, `verySlow`, `error`.
**Campos incluidos condicionalmente**: `role`/`userId` (sólo si el request está autenticado), `queryCount`/`queryTimeMs` (sólo si `PERFORMANCE_LOG_INCLUDE_QUERY_METRICS=true`).

`event` es `"http_request"` (nivel `info`) para una request normal, o `"slow_http_request"` (nivel `warn`) si superó el umbral `slow` — `verySlow` es un booleano adicional dentro de esa misma entrada, no un tercer tipo de evento (así una alerta puede filtrar por `slow:true` y refinar por `verySlow` sin tener que conocer 3 nombres de evento distintos). Un `statusCode >= 500` siempre sube el nivel a `warn`, aunque la request haya sido rápida.

Módulos nuevos (todos con responsabilidad única, para poder testear la lógica pura sin mockear la consola):

- `backend/src/shared/observability/logSanitizer.ts` — `sanitizeRequestPath()`, pura.
- `backend/src/shared/observability/performanceLogger.ts` — `generateRequestId()`, `buildPerformanceLogEntry()` (pura), `shouldLogEntry()` (pura, decide si aplica el muestreo), `logPerformanceEntry()`/`logSlowQuery()` (los únicos dos puntos de I/O real, `console.info`/`console.warn`).
- `backend/src/middlewares/requestLogger.ts` (reescrito, no nuevo) — orquesta lo anterior sobre el ciclo de vida real de la request/response de Express, reutilizando `requestMetrics.ts` tal cual ya existía.

---

## 5. Variables de entorno (Parte 3 del pedido)

Agregadas a `backend/src/config/env.ts`, dentro del mismo esquema Zod centralizado (respeta la convención ya establecida — ninguna variable nueva se lee con `process.env` directo, a diferencia del `SLOW_QUERY_THRESHOLD_MS` preexistente que sí lo hacía y que esta etapa no tocó por estar fuera de alcance).

| Variable | Tipo | Default | Notas |
|---|---|---|---|
| `PERFORMANCE_LOGGING_ENABLED` | boolean, opcional | **sin valor explícito** → `true` fuera de `production`, `false` en `production` | Es la única variable con un default "condicional" (no un valor fijo) — ver `isPerformanceLoggingEnabled()` en `env.ts`. Overridable en cualquier ambiente. |
| `PERFORMANCE_LOGGING_SAMPLE_RATE` | number (0–1) | `1` | 1 = loguear siempre; una request lenta/muy lenta/con error **nunca** se descarta por esto, sin importar el valor. |
| `PERFORMANCE_SLOW_REQUEST_MS` | entero positivo | `1000` | Umbral `slow`. |
| `PERFORMANCE_VERY_SLOW_REQUEST_MS` | entero positivo | `3000` | Umbral `verySlow`. Validado con un `.refine()` a nivel de esquema: debe ser `>= PERFORMANCE_SLOW_REQUEST_MS`, si no la app no arranca (mismo criterio que el resto de `env.ts`: falla rápido y explícito ante una config inválida, no un valor silenciosamente ignorado). |
| `PERFORMANCE_LOG_INCLUDE_QUERY_METRICS` | boolean | `true` | Permite apagar sólo el conteo de queries (p. ej. si en el futuro se mide overhead real y se decide no correrlo en producción) sin apagar el resto del logging. |

`isPerformanceLoggingEnabled()`/`shouldRecordQueryMetrics()` (`env.ts`) leen `env.*` en cada llamada, sin cachear nada en una constante de módulo — mismo patrón ya usado por `clockDeviceAuth.ts` con `env.NODE_ENV`/`env.CLOCK_DEVICE_TOKEN`, elegido a propósito para que los tests puedan mutar `env` en caliente (ver `clockDeviceAuth.test.ts`) y para no depender del orden de imports en producción.

**Reglas cumplidas**: en `development`/`test`/`demo` queda activo por defecto sin tocar ningún `.env` (mismo comportamiento que tenía antes esta etapa, en la práctica). En `production` sigue apagado por defecto — activarlo requiere setear explícitamente `PERFORMANCE_LOGGING_ENABLED=true` en el entorno real. La validación de env (`envSchema.safeParse`) sigue fallando rápido y explícito ante cualquier valor inválido, incluida la nueva regla `VERY_SLOW >= SLOW`.

---

## 6. Qué se loguea

Ver §4 para el diseño y §11 para ejemplos reales (capturados corriendo el código real, no escritos a mano). Resumen: `timestamp`, `requestId` (generado acá mismo, `req_` + 16 hex, `crypto.randomUUID()`), `method`, `path` (sanitizado), `statusCode`, `durationMs`, `slow`, `verySlow`, `error` (`statusCode >= 500`), `environment` (`env.APP_ENV`: `local`/`staging`/`production` — más granular que `NODE_ENV`, mismo campo que ya expone `GET /health`), `role`+`userId` si hay usuario autenticado, `queryCount`+`queryTimeMs` si `PERFORMANCE_LOG_INCLUDE_QUERY_METRICS=true`.

---

## 7. Qué NO se loguea (sanitización, Parte 4 del pedido)

- **Body**: nunca se lee `req.body` en ningún punto del middleware ni de los módulos nuevos.
- **Headers, incluido `Authorization`**: nunca se lee `req.headers` en absoluto.
- **Cookies**: no se leen (la app usa JWT en el header `Authorization`, no cookies de sesión).
- **Tokens/passwords**: no hay ningún camino de código que los toque.
- **Query params**: **se descarta el query string completo**, no un allowlist/denylist parcial. Decisión explícita: mantener una lista de "params seguros" es trabajo de mantenimiento continuo y un error de omisión ahí filtraría datos; eliminar el query string de raíz no tiene ese riesgo. `sanitizeRequestPath()` (`logSanitizer.ts`) hace `rawUrl.split("?")[0]`.
- **IDs reales en la ruta**: los segmentos UUID (formato usado por todos los `id` de `schema.prisma`, confirmado) se normalizan a `:id` — reduce cardinalidad en agregados y evita que un identificador real quede suelto en una línea de log que puede terminar en un sistema de agregación con retención/acceso distintos a los de la base de datos.
- **Fotos/base64/datos biométricos**: no aplica — ningún campo de la request/response se serializa nunca, sólo metadata (method/path/status/duración/contadores).
- **CUIL/DNI/direcciones/emails**: no aparecen en ningún campo logueado (no se leen del request; `userId` es el ID interno UUID, `role` es el enum de rol, ninguno de los dos es PII).
- **SQL crudo/parámetros de query**: confirmado en el diagnóstico (§3.13) que el conteo de queries nunca tuvo acceso a SQL real, sólo a `"Model.operation"` — reconfirmado en esta etapa, sin cambios en ese punto.

---

## 8. Slow / very slow thresholds (Parte 9 del pedido)

`buildPerformanceLogEntry()` (`performanceLogger.ts`) calcula, sobre la duración real redondeada a milisegundo entero:

```
slow     = durationMs >= PERFORMANCE_SLOW_REQUEST_MS       (default 1000ms)
verySlow = durationMs >= PERFORMANCE_VERY_SLOW_REQUEST_MS  (default 3000ms)
```

`verySlow=true` implica `slow=true` (el esquema de env garantiza `VERY_SLOW >= SLOW`). `event` pasa a `"slow_http_request"` y `level` a `"warn"` en cuanto `slow=true`, sin esperar a `verySlow`. Un `statusCode >= 500` también fuerza `level:"warn"` (vía `error:true`) aunque la duración esté muy por debajo de cualquier umbral — una request rota nunca se loguea como si fuera sólo informativa.

---

## 9. Query metrics: implementado, reutilizando infraestructura existente (Parte 6 del pedido)

**Ya existía** — no se construyó una infraestructura nueva. `backend/src/shared/observability/requestMetrics.ts` usa `AsyncLocalStorage` (aislamiento nativo por request, sin variables globales compartidas entre requests concurrentes — es exactamente el mecanismo que la consigna pedía si había que implementar algo desde cero). `backend/src/shared/prisma/client.ts` ya lo conectaba a cada query real vía `$extends`/`$allOperations` desde antes de esta etapa.

**El único cambio real**: el gate que decidía si `recordPrismaQuery` se llamaba pasó de `!isProduction` (hardcodeado, `client.ts`) a `shouldRecordQueryMetrics()` (`isPerformanceLoggingEnabled() && env.PERFORMANCE_LOG_INCLUDE_QUERY_METRICS`) — mismo criterio de habilitación que el resto de esta etapa, ahora también aplicable a producción de forma controlada.

**No se hizo ningún monkey-patch nuevo de Prisma** — se reutilizó el `$extends` ya existente tal cual. **No se agregó ninguna variable global mutable compartida** — todo el estado por-request sigue viviendo exclusivamente dentro del `AsyncLocalStorage` ya existente. El único estado module-level que sigue existiendo (`slowEndpointStats` en `requestLogger.ts`) es una agregación intencional entre requests (para `GET /health/performance`), no una mezcla accidental de métricas de requests concurrentes — no fue tocado en esta etapa.

**Test de aislamiento agregado** (`requestMetrics.test.ts`, ver §10): dos "requests" simuladas corriendo concurrentemente (interleaved vía `Promise.all` + `setTimeout(0)`) confirman que `queryCount`/`queryDurationMs` nunca se mezclan entre sí — cada una termina con exactamente sus propios valores, no una combinación de ambas.

---

## 10. Tests (Parte 7 del pedido)

**+45 tests backend nuevos, 5 archivos, 1051/1051 verdes en total (71 archivos)**:

| Archivo | Qué cubre |
|---|---|
| `shared/observability/logSanitizer.test.ts` (7 tests) | Descarta el query string completo; normaliza uno o varios UUID a `:id`, insensible a mayúsculas; no toca paths sin UUID/query; un valor de búsqueda que iba en el query string nunca sobrevive; path vacío → `/`. |
| `shared/observability/performanceLogger.test.ts` (20 tests) | `buildPerformanceLogEntry`: campos base correctos; `slow`/`verySlow` en el umbral exacto y por debajo; `statusCode>=500` marca `error`+`warn` aunque sea rápida; `statusCode` 4xx nunca marca error; **el JSON serializado nunca contiene body/nombre buscado/DNI/`Bearer`/`authorization`** (test explícito armando el string completo y buscando esos substrings); `role`/`userId`/`queryCount`/`queryTimeMs` sólo aparecen si se pasan explícitamente. `shouldLogEntry`: slow/verySlow/error nunca se descartan por sample rate; `sampleRate=1`/`0` siempre/nunca para una request normal; respeta una función `random` inyectada (determinístico, sin flakiness). `generateRequestId`: formato y unicidad. `logPerformanceEntry`/`logSlowQuery`: info vs warn según nivel, nunca ambos a la vez; `logSlowQuery` nunca lleva SQL crudo. |
| `shared/observability/requestMetrics.test.ts` (6 tests) | `getRequestMetrics()` fuera de contexto devuelve `undefined`; dentro de `runWithRequestMetrics` devuelve la instancia activa; `recordPrismaQuery` fuera de contexto no revienta; **dos requests concurrentes no mezclan `queryCount`/`queryDurationMs`** (test de aislamiento real, ver §9); `updateRequestMetricsUser` setea `userId`/`role` sólo dentro del contexto activo; una query lenta queda en `slowQueries`, una rápida no. |
| `config/env.test.ts` (7 tests) | `isPerformanceLoggingEnabled()`: default `true` fuera de production, default `false` en production, override explícito en ambos sentidos. `shouldRecordQueryMetrics()`: `false` si cualquiera de los dos flags está apagado, `true` sólo si ambos están prendidos. |
| `middlewares/requestLogger.test.ts` (15 tests) | Llama `next()` siempre; log info bien formado con `method`/`path`/`statusCode`/`durationMs`/`requestId`; **nunca incluye el `Authorization` header ni el body** (test con ambos presentes en el fake request, confirmando ausencia en el string logueado); redacta el query string del path; marca `slow`/`verySlow` en los umbrales configurados (con `vi.useFakeTimers()` + `vi.advanceTimersByTime()`, sin esperas reales); `statusCode` 500 → `error:true`; `statusCode` 404 → `error:false`; se puede apagar con `PERFORMANCE_LOGGING_ENABLED=false`; default seguro apagado en `production` sin configurar nada; respeta el sample rate para requests normales; el sample rate nunca esconde una request lenta/con error; `getSlowEndpointStats()` acumula sólo cuando fue lenta, no para una request rápida. |

**Test 10 del pedido ("no rompe endpoints existentes")**: no es un test unitario dedicado — está cubierto por la suite completa (1051/1051 verdes, incluidos los tests de ruteo real de `hourConceptRules.routing.test.ts`, el único test existente que monta Express directamente) y por `typecheck`/`build` limpios (ver §12).

**Test 11 del pedido (aislamiento de query metrics)**: implementado explícitamente, no sólo documentado — ver la tabla de arriba (`requestMetrics.test.ts`).

---

## 11. Cómo usarlo localmente

En desarrollo, **no hace falta configurar nada** — `PERFORMANCE_LOGGING_ENABLED` queda activo por default (mismo comportamiento que ya tenía el proyecto). Para ver los logs, correr el backend normalmente:

```bash
cd backend
npm run dev
```

Cada request autenticada o pública imprime una línea JSON a stdout. Para ajustar umbrales/sample rate en local, agregar al `.env` de `backend/`:

```bash
PERFORMANCE_LOGGING_ENABLED=true          # default true fuera de production, no hace falta setearlo en dev
PERFORMANCE_LOGGING_SAMPLE_RATE=1         # 1 = loguear todo; bajar a 0.1 para simular producción con tráfico alto
PERFORMANCE_SLOW_REQUEST_MS=1000
PERFORMANCE_VERY_SLOW_REQUEST_MS=3000
PERFORMANCE_LOG_INCLUDE_QUERY_METRICS=true
```

**Para activarlo en producción** (opt-in explícito, recomendado sólo tras revisar el volumen de tráfico real): setear `PERFORMANCE_LOGGING_ENABLED=true` en las variables de entorno del deploy. Se recomienda empezar con `PERFORMANCE_LOGGING_SAMPLE_RATE` bajo (p. ej. `0.1`–`0.2`) si el tráfico es alto — las requests lentas/con error se siguen viendo siempre, sin importar el sample rate.

---

## 12. Cómo leer los logs — ejemplos reales

Los tres ejemplos de abajo son salida real del código (`node`/`tsx`, sin mocks), no texto escrito a mano — se generaron corriendo `requestLogger` real contra requests/responses simuladas.

**Request normal, rápida** (query string descartado, sólo queda el path):
```json
{"level":"info","event":"http_request","timestamp":"2026-09-03T15:16:34.658Z","environment":"staging","requestId":"req_342e8e538cfb4919","method":"GET","path":"/api/workforce/notifications-unread-count","statusCode":200,"durationMs":51,"slow":false,"verySlow":false,"error":false,"role":"NIVEL_1_RRHH","userId":"user-demo-1","queryCount":2,"queryTimeMs":11}
```

**Request lenta** (supera `PERFORMANCE_SLOW_REQUEST_MS`, `event`/`level` cambian):
```json
{"level":"warn","event":"slow_http_request","timestamp":"2026-09-03T15:16:35.708Z","environment":"staging","requestId":"req_5feaf74209534d08","method":"POST","path":"/api/time-entries/clock/photo-punch","statusCode":200,"durationMs":1101,"slow":true,"verySlow":false,"error":false,"role":"NIVEL_1_RRHH","userId":"user-demo-1","queryCount":12,"queryTimeMs":126}
```

**Request con error 500** (lenta *y* con error — ambas condiciones visibles):
```json
{"level":"warn","event":"slow_http_request","timestamp":"2026-09-03T15:16:35.808Z","environment":"staging","requestId":"req_0a7ceae8c57e41dd","method":"POST","path":"/api/novelties/bulk-approve","statusCode":500,"durationMs":1201,"slow":true,"verySlow":false,"error":true,"role":"NIVEL_1_RRHH","userId":"user-demo-1","queryCount":3,"queryTimeMs":18}
```

**Cómo filtrar en la práctica** (cualquier agregador de logs basado en líneas/JSON — Datadog, CloudWatch Logs Insights, `grep`+`jq` en local):
- Endpoints lentos: filtrar `event:"slow_http_request"` o `slow:true`.
- Errores: filtrar `error:true` (cubre cualquier 5xx, esté o no marcado también como lento).
- Un request específico de punta a punta: filtrar por `requestId` (agrupa la línea principal + las líneas `slow_query` asociadas, si las hubo).
- Endpoints críticos de la Parte 5 del pedido (`notifications-unread-count`, `clock/status`, `clock/photo-punch`, `work-shifts`, `novelties/bulk-approve`, `shifts/assignments`, `holiday-work/assignments`, `shift-alerts`, `corrections`, legajos, carga horaria por período, dashboard): todos quedan identificables por `path` (ya normalizado, sin ID/query) sin necesitar ninguna configuración adicional — son paths reales del sistema, no requirieron ningún tratamiento especial en el código.

---

## 13. Riesgos

- **El gate de `client.ts` (`shouldRecordQueryMetrics()`) no tiene un test dedicado** — `client.ts` construye un `PrismaClient` real, no es unit-testeable sin una base de datos; la cobertura real de ese cambio es: `typecheck` limpio, `shouldRecordQueryMetrics()` testeado por separado en `env.test.ts`, y el hecho de que toda la suite de tests del proyecto (que mockea `../shared/prisma/client` en cada módulo, no ejercita el archivo real) sigue en verde. Riesgo bajo (es un cambio de una línea, un `if` que decide si se llama a una función ya testeada), pero documentado explícitamente por transparencia.
- **`SLOW_QUERY_THRESHOLD_MS` sigue leyéndose directo de `process.env`** en `requestMetrics.ts`, fuera del esquema Zod centralizado de `env.ts` — inconsistencia preexistente, no introducida ni corregida en esta etapa (estaba fuera del alcance pedido, que era agregar logging nuevo, no refactorizar configuración existente que ya funcionaba).
- **`GET /health/performance` sigue exactamente igual que antes** (`if (isProduction) return 404`, sin auth, documentado así explícitamente en `docs/BACKEND_API_CONTRACTS.md:1368` como "sin auth... operativo/monitoreo, no de negocio") — no se tocó `health.routes.ts`. Esto significa que `getSlowEndpointStats()` (la agregación en memoria de endpoints lentos) sigue siendo consultable sólo fuera de producción, aunque el logging de líneas individuales ya funcione en producción si se activa. Se documenta como decisión deliberada, no como un olvido: cambiar la exposición de ese endpoint (auth, disponibilidad en producción) es una decisión de seguridad/producto aparte, no parte de "instrumentación pasiva".
- **No se removió el monkey-patch de tamaño de respuesta que tenía el código anterior** — en realidad se **eliminó**, no se mantuvo: el diseño nuevo no reconstruye `res.write`/`res.end`. Se documenta acá como una simplificación deliberada (menos superficie de riesgo, campo no pedido en la Parte 2 del pedido) — si en el futuro se necesita telemetría de payload size (los presupuestos de `docs/PERFORMANCE_NETWORK_OPTIMIZATION_PLAN.md`), es una etapa nueva y acotada, no reintroducida a ciegas acá.
- **Sin medición real de overhead**: el diseño es liviano por construcción (un objeto plano + `JSON.stringify` por request, sin I/O de red, sin escritura a disco), pero no se corrió un benchmark de carga antes/después — si se activa en producción con sample rate 1 y tráfico alto, medir el overhead real antes de confiar en la estimación teórica de "bajo".
- **El `path` normalizado agrupa por endpoint, no por parámetro** — dos requests al mismo endpoint con datos muy distintos (p. ej. `bulk-approve` con 5 ids vs. con 250) generan la misma clave en `slowEndpointStats`; el detalle por request individual sigue disponible en la línea de log completa (`queryCount`/`durationMs` reales de esa request puntual), sólo la agregación pierde ese detalle. Comportamiento heredado sin cambios de la implementación anterior.

---

## 14. Qué NO se tocó

- **Frontend**: cero archivos de `frontend/` tocados.
- **Schema/migraciones**: `backend/prisma/schema.prisma` sin cambios; `npx prisma validate` corrido y en verde: sin diferencias.
- **Fichador**: ningún archivo de `time-entries/clock/*` tocado; el comportamiento funcional del fichador (transacciones, idempotencia, umbrales, evaluación de turnos) es exactamente el mismo antes y después — sólo cambia qué tan detallado es el log de duración/queries de esas mismas requests.
- **Liquidación, Horas Especiales, Conceptos Horarios**: ningún archivo de `hour-concepts/`, `workforce-management/doubleHourRule*` tocado.
- **Alertas**: ningún archivo de `shifts/` tocado; la generación/clasificación/notificación de `ShiftAlert` es exactamente la misma.
- **Permisos/RBAC**: ningún archivo de `authorization.ts` tocado; `auth.ts` sólo se lee (no se modifica) para confirmar que ya llamaba `updateRequestMetricsUser`.
- **Contratos de API**: ningún endpoint cambió su ruta, método, request/response shape, código de estado ni mensaje de error. El logging es enteramente server-side/observability — no hay ningún header ni campo nuevo devuelto al cliente (se evaluó explícitamente devolver `requestId` en un header de respuesta para facilitar soporte, y se descartó por ser un cambio de contrato no pedido — el `requestId` es sólo interno, para correlación de logs).
- **`GET /health/performance`**: sin cambios (ver §13).
- **Optimización de endpoints**: no se optimizó ningún endpoint listado en la Parte 5 del pedido — esta etapa es exclusivamente de medición. Ningún bug de negocio fue detectado por los tests nuevos que ameritara el "bug mínimo indispensable" que la consigna permitía corregir.

---

## 15. Checklist de entrega

- [x] `prisma validate` limpio (sin cambios de schema)
- [x] Backend `typecheck` limpio
- [x] Backend `test` — 1051/1051 verdes (71 archivos, +45 nuevos)
- [x] Backend `build` limpio
- [x] `git diff --check` sin errores de espacios en blanco
- [x] Frontend: sin cambios (no se corrió typecheck/test de frontend, no hacía falta)
- [x] Sin cambios de schema/migraciones
- [x] Sin cambios funcionales en fichador/liquidación/Horas Especiales/Conceptos Horarios/alertas/permisos
- [x] Sin cambios de contratos de API
- [x] Sin commit
