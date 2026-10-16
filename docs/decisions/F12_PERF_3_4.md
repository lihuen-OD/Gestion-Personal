# F12-PERF — PERF-3 y PERF-4

Fecha: 2026-10-16. Continúa `docs/decisions/F12_PERF_1_2.md`.

## Estado al retomar

La sesión anterior dejó PERF-3/PERF-4 implementados **sin commit** sobre `f558473`, con 42 tests rojos en `timeEntries.service.test.ts` y sin tests propios. Las dos migraciones ya estaban **aplicadas en staging** (`development`, host `ep-gentle-resonance`), con checksum igual al archivo local:

| Migración | Aplicada (UTC) | SHA-256 |
| --- | --- | --- |
| `20261015190000_add_neon_object_storage_provider` | 2026-10-15 18:14 | `febac710f40963d56d87682fdf48159bc4346d3e4fae10c6eb9cad97371e5b85` |
| `20261015203000_add_storage_archive_job` | 2026-10-15 18:16 | `d84adbbc1f24ad1d9f33dfd76c220eccc15548e52f8ecbe50ed5a9dac0bb9507` |

Al retomar, staging tenía `StorageArchiveJob` vacía y los 178 `StorageFile` de `FICHADAS` en `GOOGLE_DRIVE`: ninguna fichada real pasó todavía por Neon. Esta etapa estabilizó ese trabajo sin tocar la base ni el archivo de migración (su checksum ya está registrado en staging).

## Camino crítico

```
PWA → backend → upload del objeto al primary (Neon) → transacción → HTTP 201
                                                     └ fuera del request: StorageArchiveJob → Google Drive
```

1. `storeClockPunchPhoto` valida foto y miniatura y sube **sólo el objeto físico** (`storageService.uploadManagedObject`), antes de abrir la transacción. No escribe filas.
2. Dentro de la transacción de la fichada, antes del `AttendancePunch`, `clockEvidenceWriter` llama a `storageService.persistManagedUploadWithArchive(prepared, tx)`: `StorageFile` primario + `StorageArchiveJob PENDING` (vía `storageArchiveRepository.enqueue`), con la misma `tx` que el punch, la jornada, el `AuditLog` (F11) y el `ClockPunchAttempt COMPLETED` (F11.1). El punch guarda `photoFileId` y el `StorageFile` queda vinculado (`attendancePunchId`).
3. Si la transacción falla, no queda ninguna fila: `cleanupClockEvidence` borra el objeto por su key (`compensateManagedUpload`, mismo provider del upload). Con `tx`, `persistManagedUpload` no compensa adentro: nada de llamadas de red dentro de la transacción.
4. Google Drive no participa del request.

Key determinista: `attendance/<año>/<mes>/<deviceId>/<requestId>.<jpg|png|webp>` (mes en hora argentina, `argentinaDateParts`). No hay una carpeta por fichada: con Drive como primary, como hoy, crearla agregaría unos segundos dentro del request. `requestId` es UUID (schema) y único global (`ClockPunchAttempt`), y el attempt se crea antes del upload: un reintento o un duplicado concurrente del mismo `requestId` nunca vuelve a subir.

### Invariante por requestId

Un `requestId` confirmado produce como máximo 1 objeto primario, 1 `StorageFile`, 1 `AttendancePunch`, 1 `AuditLog` y 1 `StorageArchiveJob` (`@@unique([sourceStorageFileId, targetProvider])`). Uno no confirmado no deja filas y su objeto queda compensado. Los dos casos están probados contra PostgreSQL real en `clock.integration.test.ts`, con IN, OUT, reintento secuencial, duplicado concurrente y rollbacks por auditoría o confirmación del intento.

### Miniatura

Ya no se guarda. Antes se subía con un `setTimeout` posterior al commit (no durable), y nada la servía: la foto de RRHH lee siempre `photoFile`, y el frontend sólo usa `thumbnailFileId` para saber si hay foto. El contrato no cambia: el campo `thumbnail` se sigue aceptando y validando igual. `rawPayload.photo.thumbnailStatus` de las fichadas nuevas es `NOT_STORED`. Se eliminó `linkClockPunchThumbnail`, que había quedado sin uso.

## Archivo durable (outbox)

`StorageArchiveJob` (`PENDING → PROCESSING → COMPLETED | FAILED`) lo procesa `storageArchive.worker` al **final** del tick de `clockPunchMaintenance` (60 s), así sus uploads a Drive nunca demoran los chequeos de asistencia. Procesa hasta 5 jobs por tick.

- **Política:** sólo un primary `NEON_OBJECT_STORAGE` genera job, siempre hacia `GOOGLE_DRIVE`. Un primary Drive, Local o Cloudinary no se re-archiva.
- **Claim:** `findFirst` + `updateMany` condicional (PENDING vencido o PROCESSING con lease vencido). Bajo concurrencia sólo un worker gana. El lease dura 2 min y cada claim suma un intento.
- **Fencing:** `complete`/`retry`/`fail` exigen el `attemptCount` del claim. Un worker cuyo lease venció y fue reclamado ya no puede cerrar el job.
- **Idempotencia en Drive:** la copia lleva `appProperties.sourceStorageFileId` y `checksum`. Antes de descargar, el worker busca una copia existente (`findGoogleDriveArchiveCopy`), de modo que un reclaim tras un upload sin cerrar no duplica la copia.
- **Integridad:** antes de subir, verifica el SHA-256 del objeto descargado contra `StorageFile.checksum`.
- **Reintentos:** backoff `5 s·2^(n-1)` con techo de 1 h y 20 % de jitter. Con 12 intentos cubre unas 2,5 h de caída de Drive. Luego queda `FAILED`.
- **Errores terminales**, sin reintento: target no soportado, origen ilegible, origen `DELETED` y checksum distinto. Un error desconocido se reintenta, y su mensaje no se persiste.
- **Drive no configurado:** el worker no reclama nada. Los jobs quedan `PENDING` y se archivan cuando Drive vuelva, en vez de agotar sus intentos.
- **Layout en Drive:** replica la key bajo `attendance-archive/<año>/<mes>/<deviceId>/<requestId>.<ext>`. Las fichadas históricas siguen en `storage-sistema/fichadas/<año>/<mes>/<día>/`, de modo que quien navegue Drive ve dos árboles; unificarlos es una decisión de producto pendiente.
- **FK:** `sourceStorageFileId` es `ON DELETE RESTRICT`. El sistema nunca borra físicamente un `StorageFile` (borrado lógico `DELETED`).

## Validación

- Unit: `timeEntries.service.test.ts` (175), con un bloque F12-PERF-3: upload único antes de la transacción, key determinista, IN/OUT/rollover persistidos con la `tx`, extensión por MIME, compensación y fallo del primary. También `timeEntries.repository.test.ts` (173, orden cooldown → evidencia → punch y vínculo), `storage.service.test.ts` (21, política de archive y compensación) y `storageArchive.worker.test.ts` (13).
- Integración contra PostgreSQL 18 local, en bases `clock_it*` nuevas con `db push`: `clock.integration.test.ts` + `clockDevices.integration.test.ts`, 27/27. Corren el storage real con Neon reemplazado por `shared/testing/inMemoryObjectStorage.ts`. Incluyen el claim exclusivo concurrente, el reclaim por lease vencido, el fencing y el `RESTRICT`.
- Backend: `typecheck`, `test` (189 archivos, 3079 tests; 5 archivos de integración opt-in en skip) y `build`, todos en verde.

## Activación (no hecha)

En el `.env` actual, `PUNCH_PHOTO_STORAGE_PROVIDER` está vacío y `STORAGE_PROVIDER=google_drive`: **las fichadas siguen subiendo a Drive dentro del request**. El código no cambia ese comportamiento, sólo deja de crear la miniatura. La credencial efímera de PERF-2 fue revocada. Para activar en staging:

1. Crear una credencial Neon Object Storage limitada a `storage:read` + `storage:write` sobre `gestion-personal-fichadas-staging`.
2. Configurar `PUNCH_PHOTO_STORAGE_PROVIDER=neon_object_storage` y `NEON_OBJECT_STORAGE_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY` en el backend de staging. Mantener `GOOGLE_DRIVE_*`, que ahora usa el worker.
3. Hacer fichadas IN/OUT reales controladas y medir con `CLOCK_PUNCH_METRIC` (`primary_upload`, `storage_file_insert`, transacción, `post_commit`) la distribución total p50/p95 contra el objetivo de 1–2 s.
4. Verificar en la base: 1 `StorageFile NEON_OBJECT_STORAGE` por fichada, job `PENDING → COMPLETED` en el tick siguiente y la copia en `attendance-archive/` de Drive.

Las fichadas históricas (Drive) no se migran: siguen resolviendo por su `storageProvider` persistido (15D.1).

## Riesgos y deuda

- **Commit con resultado desconocido:** si la conexión cae después de enviar `COMMIT`, la fichada puede haber quedado confirmada mientras el backend compensa su objeto. Es el mismo riesgo que existía con Drive. Mitigarlo exige reconciliar por key/`requestId`, y eso no se hizo en esta etapa.
- **Objetos huérfanos físicos:** si la compensación falla (`CLOCK_STORAGE_COMPENSATION_FAILED`, crítico en logs), el objeto queda en el bucket sin fila. `countUnlinkedPunchEvidence` sólo ve filas. Falta un reconciliador de bucket.
- **`FAILED` es terminal:** no hay tooling de reencolado ni alerta de backlog `PENDING` envejecido. Hoy se detecta por logs (`STORAGE_ARCHIVE_FAILED`).
- **Throughput del archivo:** 5 jobs por tick equivale a unos 300/h. En un pico de cambio de turno el backlog se drena en minutos u horas. Es aceptable para un archivo secundario, pero se revisa si el piloto lo exige.
- **Latencia IN/OUT end-to-end en staging real:** todavía sin medir.
