# Performance Journey — Configuración + Puestos (Etapa 14H.1)

Reporte generado automáticamente por `npm run perf:journey:admin-config`. No editar a mano — se sobreescribe en cada corrida.

**Etapa de diagnóstico macro — no de optimización.** Ningún hallazgo de este reporte se corrigió en esta etapa; ver §15 para el orden recomendado de 14H.2 en adelante.

## 1. Resumen ejecutivo

Recorrido macro de la landing de Configuración, sus 10 tarjetas de submódulo (Exportación Finnegans excluida por estar ya cubierta por 14G.1) y Puestos en sus 3 rutas (listado, detalle, creación): 41/63 acciones cubiertas, 22 salteadas (18 de ellas por ser de escritura, con motivo documentado cada una), 0 respuestas HTTP >= 400, 0 errores de consola. 1 acción(es) en rango Crítico (> 3000ms) y 1 en rango Lento (2000-3000ms). Cero escrituras ejecutadas — modo `read-only` en todo el recorrido.

## 2. Ambiente

- Generado: 2026-09-08T14:51:11.124Z
- Frontend: http://localhost:5174
- Backend: http://localhost:4002/api
- Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.
- Usuario: Nivel 1 - RRHH (acceso rápido demo — credenciales en docs/LOCAL_DEVELOPMENT.md, no se repiten en este reporte)
- Comando: `npm run perf:journey:admin-config (desde frontend/)`

## 3. Cobertura general

| Submódulo | Acciones cubiertas | Acciones salteadas | Requests capturadas | Peor duración | Rango |
|---|---|---|---|---|---|
| Login | 1 | 0 | 4 | 6207ms | Crítico |
| A. Configuración (landing) | 2 | 0 | 1 | 1005ms | Medio |
| B. Turnos | 4 | 2 | 8 | 1697ms | Medio |
| C. Asignaciones de feriados | 2 | 1 | 8 | 2267ms | Lento |
| D. Horas especiales | 2 | 2 | 6 | 1832ms | Medio |
| E. Regímenes laborales | 8 | 2 | 4 | 1376ms | Medio |
| F. Empresas y estructura | 2 | 1 | 1 | 812ms | OK |
| G. Tipos de novedades | 3 | 3 | 2 | 914ms | OK |
| H. Conceptos horarios | 3 | 2 | 2 | 1414ms | Medio |
| I. Exportación Finnegans | 0 | 1 | 0 | — | — |
| J. Categorías documentales | 3 | 1 | 2 | 1002ms | Medio |
| K. Parámetros de auditoría | 3 | 1 | 2 | 1778ms | Medio |
| L. Puestos (listado) | 4 | 3 | 3 | 1464ms | Medio |
| M. Puesto (detalle) | 2 | 2 | 3 | 1498ms | Medio |
| N. Puesto (creación, sólo navegación) | 2 | 1 | 4 | 1263ms | Medio |

## 4. Tabla de acciones

| Acción | Submódulo | Ruta | Visible | Network idle | Requests | Errores consola | Escritura |
|---|---|---|---|---|---|---|---|
| Login (acceso rápido RRHH) | Login | `/` | 563ms | 6207ms | 4 | 0 | No |
| Entrar a Configuración | A. Configuración (landing) | `/configuracion` | 87ms | 1005ms | 1 | 0 | No |
| Ver tarjetas de submódulos | A. Configuración (landing) | `/configuracion` | 8ms | 93ms | 0 | 0 | No |
| Entrar a Turnos | B. Turnos | `/configuracion/turnos` | 71ms | 1697ms | 5 | 0 | No |
| Buscar en Turnos | B. Turnos | `/configuracion/turnos` | 18ms | 423ms | 0 | 0 | No |
| Filtrar Turnos por Estado | B. Turnos | `/configuracion/turnos` | 17ms | 101ms | 0 | 0 | No |
| Ver detalle de turno | B. Turnos | `/configuracion/turnos/:id` | 73ms | 1003ms | 3 | 0 | No |
| Entrar a Asignaciones de feriados | C. Asignaciones de feriados | `/configuracion/turnos-asignaciones-feriados` | 77ms | 2267ms | 6 | 0 | No |
| Seleccionar fecha de feriado | C. Asignaciones de feriados | `/configuracion/turnos-asignaciones-feriados` | 1331ms | 1735ms | 2 | 0 | No |
| Entrar a Horas especiales | D. Horas especiales | `/configuracion/turnos-horas-especiales` | 113ms | 1832ms | 6 | 0 | No |
| Filtrar Horas especiales por clasificación | D. Horas especiales | `/configuracion/turnos-horas-especiales` | 12ms | 96ms | 0 | 0 | No |
| Entrar a Regímenes laborales | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 131ms | 1148ms | 2 | 0 | No |
| Buscar en Regímenes laborales | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 9ms | 413ms | 0 | 0 | No |
| Filtrar Regímenes laborales por Estado | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 11ms | 94ms | 0 | 0 | No |
| Abrir modal Crear régimen | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 19ms | 101ms | 0 | 0 | No |
| Cerrar modal Crear régimen | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 27ms | 109ms | 0 | 0 | No |
| Ver empleados asociados a un régimen | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 41ms | 124ms | 0 | 0 | No |
| Filtrar vigencia de empleados asociados | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 1292ms | 1376ms | 2 | 0 | No |
| Cerrar modal Empleados asociados | E. Regímenes laborales | `/configuracion/regimenes-laborales` | 41ms | 124ms | 0 | 0 | No |
| Entrar a Empresas y estructura | F. Empresas y estructura | `/configuracion/empresas-estructura` | 124ms | 812ms | 1 | 0 | No |
| Cambiar de pestaña en Empresas y estructura | F. Empresas y estructura | `/configuracion/empresas-estructura` | 47ms | 250ms | 0 | 0 | No |
| Entrar a Tipos de novedades | G. Tipos de novedades | `/configuracion/tipos-novedades` | 74ms | 914ms | 2 | 0 | No |
| Buscar en Tipos de novedades | G. Tipos de novedades | `/configuracion/tipos-novedades` | 13ms | 418ms | 0 | 0 | No |
| Filtrar Tipos de novedades por Finnegans | G. Tipos de novedades | `/configuracion/tipos-novedades` | 15ms | 99ms | 0 | 0 | No |
| Entrar a Conceptos horarios | H. Conceptos horarios | `/configuracion/conceptos-horarios` | 77ms | 1414ms | 2 | 0 | No |
| Buscar en Conceptos horarios | H. Conceptos horarios | `/configuracion/conceptos-horarios` | 8ms | 411ms | 0 | 0 | No |
| Filtrar Conceptos horarios por Tipo | H. Conceptos horarios | `/configuracion/conceptos-horarios` | 12ms | 95ms | 0 | 0 | No |
| Entrar a Categorías documentales | J. Categorías documentales | `/configuracion/categorias-documentales` | 76ms | 1002ms | 2 | 0 | No |
| Buscar en Categorías documentales | J. Categorías documentales | `/configuracion/categorias-documentales` | 11ms | 415ms | 0 | 0 | No |
| Filtrar Categorías documentales por Tipo | J. Categorías documentales | `/configuracion/categorias-documentales` | 11ms | 95ms | 0 | 0 | No |
| Entrar a Parámetros de auditoría | K. Parámetros de auditoría | `/configuracion/parametros-auditoria` | 77ms | 1778ms | 2 | 0 | No |
| Buscar en Parámetros de auditoría | K. Parámetros de auditoría | `/configuracion/parametros-auditoria` | 13ms | 417ms | 0 | 0 | No |
| Filtrar Parámetros de auditoría por Módulo | K. Parámetros de auditoría | `/configuracion/parametros-auditoria` | 13ms | 97ms | 0 | 0 | No |
| Entrar a Puestos | L. Puestos (listado) | `/puestos` | 75ms | 1464ms | 3 | 0 | No |
| Buscar en Puestos | L. Puestos (listado) | `/puestos` | 14ms | 420ms | 0 | 0 | No |
| Filtrar Puestos por Sector | L. Puestos (listado) | `/puestos` | 17ms | 101ms | 0 | 0 | No |
| Limpiar filtros en Puestos | L. Puestos (listado) | `/puestos` | 31ms | 115ms | 0 | 0 | No |
| Ver detalle de puesto | M. Puesto (detalle) | `/puestos/:id` | 819ms | 1498ms | 3 | 0 | No |
| Cambiar de pestaña en detalle de Puesto | M. Puesto (detalle) | `/puestos/:id` | 32ms | 235ms | 0 | 0 | No |
| Entrar a Crear puesto (sólo navegación, sin guardar) | N. Puesto (creación, sólo navegación) | `/puestos/nuevo` | 78ms | 1263ms | 3 | 0 | No |
| Salir de Crear puesto sin guardar | N. Puesto (creación, sólo navegación) | `/puestos` | 62ms | 145ms | 1 | 0 | No |

## 5. Tabla por submódulo

Relevada leyendo el código real (App.tsx, navigation.tsx, cada página y sus servicios API) antes de escribir el journey — ver Matriz 1 (Inventario de submódulos) en `docs/decisions/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md`.

| Submódulo | Ruta real | Página | Cache frontend | Cache backend | Escribe datos | Medible seguro |
|---|---|---|---|---|---|---|
| A. Configuración (landing) | /configuracion | SettingsPage.tsx | N/A | N/A | No | Sí |
| B. Turnos | /configuracion/turnos | ShiftsPage.tsx | No — ambos con apiCache:false, sin wrapper cachedData/cachePolicies (único gap real de cache cliente detectado en esta etapa) | Sí — workforce.cache.ts (shiftTemplatesCache, 30s) para shift-templates; assignments/summary sin cache backend dedicado | Sí (crear turno, activar/inactivar) — no ejecutado esta etapa | Sí |
| C. Asignaciones de feriados | /configuracion/turnos-asignaciones-feriados | HolidayWorkAssignmentsPage.tsx | Sólo /org-structure (familia org-structure); dates/assignments/candidates/shift-templates sin cache | No (módulo shifts no tiene cache dedicado para holiday-work) | Sí (Guardar cambios de convocatoria) — no ejecutado esta etapa | Sí |
| D. Horas especiales | /configuracion/turnos-horas-especiales | WorkScheduleSettingsPage.tsx | org-structure y positions cacheados; double-hour-rules y su calendario NO (mismo gap que Turnos) | Sí — workforce.cache.ts (doubleRulesCache, 30s) | Sí (crear/editar regla vía formulario inline, activar/inactivar, eliminar) — no ejecutado esta etapa | Sí |
| E. Regímenes laborales | /configuracion/regimenes-laborales | WorkRegimesPage.tsx | Sí — familia work-regimes (workRegimesCatalog, 10min); empleados asociados por régimen sin cache | No | Sí (crear/editar régimen, activar/inactivar, agregar empleado, finalizar asignación) — no ejecutado esta etapa | Sí |
| F. Empresas y estructura | /configuracion/empresas-estructura | OrgStructurePage.tsx | Sí — familia org-structure (orgStructureCatalog, 10min, persistido) | No | Sí (crear/editar Empresa/UN/Establecimiento/Área/Sector/Centro de costo vía editor inline 'Guardar estructura') — no ejecutado esta etapa | Sí |
| G. Tipos de novedades | /configuracion/tipos-novedades | NoveltyTypesPage.tsx | Sí — familia novelty-types (noveltyTypesCatalog, 10min, persistido) | No | Sí (crear, activar/inactivar) — no ejecutado esta etapa | Sí |
| H. Conceptos horarios | /configuracion/conceptos-horarios | HourConceptsPage.tsx | Sí — familia hour-concepts (hourConceptsCatalog, 10min, persistido) | No | Sí (crear/editar concepto, reglas asociadas, empleados asociados, deshabilitar/eliminar) — no ejecutado esta etapa | Sí |
| I. Exportación Finnegans | /configuracion/liquidacion | FinnegansExportPage.tsx | No | No | No (endpoint de sólo lectura, el .xlsx se arma 100% client-side) | Sí, pero fuera del alcance de esta corrida |
| J. Categorías documentales | /configuracion/categorias-documentales | DocumentCategoriesPage.tsx | Sí — familia document-categories (documentCategoriesCatalog, 10min, persistido) | No | Sí (crear/editar categoría vía editor inline 'Guardar categoria') — no ejecutado esta etapa | Sí |
| K. Parámetros de auditoría | /configuracion/parametros-auditoria | AuditParametersPage.tsx | Sí — familia audit-parameters (auditParametersCatalog, 10min, persistido) | No | Sí (crear/editar parámetro vía editor inline 'Guardar parametro') — no ejecutado esta etapa | Sí |
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
- **Nuevo registro / Editar / Guardar estructura** (F. Empresas y estructura, escritura): El editor es inline y no tiene botón de cancelar limpio (sólo se cierra cambiando de pestaña) — no se abre esta etapa, ni se llega al submit real (POST/PATCH /org-structure/...)..
- **Crear tipo de novedad** (G. Tipos de novedades, escritura): Prohibido por defecto — navegación a un formulario de alta (POST /novelty-types), no se hace click..
- **Ver detalle de tipo de novedad** (G. Tipos de novedades, lectura): Navegación de detalle fuera del alcance macro de esta etapa (no es escritura) — candidato de profundización en una etapa futura si el volumen lo justifica..
- **Activar/Inactivar tipo de novedad** (G. Tipos de novedades, escritura): Prohibido por defecto — acción de escritura (PATCH /novelty-types/:id)..
- **Crear/Editar concepto horario** (H. Conceptos horarios, escritura): El editor (con panel de reglas y empleados asociados embebidos) es inline de escritura (no el componente Modal compartido) — misma política de alcance que Horas especiales; el submit real es POST/PATCH /hour-concepts[/:id]..
- **Deshabilitar/Eliminar concepto horario** (H. Conceptos horarios, escritura): Prohibido por defecto — acciones de escritura (PATCH /hour-concepts/:id/status, DELETE /hour-concepts/:id)..
- **Entrar a Exportación Finnegans** (I. Exportación Finnegans, lectura): Ya cubierto en detalle por el journey de Gestión Horaria (Etapa 14G.1, zona 'J. Exportación', 4 acciones incl. cambio de período y búsqueda) — no se remide para no duplicar esfuerzo. Ver docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md. Ruta real confirmada: /configuracion/liquidacion → FinnegansExportPage.tsx..
- **Crear/Editar categoría documental** (J. Categorías documentales, escritura): Editor inline — misma política de alcance que el resto de los editores inline de Configuración (aunque este sí tiene un botón 'Cerrar' limpio, se excluye por consistencia); el submit real es POST/PATCH /document-categories[/:id]..
- **Crear/Editar parámetro de auditoría** (K. Parámetros de auditoría, escritura): Editor inline — misma política de alcance; el submit real es POST/PATCH /audit-parameters[/:id]..
- **Paginar Puestos** (L. Puestos (listado), lectura): no hay una segunda página de puestos en el entorno actual (botón 'Siguiente' ausente o deshabilitado).
- **Crear puesto** (L. Puestos (listado), escritura): Prohibido por defecto — es la puerta de entrada a un alta real (POST /positions), no se hace click..
- **Inactivar/Activar/Eliminar puesto** (L. Puestos (listado), escritura): Prohibido por defecto — acciones de escritura (PATCH /positions/:id, DELETE /positions/:id)..
- **Guardar cambios en Puesto** (M. Puesto (detalle), escritura): Prohibido por defecto — acción de escritura (PATCH /positions/:id)..
- **Inactivar/Eliminar puesto (detalle)** (M. Puesto (detalle), escritura): Prohibido por defecto — acciones de escritura (PATCH /positions/:id, DELETE /positions/:id)..
- **Guardar puesto** (N. Puesto (creación, sólo navegación), escritura): Prohibido por defecto — crearía un puesto real (POST /positions). Nunca se usa .fill() en ningún campo del formulario, ni siquiera momentáneamente..

## 7. Top acciones lentas

| Acción | Submódulo | Visible | Network idle | Rango |
|---|---|---|---|---|
| Login (acceso rápido RRHH) | Login | 563ms | 6207ms | Crítico |
| Entrar a Asignaciones de feriados | C. Asignaciones de feriados | 77ms | 2267ms | Lento |
| Entrar a Horas especiales | D. Horas especiales | 113ms | 1832ms | Medio |
| Entrar a Parámetros de auditoría | K. Parámetros de auditoría | 77ms | 1778ms | Medio |
| Seleccionar fecha de feriado | C. Asignaciones de feriados | 1331ms | 1735ms | Medio |
| Entrar a Turnos | B. Turnos | 71ms | 1697ms | Medio |
| Ver detalle de puesto | M. Puesto (detalle) | 819ms | 1498ms | Medio |
| Entrar a Puestos | L. Puestos (listado) | 75ms | 1464ms | Medio |
| Entrar a Conceptos horarios | H. Conceptos horarios | 77ms | 1414ms | Medio |
| Filtrar vigencia de empleados asociados | E. Regímenes laborales | 1292ms | 1376ms | Medio |

## 8. Top requests lentas

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/dashboard/metrics` | 200 | 4121ms |
| GET | `/api/audit` | 200 | 2001ms |
| GET | `/api/org-structure` | 200 | 1681ms |
| GET | `/api/shifts/holiday-work/candidates` | 200 | 1255ms |
| GET | `/api/positions` | 200 | 1252ms |
| POST | `/api/auth/login` | 200 | 1215ms |
| GET | `/api/audit-parameters` | 200 | 1206ms |
| GET | `/api/shifts/assignments/summary` | 200 | 1134ms |
| GET | `/api/work-regimes/:id/employees` | 200 | 935ms |
| GET | `/api/work-regimes/:id/employees` | 200 | 911ms |

## 9. Endpoints repetidos

Mismo endpoint (método+path) pedido más de una vez a lo largo de TODO el recorrido, sin importar desde qué submódulo — detecta catálogos/endpoints compartidos entre submódulos (org-structure, positions, etc.).

| Endpoint | Llamadas totales |
|---|---|
| `GET /api/workforce/notifications-unread-count` | 15 |
| `GET /api/workforce/shift-templates` | 6 |
| `GET /api/positions` | 5 |
| `GET /api/shifts/assignments/summary` | 2 |
| `GET /api/shifts/holiday-work/dates` | 2 |
| `GET /api/workforce/double-hour-rules` | 2 |
| `GET /api/workforce/double-hour-rules/calendar` | 2 |
| `GET /api/work-regimes/:id/employees` | 2 |

## 10. Duplicados por acción

Mismo endpoint pedido más de una vez DENTRO de la ventana de una sola acción — señal de StrictMode (double-invoke en dev), remount de AppShell entre navegaciones completas, o un refetch inesperado.

- **Entrar a Turnos** (B. Turnos): `GET /api/shifts/assignments/summary` x2, `GET /api/workforce/shift-templates` x2
- **Ver detalle de turno** (B. Turnos): `GET /api/workforce/shift-templates` x2
- **Entrar a Asignaciones de feriados** (C. Asignaciones de feriados): `GET /api/workforce/shift-templates` x2, `GET /api/shifts/holiday-work/dates` x2
- **Entrar a Horas especiales** (D. Horas especiales): `GET /api/workforce/double-hour-rules` x2, `GET /api/workforce/double-hour-rules/calendar` x2
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

Cero acciones de escritura ejecutadas en todo el recorrido (modo `read-only`). 18 acción(es) de escritura identificadas y explícitamente NO ejecutadas:

- **Crear turno** (B. Turnos): Prohibido por defecto — es la puerta de entrada a un alta real (POST /workforce/shift-templates), no se hace click.
- **Inactivar/Activar turno** (B. Turnos): Prohibido por defecto — acción de escritura (PATCH /workforce/shift-templates/:id).
- **Guardar cambios (convocatoria de feriado)** (C. Asignaciones de feriados): Prohibido por defecto — asignaría feriados reales a empleados reales (PUT /shifts/holiday-work/assignments).
- **Activar/Inactivar/Eliminar regla** (D. Horas especiales): Prohibido por defecto — acciones de escritura (PATCH/DELETE /workforce/double-hour-rules/:id).
- **Agregar empleados / Finalizar asignación** (E. Regímenes laborales): Prohibido por defecto — acciones de escritura (POST /employees/:employeeId/work-regimes, PATCH .../:assignmentId/close).
- **Editar régimen / Activar-Inactivar régimen** (E. Regímenes laborales): Prohibido por defecto — acciones de escritura (POST/PATCH /work-regimes[/:id][/status]).
- **Nuevo registro / Editar / Guardar estructura** (F. Empresas y estructura): El editor es inline y no tiene botón de cancelar limpio (sólo se cierra cambiando de pestaña) — no se abre esta etapa, ni se llega al submit real (POST/PATCH /org-structure/...).
- **Crear tipo de novedad** (G. Tipos de novedades): Prohibido por defecto — navegación a un formulario de alta (POST /novelty-types), no se hace click.
- **Activar/Inactivar tipo de novedad** (G. Tipos de novedades): Prohibido por defecto — acción de escritura (PATCH /novelty-types/:id).
- **Crear/Editar concepto horario** (H. Conceptos horarios): El editor (con panel de reglas y empleados asociados embebidos) es inline de escritura (no el componente Modal compartido) — misma política de alcance que Horas especiales; el submit real es POST/PATCH /hour-concepts[/:id].
- **Deshabilitar/Eliminar concepto horario** (H. Conceptos horarios): Prohibido por defecto — acciones de escritura (PATCH /hour-concepts/:id/status, DELETE /hour-concepts/:id).
- **Crear/Editar categoría documental** (J. Categorías documentales): Editor inline — misma política de alcance que el resto de los editores inline de Configuración (aunque este sí tiene un botón 'Cerrar' limpio, se excluye por consistencia); el submit real es POST/PATCH /document-categories[/:id].
- **Crear/Editar parámetro de auditoría** (K. Parámetros de auditoría): Editor inline — misma política de alcance; el submit real es POST/PATCH /audit-parameters[/:id].
- **Crear puesto** (L. Puestos (listado)): Prohibido por defecto — es la puerta de entrada a un alta real (POST /positions), no se hace click.
- **Inactivar/Activar/Eliminar puesto** (L. Puestos (listado)): Prohibido por defecto — acciones de escritura (PATCH /positions/:id, DELETE /positions/:id).
- **Guardar cambios en Puesto** (M. Puesto (detalle)): Prohibido por defecto — acción de escritura (PATCH /positions/:id).
- **Inactivar/Eliminar puesto (detalle)** (M. Puesto (detalle)): Prohibido por defecto — acciones de escritura (PATCH /positions/:id, DELETE /positions/:id).
- **Guardar puesto** (N. Puesto (creación, sólo navegación)): Prohibido por defecto — crearía un puesto real (POST /positions). Nunca se usa .fill() en ningún campo del formulario, ni siquiera momentáneamente.

Política de esta etapa sobre editores inline: 5 submódulos (Horas especiales, Empresas y estructura, Tipos de novedades vía detalle, Conceptos horarios, Categorías documentales, Parámetros de auditoría) exponen su formulario de alta/edición como un `<Section>` inline en la propia página, no como el componente `Modal` compartido — esta etapa sólo abre y cierra modales del componente `Modal` compartido (Regímenes laborales) para mantener una única política simple de riesgo en todo el journey, documentado como decisión de alcance, no como limitación técnica (algunos de esos editores sí tienen un botón de cancelar limpio, confirmado en el relevamiento).

## 15. Recomendación de orden para 14H.2+

Ningún submódulo mostró endpoints en rango Crítico/Lento en esta corrida puntual — no hay evidencia suficiente para priorizar. Repetir la corrida antes de decidir 14H.2.

Contexto estructural relevante para esta priorización (relevado en el diagnóstico, no medido por endpoints individuales):
- Turnos y Horas especiales son las únicas 2 tarjetas sin ningún cache frontend (`apiCache:false` directo, sin `cachedData`/`cachePolicies`) — cada visita es un round-trip real garantizado, a diferencia de las 7 tarjetas restantes que sí cachean su catálogo principal 10min.
- Conceptos horarios es el submódulo con más profundidad potencial (reglas + empleados asociados anidados al editar un concepto existente) — ningún journey lo ejercitó más allá del listado en esta etapa.
- Puestos (detalle) es el único submódulo de este journey con 2 GETs secuenciales dependientes (`getById` → `getAssignedEmployees`), mismo patrón de carga compuesta ya optimizado para Legajos en 14D — candidato a evaluar si el volumen de asignaciones por puesto crece.
- Exportación Finnegans queda deliberadamente fuera de esta corrida — ya medido por 14G.1, ver `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md`.

## 16. Raw sanitized JSON

Idéntico al archivo `docs/performance/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.json` generado en esta misma corrida.

```json
{
  "generatedAt": "2026-09-08T14:51:11.124Z",
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
    "totalActions": 63,
    "coveredActions": 41,
    "skippedActions": 22,
    "slowActions": 1,
    "verySlowActions": 1,
    "writesSkipped": 18,
    "httpErrors": 0,
    "consoleErrors": 0
  },
  "submoduleRollup": [
    {
      "zone": "Login",
      "coveredActions": 1,
      "skippedActions": 0,
      "totalRequests": 4,
      "maxDurationMs": 6207,
      "rank": "Crítico"
    },
    {
      "zone": "A. Configuración (landing)",
      "coveredActions": 2,
      "skippedActions": 0,
      "totalRequests": 1,
      "maxDurationMs": 1005,
      "rank": "Medio"
    },
    {
      "zone": "B. Turnos",
      "coveredActions": 4,
      "skippedActions": 2,
      "totalRequests": 8,
      "maxDurationMs": 1697,
      "rank": "Medio"
    },
    {
      "zone": "C. Asignaciones de feriados",
      "coveredActions": 2,
      "skippedActions": 1,
      "totalRequests": 8,
      "maxDurationMs": 2267,
      "rank": "Lento"
    },
    {
      "zone": "D. Horas especiales",
      "coveredActions": 2,
      "skippedActions": 2,
      "totalRequests": 6,
      "maxDurationMs": 1832,
      "rank": "Medio"
    },
    {
      "zone": "E. Regímenes laborales",
      "coveredActions": 8,
      "skippedActions": 2,
      "totalRequests": 4,
      "maxDurationMs": 1376,
      "rank": "Medio"
    },
    {
      "zone": "F. Empresas y estructura",
      "coveredActions": 2,
      "skippedActions": 1,
      "totalRequests": 1,
      "maxDurationMs": 812,
      "rank": "OK"
    },
    {
      "zone": "G. Tipos de novedades",
      "coveredActions": 3,
      "skippedActions": 3,
      "totalRequests": 2,
      "maxDurationMs": 914,
      "rank": "OK"
    },
    {
      "zone": "H. Conceptos horarios",
      "coveredActions": 3,
      "skippedActions": 2,
      "totalRequests": 2,
      "maxDurationMs": 1414,
      "rank": "Medio"
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
      "coveredActions": 3,
      "skippedActions": 1,
      "totalRequests": 2,
      "maxDurationMs": 1002,
      "rank": "Medio"
    },
    {
      "zone": "K. Parámetros de auditoría",
      "coveredActions": 3,
      "skippedActions": 1,
      "totalRequests": 2,
      "maxDurationMs": 1778,
      "rank": "Medio"
    },
    {
      "zone": "L. Puestos (listado)",
      "coveredActions": 4,
      "skippedActions": 3,
      "totalRequests": 3,
      "maxDurationMs": 1464,
      "rank": "Medio"
    },
    {
      "zone": "M. Puesto (detalle)",
      "coveredActions": 2,
      "skippedActions": 2,
      "totalRequests": 3,
      "maxDurationMs": 1498,
      "rank": "Medio"
    },
    {
      "zone": "N. Puesto (creación, sólo navegación)",
      "coveredActions": 2,
      "skippedActions": 1,
      "totalRequests": 4,
      "maxDurationMs": 1263,
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
      "visibleMs": 563,
      "networkIdleMs": 6207,
      "requests": [
        {
          "method": "POST",
          "path": "/api/auth/login",
          "statusCode": 200,
          "durationMs": 1215
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 383
        },
        {
          "method": "GET",
          "path": "/api/audit",
          "statusCode": 200,
          "durationMs": 2001
        },
        {
          "method": "GET",
          "path": "/api/dashboard/metrics",
          "statusCode": 200,
          "durationMs": 4121
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
      "visibleMs": 87,
      "networkIdleMs": 1005,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 441
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
      "visibleMs": 8,
      "networkIdleMs": 93,
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
      "visibleMs": 71,
      "networkIdleMs": 1697,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 182
        },
        {
          "method": "GET",
          "path": "/api/shifts/assignments/summary",
          "statusCode": 200,
          "durationMs": 391
        },
        {
          "method": "GET",
          "path": "/api/workforce/shift-templates",
          "statusCode": 200,
          "durationMs": 394
        },
        {
          "method": "GET",
          "path": "/api/workforce/shift-templates",
          "statusCode": 200,
          "durationMs": 579
        },
        {
          "method": "GET",
          "path": "/api/shifts/assignments/summary",
          "statusCode": 200,
          "durationMs": 1134
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
      "visibleMs": 18,
      "networkIdleMs": 423,
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
      "visibleMs": 17,
      "networkIdleMs": 101,
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
      "visibleMs": 73,
      "networkIdleMs": 1003,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/shift-templates",
          "statusCode": 200,
          "durationMs": 1
        },
        {
          "method": "GET",
          "path": "/api/workforce/shift-templates",
          "statusCode": 200,
          "durationMs": 1
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 453
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
      "visibleMs": 77,
      "networkIdleMs": 2267,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/shift-templates",
          "statusCode": 200,
          "durationMs": 1
        },
        {
          "method": "GET",
          "path": "/api/workforce/shift-templates",
          "statusCode": 200,
          "durationMs": 3
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 190
        },
        {
          "method": "GET",
          "path": "/api/shifts/holiday-work/dates",
          "statusCode": 200,
          "durationMs": 376
        },
        {
          "method": "GET",
          "path": "/api/shifts/holiday-work/dates",
          "statusCode": 200,
          "durationMs": 547
        },
        {
          "method": "GET",
          "path": "/api/org-structure",
          "statusCode": 200,
          "durationMs": 1681
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
      "visibleMs": 1331,
      "networkIdleMs": 1735,
      "requests": [
        {
          "method": "GET",
          "path": "/api/shifts/holiday-work/assignments",
          "statusCode": 200,
          "durationMs": 685
        },
        {
          "method": "GET",
          "path": "/api/shifts/holiday-work/candidates",
          "statusCode": 200,
          "durationMs": 1255
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
      "visibleMs": 113,
      "networkIdleMs": 1832,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 369
        },
        {
          "method": "GET",
          "path": "/api/workforce/double-hour-rules",
          "statusCode": 200,
          "durationMs": 351
        },
        {
          "method": "GET",
          "path": "/api/workforce/double-hour-rules",
          "statusCode": 200,
          "durationMs": 352
        },
        {
          "method": "GET",
          "path": "/api/workforce/double-hour-rules/calendar",
          "statusCode": 200,
          "durationMs": 383
        },
        {
          "method": "GET",
          "path": "/api/workforce/double-hour-rules/calendar",
          "statusCode": 200,
          "durationMs": 564
        },
        {
          "method": "GET",
          "path": "/api/positions",
          "statusCode": 200,
          "durationMs": 1252
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
      "visibleMs": 12,
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
      "visibleMs": 131,
      "networkIdleMs": 1148,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 190
        },
        {
          "method": "GET",
          "path": "/api/work-regimes",
          "statusCode": 200,
          "durationMs": 537
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
      "visibleMs": 9,
      "networkIdleMs": 413,
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
      "visibleMs": 11,
      "networkIdleMs": 94,
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
      "visibleMs": 19,
      "networkIdleMs": 101,
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
      "visibleMs": 27,
      "networkIdleMs": 109,
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
      "visibleMs": 41,
      "networkIdleMs": 124,
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
      "visibleMs": 1292,
      "networkIdleMs": 1376,
      "requests": [
        {
          "method": "GET",
          "path": "/api/work-regimes/:id/employees",
          "statusCode": 200,
          "durationMs": 911
        },
        {
          "method": "GET",
          "path": "/api/work-regimes/:id/employees",
          "statusCode": 200,
          "durationMs": 935
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
      "visibleMs": 41,
      "networkIdleMs": 124,
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
      "visibleMs": 124,
      "networkIdleMs": 812,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 265
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
      "visibleMs": 47,
      "networkIdleMs": 250,
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
      "skippedReason": "El editor es inline y no tiene botón de cancelar limpio (sólo se cierra cambiando de pestaña) — no se abre esta etapa, ni se llega al submit real (POST/PATCH /org-structure/...).",
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
      "visibleMs": 74,
      "networkIdleMs": 914,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 189
        },
        {
          "method": "GET",
          "path": "/api/novelty-types",
          "statusCode": 200,
          "durationMs": 353
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
      "visibleMs": 13,
      "networkIdleMs": 418,
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
      "visibleMs": 15,
      "networkIdleMs": 99,
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
      "visibleMs": 77,
      "networkIdleMs": 1414,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 682
        },
        {
          "method": "GET",
          "path": "/api/hour-concepts",
          "statusCode": 200,
          "durationMs": 835
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
      "visibleMs": 8,
      "networkIdleMs": 411,
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
      "visibleMs": 12,
      "networkIdleMs": 95,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Crear/Editar concepto horario",
      "zone": "H. Conceptos horarios",
      "submodule": "H. Conceptos horarios",
      "route": "/configuracion/conceptos-horarios",
      "covered": false,
      "skippedReason": "El editor (con panel de reglas y empleados asociados embebidos) es inline de escritura (no el componente Modal compartido) — misma política de alcance que Horas especiales; el submit real es POST/PATCH /hour-concepts[/:id].",
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
      "visibleMs": 76,
      "networkIdleMs": 1002,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 181
        },
        {
          "method": "GET",
          "path": "/api/document-categories",
          "statusCode": 200,
          "durationMs": 431
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
      "visibleMs": 11,
      "networkIdleMs": 415,
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
      "visibleMs": 11,
      "networkIdleMs": 95,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Crear/Editar categoría documental",
      "zone": "J. Categorías documentales",
      "submodule": "J. Categorías documentales",
      "route": "/configuracion/categorias-documentales",
      "covered": false,
      "skippedReason": "Editor inline — misma política de alcance que el resto de los editores inline de Configuración (aunque este sí tiene un botón 'Cerrar' limpio, se excluye por consistencia); el submit real es POST/PATCH /document-categories[/:id].",
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
      "visibleMs": 77,
      "networkIdleMs": 1778,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 172
        },
        {
          "method": "GET",
          "path": "/api/audit-parameters",
          "statusCode": 200,
          "durationMs": 1206
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
      "visibleMs": 13,
      "networkIdleMs": 417,
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
      "visibleMs": 13,
      "networkIdleMs": 97,
      "requests": [],
      "consoleErrors": [],
      "notes": [],
      "isWrite": false,
      "emptyScreen": null
    },
    {
      "name": "Crear/Editar parámetro de auditoría",
      "zone": "K. Parámetros de auditoría",
      "submodule": "K. Parámetros de auditoría",
      "route": "/configuracion/parametros-auditoria",
      "covered": false,
      "skippedReason": "Editor inline — misma política de alcance; el submit real es POST/PATCH /audit-parameters[/:id].",
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
      "visibleMs": 75,
      "networkIdleMs": 1464,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 380
        },
        {
          "method": "GET",
          "path": "/api/positions",
          "statusCode": 200,
          "durationMs": 889
        },
        {
          "method": "GET",
          "path": "/api/positions",
          "statusCode": 200,
          "durationMs": 896
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
      "visibleMs": 14,
      "networkIdleMs": 420,
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
      "visibleMs": 17,
      "networkIdleMs": 101,
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
      "visibleMs": 31,
      "networkIdleMs": 115,
      "requests": [],
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
      "visibleMs": 819,
      "networkIdleMs": 1498,
      "requests": [
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 186
        },
        {
          "method": "GET",
          "path": "/api/positions/:id",
          "statusCode": 200,
          "durationMs": 380
        },
        {
          "method": "GET",
          "path": "/api/positions/:id/employees",
          "statusCode": 200,
          "durationMs": 552
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
      "visibleMs": 32,
      "networkIdleMs": 235,
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
      "visibleMs": 78,
      "networkIdleMs": 1263,
      "requests": [
        {
          "method": "GET",
          "path": "/api/positions",
          "statusCode": 200,
          "durationMs": 201
        },
        {
          "method": "GET",
          "path": "/api/workforce/notifications-unread-count",
          "statusCode": 200,
          "durationMs": 359
        },
        {
          "method": "GET",
          "path": "/api/salary-categories",
          "statusCode": 200,
          "durationMs": 691
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
      "visibleMs": 62,
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
      "path": "/api/dashboard/metrics",
      "statusCode": 200,
      "durationMs": 4121
    },
    {
      "method": "GET",
      "path": "/api/audit",
      "statusCode": 200,
      "durationMs": 2001
    },
    {
      "method": "GET",
      "path": "/api/org-structure",
      "statusCode": 200,
      "durationMs": 1681
    },
    {
      "method": "GET",
      "path": "/api/shifts/holiday-work/candidates",
      "statusCode": 200,
      "durationMs": 1255
    },
    {
      "method": "GET",
      "path": "/api/positions",
      "statusCode": 200,
      "durationMs": 1252
    },
    {
      "method": "POST",
      "path": "/api/auth/login",
      "statusCode": 200,
      "durationMs": 1215
    },
    {
      "method": "GET",
      "path": "/api/audit-parameters",
      "statusCode": 200,
      "durationMs": 1206
    },
    {
      "method": "GET",
      "path": "/api/shifts/assignments/summary",
      "statusCode": 200,
      "durationMs": 1134
    },
    {
      "method": "GET",
      "path": "/api/work-regimes/:id/employees",
      "statusCode": 200,
      "durationMs": 935
    },
    {
      "method": "GET",
      "path": "/api/work-regimes/:id/employees",
      "statusCode": 200,
      "durationMs": 911
    }
  ],
  "slowestActions": [
    {
      "name": "Login (acceso rápido RRHH)",
      "zone": "Login",
      "visibleMs": 563,
      "networkIdleMs": 6207
    },
    {
      "name": "Entrar a Asignaciones de feriados",
      "zone": "C. Asignaciones de feriados",
      "visibleMs": 77,
      "networkIdleMs": 2267
    },
    {
      "name": "Entrar a Horas especiales",
      "zone": "D. Horas especiales",
      "visibleMs": 113,
      "networkIdleMs": 1832
    },
    {
      "name": "Entrar a Parámetros de auditoría",
      "zone": "K. Parámetros de auditoría",
      "visibleMs": 77,
      "networkIdleMs": 1778
    },
    {
      "name": "Seleccionar fecha de feriado",
      "zone": "C. Asignaciones de feriados",
      "visibleMs": 1331,
      "networkIdleMs": 1735
    },
    {
      "name": "Entrar a Turnos",
      "zone": "B. Turnos",
      "visibleMs": 71,
      "networkIdleMs": 1697
    },
    {
      "name": "Ver detalle de puesto",
      "zone": "M. Puesto (detalle)",
      "visibleMs": 819,
      "networkIdleMs": 1498
    },
    {
      "name": "Entrar a Puestos",
      "zone": "L. Puestos (listado)",
      "visibleMs": 75,
      "networkIdleMs": 1464
    },
    {
      "name": "Entrar a Conceptos horarios",
      "zone": "H. Conceptos horarios",
      "visibleMs": 77,
      "networkIdleMs": 1414
    },
    {
      "name": "Filtrar vigencia de empleados asociados",
      "zone": "E. Regímenes laborales",
      "visibleMs": 1292,
      "networkIdleMs": 1376
    }
  ],
  "repeatedEndpoints": [
    {
      "key": "GET /api/workforce/notifications-unread-count",
      "method": "GET",
      "path": "/api/workforce/notifications-unread-count",
      "count": 15,
      "avgDurationMs": 308,
      "maxDurationMs": 682,
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
      "key": "GET /api/shifts/assignments/summary",
      "method": "GET",
      "path": "/api/shifts/assignments/summary",
      "count": 2,
      "avgDurationMs": 763,
      "maxDurationMs": 1134,
      "statusCodes": [
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
      "count": 6,
      "avgDurationMs": 163,
      "maxDurationMs": 579,
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
      "key": "GET /api/shifts/holiday-work/dates",
      "method": "GET",
      "path": "/api/shifts/holiday-work/dates",
      "count": 2,
      "avgDurationMs": 462,
      "maxDurationMs": 547,
      "statusCodes": [
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/workforce/double-hour-rules",
      "method": "GET",
      "path": "/api/workforce/double-hour-rules",
      "count": 2,
      "avgDurationMs": 352,
      "maxDurationMs": 352,
      "statusCodes": [
        200,
        200
      ],
      "hasErrorStatus": false,
      "hasServerErrorStatus": false
    },
    {
      "key": "GET /api/workforce/double-hour-rules/calendar",
      "method": "GET",
      "path": "/api/workforce/double-hour-rules/calendar",
      "count": 2,
      "avgDurationMs": 474,
      "maxDurationMs": 564,
      "statusCodes": [
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
      "count": 5,
      "avgDurationMs": 648,
      "maxDurationMs": 1252,
      "statusCodes": [
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
      "avgDurationMs": 923,
      "maxDurationMs": 935,
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
      "name": "Entrar a Turnos",
      "zone": "B. Turnos",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/shifts/assignments/summary",
          "count": 2,
          "durationsMs": [
            391,
            1134
          ]
        },
        {
          "method": "GET",
          "path": "/api/workforce/shift-templates",
          "count": 2,
          "durationsMs": [
            394,
            579
          ]
        }
      ]
    },
    {
      "name": "Ver detalle de turno",
      "zone": "B. Turnos",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/workforce/shift-templates",
          "count": 2,
          "durationsMs": [
            1,
            1
          ]
        }
      ]
    },
    {
      "name": "Entrar a Asignaciones de feriados",
      "zone": "C. Asignaciones de feriados",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/workforce/shift-templates",
          "count": 2,
          "durationsMs": [
            1,
            3
          ]
        },
        {
          "method": "GET",
          "path": "/api/shifts/holiday-work/dates",
          "count": 2,
          "durationsMs": [
            376,
            547
          ]
        }
      ]
    },
    {
      "name": "Entrar a Horas especiales",
      "zone": "D. Horas especiales",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/workforce/double-hour-rules",
          "count": 2,
          "durationsMs": [
            351,
            352
          ]
        },
        {
          "method": "GET",
          "path": "/api/workforce/double-hour-rules/calendar",
          "count": 2,
          "durationsMs": [
            383,
            564
          ]
        }
      ]
    },
    {
      "name": "Filtrar vigencia de empleados asociados",
      "zone": "E. Regímenes laborales",
      "duplicates": [
        {
          "method": "GET",
          "path": "/api/work-regimes/:id/employees",
          "count": 2,
          "durationsMs": [
            911,
            935
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
            889,
            896
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
      "reason": "El editor es inline y no tiene botón de cancelar limpio (sólo se cierra cambiando de pestaña) — no se abre esta etapa, ni se llega al submit real (POST/PATCH /org-structure/...)."
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
      "name": "Crear/Editar concepto horario",
      "zone": "H. Conceptos horarios",
      "isWrite": true,
      "reason": "El editor (con panel de reglas y empleados asociados embebidos) es inline de escritura (no el componente Modal compartido) — misma política de alcance que Horas especiales; el submit real es POST/PATCH /hour-concepts[/:id]."
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
      "name": "Crear/Editar categoría documental",
      "zone": "J. Categorías documentales",
      "isWrite": true,
      "reason": "Editor inline — misma política de alcance que el resto de los editores inline de Configuración (aunque este sí tiene un botón 'Cerrar' limpio, se excluye por consistencia); el submit real es POST/PATCH /document-categories[/:id]."
    },
    {
      "name": "Crear/Editar parámetro de auditoría",
      "zone": "K. Parámetros de auditoría",
      "isWrite": true,
      "reason": "Editor inline — misma política de alcance; el submit real es POST/PATCH /audit-parameters[/:id]."
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
