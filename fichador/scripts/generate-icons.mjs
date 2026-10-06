// Fichador standalone (F3). Íconos PLACEHOLDER de la PWA: reloj blanco sobre
// el primario del sistema (#2563eb). No hay logo oficial en el repo; para
// reemplazarlos, cambiar el SVG de acá (o los PNG de public/icons/ con los
// mismos nombres y tamaños) y volver a correr `npm run icons`.
// Rasteriza con el Chromium de Playwright (ya es devDependency).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRIMARY = "#2563eb";

// Reloj en un lienzo de 512: el trazo exterior llega a radio 166, dentro de
// la zona segura de los íconos maskable (círculo de radio 204,8 = 40%).
const clock = `<circle cx="256" cy="256" r="150" fill="none" stroke="#fff" stroke-width="32"/><polyline points="256 166 256 256 322 256" fill="none" stroke="#fff" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>`;
export const roundedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${PRIMARY}"/>${clock}</svg>`;
export const fullBleedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${PRIMARY}"/>${clock}</svg>`;

const outputs = [
  { file: "icons/icon-192.png", svg: roundedSvg, size: 192, transparent: true },
  { file: "icons/icon-512.png", svg: roundedSvg, size: 512, transparent: true },
  { file: "icons/icon-maskable-512.png", svg: fullBleedSvg, size: 512, transparent: false },
  // iOS redondea el ícono por su cuenta y no admite transparencia.
  { file: "icons/apple-touch-icon.png", svg: fullBleedSvg, size: 180, transparent: false },
];

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  mkdirSync(join(root, "public", "icons"), { recursive: true });
  writeFileSync(join(root, "public", "favicon.svg"), `${roundedSvg}\n`);
  const browser = await chromium.launch();
  for (const { file, svg, size, transparent } of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
    writeFileSync(join(root, "public", file), await page.screenshot({ omitBackground: transparent }));
    await page.close();
  }
  await browser.close();
  console.log(`Íconos generados: favicon.svg, ${outputs.map((output) => output.file).join(", ")}`);
}
