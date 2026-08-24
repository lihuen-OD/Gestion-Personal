import { describe, expect, it } from "vitest";
// Etapa UI-3: EmployeeDetailPage apilaba .block-card/.tracked-field pesados
// (mismo borde+sombra que .panel) dentro del .panel de cada tab, y la
// pestaña "Datos Laborales" apilaba ~10 tracked-field sin agrupación. Sin
// jsdom/RTL, se lee el código fuente (?raw) para confirmar la estructura.
import pageSource from "./EmployeeDetailPage.tsx?raw";
import blocksSource from "../components/employees/EmployeeDetailBlocks.tsx?raw";

describe("EmployeeDetailPage — Datos Laborales agrupado (Etapa UI-3)", () => {
  it('agrupa el tracked-grid en "Empresa / estructura" y "Puesto / categoría"', () => {
    expect(pageSource).toContain("EMPRESA / ESTRUCTURA");
    expect(pageSource).toContain("PUESTO / CATEGORÍA");
  });

  it("Contacto y Domicilio ya no envuelve AddressEditBlock en block-wrap suelto (usa detail-section-stack)", () => {
    expect(pageSource).not.toContain('<div className="block-wrap">\n          <AddressEditBlock');
    expect(pageSource).toContain("detail-section-stack");
  });

  it("Transporte y Configuración Horaria ya no envuelven un único bloque en block-wrap (wrapper redundante eliminado)", () => {
    expect(pageSource).not.toContain('<div className="block-wrap">\n        <TransportBlock');
    expect(pageSource).not.toContain('<div className="block-wrap">\n        <HoursSpecialBlock');
  });

  it("Responsables / Asignaciones sigue usando block-wrap.two (layout de 2 columnas, todavía necesario)", () => {
    expect(pageSource).toContain('<div className="block-wrap two">');
  });
});

describe("EmployeeDetailBlocks — conceptos adicionales 6F", () => {
  it('HoursSpecialBlock muestra "Conceptos horarios adicionales", no "Horas especiales"', () => {
    expect(blocksSource).toContain("Conceptos horarios adicionales");
    expect(blocksSource.toLowerCase()).not.toContain("horas especiales");
  });

  it("explica que Horas normales son universales y muestra el modo de carga", () => {
    expect(blocksSource).toContain("Horas normales se aplican siempre a todos los empleados");
    expect(blocksSource).toContain("hourConceptLoadModeLabels");
    expect(blocksSource).not.toContain("priority");
    expect(blocksSource).not.toContain("countsAsWorked");
  });

  it('el identificador interno histórico "HORAS_ESPECIALES" se mantiene (no se rompe trazabilidad)', () => {
    expect(blocksSource).toContain('block: "HORAS_ESPECIALES"');
  });
});
