# Baseline — primer lote incremental de fluidez

Fecha: 2026-07-20

## Alcance

- Identidad de cache por usuario, rol y alcance.
- Stale-while-revalidate del listado de Legajos.
- Búsqueda incremental de empleados en Novedades y Documentación.
- Separación de imports que arrastran Leaflet al chunk de opciones laborales.

No incluye Horas, Asistencia, Auditoría liviana, guardados complejos ni optimizaciones React.

## Línea base funcional

| Flujo | Estado previo |
| --- | --- |
| Abrir Legajos | 3 lecturas: listado, resumen y catálogo de estructura. |
| Volver a Legajos dentro de 15 s | El cache HTTP puede evitar red, pero la página remonta sin filas y presenta estado de carga. |
| Volver a Legajos después de 15 s | El listado vuelve a solicitarse y presenta skeleton completo. |
| Abrir Nueva novedad | 1 request de opciones de empleados con `take=1000` antes de abrir el modal. |
| Abrir Agregar documento | 1 request de opciones de empleados con `take=1000` antes de abrir el modal. |
| Identidad del cache persistente | Sólo hash de `user.id`; no incluye rol, empresa ni sector. |

## Bundle previo

Build de producción Vite 6.4.3:

| Artefacto | Bytes | Gzip |
| --- | ---: | ---: |
| HTML | 424 | 294 |
| JS inicial | 205.410 | 66.530 |
| CSS inicial | 126.520 | 22.740 |
| Carga inicial total | 332.354 | — |
| `roleHourOptions` | 165.272 | 49.400 |
| `structureOptions` | 67.520 | 16.390 |

El chunk `roleHourOptions` contiene Leaflet/React Leaflet aunque el archivo fuente de opciones horarias mide menos de 1 kB. La causa observada es el barrel `components/employees/employeeOptions.ts`, que reexporta opciones simples junto con dependencias de estructura, domicilio y mapa.

## Criterios de comparación

- Segunda lectura idéntica de Legajos: 0 requests adicionales durante el TTL.
- Lectura stale: devolver filas inmediatamente y ejecutar una sola revalidación en segundo plano.
- Cambio de usuario, rol, empresa o sector: clave distinta.
- Abrir los modales: 0 requests de empleados hasta que el usuario busque.
- Búsqueda: debounce y máximo 20 resultados por request.
- Leaflet ausente del chunk de opciones horarias y conservado fuera del JS inicial.

## Limitación de medición visual

El navegador integrado no está disponible en esta sesión. El tiempo hasta datos visibles se validará estructuralmente mediante el camino síncrono de cache y pruebas de hit/stale; no se informarán métricas de paint o React Profiler inventadas.
