# Etapa 15D.2 — Política de upload por módulo/propósito

## 1. Contexto

La Etapa 15D.1 (`docs/decisions/STORAGE_PROVIDER_REGISTRY_15D1.md`) resolvió
la lectura/eliminación de archivos **existentes** por su
`StorageFile.storageProvider` persistido, pero dejó explícitamente sin
tocar el upload: un archivo nuevo seguía subiéndose siempre al provider
global único (`STORAGE_PROVIDER`). Decisión de producto para esta subetapa:
por ahora, fotos/evidencia de fichada deben subirse a Google Drive y los
documentos deben poder subirse a Cloudinary — con la posibilidad, más
adelante, de migrar fichadas/fotos a Cloudinary sin romper nada (eso ya
queda cubierto por 15D.1: cualquier archivo, viejo o nuevo, siempre se
lee/borra por su propio `storageProvider` persistido).

## 2. Problema a resolver

`uploadManaged` (el único punto de upload gestionado, con `StorageFile`)
sólo conocía un provider: `provider()`, que lee `STORAGE_PROVIDER`. No había
forma de que un documento y una foto de fichada terminaran en providers
distintos sin cambiar `STORAGE_PROVIDER` globalmente (lo cual movería
*todos* los uploads nuevos, no sólo uno de los dos tipos).

## 3. Decisión técnica

Se agregó una política interna en `shared/storage/storage.service.ts` que
resuelve el provider de un upload nuevo por el campo **`module`** de
`ManagedStorageObjectInput` (`StorageModule`: `FICHADAS`, `LEGAJOS`,
`NOVEDADES`, `TRANSPORTE`, `AUDITORIA`, `DOCUMENTACION_GENERAL`) — no por
`purpose` (que ya existe en el input pero es opcional y hoy sólo gobierna
validación de MIME/tamaño). `module` es obligatorio, ya es el campo
estructural que clasifica a qué dominio de negocio pertenece el archivo, y
ya distingue exactamente los dos casos de esta etapa en los dos únicos
llamadores reales de `uploadManaged` hoy: `employees.service.ts`
(`createDocument`, `module: "LEGAJOS"`) y `timeEntries.service.ts`
(foto/miniatura de fichada, `module: "FICHADAS"`).

Mapeo módulo → variable de entorno:

- `FICHADAS` → `PUNCH_PHOTO_STORAGE_PROVIDER`
- `LEGAJOS` / `DOCUMENTACION_GENERAL` → `DOCUMENT_STORAGE_PROVIDER`
- cualquier otro módulo (`NOVEDADES`, `TRANSPORTE`, `AUDITORIA` — ninguno
  usado hoy por un caller real) → sin variable específica

Cadena de resolución (`uploadProviderFor` en `storage.service.ts`):

```txt
variable específica del módulo → DEFAULT_STORAGE_PROVIDER → STORAGE_PROVIDER
```

Las tres variables nuevas (`DEFAULT_STORAGE_PROVIDER`,
`DOCUMENT_STORAGE_PROVIDER`, `PUNCH_PHOTO_STORAGE_PROVIDER`) son
**opcionales, sin valor por defecto** en `env.ts` — si ninguna está
configurada, la cadena cae siempre en `STORAGE_PROVIDER`, exactamente el
comportamiento de antes de esta etapa. Esto no requiere ningún cambio en
`.env` existentes.

Efecto secundario corregido en el mismo cambio: la compensación de
`uploadManaged` ante un fallo posterior al upload (si
`storageFilesRepository.create` falla) borraba con `provider()` (el
provider global). Desde que el upload puede resolver un provider distinto
al global según `module`, compensar con `provider()` habría podido borrar
con el provider equivocado y dejar el archivo huérfano en el provider real.
Se corrigió para compensar siempre con el mismo objeto provider que recibió
el upload (`selectedProvider`), sin necesidad de volver a resolverlo.

## 4. Qué cambió

- **`backend/src/config/env.ts`**: tres variables nuevas, opcionales, sin
  default — `DEFAULT_STORAGE_PROVIDER`, `DOCUMENT_STORAGE_PROVIDER`,
  `PUNCH_PHOTO_STORAGE_PROVIDER`.
- **`backend/src/shared/storage/storage.service.ts`**:
  - `providerByEnvName(name)` — helper compartido que mapea un nombre de
    provider (`"local"|"cloudinary"|"google_drive"`) al adaptador; usado
    tanto por `provider()` (global, sin cambios de comportamiento) como por
    la política nueva.
  - `uploadProviderFor(module)` — resuelve el provider de un upload nuevo
    según la cadena descripta arriba.
  - `uploadManaged` usa `uploadProviderFor(input.module)` en vez de
    `provider()`, y compensa con ese mismo provider ante un fallo.
- **`backend/.env.example`**: variables nuevas documentadas, vacías por
  defecto (mismo criterio que `STORAGE_PROVIDER=local` para desarrollo).
- **`docs/BACKEND_API_CONTRACTS.md`** / **`docs/LOCAL_DEVELOPMENT.md`**: nota
  actualizada sobre qué decide el provider de un documento nuevo.

Ningún caller cambió: `employees.service.ts` y `timeEntries.service.ts` ya
pasaban `module` correctamente a `uploadManaged` desde antes de esta etapa
— la resolución de provider es enteramente interna a
`shared/storage/storage.service.ts`.

## 5. Qué NO cambió

- La lectura/eliminación de un archivo **existente** sigue resolviendo
  exclusivamente por `StorageFile.storageProvider` persistido (15D.1) — las
  variables nuevas de esta etapa no participan ahí en absoluto.
- `storageService.upload()` (el método plano/no gestionado, sin `module`)
  sigue usando `provider()` — no tiene la información necesaria para
  participar en la política por módulo, y hoy no tiene ningún llamador real
  fuera de `uploadManaged`.
- Cloudinary sigue en modo público (`resource_type=auto`, sin
  `private`/`authenticated`, sin signed URLs, sin proxy definitivo) — 15D.3.
- `DocumentCategory.viewRoles`/`uploadRoles` — no existen todavía — 15D.4.
- Ningún archivo existente se migró ni se movió de provider.
- Prisma schema, migraciones, DB, seed.
- Carga Horaria, Cierres, RBAC general, Usuarios, Login, Novedades,
  Conceptos horarios, Horas especiales.
- Flujo funcional del fichador (token de dispositivo, endpoint público,
  captura de foto) — sólo cambió qué provider recibe la foto/miniatura ya
  capturada.
- Flujo funcional de documentos — sólo cambió qué provider recibe el
  archivo ya validado.
- Frontend, UI, UX.

## 6. Compatibilidad

Con `DEFAULT_STORAGE_PROVIDER` / `DOCUMENT_STORAGE_PROVIDER` /
`PUNCH_PHOTO_STORAGE_PROVIDER` sin configurar (el estado de cualquier `.env`
existente antes de esta etapa), `uploadProviderFor(module)` resuelve
siempre a `STORAGE_PROVIDER` para cualquier `module` — comportamiento
idéntico, byte a byte, al de antes de 15D.2. Configurar sólo una de las tres
variables no afecta a los módulos que no matchean su regla.

## 7. Riesgo residual

- **Cloudinary** sigue pendiente de hardening (`private`/`authenticated`,
  signed URLs, proxy definitivo) — 15D.3.
- **`DocumentCategory.viewRoles`/`uploadRoles`** siguen sin implementarse —
  15D.4.
- Si en el futuro se agrega un caller de `uploadManaged` con `module`
  `NOVEDADES`/`TRANSPORTE`/`AUDITORIA`, hoy cae en
  `DEFAULT_STORAGE_PROVIDER`/`STORAGE_PROVIDER` sin una variable propia —
  aceptable porque ningún caller real usa esos módulos todavía; se puede
  agregar una variable específica cuando exista un caller real, sin volver
  a tocar la lógica de resolución.

## 8. Validaciones

Backend:

```txt
npx prisma validate   → OK
npm run typecheck     → OK
npm test              → 102 archivos / 1447 tests OK (1441 previos de 15D.1 + 6 nuevos de esta etapa)
npm run build         → OK
```

Frontend: no se tocó, no se corrió (no era necesario).
