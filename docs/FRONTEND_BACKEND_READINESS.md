# Frontend Backend Readiness

## Objetivo

Este documento deja explícito qué parte del frontend ya está razonablemente preparada para migrar a backend y qué parte todavía depende de mocks, localStorage o reglas de UI que deberán bajar a una capa de dominio/API.

La app sigue en fase `frontend-only`.

No hay backend real, base de datos ni contratos HTTP implementados en esta etapa.

## Fronteras actuales

### Persistencia actual
- `localStorage` para catálogos, legajos, horas, novedades, documentos, auditoría y estructura.
- `sessionStorage` para sesión mock.
- Servicios mock centralizados como fuente de verdad.

### Frontera objetivo futura
- `types` compartidos o DTOs equivalentes.
- `mock service` reemplazable por `api service`.
- selectores/helpers de presentación sin dependencia de storage.
- reglas críticas validadas también en backend.

## Módulos y estado de preparación

### 1. Legajos
**Estado:** intermedio

Ya existe:
- entidad `Employee` rica en datos personales, laborales y de relaciones;
- historial de cambios por campo y por bloque;
- integración con estructura, puestos, horas habilitadas y documentación.

Falta antes de backend:
- cerrar contrato de relaciones múltiples (`companies`, responsables, encargados);
- definir validaciones servidor-side de unicidad (`legajo`, `dni`, `cuil`);
- separar mejor defaults de alta vs datos persistidos;
- decidir estrategia de versionado/historial en backend.

### 2. Puestos
**Estado:** bastante listo para migrar

Ya existe:
- catálogo bien tipado;
- rango salarial;
- relaciones con estructura;
- asignación visual a personas.

Falta:
- definir contrato formal de compatibilidad puesto vs legajo;
- documentar reglas obligatorias de estructura y categorías;
- bajar comparación y warnings críticos a backend.

### 3. Empresas y estructura
**Estado:** bastante listo para migrar

Ya existe:
- catálogo central;
- relaciones configurables;
- derivaciones parciales ya resueltas en frontend.

Falta:
- definir claramente qué relaciones se calculan y cuáles se cargan manualmente;
- formalizar IDs externos/internos para backend;
- validar integridad relacional en servidor.

### 4. Tipos de novedades
**Estado:** listo para migración temprana

Ya existe:
- catálogo maestro;
- reglas funcionales;
- color UI por tipo;
- vínculo Finnegans;
- aprobación por rol mock.

Falta:
- consolidar contrato de reglas en DTO/API;
- formalizar auditoría de cambios;
- definir si approval roles serán IDs, roles lógicos o permisos.

### 5. Horas especiales
**Estado:** listo para migración temprana

Ya existe:
- catálogo separado de novedades;
- habilitación por legajo;
- reglas de uso en carga de horas.

Falta:
- decidir restricciones duras por concepto;
- formalizar si backend validará máximos diarios o por período.

### 6. Novedades operativas
**Estado:** intermedio

Ya existe:
- alta individual o múltiple;
- documentación adjunta mock;
- aprobación/rechazo;
- exportación Finnegans;
- impacto visual en carga horaria.

Falta:
- definir reversión/compensación al rechazar;
- cerrar precedencia entre novedad bloqueante y carga existente;
- formalizar lifecycle completo del registro.

### 7. Carga horaria
**Estado:** intermedio / sensible

Ya existe:
- período dinámico;
- resumen por persona;
- revisión y aprobación;
- exportación Excel operativa;
- novedades contextuales por celda;
- reglas básicas de bloqueo.

Falta:
- endurecer permisos por rol y alcance;
- cerrar ciclo completo de estados;
- bajar a backend reglas de edición sobre registros aprobados;
- resolver futura trazabilidad completa por alta/edición/revisión/exportación.

### 8. Exportación Finnegans
**Estado:** bastante listo para integración

Ya existe:
- armado real de Excel;
- filtro de registros exportables;
- columnas alineadas con el formato funcional actual.

Falta:
- validar layout final con archivos reales de prueba;
- decidir naming/versionado del archivo;
- documentar reglas exactas de inclusión/exclusión por estado.

### 9. Usuarios, roles y sesión
**Estado:** no listo para migración directa

Ya existe:
- mock de usuarios;
- rol y alcance visibles en UI;
- sesión simulada.

Falta:
- auth real;
- permisos reales por endpoint;
- modelo de sesión/token;
- estrategia de refresh/expiración;
- backend enforcement completo.

### 10. Auditoría
**Estado:** intermedio

Ya existe:
- registro mock centralizado;
- tablas legibles;
- varios eventos ya disparados desde servicios.

Falta:
- catálogo uniforme de eventos;
- persistencia inmutable;
- correlación por usuario, entidad y acción;
- decisión de retención/exportación.

## Reglas que hoy viven en frontend y después deben vivir también en backend

- unicidad de legajo/dni/cuil;
- alcance por rol en carga horaria;
- permisos de aprobación de novedades;
- bloqueo de edición en horas aprobadas;
- validaciones de rango de fechas;
- consistencia entre puesto y estructura;
- documentos obligatorios según tipo de novedad;
- inclusión o exclusión en exportaciones.

## Prioridad recomendada de migración futura

1. Catálogos maestros:
   - estructura
   - puestos
   - tipos de novedades
   - horas especiales
   - categorías documentales
   - parámetros de auditoría

2. Seguridad:
   - usuarios
   - autenticación
   - permisos

3. Operación core:
   - legajos
   - documentos
   - novedades
   - carga horaria

4. Integraciones y reporting:
   - exportación Finnegans
   - reportes
   - dashboard
   - auditoría consolidada

## Señales de que el frontend ya quedó mejor preparado

- menos lógica compartida incrustada en `App.tsx`;
- shell, dashboard y helpers base extraídos a módulos dedicados;
- utilidades comunes centralizadas (`roles`, `status`, `employee`, `hoursExport`);
- contratos funcionales más explícitos para futuras APIs;
- menor duplicación para reglas básicas usadas en varias pantallas.

## Pendientes técnicos todavía visibles

- `App.tsx` sigue siendo grande y conviene seguir extrayendo páginas sensibles;
- el bundle sigue pesado y más adelante conviene sumar code splitting real;
- todavía hay helpers repetidos en algunas páginas legacy;
- algunos mocks siguen mezclando normalización, persistencia y reglas de negocio.
