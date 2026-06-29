# Frontend Backend Readiness

## Objetivo

Este documento deja explícito el estado actual entre frontend y backend.

La app ya no está solamente en fase frontend-only: ahora existe un backend local real con Node.js, Express, Prisma, PostgreSQL y Neon development.

La decisión de producto sigue siendo correcta: **no conectar todo el frontend de golpe**. La migración debe hacerse por etapas para no romper flujos ya validados.

## Estado actual

### Frontend

El frontend ya está conectado al backend en los módulos principales, manteniendo mocks/localStorage como fallback temporal.

Los mocks siguen siendo útiles para:

- validar UX sin depender del backend durante ajustes visuales;
- comparar visual contra lo ya aprobado;
- mantener velocidad de iteración;
- evitar romper módulos sensibles si el backend local no está levantado.

### Backend

Backend real creado en:

```txt
backend/
```

Stack:

- Node.js;
- Express;
- TypeScript;
- Prisma;
- PostgreSQL;
- Neon development.

Base local sugerida para este repo:

```txt
http://localhost:4002/api
```

Si `4002` está ocupado, usar el `PORT` configurado en `backend/.env` y reflejar el mismo valor en `frontend/.env`.

## Contratos backend disponibles

Ver detalle completo en:

```txt
docs/BACKEND_API_CONTRACTS.md
```

Módulos con backend inicial:

- Auth.
- Usuarios y roles.
- Auditoría.
- Parámetros de auditoría.
- Categorías salariales.
- Empresas y estructura.
- Legajos.
- Contacto.
- Domicilio.
- Transporte.
- Documentos del legajo.
- Movimientos laborales.
- Responsables/asignaciones.
- Horas especiales.
- Tipos de novedades.
- Novedades operativas.
- Carga horaria.
- Mis pendientes.
- Exportación Finnegans.
- Exportación de horas por persona.

## Estrategia recomendada de conexión frontend

### Regla principal

No reemplazar todos los mocks juntos.

Cada módulo debe migrarse con esta secuencia:

1. Crear `apiClient` base.
2. Crear servicio API del módulo.
3. Mantener servicio mock como fallback temporal si hace falta.
4. Conectar una pantalla o flujo puntual.
5. Validar visual y funcional.
6. Recién después avanzar al siguiente módulo.

## Orden recomendado

### Etapa 1. Base técnica

- Crear configuración frontend:

```txt
VITE_API_URL=http://localhost:4002/api
```

- Crear cliente HTTP central.
- Manejar token JWT.
- Manejar errores API con mensaje consistente.
- No mezclar `fetch` directo en componentes.

### Etapa 2. Auth

Conectar:

- login;
- usuario actual;
- logout local.

No avanzar con módulos operativos hasta que auth quede estable.

### Etapa 3. Catálogos de lectura

Conectar primero pantallas de bajo riesgo:

- `GET /api/org-structure`
- `GET /api/hour-concepts`
- `GET /api/novelty-types`

Esto permite alimentar selects/autocompletes sin tocar todavía edición compleja.

### Etapa 4. Legajos

Conectar:

- listado de legajos;
- detalle;
- contacto;
- domicilio;
- transporte;
- documentos metadata;
- asignaciones;
- horas habilitadas.

Mantener especial cuidado con:

- mapas;
- formularios grandes;
- historial visual;
- campos que hoy dependen de mocks.

### Etapa 5. Novedades y carga horaria

Conectar:

- novedades operativas;
- aprobación/rechazo;
- carga horaria;
- envío a revisión;
- aprobación/rechazo;
- Mis Pendientes.

Esta etapa es sensible porque toca estados y permisos.

### Etapa 6. Exportaciones

Conectar:

- exportación Finnegans JSON/CSV;
- exportación horas por persona JSON/CSV.

Luego decidir si el frontend sigue generando XLSX o si el backend incorpora XLSX nativo.

## Variables de entorno frontend recomendadas

Crear:

```txt
frontend/.env.example
```

Contenido sugerido:

```bash
VITE_API_URL=http://localhost:4002/api
```

Para desarrollo local real:

```txt
frontend/.env
```

No commitear `.env` real.

## Reglas que ya bajaron al backend

- Autenticación JWT.
- Permisos por rol.
- Alcance por legajo.
- Unicidad de `legajo`, `dni`, `cuil`.
- Validación de estructuras relacionales.
- Estado de alta/baja.
- Validación de horas habilitadas por legajo.
- Bloqueo de edición de horas aprobadas/cerradas.
- Aprobación/rechazo de novedades.
- Aprobación/rechazo de carga horaria.
- Auditoría de cambios críticos.
- Exportaciones filtradas por estado.

## Reglas todavía pendientes o mejorables

### Documentos

Hoy se guarda metadata, `storageKey` y el backend acepta `fileBase64` para resolver el archivo mediante la capa de storage configurada.

Falta:

- activar y probar Cloudinary con variables de entorno reales;
- validación de extensión además de MIME;
- política de acceso/descarga a archivos.

### Paginación

Muchos listados usan `take`.

Falta:

- cursor pagination o page/pageSize;
- total count cuando la UI lo necesite;
- orden configurable en listados grandes.

### Refresh token

El backend ya expone renovacion de sesion mediante `POST /api/auth/refresh` y el frontend reintenta automaticamente una vez cuando una request protegida responde `401`.

Falta endurecer para produccion:

- persistir refresh tokens para permitir revocacion por dispositivo;
- rotacion con deteccion de reutilizacion;
- estrategia de logout global por expiracion o cambio de contrasena.

### Puestos

El backend ya cubre CRUD, rango salarial, conteo de legajos asignados y consulta especifica de empleados activos asignados por puesto.

Falta mejorar:

- validaciones backend más profundas de compatibilidad puesto vs estructura/categoría.

### Dashboard

Ya existe backend de métricas agregadas.

Falta mejorar:

- paginación/ventanas temporales configurables para métricas pesadas;
- criterios finales de qué estados cuentan en indicadores ejecutivos.

### Organigrama

El frontend ya alimenta el organigrama desde un endpoint backend optimizado cuando el backend está disponible:

```txt
GET /api/employees/org-chart
```

Este endpoint trae datos reducidos de legajos activos, estructura, puesto, empresas asociadas y asignaciones, sin cargar el detalle completo de cada legajo.

Falta mejorar:

- paginación/infinite loading en frontend si el diagrama crece mucho;
- endpoints auxiliares de filtros/agrupaciones si el organigrama necesita vistas muy pesadas.

## Criterio para decir "listo para conectar frontend"

Módulo listo si cumple:

- endpoints existentes;
- validación backend;
- permisos backend;
- auditoría si aplica;
- respuesta estable;
- build backend OK;
- prueba manual contra Neon OK;
- contrato documentado.

## Estado por módulo

| Módulo | Backend | Listo para conectar frontend |
|---|---:|---:|
| Auth | Sí | Sí |
| Usuarios | Sí | Sí |
| Auditoría | Sí | Sí |
| Parámetros de auditoría | Sí | Sí |
| Categorías salariales | Sí | Sí |
| Empresas y estructura | Sí | Sí |
| Legajos base | Sí | Sí |
| Contacto/Domicilio | Sí | Sí |
| Transporte | Sí | Sí |
| Documentos metadata + storage | Sí | Parcial |
| Horas especiales | Sí | Sí |
| Tipos de novedades | Sí | Sí |
| Novedades operativas | Sí | Sí |
| Carga horaria | Sí | Sí |
| Mis pendientes | Sí | Sí |
| Exportación Finnegans | Sí | Sí |
| Exportación horas | Sí | Sí |
| Puestos | Sí | Sí |
| Dashboard métricas | Sí | Sí |
| Organigrama | Sí | Sí |

## Próximo paso recomendado

La conexión base ya está avanzada. El próximo foco recomendado es cerrar brechas de producción:

1. completar paginación/total count en listados grandes;
2. activar Cloudinary y cerrar política de acceso/descarga de archivos;
3. sumar paginación/infinite loading visual en organigrama si el volumen real lo pide;
4. endurecer validaciones backend que hoy todavía dependen de reglas de UI;
5. sumar pruebas automatizadas mínimas por módulo crítico;
6. persistir/rotar refresh tokens si se requiere control por dispositivo.
