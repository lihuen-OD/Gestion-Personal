# Flujo Git, CI y CD

Vigente desde el 2026-11-03. Define cómo nace, se integra y llega a producción cada cambio. El repositorio es **público**: nunca se versionan credenciales, URLs con usuario o contraseña, ni datos reales.

```text
feat/* · fix/*  ──PR + CI──▶  development  ──PR + CI completo──▶  main  ──deploy manual──▶  producción
                              (integración y QA)                   (producción)
```

## 1. Ramas

| Rama | Rol | Nace de | Vuelve a | Reglas |
|---|---|---|---|---|
| `main` | Versión oficial de **producción** | — | — | Nunca se desarrolla sobre ella ni recibe pushes directos. Sólo recibe el PR `development → main` (o un `hotfix/*`, §4) |
| `development` | Integración y QA. Rama de trabajo del equipo | `main` (una vez) | `main`, por PR | Toda feature o corrección sale de acá y vuelve acá por PR. Nunca se reescribe (sin force push) |
| `feat/<nombre>` | Funcionalidad nueva | `development` | `development`, por PR | Temporal. Se borra después del merge si ya no se usa |
| `fix/<nombre>` | Corrección | `development` | `development`, por PR | Igual que `feat/*` |
| `hotfix/<nombre>` | Corrección urgente de producción | `main` | `main` y después `development` | Sólo con la estrategia de §4 |

Nombres en minúsculas y con guiones: `feat/francos-carga-horaria`, `fix/cache-asistencia`.

## 2. Flujo normal

```bash
git switch development
git pull --ff-only origin development
git switch -c feat/nombre
# commits pequeños y coherentes
git push -u origin feat/nombre
```

1. Abrir un PR `feat/nombre → development`.
2. Esperar el check **CI result** en verde (§5). Si falla, se corrige en la rama; nunca se debilita el CI para que pase.
3. Mergear con **merge commit**, para conservar los commits de la feature en la historia.
4. Si `development` avanzó mientras tanto, actualizar la rama con `git merge origin/development`. No usar rebase sobre una rama ya pusheada.

Las migraciones Prisma siguen [DATABASE_STANDARDS.md](DATABASE_STANDARDS.md): una carpeta nueva por cambio, con timestamp posterior a la última de `development`, sin editar nunca una migración existente. El CI lo verifica (§5.2).

## 3. Promoción a producción (`development → main`)

Cuando `development` tiene una versión completa y probada en QA:

1. Abrir el PR `development → main`. Es el **gateway de producción**: corre el CI completo, más el check de origen (`Promotion source`).
2. Revisar la lista de commits y de migraciones nuevas del PR. El job `Database` imprime las migraciones que el PR agrega respecto de `main`.
3. Mergear con **merge commit**, nunca squash ni rebase. Un squash deja a `main` con commits que no existen en `development` y cada promoción siguiente arrastra conflictos.
4. Recién con el merge en `main` corresponde el deploy de producción (§6), del SHA exacto de `main` con CI verde.
5. Alinear `development` con el merge commit, para que `main..development` muestre sólo trabajo pendiente:

   ```bash
   git switch development
   git pull --ff-only origin development
   git merge --ff-only origin/main
   git push origin development
   ```

## 4. Hotfix de producción

> **Propuesta, a confirmar por el equipo.** Todavía no se usó. Si se elige otra estrategia, actualizar este punto y el job `promotion-source` de `.github/workflows/ci.yml`, que hoy acepta `hotfix/*` como origen de un PR a `main`.

Sólo cuando producción tiene un problema que no puede esperar a la próxima promoción, y `development` tiene trabajo que todavía no debe salir:

1. `git switch -c hotfix/nombre origin/main`: la corrección mínima, con su test.
2. PR `hotfix/nombre → main`, con CI completo. Merge con merge commit y deploy (§6).
3. Inmediatamente después, PR `main → development` (o merge de `origin/main` en `development`), para que la corrección no se pierda en la próxima promoción. Nunca hacer cherry-pick silencioso.

Si `development` ya está lista para salir, no hace falta un hotfix: se corrige con `fix/*` sobre `development` y se promueve normalmente (§3).

## 5. CI (`.github/workflows/ci.yml`)

El CI valida; nunca despliega, nunca usa secretos y nunca toca una base real. Detalle de cada paso y comandos locales: [DEVOPS_DEPLOYMENT_STANDARDS.md](DEVOPS_DEPLOYMENT_STANDARDS.md) → "Continuous Integration".

### 5.1 Qué corre en cada evento

| Evento | Backend | Database | Frontend | Fichador | Promotion source | CI result |
|---|---|---|---|---|---|---|
| PR `feat/*` / `fix/*` → `development` | ✔ | ✔ (con historial contra `development`) | ✔ | ✔ | omitido | ✔ |
| Push / merge a `development` | ✔ | ✔ (sin chequeo de historial) | ✔ | ✔ | omitido | ✔ |
| PR `development` → `main` | ✔ | ✔ (con historial contra `main`) | ✔ | ✔ | ✔ | ✔ |
| Push / merge a `main` | ✔ | ✔ (sin chequeo de historial) | ✔ | ✔ | omitido | ✔ |
| Manual (`workflow_dispatch`) | ✔ | ✔ (sin chequeo de historial) | ✔ | ✔ | omitido | ✔ |

En un PR, un push nuevo cancela la corrida anterior. En `main` y `development` cada push conserva la suya.

| Job (nombre del check) | Qué valida |
|---|---|
| `Backend` | `npm ci`, `prisma validate`, `prisma generate`, `typecheck`, tests unitarios (Prisma mockeado), `build` |
| `Database (migrations + integration)` | Historial de migraciones (sólo en PR), migraciones sobre base limpia y las suites de integración contra PostgreSQL real (§5.2) |
| `Frontend` | `npm ci`, tests, `typecheck:e2e` (compila los journeys de Playwright) y `build` (`tsc -b` + Vite) |
| `Fichador` | `npm ci`, tests, `typecheck:e2e` y `build` (`tsc -b` + Vite + headers + aislamiento del bundle) |
| `Promotion source (PR to main)` | Un PR a `main` sólo puede salir de `development` o `hotfix/*`, y de este mismo repositorio |
| `CI result` | Falla si cualquier job anterior falló o se canceló. Un job omitido no cuenta como falla. Es el check a exigir (§7) |

**Lint:** ningún paquete tiene ESLint ni script `lint`, así que el CI no lo corre. Agregarlo es una decisión aparte, con su propia limpieza inicial.

### 5.2 Gate de migraciones e integración (job `Database`)

Corre sobre un PostgreSQL 18 efímero del runner (la misma versión mayor que Neon). Los dos scripts rechazan cualquier host que no sea `localhost`, así que nunca pueden apuntar a Neon.

| Pregunta | Cómo se responde |
|---|---|
| ¿El schema es válido? | `prisma validate` en el job `Backend` |
| ¿El historial es consistente? | En cada PR, `backend/scripts/ci/check-migration-history.ts` contra el merge-base con la rama destino. Falla si una migración existente se modificó, renombró o borró, si cambió `migration_lock.toml`, o si una nueva no tiene `migration.sql`, no respeta el formato `<14 dígitos>_<nombre>` u ordena antes que la última del destino |
| ¿Una base limpia llega al schema por migraciones? | `backend/scripts/ci/migrate-clean-database.ts` aplica las 71+ migraciones sobre una base vacía. Después, `prisma migrate status` tiene que estar al día |
| ¿Los cambios de schema están versionados? | El mismo script compara con `prisma migrate diff --exit-code`: la base migrada tiene que ser exactamente `schema.prisma`. Si falta una migración, imprime el SQL faltante y falla |

**Por qué el script y no sólo `prisma migrate deploy`.** La migración histórica `20260824170000_normalize_hour_concepts` exige que exista la fila `HC-NORMAL`. Esa fila la crea `prisma/seed.ts`, no ninguna migración, así que en una base vacía la migración aborta (conocido desde la Etapa 10D). Como las migraciones aplicadas no se editan, el script aplica el historial hasta la anterior, inserta esa única fila (la misma que tiene toda base real) y completa el resto con `migrate deploy`. Si esa migración desapareciera o cambiara de nombre, el script falla y obliga a revisarlo.

**Suites de integración.** Cada suite opt-in recibe su propia copia de la base recién migrada (`CREATE DATABASE … TEMPLATE`), porque todas vacían su base al empezar.

- **Corren en CI (8):**
  - `clock/clock`, `clock/clockPunchPerf` y `clock/clockPunchPostProcess`;
  - `clock-devices/clockDevices` y `clock-devices/clockDeviceMaintenance`;
  - `employee-day-offs/employeeDayOff`;
  - `time-entries/manualHoursConflict`;
  - `org-structure/controlledDeletion`.
- **Quedan afuera (2):** `org-structure/reorg/m2Migration` y `org-structure/reorg/cleanupRestore`. Las dos necesitan un schema **previo a M2**:
  - la primera, por diseño: ejecuta la migración M2 dentro de una transacción revertida;
  - la segunda, porque su fixture inserta un `Establishment` activo con los padres legacy, que la CHECK `Establishment_archive_shape_check` de M2 rechaza.

  Son el registro de la limpieza A8/M2, que ya corrió el 2026-10-09 (ver `docs/decisions/A8_M2_PREPARATION.md`). Se ejecutan sólo a mano, sobre una base migrada hasta antes de M2.

**Correrlo localmente** (Postgres.app o cualquier PostgreSQL local, con bases nuevas y vacías):

```bash
cd backend
createdb ci_migrations
DATABASE_URL=postgresql://<usuario>@localhost:5432/ci_migrations \
  npx tsx scripts/ci/migrate-clean-database.ts --clone=clock_it_ci,deletion_it_ci
CLOCK_IT_DATABASE_URL=postgresql://<usuario>@localhost:5432/clock_it_ci \
  npx vitest run src/modules/clock/clock.integration.test.ts
npx tsx scripts/ci/check-migration-history.ts origin/development
```

## 6. CD (despliegue)

### 6.1 Estado actual (verificado el 2026-11-03)

| Mecanismo | Estado | Evidencia |
|---|---|---|
| GitHub Actions | **No despliega nada.** Sólo valida | `.github/workflows/ci.yml` es el único workflow; sin secretos ni pasos de deploy |
| Integraciones de Netlify / Render en GitHub | **Sin rastro.** Ningún deployment, environment, status ni check de terceros | API de GitHub: 0 deployments y 0 environments; el último commit de `main` sólo tiene los checks de Actions (igual que en la auditoría de F2) |
| Admin (Netlify, base `frontend`) | Configuración versionada en `frontend/netlify.toml`: build en Netlify, deploy previews y branch deploys apagados | El panel no es verificable desde el repo |
| Fichador (Netlify, base `fichador`) | Ídem, `fichador/netlify.toml` | Ídem |
| Backend (Render) | Documentado en `PUBLIC_STAGING_PLAN.md` §4: rama `main`, deploy **manual** de un SHA con CI verde (auto-deploy apagado), pre-deploy `prisma migrate deploy` con `DIRECT_URL` | No hay `render.yaml`. El servicio real sólo es verificable en el panel |
| Neon `development` (rama de prueba) | Base de staging/testing. 71 migraciones aplicadas, incluidas `20261026120000_add_clock_device_maintenance_access` y `20261103120000_add_employee_day_off` | `prisma migrate status` en sólo lectura: "up to date"; `migrate diff` contra `schema.prisma`: vacío |
| Producción | No está descripta en el repositorio: otra configuración y otra base | — |

**Qué se despliega automáticamente hoy:** nada desde GitHub. Los paneles de Netlify y Render pueden igual tener builds automáticos configurados. Por ejemplo, un sitio de Netlify enlazado al repo construye en cada push a su rama de producción, salvo que se hayan detenido los builds (lo que `PUBLIC_STAGING_PLAN.md` §6 recomienda). Hay que verificarlo en cada panel (§8).

### 6.2 Contradicción a resolver

`PUBLIC_STAGING_PLAN.md` §4 hace que staging despliegue desde `main`. Con este flujo `main` es producción, así que staging sólo vería un cambio después de que ya llegó a producción. Mientras no se reconfigure, **staging y producción no deben seguir la misma rama**.

### 6.3 Modelo objetivo

| Entorno | Rama | Base | Disparador | Migraciones |
|---|---|---|---|---|
| Staging / QA | `development` | Neon `development` | Deploy manual de un SHA de `development` con **CI result** verde (o auto-deploy, si el equipo lo decide) | Pre-deploy `prisma migrate deploy` con el `DIRECT_URL` de staging |
| Producción | `main` | Neon de producción | Deploy **manual** de un SHA de `main` con **CI result** verde, sólo después del merge del PR `development → main` | Pre-deploy `prisma migrate deploy` con el `DIRECT_URL` de producción, después de un backup o punto de restore |

Nunca se despliega desde un PR, desde `feat/*` / `fix/*` ni desde un deploy preview. Ningún workflow de GitHub recibe credenciales de producción.

## 7. Protección de ramas (configuración manual en GitHub)

Hoy `main` y `development` **no tienen protección ni rulesets** (verificado el 2026-11-03). Se configura en *Settings → Rules → Rulesets → New branch ruleset*, o en *Settings → Branches → Add branch protection rule*. El check `CI result` aparece en el buscador una vez que corrió al menos una vez.

| Opción | `main` | `development` |
|---|---|---|
| Require a pull request before merging | Sí | Sí |
| Required approvals | 0 si hay un solo mantenedor (GitHub no deja aprobar el PR propio); 1 cuando haya un segundo revisor | 0 |
| Require status checks to pass | Sí: **`CI result`** | Sí: **`CI result`** |
| Require branches to be up to date before merging | Sí | Opcional (no recomendado: obliga a re-correr el CI por cada merge ajeno) |
| Block force pushes | Sí | Sí |
| Restrict deletions | Sí | Sí |
| Do not allow bypassing the above settings | Sí (si se deja bypass para administradores, usarlo sólo en emergencias y registrarlo) | Recomendado |

- **Un solo check obligatorio.** `CI result` ya depende de los demás jobs. Si además se quieren exigir individualmente, sus nombres son `Backend`, `Database (migrations + integration)`, `Frontend` y `Fichador`.
- **`Promotion source (PR to main)` no se marca.** Se omite fuera de los PRs a `main`, y `CI result` ya lo incluye.
- **Renombres.** Si se renombra un job, hay que actualizar los checks exigidos.
- **Merge.** En *Settings → General → Pull Requests* se recomienda permitir sólo **merge commits** (§2 y §3).

## 8. Pendientes de configuración manual

- **GitHub:** protección de `main` y `development` (§7) y método de merge. Opcional: *Automatically delete head branches*.
- **Render:**
  - verificar qué rama sigue el servicio de staging, si el auto-deploy está apagado y el pre-deploy;
  - pasar staging a `development` (§6.2–§6.3) y crear o confirmar el servicio de producción sobre `main`, con su propio entorno.
- **Netlify:**
  - verificar en cada sitio (admin y fichador) la rama de producción, que *Deploy previews* y *Branch deploys* estén en *None* y si los builds automáticos están detenidos;
  - separar los sitios de staging (`development`) de los de producción (`main`).
- **Neon:**
  - confirmar que las credenciales de producción existen sólo en los servicios de producción;
  - confirmar el punto de restore antes de la primera promoción con migraciones nuevas: `20261026120000` y `20261103120000` todavía no están en producción.

## 9. Registro: puesta en marcha del flujo (2026-11-03)

- **`main`:** `6e9e03e` antes y después; no se modificó.
- **`development`:**
  - antes: `b8c8e47`, ya contenida en `main` por el merge `cc8e4fc` (0 commits propios y 49 detrás), así que se adelantó a `main` por fast-forward, sin perder nada;
  - después: se integraron con `--no-ff`, en este orden, `fix/staging-fichador-ajustes` (modo mantenimiento del fichador y corrección de caché de asistencia, 6 commits) y `feat/francos-carga-horaria` (francos, 5 commits). El árbol resultante es idéntico al de `feat/francos-carga-horaria`, que es lo validado en local. Sin conflictos.
- **CI:** este documento y el gate de migraciones entraron por `feat/ci-development-flow`.
