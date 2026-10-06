# Fichador como app independiente (PWA) — Etapa 1: diagnóstico y plan

> Estado: plan aprobado. **F0 cerrada para el entorno de desarrollo actual** (2026-10-06, ver [§18](#18-f0--implementación-y-resultado)); la medición de `TRUST_PROXY_HOPS` es requisito previo del primer deploy real del backend. F1 cerrada (2026-10-06, [§19](#19-f1--fichador-standalone-implementación)). **F2 cerrada a nivel de repositorio: READY FOR DEPLOY — validación real de infraestructura diferida** (2026-10-06, [§20](#20-f2--despliegue-independiente), decisión en §20.12); no bloquea el desarrollo local. F3 en adelante, en local.
> Los §1–§17 son el diagnóstico read-only original sobre `main @ 697968a` y describen el estado **previo** a F0 (por ejemplo, las rutas sin foto de §2 ya no existen).

---

## 0. Resumen ejecutivo

1. **El fichador ya es casi autocontenido en frontend**: 3 archivos propios (`TimeClockPage.tsx`, `FaceCaptureModal.tsx`, `timeClockApiService.ts`) + 5 dependencias chicas compartidas. Extraerlo es un **movimiento**, no una duplicación.
2. **El backend ya tiene una lógica de fichada sólida y reutilizable** (`clockPhotoPunchIdempotent` → `clockPhotoPunch`): timestamp de servidor, idempotencia por `requestId`, índice único "una jornada abierta por empleado", compensación de evidencia, auditoría. Lo que falta es **identidad**, no lógica.
3. **El modelo de seguridad actual es efectivamente público**: el "token de dispositivo" es un único secreto global (`CLOCK_DEVICE_TOKEN`) embebido en el bundle JS de la app administrativa, que se sirve sin login. Cualquiera que abra `gestion.*/fichador` puede extraerlo. Con él se puede: enumerar empleados activos con **DNI + legajo**, y **fichar entrada/salida de cualquier empleado sin foto** por endpoints legacy que el frontend ya no usa.
4. **`AttendancePunch.deviceId` y `kioskId` existen pero nunca se escriben**. No hay modelo de dispositivo. Hace falta `ClockDevice`.
5. **Rate limiting probablemente global**: Express no tiene `trust proxy`; detrás del proxy de Render todas las requests comparten IP → un único bucket de 30 req / 5 min para **todos** los kioscos. Un solo reintento de verificación (hasta 30 polls) puede agotarlo. La IP guardada en cada fichada probablemente es la del proxy.
6. **No hay nada de PWA** (sin manifest, sin service worker, sin íconos, sin `public/`). No hay `netlify.toml` en el repo (la configuración de deploy vive fuera del repo).

Recomendación: aprobar el plan F0–F15 de §17. F0 (higiene de backend, sin cambios de schema) se puede hacer ya y elimina los dos riesgos más graves sin esperar a la nueva app.

---

## 1. Mapa exacto del fichador actual

### 1.1 Frontend (`frontend/`)

| Archivo | Líneas | Rol | Destino |
|---|---|---|---|
| `src/pages/TimeClockPage.tsx` | 318 | Pantalla completa: búsqueda, estado, botones IN/OUT, orquestación del intento, verificación por polling | **Mover** a `fichador/` y reescribir sobre el nuevo API |
| `src/components/time-clock/FaceCaptureModal.tsx` | 275 | Cámara (`getUserMedia`), detección MediaPipe, brillo, captura JPEG + miniatura | **Mover** casi intacto (lógica de cámara reutilizable) |
| `src/services/api/timeClockApiService.ts` | 171 | 6 llamadas a `/time-entries/clock/*` con header `x-clock-device-token` | **Mover** y reescribir contra `/api/clock/*` |
| `src/pages/TimeClockPage.test.tsx` | 6 tests | Sin selector de concepto, payload IN/OUT, error de estado | **Mover** y ampliar |

Puntos de montaje y referencias en la app administrativa (a eliminar en el cutover):

- `src/App.tsx:38` — `lazy(() => import("./pages/TimeClockPage"))`
- `src/App.tsx:58` — ruta `/fichador` **sin login** (árbol no autenticado)
- `src/App.tsx:71` — ruta `/fichador` **dentro de `<AppShell>`** (con sidebar) si hay sesión
- `src/app/navigation.tsx:63` — link "Fichador" en el menú
- `.env*` — `VITE_CLOCK_DEVICE_TOKEN`
- `src/styles.css:1964-2246` — bloques `.clock-*` y `.face-*`

Dependencias compartidas que usa el fichador:

| Dependencia | Acoplamiento | Decisión |
|---|---|---|
| `services/api/apiClient.ts` (`apiRequest`, `ApiError`) | **Alto**: trae refresh de JWT, `sessionStorage` de tokens admin, mapa de ~90 códigos de error administrativos, evento global `app:api-error` | **No reutilizar.** El fichador tiene su propio cliente mínimo (~60 líneas) sin JWT |
| `components/ui/Button.tsx` (29), `Modal.tsx` (34), `LoadingState.tsx` (21) | Bajo, pero estilos pensados para escritorio denso | Reescribir versiones kiosco (targets táctiles grandes); son triviales |
| `utils/date.ts` (`formatDateTime`) | Bajo | Copiar la única función usada (formato Argentina) o pasar a módulo compartido (ver §5) |
| `styles.css` (tokens `:root`, `.button`, `.modal`, `.error`, `.eyebrow`) | Medio: 2566 líneas de CSS admin cargadas por el kiosco | Hoja propia en `fichador/` con los tokens de color/tipografía copiados conscientemente |
| `lucide-react`, `@mediapipe/tasks-vision` | Paquetes npm | Dependencias propias de `fichador/package.json` |
| `main.tsx`: `AuthProvider`, `ApiErrorNotice`, `AppDialogHost`, `BrowserRouter` | Envuelven al fichador hoy | **No** en la app nueva |

Timers y estados de `TimeClockPage`:

- reloj de pantalla: `setInterval` 1 s con hora del **dispositivo** (solo display);
- búsqueda: debounce 250 ms, mínimo 2 caracteres;
- intento: `requestId = crypto.randomUUID()` al tocar IN/OUT (`:119`, `:126`), reusado en reintento;
- "lento": aviso a los 4 s; timeout HTTP 20 s (`AbortSignal.timeout`);
- verificación tras error de red: polling a `/clock/attempts/:id` cada 1,5 s, **hasta 30 veces** (`:141-153`);
- si no se confirma: `attemptLocked` queda en `true` y la pantalla queda bloqueada con "avisá a RRHH" (`:191-201`) — **callejón sin salida hasta recargar**;
- jornada abierta > 20 h → habilita "Marcar nuevo ingreso".

Cámara (`FaceCaptureModal`):

- `getUserMedia({ facingMode: "user", 1280×720 })`, se abre por fichada y se cierra al confirmar/cancelar;
- MediaPipe BlazeFace cargado **en runtime desde CDNs de terceros** (`FaceCaptureModal.tsx:29-30`: `storage.googleapis.com` y `cdn.jsdelivr.net`);
- detección cada 220 ms, brillo < 42 → `LOW_LIGHT`, valida centrado y tamaño;
- captura foto 800 px q0.84 + miniatura 240 px q0.76 como data URL;
- envía `faceValidationStatus` calculado en el navegador (no verificado en servidor).

Autenticación actual del frontend del fichador: ninguna de usuario (`auth: false`), solo el header estático `x-clock-device-token` (`timeClockApiService.ts:9-12`).

### 1.2 Backend (`backend/`)

| Archivo | Rol |
|---|---|
| `src/modules/time-entries/timeEntries.routes.ts:35-53` | Router `/time-entries/clock/*`, rate limiter propio + `requireClockDeviceToken` |
| `src/middlewares/clockDeviceAuth.ts` | Comparación `timingSafeEqual` contra `env.CLOCK_DEVICE_TOKEN` (falla cerrado en production si falta) |
| `src/modules/time-entries/timeEntries.controller.ts:15-80` | 9 handlers de clock |
| `src/modules/time-entries/timeEntries.service.ts` | `clockSearch`, `clockStatusByEmployee`, `clockPunchAttemptStatus` (`:1254`), `clockPhotoPunchIdempotent` (`:1277`), `clockPhotoPunch` (`:1338`), legacy `clockIn/Out*` (`:1598-1729`), `clockAttemptHash` (`:709`), almacenamiento de evidencia (`:589`) |
| `src/modules/time-entries/timeEntries.repository.ts` | `searchEmployeesForClock` (`:1322`), `findClockValidationContext` (`:1372`), `createOpenWorkShift`/`rolloverExpiredOpenWorkShift`/`closeOpenWorkShift`, `createClockPunchAttempt` (`:498`), `punchEvidenceData` (`:177`) |
| `src/modules/time-entries/timeEntries.schemas.ts:108-152` | Zod: `clockByDniSchema`, `clockByEmployeeSchema`, `clockEmployeeSearchQuerySchema`, `clockPhotoPunchSchema` |
| `src/modules/time-entries/clockPunchMaintenance.ts` | Scheduler de 60 s: expira intentos `PROCESSING`, retención 30 días, jobs de inactividad (reutilizable para limpiar enrolamientos vencidos) |
| `scripts/clock-staging-matrix.ts` | Matriz de staging: usa **solo** `photo-punch` y `attempts` |

---

## 2. Rutas actuales

Todas bajo `/api/time-entries/clock`, montadas **antes** de `requireAuth`, con `clockRateLimiter` (30 req / 5 min por IP) + `requireClockDeviceToken`:

| Método y ruta | ¿La usa el frontend? | Qué hace | Observación |
|---|---|---|---|
| `GET /clock/employees?search=` | Sí | Busca activos por nombre/apellido (`contains`, 12 resultados) | Devuelve **DNI + legajo** |
| `POST /clock/status` `{employeeId}` | Sí | Jornada abierta + `hourConcepts` | `hourConcepts` ya no se usa en UI |
| `POST /clock/photo-punch` | Sí | Fichada con foto, idempotente | Camino oficial |
| `GET /clock/attempts/:requestId?employeeId=` | Sí | Estado del intento | |
| `POST /clock/in` `{employeeId}` | **No** | Ingreso **sin foto** | Legacy, sin idempotencia, sin auditoría |
| `POST /clock/out` `{employeeId}` | **No** | Salida **sin foto** | Ídem |
| `POST /clock/status-by-dni` `{dni}` | **No** | Estado por DNI | Legacy |
| `POST /clock/in-by-dni` `{dni}` | **No** | Ingreso **sin foto por DNI** | Legacy |
| `POST /clock/out-by-dni` `{dni}` | **No** | Salida **sin foto por DNI** | Legacy |

No existe ningún endpoint `/api/clock/*` ni nada relacionado con dispositivos.

---

## 3. Modelo de seguridad actual

**Cómo se protege `/fichador` (frontend):** no se protege. Es una ruta pública de la SPA administrativa. Si no hay sesión renderiza solo el fichador; si hay sesión RRHH en esa pestaña, lo renderiza **dentro del layout administrativo con sidebar**. Cualquier otra URL sin sesión muestra el `LoginPage` administrativo.

**Cómo se protege el backend:** un secreto compartido global (`x-clock-device-token`), igual para todos los kioscos, embebido en el chunk JS de `TimeClockPage` (que el bundle admin sirve públicamente). En dev/test/demo sin configurar, pasa todo (con warning).

**Reutilización de credenciales administrativas:** hoy no hay cruce: los endpoints admin exigen `Authorization: Bearer <JWT>` (`middlewares/auth.ts`) y no aceptan el token de kiosco; los `/clock/*` no leen el JWT. Esa separación natural hay que **preservarla y testearla** en la arquitectura nueva.

**Sesión compartida:** la autenticación admin no usa cookies (no hay `cookie-parser`); el JWT y el refresh viven en `sessionStorage` del origen `gestion.*` (`apiClient.ts:206-220`). Hoy el fichador comparte ese origen. Con un subdominio propio, el almacenamiento queda **aislado por origen** automáticamente.

**¿El frontend del fichador carga módulos administrativos?** Sí, parcialmente: el chunk principal incluye `AuthProvider`, `AppShell`, `navigation`, `LoginPage` y las 2566 líneas de CSS admin. Las páginas admin son lazy y no se descargan salvo navegación, pero las rutas existen.

---

## 4. Riesgos (estado actual)

| # | Riesgo | Severidad | Evidencia |
|---|---|---|---|
| R1 | Token de kiosco efectivamente público (bundle de un sitio sin login) | **Alta** | `timeClockApiService.ts:10`, `SECURITY_STANDARDS.md:72` lo reconoce |
| R2 | Fichar entrada/salida de cualquier empleado **sin foto** con `curl` (endpoints legacy por `employeeId` o DNI) | **Alta** | `timeEntries.routes.ts:47-48,51-53`; sin consumidores en frontend ni scripts |
| R3 | Enumeración de empleados activos con DNI y legajo (2 letras → 12 resultados) | **Alta** (PII) | `repository.ts:1322-1354`, `service.ts:1228` |
| R4 | Sin identidad de dispositivo: imposible saber qué kiosco fichó o revocar uno solo | Alta | `deviceId`/`kioskId` sin escrituras (grep vacío) |
| R5 | Rate limit probablemente global (sin `trust proxy` detrás de Render) → un actor o un pico de cambio de turno bloquea **todos** los kioscos; la IP auditada sería la del proxy | Alta (operativa) | `app.ts` sin `trust proxy`; `requestAuditContext` usa `req.ip`. **Verificar** en logs de Render (`ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`) |
| R6 | El polling de verificación (hasta 30 req) consume el mismo bucket de 30 req | Media | `TimeClockPage.tsx:141-153` |
| R7 | Pantalla bloqueada tras intento no confirmado (requiere recargar) | Media (UX) | `TimeClockPage.tsx:191-205` |
| R8 | La respuesta de salida devuelve `entries` y `timeSegments` internos al kiosco y los persiste en `ClockPunchAttempt.response` | Media | `service.ts:1583-1584` |
| R9 | `express.json({limit: "40mb"})` global se parsea **antes** de la autenticación del kiosco | Media | `app.ts` |
| R10 | Validación facial reportada por el cliente | Media (conocido) | `service.ts:1344-1349`, `SECURITY_STANDARDS.md:57` |
| R11 | MediaPipe se baja de CDNs de terceros en cada uso: disponibilidad, CSP, cadena de suministro, incompatible con PWA offline-shell | Media | `FaceCaptureModal.tsx:29-30` |
| R12 | Kiosco expone el login administrativo y, si alguien inicia sesión en esa pestaña, la navegación admin completa | Media | `App.tsx:54-71` |
| R13 | Auditoría de fichada diferida con `setTimeout(500).unref()` → se pierde si el proceso cae; actor nulo (no hay usuario ni dispositivo) | Baja | `service.ts:696-707`; deuda §10 de `PERFORMANCE_STANDARDS.md` para caminos legacy |
| R14 | Sin cooldown: ingreso y salida del mismo empleado con segundos de diferencia generan una jornada de 0 min | Baja hoy; **Alta con reconocimiento facial automático** | `clockPhotoPunch` sólo bloquea doble ingreso abierto |

---

## 5. Archivos reutilizables

**Backend — se reutiliza tal cual (núcleo de la fichada, no se duplica):**

- `timeEntriesService.clockPhotoPunchIdempotent` / `clockPhotoPunch` / `clockPunchAttemptStatus`: se les agrega un parámetro `deviceContext` (id del dispositivo) y nada más. El nuevo módulo `clock` es una **capa de transporte** sobre ellos.
- Repositorio: `createOpenWorkShift`, `rolloverExpiredOpenWorkShift`, `closeOpenWorkShift`, `punchEvidenceData` (se extiende con `deviceId`), `createClockPunchAttempt`.
- `storeClockPunchPhoto`, `scheduleClockThumbnail`, `cleanupClockEvidence`, `decodeClockPhoto`.
- `clockPhotoPunchSchema` (base del nuevo schema, sin `employeeId` en la ruta de estado).
- `clockPunchMaintenance.ts` (scheduler de 60 s): se le suma la limpieza de enrolamientos vencidos sin crear otro `setInterval`.
- `createRateLimiter` (se le agrega `keyGenerator`).
- `shared/datetime/argentinaTime.ts`.

**Frontend:**

- `FaceCaptureModal.tsx`: la lógica de cámara/detección/captura se mueve intacta; solo cambian imports de UI.
- La lógica de orquestación de intento de `TimeClockPage` (requestId por intención, verificación) se reescribe sobre la nueva API, conservando la semántica.
- `utils/date.ts → formatDateTime`: una función; se copia al fichador (ver decisión de compartición abajo).

**Decisión sobre código compartido entre `frontend/` y `fichador/`:** **no crear paquete compartido en esta iniciativa.** Motivos:

1. Al terminar la migración, el código de fichada **sale** de `frontend/` (se borra), así que no queda duplicado: es un movimiento.
2. El único candidato real (`apiClient`) es justamente lo que el fichador **no** debe heredar (JWT, refresh, errores admin).
3. Lo que queda en común (tokens de color, `formatDateTime`, un `ApiError` de 10 líneas) no justifica workspaces/aliases entre apps con builds de Netlify independientes.

Si a futuro aparece código compartido sustancial (por ejemplo, el contrato de tipos del API de clock), la opción preferida es `shared/` en la raíz importado vía alias de Vite + `paths` de TS, sin npm workspaces. No se hace ahora.

## 6. Archivos a extraer / eliminar de la app administrativa

Se eliminan de `frontend/` **en el cutover (F12)**, no antes:

- `src/pages/TimeClockPage.tsx`, `src/pages/TimeClockPage.test.tsx`
- `src/components/time-clock/FaceCaptureModal.tsx`
- `src/services/api/timeClockApiService.ts`
- `App.tsx:38,58,71`, `navigation.tsx:63` (reemplazar el link por uno externo a `fichador.*` o quitarlo)
- `styles.css:1964-2246` (bloques `.clock-*`/`.face-*`)
- `@mediapipe/tasks-vision` de `frontend/package.json` (verificar que nada más lo importe)
- `VITE_CLOCK_DEVICE_TOKEN` de `.env.example` y del sitio de Netlify

Backend, también en el cutover: router `/time-entries/clock/*`, `clockDeviceAuth.ts` (+ test), `CLOCK_DEVICE_TOKEN` de `env.ts`, sección "Public clock endpoints" de `SECURITY_STANDARDS.md`.

Los endpoints legacy **sin foto** (`/clock/in`, `/clock/out`, `/*-by-dni`) y sus servicios `clockIn*`/`clockOut*`/`clockInResolved`/`clockOutResolved` se eliminan **ya en F0** (sin consumidores). Antes de borrar los servicios, confirmar que ningún otro módulo los invoque (hoy solo los usa el controller y tests).

---

## 7. Modelo `ClockDevice` propuesto

```prisma
enum ClockDeviceStatus {
  PENDING   // registrado, esperando aprobación de RRHH
  ACTIVE    // puede fichar
  REVOKED   // revocado; terminal, nunca vuelve a ACTIVE
}

model ClockDevice {
  id                String            @id @default(uuid())
  name              String?           // lo pone RRHH al aprobar; null mientras PENDING
  establishmentId   String?           // ubicación física (ver nota)
  status            ClockDeviceStatus @default(PENDING)
  tokenHash         String            @unique   // SHA-256 hex del deviceSecret
  pairingCode       String?           @unique   // "J7K4P9QR"; null después de aprobar
  pairingExpiresAt  DateTime?         @db.Timestamptz(3)
  activatedAt       DateTime?         @db.Timestamptz(3)
  activatedByUserId String?
  revokedAt         DateTime?         @db.Timestamptz(3)
  revokedByUserId   String?
  lastSeenAt        DateTime?         @db.Timestamptz(3)
  lastIp            String?
  lastUserAgent     String?
  lastAppVersion    String?
  createdAt         DateTime          @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime          @updatedAt @db.Timestamptz(3)

  establishment Establishment?      @relation(fields: [establishmentId], references: [id], onDelete: SetNull)
  activatedBy   User?               @relation("ClockDeviceActivatedBy", fields: [activatedByUserId], references: [id], onDelete: SetNull)
  revokedBy     User?               @relation("ClockDeviceRevokedBy", fields: [revokedByUserId], references: [id], onDelete: SetNull)
  punches       AttendancePunch[]
  attempts      ClockPunchAttempt[]

  @@index([status])
  @@index([establishmentId])
}
```

Cambios en modelos existentes:

- `AttendancePunch.deviceId` → FK a `ClockDevice` (`onDelete: Restrict`), con `@@index([deviceId, timestamp])`. Verificar en staging que toda la columna esté en `NULL` antes de agregar la FK (el código nunca la escribe).
- `AttendancePunch.kioskId` → **eliminar** en una migración posterior (sin uso; verificar `NULL` en staging).
- `ClockPunchAttempt.deviceId String?` → FK a `ClockDevice` (`onDelete: Restrict`), para atar el intento al dispositivo y que un dispositivo no pueda consultar intentos de otro.
- `WorkShiftSource`: las fichadas de dispositivo enrolado usan el valor **`KIOSK`** que ya existe en el enum, sin uso y ya rotulado "Kiosco" en `AttendancePage.tsx:72` y `auditLabels.ts:104`. Ningún código ramifica lógica por `PUBLIC_CLOCK_PHOTO` (solo labels), así que distinguir legacy vs. dispositivo no requiere enum nuevo.

Campos evaluados y **descartados**:

| Campo | Motivo |
|---|---|
| `code` | Duplica identificación: `pairingCode` resuelve el enrolamiento, `name` la identificación humana, `id` la técnica. Un tercer identificador obliga a mantener unicidad y formato sin uso concreto |
| `registeredAt` | Es `createdAt` |
| `lastTokenRotationAt` | No hay rotación automática en v1. Si un secreto se compromete: revocar y re-enrolar (1 minuto de RRHH). La rotación en caliente requiere handover en dos fases para no dejar kioscos bloqueados; no se justifica todavía |
| `revokeReason` | Va en la descripción del `AuditLog` de la revocación |
| `sectorId` | Un kiosco está en un lugar físico (= `Establishment` en la cadena Company → BU → Establishment → Area → Sector), no en un sector funcional. `establishmentId` es opcional y en v1 **no** se usa para autorización (solo panel y trazabilidad). Si RRHH no lo va a cargar, se puede omitir también |
| estado `EXPIRED` | Un PENDING vencido no tiene historial: se **borra físicamente** en el job de mantenimiento; el kiosco vuelve a registrarse |

Campo incluido que no estaba en la propuesta original: `lastAppVersion` — en PWA de iOS un service worker viejo puede quedar sirviendo una versión desactualizada durante días; el panel necesita verlo.

Reglas: un dispositivo `ACTIVE` o `REVOKED` con fichadas **nunca** se borra (consistente con la política de historial del repo); solo se revoca. Un `PENDING` puede borrarse.

---

## 8. Flujo de enrolamiento

```
iPad (PWA instalada)                Backend                         RRHH (gestion.*)
────────────────────                ───────                         ────────────────
1. abre fichador.*; IndexedDB vacío
2. POST /api/clock/device/register ─► crea ClockDevice PENDING
                                     genera deviceId, deviceSecret,
                                     pairingCode, expira en 10 min
   ◄─ {deviceId, deviceSecret, pairingCode, pairingExpiresAt}
3. guarda {deviceId, deviceSecret} en IndexedDB
4. muestra "Dispositivo no registrado / Código J7K4-P9QR / vence en 9:59"
5. polling GET /api/clock/device/status (cada 3 s, con su credencial)
                                                                    6. Configuración → Dispositivos
                                                                       → "Aprobar dispositivo"
                                                                       ingresa J7K4-P9QR + nombre
                                                                       (+ establecimiento)
                                     7. UPDATE ... WHERE status=PENDING ◄─ POST /api/clock-devices/approve
                                        AND pairingCode=? AND pairingExpiresAt>now()
                                        → ACTIVE, pairingCode=NULL, activatedAt/By
                                        + AuditLog
8. status → ACTIVE ◄──────────────────
9. entra a la pantalla de fichada; en adelante arranca directo
```

Decisiones:

- **Quién genera el secreto:** el backend (`crypto.randomBytes(32)`, base64url, 43 caracteres) y lo devuelve **una sola vez** en la respuesta de `register`. El secreto ya existe en el dispositivo desde el paso 3, pero es **inerte** hasta la aprobación. Así "entregar la credencial definitiva" no requiere un segundo canal ni un endpoint de "retiro de token" (que sería otra ventana de ataque): aprobar = cambiar `status`.
- **Código:** 8 caracteres de alfabeto Crockford base32 sin ambiguos (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`), generado con `crypto.randomInt`, mostrado como `XXXX-XXXX`, normalizado al ingresar (mayúsculas, sin guion, `O→0`, `I/L→1`). Espacio 32⁸ ≈ 10¹²; colisión entre PENDING imposible en la práctica y además bloqueada por el `@unique`.
- **Duración:** 10 minutos. Si vence, el kiosco muestra "Código vencido — generar nuevo" y vuelve a `register` (registro nuevo; el viejo lo borra el job).
- **Evitar reutilización:** el `UPDATE` condicional es atómico (`count === 1` o error) y pone `pairingCode = NULL`. Un código aprobado o vencido no matchea nunca más.
- **Spam de registros:** `register` es público → rate limit propio por IP (por ejemplo 5 / 10 min) + tope global de PENDING simultáneos (por ejemplo 20; si se excede, `429`) + borrado de PENDING vencidos en el scheduler existente.
- **Ingeniería social** ("aprobame el código X" desde un teléfono ajeno): RRHH solo aprueba códigos que ve físicamente en el dispositivo. El panel muestra IP, user agent y antigüedad del PENDING para contrastar. Documentarlo en el instructivo del panel.
- **iOS — punto crítico:** una web app agregada a la pantalla de inicio tiene **almacenamiento separado de Safari**. Si se enrola en Safari y después se instala, la app instalada arranca sin credencial. La app debe detectar si corre standalone (`matchMedia("(display-mode: standalone)")` / `navigator.standalone`) y, si no, mostrar "Instalá la app desde Compartir → Agregar a inicio" **antes** de permitir el enrolamiento (con override de desarrollo).
- **Revocación:** `POST /api/clock-devices/:id/revoke` → `REVOKED`, `revokedAt/By`, `AuditLog`. Efecto inmediato: el middleware consulta la DB en cada request (lookup por PK; volumen bajo; **sin caché**). El kiosco recibe `403 CLOCK_DEVICE_REVOKED`, borra la credencial local y muestra "Dispositivo revocado"; puede volver a registrarse (queda PENDING, requiere aprobación nueva).

---

## 9. Estrategia de token

**Formato:** `Authorization: ClockDevice <deviceId>.<deviceSecret>`

- `deviceId`: UUID público (permite buscar por PK y loguear qué dispositivo falla sin exponer el secreto).
- `deviceSecret`: 256 bits aleatorios, base64url.
- Usar el header `Authorization` con un esquema propio da aislamiento gratis: `requireAuth` exige `Bearer ` y rechaza `ClockDevice` con 401; `requireClockDevice` rechaza `Bearer`.

**En backend:** se guarda solo `tokenHash = SHA-256(deviceSecret)`. Con 256 bits de entropía, bcrypt/argon2 no aportan (esos sirven para contraseñas de baja entropía) y agregarían latencia a cada fichada. La comparación se hace con `crypto.timingSafeEqual` sobre los hashes. El secreto en claro nunca se loguea (agregarlo a `piiRedaction` / `requestLogger`).

**En el dispositivo — opciones evaluadas:**

| Opción | Persistencia en PWA iOS | Exposición a XSS | Veredicto |
|---|---|---|---|
| Cookie `HttpOnly` | Requiere API en el mismo sitio (`api.empresa.com`). Si es CNAME a Render, ITP lo trata como cloaking y **limita la cookie a 7 días**. Agrega CSRF. El jar de cookies de la PWA también está separado de Safari | Baja | Descartada: frágil en iOS para una credencial de larga vida |
| `localStorage` | Sobrevive reinicios. Las web apps de pantalla de inicio están exentas del borrado de 7 días de ITP | Alta (cualquier script del origen la lee) | Aceptable |
| **IndexedDB** | Igual que `localStorage` | Igual que `localStorage` | **Elegida** |
| WebCrypto `CryptoKey` no exportable en IndexedDB + requests firmados | Igual | XSS puede **usar** la clave pero no **exfiltrarla** | Mejor seguridad, pero requiere firma por request, nonce y anti-replay. Queda como evolución en hardening (F12), con el mismo modelo `ClockDevice` (`tokenHash` → `publicKey`) |

Se elige IndexedDB (wrapper mínimo de ~30 líneas, sin librería) porque es el mismo lugar donde viviría una futura `CryptoKey` no exportable, así que la migración a firma no cambia el almacenamiento. Además:

- al enrolar, llamar `navigator.storage.persist()` (Safari 17+) para pedir que no se desaloje bajo presión de espacio;
- **recuperación:** si el almacenamiento se pierde, el kiosco simplemente vuelve a la pantalla de registro; RRHH aprueba de nuevo y revoca el registro viejo. Es una operación de un minuto, no un incidente;
- la mitigación real contra XSS es la superficie mínima: app chica, sin scripts de terceros (MediaPipe self-hosted), CSP estricta (§12).

No se usan IMEI, MAC, serial ni fingerprinting: Safari no los expone de forma fiable y no hacen falta.

---

## 10. Endpoints

**Namespace del dispositivo — `/api/clock/*`** (nuevo módulo `backend/src/modules/clock/`, capa de transporte sobre `time-entries`):

| Método y ruta | Auth | Rate limit | Respuesta |
|---|---|---|---|
| `POST /api/clock/device/register` | Pública | Por IP, 5 / 10 min + tope global de PENDING | `{deviceId, deviceSecret, pairingCode, pairingExpiresAt}` |
| `GET /api/clock/device/status` | Dispositivo `PENDING` o `ACTIVE` | Por dispositivo | `{status, name, pairingCode?, pairingExpiresAt?, serverTime}` |
| `POST /api/clock/device/heartbeat` | `ACTIVE` | Por dispositivo | `{status, serverTime}`; body `{appVersion}` |
| `GET /api/clock/employees?search=` | `ACTIVE` | Por dispositivo | `[{id, legajo, name, dniMasked}]` (ver nota) |
| `GET /api/clock/employees/:id/status` | `ACTIVE` | Por dispositivo | `{employee, openShift: {startAt} \| null}` (sin `hourConcepts`) |
| `POST /api/clock/punches` | `ACTIVE` | Por dispositivo | Resultado de fichada **recortado** (sin `entries`/`timeSegments`) |
| `GET /api/clock/punches/:requestId` | `ACTIVE` | Por dispositivo | Estado del intento; 404 si el intento es de otro dispositivo |

Notas:

- **Un solo endpoint de fichada** (`POST /api/clock/punches`, foto obligatoria) en lugar de `/punch` + `/photo-punch`. No existe camino sin foto en el namespace nuevo. El reconocimiento facial futuro agrega campos al mismo endpoint.
- `GET` para estado (es una lectura; hoy es `POST`).
- `dniMasked`: el kiosco necesita distinguir homónimos; legajo + últimos 3 dígitos del DNI (`***.***.678`) alcanzan sin exponer el DNI completo.
- No se agrega endpoint de "renovar código": si vence, se vuelve a registrar.

**Namespace administrativo — `/api/clock-devices/*`** (JWT + rol RRHH; **no** bajo `/api/clock`, para que los dos middlewares nunca se mezclen en un mismo router):

| Método y ruta | Uso |
|---|---|
| `GET /api/clock-devices` | Listado con conectividad derivada (§13) |
| `POST /api/clock-devices/approve` `{pairingCode, name, establishmentId?}` | Aprobación |
| `PATCH /api/clock-devices/:id` `{name?, establishmentId?}` | Renombrar o reubicar |
| `POST /api/clock-devices/:id/revoke` | Revocación |
| `DELETE /api/clock-devices/:id` | Solo para `PENDING` (409 en cualquier otro estado) |

Todas las escrituras administrativas pasan por `auditService.register` con `userId`.

Según CLAUDE.md, el módulo nuevo se documenta en `BACKEND_API_CONTRACTS.md`, `ARCHITECTURE_STANDARDS.md` y `PROJECT_CONTEXT.md` en el mismo cambio.

---

## 11. Middleware `requireClockDevice`

```ts
requireClockDevice({ allowPending?: boolean }): RequestHandler
```

1. Parsear `Authorization: ClockDevice <uuid>.<base64url43>`; formato inválido → `401 CLOCK_DEVICE_UNAUTHORIZED`.
2. `prisma.clockDevice.findUnique({ where: { id } })` (vía repositorio del módulo); no existe → `401 CLOCK_DEVICE_UNAUTHORIZED`.
3. `timingSafeEqual(sha256(secret), tokenHash)`; distinto → `401 CLOCK_DEVICE_UNAUTHORIZED`.
4. `REVOKED` → `403 CLOCK_DEVICE_REVOKED`.
5. `PENDING` y `!allowPending` → `403 CLOCK_DEVICE_PENDING`.
6. `req.clockDevice = { id, name, establishmentId, status }` (augmentación de tipos de Express; **nunca** setea `req.user`).
7. Toque de presencia con throttle: si `lastSeenAt` tiene más de 60 s, `UPDATE lastSeenAt, lastIp, lastUserAgent` sin bloquear la respuesta (con `catch` logueado).

Reglas asociadas:

- El kiosco **solo** borra su credencial local ante `CLOCK_DEVICE_REVOKED` o `CLOCK_DEVICE_UNAUTHORIZED` confirmados. Nunca ante 5xx o error de red: un bug transitorio no debe forzar re-enrolar todos los kioscos.
- `trust proxy` con el número de saltos **medido** en el deploy real (`TRUST_PROXY_HOPS`, implementado en F0, ver §18.5). No se toma ningún valor de documentación ni de ejemplos externos: un valor incorrecto deja la IP del proxy o permite falsificarla vía `X-Forwarded-For`.
- Rate limiter de dispositivo con `keyGenerator: req => req.clockDevice.id`, montado **después** del middleware. Por IP solo para `register`.
- Body parser: montar el router `/api/clock` **antes** del `express.json({limit: "40mb"})` global, con su propio parser de 6 MB aplicado **después** de `requireClockDevice` (en `register`, 1 KB). Así nadie no autenticado sube 40 MB.
- **Aislamiento a testear explícitamente** (supertest sobre `createApp()`): credencial de dispositivo contra `/employees`, `/users`, `/workforce`, `/hour-concepts`, `/audit`, `/clock-devices` → 401; JWT válido de RRHH contra `/api/clock/punches` → 401.

---

## 12. PWA

Estado actual: no existe nada (sin `public/`, sin manifest, sin service worker, sin íconos, `index.html` sin metas de iOS).

Lo necesario en `fichador/`:

- `manifest.webmanifest`: `name`, `short_name: "Fichador"`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`, `orientation` (definir con piloto: probablemente `portrait`), `background_color`/`theme_color`, íconos 192/512 + `maskable`.
- `index.html`: `<link rel="apple-touch-icon" sizes="180x180">`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `viewport-fit=cover` + `env(safe-area-inset-*)` en CSS.
- Service worker con `vite-plugin-pwa` (Workbox `generateSW`):
  - precache del app shell **y de MediaPipe** (WASM + `.tflite` self-hosted en `public/mediapipe/`, versión fijada), así la cámara no depende de CDNs de terceros;
  - `/api/*` en **NetworkOnly** (nunca cachear respuestas de fichada ni estado);
  - actualización: `registerType: "autoUpdate"` + recarga automática solo cuando el kiosco está ocioso (sin modal abierto ni intento en curso). Un kiosco no tiene a quién preguntarle "¿actualizar?".
- Instalabilidad en iOS: no existe `beforeinstallprompt`; mostrar instrucciones de "Agregar a inicio" cuando no corre standalone (ver §8).
- Kiosco: Screen Wake Lock API (Safari 16.4+) para que la pantalla no se apague; documentar "Acceso guiado" de iOS para bloquear el iPad dentro de la app.
- **A validar en el piloto:** en web apps standalone de iOS el permiso de cámara puede volver a pedirse tras relanzar la app según la versión de iOS. Medirlo en el iPad real antes de decidir si la cámara queda abierta permanentemente o se abre por fichada (hoy se abre por fichada).

---

## 13. Heartbeat y conectividad

- Cada **2 min** mientras la app está visible, más uno inmediato en `visibilitychange → visible` y en el evento `online`.
- Body `{appVersion}`; respuesta `{status, serverTime}`. Con `serverTime` el kiosco calcula el desfasaje y muestra un reloj corregido. El reloj del dispositivo nunca es autoridad.
- Si la respuesta es `REVOKED` → pantalla de revocado.
- Conectividad derivada **al leer** (no se persiste un estado):
  - **En línea:** `lastSeenAt` ≤ 5 min;
  - **Visto recientemente:** ≤ 60 min;
  - **Sin conexión:** > 60 min o nunca.
  - Umbrales como constantes del módulo, no como env vars, hasta que haya una necesidad real.
- iOS suspende JS con la pantalla apagada o la app en segundo plano: el heartbeat se detiene. Por eso el Wake Lock y el Acceso guiado son parte de la operación, no opcionales.
- Efecto secundario: un ping cada 2 min mantiene despierta la instancia de Render (evita cold starts en la primera fichada del día). Considerarlo en el costo del plan de Render.

---

## 14. Timestamp, idempotencia y offline

### 14.1 Timestamp — confirmado

La hora oficial **ya** sale del servidor: `const now = new Date()` en `clockPhotoPunch` (`service.ts:1343`), tomada al procesar la request y **antes** de subir la foto. El schema de entrada no acepta ningún timestamp del cliente. Se persiste en columnas `TIMESTAMPTZ`. Se mantiene igual. En el contrato nuevo: no se acepta ninguna hora del cliente, y la pantalla de confirmación muestra la hora que devuelve el servidor.

### 14.2 Idempotencia — estado actual

- `ClockPunchAttempt.requestId @unique` + `requestHash` (SHA-256 de empleado, tipo, concepto, estado facial, score, **foto y miniatura**).
- Mismo `requestId` y mismo payload → devuelve el resultado guardado (`COMPLETED`), el error guardado (`FAILED`) o `409 CLOCK_ATTEMPT_PROCESSING`.
- Mismo `requestId` y payload distinto → `409 CLOCK_IDEMPOTENCY_KEY_REUSED`.
- `PROCESSING` con más de 60 s → `FAILED` por timeout al consultarlo; el scheduler también los expira; retención de 30 días.
- Defensa de base de datos: índice único parcial `WorkShift_one_open_per_employee` (doble ingreso concurrente → 409 limpio); `WORK_SHIFT_ALREADY_CLOSED` (doble salida → 409).

### 14.3 Qué falta y propuesta

| Caso | Hoy | Propuesta |
|---|---|---|
| Doble click | `submitGuardRef` + botón deshabilitado + `requestId` por intención | Se mantiene |
| Reintento de red | Polling hasta 30 veces; si el intento **nunca llegó** al servidor (404 constante), pantalla bloqueada | Tras 2 respuestas 404, **reenviar el mismo payload con el mismo `requestId`** (seguro por la idempotencia; la foto capturada se conserva en memoria). Máximo 3 reenvíos y luego mensaje claro **sin bloquear** el kiosco |
| Polling consume el rate limit | Bucket compartido | Rate limit por dispositivo (§11) con un presupuesto que contemple la verificación |
| Dos fichadas idénticas en segundos (IN→IN) | Bloqueado por el índice único | Se mantiene |
| IN→OUT u OUT→IN del mismo empleado en segundos | **Permitido** (jornada de 0 min) | **Cooldown en backend**: si la última `AttendancePunch` válida del empleado tiene menos de `CLOCK_PUNCH_COOLDOWN_SECONDS` (default 60), responder `409 CLOCK_PUNCH_COOLDOWN` con "Ya registraste tu ingreso a las 08:01". Se evalúa dentro del flujo existente, antes de guardar la foto |
| Doble detección (reconocimiento automático futuro) | — | Cooldown de backend + ventana de supresión en cliente por empleado reconocido |
| Intento consultado desde otro kiosco | Requiere `employeeId` en query | El intento se ata a `deviceId`; otro dispositivo recibe 404 |

`requestId` sigue siendo UUID v4 global único; no hace falta unicidad compuesta con `deviceId`.

### 14.4 Offline — v1 no ficha sin conexión

- Estado "Sin conexión" si falla el heartbeat **o** `navigator.onLine === false` (en iOS `onLine` no es fiable por sí solo; el heartbeat manda).
- Con "Sin conexión" los botones de fichada quedan deshabilitados y se muestra un banner claro con el último contacto exitoso.
- El service worker nunca encola requests de `/api/*`.
- **Futuro, fuera de alcance:** una cola offline necesita hora confiable sin servidor (timestamp firmado por dispositivo con desfasaje conocido), reconciliación contra jornadas abiertas/cerradas por otros caminos y una política de RRHH para fichadas tardías. Es una etapa propia.

---

## 15. Deploy

**Situación actual:** en el repo no hay `netlify.toml`, `_redirects` ni `_headers`; la configuración de Netlify (build, SPA fallback, env) vive en la UI. El backend está en Render y la base en Neon. `vite.config.ts` no tiene proxy: el frontend llama directo a `VITE_API_URL`. CORS es una allowlist explícita (`CORS_ORIGIN`, separada por comas, `credentials: true`).

**Propuesta:**

```
Netlify sitio "gestion"   base: frontend/   → gestion.empresa.com
Netlify sitio "fichador"  base: fichador/   → fichador.empresa.com
Render  backend único                        → api.empresa.com (dominio propio recomendado)
Neon    base única
```

- Un `netlify.toml` versionado **en cada base** (`frontend/netlify.toml`, `fichador/netlify.toml`): `command = "npm run build"`, `publish = "dist"`, fallback SPA `/* → /index.html 200`, y `ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- ."` para no rebuildear un sitio cuando solo cambió el otro.
- Headers del fichador (en su `netlify.toml`):
  - `Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://api.empresa.com; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; frame-ancestors 'none'` (MediaPipe necesita `'wasm-unsafe-eval'`);
  - `Permissions-Policy: camera=(self), microphone=(), geolocation=()`;
  - `Cache-Control: no-cache` para `sw.js` y `manifest.webmanifest`.
- Variables de entorno del fichador: solo `VITE_API_URL` y `VITE_APP_ENV`. **Ningún secreto en el bundle.**
- Backend: `CORS_ORIGIN=https://gestion.empresa.com,https://fichador.empresa.com` (más los equivalentes de staging). Puerto local del fichador: 5175 (5174 ya lo usa la app admin; agregarlo a `.env` local de CORS).
- CI (`.github/workflows/ci.yml`): job `fichador` con `npm ci`, `test` y `build`, igual que `frontend`.
- Staging primero: `fichador-staging` contra el backend de staging. Producción no se toca hasta F14.

---

## 16. Migración progresiva y riesgos técnicos

### 16.1 Convivencia

1. **F0:** se retiran los endpoints sin foto. El `/fichador` actual sigue funcionando (usa solo `photo-punch` y `attempts`).
2. **F1–F3:** la app nueva existe y se despliega, pero apunta a los endpoints **legacy** con el token compartido. Sirve para validar PWA, cámara e instalación en iPad sin esperar al backend nuevo. Mientras tanto, el token sigue siendo tan débil como hoy (sin regresión, sin mejora).
3. **F4–F9:** `/api/clock/*` con identidad de dispositivo convive con `/time-entries/clock/*`. La app nueva pasa a `/api/clock/*`; el `/fichador` viejo sigue vivo como respaldo.
4. **F12 (cutover):** se retiran `/time-entries/clock/*`, `CLOCK_DEVICE_TOKEN`, `VITE_CLOCK_DEVICE_TOKEN` y `/fichador` de la app admin (redirigir `/fichador` a `fichador.*` durante un tiempo).
5. Datos históricos: las fichadas viejas quedan con `deviceId = NULL` y `source = PUBLIC_CLOCK_PHOTO`. No hace falta backfill.

### 16.2 Riesgos técnicos

| Riesgo | Mitigación |
|---|---|
| Almacenamiento de PWA iOS separado de Safari | Enrolar solo en modo standalone (§8) |
| Pérdida de almacenamiento por presión de espacio o reinstalación | `storage.persist()`; re-enrolamiento barato |
| Service worker viejo pegado en kioscos | `autoUpdate` + recarga en ocio + `lastAppVersion` en el panel |
| Permiso de cámara repetido en standalone | Validar en piloto; definir si la cámara queda abierta |
| `trust proxy` mal configurado → IP falsificable | Verificar saltos en staging; test |
| Rate limiter en memoria (se reinicia con cada deploy, no comparte estado entre instancias) | Aceptable con una sola instancia de Render; si se escala horizontalmente, store compartido |
| Cold start de Render en la primera fichada | El heartbeat lo mitiga (§13) |
| Deriva del reloj del iPad | Solo display; reloj corregido con `serverTime` |
| Migración con FK sobre `AttendancePunch.deviceId` | Verificar `NULL` en staging; migración aplicada primero en staging |
| Fotos y futura biometría: datos personales (y biométricos = sensibles en la Ley 25.326) | Fuera del alcance técnico de este plan; requiere definición legal antes de F15 |

---

## 17. Etapas propuestas

Cada etapa cierra con `typecheck`, `test` y `build` en verde en backend, frontend y (desde F1) fichador, sin commit hasta revisión, sin push hasta confirmación y sin tocar producción. Las etapas que tocan `schema.prisma` aplican la migración **solo en staging**.

### F0 — Higiene de seguridad del backend actual (sin schema)
- **Objetivo:** cerrar R2, R5, R8 y R9 ya, sin esperar a la app nueva.
- **Cambios:** eliminar `POST /clock/in`, `/clock/out`, `/clock/status-by-dni`, `/clock/in-by-dni`, `/clock/out-by-dni` y sus servicios sin consumidores; `trust proxy` verificado; recortar la respuesta de salida (sin `entries`/`timeSegments`) y lo persistido en `ClockPunchAttempt.response`; quitar `hourConcepts` de `clock/status`; límite de body propio para `/clock` antes del parser global.
- **Archivos probables:** `timeEntries.routes.ts`, `timeEntries.controller.ts`, `timeEntries.service.ts`, `timeEntries.schemas.ts`, `app.ts`, tests de `service`/`controller`, `SECURITY_STANDARDS.md`, `PERFORMANCE_STANDARDS.md §10` (la deuda de los caminos legacy desaparece con ellos).
- **Riesgo:** bajo. Confirmar en logs de Render que nadie llama a esos endpoints.
- **Tests:** rutas eliminadas → 404; la salida no expone `entries`/`timeSegments`; `req.ip` toma `X-Forwarded-For` con un salto y no con dos; body > límite en `/clock` → 413 antes del handler.
- **Aceptación:** `clock-staging-matrix.ts` sigue verde en staging; `TimeClockPage` actual sin regresión.

### F1 — App `fichador/` separada (sobre el API legacy)
- **Objetivo:** app Vite + React + TS independiente, sin router ni layout administrativo, con la misma funcionalidad que el `/fichador` actual.
- **Archivos probables:** `fichador/{package.json, vite.config.ts, tsconfig*.json, index.html, src/main.tsx, src/App.tsx, src/api/clockClient.ts, src/features/punch/*, src/features/camera/FaceCaptureModal.tsx, src/ui/*, src/styles.css}`; `ci.yml`.
- **Riesgo:** bajo (no toca la app admin).
- **Tests:** port de los 6 tests de `TimeClockPage`; test de que el bundle no contiene `losod_access_token`, `/employees` ni rutas admin (grep sobre `dist/`); test de cliente API sin header `Authorization: Bearer`.
- **Aceptación:** `npm run build` en `fichador/` genera un bundle sin código administrativo; fichada IN/OUT funcional contra el backend local; cualquier URL distinta de `/` muestra el fichador o un 404 propio, nunca un login.

### F2 — Deploy independiente (staging)
- **Objetivo:** `fichador-staging.*` y `gestion-staging.*` desde el mismo repo, contra el mismo backend.
- **Archivos probables:** `frontend/netlify.toml`, `fichador/netlify.toml`, `backend/.env.example` (CORS), `DEVOPS_DEPLOYMENT_STANDARDS.md`, `LOCAL_DEVELOPMENT.md`.
- **Riesgo:** bajo-medio (versionar la configuración de Netlify que hoy vive en la UI; no romper el sitio admin).
- **Tests:** smoke manual; CORS desde el origen nuevo; `ignore` de Netlify verificado con un commit que solo toca `frontend/`.
- **Aceptación:** ambos sitios funcionan en staging; un cambio solo en `fichador/` no rebuildea `gestion`.

### F3 — PWA
- **Objetivo:** instalable en iPad/iPhone, standalone, con MediaPipe self-hosted y service worker sin caché de API.
- **Archivos probables:** `fichador/public/{manifest.webmanifest, icons/*, mediapipe/*}`, `vite.config.ts` (`vite-plugin-pwa`), `index.html`, `netlify.toml` (headers y CSP).
- **Riesgo:** medio (comportamiento de iOS).
- **Tests:** Lighthouse PWA installable; test unitario de la config del SW (`/api/` NetworkOnly); la cámara funciona en modo avión **hasta** el envío (el modelo carga desde caché).
- **Aceptación:** instalada en un iPad real, abre standalone, carga sin red el shell y el modelo, y nunca sirve respuestas de API desde caché.

### F4 — Modelo `ClockDevice` (schema)
- **Objetivo:** §7 completo.
- **Archivos probables:** `schema.prisma`, migración nueva, `DATABASE_STANDARDS.md`, `PROJECT_CONTEXT.md`.
- **Riesgo:** medio (FK sobre `AttendancePunch.deviceId`). Prerrequisito: query en staging que confirme `deviceId IS NULL` y `kioskId IS NULL` en todas las filas.
- **Tests:** `prisma validate`; migración aplicada en staging; `migrate status` limpio.
- **Aceptación:** schema migrado en staging; ningún cambio funcional visible.

### F5 — Middleware y enrolamiento (backend)
- **Objetivo:** `requireClockDevice`, `register`, `status`, `approve`, `revoke`, `rename`, `list`, `delete pending`; limpieza de PENDING vencidos en el scheduler existente.
- **Archivos probables:** `backend/src/modules/clock/*` (routes, controller, service, repository, schemas), `backend/src/modules/clock-devices/*` (admin) o un único módulo con dos routers; `middlewares/requireClockDevice.ts`; `routes.ts`; `app.ts`; `clockPunchMaintenance.ts`; `types/express.d.ts`; `BACKEND_API_CONTRACTS.md`; `ARCHITECTURE_STANDARDS.md`.
- **Riesgo:** medio-alto (seguridad).
- **Tests:** `*.service.test.ts` con repositorio mockeado: código de un solo uso, código vencido, aprobación concurrente (solo una gana), revocado → 403, pending → 403 en rutas ACTIVE, secreto incorrecto → 401, hash nunca loggeado; **tests de aislamiento** de §11 (supertest) en ambas direcciones; rate limit de `register`.
- **Aceptación:** enrolamiento completo vía `curl` en local/staging; los tests de aislamiento pasan.

### F6 — Panel "Dispositivos de fichada" (app admin)
- **Objetivo:** Configuración → Dispositivos de fichada: aprobar por código, listar con conectividad, renombrar, revocar con confirmación.
- **Archivos probables:** `frontend/src/pages/ClockDevicesPage.tsx`, `services/api/clockDeviceApiService.ts`, `App.tsx`, `SettingsPage.tsx`/`navigation.tsx`, CSS respetando el design system y `docs/reference-ui/`.
- **Riesgo:** bajo.
- **Tests:** service test, página (aprobar, revocar con diálogo, badges de conectividad), `RoleRoute` solo RRHH.
- **Aceptación:** RRHH aprueba un código real generado desde el fichador de staging; el QA visual de `UI_QA_CHECKLIST.md` pasa.

### F7 — Enrolamiento en el fichador
- **Objetivo:** pantallas "Instalá la app" / "Dispositivo no registrado + código + cuenta regresiva" / "Revocado"; almacenamiento en IndexedDB; `storage.persist()`; arranque automático si hay credencial `ACTIVE`.
- **Archivos probables:** `fichador/src/features/device/*`, `fichador/src/api/clockClient.ts`.
- **Riesgo:** medio (iOS).
- **Tests:** máquina de estados del dispositivo (sin credencial / pending / active / revoked / vencido); el cliente no borra la credencial ante 5xx o error de red.
- **Aceptación:** en un iPad real: instalar → código → aprobar → reiniciar el iPad → la app entra directo; revocar → la app lo muestra en menos de 2 min.

### F8 — Endpoints operativos `/api/clock/*`
- **Objetivo:** `employees`, `employees/:id/status`, `punches`, `punches/:requestId` sobre el núcleo existente; `deviceId` en `AttendancePunch` y `ClockPunchAttempt`; `source = KIOSK`; DNI enmascarado; cooldown; rate limit por dispositivo; auditoría con el dispositivo como actor en la descripción.
- **Archivos probables:** `modules/clock/*`, `timeEntries.service.ts` (parámetro `deviceContext`, cooldown), `timeEntries.repository.ts` (`punchEvidenceData` con `deviceId`), `env.ts` (`CLOCK_PUNCH_COOLDOWN_SECONDS`), tests.
- **Riesgo:** alto (toca el flujo de fichada; regla de CLAUDE.md: requiere tests de `time-entries`).
- **Tests:** la fichada persiste `deviceId` y `KIOSK`; el intento de otro dispositivo → 404; cooldown IN→OUT < 60 s → 409; el reintento con el mismo `requestId` devuelve el mismo resultado; la respuesta no contiene campos internos; `clock-staging-matrix.ts` adaptado al namespace nuevo.
- **Aceptación:** matriz de staging verde en el namespace nuevo; `AttendancePage` muestra "Kiosco" y el nombre del dispositivo.

### F9 — Flujo de fichada en la app nueva (cutover del cliente)
- **Objetivo:** la app usa solo `/api/clock/*`; reintento con el mismo payload ante 404 (§14.3); sin bloqueo permanente del kiosco; confirmación grande con la hora del servidor y retorno automático a la pantalla inicial a los N segundos; UI táctil de kiosco.
- **Archivos probables:** `fichador/src/features/punch/*`.
- **Riesgo:** medio.
- **Tests:** red caída a mitad del envío (respuesta perdida → verificación → resultado); request nunca llegada (404 → reenvío con el mismo `requestId`); `CLOCK_PUNCH_COOLDOWN`; el kiosco nunca queda bloqueado sin salida.
- **Aceptación:** prueba de caos manual en staging (cortar wifi en cada fase) sin fichadas duplicadas ni perdidas.

### F10 — Heartbeat y estado offline
- **Objetivo:** §13 y §14.4.
- **Archivos probables:** `fichador/src/features/device/heartbeat.ts`, `modules/clock/*`, panel admin (columna de conectividad y versión).
- **Riesgo:** bajo.
- **Tests:** umbrales de conectividad (función pura); botones deshabilitados sin conexión; reloj con desfasaje aplicado.
- **Aceptación:** en el panel, "En línea" → "Sin conexión" al apagar el wifi del iPad dentro de los umbrales definidos.

### F11 — Cámara y operación de kiosco
- **Objetivo:** Wake Lock, decisión cámara abierta/por fichada según la medición de F3/F7, manejo del permiso en standalone, instructivo de Acceso guiado.
- **Archivos probables:** `fichador/src/features/camera/*`, `docs/` (instructivo operativo).
- **Riesgo:** medio (dependiente de iOS).
- **Tests:** estados de permiso denegado / sin cámara / reconectar.
- **Aceptación:** 8 h de kiosco encendido en un iPad real sin intervención.

### F12 — Hardening y retiro del legacy
- **Objetivo:** CSP final verificada; eliminar `/time-entries/clock/*`, `clockDeviceAuth.ts`, `CLOCK_DEVICE_TOKEN`, `VITE_CLOCK_DEVICE_TOKEN`, `/fichador` y archivos de §6 de la app admin; redirect temporal `/fichador → fichador.*`; auditoría de fichada no diferida (o con reintento); evaluar firma con `CryptoKey` no exportable.
- **Archivos probables:** §6 completo, `SECURITY_STANDARDS.md` (reescribir la sección del fichador), `PROJECT_CONTEXT.md`.
- **Riesgo:** medio (borrado; no se puede ejecutar sin que todos los kioscos estén ya en la app nueva).
- **Tests:** las rutas viejas → 404; el bundle admin no contiene `x-clock-device-token` ni `mediapipe`; suite completa verde.
- **Aceptación:** cero tráfico a las rutas legacy durante 7 días previos (logs) antes de borrar.

### F13 — Piloto
- **Objetivo:** 1 iPad, 1 establecimiento, 2 semanas, en paralelo con el método actual.
- **Riesgo:** operativo.
- **Criterio de aceptación:** 0 fichadas perdidas o duplicadas; 0 re-enrolamientos no planificados; actualizaciones de SW aplicadas sin intervención; feedback de RRHH sobre el panel.

### F14 — Rollout
- **Objetivo:** producción por establecimiento; checklist de `engineering:deploy-checklist`; migraciones en producción **con aprobación explícita**.
- **Aceptación:** todos los kioscos enrolados y en línea en el panel; legacy retirado (F12) en producción.

### F15 — Reconocimiento facial (proyecto separado)
- Se mueve **después** del rollout: requiere enrolamiento de rostros, matching del lado del servidor (hoy la validación es solo del cliente), umbrales, fallback manual y **definición legal** sobre datos biométricos. Necesita su propio documento de diseño; el contrato de `POST /api/clock/punches` y el cooldown de F8 ya lo contemplan.

---

### Orden recomendado (resumen)

`F0 → F1 → F2 → F3 → F4 → F5 → F6 → F7 → F8 → F9 → F10 → F11 → F12 → F13 → F14` y luego `F15` como iniciativa aparte.

F0 es independiente y conviene hacerla primero. F1–F3 (frontend) y F4–F5 (backend) pueden avanzar en paralelo si hace falta.

---

## 18. F0 — implementación y resultado

Commits sobre `main` (sin push): `2305f9a`, `a77300f`, `f20aab6` y el commit de documentación que agrega esta sección. Sin cambios de schema ni migraciones.

### 18.1 Auditoría de consumidores (antes de borrar)

Búsqueda sobre todos los archivos versionados (`frontend/`, `backend/` incluidos `scripts/` y tests, `frontend/e2e/`, `docs/`):

| Ruta | Frontend actual | Fichador actual | Scripts / staging helpers | Tests | e2e | Docs |
|---|---|---|---|---|---|---|
| `GET /clock/employees` | `timeClockApiService.searchEmployees` | sí (búsqueda) | — | — | catálogo del journey 14G.1 (sólo texto) | sí |
| `POST /clock/status` | `timeClockApiService.status` | sí | — | sí | — | sí |
| `POST /clock/photo-punch` | `timeClockApiService.photoPunch` | sí | `clock-staging-matrix.ts` | sí | catálogo (sólo texto) | sí |
| `GET /clock/attempts/:requestId` | `timeClockApiService.attemptStatus` | sí (verificación) | `clock-staging-matrix.ts` | sí | — | — |
| `POST /clock/in` | `timeClockApiService.clockIn` **sin llamadores** | no | — | sólo tests unitarios del propio servicio | — | `SECURITY_STANDARDS.md` |
| `POST /clock/out` | `timeClockApiService.clockOut` **sin llamadores** | no | — | ídem | — | ídem |
| `POST /clock/status-by-dni` | — | no | — | — | — | — |
| `POST /clock/in-by-dni` | — | no | — | — | — | ídem |
| `POST /clock/out-by-dni` | — | no | — | — | — | ídem |

Los dos métodos `clockIn`/`clockOut` del frontend sólo se usaban como **tipos** (`ReturnType`) en `TimeClockPage`, nunca se invocaban.

### 18.2 Endpoints retirados

Todos bajo `/api/time-entries`, con `x-clock-device-token` y sin `requireAuth`:

| Método y ruta | Propósito original | Consumidor anterior | Por qué ya no se usaba |
|---|---|---|---|
| `POST /clock/in` `{employeeId}` | Ingreso sin foto por id | Fichador anterior a la fichada con foto (migración `20260708100000_public_clock_photo_evidence`) | Reemplazado por `photo-punch`; el frontend dejó de llamarlo |
| `POST /clock/out` `{employeeId}` | Salida sin foto por id | Ídem | Ídem |
| `POST /clock/status-by-dni` `{dni}` | Estado por DNI | Fichador "portal por DNI" original | La UI pasó a búsqueda por nombre (`/clock/employees` + `/clock/status`) |
| `POST /clock/in-by-dni` `{dni}` | Ingreso sin foto por DNI | Ídem | Ídem |
| `POST /clock/out-by-dni` `{dni}` | Salida sin foto por DNI | Ídem | Ídem |

Se eliminaron también el código que sólo servía a esas rutas: handlers del controller, `clockStatus`, `clockIn`, `clockInByEmployee`, `clockInResolved`, `clockOut`, `clockOutByEmployee`, `clockOutResolved`, `notifyOpenShiftAttempt`, `resolveClockEmployee(ById)`, `clockByDniSchema`, y del repositorio `findEmployeeByDniForClock`, `findEmployeeByIdForClock`, `findOpenWorkShift`, `createObservedPunch`. Las reglas que sólo se probaban por esos caminos (rollover por régimen, notificación de falta de salida, mapeo de P2002 y `WORK_SHIFT_ALREADY_CLOSED`, tolerancia a fallas de `evaluateShiftExit`) ahora se prueban sobre `clockPhotoPunch`, que usa los mismos helpers.

**Cierre del namespace:** si sólo se borraban las rutas, `POST /clock/in` caía en el `timeEntriesRouter.use(requireAuth)` siguiente y respondía **401**, no 404 (y con un JWT admin podía seguir hacia las rutas `/:id`). Las guardas pasaron a aplicarse por ruta y el namespace termina en `timeEntriesRouter.all(["/clock", "/clock/*"], notFoundHandler)`: toda ruta `/clock/*` no listada responde `404 ROUTE_NOT_FOUND`, con o sin token. Verificado con test HTTP y con una mutación (sin el 404 terminal, el test falla con 401).

**No queda ningún camino equivalente que fiche sin foto:** las únicas escrituras de `/clock` son `photo-punch`, cuyo schema exige `photo` (data URL, 200 B–4,5 MB) y `faceValidationStatus = VALID`, y cuyo servicio decodifica y guarda la imagen antes de abrir o cerrar la jornada.

### 18.3 Endpoints que siguen accesibles con el token temporal

| Método y ruta | Propósito | Lectura/escritura | Expone (desde F0) | Protección | Rate limit |
|---|---|---|---|---|---|
| `GET /clock/employees?search=` | Buscar empleado `ACTIVO` por nombre | Lectura | `id`, `legajo`, nombre, apellido, `dniSuffix` (3 dígitos); máx. 12, mín. 2 caracteres | token compartido | `CLOCK_RATE_LIMIT_*` por IP (30 / 5 min por defecto) |
| `POST /clock/status` | Jornada abierta del empleado elegido | Lectura | etiqueta de empleado + `openShift {id, startAt}` | ídem | ídem |
| `POST /clock/photo-punch` | Fichar con foto, idempotente | **Escritura** | etiqueta + `workShift` + `segments` (sin filas internas) | ídem + foto obligatoria | ídem |
| `GET /clock/attempts/:requestId?employeeId=` | Recuperar el resultado tras un corte de red | Lectura | lo mismo que `photo-punch`; exige que `employeeId` coincida | ídem | ídem |

Minimización aplicada en F0: DNI completo → `dniSuffix`; sin `hourConcepts` ni concepto de la jornada en `status`; sin `entries`/`timeSegments` en la salida; los intentos guardados antes de F0 se proyectan al mismo contrato al leerse. La búsqueda **se mantiene**: el fichador actual no tiene otra forma de identificar al empleado; su reemplazo restringido llega con `ClockDevice` (F8).

### 18.4 Token compartido actual

- Backend: `CLOCK_DEVICE_TOKEN` en `backend/.env` (gitignoreado) / env del hosting; middleware `backend/src/middlewares/clockDeviceAuth.ts`.
- Frontend: `VITE_CLOCK_DEVICE_TOKEN` en `frontend/.env` (gitignoreado) / env del sitio; leído en `frontend/src/services/api/timeClockApiService.ts:10` y enviado como `x-clock-device-token`.
- **No hay ningún secreto hardcodeado**: el valor local no aparece en ningún archivo versionado.
- **Sí termina en el bundle público**: verificado sobre el build local, el valor aparece literal en `dist/assets/TimeClockPage-*.js`, que el sitio admin sirve sin login. Moverlo a otra variable `VITE_*` no cambia nada, por eso no se tocó.

> **El secreto compartido sigue siendo una solución temporal y será reemplazado por `ClockDevice` (F4–F6).** Hasta entonces, quien lo extraiga puede buscar empleados activos por nombre (con DNI enmascarado), consultar su jornada abierta y fichar **con foto** en nombre de cualquiera. Ya no puede fichar sin foto ni ver el DNI completo.

### 18.5 `trust proxy`

**Topología.** Express no tenía `trust proxy`, así que `req.ip` era siempre la IP del socket. Todavía **no existe un deploy real del backend** (en el repo no hay ninguno referenciado; el destino previsto es Render, §15), así que no hay topología de producción para medir. Las fuentes externas sobre Render no coinciden entre sí en la cantidad de saltos, y por eso **ninguna se usa como valor**: no se asume 1, 2, 3 ni ningún otro número.

> **Dev Tunnels fue una herramienta temporal de revisión y no forma parte de la arquitectura de despliegue del Fichador.** Se usó sólo para compartir la app local con otra persona durante una revisión. No se mide ni se configura `TRUST_PROXY_HOPS` para él, y no es referencia para producción.

**Entorno de desarrollo actual:** backend local directo (`tsx watch`, puerto 4002) contra Neon, con `TRUST_PROXY_HOPS=0`: sin proxy delante, `req.ip` es la IP real del socket (`::1` / `127.0.0.1`), que es lo correcto en local. Las IPs que hoy guarda la base de prueba (68 fichadas con foto en 120 días con `::1`; 1884 `AuditLog` en 60 días con `::1` o `::ffff:127.0.0.1`) reflejan ese backend local y **no** dicen nada sobre la topología de producción.

**Configuración elegida:** número exacto de saltos, configurable por entorno, nunca `true`.

```
TRUST_PROXY_HOPS=0                    # default = comportamiento previo
CLIENT_IP_DIAGNOSTICS_ENABLED=false   # sonda de medición apagada
```

`app.set("trust proxy", trustProxySetting(env.TRUST_PROXY_HOPS))` es lo primero en `createApp()` (`backend/src/shared/http/clientIp.ts`). En production, si sigue en 0, se loguea un warning al arrancar. Nada lee headers de IP a mano: auditoría y `AttendancePunch.ipAddress` siguen saliendo de `req.ip` (`requestAuditContext` → evidencia → `punchEvidenceData`).

**Por qué no se fijó un número:** un valor menor al real deja la IP del proxy (el problema actual); uno **mayor** permite falsificar la IP con `X-Forwarded-For` (lo demuestra un test con 4 saltos sobre una cadena de 3). El valor se mide.

**Procedimiento de medición — requisito previo al primer deploy real del backend (y a cualquier cambio de proxy/CDN delante de él):**

1. En el entorno desplegado (nunca en local ni en Dev Tunnels), configurar `CLIENT_IP_DIAGNOSTICS_ENABLED=true` y reiniciar el backend.
2. Desde fuera (celular con datos móviles y otra red), abrir `https://<api>/api/health/client-ip`.
3. Leer `remoteAddress` (debe ser privada: es el proxy) y `xForwardedFor` / `xForwardedForEntries`. Si la cadena es `<tu IP pública>, <proxy>, …`, `TRUST_PROXY_HOPS` = cantidad de entradas que agregó la infraestructura (= `xForwardedForEntries` cuando el cliente no manda el header).
4. Configurar `TRUST_PROXY_HOPS`, reiniciar y comprobar que `ip` = tu IP pública (comparar con `trueClientIp`/`cfConnectingIp` si existen).
5. Prueba de falsificación: `curl -H "X-Forwarded-For: 6.6.6.6" https://<api>/api/health/client-ip` → `ip` **no** debe ser `6.6.6.6`.
6. Volver `CLIENT_IP_DIAGNOSTICS_ENABLED=false`.

**Resultado de los tests (app real `createApp()` con cadenas de proxies simuladas; los números de saltos de los tests son ilustrativos, no el valor de ningún entorno):**

| Caso | Resultado |
|---|---|
| Sin `trust proxy` | `req.ip` = socket (`127.0.0.1`) para cualquier `X-Forwarded-For` (comportamiento previo, documentado) |
| A/C) cadena simulada de 3 proxies con 3 saltos | `req.ip` = cliente (`203.0.113.7`) |
| A/C) 1 salto | `req.ip` = entrada agregada por el proxy |
| B) `X-Forwarded-For` falsificado (`6.6.6.6, …`) con el número exacto | ignorado: `req.ip` sigue siendo el cliente real |
| Número mayor al real (4 sobre 3) | `req.ip` = `6.6.6.6` → por eso se mide |
| Rate limit sin `trust proxy` | dos clientes distintos agotan el mismo bucket |
| Rate limit con `trust proxy` | bucket por IP; la misma IP con prefijo falso sigue en su bucket (429); otra IP sigue en 200 |
| `AttendancePunch.ipAddress` | el controller pasa la IP efectiva (no la falsificada) a la fichada; el servicio la pone en la evidencia; el repositorio la persiste en `attendancePunch.create` |

**Rate limiting auditado:** `express-rate-limit` 7.5.1, `keyGenerator` por defecto (`req.ip`), store en memoria por proceso. Fichador: 30 requests / 5 min por IP para las cuatro rutas juntas (`CLOCK_RATE_LIMIT_*`). Global: 300 / 15 min por IP. El rate limit por dispositivo queda para F10.

### 18.6 Logging de secretos

Revisado: `requestLogger` / `performanceLogger` loguean método, path saneado (sin query string, UUIDs → `:id`), status y tiempos, **nunca headers**. `errorHandler` registra en auditoría IP, user agent y path enmascarado en los 403, nunca headers. Los logs del fichador (`CLOCK_*`) llevan `requestId`, `employeeId`, códigos y tiempos. `AuditLog` guarda IP y user agent. Ningún camino escribe `x-clock-device-token`, `Authorization` ni cookies; no hizo falta sanear nada. La sonda nueva devuelve una lista cerrada de headers de IP y un test verifica que no refleja credenciales.

### 18.7 CORS

`CORS_ORIGIN` es una allowlist explícita (`parseCorsOrigins`: separa por comas, quita `/` finales, `*` queda literal y no actúa como comodín), con `credentials: true`, aunque la autenticación no usa cookies (Bearer y refresh por header/body). El fichador vive hoy en el **mismo origin** que la app admin (`/fichador`) y llama al API cross-origin (`VITE_API_URL`). El header propio `x-clock-device-token` pasa el preflight porque `cors` refleja los headers solicitados. **Para F2:** agregar `https://fichador.empresa.com` (y su equivalente de staging) a `CORS_ORIGIN`, mantener la allowlist sin comodines, y evaluar `credentials: false` si sigue sin haber cookies.

### 18.8 Riesgos residuales y deuda conocida

- **Token compartido público** (R1): mitigado en alcance, no resuelto. Reemplazo: `ClockDevice` (F4–F6).
- **Validación real de proxy/IP pendiente hasta que exista el deploy del backend:** el código está listo y probado, y en local directo `TRUST_PROXY_HOPS=0` es el valor correcto. En el deploy real, mientras no se mida y configure (§18.5), rate limiting e IP auditada agruparían a todos los clientes bajo la IP del proxy; producción lo avisa al arrancar. La medición y la prueba de falsificación son condición para habilitar ese deploy.
- **Fotos de otros:** con el token se puede fichar con una foto cualquiera por cualquier empleado; la validación facial sigue siendo del cliente (R10).
- **Body de 40 MB** (R9): el parser JSON global corre antes de la verificación del token. No se cambió en F0 porque el límite es global (afecta también `/auth/login`) y moverlo toca el orden de todos los middlewares; queda para F12.
- **Enumeración por nombre:** la búsqueda con 2 caracteres sigue permitiendo listar empleados activos (sin DNI completo), acotada por el rate limit por IP una vez configurado.
- **Despliegue desfasado:** si el backend nuevo convive un rato con el frontend viejo, la línea de identificación muestra sólo el legajo (sin el sufijo de DNI). No afecta la fichada.

### 18.9 Cierre de F0 (entorno de desarrollo actual)

| Criterio | Estado | Evidencia |
|---|---|---|
| Endpoints legacy sin foto eliminados | Cumplido | `2305f9a`; test HTTP: las 5 rutas → 404 con y sin token; smoke local directo: 404 |
| No existe bypass equivalente | Cumplido | namespace `/clock` cerrado con 404 terminal (test + mutación); única escritura = `photo-punch` con foto obligatoria |
| Exposición de datos del kiosco reducida | Cumplido | `a77300f`; tests de servicio y UI; smoke local: búsqueda devuelve `id, legajo, dniSuffix, firstName, lastName, name`, sin `dni` |
| `trust proxy` configurable y seguro | Cumplido | `f20aab6`; número exacto, nunca `true`, default 0, warning en production con 0 |
| Local funciona con `TRUST_PROXY_HOPS=0` | Cumplido | `.env` local no define la variable → 0 efectivo; diagnósticos apagados (sonda → 404); `/health` 200; `/clock/employees` 401 sin token, 200 con token |
| Tests con distintos hops | Cumplido | `app.trustProxy.test.ts`: 0, 1, 3 y sobreconteo 4; spoofing; buckets por IP; IP hasta `AttendancePunch.ipAddress` |
| Medición real documentada como requisito previo al deploy | Cumplido | §18.5, `SECURITY_STANDARDS.md` → "Client IP behind proxies", checklist de `DEVOPS_DEPLOYMENT_STANDARDS.md` |
| `CLIENT_IP_DIAGNOSTICS_ENABLED=false` por defecto | Cumplido | default del schema de env y de `.env.example` |

**Queda fuera de F0 por decisión:** medir `TRUST_PROXY_HOPS` (se hace en el primer deploy real del backend), cualquier configuración para Dev Tunnels, y producción.

### 18.10 Siguiente etapa recomendada

**F1** — app `fichador/` separada, sobre los cuatro endpoints vigentes. Pendiente de aprobación.

---

## 19. F1 — fichador standalone (implementación)

Sin cambios de backend, schema ni endpoints. Mismos cuatro endpoints de F0 y mismo token compartido temporal.

### 19.1 Arquitectura obtenida

```
Gestion-Personal/
├── backend/    API compartida (sin cambios en F1, salvo CORS_ORIGIN de ejemplo)
├── frontend/   Gestión Personal (admin); /fichador sigue vivo durante la transición
└── fichador/   app React/Vite independiente: sólo el fichador
```

El repo no tiene `package.json` raíz ni workspaces: `fichador/` sigue el mismo patrón que `frontend/` y `backend/` (paquete propio con su lockfile). Build independiente: `cd fichador && npm run build` → `fichador/dist`, sin compilar el admin.

```
fichador/
├── .env.example                 VITE_API_URL, VITE_CLOCK_DEVICE_TOKEN
├── .gitignore
├── index.html                   título "Fichador | Los O'Dwyer"
├── package.json / package-lock.json
├── vite.config.ts               puerto 5175 (strictPort), Vitest jsdom
├── tsconfig.json / tsconfig.app.json / tsconfig.e2e.json
├── playwright.config.ts         journey e2e en 5185, API mockeado, cámara falsa
├── e2e/kioskJourney.spec.ts
├── scripts/check-bundle-isolation.mjs
└── src/
    ├── main.tsx                 sin AuthProvider, router ni providers admin
    ├── App.tsx (+ test)         "/" → fichador; cualquier otra URL → 404 propio
    ├── styles.css               subconjunto del CSS admin (20 KB) + reglas del 404
    ├── pages/TimeClockPage.tsx (+ test), NotFoundPage.tsx
    ├── components/time-clock/FaceCaptureModal.tsx (+ test)
    ├── components/ui/Button.tsx, Modal.tsx, LoadingState.tsx
    ├── services/api/apiClient.ts (+ test), timeClockApiService.ts
    ├── utils/date.ts, argentinaDateKey.ts
    └── test/setupTests.ts
```

No hay `public/`: F1 no necesita assets propios (manifest e íconos son F3).

### 19.2 Qué se movió, copió o extrajo

Las rutas internas replican las del admin para que `diff` entre ambas copias sea directo mientras convivan.

| Archivo del fichador | Origen | Tipo | Diferencia con el admin |
|---|---|---|---|
| `pages/TimeClockPage.tsx` | `frontend/src/pages/TimeClockPage.tsx` | copia | errores de búsqueda/estado muestran el mensaje del cliente (sin conexión, 401, 429) con el texto anterior como fallback; `role="alert"` en el error. Flujo, `requestId` y verificación idénticos |
| `components/time-clock/FaceCaptureModal.tsx` | `frontend/src/components/time-clock/` | copia | distingue permiso denegado, sin cámara, cámara ocupada, sin HTTPS, falla de reproducción y falla de carga del detector (antes todo era "Permití el acceso a la cámara"); `role="status"` en el estado. Captura, compresión, detección, cleanup sin cambios |
| `services/api/timeClockApiService.ts` | `frontend/src/services/api/` | copia | sin las opciones `auth`/`apiCache` del cliente admin |
| `services/api/apiClient.ts` | — | **nuevo** | cliente propio sin JWT, refresh ni `sessionStorage`; `ApiError` (HTTP) y `NetworkError` (sin respuesta, a propósito no es `ApiError` para no cortar la verificación del intento); mensajes de negocio para 401/429/5xx |
| `components/ui/Button.tsx` | `frontend/src/components/ui/` | copia reducida | sin la variante `to` (`Link` de react-router-dom) |
| `components/ui/Modal.tsx` | `frontend/src/components/ui/` | copia | `role="dialog"`, `aria-modal`, `aria-label` |
| `components/ui/LoadingState.tsx` | `frontend/src/components/ui/` | copia reducida | sólo la variante `block` |
| `utils/date.ts`, `utils/argentinaDateKey.ts` | `frontend/src/utils/` | copia reducida | sólo `formatDateTime` y lo que necesita |
| `styles.css` | `frontend/src/styles.css` | **extraído** | 183 reglas cuyos selectores aplican al DOM del fichador, mismo orden de cascada (180 KB → 20 KB) + 3 reglas propias del 404 |
| `pages/TimeClockPage.test.tsx` | `frontend/src/pages/TimeClockPage.test.tsx` | copia + ampliado | 7 tests originales + 9 nuevos |

**Compartido:** nada a nivel de código. Siguiendo §5, no se creó paquete compartido: lo común es chico y la copia del admin se elimina en el cutover. **Deuda controlada:** mientras `/fichador` siga en el admin, un cambio funcional o visual del fichador se aplica en ambas copias.

**No se trajo:** `AuthContext`, `AppShell`, `navigation`, `RoleRoute`, `LoginPage`, `ApiErrorNotice`, `AppDialogHost`, cachés (`services/cache`), `react-router-dom`, `leaflet`, `xlsx`.

### 19.3 Dependencias npm

Mismas versiones exactas que el admin. Producción: `react`, `react-dom`, `lucide-react` (íconos usados), `@mediapipe/tasks-vision` (detector). Desarrollo: `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `@types/react`, `@types/react-dom`, `@playwright/test`.

### 19.4 `/fichador` del admin

Se mantiene sin cambios funcionales (opción A): es la referencia para comparar y validar el standalone, y retirarlo ahora no reduce ningún riesgo (los dos usan el mismo token y los mismos endpoints). Sólo se agregó un comentario en `frontend/src/App.tsx` que indica que se retira en el cutover (F12) junto con `TimeClockPage`, `FaceCaptureModal` y `timeClockApiService` del admin.

### 19.5 Configuración local

- **Variables** (`fichador/.env`, gitignoreado; ver `.env.example`): `VITE_API_URL` (local `http://localhost:4002/api`) y `VITE_CLOCK_DEVICE_TOKEN` (mismo valor que `CLOCK_DEVICE_TOKEN` del backend). **Esta credencial sigue siendo temporal y será retirada en F4–F6.** No hay valores versionados.
- **CORS:** el backend necesita `http://localhost:5175` en `CORS_ORIGIN` (lista explícita). `backend/.env.example` pasó de `http://localhost:5173` (desactualizado) a `http://localhost:5174,http://localhost:5175`. El `backend/.env` local no se modificó: hay que agregar el origin y reiniciar el backend. El dominio productivo se define en F2.
- **Puertos:** backend 4002, admin 5174, fichador 5175 (`strictPort`), e2e del fichador 5185.
- **Comandos:** `npm run dev`, `npm run test`, `npm run build` (incluye aislamiento), `npm run e2e`, `npm run typecheck:e2e`. Detalle en `docs/LOCAL_DEVELOPMENT.md`.
- **CI:** nuevo job `fichador` (test, typecheck del e2e, build con aislamiento).

### 19.6 Aislamiento

- **Rutas:** sin router. `/` (e `/index.html`) muestran el fichador; cualquier otra URL (`/legajos`, `/configuracion`, `/usuarios`, `/auditoria`, `/fichador`, …) muestra un 404 propio con "Ir al fichador" y no llama al API. Cubierto por test de componente y e2e.
- **Bundle:** `scripts/check-bundle-isolation.mjs` corre en cada `npm run build` y falla si (a) un import sale de `fichador/src` o usa `react-router-dom`/`leaflet`/`xlsx`, o (b) `dist` contiene marcas administrativas (nombres de páginas, rutas `/legajos`, `/configuracion`, `/usuarios`, `/auditoria`, `/cierres`, …, claves `losod_access_token`/`losod_refresh_token`, `/auth/login`, `/auth/refresh`, endpoints admin). Exige además los endpoints del fichador, para no dar un falso verde con un build vacío. Verificado con una mutación: importar el cliente admin desde `main.tsx` hace fallar el chequeo por las dos vías.

### 19.7 Tamaño del bundle (`fichador/dist`)

| Archivo | Tamaño | gzip |
|---|---|---|
| `index-*.js` (React + app) | 158,1 KB | 51,6 KB |
| `FaceCaptureModal-*.js` (lazy, MediaPipe JS) | 135,3 KB | 42,1 KB |
| `index-*.css` | 19,0 KB | 4,6 KB |
| `index.html` | 0,4 KB | 0,3 KB |
| **Total JS** | **293,3 KB** | **93,7 KB** |

El WASM y el modelo de MediaPipe se siguen bajando en runtime de los CDN (igual que en el admin); se precachean en F3. Sin dependencias administrativas en el bundle.

### 19.8 Validación

- **Tests:** fichador 47 (Vitest: flujo, búsqueda, DNI terminado en, estado, ingreso/salida, `requestId` nuevo por intención, verificación del mismo `requestId` tras perder la respuesta sin reenviar, 409 confirmado, doble envío, sin conexión, 401, 429, 5xx, timeout, errores de cámara, rutas) + 5 e2e (Playwright). Admin: 1182 sin cambios. Backend: 2143 sin cambios.
- **Visual:** capturas del admin `/fichador` y del standalone con el API mockeado y el reloj congelado, comparadas píxel a píxel a 1024, 820, 768 y 390 px. Pantalla inicial y resultados: 0 píxeles distintos en los cuatro anchos. Empleado seleccionado: 0 en 820, 1 en 390, y diferencias sólo dentro del input de búsqueda en 1024/768 (anillo de foco en transición al momento de la captura, no CSS). Modal de cámara: sólo cambia la línea de estado (nuevo mensaje del detector). 390 px: botones apilados, sin desborde.
- **Manual contra el API real, sin el admin levantado** (backend propio en 4003 sin schedulers, sólo lecturas): abre; búsqueda real 200 con legajo + "DNI terminado en" y ningún DNI completo; estado real 200 con exactamente un botón habilitado; cámara (falsa de Chromium) con stream activo y MediaPipe real cargado ("No se detectó una cara", confirmación deshabilitada); cancelar y volver al inicio; `/legajos` → 404; token inválido → 401 real → "Este dispositivo no está autorizado para fichar. Avisá a RRHH."; backend apagado → "No hay conexión con el servidor…" con ingreso deshabilitado; sin errores de consola. **No se envió ninguna fichada.**
- **Accesibilidad básica:** labels en input y botones (incluidos los de ícono), `role="dialog"` en el modal, `role="alert"` en errores, `role="status"`/`aria-live` en el estado de cámara y de envío, estados deshabilitados nativos. Contraste igual al admin.

### 19.9 Deuda y pendientes

- **Duplicación temporal** de `TimeClockPage`, `FaceCaptureModal`, `timeClockApiService` y del CSS del fichador entre admin y standalone hasta el cutover (F12).
- **Token compartido temporal** (F4–F6) y **body de 40 MB** antes de la verificación del token (F12), sin cambios.
- **No probado de punta a punta:** el envío real de una fichada (POST `photo-punch`) desde el standalone, para no escribir en la base compartida; el contrato y la orquestación están cubiertos por tests, y es el mismo servicio que usa el admin. Requiere autorización para hacerlo con un empleado de prueba.
- **Sin vuelta automática al inicio** tras una fichada exitosa: igual que hoy, se vuelve con "Cambiar empleado" (F9).
- **Verificación de 45 s** y bloqueo si el intento nunca llegó al servidor: igual que hoy (F9).
- **Fuente Inter y MediaPipe desde CDN:** igual que hoy; se resuelven con el precache de F3.
- **Sin chequeo de conectividad continuo:** la falta de backend se detecta al buscar (F10 heartbeat).

### 19.10 Siguiente etapa recomendada

**F2** — deploy independiente en staging (`netlify.toml` por app, CORS del origin real). Pendiente de aprobación.

---

## 20. F2 — despliegue independiente

**Estado: cerrada a nivel de repositorio — READY FOR DEPLOY, validación real de infraestructura diferida** (decisión del 2026-10-06, §20.12). Toda la parte del repo está hecha y validada localmente. La validación contra infraestructura real (checklist de §20.9) se hace cuando se defina y contrate la infraestructura; no bloquea el desarrollo local ni las etapas siguientes.

### 20.1 Infraestructura encontrada (auditoría 2026-10-06)

| Pregunta | Respuesta | Evidencia |
|---|---|---|
| ¿Cómo se despliega hoy el admin? | **No se despliega.** Corre en local (`npm run dev`, 5174); se mostró una vez por VS Code Dev Tunnels (herramienta temporal, fuera de la arquitectura) | Sin `netlify.toml`, `vercel.json`, `render.yaml`, Dockerfile, `_redirects`/`_headers` ni scripts de deploy en el repo |
| ¿Hay backend público de testing/staging? | **No.** El backend corre local (4002) contra Neon; `APP_ENV=staging` en el `.env` local es el nombre de la base, no un deploy | Ninguna URL pública en el repo; las IPs guardadas son `::1` (§18.5); la mención a Render en `PROJECT_CONTEXT.md` es anticipatoria |
| ¿Netlify/Render configurados sólo desde paneles? | **No hay rastro.** Ninguna integración publica estados ni checks en GitHub | Los PRs #1–#3 sólo tienen los checks de GitHub Actions; sin statuses ni comentarios de bots de Netlify/Render |
| ¿Deploy previews? | **No existen** | Ídem |
| Dominios/orígenes reales | Sólo `http://localhost:5174`, `http://localhost:5175` y una URL temporal de Dev Tunnels | `backend/.env` local, `frontend/.env.tunnel.local` |
| CLIs de proveedores | Ninguna (`netlify`, `render`, `vercel`, `gh` no instaladas) | — |
| Node | CI usa 22 en los tres jobs; ningún `engines`/`.nvmrc`; local 24 | `.github/workflows/ci.yml` |

No se creó ningún sitio ni servicio: no hay acceso autorizado a ningún proveedor.

### 20.2 Estrategia

- **Proveedor de los frontends: Netlify**, un sitio por app (la preferencia del plan, §15; no contradice ninguna infraestructura existente porque no hay ninguna). Cada sitio con su base directory, build, variables, dominio y deploy propios.
- **Backend: un único servicio** (destino previsto Render, §15), compartido por los dos frontends, con una sola base. F2 no lo crea.
- **Resolución del API:** URL absoluta por sitio con `VITE_API_URL` (el admin ya lo hace así). Es el enfoque correcto para dos sitios en dominios distintos: sin proxy ni same-origin, cada frontend apunta explícitamente al mismo backend y el backend autoriza ambos origins por CORS. Un proxy `/api/*` en cada sitio de Netlify agregaría un salto más a la cadena de IPs (§18.5) y escondería el CORS real; no se usa.

### 20.3 Configuración versionada del fichador (`fichador/netlify.toml`)

| Item | Valor |
|---|---|
| Base directory (panel) | `fichador` |
| Build | `npm run build` (Netlify instala dependencias desde `package-lock.json` antes) = `tsc -b && vite build && write-hosting-headers && check-bundle-isolation` |
| Publish | `dist` |
| Node | `NODE_VERSION = "22"` (misma mayor que CI; un test lo verifica) |
| Builds omitidos | Netlify ya omite el build si el commit no toca el base directory |
| Deploy previews / branch deploys | cancelados (`ignore = "exit 0"` por contexto); además desactivarlos en el panel |
| SPA fallback | `/*` → `/index.html` 200: `/legajos` (y su recarga) muestran el 404 propio del fichador; nunca redirige al admin |
| Guard de deploy | dentro de Netlify (`NETLIFY=true`) el build falla si `VITE_API_URL` no es `https://` o falta `VITE_CLOCK_DEVICE_TOKEN` |

Headers generados en `dist/_headers` por `scripts/hosting-headers.mjs` (la CSP necesita el origin del backend de cada entorno):

| Header | Valor | Motivo |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | — |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | no filtra paths al API ni a CDNs |
| `X-Frame-Options` | `DENY` | el kiosco no se embebe (enforced; `frame-ancestors` de la CSP report-only no bloquea) |
| `Strict-Transport-Security` | `max-age=31536000` | HTTPS obligatorio (cámara, PWA) |
| `Permissions-Policy` | `camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` | cámara sólo para el propio origin |
| `Content-Security-Policy-Report-Only` | ver abajo | |
| `Cache-Control` `/assets/*` | `public, max-age=31536000, immutable` | nombres con hash de Vite |
| `Cache-Control` `/`, `/index.html` | `no-cache` | una tablet nunca queda con un index viejo |

CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/; connect-src 'self' <origin del API> <misma ruta de jsDelivr> https://storage.googleapis.com/mediapipe-models/face_detector/; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.

- Sin `'unsafe-inline'` ni `'unsafe-eval'`: el bundle no tiene inline, React aplica `style` vía CSSOM y el loader de MediaPipe no usa `eval`/`new Function` (auditado). `'wasm-unsafe-eval'` es lo mínimo para compilar su WASM.
- **Validada en modo enforcing en Chromium** con un emulador local del hosting y el MediaPipe real del CDN: flujo completo con 0 violaciones, detector cargado ("No se detectó una cara" con la cámara falsa), Inter cargada. Control negativo: sin `'wasm-unsafe-eval'` el detector falla y aparecen las violaciones.
- **Se publica como Report-Only** porque no pudo validarse en Safari/iPad sobre HTTPS. Pasa a enforced cuando se valide en el deploy real; en F3 los recursos de CDN pasan a self-hosted y la política se simplifica.
- Un test exige que las URLs de MediaPipe de la CSP coincidan con las de `FaceCaptureModal` y con la versión instalada.

### 20.4 Recursos externos que necesita el fichador (medidos en navegador)

| Origen | Recurso | Directiva |
|---|---|---|
| `cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/` | loader JS (`<script>`) y `.wasm` | `script-src`, `connect-src` |
| `storage.googleapis.com/mediapipe-models/face_detector/` | modelo `blaze_face_short_range.tflite` | `connect-src` |
| `fonts.googleapis.com` | hoja de estilos de Inter (`@import`) | `style-src` |
| `fonts.gstatic.com` | archivos `.woff2` | `font-src` |

Todos son HTTPS y funcionan desde un origin HTTPS. Pasan a self-hosted en F3 (precache PWA).

### 20.5 CORS, preflight y credentials

- `CORS_ORIGIN` ya es una allowlist explícita separada por comas (`parseCorsOrigins`): soporta varios origins, normaliza la `/` final y un `*` queda literal (no es comodín). **No hizo falta cambiar el backend.**
- Preflight del fichador (`OPTIONS` con `POST`, `content-type`, `x-clock-device-token`): `204`, `Access-Control-Allow-Origin` = su origin, el header propio permitido (el paquete `cors` refleja los headers pedidos). Origins con sufijo (`fichador-test.example.com.evil.com`), subdominio, otro esquema o no listados no reciben permiso. Fijado por `backend/src/app.cors.test.ts`.
- **Credentials:** la configuración CORS es global y queda con `credentials: true`. El fichador no manda cookies (`fetch` cross-origin sin `credentials`) y el admin tampoco las usa (Bearer en header), así que `true` hoy no habilita nada; cambiarlo es una decisión global del backend, fuera de F2.
- Para el deploy, el backend necesita en `CORS_ORIGIN` los dos origins exactos (admin y fichador del entorno).

### 20.6 Aislamiento de sesión (validado en navegador)

Con una "sesión admin" simulada en el origin del admin (`losod_access_token` en `sessionStorage`), el fichador (otro origin) no ve `sessionStorage` ni `localStorage`, no manda `Authorization` ni cookies, sólo `x-clock-device-token`, y después de "cerrar sesión" en el admin sigue funcionando. El código del fichador no usa storage, cookies ni credentials. En local las cookies sí se ven entre `localhost:5174` y `:5175` (las cookies se aíslan por host, no por puerto); en el deploy son hosts distintos y el fichador no usa cookies.

### 20.7 Variables por app

Ver la tabla completa en `docs/DEVOPS_DEPLOYMENT_STANDARDS.md` → "Variables por app y entorno". Resumen del fichador: sólo `VITE_API_URL` y `VITE_CLOCK_DEVICE_TOKEN` (más `NODE_VERSION` en `netlify.toml`). **`VITE_CLOCK_DEVICE_TOKEN` no es secreto: Vite lo inlinea en el JavaScript. Es una credencial temporal hasta F4–F6**, y cada entorno público usa su propio valor (nunca el de un entorno productivo). Las variables de cada sitio son independientes: cambiar una sólo requiere redeploy de ese sitio.

### 20.8 Admin

No se versionó `frontend/netlify.toml`: si existiera un sitio del admin configurado desde el panel, un `netlify.toml` en su base directory pisaría esa configuración. La configuración recomendada para el sitio del admin (a confirmar antes de versionarla) es: base directory `frontend`, `npm run build`, publish `dist`, Node 22, SPA fallback `/*` → `/index.html` 200, y `Permissions-Policy` con `camera=(self)` mientras `/fichador` siga en el admin. El build, las rutas y las variables del admin no cambiaron en F2.

### 20.9 Checklist para la validación real (diferida, ver §20.12)

**A. Backend público de testing (bloqueante).** Requiere una decisión y acceso tuyos; F2 no crea servicios.
1. Crear el servicio (por ejemplo, Render web service sobre `backend/`, rama `main`) apuntando a una base **de testing** (no producción).
2. Variables: `NODE_ENV=production` (el token falla cerrado si falta), `APP_ENV=staging`, `TZ=America/Argentina/Cordoba`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, almacenamiento, `CLOCK_DEVICE_TOKEN` **nuevo y exclusivo de testing** (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), `CORS_ORIGIN=<origin admin test>,<origin fichador test>`, `TRUST_PROXY_HOPS=0` y `CLIENT_IP_DIAGNOSTICS_ENABLED=false` hasta medir.
3. **Antes de usarlo de verdad:** medir `TRUST_PROXY_HOPS` con el procedimiento de §18.5 (sonda activada sólo durante la medición) y volver a apagar la sonda.

**B. Sitio Netlify del fichador.**
1. Add new site → Import from Git → `lihuen-OD/Gestion-Personal`.
2. Site name: `gestion-personal-fichador-test`. Production branch: `main`. **Base directory: `fichador`** (build command y publish salen de `fichador/netlify.toml`; dejar vacíos en el panel).
3. Environment variables (scope Builds, contexto Production): `VITE_API_URL=https://<backend-test>/api` y `VITE_CLOCK_DEVICE_TOKEN=<el mismo CLOCK_DEVICE_TOKEN de testing>`. No cargar ninguna variable del admin.
4. Deploy contexts → Deploy previews: **None**; Branch deploys: **None**.
5. Sin dominio propio: usar la URL `https://gestion-personal-fichador-test.netlify.app`. No tocar DNS corporativo.
6. Agregar ese origin exacto a `CORS_ORIGIN` del backend de testing y redeployarlo.

**C. (Opcional) Sitio del admin de testing.** Mismo procedimiento con base directory `frontend` y la configuración de §20.8, con sus propias variables (`VITE_API_URL`, `VITE_DEMO_MODE=false`, `VITE_CLOCK_DEVICE_TOKEN` de testing mientras exista `/fichador`).

**D. Validación (la corro yo con la URL, sin fichar):**
1. HTTPS en la URL publicada.
2. Headers de §20.3 presentes.
3. Abrir sin sesión admin.
4. Buscar empleado y consultar estado (200, preflight 204 con `x-clock-device-token`).
5. Abrir la cámara: pide permiso, abre y carga el detector.
6. Cancelar.
7. `/legajos` y su recarga muestran el 404 del fichador.
8. Volver a `/`.
9. Token inválido muestra el mensaje de 401.
10. Backend caído muestra el mensaje de sin conexión.
11. Network sin errores CORS/CSP.
12. Revisar a 1024/820/768/390 y en un iPad/iPhone real; con eso, decidir si la CSP pasa a enforced.

### 20.10 Validación hecha (local)

- **Build aislado desde clon limpio** (sin `node_modules`, `dist` ni `.env` del admin): `npm ci && npm run build` y tests OK.
- **Guard de deploy simulando Netlify:**
  - sin variables, falla con el detalle de qué falta;
  - con `http://`, falla;
  - con https y token, genera `_headers` con el origin correcto y el bundle apunta a ese API.
- **Emulador local del hosting** (`_headers` + SPA fallback):
  - `/` con `no-cache`, assets `immutable`;
  - `X-Frame-Options`, `Permissions-Policy`;
  - `/legajos` y su recarga en el 404 propio;
  - CSP enforced sin violaciones.
- **CORS y preflight:** ver §20.5. **Sesión:** ver §20.6.
- **Tests:**
  - fichador: 63 unit/componente y 5 e2e, más typecheck, build y aislamiento;
  - admin: 1182 y build;
  - backend: 2143 + 7 de CORS, typecheck y build.

### 20.11 Fuera de F2 y pendientes

- **No incluido:** sin service worker, manifest ni PWA (F3), sin `ClockDevice` (F4–F6), sin cambios de schema, y `/fichador` sigue en el admin.
- **CSP:** sigue en report-only hasta validarla en Safari/iPad.
- **Recursos de CDN:** MediaPipe e Inter siguen bajando del CDN (F3).
- **Body de 40 MB:** se sigue procesando antes de verificar el token (F12).

### 20.12 Decisión: validación de infraestructura diferida (2026-10-06)

Por decisión de producto, todavía no se crea infraestructura pública ni se contratan servicios. **F2 queda cerrada a nivel de repositorio con estado READY FOR DEPLOY — validación real de infraestructura diferida.**

Se difiere, hasta que se defina y contrate la infraestructura:

- HTTPS real del sitio del fichador;
- CORS real entre los sitios desplegados y el backend;
- cámara (`getUserMedia`) y detector en un dominio público;
- medición de `TRUST_PROXY_HOPS` (sigue siendo **bloqueante para el primer deploy real del backend**, §18.5);
- creación y configuración del hosting (Netlify u otro) y del backend público;
- prueba real desde iPad/iPhone y decisión de pasar la CSP de Report-Only a enforced.

No es un bloqueo para el desarrollo local: las etapas siguientes (F3 en adelante) se trabajan y validan en local hasta entonces. Se mantienen sin cambios todos los artefactos de F2: `fichador/netlify.toml`, la generación de `dist/_headers` (headers de seguridad, CSP Report-Only, política de cache), el guard de deploy, `backend/src/app.cors.test.ts` y esta documentación. Al momento de desplegar, el checklist de §20.9 es el punto de partida; si las etapas posteriores cambian los recursos externos (por ejemplo F3 al self-hostear MediaPipe y fuentes), la CSP y el checklist se actualizan en esa misma etapa.

No se creó ningún servicio externo.
