# Estrategia de cache de datos

## Alcance actual

La primera implementación cubre catálogos de bajo riesgo. La prueba de concepto inicial fue `GET /org-structure` y luego se extendió a catálogos operativos.

Se cachea:

| Familia | Endpoint | Tipo de dato | TTL | Storage | Invalidación |
| --- | --- | --- | --- | --- | --- |
| `org-structure` | `GET /org-structure` | Catálogo organizacional no sensible | 10 minutos | Memoria LRU + IndexedDB | Cualquier mutación `/org-structure/*`, logout, cambio de cuenta, clear manual |
| `hour-concepts` | `GET /hour-concepts` | Catálogo de conceptos de horas | 10 minutos | Memoria LRU + IndexedDB | Crear/editar concepto, logout, cambio de cuenta |
| `document-categories` | `GET /document-categories` | Catálogo de tipos documentales, sin archivos | 10 minutos | Memoria LRU + IndexedDB | Crear/editar categoría, logout, cambio de cuenta |
| `novelty-types` | `GET /novelty-types`, `GET /novelty-types/:id` | Catálogo de tipos de novedades | 10 minutos | Memoria LRU + IndexedDB | Crear/editar tipo, logout, cambio de cuenta |
| `salary-categories` | `GET /salary-categories` | Catálogo de categorías salariales | 5 minutos | Memoria LRU + IndexedDB | Logout, cambio de cuenta |
| `audit-parameters` | `GET /audit-parameters` | Catálogo de parámetros de auditoría | 10 minutos | Memoria LRU + IndexedDB | Crear/editar parámetro, logout, cambio de cuenta |
| `positions` | `GET /positions`, `GET /positions/:id` | Puestos sin empleados asignados | 5 minutos | Memoria LRU | Crear/editar/eliminar puesto, mutaciones de estructura, logout, cambio de cuenta |
| `employees` | `GET /employees/options`, `GET /employees/summary`, `GET /employees/org-chart` | Opciones, resumen y organigrama | 60 segundos | Memoria LRU | Mutaciones de empleados, estructura, documentos, logout, cambio de cuenta |
| `dashboard` | `GET /dashboard/metrics` | Métricas operativas agregadas | 30 segundos | Memoria LRU | Mutaciones de empleados, horas, novedades, documentos, logout, cambio de cuenta |
| `time-entries` | `GET /time-entries/summary`, `GET /time-entries/period-employees` | Resúmenes y filas agregadas de carga horaria | 30 segundos | Memoria LRU | Mutaciones de horas, novedades, logout, cambio de cuenta |
| `pending` | `GET /pending` | Cola operativa de pendientes | 30 segundos | Memoria LRU | Mutaciones de horas, novedades, logout, cambio de cuenta |

No se cachean en IndexedDB datos personales, documentos, auditoría, usuarios, fichadas, novedades, cargas horarias ni tokens.

`GET /positions/:id/employees` no se cachea porque contiene datos identificatorios de empleados asignados.

## Arquitectura

La lógica vive en `frontend/src/services/cache`, separada de UI y de los services de dominio:

- `cachedData.ts`: orquesta cache hit/miss, stale-while-revalidate, invalidación y fallback offline.
- `lruMemoryCache.ts`: cache en memoria con política LRU y límite de entradas.
- `indexedDbCacheStore.ts`: persistencia para catálogos de bajo riesgo.
- `cachePolicy.ts`: TTL, versionado y sensibilidad por familia.
- `cacheKey.ts`: claves versionadas y aisladas por usuario usando hash.
- `cacheEvents.ts`: eventos auditables de actualización, invalidación y limpieza.
- `cacheMetrics.ts`: métricas básicas en desarrollo.

`apiClient.ts` no cachea GETs por defecto. Su cache interno queda como opt-in explícito con `apiCache: true`, para evitar que endpoints sensibles entren accidentalmente en cache por usar el cliente HTTP común.

En backend, `createTtlCache` mantiene la API existente pero ahora aplica LRU, límite de entradas y estadísticas (`hits`, `misses`, `evictions`, `hitRate`) para evitar crecimiento indefinido.

## Stale-while-revalidate

Cuando existe un valor fresco, se devuelve inmediatamente.

Cuando existe un valor vencido, se devuelve inmediatamente como fallback y se refresca en segundo plano. Si el servidor responde con datos válidos, se actualiza memoria + IndexedDB y se emite un evento `updated`.

Cuando no existe cache, se consulta al servidor. Si falla y no hay fallback, se propaga el error.

## Seguridad

- Las claves incluyen `cache:v{schemaVersion}:{userHash}:{family}:{requestHash}`.
- `userHash` se calcula con Web Crypto sobre el ID interno del usuario; no se usa email ni token.
- El cache se limpia completo en logout, fallo de login y cambio de cuenta.
- IndexedDB se usa solo para datos marcados como `sensitive: false`.
- Las respuestas se validan antes de guardarse para reducir riesgo de cache poisoning.
- Los logs de cache en desarrollo no incluyen payloads ni datos personales.

## Observabilidad

En desarrollo se expone `window.__APP_CACHE_STATS__()` con:

- `hit`
- `miss`
- `staleHit`
- `revalidation`
- `eviction`
- `invalidate`
- `clear`
- `hitRate`

## Tests

Los tests unitarios cubren:

- cache miss
- cache hit
- expiración por TTL
- stale-while-revalidate
- invalidación manual
- fallback offline con último dato cacheado
- eviction LRU

Comando:

```bash
npm test
```

## Próximos candidatos

Después de validar esta etapa, los siguientes candidatos son:

- Revisar navegación real y métricas de `window.__APP_CACHE_STATS__()` antes de ampliar a otros endpoints.
- Evaluar si algún endpoint dinámico restante merece cache de memoria con TTL ultracorto.

Los endpoints con PII o datos dinámicos deben quedar fuera de IndexedDB y, si se cachean, usar solo memoria con TTL corto.
