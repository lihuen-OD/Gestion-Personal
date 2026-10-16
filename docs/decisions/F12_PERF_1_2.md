# F12-PERF — PERF-1 y PERF-2

Fecha: 2026-10-15

## Alcance cerrado

- PERF-1 instrumenta el pipeline de fichada sin cambiar el provider efectivo.
- PERF-2 incorpora `NEON_OBJECT_STORAGE` a la abstracción existente y lo prueba aisladamente.
- No se habilita Neon para fichadas reales, no se crean `StorageArchiveJob`, no se cambia el contrato PWA y no se aplica la migración preparada.

## Frontera transaccional aprobada para una etapa posterior

El upload físico al primary storage ocurre antes de abrir la transacción core. Dentro de una única transacción se crearán `StorageFile PRIMARY`, `AttendancePunch`, `WorkShift`, `TimeEntry`/`TimeSegment` cuando corresponda, `AuditLog`, la finalización de `ClockPunchAttempt` y `StorageArchiveJob PENDING`. Sólo después del commit se responde HTTP 201.

Si la transacción falla, no debe quedar un `StorageFile` huérfano en la base. El objeto físico puede quedar huérfano y deberá resolverse mediante compensación/reconciliación por `objectKey`/`requestId`. Esta secuencia no se implementa en PERF-1/PERF-2.

## PERF-1 — Instrumentación y baseline

Los eventos `CLOCK_PUNCH_METRIC` usan una lista cerrada de campos: `requestId`, identificador parcial de dispositivo, fase, duración, bytes, provider y resultado. Se excluyen cuerpos, fotos, base64, tokens, cabeceras Authorization, secretos y URLs firmadas.

Baseline controlado del provider vigente Google Drive, 30 objetos ficticios JPEG de 36.107 bytes, sin crear `AttendancePunch`:

| Operación | p50 | p75 | p90 | p95 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Upload, incluyendo cold | 2641 ms | 2996 ms | 4008 ms | 4941 ms | 6659 ms |
| Upload warm | 2641 ms | 2940 ms | 4008 ms | 4278 ms | 4941 ms |
| Download | 914 ms | 1022 ms | 1154 ms | 2830 ms | 3351 ms |
| Delete | 1047 ms | 1949 ms | 3246 ms | 5686 ms | 6104 ms |

El primer upload cold fue 6659 ms. El bottleneck principal medido es el upload a Drive: por sí solo supera 2 segundos en p50.

No se generó una distribución IN/OUT del pipeline completo: el entorno no tenía un fichador local operativo ni una serie segura de fichadas reales de staging. La instrumentación queda preparada para capturar esa distribución antes de PERF-3.

## PERF-2 — Neon Object Storage

Verificación real sobre staging:

- branch `development`, región `aws-us-east-1`, PostgreSQL 18;
- Object Storage habilitado, endpoint S3 compatible y path-style requerido;
- bucket `gestion-personal-fichadas-staging`, acceso `private`;
- la API de storage/credenciales está marcada Beta aunque el producto Object Storage fue anunciado GA;
- el API key project-scoped no expuso el plan/cuota de billing de la organización. La documentación pública vigente informa 5 GB por proyecto para Free, pero no se asume que éste sea el plan del proyecto.

Benchmark aislado, 30 iteraciones, archivo ficticio de 36.107 bytes, credencial efímera limitada a `storage:read` y `storage:write`, revocada al finalizar:

| Operación | p50 | p75 | p90 | p95 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Upload | 278.4 ms | 304.3 ms | 388.9 ms | 426.7 ms | 572.7 ms |
| Download | 798.9 ms | 892.5 ms | 1109.9 ms | 1360.7 ms | 1469.2 ms |
| Delete | 199.6 ms | 241.6 ms | 327.3 ms | 412.8 ms | 505.9 ms |

La sobrescritura de una misma key fue idempotente. Todos los objetos ficticios fueron leídos, verificados y borrados; no quedaron credenciales F12-PERF activas.

## Migración preparada, no aplicada

```sql
ALTER TYPE "StorageProvider" ADD VALUE 'NEON_OBJECT_STORAGE';
```

- Impacto: agrega un valor al enum; no reescribe filas ni cambia el provider efectivo.
- Estado staging: 67 migraciones locales detectadas; sólo `20261015190000_add_neon_object_storage_provider` está pendiente.
- SHA-256: `febac710f40963d56d87682fdf48159bc4346d3e4fae10c6eb9cad97371e5b85`.

> Actualización 2026-10-16: la migración se aplicó después en staging (2026-10-15 18:14 UTC, mismo checksum), junto con `20261015203000_add_storage_archive_job`. PERF-3/PERF-4: `docs/decisions/F12_PERF_3_4.md`.
