/**
 * E/S compartida de los scripts de reorganización
 * (docs/decisions/ORG_LOCATION_REORGANIZATION.md §5).
 *
 * Conexión SIEMPRE explícita: la URL sale de `--env-file=<archivo>` (nunca del
 * `.env` habitual) y su host debe coincidir con `--expected-host`. Antes de
 * importar cualquier módulo de la app se fija process.env.DATABASE_URL a esa
 * URL, así ningún cliente puede caer en otra base.
 */
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { assertExpectedHost, verifyNeonIdentity, type NeonIdentity } from "../../src/modules/org-structure/reorg/targetIdentity";
import { engineOutcomeLabel, type EngineEvaluation } from "../../src/modules/time-entries/specialHourEvidence";
import type { Tx } from "../../src/modules/org-structure/reorg/catalogReads";

// Las lecturas viven en src (tipadas por el tsconfig de CI y probables en
// integración); se re-exportan para los scripts.
export * from "../../src/modules/org-structure/reorg/catalogReads";

// `EngineEvaluation` y `engineOutcomeLabel` viven en el módulo puro de
// evidencia (src) y se re-exportan acá para los scripts D5/A8.
export { engineOutcomeLabel };
export type { EngineEvaluation };


export function arg(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}
export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export interface Target { prisma: PrismaClient; host: string; databaseUrl: string; identity: NeonIdentity }

/** Conecta al destino declarado y comprueba (si hay credencial) su identidad Neon. */
export async function connectTarget(): Promise<Target> {
  const envFile = arg("env-file");
  if (!envFile) throw new Error("Falta --env-file=<archivo>: el destino nunca se toma del .env habitual.");
  const databaseUrl = parse(readFileSync(envFile)).DATABASE_URL;
  if (!databaseUrl) throw new Error(`${envFile} no define DATABASE_URL.`);
  const host = assertExpectedHost(databaseUrl, arg("expected-host"));
  process.env.DATABASE_URL = databaseUrl;
  const identity = await verifyNeonIdentity({
    databaseUrl,
    apiKey: process.env.NEON_API_KEY,
    projectId: arg("neon-project-id"),
    expectedBranchId: arg("expected-branch-id"),
    expectedBranchName: arg("expected-branch-name"),
  });
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  return { prisma, host, databaseUrl, identity };
}

/** Transacción de SÓLO LECTURA: Postgres rechaza cualquier escritura. */
export function readOnly<T>(prisma: PrismaClient, operation: (tx: Tx) => Promise<T>, timeout = 300_000): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return operation(tx as Tx);
  }, { timeout, maxWait: 30_000 });
}

