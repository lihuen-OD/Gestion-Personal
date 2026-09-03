import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setupTests.ts"],
    // Etapa 14B.3: los *.spec.ts de e2e/ son tests de Playwright (otro test
    // runner), no de Vitest — excluirlos explícitamente para que "npm run
    // test" no intente importarlos. Los *.test.ts de e2e/support/ (helpers
    // puros del performance journey) sí quedan cubiertos por Vitest, como
    // cualquier otro *.test.ts del proyecto.
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**/*.spec.ts"],
  },
});
