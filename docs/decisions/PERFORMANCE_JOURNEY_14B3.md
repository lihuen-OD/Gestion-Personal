# Etapa 14B.3 — Performance Journey automatizado

Fecha: 2026-09-03
Estado: implementado, corrido con éxito contra el entorno local real (backend conectado a staging), pendiente de aprobación para commitear
Alcance: sólo instrumentación de medición (frontend, herramienta nueva de test E2E). No se optimizó ningún endpoint, no se tocó backend, no se tocó schema, no se tocaron reglas funcionales, no se cambió ningún contrato de API.

---

## 1. Objetivo

Automatizar el recorrido manual que las Etapas 13H/13J1 ya venían haciendo "a mano" con Playwright para validación visual (login demo, navegar pantallas críticas, mirar consola/red) y convertirlo en un comando repetible (`npm run perf:journey`) que además produzca un reporte estructurado de performance — endpoints más lentos, más llamados, con error, y un ranking preliminar — sin depender de que alguien esté mirando DevTools en el momento exacto.

---

## 2. Por qué no optimiza todavía

Esta etapa es exclusivamente de medición, por diseño explícito del pedido. El journey **no** modifica ningún endpoint, no cambia ninguna query, no toca ningún componente de negocio — sólo navega, observa y reporta. La primera corrida real (ver §9) encontró varios endpoints en el rango "Crítico" del ranking (`GET /employees/:id/overview-details` a 6.4s, `GET /time-entries/period-employees` a 6.3s, entre otros) — **coinciden exactamente con hallazgos ya documentados en `docs/decisions/PERFORMANCE_AUDIT_14A.md`** (el fan-out de `employeeDetailSelect`, ~24 relaciones anidadas). Confirmar con datos reales que el diagnóstico de 14A seguía vigente era el objetivo de esta etapa — decidir y aplicar la corrección es trabajo de una etapa 14C+ dedicada, con su propio análisis de causa/riesgo/tests, no un efecto colateral de agregar instrumentación.

---

## 3. Herramienta elegida — diagnóstico completo (Parte 1 del pedido)

1. **¿El frontend ya tenía Playwright instalado?** No, como dependencia del proyecto (`frontend/package.json` no lo listaba; los únicos hits de "playwright" en `package-lock.json` eran `@vitest/browser-playwright`, un adaptador opcional de Vitest, no Playwright en sí).
2. **¿Existían tests E2E?** No — no había ningún directorio `e2e/` ni configuración de un test runner de navegador real. El único test que monta Express directamente (`hourConceptRules.routing.test.ts`, backend) es de ruteo, no E2E de UI.
3. **¿Cómo se levanta el frontend local?** Ya documentado en `docs/LOCAL_DEVELOPMENT.md` — `cd frontend && npm run dev`. Confirmado que el puerto real configurado en `vite.config.ts` es **5174** (el doc dice 5173 — desactualizado, no corregido en esta etapa por no ser parte del alcance pedido, sólo señalado acá).
4. **¿Cómo se conecta al backend local?** `VITE_API_URL`, con fallback a `http://localhost:4002/api` si no está seteada (`apiClient.ts:1`) — coincide con `docs/LOCAL_DEVELOPMENT.md`.
5. **¿Cómo se autentica un usuario demo/local?** `LoginPage.tsx` tiene un formulario normal (email/password) **y** tres botones de "acceso rápido" por rol (`quickLogin(role)` → `authApiService` con `demoCredentialsByRole`). El journey usa el botón de acceso rápido "Nivel 1 - RRHH" — evita escribir credenciales a mano en el script y es el mismo mecanismo que ya usaron las validaciones manuales de 13H/13J1.
6. **¿Existe un usuario seed admin/RRHH?** Sí, documentado en `docs/LOCAL_DEVELOPMENT.md` (`admin@losod.local`, rol "Nivel 1 - RRHH", acceso completo) — el journey no repite el email/password en ningún reporte generado (ver §7).
7. **¿Existe endpoint/mecanismo de login?** Sí, `POST /api/auth/login`, sin cambios.
8. **¿Rutas estables para las 14 pantallas pedidas?** Confirmadas las 14, leyendo `frontend/src/App.tsx` antes de escribir una sola línea del spec — ninguna tuvo que inventarse ni hubo que agregar una ruta nueva (detalle completo en `frontend/e2e/support/screens.ts`).
9. **¿El backend ya imprime logs JSON de performance en stdout?** Sí, desde la Etapa 14B.2 (`requestLogger.ts`) — pero condicionado a que el backend corra con `PERFORMANCE_LOGGING_ENABLED` activo (default `true` fuera de `production`, que es el caso del backend local usado acá).
10. **¿Cómo capturar esos logs durante el recorrido?** Ver §9 (Parte 5 del pedido) — se evaluó explícitamente y se decidió **no** intentar capturar el stdout del backend desde este script.
11. **Riesgos de flakiness** — ver §9.
12. **Qué datos sensibles evitar** — ver §7.

**Decisión: agregar `@playwright/test` como devDependency de `frontend/`.** Justificación (Parte del pedido: "si es razonable agregarlo, proponerlo claramente"):
- Es exactamente la herramienta para este trabajo — necesita un navegador real (timing de red real, `console`/`pageerror` reales, capacidad de screenshot ante fallo) — algo que Vitest+jsdom (ya presente, usado para tests de componentes) estructuralmente no puede dar: jsdom no ejecuta requests de red reales ni tiene un motor de layout/paint real.
- Ya era una herramienta de facto del proyecto: usada ad-hoc (vía una herramienta externa a este repo) en las Etapas 13H y 13J1 para validación visual manual — nunca formalizada como dependencia. Los binarios del navegador (`chromium-1234`) ya estaban cacheados en la máquina de desarrollo por ese uso previo.
- Footprint real: **3 paquetes npm agregados** (`@playwright/test` + 2 dependencias directas), **0 MB de descarga de navegador** (ya estaba cacheado, confirmado con `npx playwright install --dry-run chromium` antes de instalar nada). Se fijó la versión exacta `1.62.1` (sin `^`) para que coincida con el build de Chromium ya cacheado y no dispare una descarga nueva en esta máquina ni en el próximo `npm install` de otro desarrollador con la misma versión.
- Se agregó también `@types/node` (no estaba, hacía falta para tipar `node:fs`/`node:path`/`node:url` en el spec) — devDependency estándar, sin footprint de runtime.

---

## 4. Cómo se ejecuta

**Precondición** (no automatizada a propósito — ver §9): backend y frontend ya corriendo localmente, tal como documenta `docs/LOCAL_DEVELOPMENT.md`:
```bash
# terminal 1
cd backend && npm run dev
# terminal 2
cd frontend && npm run dev
```

Luego, desde `frontend/`:
```bash
npm run perf:journey
```

Variables de entorno opcionales (todas con default razonable, no hace falta configurar nada para correrlo local):
```bash
PERF_JOURNEY_BASE_URL=http://localhost:5174        # default
PERF_JOURNEY_API_URL=http://localhost:4002/api     # default
PERFORMANCE_SLOW_REQUEST_MS=1000                   # mismo default que 14B.2
PERFORMANCE_VERY_SLOW_REQUEST_MS=3000               # mismo default que 14B.2
```

También se agregó `npm run typecheck:e2e` (`tsc -p tsconfig.e2e.json --noEmit`) — los archivos de `e2e/` viven fuera del grafo de proyectos de `tsconfig.app.json` (que sólo incluye `src/`, igual que `vite.config.ts` ya vivía fuera de ese grafo antes de esta etapa), así que necesitan su propio chequeo de tipos independiente. No se agregó al `build` existente (`tsc -b && vite build`) para no cambiar lo que ese comando valida — ver §9.

---

## 5. Qué pantallas cubre

Las 14 pedidas, en el orden pedido, todas cubiertas en la corrida real (ver §8): Login, Dashboard, Legajos/Empleados, Detalle de un legajo existente, Conceptos Horarios, Tipos de Novedades, Categorías Documentales, Horas Especiales, Turnos, Regímenes Laborales, Alertas, Auditoría, Carga Horaria, Documentos.

**"Detalle de un legajo existente"** no tiene una ruta fija — el spec visita `/legajos`, toma el primer link real de la tabla (`a[href^="/legajos/"]:not([href="/legajos/nuevo"])`) y navega ahí. Si el listado no devolviera ningún legajo, la pantalla queda documentada como no cubierta con el motivo explícito ("el listado de Legajos no devolvió ningún registro") — no se inventa ni se hardcodea un ID.

**Acción extra, fuera de las 14** (no pedida por la Parte 3, agregada porque el contexto de esta etapa marcaba `POST /api/auth/logout` como ya observado lento en logs reales): **Logout**, medida igual que una pantalla más, en una sección separada del reporte ("acciones adicionales") para no alterar el conteo de "14 pantallas".

---

## 6. Qué métricas captura

Por pantalla:
- `headerVisibleMs` — tiempo desde que arranca la navegación hasta que el primer `<h1>` visible aparece (todas las pantallas del proyecto tienen uno — 12 de las 13 vía el componente compartido `PageHeader`, `EmployeeDetailPage` con un `<h1>` propio). Proxy de "el shell de la pantalla ya renderizó".
- `networkIdleMs` — tiempo hasta que la red queda inactiva (`page.waitForLoadState("networkidle")`). Proxy **aproximado** de "ya terminó de traer datos" — no es exacto (una sección interna podría seguir mostrando su propio loader puntual sin que eso dispare más tráfico de red).
- Requests a la API disparados en esa ventana: método, path (sanitizado), status code, duración real (`request.timing().responseEnd`, ver el bug corregido en §9).
- Errores de consola (`console.error`) y errores de página (`pageerror`) ocurridos en esa ventana.
- Screenshot **sólo si el test completo falla** (comportamiento default de Playwright con `screenshot: "only-on-failure"`, `playwright.config.ts`) — no se guarda ningún screenshot en una corrida exitosa.

Agregado, entre todas las pantallas:
- Top 10 endpoints más lentos (por duración máxima observada).
- Top 10 endpoints más llamados.
- Todos los endpoints con algún status `>= 400`.
- Ranking Crítico/Alto/Medio/Bajo por endpoint (regla documentada en `frontend/e2e/support/reportBuilder.ts`, ver §8).

---

## 7. Qué NO captura

Nunca, por diseño (ninguno de estos campos existe en el código que arma el reporte — no es una redacción posterior, es información que el script nunca lee):
- Tokens JWT, header `Authorization`, cookies.
- Body de ningún request/response.
- Query string de ningún request — se descarta completo (`sanitizeRequestPath`, misma política que `backend/src/shared/observability/logSanitizer.ts` de la Etapa 14B.2, reimplementada acá porque frontend/backend son paquetes npm separados).
- IDs reales en el path — se normalizan a `:id` (mismo criterio que 14B.2).
- Email/password del usuario usado — el reporte sólo dice el rol ("Nivel 1 - RRHH"), nunca repite las credenciales (ya documentadas aparte en `docs/LOCAL_DEVELOPMENT.md`).
- Datos de empleados — el único punto donde el script "lee" un dato real es el `href` del primer legajo de la tabla (un UUID interno, no un dato personal) para poder abrir su detalle; nunca lee/loguea nombre, DNI, CUIL, dirección, etc.

**Límite conocido, documentado explícitamente**: los mensajes de `console.error`/`pageerror` se truncan a 500 caracteres pero **no se sanitizan más allá de eso** — si algún error de consola llegara a interpolar un dato real (poco probable en una app bien comportada, pero no garantizado por el código de este journey), quedaría en el reporte tal cual. Antes de compartir un reporte generado fuera del equipo, revisar la sección 7 ("Errores frontend encontrados") por las dudas — en la corrida real de esta etapa esa sección salió vacía (ver §8).

---

## 8. Cómo leer el reporte

`docs/performance/PERFORMANCE_JOURNEY_14B3.md` — generado automáticamente, se sobreescribe en cada corrida (dice esto mismo en su primera línea). Tiene las 13 secciones pedidas en la Parte 4. `docs/performance/PERFORMANCE_JOURNEY_14B3.json` — mismo contenido en formato estructurado, para comparar corridas futuras programáticamente (no se armó ningún comparador automático todavía — es el candidato natural de una etapa futura si hace falta, ver §10).

**Regla de ranking** (`rankEndpoint`, `frontend/e2e/support/reportBuilder.ts`, testeada con Vitest):
- **Crítico**: algún 5xx en ese endpoint, o algún request individual `>= verySlowThresholdMs` (3000ms default).
- **Alto**: algún 4xx (inesperado en un recorrido de sólo lectura con un usuario RRHH con acceso completo), o algún request individual `>= slowThresholdMs` (1000ms default).
- **Medio**: el promedio del endpoint ya es visible (`>= slowThresholdMs/2`) aunque ningún request individual haya cruzado el umbral.
- **Bajo**: todo lo demás.

**Resultado de la corrida real** (2026-09-03, backend local conectado a la base real de staging): las 14 pantallas cubiertas, 0 errores de consola, 0 requests con status `>= 400`, **7 endpoints en Crítico** — `GET /employees/:id/overview-details` (máx 6441ms), `GET /time-entries/period-employees` (6298ms), `GET /employees` (4273ms), `GET /positions` (4166ms), `GET /shifts/alerts` (3906ms), `GET /dashboard/metrics` (3665ms), `GET /audit` (3063ms). Corroboran de forma independiente y con datos reales varios de los hallazgos ya documentados en `docs/decisions/PERFORMANCE_AUDIT_14A.md` (en particular, el fan-out de `employeeDetailSelect`). No se investigó la causa acá — ese es exactamente el trabajo de una etapa 14C+ dedicada.

---

## 9. Riesgos

- **Bug real encontrado y corregido durante esta misma etapa**: la primera corrida completa del journey devolvió `durationMs: 0` para **todos** los requests, sin excepción — una señal inequívoca de bug de instrumentación, no de que todo fuera instantáneo. Causa: `request.timing().startTime` es un **epoch absoluto** (ms desde 1970), mientras que el resto de los campos (`responseEnd`, etc.) ya vienen como "ms transcurridos desde `startTime`" — la resta `responseEnd - startTime` daba un número gigante negativo, clampeado a `0` por el `Math.max(0, ...)` que tenía el código. Corregido: la duración real es directamente `timing.responseEnd` (documentado con un comentario en el propio código para que no se reintroduzca). Se dejó como evidencia de que esta etapa se validó con una corrida real, no sólo con el `test` compilando — un test que sólo verifica "no explota" no hubiera atrapado este bug.
- **Flakiness**: mitigado, no eliminado. `waitForLoadState("networkidle")` tiene un timeout de 15s por pantalla (si nunca queda idle — p. ej. un polling agresivo — la pantalla igual se reporta, con `networkIdleMs: undefined`, en vez de hacer fallar todo el journey). El único punto que si falla revienta el test completo es el login (sin sesión real, ninguna pantalla siguiente tiene sentido) — decisión deliberada, no un descuido. `retries: 0` en `playwright.config.ts`: a propósito, para no esconder flakiness real reintentando en silencio (un journey de medición que reintenta solo estaría maquillando el propio problema que busca medir).
- **Un solo usuario, sin concurrencia**: el reporte lo dice explícitamente en su última sección — esto mide un recorrido puntual, no reemplaza el logging real de producción/staging acumulado en el tiempo (Etapa 14B.2). Los tiempos observados en una corrida contra Neon (staging) pueden variar entre corridas por la misma razón ya documentada en `docs/decisions/CLOCK_PHOTO_PUNCH_EXIT_TRANSACTION_13F.md` (latencia variable del pooler remoto, cold starts).
- **Corre contra datos reales de staging**: el login (con el usuario seed RRHH) y la navegación de sólo lectura generan tráfico real contra la base de staging (incluida al menos una fila de auditoría por el login, ya esperado y aceptado — mismo patrón que las validaciones manuales de 13H/13J1). El journey nunca envía un formulario ni hace ninguna escritura — confirmado por lectura completa de `performanceJourney.spec.ts`: no hay un solo `.click()` sobre un botón de guardar/crear/editar/eliminar, sólo navegación (`.goto`) y dos clicks de acceso rápido (login/logout).
- **`GET /health/performance` y los logs backend de 14B.2 no se cruzan automáticamente con este reporte** — ver Parte 5 del pedido, decisión explícita abajo.

**Parte 5 del pedido — relación con los logs de 14B.2, decisión explícita**: se evaluó capturar y parsear el stdout del backend (líneas JSON de `requestLogger.ts`) durante el journey. **Se decidió no hacerlo**, por una razón concreta, no por pereza: el backend usado por este journey **ya está corriendo como proceso externo** (precondición documentada en §4, igual que el resto del proyecto) — este script no lo lanza ni lo controla, así que no tiene ningún pipe al que engancharse sin **reiniciar** ese proceso (perdiendo su estado/conexiones actuales) o sin pedirle al usuario que redirija manualmente su `npm run dev` a un archivo (`npm run dev > backend.log 2>&1`, fuera del control de este script). Cualquiera de las dos opciones es más fràgil que el valor que aporta, para un dato que **ya se puede cruzar a mano** (buscar el mismo `path` sanitizado en el log de 14B.2 alrededor del mismo rango horario) — exactamente el criterio que pedía "no sobre-ingenierizar" si la integración automática resulta frágil. En su lugar: Playwright's `request.timing()` es la fuente de verdad de este reporte (incluye latencia de red real ida y vuelta, algo que el logging del lado del servidor de 14B.2 no mide — 14B.2 mide sólo el tiempo del lado del servidor); el reporte lo dice explícitamente en su sección 13 ("cruzar estos hallazgos con logs reales"). Documentado acá como estaba pedido, en vez de forzar una integración fràgil.

---

## 10. Próximos pasos

- **No implementado a propósito, candidato futuro**: un comparador automático entre dos corridas del JSON (detectar regresiones, no sólo el estado actual) — tiene sentido recién cuando haya más de una corrida real para comparar; hoy sería una abstracción sin un segundo caso de uso confirmado.
- **No implementado a propósito**: correr el journey en CI — hoy depende de un backend+frontend locales ya levantados contra una base real; correrlo en CI necesitaría una base de datos de test propia (seed reproducible, aislada), que es un trabajo aparte y no trivial (fuera del alcance de esta etapa, que pedía explícitamente "no sobre-ingenierizar").
- **Recomendación inmediata** (dato, no implementación): los 7 endpoints Crítico de la corrida real (§8) son el input más concreto para decidir el contenido de la próxima etapa de optimización (14C) — en particular `GET /employees/:id/overview-details` y `GET /employees` corroboran con datos reales el hallazgo de `employeeDetailSelect` ya documentado en 14A.
- Repetir el journey después de cualquier cambio de performance futuro (14C+) para confirmar mejora con el mismo método, no sólo con la lectura de código.

---

## 11. Qué NO se tocó

- **Backend**: cero archivos de `backend/` tocados en esta etapa (el journey sólo consume el backend ya corriendo, no lo modifica).
- **Schema/migraciones**: sin cambios.
- **Reglas funcionales**: el journey es 100% de sólo lectura — sin un solo `.click()` sobre una acción de guardar/crear/editar/eliminar/aprobar/rechazar en todo el spec.
- **Fichador, liquidación, Horas Especiales, Conceptos Horarios, alertas, permisos**: sin cambios funcionales — sólo se navegó a sus pantallas para medir, nunca se interactuó con sus formularios.
- **Contratos de API**: ningún endpoint cambiado.
- **`npm run build`/`npm run test` existentes**: siguen haciendo exactamente lo mismo que antes (`tsc -b && vite build` / `vitest run`) — se agregó un `exclude` a la config de Vitest para que no intente correr los `*.spec.ts` de Playwright como si fueran tests suyos (sin eso, `npm run test` se hubiera roto), y se agregó un script nuevo (`typecheck:e2e`) sin tocar ninguno existente.

---

## 12. Checklist de entrega

- [x] Backend: `prisma validate` limpio (sin cambios de schema)
- [x] Backend: `typecheck`/`test`/`build` limpios (sin cambios de backend — se re-corrieron igual, por consistencia con el resto del proyecto)
- [x] Frontend: `typecheck:e2e` limpio
- [x] Frontend: `tsc -b --noEmit` limpio (el que ya usa `npm run build`)
- [x] Frontend: `npm run test` — 67 archivos, 549 tests, todos verdes (+2 archivos/+20 tests de esta etapa)
- [x] Frontend: `npm run build` limpio
- [x] Frontend: `npm run perf:journey` corrido con éxito contra el entorno local real — reporte generado en `docs/performance/PERFORMANCE_JOURNEY_14B3.md`/`.json`
- [x] `git diff --check` sin errores de espacios en blanco
- [x] Sin datos sensibles en el reporte generado (verificado con grep: sin `password`/`bearer`/`authorization`/credenciales/emails)
- [x] Sin cambios de schema/migraciones
- [x] Sin cambios funcionales en ningún módulo de negocio
- [x] Sin cambios de contratos de API
- [x] Sin commit
