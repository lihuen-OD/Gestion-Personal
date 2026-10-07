# Backend API Contracts

## Objetivo

Este documento resume los contratos HTTP actuales del backend real.

El frontend ya consume estos contratos de forma real a través de sus `*ApiService`; la migración de mocks a backend real está cerrada. Este documento existe para que cualquier cambio de contrato (nuevo endpoint, campo agregado/removido, query param nuevo) se documente en el mismo cambio que lo introduce, antes de que el código y el documento diverjan.

## Base local

```txt
Backend local: http://localhost:4002/api
```

Si el puerto `4002` está ocupado, usar el valor configurado en `backend/.env` y actualizar `frontend/.env`.

Todas las respuestas siguen el patrón:

```json
{
  "data": {}
}
```

Los listados grandes pueden incluir metadatos de paginación sin cambiar `data`:

```json
{
  "data": [],
  "meta": {
    "total": 125,
    "page": 1,
    "pageSize": 50,
    "hasMore": true
  }
}
```

### Contrato de listados paginados: filtros, búsqueda, orden y paginación server-side

Toda pantalla que no tiene el dataset completo resuelve búsqueda, filtros, orden y paginación en el backend, en este orden: `WHERE` (filtros + búsqueda) → `ORDER BY` → `COUNT` → `OFFSET/LIMIT`. Nunca se ordena ni filtra en el frontend una página ya recortada.

Request (sin cambiar convenciones existentes):

```txt
page        1..10000 (default 1)
take        tamaño de página (máximo propio de cada endpoint; la respuesta lo informa como meta.pageSize)
search      texto libre, si el endpoint lo soporta
<filtros>   propios del módulo (companyId, status, period, ...)
sortBy      key pública de una whitelist explícita por endpoint (opcional)
sortOrder   asc | desc (opcional, default asc)
```

- `sortBy` fuera de la whitelist → `400 VALIDATION_ERROR` (mismo `validateQuery` que el resto de los parámetros). Nunca se pasa un nombre de campo del request a Prisma: cada endpoint traduce su key pública con un mapa propio (`backend/src/shared/validation/listSort.ts`).
- Sin `sortBy` se mantiene el orden de negocio default del endpoint (sin cambios respecto del comportamiento previo).
- Siempre se agrega un desempate estable por columna única (`id`) al final del `ORDER BY`, para que paginar no repita ni saltee filas con el mismo valor.
- Columnas nulables ordenan con `NULLS LAST` en ambas direcciones. Relaciones opcionales (sector, centro de costo, usuario) **no** se exponen como `sortBy`: Prisma no permite `nulls` sobre relaciones y en `DESC` los vacíos quedarían primero.
- Texto: la base usa collation `C.UTF-8` (orden por bytes). El orden server-side distingue mayúsculas y ubica iniciales acentuadas después de la Z; el orden natural/sin acentos (`localeCompare("es")`) aplica sólo a tablas client-side. Cambiarlo requiere una migración de collation ICU por columna — pendiente, fuera del alcance de la etapa de tablas.
- Booleanos de query: sólo `true`/`false` (`shared/validation/queryBoolean.ts`); antes `z.coerce.boolean()` interpretaba `"false"` como `true`.

Whitelists vigentes:

| Endpoint | `sortBy` | Default sin `sortBy` |
|---|---|---|
| `GET /api/employees` | `legajo`, `cuil`, `lastName`, `firstName`, `status` | estado, apellido, nombre |
| `GET /api/documents` | `legajo`, `employee`, `category`, `fileName`, `createdAt`, `expiresAt`, `status` | fecha de carga desc |
| `GET /api/novelties` | `legajo`, `employee`, `noveltyType`, `fromDate`, `status` | vigencia desde desc |
| `GET /api/audit` | `createdAt` | fecha desc |
| `GET /api/positions` | `name`, `status` | estado, nombre |
| `GET /api/positions/:id/employees` | `legajo`, `employee` | apellido, nombre |
| `GET /api/time-entries` (`view=flat`) | `legajo`, `employee`, `date`, `hourConcept`, `hours`, `status` | fecha desc, apellido |
| `GET /api/time-entries` (`view=byEmployee`), `GET /api/time-entries/period-employees` | `legajo`, `employee` (otra key de la whitelist de `/time-entries` cae al default) | apellido, nombre |
| `GET /api/hour-concepts/:id/employees`, `GET /api/work-regimes/:id/employees` | `legajo`, `employee` | apellido, nombre |

`status` ordena por el orden de declaración del enum (ciclo de vida), no alfabéticamente por la etiqueta.

**Sin truncado silencioso.** Ningún listado que la UI presente como completo puede cortarse en un `take` implícito. Los catálogos chicos que la pantalla necesita enteros se piden explícitamente completos: el frontend recorre `meta.hasMore` con `collectAllPages` (`frontend/src/services/api/listQuery.ts`, falla de forma visible si supera 50 páginas), o el endpoint es un catálogo completo documentado (`GET /api/org-structure`, `GET /api/positions/options` sin `take`). La rama cacheada "sin filtros" de los catálogos (`REPOSITORY_LIST_CACHE_MAX_ROWS`, 500) cae a la consulta paginada real si el catálogo la supera, en vez de informar un total recortado.

En errores:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Readable error message"
  }
}
```

## Autenticación

### Login

```txt
POST /api/auth/login
```

Body:

```json
{
  "email": "usuario@example.com",
  "password": "<contraseña>"
}
```

Response:

```json
{
  "user": {
    "id": "uuid",
    "name": "Administrador RRHH",
    "email": "usuario@example.com",
    "role": "NIVEL_1_RRHH",
    "status": "ACTIVO"
  },
  "accessToken": "jwt",
  "refreshToken": "jwt"
}
```

### Renovar sesion

```txt
POST /api/auth/refresh
```

Body:

```json
{
  "refreshToken": "jwt"
}
```

Response:

```json
{
  "user": {
    "id": "uuid",
    "name": "Administrador RRHH",
    "email": "usuario@example.com",
    "role": "NIVEL_1_RRHH",
    "status": "ACTIVO"
  },
  "accessToken": "jwt",
  "refreshToken": "jwt"
}
```

### Usuario actual

```txt
GET /api/auth/me
Authorization: Bearer <token>
```

Response:

```json
{
  "data": {
    "id": "uuid",
    "name": "Administrador RRHH",
    "email": "usuario@example.com",
    "role": "NIVEL_1_RRHH",
    "status": "ACTIVO"
  }
}
```

## Roles

Roles soportados:

```txt
NIVEL_1_RRHH
NIVEL_2_SUPERVISION
NIVEL_3_CARGA_HORARIA
```

Regla general:

- `NIVEL_1_RRHH`: alcance global.
- `NIVEL_2_SUPERVISION`: alcance por legajos con un `EmployeeAssignment` `TIME_RESPONSIBLE` vigente para el usuario (misma regla que Nivel 3, `backend/src/modules/employees/employeeAccess.ts`). **No** se limita por sector ni por otro nodo de la estructura, y `User.companyId/sectorId` no filtran datos. La reorganización de estructura (`docs/decisions/ORG_LOCATION_REORGANIZATION.md`) no cambia esta regla.
- `NIVEL_3_CARGA_HORARIA`: alcance por legajos asignados como responsable de carga horaria.

## Legajos

### Listar legajos

```txt
GET /api/employees
```

Query:

```txt
search
status
companyId
sectorId
costCenterId
take
page
sortBy     legajo | cuil | lastName | firstName | status
sortOrder  asc | desc
```

Devuelve `meta` de paginacion. Las pantallas de listado deben consumir este endpoint de forma paginada y no pedir todos los legajos para calcular tarjetas. Ver "Contrato de listados paginados" arriba.

### Resumen de legajos

```txt
GET /api/employees/summary
```

Devuelve contadores agregados para KPI cards:

```json
{
  "data": {
    "total": 120,
    "active": 110,
    "inactive": 10,
    "missingTimeResponsible": 4,
    "pendingTimeLoads": 8
  }
}
```

Reglas:

- Respeta el alcance del rol autenticado.
- No devuelve listas completas.
- Debe usarse para tarjetas del modulo Legajos en lugar de calcular desde `/api/employees` o `/api/time-entries`.

### Listar legajos para organigrama

```txt
GET /api/employees/org-chart
```

Endpoint optimizado para alimentar el organigrama sin traer el detalle completo del legajo.

Query:

```txt
search
status
companyId
sectorId
positionId
costCenterId
take
page
```

Reglas:

- Por defecto devuelve legajos `ACTIVO`.
- Respeta el alcance del rol autenticado.
- `NIVEL_1_RRHH` y `NIVEL_2_SUPERVISION` pueden consultar el organigrama.
- Devuelve `data` con datos mínimos de estructura, puesto, empresas y asignaciones, más `meta` de paginación.

### Ver detalle

```txt
GET /api/employees/:id
```

Incluye:

- datos personales;
- contacto;
- domicilio;
- empresas asociadas;
- puesto;
- sector;
- centro de costo;
- responsables/asignaciones;
- horas especiales habilitadas;
- movimientos laborales;
- transporte;
- documentos;
- novedades recientes.

### Grilla horaria de un legajo

```txt
GET /api/employees/:id/time-grid?period=YYYY-MM&includeDetails=false
```

Además del contrato operativo histórico (`employee`, `entries`, novedades y catálogos opcionales), devuelve la grilla del modelo de tiempo trabajado (`docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md`):

- `rows`: Horas base (`role: NORMAL_BASE`) siempre primera; luego un concepto por fila (`role: ADDITIONAL`), primero los `WITHIN_BASE` y después los `ADDITIVE_TO_WORKED_TOTAL`;
- `rows[].concept`: identidad estable (`id`, `code`, `systemRole`) y presentación (`name`, `kind`, `loadMode`, `status`, `workTreatment`);
- `rows[].enabled`: `false` para un concepto con horas en el período que hoy no está habilitado para el legajo (se muestra sólo lectura para que la grilla explique el total);
- `rows[].minutesByDay` y `rows[].totalMinutes`: minutos reales por fila;
- `accounting`: `PeriodAccounting` con `days[day]` — `baseMinutes`, `normalResidualMinutes`, `withinBaseMinutes`, `withinBaseCoveredMinutes`, `withinBaseOverlapMinutes`, `withinBaseExcessMinutes`, `additiveMinutes`, `totalWorkedMinutes`, `settlement { normalMinutes, withinBaseMinutes, additiveMinutes, totalMinutes }`, `concepts[{ hourConceptId, treatment, realMinutes, settlementMinutes }]`, `multiplier` (por día) y `hasSpecialMultiplier` (período);
- `totalWorkedMinutes`: total real = Horas base + conceptos `ADDITIVE_TO_WORKED_TOTAL` (nunca + `WITHIN_BASE`);
- `specialHoursByDay[day]`: `{ multiplier, ruleNames, conflict }` sólo para días con multiplicador > 1 (indicador visual; las horas del día viven en `accounting.days`).

Desde 2026-10-02 ya no existen `specialHourAdditionalMinutes`, `specialHourLiquidableTotalMinutes` ni `additionalMinutes`/`liquidableTotalMinutes` por día (duplicaban los conceptos dentro de la jornada). Los conceptos `AUTOMATIC` son de sólo lectura; los `MANUAL` y `BOTH` admiten la operación manual documentada a continuación.

Cacheado 60s en backend por usuario+legajo+query string (`employeeTimeGridCache`, `employees.controller.ts`). Se invalida (`clearEmployeeReadCaches()`) al guardar un desglose manual y, desde la Etapa 6L.4, también al crear/editar/enviar/aprobar/rechazar/devolver un `TimeEntry` (`POST`/`PATCH`/`:id/submit`/`:id/approve`/`:id/reject`/`:id/return` de `/time-entries`) — antes de 6L.4 esos seis endpoints no invalidaban este cache, así que una hora podía guardarse bien y el siguiente `GET /time-grid` de esa misma sesión seguir devolviendo la respuesta cacheada hasta por 60s.

#### Carga manual de desgloses adicionales

```txt
PUT /api/employees/:id/hour-concept-breakdowns/manual
```

Body de alta/actualización:

```json
{
  "date": "2026-08-12",
  "hourConceptId": "uuid-del-concepto",
  "minutes": 120,
  "observation": "Traslado autorizado"
}
```

PUT con `minutes = 0` elimina el registro manual. No se expone DELETE porque el módulo `/employees` protege por contrato la ausencia de rutas de borrado HTTP. La API fija `source = MANUAL`; no acepta `source`, `status`, `priority` ni `countsAsWorked` desde el cliente.

Estado inicial (o resultante de sobrescribir un registro existente) según el rol de quien carga (Etapa 6L.3): **RRHH** deja el desglose `APROBADO` directo, con `approvedByUserId`/`approvedAt` propios. **Nivel 2/3** dejan el desglose `EN_REVISION` — a diferencia de `TimeEntry`, el desglose manual no tiene una acción separada de "enviar a revisión"; el único `PUT` ya es la carga completa, así que queda pendiente de una. RRHH ve esos desgloses `EN_REVISION` de Nivel 2/3 en `GET /pending` (ver más abajo) y los resuelve con los endpoints de abajo.

Sólo admite conceptos adicionales habilitados, activos, no eliminados y con modo `MANUAL` o `BOTH`. Rechaza Normal, `AUTOMATIC`, conceptos fuera del legajo. Nivel 2/Nivel 3 conservan el alcance operativo por responsable de horas.

Tratamiento del concepto (`docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md`), independiente de `loadMode`:

- `WITHIN_BASE`: exige Horas base registradas ese día (TimeEntry `NORMAL_BASE` no rechazado) — si no hay, `409 WITHIN_BASE_REQUIRES_BASE_HOURS` ("No se puede cargar <Concepto> dentro de la jornada porque no hay horas base registradas para ese día."); la cobertura resultante (unión con los demás conceptos dentro de la jornada de ese día) no puede superar la base: `409 WITHIN_BASE_EXCEEDS_BASE_HOURS`. Nunca se convierte en horas adicionales.
- `ADDITIVE_TO_WORKED_TOTAL`: puede cargarse sin Horas base.
- Al guardar (minutes > 0) se congela `appliedMultiplier` con el motor de Hora Especial de esa fecha (mismo criterio que `TimeEntry.appliedMultiplier`).

Período cerrado (`MonthlyTimeClosure` en `ENVIADO`/`APROBADO`/`CORRECCION_PENDIENTE`) — **Etapa 15E**, alineado con `TimeEntry` (`docs/decisions/TIME_CLOSURE_CONSISTENCY_15E.md`): Nivel 2/3 siguen recibiendo `409 PERIOD_CLOSED` sin excepción. RRHH puede corregir directo si manda `observation` no vacío (reutiliza el campo del body, no hay uno nuevo); sin `observation`, responde `400 HOUR_CONCEPT_BREAKDOWN_CORRECTION_REASON_REQUIRED`.

La base garantiza la idempotencia manual mediante el índice único parcial `HourConceptBreakdown_manual_unique` sobre empleado, fecha y concepto con `source = 'MANUAL'`. El índice no aplica a `AUTOMATIC`. Una carrera concurrente se reintenta una vez y, si persiste, responde `409` con código `MANUAL_BREAKDOWN_CONCURRENT_CONFLICT`.

#### Aprobar / rechazar / devolver un desglose manual (Etapa 6L.3, ajuste)

```txt
POST /api/employees/:id/hour-concept-breakdowns/manual/:breakdownId/approve
POST /api/employees/:id/hour-concept-breakdowns/manual/:breakdownId/reject
POST /api/employees/:id/hour-concept-breakdowns/manual/:breakdownId/return
```

Exclusivos de RRHH (`403 FORBIDDEN` para cualquier otro rol). `reject`/`return` requieren body `{ "reason": "..." }` (2-600 caracteres). Los tres exigen que el desglose esté `EN_REVISION` (`400 HOUR_CONCEPT_BREAKDOWN_STATUS_NOT_RESOLVABLE` si no) y respetan el scope operativo del usuario y el `:id` del legajo (`404 HOUR_CONCEPT_BREAKDOWN_NOT_FOUND` si no matchea). `approve` deja `status = APROBADO` con `approvedByUserId`/`approvedAt`; `reject` deja `status = RECHAZADO`; `return` deja `status = DEVUELTO` — ambos limpian `approvedByUserId`/`approvedAt`. Mismo patrón que `/time-entries/:id/approve|reject|return`. No hay todavía una UI que dispare estos endpoints (ver Etapa 6L.3 en `docs/decisions/CONCEPTOS_HORARIOS_ADITIVOS.md`) — quedan disponibles para conectar en una subetapa inmediata.

#### Recálculo de desgloses automáticos

```txt
POST /api/employees/:id/hour-concept-breakdowns/recalculate-automatic
```

```json
{ "period": "2026-08" }
```

La operación toma exclusivamente intervalos reales de `WorkShift` completos con estado `PROCESADO`. Evalúa las reglas activas de conceptos adicionales `AUTOMATIC` o `BOTH` habilitados en el legajo, intersecta cada franja con el intervalo trabajado y parte el resultado por día calendario Argentina. Las reglas que cruzan medianoche se evalúan como una sola franja; las reglas solapadas de un mismo concepto se fusionan para no duplicar minutos, mientras conceptos distintos sí pueden superponerse.

El recálculo reemplaza en una transacción serializable todas las filas `source = AUTOMATIC` del empleado y período solicitados, crea el resultado con estado `BORRADOR` y conserva intactas las filas `MANUAL`. Este alcance amplio es aceptable temporalmente porque 6I es el único generador automático actual; si se incorporan otros generadores, deberán separar explícitamente su identidad antes de compartir el mismo empleado/período. No se eliminan datos de otros empleados ni períodos. Así se eliminan resultados obsoletos y la operación es idempotente. No lee `priority`, `countsAsWorked`, `TimeSegment` ni `TimeEntry`, y nunca modifica Horas normales ni `totalWorkedMinutes`. Un cierre `ENVIADO`, `APROBADO` o `CORRECCION_PENDIENTE` responde `409 PERIOD_CLOSED`; una carrera serializable se reintenta una vez y luego responde `409 AUTOMATIC_BREAKDOWN_CONCURRENT_CONFLICT`.

Consumido desde la acción "Recalcular automáticos" de `EmployeeHoursPage` (Etapa 6J), con el `employeeId` y el período visibles en la grilla. El frontend no agrega lógica de permisos propia: usa los mismos tres roles ya habilitados en el backend.

### Crear legajo

```txt
POST /api/employees
```

Uso actual: `NIVEL_1_RRHH`.

### Actualizar legajo

```txt
PATCH /api/employees/:id
```

Uso actual: `NIVEL_1_RRHH`.

### Contacto

```txt
PUT /api/employees/:id/contact
```

Campos:

```json
{
  "email": "persona@empresa.com",
  "phone": "03447...",
  "mobile": "3447...",
  "emergencyContact": "Nombre",
  "emergencyRelation": "Familiar",
  "emergencyPhone": "3447..."
}
```

### Domicilio

```txt
PUT /api/employees/:id/address
```

Campos:

```json
{
  "province": "Entre Rios",
  "department": "Colon",
  "city": "Colon",
  "street": "12 de Abril",
  "streetNumber": "118",
  "postalCode": "E3285",
  "latitude": -32.2195104,
  "longitude": -58.135839,
  "mapLabel": "12 de Abril 118, Colon"
}
```

### Transporte

```txt
PUT /api/employees/:id/transport
```

Campos:

```json
{
  "usesCompanyTransport": true,
  "locality": "Colon",
  "pickupAddress": "12 de Abril 118",
  "pickupReference": "Frente a administracion",
  "busLine": "Colectivo empresa",
  "schedule": "06:30",
  "observation": "Observacion"
}
```

### Responsables / asignaciones

```txt
PUT /api/employees/:id/assignments
```

Body:

```json
{
  "assignments": [
    {
      "type": "DIRECT_MANAGER",
      "userId": "uuid"
    },
    {
      "type": "TIME_RESPONSIBLE",
      "userId": "uuid"
    }
  ]
}
```

`EmployeeAssignment.role` (`String?`, in `schema.prisma`) still exists in the schema and in `employeeAssignmentSchema` as an optional/nullable field, but it is legacy: it has no consumer anywhere in permissions, access scoping (`employeeAccess.ts`), notifications (`workforce.service.ts`), or hour calculation. The frontend stopped sending it from the "Responsable de carga horaria actual" modal (2026-09-15) — a user's real role/level is `User.role` (`RoleName`), managed only from Usuarios/Roles, and the assignment must never redefine or duplicate it. The column and the schema field were kept as-is (not migrated away) because old rows may still carry a value and dropping it was not required to fix the UI confusion; do not read it for any authorization decision.

### Horas especiales habilitadas

```txt
PUT /api/employees/:id/hour-concepts
```

Body:

```json
{
  "hourConceptIds": ["uuid"]
}
```

### Movimientos laborales

```txt
POST /api/employees/:id/labor-movements
```

Body:

```json
{
  "type": "BAJA",
  "effectiveFrom": "2026-06-22",
  "reason": "Motivo",
  "observation": "Observacion"
}
```

Reglas:

- El estado laboral se calcula desde los movimientos vigentes por `effectiveFrom`.
- `BAJA` con fecha vigente o pasada pasa el legajo a `INACTIVO`.
- `BAJA` futura queda programada y el legajo sigue `ACTIVO` hasta esa fecha.
- `ALTA` vigente vuelve a dejar el legajo `ACTIVO`.

### Sincronizar estados laborales

```txt
POST /api/employees/sync-labor-statuses
```

Uso:

- Recalcula estados de legajos desde movimientos laborales vigentes.
- Sirve para aplicar bajas futuras cuando llega la fecha efectiva.
- Requiere rol RRHH.
- Registra auditoria con cantidad de legajos revisados y actualizados.

Respuesta:

```json
{
  "data": {
    "scanned": 120,
    "updated": 3
  }
}
```

### Documentos del legajo

```txt
POST /api/employees/:id/documents
```

Body:

```json
{
  "categoryId": "uuid",
  "noveltyId": "uuid opcional",
  "fileName": "dni.pdf",
  "fileMimeType": "application/pdf",
  "fileSizeBytes": 1024,
  "fileBase64": "data:application/pdf;base64,...",
  "storageKey": "opcional si el archivo ya fue subido por otro flujo",
  "status": "VIGENTE",
  "notes": "Observacion documental opcional",
  "issuedAt": "2026-06-01",
  "expiresAt": "2027-06-01"
}
```

Notas:

- `fileBase64` permite enviar el archivo desde frontend sin depender de multipart.
- Qué provider recibe el archivo lo decide el backend internamente (Etapa 15D.2, `docs/decisions/STORAGE_UPLOAD_POLICY_15D2.md`): `DOCUMENT_STORAGE_PROVIDER` para documentos de legajo, con fallback a `DEFAULT_STORAGE_PROVIDER` y luego a `STORAGE_PROVIDER` si no están configuradas — no es un valor que el cliente pueda elegir.
- `storageKey` sigue disponible para integraciones futuras donde el archivo ya venga subido por otro canal.
- Rol (Etapa 15D.4, `docs/decisions/DOCUMENT_CATEGORY_AUTHORIZATION_15D4.md`): `NIVEL_1_RRHH`/`NIVEL_2_SUPERVISION`/`NIVEL_3_CARGA_HORARIA` pueden llegar a la ruta; la autorización real es por categoría — RRHH siempre puede, los demás sólo si `categoryId` referencia una categoría existente cuyo `uploadRoles` incluye su rol **y** el legajo está dentro de su alcance (`employeeAccessWhere`). `categoryId` inexistente responde `404 DOCUMENT_CATEGORY_NOT_FOUND`; sin permiso de categoría responde `403 DOCUMENT_UPLOAD_FORBIDDEN` — ambos antes de tocar storage, para no dejar un archivo huérfano subido.

### Descargar / abrir documento

```txt
GET /api/documents/:id/download
```

Reglas:

- Requiere autenticacion. Rol: `NIVEL_1_RRHH`/`NIVEL_2_SUPERVISION`/`NIVEL_3_CARGA_HORARIA` (Etapa 15D.4 — antes Nivel 3 quedaba bloqueado por completo de `/api/documents`, ver `docs/decisions/DOCUMENT_CATEGORY_AUTHORIZATION_15D4.md`).
- Respeta el alcance del legajo asociado al documento (`employeeAccessWhere`) **y** que `category.viewRoles` incluya el rol del usuario (RRHH siempre puede). Ambas condiciones se resuelven a nivel de query — un documento fuera de alcance o de categoría no autorizada responde `404`, igual que uno inexistente; nunca revela que existe.
- En storage local sirve el archivo desde `backend/uploads`.
- En Cloudinary (Etapa 15D.3, `docs/decisions/CLOUDINARY_SECURE_DELIVERY_15D3.md`) el backend descarga el archivo del proveedor y lo sirve como respuesta autenticada — nunca redirige a una URL pública de Cloudinary, ni para documentos nuevos ni para los subidos antes de esta etapa.

## Catálogos

### Estructura organizacional

> Etapa A2 de `docs/decisions/ORG_LOCATION_REORGANIZATION.md`: contrato **en código** en la rama `feat/org-location-reorg`, junto con la migración M1. **Todavía no está aplicado a ninguna base ni desplegado.** El frontend actual (`OrgStructurePage`) se adapta en A4. Hasta entonces, sus altas de sector, área y establecimiento con los padres anteriores responden 400.

Dos árboles independientes, cada nodo con un único padre obligatorio:

- **Organización:** Empresa → Unidad de negocio → Sector → Área.
- **Ubicaciones:** Zona → Establecimiento.

```txt
GET /api/org-structure
```

Devuelve `companies`, `businessUnits`, `sectors`, `areas`, `zones`, `establishments` y `costCenters`.

**Padre del modelo objetivo** de cada nodo:

| Nodo | Campo de padre |
|---|---|
| Unidad de negocio | `companyId` |
| Sector | `businessUnitId` |
| Área | `sectorId` |
| Establecimiento | `zoneId` (más el domicilio) |

**Padres del modelo anterior**: hasta M2 se devuelven además, **sólo de lectura**, `sectors[].areaId`, `areas[].establishmentId` y `establishments[].companyId/businessUnitId`. Un sector sin `businessUnitId`, un área sin `sectorId` o un establecimiento sin `zoneId` es un registro **legado**, que la limpieza controlada va a eliminar.

**Cost centers:** traen sus vínculos M:N (`companies`, `businessUnits`, `sectors`, `areas`, `establishments`).

Nota: este endpoint se mantiene como overview completo para alimentar selects y formularios. Si la estructura crece mucho, se agregarán endpoints específicos paginados por entidad sin romper este contrato.

Altas/ediciones admin (sólo `NIVEL_1_RRHH`):

```txt
POST/PATCH /api/org-structure/companies        { code, name, status }
POST/PATCH /api/org-structure/business-units   { code, name, status, companyId }
POST/PATCH /api/org-structure/sectors          { code, name, status, businessUnitId }
POST/PATCH /api/org-structure/areas            { code, name, status, sectorId }
POST/PATCH /api/org-structure/zones            { code, name, status }
POST/PATCH /api/org-structure/establishments   { code, name, status, zoneId, province?, department?, city?, street?, streetNumber?, postalCode? }
POST/PATCH /api/org-structure/cost-centers     { code, name, status, companyIds[], businessUnitIds[], sectorIds[], areaIds[], establishmentIds[] }
```

Reglas:

- **Padre en el alta:** obligatorio en POST. En PATCH es opcional y nunca `null`.
  - El padre debe existir, estar `ACTIVO` y pertenecer al modelo objetivo. Si no, responde `400 ORG_STRUCTURE_INVALID_PARENT`, con el motivo en lenguaje de negocio.
  - Las altas no aceptan los padres del modelo anterior (`areaId`, `establishmentId`, `companyId`/`businessUnitId` del establecimiento): zod los descarta.
- **Cambio de padre:**
  - Un registro **legado** no se reubica en el árbol nuevo (`409 ORG_STRUCTURE_LEGACY_RECORD`). Sí puede corregir código, nombre y estado.
  - Un nodo **en uso** no cambia de padre (`409 ORG_STRUCTURE_PARENT_IN_USE`, con `details.dependencies`). Decisión D-9 del ADR, ratificada el 2026-10-07. Para reorganizar nodos en uso hará falta una operación explícita que contemple sus referencias; hoy no existe.
- **Centros de costo:** no agregan vínculos nuevos a sectores, áreas o establecimientos legados (`400 ORG_STRUCTURE_LEGACY_LINK`). Los vínculos que ya tenían se conservan.
- **Código de establecimiento:** único entre los establecimientos con zona (`409 UNIQUE_CONSTRAINT`). Hasta M2 la base conserva la unicidad legada por empresa.
- **Transacción y auditoría:**
  - Cada escritura corre en una transacción `Serializable`. Un cambio concurrente responde `409 ORG_STRUCTURE_CONCURRENT_CHANGE`.
  - La auditoría (`CREATE`/`UPDATE`/`DELETE`, con estado previo en `before`) se escribe **en la misma transacción**: si falla, el cambio se revierte.
  - Los cachés se limpian después del commit.

Eliminación definitiva (sólo `NIVEL_1_RRHH`, mismo permiso que altas/ediciones):

```txt
DELETE /api/org-structure/companies/:id
DELETE /api/org-structure/business-units/:id
DELETE /api/org-structure/sectors/:id
DELETE /api/org-structure/areas/:id
DELETE /api/org-structure/zones/:id
DELETE /api/org-structure/establishments/:id
DELETE /api/org-structure/cost-centers/:id
```

**Uso:** está pensada para corregir registros creados por error. La baja normal sigue siendo pasar `status` a `INACTIVO`, que es reversible.

**Condición:** sólo borra si el registro no tiene ninguna dependencia de negocio. Si tiene alguna, responde `409 ORG_STRUCTURE_HAS_DEPENDENCIES` con el motivo en lenguaje de negocio (`message`) y el detalle (`details.dependencies: [{ key, count, label }]`). Nunca borra ni desvincula en cadena.

**Dependencias:** se cuentan las del modelo objetivo y, hasta M2, también las del modelo anterior.

| Entidad | Bloquean la eliminación |
|---|---|
| Empresa | unidades de negocio, establecimientos (legado), empleados (`EmployeeCompany`), usuarios con alcance, centros de costo asociados, reglas de horas especiales, alcances de puestos |
| Unidad de negocio | sectores, establecimientos (legado), centros de costo asociados, alcances de puestos |
| Sector | áreas, empleados (legado), puestos (legado), usuarios con alcance (legado), centros de costo asociados, reglas de horas especiales, alcances de puestos |
| Área | sectores (legado), centros de costo asociados, alcances de puestos |
| Zona | establecimientos |
| Establecimiento | áreas (legado), centros de costo asociados, ubicaciones de trabajo de legajos, dispositivos de fichada |
| Centro de costo | empleados, reglas de horas especiales. Sus propios vínculos se borran explícitamente con él, no por CASCADE |

**Protección en la base:** la base no protege todos los casos del modelo anterior por sí sola (varias FK son `ON DELETE SET NULL` y `EmployeeCompany` es `CASCADE`). Las FKs nuevas de M1 sí son `RESTRICT`: los padres nuevos, los alcances de puestos, las ubicaciones de legajos, `ClockDevice.establishmentId` y las cuatro dimensiones de `DoubleHourRule`. Por eso el conteo y el borrado corren en una transacción `Serializable`, y un alta concurrente de una dependencia hace fallar la operación (`409 ORG_STRUCTURE_CONCURRENT_CHANGE`).

**Resultado:**
- Inexistente → `404 RECORD_NOT_FOUND`.
- Cada eliminación queda en auditoría (`action: DELETE`) dentro de la misma transacción.

Ver `backend/src/modules/org-structure/orgStructure.dependencies.ts`.

### Usuarios

```txt
GET /api/users
GET /api/users/:id
POST /api/users
PATCH /api/users/:id
POST /api/users/:id/reset-password
```

Query de listado:

```txt
search
role
status
take
page
```

### Parametros de auditoria

```txt
GET /api/audit-parameters
POST /api/audit-parameters
PATCH /api/audit-parameters/:id
```

Query de listado:

```txt
search
scope
severity
status
requiresReason
take
page
```

Uso actual: `NIVEL_1_RRHH`.

Define reglas configurables de trazabilidad por modulo:

- eventos auditados;
- severidad;
- motivo obligatorio;
- fecha efectiva obligatoria;
- roles visibles;
- notificaciones;
- retencion.

### Categorias salariales

```txt
GET /api/salary-categories
POST /api/salary-categories
PATCH /api/salary-categories/:id
```

Query de listado:

```txt
search
family
status
take
page
```

Uso:

- lectura para roles autenticados;
- alta/edicion para roles administradores.

Alimenta:

- rango salarial en Puestos;
- seleccionables de categoria interna en Legajos;
- comparacion puesto vs categoria.

### Categorías documentales

```txt
GET /api/document-categories
POST /api/document-categories
PATCH /api/document-categories/:id
```

Query de listado:

```txt
search
kind
scope
status
mandatory
expires
take
page
```

`uploadRoles`/`viewRoles`/`approvalRoles` se guardan como `Json` con las ETIQUETAS en español del rol (`"Nivel 1 - RRHH"`, `"Nivel 2 - Supervisión / Gestión"`, `"Nivel 3 - Administrativo de Carga Horaria"`) — no el enum `RoleName` que trae el usuario autenticado. Desde la Etapa 15D.4 (`docs/decisions/DOCUMENT_CATEGORY_AUTHORIZATION_15D4.md`), `viewRoles`/`uploadRoles` ya se aplican server-side en listado/descarga/carga de documentos (antes existían en el modelo pero el backend no los usaba para autorizar); `approvalRoles` sigue sin un flujo de aprobación documental real conectado.

### Horas especiales

> Modelo vigente: `docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md`. Horas base (NORMAL_BASE) es obligatoria; cada concepto adicional declara `workTreatment` (`WITHIN_BASE` clasifica horas de la base; `ADDITIVE_TO_WORKED_TOTAL` suma al total trabajado).

```txt
GET /api/hour-concepts
GET /api/hour-concepts/next-code
POST /api/hour-concepts
PATCH /api/hour-concepts/:id
DELETE /api/hour-concepts/:id
```

Query de listado:

```txt
search
kind
status
take
page
```

Campos principales:

```json
{
  "code": "HC-NORMAL",
  "name": "Hora normal",
  "kind": "NORMAL",
  "status": "ACTIVO",
  "countsAsWorked": true,
  "workTreatment": null
}
```

`workTreatment` (`WITHIN_BASE` | `ADDITIVE_TO_WORKED_TOTAL`) es obligatorio en `POST` para todo concepto adicional y opcional en `PATCH`; `NORMAL_BASE` lo tiene en `null` (CHECK `HourConcept_work_treatment_check`). Es una clasificación corregible por RRHH aunque el concepto ya tenga horas: el `PATCH` actualiza el concepto y, en la misma transacción, recalcula los snapshots de los cierres afectados. Los desgloses conservan sus minutos y toda lectura los interpreta con el tratamiento vigente. Queda auditado con el tratamiento anterior y el nuevo, el usuario y el alcance (desgloses, legajos, períodos y cierres). La respuesta sigue siendo `{ data: HourConcept }`.

`GET /api/hour-concepts/next-code` (sólo RRHH) consulta directamente todos los códigos `HOR-*` físicamente existentes y devuelve `{ data: { code: "HOR-005" } }` con el **primer número libre**. No usa el listado cacheado/paginado del navegador; una eliminación definitiva vuelve reutilizable su hueco. `UNIQUE(code)` sigue siendo la autoridad ante dos altas concurrentes: `POST` responde `409 HOUR_CONCEPT_UNIQUE_CONSTRAINT` y la UI solicita otro código sin perder los demás campos del formulario.

No hay baja lógica (`deletedAt` se eliminó en la migración `20261003100000`) ni `?includeDeleted`:

La migración limpia todas las filas `deletedAt IS NOT NULL` de la política anterior con la misma preservación de jornadas de la eliminación definitiva. Si detecta un `TimeEntry` legacy asociado, aborta completa antes de modificar datos e informa los códigos implicados para auditoría manual.

- **Deshabilitar** = `PATCH { status: "INACTIVO" }`. Conserva el concepto y su historia e impide nuevas cargas, asignaciones y clasificación automática.
- **Eliminar** = `DELETE /api/hour-concepts/:id`. Es definitivo y no admite `?force`. En una transacción borra los desgloses, reglas y habilitaciones por legajo del concepto, reclasifica a Hora normal los `TimeSegment`/`WorkShift` que lo referenciaban, desvincula `Novelty.targetHourConceptId`, borra el concepto (el código queda libre) y recalcula los cierres afectados. Fichadas, jornadas y Horas base se conservan.
  - Respuesta: `{ data: { concept: { id, code, name }, deletedBreakdowns, deletedRules, deletedEmployeeAssignments, reclassifiedSegments, reclassifiedWorkShifts, unlinkedNovelties, recalculatedClosures } }`.
  - Errores: `409 HOUR_CONCEPT_SYSTEM_MANAGED` (Hora normal), `409 HOUR_CONCEPT_HAS_LEGACY_TIME_ENTRIES` (hay `TimeEntry` del concepto del modelo previo a 6L; no se borra nada) y `409 HOUR_CONCEPT_CHANGED_DURING_DELETE` (se cargaron horas mientras se eliminaba; la transacción no borró nada).

`countsAsWorked` queda deprecado como criterio para calcular el total trabajado. Mientras continúe en el contrato por compatibilidad, no debe interpretarse como autorización para sumar un concepto adicional a Horas normales.

### Reglas de conceptos horarios (`HourConceptRule`)

> Contrato actual/deuda conocida: la clasificación exclusiva documentada debajo todavía existe en la implementación, pero contradice el modelo aditivo objetivo. `priority`, el concepto “ganador” y la exclusión global por solapamiento quedan deprecados y pendientes de rediseño. En el modelo oficial, reglas activas pueden derivar desgloses independientes y superpuestos a partir de la misma fichada.
>
> Etapa 15I (`docs/decisions/ENABLED_HOUR_CONCEPT_CLASSIFICATION_15I.md`): `classifyWorkShiftSegments` ya no recibe todas las `HourConceptRule` activas del sistema — el caller (`classifySegmentsForEmployee`, `timeEntries.service.ts`) las filtra primero a sólo las reglas de conceptos que el empleado tiene habilitados (`EmployeeHourConcept`). Una regla activa de un concepto que el empleado no tiene asignado ya no compite por sus tramos ni genera `CONCEPTO_NO_HABILITADO` — ese status queda como salvaguarda legacy/defensiva, no como resultado esperado.

Define CUÁNDO aplica un concepto horario (franja diaria recurrente), no su nombre — eso lo define RRHH en `HourConcept`. Usado por la clasificación automática de jornadas (`classifyWorkShiftSegments`). Lectura para cualquier autenticado; escritura solo RRHH. No hay `DELETE`: una regla histórica se inactiva (`status: INACTIVO`), nunca se borra.

```txt
GET /api/hour-concept-rules
GET /api/hour-concept-rules/:id
POST /api/hour-concept-rules
PATCH /api/hour-concept-rules/:id
PATCH /api/hour-concept-rules/:id/status
GET /api/hour-concepts/:hourConceptId/rules
```

Query de listado (`GET /api/hour-concept-rules`): `hourConceptId`, `status`, `crossesMidnight`, `page`, `take`. Orden de respuesta siempre `priority desc, startTime asc`.

Campos principales:

```json
{
  "hourConceptId": "uuid",
  "startTime": "21:00",
  "endTime": "04:00",
  "crossesMidnight": true,
  "priority": 1,
  "status": "ACTIVO"
}
```

Validación de solapamiento (409 `HOUR_CONCEPT_RULE_AMBIGUOUS_OVERLAP`): dos reglas **activas** con **la misma priority** no pueden superponerse en horario — la clasificación no podría desambiguar cuál gana. Con prioridades distintas, sí pueden superponerse (gana la de mayor priority). El chequeo es **global** (compara contra reglas de todos los conceptos, no solo el mismo `hourConceptId`), porque así compara la clasificación real. Reglas `INACTIVO` nunca participan del chequeo ni de la clasificación.

La regla anterior se conserva aquí solamente para describir fielmente el comportamiento actual del endpoint. No debe reutilizarse como requisito del rediseño.

### Tipos de novedades

```txt
GET /api/novelty-types
POST /api/novelty-types
PATCH /api/novelty-types/:id
```

Query de listado:

```txt
search
kind
status
exportsToFinnegans
take
page
```

**Etapa 15L.6** (`docs/decisions/NOVELTY_TYPE_LEGACY_REMOVAL_15L6.md`, breaking
interno — sólo lo consume el frontend de este mismo repo): se eliminaron los
campos legacy `origin`, `allowsDateTo`, `hasValidity`, `blocksTimeEntry`,
`setsWorkedHoursToZero`, `timeImpact` y la relación 1:N
`finnegansLinks`/`FinnegansNoveltyLink`, migrada a columnas planas
`finnegansCode`/`finnegansName` (1:1 físico, mismo patrón que
`finnegansValueUnit`/`finnegansRequiresValidity`):

```json
{
  "code": "NOV-LLEGADA-TARDE",
  "name": "Llegada tarde",
  "uiColor": "amber",
  "kind": "HORARIA",
  "exportsToFinnegans": true,
  "requiresApproval": false,
  "requiresDocumentation": false,
  "allowsHours": true,
  "allowsDateRange": false,
  "timeEntryBehavior": "NO_BLOQUEA",
  "finnegansValueUnit": "HOURS",
  "finnegansRequiresValidity": false,
  "finnegansCode": "TARDANZA",
  "finnegansName": "Tardanza"
}
```

Si `exportsToFinnegans=true`, `finnegansCode`/`finnegansName` y
`finnegansValueUnit` son obligatorios (`400
NOVELTY_TYPE_FINNEGANS_LINK_REQUIRED` / `NOVELTY_TYPE_FINNEGANS_VALUE_UNIT_REQUIRED`).
`allowsHours=true` + `finnegansValueUnit=DAYS` está prohibido (`400
NOVELTY_TYPE_HOURS_DAYS_CONFLICT`, Etapa 15L.5) — estructuralmente inviable,
ese tipo nunca tendría `quantityDays` para exportar.

### Puestos

```txt
GET /api/positions
GET /api/positions/:id
GET /api/positions/:id/employees
POST /api/positions
PATCH /api/positions/:id
DELETE /api/positions/:id
```

Query de listado:

```txt
search
status
sectorId
areaId
establishmentId
businessUnitId
salaryRangeCategory
take
page
```

`areaId`, `establishmentId` y `businessUnitId` (Etapa 9E, `positions.schemas.ts`) filtran recorriendo la cadena desde `sectorId`. Antes no estaban documentados aquí.

`sectorId` es, en el **modelo actual**, la única fuente de ubicación de un puesto (no existen `businessUnitName`/`establishmentName`/`areaDepartment`/`sector` como query params ni como columnas de `Position` — fueron eliminados en la limpieza final de Position, ver `docs/DATABASE_STANDARDS.md`). El body de creación/edición usa `sectorId` y `salaryCategoryIds` (array de IDs contra `PositionSalaryCategory`), no un único "suggested category". En el modelo objetivo, aprobado y no implementado (`docs/decisions/ORG_LOCATION_REORGANIZATION.md`), `sectorId` se reemplaza por un alcance organizativo de uno o varios nodos de Organización, en su etapa correspondiente.

`DELETE /api/positions/:id` (etapa A2 de la reorganización, en código y no desplegado):

- **Se inactiva, no se borra,** si el puesto tiene personas asignadas o una regla de horas especiales lo referencia (`DoubleHourRule.positionId`). Responde con el puesto inactivo.
  - Antes, un puesto sin personas se borraba aunque una regla lo referenciara. La FK `SET NULL` dejaba esa regla sin restricción de puesto: aplicaba a todos.
- **Se borra** si no tiene dependencias. Primero se borran explícitamente sus alcances organizativos y sus categorías. Responde `null`.
- **Transacción y auditoría:** corre en una transacción `Serializable` (`409 POSITION_CONCURRENT_CHANGE`), con la auditoría dentro de ella.

`GET /api/positions/:id/employees` devuelve los legajos activos asignados al puesto para la solapa de personas asignadas, incluyendo legajo, nombre, empresas, sector, centro de costo, categoria interna y estado. Paginado (`page`, `take` default 25 / máx. 100, `sortBy=legajo|employee`, `sortOrder`) con `meta` real — antes `take: 500` fijo sin meta. `meta.total` es la cantidad real de personas asignadas.

`GET /api/positions/options` sin `take` devuelve el catálogo completo (antes default 300); `includeAssignedCount` acepta sólo `true`/`false`.

## Novedades operativas

### Listar

```txt
GET /api/novelties
```

Query:

```txt
employeeId
noveltyTypeId
status
from
to
period
exportable
search
take
page
```

`from`/`to` filtran únicamente por `fromDate` (sin intersección de rango) — sin caller real hoy. `period` (Etapa 15M.15, `"YYYY-MM"`) es distinto: selecciona por intersección real de vigencia contra el mes completo, mismo criterio de negocio que `novelties.dateRange.ts::noveltyCoversDay` generalizado de "cubre este día" a "toca este mes" — no el mismo criterio que usa `finnegans-export` (Etapa 15L.3B.1, dueño único por `fromDate`, sin intersección, para no exportar la misma fila dos veces). Con `toDate` cargado: interseca si el rango `[fromDate, toDate]` toca el mes. Sin `toDate`: si `NoveltyType.allowsDateRange=true` la novedad se considera vigente abierta y aparece en el mes de inicio y en todos los posteriores; si `allowsDateRange=false` es una novedad de un único día y sólo aparece en el mes de `fromDate`. Usado por `NoveltiesPage.tsx` (filtro server-side, se combina por AND con `search`/`status`/etc., nunca OR).

Las pantallas de listado deben usar los datos de empleado incluidos en cada novedad cuando alcance para mostrar legajo/persona. No deben pedir todos los legajos solo para resolver nombres.

### Crear individual o masiva

```txt
POST /api/novelties
```

Body:

```json
{
  "employeeIds": ["uuid"],
  "noveltyTypeId": "uuid",
  "fromDate": "2026-06-22",
  "toDate": "2026-06-25",
  "quantityHours": 1,
  "quantityDays": 1,
  "observation": "Observacion",
  "targetHourConceptId": "uuid opcional"
}
```

Reglas:

- Si quien crea es RRHH, la novedad nace `APROBADO` directo; cualquier otro rol la deja `PENDIENTE` (el campo `NoveltyType.requiresApproval` se persiste pero no controla este flujo — es decorativo).
- Valida si el tipo permite horas o fecha hasta.
- Valida vigencia cuando corresponde.
- **Etapa 15G.1** (`docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md`): crear una novedad **nunca** crea ni modifica `TimeEntry` — esto aplica sin importar `status` (`PENDIENTE`/`APROBADO`), rol de quien crea, ni `timeEntryBehavior` del tipo. El fichador y la carga horaria manual (`/api/time-entries`) son la única fuente de verdad de horas reales; Novedades es justificación administrativa.
- **Etapa 15G.3** (`docs/decisions/NOVELTY_OVERLAP_DUPLICATE_RULES_15G3.md`): rechaza (409) crear una novedad del **mismo `noveltyTypeId`** para el **mismo empleado** cuando su rango de fechas (`fromDate`/`toDate`, `toDate` nulo tratado como igual a `fromDate`) coincide o se superpone con una novedad ya activa (cualquier `status` salvo `RECHAZADO`):
  - `NOVELTY_DUPLICATE` — el rango coincide exactamente con el existente.
  - `NOVELTY_OVERLAP` — el rango sólo se superpone parcialmente.
  - En carga masiva (`employeeIds` con más de un legajo), si **cualquiera** tiene un conflicto se rechaza el lote completo — no crea parcialmente al resto.
  - El mensaje (`error.message`) identifica el tipo de novedad y el/los legajo(s) en conflicto (p. ej. `Ya existe una novedad "Vacaciones" para el legajo 100 que se superpone con el rango de fechas seleccionado.`) — nunca un id/UUID técnico.
  - **No** evalúa compatibilidad entre `NoveltyType` distintos (dos tipos diferentes pueden seguir superponiéndose sin bloqueo) — ver el documento de decisión para el alcance exacto.

### Aprobar / rechazar

```txt
POST /api/novelties/:id/approve
POST /api/novelties/:id/reject
```

Rechazo:

```json
{
  "reason": "Motivo"
}
```

**Etapa 15G.1:** `approve` sólo cambia `status`/`approvedByUserId`/`approvedAt` y registra auditoría — nunca crea ni modifica `TimeEntry`, sea cual sea `timeEntryBehavior` del tipo. `reject` tampoco toca `TimeEntry` (nunca hubo nada que revertir).

### Fichador público (clock)

```txt
GET  /api/time-entries/clock/employees?search=
POST /api/time-entries/clock/status
POST /api/time-entries/clock/photo-punch
GET  /api/time-entries/clock/attempts/:requestId?employeeId=
```

Kiosco sin sesión de usuario. Desde F6 cada una de estas cuatro rutas exige un `ClockDevice` **ACTIVE** autenticado individualmente con `Authorization: ClockDevice <deviceId>.<secret>` (`requireClockDevice()`); no existe token compartido y `x-clock-device-token` ya no autentica nada. Orden de guardas: límite por IP previo a autenticar (`CLOCK_IP_RATE_LIMIT_MAX`), `requireClockDevice()`, límite por dispositivo autenticado (`CLOCK_RATE_LIMIT_MAX`), y recién después validación del body. No requieren `requireAuth` (y un JWT no las abre). Son las únicas rutas `/clock`: cualquier otra `/api/time-entries/clock/*` responde `404 ROUTE_NOT_FOUND` con o sin credencial (F0 del fichador standalone retiró `POST /clock/in`, `/clock/out`, `/clock/status-by-dni`, `/clock/in-by-dni` y `/clock/out-by-dni`, que fichaban sin foto). Ver `docs/SECURITY_STANDARDS.md` → "Public clock endpoints (fichador)".

Errores de dispositivo (comunes a las cuatro rutas):

| Status | Código | Cuándo |
|---|---|---|
| 401 | `CLOCK_DEVICE_INVALID_CREDENTIAL` | Header ausente o mal formado, id inexistente o secreto incorrecto (respuesta idéntica en los tres casos) |
| 403 | `CLOCK_DEVICE_NOT_ACTIVE` | Credencial válida de un dispositivo `PENDING` |
| 403 | `CLOCK_DEVICE_REVOKED` | Credencial válida de un dispositivo `REVOKED` |
| 404 | `CLOCK_ATTEMPT_NOT_FOUND` | `attempts/:requestId` inexistente, de otro dispositivo, histórico sin dispositivo o de otro empleado |
| 429 | (rate limiter) | Cupo por IP o por dispositivo agotado |

Atribución (F6): la fichada y el intento guardan `deviceId = req.clockDevice.id` (`AttendancePunch.deviceId`, `ClockPunchAttempt.deviceId`); cualquier `deviceId` del body se descarta. IP y user-agent persistidos salen de la request, nunca del body (`device.*` es sólo contexto informativo de la cámara). `requestId` sigue siendo único global: reutilizarlo desde otro dispositivo responde `409 CLOCK_IDEMPOTENCY_KEY_REUSED` sin exponer el resultado guardado. `source` sigue siendo `PUBLIC_CLOCK_PHOTO` hasta F7 (plan §25). `ClockDevice.sectorId` es metadata de ubicación y no restringe qué empleados puede buscar o fichar un dispositivo `ACTIVE` (plan §25.2).

Contrato de empleado en las cuatro respuestas (F0): `{ id, legajo, dniSuffix, firstName, lastName, name }` — `dniSuffix` son los últimos 3 dígitos del DNI; el DNI completo nunca se devuelve. `clock/status` devuelve `{ employee, openShift: { id, startAt } | null }` (sin conceptos horarios). La respuesta de salida de `photo-punch` devuelve `employee`, `workShift` (`id`, `startAt`, `endAt`, `totalMinutes`, `totalHours`) y `segments` (etiquetas para pantalla), sin las filas internas de `TimeEntry`/`TimeSegment`.

```json
{
  "requestId": "uuid",
  "employeeId": "uuid",
  "punchType": "IN",
  "photo": "data:image/jpeg;base64,...",
  "thumbnail": "data:image/jpeg;base64,...",
  "faceValidationStatus": "VALID",
  "faceDetectionScore": 0.94,
  "device": { "userAgent": "...", "platform": "...", "language": "...", "cameraLabel": "..." }
}
```

Etapa 6K — el fichador registra únicamente entrada/salida, nunca un tipo de jornada:

- `hourConceptId` ya no se pide ni se manda desde la UI. El campo sigue existiendo en el schema como opcional, sólo por compatibilidad con clientes viejos; ya no hay `superRefine` que lo exija en `IN`.
- El backend resuelve internamente la Hora normal canónica por `HourConcept.systemRole = NORMAL_BASE` (no por `kind = "NORMAL"`, que es la etiqueta legacy) — ver `findDefaultHourConcept` en `timeEntries.repository.ts`. La resolución es directa contra `HourConcept` (igual que la grilla aditiva), sin exigir un vínculo `EmployeeHourConcept` por legajo: Normal es la base universal, no un concepto adicional habilitado por legajo.
- Si un cliente viejo todavía manda `hourConceptId` en `IN` y ese id resuelve a un concepto que **no** es la base canónica (por ejemplo Sereno o Colectivo), el backend lo rechaza explícitamente con `409 CLOCK_HOUR_CONCEPT_NOT_ALLOWED` — no se acepta silenciosamente ni se ignora. Esta restricción es específica del fichador (`resolveShiftConcept(..., { restrictToNormalBase: true })`).
- El fichador no crea `HourConceptBreakdown` ni dispara el recálculo automático (Etapa 6I/6J); sólo abre/cierra `WorkShift` y, al cerrar, sigue generando `TimeEntry`/`TimeSegment` de Horas normales como antes.

Etapa 6L — el `TimeEntry` que se genera al cerrar cualquier jornada (fichador público, DNI, o alta/cierre manual de RRHH) siempre usa la Hora normal canónica, independientemente de qué concepto haya intersectado el clasificador legacy en cada tramo:

- **`POST /time-entries/work-shifts` (alta manual RRHH) ya no puede generar un `TimeEntry` de un concepto adicional.** El contrato de request no cambió — `hourConceptId` sigue siendo opcional y RRHH puede seguir enviando cualquier concepto habilitado (Sereno, Colectivo, etc.) — pero ese valor ya sólo alimenta la partición interna de `TimeSegment` (evidencia técnica del clasificador `HourConceptRule`/`priority`); el `TimeEntry` real que representa el trabajo (`totalMinutes`/`hours`, lo que cuenta como Horas normales) siempre se resuelve por separado contra `HourConcept.systemRole = NORMAL_BASE`, ignorando el `hourConceptId` recibido para ese fin. Antes de esta etapa, esta ruta sí generaba `TimeEntry` con el concepto pedido.
- `POST /time-entries/work-shifts/:id/close-manual` no cambió: ya resolvía Normal sin id desde antes.
- `TimeSegment` no cambió: sigue guardando el `hourConceptId`/`hourConceptRuleId`/`conceptStatus` que produce el clasificador legacy por `HourConceptRule`/`priority`, tal cual como evidencia técnica. `priority` sigue sin gobernar ningún dato del modelo nuevo — ver `docs/decisions/CONCEPTOS_HORARIOS_ADITIVOS.md` (Etapa 6L) para el detalle completo y la deuda pendiente.

## Carga horaria — CRUD y flujo de aprobación

> Estado de transición: el CRUD actual exige `hourConceptId` por registro y valida conceptos habilitados. El rediseño deberá garantizar Horas normales para todos los empleados sin asignación y tratar los demás `hourConceptId` como desgloses habilitados desde el legajo. Hasta entonces, esta sección es contrato técnico vigente, no fuente de verdad del cálculo funcional.

### Listar

```txt
GET /api/time-entries
```

Query:

```txt
employeeId
hourConceptId
status
period
from
to
take
page
```

### Crear carga

```txt
POST /api/time-entries
```

Body:

```json
{
  "employeeId": "uuid",
  "hourConceptId": "uuid",
  "date": "2026-06-23",
  "hours": 8,
  "observation": "Observacion"
}
```

Reglas:

- Crea en `BORRADOR` — **excepto si quien carga es RRHH** (Etapa 6L.3): en ese caso queda `APROBADO` directo, con `approvedByUserId`/`approvedAt` propios, sin pasar por `BORRADOR`/`EN_REVISION`. Nivel 2/3 mantienen `BORRADOR`. La decisión es por rol del usuario autenticado (`req.user.role`), nunca por un campo del body — el cliente no puede pedir el estado.
- Valida que la hora especial esté habilitada para el legajo.
- Evita duplicado por empleado + fecha + concepto.
- Permite `0` horas para registros generados o asociados a novedades bloqueantes.
- Rechaza horas negativas y más de 24 horas por registro.
- **Etapa 15E** (`docs/decisions/TIME_CLOSURE_CONSISTENCY_15E.md`): si `MonthlyTimeClosure` del empleado/período (derivado de `date`) está `ENVIADO`/`APROBADO`/`CORRECCION_PENDIENTE`, responde `409 MONTHLY_CLOSURE_LOCKED` — **sin excepción de rol, ni siquiera RRHH**. No existe una vía de "corrección" para crear una fila nueva en un período cerrado; para eso hay que reabrir el cierre primero (`POST /workforce/closures/:id/return`, ver más abajo).
- **Etapa 15G.1** (`docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md`): si el día está cubierto por una `Novelty` con `status = APROBADO` cuyo `noveltyType` tenga `timeEntryBehavior = BLOQUEA_NUEVA_CARGA`, responde `409 TIME_ENTRY_DAY_BLOCKED_BY_NOVELTY`. Antes de esta etapa bastaba con que la novedad no estuviera `RECHAZADO` (una `PENDIENTE` ya bloqueaba); ahora sólo `APROBADO` bloquea. Esto es sólo bloqueo preventivo de carga **nueva** — nunca modifica un `TimeEntry` existente.

### Editar

```txt
PATCH /api/time-entries/:id
```

No permite editar `CERRADO`. Editar una fila `APROBADO` (o con el período en `ENVIADO`/`APROBADO`/`CORRECCION_PENDIENTE`) exige `correctionReason` en el body. Si quien edita es RRHH (Etapa 6L.3), la fila queda (o se mantiene) `APROBADO` con `approvedByUserId`/`approvedAt` propios sin importar el estado anterior (`BORRADOR`, `EN_REVISION`, `DEVUELTO` o ya `APROBADO`); Nivel 2/3 no tocan el `status` al editar, igual que antes de esta etapa. Con el período `ENVIADO`/`APROBADO`/`CORRECCION_PENDIENTE`, Nivel 2/3 reciben `409 PERIOD_CLOSED_REQUIRES_CORRECTION` (deben usar `POST /workforce/corrections` en su lugar); no existe endpoint de borrado para `TimeEntry`.

### Enviar / aprobar / rechazar / devolver

```txt
POST /api/time-entries/:id/submit
POST /api/time-entries/:id/approve
POST /api/time-entries/:id/reject
POST /api/time-entries/:id/return
```

`submit` sigue disponible para RRHH/Supervisión/Nivel 3 (`operationalRoles`). `approve`/`reject`/`return` son **exclusivos de RRHH** (Etapa 6L.3, ajuste posterior): el guard de ruta acepta sólo `NIVEL_1_RRHH` y el servicio responde `403 FORBIDDEN` para cualquier otro rol, sea o no el creador de la carga — Supervisión (Nivel 2) ya no puede aprobar/rechazar/devolver ninguna carga horaria, ni propia ni ajena. RRHH nunca necesita resolver una carga propia por esta vía porque `create`/`update` ya la dejan `APROBADO` directo.

## Mis Pendientes

```txt
GET /api/pending
```

Query:

```txt
kind=all|novelties|timeEntries|hourConceptBreakdowns
period=YYYY-MM
page=1
take=100
```

`novelties` y `hourConceptBreakdowns` son de una sola fuente y paginan de verdad (`page` + `meta`). `all`/`timeEntries` combinan fuentes y devuelven siempre la primera página de cada una (`meta.page = 1`, `meta.hasMore` si hay más). `summary` informa **totales reales** (`count`), no la cantidad de filas traídas.

Devuelve:

```json
{
  "data": {
    "summary": {
      "total": 1,
      "novelties": 1,
      "timeEntries": 0,
      "hourConceptBreakdowns": 0
    },
    "data": [
      {
        "kind": "novelty",
        "sourceId": "uuid",
        "status": "PENDIENTE",
        "employeeId": "uuid-del-legajo",
        "employeeLabel": "000001 - Apellido, Nombre",
        "title": "Vacaciones",
        "subtitle": "NOV-VAC",
        "quantity": "1"
      }
    ],
    "meta": { "total": 1, "page": 1, "pageSize": 100, "hasMore": false }
  }
}
```

Desde la Etapa 6L.3, `kind` también puede ser `"hourConceptBreakdown"` (desgloses manuales `EN_REVISION` de Nivel 2/3, filtrados por `kind=all|timeEntries` igual que `timeEntry` — `kind=novelties` los excluye) y `summary` suma el campo `hourConceptBreakdowns` con su conteo. Es un campo aditivo: un consumidor que ya leía `summary.total`/`summary.novelties`/`summary.timeEntries` sigue funcionando sin cambios.

**Etapa 6L.5 (aclaración de contrato):** todo ítem expone `employeeId` (antes iba embebido sin tipar en un objeto `employee` que ningún consumidor leía) — es el `:id` que pide `POST /employees/:id/hour-concept-breakdowns/manual/:breakdownId/approve|reject|return` para resolver un ítem `kind: "hourConceptBreakdown"` desde la bandeja de revisión. `sourceId` es el `:breakdownId` en ese caso (o el `:id` de `POST /time-entries/:id/approve|reject|return` cuando `kind: "timeEntry"`).

## Documentos

### Listar documentos

```txt
GET /api/documents
```

Query:

```txt
employeeId
categoryId
status
search
take
page
```

Reglas:

- Requiere autenticacion. Rol: `NIVEL_1_RRHH`/`NIVEL_2_SUPERVISION`/`NIVEL_3_CARGA_HORARIA` (Etapa 15D.4).
- Devuelve datos minimos de categoria y empleado para renderizar la tabla.
- Las pantallas de listado no deben pedir `/api/employees` solo para mostrar legajo/persona.
- El listado debe mantenerse paginado; las subidas de documentos pueden cargar legajos bajo demanda al abrir el modal.
- Filtra por `employeeAccessWhere` (alcance) y por `category.viewRoles` (Etapa 15D.4) — RRHH ve todo; Supervisión/Nivel 3 sólo ven documentos de categorías cuyo `viewRoles` incluya su rol, dentro de su alcance. El filtro va en la query (no en memoria), así `meta.total`/`hasMore` quedan correctos.

## Carga horaria — listados y resúmenes

### Listar cargas

```txt
GET /api/time-entries
```

Query:

```txt
period=YYYY-MM
employeeId
hourConceptId
status
search
costCenterId
from
to
take
page
```

Reglas:

- Devuelve `meta` de paginacion.
- `search` filtra por datos del empleado: legajo, legajo Finnegans, CUIL, DNI, nombre o apellido.
- `costCenterId` filtra por centro de costo del empleado.
- La bandeja de revision de Horas debe usar `status=EN_REVISION` y paginacion, no descargar todas las cargas del periodo.

### Resumen del periodo

```txt
GET /api/time-entries/summary
```

Query:

```txt
period=YYYY-MM
```

Response:

```json
{
  "data": {
    "activeEmployees": 110,
    "employeesWithEntries": 82,
    "pendingEmployees": 28,
    "reviewEmployees": 12,
    "countableHours": 1540,
    "coverage": 75
  }
}
```

Reglas:

- Respeta el alcance del rol autenticado.
- Debe usarse para KPI cards del modulo Horas.
- Evita traer todas las cargas del periodo solo para calcular contadores.
- `countableHours` ("Total trabajado" en la UI) = Horas base (`TimeEntry` `NORMAL_BASE` APROBADO/EN_REVISION) + horas de conceptos `ADDITIVE_TO_WORKED_TOTAL` (`HourConceptBreakdown` sin RECHAZADO). Nunca suma conceptos `WITHIN_BASE` (ver `docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md`).

### Personas del periodo para tabla

```txt
GET /api/time-entries/period-employees
```

Query:

```txt
period=YYYY-MM
search
costCenterId
take
page
```

Response:

```json
{
  "data": [
    {
      "employee": {
        "id": "uuid",
        "legajo": "000001",
        "firstName": "Nombre",
        "lastName": "Apellido"
      },
      "summary": {
        "total": 160,
        "status": "APROBADO"
      }
    }
  ],
  "meta": {
    "total": 120,
    "page": 1,
    "pageSize": 25,
    "hasMore": true
  }
}
```

Reglas:

- Respeta el alcance del rol autenticado.
- Devuelve empleados activos paginados.
- Calcula total y estado solo para los empleados visibles.
- Debe usarse para la tabla principal de Horas en lugar de descargar todos los legajos y todas las cargas del periodo.
- Desde 2026-10-02 `summary = { incidents, status, accounting, dailyBreakdown }` (el JSON de ejemplo de arriba es anterior). `accounting` es el `PeriodAccounting` del legajo (ver time-grid) con `days`; Horas base = `TimeEntry` `NORMAL_BASE` APROBADO/EN_REVISION y conceptos = `HourConceptBreakdown` sin RECHAZADO. `dailyBreakdown[]` = `{ day, novelty, specialHourRuleNames, specialHourConflict }` sólo para días con horas o novedad. Ya no existen `total`, `normal`, `special`, `specialHourAdditionalHours` ni `specialHourLiquidableTotal`. La vista "Por persona" (`GET /time-entries?view=byEmployee`) devuelve `summary = { status, accounting (sin days), specialHourRuleNames, specialHourConflict }`.

## Exportaciones

### Finnegans novedades — preview

```txt
GET /api/finnegans-export/novelties
```

Query:

```txt
period=YYYY-MM   (obligatorio)
employeeId       (opcional)
preview=true     (aceptado por compatibilidad textual; este GET siempre se
                   trata como preview desde la Etapa 15L.4 — la exportación
                   definitiva se movió a POST, ver abajo)
```

**Etapa 15L.3A** (`docs/decisions/FINNEGANS_EXPORT_NORMALIZED_15L3A.md`):
`from`/`to`/`includePending` se retiraron (sin caller real, incompatibles con
el gate de cierre mensual). Este GET nunca exige cierre mensual aprobado,
nunca audita y nunca crea historial.

Respuesta JSON (`{ data: { period, rows, readiness, hash, lastExport } }`):

```txt
readiness.ready        boolean
readiness.totalRows    number
readiness.readyRows    number
readiness.blockedRows  number
readiness.reasons      string[]  (motivos humanos, sin ids técnicos)
hash                    string   (SHA-256 del dataset actual, Etapa 15L.4 §7)
lastExport              FinnegansExportBatchSummary & { sameAsCurrent: boolean } | null
```

Cada fila trae, además de las columnas de abajo, un campo `estado`
(`LISTO`/`FALTA_CANTIDAD`/`FALTA_CONFIGURACION`/`CIERRE_PENDIENTE`) — sólo
para la UI de preview, nunca se exporta en el CSV/XLSX.

### Finnegans novedades — exportación definitiva (Etapa 15L.4)

```txt
POST /api/finnegans-export/novelties/export
```

Reemplaza al GET sin `preview` y a `GET .../novelties.csv` de 15L.3A
(ambos retirados — sin ningún caller real). Body:

```txt
{
  period: "YYYY-MM",       (obligatorio)
  employeeId?: string,      (opcional)
  format: "XLSX" | "CSV",   (obligatorio, sólo informativo — no cambia selección)
  reexportReason?: string,  (obligatorio si el período ya tiene algún batch —
                              exigido por el backend, mínimo 5 caracteres)
  idempotencyKey: string,   (obligatorio, UUID — un reintento con la misma
                              key nunca crea una versión nueva)
}
```

Revalida todo desde cero: exige que el cierre mensual de cada empleado
incluido esté `APROBADO` (si no, `409 FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED`),
que cada fila esté completamente lista (si no, `409 FINNEGANS_EXPORT_NOT_READY`
— con precedencia sobre el de cierre si ambos aplican), y que venga motivo
si corresponde (si no, `400 FINNEGANS_EXPORT_REASON_REQUIRED`). Si autoriza,
crea un `FinnegansExportBatch` + snapshot de filas (`FinnegansExportBatchItem`)
y audita (`AuditLog`, `action: EXPORT`, `entity: FinnegansExport`,
`entityId: batch.id`).

Respuesta JSON (`{ data: { period, rows, readiness, batch } }`):

```txt
batch.id              string  (referencia de navegación, no se muestra como texto)
batch.version          number
batch.format            "XLSX" | "CSV"
batch.createdAt          string (ISO)
batch.createdByName      string | null
batch.rowCount           number
batch.reason             string | null
batch.isReexport         boolean  (version > 1)
batch.sameAsPrevious     boolean  (hash igual al batch anterior)
batch.diff               { added, removed, modified } | null  (null en v1)
```

### Finnegans novedades — historial (Etapa 15L.4)

```txt
GET /api/finnegans-export/history?period=YYYY-MM
GET /api/finnegans-export/history/:batchId
```

El primero devuelve `{ data: { period, batches } }` — batches del período,
más nueva primero, cada uno con la misma forma que `batch` de arriba más
`diff` contra su versión anterior inmediata. El segundo devuelve
`{ data: { batch, rows, diff } }` — metadata + snapshot completo de filas
(mismo formato que las columnas de exportación) + diff contra el anterior.
Ambos exigen el mismo rol que el resto del módulo (RRHH) — sin ids
técnicos expuestos en ningún texto de presentación.

Columnas (CSV/XLSX, sin cambios de nombre ni de orden desde 15L.3A):

```txt
Legajo
Novedad
Centro de costo
Valor 1
Fecha Aplicación
Fecha desde
Fecha hasta
```

### Horas por persona

```txt
GET /api/time-entries/export
GET /api/time-entries/export.csv
```

Query:

```txt
period=YYYY-MM
employeeId
includeInReview=false
```

**Etapa 15E.2** (`docs/decisions/TIME_EXPORT_CLOSURE_GATE_15E2.md`): con `includeInReview=false` (el default — export **definitivo**, para liquidación), el endpoint exige que `MonthlyTimeClosure` esté `APROBADO` para **cada** empleado que aparecería en el resultado. Si algún empleado no tiene cierre para ese período, o lo tiene en `ABIERTO`/`ENVIADO`/`DEVUELTO`/`CORRECCION_PENDIENTE`, responde `409 MONTHLY_CLOSURE_NOT_APPROVED` — nunca genera un archivo parcial. Con `includeInReview=true` (vista previa — incluye filas `EN_REVISION` además de `APROBADO`), el gate no aplica; la respuesta JSON incluye `definitive: false` para marcar explícitamente que no es apta para liquidación (`definitive: true` en el export normal). Este campo es aditivo — no cambia las columnas del `.csv`, que sólo lee `rows`.

Antes de 15E.2, este endpoint filtraba sólo por `TimeEntry.status` y nunca consultaba `MonthlyTimeClosure` — quedó documentado como deuda en `docs/decisions/TIME_CLOSURE_CONSISTENCY_15E.md` §8 y cerrado acá.

Respuesta JSON (desde 2026-10-02, `docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md`): `{ total, columns[{ key, kind: "text" | "hours" }], rows[Record<string,string>], definitive }`. El `.csv` usa exactamente `columns` en el mismo orden.

Columnas:

```txt
CUIL | Apellido | Nombre | Legajo | Empresa | Centro de costo
Horas base
Horas normales
<Concepto> (horas reales)            -- una por concepto con horas en el período (dentro de la jornada primero)
Total trabajado                      -- Horas base + conceptos ADDITIVE_TO_WORKED_TOTAL
Horas normales (para liquidación)
<Concepto> (para liquidación)        -- una por concepto
Equivalencia para liquidación        -- suma de los componentes anteriores
Reglas de horas especiales aplicadas
Conflicto de reglas
Estado
```

- Todos los valores salen de la contabilidad única (`workedTimeAccounting.ts`); el multiplicador de cada desglose es su propio snapshot (`HourConceptBreakdown.appliedMultiplier`).
- Conceptos con el mismo nombre se distinguen por código: `Traslado (TR-1) (horas reales)`.
- Incluye a quienes sólo tienen horas adicionales en el período (sin `TimeEntry`), y el gate de cierre aprobado también los alcanza.
- Ejemplo obligatorio (base 8, Sereno 3, Colectivo 1, domingo ×2): `Horas base 8`, `Horas normales 5`, `Sereno (horas reales) 3`, `Colectivo (horas reales) 1`, `Total trabajado 9`, `Horas normales (para liquidación) 10`, `Sereno (para liquidación) 6`, `Colectivo (para liquidación) 2`, `Equivalencia para liquidación 18`.
- Se eliminaron `Horas especiales`, `Horas trabajadas totales`, `Horas especiales (equivalente liquidable)`, `Conceptos horarios (equivalente liquidable)`, `Adicional por horas especiales` y `Total liquidable` (8F/11B), que duplicaban los conceptos dentro de la jornada.
- `TimeEntry.hours`/`totalMinutes` siguen siendo siempre minutos reales (Etapa 8F).

## Auditoría

```txt
GET /api/audit
```

Query:

```txt
entity
entityId
userId
action
take
page
```

Acciones críticas ya auditadas:

- creación/edición de legajos;
- contacto;
- domicilio;
- transporte;
- documentos (incluye descarga/visualización, acción `EXPORT`);
- movimientos laborales;
- asignaciones;
- horas habilitadas;
- novedades (incluye aprobación/rechazo);
- carga horaria;
- cierres mensuales (envío, aprobación, devolución) y correcciones de horas (creación, aprobación, rechazo) — `workforceService`;
- login (éxito y fallo, acción `LOGIN`) y accesos denegados/403 (acción `REJECT`);
- exportaciones;
- catálogos principales.

## Módulos agregados (2026-08)

Estos módulos existen y están en uso real, pero no tenían sección en este documento. Rutas confirmadas contra `backend/src/modules/*/*.routes.ts` — ver el código fuente de cada uno para el detalle exacto de payloads/respuestas.

### Régimen laboral (`work-regimes`, montado en `/api/work-regimes` y `/api/employees/:employeeId/work-regimes`)

WorkRegime es 100% configurable por RRHH — `kind` (`TURNO_OBLIGATORIO`/`TURNO_FLEXIBLE`/`SIN_TURNO`) y `openShiftOverflowAction` (`ROLLOVER`/`ALERT_ONLY`) son comportamientos genéricos; instancias concretas (Cosecha, Riego, Campaña, Oficina flexible, etc.) son datos, nunca valores hardcodeados. `EmployeeWorkRegime` asigna un régimen a un empleado con vigencia (`effectiveFrom`/`effectiveTo`); no se permiten dos asignaciones vigentes solapadas para el mismo empleado (409 `WORK_REGIME_ASSIGNMENT_OVERLAP`). Todas las rutas requieren `requireAuth`; lectura abierta a cualquier rol autenticado, escritura solo RRHH.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/work-regimes` | cualquiera autenticado | Listar regímenes (filtros `status`, `kind`, `search`) |
| GET | `/work-regimes/:id` | cualquiera autenticado | Detalle de un régimen |
| POST | `/work-regimes` | RRHH | Crear régimen (409 si `code` ya existe) |
| PATCH | `/work-regimes/:id` | RRHH | Editar régimen (parcial) |
| PATCH | `/work-regimes/:id/status` | RRHH | Activar/inactivar (audita `ACTIVATE`/`DEACTIVATE`) |
| GET | `/employees/:employeeId/work-regimes` | cualquiera autenticado | Historial de asignaciones, orden `effectiveFrom desc` |
| GET | `/employees/:employeeId/work-regimes/current?date=YYYY-MM-DD` | cualquiera autenticado | Régimen vigente a esa fecha (`data: null` si no hay ninguno) |
| POST | `/employees/:employeeId/work-regimes` | RRHH | Asignar régimen con vigencia (404 si `employeeId`/`workRegimeId` no existen; 409 si se solapa) |
| PATCH | `/employees/:employeeId/work-regimes/:assignmentId` | RRHH | Editar una asignación (re-chequea solapamiento) |
| PATCH | `/employees/:employeeId/work-regimes/:assignmentId/close` | RRHH | Cerrar vigencia (`effectiveTo`) |

### Turnos (`shifts`, montado en `/api/shifts`)

Todas las rutas requieren `requireAuth`.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/assignments` | RRHH/Supervisión/Carga Horaria | Listar asignaciones de turno |
| GET | `/assignments/summary` | RRHH/Supervisión/Carga Horaria | Conteos agregados por turno (`total`, `enabled`, `disabled`, `other`), respetando alcance por empleado |
| POST | `/assignments` | RRHH | Asignar turno a un empleado |
| PATCH | `/assignments/:id` | RRHH | Editar una asignación |
| DELETE | `/assignments/:id` | RRHH | Quitar una asignación |
| GET | `/alerts` | RRHH/Supervisión/Carga Horaria | Listar alertas de jornada abierta/vencida |
| POST | `/alerts/:id/resolve` | RRHH/Supervisión | Resolver una alerta |
| GET | `/holiday-work/dates?from&to` | RRHH/Supervisión/Carga Horaria | Fechas de feriado disponibles para convocar (Etapa 12D) |
| GET | `/holiday-work/candidates?sectorId&shiftTemplateId&withoutShift&search&page&take` | RRHH/Supervisión/Carga Horaria | Empleados candidatos a convocar (con o sin turno habitual) |
| GET | `/holiday-work/assignments?date` | RRHH/Supervisión/Carga Horaria | Convocatorias activas para una fecha |
| PUT | `/holiday-work/assignments` | RRHH | Guardar convocatorias (upsert por empleado, ver abajo) |

#### Asignaciones de trabajo en feriados (`/holiday-work/*`) — Etapa 12D

- `GET /holiday-work/dates?from=YYYY-MM-DD&to=YYYY-MM-DD` (rango máximo 400 días): delega en `workforceService.holidayDatesInRange` (`workforce-management`, reutiliza `calendarPreview(kind=FERIADO)` sin duplicar el cálculo de calendario — ver `docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_12A.md`). Devuelve `[{ date, rules: [{ id, name }] }]` — nunca `multiplier`/`priority`/`hasOverlap`/`hasConflict` (eso es de liquidación, no de esta pantalla).
- `GET /holiday-work/candidates`: empleados `status=ACTIVO` dentro del alcance del usuario (`employeeAccessWhere`), paginados (`take` máximo 500, default 100). `shiftTemplateId` filtra por `shiftAssignments` `HABILITADO`; `withoutShift=true` filtra a quienes no tienen ninguna. Devuelve, por empleado, su sector y sus turnos habituales activos.
- `GET /holiday-work/assignments?date=YYYY-MM-DD`: convocatorias `status=ACTIVA` para esa fecha, dentro del alcance del usuario.
- `PUT /holiday-work/assignments` — body `{ date, assignments: [{ employeeId, status?, shiftTemplateId?, expectedStartTime?, expectedEndTime?, notes? }] }` (`status` default `ACTIVA`). **Cada entrada es un upsert independiente para `(date, employeeId)` — nunca reemplaza todas las convocatorias ya guardadas para la fecha.** Un empleado no incluido en el body no se toca. `status=CANCELADA` desactiva sin borrar la fila (mismo criterio que `ShiftAssignment` `DESHABILITADO`); un `employeeId` repetido en el mismo body se rechaza. No crea `TimeSegment`/`TimeEntry`, no toca `DoubleHourRule` ni ninguna tabla de liquidación, no dispara notificaciones.

### Gestión de fuerza laboral (`workforce-management`, montado en `/api/workforce`)

Todas las rutas requieren `requireAuth`.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/closures` | todos los operativos | Cierres mensuales por período |
| POST | `/closures/submit` | Supervisión/Carga Horaria | Enviar cierre a aprobación |
| POST | `/closures/approve` | RRHH | Aprobar cierres en lote |
| POST | `/closures/:id/return` | RRHH | Devolver un cierre |
| GET / POST | `/corrections`, `/corrections/:id/approve`, `/corrections/:id/reject` | según rol | Solicitudes de corrección de horas. `GET` exige `period=YYYY-MM` y acepta `status=PENDIENTE|APROBADA|RECHAZADA` — filtrados en el `where` (antes: últimas 500 de todos los períodos, filtradas en el cliente) |
| GET / POST | `/notifications`, `/notifications/:id/read`, `/notifications-unread-count` | todos | Notificaciones internas del sistema |
| GET / POST / PATCH / DELETE | `/shift-templates*` | RRHH (escritura) | Plantillas de turno |
| GET / POST / PATCH / DELETE | `/double-hour-rules*` | RRHH (escritura) | Reglas de Horas Especiales (`DoubleHourRule`) |
| GET | `/double-hour-rules/calendar?from&to&kind` | todos los operativos | Preview de calendario de Horas Especiales (ver abajo) |

#### Notificaciones (`/notifications`) — fecha efectiva, filtros, cursor y enriquecimiento de `employee`

`GET /notifications` siempre filtra por `recipientUserId` del usuario autenticado (nunca notificaciones de otro usuario). Query (docs/decisions/NOTIFICATIONS_EVENT_ORDER.md):

- `status?=NO_LEIDA|LEIDA`
- `dateFrom?`/`dateTo?` = `AAAA-MM-DD`, días calendario Argentina inclusive, sobre `eventAt`. `dateFrom > dateTo` → 400 con mensaje de negocio.
- `after?=<cursor>` (página siguiente) o `through?=<cursor>` (ventana visible hasta esa fila inclusive), excluyentes.
- `page?` (compatibilidad, sólo sin cursor) y `take?` (default 20, máximo 100).

Orden: `eventAt DESC, createdAt DESC, id DESC`. El cursor es el `meta.nextCursor` de una respuesta anterior (`"<eventAt>_<createdAt>_<id>"`). Respuesta: `{ data, meta: { total, page, pageSize, hasMore, nextCursor } }`.

Cada item trae `id, type, priority, title, message, entityType?, entityId?, link?, status, eventAt, createdAt`:
- `eventAt` es la fecha efectiva del hecho (inmutable, fijada al crear la notificación). Es la que se muestra, ordena y filtra.
- `createdAt` es solo la creación técnica de la fila. Reemplaza al `eventDate` derivado de 15M.19E.

Sólo para 4 valores de `entityType` llega además un `employee` ya resuelto (`{ id, legajo, firstName, lastName }`, select liviano — nunca el legajo completo):

- `ShiftAlert` (alertas de turno: llegada tarde, salida anticipada, etc. — `type: "ALERTA_FICHADA"`).
- `WorkShift` (falta de salida/olvido — `type: "FALTA_SALIDA"`).
- `Employee` (intento de ingreso con jornada abierta — `type: "INTENTO_INGRESO_JORNADA_ABIERTA"`).
- `AttendanceInactivityIncident` (**"no asistió"**, `type: "SIN_ACTIVIDAD_REGISTRADA"` — agregado en la Etapa 15G.2, docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md; antes de esta etapa este `entityType` no traía `employee`).

El resto de `entityType` (cierres, correcciones, novedades pendientes) no trae `employee`. El enriquecimiento sólo consulta el entityId de la página actual (nunca recorre todo el histórico) y usa un `select` mínimo — no dispara ningún fetch de legajo completo.

#### Horas Especiales (`/double-hour-rules*`) — Etapa 8B (extendido en 12B)

`DELETE /double-hour-rules/:id` **siempre** elimina físicamente la regla, sin importar su vigencia ni su estado, y responde `{ data: { mode: "DELETED", id } }`.
- En la misma transacción retira su traza, la borra y reinterpreta las horas afectadas (cierres incluidos, sin cambiar su estado).
- Para conservar una regla sin que aplique se usa `PATCH` con `status: "INACTIVO"`.
- El modo `INACTIVATED` del DELETE ya no existe. Ver `docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md` §15, "Eliminar vs. inactivar".

Body de `POST`/`PATCH` (todos los campos de scope y `dates` son opcionales; `updateDoubleRuleSchema` acepta un subconjunto parcial):

```json
{
  "name": "Domingo Pañol",
  "recurrenceType": "SEMANAL",
  "fromDate": "2026-01-01",
  "toDate": null,
  "weekdays": [0],
  "multiplier": 2.5,
  "priority": 5,
  "kind": "DOMINGO",
  "companyId": "uuid-o-null",
  "sectorId": "uuid-o-null",
  "costCenterId": "uuid-o-null",
  "positionId": "uuid-o-null",
  "dates": [{ "date": "2026-12-25", "isActive": true }],
  "employeeIds": [],
  "reason": "..."
}
```

- `employeeIds` ya no es obligatorio (antes exigía `.min(1)`) — `[]` significa "sin restricción por persona". `companyId`/`sectorId`/`costCenterId`/`positionId` son independientes y opcionales; todas las dimensiones configuradas (incluida `employeeIds` cuando no está vacío) combinan con **AND**. Sin ninguna configurada, la regla alcanza a cualquier empleado que efectivamente trabaje/fiche. Por eso un `null` **amplía** la regla. Hoy esas cuatro FK son `ON DELETE SET NULL`: borrar el destino amplía la regla en silencio. La reorganización (`docs/decisions/ORG_LOCATION_REORGANIZATION.md` §6) las lleva a `RESTRICT` y prohíbe liberar una referencia dejando el alcance en `null` o borrando la regla. Cómo se evalúa `sectorId` sin `Employee.sectorId` es una decisión pendiente (D-4) que se toma con el inventario de reglas afectadas.
- `priority` (default `0`, mayor gana) resuelve superposición: si 2+ reglas activas matchean el mismo tramo, gana la de mayor prioridad; si empatan en la mayor, se marca conflicto (`SpecialHourRuleApplication.wasConflicting = true`) y se aplica el multiplicador mayor entre las empatadas como resolución determinística — no bloquea la fichada. Política fija por ahora (no configurable por regla); ver `docs/decisions/HORAS_ESPECIALES_8B.md` para lo que queda pendiente.
- `dates` sólo aplica cuando `recurrenceType = "FECHA"` — reemplaza el uso de `fromDate` como "la única fecha": una regla FECHA puede tener muchas fechas (feriados) o una sola. `fromDate`/`toDate` enviados para una regla FECHA se ignoran — el backend los recalcula como min/max de `dates`.
- `kind` (`FERIADO | DOMINGO | JORNADA_ESPECIAL | OTRO`, default `OTRO` — Etapa 12B): clasificación estructurada, independiente de `name` (que sigue siendo sólo texto visible, nunca se usa para lógica ni de matching ni de liquidación). Reglas creadas antes de esta etapa quedaron en `OTRO` por default de la migración, sin inferencia por nombre — requieren reclasificación explícita desde la UI. Ver `docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_12A.md`/`SPECIAL_HOUR_RULE_CLASSIFICATION_12B.md`.
- `GET /double-hour-rules/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&kind=FERIADO` (rango máximo 400 días; `kind` opcional, Etapa 12B): para cada fecha con al menos una regla `ACTIVO` cuyo calendario matchea (y cuyo `kind` coincide, si se pasó el filtro), devuelve `{ date, rules: [{ id, name, priority, multiplier, kind }], hasOverlap, hasConflict }`. Sin `kind`, comportamiento idéntico al de antes de la Etapa 12B (sin filtro). Es un preview de **configuración** (heurístico de alcance, sin fichadas reales) — la resolución exacta por empleado sigue ocurriendo sólo en el motor al fichar.

### Dashboard (`dashboard`, montado en `/api/dashboard`)

`GET /` (requiere auth) — métricas agregadas del home (empleados, altas/bajas, novedades, pendientes de carga horaria, alertas documentales, etc.). Cacheado ~30s en backend, ver `backend/src/modules/dashboard/dashboard.cache.ts`. El KPI `loadedHours` ("Horas cargadas") es el total trabajado real del período: Horas base (`TimeEntry` `NORMAL_BASE` APROBADO/EN_REVISION) + conceptos `ADDITIVE_TO_WORKED_TOTAL` (`HourConceptBreakdown` sin RECHAZADO); nunca suma conceptos `WITHIN_BASE` (base 8 + Sereno 3 + Colectivo 1 → 9, no 8 ni 12). Ver `docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md`.

### Storage (`storage`, montado en `/api/storage`)

Capa compartida de archivos (documentos, evidencia fotográfica del fichador). Todas las rutas requieren `requireAuth`.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/files/:id` | RRHH/Supervisión/Carga Horaria | Metadata del archivo (audita `EXPORT`) |
| GET | `/files/:id/preview` | idem | Preview inline (mismo handler que download) |
| GET | `/files/:id/download` | idem | Descarga (audita `EXPORT`) |
| DELETE | `/files/:id` | RRHH | Archivar/eliminar (audita `DELETE`) |

`preview`/`download` nunca redirigen a una URL pública del proveedor — resuelven por `StorageFile.storageProvider` persistido (Etapa 15D.1) y devuelven el archivo como respuesta autenticada del backend. Para Cloudinary esto es obligatorio desde la Etapa 15D.3 (`docs/decisions/CLOUDINARY_SECURE_DELIVERY_15D3.md`): `getPublicUrl` no entrega ninguna URL permanente utilizable por el cliente.

### Dispositivos de fichada (`clock-devices`, F5)

DTO seguro de dispositivo: `id`, `name`, `status`, `sectorId`, `sector`,
timestamps de activación/revocación/última conexión/creación, última IP,
user-agent y versión. Nunca incluye `tokenHash`, `pairingCodeHash` ni secreto.

Rutas públicas, con rate limit independiente:

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/clock/device/register` | IP/rate limit | Crea `PENDING`; devuelve una vez `{ device, secret }`, con código claro y vencimiento dentro de `device` |
| GET | `/api/clock/device/status` | `Authorization: ClockDevice <id>.<secret>`, cualquier estado | Estado seguro y actualización de metadata de última conexión; un `REVOKED` recibe `200` con su estado para poder mostrarlo |
| POST | `/api/clock/device/pairing-code/refresh` | idem | Sólo `PENDING`; invalida el código anterior y devuelve código/vencimiento nuevos |

Rate limits por IP: registro `5/10 min`, estado `120/5 min`, refresh `10/10
min`; además hay un máximo operativo de 20 solicitudes pendientes. La
resolución RRHH usa `10/5 min`, separada de las anteriores.

Rutas RRHH (`Bearer` JWT + Nivel 1):

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/clock-devices?status=&search=&sectorId=&page=&take=` | Listado paginado |
| GET | `/api/clock-devices/:id` | Detalle seguro |
| POST | `/api/clock-devices/resolve-pairing` | Resuelve `{ pairingCode }` a metadata segura de un pendiente vigente |
| POST | `/api/clock-devices/:id/activate` | `{ pairingCode, name, sectorId? }`; consume pairing y activa atómicamente |
| POST | `/api/clock-devices/:id/revoke` | Transición terminal `ACTIVE → REVOKED` |
| DELETE | `/api/clock-devices/:id` | Sólo `PENDING` sin fichadas/intentos |

Desde F6 la misma credencial individual es la única que autentica
`/api/time-entries/clock/*` (sólo `ACTIVE`; ver "Fichador público (clock)").
No hay heartbeat todavía: la presencia se actualiza en `status` y, con
throttle de 1 minuto, en las rutas operativas.

### Health (`health`, montado en `/api/health`)

`GET /` — healthcheck (sin auth). `GET /performance` — métricas de performance del proceso (sin auth). Uso operativo/monitoreo, no de negocio.

`GET /client-ip` — sonda de medición de proxies (F0 del fichador standalone): sólo existe con `CLIENT_IP_DIAGNOSTICS_ENABLED=true` (si no, 404), sin auth, rate limit propio (20 / 5 min). Devuelve `{ ip, ips, remoteAddress, trustProxy, xForwardedFor, xForwardedForEntries, xRealIp, forwarded, trueClientIp, cfConnectingIp }` del propio llamador, nunca headers de credenciales. Se usa para fijar `TRUST_PROXY_HOPS` y se apaga después.

## Pendientes técnicos de contrato

- Paginación avanzada: varios listados críticos ya soportan `page`, `take` y `meta`; falta extenderlo al resto de catálogos y evaluar cursor pagination para volúmenes muy altos.
- XLSX backend: hoy exportaciones CSV/JSON; el frontend puede generar XLSX o se puede sumar streaming XLSX después.
- Nota (2026-08): los ítems "document upload real" y "refresh tokens" que estaban listados aquí ya están implementados (`POST /employees/:id/documents` vía storage managed upload; `POST /auth/refresh`) — se removieron de esta lista porque ya no son pendientes.
