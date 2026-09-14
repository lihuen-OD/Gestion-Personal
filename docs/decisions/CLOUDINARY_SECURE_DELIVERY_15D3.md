# Etapa 15D.3 — Cloudinary seguro para documentos

## 1. Contexto 15D / 15D.1 / 15D.2

- 15D (auditoría/diseño read-only) confirmó que `StorageFile` ya persiste
  `storageProvider` por archivo, pero las operaciones no lo usaban.
- 15D.1 (`docs/decisions/STORAGE_PROVIDER_REGISTRY_15D1.md`) hizo que
  download/delete/getPublicUrl de un archivo **existente** resuelvan por
  `StorageFile.storageProvider` persistido, no por el provider global.
- 15D.2 (`docs/decisions/STORAGE_UPLOAD_POLICY_15D2.md`) hizo que un upload
  **nuevo** elija provider por módulo/propósito
  (`DOCUMENT_STORAGE_PROVIDER`/`PUNCH_PHOTO_STORAGE_PROVIDER`, con fallback a
  `DEFAULT_STORAGE_PROVIDER`/`STORAGE_PROVIDER`).
- Decisión de producto vigente: documentos suben a Cloudinary, fichadas/fotos
  suben a Google Drive por ahora, con la intención de poder migrar fichadas
  a Cloudinary más adelante sin romper nada — eso último ya lo garantiza
  15D.1 (cualquier archivo, viejo o nuevo, se opera por su propio
  `storageProvider` persistido).

Lo que 15D.1/15D.2 no resolvieron: aunque el provider correcto ya se elige
bien, el provider **Cloudinary en sí** entregaba una URL pública permanente
como mecanismo de acceso — ese es el problema que cierra esta subetapa.

## 2. Problema detectado

Auditoría del `cloudinaryStorage.provider.ts` anterior a 15D.3:

- **Upload**: `POST /auto/upload` sin `type` — Cloudinary asume delivery
  `upload` (público) por default. La única metadata persistida era
  `storageKey` (= `public_id`) y `publicUrl` (= `secure_url`); **nunca**
  `resource_type`, `asset_id`, `version`, `format` ni el `type` real.
- **Download**: construía `https://res.cloudinary.com/<cloud>/raw/upload/<key>`
  hardcodeado — asumía siempre `resource_type=raw`, aunque el upload usaba
  `resource_type=auto` (Cloudinary clasifica cada archivo según su
  contenido real: un PDF queda como `image`, un `.xlsx` como `raw`). Un PDF
  real fallaría con esta URL.
- **Delete**: `POST /image/destroy` hardcodeado — asumía siempre
  `resource_type=image`, inconsistente con lo que asumía `download` (`raw`)
  y potencialmente incorrecto para cualquier archivo que no sea imagen.
- **El hallazgo de seguridad real**: `getPublicUrl()` devolvía esa URL
  pública permanente, y los tres llamadores (`documents.service.ts`,
  `modules/storage/storage.service.ts`, `timeEntries.service.ts` →
  `attendancePunchPhoto`) usan el mismo patrón — *"si hay `publicUrl`,
  devolvé `{ kind: "redirect", url: publicUrl }` al cliente"*. Eso significa
  que una request autenticada a `GET /api/documents/:id/download` terminaba
  con un **302 hacia una URL de Cloudinary sin expiración y sin
  autenticación propia** — una vez que el navegador la recibe, puede
  guardarse, compartirse o reutilizarse indefinidamente sin volver a pasar
  por el backend. Ese es el "documento sensible expuesto por URL pública
  permanente" del hallazgo 15D.

## 3. Decisión técnica

**Fix de fondo (garantizado, sin ambigüedad): `cloudinaryStorageProvider.getPublicUrl()`
ahora devuelve siempre `undefined`** — para archivos nuevos y para legacy,
sin excepción. Los tres llamadores ya tratan "sin `publicUrl`" como "seguir
con `download()`" (así estaba escrito desde antes de esta etapa), así que
**ningún llamador necesitó cambiar una sola línea**: automáticamente dejan
de redirigir y pasan a servir el buffer que el propio backend descarga del
proveedor. Esto es lo que efectivamente cierra el hallazgo de seguridad,
para archivos nuevos y viejos por igual, sin depender de que el resto del
diseño (capa 2, abajo) sea perfecto.

**Capa adicional de defensa en profundidad (mejor esfuerzo, ver riesgo
residual §9): todo upload nuevo usa `type=authenticated` en Cloudinary**, de
forma que ni siquiera alguien que adivinara/filtrara el `public_id` podría
descargar el archivo directo desde el CDN de Cloudinary sin pasar por una
request firmada. Para que el backend pueda seguir descargando esos archivos
server-side, se persiste la metadata real que Cloudinary devuelve al subir
(`resource_type`, `type`, `asset_id`, `version`, `format`) en
`StorageFile.metadata` (Json, ya existente — sin tocar el schema), y
download/delete la usan para construir la request correcta en vez de
asumir un `resource_type`/`type` fijo.

Se evaluó implementar el esquema de "signed delivery URL" avanzado de
Cloudinary (`__cld_token__`, transformaciones estrictas) para servir el
recurso `authenticated` directo desde el CDN con un token de corta duración.
Se descartó: es una funcionalidad de cuenta que requiere configuración
adicional no verificable sin una cuenta Cloudinary real, y equivocar el
esquema de firma sin poder probarlo contra producción habría sido peor que
no implementarlo. En su lugar se usa el mecanismo estándar del Upload API
para descarga autenticada (`GET /<resource_type>/download?public_id=...&timestamp=...&signature=...`),
que reutiliza exactamente el mismo esquema de firma HMAC-SHA1 por
parámetros ordenados que este archivo ya usaba para `/destroy` — no
introduce ningún mecanismo nuevo, sólo lo aplica a un endpoint adicional del
mismo API. Este mecanismo queda marcado como no verificado contra una
cuenta real (§9), justamente porque el fix de fondo (`getPublicUrl` → nunca
público) no depende de que funcione para que el sistema esté seguro.

## 4. Qué cambió en upload

`cloudinaryStorageProvider.upload()`:

- Agrega `type=authenticated` a la request firmada (`form` + parámetros de
  la firma).
- Devuelve (vía `StorageObjectResult`, campos nuevos y opcionales,
  compatibles con local/Drive que no los usan): `cloudinaryResourceType`,
  `cloudinaryDeliveryType`, `cloudinaryAssetId`, `cloudinaryVersion`,
  `cloudinaryFormat` — todos tomados de la respuesta REAL de Cloudinary
  (nunca asumidos).
- `secure_url` se sigue devolviendo en `publicUrl` sólo como dato
  informativo — marcado `@deprecated` en el tipo, con la advertencia
  explícita de no usarlo para armar una respuesta al cliente.

`storageService.uploadManaged()` (`shared/storage/storage.service.ts`):
mezcla esos campos nuevos dentro de `StorageFile.metadata` vía el helper
`cloudinaryMetadataFrom()`, agregado a la metadata que el caller ya pasaba.
Sin cambios de Prisma schema — `metadata` ya era `Json`.

## 5. Qué cambió en download

- `getPublicUrl()` (provider Cloudinary): devuelve siempre `undefined` — ver
  §3. Nunca se usa para construir un redirect al cliente.
- `download(storageKey, metadata)` (nueva firma, segundo parámetro
  opcional): si `metadata.cloudinaryDeliveryType === "authenticated"` (todo
  upload nuevo), pide una URL de descarga firmada de corta vida al Upload
  API (mismo esquema de firma que `/destroy`) usando el `resource_type`
  persistido, y trae los bytes server-side — esa URL firmada nunca se
  expone al cliente. Si no hay metadata (archivo legacy), reproduce
  exactamente el fetch server-side anterior a esta etapa (URL pública,
  pero sólo usada internamente — nunca devuelta como redirect, gracias al
  fix de `getPublicUrl`).
- `getStoredFilePublicUrl`/`downloadStoredFile`/`deleteStoredFile`/`deleteManaged`
  en `shared/storage/storage.service.ts` ahora pasan `file.metadata` al
  provider (`StorageFileRef`/`StorageProvider` ganaron un parámetro opcional
  `metadata` — local/Google Drive lo ignoran, sin cambios de comportamiento).

## 6. Qué cambió en delete

- `delete(storageKey, metadata)`: usa el `resource_type` y el `type`
  persistidos (`{resource_type}/destroy`, con `type` en la firma y en el
  form) en vez de asumir siempre `image`. Legacy sin metadata: reproduce el
  `image/destroy` anterior, sin cambios.
- Idempotencia: `result: "not found"` en la respuesta de Cloudinary ya no
  lanza error — mismo criterio que `deleteManaged` con un `StorageFile` ya
  `DELETED`.

## 7. Qué NO cambió

- `DocumentCategory.viewRoles`/`uploadRoles` — no existen todavía.
- Ningún rediseño de permisos documentales.
- No se migró ni se movió ningún archivo existente entre providers.
- Frontend: cero cambios — `documents.service.ts`,
  `modules/storage/storage.service.ts` y `timeEntries.service.ts` no
  necesitaron tocarse (su lógica `if (publicUrl) redirect; else download`
  ya hacía lo correcto en cuanto `getPublicUrl` dejó de mentir); el
  frontend sigue recibiendo exactamente el mismo Blob que antes.
- Prisma schema / migraciones — no hizo falta ninguna; `StorageFile.metadata`
  ya existía.
- DB, seed, login, RBAC general, Usuarios, Carga Horaria, Cierres,
  Novedades, Conceptos horarios, Horas especiales.
- Flujo funcional del fichador — sólo se amplió el `select` de `photoFile`
  con `metadata` (forward-compat para cuando fichadas migre a Cloudinary;
  hoy no cambia nada porque fichadas sigue en Google Drive).
- `upload()`/`uploadManaged()` de local y Google Drive — sin cambios; la
  política de 15D.2 (elegir provider por módulo) sigue intacta.

## 8. Cómo configurar documentos Cloudinary + fichadas Drive

Sin ninguna variable nueva respecto a 15D.2:

```env
DOCUMENT_STORAGE_PROVIDER=cloudinary
PUNCH_PHOTO_STORAGE_PROVIDER=google_drive
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
CLOUDINARY_FOLDER=gestion-personal
GOOGLE_DRIVE_ENABLED=true
GOOGLE_DRIVE_ROOT_FOLDER_ID=...
GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_DRIVE_PRIVATE_KEY=...
```

`type=authenticated` para Cloudinary no es configurable todavía — es el
único modo que usa `uploadManaged` desde esta etapa (ver §3, "no
configurable todavía" es una simplificación deliberada, no un olvido).

## 9. Riesgo residual

- **No verificado contra una cuenta Cloudinary real**: el mecanismo de
  descarga autenticada (`{resource_type}/download?public_id=...&signature=...`)
  sigue el esquema de firma estándar del Upload API, pero no se probó
  contra Cloudinary de verdad (no hay credenciales reales disponibles en
  este entorno). Antes del primer uso productivo con
  `DOCUMENT_STORAGE_PROVIDER=cloudinary`, conviene un smoke test manual:
  subir un documento real, descargarlo desde la UI, confirmar que llega el
  contenido correcto.
- **`DocumentCategory.viewRoles`/`uploadRoles`** siguen sin implementarse —
  15D.4.
- **Fichadas en Cloudinary**: `PUNCH_PHOTO_STORAGE_PROVIDER=cloudinary` ya
  funcionaría con este mismo código (mismo provider, mismo `uploadManaged`),
  pero no se ejercitó ningún caso de prueba fichada+Cloudinary específico
  en esta etapa — sigue siendo Google Drive por decisión de producto.
- **Legacy sin metadata**: documentos Cloudinary subidos antes de 15D.3
  siguen dependiendo de los mismos supuestos hardcodeados que ya tenía el
  código (`image` para delete, `raw` para download) — deuda preexistente,
  no agravada ni "arreglada silenciosamente" acá; si alguno de esos
  archivos no es realmente de ese `resource_type`, la operación fallará con
  un error claro (`STORAGE_CLOUDINARY_DELETE_FAILED`/`_DOWNLOAD_FAILED`),
  igual que fallaba antes de esta etapa.

## 10. Qué queda para 15D.4

- `DocumentCategory.viewRoles` / `uploadRoles` — permisos de visualización y
  carga por categoría documental.
- Posible smoke test productivo del delivery autenticado de Cloudinary.

## 11. Validaciones

Backend:

```txt
npx prisma validate   → OK
npm run typecheck     → OK
npm test              → 103 archivos / 1458 tests OK (1447 previos de 15D.1/15D.2 + 11 nuevos de esta etapa)
npm run build         → OK
```

Frontend: no se tocó, no se corrió (no era necesario).

General: `git diff --check` sin errores.
