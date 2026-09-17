# Etapa 15M.7C — política de regímenes sin turno

## Decisión

`WorkRegime.kind` es la fuente semántica para decidir si la ausencia de un
turno válido constituye un hallazgo:

- `SIN_TURNO` y `TURNO_FLEXIBLE` no generan `TURNO_NO_IDENTIFICADO` ni
  `SHIFT_NOT_ENABLED_FOR_EMPLOYEE`, aunque datos históricos conserven
  `alertOnOutOfShift=true`.
- `TURNO_OBLIGATORIO` puede generar esas alertas. Se conserva
  `alertOnOutOfShift=false` como opt-out histórico para no romper
  configuraciones existentes.
- Sin régimen vigente se mantiene el comportamiento conservador anterior:
  la ausencia o incompatibilidad de turno genera alerta.

La regla se concentra en `shouldSuppressMissingShiftAlert`, consumida por el
runner de evaluación. No se modifican enums ni datos persistidos.

El enum real contiene únicamente:

| kind | ¿Exige turno? | Política efectiva |
| --- | ---: | --- |
| `TURNO_OBLIGATORIO` | Sí | Puede alertar; respeta el opt-out explícito de `alertOnOutOfShift`. |
| `TURNO_FLEXIBLE` | No | Nunca alerta por ausencia/incompatibilidad de turno. |
| `SIN_TURNO` | No | Nunca alerta por ausencia/incompatibilidad de turno. |

## Controles universales

La política anterior sólo afecta hallazgos cuya causa es la falta de un turno
válido. No suprime controles de jornada. En particular:

- `POSIBLE_OLVIDO_SALIDA` conserva el umbral por turno o el default de 600
  minutos, con independencia del régimen.
- `JORNADA_EXTENDIDA` sigue usando la prioridad régimen → turno → default y
  funciona también sin plantilla de turno.
- Las alertas de puntualidad sólo se evalúan contra un turno propio habilitado,
  como ya exigía la política de matching.

La búsqueda continúa limitada a turnos propios; no se reintroduce matching
contra turnos ajenos.

## Compatibilidad

`alertOnOutOfShift` no se elimina del esquema ni requiere migración. Los datos
contradictorios de regímenes sin turno se neutralizan en la lógica. Las alertas
históricas permanecen legibles y no se crean tipos nuevos.

Para impedir nuevas contradicciones, create/update normalizan
`alertOnOutOfShift=false` en `SIN_TURNO` y `TURNO_FLEXIBLE`. Al cambiar desde
uno de esos kinds a `TURNO_OBLIGATORIO`, el control se reactiva por defecto si
el request no envía una decisión explícita; un `false` explícito se conserva.
La UI oculta el switch cuando no aplica, muestra “Este régimen no requiere un
turno fijo” y representa registros históricos contradictorios como “No aplica”.

Las asignaciones de turno históricas no se eliminan. El régimen vigente para
la fecha Argentina de la fichada decide si pueden producir alertas. El cierre
automático `FALTA_SALIDA` sigue dependiendo de `openShiftOverflowAction`, no de
la obligación de turno.

Las jornadas cross-midnight conservan su duración y partición por día. La
clasificación de conceptos horarios y las reglas de Horas Especiales permanecen
ortogonales al régimen; esta etapa no modifica sus motores ni modelos.
