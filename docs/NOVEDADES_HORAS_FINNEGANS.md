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

**Etapa 15G.1** (`docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md`, decisión funcional final): el fichador y la carga horaria manual son la única fuente de verdad de horas reales; Novedades es justificación administrativa. Una novedad **nunca** crea ni modifica un `TimeEntry`, en ningún estado (ni `PENDIENTE` ni `APROBADO`) ni para ningún tipo. Si una novedad `APROBADA` bloquea la carga horaria (`NoveltyType.timeEntryBehavior = BLOQUEA_NUEVA_CARGA`, única fuente desde la Etapa 15L.6, `docs/decisions/NOVELTY_TYPE_LEGACY_REMOVAL_15L6.md`), su único efecto es impedir que se cargue manualmente una hora **nueva** ese día — no genera ningún registro de 0 horas por sí misma. La app no calcula descuento ni sueldo.

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

**`quantityDays`/`quantityHours`** (Etapa 15L.5,
`docs/decisions/NOVELTY_QUANTITY_SEMANTICS_15L5.md`): el backend es la
única autoridad de ambos valores, calculados/validados al crear la
novedad — el cliente ya no puede fijarlos. `quantityHours` sigue siendo
100% manual (aplica si `NoveltyType.allowsHours = true`).
`quantityDays` (aplica si `allowsHours = false`) es la cantidad de días
calendario **inclusive** del rango real completo `[fromDate, toDate]`, sin
recortar al mes al que pertenece la novedad para Finnegans (ese período lo
sigue decidiendo sólo `fromDate`, Etapa 15L.3B.1): una novedad
`30/07/2026 → 02/08/2026` tiene `quantityDays = 4`, y se exporta en julio
con ese mismo valor completo — nunca `2` (los días de julio solamente).

**Preview vs. exportación definitiva** (Etapa 15L.3A, contrato de endpoint
actualizado en la Etapa 15L.4): `GET .../novelties?period=YYYY-MM&preview=true`
sólo informa — muestra todas las novedades candidatas del período,
incluidas las que todavía no están completamente configuradas (marcadas
con un estado de "readiness"), y nunca exige cierre mensual aprobado ni
queda registrada como una exportación realizada. `POST .../novelties/export`
(`{ period, format: "XLSX"|"CSV", reexportReason?, idempotencyKey }`) es la
exportación **definitiva**: revalida todo, bloquea con `409` si alguna
novedad no está lista (código Finnegans configurado, unidad de Valor 1,
cantidad, vigencia) o si el cierre mensual de algún empleado incluido no
está `APROBADO`, y sólo entonces genera el archivo — nunca una exportación
parcial. El GET sin `preview` y `.novelties.csv` se retiraron (sin ningún
caller real) a favor de este único endpoint POST.

**Gate de cierre mensual propio de este módulo**: sólo se exige el cierre
`APROBADO` de los empleados que tienen alguna novedad candidata en el
período — un legajo sin ninguna novedad exportable nunca bloquea la
exportación de los demás.

**Historial, versionado e idempotencia** (Etapa 15L.4,
`docs/decisions/FINNEGANS_EXPORT_HISTORY_IDEMPOTENCY_15L4.md`): cada
exportación definitiva exitosa deja un `FinnegansExportBatch` persistente
(período, versión correlativa, formato, hash del contenido, motivo,
quién y cuándo) con sus filas exportadas en snapshot
(`FinnegansExportBatchItem`, sobrevive aunque la `Novelty` original se
borre después). Reexportar un período ya exportado es posible sin límite,
pero siempre explícito: exige un motivo (mínimo 5 caracteres, exigido por
el backend, no sólo por el frontend). Un mismo intento de exportación
(mismo `idempotencyKey`, generado por el frontend por click) nunca crea
una versión duplicada aunque la request se reintente; una reexportación
voluntaria nueva sí crea una versión nueva, siempre con motivo. `GET
.../history?period=YYYY-MM` lista las versiones de un período (con el
resumen de qué cambió respecto de la anterior); `GET
.../history/:batchId` muestra el detalle de una versión puntual.

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
