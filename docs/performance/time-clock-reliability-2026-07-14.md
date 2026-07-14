# Fichador con foto: confiabilidad e idempotencia

Fecha: 2026-07-14  
Alcance: fichador público con foto (`POST /api/time-entries/clock/photo-punch`).

## Incidente y línea base

Comportamiento observado antes del cambio:

- la API podía responder `500` después de crear una fichada observada, por lo que la interfaz indicaba error aunque existía un registro;
- el botón de confirmación permanecía habilitado mientras el pedido estaba en curso;
- no existía una clave idempotente que relacionara un intento de la interfaz con una única operación de backend;
- dos salidas concurrentes podían leer la misma jornada abierta;
- la evidencia se subía antes de completar todas las validaciones funcionales.

En la primera etapa no se obtuvo un tiempo real porque el backend local no estaba disponible. La medición se completó posteriormente en staging y se registra al final de este documento.

## Cambio implementado

- Cada intento usa un UUID estable y queda registrado como `PROCESSING`, `COMPLETED` o `FAILED`.
- El UUID se vincula a una huella SHA-256 de empleado, tipo, estado/puntaje facial, foto y miniatura; reutilizarlo con evidencia esencial distinta responde `409 Conflict`.
- Repetir el mismo UUID devuelve el resultado ya confirmado y no vuelve a fichar.
- Ante timeout de red, el frontend consulta el estado del intento antes de informar un fallo.
- El botón, cierre del modal y nueva captura quedan bloqueados sincrónicamente durante el envío.
- Las validaciones de empleado, rostro, jornada abierta, concepto horario y días bloqueados ocurren antes de subir evidencia.
- Una falla de storage no crea una fichada observada ni una jornada.
- Los archivos subidos parcialmente se eliminan mediante compensación.
- La apertura tiene una restricción única de base de datos por empleado.
- La salida reclama atómicamente la jornada abierta; un segundo pedido concurrente no crea otra salida.
- Un error técnico inesperado se informa como operación no confirmada y puede recuperarse consultando el intento.
- Los intentos `PROCESSING` vencen automáticamente a los 60 segundos por defecto, incluso si ningún cliente consulta su estado.
- Los intentos finalizados se retienen 30 días por defecto y luego se eliminan mediante mantenimiento periódico.
- Se emiten alertas estructuradas para intentos fallidos, intentos vencidos, compensaciones fallidas, mantenimiento fallido y evidencia huérfana.

## Resultado verificable

| Escenario | Antes | Después |
| --- | --- | --- |
| Doble clic | Podía enviar varias solicitudes | Guardia síncrona y controles deshabilitados |
| Respuesta perdida después del guardado | La UI mostraba error ambiguo | Consulta de estado y recuperación del resultado confirmado |
| Reenvío del mismo intento | Podía duplicar efectos | Resultado idempotente por UUID |
| Dos ingresos concurrentes | Dependía de la aplicación | Índice único parcial en base de datos |
| Dos salidas concurrentes | Ambas podían leer jornada abierta | Reclamo condicional dentro de transacción |
| Falla al guardar foto | Podía dejar fichada observada | No crea fichada; limpia carga parcial |
| Validación funcional rechazada | Podía subir foto antes de fallar | Validación previa al storage |

## Validaciones ejecutadas

- Backend: `npm run typecheck` — OK.
- Backend: `npm run build` — OK.
- Frontend: `npm test` — 7/7 pruebas OK.
- Frontend: `npm run build` — OK.
- Presupuesto frontend: 324.516 bytes iniciales en 3 requests; módulos pesados diferidos — OK.
- Migración Prisma aplicada y cliente regenerado.
- Prueba HTTP local posterior: `GET /api/health` respondió `200`; un `photo-punch` incompleto respondió `400` con validación de `requestId`, empleado, foto y estado facial, sin mutación.
- Auditoría inicial: se detectaron 7 archivos activos potencialmente huérfanos; fueron revisados y conciliados en staging, como se detalla al final.

## Matriz manual obligatoria antes de producción

Ejecutar en un ambiente de prueba con empleados dedicados y revisar UI, `ClockPunchAttempt`, `WorkShift`, `AttendancePunch`, `TimeEntry` y archivos de storage:

1. Entrada normal y salida normal.
2. Diez clics rápidos sobre confirmar: debe existir una sola operación.
3. Cortar la respuesta de red después del envío: la UI debe recuperar el resultado mediante el UUID.
4. Repetir exactamente el mismo request: debe devolver el mismo resultado.
5. Enviar dos UUID simultáneos de entrada: sólo una jornada debe quedar abierta.
6. Enviar dos UUID simultáneos de salida: sólo una salida y sus segmentos deben persistirse.
7. Simular storage caído: no debe existir punch, jornada ni archivo parcial.
8. Rostro inválido, empleado inactivo, sin ingreso abierto, día bloqueado y horas aprobadas: rechazo claro sin mutación.
9. Jornada con cruce de medianoche y jornada vencida: conservar segmentos y reglas actuales.
10. Verificar permisos, fichador público y visualización administrativa de evidencia.

## Riesgos pendientes

- Reducir y volver a medir la latencia real de la confirmación inicial.
- Conectar los eventos estructurados de alerta con el recolector/servicio de monitoreo del despliegue.
- Revisar periódicamente la política de retención de 30 días según volumen y requisitos de auditoría.

## Ejecución staging final

Entorno confirmado por el responsable como demo/staging sin datos productivos:

- `APP_ENV=staging`;
- `NODE_ENV=development`;
- `VITE_APP_ENV=staging`;
- `VITE_DEMO_MODE=false`;
- Neon actual: base de prueba;
- Google Drive actual: storage de prueba.

Se usaron exclusivamente empleados temporales con prefijo `STG-CLOCK-*` y una imagen técnica PNG del repositorio. La verificación posterior obtuvo 0 empleados temporales, 0 intentos asociados y 0 evidencias activas sin vínculo.

| Escenario | Resultado staging |
| --- | --- |
| Validación facial inválida | `422`; 0 jornadas |
| Empleado inactivo | `403`; 0 jornadas |
| Salida sin ingreso abierto | `409`; 0 evidencia activa |
| Día bloqueado por novedad | `409`; 0 evidencia activa |
| Storage deshabilitado | `503`; 0 jornadas, 0 punches, 0 archivos activos |
| Doble clic, mismo UUID | `201` + `409 PROCESSING`; 1 jornada y 1 punch |
| Mismo UUID, payload distinto | `409 CLOCK_IDEMPOTENCY_KEY_REUSED` |
| Dos ingresos concurrentes | `201` + `409`; exactamente 1 jornada abierta |
| Dos salidas concurrentes | `201` + `409`; exactamente 1 punch de salida |
| Timeout de cliente | intento recuperado por consulta; reintento idempotente `201`; 1 jornada |
| Cruce de medianoche | `201`; `crossesMidnight=true`; 2 segmentos |
| Horas aprobadas | `409`; 0 evidencia activa residual; 0 punch de salida |
| Evidencia administrativa | `200 image/png`; 64.879 bytes |

Los 7 archivos huérfanos fueron revisados: uno estaba identificado como diagnóstico y seis eran tres pares foto/miniatura de intentos de prueba sin punch. Se eliminaron de Drive staging, quedaron `DELETED` en Neon y la comprobación final obtuvo 0 archivos activos huérfanos.

### Latencia real

- Primera operación exitosa con Drive (fría): 10.173,1 ms.
- Mediana general de 14 muestras: 8.919,8 ms.
- Peor caso: 19.272,4 ms (rechazo y compensación por horas aprobadas).
- Reintento idempotente caliente: 613,6 ms.
- Visualización administrativa de evidencia: 2.626,3 ms.

La instrumentación muestra múltiples consultas Neon de aproximadamente 250–800 ms y dos cargas secuenciales a Drive por fichada. La seguridad e integridad funcional quedan validadas, pero el tiempo de confirmación inicial no es adecuado para producción.

Decisión: **FUNCIONALMENTE APROBADO EN STAGING, NO APTO PARA PRODUCCIÓN POR LATENCIA**. Antes de promover se debe reducir la ruta de confirmación, medir nuevamente una ejecución fría y tres calientes, y mantener las invariantes verificadas por `npm run staging:clock:matrix`.

## Optimización de ruta crítica

Cambios aplicados sin modificar las invariantes:

- contexto consolidado para empleado y jornada abierta;
- el ingreso no consulta conceptos horarios que sólo necesita la salida;
- original y miniatura dejaron de bloquearse secuencialmente;
- la foto original continúa siendo obligatoria, persistida y vinculada antes de confirmar;
- la miniatura queda `PENDING`, se sube 750 ms después fuera de la respuesta y se vincula transaccionalmente;
- si la miniatura o su vinculación fallan, se compensa el archivo y se emite `CLOCK_PHOTO_THUMBNAIL_FAILED`;
- auditoría exitosa diferida 500 ms con alerta crítica ante fallo;
- `ClockPunchAttempt=COMPLETED` continúa actualizándose antes de responder;
- horas aprobadas/cerradas se validan antes del storage;
- validaciones independientes de segmentos se ejecutan en paralelo;
- rollover vencido y salida conservan reclamo atómico;
- timeout transaccional explícito de 20 s para cierres multisegmento sobre Neon remoto;
- protección contra creación concurrente de carpetas Drive;
- loading modal explícito al abrir evidencia administrativa.

### Comparación antes/después

| Medición | Antes | Después | Diferencia |
| --- | ---: | ---: | ---: |
| Mediana matriz | 8.919,8 ms | 3.960,5 ms | -55,6% |
| Peor caso | 19.272,4 ms | 11.444,3 ms | -40,6% |
| Reintento idempotente | 613,6 ms | 721,6 ms | +17,6%, aún <1 s |
| Evidencia administrativa | 2.626,3 ms | 2.470,4 ms | -5,9% y loading explícito |
| Horas aprobadas | 19.272,4 ms | 2.276,5 ms | -88,2%; rechazo previo a storage |

Desglose representativo de ingreso caliente:

- contexto/validaciones: 340–405 ms;
- reserva idempotente: aproximadamente 340–410 ms;
- storage original: 3.161–3.412 ms;
- storage miniatura en ruta crítica: 0 ms (`PENDING`);
- transacción de ingreso: aproximadamente 680–820 ms;
- cierre `ClockPunchAttempt`: 172–174 ms;
- respuesta total interna caliente observada: 4.543–4.983 ms.

Desglose representativo de salida normal:

- contexto: aproximadamente 536 ms;
- storage original: aproximadamente 3.321 ms;
- concepto, validaciones y transacción: aproximadamente 1.855 ms;
- cierre idempotente: aproximadamente 348 ms;
- total observado: aproximadamente 6.242 ms.

Resultado final de la matriz:

- carga fría: 9.012,3 ms;
- mediana de 14 muestras: 3.960,5 ms;
- ingreso caliente exitoso: 4.920,6 ms;
- salida normal exitosa: 6.375,8 ms;
- cruce de medianoche: 11.444,3 ms con 2 segmentos;
- reintento idempotente: 721,6 ms;
- evidencia administrativa: 2.470,4 ms con loading visible;
- limpieza: 0 empleados temporales y 0 evidencias activas sin vínculo.

Decisión posterior: **MEJORA ACEPTABLE, AÚN NO APTO PARA PRODUCCIÓN**. Se alcanzó el límite inicial menor a 5 s para el ingreso caliente y la mediana general, pero no para carga fría, salida normal ni cruce de medianoche. El siguiente cuello es Drive original (3–6,4 s) y los roundtrips secuenciales de la transacción de salida; no se proponen índices sin `EXPLAIN ANALYZE`.

## Decisión de storage y UX de espera

Se mantiene Google Drive como storage principal para fichadas y documentación por costo, administración centralizada y aprovechamiento de Google Workspace. Se acepta explícitamente una latencia superior a la de un storage especializado en imágenes durante esta etapa.

La experiencia del fichador compensa esa latencia con estas reglas:

- bloqueo síncrono de confirmación, cierre y nueva captura;
- mensajes visibles “Registrando fichada...”, “Guardando evidencia fotográfica...” y “No cierres esta pantalla.”;
- después de 4 segundos se informa que Drive puede demorar;
- ante timeout se consulta el mismo UUID hasta `COMPLETED` o `FAILED`, con un máximo de 30 consultas cada 1,5 segundos;
- `COMPLETED` muestra el resultado confirmado;
- `FAILED` o vencido muestra el error del backend y habilita un nuevo intento;
- si no puede determinarse un estado terminal por pérdida prolongada de conectividad, el UUID queda bloqueado y no se permite iniciar otro intento ambiguo;
- administración muestra un modal de loading explícito mientras descarga evidencia.

El criterio aceptado es que una espera de 4–6 segundos resulta válida si el empleado comprende que se está guardando evidencia y no puede duplicar la operación.
