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

## Activación en staging (2026-10-16)

Se activó en el `backend/.env` local de staging (gitignoreado): `PUNCH_PHOTO_STORAGE_PROVIDER=neon_object_storage` más `NEON_OBJECT_STORAGE_*`, con una credencial nueva entregada por el usuario. No se cambiaron `STORAGE_PROVIDER` (`google_drive`), `DEFAULT_STORAGE_PROVIDER` ni `DOCUMENT_STORAGE_PROVIDER`: los documentos siguen yendo a Drive. `GOOGLE_DRIVE_*` se mantiene, porque lo usa el worker de archivo. Las fichadas históricas (Drive) no se migran: siguen resolviendo por su `storageProvider` persistido (15D.1).

## Validación real en staging (2026-10-16)

**Entorno:** backend aislado en `:4003` con `AUTOMATIC_JOBS_ENABLED=false`, una sola instancia, contra la base de staging. Dispositivo `TEST F12-PERF staging 2026-10-16`, enrolado por pairing y aprobado por RRHH, `REVOKED` al terminar con su historia intacta. Legajos de prueba 29, 30 y 31, con las alertas de puntualidad aceptadas de antemano. La foto es un JPEG sintético con el mismo pipeline de la PWA (canvas 800×600 `toDataURL` q0,84 = 34.626 B, más una miniatura 240×180 q0,76).

### Neon Object Storage (smoke aislado, sin filas de negocio)

Fueron 5 ciclos de upload → HEAD → GET (SHA-256 ok) → DELETE → HEAD (no existe), todos correctos. Latencia en ms, con las 5 muestras individuales en orden:

| Operación | Muestras | p50 | max |
| --- | --- | ---: | ---: |
| Upload | 1658 (frío), 451, 244, 253, 277 | 277 | 1658 |
| HEAD | 773, 733, 672, 723, 535 | 723 | 773 |
| GET | 437, 367, 209, 232, 212 | 232 | 437 |
| DELETE | 198, 319, 192, 182, 242 | 198 | 319 |

**Bucket privado.** El GET anónimo devuelve 403 en los 5 ciclos. El provider no expone URL pública. La ACL tiene un solo grant (owner `FULL_CONTROL`) y ninguno a `AllUsers`/`AuthenticatedUsers`, y no hay bucket policy (`NoSuchBucketPolicy`). La credencial lista un único bucket, `gestion-personal-fichadas-staging`, porque el endpoint es de la rama de staging. Sólo se hicieron sondas de lectura: no se cambió ninguna ACL ni policy.

### Fichadas controladas

Las 8 fichadas respondieron 201: las 6 muestras, el IN con Drive caído y el OUT con respuesta perdida. Para **cada una** se verificó:

- primary `NEON_OBJECT_STORAGE`, en la key `attendance/2026/10/<dispositivo>/<requestId>.jpg`;
- 1 objeto en el bucket (al final había 8 objetos para 8 fichadas) y 1 `StorageFile` vinculado al punch;
- 1 `AttendancePunch`, 1 `AuditLog` de la fichada, `ClockPunchAttempt` `COMPLETED` y 1 `StorageArchiveJob` (`PENDING`, `attemptCount 0`);
- las salidas dejan la jornada `PROCESADO` con su `TimeEntry`/`TimeSegment` de Hora normal (2 min).

**Drive fuera del camino crítico:**

- el `primary_upload` registra el provider `neon_object_storage` en todas las fichadas;
- justo después de cada 201, Drive tenía **0 copias** de esa evidencia (consulta por `appProperties.sourceStorageFileId` antes de correr el worker);
- con la carpeta raíz de Drive inválida en el proceso del backend, el IN igual respondió 201.

### Latencia (cliente → 201)

Las muestras son sólo 3 por tipo: los valores son orientativos, no percentiles. Todo en ms; `total` es `http_response_write` del servidor, y la transacción incluye `storage_file_insert`, `audit` y `attempt_completion`.

| Muestra | Cliente | Total servidor | primary_upload | storage_file_insert | tx acquire | tx core | audit | post_commit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| IN 29 (1º request, frío) | 10567 | 10181 | 1563 | 502 | 344 | 3322 | 179 | 3504 |
| IN 30 | 5599 | 5240 | 979 | 176 | 180 | 1743 | 183 | 1399 |
| IN 31 | 6301 | 6128 | 1043 | 357 | 184 | 3137 | 358 | 368 |
| OUT 29 | 20784 | 20595 | 1080 | 372 | 184 | 6779 | 380 | 8907 |
| OUT 30 | 17774 | 17318 | 1304 | 350 | 172 | 6564 | 351 | 6004 |
| OUT 31 | 15997 | 15640 | 1133 | 191 | 280 | 3497 | 189 | 6727 |

Resumen: IN min 5599 / mediana 6301 / max 10567, y OUT min 15997 / mediana 17774 / max 20784. **Ninguna muestra alcanza el objetivo de ≤ 2 s.**

### Bottleneck nuevo: idas y vueltas a la base, no storage

- **Latencia de red de la topología:** desde el backend local hasta Neon us-east-1, `SELECT 1` tarda en mediana 204 ms (176–247). Una transacción interactiva con una sola consulta cuesta 500–630 ms. A ese RTT, una fichada equivale a ~21–25 idas y vueltas a la base en el IN y ~70–96 en el OUT (estimado como `(total − primary_upload) / RTT`). Esta topología no representa un backend desplegado en la misma región que la base; la proyección a esa topología es una estimación sin medir.
- **El `post_commit` está antes del 201:** en el OUT tarda 6,0–8,9 s (evaluación de salida, alertas, notificaciones y sincronización de desgloses), entre el 35 % y el 45 % del total. En el IN tarda 0,4–3,5 s.
- **La transacción del OUT tarda 3,5–6,8 s**, y la preparación de salida previa a la transacción, sin instrumentar, ~3 s.
- **El upload a Neon en la fichada tarda ~1,0–1,3 s**, contra 244–450 ms con la conexión reutilizada del smoke: cada fichada vuelve a negociar TLS con el endpoint. Aun así, el storage dejó de dominar: Drive como primary costaba 2641 ms en p50 sólo de upload.
- **Primer request de cada proceso:** ~2× más lento (pool, TLS, JIT).

No se cambió código. Optimizarlo queda para PERF-5.

### Archivo durable (worker real)

Los jobs se procesaron con `processOneStorageArchiveJob`, la misma función que llama el tick. No se encendieron los schedulers completos: el cableado del tick es una sola llamada cubierta por tests, y encenderlos contra staging dispara monitores ajenos a esta prueba (en F6 produjeron 19 notificaciones de "Falta de ingreso").

- Los 8 jobs pasaron `PENDING → PROCESSING → COMPLETED`. Cada uno dejó **1 sola** copia en Drive (`<requestId>.jpg`, 34.626 B, checksum igual al del `StorageFile`, igual a `targetStorageKey`), y el primary sigue en Neon.
- El archivo tardó ~5–6 s por job (12 s el primero, por la creación de carpetas), siempre fuera del request.
- **Drive caído:** se usó una carpeta raíz inválida sólo en el env del proceso, sin tocar las credenciales reales. El job hizo `PENDING → PROCESSING → PENDING`, con `attemptCount 1`, `lastErrorCode STORAGE_GOOGLE_DRIVE_API_ERROR` y reintento a +5 s. Al restaurar la carpeta pasó a `COMPLETED` (`attemptCount 2`) con 1 copia, sin punch ni primary nuevos.

### Idempotencia y respuesta perdida

- **Mismo `requestId` repetido 2 veces** (IN 30): 201, con el mismo resultado que `GET /clock/attempts/:requestId`, en 0,7–1,6 s. Siguen existiendo 1 objeto, 1 `StorageFile`, 1 punch, 1 audit y 1 job.
- **Respuesta perdida** (OUT 29): el cliente cortó a los 1,5 s y el servidor completó igual. El polling del intento pasó de `PROCESSING` a `COMPLETED` en ~13,6 s, y el reintento con el mismo `requestId` devolvió 201 con la respuesta durable, sin duplicados.

### Resultado

| Ítem | Resultado |
| --- | --- |
| Neon smoke | PASS |
| Bucket privado | Sí |
| Activación PERF-3 en staging | PASS |
| Archivo real PERF-4 | PASS |
| Drive fuera del camino crítico | Sí |
| Idempotencia / recovery / reintento con Drive caído | PASS / PASS / PASS |
| Objetivo de latencia ≤ 2 s | FAIL (IN ~5,6–10,6 s; OUT ~16–21 s) |

## Riesgos y deuda

- **Commit con resultado desconocido:** si la conexión cae después de enviar `COMMIT`, la fichada puede haber quedado confirmada mientras el backend compensa su objeto. Es el mismo riesgo que existía con Drive. Mitigarlo exige reconciliar por key/`requestId`, y eso no se hizo en esta etapa.
- **Objetos huérfanos físicos:** si la compensación falla (`CLOCK_STORAGE_COMPENSATION_FAILED`, crítico en logs), el objeto queda en el bucket sin fila. `countUnlinkedPunchEvidence` sólo ve filas. Falta un reconciliador de bucket.
- **`FAILED` es terminal:** no hay tooling de reencolado ni alerta de backlog `PENDING` envejecido. Hoy se detecta por logs (`STORAGE_ARCHIVE_FAILED`).
- **Throughput del archivo:** 5 jobs por tick equivale a unos 300/h. En un pico de cambio de turno el backlog se drena en minutos u horas. Es aceptable para un archivo secundario, pero se revisa si el piloto lo exige.
- **Latencia IN/OUT end-to-end:** medida en staging (sección anterior). No cumple el objetivo, y la causa es la cantidad de idas y vueltas a la base por fichada a ~200 ms de RTT, más el `post_commit` dentro del request. Es el punto de partida de PERF-5.
- **`StorageArchiveJob.startedAt` es el del primer claim:** en un job reintentado, `completedAt − startedAt` incluye la espera del backoff (50,9 s en la prueba). No sirve como duración del upload a Drive.
