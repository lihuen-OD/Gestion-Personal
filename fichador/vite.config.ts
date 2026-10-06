import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Fichador standalone (F1). Puerto fijo 5175: el admin usa 5174 y el backend
// 4002 (docs/LOCAL_DEVELOPMENT.md). strictPort evita que Vite salte a otro
// puerto en silencio y quede fuera del CORS del backend.
export default defineConfig({
  plugins: [react()],
  server: { port: 5175, strictPort: true },
  preview: { port: 5175, strictPort: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setupTests.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
});
