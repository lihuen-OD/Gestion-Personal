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
  "email": "admin@losod.local",
  "password": "Admin1234!"
}
```

Response:

```json
{
  "user": {
    "id": "uuid",
    "name": "Administrador RRHH",
    "email": "admin@losod.local",
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
    "email": "admin@losod.local",
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
    "email": "admin@losod.local",
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
- `NIVEL_2_SUPERVISION`: alcance por sector asignado.
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
```

Devuelve `meta` de paginacion. Las pantallas de listado deben consumir este endpoint de forma paginada y no pedir todos los legajos para calcular tarjetas.

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
- Si `STORAGE_PROVIDER=local`, se genera un `storageKey` local para desarrollo.
- Si `STORAGE_PROVIDER=cloudinary`, el backend sube el archivo a Cloudinary usando las variables de entorno configuradas.
- `storageKey` sigue disponible para integraciones futuras donde el archivo ya venga subido por otro canal.

### Descargar / abrir documento

```txt
GET /api/documents/:id/download
```

Reglas:

- Requiere autenticacion.
- Respeta el alcance del legajo asociado al documento.
- En storage local sirve el archivo desde `backend/uploads`.
- En Cloudinary redirige a la URL del proveedor.

## Catálogos

### Estructura organizacional

```txt
GET /api/org-structure
```

Devuelve:

- companies;
- businessUnits;
- establishments;
- areas;
- sectors;
- costCenters.

Nota: este endpoint se mantiene como overview completo para alimentar selects y formularios. Si estructura crece mucho, se agregarán endpoints específicos paginados por entidad sin romper este contrato.

Altas/ediciones admin:

```txt
POST/PATCH /api/org-structure/companies
POST/PATCH /api/org-structure/business-units
POST/PATCH /api/org-structure/establishments
POST/PATCH /api/org-structure/areas
POST/PATCH /api/org-structure/sectors
POST/PATCH /api/org-structure/cost-centers
```

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

### Horas especiales

```txt
GET /api/hour-concepts
POST /api/hour-concepts
PATCH /api/hour-concepts/:id
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
  "countsAsWorked": true
}
```

### Reglas de conceptos horarios (`HourConceptRule`)

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
origin
status
exportsToFinnegans
take
page
```

Soporta reglas y vínculos Finnegans:

```json
{
  "code": "NOV-LLEGADA-TARDE",
  "name": "Llegada tarde",
  "uiColor": "amber",
  "kind": "HORARIA",
  "origin": "MIXTA",
  "exportsToFinnegans": true,
  "requiresApproval": false,
  "requiresDocumentation": false,
  "allowsHours": true,
  "allowsDateTo": false,
  "hasValidity": false,
  "blocksTimeEntry": false,
  "setsWorkedHoursToZero": false,
  "timeImpact": "REGISTRA_HORAS_NO_TRABAJADAS",
  "finnegansLinks": [
    {
      "code": "TARDANZA",
      "name": "Tardanza",
      "exportConcept": "Llegada tarde",
      "priority": 1,
      "status": "ACTIVO",
      "hasValidity": false
    }
  ]
}
```

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
salaryRangeCategory
take
page
```

`sectorId` es la única fuente de ubicación de un puesto (no existen `businessUnitName`/`establishmentName`/`areaDepartment`/`sector` como query params ni como columnas de `Position` — fueron eliminados en la limpieza final de Position, ver `docs/DATABASE_STANDARDS.md`). El body de creación/edición usa `sectorId` y `salaryCategoryIds` (array de IDs contra `PositionSalaryCategory`), no un único "suggested category".

`GET /api/positions/:id/employees` devuelve los legajos activos asignados al puesto para la solapa de personas asignadas, incluyendo legajo, nombre, empresas, sector, centro de costo, categoria interna y estado.

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
exportable
search
take
page
```

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

- Si el tipo requiere aprobación, queda `PENDIENTE`.
- Si no requiere aprobación, queda `APROBADO`.
- Valida si el tipo permite horas o fecha hasta.
- Valida vigencia cuando corresponde.

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

## Carga horaria — CRUD y flujo de aprobación

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

- Crea en `BORRADOR`.
- Valida que la hora especial esté habilitada para el legajo.
- Evita duplicado por empleado + fecha + concepto.
- Permite `0` horas para registros generados o asociados a novedades bloqueantes.
- Rechaza horas negativas y más de 24 horas por registro.

### Editar

```txt
PATCH /api/time-entries/:id
```

No permite editar `APROBADO` ni `CERRADO`.

### Enviar / aprobar / rechazar

```txt
POST /api/time-entries/:id/submit
POST /api/time-entries/:id/approve
POST /api/time-entries/:id/reject
```

## Mis Pendientes

```txt
GET /api/pending
```

Query:

```txt
kind=all|novelties|timeEntries
period=YYYY-MM
take=100
```

Devuelve:

```json
{
  "data": {
    "summary": {
      "total": 1,
      "novelties": 1,
      "timeEntries": 0
    },
    "data": [
      {
        "kind": "novelty",
        "sourceId": "uuid",
        "status": "PENDIENTE",
        "employeeLabel": "000001 - Apellido, Nombre",
        "title": "Vacaciones",
        "subtitle": "NOV-VAC",
        "quantity": "1"
      }
    ]
  }
}
```

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

- Devuelve datos minimos de categoria y empleado para renderizar la tabla.
- Las pantallas de listado no deben pedir `/api/employees` solo para mostrar legajo/persona.
- El listado debe mantenerse paginado; las subidas de documentos pueden cargar legajos bajo demanda al abrir el modal.

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

## Exportaciones

### Finnegans novedades

```txt
GET /api/finnegans-export/novelties
GET /api/finnegans-export/novelties.csv
```

Query:

```txt
period=YYYY-MM
from=YYYY-MM-DD
to=YYYY-MM-DD
employeeId
includePending=false
```

Columnas:

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

Columnas:

```txt
CUIL
Apellido
Nombre
Legajo
Empresa
Centro de costo
Horas normales
Horas especiales
Horas trabajadas totales
Estado
```

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

### Gestión de fuerza laboral (`workforce-management`, montado en `/api/workforce`)

Todas las rutas requieren `requireAuth`.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/closures` | todos los operativos | Cierres mensuales por período |
| POST | `/closures/submit` | Supervisión/Carga Horaria | Enviar cierre a aprobación |
| POST | `/closures/approve` | RRHH | Aprobar cierres en lote |
| POST | `/closures/:id/return` | RRHH | Devolver un cierre |
| GET / POST | `/corrections`, `/corrections/:id/approve`, `/corrections/:id/reject` | según rol | Solicitudes de corrección de horas |
| GET / POST | `/notifications`, `/notifications/:id/read`, `/notifications-unread-count` | todos | Notificaciones internas del sistema |
| GET / POST / PATCH / DELETE | `/shift-templates*` | RRHH (escritura) | Plantillas de turno |
| GET / POST / PATCH / DELETE | `/double-hour-rules*` | RRHH (escritura) | Reglas de horas dobles |

### Dashboard (`dashboard`, montado en `/api/dashboard`)

`GET /` (requiere auth) — métricas agregadas del home (empleados, altas/bajas, novedades, pendientes de carga horaria, alertas documentales, etc.). Cacheado ~30s en backend, ver `backend/src/modules/dashboard/dashboard.cache.ts`.

### Storage (`storage`, montado en `/api/storage`)

Capa compartida de archivos (documentos, evidencia fotográfica del fichador). Todas las rutas requieren `requireAuth`.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/files/:id` | RRHH/Supervisión/Carga Horaria | Metadata del archivo (audita `EXPORT`) |
| GET | `/files/:id/preview` | idem | Preview inline (mismo handler que download) |
| GET | `/files/:id/download` | idem | Descarga (audita `EXPORT`) |
| DELETE | `/files/:id` | RRHH | Archivar/eliminar (audita `DELETE`) |

### Health (`health`, montado en `/api/health`)

`GET /` — healthcheck (sin auth). `GET /performance` — métricas de performance del proceso (sin auth). Uso operativo/monitoreo, no de negocio.

## Pendientes técnicos de contrato

- Paginación avanzada: varios listados críticos ya soportan `page`, `take` y `meta`; falta extenderlo al resto de catálogos y evaluar cursor pagination para volúmenes muy altos.
- XLSX backend: hoy exportaciones CSV/JSON; el frontend puede generar XLSX o se puede sumar streaming XLSX después.
- Nota (2026-08): los ítems "document upload real" y "refresh tokens" que estaban listados aquí ya están implementados (`POST /employees/:id/documents` vía storage managed upload; `POST /auth/refresh`) — se removieron de esta lista porque ya no son pendientes.
