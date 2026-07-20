# Primer lote incremental — resultado

Fecha: 2026-07-20

## Alcance ejecutado

- Baseline funcional y de experiencia.
- Claves de cache aisladas por usuario, rol, empresa y sector.
- Cache stale-while-revalidate en el listado de Legajos.
- Búsqueda remota incremental de empleados en Novedades y Documentación.
- Separación de Leaflet del barrel y del chunk de opciones de rol/horas.

No se modificaron reglas de negocio, base de datos, índices, Drive, infraestructura, Horas, Asistencia, Auditoría, guardados complejos ni optimizaciones generales de React.

## Métricas antes/después

| Métrica | Antes | Después | Resultado |
| --- | ---: | ---: | --- |
| Requests de empleados al abrir modal de Novedades | 1 (`take=1000`) | 0 | 1 request y hasta 1.000 registros evitados por apertura |
| Requests de empleados al abrir modal de Documentación | 1 (`take=1000`) | 0 | 1 request y hasta 1.000 registros evitados por apertura |
| Búsqueda dentro de esos modales | carga completa anticipada | desde 2 caracteres, debounce 300 ms, `take=20` | payload acotado y bajo demanda |
| Segunda lectura idéntica de Legajos dentro de 30 s | 1 solicitud de página al remontar | 0 solicitudes HTTP | hit de memoria por clave y alcance |
| Vuelta a Legajos con snapshot disponible | tabla vacía + estado de carga | filas y paginación visibles en el primer render | sin skeleton completo; revalidación en segundo plano si venció el TTL |
| Chunk `roleHourOptions` | 165,27 kB (49,40 kB gzip), mezclado con Leaflet | 8,43 kB (3,14 kB gzip) | -156,84 kB (-94,9 %) en ese chunk compartido |
| Leaflet/mapa | mezclado en `roleHourOptions` | chunk propio 156,80 kB (46,16 kB gzip) | descargado sólo al renderizar un mapa |
| CSS de Leaflet | asociado al grafo anterior | chunk propio 15,61 kB (6,46 kB gzip) | CSS diferido con el mapa |
| HTML + JS inicial + CSS inicial | 332.354 B | 332.583 B | +229 B (+0,07 %), dentro del presupuesto |
| Requests iniciales del presupuesto | 3 | 3 | sin regresión |

El “tiempo hasta datos visibles” al volver a Legajos pasa de depender de la respuesta remota a estar disponible en el primer render cuando existe snapshot. No se asigna un valor de milisegundos de pintura porque no hubo una sesión de navegador instrumentable; queda pendiente medir FCP/commit visual en staging.

## Comportamiento del cache

- La clave incluye `userId`, `role`, `companyId` y `sectorId`, además de familia, versión y request.
- El listado de Legajos usa TTL de 30 segundos y no persiste datos sensibles fuera de memoria.
- Dentro del TTL se devuelve el valor cacheado sin request HTTP.
- Vencido el TTL se muestran los datos existentes y se lanza una única revalidación de fondo.
- Las mutaciones de empleados invalidan la familia `employees` y eliminan los snapshots; no se conservan filas potencialmente obsoletas después de editar.
- Cambiar usuario, rol, empresa o sector produce otra clave y evita reutilizar datos de otro alcance.

## Validación funcional y técnica

- `npm test`: 4 archivos, 12 tests aprobados.
- Tests de aislamiento de clave: mismo alcance mantiene clave; usuario, rol, empresa o sector diferentes generan claves diferentes.
- `npm run build`: aprobado con Vite 6.4.3, 1.790 módulos transformados.
- `npm run performance:check`: aprobado, 332.583 B en 3 requests iniciales y módulos pesados diferidos.
- Inspección estática: no quedan consumidores del barrel `employeeOptions`; MediaPipe y XLSX permanecen en chunks diferidos.
- Novedades y Documentación conservan empleados preseleccionados y no alteran el payload de guardado.

## Riesgos pendientes

- La primera apertura de un mapa agrega una solicitud diferida y puede mostrar brevemente “Cargando mapa...”. Es el costo intencional de no descargar Leaflet antes de necesitarlo.
- El snapshot de Legajos es sólo de memoria: un refresh completo del navegador vuelve a depender de la API. Esto evita persistir información sensible.
- Las métricas de pintura y la validación visual responsive necesitan una sesión real de navegador/staging; no se inventaron valores.
- La búsqueda remota depende de que el endpoint mantenga la semántica actual de `search` y `take`.
- El alcance aprobado no incluyó cache del resumen de Legajos en el primer render, detalle, Horas, Asistencia, Auditoría ni guardados.

## Decisión

El lote cumple sus objetivos técnicos sin ampliar el alcance ni cambiar reglas de negocio. Puede pasar a validación manual en staging. Antes de iniciar el segundo lote conviene confirmar visualmente: retorno a Legajos con datos inmediatos, búsqueda con teclado en ambos modales, preservación de selección y carga del mapa en alta/detalle de legajo.
