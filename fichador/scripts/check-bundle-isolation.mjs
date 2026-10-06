// Fichador standalone (F1, docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md).
// Corre al final de `npm run build`: falla el build si el fichador importa
// algo de fuera de su propia carpeta o si el bundle arrastra módulos
// administrativos. No alcanza con que las rutas no estén registradas: esos
// módulos no tienen que estar empaquetados.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// 1) Fuentes: ningún import relativo sale de fichador/, y no se usan los
//    paquetes del admin que el fichador no necesita.
const forbiddenPackages = ["react-router-dom", "react-router", "leaflet", "react-leaflet", "xlsx"];
const importPattern = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
for (const file of walk(join(root, "src")).filter((path) => /\.(ts|tsx)$/.test(path))) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] || match[2];
    if (specifier.startsWith(".")) {
      const target = resolve(dirname(file), specifier);
      if (!target.startsWith(join(root, "src"))) failures.push(`${relative(root, file)} importa fuera de fichador/src: ${specifier}`);
    } else if (forbiddenPackages.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
      failures.push(`${relative(root, file)} importa un paquete del admin: ${specifier}`);
    }
  }
}

// 2) Bundle: marcas que sobreviven a la minificación (rutas, claves de
//    sesión, endpoints y textos de módulos administrativos).
const adminMarkers = [
  "Dashboard", "Legajos", "Configuración", "Auditoría", "Usuarios", "MonthlyClosures",
  "EmployeeDetailPage", "AppShell", "SettingsPage", "Cerrar sesión",
  "/legajos", "/configuracion", "/usuarios", "/auditoria", "/cierres", "/gestion-horaria", "/novedades", "/reportes",
  "losod_access_token", "losod_refresh_token", "/auth/refresh", "/auth/login",
  "/workforce", "/hour-concepts", "/audit-parameters", "/finnegans-export",
  // Endpoint admin de legajos al inicio de un literal ("/employees…): el
  // fichador sí usa /time-entries/clock/employees, que no debe contar.
  /["'`]\/employees\b/,
];
// Prueba de vida: si el build no contiene el fichador, el chequeo no vale.
const requiredMarkers = ["/time-entries/clock/photo-punch", "/time-entries/clock/attempts/"];

const assets = walk(join(root, "dist")).filter((path) => /\.(js|css|html)$/.test(path));
const bundle = assets.map((path) => ({ path, text: readFileSync(path, "utf8") }));
for (const marker of adminMarkers) {
  for (const { path, text } of bundle) {
    const found = typeof marker === "string" ? text.includes(marker) : marker.test(text);
    if (found) failures.push(`${relative(root, path)} contiene una marca administrativa: ${marker}`);
  }
}
for (const marker of requiredMarkers) {
  if (!bundle.some(({ text }) => text.includes(marker))) failures.push(`el bundle no contiene "${marker}": ¿se buildeó el fichador?`);
}

if (failures.length) {
  console.error("Aislamiento del fichador: FALLÓ");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Aislamiento del fichador: OK (${assets.length} archivos de dist, ${adminMarkers.length} marcas administrativas ausentes)`);
