# Etapa 15K — Panel de revisión visual previo al cierre de horas

## 1. Problema previo

La auditoría read-only del módulo Cierre de Horas (previa a esta etapa)
confirmó que `MonthlyClosuresPage.tsx` (`/cierres`), usada por los 3 niveles
(RRHH, Supervisión, Administrativo de Carga Horaria), sólo mostraba
Legajo / Empleado / Estado / Responsable / Observación antes de
enviar/aprobar/devolver un cierre. Nada de horas reales, conceptos
horarios, Horas Especiales, novedades o incidencias — el usuario podía
ejecutar la acción "a ciegas", sin ver en la misma pantalla lo que estaba
cerrando.

## 2. El cierre de backend ya era correcto

`MonthlyTimeClosure` (estados `ABIERTO`/`ENVIADO`/`APROBADO`/`DEVUELTO`/
`CORRECCION_PENDIENTE`), sus guardas de rol (`requireAnyRole`) y sus
endpoints (`GET /workforce/closures`, `POST /workforce/closures/submit`,
`POST /workforce/closures/approve`, `POST /workforce/closures/:id/return`)
no tenían ningún problema funcional. Esta etapa es exclusivamente visual —
no se tocó ninguna regla de negocio, estado o permiso.

## 3. Panel read-only agregado

Se agregó una acción "Revisar horas" por fila en `MonthlyClosuresPage.tsx`
(icono `Eye`, mismo patrón `table-icon-action` ya usado en el resto de la
app — `AttendancePage.tsx`, `NotificationsPage.tsx`, etc.) que abre un
panel de revisión en un modal ancho:

- `frontend/src/components/hours/MonthlyClosureReviewPanel.tsx` —
  contenedor: carga lazy de la grilla del empleado seleccionado, calcula
  los KPIs a partir de esa grilla y muestra loading/error/vacío. No conoce
  reglas de cierre ni ejecuta ninguna acción de `workforceApiService`.
- `frontend/src/components/hours/MonthlyHoursReviewGrid.tsx` — presentacional
  puro: recibe la grilla ya cargada (`EmployeeTimeGrid`) y el período, y la
  renderiza en modo sólo lectura (sin botones, sin `onClick` de edición, sin
  conocer roles).

## 4. Misma información para Nivel 1/2/3

El panel es el mismo componente para los tres niveles — no existen tres
variantes de la grilla. Lo que cambia entre niveles sigue siendo
exactamente lo que ya cambiaba antes de esta etapa: alcance de empleados
(`employeeAccessWhere` en backend, `getOptions`/`closures` en frontend) y
acciones disponibles (ver §5). El contenido del panel (KPIs + grilla) es
idéntico para RRHH, Supervisión y Administrativo de Carga Horaria.

## 5. Acciones diferenciadas por permisos — sin cambios

Se conservaron exactamente las acciones que ya existían:

- Nivel 1 (RRHH): "Aprobar seleccionados" (bulk), "Devolver" (por fila,
  sólo `ENVIADO`), aprobar/rechazar correcciones posteriores.
- Nivel 2/3: "Enviar cierre a RH" (bulk).

El panel de revisión no agrega ninguna acción de cierre propia (ni un
"aprobar este empleado" individual dentro del modal): por preferencia
explícita de esta etapa, ante la posibilidad de introducir complejidad
extra, se priorizó la revisión visual y se dejó la acción individual
equivalente fuera de alcance. El usuario revisa en el panel y ejecuta la
acción (individual o masiva) desde el listado, igual que antes.

## 6. Carga lazy del time-grid

El panel llama `GET /employees/:id/time-grid?period=YYYY-MM` (mismo
endpoint que ya usa `EmployeeHoursPage.tsx`) **una sola vez**, sólo para el
`employeeId` seleccionado, al montarse (`useEffect` con `[closure.employeeId,
period]`). Se pide con `includeDetails: true` — a diferencia de
`EmployeeHoursPage.tsx` (que pide `includeDetails: false` y hace dos
llamadas adicionales, `noveltyApiService.getAll` + `noveltyTypeApiService.getAll`,
porque además necesita el catálogo activo para el formulario de carga), el
panel de revisión no necesita ningún catálogo para edición: pedir
`includeDetails: true` trae `novelties` en la misma respuesta y evita esas
dos llamadas extra. Es la misma cantidad de round-trips (1) con menos
llamadas totales que si se hubiera replicado el patrón de
`EmployeeHoursPage.tsx` tal cual.

## 7. Cero N+1

Abrir el listado de `/cierres` (con cualquier cantidad de filas) no
dispara ningún `GET /employees/:id/time-grid` — ese request sólo ocurre al
hacer clic en "Revisar horas" de una fila puntual, y sólo para ese
`employeeId`. Verificado con tests dedicados (20 filas de cierre → cero
llamadas; abrir un empleado → 1 llamada; cambiar a otro → 1 llamada más,
nunca releer el anterior). No se tocó `employeeTimeGridCache` (backend) ni
se agregó ningún mecanismo de cache nuevo en frontend — la llamada usa el
mismo `employeeApiService.getTimeGrid` sin envoltorio adicional.

## 8. Cero reglas nuevas de bloqueo

El panel es puramente informativo. No se agregó ninguna validación nueva
que bloquee enviar/aprobar/devolver por jornada abierta, novedad
pendiente, alerta o incidencia — esas condiciones, si existen, se
muestran (incidencias del período, novedades del período) pero nunca
impiden la acción. `submit`/`approve`/`return` en
`workforceApiService`/`workforce.service.ts` no se tocaron.

## 9. La grilla existente como fuente de verdad

Ningún cálculo se reimplementó en el frontend. El panel reutiliza:

- `employeeApiService.getTimeGrid` (mismo servicio, mismo contrato).
- `totalWorkedMinutesFromRows`, `additionalBreakdownHours`,
  `hourConceptLoadModeLabel` (`utils/employeeHoursGrid.ts`, sin cambios).
- `formatHours`, `formatMultiplier`, `getMonthDays`, `getWeekdayAbbr`,
  `formatPeriodLabel` (utils/helpers ya existentes, sin cambios).
- Los mismos badges/indicadores visuales que `EmployeeHoursPage.tsx`
  (`alert-dot purple` para novedad, `alert-dot orange` para multiplicador
  de Hora Especial, clases `hour-cell`/`stat-grid`/`table-sub` ya
  existentes).

`EmployeeHoursPage.tsx` **no se modificó** — la etapa explícitamente
prohibía tocar sus ~930 líneas, sus 25 estados o sus flujos de
edición/documentos. La única lógica nueva es un helper local no exportado
de 6 líneas dentro de `MonthlyHoursReviewGrid.tsx`
(`noveltiesForDay`) que replica — sin extraerla a un util compartido, para
no acoplar un módulo compartido a un único consumidor nuevo — el mismo
criterio de asociación día↔novedad que `EmployeeHoursPage.tsx` ya usa
internamente (`dayNovelties`, tampoco exportado ahí).

También se extrajeron (sin cambio de comportamiento) los dos mapas de
texto/color de estado de `MonthlyClosuresPage.tsx` a
`frontend/src/utils/monthlyClosureStatus.ts`, para que el panel use
exactamente el mismo texto/color de badge que la fila del listado sin
duplicar el mapeo ni crear un import circular página↔componente.

## 10. Relación con Conceptos Horarios

El panel respeta el modelo aditivo vigente (`docs/decisions/CONCEPTOS_HORARIOS_ADITIVOS.md`):
"Horas reales trabajadas" es siempre y únicamente el total de la fila
`NORMAL_BASE`; "Conceptos horarios adicionales" es la suma de las filas
`ADDITIONAL`, mostrada aparte. Nunca se suman entre sí para ningún KPI ni
total — mismo criterio que `HoursPage.tsx`/`EmployeeHoursPage.tsx`/export.

## 11. Relación con Horas Especiales

Si `time-grid` ya trae `specialHoursByDay`/`specialHourAdditionalMinutes`/
`specialHourLiquidableTotalMinutes` (multiplicador, feriado/domingo,
conflicto de reglas), el panel los muestra con el mismo criterio visual
que `EmployeeHoursPage.tsx`: punto `alert-dot orange` por día con
tooltip del multiplicador, y el KPI "Valor liquidable" sólo aparece
cuando `specialHourAdditionalMinutes > 0`. No se tocó `DoubleHourRule`,
`SpecialHourRuleApplication`, prioridades ni multiplicadores.

## 12. Deuda futura (fuera de alcance de 15K)

- **Jornadas abiertas agregadas por período**: hoy sólo existe una vista
  diaria (`GET /time-entries/attendance`); no hay un conteo por
  empleado+período. No se agregó ningún endpoint nuevo para esto en esta
  etapa (prohibido explícitamente por el alcance).
- **Novedades pendientes agregadas por período**: idem — `pendingNoveltiesCount`
  existe pero no está correlacionado por empleado+período en un único
  endpoint.
- **Paginación de `MonthlyClosuresPage`**: sigue usando `getOptions({ take:
  1000 })` sin paginar — deuda ya documentada en `PERFORMANCE_STANDARDS.md`,
  explícitamente fuera de alcance de esta etapa.
- **Extracción de una grilla compartida completa**: `HoursPage.tsx` y
  `EmployeeHoursPage.tsx` siguen teniendo su propia implementación de tabla
  (no extraída a un componente común). `MonthlyHoursReviewGrid.tsx` es una
  tercera implementación deliberadamente acotada a modo lectura — una
  futura unificación de las tres queda pendiente y no se intentó acá
  (habría exigido tocar `EmployeeHoursPage.tsx`, prohibido en esta etapa).
- **Acción de cierre individual dentro del panel**: evaluada y descartada
  para esta etapa por preferencia explícita (§5) — queda disponible para
  una etapa futura si se decide agregarla, reutilizando el mismo endpoint
  bulk existente con un array de un solo elemento.

## 13. Qué NO se tocó

Reglas de negocio de cierres, estados, aprobación, corrección RRHH,
Novedades, Horas Especiales, Conceptos Horarios, `TimeEntry`, exportación
Finnegans, permisos, DB/schema/migraciones, `EmployeeHoursPage.tsx`,
`HoursPage.tsx`.

## 14. Archivos tocados

Nuevos:

- `frontend/src/components/hours/MonthlyHoursReviewGrid.tsx`
- `frontend/src/components/hours/MonthlyHoursReviewGrid.test.tsx`
- `frontend/src/components/hours/MonthlyClosureReviewPanel.tsx`
- `frontend/src/components/hours/MonthlyClosureReviewPanel.test.tsx`
- `frontend/src/utils/monthlyClosureStatus.ts`
- `docs/decisions/MONTHLY_CLOSURE_REVIEW_PANEL_15K.md` (este documento)

Modificados:

- `frontend/src/pages/MonthlyClosuresPage.tsx` — acción "Revisar horas" por
  fila, estado `reviewing`, render del panel; los dos mapas de estado se
  movieron a `utils/monthlyClosureStatus.ts` (mismo valor, re-exportado con
  alias para no tocar ningún otro uso en el archivo).
- `frontend/src/pages/MonthlyClosuresPage.test.tsx` — nuevos describe
  blocks (panel de revisión, performance/cero N+1, regresión de acciones
  existentes) + helper `authAs` genérico.
- `frontend/src/styles.css` — regla `.modal:has(.monthly-hours-review-panel)`
  para un modal ancho (mismo patrón `:has()` ya usado para
  `.associated-employees-panel`/`.address-edit-layout`), con sus resets de
  mobile correspondientes.
- `docs/PROJECT_CONTEXT.md` — nota breve sobre el panel de revisión.

## 15. Tests agregados

- `MonthlyHoursReviewGrid.test.tsx` (9 tests): fila Hora normal, conceptos
  adicionales, columnas por día, total por fila, día sin horas, indicador
  de novedad, indicador de Hora Especial, ausencia total de botones
  (read-only), estado vacío sin filas.
- `MonthlyClosureReviewPanel.test.tsx` (6 tests): loading, una sola llamada
  a `getTimeGrid` con los argumentos correctos, mensaje de error sin
  detalle técnico, KPIs mínimos presentes, KPI de valor liquidable
  condicional, cerrar no dispara ninguna acción de mutación.
- `MonthlyClosuresPage.test.tsx` (+13 tests nuevos sobre los 2
  preexistentes): acción visible por fila, carga lazy sin N+1 con 2
  filas, cerrar no muta el cierre, paridad Nivel 1/2/3 (`it.each`),
  20 filas sin ningún request de time-grid, cambiar de empleado revisado
  sólo carga el nuevo, y regresión explícita de selección individual,
  envío masivo (Nivel 2), devolución (RRHH) y correcciones posteriores.

## 16. Validaciones

Frontend:

```txt
npx tsc -p tsconfig.app.json --noEmit   → OK
npx tsc -p tsconfig.e2e.json --noEmit   → OK
npx vitest run                          → 89 archivos / 878 tests OK
npm run build                           → OK
```

Backend: no se tocó ningún archivo de `backend/` — no se corrió su suite
completa (regla explícita de la etapa).

General:

```txt
git diff --check     → sin errores
git status --short   → sólo los archivos listados en §14 (sin commit)
```

## 17. QA visual

No se ejecutó una pasada visual real en navegador. El único backend
disponible en este entorno apunta a una base Postgres remota real (Neon,
`backend/.env`) sin credenciales de demo conocidas para este sesión —
levantar el stack completo y loguearse contra esa base para tomar
capturas hubiera significado conectar y operar sobre una base de datos
real ajena a esta tarea, algo que se prefirió no hacer sin confirmación
explícita. En su lugar, la verificación visual se apoyó en:

- Reutilización exacta de clases CSS ya validadas visualmente en
  producción (`hour-cell`, `stat-grid`, `alert-dot`, `table-sub`,
  `table-icon-action`) — ninguna clase nueva de layout, salvo el ancho del
  modal.
- El mismo patrón `:has()` de modal ancho ya usado (y ya validado
  visualmente) para el modal de "Empleados asociados"/régimen laboral.
- Tests de React Testing Library que verifican la estructura semántica
  (roles de tabla/fila/celda, ausencia de botones, presencia de badges)
  como sustituto parcial, no equivalente, de una inspección visual real.

Queda pendiente una pasada visual real (desktop 1366/1440/1920, tablet,
mobile) la próxima vez que se disponga de un entorno con backend local o
credenciales de demo autorizadas.
