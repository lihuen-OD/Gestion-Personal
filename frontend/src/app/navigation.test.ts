import { describe, expect, it } from "vitest";
import { flattenNavigation, navigationForRole } from "./navigation";

// Etapa 15M.17 (docs/PROJECT_UI_CONTEXT.md "Un único acceso principal por
// módulo operativo"): "Exportación" es el acceso operativo del sidebar
// (Gestión horaria → Exportación, /configuracion/liquidacion). La card
// duplicada se quitó de SettingsPage.tsx (ver SettingsPage.test.tsx) -- acá
// se fija que el sidebar en sí sigue sin cambios: sigue existiendo, apunta
// a la misma ruta, y sigue restringido a Nivel 1 (RRHH), igual que antes.
describe("navigation — Etapa 15M.17 (el acceso a Exportación en el sidebar no se tocó)", () => {
  it("Nivel 1 (RRHH) ve 'Exportación' en el sidebar, apuntando a /configuracion/liquidacion", () => {
    const links = flattenNavigation(navigationForRole("Nivel 1 - RRHH"));
    const exportLinks = links.filter((item) => item.label === "Exportación");

    expect(exportLinks).toHaveLength(1);
    expect(exportLinks[0]!.href).toBe("/configuracion/liquidacion");
  });

  it("Nivel 2 y Nivel 3 no ven 'Exportación' (mismo permiso que antes de esta etapa)", () => {
    const level2Links = flattenNavigation(navigationForRole("Nivel 2 - Supervisión / Gestión"));
    const level3Links = flattenNavigation(navigationForRole("Nivel 3 - Administrativo de Carga Horaria"));

    expect(level2Links.some((item) => item.label === "Exportación")).toBe(false);
    expect(level3Links.some((item) => item.label === "Exportación")).toBe(false);
  });

  it("'Configuración' sigue existiendo como acceso propio, separado de 'Exportación'", () => {
    const links = flattenNavigation(navigationForRole("Nivel 1 - RRHH"));
    const settingsLink = links.find((item) => item.label === "Configuración");

    expect(settingsLink?.href).toBe("/configuracion");
  });
});
