# Decisión: Conceptos Horarios Aditivos

Fecha: 2026-08-24  
Estado: aceptada; implementación pendiente por etapas

## Problema

La documentación y la implementación actuales mezclan dos modelos incompatibles. El modelo anterior clasifica cada tramo en un único concepto, resuelve solapamientos por `priority` y puede calcular el total sumando horas normales y especiales. Esto permite resultados funcionalmente incorrectos, como registrar 4 horas normales y 6 horas de Sereno para una jornada real de 10 horas.

## Auditoría documental

| Documento | Qué decía | Contradicción | Corrección adoptada |
| --- | --- | --- | --- |
| `docs/PROJECT_CONTEXT.md` | La carga se describía genéricamente por `hourType`, sin fijar la base ni el cálculo del total. | Permitía interpretar que Normal era opcional o intercambiable con otro concepto. | Se incorporó el modelo oficial completo como fuente principal de verdad. |
| `docs/NOVEDADES_HORAS_FINNEGANS.md` | Las horas especiales eran “horas trabajadas con clasificación especial”, tenían “si suma como hora trabajada” y el ejemplo repartía 7 normales + 2 especiales. | Convertía los desgloses en componentes sumables o sustitutivos del total. | Se definió Horas normales como total y los conceptos adicionales como desgloses no sumables, con modos de carga. |
| `docs/plan-redisenio-novedades-horas-liquidacion.md` | Incluía Hora normal en el catálogo asignable y calculaba 8 normales + 2 Colectivo = 10 trabajadas. | Hacía competir a Normal con los conceptos habilitados y repartía el total. | Se marcó como histórico parcialmente reemplazado y se corrigieron los ejemplos centrales. |
| `docs/BACKEND_API_CONTRACTS.md` | Documentaba `countsAsWorked`, orden por `priority`, concepto ganador, exclusión global de solapamientos y `hourConceptId` obligatorio. | Es el contrato técnico del modelo exclusivo actual, no el objetivo aditivo. | Se preservó la descripción del endpoint, pero se rotuló como deuda/deprecación y se aclaró el cálculo objetivo. |
| `docs/performance/hour-management-automation-2026-07-14.md` | Registraba selector Normal/Sereno y tramos clasificados por separado. | Puede confundirse con una regla vigente aunque es evidencia histórica de la implementación anterior. | Se agregó una advertencia de documento histórico y enlace a la decisión vigente. |

Las referencias encontradas en `PROJECT_UI_CONTEXT.md`, `FRONTEND_BACKEND_READINESS.md`, `ENTERPRISE_TABLE_SYSTEM.md`, `SECURITY_STANDARDS.md`, `LOCAL_DEVELOPMENT.md`, `backend/README.md` y los restantes informes de performance son inventarios, navegación, seguridad, operación o métricas. No definen cómo se calcula el total ni una exclusividad entre conceptos, por lo que no requirieron cambios.

## Decisión

Horas normales es la grilla base obligatoria de todo empleado y representa el total real trabajado. Puede originarse en el fichador o en una carga manual por fallas o ajustes autorizados. No depende de una asignación en el legajo.

Los demás conceptos horarios son grillas adicionales y desgloses de Horas normales. Se habilitan por empleado, no reemplazan Horas normales, no compiten entre sí y no se suman para obtener el total trabajado. Sirven para liquidación/exportación, análisis y control.

Cada concepto adicional admite modo de carga `MANUAL`, `AUTOMATICO` o `MANUAL_Y_AUTOMATICO`. Un concepto automático usa una regla activa con hora desde, hora hasta y cruza medianoche. Varias reglas pueden producir desgloses superpuestos de la misma jornada.

## Ejemplos

Empleado trabaja 10 horas reales, de las cuales 6 corresponden a Sereno:

```txt
Horas normales: 10
Sereno:          6
Total trabajado: 10
```

Es incorrecto guardar `Horas normales: 4` y `Sereno: 6`, porque Sereno no sustituye una parte de la base.

Colectivo manual durante una jornada de 8 horas:

```txt
Horas normales: 8
Colectivo:       2
Total trabajado: 8
```

La carga de Colectivo no crea, completa ni incrementa automáticamente Horas normales.

## Impacto en grilla

La grilla siempre muestra Horas normales. Además muestra únicamente los conceptos adicionales habilitados en el legajo. Resúmenes, indicadores y cierres calculan el total trabajado desde Horas normales; los desgloses se presentan en columnas o grillas separadas sin sumarlos al total.

## Impacto en fichador

Las fichadas determinan el intervalo real trabajado y alimentan Horas normales. Después, las reglas automáticas evalúan ese mismo intervalo para generar desgloses adicionales. Una regla de Sereno puede cruzar medianoche. El empleado no debe elegir un concepto que reemplace Horas normales al fichar.

## Impacto en legajo

El legajo habilita conceptos adicionales por empleado. Horas normales no se asigna: existe siempre. Por ejemplo, si Juan Pérez tiene Sereno y Colectivo habilitados pero Camioneta no, su grilla muestra Horas normales, Sereno y Colectivo.

## Impacto en liquidación, novedades y cierres

Los conceptos adicionales pueden alimentar reglas de liquidación o exportación, análisis y control, pero no alteran el total real trabajado. Las novedades continúan siendo eventos separados por persona y día o rango. El cierre mensual debe preservar tanto la base normal como sus desgloses sin doble contabilización.

## Campos y comportamientos a deprecar

* `priority`: no corresponde porque los conceptos no compiten. Queda deprecado y pendiente de eliminación futura.
* Selección de un concepto “ganador” y rechazo global de solapamientos: quedan deprecados.
* `countsAsWorked`: no debe decidir si un concepto adicional incrementa el total; queda deprecado para ese cálculo.
* Uso exclusivo de `hourConceptId` en una jornada o `TimeSegment`: puede mantenerse temporalmente por compatibilidad, pero no debe imponer exclusividad funcional.

## Estado actual y transición

La aplicación puede no cumplir todavía esta decisión en todos sus consumidores. El sistema no está en producción, por lo que no se conservarán campos, datos ni comportamientos legacy incorrectos sólo por compatibilidad. La corrección se realiza por etapas separadas, cada una con pruebas, sin mezclar schema, frontend, grilla, fichador, cierres y exportaciones en un mismo cambio.

### Etapa 6C — base persistente agregada

La migración `add_hour_concept_breakdowns` incorpora únicamente estructura compatible, sin activar todavía el modelo aditivo:

* `HourConcept.loadMode` acepta `MANUAL`, `AUTOMATIC` o `BOTH` y permanece nullable para no atribuir una modalidad a conceptos existentes sin revisión.
* `HourConceptBreakdown` almacena exclusivamente desgloses adicionales por empleado, fecha y concepto. Reutiliza `ApprovalStatus` y admite origen `MANUAL` o `AUTOMATIC`.
* Los vínculos opcionales a `WorkShift`, `TimeSegment` y `HourConceptRule` permiten trazabilidad automática futura; las cargas manuales pueden existir sin esos vínculos.
* La clave única `timeSegmentId + hourConceptRuleId + hourConceptId + source` evita regenerar el mismo desglose cuando una fila automática tenga segmento y regla. Como PostgreSQL permite múltiples `NULL` en una clave única, la etapa funcional deberá exigir ambos vínculos para origen `AUTOMATIC`.
* `priority`, `countsAsWorked`, `TimeEntry`, `TimeSegment` y el comportamiento actual se conservan sin cambios. La tabla nueva todavía no tiene servicios, endpoints, carga manual ni generación automática.
* No se realizó backfill: los registros existentes conservan `loadMode = null` y no se crearon desgloses históricos.

La inspección de la base de desarrollo al crear 6C encontró `HC-NORMAL` con historial, pero inactivo y eliminado lógicamente, y otro concepto (`Colectivo`) clasificado como `kind = NORMAL`. Por eso `kind` no identifica hoy de forma segura una única base. 6C no modifica esos datos ni el seed. Antes de hacer obligatoria la base debe decidirse la reactivación/normalización del concepto canónico y evaluar un rol estable del sistema (por ejemplo `baseRole`/`isSystem`) en lugar de depender del nombre o de `kind` solamente.

### Etapa 6D — concepto Normal canónico y catálogo normalizado

* `HourConcept.systemRole = NORMAL_BASE` identifica de forma estable y única la base del sistema, sin depender de `code`, nombre o `kind`. El único canónico recuperado es la fila histórica `HC-NORMAL`.
* `HC-NORMAL` queda activo, sin baja lógica, con `kind = NORMAL`, sin `loadMode` y fuera de `EmployeeHourConcept`: existe siempre y no se habilita por legajo.
* Los conceptos adicionales requieren `loadMode`. El contrato genérico no permite crear otro `kind = NORMAL`, y las operaciones de edición, eliminación o asignación rechazan el concepto administrado por el sistema.
* El catálogo demo queda corregido como `Sereno = AUTOMATIC`, `Colectivo = TRANSPORTE/MANUAL` y `Guardia = AUTOMATIC`. No se crea Camioneta porque no existía en los datos auditados.
* La migración normaliza cualquier concepto legacy restante: los `kind = NORMAL` no canónicos pasan a `OTRO` y los que no tienen modo reciben `AUTOMATIC` sólo si son Nocturna, Guardia o Sereno; en los demás casos reciben `MANUAL`.
* Un constraint de base preserva la separación: Normal debe estar activo y sin modo; todo adicional debe tener modo y no puede usar `kind = NORMAL`.
* Esta etapa no cambia todavía grilla, fichador, generación de desgloses, cierres, dashboard ni exportaciones. Esos consumidores continúan como deuda explícita para etapas posteriores.

### Etapa 6E — configuración alineada al modelo aditivo

* El CRUD genérico configura únicamente conceptos adicionales: exige `loadMode`, no acepta `kind = NORMAL` ni `countsAsWorked`, y mantiene `NORMAL_BASE` visible pero protegido de edición, cambio de estado, eliminación y asignación.
* Las respuestas del catálogo incluyen `loadMode` y `systemRole`. La pantalla distingue “Base del sistema” de “Adicional” y muestra los modos Manual, Automático y Manual y automático.
* Las reglas horarias sólo se consultan o modifican para conceptos adicionales activos con modo `AUTOMATIC` o `BOTH`. Normal, los conceptos manuales y los conceptos inactivos/eliminados son rechazados por backend; la UI explica el modo manual sin abrir el editor de reglas.
* `priority` continúa físicamente en la base y en el clasificador legacy, que todavía no se modifica. Sale del contrato de escritura, de las respuestas públicas del módulo y de la UI; las reglas nuevas persisten temporalmente `priority = 0` como detalle interno. También se retiró el rechazo de solapamientos basado en prioridad porque los desgloses no compiten.
* `countsAsWorked` continúa físicamente por deuda legacy, pero queda fuera del contrato editable y de la UI. No gobierna el total trabajado en el modelo nuevo.
* Las asignaciones aceptan únicamente conceptos adicionales activos, no eliminados y con modo definido. Las respuestas de legajo que exponen conceptos asignados incluyen `loadMode` y `systemRole`.
* Continúan pendientes la generación aditiva real, la grilla mensual, el fichador, `TimeEntry`, `TimeSegment`, cierres, dashboard y exportaciones; 6E no modifica ninguno de esos consumidores.

### Etapa 6F — habilitación por legajo

* `EmployeeHourConcept` representa exclusivamente conceptos adicionales habilitados. Horas normales sigue siendo universal y no se almacena ni se muestra como opción del legajo.
* La asignación valida por ID que cada concepto tenga `systemRole = null`, estado activo, `deletedAt = null` y `loadMode` definido. La misma regla se aplica al alta del empleado y al reemplazo posterior de sus conceptos; los IDs se deduplican antes de persistir.
* El catálogo asignable reutiliza `GET /hour-concepts?status=ACTIVO` y se filtra por identidad estable y modo de carga. No se creó otro endpoint, schema ni migración.
* La respuesta del legajo incluye por cada vínculo `id`, `code`, `name`, `kind`, `loadMode`, `status` y `systemRole`. La presencia de `EmployeeHourConcept` significa `enabled = true`; cualquier vínculo legacy con Normal o con un concepto que ya no sea asignable se ignora defensivamente al leer y se elimina en el siguiente reemplazo.
* La sección pasa a llamarse “Conceptos horarios adicionales”, explica que Horas normales se aplica siempre y muestra nombre, modo y estado. La selección y persistencia usan IDs; no exponen `priority` ni `countsAsWorked`.
* Estos conceptos habilitados serán la fuente de verdad para decidir qué filas o desgloses adicionales verá el empleado. La grilla aditiva y la generación manual/automática continúan pendientes y no forman parte de 6F.

### Etapa 6G — grilla aditiva base

* `GET /employees/:id/time-grid` presenta una colección `rows` ordenada: primero el concepto canónico con `systemRole = NORMAL_BASE` y luego sólo los conceptos adicionales habilitados en `EmployeeHourConcept`. Cada fila conserva el ID estable, `loadMode` y `systemRole`; los nombres son exclusivamente de presentación.
* La fila Normal se alimenta de los `TimeEntry` normales ya existentes. `totalWorkedMinutes` se deriva exclusivamente de esa fila y nunca suma conceptos adicionales.
* Las filas adicionales se alimentan únicamente de `HourConceptBreakdown` no rechazados del período. Un concepto habilitado aparece con total cero aunque todavía no tenga desgloses. Los `TimeEntry` especiales legacy no se reinterpretan como desgloses ni aumentan el total.
* La pantalla mensual muestra Normal siempre primera y mantiene su edición manual existente. Los adicionales son de sólo lectura en esta etapa, muestran su modo de carga y no incorporan acciones manuales ni generación automática.
* Esta etapa es de presentación aditiva. No modifica schema, migraciones, fichador, `TimeSegment`, cálculo/clasificador operativo, cierres, dashboard ni exportaciones. La generación y carga funcional de `HourConceptBreakdown` quedan para etapas separadas.

### Etapa 6H — carga manual de desgloses adicionales

* La carga manual escribe exclusivamente `HourConceptBreakdown` con `source = MANUAL` y estado inicial `BORRADOR`. Nunca crea un `TimeEntry` especial ni modifica Horas normales o `totalWorkedMinutes`.
* Sólo se permite para conceptos adicionales habilitados en el legajo, activos, no eliminados y con `loadMode = MANUAL` o `BOTH`. Normal y los conceptos `AUTOMATIC` son rechazados por backend; la UI mantiene estos últimos en modo de sólo lectura.
* La identidad funcional es empleado + fecha + concepto + `source = MANUAL`. El repositorio usa una transacción serializable, actualiza el registro existente y elimina duplicados legacy defensivamente. No se agregó schema ni migración en esta etapa.
* Hardening pendiente: garantizar esa identidad con un índice único parcial PostgreSQL sobre `(employeeId, date, hourConceptId) WHERE source = 'MANUAL'`, precedido por una comprobación/saneamiento de duplicados. No corresponde usar un `@@unique([employeeId, date, hourConceptId, source])` global porque también limitaría los futuros breakdowns `AUTOMATIC` a una sola fila por día y concepto, aunque provengan de turnos o segmentos distintos. Prisma no expresa actualmente este índice parcial en `schema.prisma`, por lo que debe incorporarse en una migración SQL dedicada y verificable.
* Guardar cero mediante el mismo PUT elimina físicamente el desglose manual de esa celda. No se agregó una ruta HTTP DELETE porque `/employees` protege explícitamente esa convención. Se eligió delete físico interno porque `HourConceptBreakdown` no tiene baja lógica y el registro manual es un dato editable, no una fuente histórica externa; la acción queda auditada.
* Si un concepto se deshabilita del legajo, sus breakdowns existentes se conservan como historia persistida pero dejan de aparecer en la grilla activa. Debe volver a habilitarse para admitir edición manual directa.
* Los períodos `ENVIADO`, `APROBADO` o `CORRECCION_PENDIENTE` bloquean edición directa, reutilizando el cierre mensual existente. `ABIERTO`, ausencia de cierre y un cierre `DEVUELTO` permiten corrección.
* La grilla continúa mostrando únicamente breakdowns habilitados y estados visibles. Normal conserva su flujo actual; generación automática, fichador, cierres/exportaciones como consumidores y dashboard siguen pendientes de etapas separadas.

## Plan de implementación futura

1. Auditar datos y comportamiento actual: fichadas, `TimeSegment`, `TimeEntry`, cierres, exportaciones y asignaciones por legajo.
2. Diseñar compatibilidad y migración de datos sin perder historial ni duplicar totales.
3. Adaptar el modelo para garantizar Horas normales y modos de carga por concepto adicional.
4. Reemplazar clasificación exclusiva por derivación aditiva de desgloses automáticos, incluido cruce de medianoche.
5. Rediseñar legajo y grilla: base siempre visible y conceptos adicionales habilitados.
6. Corregir resúmenes, liquidación/exportaciones y cierres para tomar el total solo de Horas normales.
7. Deprecar y luego retirar `priority` y cualquier uso contable incompatible de `countsAsWorked`, con migraciones y contratos versionados si corresponde.
8. Agregar pruebas de carga manual, fichador, solapamientos, medianoche, cierres y ausencia de doble contabilización antes de activar el nuevo modelo.
