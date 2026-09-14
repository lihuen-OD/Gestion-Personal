# Etapa 15D.1 — Registry multi-provider: resolver operaciones por provider persistido

## 1. Contexto 15D

La Etapa 15D (auditoría/diseño read-only) confirmó que `StorageFile` ya
persiste `storageProvider` (`LOCAL` / `GOOGLE_DRIVE` / `CLOUDINARY`) por cada
archivo, pero que las operaciones sobre archivos existentes no lo usaban: el
objetivo final de storage es Google Drive para fichadas/fotos, Cloudinary
para documentos, y la posibilidad futura de migrar fichadas/fotos a
Cloudinary sin romper archivos viejos. Esta subetapa (15D.1) implementa
únicamente la resolución de provider por archivo — no la estrategia completa
(eso queda para 15D.2/15D.3/15D.4, ver §9).

## 2. Problema detectado

`storageService` (`backend/src/shared/storage/storage.service.ts`) resolvía
el provider con una única función `provider()` que lee `env.STORAGE_PROVIDER`
(el provider global activo *hoy*). Todos los llamadores de
download/delete/getPublicUrl/getFilePath pasaban sólo un `storageKey` crudo,
así que esas operaciones siempre usaban el provider global, nunca el
`StorageFile.storageProvider` con el que el archivo realmente se había
subido. Si una foto se sube hoy a Google Drive y mañana `STORAGE_PROVIDER`
pasa a `cloudinary`, el sistema intentaba leerla/borrarla desde Cloudinary —
rompiendo la convivencia multi-provider. Afectaba tres puntos:

- `modules/storage/storage.service.ts` (`GET/DELETE /storage/files/:id/*`,
  genérico para documentos y evidencia del fichador).
- `modules/documents/documents.service.ts` (`GET /documents/:id/download`).
- `modules/time-entries/timeEntries.service.ts` (`attendancePunchPhoto`, foto
  de una fichada).

`storageService.deleteManaged(id)` (usado por la compensación ante fallos:
`cleanupClockEvidence` y el catch de `scheduleClockThumbnail` en
`timeEntries.service.ts`) ya recibía el `StorageFile` completo internamente,
pero también borraba con el provider global en vez del persistido.

## 3. Decisión técnica

Se agregó un registry interno en `shared/storage/storage.service.ts` que
mapea `StorageFile.storageProvider` (`LOCAL` / `GOOGLE_DRIVE` / `CLOUDINARY`)
al adaptador (`StorageProvider`) correspondiente, expuesto como
`storageProviderRegistry.get(storageProvider)`. `storageService` agrega
cuatro métodos nuevos que operan sobre una referencia mínima a un archivo
existente (`StorageFileRef = { storageProvider, storageKey }`, que un
`StorageFile` de Prisma satisface directamente):

- `getStoredFilePublicUrl(file)`
- `getStoredFilePath(file)`
- `downloadStoredFile(file)`
- `deleteStoredFile(file)`

Un provider desconocido/corrupto (nunca debería ocurrir con el enum actual,
pero es una entrada de otro sistema — la DB) responde `AppError` `500
STORAGE_PROVIDER_UNKNOWN`, nunca un `undefined` silencioso.

`upload()`/`uploadManaged()` NO cambiaron: siguen resolviendo por
`provider()` (el provider global activo), tal como pide esta subetapa — el
upload de un archivo nuevo puede seguir usando el provider configurado hoy;
`DOCUMENT_STORAGE_PROVIDER`/`PUNCH_PHOTO_STORAGE_PROVIDER` por módulo quedan
para 15D.2, fuera de este alcance.

Los métodos legacy (`getPublicUrl`, `getFilePath`, `download`, `delete`, que
toman sólo un `storageKey` y resuelven por el provider global) se conservan
tal cual — sin cambiar su firma ni su comportamiento — y quedan marcados con
`@legacy` en el código: sólo son correctos para un `storageKey` sin
`StorageFile` vinculado (documentos/fichadas previos a que `StorageFile`
existiera), donde no hay forma de saber con qué provider se subió el
archivo, así que preservan el comportamiento actual (provider global) en vez
de adivinar uno.

## 4. Qué cambió

- **`shared/storage/storage.types.ts`**: nueva interfaz `StorageFileRef`
  (`{ storageProvider, storageKey }`) y el re-export del enum Prisma
  `StorageProvider` como `PersistedStorageProvider` (evita colisión de
  nombre con la interfaz `StorageProvider` — el adaptador — ya existente).
- **`shared/storage/storage.service.ts`**: registry `providerRegistry` +
  `providerFor()`/`storageProviderRegistry.get()`; cuatro métodos nuevos
  (`getStoredFilePublicUrl`, `getStoredFilePath`, `downloadStoredFile`,
  `deleteStoredFile`); `deleteManaged(id)` ahora borra con
  `providerFor(file.storageProvider)` en vez del provider global — mismo
  nombre/firma, así que arregla automáticamente toda compensación que ya
  pasaba por `deleteManaged` (fichador) sin tocar `timeEntries.service.ts`
  para eso.
- **`modules/storage/storage.service.ts`** (`storageModuleService.download`):
  usa `getStoredFilePublicUrl(file)` / `downloadStoredFile(file)` /
  `getStoredFilePath(file)` — `file` ya era el `StorageFile` completo.
- **`modules/documents/documents.service.ts`** (`documentsService.download`):
  si `item.storageFile` existe, resuelve por su `storageProvider`
  persistido; si no (documento legacy sin `StorageFile` vinculado), conserva
  exactamente el comportamiento anterior (provider global vía los métodos
  legacy).
- **`modules/time-entries/timeEntries.repository.ts`**
  (`findAttendancePunchEvidence`): se agregó `storageProvider: true` al
  `select` de `photoFile` — antes faltaba, así que `attendancePunchPhoto` no
  podía resolver el provider persistido aunque quisiera.
- **`modules/time-entries/timeEntries.service.ts`**
  (`attendancePunchPhoto`): mismo patrón que documentos — si `punch.photoFile`
  existe, resuelve por su `storageProvider`; si no (fichada legacy con sólo
  `photoStoragePath`), conserva el comportamiento anterior.

## 5. Qué NO cambió

- `upload()` / `uploadManaged()` — siguen usando el provider global activo.
- `DOCUMENT_STORAGE_PROVIDER` / `PUNCH_PHOTO_STORAGE_PROVIDER` — no se
  agregaron (quedan para 15D.2).
- Cloudinary sigue con `resource_type=auto`/delivery público — no se tocó
  autenticación, signed URLs ni proxy (15D.3).
- `DocumentCategory.viewRoles` / `uploadRoles` — no existen todavía (15D.4).
- Ningún dato se migró ni se movió de provider.
- `storageModuleService.archive` (borrado lógico del módulo `storage`) no
  llama a ningún provider físico hoy — comportamiento preexistente, no
  tocado.
- Prisma schema, migraciones, DB, seed.
- Carga Horaria, Cierres, RBAC general, Usuarios, Login, Novedades,
  Conceptos horarios, Horas especiales, flujo del fichador, token de
  dispositivo, endpoint público, UI/frontend.

## 6. Por qué no hizo falta migración de DB

El campo `StorageFile.storageProvider` ya existía (persistido desde antes de
15D) y todas las queries relevantes ya lo tenían disponible o sólo requerían
agregarlo a un `select` (`findAttendancePunchEvidence`). El cambio es
enteramente de código de aplicación: qué provider se usa para operar sobre
un archivo ya identificado, no qué se guarda en la base.

## 7. Por qué no se movieron archivos

El objetivo de esta subetapa es que el sistema opere correctamente sobre
archivos que ya están en providers distintos — no unificarlos. Mover
archivos de provider es, por definición, lo que esta etapa habilita hacer
más adelante sin romper nada; hacerlo ahora sería una migración de datos
fuera del alcance pedido.

## 8. Cómo queda la compatibilidad multi-provider

- Un archivo con `StorageFile` vinculado (documento subido por el flujo
  real, foto/thumbnail de fichada) se lee/borra siempre por su
  `storageProvider` persistido, sin importar qué diga `STORAGE_PROVIDER` hoy.
- Un archivo legacy sin `StorageFile` vinculado (datos previos a que la
  tabla existiera) sigue resolviendo por el provider global activo —
  comportamiento idéntico al de antes de esta etapa, porque no hay
  información para hacer algo mejor.
- Subir un archivo nuevo sigue usando el provider global configurado hoy;
  ese archivo queda con su `storageProvider` correctamente persistido, así
  que ya es operable por esta misma lógica desde el momento en que se sube.

## 9. Riesgo residual

- **Cloudinary** sigue pendiente de hardening (`private`/`authenticated`,
  signed URLs, proxy definitivo) — 15D.3.
- **`DocumentCategory.viewRoles`/`uploadRoles`** siguen sin implementarse —
  15D.4.
- **Upload por módulo** (`DOCUMENT_STORAGE_PROVIDER`,
  `PUNCH_PHOTO_STORAGE_PROVIDER`) sigue pendiente — 15D.2.
- Un archivo legacy sin `StorageFile` (si existiera alguno en datos reales)
  sigue dependiendo de que el provider global activo coincida con el
  provider real con el que se subió — deuda preexistente, no introducida ni
  agravada por esta etapa.

## 10. Validaciones

Backend:

```txt
npx prisma validate   → OK
npm run typecheck     → OK
npm test              → 102 archivos / 1441 tests OK (1423 previos + 18 nuevos de esta etapa)
npm run build         → OK
```

General:

```txt
git diff --check      → sin errores
git diff --stat        → 7 archivos modificados, 3 archivos de test nuevos
```

Frontend: no se tocó, no se corrió (no era necesario).
