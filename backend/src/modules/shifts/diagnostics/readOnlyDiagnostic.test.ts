import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertDiagnosticTargetAllowed,
  describeDatabaseTarget,
  diagnosticHeader,
  DiagnosticTargetRefused,
  DiagnosticUsageError,
  parseDiagnosticArgs,
  readOnlyClient,
  ReadOnlyViolationError,
  runInReadOnlyTransaction,
} from "./readOnlyDiagnostic";

const BASE_ARGS = ["--env-file=.env.diagnostic", "--expected-host=localhost"];
const LOCAL_URL = "postgresql://user:s3cret-pass@localhost:5432/gestion_dev?schema=public";
const REMOTE_URL = "postgresql://owner:s3cret-pass@ep-sample-123.us-east-1.aws.neon.tech/neondb?sslmode=require";

describe("parseDiagnosticArgs — lista blanca cerrada", () => {
  it("acepta los flags declarados", () => {
    expect(parseDiagnosticArgs([...BASE_ARGS, "--from=2026-11-16", "--to=2026-11-30", "--json", "--confirm-non-production"])).toEqual({
      envFile: ".env.diagnostic",
      expectedHost: "localhost",
      from: "2026-11-16",
      to: "2026-11-30",
      json: true,
      confirmNonProduction: true,
      productionReadAuthorized: false,
    });
  });

  it.each([["--apply"], ["--apply=true"], ["--write"], ["--fix"], ["--mode=repair"], ["posicional"]])("rechaza %s antes de conectar", (extra) => {
    expect(() => parseDiagnosticArgs([...BASE_ARGS, extra])).toThrow(DiagnosticUsageError);
  });

  it("exige --env-file y --expected-host (el destino nunca es implícito)", () => {
    expect(() => parseDiagnosticArgs(["--expected-host=localhost"])).toThrow(/--env-file/);
    expect(() => parseDiagnosticArgs(["--env-file=.env"])).toThrow(/--expected-host/);
  });

  it("valida fechas y orden", () => {
    expect(() => parseDiagnosticArgs([...BASE_ARGS, "--from=16/11/2026"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseDiagnosticArgs([...BASE_ARGS, "--from=2026-11-30", "--to=2026-11-01"])).toThrow(/anterior/);
    expect(() => parseDiagnosticArgs([...BASE_ARGS, "--json=yes"])).toThrow(DiagnosticUsageError);
  });
});

describe("describeDatabaseTarget — nunca expone credenciales", () => {
  it("devuelve sólo host, base y entorno declarado", () => {
    const target = describeDatabaseTarget(LOCAL_URL, { APP_ENV: "local" });
    expect(target).toEqual({ host: "localhost", database: "gestion_dev", isLocal: true, appEnv: "local", nodeEnv: null, declaredProduction: false });
    const printed = JSON.stringify(target) + diagnosticHeader(target, { from: "2026-11-16", to: "2026-12-13", days: 28 }).join("\n");
    expect(printed).not.toMatch(/s3cret|user:|sslmode|schema=/);
  });

  it("marca production si APP_ENV o NODE_ENV lo declaran", () => {
    expect(describeDatabaseTarget(REMOTE_URL, { APP_ENV: "production" }).declaredProduction).toBe(true);
    expect(describeDatabaseTarget(REMOTE_URL, { NODE_ENV: "production" }).declaredProduction).toBe(true);
    expect(describeDatabaseTarget(REMOTE_URL, { APP_ENV: "staging" }).declaredProduction).toBe(false);
  });

  it("errores sin filtrar el contenido de la URL", () => {
    expect(() => describeDatabaseTarget(undefined, {})).toThrow(/no define DATABASE_URL/);
    expect(() => describeDatabaseTarget("no es url s3cret", {})).toThrow(/no se muestra/);
    expect(() => describeDatabaseTarget("mysql://u:s3cret@h/db", {})).toThrow(/PostgreSQL/);
  });
});

describe("assertDiagnosticTargetAllowed", () => {
  const flags = { confirmNonProduction: false, productionReadAuthorized: false };
  const local = describeDatabaseTarget(LOCAL_URL, { APP_ENV: "local" });
  const remoteStaging = describeDatabaseTarget(REMOTE_URL, { APP_ENV: "staging" });
  const remoteProduction = describeDatabaseTarget(REMOTE_URL, { APP_ENV: "production" });
  const remoteHost = "ep-sample-123.us-east-1.aws.neon.tech";

  it("local: permitido", () => {
    expect(() => assertDiagnosticTargetAllowed(local, { ...flags, expectedHost: "localhost" })).not.toThrow();
  });

  it("host distinto del declarado: STOP", () => {
    expect(() => assertDiagnosticTargetAllowed(local, { ...flags, expectedHost: "otro-host" })).toThrow(DiagnosticTargetRefused);
  });

  it("remoto no production: exige --confirm-non-production", () => {
    expect(() => assertDiagnosticTargetAllowed(remoteStaging, { ...flags, expectedHost: remoteHost })).toThrow(/--confirm-non-production/);
    expect(() => assertDiagnosticTargetAllowed(remoteStaging, { ...flags, expectedHost: remoteHost, confirmNonProduction: true })).not.toThrow();
  });

  it("production: STOP aunque se confirme 'no production'; sólo pasa con --production-read-authorized", () => {
    expect(() => assertDiagnosticTargetAllowed(remoteProduction, { ...flags, expectedHost: remoteHost })).toThrow(/STOP: el destino se declara production/);
    expect(() => assertDiagnosticTargetAllowed(remoteProduction, { ...flags, expectedHost: remoteHost, confirmNonProduction: true })).toThrow(/production/);
    expect(() => assertDiagnosticTargetAllowed(remoteProduction, { ...flags, expectedHost: remoteHost, productionReadAuthorized: true })).not.toThrow();
  });
});

describe("readOnlyClient — sólo operaciones de lectura", () => {
  function fakeClient() {
    const model = { findMany: vi.fn().mockResolvedValue([{ id: "1" }]), count: vi.fn().mockResolvedValue(1), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn(), createMany: vi.fn() };
    return { client: { shiftAssignment: model, $executeRawUnsafe: vi.fn(), $executeRaw: vi.fn(), $queryRawUnsafe: vi.fn(), $transaction: vi.fn() }, model };
  }

  it("permite findMany/count", async () => {
    const { client, model } = fakeClient();
    const reader = readOnlyClient(client);
    await expect(reader.shiftAssignment.findMany()).resolves.toEqual([{ id: "1" }]);
    await expect(reader.shiftAssignment.count()).resolves.toBe(1);
    expect(model.findMany).toHaveBeenCalledTimes(1);
  });

  it.each(["create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"])("bloquea %s sin llegar al cliente", (operation) => {
    const { client, model } = fakeClient();
    const reader = readOnlyClient(client) as unknown as Record<string, Record<string, unknown>>;
    expect(() => reader.shiftAssignment![operation]).toThrow(ReadOnlyViolationError);
    expect((model as Record<string, ReturnType<typeof vi.fn>>)[operation]).not.toHaveBeenCalled();
  });

  it.each(["$executeRawUnsafe", "$executeRaw", "$queryRawUnsafe", "$transaction"])("bloquea %s", (operation) => {
    const { client } = fakeClient();
    const reader = readOnlyClient(client) as unknown as Record<string, unknown>;
    expect(() => reader[operation]).toThrow(ReadOnlyViolationError);
  });

  it("no permite asignar propiedades", () => {
    const reader = readOnlyClient(fakeClient().client) as unknown as Record<string, unknown>;
    expect(() => {
      reader.shiftAssignment = {};
    }).toThrow(ReadOnlyViolationError);
  });
});

describe("runInReadOnlyTransaction", () => {
  function fakePrisma(readOnlyValue: string) {
    const model = { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() };
    const statements: string[] = [];
    const tx = {
      shiftTemplate: model,
      $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
        statements.push(strings.join(""));
        return 0;
      }),
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        statements.push(strings.join(""));
        return [{ transaction_read_only: readOnlyValue }];
      }),
    };
    const prisma = { $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) };
    return { prisma, statements, model };
  }

  it("activa y verifica READ ONLY antes de leer, y entrega un cliente de sólo lectura", async () => {
    const { prisma, statements, model } = fakePrisma("on");
    const result = await runInReadOnlyTransaction(prisma as never, async (reader: { shiftTemplate: typeof model }) => {
      expect(() => reader.shiftTemplate.create).toThrow(ReadOnlyViolationError);
      return reader.shiftTemplate.findMany();
    });
    expect(result).toEqual([]);
    expect(statements).toEqual(["SET TRANSACTION READ ONLY", "SHOW transaction_read_only"]);
  });

  it("aborta sin leer si la transacción no quedó READ ONLY", async () => {
    const { prisma, model } = fakePrisma("off");
    const operation = vi.fn();
    await expect(runInReadOnlyTransaction(prisma as never, operation)).rejects.toThrow(/READ ONLY/);
    expect(operation).not.toHaveBeenCalled();
    expect(model.findMany).not.toHaveBeenCalled();
  });
});

// Guarda estática: impide que el diagnóstico evolucione por accidente a un
// script de escritura. Si este test falla, NO relajarlo: crear un script
// distinto, con su propia revisión y autorización.
describe("guarda estática del código del diagnóstico", () => {
  const root = path.resolve(__dirname, "../../../..");
  const files = {
    script: readFileSync(path.join(root, "scripts/diagnose-shift-assignments.ts"), "utf8"),
    analysis: readFileSync(path.join(__dirname, "shiftAssignmentDiagnostic.ts"), "utf8"),
    guard: readFileSync(path.join(__dirname, "readOnlyDiagnostic.ts"), "utf8"),
  };
  const WRITE_PATTERNS = [
    /\.(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\s*\(/,
    /\$executeRawUnsafe|\$queryRawUnsafe/,
    /\bINSERT\s+INTO\b|\bUPDATE\s+"|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bALTER\s+TABLE\b|\bDROP\s+/i,
    /--apply/,
  ];

  it.each(Object.entries(files))("%s: sin operaciones de escritura", (_name, source) => {
    for (const pattern of WRITE_PATTERNS) expect(source).not.toMatch(pattern);
  });

  it("la única sentencia raw no-SELECT es SET TRANSACTION READ ONLY, en el módulo de guardas", () => {
    expect(files.script).not.toMatch(/\$executeRaw|\$queryRaw/);
    expect(files.analysis).not.toMatch(/\$executeRaw|\$queryRaw/);
    expect(files.guard.match(/\$executeRaw`[^`]*`/g)).toEqual(["$executeRaw`SET TRANSACTION READ ONLY`"]);
  });

  it("no importa el cliente Prisma compartido ni config/env (leerían el .env habitual)", () => {
    for (const source of Object.values(files)) {
      const sharedClientImports = source.match(/^import\s[^;]*from\s+"[^"]*shared\/prisma\/client";/gm) ?? [];
      expect(sharedClientImports.every((statement) => statement.startsWith("import type "))).toBe(true);
      expect(source).not.toMatch(/from\s+"[^"]*config\/env"/);
    }
    expect(files.analysis).toMatch(/import type \{ PrismaTransactionClient \} from "..\/..\/..\/shared\/prisma\/client"/);
  });

  it("el script usa la transacción de sólo lectura y valida el destino antes de conectar", () => {
    const assertAt = files.script.indexOf("assertDiagnosticTargetAllowed(target, args)");
    const connectAt = files.script.indexOf("new PrismaClient(");
    expect(assertAt).toBeGreaterThan(-1);
    expect(connectAt).toBeGreaterThan(assertAt);
    expect(files.script).toMatch(/runInReadOnlyTransaction\(prisma,/);
  });
});
