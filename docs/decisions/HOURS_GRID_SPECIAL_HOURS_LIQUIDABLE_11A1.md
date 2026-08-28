# Etapa 11A.1 — Liquidable de Horas Especiales sobre total y conceptos horarios

Fecha: 2026-08-28
Estado: implementado, pendiente de aprobación para commitear
Continúa: `docs/decisions/HOURS_GRID_REVIEW_SPECIAL_HOURS_AUDIT_11A.md` (11A cerró que la grilla marque la Hora Especial; 11A.1 corrige que ese marcado también impacte el total liquidable y alcance a los Conceptos Horarios adicionales)

## 0. Documentos leídos

`HORAS_ESPECIALES_AUDITORIA_8A.md`, `HORAS_ESPECIALES_8B.md`, `HORAS_ESPECIALES_8C.md`, `HOURS_GRID_REVIEW_SPECIAL_HOURS_AUDIT_11A.md` (propio, base de esta etapa), `CONCEPTOS_HORARIOS_ADITIVOS.md`, `PERFORMANCE_STANDARDS.md`, `CLAUDE.md`, `AGENTS.md` — más lectura directa del código actual de `findPeriodEmployees` (`timeEntries.repository.ts`) y `HoursPage.tsx`, en el estado exacto que dejó 11A (ya commiteado por el usuario, commit `d8059f8`).

## 1. Resumen ejecutivo

11A cerró que la grilla *marque* una Hora Especial aplicada (badge/punto + popover con multiplicador y adicional). Probando esa corrección, el usuario encontró dos huecos reales, ambos confirmados con evidencia de código:

1. **El adicional liquidable que se mostraba nunca se sumaba a un total liquidable real** — sólo existía un delta ("+8h") pegado al lado del total real, sin que existiera en ningún lado el número final "cuánto liquida este día/período".
2. **El multiplicador de Hora Especial sólo se aplicaba a la Hora normal, nunca a los Conceptos Horarios adicionales** (Sereno, Colectivo, etc.) — el loop que agrega `HourConceptBreakdown` en `findPeriodEmployees` nunca leía ni aplicaba el multiplicador del día, aunque ya estaba resuelto en ese punto del código.

Se corrigieron ambos, reutilizando exactamente el mismo multiplicador que 11A ya resolvía por día/empleado (sin agregar ninguna consulta nueva a `DoubleHourRule`, sin tocar el motor de matching/scope/prioridad, sin cambiar `schema.prisma`). Se agregó un campo nuevo (`specialHourLiquidableTotal`) que expone el total liquidable real (Hora normal + Conceptos, con el multiplicador aplicado) por día y por período, dejando el total real (`total`) exactamente como estaba.

## 2. Bug detectado por el usuario

- **Problema 1**: "La grilla marca la Hora Especial aplicada, pero el total no refleja correctamente el valor liquidable." — Confirmado: `specialHourAdditionalHours` (11A) era sólo un delta informativo; no existía ningún campo ni UI mostrando la suma final liquidable.
- **Problema 2**: "Las Horas Especiales se están aplicando sólo sobre las horas normales/base, pero no sobre los Conceptos Horarios adicionales." — Confirmado con evidencia exacta: en `findPeriodEmployees` (`timeEntries.repository.ts`), el loop de `breakdowns` (Conceptos Horarios) sólo acumulaba `special += hours`, sin leer `dayCurrent.specialHourMultiplier` (que el loop de `entries`, ejecutado antes, ya había resuelto para ese mismo día/empleado).

## 3. Diagnóstico (Parte 1 del pedido)

1. **Qué total calcula hoy la grilla**: `summary.total` = suma de `TimeEntry.hours` con `hourConcept.systemRole = NORMAL_BASE` y `status ∈ {APROBADO, EN_REVISION}` — es decir, **horas reales de Hora normal únicamente**, nunca inflado, nunca incluye Conceptos Horarios (regla de la Etapa 6M, sin cambios).
2. **Qué representa ese total**: **real**, exclusivamente. No es mixto ni liquidable — es y sigue siendo el total de horas trabajadas reales.
3. **Dónde se calcula**: 100% backend (`timeEntries.repository.ts:findPeriodEmployees`). El frontend (`HoursPage.tsx`) sólo formatea/muestra lo que el backend ya sumó — no hace ninguna aritmética de agregación.
4. **Cómo se calcula `appliedMultiplier`**: se resuelve una única vez, al escribir el `TimeEntry` (fichador en `createFromWorkShift`/`closeOpenWorkShift`, o carga manual en `create()`/`update()` desde la Etapa 11A) — nunca en la grilla. La grilla sólo lo lee (`select: { appliedMultiplier: true }`, agregado en 11A).
5. **Cómo se calculaba `specialHourAdditionalHours`/liquidable antes de 11A.1**: `hours_normal * (appliedMultiplier - 1)`, sólo con los minutos de la Hora normal del día — nunca se sumaba a nada para formar un "total".
6. **Cómo viajan los Conceptos Horarios adicionales hacia la grilla**: vía `HourConceptBreakdown` (`employeeId`, `day`, `minutes`), consultados en paralelo en el mismo endpoint, agregados a `special`/`dailyBreakdown[].special` — completamente desacoplado de `appliedMultiplier` antes de esta etapa.
7. **¿`HourConceptBreakdown` tiene fecha/día suficiente?** Sí — tiene `date`/`day`/`period` (usados hoy mismo para el `where`/`select` de `findPeriodEmployees`). No hace falta ningún campo nuevo.
8. **¿Los conceptos tienen minutos reales asociados por día?** Sí — `minutes` es el campo real, nunca inflado, y sigue sin tocarse en esta etapa.
9. **¿La regla de Hora Especial aplica al día completo o a tramos?** El motor (`ruleMatchesDate`) matchea por **fecha calendario** del `TimeSegment`/de la carga — es decir, por día completo dentro de esa fecha, no por franja horaria específica. `DoubleHourRule` no tiene (ni tenía en 8B) ningún campo de "hora desde/hasta" — sólo fecha/rango/semanal. Por lo tanto, aplicar el mismo multiplicador del día a todo lo cargado ese día/empleado (Hora normal + Conceptos) es consistente con cómo ya funciona el motor, no una extensión inventada.
10. **¿Carga manual tiene información suficiente para saber qué conceptos caen dentro de la Hora Especial?** Sólo a nivel de día — no hay (ni se agregó) ningún vínculo entre un `HourConceptBreakdown` puntual y una `DoubleHourRule` específica (eso requeriría replicar `SpecialHourRuleApplication` para conceptos, que exige `TimeSegment`, y los breakdows no lo tienen — ver §6 sobre la limitación heredada de 11A).
11. **¿Carga automática tiene información suficiente por segmento?** Los `HourConceptBreakdown` `AUTOMATIC` (Etapa 6I) se generan desde `WorkShift`, **sin pasar por `TimeSegment`** ni por el motor de `DoubleHourRule` — confirmado releyendo 6I: "No reutiliza `TimeSegment` ni `TimeEntry`". Es decir, ni siquiera la carga automática de conceptos tiene, hoy, un vínculo con el motor de Horas Especiales a nivel de tramo — el único punto de contacto posible sin tocar ese generador es el día/empleado, que es exactamente lo que se usó.
12. **¿Diferencias entre manual y automático?** Ninguna nueva — ambos caminos alimentan el mismo `HourConceptBreakdown.minutes`/`day`, y ambos se benefician del mismo multiplicador ya resuelto por día/empleado (desde la Hora normal de ese día, que si vino del fichador o de carga manual, ya tiene su `appliedMultiplier` correcto desde 11A).
13. **¿Conflictos de reglas impactan conceptos adicionales?** No de forma distinta — el multiplicador que llega a los conceptos es el mismo que ya ganó la resolución de conflicto (`resolveWinningRules`) para la Hora normal de ese día. No se re-evalúa el conflicto para conceptos.
14. **¿Frontend suma mal o backend no expone el dato?** Backend no exponía el dato (ni el multiplicado sobre conceptos, ni un total liquidable) — el frontend nunca tuvo la culpa; sólo mostraba lo que llegaba.

## 4. Regla funcional final aplicada (Parte 2 del pedido)

Para cada día/persona, exactamente la fórmula pedida:

```
realWorkedMinutes    = minutos reales de Hora normal ese día (TimeEntry, systemRole=NORMAL_BASE)
conceptBreakdownMinutes = suma de minutos de HourConceptBreakdown ese día (todos los conceptos adicionales)
appliedMultiplier     = multiplicador de la Hora Especial ganadora ese día (ya resuelto al escribir la Hora normal; 1 si no hay ninguna)

normalLiquidableMinutes  = realWorkedMinutes * appliedMultiplier
conceptLiquidableMinutes = conceptBreakdownMinutes * appliedMultiplier
totalLiquidableMinutes   = normalLiquidableMinutes + conceptLiquidableMinutes
```

**Decisión documentada para "sin Hora Especial" (Caso D del pedido)**: `conceptLiquidableMinutes = conceptBreakdownMinutes` (no 0) — es decir, los Conceptos Horarios adicionales **siempre** cuentan para el total liquidable, con o sin Hora Especial, porque `docs/decisions/CONCEPTOS_HORARIOS_ADITIVOS.md` ya establece que "sirven para liquidación/exportación, análisis y control" — no es una decisión nueva de esta etapa, es la aplicación consistente de la fórmula general con `appliedMultiplier = 1` por default. El total real (`total`) nunca incluye estos minutos — sigue siendo sólo Hora normal, sin cambios.

## 5. Fórmula de cálculo — ejemplos verificados con test

| Caso | Normal real | Concepto real | Multiplicador | Adicional | Total liquidable |
|---|---|---|---|---|---|
| A — común, sin conceptos | 8 | 0 | 1 | 0 | 8 |
| B — feriado x2, sin conceptos | 8 | 0 | 2 | 8 | 16 |
| **C — feriado x2 con Sereno** | **8** | **4** | **2** | **12** | **24** |
| D — común, con Sereno (sin regla) | 8 | 4 | 1 | 0 | 12 |
| E — x1.5 con 2hs de concepto | 8 | 2 | 1.5 | 5 | 15 |

Caso C, desglosado exactamente como lo pidió el encargo: liquidable normal `8×2=16`, liquidable Sereno `4×2=8`, total liquidable `16+8=24`.

## 6. Manual vs. automático

Sin diferencias de comportamiento — el multiplicador que alcanza a los conceptos es el mismo, day-level, que ya viene de `TimeEntry.appliedMultiplier` (correcto para ambos caminos desde 11A). **Limitación heredada de 11A, no resuelta ni agravada acá**: una carga manual no genera `SpecialHourRuleApplication` (no hay `TimeSegment`), así que para conceptos alcanzados por una Hora Especial cargada manualmente tampoco hay nombre de regla — el multiplicador y el liquidable son correctos, sólo falta el nombre. Documentado, no bloqueante.

**Caso borde nuevo, documentado explícitamente**: un `HourConceptBreakdown` sin ningún `TimeEntry` de Hora normal ese mismo día/empleado (breakdown "huérfano" — infrecuente, pero posible si alguien carga un concepto sin cargar la Hora normal correspondiente) no tiene forma de resolver el multiplicador del día sin una consulta adicional a `DoubleHourRule` por fila. Se decidió **no** agregar esa consulta extra (evitar N+1 en un endpoint paginado con hasta 25 empleados × 31 días) — ese caso queda con multiplicador 1 (liquidable = real). Cubierto por test dedicado.

## 7. Horas reales vs. total liquidable

Sin cambios de invariante: `TimeEntry.hours`/`totalMinutes` y `HourConceptBreakdown.minutes` **nunca** se tocan — todo el cálculo de liquidable es una derivación de sólo lectura en `findPeriodEmployees`, expuesta en campos nuevos y separados (`specialHourAdditionalHours` ampliado, `specialHourLiquidableTotal` nuevo). La columna "Total" de la grilla sigue siendo el total real, sin reemplazar ni renombrar — el total liquidable se agrega como una pieza de información nueva y claramente etiquetada ("Total liquidable"), nunca sustituyendo al real.

## 8. Conceptos Horarios vs. Horas Especiales

Sin mezcla de modelos: no se tocó `hour-concepts`, no se agregó ningún vínculo `DoubleHourRule`↔`HourConcept` en el schema, no se creó ninguna entidad de trazabilidad para conceptos. El multiplicador se aplica **en lectura**, exclusivamente dentro de `findPeriodEmployees`, sin que `HourConceptBreakdown` sepa nada de Horas Especiales. La columna/label "Especiales" (Conceptos Horarios) y el nuevo indicador de Hora Especial siguen usando nombres de campo y copy distintos (`special` vs. `specialHour*`), tal como decidió 11A.

## 9. Qué se corrigió

**Backend** (`timeEntries.repository.ts`, `findPeriodEmployees`):
- El loop de `breakdowns` ahora lee `dayCurrent.specialHourMultiplier` (ya resuelto por el loop de `entries`, que corre antes) y, si es mayor a 1, suma `hours * (multiplier - 1)` a `specialHourAdditionalHours` (día y período) — el mismo campo que antes sólo incluía la Hora normal.
- Nuevo campo `specialHourLiquidableTotal` (día y período) = `(normal + special) + specialHourAdditionalHours` — el total liquidable real, derivado, nunca persistido.

**Frontend** (`HoursPage.tsx`):
- Popover de día: copy alineado a los términos pedidos ("Horas reales", "Conceptos horarios (reales)", "Hora especial aplicada — Multiplicador", "Conceptos alcanzados", "Adicional liquidable", "Total liquidable"), mostrando el detalle de conceptos alcanzados y el total liquidable cuando corresponde (hay concepto o hay multiplicador).
- Badge de período: pasó de mostrar sólo el delta ("Hora Especial +8h") a mostrar el total liquidable explícito ("Total liquidable: 48.00 h"), sin tocar la columna "Total" (real), que sigue mostrándose sin ninguna etiqueta nueva.
- Tipos (`ApiEmployeePeriodDailyBreakdown`/`ApiEmployeePeriodRow`, `timeEntryApiService.ts`) extendidos de forma aditiva con `specialHourLiquidableTotal`.

## 10. Qué NO se tocó

- `schema.prisma` — ninguna columna, ningún modelo, ninguna migración.
- El motor de matching/prioridad/scope (`doubleHourRuleMatching.ts`) — no se tocó ni se re-consultó; se reutilizó el multiplicador ya resuelto.
- `createFromWorkShift`/`closeOpenWorkShift`/carga manual (`create()`/`update()`) — sin cambios, ya resolvían `appliedMultiplier` correctamente desde 11A.
- El generador automático de `HourConceptBreakdown` (Etapa 6I) — no se le agregó ningún vínculo a `TimeSegment`/`DoubleHourRule`.
- `EmployeeHoursPage.tsx` (grilla mensual por legajo) — decisión de alcance ya tomada en 11A, sin cambios acá tampoco.
- La tabla de la Bandeja de revisión — sin indicador de Horas Especiales, decisión de alcance de 11A.
- `exportByPerson` — sigue derivando el equivalente sólo de Hora normal (`real × appliedMultiplier`), sin extender a Conceptos Horarios. No estaba en el alcance explícito de 11A.1 (Parte 5/6 hablan de "grilla"/`HoursPage.tsx`, no de export) — documentado como pendiente (§12).
- Invalidación de cache — se revisó explícitamente (Parte 5.7) y **no hizo falta ningún cambio**: no se agregó ninguna fuente de datos ni ruta de escritura nueva — sólo se derivan más campos de datos que ya estaban correctamente cacheados/invalidados desde 11A (`TimeEntry`, `HourConceptBreakdown`).

## 11. Tests agregados/modificados

**Backend** (+8 tests sobre `timeEntries.repository.test.ts`, total 819, todos verdes): Caso C (feriado x2 con Sereno, liquidable 24), Caso B regresión (sin conceptos, liquidable 16), Caso A (sin regla, liquidable = real), Caso D (común con Sereno, liquidable 12 sin regla — decisión documentada), Caso E (x1.5 con decimales, liquidable 15), Caso F (conflicto — usa el multiplicador ya resuelto, no inventa uno nuevo, liquidable 30), breakdown huérfano (sin Hora normal ese día, multiplicador 1 documentado), Caso G (empleado fuera de alcance — multiplicador ya en 1, conceptos no se multiplican).

**Frontend** (+1 test neto sobre `HoursPage.test.tsx`, total 36, todos verdes — 5 tests reescritos con el copy nuevo + 1 test nuevo): popover muestra "Hora especial aplicada — Multiplicador x2" y "Total liquidable"; sin regla ni conceptos no muestra ningún indicador; **8 normales + 4 Sereno + x2 muestra "Conceptos alcanzados: 4.00 h" y "Total liquidable: 24.00 h"** (caso explícito del pedido); conflicto visible sin ocultar el liquidable ya resuelto; badge de período muestra "Total liquidable" sin reemplazar la columna "Total" (real, verificado que sigue visible); sin adicional, sin badge.

## 12. Riesgos pendientes

- **Breakdown huérfano** (§6): un Concepto Horario cargado sin Hora normal el mismo día no recibe multiplicador — limitación aceptada para no agregar N+1 queries a un endpoint paginado, documentada explícitamente con test.
- **Sin trazabilidad de regla nombrada para conceptos alcanzados** — igual limitación que 11A para la Hora normal manual, ahora extendida a conceptos: se sabe el multiplicador y el liquidable, no el nombre de la regla específica que lo generó (sólo si la Hora normal del día vino del fichador, vía `SpecialHourRuleApplication`).
- **Export no extendido** (§10) — si se pide una etapa futura, `exportByPerson` podría sumar el mismo criterio (multiplicar también `HourConceptBreakdown` por el `appliedMultiplier` del día) reutilizando la misma fórmula, sin cambios de schema.
- Los riesgos ya documentados en 11A (§16 de ese doc) siguen vigentes sin cambios.

---

No commitear sin aprobación explícita del usuario.
