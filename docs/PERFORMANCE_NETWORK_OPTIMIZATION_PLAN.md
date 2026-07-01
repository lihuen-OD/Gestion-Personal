# Performance and Network Optimization Plan

## Objetivo

Este documento define el plan para optimizar la velocidad de la app y reducir el consumo de red antes de subirla a la nube.

La idea no es hacer una mejora aislada. Este plan debe servir como proceso repetible cada vez que se agreguen nuevos modulos, reportes, pantallas o endpoints.

## Problema observado

En desarrollo local se detecto que algunas pantallas tardan entre 7 y 10 segundos en actualizar u obtener informacion.

Los casos mas visibles son:

- Dashboard.
- Legajos.
- Modulos que cargan listados, metricas y catalogos al mismo tiempo.

La causa probable no es una sola. El problema combina:

- base de datos remota;
- latencia de red hacia la base;
- multiples consultas Prisma por endpoint;
- endpoints que devuelven mas datos de los necesarios;
- pantallas que hacen varias requests iniciales;
- listados grandes cargados completos en frontend;
- catalogos repetidos entre modulos;
- falta de cache para datos que no cambian constantemente.

## Contexto tecnico actual

Frontend:

- Vite + React.
- API configurada con `VITE_API_URL`.
- Servicios en `frontend/src/services/api`.
- Varias pantallas cargan datos con `useEffect`.

Backend:

- Express + Prisma.
- Separacion por rutas, controllers, services y repositories.
- Logger de request activo en desarrollo.
- Base configurada por `DATABASE_URL`.

Base de datos:

- PostgreSQL.
- En desarrollo actual se esta usando una base remota.
- Ya existe una migracion de indices de performance, pero debe ampliarse segun medicion real.

## Principio principal

Antes de optimizar a ciegas, medir.

Toda mejora debe responder estas preguntas:

- Que endpoint tarda?
- Cuanto tarda el backend?
- Cuanto tarda cada query?
- Cuanto pesa la respuesta?
- Cuantas requests dispara la pantalla?
- El dato necesita ser en tiempo real o puede cachearse?
- La pantalla necesita todos los campos o solo una vista resumida?

## Metricas objetivo

Estos valores son guias para produccion. Pueden ajustarse segun volumen real.

| Area | Objetivo |
| --- | --- |
| Dashboard caliente | menos de 1.5s |
| Dashboard con cache | menos de 500ms backend |
| Listados paginados | menos de 1s |
| Catalogos cacheados | menos de 300ms o sin request repetida |
| Detalle de entidad | menos de 1.5s |
| Respuestas de tabla | idealmente menos de 200 KB |
| Requests iniciales por pantalla | maximo 3 criticas |
| Endpoints lentos aceptables | solo reportes/exportaciones |

## Fase 1: Diagnostico

### 1.1 Logging por endpoint

Mejorar el logger actual para registrar:

- metodo HTTP;
- path;
- status;
- duracion total;
- usuario o rol si aplica;
- tamano aproximado de respuesta cuando sea razonable;
- marca de endpoint lento cuando supere un umbral.

Umbrales sugeridos:

- `WARN`: mas de 1000ms.
- `SLOW`: mas de 3000ms.

### 1.2 Logging de Prisma

En desarrollo, medir queries lentas.

Registrar:

- modelo o query;
- duracion;
- endpoint asociado si es posible;
- parametros generales sin exponer datos sensibles.

No se deben loguear secretos, tokens ni datos personales innecesarios.

### 1.3 Revision en navegador

En Chrome DevTools, para cada modulo importante revisar:

- cantidad de requests al entrar;
- duracion de cada request;
- tamano transferido;
- si hay requests repetidas;
- si hay endpoints bloqueando todo el render;
- si hay waterfalls evitables.

### 1.4 Resultado esperado de diagnostico

Crear una tabla por modulo:

| Modulo | Requests iniciales | Endpoint mas lento | Peso mayor | Causa probable | Accion |
| --- | ---: | --- | ---: | --- | --- |
| Dashboard | pendiente | pendiente | pendiente | pendiente | pendiente |
| Legajos | pendiente | pendiente | pendiente | pendiente | pendiente |
| Horas | pendiente | pendiente | pendiente | pendiente | pendiente |
| Novedades | pendiente | pendiente | pendiente | pendiente | pendiente |
| Documentos | pendiente | pendiente | pendiente | pendiente | pendiente |

## Fase 2: Quick wins

### 2.1 Cache corto para Dashboard

El endpoint `/dashboard/metrics` calcula informacion agregada que no necesita cambiar cada segundo.

Implementar cache server-side por:

- rol;
- usuario o alcance;
- periodo;
- filtros relevantes.

Duracion inicial sugerida:

- 30 segundos en desarrollo;
- 60 segundos en produccion, salvo que negocio pida otra cosa.

Invalidar o dejar expirar cuando cambien:

- legajos;
- novedades;
- documentos;
- cargas horarias;
- movimientos laborales.

### 2.2 Optimizar consultas del Dashboard

Acciones:

- mover consultas secuenciales restantes al bloque paralelo cuando sea seguro;
- evitar `findMany` grandes para calculos que puedan hacerse con agregaciones;
- revisar campos seleccionados;
- reducir calculos en JS cuando puedan resolverse en base;
- separar metricas criticas de metricas secundarias si una parte es pesada.

### 2.3 Cache de catalogos frontend

Catalogos candidatos:

- empresas;
- unidades de negocio;
- establecimientos;
- areas;
- sectores;
- centros de costo;
- puestos;
- conceptos de hora;
- categorias documentales;
- tipos de novedades.

Regla:

- si un catalogo cambia poco, no debe descargarse de nuevo en cada pantalla.

Opciones:

- cache simple en memoria dentro del servicio;
- `sessionStorage` con version;
- incorporar TanStack Query mas adelante si la app crece.

### 2.4 Evitar cargas completas en listados

Revisar pantallas que usan valores como:

- `take=500`;
- `take=1000`;
- listados completos para calcular tarjetas;
- filtros hechos solo en frontend.

Reemplazar por:

- paginacion real;
- filtros backend;
- endpoint de resumen;
- endpoint de listado liviano.

## Fase 3: Optimizacion por modulo

### Dashboard

Objetivo:

- responder rapido aunque la base este remota;
- evitar recalcular todo en cada navegacion;
- reducir queries y payload.

Acciones:

- cachear `/dashboard/metrics`;
- cachear o limitar actividad reciente;
- revisar indices para documentos, novedades, horas y empleados;
- reemplazar lecturas masivas por agregaciones;
- devolver solo los datos visibles.

### Legajos

Objetivo:

- que el listado no dependa de traer todos los empleados.

Acciones:

- usar paginacion real en la UI;
- enviar `page`, `take`, `search`, `companyId`, `sectorId`, `status`;
- agregar endpoint de resumen para tarjetas;
- mantener endpoint de detalle separado;
- no incluir documentos, novedades o movimientos en el listado si no se muestran.

Endpoints deseados:

```txt
GET /api/employees?page=1&take=25&search=&status=
GET /api/employees/summary
GET /api/employees/:id
```

### Horas

Objetivo:

- evitar traer 1000 cargas para calcular pendientes o contadores.

Acciones:

- endpoint de listado paginado;
- endpoint de resumen por periodo;
- filtros backend por periodo, estado, empleado y concepto;
- indices por periodo, estado y empleado.

Endpoints deseados:

```txt
GET /api/time-entries?page=1&take=25&period=2026-06&status=
GET /api/time-entries/summary?period=2026-06
```

### Novedades

Objetivo:

- reducir busquedas por rangos de fecha y estado.

Acciones:

- paginacion;
- filtros backend por empleado, tipo, estado y periodo;
- endpoint de resumen para pendientes/aprobadas/rechazadas;
- indices para `status`, `employeeId`, `fromDate`, `toDate`, `noveltyTypeId`.

### Documentos

Objetivo:

- evitar transferir documentos y categorias completas si solo se muestran estados.

Acciones:

- endpoint de resumen de vencidos y por vencer;
- listado paginado;
- detalle por empleado o documento;
- no enviar metadata pesada si no se muestra;
- revisar estrategia de archivos en nube.

### Puestos y estructura organizacional

Objetivo:

- no descargar organigramas o estructuras completas si solo se necesita un selector.

Acciones:

- endpoints livianos para selects;
- cache de catalogos;
- endpoint especifico para organigrama;
- paginacion en puestos;
- indices por estado, area, sector y centro de costo.

### Auditoria

Objetivo:

- que la auditoria no sea una carga permanente para pantallas no criticas.

Acciones:

- limitar `take`;
- paginacion real;
- indices por `createdAt`, `entity`, `entityId`, `userId`, `action`;
- cargar auditoria bajo demanda cuando no sea informacion principal.

## Fase 4: Optimizacion de API contracts

Cada modulo debe separar estos tipos de endpoint:

### List endpoint

Para tablas.

Debe devolver:

- solo columnas visibles;
- datos minimos para acciones de fila;
- paginacion;
- filtros;
- ordenamiento cuando aplique.

No debe devolver:

- historial completo;
- documentos completos;
- relaciones pesadas;
- datos no visibles.

### Detail endpoint

Para vista individual.

Puede devolver mas relaciones, pero solo las necesarias para esa pantalla.

### Summary endpoint

Para KPI cards, contadores y alertas.

Debe devolver numeros agregados, no listas completas para que el frontend calcule.

### Catalog endpoint

Para selects y filtros.

Debe:

- ser liviano;
- cachearse;
- tener version o timestamp si mas adelante hace falta invalidacion fina.

## Fase 5: Indices de base de datos

Los indices deben agregarse segun medicion, no por intuicion solamente.

Candidatos iniciales:

```txt
Employee(status)
Employee(sectorId, status)
Employee(costCenterId, status)
Employee(positionId, status)
EmployeeCompany(employeeId)
EmployeeCompany(companyId)
EmployeeAssignment(employeeId, type)
TimeEntry(period, status, employeeId)
TimeEntry(employeeId, period)
Novelty(status, employeeId)
Novelty(fromDate, toDate)
Novelty(noveltyTypeId, status)
EmployeeDocument(status, employeeId)
EmployeeDocument(expirationDate)
LaborMovement(employeeId, type, effectiveFrom)
AuditLog(createdAt)
AuditLog(entity, entityId)
AuditLog(userId, createdAt)
```

Reglas:

- cada indice debe estar justificado por una query real;
- revisar costo de escritura;
- revisar si el indice ya existe;
- crear migracion Prisma;
- validar con mediciones antes/despues.

## Fase 6: Reduccion de Network Transfer

### Reglas para payloads

Cada respuesta debe cumplir:

- no enviar campos que la pantalla no usa;
- no enviar relaciones completas si alcanza con `id` y `name`;
- no enviar listas internas grandes en endpoints de listado;
- no repetir datos estaticos en cada fila si pueden venir de catalogo;
- no enviar blobs ni archivos por JSON;
- no mezclar detalle con listado.

### Presupuesto de transferencia

Valores guia:

| Tipo de respuesta | Objetivo |
| --- | ---: |
| Catalogo simple | menos de 50 KB |
| Listado paginado | menos de 200 KB |
| Dashboard metrics | menos de 100 KB |
| Detalle de legajo | menos de 300 KB |
| Reporte/exportacion | puede superar, pero debe ser accion explicita |

### Compresion

En produccion:

- habilitar gzip o brotli en proxy/plataforma;
- confirmar que JSON se comprime;
- evitar respuestas enormes aunque haya compresion.

## Fase 7: Estrategia para nube

Al subir a produccion, revisar:

- region del backend;
- region de la base de datos;
- latencia entre backend y DB;
- connection pooling;
- autosuspend/cold start de la base;
- limites del proveedor;
- compresion HTTP;
- cache headers para assets;
- CDN para frontend;
- almacenamiento externo para archivos;
- monitoreo de endpoints lentos.

Regla importante:

El backend y la base deben estar lo mas cerca posible. La latencia usuario-frontend importa, pero la latencia backend-base impacta en cada query.

## Fase 8: UX de carga

Aunque el backend mejore, la app debe sentirse rapida.

Implementar:

- skeletons por seccion;
- render parcial cuando una parte ya cargo;
- mantener datos anteriores mientras refresca;
- estados de error claros;
- botones deshabilitados durante acciones;
- evitar pantallas totalmente vacias mientras se carga una metrica secundaria.

## Checklist para cada nueva funcionalidad

Antes de agregar una pantalla o modulo:

- Define si necesita listado, detalle, resumen y catalogos separados.
- Define filtros backend desde el inicio.
- Define paginacion si puede crecer.
- Define campos exactos que la UI necesita.
- Revisa si reutiliza catalogos existentes.
- Revisa si necesita indices.
- Revisa si necesita cache.
- Revisa si afecta dashboard o contadores globales.
- Revisa si genera auditoria.
- Mide el payload en Network.
- Mide el endpoint en backend.

No aceptar una nueva pantalla si:

- trae todos los registros sin paginar;
- calcula KPIs desde listas completas en frontend;
- descarga relaciones que no muestra;
- duplica requests de catalogos;
- bloquea todo el render por datos secundarios.

## Checklist antes de deploy

- Medir endpoints principales en ambiente similar a produccion.
- Revisar Network Transfer de cada modulo.
- Revisar bundle frontend.
- Confirmar compresion.
- Confirmar cache de assets.
- Confirmar region backend/base.
- Confirmar connection pooling.
- Ejecutar migraciones de indices.
- Verificar que logs no exponen secretos.
- Revisar endpoints lentos con datos reales.
- Confirmar que exportaciones/reportes pesados no bloquean requests normales.

## Orden recomendado de trabajo

### Etapa A: Diagnostico y medicion

1. Mejorar logger backend.
2. Medir Prisma queries lentas.
3. Medir Network en frontend.
4. Documentar top endpoints lentos.

### Etapa B: Quick wins

1. Cache corto de dashboard.
2. Cache de catalogos frontend.
3. Reducir payloads evidentes.
4. Evitar requests duplicadas.

### Etapa C: Modulos principales

1. Dashboard.
2. Legajos.
3. Horas.
4. Novedades.
5. Documentos.
6. Puestos y estructura.
7. Auditoria.

### Etapa D: Preparacion nube

1. Region y proveedor.
2. Pooling.
3. Compresion.
4. Observabilidad.
5. Pruebas con datos reales.

## Registro de implementacion

### 2026-06-30: Etapa inicial

Implementado:

- Logger backend mejorado para mostrar duracion total, cantidad de queries Prisma, tiempo acumulado de queries y tamano aproximado de respuesta.
- Deteccion de requests lentos con niveles `INFO`, `WARN` y `SLOW`.
- Deteccion de queries Prisma lentas en desarrollo mediante `SLOW_QUERY`.
- Cache TTL server-side para `/dashboard/metrics`, segmentado por usuario, rol, alcance y periodo.
- Optimizacion inicial de dashboard para ejecutar la consulta de transporte en paralelo con el resto de metricas.
- Cache frontend en memoria para catalogo de estructura organizacional.
- Cache frontend por query para puestos, conceptos de hora, tipos de novedad y categorias documentales.
- Invalidacion local de caches de catalogos cuando se crean o actualizan registros desde los servicios correspondientes.

Pendiente para la siguiente etapa:

- Medir tiempos reales con el backend corriendo y navegar modulos principales.
- Registrar tabla de endpoints lentos por modulo.
- Crear endpoints `summary` para listados que hoy calculan KPIs desde datos completos.
- Aplicar paginacion real en pantallas que usan `take=500`, `take=1000` o cargas completas.
- Revisar indices de base con medicion real.
- Evaluar region/proveedor final para produccion.

### 2026-06-30: Optimizacion inicial de Legajos

Implementado:

- Endpoint `GET /api/employees/summary` para KPIs de Legajos.
- Resumen calculado en backend con conteos agregados y respetando alcance del usuario.
- `EmployeesPage` consume `/employees/summary` para tarjetas.
- `EmployeesPage` consume `/employees?page=&take=&search=&companyId=` para la tabla.
- Se elimino de Legajos la request a `/time-entries?take=1000` usada solo para calcular cargas pendientes.
- Se redujo el listado inicial de Legajos de `take=500` a paginas de 25 registros.
- El filtro de empresa ahora envia `companyId` al backend cuando el valor existe en el catalogo.

Impacto esperado:

- Menos transferencia inicial en Legajos.
- Menos consultas y payload innecesario de cargas horarias.
- Tabla preparada para crecer sin descargar toda la base de empleados.

Pendiente:

- Agregar debounce a busqueda si el volumen de usuarios o latencia lo requiere.
- Crear summaries equivalentes en Horas, Novedades y Documentos.
- Revisar indices especificos con medicion real sobre `/employees/summary` y `/employees`.

### 2026-06-30: Optimizacion inicial de Horas, Novedades y Documentos

Implementado:

- Endpoint `GET /api/time-entries/summary?period=YYYY-MM` para KPIs de carga horaria.
- `HoursPage` consume summary de backend para personas activas, pendientes, en revision y horas contables.
- Summary de Horas se calcula con agregaciones/conteos en backend y respeta alcance por rol.
- `DocumentsPage` dejo de pedir todos los legajos al cargar la tabla.
- `documentApiService` mapea datos minimos del empleado incluidos en `/documents`.
- `DocumentsPage` carga legajos bajo demanda solo al abrir el modal de subida.
- `NoveltiesPage` dejo de pedir todos los legajos al cargar la tabla.
- `noveltyApiService` mapea datos minimos del empleado incluidos en `/novelties`.
- `NoveltiesPage` carga legajos bajo demanda solo al abrir el modal de creacion.
- Se redujo el `take` por defecto de documentos y novedades operativas a 100 para evitar payloads grandes en el primer render.

Impacto esperado:

- Menos requests iniciales en Documentos y Novedades.
- Menos transferencia de legajos completos en pantallas que solo necesitan legajo/nombre.
- KPIs de Horas desacoplados de la descarga de cargas horarias completas.

Pendiente:

- Agregar paginadores visibles en Documentos y Novedades.
- Reducir `HoursPage` a una tabla realmente paginada por backend, manteniendo exportacion como accion explicita.
- Crear summaries especificos de Documentos y Novedades si se agregan KPI cards.
- Evaluar indices adicionales para `/time-entries/summary` con datos reales.

### 2026-06-30: Paginacion visible en Documentos y Novedades

Implementado:

- `documentApiService.list()` consume `data + meta` desde `/documents`.
- `DocumentsPage` usa paginacion backend con paginas de 25 registros.
- `noveltyApiService.list()` consume `data + meta` desde `/novelties`.
- `NoveltiesPage` usa paginacion backend con paginas de 25 registros.
- `getAll()` se mantiene como compatibilidad para componentes existentes, pero las pantallas principales ya usan `list()`.

Impacto esperado:

- Menos payload inicial en Documentos y Novedades.
- Mejor comportamiento cuando crezcan los registros historicos.
- Base preparada para sumar filtros backend visibles sin cambiar contratos.

Pendiente:

- Agregar filtros visibles de busqueda/estado/periodo en Novedades.
- Agregar filtros visibles de busqueda/estado/categoria en Documentos.
- Revisar `HoursPage` para convertir tambien la tabla principal a paginacion backend real.

### 2026-06-30: Paginacion backend real en tabla principal de Horas

Implementado:

- Endpoint `GET /api/time-entries/period-employees`.
- Tabla principal de `HoursPage` consume filas paginadas de 25 empleados.
- El backend calcula total de horas y estado del periodo solo para los empleados visibles.
- Busqueda y filtro por centro de costo se envian al backend.
- Centros de costo se toman del catalogo organizacional cacheado.
- Exportacion de horas queda como accion explicita contra backend, sin depender de tener todas las filas cargadas en pantalla.

Impacto esperado:

- La pantalla de Horas deja de descargar todos los legajos y todas las cargas del periodo para renderizar la tabla principal.
- Menor transferencia inicial y menos memoria usada en frontend.
- Mejor escalabilidad cuando crezcan los registros historicos de carga horaria.

Pendiente:

- Optimizar la bandeja de revision de Horas, que todavia necesita registros concretos para aprobar/rechazar.
- Agregar debounce a busqueda de Horas para evitar una request por tecla.
- Evaluar indices para `TimeEntry(period, employeeId, status)` y `Employee(costCenterId, status)` con medicion real.

### 2026-06-30: Optimizacion de bandeja de revision de Horas

Implementado:

- `timeEntryApiService.list()` consume `data + meta` desde `/time-entries`.
- `TimeEntry` ahora conserva `employeeLegajo` y `employeeName` cuando el backend los incluye.
- `/api/time-entries` acepta `search` y `costCenterId` para filtrar por datos del empleado.
- La bandeja de revision de `HoursPage` pide solo `status=EN_REVISION` con paginas de 25 registros.
- La tabla de revision muestra legajo/persona desde cada registro, sin pedir todos los legajos.
- Los filtros de periodo, busqueda y centro de costo se resuelven en backend.

Impacto esperado:

- Menos transferencia en `/horas/pendientes`.
- Menor cantidad de registros de carga horaria en memoria.
- La bandeja de revision escala mejor cuando hay historico grande de cargas.

Pendiente:

- Agregar debounce compartido para busquedas en Legajos/Horas/Novedades/Documentos.
- Revisar indices con mediciones reales de `SLOW_QUERY`.
- Corregir errores TypeScript preexistentes para recuperar build frontend confiable.

### 2026-06-30: Recuperacion de build frontend

Implementado:

- Correccion de tipos en historiales de campos y bloques de legajo.
- Correccion de tipo de `section` en historial laboral trackeado.
- Correccion de nullability en detalle de legajo.
- Restauracion del estado `usesBackend` en Organigramas.
- Inicializacion completa de filtros en Puestos.

Resultado:

- `frontend`: `npm run build` pasa correctamente.
- `backend`: `npm run typecheck` pasa correctamente.
- `git diff --check` pasa correctamente.

Impacto esperado:

- El build vuelve a ser una señal confiable antes de seguir optimizando.
- Las proximas mejoras pueden validarse con mayor seguridad.

### 2026-07-01: Debounce de busquedas backend

Implementado:

- Hook reutilizable `useDebouncedValue`.
- Debounce de busqueda en Legajos.
- Debounce de busqueda en Horas, aplicado a tabla principal y bandeja de revision.
- Busqueda visible y debounced en Documentos.
- Busqueda visible y debounced en Novedades.
- Busqueda de Novedades extendida para contemplar CUIL ademas de legajo, DNI, nombre, apellido y tipo.

Impacto esperado:

- Menos requests por tipeo.
- Menos ruido en logs de medicion.
- Mejor base para detectar endpoints realmente lentos y no requests intermedias descartables.

Pendiente:

- Levantar la app y registrar mediciones reales por modulo con los logs nuevos.
- Definir indices a partir de `SLOW_QUERY`.

## Definicion de terminado

Una optimizacion se considera terminada cuando:

- se midio antes;
- se implemento la mejora;
- se midio despues;
- se redujo tiempo, payload o cantidad de requests;
- no se rompio contrato frontend/backend;
- se agregaron indices o cache solo con justificacion;
- quedo documentado si hay una decision tecnica relevante.

## Notas para futuras iteraciones

Cuando se agreguen nuevas funciones, este documento debe revisarse de nuevo.

Si un modulo empieza simple pero puede crecer, conviene dejar desde el inicio:

- paginacion;
- filtros backend;
- endpoints separados;
- payload minimo;
- opcion de cache;
- indices pensados para busqueda y reportes.

Esto evita tener que rehacer el modulo completo cuando la app tenga mas datos o usuarios.
