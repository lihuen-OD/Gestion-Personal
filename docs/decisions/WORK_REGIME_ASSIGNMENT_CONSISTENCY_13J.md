# Etapa 13J — Consistencia de asignaciones de Régimen Laboral entre Legajo y Régimen

Fecha: 2026-09-02
Estado: implementado, validado, pendiente de aprobación para commitear
Continúa: `docs/decisions/WORK_REGIME_SHIFT_ALERTS_AUDIT_10A.md`, `docs/decisions/WORK_REGIME_SHIFT_ALERTS_10C.md`, `docs/decisions/WORK_REGIME_SHIFT_ALERTS_10D.md` (Etapa 8G/8H, no documentada con su propio archivo, introdujo `GET /work-regimes/:id/employees` y `EmployeeWorkRegime`)
Alcance: sólo la relación empleado ↔ régimen laboral (lectura y escritura de `EmployeeWorkRegime`, y la UI del modal "Empleados asociados" en Régimen Laboral). No se tocó fichadas, alertas de entrada/salida, Horas Especiales, Conceptos Horarios, liquidación, grilla/export/bandeja, ni asignaciones de feriado.

## 1. Resumen ejecutivo

El bug reportado (09 Granja y 10 Granja apareciendo como "asociados" a 01 - Agricultura en el modal de Régimen Laboral, con vigencia vencida el 01/09/2026, mientras el Legajo ya no los mostraba con ese régimen vigente) **no era un problema de fuente de verdad duplicada** — Legajo y Régimen Laboral ya leían y escribían la misma tabla (`EmployeeWorkRegime`) a través de los mismos endpoints desde la Etapa 8G/8H. El problema real, confirmado contra los datos reales de staging, era doble:

1. El endpoint `GET /work-regimes/:id/employees` (el que alimenta el modal) tenía como default `status=all` — mezclaba vigentes, históricas y futuras sin que el modal ofreciera ningún filtro para separarlas.
2. El modal de Régimen Laboral no tenía forma de asociar/quitar empleados directamente — sólo se podía hacer desde el Legajo, aunque el pedido funcional (Parte 3.4) exige poder hacerlo desde ambos lados.

Se corrigieron ambos: el default pasó a `status=current`, se agregó un filtro visible Vigentes/Históricos/Todos (default Vigentes), y se agregaron las acciones "Agregar empleados"/"Finalizar asignación" en el modal — **reusando exactamente los mismos endpoints que ya usa el Legajo** (`POST` y `PATCH .../close` de `/employees/:employeeId/work-regimes`), sin agregar ninguna ruta backend nueva. No se creó ninguna migración. No se borró historial. Verificado contra la base real de staging: con el fix, el listado por defecto para "01 - Agricultura" muestra sólo 27/28 Agricultura (vigentes) y ya no muestra 09/10 Granja (históricos, vencidos el 01/09/2026) — reproduce y corrige exactamente el caso reportado.

## 2. Problema detectado

- Modal "Empleados asociados a 01 - Agricultura" mostraba, sin ningún aviso ni filtro, empleados cuya vigencia ya había vencido (`effectiveTo` anterior a hoy) mezclados con los vigentes.
- El Legajo de esos empleados (09 Granja, 10 Granja) ya mostraba correctamente "El empleado no tiene un régimen laboral vigente para la fecha de hoy" — confirmando que el dato en sí era correcto; sólo la vista del modal lo presentaba mal.
- No existía forma de asociar/quitar un empleado a un régimen desde la propia pantalla de Régimen Laboral.

## 3. Fuente de verdad

**`EmployeeWorkRegime`** (`backend/prisma/schema.prisma`) es la única fuente de verdad de la asignación empleado ↔ régimen laboral, y ya lo era antes de esta etapa. Campos: `id`, `employeeId`, `workRegimeId`, `effectiveFrom` (`@db.Date`), `effectiveTo` (`@db.Date`, nullable), `assignedByUserId`, `createdAt`. **No tiene `status` ni `updatedAt`** — la vigencia se deriva de `effectiveFrom`/`effectiveTo` contra una fecha de referencia (mismo patrón que `Employee.status` derivado de `LaborMovement`), nunca de un booleano ni de un campo mutable aparte. El repositorio (`workRegimes.repository.ts`) **no expone ningún método de borrado** para este modelo — estructuralmente no es posible eliminar una asignación a través de este módulo, sólo crearla o cerrarle la vigencia (`effectiveTo`). Ambas FK son `onDelete: Restrict`, así que tampoco se pierde por cascada.

## 4. Diagnóstico (Parte 1 del pedido, con evidencia)

1. **Modelo de la asignación**: `EmployeeWorkRegime` (ver §3).
2. **¿Existe historial?**: sí — múltiples filas por empleado, cada una con su propio `effectiveFrom`/`effectiveTo`; nunca se sobrescribe una fila existente al asignar un régimen nuevo, se cierra la anterior (si corresponde) y se crea una nueva.
3. **Campos**: `employeeId` ✅, `workRegimeId` ✅, `effectiveFrom` ✅, `effectiveTo` ✅ (nullable, no `validTo` fijo obligatorio), **no** tiene `status` (se deriva, no se guarda) ni `updatedAt` (no se edita nunca in-place salvo `effectiveFrom`/`effectiveTo`/`workRegimeId` vía `updateAssignment`, que sí es un UPDATE real de esa misma fila — no un nuevo registro — usado sólo para corregir una asignación, no para "cerrarla").
4. **Endpoint que usa el Legajo para leer**: `GET /employees/:employeeId/work-regimes` (historial completo) y `GET /employees/:employeeId/work-regimes/current` (vigente a una fecha) — `EmployeeWorkRegimePanel.tsx`.
5. **Endpoint que usa el modal de Régimen Laboral para listar**: `GET /work-regimes/:id/employees` — `WorkRegimesPage.tsx` vía `AssociatedEmployeesPanel`.
6. **Endpoint que usa el Legajo para asignar/cambiar/quitar**: `POST /employees/:employeeId/work-regimes` (asignar), `PATCH .../:assignmentId` (editar), `PATCH .../:assignmentId/close` (cerrar vigencia).
7. **Endpoint que usaba Régimen Laboral para asociar/quitar, antes de esta etapa**: **ninguno** — el modal era de sólo lectura (`canEdit` no se pasaba a `AssociatedEmployeesPanel` en `WorkRegimesPage.tsx`).
8. **¿Ambos lados escriben sobre la misma tabla/modelo?**: sí, y ya lo hacían — ambos endpoints (Legajo y régimen) pasan por `workRegimesService`/`workRegimesRepository`, sobre `prisma.employeeWorkRegime`. No había una segunda tabla ni un modelo paralelo.
9. **¿El modal mostraba vigentes, históricos o todos?**: todos mezclados — `listWorkRegimeEmployeesQuerySchema.status` tenía `.default("all")`, y `buildAssociatedEmployeesRequest` (el filtro que arma `AssociatedEmployeesPanel`) nunca incluía `status` en absoluto, así que siempre caía en el default del backend.
10. **¿Etiquetaba correctamente Vigente vs Histórica?**: sí, por fila (`classifyWorkRegimeVigency` + `Badge`) — el problema no era el label de cada fila, sino que no había ningún filtro para no mostrarlas todas juntas por defecto.
11. **¿El filtro por estado funcionaba?**: el backend sí lo soportaba correctamente (`current`/`historical`/`future`/`all`, con tests dedicados) — el problema era que el frontend nunca lo usaba.
12. **¿Una asignación con `effectiveTo` anterior a hoy aparecía como vigente por error?**: no como "vigente" (el badge decía "Histórica" correctamente) — pero sí aparecía **en el listado por defecto** sin distinción visual de conjunto, lo que en el uso real se leyó como "está asociado".
13. **¿Una asignación histórica seguía afectando fichadas/alertas?**: no — ver punto 14.
14. **Función que resuelve el régimen activo para una fecha**: `resolveActiveWorkRegime` (`workRegimes.service.ts`) → `findActiveEmployeeWorkRegime` (repositorio), que filtra `effectiveFrom <= fecha AND (effectiveTo IS NULL OR effectiveTo >= fecha)`. Confirmado con la fila real de 09 Granja: `effectiveTo = 2026-09-01`, hoy `2026-09-02` → `GET /employees/:id/work-regimes/current` devuelve `null`. Correcto.
15. **¿Usa fecha actual o fecha de fichada?**: usa la fecha del **instante evaluado** (`actualAt`/`now`, pasado por el llamador — la fichada real o el momento de evaluación), nunca hardcodea `new Date()` dentro de la función. Confirmado en los tres call sites (`timeEntries.service.ts`, `timeEntries.repository.ts`, `workShiftEvaluationRunner.ts`, `openShiftMonitor.service.ts`) — todos pasan el instante del evento, no la hora del servidor al momento de correr el job.
16. **¿Hay cache que pueda dejar datos viejos?**: no para este flujo — `getAssignmentHistory`, `getCurrentAssignment` y `getWorkRegimeEmployees` usan `apiCache: false` (sin cache HTTP) y no pasan por `cachedData` (sin cache de frontend). Sólo el catálogo de regímenes (`getAll`, `workRegimesCatalog`) usa cache, y ya se invalida correctamente en `create`/`update`/`updateStatus`; no aplica a asignaciones.
17. **Tests existentes**: 66 tests backend ya cubrían CRUD de régimen, asignación con vigencia (crear/editar/cerrar/solapamiento), `resolveActiveWorkRegime`, `classifyWorkRegimeVigency` y `listEmployees` (incluida la construcción del `where` por cada valor de `status`). Frontend: tests de `matchesFilters`, del panel de régimen del Legajo (función pura `assignmentRowStatus`) y helpers de vigencia — pero **ningún test cubría el modal "Empleados asociados" en uso (con datos)**, ni el hecho de que no ofrecía agregar/quitar.
18. **Pantallas que deben mantenerse sincronizadas**: Legajo (tab Régimen Laboral) y Régimen Laboral (modal "Empleados asociados") — ambas ya sincronizadas por diseño al compartir la misma tabla y, ahora, los mismos endpoints de escritura.

**Conclusión del diagnóstico**: no hacía falta una migración, ni unificar dos fuentes de verdad (ya había una sola), ni tocar `resolveActiveWorkRegime` (ya usaba la fecha correcta). El bug era 100% de UI/UX en la pantalla de Régimen Laboral: default de filtro incorrecto y ausencia de acciones de escritura.

## 5. Qué se corrigió

**`backend/src/modules/work-regimes/workRegimes.schemas.ts`**:
- `listWorkRegimeEmployeesQuerySchema.status`: default `"all"` → `"current"`. Es el único cambio de comportamiento del backend en esta etapa.

**`frontend/src/components/shared/AssociatedEmployeesPanel.tsx`** (componente compartido, también usado por `HourConceptsPage.tsx`):
- Nuevos props opcionales, todos con default que preserva el comportamiento anterior exacto para quien no los pase (`HourConceptsPage` no los usa, cero cambio de comportamiento ahí):
  - `removeConfirmTitle` (default `"Quitar empleado"`) y `removeActionLabel` (default `"Quitar"`) — para que Régimen Laboral pueda decir "Finalizar asignación" en vez de "Quitar"/"Eliminar" cuando en realidad conserva historial.
  - `canRemove?: (item) => boolean` — para ocultar la acción de baja en filas que no corresponde cerrar (históricas, ya cerradas).
  - `renderAddExtra?: () => ReactNode` — slot para un campo extra en el modal "Agregar empleados" (la fecha "Vigencia desde", que Régimen Laboral necesita y Concepto Horario no).
  - `renderFilterExtra?: () => ReactNode` — slot para un filtro extra en la misma barra de filtros (el selector de vigencia).

**`frontend/src/pages/WorkRegimesPage.tsx`**:
- El modal "Empleados asociados" ahora incluye: copy explicando vigentes vs históricos, selector "Vigencia" (Vigentes/Históricos/Todos, default Vigentes) integrado en la barra de filtros, botón "Agregar empleados" con campo de fecha "Vigencia desde", y acción "Finalizar asignación" por fila (sólo visible en filas vigentes).
- `onAddEmployees`: por cada empleado seleccionado, llama a `workRegimeApiService.assign(employeeId, { workRegimeId, effectiveFrom })` — el mismo método que ya usa `EmployeeWorkRegimePanel.tsx` desde el Legajo.
- `onRemoveEmployee`: llama a `workRegimeApiService.closeAssignment(employeeId, assignmentId, hoy)` — el mismo método que ya usa el Legajo para "Cerrar vigencia".
- Gateado por `editable` (rol `Nivel 1 - RRHH`), exactamente el mismo rol que exige el backend (`adminRoles = [NIVEL_1_RRHH]`) en los endpoints de asignación — confirmado que ambos coinciden antes de reusar el flag.

**No se agregó ningún endpoint backend nuevo** — Régimen Laboral escribe a través de los mismos endpoints `/employees/:employeeId/work-regimes` que ya usaba el Legajo, lo que además hace estructuralmente imposible que ambas pantallas diverjan en el futuro (no hay dos implementaciones de "asignar" que puedan desincronizarse).

## 6. Flujo desde Legajo

Sin cambios de comportamiento (ya era correcto):
- **Asignar**: `EmployeeWorkRegimePanel.tsx` → `POST /employees/:employeeId/work-regimes` → crea una fila `EmployeeWorkRegime` nueva (valida solapamiento contra cualquier régimen del empleado). Aparece inmediatamente como vigente en Régimen Laboral (misma tabla, `GET /work-regimes/:id/employees?status=current` la incluye si `effectiveFrom <= hoy` y sin `effectiveTo` vencido).
- **Quitar (cerrar vigencia)**: `PATCH .../:assignmentId/close` con `effectiveTo` → hace `UPDATE` de esa fila (`effectiveTo` pasa de `null` a la fecha elegida). La fila **no se borra** — deja de aparecer como vigente (`status=current`) pero sigue apareciendo en históricos (`status=historical`/`all`).

## 7. Flujo desde Régimen Laboral (nuevo en esta etapa)

- **Agregar empleado**: botón "Agregar empleados" en el modal → selector remoto de legajos + campo "Vigencia desde" (default hoy) → por cada empleado seleccionado, `POST /employees/:employeeId/work-regimes` (idéntico al paso del Legajo). Si un empleado ya tiene una vigencia solapada, esa asignación puntual falla con 409 (mismo comportamiento que si se hiciera desde el Legajo) — no es atómico entre varios empleados seleccionados a la vez (ver Riesgos, §12).
- **Finalizar asignación**: acción "Finalizar asignación" (icono, sólo visible en filas con `vigencyStatus === "current"`) → confirmación → `PATCH .../:assignmentId/close` con `effectiveTo = hoy` (idéntico al "Cerrar vigencia" del Legajo). No se ofrece sobre filas históricas (ya cerradas) ni futuras (cerrarlas con la fecha de hoy violaría `effectiveTo >= effectiveFrom`).

## 8. Vigentes vs Históricos

- Backend: `classifyWorkRegimeVigency(effectiveFrom, effectiveTo, referenceDate)` — sin cambios, ya era correcto (future / historical / current, mutuamente excluyentes).
- Filtro del modal: `Vigentes` (`status=current`, **default**) / `Históricos` (`status=historical`) / `Todos` (`status=all`). Cambiar el filtro fuerza un remount del panel (`key={regimeId-status}`) para no arrastrar página/búsqueda de un filtro al otro.
- Copy agregado: "Los empleados vigentes tienen este régimen activo actualmente. Los históricos conservaron este régimen en un período anterior." — visible siempre en el modal, no sólo cuando se filtra por históricos.
- Badge por fila: `Vigente` (verde) / `Histórica` (neutro) / `Futura` (amarillo) — sin cambios, ya eran correctos.

## 9. Impacto en fichadas/alertas

**Ninguno.** No se tocó `resolveActiveWorkRegime`, `findActiveEmployeeWorkRegime`, `workShiftEvaluationRunner.ts`, `timeEntries.service.ts`, `timeEntries.repository.ts` ni `openShiftMonitor.service.ts`. El diagnóstico (§4, puntos 14-15) confirma que esa función ya usaba correctamente la fecha del evento evaluado, no la fecha del servidor — no había ningún bug ahí que corregir. Los 999 tests backend existentes (incluida toda la suite de `workShiftEvaluationRunner.test.ts`, `timeEntries.*`) siguen pasando sin ninguna modificación de esos archivos.

## 10. Tests backend

- **Nuevo**: `workRegimes.schemas.test.ts` — `listWorkRegimeEmployeesQuerySchema.status` sin valor en el query → default `"current"` (no `"all"`); acepta `"historical"`/`"all"` explícitos sin que el default los pise.
- **Ya cubrían y no requirieron cambios** (verificado leyendo cada uno antes de decidir no duplicarlos): `workRegimes.service.test.ts` (66 tests) — asignar desde Legajo aparece vigente (`assign` + `listEmployees`/`getCurrent` comparten la misma fila), finalizar deja de aparecer como vigente y conserva historial (`closeAssignment` hace `UPDATE`, nunca `DELETE`), `resolveActiveWorkRegime` no devuelve régimen vencido y usa la fecha evaluada, `classifyWorkRegimeVigency` cubre los 3 casos, `findEmployees`/`vigencyWhere` cubre los 4 valores de `status` incluido que `current` excluye `effectiveTo` vencido. No se reescribieron porque el bug no estaba en esa lógica (§4) — agregar tests redundantes sobre código sin cambios no habría aportado nada.
- Dado que Régimen Laboral ahora escribe por los **mismos** endpoints que el Legajo (no una implementación paralela), la cobertura ya existente de `assign`/`closeAssignment` cubre estructuralmente ambos orígenes — no hay una segunda función de servicio "asignar desde régimen" que necesite sus propios tests.
- Suite completa: **999/999 verdes** (66 archivos), incluida la corrida completa de `work-regimes` (66 tests, 4 archivos) aislada.

## 11. Tests frontend

Nuevo archivo `frontend/src/pages/WorkRegimesPage.associatedEmployees.test.tsx` (10 tests, todos verdes):

1. Por defecto pide `status=current` (no mezcla históricas sin avisar) y el selector muestra "Vigentes".
2. Una fila vigente muestra el badge "Vigente".
3. Cambiar a "Históricos" vuelve a pedir con `status=historical` y muestra el badge "Histórica".
4. Cambiar a "Todos" pide `status=all`.
5. Empty state con el texto correcto según el filtro aplicado.
6. Error state (mensaje de error, no un listado vacío silencioso).
7. Loading state (skeleton visible mientras resuelve la promesa).
8. Una fila vigente ofrece "Finalizar asignación" (nunca "Eliminar"/"Quitar"); una histórica no ofrece ninguna acción de baja.
9. "Finalizar asignación" pide confirmación y llama a `closeAssignment(employeeId, assignmentId, hoy)` — y dispara un nuevo `getWorkRegimeEmployees` (el mismo endpoint que lee el Legajo ve el cambio de inmediato, por compartir fuente).
10. "Agregar empleados" selecciona un legajo remoto y llama a `assign(employeeId, { workRegimeId, effectiveFrom })` con la fecha por defecto (hoy).

Suite completa frontend: **486/486 verdes** (58 archivos), sin regresiones en `WorkRegimesPage.test.tsx`, `WorkRegimesPage.filters.test.ts`, `AssociatedEmployeesPanel.helpers.test.ts`, `HourConceptsPage.copy.test.ts`/`.filters.test.ts` ni `EmployeeWorkRegimePanel.test.ts`.

**Item no cubierto con un test dedicado**: "Legajo refleja cambio luego de asignar/quitar" (Parte 6.8) no tiene un test de render de `EmployeeWorkRegimePanel.tsx` porque ese componente no fue tocado — la garantía es estructural (mismo endpoint `GET /employees/:id/work-regimes/current`, sin cache), confirmada en vivo contra datos reales (§13) en vez de con un test unitario adicional de bajo valor sobre un componente sin cambios.

## 12. Validaciones ejecutadas

- `prisma validate` ✅ (schema válido, sin cambios).
- `prisma generate` ✅.
- `prisma migrate status` ✅ (49 migraciones, sin cambios de schema, "Database schema is up to date").
- Backend `typecheck` (`tsc --noEmit`) ✅.
- Backend `vitest run` ✅ 999/999 (66 archivos).
- Backend `build` (`tsc`) ✅.
- Frontend `typecheck` (`tsc -b --noEmit`) ✅.
- Frontend `vitest run` ✅ 486/486 (58 archivos).
- Frontend `build` (`vite build`) ✅.
- `git diff --check` ✅ sin errores de espacios en blanco.
- **Verificación manual en vivo** contra la base real de staging (Neon), con los usuarios seed (`docs/LOCAL_DEVELOPMENT.md`): login como `admin@losod.local` (RRHH), navegación real a Régimen Laboral, apertura del modal para el régimen real "01 - Agricultura" (el mismo del reporte). Confirmado por API y por captura de pantalla: con el fix, el listado por defecto muestra sólo 27/28 Agricultura (vigentes, sin `effectiveTo`); al cambiar a "Todos" aparecen además 09/10 Granja con badge "Histórica" y fechas 01/08/2026 — 01/09/2026 (exactamente el caso reportado), sin acción de "Finalizar asignación" disponible en esas filas. Sin errores de consola del navegador.

## 13. Confirmación: no se borró historial

Confirmado en tres niveles: (1) el repositorio de `EmployeeWorkRegime` no expone ningún método de borrado — no hay `delete`/`deleteMany` para este modelo en `workRegimes.repository.ts`; (2) "Finalizar asignación" desde Régimen Laboral llama al mismo `closeAssignment` que ya usaba el Legajo, que hace `prisma.employeeWorkRegime.update({ data: { effectiveTo } })`, nunca un `delete`; (3) verificado en vivo: tras el fix, la fila de 09 Granja (histórica) sigue existiendo y sigue siendo consultable vía `GET /employees/:id/work-regimes` (historial) y vía el filtro "Históricos"/"Todos" del modal — sólo dejó de aparecer en el filtro "Vigentes" (default), que es el comportamiento pedido.

## 14. Confirmación: no se tocó liquidación/fichador

Ningún archivo de `time-entries`, `shifts` (evaluación de turnos/alertas), `hour-concepts`, ni ningún archivo relacionado a liquidación fue modificado en esta etapa. El único archivo backend tocado es `workRegimes.schemas.ts` (un default de query). `git diff --stat` (§16) lo confirma: sólo 4 archivos modificados + 1 test nuevo, todos dentro de `work-regimes`/`AssociatedEmployeesPanel`/`WorkRegimesPage`.

## 15. Riesgos pendientes

- **"Agregar empleados" no es atómico entre varios empleados seleccionados a la vez**: se ejecuta un `assign` por empleado en paralelo (`Promise.all`); si uno falla por solapamiento, el mensaje de error no distingue cuál de los seleccionados fue. Los que sí se pudieron asignar quedan asignados igual (no hay rollback). Es el mismo riesgo que ya existía en `AssociatedEmployeesPanel` para Concepto Horario (mismo patrón, `skipDuplicates` a nivel `createMany` ahí en vez de por-fila acá, porque el régimen sí necesita validar solapamiento de vigencia por fila, cosa que un `createMany` no puede hacer). No se resolvió en esta etapa por no ser parte del bug reportado ni de los criterios de aceptación.
- **Índice de `EmployeeWorkRegime.workRegimeId`**: ya documentado como deuda desde la Etapa 8G (comentario en `schema.prisma`) — el filtro por régimen en `findEmployees` no tiene un índice dedicado, sólo `[workRegimeId, effectiveFrom]`. No se agregó ninguna migración en esta etapa (fuera del alcance pedido: "no crear migraciones salvo que el diagnóstico demuestre que el modelo actual no alcanza" — no fue el caso).
- **Filtro de vigencia se resetea al reabrir el modal**: si un usuario dejó el filtro en "Todos" y cierra/reabre el modal (o cambia de régimen), vuelve a "Vigentes". Es intencional (default seguro), pero documentado por si en el futuro se pide recordar la última selección.

## 16. Qué NO se tocó

- Fichadas, alertas de entrada/salida (`workShiftEvaluationRunner.ts`, `timeEntries.service.ts`, `timeEntries.repository.ts`, `openShiftMonitor.service.ts`).
- Horas Especiales, Conceptos Horarios (`hour-concepts/*`).
- Liquidación.
- Grilla/export/bandeja de revisión.
- Asignaciones de feriado (`HolidayWorkAssignment`).
- `schema.prisma` — sin cambios, sin migraciones.
- `resolveActiveWorkRegime`, `findActiveEmployeeWorkRegime`, `classifyWorkRegimeVigency` — sin cambios (ya eran correctos).
- `EmployeeWorkRegimePanel.tsx` (Legajo) — sin cambios (ya era correcto).
- `HourConceptsPage.tsx` — sin cambios de comportamiento (los nuevos props de `AssociatedEmployeesPanel` son opcionales, con default idéntico al comportamiento previo).
- Permisos/RBAC — se reusa el mismo `adminRoles`/`roleLevel === 1` ya existente, sin agregar ni modificar ningún rol.

---

No se tocó fichador, alertas, Horas Especiales, Conceptos Horarios, liquidación, grilla/export/bandeja ni asignaciones de feriado. No se creó ninguna migración. No se borró historial. No commitear sin aprobación explícita del usuario.
