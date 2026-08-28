# Etapa 11B — Extender Horas Especiales a Detalle, Bandeja, Export y Cierre

Fecha: 2026-08-28
Estado: implementado, pendiente de aprobación para commitear
Continúa: `docs/decisions/HOURS_GRID_REVIEW_SPECIAL_HOURS_AUDIT_11A.md`, `docs/decisions/HOURS_GRID_SPECIAL_HOURS_LIQUIDABLE_11A1.md`

## 0. Documentos leídos

`HORAS_ESPECIALES_AUDITORIA_8A.md`, `HORAS_ESPECIALES_8B.md`, `HORAS_ESPECIALES_8C.md`, `HOURS_GRID_REVIEW_SPECIAL_HOURS_AUDIT_11A.md`, `HOURS_GRID_SPECIAL_HOURS_LIQUIDABLE_11A1.md`, `CONCEPTOS_HORARIOS_ADITIVOS.md`, `PERFORMANCE_STANDARDS.md`, `CLAUDE.md`, `AGENTS.md` — más lectura directa de código actual: `employees.repository.ts`/`employees.service.ts` (`findTimeGrid`/`buildAdditiveTimeGrid`), `EmployeeHoursPage.tsx` completo, `timeEntries.repository.ts` (`timeEntryInclude`, `findMany`, `findManyByEmployeeGrouped`, `findForExport`, `findBreakdownHoursForExport`), `timeEntries.service.ts` (`exportByPerson`), `pending.service.ts`, `workforce.service.ts` (`submitClosures`, `returnClosure`), `MonthlyClosuresPage.tsx`, `dashboard.repository.ts`.

## 1. Resumen ejecutivo

11A/11A.1 corrigieron la grilla principal (`HoursPage.tsx`, tabla de período). El resto del flujo — detalle por legajo, Bandeja de revisión, export y cierre — no se había auditado todavía. Diagnóstico con evidencia de código:

1. **`EmployeeHoursPage.tsx` (detalle por legajo) ignoraba por completo Horas Especiales** — `buildAdditiveTimeGrid` nunca leía `appliedMultiplier` ni `SpecialHourRuleApplication`. Mismo bug de fondo que 11A, en una pantalla distinta. **Corregido.**
2. **La Bandeja de revisión perdía el dato en el mapeo frontend** — el backend ya devolvía `appliedMultiplier` crudo en el listado plano (`GET /time-entries`), pero `mapTimeEntryFromApi` nunca lo leía, y tampoco incluía la relación con el nombre de la regla. **Corregido.**
3. **El export tenía dos bugs reales**: (a) "Horas especiales (equivalente liquidable)" sólo multiplicaba Hora normal, nunca los Conceptos Horarios adicionales — inconsistente con la grilla desde 11A.1; (b) no filtraba `specialHourRuleApplications` por `isWinner: true` (a diferencia de la grilla desde 11A), pudiendo listar reglas que no ganaron el conflicto. **Ambos corregidos.**
4. **Cierre y Dashboard: confirmados correctos, sin bugs.** El cierre usa exclusivamente horas reales de Hora normal (nunca multiplicadas, nunca incluye Conceptos Horarios) y su snapshot no se vuelve a leer en ningún lado — no hay nada que corregir ni que recalcular. El dashboard es pass-through puro de horas reales, sin ningún valor liquidable. **Sin cambios.**

No se tocó `schema.prisma`, no se creó ninguna migración, no se tocó el fichador, no se tocó Conceptos Horarios, no se cambió ninguna regla de negocio del motor de Horas Especiales (scope/prioridad/conflicto), no se cambió la política de cierre.

## 2. Mapa — EmployeeHoursPage (antes de esta etapa)

- **Endpoint**: `GET /employees/:id/time-grid` → `employeesService.getTimeGrid` → `employeesRepository.findTimeGrid` → `buildAdditiveTimeGrid`.
- **Qué mostraba por día/período**: filas por concepto (Hora normal + adicionales habilitados), columnas por día, total por fila y total del período (`totalWorkedMinutes`, sólo Hora normal).
- **¿Recibía `appliedMultiplier`?** El `include` de Prisma (`timeGridTimeEntryInclude`) ya lo traía como escalar (por default de `include`), pero `buildAdditiveTimeGrid` nunca lo leía — se descartaba en el camino.
- **¿Recibía `specialHourLiquidableTotal`/`specialHourAdditionalHours`/conceptos alcanzados/regla aplicada/conflicto?** No, ninguno — no existían en esta pantalla.
- **¿Diferenciaba Conceptos Horarios de Horas Especiales?** No aplicaba — al no existir Horas Especiales en esta pantalla, no había nada que confundir, pero tampoco nada que mostrar.
- **¿Refetch tras editar/cargar manualmente?** Sí, correcto (actualización local inmediata + refetch silencioso en segundo plano, Etapa 6L.4) — patrón reutilizado sin cambios para el nuevo estado de Horas Especiales (ver §9).

## 3. Mapa — Bandeja de revisión (antes de esta etapa)

- **Endpoints**: `GET /time-entries` (vista plana, `findMany`) y `GET /time-entries?view=byEmployee` (`findManyByEmployeeGrouped`); widget `GET /pending`.
- **`findMany`**: usaba `include: timeEntryInclude` (no `select`) → `appliedMultiplier` **sí viajaba** en el JSON crudo (es un escalar), pero **no** incluía la relación `timeSegment.specialHourRuleApplications`.
- **`findManyByEmployeeGrouped`**: `select` explícito y mínimo (`{employeeId, hours}`) — no traía `appliedMultiplier` en absoluto.
- **`GET /pending`**: también usaba `include`, así que `appliedMultiplier` viajaba en la consulta Prisma, pero el mapper del servicio (`pending.service.ts`) lo descartaba antes de armar la respuesta HTTP.
- **Frontend `mapTimeEntryFromApi`**: no mapeaba `appliedMultiplier` a ningún campo del tipo `TimeEntry` del frontend — el dato se perdía ahí, aunque el backend ya lo mandara.
- **UI**: cero indicadores de Hora Especial en la tabla "Horas enviadas a revisión" (ni vista "Por registro" ni "Por persona").
- **`approve`/`reject`/`returnForCorrection`**: confirmado que ninguno toca `appliedMultiplier`, `hours`, `totalMinutes` ni ninguna FK relacionada a `SpecialHourRuleApplication` — la trazabilidad de una entrada de fichador se preserva intacta en los tres flujos (nada que corregir ahí).
- **Manual vs. automática**: `TimeEntry.source` existe pero no se usa para filtrar ni para distinguir visualmente en ningún punto — no es un bug (no lo pedía ningún requisito previo), documentado como confirmado sin tratamiento diferenciado.

## 4. Mapa — Exportación (antes de esta etapa)

`exportByPerson` (`timeEntries.service.ts`). Columnas antes de esta etapa: `CUIL, Apellido, Nombre, Legajo, Empresa, Centro de costo, Horas normales, Horas especiales, Horas trabajadas totales, Horas especiales (equivalente liquidable), Adicional por horas especiales, Reglas de horas especiales aplicadas, Estado`.

- **"Horas especiales (equivalente liquidable)"** = `Σ(horas reales de Hora normal × appliedMultiplier)` — **nunca incluía `HourConceptBreakdown`**. Un Sereno en un feriado x2 aparecía en "Horas especiales" (columna real, sin multiplicar) pero jamás entraba al equivalente liquidable.
- **"Adicional por horas especiales"** = `equivalente - normal` — mismo problema, sólo Hora normal.
- **No existía ninguna columna "Total liquidable"**.
- **`specialHourRuleApplications`** se consultaba **sin** `where: { isWinner: true }` (a diferencia de `findPeriodEmployees`, que sí lo filtra desde 11A) — podía listar reglas perdedoras de un conflicto junto a la ganadora.
- **Cálculo a mano del caso obligatorio** (8hs normales + 4hs Sereno, feriado x2, antes de esta etapa): "Horas normales"=8, "Horas especiales"=4, "Horas trabajadas totales"=8, "Horas especiales (equivalente liquidable)"=**16** (sólo normal×2), "Adicional"=8. **El "24" no aparecía en ningún lado.**

## 5. Mapa — Cierre y Dashboard (confirmado correcto, sin cambios)

- **`submitClosures`**: snapshot = `prisma.timeEntry.groupBy({by:[employeeId,status], where:{..., hourConcept:{systemRole:"NORMAL_BASE"}}, _sum:{hours}})` — sólo horas reales de Hora normal, nunca multiplicadas, nunca incluye Conceptos Horarios. Confirmado con grep exhaustivo de `.snapshot` en todo el repo: **nadie vuelve a leer ese campo** — es escribe-y-olvida, sólo auditoría.
- **`MonthlyClosuresPage.tsx`**: la tabla no muestra ni horas reales ni nada de Horas Especiales/liquidable — sólo estado del cierre por legajo.
- **Devolución de cierre (`returnClosure`)**: sólo actualiza la fila de `MonthlyTimeClosure` (`status`, `reviewedByUserId`, `reviewedAt`, `reviewNote`) — nunca toca `TimeEntry`/`TimeSegment`/`SpecialHourRuleApplication`. Una Hora Especial aplicada antes del cierre **sigue completamente visible** después (en la grilla, el detalle y ahora también en la bandeja) porque el cierre nunca la tocó.
- **Recálculo retroactivo**: sigue sin existir (deuda documentada desde 8A) — cambiar una regla después de cerrar no recalcula nada, igual que antes de cerrar. No es un comportamiento nuevo ni afectado por esta etapa.
- **Recomendación (no implementada)**: si en el futuro se necesita que el cierre preserve el valor liquidable del momento exacto de cierre (por ejemplo, para que un cambio de regla posterior no afecte un período ya liquidado), eso requeriría ampliar la forma del snapshot — cambio de schema, fuera de alcance sin aprobación explícita. Hoy no hace falta: nadie lee el snapshot, y el dato real (`appliedMultiplier`/`SpecialHourRuleApplication`) sigue disponible en `TimeEntry`/`TimeSegment` indefinidamente.
- **Dashboard (`sumLoadedHours`)**: confirmado pass-through puro de horas reales (`_sum.hours`, filtrado a `NORMAL_BASE`), sin multiplicar. No existe ningún valor liquidable en el dashboard — correcto, no se tocó (`PERFORMANCE_STANDARDS.md` §9 ya documenta esto como decisión de diseño explícita).

## 6. Cómo viajan las Horas Especiales ahora (después de 11B)

| Consumidor | Antes | Después |
|---|---|---|
| Grilla de período (`HoursPage.tsx`) | Correcto desde 11A/11A.1 | Sin cambios |
| Detalle por legajo (`EmployeeHoursPage.tsx`) | Ignoraba todo | Multiplicador, adicional, total liquidable y regla por día (badge + StatCard + aviso en modales) |
| Bandeja de revisión — vista "Por registro" | Ignoraba todo | Badge con multiplicador, tooltip con regla/liquidable/conflicto |
| Bandeja de revisión — vista "Por persona" | Ignoraba todo | **Sin cambios — fuera de alcance, ver §12** |
| Export | Sólo Hora normal, sin filtrar `isWinner` | Hora normal + Conceptos Horarios, filtrado a la regla ganadora, + columna "Total liquidable" |
| Cierre | Sólo reales, snapshot no leído | Sin cambios (ya correcto) |
| Dashboard | Pass-through real puro | Sin cambios (ya correcto) |

## 7. Manual vs. automático

Sin diferencias nuevas en ninguno de los consumidores tocados — todos leen `appliedMultiplier`/`SpecialHourRuleApplication` de la misma forma sin importar el origen. Limitación heredada de 11A, ahora visible en más lugares: una carga manual no tiene `SpecialHourRuleApplication` (no genera `TimeSegment`), así que en el detalle, la bandeja y el export el multiplicador/liquidable se ve correcto pero sin nombre de regla para filas manuales — documentado, no es un bug nuevo.

## 8. Horas reales vs. liquidables

Invariante confirmado intacto en los cuatro consumidores: ningún cambio de esta etapa toca `TimeEntry.hours`/`totalMinutes`/`HourConceptBreakdown.minutes`. Todo lo nuevo (`specialHoursByDay` en el detalle, campos `specialHour*` en la bandeja, columnas nuevas del export) se deriva en lectura, reutilizando exactamente la fórmula ya aprobada en 11A.1 (`normalLiquidable = real×multiplicador`, `conceptLiquidable = conceptoReal×multiplicador`, `total = suma de ambos`).

## 9. Conceptos Horarios vs. Horas Especiales

Sin mezcla en ningún consumidor nuevo: nombres de campo (`specialHour*` vs. `special`/Conceptos), copy (Parte 4 del pedido) y colores distintos, mismo criterio ya establecido en 11A/11A.1. En `EmployeeHoursPage.tsx` el aviso de Hora Especial dice explícitamente "Este concepto también queda alcanzado" al editar un desglose adicional, para dejar claro que son dos cosas distintas que interactúan, no una mezcla de modelos.

## 10. Caso obligatorio — 8 normales + 4 Sereno + x2 = 24 liquidables

Verificado con test en los tres consumidores nuevos:

- **`EmployeeHoursPage.tsx`**: StatCard "Valor liquidable" = 24.00 h (detalle: "Incluye Hora especial: +16.00 h"); "Horas trabajadas" sigue en 8.00 h (real, sin inflar).
- **Export**: "Horas normales"=8, "Horas especiales"=4 (reales), "Horas especiales (equivalente liquidable)"=16, "Conceptos horarios (equivalente liquidable)"=8, "Adicional por horas especiales"=12, **"Total liquidable"=24**.
- **Bandeja**: el `TimeEntry` de Hora normal de ese día muestra badge "x2" con tooltip "Hora especial aplicada — Multiplicador x2: Domingo — Valor liquidable: 16.00 h" (el liquidable mostrado en la bandeja es sólo el de Hora normal, ya que esa vista es por `TimeEntry` individual, no por día agregado — el total de 24 se ve en el detalle por legajo y en el export).

## 11. Bugs encontrados

1. **`EmployeeHoursPage.tsx`/`buildAdditiveTimeGrid` ignoraba Horas Especiales por completo** — mismo tipo de bug que motivó 11A, nunca corregido en esta pantalla.
2. **Bandeja: `mapTimeEntryFromApi` descartaba `appliedMultiplier`** aunque el backend ya lo devolvía crudo en el listado plano — frontend ignorando un campo ya disponible.
3. **Bandeja: `findMany`/`GET /pending` no incluían `timeSegment.specialHourRuleApplications`** — sin esto no se puede nombrar la regla ni detectar conflicto, aunque el multiplicador sí llegara.
4. **Export: "equivalente liquidable"/"adicional" ignoraban `HourConceptBreakdown`** — inconsistente con la grilla desde 11A.1, el caso 8+4x2 exportaba 16 en vez de 24.
5. **Export: `findForExport` no filtraba `specialHourRuleApplications` por `isWinner: true`** — podía listar reglas perdedoras de un conflicto en "Reglas de horas especiales aplicadas".

Sin bugs encontrados en Cierre ni Dashboard (§5).

## 12. Correcciones realizadas

**Backend**:
- `employees.repository.ts`: `timeGridTimeEntryInclude` agrega `timeSegment.specialHourRuleApplications` (filtrado `isWinner: true`).
- `employees.service.ts`: `buildAdditiveTimeGrid` calcula `specialHoursByDay` (multiplicador/adicional/liquidable/regla(s)/conflicto por día, mismo criterio que `findPeriodEmployees` de 11A.1) + totales de período (`specialHourAdditionalMinutes`, `specialHourLiquidableTotalMinutes`).
- `timeEntries.repository.ts`: `timeEntryInclude` (compartido por `findMany`/create/update/approve/reject/etc.) agrega `timeSegment.specialHourRuleApplications` (`isWinner: true`); `findForExport` agrega el mismo filtro (antes faltaba) + `wasConflicting`; `findBreakdownHoursForExport` agrega `day` (necesario para saber qué multiplicador le corresponde a cada desglose).
- `timeEntries.service.ts`: `exportByPerson` calcula el equivalente liquidable de Conceptos Horarios por día (mismo multiplicador que ya ganó para la Hora normal de ese día/empleado), amplía "Adicional por horas especiales" para incluirlo, agrega columnas nuevas "Conceptos horarios (equivalente liquidable)", "Total liquidable" y "Conflicto de reglas".

**Frontend**:
- `employeeApiService.ts`: tipos extendidos con `specialHoursByDay`/`specialHourAdditionalMinutes`/`specialHourLiquidableTotalMinutes`.
- `EmployeeHoursPage.tsx`: StatCard "Valor liquidable" (condicional, 5ta tarjeta reutilizando `.stat-grid.five` ya existente); punto ámbar en cualquier celda de día alcanzada; aviso "Hora especial aplicada" en el modal de Hora normal y en el de desglose manual, con multiplicador/regla/liquidable/conflicto.
- `timeEntryApiService.ts`: `ApiTimeEntry`/`TimeEntry` extendidos con `appliedMultiplier`/`timeSegment` (API) y `specialHourMultiplier`/`specialHourLiquidableHours`/`specialHourRuleNames`/`specialHourConflict` (frontend, campos nuevos, sin tocar `isSpecial`); `mapTimeEntryFromApi` los mapea condicionalmente (sólo si multiplicador > 1).
- `HoursPage.tsx`: badge con multiplicador (tono `warning`/`danger` según conflicto) junto a "Horas" en la tabla "Por registro" de la Bandeja.
- `hoursExport.ts`: columnas nuevas en el Excel exportado (`conceptosHorariosEquivalentes`, `totalLiquidable`, `conflictoDeReglas`).

## 13. Qué NO se tocó

- `schema.prisma` — ninguna columna, ningún modelo, ninguna migración.
- El motor de matching/prioridad/scope (`doubleHourRuleMatching.ts`) — no se tocó, se reutilizó el multiplicador ya resuelto.
- El fichador y la carga manual (`create()`/`update()`/`createFromWorkShift`/`closeOpenWorkShift`) — sin cambios, ya calculaban `appliedMultiplier` correctamente desde 11A.
- Conceptos Horarios (`hour-concepts`) — ningún archivo tocado.
- Política de cierre (`submitClosures`, `returnClosure`) — confirmada correcta, sin cambios.
- Dashboard — confirmado correcto, sin cambios.
- **Bandeja de revisión, vista "Por persona"** (`reviewByPerson`/`findManyByEmployeeGrouped`) — decisión explícita de alcance: esa vista agrupa por empleado con un `select` mínimo; extenderla implicaría la misma agregación día-a-día que ya se hizo para `findPeriodEmployees` (11A.1) y `buildAdditiveTimeGrid` (11B), mayor superficie de cambio no pedida explícitamente para esta vista puntual — queda documentado como pendiente (§16).
- Cálculo de horas reales — `hours`/`totalMinutes`/`minutes` siguen calculándose exactamente igual en todos los caminos.
- Permisos/scope (`employeeAccessWhere`) — no se tocó ninguna condición de alcance; sólo se agregaron campos de sólo lectura a queries ya scopeadas correctamente.

## 14. Tests agregados/modificados

**Backend** (+13 tests: 819→830, todos verdes):
- `employees.service.test.ts` (+5): sin regla → `specialHoursByDay` vacío; caso obligatorio (8+4 Sereno x2 → 1440 min liquidable); conflicto de prioridad; carga manual sin trazabilidad de regla (igual expone multiplicador/liquidable); `EN_REVISION` cuenta, `BORRADOR` no.
- `timeEntries.repository.test.ts` (+2): `findForExport` filtra `specialHourRuleApplications` a `isWinner=true` y trae `wasConflicting`; `findBreakdownHoursForExport` selecciona `day`.
- `timeEntries.service.test.ts` (+5, describe "liquidable de Horas Especiales sobre Conceptos Horarios en el export"): caso obligatorio (Total liquidable=24); concepto en día sin regla (multiplicador 1 por default); concepto en día distinto al de la regla (sólo el día alcanzado multiplica); conflicto marca "Conflicto de reglas"="Sí"; sin conflicto queda vacío.

**Frontend** (+13 tests: 411→424, 56 archivos, todos verdes):
- `timeEntryApiService.test.ts` (archivo nuevo, +5): `mapTimeEntryFromApi` sin regla no agrega campos; con `timeSegment` (fichador) mapea multiplicador/liquidable/regla; sin `timeSegment` (manual) mapea multiplicador/liquidable sin nombre de regla; conflicto; `isSpecial` (Conceptos Horarios) no se confunde con `specialHourMultiplier`.
- `HoursPage.test.tsx` (+3): badge con multiplicador y tooltip en la Bandeja; sin Hora Especial no muestra indicador; conflicto usa tono más fuerte y lo menciona en el tooltip.
- `EmployeeHoursPage.test.tsx` (+5): caso obligatorio (StatCard "Valor liquidable"=24.00 h, "Horas trabajadas" sigue en 8.00 h); sin Hora Especial no muestra la tarjeta; modal de Hora normal muestra el aviso completo; modal de desglose manual (Colectivo) también avisa; sin Hora Especial ese día el modal no muestra nada adicional.

## 15. Validaciones ejecutadas

| Validación | Resultado |
| --- | --- |
| `npx prisma validate` (backend) | ✅ schema válido |
| `npx prisma generate` (backend) | ✅ |
| `npx prisma migrate status` (backend) | ✅ "Database schema is up to date!" (46 migraciones, sin cambios) |
| `npm run typecheck` (backend) | ✅ sin errores |
| `npx vitest run` (backend) | ✅ 830/830 tests, 62 archivos |
| `npm run build` (backend) | ✅ |
| `npx tsc -b` (frontend) | ✅ sin errores |
| `npx vitest run` (frontend) | ✅ 424/424 tests, 56 archivos |
| `npm run build` (frontend) | ✅ |
| `git diff --check` | ✅ sin errores de espacios en blanco |

## 16. Riesgos pendientes

- **Bandeja "Por persona" sin indicador** (§13) — decisión explícita de alcance, no un bug; requiere la misma agregación día-a-día ya usada en 11A.1/11B si se prioriza en una etapa futura.
- **Sin trazabilidad de regla nombrada para carga manual** (§7) — heredado de 11A, ahora también visible (por ausencia) en la bandeja y el export para filas manuales.
- **Cierre sin captura de liquidable histórico** (§5) — aceptado como comportamiento correcto hoy (nadie lo lee); si se necesita en el futuro, requiere schema + aprobación explícita.
- Los riesgos ya documentados en 11A/11A.1 siguen vigentes sin cambios (sin bandeja de resolución de conflictos, sin política `ACUMULAR` configurable, sin integración con Conceptos Horarios en el motor de reglas, heurístico de superposición del calendario advisorio, sin recálculo retroactivo).

---

No commitear sin aprobación explícita del usuario.
