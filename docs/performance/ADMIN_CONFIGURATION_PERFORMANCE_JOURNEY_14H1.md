# Performance Journey — Configuración + Puestos (Etapa 14H.1)

Reporte generado automáticamente por `npm run perf:journey:admin-config`. No editar a mano — se sobreescribe en cada corrida.

**Etapa de diagnóstico macro — no de optimización.** Ningún hallazgo de este reporte se corrigió en esta etapa; ver §15 para el orden recomendado de 14H.2 en adelante.

## 1. Resumen ejecutivo

Recorrido macro de la landing de Configuración, sus 10 tarjetas de submódulo (Exportación Finnegans excluida por estar ya cubierta por 14G.1) y Puestos en sus 3 rutas (listado, detalle, creación): 47/74 acciones cubiertas, 27 salteadas (21 de ellas por ser de escritura, con motivo documentado cada una), 0 respuestas HTTP >= 400, 0 errores de consola. 1 acción(es) en rango Crítico (> 3000ms) y 2 en rango Lento (2000-3000ms). Cero escrituras ejecutadas — modo `read-only` en todo el recorrido.

## 2. Ambiente

- Generado: 2026-09-08T17:47:26.318Z
- Frontend: http://localhost:5174
- Backend: http://localhost:4002/api
- Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.
- Usuario: Nivel 1 - RRHH (acceso rápido demo — credenciales en docs/LOCAL_DEVELOPMENT.md, no se repiten en este reporte)
- Comando: `npm run perf:journey:admin-config (desde frontend/)`

## 3. Cobertura general

| Submódulo | Acciones cubiertas | Acciones salteadas | Requests capturadas | Peor duración | Rango |
|---|---|---|---|---|---|
| Login | 1 | 0 | 4 | 4155ms | Crítico |
| A. Configuración (landing) | 2 | 0 | 1 | 909ms | OK |
| B. Turnos | 4 | 2 | 5 | 2275ms | Lento |
| C. Asignaciones de feriados | 2 | 1 | 6 | 2093ms | Lento |
| D. Horas especiales | 2 | 2 | 4 | 1797ms | Medio |
| E. Regímenes laborales | 8 | 2 | 4 | 1368ms | Medio |
| F. Empresas y estructura | 2 | 1 | 1 | 980ms | OK |
| G. Tipos de novedades | 3 | 3 | 2 | 972ms | OK |
| H. Conceptos horarios | 5 | 7 | 3 | 884ms | OK |
| I. Exportación Finnegans | 0 | 1 | 0 | — | — |
| J. Categorías documentales | 5 | 1 | 2 | 891ms | OK |
| K. Parámetros de auditoría | 5 | 1 | 2 | 900ms | OK |
| L. Puestos (listado) | 4 | 3 | 4 | 1216ms | Medio |
| M. Puesto (detalle) | 2 | 2 | 3 | 1513ms | Medio |
| N. Puesto (creación, sólo navegación) | 2 | 1 | 4 | 1246ms | Medio |

## 4. Tabla de acciones

| Acción | Submódulo | Ruta | Visible | Network idle | Requests | Errores consola | Escritura |
|---|---|---|---|---|---|---|---|
| Login (acceso rápido RRHH) | Login | `/` | 508ms | 4155ms | 4 | 0 | No |
| Entrar a Configuración | A. Configuración (landing) | `/configuracion` | 67ms | 909ms | 1 | 0 | No |
| Ver tarjetas de submódulos | A. Configuración (landing) | `/configuracion` | 9ms | 94ms | 0 | 0 | No |
| Entrar a Turnos | B. Turnos | `/configuracion/turnos` | 79ms | 2275ms | 3 | 0 | No |
| Buscar en Turnos | B. Turnos | `/configuracion/turnos` | 15ms | 417ms | 0 | 0 | No |
| Filtrar Turnos por Estado | B. Turnos | `/configuracion/turnos` | 11ms | 93ms | 0 | 0 | No |
| Ver detalle de turno | B. Turnos | `/configuracion/turnos/:id` | 307ms | 1237ms | 2 | 0 | No |
| Entrar a Asignaciones de feriados | C. Asignaciones de feriados | `/configuracion/turnos-asignaciones-feriados` | 56ms | 2093ms | 4 | 0 | No |
| Seleccionar fecha de feriado | C. Asignaciones de feriados | `/configuracion/turnos-asignaciones-feriados` | 805ms | 1208ms | 2 | 0 | No |
| Entrar a Horas especiales | D. Horas especiales | `/configuracion/turnos-horas-especiales` | 80ms | 1797ms | 4 | 0 | No |
| Filtrar Horas especiales por clasificación | D. Horas especiales | `/configuracion/turnos-horas-especiales` | 13ms | 96ms | 0 | 0 | No |
| Entrar a Regímenes laborales | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 72ms | 1095ms | 2 | 0 | No |
| Buscar en Regímenes laborales | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 5ms | 406ms | 0 | 0 | No |
| Filtrar Regímenes laborales por Estado | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 4ms | 86ms | 0 | 0 | No |
| Abrir modal Crear régimen | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 15ms | 97ms | 0 | 0 | No |
| Cerrar modal Crear régimen | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 18ms | 100ms | 0 | 0 | No |
| Ver empleados asociados a un régimen | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 17ms | 99ms | 0 | 0 | No |
| Filtrar vigencia de empleados asociados | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 1286ms | 1368ms | 2 | 0 | No |
| Cerrar modal Empleados asociados | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 22ms | 104ms | 0 | 0 | No |
| Entrar a Empresas y estructura | F. Empresas y estructura | `/configuracion/empresas-estructura` | 48ms | 980ms | 1 | 0 | No |
| Cambiar de pestaña en Empresas y estructura | F. Empresas y estructura | `/configuracion/empresas-estructura` | 32ms | 234ms | 0 | 0 | No |
| Entrar a Tipos de novedades | G. Tipos de novedades | `/configuracion/tipos-novedades` | 52ms | 972ms | 2 | 0 | No |
| Buscar en Tipos de novedades | G. Tipos de novedades | `/configuracion/tipos-novedades` | 6ms | 408ms | 0 | 0 | No |
| Filtrar Tipos de novedades por Finnegans | G. Tipos de novedades | `/configuracion/tipos-novedades` | 5ms | 87ms | 0 | 0 | No |
| Entrar a Conceptos horarios | H. Conceptos horarios | `/configuracion/conceptos-horarios` | 52ms | 884ms | 2 | 0 | No |
| Buscar en Conceptos horarios | H. Conceptos horarios | `/configuracion/conceptos-horarios` | 5ms | 408ms | 0 | 0 | No |
| Filtrar Conceptos horarios por Tipo | H. Conceptos horarios | `/configuracion/conceptos-horarios` | 6ms | 86ms | 0 | 0 | No |
| Abrir detalle de concepto horario (Editar) | H. Conceptos horarios | `/configuracion/conceptos-horarios` | — | 435ms | 0 | 0 | No |
| Cerrar detalle de concepto horario sin guardar | H. Conceptos horarios | `/configuracion/conceptos-horarios` | 46ms | 131ms | 1 | 0 | No |
| Entrar a Categorías documentales | J. Categorías documentales | `/configuracion/categorias-documentales` | 69ms | 891ms | 2 | 0 | No |
| Buscar en Categorías documentales | J. Categorías documentales | `/configuracion/categorias-documentales` | 10ms | 413ms | 0 | 0 | No |
| Filtrar Categorías documentales por Tipo | J. Categorías documentales | `/configuracion/categorias-documentales` | 10ms | 94ms | 0 | 0 | No |
| Abrir detalle de categoría documental (Editar) | J. Categorías documentales | `/configuracion/categorias-documentales` | 43ms | 126ms | 0 | 0 | No |
| Cerrar detalle de categoría documental sin guardar | J. Categorías documentales | `/configuracion/categorias-documentales` | 33ms | 116ms | 0 | 0 | No |
| Entrar a Parámetros de auditoría | K. Parámetros de auditoría | `/configuracion/parametros-auditoria` | 66ms | 900ms | 2 | 0 | No |
| Buscar en Parámetros de auditoría | K. Parámetros de auditoría | `/configuracion/parametros-auditoria` | 7ms | 411ms | 0 | 0 | No |
| Filtrar Parámetros de auditoría por Módulo | K. Parámetros de auditoría | `/configuracion/parametros-auditoria` | 11ms | 95ms | 0 | 0 | No |
| Abrir detalle de parámetro de auditoría (Editar) | K. Parámetros de auditoría | `/configuracion/parametros-auditoria` | 54ms | 136ms | 0 | 0 | No |
| Cerrar detalle de parámetro de auditoría sin guardar | K. Parámetros de auditoría | `/configuracion/parametros-auditoria` | 22ms | 107ms | 0 | 0 | No |
| Entrar a Puestos | L. Puestos (listado) | `/puestos` | 55ms | 1216ms | 3 | 0 | No |
| Buscar en Puestos | L. Puestos (listado) | `/puestos` | 16ms | 419ms | 0 | 0 | No |
| Filtrar Puestos por Sector | L. Puestos (listado) | `/puestos` | 14ms | 97ms | 0 | 0 | No |
| Limpiar filtros en Puestos | L. Puestos (listado) | `/puestos` | 47ms | 133ms | 1 | 0 | No |
| Ver detalle de puesto | M. Puesto (detalle) | `/puestos/:id` | 820ms | 1513ms | 3 | 0 | No |
| Cambiar de pestaña en detalle de Puesto | M. Puesto (detalle) | `/puestos/:id` | 41ms | 245ms | 0 | 0 | No |
| Entrar a Crear puesto (sólo navegación, sin guardar) | N. Puesto (creación, sólo navegación) | `/puestos/nuevo` | 70ms | 1246ms | 3 | 0 | No |
| Salir de Crear puesto sin guardar | N. Puesto (creación, sólo navegación) | `/puestos` | 63ms | 145ms | 1 | 0 | No |

## 5. Tabla por submódulo

Relevada leyendo el código real (App.tsx, navigation.tsx, cada página y sus servicios API) antes de escribir el journey — ver Matriz 1 (Inventario de submódulos) en `docs/decisions/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md`.

| Submódulo | Ruta real | Página | Cache frontend | Cache backend | Escribe datos | Medible seguro |
|---|---|---|---|---|---|---|
| A. Configuración (landing) | /configuracion | SettingsPage.tsx | N/A | N/A | No | Sí |
| B. Turnos | /configuracion/turnos | ShiftsPage.tsx | No — ambos con apiCache:false, sin wrapper cachedData/cachePolicies (único gap real de cache cliente detectado en esta etapa) | Sí — workforce.cache.ts (shiftTemplatesCache, 30s) para shift-templates; assignments/summary sin cache backend dedicado | Sí (crear turno, activar/inactivar) — no ejecutado esta etapa | Sí |
| C. Asignaciones de feriados | /configuracion/turnos-asignaciones-feriados | HolidayWorkAssignmentsPage.tsx | Sólo /org-structure (familia org-structure); dates/assignments/candidates/shift-templates sin cache | No (módulo shifts no tiene cache dedicado para holiday-work) | Sí (Guardar cambios de convocatoria) — no ejecutado esta etapa | Sí |
| D. Horas especiales | /configuracion/turnos-horas-especiales | WorkScheduleSettingsPage.tsx | org-structure y positions cacheados; double-hour-rules y su calendario NO (mismo gap que Turnos) | Sí — workforce.cache.ts (doubleRulesCache, 30s) | Sí (crear/editar regla vía formulario inline, activar/inactivar, eliminar) — no ejecutado esta etapa | Sí |
| E. Regímenes laborales | /configuracion/regimenes-laborales | WorkRegimesPage.tsx | Sí — familia work-regimes (workRegimesCatalog, 10min); empleados asociados por régimen sin cache | No | Sí (crear/editar régimen, activar/inactivar, agregar empleado, finalizar asignación) — no ejecutado esta etapa | Sí |
| F. Empresas y estructura | /configuracion/empresas-estructura | OrgStructurePage.tsx | Sí — familia org-structure (orgStructureCatalog, 10min, persistido) | Sí — orgStructure.repository.ts (overviewCache, 60s, in-memory) — corrige el hallazgo original de 14H.1 (decía 'No'; relectura completa en 14H.6 confirmó que ya existía). fetchOverview() ya usa Promise.all(...) para sus 6 lecturas independientes, nunca tuvo el antipatrón $transaction — sin cambios de código esta etapa. | Sí (crear/editar Empresa/UN/Establecimiento/Área/Sector/Centro de costo vía editor inline 'Guardar estructura') — no ejecutado esta etapa | Sí |
| G. Tipos de novedades | /configuracion/tipos-novedades | NoveltyTypesPage.tsx | Sí — familia novelty-types (noveltyTypesCatalog, 10min, persistido) | No | Sí (crear, activar/inactivar) — no ejecutado esta etapa | Sí |
| H. Conceptos horarios | /configuracion/conceptos-horarios | HourConceptsPage.tsx | Sí — familia hour-concepts: hourConceptsCatalog (10min, persistido), + hourConceptEmployeesList (15s) y hourConceptRulesByConceptId (30s) desde 14H.5 | Sólo el listado (hourConceptsReadCache, 60s, controller-level) — sin cache backend en rules/employees | Sí (crear/editar concepto, reglas asociadas, empleados asociados, deshabilitar/eliminar) — no ejecutado esta etapa | Sí |
| I. Exportación Finnegans | /configuracion/liquidacion | FinnegansExportPage.tsx | No | No | No (endpoint de sólo lectura, el .xlsx se arma 100% client-side) | Sí, pero fuera del alcance de esta corrida |
| J. Categorías documentales | /configuracion/categorias-documentales | DocumentCategoriesPage.tsx | Sí — familia document-categories (documentCategoriesCatalog, 10min, persistido) | Sí — documentCategoriesReadCache (60s, controller-level, keyed por req.originalUrl) — corrige el hallazgo original de 14H.1 (decía 'No'; relectura completa en 14H.6 confirmó que ya existía). Además, repository-level: findMany() en su rama filtrada usaba $transaction([findMany,count]) — corregido a Promise.all(...) en 14H.6 (rama alcanzable vía documentCategoryApiService.getAll({status,scope}) desde EmployeeHoursPage.tsx en Gestión Horaria, sin tocar ese caller). La rama sin filtros usa un listCache propio (2min) — sin cambios. | Sí (crear/editar categoría vía editor inline 'Guardar categoria') — no ejecutado esta etapa | Sí |
| K. Parámetros de auditoría | /configuracion/parametros-auditoria | AuditParametersPage.tsx | Sí — familia audit-parameters (auditParametersCatalog, 10min, persistido) | Sí desde 14H.6 — auditParametersReadCache (60s, controller-level, keyed por req.originalUrl), agregado esta etapa (único de los 3 submódulos que genuinamente no tenía ninguna cache backend). Además, findMany() usaba $transaction([findMany,count]) SIEMPRE (sin rama alternativa sin filtros, a diferencia de hourConcepts/documentCategories) — corregido a Promise.all(...) en 14H.6, el fix más ampliamente alcanzable de los 3 submódulos porque se ejercita en cada carga de la pantalla. | Sí (crear/editar parámetro vía editor inline 'Guardar parametro') — no ejecutado esta etapa | Sí |
| L. Puestos (listado) | /puestos | PuestosPage.tsx | org-structure y positions (getAll) cacheados 5-10min; el listado paginado usa una policy separada (positionsList, 30s, no persistida) | No | Sí (crear puesto, activar/inactivar, eliminar/ocultar) — no ejecutado esta etapa | Sí |
| M. Puesto (detalle) | /puestos/:id | PuestoDetailPage.tsx | getById cacheado (familia positions); empleados asignados sin cache — siempre fresco | No | Sí (Guardar cambios en tabs 1-9, activar/inactivar, eliminar) — no ejecutado esta etapa | Sí |
| N. Puesto (creación, sólo navegación) | /puestos/nuevo | PuestoCreatePage.tsx | Sí — misma familia/policy positionsCatalog que Puestos (listado); probable cache hit si se visitó antes en el mismo recorrido | No | No con sólo navegar — el único write es el submit 'Guardar puesto' (POST /positions), no ejecutado esta etapa | Sí |

## 6. Acciones no cubiertas y motivo

- **Crear turno** (B. Turnos, escritura): Prohibido por defecto — es la puerta de entrada a un alta real (POST /workforce/shift-templates), no se hace click..
- **Inactivar/Activar turno** (B. Turnos, escritura): Prohibido por defecto — acción de escritura (PATCH /workforce/shift-templates/:id)..
- **Guardar cambios (convocatoria de feriado)** (C. Asignaciones de feriados, escritura): Prohibido por defecto — asignaría feriados reales a empleados reales (PUT /shifts/holiday-work/assignments)..
- **Abrir edición de regla / Crear regla** (D. Horas especiales, lectura): El formulario 'Nueva regla'/'Editar' es un editor inline siempre presente en la página (no el componente Modal compartido) — esta etapa sólo abre y cierra modales del componente Modal compartido (Regímenes laborales) para mantener una única política simple de riesgo en todo el journey..
- **Activar/Inactivar/Eliminar regla** (D. Horas especiales, escritura): Prohibido por defecto — acciones de escritura (PATCH/DELETE /workforce/double-hour-rules/:id)..
- **Agregar empleados / Finalizar asignación** (E. Regímenes laborales, escritura): Prohibido por defecto — acciones de escritura (POST /employees/:employeeId/work-regimes, PATCH .../:assignmentId/close)..
- **Editar régimen / Activar-Inactivar régimen** (E. Regímenes laborales, escritura): Prohibido por defecto — acciones de escritura (POST/PATCH /work-regimes[/:id][/status])..
- **Nuevo registro / Editar / Guardar estructura** (F. Empresas y estructura, escritura): Etapa 14H.6: evaluado y descartado ampliar el alcance acá (a diferencia de Categorías documentales/Parámetros de auditoría, arriba/abajo) — el editor inline no tiene botón de cancelar limpio (sólo se cierra cambiando de pestaña, un efecto colateral del onChange de las Tabs, no un control pensado para esto), y a diferencia de Conceptos horarios (14H.5) abrirlo no revelaría ningún request nuevo (el catálogo completo ya se cargó una sola vez vía getCatalog(), editar es 100% local) — sin valor diagnóstico que justifique salirse de la política de sólo abrir editores con un cierre limpio. No se abre esta etapa, ni se llega al submit real (POST/PATCH /org-structure/...)..
- **Crear tipo de novedad** (G. Tipos de novedades, escritura): Prohibido por defecto — navegación a un formulario de alta (POST /novelty-types), no se hace click..
- **Ver detalle de tipo de novedad** (G. Tipos de novedades, lectura): Navegación de detalle fuera del alcance macro de esta etapa (no es escritura) — candidato de profundización en una etapa futura si el volumen lo justifica..
- **Activar/Inactivar tipo de novedad** (G. Tipos de novedades, escritura): Prohibido por defecto — acción de escritura (PATCH /novelty-types/:id)..
- **Abrir modal Nueva regla horaria** (H. Conceptos horarios, lectura): no se encontró el disparador de este modal en el estado actual del entorno.
- **Cerrar modal Nueva regla horaria** (H. Conceptos horarios, lectura): depende de la acción anterior, salteada.
- **Crear concepto horario / Guardar cambios del concepto** (H. Conceptos horarios, escritura): Prohibido por defecto — acción de escritura (POST/PATCH /hour-concepts[/:id])..
- **Crear/Editar regla horaria (Guardar)** (H. Conceptos horarios, escritura): Prohibido por defecto — el modal se abre y se cierra sin tocar este botón (POST/PATCH /hour-concept-rules[/:id])..
- **Activar/Inactivar regla horaria** (H. Conceptos horarios, escritura): Prohibido por defecto — acción de escritura (PATCH /hour-concept-rules/:id/status)..
- **Agregar/Quitar empleados habilitados** (H. Conceptos horarios, escritura): Prohibido por defecto — acciones de escritura (POST /hour-concepts/:id/employees, DELETE /hour-concepts/:id/employees/:employeeId)..
- **Deshabilitar/Eliminar concepto horario** (H. Conceptos horarios, escritura): Prohibido por defecto — acciones de escritura (PATCH /hour-concepts/:id/status, DELETE /hour-concepts/:id)..
- **Entrar a Exportación Finnegans** (I. Exportación Finnegans, lectura): Ya cubierto en detalle por el journey de Gestión Horaria (Etapa 14G.1, zona 'J. Exportación', 4 acciones incl. cambio de período y búsqueda) — no se remide para no duplicar esfuerzo. Ver docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md. Ruta real confirmada: /configuracion/liquidacion → FinnegansExportPage.tsx..
- **Crear categoría documental / Guardar cambios de categoría** (J. Categorías documentales, escritura): Prohibido por defecto — el editor se abre y se cierra sin tocar 'Guardar categoria' (POST/PATCH /document-categories[/:id])..
- **Crear parámetro de auditoría / Guardar cambios de parámetro** (K. Parámetros de auditoría, escritura): Prohibido por defecto — el editor se abre y se cierra sin tocar 'Guardar parametro' (POST/PATCH /audit-parameters[/:id])..
- **Paginar Puestos** (L. Puestos (listado), lectura): no hay una segunda página de puestos en el entorno actual (botón 'Siguiente' ausente o deshabilitado).
- **Crear puesto** (L. Puestos (listado), escritura): Prohibido por defecto — es la puerta de entrada a un alta real (POST /positions), no se hace click..
- **Inactivar/Activar/Eliminar puesto** (L. Puestos (listado), escritura): Prohibido por defecto — acciones de escritura (PATCH /positions/:id, DELETE /positions/:id)..
- **Guardar cambios en Puesto** (M. Puesto (detalle), escritura): Prohibido por defecto — acción de escritura (PATCH /positions/:id)..
- **Inactivar/Eliminar puesto (detalle)** (M. Puesto (detalle), escritura): Prohibido por defecto — acciones de escritura (PATCH /positions/:id, DELETE /positions/:id)..
- **Guardar puesto** (N. Puesto (creación, sólo navegación), escritura): Prohibido por defecto — crearía un puesto real (POST /positions). Nunca se usa .fill() en ningún campo del formulario, ni siquiera momentáneamente..

## 7. Top acciones lentas

| Acción | Submódulo | Visible | Network idle | Rango |
|---|---|---|---|---|
| Login (acceso rápido RRHH) | Login | 508ms | 4155ms | Crítico |
| Entrar a Turnos | B. Turnos | 79ms | 2275ms | Lento |
| Entrar a Asignaciones de feriados | C. Asignaciones de feriados | 56ms | 2093ms | Lento |
| Entrar a Horas especiales | D. Horas especiales | 80ms | 1797ms | Medio |
| Ver detalle de puesto | M. Puesto (detalle) | 820ms | 1513ms | Medio |
| Filtrar vigencia de empleados asociados | E. Regímenes laborales | 1286ms | 1368ms | Medio |
| Entrar a Crear puesto (sólo navegación, sin guardar) | N. Puesto (creación, sólo navegación) | 70ms | 1246ms | Medio |
| Ver detalle de turno | B. Turnos | 307ms | 1237ms | Medio |
| Entrar a Puestos | L. Puestos (listado) | 55ms | 1216ms | Medio |
| Seleccionar fecha de feriado | C. Asignaciones de feriados | 805ms | 1208ms | Medio |

## 8. Top requests lentas

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/audit` | 200 | 2005ms |
| GET | `/api/workforce/shift-templates` | 200 | 1716ms |
| GET | `/api/dashboard/metrics` | 200 | 1661ms |
| GET | `/api/org-structure` | 200 | 1540ms |
| GET | `/api/positions` | 200 | 1229ms |
| POST | `/api/auth/login` | 200 | 1127ms |
| GET | `/api/positions` | 200 | 1031ms |
| GET | `/api/hour-concepts/:id/rules` | 200 | 882ms |
| GET | `/api/work-regimes/:id/employees` | 200 | 823ms |
| GET | `/api/work-regimes/:id/employees` | 200 | 736ms |

## 9. Endpoints repetidos

Mismo endpoint (método+path) pedido más de una vez a lo largo de TODO el recorrido, sin importar desde qué submódulo — detecta catálogos/endpoints compartidos entre submódulos (org-structure, positions, etc.).

| Endpoint | Llamadas totales |
|---|---|
| `GET /api/workforce/notifications-unread-count` | 15 |
| `GET /api/positions` | 6 |
| `GET /api/workforce/shift-templates` | 3 |
| `GET /api/work-regimes/:id/employees` | 2 |

## 10. Duplicados por acción

Mismo endpoint pedido más de una vez DENTRO de la ventana de una sola acción — señal de StrictMode (double-invoke en dev), remount de AppShell entre navegaciones completas, o un refetch inesperado.

- **Filtrar vigencia de empleados asociados** (E. Regímenes laborales): `GET /api/work-regimes/:id/employees` x2
- **Entrar a Puestos** (L. Puestos (listado)): `GET /api/positions` x2

## 11. HTTP errors

Ninguna respuesta >= 400 en todo el recorrido.

## 12. Console errors

Ninguna acción cubierta generó errores de consola.

## 13. Loading/error/empty states

- Pantallas vacías detectadas: ninguna.
- Loading global detectado: ninguno — cada submódulo usa su propio LoadingState/skeleton local, sin bloquear el resto de la app.
- Loading localizado detectado: sin datos suficientes en esta corrida.

## 14. Seguridad/no escrituras

Cero acciones de escritura ejecutadas en todo el recorrido (modo `read-only`). 21 acción(es) de escritura identificadas y explícitamente NO ejecutadas:

- **Crear turno** (B. Turnos): Prohibido por defecto — es la puerta de entrada a un alta real (POST /workforce/shift-templates), no se hace click.
- **Inactivar/Activar turno** (B. Turnos): Prohibido por defecto — acción de escritura (PATCH /workforce/shift-templates/:id).
- **Guardar cambios (convocatoria de feriado)** (C. Asignaciones de feriados): Prohibido por defecto — asignaría feriados reales a empleados reales (PUT /shifts/holiday-work/assignments).
- **Activar/Inactivar/Eliminar regla** (D. Horas especiales): Prohibido por defecto — acciones de escritura (PATCH/DELETE /workforce/double-hour-rules/:id).
- **Agregar empleados / Finalizar asignación** (E. Regímenes laborales): Prohibido por defecto — acciones de escritura (POST /employees/:employeeId/work-regimes, PATCH .../:assignmentId/close).
- **Editar régimen / Activar-Inactivar régimen** (E. Regímenes laborales): Prohibido por defecto — acciones de escritura (POST/PATCH /work-regimes[/:id][/status]).
- **Nuevo registro / Editar / Guardar estructura** (F. Empresas y estructura): Etapa 14H.6: evaluado y descartado ampliar el alcance acá (a diferencia de Categorías documentales/Parámetros de auditoría, arriba/abajo) — el editor inline no tiene botón de cancelar limpio (sólo se cierra cambiando de pestaña, un efecto colateral del onChange de las Tabs, no un control pensado para esto), y a diferencia de Conceptos horarios (14H.5) abrirlo no revelaría ningún request nuevo (el catálogo completo ya se cargó una sola vez vía getCatalog(), editar es 100% local) — sin valor diagnóstico que justifique salirse de la política de sólo abrir editores con un cierre limpio. No se abre esta etapa, ni se llega al submit real (POST/PATCH /org-structure/...).
- **Crear tipo de novedad** (G. Tipos de novedades): Prohibido por defecto — navegación a un formulario de alta (POST /novelty-types), no se hace click.
- **Activar/Inactivar tipo de novedad** (G. Tipos de novedades): Prohibido por defecto — acción de escritura (PATCH /novelty-types/:id).
- **Crear concepto horario / Guardar cambios del concepto** (H. Conceptos horarios): Prohibido por defecto — acción de escritura (POST/PATCH /hour-concepts[/:id]).
- **Crear/Editar regla horaria (Guardar)** (H. Conceptos horarios): Prohibido por defecto — el modal se abre y se cierra sin tocar este botón (POST/PATCH /hour-concept-rules[/:id]).
- **Activar/Inactivar regla horaria** (H. Conceptos horarios): Prohibido por defecto — acción de escritura (PATCH /hour-concept-rules/:id/status).
- **Agregar/Quitar empleados habilitados** (H. Conceptos horarios): Prohibido por defecto — acciones de escritura (POST /hour-concepts/:id/employees, DELETE /hour-concepts/:id/employees/:employeeId).
- **Deshabilitar/Eliminar concepto horario** (H. Conceptos horarios): Prohibido por defecto — acciones de escritura (PATCH /hour-concepts/:id/status, DELETE /hour-concepts/:id).
- **Crear categoría documental / Guardar cambios de categoría** (J. Categorías documentales): Prohibido por defecto — el editor se abre y se cierra sin tocar 'Guardar categoria' (POST/PATCH /document-categories[/:id]).
- **Crear parámetro de auditoría / Guardar cambios de parámetro** (K. Parámetros de auditoría): Prohibido por defecto — el editor se abre y se cierra sin tocar 'Guardar parametro' (POST/PATCH /audit-parameters[/:id]).
- **Crear puesto** (L. Puestos (listado)): Prohibido por defecto — es la puerta de entrada a un alta real (POST /positions), no se hace click.
- **Inactivar/Activar/Eliminar puesto** (L. Puestos (listado)): Prohibido por defecto — acciones de escritura (PATCH /positions/:id, DELETE /positions/:id).
- **Guardar cambios en Puesto** (M. Puesto (detalle)): Prohibido por defecto — acción de escritura (PATCH /positions/:id).
- **Inactivar/Eliminar puesto (detalle)** (M. Puesto (detalle)): Prohibido por defecto — acciones de escritura (PATCH /positions/:id, DELETE /positions/:id).
- **Guardar puesto** (N. Puesto (creación, sólo navegación)): Prohibido por defecto — crearía un puesto real (POST /positions). Nunca se usa .fill() en ningún campo del formulario, ni siquiera momentáneamente.

Política base sobre editores inline: los submódulos con formulario de alta/edición como un `<Section>` inline en la propia página (no el componente `Modal` compartido) sólo se abren si tienen un botón de cierre limpio Y aportan valor diagnóstico real — el journey base sólo abre y cierra modales del componente `Modal` compartido (Regímenes laborales) para mantener una única política simple de riesgo, documentado como decisión de alcance, no como limitación técnica. **Excepciones acumuladas**: desde la Etapa 14H.5, Conceptos horarios abre su editor inline en modo lectura (botón 'Editar', 100% local, sin request propio) porque anida paneles hijos con fetch propio (reglas horarias + empleados habilitados) que sólo se ven al abrirlo. Desde la Etapa 14H.6, Categorías documentales y Parámetros de auditoría también abren su editor inline en modo lectura (mismo botón 'Editar' 100% local, botón 'Cerrar' explícito confirmado en ambos) — a diferencia de Conceptos horarios, ninguno de estos 2 anida paneles con fetch propio, así que abrir/cerrar no revela ningún request nuevo; se abren igual porque el pedido de esa etapa era explícitamente ampliar la cobertura de detalle de estos submódulos. Horas especiales y Empresas y estructura siguen SIN abrirse: ninguno de los dos tiene un botón de cierre limpio (sólo un editor siempre visible o un cierre-por-efecto-colateral vía cambio de pestaña), y Empresas y estructura además no tendría ningún request nuevo que revelar (evaluado y descartado explícitamente en 14H.6). En ningún caso de los 3 editores que sí se abren se toca 'Guardar'/'Guardar regla'/'Guardar cambios'/'Guardar categoria'/'Guardar parametro'.

## 15. Recomendación de orden para 14H.2+

Ningún submódulo mostró endpoints en rango Crítico/Lento en esta corrida puntual — no hay evidencia suficiente para priorizar. Repetir la corrida antes de decidir 14H.2.

Contexto estructural relevante para esta priorización (relevado en el diagnóstico, no medido por endpoints individuales):
- Turnos y Horas especiales son las únicas 2 tarjetas sin ningún cache frontend (`apiCache:false` directo, sin `cachedData`/`cachePolicies`) — cada visita es un round-trip real garantizado, a diferencia de las 7 tarjetas restantes que sí cachean su catálogo principal 10min.
- Conceptos horarios: desde la Etapa 14H.5 este journey también mide sus 2 endpoints anidados (reglas horarias + empleados habilitados) al abrir 'Editar' un concepto existente — ver `docs/decisions/HOUR_CONCEPTS_PERFORMANCE_14H5.md` para el diagnóstico completo y las métricas antes/después.
- Puestos (detalle) es el único submódulo de este journey con 2 GETs secuenciales dependientes (`getById` → `getAssignedEmployees`), mismo patrón de carga compuesta ya optimizado para Legajos en 14D — candidato a evaluar si el volumen de asignaciones por puesto crece.
- Exportación Finnegans queda deliberadamente fuera de esta corrida — ya medido por 14G.1, ver `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md`.

## 16. Raw sanitized JSON

Idéntico al archivo `docs/performance/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.json` generado en esta misma corrida.

```json
{
  "generatedAt": "2026-09-08T17:47:26.318Z",
  "environment": "Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.",
  "baseUrl": "http://localhost:5174",
  "apiBaseUrl": "http://localhost:4002/api",
  "user": "Nivel 1 - RRHH (acceso rápido demo — credenciales en docs/LOCAL_DEVELOPMENT.md, no se repiten en este reporte)",
  "command": "npm run perf:journey:admin-config (desde frontend/)",
  "mode": "read-only",
  "thresholds": {
    "okThresholdMs": 1000,
    "mediumThresholdMs": 2000,
    "slowThresholdMs": 3000
  },
  "summary": {
    "totalActions": 74,
    "coveredActions": 47,
    "skippedActions": 27,
    "slowActions": 2,
    "verySlowActions": 1,
    "writesSkipped": 21,
    "httpErrors": 0,
    "consoleErrors": 0
  },
  "submoduleRollup": [
    {
      "zone": "Login",
      "coveredActions": 1,
      "skippedActions": 0,
      "totalRequests": 4,
      "maxDurationMs": 4155,
      "rank": "Crítico"
    },
    {
      "zone": "A. Configuración (landing)",
      "coveredActions": 2,
      "skippedActions": 0,
      "totalRequests": 1,
      "maxDurationMs": 909,
      "rank": "OK"
    },
    {
      "zone": "B. Turnos",
      "coveredActions": 4,
      "skippedActions": 2,
      "totalRequests": 5,
      "maxDurationMs": 2275,
      "rank": "Lento"
    },
    {
      "zone": "C. Asignaciones de feriados",
      "coveredActions": 2,
      "skippedActions": 1,
      "totalRequests": 6,
      "maxDurationMs": 2093,
      "rank": "Lento"
    },
    {
      "zone": "D. Horas especiales",
      "coveredActions": 2,
      "skippedActions": 2,
      "totalRequests": 4,
      "maxDurationMs": 1797,
      "rank": "Medio"
    },
    {
      "zone": "E. Regímenes laborales",
      "coveredActions": 8,
      "skippedActions": 2,
      "totalRequests": 4,
      "maxDurationMs": 1368,
      "rank": "Medio"
    },
    {
      "zone": "F. Empresas y estructura",
      "coveredActions": 2,
      "skippedActions": 1,
      "totalRequests": 1,
      "maxDurationMs": 980,
      "rank": "OK"
    },
    {
      "zone": "G. Tipos de novedades",
      "coveredActions": 3,
      "skippedActions": 3,
      "totalRequests": 2,
      "maxDurationMs": 972,
      "rank": "OK"
    },
    {
      "zone": "H. Conceptos horarios",
      "coveredActions": 5,
      "skippedActions": 7,
      "totalRequests": 3,
      "maxDurationMs": 884,
      "rank": "OK"
    },
    {
      "zone": "I. Exportación Finnegans",
      "coveredActions": 0,
      "skippedActions": 1,
      "totalRequests": 0,
      "rank": "—"
    },
    {
      "zone": "J. Categorías documentales",
      "coveredActions": 5,
      "skippedActions": 1,
      "totalRequests": 2,
      "maxDurationMs": 891,
      "rank": "OK"
    },
    {
      "zone": "K. Parámetros de auditoría",
      "coveredActions": 5,
      "skippedActions": 1,
      "totalRequests": 2,
      "maxDurationMs": 900,
      "rank": "OK"
    },
    {
      "zone": "L. Puestos (listado)",
      "coveredActions": 4,
      "skippedActions": 3,
      "totalRequests": 4,
      "maxDurationMs": 1216,
      "rank": "Medio"
    },
    {
      "zone": "M. Puesto (detalle)",
      "coveredActions": 2,
      "skippedActions": 2,
      "totalRequests": 3,
      "maxDurationMs": 1513,
      "rank": "Medio"
    },
    {
      "zone": "N. Puesto (creación, sólo navegación)",
      "coveredActions": 2,
      "skippedActions": 1,
      "totalRequests": 4,
      "maxDurationMs": 1246,
      "rank": "Medio"
    }
  ],
  "actions": [
    {
      "name": "Login (acceso rápido RRHH)",
      "zone": "Login",
      "submodule": "Login",
      "route": "/",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 508,
      "networkIdleMs": 4155,
      "requests": [
        {
          "method": "POST",
          "path": "/api/auth/login",
          "statusCode": 200,
          "durationMs": 1127
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 371
        },
        {
          "method": "GET",
          "path": "/api/dashboard/metrics",
          "statusCode": 200,
          "durationMs": 1661
        },
        {
          "method": "GET",
          "path": "/api/audit",
          "statusCode": 200,
          "durationMs": 2005
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Configuración",
      "zone": "A. Configuración (landing)",
      "submodule": "A. Configuración (landing)",
      "route": "/configuracion",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 67,
      "networkIdleMs": 909,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 345
        }
      ],
      "consoleErrors": [],
      "notes": [
        "página estática sin llamadas API — 10 tarjetas de submódulos, todas con <Link> real sin efectos colaterales"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Ver tarjetas de submódulos",
      "zone": "A. Configuración (landing)",
      "submodule": "A. Configuración (landing)",
      "route": "/configuracion",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 9,
      "networkIdleMs": 94,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "se detectaron 10 tarjetas (se esperan 10)"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Turnos",
      "zone": "B. Turnos",
      "submodule": "B. Turnos",
      "route": "/configuracion/turnos",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 79,
      "networkIdleMs": 2275,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 175
        },
        {
          "method": "GET",
          "path": "/api/shifts/assignments/summary",
          "statusCode": 200,
          "durationMs": 344
        },
        {
          "method": "GET",
          "path": "/api/workforce/shift-templates",
          "statusCode": 200,
          "durationMs": 1716
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": false
    },
    {
      "name": "Buscar en Turnos",
      "zone": "B. Turnos",
      "submodule": "B. Turnos",
      "route": "/configuracion/turnos",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 15,
      "networkIdleMs": 417,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "término tomado de un turno real — no se registra el valor buscado en este reporte"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Filtrar Turnos por Estado",
      "zone": "B. Turnos",
      "submodule": "B. Turnos",
      "route": "/configuracion/turnos",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 11,
      "networkIdleMs": 93,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Crear turno",
      "zone": "B. Turnos",
      "submodule": "B. Turnos",
      "route": "/configuracion/turnos",
      "covered": false,
      "skippedReason": "Prohibido por defecto — es la puerta de entrada a un alta real (POST /workforce/shift-templates), no se hace click.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Ver detalle de turno",
      "zone": "B. Turnos",
      "submodule": "B. Turnos",
      "route": "/configuracion/turnos/:id",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 307,
      "networkIdleMs": 1237,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/shift-templates",
          "statusCode": 200,
          "durationMs": 169
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 713
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Inactivar/Activar turno",
      "zone": "B. Turnos",
      "submodule": "B. Turnos",
      "route": "/configuracion/turnos/:id",
      "covered": false,
      "skippedReason": "Prohibido por defecto — acción de escritura (PATCH /workforce/shift-templates/:id).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Asignaciones de feriados",
      "zone": "C. Asignaciones de feriados",
      "submodule": "C. Asignaciones de feriados",
      "route": "/configuracion/turnos-asignaciones-feriados",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 56,
      "networkIdleMs": 2093,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/shift-templates",
          "statusCode": 200,
          "durationMs": 2
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 185
        },
        {
          "method": "GET",
          "path": "/api/shifts/holiday-work/dates",
          "statusCode": 200,
          "durationMs": 363
        },
        {
          "method": "GET",
          "path": "/api/org-structure",
          "statusCode": 200,
          "durationMs": 1540
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": false
    },
    {
      "name": "Seleccionar fecha de feriado",
      "zone": "C. Asignaciones de feriados",
      "submodule": "C. Asignaciones de feriados",
      "route": "/configuracion/turnos-asignaciones-feriados",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 805,
      "networkIdleMs": 1208,
      "requests": [
        {
          "method": "GET",
          "path": "/api/shifts/holiday-work/assignments",
          "statusCode": 200,
          "durationMs": 354
        },
        {
          "method": "GET",
          "path": "/api/shifts/holiday-work/candidates",
          "statusCode": 200,
          "durationMs": 355
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Guardar cambios (convocatoria de feriado)",
      "zone": "C. Asignaciones de feriados",
      "submodule": "C. Asignaciones de feriados",
      "route": "/configuracion/turnos-asignaciones-feriados",
      "covered": false,
      "skippedReason": "Prohibido por defecto — asignaría feriados reales a empleados reales (PUT /shifts/holiday-work/assignments).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Horas especiales",
      "zone": "D. Horas especiales",
      "submodule": "D. Horas especiales",
      "route": "/configuracion/turnos-horas-especiales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 80,
      "networkIdleMs": 1797,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 173
        },
        {
          "method": "GET",
          "path": "/api/workforce/double-hour-rules/calendar",
          "statusCode": 200,
          "durationMs": 358
        },
        {
          "method": "GET",
          "path": "/api/workforce/double-hour-rules",
          "statusCode": 200,
          "durationMs": 359
        },
        {
          "method": "GET",
          "path": "/api/positions",
          "statusCode": 200,
          "durationMs": 1229
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": false
    },
    {
      "name": "Filtrar Horas especiales por clasificación",
      "zone": "D. Horas especiales",
      "submodule": "D. Horas especiales",
      "route": "/configuracion/turnos-horas-especiales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 13,
      "networkIdleMs": 96,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Abrir edición de regla / Crear regla",
      "zone": "D. Horas especiales",
      "submodule": "D. Horas especiales",
      "route": "/configuracion/turnos-horas-especiales",
      "covered": false,
      "skippedReason": "El formulario 'Nueva regla'/'Editar' es un editor inline siempre presente en la página (no el componente Modal compartido) — esta etapa sólo abre y cierra modales del componente Modal compartido (Regímenes laborales) para mantener una única política simple de riesgo en todo el journey.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Activar/Inactivar/Eliminar regla",
      "zone": "D. Horas especiales",
      "submodule": "D. Horas especiales",
      "route": "/configuracion/turnos-horas-especiales",
      "covered": false,
      "skippedReason": "Prohibido por defecto — acciones de escritura (PATCH/DELETE /workforce/double-hour-rules/:id).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Regímenes laborales",
      "zone": "E. Regímenes laborales",
      "submodule": "E. Regímenes laborales",
      "route": "/configuracion/regimenes-laborales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 72,
      "networkIdleMs": 1095,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 388
        },
        {
          "method": "GET",
          "path": "/api/work-regimes",
          "statusCode": 200,
          "durationMs": 533
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": false
    },
    {
      "name": "Buscar en Regímenes laborales",
      "zone": "E. Regímenes laborales",
      "submodule": "E. Regímenes laborales",
      "route": "/configuracion/regimenes-laborales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 5,
      "networkIdleMs": 406,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "término tomado de un régimen real — no se registra el valor buscado en este reporte"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Filtrar Regímenes laborales por Estado",
      "zone": "E. Regímenes laborales",
      "submodule": "E. Regímenes laborales",
      "route": "/configuracion/regimenes-laborales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 4,
      "networkIdleMs": 86,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Abrir modal Crear régimen",
      "zone": "E. Regímenes laborales",
      "submodule": "E. Regímenes laborales",
      "route": "/configuracion/regimenes-laborales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 15,
      "networkIdleMs": 97,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "se abrió el modal y se cerró sin guardar (modo lectura de esta etapa)"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cerrar modal Crear régimen",
      "zone": "E. Regímenes laborales",
      "submodule": "E. Regímenes laborales",
      "route": "/configuracion/regimenes-laborales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 18,
      "networkIdleMs": 100,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Ver empleados asociados a un régimen",
      "zone": "E. Regímenes laborales",
      "submodule": "E. Regímenes laborales",
      "route": "/configuracion/regimenes-laborales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 17,
      "networkIdleMs": 99,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Filtrar vigencia de empleados asociados",
      "zone": "E. Regímenes laborales",
      "submodule": "E. Regímenes laborales",
      "route": "/configuracion/regimenes-laborales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 1286,
      "networkIdleMs": 1368,
      "requests": [
        {
          "method": "GET",
          "path": "/api/work-regimes/:id/employees",
          "statusCode": 200,
          "durationMs": 736
        },
        {
          "method": "GET",
          "path": "/api/work-regimes/:id/employees",
          "statusCode": 200,
          "durationMs": 823
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cerrar modal Empleados asociados",
      "zone": "E. Regímenes laborales",
      "submodule": "E. Regímenes laborales",
      "route": "/configuracion/regimenes-laborales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 22,
      "networkIdleMs": 104,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Agregar empleados / Finalizar asignación",
      "zone": "E. Regímenes laborales",
      "submodule": "E. Regímenes laborales",
      "route": "/configuracion/regimenes-laborales",
      "covered": false,
      "skippedReason": "Prohibido por defecto — acciones de escritura (POST /employees/:employeeId/work-regimes, PATCH .../:assignmentId/close).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Editar régimen / Activar-Inactivar régimen",
      "zone": "E. Regímenes laborales",
      "submodule": "E. Regímenes laborales",
      "route": "/configuracion/regimenes-laborales",
      "covered": false,
      "skippedReason": "Prohibido por defecto — acciones de escritura (POST/PATCH /work-regimes[/:id][/status]).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Empresas y estructura",
      "zone": "F. Empresas y estructura",
      "submodule": "F. Empresas y estructura",
      "route": "/configuracion/empresas-estructura",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 48,
      "networkIdleMs": 980,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 459
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cambiar de pestaña en Empresas y estructura",
      "zone": "F. Empresas y estructura",
      "submodule": "F. Empresas y estructura",
      "route": "/configuracion/empresas-estructura",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 32,
      "networkIdleMs": 234,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Nuevo registro / Editar / Guardar estructura",
      "zone": "F. Empresas y estructura",
      "submodule": "F. Empresas y estructura",
      "route": "/configuracion/empresas-estructura",
      "covered": false,
      "skippedReason": "Etapa 14H.6: evaluado y descartado ampliar el alcance acá (a diferencia de Categorías documentales/Parámetros de auditoría, arriba/abajo) — el editor inline no tiene botón de cancelar limpio (sólo se cierra cambiando de pestaña, un efecto colateral del onChange de las Tabs, no un control pensado para esto), y a diferencia de Conceptos horarios (14H.5) abrirlo no revelaría ningún request nuevo (el catálogo completo ya se cargó una sola vez vía getCatalog(), editar es 100% local) — sin valor diagnóstico que justifique salirse de la política de sólo abrir editores con un cierre limpio. No se abre esta etapa, ni se llega al submit real (POST/PATCH /org-structure/...).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Tipos de novedades",
      "zone": "G. Tipos de novedades",
      "submodule": "G. Tipos de novedades",
      "route": "/configuracion/tipos-novedades",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 52,
      "networkIdleMs": 972,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 273
        },
        {
          "method": "GET",
          "path": "/api/novelty-types",
          "statusCode": 200,
          "durationMs": 435
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": false
    },
    {
      "name": "Buscar en Tipos de novedades",
      "zone": "G. Tipos de novedades",
      "submodule": "G. Tipos de novedades",
      "route": "/configuracion/tipos-novedades",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 6,
      "networkIdleMs": 408,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "término tomado de un tipo de novedad real — no se registra el valor buscado en este reporte"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Filtrar Tipos de novedades por Finnegans",
      "zone": "G. Tipos de novedades",
      "submodule": "G. Tipos de novedades",
      "route": "/configuracion/tipos-novedades",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 5,
      "networkIdleMs": 87,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Crear tipo de novedad",
      "zone": "G. Tipos de novedades",
      "submodule": "G. Tipos de novedades",
      "route": "/configuracion/tipos-novedades",
      "covered": false,
      "skippedReason": "Prohibido por defecto — navegación a un formulario de alta (POST /novelty-types), no se hace click.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Ver detalle de tipo de novedad",
      "zone": "G. Tipos de novedades",
      "submodule": "G. Tipos de novedades",
      "route": "/configuracion/tipos-novedades",
      "covered": false,
      "skippedReason": "Navegación de detalle fuera del alcance macro de esta etapa (no es escritura) — candidato de profundización en una etapa futura si el volumen lo justifica.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Activar/Inactivar tipo de novedad",
      "zone": "G. Tipos de novedades",
      "submodule": "G. Tipos de novedades",
      "route": "/configuracion/tipos-novedades",
      "covered": false,
      "skippedReason": "Prohibido por defecto — acción de escritura (PATCH /novelty-types/:id).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Conceptos horarios",
      "zone": "H. Conceptos horarios",
      "submodule": "H. Conceptos horarios",
      "route": "/configuracion/conceptos-horarios",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 52,
      "networkIdleMs": 884,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 171
        },
        {
          "method": "GET",
          "path": "/api/hour-concepts",
          "statusCode": 200,
          "durationMs": 343
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": false
    },
    {
      "name": "Buscar en Conceptos horarios",
      "zone": "H. Conceptos horarios",
      "submodule": "H. Conceptos horarios",
      "route": "/configuracion/conceptos-horarios",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 5,
      "networkIdleMs": 408,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "término tomado de un concepto horario real — no se registra el valor buscado en este reporte"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Filtrar Conceptos horarios por Tipo",
      "zone": "H. Conceptos horarios",
      "submodule": "H. Conceptos horarios",
      "route": "/configuracion/conceptos-horarios",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 6,
      "networkIdleMs": 86,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Abrir detalle de concepto horario (Editar)",
      "zone": "H. Conceptos horarios",
      "submodule": "H. Conceptos horarios",
      "route": "/configuracion/conceptos-horarios",
      "covered": true,
      "skippedReason": null,
      "networkIdleMs": 435,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Abrir modal Nueva regla horaria",
      "zone": "H. Conceptos horarios",
      "submodule": "H. Conceptos horarios",
      "route": "/configuracion/conceptos-horarios",
      "covered": false,
      "skippedReason": "no se encontró el disparador de este modal en el estado actual del entorno",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cerrar modal Nueva regla horaria",
      "zone": "H. Conceptos horarios",
      "submodule": "H. Conceptos horarios",
      "route": "/configuracion/conceptos-horarios",
      "covered": false,
      "skippedReason": "depende de la acción anterior, salteada",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cerrar detalle de concepto horario sin guardar",
      "zone": "H. Conceptos horarios",
      "submodule": "H. Conceptos horarios",
      "route": "/configuracion/conceptos-horarios",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 46,
      "networkIdleMs": 131,
      "requests": [
        {
          "method": "GET",
          "path": "/api/hour-concepts/:id/rules",
          "statusCode": 200,
          "durationMs": 882
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Crear concepto horario / Guardar cambios del concepto",
      "zone": "H. Conceptos horarios",
      "submodule": "H. Conceptos horarios",
      "route": "/configuracion/conceptos-horarios",
      "covered": false,
      "skippedReason": "Prohibido por defecto — acción de escritura (POST/PATCH /hour-concepts[/:id]).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Crear/Editar regla horaria (Guardar)",
      "zone": "H. Conceptos horarios",
      "submodule": "H. Conceptos horarios",
      "route": "/configuracion/conceptos-horarios",
      "covered": false,
      "skippedReason": "Prohibido por defecto — el modal se abre y se cierra sin tocar este botón (POST/PATCH /hour-concept-rules[/:id]).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Activar/Inactivar regla horaria",
      "zone": "H. Conceptos horarios",
      "submodule": "H. Conceptos horarios",
      "route": "/configuracion/conceptos-horarios",
      "covered": false,
      "skippedReason": "Prohibido por defecto — acción de escritura (PATCH /hour-concept-rules/:id/status).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Agregar/Quitar empleados habilitados",
      "zone": "H. Conceptos horarios",
      "submodule": "H. Conceptos horarios",
      "route": "/configuracion/conceptos-horarios",
      "covered": false,
      "skippedReason": "Prohibido por defecto — acciones de escritura (POST /hour-concepts/:id/employees, DELETE /hour-concepts/:id/employees/:employeeId).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Deshabilitar/Eliminar concepto horario",
      "zone": "H. Conceptos horarios",
      "submodule": "H. Conceptos horarios",
      "route": "/configuracion/conceptos-horarios",
      "covered": false,
      "skippedReason": "Prohibido por defecto — acciones de escritura (PATCH /hour-concepts/:id/status, DELETE /hour-concepts/:id).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Exportación Finnegans",
      "zone": "I. Exportación Finnegans",
      "submodule": "I. Exportación Finnegans",
      "route": "/configuracion/conceptos-horarios",
      "covered": false,
      "skippedReason": "Ya cubierto en detalle por el journey de Gestión Horaria (Etapa 14G.1, zona 'J. Exportación', 4 acciones incl. cambio de período y búsqueda) — no se remide para no duplicar esfuerzo. Ver docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md. Ruta real confirmada: /configuracion/liquidacion → FinnegansExportPage.tsx.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Categorías documentales",
      "zone": "J. Categorías documentales",
      "submodule": "J. Categorías documentales",
      "route": "/configuracion/categorias-documentales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 69,
      "networkIdleMs": 891,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 170
        },
        {
          "method": "GET",
          "path": "/api/document-categories",
          "statusCode": 200,
          "durationMs": 337
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": false
    },
    {
      "name": "Buscar en Categorías documentales",
      "zone": "J. Categorías documentales",
      "submodule": "J. Categorías documentales",
      "route": "/configuracion/categorias-documentales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 10,
      "networkIdleMs": 413,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "término tomado de una categoría documental real — no se registra el valor buscado en este reporte"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Filtrar Categorías documentales por Tipo",
      "zone": "J. Categorías documentales",
      "submodule": "J. Categorías documentales",
      "route": "/configuracion/categorias-documentales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 10,
      "networkIdleMs": 94,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Abrir detalle de categoría documental (Editar)",
      "zone": "J. Categorías documentales",
      "submodule": "J. Categorías documentales",
      "route": "/configuracion/categorias-documentales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 43,
      "networkIdleMs": 126,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cerrar detalle de categoría documental sin guardar",
      "zone": "J. Categorías documentales",
      "submodule": "J. Categorías documentales",
      "route": "/configuracion/categorias-documentales",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 33,
      "networkIdleMs": 116,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Crear categoría documental / Guardar cambios de categoría",
      "zone": "J. Categorías documentales",
      "submodule": "J. Categorías documentales",
      "route": "/configuracion/categorias-documentales",
      "covered": false,
      "skippedReason": "Prohibido por defecto — el editor se abre y se cierra sin tocar 'Guardar categoria' (POST/PATCH /document-categories[/:id]).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Parámetros de auditoría",
      "zone": "K. Parámetros de auditoría",
      "submodule": "K. Parámetros de auditoría",
      "route": "/configuracion/parametros-auditoria",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 66,
      "networkIdleMs": 900,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 335
        },
        {
          "method": "GET",
          "path": "/api/audit-parameters",
          "statusCode": 200,
          "durationMs": 349
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": false
    },
    {
      "name": "Buscar en Parámetros de auditoría",
      "zone": "K. Parámetros de auditoría",
      "submodule": "K. Parámetros de auditoría",
      "route": "/configuracion/parametros-auditoria",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 7,
      "networkIdleMs": 411,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "término tomado de un parámetro de auditoría real — no se registra el valor buscado en este reporte"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Filtrar Parámetros de auditoría por Módulo",
      "zone": "K. Parámetros de auditoría",
      "submodule": "K. Parámetros de auditoría",
      "route": "/configuracion/parametros-auditoria",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 11,
      "networkIdleMs": 95,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Abrir detalle de parámetro de auditoría (Editar)",
      "zone": "K. Parámetros de auditoría",
      "submodule": "K. Parámetros de auditoría",
      "route": "/configuracion/parametros-auditoria",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 54,
      "networkIdleMs": 136,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cerrar detalle de parámetro de auditoría sin guardar",
      "zone": "K. Parámetros de auditoría",
      "submodule": "K. Parámetros de auditoría",
      "route": "/configuracion/parametros-auditoria",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 22,
      "networkIdleMs": 107,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Crear parámetro de auditoría / Guardar cambios de parámetro",
      "zone": "K. Parámetros de auditoría",
      "submodule": "K. Parámetros de auditoría",
      "route": "/configuracion/parametros-auditoria",
      "covered": false,
      "skippedReason": "Prohibido por defecto — el editor se abre y se cierra sin tocar 'Guardar parametro' (POST/PATCH /audit-parameters[/:id]).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Puestos",
      "zone": "L. Puestos (listado)",
      "submodule": "L. Puestos (listado)",
      "route": "/puestos",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 55,
      "networkIdleMs": 1216,
      "requests": [
        {
          "method": "GET",
          "path": "/api/positions",
          "statusCode": 200,
          "durationMs": 670
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 684
        },
        {
          "method": "GET",
          "path": "/api/positions",
          "statusCode": 200,
          "durationMs": 676
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": false
    },
    {
      "name": "Buscar en Puestos",
      "zone": "L. Puestos (listado)",
      "submodule": "L. Puestos (listado)",
      "route": "/puestos",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 16,
      "networkIdleMs": 419,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "término tomado de un puesto real — no se registra el valor buscado en este reporte"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Filtrar Puestos por Sector",
      "zone": "L. Puestos (listado)",
      "submodule": "L. Puestos (listado)",
      "route": "/puestos",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 14,
      "networkIdleMs": 97,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Limpiar filtros en Puestos",
      "zone": "L. Puestos (listado)",
      "submodule": "L. Puestos (listado)",
      "route": "/puestos",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 47,
      "networkIdleMs": 133,
      "requests": [
        {
          "method": "GET",
          "path": "/api/positions",
          "statusCode": 200,
          "durationMs": 1031
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Paginar Puestos",
      "zone": "L. Puestos (listado)",
      "submodule": "L. Puestos (listado)",
      "route": "/puestos",
      "covered": false,
      "skippedReason": "no hay una segunda página de puestos en el entorno actual (botón 'Siguiente' ausente o deshabilitado)",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Crear puesto",
      "zone": "L. Puestos (listado)",
      "submodule": "L. Puestos (listado)",
      "route": "/puestos",
      "covered": false,
      "skippedReason": "Prohibido por defecto — es la puerta de entrada a un alta real (POST /positions), no se hace click.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Inactivar/Activar/Eliminar puesto",
      "zone": "L. Puestos (listado)",
      "submodule": "L. Puestos (listado)",
      "route": "/puestos",
      "covered": false,
      "skippedReason": "Prohibido por defecto — acciones de escritura (PATCH /positions/:id, DELETE /positions/:id).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Ver detalle de puesto",
      "zone": "M. Puesto (detalle)",
      "submodule": "M. Puesto (detalle)",
      "route": "/puestos/:id",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 820,
      "networkIdleMs": 1513,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 176
        },
        {
          "method": "GET",
          "path": "/api/positions/:id",
          "statusCode": 200,
          "durationMs": 431
        },
        {
          "method": "GET",
          "path": "/api/positions/:id/employees",
          "statusCode": 200,
          "durationMs": 523
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Cambiar de pestaña en detalle de Puesto",
      "zone": "M. Puesto (detalle)",
      "submodule": "M. Puesto (detalle)",
      "route": "/puestos/:id",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 41,
      "networkIdleMs": 245,
      "requests": [],
      "consoleErrors": [],
      "notes": [
        "cambio de pestaña 100% client-side — empleados asignados ya se cargó al entrar al detalle, no debería disparar un request nuevo"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Guardar cambios en Puesto",
      "zone": "M. Puesto (detalle)",
      "submodule": "M. Puesto (detalle)",
      "route": "/puestos/:id",
      "covered": false,
      "skippedReason": "Prohibido por defecto — acción de escritura (PATCH /positions/:id).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Inactivar/Eliminar puesto (detalle)",
      "zone": "M. Puesto (detalle)",
      "submodule": "M. Puesto (detalle)",
      "route": "/puestos/:id",
      "covered": false,
      "skippedReason": "Prohibido por defecto — acciones de escritura (PATCH /positions/:id, DELETE /positions/:id).",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    },
    {
      "name": "Entrar a Crear puesto (sólo navegación, sin guardar)",
      "zone": "N. Puesto (creación, sólo navegación)",
      "submodule": "N. Puesto (creación, sólo navegación)",
      "route": "/puestos/nuevo",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 70,
      "networkIdleMs": 1246,
      "requests": [
        {
          "method": "GET",
          "path": "/api/positions",
          "statusCode": 200,
          "durationMs": 172
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 352
        },
        {
          "method": "GET",
          "path": "/api/salary-categories",
          "statusCode": 200,
          "durationMs": 686
        }
      ],
      "consoleErrors": [],
      "notes": [
        "visitar esta ruta dispara GET /positions (cálculo del próximo código correlativo) — es de sólo lectura, no persiste nada; probable cache hit si Puestos ya se visitó antes en este mismo recorrido (misma cachePolicies.positionsCatalog)"
      ],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Salir de Crear puesto sin guardar",
      "zone": "N. Puesto (creación, sólo navegación)",
      "submodule": "N. Puesto (creación, sólo navegación)",
      "route": "/puestos",
      "covered": true,
      "skippedReason": null,
      "visibleMs": 63,
      "networkIdleMs": 145,
      "requests": [
        {
          "method": "GET",
          "path": "/api/positions",
          "statusCode": 200,
          "durationMs": 2
        }
      ],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Guardar puesto",
      "zone": "N. Puesto (creación, sólo navegación)",
      "submodule": "N. Puesto (creación, sólo navegación)",
      "route": "/puestos",
      "covered": false,
      "skippedReason": "Prohibido por defecto — crearía un puesto real (POST /positions). Nunca se usa .fill() en ningún campo del formulario, ni siquiera momentáneamente.",
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": true,
      "emptyScreen": null
    }
  ],
  "slowestRequests": [
    {
      "method": "GET",
      "path": "/api/audit",
      "statusCode": 200,
      "durationMs": 2005
    },
    {
      "method": "GET",
      "path": "/api/workforce/shift-templates",
      "statusCode": 200,
      "durationMs": 1716
    },
    {
      "method": "GET",
      "path": "/api/dashboard/metrics",
      "statusCode": 200,
      "durationMs": 1661
    },
    {
      "method": "GET",
      "path": "/api/org-structure",
      "statusCode": 200,
      "durationMs": 1540
    },
    {
      "method": "GET",
      "path": "/api/positions",
      "statusCode": 200,
      "durationMs": 1229
    },
    {
      "method": "POST",
      "path": "/api/auth/login",
      "statusCode": 200,
      "durationMs": 1127
    },
    {
      "method": "GET",
      "path": "/api/positions",
      "statusCode": 200,
      "durationMs": 1031
    },
    {
      "method": "GET",
      "path": "/api/hour-concepts/:id/rules",
      "statusCode": 200,
      "durationMs": 882
    },
    {
      "method": "GET",
      "path": "/api/work-regimes/:id/employees",
      "statusCode": 200,
      "durationMs": 823
    },
    {
      "method": "GET",
      "path": "/api/work-regimes/:id/employees",
      "statusCode": 200,
      "durationMs": 736
    }
  ],
  "slowestActions": [
    {
      "name": "Login (acceso rápido RRHH)",
      "zone": "Login",
      "visibleMs": 508,
      "networkIdleMs": 4155
    },
    {
      "name": "Entrar a Turnos",
      "zone": "B. Turnos",
      "visibleMs": 79,
      "networkIdleMs": 2275
    },
    {
      "name": "Entrar a Asignaciones de feriados",
      "zone": "C. Asignaciones de feriados",
      "visibleMs": 56,
      "networkIdleMs": 2093
    },
    {
      "name": "Entrar a Horas especiales",
      "zone": "D. Horas especiales",
      "visibleMs": 80,
      "networkIdleMs": 1797
    },
    {
      "name": "Ver detalle de puesto",
      "zone": "M. Puesto (detalle)",
      "visibleMs": 820,
      "networkIdleMs": 1513
    },
    {
      "name": "Filtrar vigencia de empleados asociados",
      "zone": "E. Regímenes laborales",
      "visibleMs": 1286,
      "networkIdleMs": 1368
    },
    {
      "name": "Entrar a Crear puesto (sólo navegación, sin guardar)",
      "zone": "N. Puesto (creación, sólo navegación)",
      "visibleMs": 70,
      "networkIdleMs": 1246
    },
    {
      "name": "Ver detalle de turno",
      "zone": "B. Turnos",
      "visibleMs": 307,
      "networkIdleMs": 1237
    },
    {
      "name": "Entrar a Puestos",
      "zone": "L. Puestos (listado)",
      "visibleMs": 55,
      "networkIdleMs": 1216
    },
    {
      "name": "Seleccionar fecha de feriado",
      "zone": "C. Asignaciones de feriados",
      "visibleMs": 805,
      "networkIdleMs": 1208
    }
  ],
  "repeatedEndpoints": [
    {
      "key": "GET /api/workforce/notifications-unread-count",
      "method": "GET",
      "path": "/api/workforce/notifications-unread-count",
      "count": 15,
      "avgDurationMs": 331,
      "maxDurationMs": 713,
      "statusCodes": [
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/workforce/shift-templates",
      "method": "GET",
      "path": "/api/workforce/shift-templates",
      "count": 3,
      "avgDurationMs": 629,
      "maxDurationMs": 1716,
      "statusCodes": [
        200,
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/positions",
      "method": "GET",
      "path": "/api/positions",
      "count": 6,
      "avgDurationMs": 630,
      "maxDurationMs": 1229,
      "statusCodes": [
        200,
        200,
        200,
        200,
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/work-regimes/:id/employees",
      "method": "GET",
      "path": "/api/work-regimes/:id/employees",
      "count": 2,
      "avgDurationMs": 780,
      "maxDurationMs": 823,
      "statusCodes": [
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    }
  ],
  "duplicatesByAction": [
    {
      "name": "Filtrar vigencia de empleados asociados",
      "zone": "E. Regímenes laborales",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/work-regimes/:id/employees",
          "count": 2,
          "durationsMs": [
            736,
            823
          ]
        }
      ]
    },
    {
      "name": "Entrar a Puestos",
      "zone": "L. Puestos (listado)",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/positions",
          "count": 2,
          "durationsMs": [
            670,
            676
          ]
        }
      ]
    }
  ],
  "coverageGaps": [
    {
      "name": "Crear turno",
      "zone": "B. Turnos",
      "isWrite": true,
      "reason": "Prohibido por defecto — es la puerta de entrada a un alta real (POST /workforce/shift-templates), no se hace click."
    },
    {
      "name": "Inactivar/Activar turno",
      "zone": "B. Turnos",
      "isWrite": true,
      "reason": "Prohibido por defecto — acción de escritura (PATCH /workforce/shift-templates/:id)."
    },
    {
      "name": "Guardar cambios (convocatoria de feriado)",
      "zone": "C. Asignaciones de feriados",
      "isWrite": true,
      "reason": "Prohibido por defecto — asignaría feriados reales a empleados reales (PUT /shifts/holiday-work/assignments)."
    },
    {
      "name": "Abrir edición de regla / Crear regla",
      "zone": "D. Horas especiales",
      "isWrite": false,
      "reason": "El formulario 'Nueva regla'/'Editar' es un editor inline siempre presente en la página (no el componente Modal compartido) — esta etapa sólo abre y cierra modales del componente Modal compartido (Regímenes laborales) para mantener una única política simple de riesgo en todo el journey."
    },
    {
      "name": "Activar/Inactivar/Eliminar regla",
      "zone": "D. Horas especiales",
      "isWrite": true,
      "reason": "Prohibido por defecto — acciones de escritura (PATCH/DELETE /workforce/double-hour-rules/:id)."
    },
    {
      "name": "Agregar empleados / Finalizar asignación",
      "zone": "E. Regímenes laborales",
      "isWrite": true,
      "reason": "Prohibido por defecto — acciones de escritura (POST /employees/:employeeId/work-regimes, PATCH .../:assignmentId/close)."
    },
    {
      "name": "Editar régimen / Activar-Inactivar régimen",
      "zone": "E. Regímenes laborales",
      "isWrite": true,
      "reason": "Prohibido por defecto — acciones de escritura (POST/PATCH /work-regimes[/:id][/status])."
    },
    {
      "name": "Nuevo registro / Editar / Guardar estructura",
      "zone": "F. Empresas y estructura",
      "isWrite": true,
      "reason": "Etapa 14H.6: evaluado y descartado ampliar el alcance acá (a diferencia de Categorías documentales/Parámetros de auditoría, arriba/abajo) — el editor inline no tiene botón de cancelar limpio (sólo se cierra cambiando de pestaña, un efecto colateral del onChange de las Tabs, no un control pensado para esto), y a diferencia de Conceptos horarios (14H.5) abrirlo no revelaría ningún request nuevo (el catálogo completo ya se cargó una sola vez vía getCatalog(), editar es 100% local) — sin valor diagnóstico que justifique salirse de la política de sólo abrir editores con un cierre limpio. No se abre esta etapa, ni se llega al submit real (POST/PATCH /org-structure/...)."
    },
    {
      "name": "Crear tipo de novedad",
      "zone": "G. Tipos de novedades",
      "isWrite": true,
      "reason": "Prohibido por defecto — navegación a un formulario de alta (POST /novelty-types), no se hace click."
    },
    {
      "name": "Ver detalle de tipo de novedad",
      "zone": "G. Tipos de novedades",
      "isWrite": false,
      "reason": "Navegación de detalle fuera del alcance macro de esta etapa (no es escritura) — candidato de profundización en una etapa futura si el volumen lo justifica."
    },
    {
      "name": "Activar/Inactivar tipo de novedad",
      "zone": "G. Tipos de novedades",
      "isWrite": true,
      "reason": "Prohibido por defecto — acción de escritura (PATCH /novelty-types/:id)."
    },
    {
      "name": "Abrir modal Nueva regla horaria",
      "zone": "H. Conceptos horarios",
      "isWrite": false,
      "reason": "no se encontró el disparador de este modal en el estado actual del entorno"
    },
    {
      "name": "Cerrar modal Nueva regla horaria",
      "zone": "H. Conceptos horarios",
      "isWrite": false,
      "reason": "depende de la acción anterior, salteada"
    },
    {
      "name": "Crear concepto horario / Guardar cambios del concepto",
      "zone": "H. Conceptos horarios",
      "isWrite": true,
      "reason": "Prohibido por defecto — acción de escritura (POST/PATCH /hour-concepts[/:id])."
    },
    {
      "name": "Crear/Editar regla horaria (Guardar)",
      "zone": "H. Conceptos horarios",
      "isWrite": true,
      "reason": "Prohibido por defecto — el modal se abre y se cierra sin tocar este botón (POST/PATCH /hour-concept-rules[/:id])."
    },
    {
      "name": "Activar/Inactivar regla horaria",
      "zone": "H. Conceptos horarios",
      "isWrite": true,
      "reason": "Prohibido por defecto — acción de escritura (PATCH /hour-concept-rules/:id/status)."
    },
    {
      "name": "Agregar/Quitar empleados habilitados",
      "zone": "H. Conceptos horarios",
      "isWrite": true,
      "reason": "Prohibido por defecto — acciones de escritura (POST /hour-concepts/:id/employees, DELETE /hour-concepts/:id/employees/:employeeId)."
    },
    {
      "name": "Deshabilitar/Eliminar concepto horario",
      "zone": "H. Conceptos horarios",
      "isWrite": true,
      "reason": "Prohibido por defecto — acciones de escritura (PATCH /hour-concepts/:id/status, DELETE /hour-concepts/:id)."
    },
    {
      "name": "Entrar a Exportación Finnegans",
      "zone": "I. Exportación Finnegans",
      "isWrite": false,
      "reason": "Ya cubierto en detalle por el journey de Gestión Horaria (Etapa 14G.1, zona 'J. Exportación', 4 acciones incl. cambio de período y búsqueda) — no se remide para no duplicar esfuerzo. Ver docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md. Ruta real confirmada: /configuracion/liquidacion → FinnegansExportPage.tsx."
    },
    {
      "name": "Crear categoría documental / Guardar cambios de categoría",
      "zone": "J. Categorías documentales",
      "isWrite": true,
      "reason": "Prohibido por defecto — el editor se abre y se cierra sin tocar 'Guardar categoria' (POST/PATCH /document-categories[/:id])."
    },
    {
      "name": "Crear parámetro de auditoría / Guardar cambios de parámetro",
      "zone": "K. Parámetros de auditoría",
      "isWrite": true,
      "reason": "Prohibido por defecto — el editor se abre y se cierra sin tocar 'Guardar parametro' (POST/PATCH /audit-parameters[/:id])."
    },
    {
      "name": "Paginar Puestos",
      "zone": "L. Puestos (listado)",
      "isWrite": false,
      "reason": "no hay una segunda página de puestos en el entorno actual (botón 'Siguiente' ausente o deshabilitado)"
    },
    {
      "name": "Crear puesto",
      "zone": "L. Puestos (listado)",
      "isWrite": true,
      "reason": "Prohibido por defecto — es la puerta de entrada a un alta real (POST /positions), no se hace click."
    },
    {
      "name": "Inactivar/Activar/Eliminar puesto",
      "zone": "L. Puestos (listado)",
      "isWrite": true,
      "reason": "Prohibido por defecto — acciones de escritura (PATCH /positions/:id, DELETE /positions/:id)."
    },
    {
      "name": "Guardar cambios en Puesto",
      "zone": "M. Puesto (detalle)",
      "isWrite": true,
      "reason": "Prohibido por defecto — acción de escritura (PATCH /positions/:id)."
    },
    {
      "name": "Inactivar/Eliminar puesto (detalle)",
      "zone": "M. Puesto (detalle)",
      "isWrite": true,
      "reason": "Prohibido por defecto — acciones de escritura (PATCH /positions/:id, DELETE /positions/:id)."
    },
    {
      "name": "Guardar puesto",
      "zone": "N. Puesto (creación, sólo navegación)",
      "isWrite": true,
      "reason": "Prohibido por defecto — crearía un puesto real (POST /positions). Nunca se usa .fill() en ningún campo del formulario, ni siquiera momentáneamente."
    }
  ]
}
```
