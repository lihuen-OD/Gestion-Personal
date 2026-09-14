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

## Puertos

Recomendado:

```txt
Frontend: http://localhost:5173
Backend:  http://localhost:4002/api
```

Si el backend usa otro puerto, actualizar ambos valores con el mismo puerto:

```bash
PORT=<PUERTO_BACKEND>
VITE_API_URL=http://localhost:<PUERTO_BACKEND>/api
```

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
