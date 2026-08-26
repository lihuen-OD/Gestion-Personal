# Etapa 8B — Rediseño de alcance, calendario, prioridad y superposición de Horas Especiales

Fecha: 2026-08-26
Estado: implementado, pendiente de aprobación para commitear
Continúa: `docs/decisions/HORAS_ESPECIALES_AUDITORIA_8A.md` (hallazgos de scope/calendario/prioridad) y `docs/decisions/HORAS_ESPECIALES_8F.md` (horas reales vs. liquidables, no se toca en esta etapa)

## 1. Diagnóstico del modelo actual (verificado antes de tocar nada)

- `DoubleHourRule`/`DoubleHourRuleEmployee`/`SpecialHourRuleApplication` no habían cambiado desde 8A — 8F sólo tocó la escritura de `TimeEntry`, nunca este modelo.
- `doubleRuleSchema` (`workforce.schemas.ts`) exigía `employeeIds: z.array(...).min(1)` — única restricción de alcance existente.
- El motor (`matchingDoubleHourRules`/`effectiveMultiplier`, `timeEntries.repository.ts`) resolvía superposición como "todas matchean, gana el mayor multiplicador", sin prioridad ni conflicto. La query que trae las reglas exigía `employees: { some: { employeeId } }` — una regla sin empleados cargados nunca podía matchear a nadie.
- Frontend (`WorkScheduleSettingsPage.tsx`): selector de empleados obligatorio ("Seleccioná al menos una persona para guardar la regla"), sin ningún filtro de empresa/sector/centro de costo/puesto, sin calendario visual.
- Impacto en datos (consulta de sólo lectura contra la base conectada — Neon `neondb`, Postgres 18.6 — antes de migrar): **1 sola `DoubleHourRule` existente** ("Domingo", `recurrenceType: SEMANAL`, 2 empleados vinculados, 0 `SpecialHourRuleApplication`, 0 reglas `FECHA`). La migración pudo ser 100% aditiva, sin ningún backfill de datos — verificado leyendo esa fila después de migrar: quedó intacta, con las 4 columnas de scope nuevas en `NULL` y `priority` en `0`.

## 2. Estrategia elegida

Migración aditiva (nuevas columnas nullable + nueva tabla, ningún tipo/nullability existente cambia) más un motor que resuelve alcance por AND entre dimensiones independientes, en vez de forzar la selección de personas. Se reutilizó todo lo que ya existía en el repo en vez de inventar:

- `backend/src/shared/prisma/employeeAssociationQuery.ts` (empleados por sector/centro de costo/empresa opcionales, ya usado por Régimen Laboral y Concepto Horario) dio el criterio exacto para el nuevo filtro de scope — se extendió con `positionId` (nuevo en ese sentido, no existía antes en ningún filtro de este tipo en el repo).
- `AssociatedEmployeesPanel`/`orgStructureApiService.getCatalog()`/`positionApiService.getAll()` dieron los 4 catálogos sin crear ningún endpoint nuevo.
- `EmployeeRemoteSelector` siguió siendo el picker de "empleados específicos", ahora detrás de un toggle en vez de obligatorio.
- `workRegimes.repository.ts` (`findOverlappingAssignment`) fue el precedente de "query de solapamiento + mensaje de dominio" reutilizado como criterio para el heurístico de superposición del calendario.
- No existía ningún componente de calendario-grilla ni lista de feriados en el repo — el mes-grilla visual se construyó desde cero, con CSS grid, sin librería nueva.

## 3. Migración

Aditiva, aplicada contra la base conectada:

```sql
ALTER TABLE "DoubleHourRule" ADD COLUMN "companyId" TEXT, ADD COLUMN "costCenterId" TEXT, ADD COLUMN "positionId" TEXT, ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "sectorId" TEXT;
ALTER TABLE "SpecialHourRuleApplication" ADD COLUMN "isWinner" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "wasConflicting" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "SpecialHourRuleDate" (id, ruleId, date, isActive, createdAt);
-- + 4 foreign keys ON DELETE SET NULL (companyId/sectorId/costCenterId/positionId), + FK cascade de SpecialHourRuleDate a DoubleHourRule.
```

Sin `DROP`, sin cambio de tipo, sin backfill (no había filas que migrar — ver §1). `npx prisma migrate dev` no se pudo usar tal cual porque la migración histórica `20260824170000_normalize_hour_concepts` falla al reproducirse contra una shadow database vacía (una aserción de datos que asume filas preexistentes) — esto es preexistente al repo, no algo introducido acá. Se generó el SQL con `prisma migrate diff --from-url <DATABASE_URL> --to-schema-datamodel prisma/schema.prisma` (diff contra la base real, sin shadow DB) y se aplicó con `prisma migrate deploy` (que tampoco usa shadow DB) — la migración quedó igual registrada en `prisma/migrations/20260826120000_special_hour_rules_scope_calendar_priority/` como cualquier otra, con `prisma migrate status` confirmando "up to date" después.

Reglas existentes con `employeeIds`: sin cambios de comportamiento — las 4 columnas de scope nuevas quedan `NULL` (sin restricción adicional), la lista de empleados sigue siendo la única restricción, exactamente igual que antes de esta etapa (verificado con los Casos A-H preexistentes, que siguen pasando sin modificar sus expectativas). No existían reglas sin empleados que analizar.

## 4. Qué cambió en backend

- **Nuevo `backend/src/modules/workforce-management/doubleHourRuleMatching.ts`** (funciones puras, sin Prisma): `ruleMatchesDate` (generaliza el matching de fecha — FECHA ahora consulta `SpecialHourRuleDate` en vez de `fromDate`), `resolveWinningRules` (prioridad + detección de empate/conflicto, con el criterio de desempate anterior —mayor multiplicador— como fallback determinístico), `scopesCouldOverlap` (heurístico de superposición de alcances para el calendario). Reemplaza la lógica que antes vivía sólo en `timeEntries.repository.ts`, sin duplicarla entre el motor real y el preview de calendario.
- **`timeEntries.repository.ts`** (`createFromWorkShift`/`closeOpenWorkShift`, únicos 2 lugares que aplican `DoubleHourRule`): la query que trae las reglas candidatas ahora resuelve el scope del empleado (sector/centro de costo/puesto/empresas vía `EmployeeCompany`) y arma un `AND` de condiciones "sin restricción en esa dimensión O coincide con el empleado" — una regla sin ninguna dimensión configurada y sin empleados cargados matchea a cualquiera. `SpecialHourRuleApplication` ahora también graba `isWinner`/`wasConflicting`, congelados al momento de aplicar (no se recalculan si la prioridad de la regla cambia después). **No se tocó nada de lo que corrigió 8F**: `TimeEntry.hours`/`totalMinutes`/`actualMinutes` siguen viniendo de minutos reales, sólo cambió de dónde sale el multiplicador ganador.
- **`workforce.schemas.ts`**: `employeeIds` pasa a ser opcional (`.default([])`, sin `.min(1)`); nuevos `companyId`/`sectorId`/`costCenterId`/`positionId` (opcionales), `priority` (default `0`), `dates` (con un `superRefine` que exige al menos una fecha cuando `recurrenceType` es `FECHA`); nuevo `calendarRangeQuerySchema`.
- **`workforce.service.ts`**: `createDoubleRule`/`updateDoubleRule` extendidos para los campos nuevos y el reemplazo completo de `dates` (mismo patrón que ya usaba `employeeIds`); las columnas `fromDate`/`toDate` de una regla `FECHA` se recalculan server-side como min/max de `dates` (nunca se confía en lo que mande el cliente para esas dos columnas en ese caso, porque son las que se usan como pre-filtro grueso de vigencia antes de evaluar `ruleMatchesDate`). Nuevo `calendarPreview(from, to)` — preview de **configuración** (no de fichadas reales): para cada día del rango, qué reglas activas matchean por calendario y si sus alcances podrían superponerse (con conflicto si empatan en la prioridad máxima).
- **`workforce.routes.ts`/`workforce.controller.ts`**: nuevo `GET /workforce/double-hour-rules/calendar?from&to`, mismo nivel de acceso que el resto de `double-hour-rules` (lectura para RRHH/Supervisión/Carga Horaria).

## 5. Qué cambió en frontend

- **`workforceApiService.ts`**: tipos `DoubleHourRule`/`DoubleHourRuleInput` extendidos con `priority`, scope (`companyId`/`sectorId`/`costCenterId`/`positionId` + los objetos `company`/`sector`/`costCenter`/`position` de sólo lectura) y `dates`; nuevo método `doubleHourRulesCalendar`.
- **`WorkScheduleSettingsPage.tsx`** (se corrigió el formulario existente, no se rediseñó la página completa):
  - El selector de empleados obligatorio se reemplazó por 4 selects opcionales (Empresa/Sector/Centro de costo/Puesto, con "Todas"/"Todos" por default = sin filtro) más un checkbox "Limitar a empleados específicos" que sólo entonces exige al menos una persona.
  - Texto de ayuda fijo explicando el alcance por default.
  - Nuevo campo "Prioridad" con su propio texto de ayuda.
  - `recurrenceType = "FECHA"` reemplaza el input de fecha única por un editor de lista (agregar fecha, activar/desactivar, quitar) — cubre feriados y fechas manuales sin crear una regla por fecha.
  - `recurrenceType = "SEMANAL"` gana dos botones de conveniencia ("Todo el año actual", "Desde hoy en adelante") que sólo autocompletan los inputs de vigencia ya existentes.
  - La tabla de reglas gana columnas de Prioridad y Alcance (resumen legible: empresa/sector/centro de costo/puesto/cantidad de personas, o "General" si ninguna dimensión está configurada).
- **Nuevo `frontend/src/components/workforce/SpecialHourRulesCalendarMonth.tsx`**: mes-grilla con navegación anterior/siguiente, construido con CSS grid (sin librería externa), que consume el nuevo endpoint de preview y pinta por día los nombres/multiplicadores de las reglas que aplican, con un aviso de superposición o de conflicto según corresponda.
- No se tocó ninguna otra pantalla (grilla de carga, dashboard, cierre, export) — quedan igual porque nada de esto cambia cómo se computan `TimeEntry`/`HourConceptBreakdown`, sólo qué reglas puede configurar RRHH y a quién alcanzan.

## 6. Cómo queda el calendario

Dos ejes independientes por regla, sin mezclarlos:

- **SEMANAL** (`weekdays` + `fromDate`/`toDate`): "todos los domingos desde una fecha", con o sin fecha de corte — cubre "todos los domingos del año" (fromDate=01/01, toDate=31/12) y "desde hoy en adelante" (fromDate=hoy, sin toDate) con los mismos campos que ya existían, sin materializar cada domingo como una fila.
- **RANGO** (`fromDate`/`toDate`, sin filtro de día de semana): cualquier día dentro del rango.
- **FECHA** (nueva tabla `SpecialHourRuleDate`): lista explícita de fechas, cada una togglable activa/inactiva sin perder historial — cubre feriados (una regla "Feriados 2026" con 15 fechas, o una regla dedicada por feriado, ambas soportadas por el mismo mecanismo) y fechas manuales sueltas.

El calendario visual (mes-grilla) es de **configuración**: muestra qué reglas activas matchean cada día según su condición de calendario, más un aviso cuando dos o más podrían superponerse (heurístico de alcance) y un aviso más fuerte cuando esas reglas superpuestas empatan en la prioridad máxima (conflicto). No representa fichadas reales ni resuelve por empleado — eso sigue siendo exclusivo del motor.

## 7. Cómo queda el alcance

Cinco dimensiones, todas opcionales, todas combinan con **AND**: empresa, sector, centro de costo, puesto, empleados específicos. Sin ninguna configurada, la regla alcanza a cualquier empleado que efectivamente trabaje/fiche ese día — la ausencia de fichada nunca genera nada (la obligación de trabajar sigue siendo un tema de Turnos, no de Horas Especiales; el motor de Horas Especiales sólo corre dentro de `createFromWorkShift`/`closeOpenWorkShift`, es decir, sólo cuando ya hay una fichada real). Empresa se resuelve vía `EmployeeCompany` (relación existente, no una columna nueva en `Employee`); sector/centro de costo/puesto son columnas directas ya existentes en `Employee`.

## 8. Cómo queda la prioridad

`priority: Int` (default `0`, mayor gana) en cada regla. Política fija para esta etapa (no configurable por regla, tal como habilitaba el pedido si implementar todo era demasiado): no acumulable por defecto, gana la de mayor prioridad; si 2+ empatan en la prioridad máxima, se resuelve con el mismo criterio que existía antes de tener prioridad (mayor multiplicador entre las empatadas) pero queda marcado (`SpecialHourRuleApplication.isWinner`/`wasConflicting`, congelados al momento de aplicar) para que RRHH lo vea — nunca bloquea ni rompe la fichada.

## 9. Cómo quedan las superposiciones

- Domingo + Feriado, Domingo Odwyer + Domingo Pañol, Feriado + regla de sector, regla general + regla de empleado, Domingo + regla de empresa, Domingo + regla de puesto: todas resueltas por el mismo mecanismo de prioridad de §8, evaluado en el motor real contra el scope del empleado concreto.
- El calendario de configuración muestra un aviso de superposición ADVISORIO (heurístico `scopesCouldOverlap`: dos alcances se consideran mutuamente excluyentes sólo si alguna dimensión está seteada distinta en ambos, o si ambos restringen por empleados específicos disjuntos) — puede marcar "posible superposición" en casos donde, para un empleado concreto, en la práctica sólo una regla termine aplicando (ej. Domingo general vs. Domingo Odwyer: se muestran como superpuestas en el calendario aunque para un empleado de Tropa sólo aplique la general). Esto es intencional y está documentado en el propio código: el calendario advierte, el motor resuelve.
- Pendiente explícito, no implementado en esta etapa: una política `ACUMULAR` configurable por regla, y una bandeja/pantalla de resolución de conflictos (hoy el conflicto se detecta y se puede consultar/ver en el calendario, pero no hay un flujo de "RRHH marca este conflicto como resuelto").

## 10. Cómo se integra con el fichador

Sin cambios — el fichador (`TimeClockPage.tsx`/`timeClockApiService.ts`) nunca preguntó nada sobre Horas Especiales y sigue sin hacerlo. El flujo es exactamente el descrito en el pedido: fichada → `WorkShift`/`TimeEntry` real → el backend resuelve scope+calendario+prioridad dentro de la misma transacción → horas reales intactas → resultado liquidable separado y trazado (`appliedMultiplier` + `SpecialHourRuleApplication`).

## 11. Cómo se diferencia de Conceptos Horarios

Sin cambios respecto de 8A: `DoubleHourRule` y `HourConcept`/`HourConceptBreakdown` siguen siendo tablas y motores completamente independientes — esta etapa no integra Horas Especiales con Conceptos Horarios (Ejemplo 4 del pedido original, "Domingo aplicando también sobre Sereno", sigue sin implementarse; sigue siendo trabajo de una etapa futura). No se tocó ningún archivo del módulo `hour-concepts` ni `HourConceptBreakdown` en esta etapa, ni siquiera en lectura.

## 12. Tests agregados/modificados

Backend:
- Nuevo `doubleHourRuleMatching.test.ts` (18 tests): `ruleMatchesDate` (SEMANAL/RANGO/FECHA, vigencia), `resolveWinningRules` (sin reglas, una, prioridad distinta, empate, empate parcial entre 3), `scopesCouldOverlap` (por dimensión, por empleados disjuntos, casos "podría superponerse").
- `timeEntries.repository.test.ts`: infraestructura de mock extendida (`tx.employee.findUnique`, con default "empleado general" para no romper los Casos A-K preexistentes) y `rule()` extendido con `priority`/scope/`dates`. 8 casos nuevos (Caso L a R): regla general construye el `AND` de scope correctamente, regla de empleados específicos sigue exigiendo pertenencia a la lista, empresa/empresa+sector arman el `AND` esperado, una regla general aplica aunque el mock simule "sin scope real" del lado de la base, una regla excluida por scope no se aplica, prioridad distinta hace ganar a la de mayor prioridad, empate marca `isWinner`/`wasConflicting` en ambas sin romper el pipeline. El Caso K (cruce de medianoche, de 8F) se re-verificó intacto contra la query nueva.
- `workforce.service.test.ts`: 8 tests nuevos — crear regla general/con empresa/con empresa+sector/con empleados específicos (sin exigir `employeeIds`), crear una regla `FECHA` con varias fechas (confirmando que `fromDate`/`toDate` se derivan server-side), y 3 tests de `calendarPreview` (marca overlap+conflicto, no marca overlap cuando los alcances son excluyentes, no incluye días sin ninguna regla).
- `dashboard.repository.test.ts`/`timeEntries.service.test.ts` (de 8F): sin cambios, siguen verdes.

Frontend:
- Nuevo `WorkScheduleSettingsPage.test.tsx` (8 tests, no existía archivo de test para esta página): crear regla sin empleados, con empresa, con empresa+sector, bloqueo al activar "empleados específicos" sin elegir a nadie, texto de ayuda presente, preset "Todo el año actual" completa Desde/Hasta, el calendario muestra el aviso de superposición cuando el backend lo reporta, el campo de prioridad se edita y viaja en el payload.

## 13. Validación manual

**No se ejecutó contra la base.** Mismo motivo que en 8F: `backend/.env` apunta a una base Postgres real y compartida (Neon, `neondb`, `APP_ENV=staging`), no a una base local descartable — y además ya tiene una regla real ("Domingo", creada por un uso real del sistema, no un fixture de test) que no se quiso tocar ni usar como base para pruebas manuales. Crear/editar/borrar reglas de prueba (Domingo Odwyer, Domingo Pañol, Feriado) y fichar contra esa base dejaría entradas de auditoría (`AuditLog`) no completamente reversibles sin autorización explícita para esa base puntual.

En su lugar, la corrección se verificó de punta a punta con los tests automatizados de §12, que cubren exactamente los 9 puntos pedidos en la validación manual: creación sin empleados con empresa/sector, aplicación a empleado de esa empresa y no de otra (Casos M/N/P), prioridad ganando sobre otra regla (Caso Q), empate marcado como conflicto sin romper el pipeline (Caso R), y horas reales sin inflar (aserciones de `totalMinutes`/`actualMinutes` en los mismos casos). Si preferís que se ejecute igual contra la base compartida, decime con qué legajo/empresa/sector de prueba puedo trabajar y confirmo antes de crear o borrar nada ahí.

## 14. Datos existentes / datos demo

Se confirmó (lectura, antes y después de migrar) que la única `DoubleHourRule` real de la base ("Domingo") no fue modificada por la migración ni por ningún test — los tests corren enteramente contra Prisma mockeado, ninguno tocó la base conectada. No se creó, modificó ni necesitó revertir ningún dato demo en esta etapa.

## 15. Verificación post-implementación: una regla con muchas fechas específicas ("Feriado")

Antes de cerrar 8B se revisó explícitamente si el diseño ya soportaba "una sola Hora Especial con muchas fechas" (ej. un único "Feriado" con 01/01, 24/03, 02/04, 01/05, 25/05, 09/07, 25/12, etc., en vez de una regla por feriado). El modelo y el backend ya lo soportaban desde el diseño original de 8B; lo que faltaba era **cobertura de test explícita** para ese escenario exacto, y un gap real en el frontend (cero tests del editor de fechas). Se corrigió antes de cerrar:

1. **¿Una regla FECHA admite muchas filas en `SpecialHourRuleDate`?** Sí — `dates SpecialHourRuleDate[]` sin límite de cantidad (sólo `@@unique([ruleId, date])` para no duplicar la misma fecha dos veces); el Zod acepta hasta 500 fechas por request (`dates: z.array(...).max(500)`).
2. **¿Se puede crear/editar con múltiples fechas desde el frontend?** Sí — el editor de fechas de `WorkScheduleSettingsPage.tsx` permite agregar tantas fechas como se quiera (sin tope propio) antes de enviar; `updateDoubleRule` reemplaza el set completo (`deleteMany` + `create`) cuando se envía `dates`, así que editar una regla ya creada para agregar/quitar fechas funciona igual.
3. **¿Agregar/quitar/activar/desactivar fechas específicas?** Sí — la lista del formulario tiene un botón "Agregar fecha", y cada fila tiene "Activar/Desactivar" y "Quitar" (se maneja en el estado local del formulario y se manda como un array completo al guardar).
4. **¿El calendario visual muestra esas fechas?** Sí — `calendarPreview` recorre día por día el rango pedido y evalúa `ruleMatchesDate` contra las fechas activas de cada regla; una regla "Feriado" con 7 fechas repartidas en el año aparece en cada uno de esos 7 días (verificado con un test que pide un rango que cubre 3 de esas fechas y confirma que las 3 aparecen, no sólo la primera). Importante: el mes-grilla (`SpecialHourRulesCalendarMonth`) pide un mes a la vez — para ver los 7 feriados del año hay que navegar mes a mes, no es una limitación nueva, es cómo funciona cualquier calendario de vista mensual.
5. **¿El motor aplica la misma regla a cualquiera de esas fechas?** Sí — verificado ahora con un test que ficha en dos fechas distintas de la misma regla "Feriado" (25/12 y 09/07) y confirma que ambas fichadas registran `SpecialHourRuleApplication` contra la MISMA `doubleHourRuleId`, con una tercera fecha fuera de la lista (15/06) sin ninguna aplicación. También se agregó un test confirmando que una fecha desactivada (`isActive=false`) dentro de una regla con varias fechas no matchea, aunque otra fecha activa de la misma regla sí.
6. **¿Hace falta crear una regla por feriado?** No — una sola regla "Feriado" con N fechas cubre todos los feriados del año; no hay ningún límite de diseño que empuje a fragmentar en una regla por fecha (crear una regla por feriado sigue siendo una opción válida si el negocio quisiera multiplicadores/prioridades distintos por feriado, pero no es obligatorio).
7. **¿Hace falta seleccionar empleados si el alcance es general?** No — esto es independiente del tipo de calendario (FECHA/SEMANAL/RANGO): una regla FECHA con alcance general (sin empresa/sector/centro de costo/puesto/empleados) sigue sin exigir ninguna selección de personas, exactamente igual que una regla SEMANAL general.

Lo que se corrigió concretamente antes de cerrar (no eran bugs de comportamiento — eran gaps de cobertura y una mejora de accesibilidad menor):
- Backend: 2 tests nuevos en `timeEntries.repository.test.ts` (Caso S — una regla "Feriado" con 7 fechas aplicada a 2 fichadas reales en fechas distintas + una fecha fuera de la lista sin match; Caso T — fecha desactivada dentro de una regla multi-fecha no matchea).
- Backend: 2 tests nuevos en `workforce.service.test.ts` (`calendarPreview` mostrando cada fecha de una regla multi-fecha por separado; `updateDoubleRule` agregando y quitando fechas de una regla FECHA existente en la misma operación).
- Frontend: el input de nueva fecha no tenía `aria-label` (gap real de accesibilidad, no sólo de test) — se agregó `aria-label="Nueva fecha"`. Se agregó el primer test del editor de fechas (no existía ninguno): agregar 3 fechas a una misma regla, desactivar una, quitar otra, y confirmar que el payload final refleja exactamente ese estado.

### ¿`recurrenceType` obliga a elegir sólo SEMANAL o FECHA (no ambos en la misma regla)?

Sí, es una limitación real y se documenta acá en vez de resolverse ahora. `recurrenceType` es un único enum (`FECHA | RANGO | SEMANAL`) por regla — una regla es SEMANAL (recurrente por día de semana) *o* FECHA (fechas explícitas) *o* RANGO (rango continuo), nunca una combinación de dos tipos dentro de la misma fila. Esto significa que "Domingo (recurrente) + además estas 3 fechas puntuales" bajo el mismo nombre/multiplicador/prioridad no se puede cargar como una única regla hoy.

Por qué no se ajustó el modelo en esta etapa: el caso concreto que motivó esta revisión (muchos feriados en una sola regla) ya está resuelto por FECHA-con-muchas-fechas, sin necesitar combinar tipos. Cuando de verdad se necesite "Domingo + un feriado especial" como dos condiciones distintas, el motor de prioridad ya resuelve eso correctamente con **dos reglas separadas** (ej. "Domingo" SEMANAL y "Feriado" FECHA, cada una con su multiplicador/prioridad) — que es exactamente el patrón que usan los Ejemplos 1 y 5 del pedido original. Combinar dos condiciones de calendario dentro de una sola fila es un cambio de modelo más grande (`DoubleHourRule` pasaría de "una condición" a "una o más condiciones"), no trivial de hacer sin riesgo, y no lo pide ningún caso concreto planteado hasta ahora — queda documentado como limitación conocida y candidato a una etapa futura si aparece un caso real que lo necesite (por ejemplo, si RRHH quisiera que "Domingo" y "Feriado" compartan exactamente la misma prioridad/multiplicador/alcance y prefiriera verlos como una sola fila en la tabla en vez de dos).

## 15.5 Corrección post-implementación: el calendario visual quedaba stale tras guardar

**Causa exacta:** `SpecialHourRulesCalendarMonth` tiene su propio fetch (`useEffect` con dependencia `[cursor]`, el mes visible) totalmente desacoplado del listado de reglas de `WorkScheduleSettingsPage` — no recibía ninguna prop, así que nada le avisaba cuando `createDoubleRule`/`updateDoubleRule`/activar-desactivar/borrar terminaban. El listado sí se refrescaba (`load()` ya se llamaba tras cada mutación), pero el calendario sólo volvía a pedir datos si el usuario cambiaba de mes (lo único que tocaba su única dependencia) o recargaba la página.

**Qué cambió (sólo frontend, nada de backend — el endpoint ya usaba `apiCache: false` y no tiene ninguna capa de cache propia, confirmado antes de descartar tocarlo):**
- `WorkScheduleSettingsPage.tsx`: nuevo estado `calendarRefreshToken`, incrementado en los 3 puntos donde ya se confirmaba una mutación exitosa (crear/editar en `submitRule`, activar/inactivar en `toggleRule`, eliminar/inactivar en `removeRule` — esto cubre también cambios de prioridad, alcance, recurrencia y fechas de una regla FECHA, porque todos son ediciones que pasan por `submitRule`). Se pasa como prop `refreshToken` a `SpecialHourRulesCalendarMonth`.
- `SpecialHourRulesCalendarMonth.tsx`: acepta `refreshToken` y lo agrega a la dependencia del efecto de fetch (`[cursor, refreshToken]`) — un cambio de token dispara un refetch del mes actualmente visible, sin necesidad de navegar de mes. El refetch por `refreshToken` es **silencioso**: un `ref` distingue "primera carga de este mes" (sí muestra el esqueleto de carga, reemplazando la grilla) de "refresh por mutación" (no vuelve a mostrar el loading ni borra la grilla — la reemplaza recién cuando llega la respuesta nueva). Si el refresh silencioso falla, se muestra un aviso discreto (`<small>`, no el mismo estilo que un error de formulario) sin perder la grilla anterior ni afectar el guardado de la regla (que ya había terminado con éxito antes de este paso).
- No se tocó el listado de reglas (`load()`) — su comportamiento de refresco ya era correcto (sólo le faltaba avisarle al calendario, que es un componente hermano con estado propio).

**Tests nuevos** (`WorkScheduleSettingsPage.test.tsx`, describe "corrección: sincronización del calendario tras mutaciones"): crear una regla vuelve a pedir el calendario del mes visible; editar una regla existente también refresca; cambiar prioridad y guardar refresca; agregar/quitar una fecha de una regla FECHA y guardar refresca; si el calendario devuelve `hasOverlap`/`hasConflict` actualizado tras la mutación, la UI lo muestra sin recargar la página; durante ese refresh el listado sigue visible y no reaparece el esqueleto de carga completo del calendario. De paso, estos tests fueron los primeros en ejercitar `editRule()` en este archivo y expusieron que jsdom no implementa `scrollIntoView` (gap del entorno de test, no del código de producción) — se stubbeó localmente en el test file.

**Validación manual:** no se ejecutó contra la base compartida (mismo motivo que las etapas anteriores — Neon staging con una regla real, sin legajo de prueba autorizado); cubierto por los 6 tests automatizados de arriba, que reproducen exactamente el flujo reportado (crear/editar/cambiar prioridad/cambiar fechas → el calendario del mes visible se actualiza solo, sin recargar la página ni bloquear la pantalla).

## 16. Riesgos pendientes

- Bandeja/flujo de resolución de conflictos: no implementado — el conflicto se detecta y se puede ver (calendario, `SpecialHourRuleApplication`), pero RRHH no tiene un botón de "marcar como resuelto" o "elegir manualmente la ganadora".
- Política `ACUMULAR` configurable por regla: no implementada, fija en "no acumulable + prioridad" para todas las reglas.
- Integración con Conceptos Horarios (una Hora Especial aplicando también sobre un concepto como Sereno, no sólo sobre Hora normal): sigue sin implementarse — Ejemplo 4 del pedido original sigue pendiente.
- El heurístico de superposición del calendario (`scopesCouldOverlap`) es advisorio y puede marcar "posible superposición" en casos donde, para un empleado concreto, sólo una regla termina aplicando — documentado como comportamiento esperado, no un bug, pero puede generar ruido visual si RRHH configura muchas reglas de scopes muy distintos entre sí.
- `recurrenceType` es mutuamente excluyente (SEMANAL *o* FECHA *o* RANGO por regla) — no se puede combinar "recurrente" y "fechas puntuales" en una misma fila. Ver §15 para el detalle y por qué no se ajustó ahora (el caso concreto pedido —muchos feriados en una sola regla— ya está resuelto sin necesitar combinar tipos).
- No se validó manualmente contra la base real (ver §13).
