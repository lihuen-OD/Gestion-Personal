# Etapa 15M.7D — jornada completamente fuera de turno

## Definición

`JORNADA_FUERA_DE_TURNO` describe una jornada cerrada cuyo intervalo real no
tuvo ningún solapamiento con la ocurrencia real de un turno propio, aplicable y
habilitado. Su severidad es `ADVERTENCIA` y utiliza el flujo habitual de
resolución de `ShiftAlert`.

Los intervalos son semicerrados: `[inicio, fin)`. El solapamiento es:

```text
max(0, min(actualEnd, scheduledEnd) - max(actualStart, scheduledStart))
```

Sólo `overlap == 0` dispara la alerta. Tocar un límite —por ejemplo comenzar
exactamente a la hora de fin— no cuenta como solapamiento.

## Ocurrencia y turnos nocturnos

La comparación usa instantes, no horas de reloj. El inicio programado es la
ocurrencia más cercana al ingreso real (hoy, ayer o mañana) y el fin se deriva
respetando `crossesMidnight`. Así, un turno 22:00–06:00 se representa como un
intervalo que termina al día siguiente.

## Referencia válida y régimen

Sólo se evalúa con `ShiftMatchResult.case === ENABLED`; nunca se buscan turnos
globales o ajenos. Sin turno, con turno deshabilitado o con `NO_MATCH`, no se
genera esta alerta. `SIN_TURNO` queda excluido incluso si conserva asignaciones
históricas. `TURNO_FLEXIBLE` mantiene la semántica previa: sólo se evalúa si
tiene una referencia explícita habilitada. `TURNO_OBLIGATORIO` y el fallback
sin régimen se evalúan cuando existe esa referencia.

El régimen se resuelve para `WorkShift.startAt`, la fecha relevante de la
jornada, incluida una jornada cross-midnight.

## Ciclo de puntualidad

La entrada continúa evaluándose inmediatamente. Si al cierre se confirma cero
solapamiento, cualquier alerta pendiente `INGRESO_TARDE`,
`INGRESO_ANTICIPADO`, `SALIDA_ANTICIPADA` o `SALIDA_TARDIA` de la misma jornada
se marca `RESUELTA` automáticamente con motivo auditable. No se borra historial.
Una notificación de ingreso ya enviada no puede desenviarse; esta limitación se
acepta para evitar rediseñar el flujo de fichaje.

No se crean alertas nuevas de puntualidad al cierre cuando aplica
`JORNADA_FUERA_DE_TURNO`.

## Prioridad y dimensiones ortogonales

La nueva alerta es la principal en la cascada de notificación de cierre y en la
vista agrupada. `JORNADA_INSUFICIENTE` y `JORNADA_EXTENDIDA` pueden persistirse
como hallazgos secundarios técnicamente correctos, pero no generan otra
notificación principal.

La alerta no modifica horas reales, minutos acreditados, segmentos, conceptos,
Motor A/B, Horas Especiales ni liquidación. No bloquea entrada, salida ni
persistencia. No se reclasifican jornadas históricas ni se ejecuta backfill.

