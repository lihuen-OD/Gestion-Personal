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
npm run prisma:seed
```

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
admin@losod.local / Admin1234!

Supervisor:
supervisor@losod.local / Admin1234!

Carga horaria:
carga@losod.local / Admin1234!
```

## Frontend

Crear:

```txt
frontend/.env
```

Contenido:

```bash
VITE_API_URL=http://localhost:4002/api
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
