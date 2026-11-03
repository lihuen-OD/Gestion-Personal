/**
 * Gate de historial de migraciones para PRs (docs/GIT_WORKFLOW.md §5). Compara HEAD contra
 * el merge-base con la rama destino y falla si:
 * - una carpeta de migración que ya existe en el destino se modificó, renombró o borró
 *   (Prisma no vuelve a aplicar una migración registrada: el cambio nunca llegaría a una
 *   base que ya la tiene, y `migrate dev` lo marcaría como drift);
 * - cambió `migration_lock.toml`;
 * - una migración nueva no tiene `migration.sql`, no sigue el formato `<14 dígitos>_<nombre>`
 *   o no ordena después de la última del destino (Prisma aplica por nombre: una nueva "en el
 *   pasado" quedaría en otro orden en producción que en desarrollo).
 *
 * Uso: npx tsx scripts/ci/check-migration-history.ts <ref-destino>   (p. ej. origin/main)
 */
import { execFileSync } from "node:child_process";

const MIGRATIONS_PATH = "backend/prisma/migrations";
const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+$/;

function git(args: string[]) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

function main() {
  const target = process.argv[2];
  if (!target) throw new Error("Uso: check-migration-history.ts <ref-destino> (p. ej. origin/main).");

  const mergeBase = git(["merge-base", target, "HEAD"]);
  const existing = new Set(git(["ls-tree", "--name-only", `${mergeBase}:${MIGRATIONS_PATH}`]).split("\n").filter((name) => name && name !== "migration_lock.toml"));
  const latestExisting = [...existing].sort().at(-1) ?? "";

  const changes = git(["diff", "--name-status", "--no-renames", mergeBase, "HEAD", "--", MIGRATIONS_PATH])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, path] = line.split("\t");
      return { status: status ?? "", folder: (path ?? "").slice(MIGRATIONS_PATH.length + 1).split("/")[0] ?? "" };
    });

  const errors: string[] = [];
  const added = new Set<string>();
  for (const { status, folder } of changes) {
    if (folder === "migration_lock.toml") errors.push(`migration_lock.toml cambió (${status}).`);
    else if (existing.has(folder)) errors.push(`${folder} ya existe en ${target} y no se puede modificar ni borrar (${status}).`);
    else added.add(folder);
  }

  for (const folder of [...added].sort()) {
    if (!MIGRATION_NAME.test(folder)) errors.push(`${folder}: el nombre debe ser <14 dígitos>_<nombre_en_minúsculas>.`);
    if (folder <= latestExisting) errors.push(`${folder} ordena antes que ${latestExisting}, la última migración de ${target}.`);
    try {
      git(["cat-file", "-e", `HEAD:${MIGRATIONS_PATH}/${folder}/migration.sql`]);
    } catch {
      errors.push(`${folder} no tiene migration.sql.`);
    }
  }

  if (errors.length) {
    console.error(`Historial de migraciones inválido respecto de ${target}:\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }
  console.log(added.size ? `Migraciones nuevas respecto de ${target} (${added.size}): ${[...added].sort().join(", ")}.` : `Sin migraciones nuevas respecto de ${target}.`);
  console.log(`Ninguna migración existente cambió. Última en ${target}: ${latestExisting}.`);
}

main();
