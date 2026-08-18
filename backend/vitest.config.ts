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
    },
  },
});
