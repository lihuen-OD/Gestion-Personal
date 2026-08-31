# Etapa 12D — Asignaciones de trabajo en feriados desde Turnos

Fecha: 2026-08-31
Estado: implementado, validado, pendiente de aprobación para commitear
Continúa: `docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_12A.md`, `docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_12B.md` (commit `c6864b0`), `docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_UX_12C.md` (commit `34aee9f`)

## 1. Resumen ejecutivo

Se agregó `HolidayWorkAssignment`, una entidad nueva y aditiva que registra qué empleados fueron convocados a trabajar un feriado puntual. Las fechas disponibles para convocar salen exclusivamente de `DoubleHourRule.kind=FERIADO` (Etapa 12B) a través de una función fina (`workforceService.holidayDatesInRange`) que reutiliza `calendarPreview` sin duplicar el cálculo de calendario — Turnos no tiene, y no debe tener, su propio calendario de feriados. Se implementaron 4 endpoints dentro del módulo `shifts` (`/shifts/holiday-work/*`) y una pantalla nueva ("Turnos → Asignaciones de feriados") con selector de mes, lista de feriados, filtros (turno/sector/sin turno/búsqueda), acciones rápidas de selección y guardado por upsert seguro (nunca "reemplaza toda la fecha"). No se tocó el motor de liquidación, el fichador, Conceptos Horarios ni la notificación "Sin actividad registrada" — esta etapa sólo deja registrada la *expectativa* de convocatoria, sin resolver nada de liquidación ni de notificaciones todavía. +45 tests backend (856→901), +18 tests frontend (443→461), todos verdes.

## 2. Diagnóstico previo (Parte 1 del pedido)

1. **Módulo actual de Turnos** (`backend/src/modules/shifts/`): `shiftTemplate` (vive en `workforce-management`, no en `shifts`), `shiftAssignment.{repository,service,controller,schemas}.ts` (asignación empleado↔turno recurrente), `shiftAlert.*` (alertas de jornada), `openShiftMonitor.service.ts`, `workShiftEvaluation*.ts`. Un único router, `shifts.routes.ts`, monta todo bajo `/api/shifts`.
2. **Modelos relevantes** ([schema.prisma](../../backend/prisma/schema.prisma)):
   - `ShiftTemplate` (línea ~1087): horario habitual + tolerancias, `status: RecordStatus`.
   - `ShiftAssignment` (línea ~1126): `employeeId`+`shiftTemplateId` únicos compuestos, `status: HABILITADO|DESHABILITADO`, vigencia (`effectiveFrom`/`effectiveTo`/`weekdays`) — es un vínculo **recurrente por día de semana**, no por fecha puntual.
   - `Employee.sectorId`/`costCenterId`/`positionId` son columnas directas; `EmployeeCompany` es la relación a empresa.
   - `WorkRegime`/`EmployeeWorkRegime`: régimen laboral, sin relación directa con feriados.
3. **Cómo se asignan turnos hoy**: `shiftAssignmentService.assign()` — upsert por `(employeeId, shiftTemplateId)`: si no existe, `create`; si existe y está `DESHABILITADO`, `reEnable` (pisa vigencia/días); si ya está `HABILITADO`, no-op. **Este es el patrón exacto que se reutilizó para `HolidayWorkAssignment`** (ver §3).
4. **¿Existe algo parecido a asignación por fecha puntual?** No — `ShiftAssignment` es siempre recurrente (`weekdays`). No hay precedente de "asignación para una fecha específica" en todo el repo antes de esta etapa.
5. **Endpoint de empleados por turno/sector**: `GET /employees/options` (`employees.routes.ts`) soporta `search`/`status`/`companyId`/`sectorId`, pero **no** `shiftTemplateId` ni "sin turno" — no alcanza para los candidatos de esta pantalla sin extenderlo (ver §4 sobre por qué no se extendió).
6. **Cómo se filtran empleados por empresa/sector/turno hoy**: `employees.repository.ts` repite (sin compartir) el mismo patrón de `where` de búsqueda en 3 funciones (`buildWhere`/`buildOrgChartWhere`/`buildOptionsWhere`); `timeEntries.repository.ts` tiene una cuarta copia local (`employeeSearchWhere`). No existe un helper compartido — es la convención ya establecida en el repo (duplicar localmente, no factorizar prematuramente).
7. **Permisos de Turnos hoy**: lectura `[rrhh, supervision, cargaHoraria]`, escritura (`POST/PATCH/DELETE /assignments`) sólo `rrhh` — mismo patrón que Horas Especiales y Régimen Laboral.
8. **Cómo se consumen las fechas de Horas Especiales**: `GET /workforce/double-hour-rules/calendar?from&to&kind` (`workforce.service.ts:calendarPreview`, Etapa 12B) — ya soporta filtrar por `kind=FERIADO`.
9. **Cómo llamar sin duplicar lógica**: se agregó `workforceService.holidayDatesInRange(from, to)` — una función de una línea que llama a `calendarPreview(from, to, "FERIADO")` y angosta la respuesta. Exactamente el contrato ya diseñado en `docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_12A.md` §12.
10. **Dónde ubicar la pantalla**: `Configuración → Asignaciones de feriados` (tarjeta nueva en `SettingsPage.tsx`, mismo patrón que "Horas especiales"/"Turnos"), ruta `/configuracion/turnos-asignaciones-feriados`.
11. **¿Endpoint propio en `shifts` o reutilizar `workforce`?**: propio, en `shifts` — es la entidad nueva (`HolidayWorkAssignment`) la que pertenece a Turnos conceptualmente (define expectativa de trabajo, no liquidación); sólo la *lectura* de fechas delega en `workforce-management` (dueño de `DoubleHourRule`), vía import cruzado — mismo patrón ya usado por `timeEntries.repository.ts` al importar `doubleHourRuleMatching.ts`.
12. **Riesgos de performance al listar empleados**: `Employee` es una tabla operativa que crece con headcount (categoría C de `docs/PERFORMANCE_STANDARDS.md`), nunca catálogo fetch-all-seguro — se paginó desde el diseño inicial (ver §10).

## 3. Modelo implementado

```prisma
enum HolidayWorkAssignmentStatus {
  ACTIVA
  CANCELADA
}

model HolidayWorkAssignment {
  id                String                       @id @default(uuid())
  date              DateTime                     @db.Date
  employeeId        String
  shiftTemplateId   String?
  expectedStartTime String?
  expectedEndTime   String?
  notes             String?
  status            HolidayWorkAssignmentStatus  @default(ACTIVA)
  createdByUserId   String?
  updatedByUserId   String?
  createdAt         DateTime                     @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime                     @updatedAt @db.Timestamptz(3)

  employee      Employee       @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  shiftTemplate ShiftTemplate? @relation(fields: [shiftTemplateId], references: [id], onDelete: SetNull)
  createdBy     User?          @relation("HolidayWorkAssignmentCreatedBy", fields: [createdByUserId], references: [id], onDelete: SetNull)
  updatedBy     User?          @relation("HolidayWorkAssignmentUpdatedBy", fields: [updatedByUserId], references: [id], onDelete: SetNull)

  @@unique([date, employeeId])
  @@index([date, status])
  @@index([employeeId])
}
```

**Sin `multiplier`, sin regla de liquidación, sin horas liquidables** — exactamente como pedía el encargo. `date` es un valor propio (no una FK a `SpecialHourRuleDate` ni a ninguna tabla de Horas Especiales): esta tabla **no es un calendario paralelo**, sólo referencia por valor una fecha que ya salió de la fuente única (`DoubleHourRule.kind=FERIADO`).

**`@@unique([date, employeeId])`**: sólo puede existir una fila por persona y fecha, para siempre. "Sacar" a alguien de la convocatoria nunca borra la fila ni permite crear una segunda — la deja en `status=CANCELADA`. Es el mismo patrón ya usado por `ShiftAssignment` (`reEnable`/`DESHABILITADO`) y por `DoubleHourRuleEmployee` — reutilizado, no inventado.

## 4. Migración

Generada con `prisma migrate diff` contra la base real (mismo criterio que 8B/10D/12B) y aplicada con `prisma migrate deploy`:

```sql
CREATE TYPE "HolidayWorkAssignmentStatus" AS ENUM ('ACTIVA', 'CANCELADA');
CREATE TABLE "HolidayWorkAssignment" ( ... );
CREATE INDEX "HolidayWorkAssignment_date_status_idx" ON "HolidayWorkAssignment"("date", "status");
CREATE INDEX "HolidayWorkAssignment_employeeId_idx" ON "HolidayWorkAssignment"("employeeId");
CREATE UNIQUE INDEX "HolidayWorkAssignment_date_employeeId_key" ON "HolidayWorkAssignment"("date", "employeeId");
-- + 4 foreign keys (employeeId RESTRICT, shiftTemplateId/createdByUserId/updatedByUserId SET NULL)
```

100% aditivo — tabla nueva, ninguna columna/tipo/nullability de una tabla existente cambia. Guardada en `backend/prisma/migrations/20260831180000_add_holiday_work_assignment/migration.sql`, aplicada con `npx prisma migrate deploy` (sin shadow database, mismo motivo preexistente ya documentado desde 8B: la migración histórica `20260824170000_normalize_hour_concepts` sigue sin poder reproducirse contra una shadow DB vacía). Confirmado después con `prisma migrate status`: 48 migraciones, "Database schema is up to date!".

## 5. Endpoints

Todos bajo `/api/shifts`, `requireAuth` + `requireAnyRole`:

| Método | Ruta | Rol | Qué hace |
|---|---|---|---|
| GET | `/holiday-work/dates?from&to` | RRHH/Supervisión/Carga Horaria | Fechas `kind=FERIADO` en el rango (máx. 400 días) |
| GET | `/holiday-work/candidates?sectorId&shiftTemplateId&withoutShift&search&page&take` | RRHH/Supervisión/Carga Horaria | Empleados candidatos, paginados |
| GET | `/holiday-work/assignments?date` | RRHH/Supervisión/Carga Horaria | Convocatorias `ACTIVA` para esa fecha |
| PUT | `/holiday-work/assignments` | **RRHH** | Guarda convocatorias (ver §6) |

Lectura para los mismos 3 roles operativos que ya leen Turnos/Horas Especiales; escritura sólo RRHH — **mismo criterio ya usado por `POST/PATCH/DELETE /shifts/assignments`**, sin abrir ningún permiso nuevo sin justificar.

## 6. Por qué el `PUT` es un upsert por empleado, no "reemplazar toda la fecha"

El pedido proponía un `PUT` que "reemplaza la asignación activa de esa fecha", pero pedía explícitamente evaluar si es seguro. Se descartó: si el payload representara *la verdad completa* de una fecha, un usuario que guarda con un filtro de sector activo (ej. Supervisión filtrando sólo "Pañol") **borraría silenciosamente** las convocatorias de otros sectores ya guardadas por otro usuario para la misma fecha — el filtro de la UI no debería poder afectar datos fuera de su alcance visible.

**Diseño implementado**: cada entrada de `assignments[]` es un upsert independiente para `(date, employeeId)`, con `status` explícito (`ACTIVA` default, o `CANCELADA`). Sólo se tocan los `employeeId` incluidos en el array — cualquier convocatoria ya guardada para esa fecha que no aparece en el payload queda intacta. El frontend calcula el diff (altas + bajas) contra lo que cargó al abrir la fecha (ver §7) y sólo manda lo que realmente cambió.

## 7. Cómo se consumen los feriados desde Horas Especiales (sin duplicar calendario)

```
DoubleHourRule.kind=FERIADO (12B)
        │
        ▼
workforce.service.ts:calendarPreview(from, to, "FERIADO")   ← sin tocar, reutilizado tal cual
        │
        ▼
workforce.service.ts:holidayDatesInRange(from, to)           ← NUEVO, 1 línea, angosta la respuesta
        │  { date, rules: [{ id, name }] }  — nunca multiplier/priority/hasOverlap/hasConflict
        ▼
shifts/holidayWorkAssignment.service.ts:holidayDates()        ← NUEVO, pass-through
        │
        ▼
GET /shifts/holiday-work/dates                                ← consumido por el frontend
```

Ningún archivo de `doubleHourRuleMatching.ts` ni de `calendarPreview` se modificó. `holidayDatesInRange` vive en `workforce-management` (dueño de `DoubleHourRule`) — `shifts` sólo la importa, nunca al revés, mismo patrón cruzado ya usado por `timeEntries.repository.ts`. Verificado con test: la respuesta nunca incluye `multiplier`/`priority`/`hasOverlap`/`hasConflict`.

## 8. UX de la pantalla

`Configuración → Asignaciones de feriados` (`HolidayWorkAssignmentsPage.tsx`):

1. **Selector de mes** (prev/siguiente) + **lista de feriados disponibles** del mes visible, como chips clickeables (con tooltip mostrando el/los nombres de regla de origen — nunca usado para lógica, sólo texto).
2. Al elegir una fecha: panel de convocatoria con **filtros** (búsqueda con debounce 350ms, Turno, Sector, "Mostrar empleados sin turno") y **acciones rápidas** ("Seleccionar todos los visibles", "Deseleccionar visibles", "Deseleccionar todos").
3. **Tabla de candidatos**: checkbox "Trabaja este feriado" (sólo visible/habilitado si `canEdit`), legajo, nombre, sector, turno habitual (o "Sin turno habitual"), horario esperado (editable sólo si está marcado), observación (editable sólo si está marcado).
4. **Guardar cambios**: calcula el diff (ver §6) y llama al `PUT`. Estados: `loading` (skeleton inicial, nunca en refetch por filtro), `error` con reintento, `empty` con el copy exacto pedido.
5. Usuarios de Supervisión/Carga Horaria ven la misma pantalla en **modo sólo lectura** (sin checkboxes ni botón de guardar) — mismo criterio de permisos que el resto de Turnos.

**Copy usado, sin lenguaje técnico** (verificado con test): *"Estas fechas vienen de Horas Especiales clasificadas como Feriado."*, *"Seleccioná quiénes estaban convocados a trabajar ese feriado."*, *"La liquidación de las horas trabajadas la sigue resolviendo Horas Especiales — acá sólo queda registrada la expectativa de quién debía trabajar."*, empty state: *"No hay feriados disponibles. Primero clasificá una regla de Horas Especiales como Feriado."*

**Decisión de alcance explícita**: no se agregó un aviso separado "las reglas siguen en Otro" en esta pantalla (a diferencia de la Etapa 12C, que sí lo tiene en Horas Especiales) — el empty state ya cubre ese caso con el mismo mensaje ("clasificá una regla como Feriado"), y agregar un segundo aviso requeriría una consulta adicional a todas las `DoubleHourRule` (no sólo las `FERIADO`) que esta pantalla no necesita para nada más. Esa responsabilidad queda donde ya vive, en Horas Especiales (12C).

**Decisión de alcance explícita (acciones rápidas)**: el pedido sugería 4 acciones ("seleccionar visibles", "deseleccionar visibles", "seleccionar todos del turno", "deseleccionar todos"). Se implementaron 3: "seleccionar todos del turno" ya se logra combinando el filtro "Turno" existente + "Seleccionar todos los visibles" — agregar un cuarto botón que hace exactamente lo mismo en un paso duplicaría una acción ya cubierta y contradice "Evitar acciones ambiguas" del propio encargo (Parte 6, punto 6).

## 9. Casos funcionales (Parte "Casos reales a resolver")

1. **Administrativo, no trabaja nadie**: RRHH abre la fecha, no marca a nadie, guarda (o no guarda si no había nada antes) — `payload` vacío no dispara ningún `PUT` (`hasChanges()` lo evita), consistente con "no crea una fila cancelada vacía" (ver `save()`, service).
2. **Pañol, trabaja todo el equipo**: filtro Turno = turno de Pañol → "Seleccionar todos los visibles" → guardar — cada empleado se crea con `status=ACTIVA`.
3. **Oficina grande, sólo algunos**: sin filtro de turno, se tildan puntualmente los legajos correspondientes.
4. **Persona sin turno, convocada**: toggle "Mostrar empleados sin turno" (`shiftAssignments: none HABILITADO`) la trae al listado; se puede tildar igual que cualquier otro candidato — `shiftTemplateId` queda `null` en la fila creada (campo opcional, exactamente como pedía el modelo).
5. **Persona no convocada que ficha**: no se toca en esta etapa — el motor de Horas Especiales sigue aplicando el multiplicador igual, sin consultar `HolidayWorkAssignment` en ningún punto (confirmado: `doubleHourRuleMatching.ts`/`timeEntries.repository.ts` no fueron tocados ni importan nada de `shifts`).
6. **Persona convocada que no ficha**: la fila `HolidayWorkAssignment` con `status=ACTIVA` queda registrada — es exactamente "la expectativa" que pedía el encargo. No se generó ninguna notificación ni alerta a partir de esto (ver §11).

## 10. Performance

- **Candidatos paginados desde el diseño inicial** (`page`/`take`, `take` máximo 500) — nunca fetch-all de `Employee` (categoría operativa, crece con headcount).
- **Límite V1 documentado explícitamente**: el frontend pide `take=300` sin UI de "cargar más" — alcanza para un headcount activo de hasta 300 personas por combinación de filtros. Si una organización con más de 300 empleados activos necesitara ver "todos sin turno" sin acotar más el filtro, esta pantalla no los traería completos en la v1. Documentado en el propio código (`holidayWorkAssignmentApiService.ts`) y acá — no es un fetch-all sin límite, es un límite fijo conocido, candidato a paginación real (botón "cargar más") si el volumen real lo exige.
- **El calendario de feriados usa "mes visible"** (`docs/PERFORMANCE_STANDARDS.md` §7), mismo criterio que `SpecialHourRulesCalendarMonth` — nunca año completo.
- **Cambiar un filtro no recalcula el calendario de feriados** ni vuelve a pedir la convocatoria ya guardada — sólo dispara `getCandidates` (la selección local, `checkedIds`/`details`, sobrevive a cambios de filtro, sólo se resetea al cambiar de fecha).
- **No blanquea la tabla durante un refetch por filtro** — el guard `if (!candidates) setCandidatesStatus("loading")` sólo muestra el skeleton en la primera carga de cada fecha (forzado por `openDate()`, que limpia `candidates` explícitamente); un cambio de filtro deja la tabla anterior visible mientras llega la respuesta nueva.
- **Ningún checkbox dispara fetch** — marcar/desmarcar es 100% estado local (`checkedIds`/`details`); sólo "Guardar cambios" llama a la API, una única vez por click.
- **Sin cache nuevo agregado** — `apiCache: false` en las 4 llamadas (mismo criterio que `shiftAssignmentApiService`, datos operativos de escritura frecuente que no ameritan cache de frontend); no se tocó `frontend/src/services/cache/` ni `backend/src/shared/cache/`.

## 11. Confirmaciones explícitas pedidas

- **No se tocó liquidación**: `doubleHourRuleMatching.ts`, `timeEntries.repository.ts`, `TimeEntry.hours/totalMinutes/appliedMultiplier`, `HourConceptBreakdown` — ningún archivo de esos tocado. `HolidayWorkAssignment` no guarda `multiplier` ni ninguna referencia a liquidación. Test dedicado en el service confirma que `save()` sólo toca el repositorio de `HolidayWorkAssignment` y auditoría (el mock de `prisma` en ese test sólo expone `employee.count` — si el service intentara tocar `timeEntry`/`timeSegment`/`doubleHourRule`, el test fallaría por `undefined is not a function`, no silenciosamente).
- **No se tocó "Sin actividad registrada"**: `attendanceInactivity.service.ts` no se tocó, no se le agregó ninguna consulta a `HolidayWorkAssignment`. Esta etapa deja la base lista (la tabla existe, tiene los datos), pero **no la conecta** — queda explícitamente para 12E.
- **No se crean fichadas**: `HolidayWorkAssignment` no tiene ninguna relación con `AttendancePunch`/`WorkShift`/`TimeSegment`, y ningún código de esta etapa los crea.
- **No se disparan notificaciones**: `holidayWorkAssignment.service.ts` no importa `notifyUsers`/`notifyRrhh`/`systemNotification` en ningún punto — confirmado por lectura del archivo y por test (`auditService.register` es el único efecto secundario, llamado exactamente una vez por operación).
- **No se tocó Turnos existente**: `ShiftTemplate`/`ShiftAssignment`/`shiftAssignment.*` sin cambios de código (sólo se leen, vía `shiftTemplateId` opcional en el nuevo modelo).
- **No se cambiaron permisos globales**: mismo RBAC ya usado por `/shifts/assignments` (lectura 3 roles, escritura sólo RRHH) — ninguna ruta nueva, de ningún módulo, cambia su alcance.
- **No se duplicó el calendario de feriados**: confirmado en §7 — `HolidayWorkAssignment.date` es un valor, no una fuente de verdad; las fechas disponibles siempre se resuelven en vivo contra `DoubleHourRule.kind=FERIADO`.

## 12. Tests

**Backend** (+45 tests, 856 → 901, todos verdes):
- `workforce.service.test.ts` (+4): `holidayDatesInRange` llama a `calendarPreview` con `kind=FERIADO`; devuelve la forma angosta (`date`+`rules[{id,name}]`, nunca multiplier/priority/hasOverlap/hasConflict); una regla "Pedro" `FERIADO` aparece, una "Feriados" `OTRO` no; una regla `DOMINGO` no aparece.
- `holidayWorkAssignment.schemas.test.ts` (+15): rangos de fecha (válido/invertido/>400 días), query de candidatos (defaults de paginación, filtros combinados, tope de `take`), payload de guardado (item mínimo sin turno, item completo, `status` explícito/inválido, horario con formato inválido, array vacío, sin fecha).
- `holidayWorkAssignment.repository.test.ts` (+11): `findCandidates` arma el `where` correcto por sectorId/shiftTemplateId/withoutShift/search/status ACTIVO, combina `accessWhere` con AND sin pisarlo, pagina con skip/take; `findByDate` filtra por fecha+ACTIVA+alcance; `findExisting`/`create`/`update` arman los argumentos exactos a Prisma (incluido `createdByUserId`/`updatedByUserId`).
- `holidayWorkAssignment.service.test.ts` (+15): crear con turno, crear sin turno (`shiftTemplateId: null`), rechaza `employeeId` duplicado en el mismo guardado, reclasificar-vía-update en vez de crear una segunda fila si ya existe, un P2002 real (carrera) se traduce en `AppError` 409 en vez de 500, actualizar horario/notas, cancelar (audita `DEACTIVATE`, no borra), reactivar (audita `ACTIVATE`), un `CANCELADA` sobre algo que nunca existió es no-op, rechaza si algún empleado no existe, confirma que no toca ninguna tabla de liquidación, confirma que no dispara notificaciones, `candidates`/`listByDate` aplican `employeeAccessWhere` del usuario.

**Frontend** (+18 tests, 443 → 461, todos verdes), en `HolidayWorkAssignmentsPage.test.tsx`: empty state sin feriados; lista de feriados; seleccionar fecha; ver candidatos; filtro por turno; filtro por sector; toggle "sin turno"; búsqueda debounced; seleccionar uno; seleccionar todos visibles; deseleccionar visibles; guardar (payload con altas ACTIVA + bajas CANCELADA correctas); al recargar muestra pre-marcados a los ya convocados; copy sin lenguaje técnico; loading state; error state con reintento (feriados y candidatos, 2 tests); un usuario de Supervisión ve la pantalla sin checkboxes ni botón de guardar.

## 13. Validaciones ejecutadas

| Validación | Resultado |
| --- | --- |
| `npx prisma validate` | ✅ |
| `npx prisma generate` | ✅ |
| `npx prisma migrate status` | ✅ 48 migraciones, al día |
| `npm run typecheck` (backend) | ✅ sin errores |
| `npx vitest run` (backend) | ✅ 901/901, 65 archivos |
| `npm run build` (backend) | ✅ |
| `npx tsc -b` (frontend) | ✅ sin errores |
| `npx vitest run` (frontend) | ✅ 461/461, 57 archivos |
| `npm run build` (frontend) | ✅ (chunk `HolidayWorkAssignmentsPage` generado) |
| `git diff --check` | ✅ sin errores de espacios en blanco |
| Verificación visual (Playwright headless contra `localhost:5174`/`:4002`, base real) | ✅ sin errores de consola; empty state correcto (no hay reglas `FERIADO` reales todavía — ver §14); layout limpio en 1440×900 |

## 14. Qué NO se tocó

- El motor de matching/prioridad/scope de Horas Especiales (`doubleHourRuleMatching.ts`) — sin cambios.
- `calendarPreview` (`workforce.service.ts`) — sin cambios de comportamiento; sólo se agregó una función nueva (`holidayDatesInRange`) que lo llama.
- El fichador — ningún archivo tocado.
- Conceptos Horarios (`hour-concepts`) — ningún archivo tocado.
- La notificación "Sin actividad registrada" (`attendanceInactivity.service.ts`) — sin cambios; sigue sin usar `HolidayWorkAssignment` (a propósito, es 12E).
- `ShiftTemplate`/`ShiftAssignment` y sus endpoints existentes — sin cambios de código, sólo lectura (`shiftTemplateId` opcional en el modelo nuevo, filtro por turno en candidatos).
- Permisos/RBAC de cualquier ruta existente — sin cambios.
- `GET /employees/options` — no se extendió ni se tocó; se construyó una query propia en `holidayWorkAssignment.repository.ts` porque ese endpoint no cubre `shiftTemplateId`/`withoutShift` y extenderlo arriesgaba un endpoint compartido usado en más pantallas.
- Cache (frontend y backend) — no se agregó ningún cache nuevo, no se tocó ningún mecanismo existente.
- Las 2 reglas reales de producción ("Domingos", "Feriados") siguen en `OTRO` (12B/12C) — esta etapa no las reclasifica; hasta que RRHH lo haga desde Horas Especiales, esta pantalla no tendrá ningún feriado real disponible (verificado en vivo, ver §13).

## 15. Riesgos pendientes

- **Sin feriados reales clasificados todavía**: verificado contra la base real que hoy no hay ninguna `DoubleHourRule` con `kind=FERIADO` — la pantalla funciona correctamente (empty state) pero no puede probarse de punta a punta con datos reales hasta que RRHH reclasifique al menos una regla desde Horas Especiales.
- **Límite de 300 candidatos sin paginación real en la UI** (§10) — aceptado como límite V1 documentado; requeriría una etapa de UI (botón "cargar más") si el headcount real de una combinación de filtros lo supera.
- **`shiftTemplateId`/horario esperado son sólo informativos** — no se validan contra el `ShiftTemplate` real (por ejemplo, que el horario esperado esté dentro de las tolerancias del turno); es intencional, esta etapa no gobierna asistencia ni fichadas, sólo la expectativa de convocatoria.
- **Sin recálculo retroactivo si una regla deja de ser `FERIADO`**: si RRHH reclasifica una regla de `FERIADO` a otra cosa después de haber creado convocatorias para sus fechas, las filas de `HolidayWorkAssignment` ya creadas **no se borran ni se avisan** — quedan como historial de una convocatoria que ya no correspondería a un feriado "vigente". No se implementó ninguna sincronización automática (mismo criterio que el resto del sistema: sin recálculo retroactivo, deuda ya documentada desde 8A para el motor de liquidación, extendida acá por consistencia). Aceptado explícitamente, no bloqueante.
- **Acción rápida "seleccionar todos del turno" no existe como botón separado** (§8) — decisión de alcance documentada, cubierta por filtro+"seleccionar visibles".

## 16. Próxima etapa sugerida

- **12E** — Usar `HolidayWorkAssignment` para que la notificación "Sin actividad registrada" (`attendanceInactivity.service.ts`) sólo dispare cuando existía expectativa real de actividad: un feriado sin convocatoria activa para ese empleado no debería generar la alerta; un feriado con convocatoria `ACTIVA` sin fichada sí. Requiere decidir explícitamente el comportamiento para días no-feriado (sin cambios, fuera del alcance de `HolidayWorkAssignment`) y para empleados con turno habitual pero sin convocatoria de feriado.

---

No commitear sin aprobación explícita del usuario.
