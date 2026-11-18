import { describe, expect, it } from "vitest";
import { BLOCKED_TEST_DATABASE_URL, evaluateTestDatabaseGuard, TEST_DATABASE_BLOCKED_MESSAGE } from "./testDatabaseGuard";

// Guard global de base para tests: un test unitario nunca abre Prisma contra
// una base tomada del .env (Neon u otra compartida).
describe("evaluateTestDatabaseGuard", () => {
  it("fuera de vitest no hace nada (la app y los scripts usan su DATABASE_URL)", () => {
    expect(evaluateTestDatabaseGuard({ DATABASE_URL: "postgresql://user:secret@ep-example.us-east-2.aws.neon.tech/neondb" })).toEqual({ blocked: false });
  });

  it.each([
    ["sin DATABASE_URL", undefined],
    ["una URL inválida", "no es una url"],
    ["Neon", "postgresql://user:secret@ep-example-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"],
    ["otra base externa", "postgresql://user:secret@db.example.com:5432/gestion"],
    ["una base local que no es de integración (p. ej. la de desarrollo)", "postgresql://user@localhost:5432/gestion_personal"],
    ["la URL bloqueada por defecto de vitest", BLOCKED_TEST_DATABASE_URL],
  ])("bajo vitest bloquea %s", (_label, url) => {
    expect(evaluateTestDatabaseGuard({ VITEST: "true", DATABASE_URL: url })).toEqual({ blocked: true, message: TEST_DATABASE_BLOCKED_MESSAGE });
  });

  it.each([
    "postgresql://ci:ci@localhost:5432/clock_it_ci",
    "postgresql://user@127.0.0.1:5432/clock_it_novelty_coverage",
    "postgresql://ci:ci@localhost:5432/deletion_it_ci",
    "postgresql://user@localhost:5432/reorg_it_m2_local",
  ])("bajo vitest permite una base local de integración explícita (%s)", (url) => {
    expect(evaluateTestDatabaseGuard({ VITEST: "true", DATABASE_URL: url })).toEqual({ blocked: false });
  });

  it("un host externo con nombre de base de integración igual se bloquea", () => {
    expect(evaluateTestDatabaseGuard({ VITEST: "true", DATABASE_URL: "postgresql://u:p@ep-x.neon.tech/clock_it_fake" }).blocked).toBe(true);
  });

  it("el mensaje nunca incluye la URL ni credenciales", () => {
    const guard = evaluateTestDatabaseGuard({ VITEST: "true", DATABASE_URL: "postgresql://user:super-secret@ep-example.neon.tech/neondb" });
    expect(guard.blocked && guard.message).not.toMatch(/super-secret|neon\.tech|neondb|user/);
  });
});

describe("cliente de Prisma bajo vitest (sin mockear)", () => {
  it("vitest.config.ts fija una DATABASE_URL bloqueada: el .env nunca entra a los tests", () => {
    expect(process.env.DATABASE_URL).toBe(BLOCKED_TEST_DATABASE_URL);
  });

  it("una consulta de modelo falla antes de conectar, con un mensaje claro", async () => {
    const { prisma } = await import("./client");
    await expect(prisma.user.findFirst()).rejects.toThrow(TEST_DATABASE_BLOCKED_MESSAGE);
  });

  it("una consulta cruda tampoco sale del equipo (puerto local inalcanzable)", async () => {
    const { prisma } = await import("./client");
    await expect(prisma.$queryRawUnsafe("SELECT 1")).rejects.toThrow();
  });
});
