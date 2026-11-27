/**
 * Diagnóstico de SÓLO LECTURA de convocatorias a feriado
 * (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §20, F2.4).
 *
 *   npx tsx scripts/diagnose-holiday-convocations.ts --env-file=<archivo> --expected-host=<host>
 *       [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--json]
 *       [--confirm-non-production]        (destino remoto confirmado como NO production)
 *       [--production-read-authorized]    (sólo con autorización explícita previa)
 *
 * Informa las convocatorias ACTIVAS del rango (sin --from/--to, los próximos 28
 * días) que quedan sin horario esperado, con plantilla inválida, con horario
 * libre sin turno, con una plantilla distinta del turno real del día o en una
 * fecha que ya no es feriado. Nunca escribe: transacción READ ONLY verificada y
 * cliente que bloquea toda operación que no sea lectura
 * (src/modules/shifts/diagnostics/readOnlyDiagnostic.ts). No imprime la cadena
 * de conexión ni credenciales.
 *
 * GUARDA: no agregar escrituras a este script (readOnlyDiagnostic.test.ts).
 */
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { PrismaClient } from "@prisma/client";
import {
  assertDiagnosticTargetAllowed,
  describeDatabaseTarget,
  diagnosticHeader,
  parseDiagnosticArgs,
  runInReadOnlyTransaction,
} from "../src/modules/shifts/diagnostics/readOnlyDiagnostic";
import { resolveDiagnosticRange } from "../src/modules/shifts/diagnostics/shiftAssignmentDiagnostic";
import {
  formatHolidayConvocationDiagnostic,
  runHolidayConvocationDiagnostic,
  type HolidayConvocationDiagnosticReader,
} from "../src/modules/shifts/diagnostics/holidayConvocationDiagnostic";

async function main() {
  const args = parseDiagnosticArgs(process.argv.slice(2));
  const envVars = parse(readFileSync(args.envFile));
  const target = describeDatabaseTarget(envVars.DATABASE_URL, envVars);
  const range = resolveDiagnosticRange(args.from, args.to);

  // Siempre a stderr: el stdout queda limpio para --json.
  console.error(["HOLIDAY CONVOCATION DIAGNOSTIC", ...diagnosticHeader(target, range)].join("\n"));
  assertDiagnosticTargetAllowed(target, args);

  const prisma = new PrismaClient({ datasourceUrl: envVars.DATABASE_URL });
  try {
    const report = await runInReadOnlyTransaction(prisma, (reader: HolidayConvocationDiagnosticReader) => runHolidayConvocationDiagnostic(reader, range));
    console.log(args.json ? JSON.stringify({ target: { host: target.host, database: target.database, appEnv: target.appEnv, nodeEnv: target.nodeEnv }, ...report }, null, 2) : formatHolidayConvocationDiagnostic(report));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
