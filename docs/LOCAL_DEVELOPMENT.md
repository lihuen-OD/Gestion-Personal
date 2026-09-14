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
`DEMO_SEED_PASSWORD` al crearse. Para habilitar los accesos rápidos del
frontend, crear `frontend/.env.local` con `VITE_DEMO_MODE=true` y completar las
seis variables `VITE_DEMO_*_EMAIL` / `VITE_DEMO_*_PASSWORD` descriptas en
`frontend/.env.example`. Si falta un email o password, ese perfil no se muestra.

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
