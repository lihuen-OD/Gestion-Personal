// La barra "Volviendo al inicio…" de la confirmación se anima en CSS porque la
// CSP (style-src 'self') no admite estilos en línea. Su duración tiene que ser
// la misma que SUCCESS_RESET_MS, que es lo que realmente devuelve el kiosco al
// inicio. Este test impide que una cambie sin la otra.
// (.mjs con node:fs: vitest reemplaza los .css importados por un texto vacío,
// incluso con ?raw, y el tsconfig de la app no incluye los tipos de Node.)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUCCESS_RESET_MS } from "../../pages/TimeClockPage";

// vitest corre desde fichador/ (donde está vite.config.ts).
const kioskCss = readFileSync(`${process.cwd()}/src/styles/screens/kiosk.css`, "utf8");

function cssDurationMs(value) {
  const match = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(value.trim());
  if (!match) throw new Error(`Duración CSS no reconocida: "${value}"`);
  return match[2] === "s" ? Number(match[1]) * 1000 : Number(match[1]);
}

function resultBarAnimation(css) {
  const rule = /\.kiosk-result-bar span\s*\{([^}]*)\}/.exec(css);
  if (!rule) throw new Error("No se encontró la regla .kiosk-result-bar span en kiosk.css");
  const animation = /(?:^|;)\s*animation:\s*([^;]+);/.exec(rule[1]);
  if (!animation) throw new Error("La barra de la confirmación no declara animation");
  return animation[1];
}

describe("confirmación: la barra dura lo mismo que el regreso al inicio", () => {
  it("la animación kiosk-fill de la barra usa SUCCESS_RESET_MS", () => {
    const [name, duration] = resultBarAnimation(kioskCss).split(/\s+/);
    expect(name).toBe("kiosk-fill");
    expect(kioskCss).toMatch(/@keyframes kiosk-fill\s*\{/);
    expect(cssDurationMs(duration)).toBe(SUCCESS_RESET_MS);
  });

  it("reconoce duraciones en s y ms (el control no pasa en vacío)", () => {
    expect(cssDurationMs("3.5s")).toBe(3500);
    expect(cssDurationMs("3500ms")).toBe(3500);
    expect(() => cssDurationMs("var(--x)")).toThrow();
    expect(() => resultBarAnimation(".otra { color: red; }")).toThrow();
  });
});
