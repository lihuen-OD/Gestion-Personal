# Local Development

## Objetivo

Guía breve para levantar el backend real y preparar el frontend para empezar a consumir API.

## Backend

Entrar a:

```bash
cd backend
```

Crear `.env` desde ejemplo:

```bash
copy .env.example .env
```

Configurar:

```bash
DATABASE_URL="connection string de Neon development"
PORT=4002
CORS_ORIGIN=http://localhost:5173
JWT_ACCESS_SECRET="valor-local-seguro"
JWT_REFRESH_SECRET="valor-local-seguro"
STORAGE_PROVIDER=local
JSON_BODY_LIMIT=40mb
```

Instalar dependencias:

```bash
npm install
```

Generar Prisma Client:

```bash
npm run prisma:generate
```

Aplicar migraciones:

```bash
npm run prisma:migrate:dev
```

Seed inicial:

```bash
DEMO_SEED_PASSWORD="<contraseña-demo-local>" npm run prisma:seed
```

El seed se niega a ejecutar si `APP_ENV=production` o `NODE_ENV=production`. La
contraseña debe configurarse localmente mediante `DEMO_SEED_PASSWORD`; no tiene
valor por defecto y no debe versionarse.

Levantar backend:

```bash
npm run dev
```

Health check:

```txt
GET http://localhost:4002/api/health
```

## Usuarios seed

```txt
RRHH:
admin@losod.local

Supervisor:
supervisor@losod.local

Carga horaria:
carga@losod.local
```

Los tres usuarios usan la contraseña local configurada en
`DEMO_SEED_PASSWORD` al crearse.

### Habilitar los accesos rápidos del login (sólo mientras el sistema está en prueba)

Desde la Etapa 15C (`docs/decisions/DEMO_CREDENTIALS_CONTAINMENT_15C.md`),
el login siempre arranca con email y contraseña vacíos, y los tres botones
de acceso rápido (RRHH / Supervisión / Carga horaria) sólo se renderizan
si `VITE_DEMO_MODE=true` **y** el perfil tiene su email y password
completos — nunca hay credenciales hardcodeadas ni por defecto en el
código. Si falta un email o password para un perfil, ese botón
simplemente no aparece (la pantalla no se rompe).

Para verlos en desarrollo local, crear `frontend/.env.local` (gitignoreado,
nunca se versiona) con:

```bash
VITE_DEMO_MODE=true
VITE_DEMO_ADMIN_EMAIL="admin-local@example.com"
VITE_DEMO_ADMIN_PASSWORD="<password-local>"
VITE_DEMO_SUPERVISOR_EMAIL="supervisor-local@example.com"
VITE_DEMO_SUPERVISOR_PASSWORD="<password-local>"
VITE_DEMO_CARGA_EMAIL="carga-local@example.com"
VITE_DEMO_CARGA_PASSWORD="<password-local>"
```

Usar ahí los mismos emails de los usuarios seed (arriba) y la contraseña
local que se haya configurado en `DEMO_SEED_PASSWORD`. Estas variables
`VITE_*` quedan embebidas en el build de Vite (públicas por definición) —
usarlas sólo en un ambiente de prueba/demo controlado, **nunca** con un
email o contraseña de una cuenta productiva real.

## Frontend

Crear:

```txt
frontend/.env
```

Contenido:

```bash
VITE_API_URL=http://localhost:4002/api
VITE_DEMO_MODE=false
```

Levantar frontend según el script del proyecto:

```bash
cd frontend
npm run dev
```

## Fichador standalone (`fichador/`)

App React/Vite independiente que sólo contiene el fichador (F1 de
`docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md`). No necesita el frontend
administrativo levantado. Mientras dure la transición, `/fichador` sigue
existiendo también en el admin.

Crear `fichador/.env` (gitignoreado) a partir de `fichador/.env.example`:

```bash
VITE_API_URL=http://localhost:4002/api
# Mismo valor que CLOCK_DEVICE_TOKEN del backend. Credencial TEMPORAL: se
# retira en F4–F6 (ClockDevice). No es un secreto (queda en el bundle).
VITE_CLOCK_DEVICE_TOKEN=
```

El backend tiene que aceptar el origin del fichador: en `backend/.env`,
`CORS_ORIGIN` debe incluir `http://localhost:5175` (lista explícita, sin `*`),
por ejemplo `CORS_ORIGIN=http://localhost:5174,http://localhost:5175`.
Reiniciar el backend después de cambiarlo.

```bash
cd fichador
npm install
npm run dev          # http://localhost:5175 (puerto fijo, strictPort)
npm run test         # unit/componente (Vitest)
npm run build        # tsc + vite build + dist/_headers + chequeo de aislamiento
npm run e2e          # journey Playwright con el API mockeado (no toca datos)
npm run e2e:pwa      # PWA contra build + preview: SW, precache y offline (puerto 5195)
npm run icons        # regenera los íconos placeholder de la PWA
```

El service worker (F3) sólo existe en el build: `npm run dev` no lo registra.
Para probar la PWA a mano: `npm run build && npx vite preview` y abrir
`http://localhost:5175`. MediaPipe (WASM y modelo) e Inter son self-hosted, así
que el fichador no necesita Internet para abrir ni para la cámara; sí lo
necesita para buscar y fichar contra el backend.

`npm run build` falla si el fichador importa algo de fuera de `fichador/src` o
si el bundle contiene marcas de módulos administrativos
(`fichador/scripts/check-bundle-isolation.mjs`).

## Puertos

Recomendado:

```txt
Backend:            http://localhost:4002/api
Frontend (admin):   http://localhost:5174
Fichador:           http://localhost:5175
```

Los tres pueden correr a la vez. El e2e del fichador levanta su propio Vite en
`5185` con el API mockeado.

Si el backend usa otro puerto, actualizar ambos valores con el mismo puerto:

```bash
PORT=<PUERTO_BACKEND>
VITE_API_URL=http://localhost:<PUERTO_BACKEND>/api
```

## Mostrar la app con VS Code Dev Tunnels

Para mostrar el entorno de prueba local a otras personas sin deployar. No
toca producción; funciona mientras tu PC y VS Code estén prendidos.

### Uso normal

```bash
cd backend && npm run dev     # http://localhost:4002/api
cd frontend && npm run dev    # http://localhost:5174 -> API localhost
cd fichador && npm run dev    # http://localhost:5175 -> API localhost
```

### Enrolamiento local del fichador (F5)

1. Abrir `http://localhost:5175` y pulsar **Configurar dispositivo**. No hay
   registro automático al cargar.
2. Ingresar el código mostrado desde el admin local:
   **Configuración → Dispositivos de fichada** (`/configuracion/dispositivos-fichada`),
   asignar nombre/sector y aprobar.
3. La PWA consulta estado cada 7,5 segundos y muestra el fichador al quedar
   `ACTIVE`.

La identidad `{id, secret}` queda en IndexedDB del origin 5175. El código claro
no se persiste: si se recarga una solicitud pendiente, usar **Generar código
nuevo**. Para reiniciar deliberadamente un equipo revocado/inválido, usar
**Borrar configuración local**; el registro revocado permanece en backend para
auditoría. El modo navegador se permite para desarrollo local, aunque la
política operativa futura es instalar la PWA en la pantalla de inicio.

Esto no reemplaza todavía `VITE_CLOCK_DEVICE_TOKEN`: F5 no cambia la
autenticación de las cuatro fichadas; esa integración es F6.

### Para mostrar la app con VS Code Tunnel

1. Levantar backend: `cd backend && npm run dev`.
2. Pestaña **Puertos** de VS Code: reenviar `4002`.
3. Reenviar `5174`.
4. Poner ambos en visibilidad **Pública** (clic derecho → Visibilidad del
   puerto). Un `4002` privado se ve en el navegador como error de CORS.
5. Configurar una sola vez (se repite sólo si la URL del tunnel cambia):
   - `frontend/.env.tunnel.local` (gitignoreado, copiar de
     `frontend/.env.tunnel.local.example`):
     `VITE_API_URL=https://XXXXXXXX-4002.brs.devtunnels.ms/api`
   - `backend/.env`, agregar el origin del frontend tunnel (sin `/` final) y
     reiniciar el backend:
     `CORS_ORIGIN=http://localhost:5174,https://XXXXXXXX-5174.brs.devtunnels.ms`
6. Frontend: `cd frontend && npm run dev:tunnel`.
7. Compartir sólo la URL del `5174`.

### Para volver a local

```bash
cd frontend && npm run dev
```

Qué archivo gana (Vite pisa clave por clave, el último manda):

| Comando              | Archivos cargados, en orden                          |
| -------------------- | ---------------------------------------------------- |
| `npm run dev`        | `.env` → `.env.local`                                |
| `npm run dev:tunnel` | `.env` → `.env.local` → `.env.tunnel.local`          |

`.env.tunnel.local` define sólo `VITE_API_URL`; el modo demo y sus perfiles
se heredan de `.env.local`, así el tunnel muestra la misma app de prueba.
Las credenciales demo quedan visibles para quien abra el link (como toda
variable `VITE_*`): usar sólo cuentas de prueba con contraseña exclusiva.
La auth no usa cookies (Bearer + refresh en body, `sessionStorage`), así que
cross-origin alcanza con CORS. Quienes entran por el tunnel comparten el rate
limit de login (misma IP local).
Dev Tunnels es sólo una herramienta temporal para mostrar la app local en una
revisión; no forma parte de la arquitectura de despliegue. En desarrollo local
(directo o por tunnel) `TRUST_PROXY_HOPS` queda en `0` y
`CLIENT_IP_DIAGNOSTICS_ENABLED` en `false`: no se mide ni se ajusta nada para
el tunnel. La medición de proxies se hace en el deploy real del backend (ver
`docs/SECURITY_STANDARDS.md` → "Client IP behind proxies").

## Notas de seguridad

- No commitear `.env`.
- No pegar credenciales en documentación.
- La URL real de Neon debe vivir solo en `.env` local o secrets del entorno.
- Rotar credenciales antes de producción si fueron compartidas por chat o canales no seguros.

## Archivos y Cloudinary

Durante desarrollo local se puede usar:

```bash
STORAGE_PROVIDER=local
```

Con ese modo, el backend guarda archivos de prueba en `backend/uploads` y genera una referencia local sin depender de credenciales externas.

Cuando se active Cloudinary al final del proyecto, configurar:

```bash
STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=gestion-personal
```

El frontend ya envia el archivo al backend como `fileBase64` y el backend decide si lo resuelve con storage local o Cloudinary.

Desde la Etapa 15D.2 (`docs/decisions/STORAGE_UPLOAD_POLICY_15D2.md`), qué
provider recibe un upload nuevo puede configurarse por propósito con
`DOCUMENT_STORAGE_PROVIDER` (documentos) y `PUNCH_PHOTO_STORAGE_PROVIDER`
(fotos/evidencia de fichada), con `DEFAULT_STORAGE_PROVIDER` como default
compartido si no se define una específica. Dejarlas vacías (como en
`.env.example`) es compatible: todo sigue resolviendo por `STORAGE_PROVIDER`
como hasta ahora. La lectura/eliminación de un archivo ya existente nunca
usa estas variables — sigue por `StorageFile.storageProvider` persistido
(Etapa 15D.1, `docs/decisions/STORAGE_PROVIDER_REGISTRY_15D1.md`).

Desde la Etapa 15D.3 (`docs/decisions/CLOUDINARY_SECURE_DELIVERY_15D3.md`),
todo upload nuevo a Cloudinary queda con delivery `authenticated` — no es
configurable todavía, no hace falta ninguna variable nueva. El backend nunca
entrega al cliente una URL pública permanente de Cloudinary: descarga el
archivo del proveedor y lo sirve como respuesta autenticada, igual que con
local o Google Drive. Para probar Cloudinary en local hace falta una cuenta
real (`CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`
propios, nunca commiteados) — el mecanismo de descarga autenticada no fue
validado contra una cuenta real durante 15D.3 (ver riesgo residual en el
documento de decisión).
