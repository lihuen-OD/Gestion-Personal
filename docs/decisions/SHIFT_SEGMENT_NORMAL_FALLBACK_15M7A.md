# Etapa 15M.7A — fallback normal de segmentos

Fecha: 2026-09-17  
Estado: implementado, pendiente de aprobación para commitear

## Decisión

Hora normal es la base universal y representa la duración real completa de la jornada. Los conceptos horarios adicionales son desgloses aditivos: una regla puede reconocer minutos adicionales, pero nunca reemplaza ni reduce Hora normal.

Cuando ninguna `HourConceptRule` adicional cubre un tramo, ese tramo es Hora normal sin concepto adicional. No constituye una anomalía, no requiere revisión y no genera una nueva `ShiftAlert` `SEGMENTO_SIN_CLASIFICAR`.

## Estado técnico elegido

Se conserva `conceptStatus = SIN_CONCEPTO_COMPATIBLE` como metadata técnica para los nuevos fallbacks. Esta fue la alternativa de menor riesgo porque:

- `MANUAL` ya expresa una clasificación manual o el modo de compatibilidad usado cuando no hay reglas candidatas;
- convertir un fallback automático en `MANUAL` atribuiría un origen falso;
- no hace falta cambiar el enum ni migrar datos;
- la semántica funcional queda corregida en sus consumidores: el estado es neutral, no entra en contadores de revisión y no produce alertas.

El nombre interno queda como deuda semántica histórica. No debe interpretarse como "minutos perdidos" ni como una falla de clasificación.

## Productores de alertas

`notifyClassificationAlerts` y `evaluateShiftExit` dejaron de contar `SIN_CONCEPTO_COMPATIBLE` para producir `SEGMENTO_SIN_CLASIFICAR`. También se retiró ese tipo de la prioridad de notificaciones de salida y se eliminó `findHasAdditionalConceptEnabled`, cuyo único uso era legitimar esa política anterior.

El enum, schemas, contratos API, labels y pantalla de Alertas de Turnos se conservan para poder consultar y renderizar filas históricas ya persistidas.

## Interfaz

En el detalle de segmentos, `SIN_CONCEPTO_COMPATIBLE` se presenta como "Sin concepto adicional", con tono neutral, mensaje "Hora normal sin concepto adicional aplicado" y estado "Sin observaciones". No aparece en el bloque de tramos que requieren revisión.

## Regresión principal

Para una jornada 08:59–11:20 y una regla Prueba 09:00–11:00:

- Hora normal: 141 minutos;
- Prueba: 120 minutos;
- segmentos fallback normales: 1 minuto y 20 minutos;
- `SEGMENTO_SIN_CLASIFICAR`: cero.

Se cubren además reglas parciales, huecos entre múltiples conceptos, ninguna coincidencia y jornadas cross-midnight sin pérdida ni duplicación de minutos.

## Límites explícitos

Esta etapa no modifica Motor B (`HourConceptBreakdown`), `loadMode`, WorkRegime, Horas Especiales, cálculo de Hora normal, liquidación, enums, schema ni migraciones. La rama defensiva `CONCEPTO_NO_HABILITADO` y `ensureHourConceptEnabled` permanecen intactos.

