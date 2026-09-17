# Etapa 15M.7B — alineación de Motor A por `loadMode`

Fecha: 2026-09-17  
Estado: implementado, pendiente de aprobación para commitear

## Problema

Motor A (`TimeSegment`) consultaba reglas activas de cualquier concepto activo y luego las intersectaba con los conceptos habilitados al empleado. No filtraba `HourConcept.loadMode` ni `deletedAt`, por lo que un concepto `MANUAL` con una regla legacy activa podía aparecer como `SUGERIDO` en Asistencia aunque Motor B nunca generara su `HourConceptBreakdown` automático.

Motor B ya exigía concepto habilitado, activo, no eliminado, `loadMode` `AUTOMATIC`/`BOTH` y regla activa.

## Decisión

`hourConceptsRepository.findActiveRules()` alimenta Motor A exclusivamente con reglas que cumplen:

- `HourConceptRule.status = ACTIVO`;
- `HourConcept.status = ACTIVO`;
- `HourConcept.deletedAt = null`;
- `HourConcept.loadMode IN (AUTOMATIC, BOTH)`.

Después, `classifySegmentsForEmployee()` conserva el filtro de la Etapa 15I por `enabledHourConceptIds`. La secuencia es:

```text
regla y concepto automáticamente elegibles
+ concepto habilitado al empleado
= candidato de Motor A
```

## Modos de carga

- `MANUAL`: nunca participa en detección automática. Sus reglas históricas no compiten. Continúa disponible en el flujo manual.
- `AUTOMATIC`: participa en Motor A y Motor B.
- `BOTH`: participa en Motor A y Motor B y conserva la carga manual existente.

Si no queda ninguna regla automática aplicable, se preserva 15M.7A: el tramo es Hora normal con metadata neutral, sin `SEGMENTO_SIN_CLASIFICAR` ni `CONCEPTO_NO_HABILITADO`.

## Cross-midnight

Una regla MANUAL 21:00–04:00 queda fuera antes de clasificar; una jornada 23:00–03:00 conserva sus 240 minutos en Hora normal. La misma regla `AUTOMATIC` o `BOTH` conserva su clasificación `SUGERIDO`, su `hourConceptRuleId` y los 240 minutos, sin pérdidas ni duplicaciones.

## Históricos y reclasificación

No se migran `TimeSegment` históricos donde un concepto MANUAL haya quedado `SUGERIDO`; siguen siendo legibles. No existe un proceso separado de reclasificación de `TimeSegment`: los cuatro caminos reales que crean segmentos al cerrar una jornada pasan por el mismo `classifySegmentsForEmployee()`, por lo que todos reciben la nueva política.

## Límites

Motor B se leyó como referencia y no fue modificado. Tampoco cambiaron carga manual, `ensureHourConceptEnabled`, Hora normal, minutos, `HourConceptBreakdown`, Horas Especiales, exportaciones, Finnegans, schema, migraciones, WorkRegime ni alertas.

