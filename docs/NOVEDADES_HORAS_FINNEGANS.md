# Novedades, Horas Especiales y Exportación Finnegans

## Decisión funcional

La aplicación no liquida sueldos. Registra información operativa de legajos, horas y novedades, y prepara datos exportables para Finnegans.

La separación queda definida así:

- **Horas normales**: total real trabajado por la persona; es la grilla base obligatoria y la única fuente del total trabajado.
- **Conceptos horarios adicionales / horas especiales**: desgloses de horas normales, como sereno, guardia, manejo de colectivo, nocturna, feriado trabajado u hora extra. No reemplazan ni incrementan el total trabajado.
- **Novedades**: eventos del legajo o del día, como vacaciones, enfermedad, llegada tarde, suspensión o accidente.
- **Exportación Finnegans**: vista mensual de novedades exportables con códigos Finnegans.

## Novedades

Una novedad se asocia a una o varias personas. Puede ser interna, Finnegans o interna vinculada a Finnegans.

Ejemplos de novedades:

- Vacaciones.
- Enfermedad.
- Llegada tarde.
- Ausente sin aviso.
- Suspensión.
- Accidente laboral.
- Licencia por maternidad.
- Permiso gremial.

No son novedades:

- Sereno.
- Guardia.
- Manejo de colectivo.
- Hora extra.
- Nocturna.
- Feriado trabajado.

Esos conceptos pertenecen al catálogo de horas especiales.

## Horas especiales

El módulo antes llamado Conceptos horarios queda funcionalmente como **Horas especiales**.

Cada concepto horario adicional define:

- Código interno.
- Nombre.
- Tipo.
- Modo de carga: manual, automático o manual y automático.
- Para el modo automático: hora desde, hora hasta, cruza medianoche y estado de la regla.
- Estado.

Horas normales está disponible para todos los legajos sin asignación. Cada legajo habilita únicamente sus conceptos adicionales. En carga horaria siempre se muestra Horas normales y solo los conceptos adicionales habilitados para ese legajo.

`priority` y la selección de un único concepto ganador pertenecen al modelo anterior y quedan deprecados. `countsAsWorked` no debe sumar conceptos adicionales al total real trabajado. La implementación actual puede no coincidir todavía y será corregida por etapas.

## Carga horaria

La carga horaria se realiza por persona y día. Horas normales registra el total real; los conceptos adicionales registran desgloses que pueden superponerse con ese total.

Una misma persona puede tener el mismo día:

- 10 horas normales trabajadas.
- 2 horas de manejo de colectivo incluidas dentro de esas 10 horas.
- 1 novedad de llegada tarde.

Cada registro se guarda separado para evitar mezclar el total trabajado, sus desgloses y los eventos administrativos. En este ejemplo el total trabajado es 10, no 12.

Si una novedad bloquea la carga horaria, se genera un registro de 0 horas para el día o rango correspondiente. La app no calcula descuento ni sueldo.

## Exportación Finnegans

Exportación Finnegans reemplaza el enfoque de liquidación dentro de la app.

Se exportan:

- Novedades Finnegans.
- Novedades internas vinculadas a Finnegans.

No se exportan:

- Novedades internas sin código Finnegans.
- Horas especiales.
- Observaciones internas.
- Alertas.
- Información sin código exportable.

Columnas de exportación:

| Campo | Regla |
| --- | --- |
| Legajo | Texto. Conserva ceros adelante. |
| Novedad | Código Finnegans, no nombre interno. |
| Centro de costo | Opcional. Si queda vacío, Finnegans toma el del legajo. |
| Valor 1 | Unidad, cantidad u horas. |
| Fecha Aplicación | Fecha de aplicación de la transacción. |
| Fecha desde | Obligatoria si tiene vigencia. |
| Fecha hasta | Obligatoria si tiene vigencia. |

## Criterios de aceptación

- Sereno, guardia y manejo de colectivo no aparecen como novedades.
- Sereno, guardia y manejo de colectivo aparecen como horas especiales.
- La carga horaria permite varias líneas por día.
- Horas normales siempre aparece y determina por sí sola el total trabajado.
- Las horas especiales son desgloses aditivos y no se suman al total trabajado.
- Las novedades se registran separadas de las horas.
- Suspensión y vacaciones pueden bloquear el día y registrar 0 horas.
- Exportación Finnegans no calcula sueldos.
- Exportación Finnegans muestra solo registros con código exportable.
