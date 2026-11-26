import { describe, expect, it } from "vitest";
import { flattenNavigation, homePathForLevel, navByLevel, navigationForRole } from "./navigation";

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

// F11 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §30): /fichador se
// retiró del admin; el menú no puede volver a ofrecerlo en ningún nivel.
describe("navigation — sin el fichador viejo del admin", () => {
  it("ningún nivel ofrece /fichador", () => {
    for (const items of Object.values(navByLevel)) {
      expect(flattenNavigation(items).map((item) => item.href)).not.toContain("/fichador");
    }
  });
});

// 2026-11-17: se retiró "Inicio" de Gestión horaria y Nivel 2 perdió
// Dashboard, Puestos, Organigramas y Reportes de Gestión.
const labelsFor = (role: Parameters<typeof navigationForRole>[0]) => flattenNavigation(navigationForRole(role)).map((item) => item.label);
const hourlyItemsFor = (role: Parameters<typeof navigationForRole>[0]) => {
  const hourly = navigationForRole(role).find((item) => item.type === "group" && item.label === "Gestión horaria");
  return hourly?.type === "group" ? hourly.items.map((item) => `${item.label} ${item.href}`) : [];
};

describe("navigation — accesos por nivel (2026-11-17)", () => {
  it("ningún nivel ofrece 'Inicio' ni /gestion-horaria", () => {
    for (const items of Object.values(navByLevel)) {
      const links = flattenNavigation(items);
      expect(links.map((item) => item.label)).not.toContain("Inicio");
      expect(links.map((item) => item.href)).not.toContain("/gestion-horaria");
    }
  });

  it("Nivel 1 conserva todos sus módulos, en el mismo orden", () => {
    expect(navigationForRole("Nivel 1 - RRHH").map((item) => item.label)).toEqual([
      "Dashboard", "Legajos", "Puestos", "Gestión horaria", "Gestión Documental", "Organigramas", "Usuarios y Roles", "Configuración", "Auditoría",
    ]);
    expect(hourlyItemsFor("Nivel 1 - RRHH")).toEqual([
      "Asistencia /asistencia", "Alertas de turnos /asistencia/alertas", "Carga de horas /horas", "Cierres mensuales /cierres",
      "Bandeja de revisión /pendientes", "Novedades /novedades", "Notificaciones /notificaciones", "Exportación /configuracion/liquidacion",
    ]);
  });

  it("Nivel 2 sólo ve Gestión horaria y Legajos de mi área", () => {
    expect(navigationForRole("Nivel 2 - Supervisión / Gestión").map((item) => item.label)).toEqual(["Gestión horaria", "Legajos de mi área"]);
    const labels = labelsFor("Nivel 2 - Supervisión / Gestión");
    for (const removed of ["Dashboard", "Puestos", "Organigramas", "Reportes de Gestión"]) expect(labels).not.toContain(removed);
    expect(hourlyItemsFor("Nivel 2 - Supervisión / Gestión")).toEqual([
      "Asistencia /asistencia", "Alertas de turnos /asistencia/alertas", "Carga de horas /horas", "Cierres mensuales /cierres",
      "Bandeja de revisión /pendientes", "Novedades /novedades", "Notificaciones /notificaciones",
      // R8: Turnos de sus grupos (sin grupos, la pantalla muestra un estado vacío).
      "Turnos /configuracion/turnos",
    ]);
  });

  it("Nivel 3 conserva sus submódulos de Gestión horaria", () => {
    expect(navigationForRole("Nivel 3 - Administrativo de Carga Horaria").map((item) => item.label)).toEqual(["Gestión horaria"]);
    expect(hourlyItemsFor("Nivel 3 - Administrativo de Carga Horaria")).toEqual([
      "Asistencia /asistencia", "Alertas de turnos /asistencia/alertas", "Carga de horas /horas", "Cierres mensuales /cierres",
      "Novedades horarias /novedades", "Notificaciones /notificaciones",
      "Turnos /configuracion/turnos",
    ]);
  });

  it("la pantalla inicial es el Dashboard sólo para Nivel 1; Nivel 2 y 3 van a Asistencia", () => {
    expect(homePathForLevel(1)).toBe("/");
    expect(homePathForLevel(2)).toBe("/asistencia");
    expect(homePathForLevel(3)).toBe("/asistencia");
  });
});
