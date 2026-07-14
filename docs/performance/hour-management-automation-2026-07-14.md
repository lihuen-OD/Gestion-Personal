# Automatización de gestión de horas — staging/demo

## Alcance y reglas implementadas

- El entorno actual es `staging/demo`: Neon y Google Drive contienen exclusivamente datos y archivos de prueba.
- Cada ingreso conserva un concepto horario habilitado para el legajo (`Normal`, `Sereno` u otro especial). La salida no puede cambiarlo.
- Una jornada cerrada correctamente genera horas `APROBADO` de forma automática. En la interfaz operativa se muestra como **Registradas**, sin exigir un circuito manual de borrador/aprobación.
- Los tramos normales y especiales se agregan por separado. Ejemplo: 08:00–17:00 Normal y 21:00–03:00 Sereno producen dos conceptos; el segundo se divide por fecha al cruzar medianoche sin perder su clasificación.
- Se admiten varias jornadas del mismo concepto y día mientras el período no esté cerrado.
- Al vencer `maxAllowedMinutes` sin salida, la jornada se reclama atómicamente como `FALTA_SALIDA`, registra `0 h` y la observación “Falta registrar la salida”. No se infieren horas.
- La gestión mensual muestra horas normales, especiales, total e incidencias que requieren revisión.
- Los estados históricos se conservan internamente por compatibilidad con cargas manuales, novedades, auditoría y cierres existentes.
- RRHH y Supervisión pueden corregir una hora automática aprobada indicando un motivo obligatorio; el registro conserva su condición contable y la auditoría guarda antes, después y motivo. Un período `CERRADO` permanece inmutable.

## Seguridad funcional

- El concepto se valida contra `EmployeeHourConcept`; un empleado no puede elegir un concepto no habilitado.
- El concepto forma parte del fingerprint idempotente. Reutilizar el UUID con otro concepto produce el conflicto de payload ya definido.
- La jornada abierta guarda el concepto elegido y la salida lo toma de allí.
- La expiración usa un reclamo condicional `ABIERTO + endAt null`, evitando registrar dos incidencias por concurrencia.
- Las horas automáticas sólo pueden seguir acumulándose antes del estado `CERRADO` del período.

## Validación realizada

- `backend`: Prisma Client generado y TypeScript compila.
- `frontend`: TypeScript y build productivo compilan.
- La migración `20260714190000_work_shift_hour_concept` es compatible: agrega columnas anulables, recupera conceptos desde segmentos históricos y no elimina datos.

## Pendiente obligatorio antes de producción

- Aplicar la migración en staging/demo y repetir la matriz con empleados y fotos de prueba.
- Validar visualmente: selector Normal/Sereno, doble jornada, cruce de medianoche, falta de salida, separación mensual y corrección administrativa.
- Confirmar que los jobs de mantenimiento están activos en todas las réplicas y que la alerta `CLOCK_WORK_SHIFTS_MISSING_EXIT` llega al canal operativo.
- Evaluar en una etapa posterior una corrección integral por jornada cuando sea necesario editar simultáneamente fichadas, segmentos y evidencia; la corrección puntual de horas ya exige motivo y auditoría.
