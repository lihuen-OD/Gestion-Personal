/**
 * Lanzador de los scripts de reorganización con la identidad Neon (D-0,
 * docs/decisions/A8_M2_PREPARATION.md §8.3 y §12.14.10).
 *
 *   npx tsx scripts/org-reorg/neon-admin.ts <script org-reorg-*.ts> [argumentos propios del script]
 *
 * Lee `backend/.env.neon-admin` (ignorado por Git, permisos 600) y:
 * - pasa `NEON_API_KEY` SÓLO en el entorno del proceso hijo: nunca por argv,
 *   nunca por pantalla ni a un archivo;
 * - agrega `--env-file`, `--expected-host`, `--neon-project-id`,
 *   `--expected-branch-id` y `--expected-branch-name` desde el archivo (no se
 *   aceptan también desde la línea de comandos, para que haya una sola fuente).
 * Se niega a correr si el archivo está versionado o no ignorado, si tiene
 * permisos abiertos a grupo/otros, si queda algún placeholder `<...>` o si el
 * archivo de conexión es el `.env` habitual. Las compuertas de cada script
 * (host esperado, identidad verificada) siguen aplicándose igual.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parse } from "dotenv";

const backend = resolve(__dirname, "..", "..");
const ADMIN_FILE = ".env.neon-admin";
const FIELDS = ["NEON_API_KEY", "NEON_PROJECT_ID", "NEON_BRANCH_ID", "NEON_BRANCH_NAME", "REORG_ENV_FILE", "REORG_EXPECTED_HOST"] as const;
const IDENTITY_FLAGS = ["--env-file", "--expected-host", "--neon-project-id", "--expected-branch-id", "--expected-branch-name"];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const git = (...args: string[]) => spawnSync("git", args, { cwd: backend, stdio: "pipe" }).status;

function main() {
  const [script, ...rest] = process.argv.slice(2);
  if (!script || !/^org-reorg-[a-z0-9-]+\.ts$/.test(basename(script)) || !existsSync(join(backend, "scripts", basename(script)))) {
    fail("Uso: npx tsx scripts/org-reorg/neon-admin.ts scripts/org-reorg-<nombre>.ts [argumentos]. Sólo scripts org-reorg-*.ts.");
  }
  const repeated = rest.filter((value) => IDENTITY_FLAGS.some((flag) => value === flag || value.startsWith(`${flag}=`)));
  if (repeated.length) fail(`No pases ${repeated.map((value) => value.split("=")[0]).join(", ")}: salen de ${ADMIN_FILE}.`);

  const path = join(backend, ADMIN_FILE);
  if (!existsSync(path)) fail(`Falta backend/${ADMIN_FILE}.`);
  if (git("ls-files", "--error-unmatch", ADMIN_FILE) === 0) fail(`${ADMIN_FILE} está versionado en Git: no se usa.`);
  if (git("check-ignore", "-q", ADMIN_FILE) !== 0) fail(`${ADMIN_FILE} no está ignorado por Git: no se usa.`);
  if (statSync(path).mode & 0o077) fail(`${ADMIN_FILE} es legible por grupo u otros: chmod 600 backend/${ADMIN_FILE}.`);

  const values = parse(readFileSync(path));
  const missing = FIELDS.filter((field) => !values[field]?.trim() || values[field]!.trim().startsWith("<"));
  if (missing.length) fail(`Completar en backend/${ADMIN_FILE}: ${missing.join(", ")}.`);
  if (basename(values.REORG_ENV_FILE!) === ".env") fail("REORG_ENV_FILE no puede ser el .env habitual.");

  const child = spawnSync(join(backend, "node_modules", ".bin", "tsx"), [
    join("scripts", basename(script)),
    `--env-file=${values.REORG_ENV_FILE}`,
    `--expected-host=${values.REORG_EXPECTED_HOST}`,
    `--neon-project-id=${values.NEON_PROJECT_ID}`,
    `--expected-branch-id=${values.NEON_BRANCH_ID}`,
    `--expected-branch-name=${values.NEON_BRANCH_NAME}`,
    ...rest,
  ], { cwd: backend, stdio: "inherit", env: { ...process.env, NEON_API_KEY: values.NEON_API_KEY, AUTOMATIC_JOBS_ENABLED: "false" } });
  process.exit(child.status ?? 1);
}

main();
