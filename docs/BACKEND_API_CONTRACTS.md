# Backend API Contracts

## Objetivo

Este documento resume los contratos HTTP actuales del backend real.

El objetivo es que el frontend pueda empezar a reemplazar mocks por servicios API de forma incremental, sin cambiar flujos de negocio de golpe.

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
businessUnitName
establishmentName
areaDepartment
sector
salaryRangeCategory
take
page
```

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

## Carga horaria

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
- documentos;
- movimientos laborales;
- asignaciones;
- horas habilitadas;
- novedades;
- carga horaria;
- exportaciones;
- catálogos principales.

## Pendientes técnicos de contrato

- Document upload real: falta storage privado y endpoint multipart/presigned URL.
- Paginación avanzada: varios listados críticos ya soportan `page`, `take` y `meta`; falta extenderlo al resto de catálogos y evaluar cursor pagination para volúmenes muy altos.
- Refresh tokens: el backend tiene configuración preparada, pero el flujo expuesto actual usa access token.
- XLSX backend: hoy exportaciones CSV/JSON; el frontend puede generar XLSX o se puede sumar streaming XLSX después.
