import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Fija el TZ del proceso de test para que sea el mismo en cualquier
    // máquina/CI, independientemente del huso horario por defecto del host.
    // Sin esto, los tests que construyen fechas con el constructor local de
    // Date (new Date(y, m, d, h, min)) o leen con getHours()/getDate() quedan
    // atados al TZ del sistema en el que corren — pasan "por casualidad" en
    // una máquina configurada en Argentina y fallan en un runner en UTC.
    env: {
      TZ: "America/Argentina/Cordoba",
      // Ningún test toma DATABASE_URL del .env (dotenv no pisa una variable ya
      // definida): por defecto apunta a un puerto local inalcanzable y
      // src/shared/prisma/testDatabaseGuard.ts bloquea toda base que no sea una
      // local de integración (clock_it*/deletion_it*/reorg_it_m2*), que las
      // suites opt-in fijan explícitamente. Mismo valor que
      // BLOCKED_TEST_DATABASE_URL.
      DATABASE_URL: "postgresql://unit-tests-must-mock-prisma@127.0.0.1:1/unit_tests_must_mock_prisma",
    },
  },
});
