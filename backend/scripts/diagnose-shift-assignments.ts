/**
 * Diagnóstico de SÓLO LECTURA de asignaciones de turno — Etapa R1
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §19).
 *
 *   npx tsx scripts/diagnose-shift-assignments.ts --env-file=<archivo> --expected-host=<host>
 *       [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--json]
 *       [--confirm-non-production]        (destino remoto confirmado como NO production)
 *       [--production-read-authorized]    (sólo con autorización explícita previa)
 *
 * Informa: valores de ShiftTemplate.categoryName, empleados ACTIVO con 2+
 * ShiftAssignment HABILITADAS aplicables el mismo día y qué hace hoy cada
 * consumidor esos días (obligación, entrada, Novedades, superposición).
 * Sin --from/--to analiza los próximos 28 días desde hoy (Argentina).
 *
 * Nunca escribe: no tiene modo de aplicación, corre en una transacción READ ONLY
 * verificada y con un cliente que bloquea toda operación que no sea lectura
 * (src/modules/shifts/diagnostics/readOnlyDiagnostic.ts). No imprime la cadena
 * de conexión ni credenciales: sólo host y nombre de la base.
 *
 * GUARDA: no agregar escrituras a este script. readOnlyDiagnostic.test.ts
 * falla si aparecen operaciones de escritura, raw inseguro o imports del
 * cliente Prisma compartido / config/env (que leerían el .env habitual).
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
import {
  formatShiftAssignmentDiagnostic,
  resolveDiagnosticRange,
  runShiftAssignmentDiagnostic,
  type ShiftDiagnosticReader,
} from "../src/modules/shifts/diagnostics/shiftAssignmentDiagnostic";

async function main() {
  const args = parseDiagnosticArgs(process.argv.slice(2));
  const envVars = parse(readFileSync(args.envFile));
  const target = describeDatabaseTarget(envVars.DATABASE_URL, envVars);
  const range = resolveDiagnosticRange(args.from, args.to);

  // Siempre a stderr: el stdout queda limpio para --json.
  console.error(["SHIFT ASSIGNMENT DIAGNOSTIC", ...diagnosticHeader(target, range)].join("\n"));
  assertDiagnosticTargetAllowed(target, args);

  const prisma = new PrismaClient({ datasourceUrl: envVars.DATABASE_URL });
  try {
    const report = await runInReadOnlyTransaction(prisma, (reader: ShiftDiagnosticReader) => runShiftAssignmentDiagnostic(reader, range));
    const output = args.json
      ? JSON.stringify({ target: { host: target.host, database: target.database, appEnv: target.appEnv, nodeEnv: target.nodeEnv }, ...report }, null, 2)
      : formatShiftAssignmentDiagnostic(report);
    console.log(output);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
