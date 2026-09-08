# Etapa 14H.1 — Diagnóstico macro de performance de Configuración + Puestos

Fecha: 2026-09-08
Estado: journey implementado, corrido contra staging real, **pendiente de aprobación para commitear**
Alcance: exclusivamente diagnóstico/medición de la landing de Configuración (`/configuracion`), sus 10 tarjetas de submódulo, y Puestos (`/puestos`, `/puestos/:id`, `/puestos/nuevo`). **No se optimizó nada, no se modificó ninguna lógica de negocio, no se tocó ningún archivo backend, no se tocó ningún archivo de `src/` del frontend.** El único módulo previamente cerrado que se toca es `frontend/package.json` (un script nuevo). Primera etapa de la serie **14H — "Performance read-only de módulos administrativos/configuración"**.

---

## 0. Qué NO es esta etapa (confirmado leyendo `App.tsx`/`navigation.tsx`, no supuesto)

- No es la serie 14G (Gestión horaria) — esa serie ya cerró (14G.1-14G.9) y **no se toca** ningún archivo de sus 10 zonas (Inicio, Asistencia, Alertas de turnos, Carga de horas, Cierres mensuales, Bandeja de revisión, Novedades, Notificaciones, Fichador, Exportación).
- No es Legajos (14D) ni Landing (14F) — ninguno de sus archivos se toca.
- **Exportación Finnegans** (`/configuracion/liquidacion`, `FinnegansExportPage.tsx`) es una tarjeta de la landing de Configuración, pero YA está cubierta en detalle por el journey de 14G.1 (zona "J. Exportación", 4 acciones: entrar, cambiar período, buscar, y el skip documentado de "Exportar Excel"). Se decidió explícitamente **no remedirla** en este journey para no duplicar esfuerzo entre dos journeys — queda como un `skip()` de referencia cruzada en la zona I de esta etapa.
- No incluye Fichador — no forma parte de Configuración/Puestos, categoría D de `docs/PERFORMANCE_STANDARDS.md` §10, no se toca sin etapa dedicada.
- No es una etapa de optimización — ningún hallazgo de este documento se corrige acá. Ver §8 para la recomendación de orden de 14H.2 en adelante.

---

## 1. Rutas reales y submódulos (relevado leyendo `App.tsx`, `navigation.tsx` y las 13 páginas involucradas — no supuesto)

Confirmado en `frontend/src/App.tsx` (rutas) y `frontend/src/app/navigation.tsx` (visibilidad por rol): **Nivel 1 (RRHH) es el único rol con acceso simultáneo a `/configuracion` y `/puestos`** — "Configuración" no aparece en absoluto para Nivel 2/3, y "Puestos" es visible para Nivel 1 y Nivel 2 pero no Nivel 3. El journey loguea como Nivel 1 por este motivo (mismo mecanismo que 14D.1/14F.1/14G.1).

| # | Tarjeta / pantalla | Ruta real | Página |
|---|---|---|---|
| — | Landing | `/configuracion` | `SettingsPage.tsx` |
| 1 | Turnos | `/configuracion/turnos` | `ShiftsPage.tsx` |
| 2 | Asignaciones de feriados | `/configuracion/turnos-asignaciones-feriados` | `HolidayWorkAssignmentsPage.tsx` |
| 3 | Horas especiales | `/configuracion/turnos-horas-especiales` | `WorkScheduleSettingsPage.tsx` |
| 4 | Regímenes laborales | `/configuracion/regimenes-laborales` | `WorkRegimesPage.tsx` |
| 5 | Empresas y estructura | `/configuracion/empresas-estructura` | `OrgStructurePage.tsx` |
| 6 | Tipos de novedades | `/configuracion/tipos-novedades` | `NoveltyTypesPage.tsx` |
| 7 | Conceptos horarios | `/configuracion/conceptos-horarios` | `HourConceptsPage.tsx` |
| 8 | Exportación Finnegans | `/configuracion/liquidacion` | `FinnegansExportPage.tsx` (ya cubierto por 14G.1, ver §0) |
| 9 | Categorías documentales | `/configuracion/categorias-documentales` | `DocumentCategoriesPage.tsx` |
| 10 | Parámetros de auditoría | `/configuracion/parametros-auditoria` | `AuditParametersPage.tsx` |
| — | Puestos (listado) | `/puestos` | `PuestosPage.tsx` |
| — | Puesto (detalle) | `/puestos/:id` | `PuestoDetailPage.tsx` |
| — | Puesto (creación) | `/puestos/nuevo` | `PuestoCreatePage.tsx` |

Las 10 tarjetas confirmadas en `SettingsPage.tsx` son todas `<Link>` reales sin `onClick` oculto (el fallback `<button>` del código nunca se renderiza, ya que las 10 tienen `path`) — no hay ningún hallazgo de seguridad tipo "click de navegación que también escribe" en la landing, a diferencia de lo encontrado en Notificaciones en 14G.1.

Ver Matriz 1 y Matriz 2 completas en `frontend/e2e/support/adminConfigurationJourney.ts` (`SUBMODULE_INVENTORY`, 14 filas; `COVERAGE_MATRIX`, 63 filas) — reproducidas también en las secciones 5 y 4 del reporte generado (`docs/performance/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md`).

---

## 2. Relevamiento previo a escribir el journey

Antes de escribir una sola línea de `.spec.ts`, se hizo un relevamiento página por página (agente de exploración dedicado, resultado verificado contra `App.tsx`/`navigation.tsx`/`cachePolicy.ts` antes de usarse) cubriendo, por cada una de las 13 páginas: endpoints reales en el montaje, si están cacheados (frontend `cachePolicy.ts` y backend `*.cache.ts`), selectores de búsqueda/filtros/tabs exactos, y — crítico para esta etapa de sólo lectura — **qué botón hace qué**, distinguiendo siempre navegación pura de una acción que dispara una escritura real. Se leyeron además:

- `docs/PERFORMANCE_STANDARDS.md` completo (categorías A-E de datos, reglas de cache/paginación/dashboards — usado para clasificar cada tarjeta en la Matriz 1).
- `docs/decisions/WORK_REGIME_ASSIGNMENT_CONSISTENCY_13J.md` (13J) — confirma el flujo real del modal "Empleados asociados" de Regímenes laborales (filtro de vigencia, "Agregar empleados", "Finalizar asignación") que el journey ejercita de forma segura.
- `docs/decisions/POSITIONS_PERFORMANCE_FOR_EMPLOYEES_14D4.md` (14D.4) — confirma que `GET /positions/options` es un endpoint separado consumido por Legajos, no por Puestos (Puestos sigue usando `GET /positions`/`GET /positions/:id` completos, que es lo que este journey mide).
- `frontend/e2e/support/workforceManagementJourney.ts` + `.spec.ts` (14G.1) completos — plantilla estructural replicada para `adminConfigurationJourney.ts`/`.spec.ts` (mismo patrón `measure()`/`skip()`/`measureModalOpenAndCancel()`, mismos 16 encabezados de reporte, misma sanitización vía `sanitizeRequestPath`).

**Hallazgo de relevamiento clave**: sólo **Turnos** y **Horas especiales** no tienen ningún cache frontend en sus endpoints principales (`shiftTemplates()`, `doubleHourRules()`, `doubleHourRulesCalendar()`, `assignments/summary` — todos con `apiCache:false` directo, sin `cachedData`/`cachePolicies`). Las 7 tarjetas restantes (Regímenes laborales, Empresas y estructura, Tipos de novedades, Conceptos horarios, Categorías documentales, Parámetros de auditoría, y el catálogo `getAll()` de Puestos) sí cachean su catálogo principal 5-10min vía una familia dedicada en `cachePolicy.ts`. Backend: sólo el módulo `workforce-management` (que sirve Turnos y Horas especiales) tiene un `*.cache.ts` propio (`workforce.cache.ts`, 30s) entre los 9 módulos backend involucrados en esta etapa — `positions`, `work-regimes`, `org-structure`, `novelty-types`, `hour-concepts`, `document-categories` y `audit-parameters` no tienen ninguna cache backend.

---

## 3. Política de alcance para editores inline (decisión explícita, no un hallazgo técnico)

5 de las 10 tarjetas (Horas especiales, Empresas y estructura, Conceptos horarios, Categorías documentales, Parámetros de auditoría) exponen su formulario de alta/edición como un `<Section>` **inline siempre presente en la propia página**, no como el componente `Modal` compartido usado en el resto de la app. El relevamiento confirmó que algunos de esos editores SÍ tienen un botón de cancelar limpio sin request (Horas especiales, Categorías documentales, Parámetros de auditoría, Conceptos horarios) y uno no lo tiene en absoluto (Empresas y estructura — sólo se cierra cambiando de pestaña).

Para no tener una política distinta por página (fuente de errores en un journey de este tamaño), esta etapa decidió, deliberadamente: **abrir y cerrar sólo modales del componente `Modal` compartido** (único caso real en este alcance: Regímenes laborales — "Crear régimen" y "Empleados asociados", ambos con botón "Cerrar"/"Cancelar" que no dispara ningún request). Los 5 editores inline arriba mencionados **no se abren** esta etapa. Esto es una decisión de alcance para reducir superficie de riesgo con una regla única y fácil de auditar, no una limitación técnica — documentado explícitamente como candidato de cobertura para 14H.2 si aporta valor.

---

## 4. Archivos creados

| Archivo | Rol |
|---|---|
| `frontend/e2e/support/adminConfigurationJourney.ts` | Módulo puro (sin Playwright/fs): tipos, `rankDuration`/`findDuplicateRequests`/`aggregateEndpoints`/`buildSummary`/`buildSubmoduleRollup`/`buildJsonReport`/`buildMarkdownReport`, `SUBMODULE_INVENTORY` (14 filas), `COVERAGE_MATRIX` (63 filas) |
| `frontend/e2e/support/adminConfigurationJourney.test.ts` | 28 tests Vitest sobre el módulo puro de arriba (mismo patrón factory que `workforceManagementJourney.test.ts`) |
| `frontend/e2e/adminConfigurationPerformanceJourney.spec.ts` | El journey Playwright real — login, landing, 9 tarjetas medidas + 1 referenciada (Exportación Finnegans), Puestos en sus 3 rutas |
| `docs/performance/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md` / `.json` | Reportes generados automáticamente por el spec — no se editan a mano |
| `docs/decisions/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md` | Este documento |

**Archivo modificado**: `frontend/package.json` — una línea agregada (`"perf:journey:admin-config": "playwright test --config=playwright.config.ts adminConfigurationPerformanceJourney.spec.ts"`), mismo patrón exacto que los 3 scripts `perf:journey:*` ya existentes.

**Ningún archivo backend, ningún archivo de `frontend/src/`, ningún `schema.prisma`, ninguna migración.**

---

## 5. Resultado de la corrida real (staging vía Neon, `npm run perf:journey:admin-config`)

- **63 acciones totales**: 41 cubiertas, 22 salteadas (18 por ser de escritura o abrir un editor inline fuera de la política de §3, con motivo documentado cada una; 3 por no encontrar datos/elementos reales en el entorno — p. ej. "Paginar Puestos" no tenía segunda página; 1 por estar fuera del alcance de esta corrida, Exportación Finnegans).
- **0 respuestas HTTP >= 400.**
- **4 errores de consola** — ver Hallazgo §6, todos de la misma acción.
- **0 acciones de escritura ejecutadas** (assert automático en el propio spec).
- Ranking real detectado: 1 acción en rango Crítico (Login, 6563ms — mismo artefacto de cold-start de Neon post-login ya documentado en 14D.4/14G.1, no es un hallazgo nuevo de Configuración/Puestos) y 4 en rango Lento (2000-3000ms): "Filtrar vigencia de empleados asociados" (E. Regímenes laborales, 2878ms), "Entrar a Asignaciones de feriados" (2253ms), "Seleccionar fecha de feriado" (2248ms), "Entrar a Parámetros de auditoría" (2125ms).
- Reporte completo (16 secciones) en `docs/performance/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md`.

---

## 6. HALLAZGO — bug pre-existente, no introducido por esta etapa

Al filtrar "Vigencia" a **"Todos"** en el modal "Empleados asociados" de Regímenes laborales, React emite 4 warnings de consola (`console.error`, por lo que el assert `consoleErrors === 0` del journey falla — correctamente, es el diseño):

```
Warning: Encountered two children with the same key, `<employeeId>`. Keys should be unique...
```

**Causa raíz confirmada leyendo el código** (`frontend/src/components/shared/AssociatedEmployeesPanel.tsx:414,462`): las filas de la tabla/tarjetas usan `key={item.employeeId}` — correcto cuando el filtro es "Vigentes" (`status=current`, a lo sumo 1 fila vigente por empleado para ese régimen), pero **incorrecto cuando el filtro es "Todos"** (`status=all`): un mismo empleado puede tener más de una fila de `EmployeeWorkRegime` para el mismo régimen (una histórica + una vigente, o dos históricas), cada una con su propio `assignmentId` pero el mismo `employeeId` — exactamente el escenario de datos reales que `docs/decisions/WORK_REGIME_ASSIGNMENT_CONSISTENCY_13J.md` documentó (09/10 Granja con una asignación histórica a "01 - Agricultura").

- **No es una regresión de esta etapa**: `AssociatedEmployeesPanel.tsx` no fue tocado — el bug ya existía, esta etapa simplemente fue la primera en ejercitar automáticamente el filtro "Todos" contra datos reales con asignaciones históricas.
- **No se corrige acá** — corregirlo (cambiar la key a `item.assignmentId`) sería una modificación de `frontend/src/`, fuera del alcance explícito de esta etapa ("no modificar lógica de negocio/UI salvo estrictamente necesario para instrumentación read-only").
- **Impacto real**: bajo pero real — el propio warning de React advierte que puede causar duplicación/omisión visual de filas bajo ese filtro específico. No afecta el filtro por defecto ("Vigentes"), que es el más usado.
- **Recomendación**: candidato de arreglo de 1 línea (`key={item.assignmentId}` en vez de `key={item.employeeId}`) para una etapa futura (14H.2 o un fix puntual dedicado) — no requiere una etapa de performance completa.

Este es el único hallazgo de consola de toda la corrida — confirma que el resto del recorrido (37 de las 41 acciones cubiertas) no generó ningún error de React en ninguna otra pantalla.

---

## 7. Riesgos

- **Assert de consola rojo por el hallazgo de §6**: el propio journey queda en rojo (`npm run perf:journey:admin-config` falla) hasta que se corrija el bug de key duplicada o se decida explícitamente aceptar el warning — se mantiene el assert estricto (mismo criterio que 14D.1/14G.1: un journey que nunca falla ante un problema real no sirve como red de seguridad). Esto NO bloquea la validación estándar de esta etapa (`typecheck:e2e`/`test`/`build`, todas verdes — ver §9), que es lo que efectivamente gatea CI.
- **Búsquedas fetch-all vs server-side**: la mayoría de las tarjetas de Configuración filtran en memoria sobre un `fetch-all` ya cacheado (comportamiento correcto documentado en `PERFORMANCE_STANDARDS.md` §6 para catálogos chicos administrados a mano) — el journey mide el tiempo de UI de esas búsquedas, pero no representan carga real de red adicional. Puestos es la única excepción real (búsqueda server-side paginada).
- **Datos dependientes del entorno**: 3 acciones se saltearon por no encontrar datos reales (paginación de Puestos sin segunda página, entre otras) — esperado en un entorno de staging con un volumen de datos que puede variar entre corridas; no es un fallo del journey.
- **Editores inline no cubiertos (§3)**: es una decisión de alcance documentada, no una limitación — 5 submódulos quedan sin cobertura de su flujo de creación/edición hasta una etapa futura que decida ampliar la política.

---

## 8. Recomendación de orden para 14H.2+

Ordenado por evidencia de esta corrida (ver también §15 del reporte generado):

1. **Regímenes laborales** — el único hallazgo funcional real (key duplicada, §6) más el endpoint más lento del recorrido tras el login (2878ms, "Filtrar vigencia de empleados asociados").
2. **Asignaciones de feriados** — hasta 5 GETs encadenados al elegir una fecha (dates + org-structure + shift-templates + assignments + candidates), 2 acciones en rango Lento.
3. **Turnos y Horas especiales** — únicas 2 tarjetas sin ningún cache frontend; Horas especiales además con el mayor conteo de GETs en el montaje (4) de toda Configuración.
4. **Conceptos horarios** — no medido más allá del listado en esta etapa; el submódulo con mayor profundidad potencial (reglas + empleados asociados anidados al editar), candidato fuerte para una etapa de relevamiento propia antes de optimizar.
5. **Puesto (detalle)** — 2 GETs secuenciales no paralelos (`getById` → `getAssignedEmployees`), mismo patrón ya optimizado para Legajos en 14D — evaluar si el volumen de asignaciones por puesto lo justifica.

Exportación Finnegans queda fuera de este orden — ya tiene su propio hallazgo documentado en 14G.1 (`take:10000` sin paginación en `finnegansExport.repository.ts`).

---

## 9. Validaciones ejecutadas

- `npx tsc -p tsconfig.e2e.json --noEmit` (vía `npm run typecheck:e2e`) ✅ sin errores.
- `npm test` (vitest) ✅ **736/736** (77 archivos) — incluye los 28 tests nuevos de `adminConfigurationJourney.test.ts`.
- `npm run build` (vite build) ✅ sin errores ni warnings nuevos.
- `npm run perf:journey:admin-config` ⚠️ corre completo (41/63 acciones cubiertas, 0 HTTP errors, 0 escrituras) pero el assert de consola falla por el hallazgo real de §6 — comportamiento esperado y documentado, no un bug del journey.
- `npm run perf:journey:workforce` (14G.1, regresión) ✅ passed, 1.1min.
- `npm run perf:journey:employees` (14D.1, regresión) ✅ passed, 39.2s.
- Backend: **sin validaciones** — cero archivos backend tocados en esta etapa (`prisma validate`/`typecheck`/`test`/`build` del backend no aplican).
- `git diff --check` ✅ sin errores de espacios en blanco.
- `git status --short` tras las 3 corridas de journeys: además de los 5 archivos nuevos de esta etapa y `frontend/package.json` modificado, `docs/performance/EMPLOYEES_PERFORMANCE_JOURNEY_14D1.{md,json}` y `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.{md,json}` quedaron modificados como efecto colateral inevitable de correr esos 2 journeys para el control de regresión — se restauran (`git restore`) como parte del protocolo de cierre de etapa, nunca se commitean.

---

## 10. Qué NO se tocó

- Ningún archivo backend (`backend/src/**`), ningún `schema.prisma`, ninguna migración.
- Ningún archivo de `frontend/src/**` — ni páginas, ni servicios, ni cache, ni componentes compartidos (incluido `AssociatedEmployeesPanel.tsx`, pese al hallazgo de §6).
- Ningún archivo de la serie 14G (Gestión horaria) más allá de re-ejecutar su journey para el control de regresión (§9) — su código fuente no se tocó.
- Ningún dato real — cero escrituras ejecutadas (confirmado por assert automático del propio journey).
- RBAC/scope/contratos de API — sin cambios, esta etapa no toca backend.

---

No se optimizó nada. No se tocó backend ni `frontend/src/`. No se ejecutó ninguna escritura real. No commitear sin aprobación explícita del usuario. No hacer push.
