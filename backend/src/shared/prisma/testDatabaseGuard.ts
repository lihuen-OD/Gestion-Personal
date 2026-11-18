/**
 * Guard de base de datos para tests (docs/TESTING_QA_STANDARDS.md, "Base de
 * datos en tests"). Un test unitario nunca debe poder abrir Prisma contra una
 * base tomada del `.env` (que puede ser Neon u otra compartida).
 *
 * Bajo vitest (`VITEST=true`) sólo se permite una base PostgreSQL LOCAL de
 * integración, con el prefijo de las suites opt-in (`clock_it*`,
 * `deletion_it*`, `reorg_it_m2*`), que esas suites fijan explícitamente en
 * `process.env.DATABASE_URL` antes de importar el cliente. Cualquier otra
 * (también la URL bloqueada que fija `vitest.config.ts`) queda bloqueada:
 * `client.ts` apunta Prisma a un puerto local inalcanzable y corta toda
 * consulta de modelo antes de conectar. Fuera de vitest no hace nada.
 *
 * Los mensajes nunca incluyen la URL, el usuario ni la contraseña.
 */

/** Puerto 1 de loopback: una conexión falla de inmediato y nunca sale del equipo. */
export const BLOCKED_TEST_DATABASE_URL = "postgresql://unit-tests-must-mock-prisma@127.0.0.1:1/unit_tests_must_mock_prisma";

export const INTEGRATION_TEST_DATABASE_PREFIXES = ["clock_it", "deletion_it", "reorg_it_m2"] as const;

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

export type TestDatabaseGuard = { blocked: false } | { blocked: true; message: string };

export const TEST_DATABASE_BLOCKED_MESSAGE =
  "Prisma está bloqueado en tests unitarios: mockeá el cliente (vi.mock(\"../../shared/prisma/client\")) o usá una suite de integración opt-in con una base PostgreSQL local clock_it*/deletion_it*/reorg_it_m2*.";

export function evaluateTestDatabaseGuard(env: { VITEST?: string; DATABASE_URL?: string }): TestDatabaseGuard {
  if (env.VITEST !== "true") return { blocked: false };
  const blocked = { blocked: true as const, message: TEST_DATABASE_BLOCKED_MESSAGE };
  if (!env.DATABASE_URL) return blocked;
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    return blocked;
  }
  const database = url.pathname.slice(1);
  if (!LOCAL_HOSTS.includes(url.hostname)) return blocked;
  if (!INTEGRATION_TEST_DATABASE_PREFIXES.some((prefix) => database.startsWith(prefix))) return blocked;
  return { blocked: false };
}
