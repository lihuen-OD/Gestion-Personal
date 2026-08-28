# Etapa 11C — Bandeja por persona y consistencia final de revisión

Fecha: 2026-08-28
Estado: implementado, pendiente de aprobación para commitear
Continúa: `docs/decisions/HOURS_GRID_REVIEW_SPECIAL_HOURS_AUDIT_11A.md`, `docs/decisions/HOURS_GRID_SPECIAL_HOURS_LIQUIDABLE_11A1.md`, `docs/decisions/HOURS_REVIEW_EXPORT_CLOSURE_SPECIAL_HOURS_11B.md`

## 0. Documentos leídos

`HORAS_ESPECIALES_AUDITORIA_8A.md`, `HORAS_ESPECIALES_8B.md`, `HOURS_GRID_REVIEW_SPECIAL_HOURS_AUDIT_11A.md`, `HOURS_GRID_SPECIAL_HOURS_LIQUIDABLE_11A1.md`, `HOURS_REVIEW_EXPORT_CLOSURE_SPECIAL_HOURS_11B.md`, `CONCEPTOS_HORARIOS_ADITIVOS.md`, `PERFORMANCE_STANDARDS.md`, `CLAUDE.md`, `AGENTS.md` — más lectura directa de código actual: `timeEntries.repository.ts` (`findManyByEmployeeGrouped`, `buildReviewByEmployeeWhere`), `timeEntries.controller.ts` (cache), `HoursPage.tsx` (vista "Por persona").

## 1. Resumen ejecutivo

11B corrigió la Bandeja "Por registro" pero dejó explícitamente pendiente la vista "Por persona" (pestaña "Por persona" dentro de `/pendientes`), alimentada por un endpoint completamente distinto (`findManyByEmployeeGrouped`, no `findMany`). Diagnóstico confirmado: ese endpoint **ni siquiera consultaba** `appliedMultiplier` ni `HourConceptBreakdown` — no es que el dato se perdiera en el mapeo (como en 11B), directamente no se pedía. Quedaba ciega no sólo a Horas Especiales sino también a Conceptos Horarios (no mostraba ninguna columna "Especiales" siquiera). Se corrigió replicando exactamente el mismo patrón de agregación ya usado en `findPeriodEmployees` (11A.1) y `buildAdditiveTimeGrid` (11B): el multiplicador ganador de la Hora normal de cada día/empleado también se aplica a los Conceptos Horarios cargados ese mismo día. Cache/refetch confirmados ya correctos (mismo cache backend y mismas invalidaciones que "Por registro", sin cambios necesarios). No se tocó `schema.prisma`, no hubo migraciones, no se tocó el motor de reglas, no se tocó Conceptos Horarios, no se tocó carga manual ni fichador.

## 2. Mapa — Bandeja "Por persona" (antes de esta etapa)

1. **Dónde está implementada**: `frontend/src/pages/HoursPage.tsx`, dentro de `pendingOnly` (ruta `/pendientes`), pestaña "Por persona" (`groupByPerson=true`).
2. **Endpoint**: `GET /time-entries?view=byEmployee&status=EN_REVISION&period=...` → `timeEntryApiService.listByEmployee()`.
3. **Backend**: mismo controller `list` que "Por registro" (`GET /time-entries`), pero `timeEntriesService.list()` rutea internamente a `findManyByEmployeeGrouped` cuando `query.view === "byEmployee"` — una función completamente distinta de `findMany`, no una variante del mismo query.
4. **Cómo agrupaba**: `tx.timeEntry.findMany({where:{employeeId:{in}, status, period, hourConcept:{systemRole:"NORMAL_BASE"}}, select:{employeeId, hours}})` — sumaba `hours` en un `Map<employeeId, number>`. Nada más.
5. **Totales que mostraba**: sólo `total` (suma de horas reales de Hora normal). Ni siquiera "Especiales" (Conceptos Horarios) aparecía — a diferencia de la grilla principal y de "Por registro" (que si bien tampoco mostraba Conceptos como columna propia, al menos el dato viajaba en cada `TimeEntry`).
6-10. **¿Recibía `appliedMultiplier`/`specialHourLiquidableTotal`/`specialHourAdditionalHours`/conceptos alcanzados/conflictos?** Ninguno — el `select` era `{employeeId, hours}`, no traía nada de eso.
11. **¿Se perdía en el mapeo frontend?** No — a diferencia de 11B (donde el backend sí mandaba el dato y el frontend lo descartaba), acá el bug es 100% backend: el dato ni se consultaba.
12/13. **¿Backend ya lo exponía?** No, había que agregarlo — no era sólo "mostrar lo que ya llega".
14. **¿Mismo endpoint que "Por registro"?** No — comparten la ruta HTTP (`GET /time-entries`) pero `?view=byEmployee` ejecuta una función de repositorio completamente distinta (`findManyByEmployeeGrouped` vs. `findMany`), con su propio `select` y su propia agregación.
15. **Manual vs. automático**: sin diferencia de tratamiento — el `Map` por `employeeId` suma ambos por igual, no filtra por `source`.

## 3. Relación con la Bandeja "Por registro"

Antes de esta etapa, "Por persona" era la única vista de todo el flujo de Horas Especiales (grilla, detalle, "Por registro", export) que no tenía ningún camino de datos hacia `DoubleHourRule`/`SpecialHourRuleApplication`. Después de esta etapa, usa exactamente el mismo criterio que "Por registro" (11B) y la grilla principal (11A.1): el multiplicador se lee desde `TimeEntry.appliedMultiplier` (ya resuelto al escribir, sin re-evaluar reglas), y se aplica también a `HourConceptBreakdown` del mismo día/empleado. La diferencia de forma es intencional y se mantiene: "Por registro" muestra el indicador por fila individual (un `TimeEntry` puntual); "Por persona" lo muestra agregado por período/empleado (mismo criterio que la columna "Total" de la grilla principal).

## 4. Horas reales vs. liquidables

Invariante intacto: `entry.hours`/`totalMinutes`/`breakdown.minutes` no se tocan en ningún punto de `findManyByEmployeeGrouped`. El `total` (real) sigue siendo exactamente la suma de horas reales de Hora normal, sin cambios de fórmula. Lo nuevo (`specialHourAdditionalHours`, `specialHourLiquidableTotal`) se deriva en lectura, en un `Map` aparte, y se expone como campos adicionales del `summary` — nunca reemplaza a `total`.

## 5. Conceptos Horarios vs. Horas Especiales

Sin mezcla: no se agregó ninguna columna "Especiales" (Conceptos) a esta vista (no estaba pedido, ni existía antes) — sólo se agregó el indicador de Horas Especiales, con nombres de campo (`specialHour*`) y copy ("Total liquidable", tooltip con "Hora especial aplicada"/"Conflicto de reglas") consistentes con 11A/11A.1/11B, sin ningún texto que confunda ambos dominios.

## 6. Caso obligatorio — 8 normales + 4 Sereno + x2 = 24 liquidables

Verificado con test backend y frontend: el badge en la fila de la persona muestra "Total liquidable: 24.00 h" con tooltip nombrando la regla ("Domingo"), mientras la celda de "Total en revisión" sigue mostrando "8.00 h" (real, sin inflar) — igual separación que ya se ve en la grilla principal, el detalle por legajo y "Por registro".

## 7. Bugs encontrados

1. **`findManyByEmployeeGrouped` no consultaba `appliedMultiplier` ni `HourConceptBreakdown`** — la vista "Por persona" quedaba completamente ciega a Horas Especiales, el único punto del flujo de Carga Horaria/Bandeja/Export donde esto seguía pasando después de 11B.

No se encontraron bugs de cache/refetch, ni de permisos/scope (ver §12).

## 8. Correcciones realizadas

**Backend** (`timeEntries.repository.ts`, `findManyByEmployeeGrouped`):
- El `select` del `TimeEntry` agrega `day`, `appliedMultiplier` y `timeSegment.specialHourRuleApplications` (filtrado `isWinner: true`, mismo patrón que `findPeriodEmployees`/`findForExport`/`buildAdditiveTimeGrid`).
- Se agrega una consulta a `HourConceptBreakdown` (sólo cuando `query.period` está presente, evitando una consulta innecesaria si no hay período — Parte 5.10 del pedido).
- Se calcula, por empleado: `specialHourAdditionalHours` (adicional total, Hora normal + Conceptos Horarios del mismo día), `specialHourLiquidableTotal` (real + adicional), `specialHourRuleNames` (unión de reglas ganadoras de todos los días del período), `specialHourConflict` (true si algún día tuvo empate de prioridad).

**Frontend** (`HoursPage.tsx`, `timeEntryApiService.ts`):
- `listByEmployee()` mapea los 4 campos nuevos (con defaults seguros si el backend no los manda).
- La celda "Total en revisión" de la vista "Por persona" agrega un badge "Total liquidable: X h" (tono `warning`, o `danger` si hay conflicto) cuando `specialHourAdditionalHours > 0`, con tooltip mostrando la(s) regla(s) y el aviso de conflicto — mismo patrón visual ya usado en la grilla principal y en "Por registro".

## 9. Qué NO se tocó

- `schema.prisma` — ninguna columna, ningún modelo, ninguna migración.
- El motor de matching/prioridad/scope (`doubleHourRuleMatching.ts`) — no se tocó, se reutilizó el multiplicador ya resuelto.
- Conceptos Horarios (`hour-concepts`) — ningún archivo tocado, sólo se leyó `HourConceptBreakdown` (ya se leía desde otros consumidores).
- Carga manual y fichador — sin cambios; no se encontró ningún bug de integración que lo requiriera.
- `buildReviewByEmployeeWhere`/`employeeAccessWhere` — sin cambios, el alcance por rol sigue exactamente igual.
- La vista "Por registro" — sin cambios en esta etapa (ya corregida en 11B).
- Cache backend/frontend — confirmado ya correcto (§12), sin cambios.
- Cálculo de horas reales — `hours`/`totalMinutes`/`minutes` sin cambios en ningún camino.
- No se rediseñó la Bandeja — mismo layout, mismas columnas, mismas acciones ("Ver detalle"), sólo un indicador agregado a una celda existente.

## 10. Performance / cache / refetch (Parte 7)

Confirmado sin bugs, sin cambios necesarios:
- `listByEmployee()` (frontend) usa `apiRequest` directo, **sin** capa de cache de frontend (`cachedData`) — siempre pide datos frescos al backend.
- El backend cachea `GET /time-entries` (ambas vistas, `flat` y `byEmployee`, comparten `timeEntriesListCache` con clave por `req.originalUrl`, que incluye el query string completo) — TTL corto, invalidado por `clearTimeEntriesReadCaches()` en los mismos mutadores que ya invalidan "Por registro" (crear/actualizar/aprobar/rechazar/devolver `TimeEntry`, fichador). Como no se agregó ninguna ruta de escritura nueva, esta invalidación ya cubre correctamente los campos nuevos.
- No se blanquea la bandeja durante el refresh (mismo patrón `reviewLoading`/estado previo visible ya usado, sin cambios).

## 11. Tests agregados/modificados

**Backend** (+9 tests sobre `timeEntries.repository.test.ts`, total 844, todos verdes): caso obligatorio (8+4 Sereno x2 → total real 8, liquidable 24); sin ninguna Hora Especial (adicional 0, liquidable=total); carga manual sin `timeSegment` (multiplicador/liquidable correctos, sin nombre de regla); conflicto de prioridad (`specialHourConflict=true`); no consulta `HourConceptBreakdown` si la query no trae `period` (evita consulta innecesaria).

**Frontend** (+5 tests sobre `HoursPage.test.tsx`, total 429, todos verdes): caso obligatorio (badge "Total liquidable: 24.00 h", total real "8.00 h" separado); sin Horas Especiales no muestra indicador; conflicto usa tono más fuerte y lo menciona en el tooltip; acción "Ver detalle" sigue disponible sin cambios; sin texto técnico visible.

## 12. Validaciones ejecutadas

| Validación | Resultado |
| --- | --- |
| `npx prisma validate` (backend) | ✅ schema válido |
| `npx prisma generate` (backend) | ✅ |
| `npx prisma migrate status` (backend) | ✅ "Database schema is up to date!" (46 migraciones, sin cambios) |
| `npm run typecheck` (backend) | ✅ sin errores |
| `npx vitest run` (backend) | ✅ 844/844 tests |
| `npm run build` (backend) | ✅ |
| `npx tsc -b` (frontend) | ✅ sin errores |
| `npx vitest run` (frontend) | ✅ 429/429 tests, 56 archivos |
| `npm run build` (frontend) | ✅ |
| `git diff --check` | ✅ sin errores de espacios en blanco |

## 13. Riesgos pendientes

- Mismos riesgos heredados de 11A/11A.1/11B (sin trazabilidad de regla nombrada para carga manual, sin bandeja de resolución de conflictos, cierre sin captura de liquidable histórico) — ninguno agravado ni resuelto por esta etapa.
- El agregado de reglas por empleado (`specialHourRuleNames`) es una unión simple de todas las reglas ganadoras de cualquier día del período — si una persona tuvo Domingo un día y Feriado otro, el tooltip lista ambas juntas sin indicar qué día correspondió a cuál. Es información suficiente para el nivel de resumen que pide esta vista (no reemplaza al detalle por legajo, que sí es día por día) — documentado como comportamiento esperado, no un bug.

## 14. Reglas futuras / recomendaciones

- Con esto, los 4 consumidores principales del flujo de Carga Horaria (grilla, detalle por legajo, Bandeja completa, export) están alineados a la misma fórmula de liquidable. La próxima extensión natural, si se prioriza, sería el export/dashboard agregando el mismo nivel de detalle por regla que hoy sólo tiene el detalle por legajo (día por día).
- Si en algún momento se autoriza tocar schema, la trazabilidad completa de carga manual (`SpecialHourRuleApplication` sin depender de `TimeSegment`) resolvería la limitación que hoy se repite en los 4 consumidores por igual.

---

No commitear sin aprobación explícita del usuario.
