# Etapa 14F.1 — Diagnóstico del aterrizaje inicial / login

Fecha: 2026-09-07
Estado: **diagnóstico completo. Sin cambios funcionales — sólo instrumentación de medición nueva (journey `perf:journey:landing`), sin tocar ningún código productivo.**
Alcance: mapear con precisión el flujo login → primer contenido en `/`. NO se optimizó nada — los hallazgos de esta etapa son candidatos documentados para una futura 14F.2.

---

## 1. Resumen del diagnóstico

El problema real **no es un endpoint roto** (14E.1/14E.2 ya lo confirmaron) — es la **suma** de 6 requests que se disparan tras el login, de las cuales **2 pares están duplicados por StrictMode sin ningún dedupe frontend** (`notifications-unread-count`, `/api/audit`), y una de ellas (`GET /api/audit`) **acopla su lentitud a la del dashboard completo** por compartir el mismo `Promise.all`/estado de carga que `dashboard/metrics`. Además, se confirmó con evidencia nueva (medida, no supuesta) que el **shell de la app (sidebar, navegación) es usable ~1.3-2.0s después del login**, mucho antes de que la red quede "idle" (~3.0-6.4s) — la métrica de network idle sobreestima la mala experiencia real.

---

## 2. Revisión de código (Parte 1 del pedido)

### Frontend

1. **`LoginPage.tsx`**: formulario + 3 botones de acceso rápido por rol. Llama `useAuth().login`/`loginAs` — no dispara ningún fetch de datos de negocio por sí mismo.
2. **`AuthContext.tsx`**: `login()` llama `authApiService.login(email, password)` (único POST), guarda tokens + `user` en `sessionStorage`. `clearAllAppCaches()` sólo se llama si se cambia de usuario (no en un login fresco) o en logout/fallo.
3. **Navegación post-login**: no hay una redirección explícita — `App.tsx` re-renderiza condicionalmente según `user` (de `undefined` a definido) y monta `<AppShell>` con `<Routes>` en `/`.
4. **Router (`App.tsx`)**: `/` → `DashboardPage` (lazy) para niveles 1/2, redirect a `/gestion-horaria` para nivel 3. Todas las páginas son `React.lazy` — la primera vez que se visita `/` en la sesión, el navegador debe descargar+parsear el chunk de `DashboardPage` antes de que monte.
5. **Layout principal (`AppShell.tsx`)**: envuelve `<Suspense>`+`<Routes>` — **no está lazy, no espera ningún dato para renderizar** sidebar/header. Dispara `workforceApiService.unreadNotificationCount()` en un `useEffect` (deps `[user?.id]`) + `setInterval` de **60s** para refrescarlo.
6. **Providers globales**: sólo `AuthProvider` (contexto simple, sin fetch propio).
7. **Hooks globales**: ninguno adicional relevante al aterrizaje más allá de lo ya cubierto.
8. **`DashboardPage.tsx`**: `useEffect` con `Promise.all([dashboardMetricsApiService.getMetrics(...), level===1 ? dashboardMetricsApiService.getAudit(5) : Promise.resolve([])])` — **un único estado `status` (`loading`/`success`/`error`) gobierna AMBAS respuestas juntas**, aunque alimentan secciones visualmente distintas de la página (KPI cards vs. feed de actividad reciente).
9. **Sidebar/header (`AppShell.tsx`)**: ya cubierto en el punto 5 — el badge de notificaciones no bloquea nada (arranca en 0, se actualiza async).
10. **Componente de notificaciones**: el badge en sí vive en `AppShell.tsx` (punto 5); `NotificationsPage.tsx` (la pantalla completa) no se monta durante el aterrizaje.
11. **Componente de auditoría/actividad reciente**: dentro de `DashboardPage.tsx` (acoplado a `getAudit`, punto 8).
12. **Stores/contextos globales**: sólo `AuthContext` (punto 2/6).
13. **Servicios API usados al montar `/`**: `dashboardMetricsApiService.getMetrics`/`.getAudit` (→ `auditApiService.getAll`), `workforceApiService.unreadNotificationCount`.
14. **Cache frontend**: `dashboardMetricsApiService.getMetrics` **SÍ** usa `cachedData` (familia `dashboard`, TTL 30s, dedupe in-flight). `auditApiService.list`/`.getAll` y `workforceApiService.unreadNotificationCount` **NO tienen ningún cache frontend** — llaman `apiRequest` directo (`apiCache: false`, flag deprecado/no-op).
15. **Dedupe frontend**: sólo existe donde hay `cachedData` (punto 14) — por eso `dashboard/metrics` nunca se duplica pese a StrictMode, pero `notifications-unread-count` y `/api/audit` sí.
16. **Loaders/skeletons**: `DashboardPage` muestra un `LoadingState variant="table"` (skeleton de KPIs) mientras `status==="loading"` — nunca blanquea la página completa. `AppShell` no tiene loading propio (renderiza sidebar/header de inmediato).
17. **Manejo de error**: `DashboardPage` muestra un `ErrorState` con retry localizado (dentro de la sección "Indicadores"), no rompe el resto del shell. `AppShell`'s notification fetch usa `.catch(() => undefined)` — silencioso pero de bajo riesgo (un badge en 0 no es un error visible que oculte información crítica).

### Backend

18. **`POST /api/auth/login`**: `authService.login` — 1 `SELECT` (`findByEmailWithPassword`) + `bcrypt.compare` (CPU, deliberadamente costoso) + 1 `INSERT` vía `auditService.register()` (registra el login exitoso). **Esta llamada a `auditService.register()` es la causa estructural de que `dashboard/metrics` y `/api/audit` SIEMPRE sean cache-miss inmediatamente después de un login** — ver hallazgo §5.
19. **`GET /api/dashboard/metrics`**: ya optimizado en 14E.1/14E.2 (13 queries, batches de 5, 200 estable, ~1.3-4.4s en frío). Cache backend 30s (`dashboardMetricsCache`), scopeado por `{period,userId,role,companyId,sectorId}`.
20. **`GET /api/workforce/notifications-unread-count`**: `prisma.systemNotification.count({where:{recipientUserId, status:"NO_LEIDA"}})` — 1 query simple, genuinamente por-usuario. **Sin ningún cache backend.**
21. **`GET /api/audit`**: `auditService.list` → `auditRepository.findMany` (paginado). Cache backend 15s (`auditListCache`, controller-level, clave = `req.originalUrl`) — **seguro sin scope por usuario** porque `getAudit(5)` no pasa `userId` (feed global de actividad, mismo para cualquier RRHH) y la ruta ya está restringida a `adminRoles`.
22. **`GET /api/employees/summary`, `GET /api/employees`, `GET /api/org-structure`**: **NO se observaron en el aterrizaje** en ninguna de las 4 corridas medidas (2 del journey de Legajos, 2 del journey nuevo de landing) — eran especulativos en el pedido, no confirmados. Documentado explícitamente para no inventar un hallazgo que la medición no sostiene.
23. **Middlewares globales / `requireAuth`**: `authService.getCurrentUser(userId)` tiene su propio cache in-memory de 5s (`AUTH_USER_CACHE_MS`, no 60s como podría suponerse) — irrelevante para el primer login (no hay token todavía en ese momento), relevante para requests posteriores dentro de la misma sesión.
24. **Logging/performance logger**: ya cubierto en 14E.1/14E.2 — sin cambios, sin PII, structured JSON.
25. **Cache backend existente**: `dashboardMetricsCache` (30s), `auditListCache` (15s) — **ambos invalidados incondicionalmente por CUALQUIER login exitoso** (ver hallazgo §5). `notifications-unread-count` no tiene cache backend.
26. **RBAC de los 4 endpoints**: `auth/login` público (sin auth previa, por diseño). `dashboard/metrics`/`workforce/notifications-unread-count` con `requireAnyRole(all)`/similar. `/audit` con `requireAnyRole(adminRoles)` — sin cambios en esta etapa.

---

## 3. Matriz obligatoria (Parte 2 del pedido)

| Request | Método | Endpoint | Lo dispara | Archivo/componente | Momento | Bloquea 1er render | Necesario 1er render | Cache frontend | Cache backend | Duplicado | Duración observada | Diferible | Riesgo de diferir | Recomendación |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Login | POST | `/auth/login` | Click en botón de acceso rápido | `LoginPage.tsx`/`AuthContext.tsx` | Antes de cualquier otra cosa | **Sí** (bloquea todo — nada puede pasar sin tokens) | Sí | No aplica | No aplica | No | 766-1146ms | No | — | Sin cambios — es inherente al modelo de auth |
| Notificaciones | GET | `/workforce/notifications-unread-count` | `AppShell.tsx` (mount) | `AppShell.tsx` | Junto con el mount del shell, tras login | **No** (el shell renderiza con badge=0 antes de que resuelva) | No | **No** | No | **Sí, x2** (StrictMode, sin dedupe) | 163-879ms | Sí, ya es background | Bajo | **Dedupe** (B) — candidato 14F.2 |
| Auditoría (widget) | GET | `/audit?take=5` | `DashboardPage.tsx` (mount, sólo RRHH) | `DashboardPage.tsx` | Junto con `getMetrics`, mismo `Promise.all` | **Sí, hoy** (mismo `status` que las KPI cards) | No (alimenta un widget secundario, no las KPIs) | **No** | Sí (15s, pero ver §5) | **Sí, x2** (StrictMode, sin dedupe) | 591-2072ms | **Sí** — no debería compartir estado con las KPIs | Bajo | **Diferir** (A) + **Dedupe** (C) — candidatos 14F.2 |
| Dashboard metrics | GET | `/dashboard/metrics` | `DashboardPage.tsx` (mount) | `DashboardPage.tsx` | Junto con `getAudit`, mismo `Promise.all` | Sí (gobierna las KPI cards) | **Sí** | Sí (30s, dedupe in-flight) | Sí (30s, pero ver §5) | No (ya deduplicado) | 1257-4385ms | No (es el contenido principal de la pantalla) | — | Ya optimizado (14E.1/14E.2) — sin cambios |
| Employees summary/list, org-structure | — | — | — | — | — | — | — | — | — | — | **No observado en ninguna corrida** | — | — | No aplica — no ocurre en el aterrizaje |

---

## 4. Medición (Parte 3 del pedido)

### 4.1 Se creó `npm run perf:journey:landing` (nuevo, chico)

Se creó (`frontend/e2e/landingPerformanceJourney.spec.ts` + `frontend/e2e/support/landingJourney.ts`) porque **el journey existente (`perf:journey:employees`) ya mide bien la acción "Login" en sí, pero no da timing relativo por request** (sólo duración individual, no cuándo empezó/terminó cada uno respecto al inicio) — sin eso no se puede responder con precisión "¿qué tan rápido es usable el shell vs. cuándo termina todo de cargar en el fondo?" (Parte 4 del pedido). El nuevo script:
- Corre en ~30s (vs. ~40-50s del journey completo de Legajos) — pensado para iterar rápido sobre el aterrizaje específicamente.
- Captura `startOffsetMs`/`endOffsetMs` por request (no sólo `durationMs`).
- Corre 3 veces en la misma sesión de Playwright: **fría** (primera visita), **tibia** (logout + login inmediato) y **después de 16s** (logout + esperar 16s, pasa el TTL de `auditListCache` de 15s sin pasar el de `dashboardMetricsCache` de 30s).
- Reusa `sanitizeRequestPath` (mismo módulo que el journey de Legajos) — nunca guarda una URL cruda, un UUID sin normalizar, ni ningún token/credencial.
- Produce `docs/performance/LANDING_PERFORMANCE_JOURNEY_14F1.md`/`.json`.

**No se modificó el journey existente de Legajos** — es un archivo completamente nuevo y separado, cero riesgo para la infraestructura ya probada.

### 4.2 Tabla obligatoria — 2 corridas independientes del script nuevo (6 sub-corridas en total)

| Corrida | Login visible (`.app-shell`) | Login network idle | Requests totales | HTTP errors | Console errors | Endpoint más lento | Observación |
|---|---|---|---|---|---|---|---|
| Corrida A — fría | 1635ms | 6402ms | 6 | 0 | 0 | `dashboard/metrics` (4385ms) | 2 duplicados (notifications, audit) |
| Corrida A — tibia | 867ms | 3255ms | 6 | 0 | 0 | `/audit` (1879ms) | 2 duplicados |
| Corrida A — después de 16s | 1373ms | 3092ms | 6 | 0 | 0 | `dashboard/metrics` (1597ms) | 2 duplicados |
| Corrida B — fría | 1958ms | 4275ms | 6 | 0 | 0 | `dashboard/metrics` (1934ms) | 2 duplicados |
| Corrida B — tibia | 1375ms | 3200ms | 6 | 0 | 0 | `dashboard/metrics` (1762ms) | 2 duplicados |
| Corrida B — después de 16s | 1369ms | 3046ms | 6 | 0 | 0 | `dashboard/metrics` (1441ms) | 2 duplicados |

**No se inventó ningún número** — las 6 sub-corridas son datos reales de 2 ejecuciones independientes de `npm run perf:journey:landing`, sin promediar para verse más prolijo. `dashboard/metrics` domina en 5/6 corridas; `/audit` dominó en 1/6 (corrida A-tibia).

### 4.3 `npm run perf:journey:employees` (Parte 9, confirmación cruzada)

Corrido una vez como validación — misma acción "Login" (6 requests, mismo patrón de 2 duplicados), 0 errores HTTP/consola, `networkIdleMs=3473`. Confirma que el patrón medido por el script nuevo es consistente con el journey ya establecido — **no son mediciones contradictorias, son complementarias**.

**Hallazgo adicional al correr ambos journeys en paralelo**: el journey de Legajos reporta `visibleMs=563` para "Login" — **este número es engañoso** (ver §6) porque usa `page.locator("h1").first()` como señal de "visible", y **tanto `LoginPage` como `DashboardPage` tienen su propio `<h1>`** — el de `LoginPage` (headline de marketing) ya está en el DOM antes de que el login siquiera se dispare, así que esa medición captura básicamente "tiempo de carga inicial de la página", no "tiempo hasta que el dashboard autenticado es visible". El script nuevo corrige esto usando `.app-shell` (sólo existe con sesión activa) como señal — de ahí la diferencia entre 563ms (journey viejo, señal ambigua) y 867-1958ms (journey nuevo, señal inequívoca). **No se corrigió el journey de Legajos en esta etapa** (fuera de alcance — es diagnóstico, no tocar infraestructura ya probada) — queda documentado como hallazgo/candidato.

---

## 5. Hallazgo no anticipado: el login invalida sus propios caches del aterrizaje

`auditService.register()` (llamado por `authService.login()` en CADA login exitoso, para registrar el evento) llama incondicionalmente `clearAuditListCache()` **y** `clearDashboardMetricsCache()`. Esto significa que **`dashboard/metrics` y `/audit` nunca pueden servirse desde cache backend inmediatamente después de un login** — cada aterrizaje real vía login es, estructuralmente, un cache-miss garantizado para ambos, sin importar cuán reciente sea la última lectura. La variación de velocidad observada entre corridas ("tibia" vs "fría") se explica por calentamiento de la conexión a Neon, **no** por hits de cache — confirmado comparando duraciones (ninguna corrida "tibia" muestra una duración cercana a 0ms, que sería la señal de un cache-hit real).

Esto es coherente para `/audit` (el login mismo generó una fila nueva que el feed de actividad debería reflejar) pero **no está claro que sea necesario para `dashboard/metrics`** (ningún KPI del dashboard depende de si alguien acaba de loguearse) — candidato documentado en §7, no aplicado.

---

## 6. Visible vs Network idle

1. **¿La pantalla se ve rápido pero network idle tarda?** **Sí, claramente.** El shell autenticado (`.app-shell`: sidebar + navegación + header) es visible en **1.3-2.0s** en las 2 corridas "fría" medidas — la red no queda "idle" hasta **4.3-6.4s**. La brecha (~2.5-4.4s) es tiempo en que la app ya es usable pero sigue habiendo requests de fondo.
2. **¿Hay skeletons parciales?** Sí — `DashboardPage` muestra un skeleton de tabla (`LoadingState variant="table" rows={2} columns={4}`) en el lugar de las KPI cards mientras `status==="loading"` — nunca una pantalla en blanco.
3. **¿Hay bloqueo de página completa?** No — confirmado leyendo el código: `AppShell` (sidebar/header) se renderiza incondicionalmente, sin esperar ningún dato. Sólo el contenido INTERNO de `DashboardPage` (las KPI cards) queda en estado de carga.
4. **¿Se puede navegar mientras cargan requests?** **Sí** — los links del sidebar están montados y son clickeables desde el instante en que `.app-shell` aparece (~1.3-2.0s), sin ninguna dependencia de si `dashboard/metrics`/`audit` ya resolvieron.
5. **¿Qué requests son estrictamente necesarios para USAR la pantalla (no para tener el contenido completo)?** Ninguno de los 4 — el shell + navegación funcionan con datos en 0/vacío. Para tener el **contenido específico del Dashboard** (no sólo "poder navegar"), `dashboard/metrics` es el único estrictamente necesario; `notifications-unread-count` y `/audit` son informativos, no bloqueantes por diseño de producto (un badge en 0 o un feed vacío no impide usar nada).
6. **¿Qué requests podrían pasar a background sin que nadie lo note como "malo"?** `notifications-unread-count` (ya es efectivamente background) y `/audit` (hoy acoplado innecesariamente a las KPIs vía el mismo `Promise.all`/`status`).

**Conclusión de esta sección**: el problema **no es tan grave en términos de UX real** como "Crítico (network idle > 3000ms)" sugiere — el shell es usable mucho antes. Sí es un problema real y medible en términos de: (a) carga innecesaria en el backend por 2 duplicados por StrictMode, y (b) que el widget de auditoría retrasa innecesariamente el momento en que las KPI cards (el contenido principal del Dashboard) muestran números reales.

---

## 7. Candidatos de optimización para 14F.2 (Parte 5 del pedido — no aplicados)

| Candidato | Tipo | Beneficio esperado | Riesgo | Archivos a tocar | Backend | Frontend | Recomendado para 14F.2 |
|---|---|---|---|---|---|---|---|
| Diferir `getAudit` del `Promise.all` de `DashboardPage` (mostrar KPIs apenas resuelve `getMetrics`, feed de actividad con su propio loading) | A. Diferir | Las KPI cards podrían mostrarse hasta ~2s antes en las corridas donde `/audit` es el más lento | Bajo — sólo cambia cuándo se pinta un widget secundario | `DashboardPage.tsx` | No | Sí | **Sí, prioridad alta** |
| Dedupe `unreadNotificationCount` (mismo patrón `cachedData` ya usado en `getMetrics`) | B. Dedupe | Elimina 1 request duplicado por mount (StrictMode) | Bajo — patrón ya probado 3+ veces en el proyecto | `workforceApiService.ts` (+ policy de cache nueva) | No | Sí | **Sí, prioridad alta** |
| Dedupe `auditApiService.list`/`getAll` (mismo patrón) | B. Dedupe | Elimina 1 request duplicado por mount | Bajo — mismo patrón | `auditApiService.ts` (+ policy de cache) | No | Sí | **Sí, prioridad alta** |
| Reconsiderar si un login exitoso debe invalidar `dashboardMetricsCache` (no sólo `auditListCache`) | C. Cache (ajuste de invalidación, no cache nuevo) | Un login podría a veces servir `dashboard/metrics` desde cache backend real (hasta 30s de ahorro completo) | **Medio** — cambia una regla de invalidación existente; requiere confirmar que ningún KPI depende de eventos de login antes de tocarlo | `auditService.ts` (línea de invalidación) | Sí | No | Evaluar con cuidado, no trivial |
| Preload del chunk de `DashboardPage` mientras el usuario está en `LoginPage` | E. Preload no bloqueante | Reduce el pequeño delay de descarga/parseo del chunk antes de que `AppShell`/`DashboardPage` monten | Bajo — patrón estándar de `import()` adelantado | `LoginPage.tsx` o `App.tsx` | No | Sí | Prioridad media |
| Endpoint de bootstrap agregado (login+metrics+notifications+audit en 1 sola respuesta) | F. Endpoint agregado | Teórico: menos round-trips | **Alto** — cambia contrato, mezcla dominios (auth con datos de negocio), complejidad de diseño no trivial | Varios módulos | Sí | Sí | **No recomendado como primer paso** — el pedido mismo lo desalienta sin necesidad clara |
| Revisar payload de `/audit?take=5` (¿trae más campos de los que el widget muestra?) | G. Reducir payload | Desconocido — no diagnosticado a fondo esta etapa | Bajo (sólo diagnóstico) | `audit.repository.ts` | Sí (diagnóstico) | No | Diagnosticar en 14F.2 antes de decidir |
| Optimizar la query de `/audit` en sí (siempre cache-miss en este flujo, ver §5) | H. Backend puntual | Podría bajar su ~600-2000ms observado | Medio — requiere el mismo rigor de diagnóstico que 14E.1/14E.2 | `audit.repository.ts` | Sí | No | Diagnosticar en 14F.2 |

---

## 8. Reglas de seguridad (Parte 6) — cumplimiento

No se desactivó ningún request sin entender para qué sirve (todos quedaron mapeados, §2-3). No se ocultó ningún error (0 HTTP/consola en las 6 sub-corridas + 1 corrida de Legajos, reportado tal cual). No se cambiaron roles/permisos/respuestas de endpoints existentes. No se rompió ningún cache existente (todos quedaron exactamente igual — el hallazgo de §5 se documenta, no se corrige). No se creó ningún endpoint bootstrap. No se tocó ningún módulo fuera del aterrizaje (Legajos, Carga Horaria, Fichador, Turnos, Horas Especiales, Conceptos Horarios, Puestos — todos sin diff). No se borró auditoría/notificaciones. No se cambió la navegación post-login (sigue siendo la misma condicional en `App.tsx`, sin tocar).

---

## 9. Tests agregados (Parte 7)

Se modificó/creó código productivo de instrumentación (el journey nuevo + su módulo de soporte), así que corresponden tests — **11 tests nuevos** en `frontend/e2e/support/landingJourney.test.ts`:
- `toSanitizedRequest`: sanitiza URL (sin query string, IDs normalizados), nunca conserva la URL cruda, redondea duraciones/offsets sin negativos, nunca deja pasar un token aunque la URL cruda lo llevara.
- `findDuplicateRequests`: detecta duplicados por método+path exacto, no confunde métodos distintos en el mismo path, no marca falsos positivos, ordena por cantidad.
- `topSlowestRequests`/`countHttpErrors`: orden correcto, límite respetado, sólo cuenta status ≥ 400.
- `buildLandingMarkdownReport`: nunca incluye una URL cruda ni un ID sin sanitizar en el texto final; reporta "sin duplicados" correctamente cuando no hay ninguno.

El spec de Playwright (`landingPerformanceJourney.spec.ts`) en sí no tiene test unitario propio — mismo criterio que `employeesPerformanceJourney.spec.ts` (la orquestación de Playwright no se testea con Vitest, sólo su módulo de soporte puro).

**Checklist de la Parte 7 del pedido, confirmado**:
- Cubre login: sí (3 veces por corrida).
- Captura requests: sí, con timing relativo.
- Sanitiza IDs: sí (`sanitizeRequestPath`, mismo módulo ya probado).
- No filtra tokens: confirmado con test dedicado + `grep` sobre el reporte generado real (0 coincidencias).
- No guarda datos sensibles: confirmado (0 emails/passwords/tokens en el reporte generado real).
- Produce JSON/MD: sí.
- No escribe datos: confirmado — sólo login/logout/navegación, ningún formulario de negocio.

---

## 10. Riesgos

- El nuevo script agrega una dependencia de mantenimiento más (un journey más para mantener sincronizado si `AppShell`/`LoginPage`/`DashboardPage` cambian sus selectores) — mismo tipo de riesgo ya aceptado para `perf:journey:employees`.
- La corrida "tibia"/"después de 16s" dependen de logout+login reales dentro del mismo test — si `logout()` cambiara de comportamiento (por ejemplo, se agregara una confirmación modal), el helper `logout()` de este script necesitaría actualizarse.
- El hallazgo de §5 (login invalida sus propios caches) es específico de este flujo — si se decide "corregir" en 14F.2 sin medir con cuidado, existe riesgo real de romper la propiedad de que el feed de auditoría siempre refleje el login más reciente.

## 11. Qué NO se tocó

Legajos, Carga Horaria, Fichador, Turnos, Horas Especiales, Conceptos Horarios, Puestos, `dashboard.service.ts`/`dashboard.repository.ts` (ningún cambio funcional — sólo se leyeron), `AppShell.tsx`, `DashboardPage.tsx`, `LoginPage.tsx`, `AuthContext.tsx`, `auditApiService.ts`, `workforceApiService.ts` (todos leídos, ninguno modificado), Prisma schema, migraciones, RBAC, contratos de API, diseño visual, `employeesPerformanceJourney.spec.ts`/`performanceEmployeesJourney.ts` (el journey de Legajos existente — cero cambios, pese a que su métrica "Login visible" tiene la misma ambigüedad documentada en §4.3; se dejó explícitamente sin tocar por ser infraestructura ya probada, fuera del foco quirúrgico de esta etapa de diagnóstico). `docs/PERFORMANCE_STANDARDS.md` — no se encontró ninguna regla transversal nueva que ameritara actualizarlo (el hallazgo de §5 es específico del flujo de login, no un patrón general).
