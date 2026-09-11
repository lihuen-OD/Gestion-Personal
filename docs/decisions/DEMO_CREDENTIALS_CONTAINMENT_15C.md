# Etapa 15C — Contención de credenciales demo y seed seguro

## Contexto y riesgo

La auditoría read-only 15B confirmó que el login precompletaba una cuenta demo,
que los accesos rápidos conservaban tres pares email/password hardcodeados y
que no existía gating por ambiente. Esos valores entraban al grafo productivo
de Vite. También confirmó que el seed podía ejecutarse contra cualquier
`DATABASE_URL` sin rechazar producción.

## Decisión

- El login normal inicia siempre con email y contraseña vacíos.
- El copy y los accesos rápidos demo sólo se renderizan con
  `VITE_DEMO_MODE=true` y únicamente para perfiles cuyo email y contraseña
  estén completos.
- Las credenciales rápidas se leen de variables `VITE_DEMO_*`; no existen
  valores por defecto ni credenciales versionadas en el frontend.
- `authApiService` y `AuthContext` sólo conservan el flujo de autenticación
  normal. El acceso rápido reutiliza `login(email, password)` desde la página.
- El seed rechaza `APP_ENV=production` o `NODE_ENV=production` antes de su
  primera operación Prisma y exige `DEMO_SEED_PASSWORD` con al menos ocho
  caracteres fuera de producción.

## Habilitación local explícita

Crear `frontend/.env.local`, mantenerlo fuera de Git y configurar:

```dotenv
VITE_DEMO_MODE=true
VITE_DEMO_ADMIN_EMAIL=
VITE_DEMO_ADMIN_PASSWORD=
VITE_DEMO_SUPERVISOR_EMAIL=
VITE_DEMO_SUPERVISOR_PASSWORD=
VITE_DEMO_CARGA_EMAIL=
VITE_DEMO_CARGA_PASSWORD=
```

Las variables `VITE_*` son públicas por definición y quedan embebidas en un
build demo. Deben usarse sólo en un ambiente demo controlado, nunca para una
cuenta o contraseña de producción.

Para crear los usuarios demo, configurar `DEMO_SEED_PASSWORD` en el entorno
local del backend y ejecutar manualmente `npm run prisma:seed`. El seed no se
ejecuta como parte de CI ni de las migraciones.

## Fuera de alcance

No se conectó ni escribió ninguna base, no se rotaron o borraron usuarios, no
se modificó Prisma schema ni se crearon migraciones. Tampoco se tocaron storage,
Cloudinary, Google Drive, documentos, RBAC, permisos, carga horaria, cierres o
fichador.

## Recomendación operativa

No versionar credenciales demo: guardarlas solamente en `.env.local` o en el
gestor de secretos del ambiente. Como estas credenciales existieron en staging,
su rotación manual sigue siendo necesaria; este cambio no altera usuarios ya
persistidos. Cuando exista producción, verificar que no contenga usuarios demo
y que ambos indicadores de entorno estén correctamente configurados.

## Validación

- Frontend: 83 archivos / 807 tests; typecheck e2e y build productivo verdes.
- Backend: 99 archivos / 1423 tests; Prisma validate, typecheck y build verdes.
- Tests nuevos del login vacío, login manual, gating, perfiles configurados y
  rechazo seguro del seed.
- Búsqueda del build productivo: ninguna de las tres cuentas demo ni la
  contraseña histórica aparece en `frontend/dist`.
- `git diff --check` sin errores.
