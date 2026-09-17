// Etapa 15M.4 (docs/decisions/ATTENDANCE_NORMAL_HOURS_RECONCILIATION_15M4.md):
// herramienta interna de reconciliación de Hora normal histórica, corrompida
// por la regresión de la Etapa 13F (corregida en la Etapa 15M.3). NO es un
// endpoint HTTP -- mismo criterio ya usado por scripts/reconcile-clock-orphans.ts
// para operaciones de reconciliación de datos reales: default seguro
// (dry-run), modo de escritura detrás de un flag explícito y guard de
// entorno.
//
// Uso:
//   npx tsx scripts/reconcile-normal-hours.ts --mode=dry-run --employee-legajo=30 --period=2026-09
//   npx tsx scripts/reconcile-normal-hours.ts --mode=repair  --employee-legajo=30 --date=2026-09-16
//
// Flags:
//   --mode=dry-run|repair   (default: dry-run -- si falta o es inválido, nunca se asume repair)
//   --employee-legajo=NN    (opcional; sin esto, alcanza a TODOS los empleados con actividad en el rango)
//   --period=YYYY-MM        (requerido salvo que se use --date)
//   --date=YYYY-MM-DD       (acota a un único día calendario)
//   --snapshot-dir=PATH     (repair: dónde guardar el snapshot pre-escritura; default backend/.reconciliation-snapshots)
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../src/config/env";
import { prisma } from "../src/shared/prisma/client";
import { normalHoursReconciliationService } from "../src/modules/time-entries/normalHoursReconciliation.service";
import type { ReconciliationScope } from "../src/modules/time-entries/normalHoursReconciliation.service";

function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const match = arg.match(/^--([a-z-]+)=(.*)$/);
    if (match) flags[match[1]!] = match[2]!;
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  // Default explícito y seguro: cualquier valor que no sea exactamente
  // "repair" cae en dry-run -- nunca se asume repair por un flag mal escrito.
  const mode: "dry-run" | "repair" = flags.mode === "repair" ? "repair" : "dry-run";

  const scope: ReconciliationScope = {
    legajo: flags["employee-legajo"],
    period: flags.period,
    date: flags.date,
  };

  if (mode === "repair" && env.APP_ENV !== "staging") {
    throw new Error(`Refusing normal-hours repair in APP_ENV=${env.APP_ENV} (sólo permitido en staging, mismo guard que reconcile-clock-orphans.ts)`);
  }

  if (mode === "dry-run") {
    const report = await normalHoursReconciliationService.dryRun(scope);
    console.log(JSON.stringify({ mode, ...report }, null, 2));
    return;
  }

  const snapshotDir = flags["snapshot-dir"] || path.join(__dirname, "..", ".reconciliation-snapshots");
  const report = await normalHoursReconciliationService.repair(scope, {
    snapshot: async (payload) => {
      await mkdir(snapshotDir, { recursive: true });
      const fileName = `normal-hours-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const filePath = path.join(snapshotDir, fileName);
      await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
      console.error(`Snapshot pre-repair guardado en: ${filePath}`);
      return filePath;
    },
  });
  console.log(JSON.stringify({ mode, ...report }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
