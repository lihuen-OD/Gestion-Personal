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

**Etapa 15G.1** (`docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md`, decisión funcional final): el fichador y la carga horaria manual son la única fuente de verdad de horas reales; Novedades es justificación administrativa. Una novedad **nunca** crea ni modifica un `TimeEntry`, en ningún estado (ni `PENDIENTE` ni `APROBADO`) ni para ningún tipo (tampoco para uno con `setsWorkedHoursToZero`). Si una novedad `APROBADA` bloquea la carga horaria (`blocksTimeEntry`/`setsWorkedHoursToZero`/`timeImpact = BLOQUEA_CARGA_DIA`), su único efecto es impedir que se cargue manualmente una hora **nueva** ese día — no genera ningún registro de 0 horas por sí misma. La app no calcula descuento ni sueldo.

## Exportación Finnegans

> Confirmado en el diagnóstico de la Etapa 15E.2 (`docs/decisions/TIME_EXPORT_CLOSURE_GATE_15E2.md`): el módulo `finnegans-export` (`GET /api/finnegans-export/novelties[.csv]`) exporta exclusivamente novedades, tal como ya documentaba esta sección — nunca horas/liquidación. Por eso el requisito de cierre mensual `APROBADO` de 15E.2 se aplicó a `GET /api/time-entries/export(.csv)`; este módulo tiene, desde la Etapa 15L.3A (`docs/decisions/FINNEGANS_EXPORT_NORMALIZED_15L3A.md`), su **propio** gate de cierre mensual, independiente del de horas (ver más abajo).

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

Columnas de exportación (CSV/XLSX, sin cambios desde la Etapa 15L.3A):

| Campo | Regla |
| --- | --- |
| Legajo | Texto. Conserva ceros adelante. |
| Novedad | Código Finnegans, no nombre interno. |
| Centro de costo | Opcional. Si queda vacío, Finnegans toma el del legajo. |
| Valor 1 | Depende exclusivamente de `NoveltyType.finnegansValueUnit` (horas/días/unidad) — sin ningún fallback entre cantidades. |
| Fecha Aplicación | Fecha de aplicación de la transacción (`fromDate`). |
| Fecha desde | Vacía salvo que el tipo exija vigencia (`finnegansRequiresValidity`). |
| Fecha hasta | Vacía salvo que el tipo exija vigencia; si falta, la fila queda bloqueada en vez de exportarse con la celda vacía. |

**Preview vs. exportación definitiva** (Etapa 15L.3A): `GET
.../novelties?period=YYYY-MM&preview=true` sólo informa — muestra todas las
novedades candidatas del período, incluidas las que todavía no están
completamente configuradas (marcadas con un estado de "readiness"), y nunca
exige cierre mensual aprobado ni queda registrada como una exportación
realizada. `GET .../novelties?period=YYYY-MM` (sin `preview`, y siempre
`.../novelties.csv`) es la exportación **definitiva**: revalida todo,
bloquea con `409` si alguna novedad no está lista (vínculo Finnegans
activo, unidad de Valor 1, cantidad, vigencia) o si el cierre mensual de
algún empleado incluido no está `APROBADO`, y sólo entonces genera el
archivo — nunca una exportación parcial.

**Gate de cierre mensual propio de este módulo**: sólo se exige el cierre
`APROBADO` de los empleados que tienen alguna novedad candidata en el
período — un legajo sin ninguna novedad exportable nunca bloquea la
exportación de los demás.

**Pertenencia mensual única** (Etapa 15L.3B.1,
`docs/decisions/FINNEGANS_EXPORT_MONTHLY_OWNERSHIP_15L3B.md`): el período de
exportación de una novedad se determina por su Fecha desde (`fromDate`). Una
novedad se exporta en un único período, aunque su Fecha hasta pertenezca a
otro mes. Una novedad `30/07/2026 → 02/08/2026` se exporta únicamente en
julio, con el rango real completo (`Fecha desde=30/07/2026`,
`Fecha hasta=02/08/2026`, sin recortar); una novedad abierta
(`toDate = null`) se exporta una única vez, en el mes de su `fromDate`, sin
repetirse en los meses siguientes. `toDate` no decide en qué mes se exporta
— sólo sigue siendo la vigencia real exportada y lo que usa la grilla
horaria para mostrar la novedad en pantalla.

## Criterios de aceptación

- Sereno, guardia y manejo de colectivo no aparecen como novedades.
- Sereno, guardia y manejo de colectivo aparecen como horas especiales.
- La carga horaria permite varias líneas por día.
- Horas normales siempre aparece y determina por sí sola el total trabajado.
- Las horas especiales son desgloses aditivos y no se suman al total trabajado.
- Las novedades se registran separadas de las horas.
- Suspensión y vacaciones pueden bloquear el día y registrar 0 horas.
- Exportación Finnegans no calcula sueldos.
- La exportación **definitiva** de Finnegans sólo contiene registros con código exportable y configuración completa; la **preview** puede mostrar además novedades candidatas que todavía no están completamente configuradas, señalándolas como tales.
