// Fichador standalone (F2). Corre después de `vite build`: valida las
// variables de deploy (sólo dentro del hosting) y escribe dist/_headers.
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertDeployEnv, hostingHeaders } from "./hosting-headers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
assertDeployEnv(process.env);
// Mismo default que src/services/api/apiClient.ts para builds locales.
const apiUrl = process.env.VITE_API_URL || "http://localhost:4002/api";
writeFileSync(join(root, "dist", "_headers"), hostingHeaders(apiUrl));
console.log(`dist/_headers escrito (connect-src del API: ${new URL(apiUrl).origin})`);
