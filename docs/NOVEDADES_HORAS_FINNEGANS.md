# Novedades, Horas Especiales y Exportación Finnegans

## Decisión funcional

La aplicación no liquida sueldos. Registra información operativa de legajos, horas y novedades, y prepara datos exportables para Finnegans.

La separación queda definida así:

- **Horas trabajadas**: horas que la persona efectivamente trabajó.
- **Horas especiales**: horas trabajadas con clasificación especial, como sereno, guardia, manejo de colectivo, nocturna, feriado trabajado u hora extra.
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

Cada hora especial define:

- Código interno.
- Nombre.
- Tipo.
- Si suma como hora trabajada.
- Estado.

Cada legajo tiene horas especiales habilitadas. En carga horaria solo se muestran la hora normal y las horas habilitadas para ese legajo.

## Carga horaria

La carga horaria se realiza por persona, día y concepto.

Una misma persona puede tener el mismo día:

- 7 horas normales trabajadas.
- 2 horas de manejo de colectivo.
- 1 novedad de llegada tarde.

Cada registro se guarda separado para evitar mezclar horas trabajadas con eventos administrativos.

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
- Las novedades se registran separadas de las horas.
- Suspensión y vacaciones pueden bloquear el día y registrar 0 horas.
- Exportación Finnegans no calcula sueldos.
- Exportación Finnegans muestra solo registros con código exportable.
