# Fichador — modo mantenimiento del dispositivo

Fecha: 2026-10-26. Rama: `fix/staging-fichador-ajustes`. Estado: **implementado en código**. La migración no se aplicó a ningún entorno compartido (ni `development`/staging, ni producción, ni demo). Se valida sólo sobre una base local desechable `clock_it*`.

Operación para RRHH y modo kiosco del sistema operativo: [docs/fichador-kiosk/README.md](../fichador-kiosk/README.md).

## 1. Problema

El fichador va a funcionar como terminal físico dedicado: tablet Android, iPad/iPhone o ChromeOS. Las personas que fichan deben ver sólo el fichador. RRHH, en cambio, necesita a veces revisar el equipo y hacer acciones técnicas, como recargar la app o reconfigurar el dispositivo, sin dejar controles visibles para todos.

No se usa un PIN maestro: ni en el código, ni en `VITE_*`, ni en `localStorage`/IndexedDB, ni compartido entre equipos. Tampoco se intenta "bloquear" el sistema operativo desde JavaScript. Eso lo hace el modo kiosco del sistema (§9).

## 2. Decisión

Autorización temporal emitida por RRHH, atada a un `ClockDevice` y validada por el backend:

1. RRHH, desde **Admin → Configuración → Dispositivos de fichada**, genera un **código de mantenimiento** para un dispositivo `ACTIVE`.
2. En el fichador, un gesto discreto abre **"Acceso de mantenimiento"**: mantener presionado el encabezado durante 5 s.
3. Se ingresa el código. El backend lo valida contra la credencial del dispositivo y abre una **sesión de mantenimiento** corta.
4. La PWA muestra el modo mantenimiento hasta que vence la sesión o RRHH sale.

No es un sistema paralelo. Reutiliza:

- la autenticación por dispositivo (`requireClockDevice`, sólo `ACTIVE`);
- el patrón de secretos del pairing: valor aleatorio, sólo SHA-256 persistido y vencimiento en la misma fila;
- los limitadores en capas del namespace `/api/clock/*`;
- `auditService`;
- la revocación en caliente: 401/403 de dispositivo → `clockDeviceSession` → `ClockDeviceGate`.

## 3. Por qué es seguro

| Requisito | Cómo se cumple |
|---|---|
| Fuente criptográfica | Código de 6 dígitos con `crypto.randomInt`; token de sesión de 32 bytes con `randomBytes` |
| Vida corta | Código: 5 min. Sesión: 10 min. Los vence el servidor con su reloj |
| Atado al dispositivo | El hash es `SHA-256("clock-maintenance:<deviceId>:<código>")` y la validación filtra por el dispositivo **autenticado**. El código de A no sirve en B |
| Un solo uso | El consumo es un único `UPDATE … WHERE` condicional: hash, vencimiento, intentos y `ACTIVE`. Dos pedidos concurrentes no pueden consumirlo dos veces |
| Un código por equipo | Generar otro reemplaza al anterior en la misma columna, así que el anterior deja de valer |
| Sin texto plano | Se persisten sólo los hashes del código y del token. El código no se loguea ni se audita, y el token tampoco |
| Fuerza bruta | (a) límite por IP antes de autenticar; (b) **10 validaciones / 15 min por dispositivo**; (c) **5 intentos fallidos anulan el código** (contador en la base, vale entre instancias). Con un código vigente, la probabilidad de acertar es ≤ 5 / 10⁶ |
| Sin pistas | Inexistente, vencido, anulado, ya usado o de otro equipo responden lo mismo: `401 CLOCK_MAINTENANCE_CODE_INVALID`, "El código no es válido o ya venció." |
| Sesión separada | El token de mantenimiento viaja en `X-Clock-Maintenance-Session`, **además** de la credencial del dispositivo. No reemplaza ni modifica `tokenHash`. El token durable del equipo nunca funciona como sesión administrativa |
| Revocación | Toda ruta de mantenimiento exige `ACTIVE`. `revoke` limpia código y sesión en el mismo `UPDATE`, y una CHECK en la base impide que un equipo no `ACTIVE` conserve estado de mantenimiento |
| Multi-instancia | Código, intentos y sesión viven en PostgreSQL, no en memoria. Los limitadores siguen en memoria por proceso (deuda conocida de SECURITY_STANDARDS) y el tope de intentos en la base cubre ese hueco |
| Bundle | El frontend no lleva ninguna credencial administrativa. El código lo escribe una persona y el token sólo vive en memoria del componente |

**Límite conocido.** El SHA-256 de un código de 6 dígitos se puede revertir por fuerza bruta en segundos. Quien lea la base mientras un código está vigente (5 min) podría recuperarlo. Para usarlo necesitaría además la credencial del equipo, guardada en su IndexedDB, y estar frente a ese equipo. El mantenimiento sólo permite ver diagnóstico, recargar y reconfigurar localmente. Se acepta el mismo modelo que el código de pairing, de 8 caracteres y 10 min.

## 4. Persistencia

Columnas nuevas en `ClockDevice` (migración `20261026120000_add_clock_device_maintenance_access`), sin tabla nueva:

| Columna | Tipo | Uso |
|---|---|---|
| `maintenanceCodeHash` | `TEXT NULL` | SHA-256 ligado al dispositivo del código vigente |
| `maintenanceCodeExpiresAt` | `TIMESTAMPTZ(3) NULL` | Vencimiento del código |
| `maintenanceCodeFailedAttempts` | `INTEGER NOT NULL DEFAULT 0` | Intentos fallidos contra el código vigente |
| `maintenanceSessionHash` | `TEXT NULL` | SHA-256 del token de la sesión vigente |
| `maintenanceSessionExpiresAt` | `TIMESTAMPTZ(3) NULL` | Vencimiento de la sesión |

CHECKs, que Prisma no modela:

- `ClockDevice_maintenance_code_shape_check`: hash y vencimiento del código, los dos o ninguno;
- `ClockDevice_maintenance_session_shape_check`: igual para la sesión;
- `ClockDevice_maintenance_active_only_check`: sólo un `ACTIVE` puede tener código o sesión.

**Por qué no una tabla nueva.** Hay como máximo un código y una sesión por equipo, y los dos son efímeros. Es el mismo caso que `pairingCodeHash`/`pairingExpiresAt`. La historia (quién generó, cuándo se usó, rechazos) ya queda en `AuditLog`. Una fila por equipo da la invalidación del código anterior y la limpieza al revocar sin joins ni barridos. Si algún día se necesitan varios accesos simultáneos o un historial consultable, se pasa a una tabla.

La migración es aditiva: no tiene backfill y no toca fichadas. El rollback (`backend/prisma/rollbacks/20261026120000_add_clock_device_maintenance_access.down.sql`) puede borrar las columnas, porque su contenido vence en minutos y la historia está en la auditoría.

## 5. Contrato

Rutas del dispositivo, bajo `/api/clock`. Todas exigen `Authorization: ClockDevice <id>.<secret>` de un `ACTIVE`:

| Método | Ruta | Guardas | Resultado |
|---|---|---|---|
| POST | `/maintenance/session` | IP → `requireClockDevice()` → 10/15 min por dispositivo → body `.strict()` `{ code: /^\d{6}$/ }` | `201 { token, expiresAt, expiresInSeconds, device }`, `Cache-Control: no-store`. Código inválido → `401 CLOCK_MAINTENANCE_CODE_INVALID` |
| GET | `/maintenance/session` | IP → `requireClockDevice()` → 30/5 min por dispositivo; header `X-Clock-Maintenance-Session` | `200 { expiresAt, expiresInSeconds, device, serverTime }`. Sesión inválida o vencida → `401 CLOCK_MAINTENANCE_SESSION_INVALID` |
| DELETE | `/maintenance/session` | Igual que GET | `204` siempre (idempotente). Borra la sesión sólo si el token coincide |

`device` es la vista de diagnóstico del propio equipo: `name`, `status`, `establishment { name, zone { name } }`, `activatedAt`, `lastSeenAt`, `lastAppVersion` y `connectivity`. No incluye id, IP, user-agent ni hashes.

Ruta RRHH (`Bearer` + Nivel 1):

| Método | Ruta | Resultado |
|---|---|---|
| POST | `/api/clock-devices/:id/maintenance-code` | `201 { code, expiresAt, expiresInSeconds }`, `Cache-Control: no-store`. Límite 10/5 min por usuario. No `ACTIVE` → `409 CLOCK_MAINTENANCE_DEVICE_NOT_ACTIVE`; inexistente → `404 CLOCK_DEVICE_NOT_FOUND` |

## 6. Auditoría

Entidad `ClockDeviceMaintenance`, con `entityId` = dispositivo. La descripción nombra al equipo, nunca su UUID:

| Evento | Acción | Actor |
|---|---|---|
| Código generado | `CREATE` | Usuario RRHH |
| Ingreso al modo mantenimiento | `LOGIN` | Dispositivo (`userId = NULL`, `after.actorClockDeviceId`) |
| Código rechazado con un código vigente | `REJECT`, con la anulación por exceso de intentos | Dispositivo |

Lo que **no** se audita:

- un rechazo sin código vigente: sólo se escribe el log `CLOCK_MAINTENANCE_CODE_REJECTED`, sin el código;
- las lecturas de la sesión;
- la salida manual y el vencimiento.

Así el dispositivo no puede llenar la auditoría con reintentos. Es el mismo criterio de F7 con las fichadas rechazadas: como mucho hay 5 rechazos auditados por código generado. Un 403 de un equipo revocado lo sigue auditando el `errorHandler` global (`REJECT Route`).

## 7. PWA

- **Gesto:** presionar 5 s el encabezado ("Fichador de personal"). Funciona con dedo, mouse o lápiz. Se cancela si se suelta o si el dedo se mueve más de 10 px, para no confundirlo con un desplazamiento. No da ninguna señal visual. Sólo está activo con el kiosco ocioso: sin cámara abierta ni fichada en curso.
- **"Acceso de mantenimiento":**
  - campo para el código numérico, "Ingresar" y "Cancelar";
  - no muestra pistas ni ids;
  - se cierra solo después de 60 s sin actividad, para no dejar el kiosco bloqueado.
  - Errores humanos:
    - "El código no es válido o ya venció.";
    - "No se pudo verificar el acceso. Revisá la conexión.";
    - con un 429, "Hay demasiados intentos. Esperá unos minutos y volvé a intentar.".
- **Modo mantenimiento:**
  - reemplaza la pantalla del fichador: nadie puede fichar mientras está abierto;
  - muestra dispositivo, aplicación y acciones;
  - la cuenta regresiva usa `expiresInSeconds` del servidor, nunca la hora absoluta del equipo;
  - refresca el diagnóstico cada 30 s con la pestaña visible;
  - un `401 CLOCK_MAINTENANCE_SESSION_INVALID` lo cierra.
- **Acciones:**
  - "Volver al fichador": sale y cierra la sesión en el servidor (best-effort; si no hay red, vence sola);
  - "Recargar aplicación";
  - "Reconfigurar dispositivo", con confirmación fuerte (§8).
- **Revocación en caliente:** el heartbeat (cada 60 s) o el refresco del diagnóstico (cada 30 s) recibe `403 CLOCK_DEVICE_REVOKED`. `clockDeviceSession` cierra la sesión y el Gate muestra "Dispositivo deshabilitado". El modo mantenimiento se desmonta y el token en memoria se descarta. El backend ya había limpiado la sesión al revocar.
- **Actualizaciones de la app:** mientras el acceso o el modo mantenimiento están abiertos, el kiosco cuenta como ocupado (`kioskActivity.hold`). Una versión nueva no recarga en medio de la revisión.

## 8. "Reconfigurar dispositivo"

Hoy, reconfigurar (`ClockDeviceGate.reset`) borra **sólo** la identidad local `{id, secret}` de IndexedDB y cierra la sesión operativa en memoria. No toca el backend: no revoca, no borra fichadas, intentos ni auditoría. El Gate vuelve a "Configurar este dispositivo".

Desde el modo mantenimiento se reutiliza exactamente ese `reset`. Antes se cierra la sesión de mantenimiento en el servidor. La confirmación pide escribir `RECONFIGURAR` y explica que:

- el equipo deja de estar vinculado y RRHH tiene que aprobarlo de nuevo;
- el registro anterior sigue figurando en Admin hasta que RRHH lo revoque, porque **la revocación sigue siendo sólo de Admin**.

## 9. Lo que hace la app y lo que hace el sistema operativo

| La aplicación | El sistema operativo (modo kiosco) |
|---|---|
| Pairing e identidad individual del dispositivo | Impedir cerrar la app |
| Heartbeat y conectividad en Admin | Impedir abrir otras apps |
| Modo mantenimiento con código temporal de RRHH | Impedir volver al escritorio |
| Reconfiguración local con confirmación | Autoarranque, cuando la plataforma lo soporte |
| Revocación desde Admin, efectiva en el siguiente request | Código o administración propios del sistema para salir del kiosco |

> El modo mantenimiento de la PWA **no reemplaza** el bloqueo kiosco del sistema operativo.

## 10. Fuera de alcance y pendientes

- Configuración real del modo kiosco en Android, Apple y ChromeOS, y pruebas físicas por plataforma (docs/fichador-kiosk/).
- Cámara al perder el foco (el comportamiento observado al cambiar de aplicación en Mac): se valida con kiosco real en dispositivos físicos, no en esta etapa.
- Workers, alertas y PERF-5G: sin cambios.
- La migración se aplica en `development`/staging con el pre-deploy (`prisma migrate deploy`) del próximo despliegue autorizado. **Antes de desplegar este código la migración tiene que estar aplicada**: sin las columnas, la revocación (escribe el estado de mantenimiento) y las rutas de mantenimiento fallan. El pre-deploy de Render (`PUBLIC_STAGING_PLAN.md` §4) ya garantiza ese orden. Producción y demo no se tocan.
