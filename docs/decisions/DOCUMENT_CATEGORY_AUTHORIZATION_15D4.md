# Etapa 15D.4 — Autorización documental por categoría

## 1. Contexto 15D

La serie 15D (auditoría/diseño de storage) dejó pendiente un hallazgo
orthogonal al provider: `DocumentCategory.viewRoles`/`uploadRoles` existen
en el modelo (`Json`, poblados desde la UI de configuración de categorías
documentales) pero el backend nunca los leía para autorizar nada — listado,
descarga y carga de documentos resolvían sólo por rol general y por alcance
de empleado (`employeeAccessWhere`), ignorando por completo la
configuración por categoría. 15D.4 cierra ese hallazgo, sin tocar storage
provider ni Cloudinary (ya cerrados en 15D.1/15D.2/15D.3).

## 2. Problema detectado

- `documents.service.ts` bloqueaba a Nivel 3 (Carga Horaria) de **toda**
  `/api/documents` con un chequeo de rol plano
  (`assertCanAccessDocuments`), documentado como decisión deliberada de PII
  en `docs/SECURITY_STANDARDS.md`/`docs/PROJECT_CONTEXT.md`. Supervisión
  pasaba ese chequeo, pero después nada más se filtraba por categoría —
  veía/descargaba cualquier documento de cualquier categoría, dentro de su
  alcance de empleado.
- `POST /api/employees/:id/documents` (carga de documentos) era
  **exclusivamente RRHH** a nivel de ruta — ni Supervisión ni Nivel 3 podían
  subir un documento, sin importar la categoría.
- `employees.service.ts` `createDocument` no validaba que `categoryId`
  correspondiera a una categoría real: si no existía, el archivo se subía
  igual al storage y recién fallaba después, al crear el registro en DB por
  violación de la FK — dejando un archivo huérfano en el provider.
- `viewRoles`/`uploadRoles`/`approvalRoles` se persisten como las
  **etiquetas en español** del rol (`"Nivel 1 - RRHH"`, no
  `"NIVEL_1_RRHH"`) — el mismo patrón ya usado por `NoveltyType` en
  `modules/novelties/novelties.service.ts`, que nunca se conectó para
  `DocumentCategory`.

## 3. Decisión de negocio

- **RRHH (`NIVEL_1_RRHH`) es superadmin documental**: ve, lista, descarga,
  sube y (si existiera un flujo real) aprobaría cualquier documento de
  cualquier categoría, sin excepción. Nunca queda bloqueado por
  `viewRoles`/`uploadRoles`.
- **Supervisión (`NIVEL_2_SUPERVISION`) y Nivel 3 (`NIVEL_3_CARGA_HORARIA`)
  se tratan de forma simétrica**: necesitan (a) que el empleado/documento
  esté dentro de su alcance (`employeeAccessWhere`) **y** (b) que la
  categoría liste explícitamente su rol en `viewRoles` (para
  ver/listar/descargar) o `uploadRoles` (para subir). Ambas condiciones son
  obligatorias — ninguna sustituye a la otra.
- **Decisión explícita sobre Nivel 3** (confirmada con el usuario antes de
  implementar, dado que contradecía un bloqueo total preexistente y
  documentado): se reemplaza el bloqueo blanket de `/api/documents` por el
  control granular por categoría, igual que Supervisión — no se lo
  mantiene bloqueado por completo. Como `viewRoles`/`uploadRoles` **default
  a `["Nivel 1 - RRHH"]`** al crear una categoría nueva (ver
  `documentCategories.schemas.ts`), el efecto práctico para cualquier
  categoría que RRHH no haya configurado explícitamente para Nivel 3 sigue
  siendo "sin acceso" — el cambio es arquitectural (el control real pasa a
  ser la configuración por categoría, no un `if (role === cargaHoraria)`
  hardcodeado), no una apertura masiva de PII documental.

## 4. Semántica de `viewRoles`/`uploadRoles`/`approvalRoles` vacíos o `null`

Implementada en `canAccessDocumentCategory`
(`backend/src/shared/security/documentCategoryAccess.ts`), pura y testeada
en aislamiento:

- **RRHH**: siempre `true`, sin mirar la categoría.
- **Categoría ausente (`null`/`undefined`)**: `false` para cualquier otro
  rol. En la práctica `EmployeeDocument.categoryId` es una FK obligatoria
  (nunca `null` en un documento ya persistido) — esta rama es una
  salvaguarda defensiva, no un caso alcanzable hoy con datos reales.
- **Array vacío / `null` / valor no-array**: se normaliza a `[]` vía
  `asStringArray`, y `[].includes(...)` es siempre `false` — mismo
  resultado que "sólo RRHH", sin necesitar un caso especial.
- **Rol desconocido** (no está en la tabla de tres roles): nunca matchea
  ninguna etiqueta persistida — deniega por defecto sin caso especial.

No se inventaron permisos amplios para ningún caso límite.

## 5. Qué cambió en listado/descarga/upload

### Listado (`GET /api/documents`) y descarga (`GET /api/documents/:id/download`)

- Se agregó `documentCategoryViewWhere(user.role)` — un fragmento de
  `where` de Prisma (RRHH: `{}`; Supervisión/Nivel 3:
  `{ category: { viewRoles: { array_contains: "<etiqueta>" } } }`; rol
  desconocido: sentinela que nunca matchea, mismo patrón que
  `employeeAccessWhere` usa para roles no reconocidos).
- Se compone junto a `employeeAccessWhere` vía `AND: [...]` en
  `documents.repository.ts` (nunca por spread plano — evita que una clave
  del sentinela pise o sea pisada por otro filtro con el mismo nombre, p.
  ej. `categoryId`).
- El filtro corre **en la query**, no en memoria después de traer la
  página — así la paginación (`meta.total`/`hasMore`) queda correcta, y
  "descarga por ID directo" nunca revela metadata de un documento fuera de
  alcance: si `category.viewRoles` no incluye el rol, la query no lo
  encuentra y el caller ve el mismo `404 DOCUMENT_NOT_FOUND` que un
  documento inexistente — nunca distingue "existe pero no tenés permiso"
  de "no existe".
- Se eliminó `assertCanAccessDocuments` (el bloqueo blanket de Nivel 3) —
  reemplazado por lo anterior. Las rutas `GET /` y `GET /:id/download` ahora
  aceptan `NIVEL_1_RRHH`/`NIVEL_2_SUPERVISION`/`NIVEL_3_CARGA_HORARIA`
  (antes sólo los primeros dos).

### Upload (`POST /api/employees/:id/documents`)

- La ruta ahora acepta los tres roles operativos (antes sólo RRHH); la
  autorización real se resuelve en `employeesService.createDocument`.
- Orden seguro (ver §6).

## 6. Orden seguro de upload

`employeesService.createDocument(id, input, user, audit?)` (agregó el
parámetro `user`, antes sólo tomaba `audit?`):

1. Busca la categoría por `input.categoryId`. Si no existe →
   `404 DOCUMENT_CATEGORY_NOT_FOUND`.
2. `canAccessDocumentCategory({ userRole: user.role, category, action: "upload" })`.
   Si no autoriza → `403 DOCUMENT_UPLOAD_FORBIDDEN`.
3. `employeesService.getById(id, user)` — aplica `employeeAccessWhere(user)`;
   si el empleado no está en el alcance del usuario → `404 EMPLOYEE_NOT_FOUND`
   (mismo mecanismo ya usado por otros endpoints de legajo, reutilizado sin
   cambios).
4. Recién acá se sube el archivo al storage (`storageService.uploadManaged`).
5. Se crea el registro `EmployeeDocument`.

Los pasos 1-3 nunca tocan storage — una categoría inexistente, no
autorizada, o un empleado fuera de alcance, cortan antes de que exista
ningún archivo subido. No hace falta ninguna compensación/borrado nueva
porque no hay nada que borrar en esos casos.

## 7. Qué no cambió

- Storage provider registry (15D.1), política de upload por módulo (15D.2)
  y delivery seguro de Cloudinary (15D.3) — sin tocar; `uploadManaged`
  sigue recibiendo `module`/`purpose` exactamente igual, la resolución de
  provider es independiente de esta etapa.
- Prisma schema — sin cambios. `viewRoles`/`uploadRoles`/`approvalRoles` ya
  existían como `Json`.
- Sin migraciones, sin tocar DB, sin seed.
- Login, Usuarios, RBAC general fuera de documentos, Carga Horaria,
  Cierres, Novedades, Conceptos horarios, Horas especiales, Fichador — sin
  tocar.
- Frontend: sin cambios. La seguridad real queda del lado del backend; ver
  riesgo residual (§9) sobre un gap de UI preexistente que esta etapa no
  amplía.
- `approvalRoles`: el helper lo soporta (`action: "approval"`) por
  completitud del modelo, pero no se conectó a ningún endpoint — no existe
  ningún flujo de aprobación documental real en el backend (no hay
  `POST /documents/:id/approve` ni equivalente). No se inventó uno en esta
  etapa, según lo pedido.
- Auditoría: sin cambios — `download` seguía (y sigue) auditando `EXPORT`;
  `createDocument` seguía (y sigue) auditando `CREATE`. `list` no auditaba
  antes y sigue sin auditar.

## 8. Tests agregados

- `shared/security/documentCategoryAccess.test.ts` (nuevo, 11 tests): el
  helper puro — RRHH superadmin, Supervisión/Nivel 3 simétricos,
  vacío/null/categoría ausente/rol desconocido, tolerancia a JSON corrupto,
  y `documentCategoryViewWhere` para los 4 casos de rol.
- `modules/documents/documents.service.test.ts`: reemplaza el describe de
  "permisos Nivel 3" (que probaba el bloqueo total, ahora inexistente) por
  uno que prueba el `where` compuesto real para RRHH/Supervisión/Nivel 3 en
  `list`/`download`, y que la descarga fuera de alcance/categoría responde
  `404 DOCUMENT_NOT_FOUND` (nunca revela existencia).
- `modules/documents/documents.repository.test.ts`: ajustado a la
  composición `AND` del `where` (antes plano); agrega 2 tests nuevos que
  confirman que `categoryViewWhere` viaja en `findMany`/`findById`.
- `modules/employees/employees.documents.test.ts`: 6 tests nuevos —
  categoría inexistente (404, sin tocar storage), Supervisión sin permiso
  (403, sin tocar storage ni chequear alcance), Supervisión y Nivel 3 con
  permiso y alcance (suben correctamente), permiso OK pero empleado fuera
  de alcance (404, sin tocar storage), RRHH sube aunque `uploadRoles` no lo
  liste.
- Se corrigieron los call-sites existentes (`documents.repository.test.ts`,
  `employees.documents.test.ts`) para las nuevas firmas
  (`findMany`/`findById` con tercer argumento; `createDocument` con `user`).

## 9. Riesgo residual

- **Gap de UI preexistente, no ampliado por esta etapa**: `EmployeeDetailPage.tsx`
  (frontend) sólo permite llegar al legajo a Nivel 1 y Nivel 2
  (`allowedLevels={[1, 2]}`) — Nivel 3 no puede llegar a la pestaña
  "Gestión Documental" hoy, con o sin este cambio. `EmployeeDocumentsPanel.tsx`
  no oculta el botón "Subir documento" según rol/categoría — antes de esta
  etapa, un click de Supervisión siempre fallaba con 403 (ruta RRHH-only);
  después de esta etapa, puede tener éxito si la categoría y el alcance lo
  permiten, o fallar con un 403/404 legible si no. No es una regresión de
  seguridad (el backend es la autoridad real), pero es una superficie de UX
  mejorable — queda documentado como pendiente, no como blocker.
- **`approvalRoles`** sigue sin flujo de aprobación documental real
  conectado — pendiente de una etapa futura si el negocio lo pide.
- **`DocumentsPage.tsx`** (pantalla general de "Gestión Documental") sigue
  restringida a Nivel 1 únicamente en el frontend — más restrictiva que el
  backend ahora, lo cual es aceptable según el criterio de la etapa
  ("la UI puede quedar más restrictiva, nunca menos").
- Categorías ya existentes en producción con `uploadRoles`/`viewRoles` que
  nunca se revisaron seguirán con su default `["Nivel 1 - RRHH"]` (o lo que
  RRHH haya configurado) — este cambio no migra ni reinterpreta datos
  existentes, sólo empieza a *aplicarlos*.

## 10. Validaciones

Backend:

```txt
npx prisma validate   → OK
npm run typecheck     → OK
npm test              → 104 archivos / 1482 tests OK (1463 previos de 15D.1/15D.2/15D.3 + 19 nuevos de esta etapa)
npm run build         → OK
```

Frontend: no se tocó, no se corrió (no era necesario — ver §9 sobre el gap
de UI documentado, deliberadamente no resuelto en esta etapa).

General: `git diff --check` sin errores.
