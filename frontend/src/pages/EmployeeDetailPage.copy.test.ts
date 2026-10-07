import { describe, expect, it } from "vitest";
// Etapa UI-3: EmployeeDetailPage apilaba .block-card/.tracked-field pesados
// (mismo borde+sombra que .panel) dentro del .panel de cada tab, y la
// pestaña "Datos Laborales" apilaba ~10 tracked-field sin agrupación. Sin
// jsdom/RTL, se lee el código fuente (?raw) para confirmar la estructura.
import pageSource from "./EmployeeDetailPage.tsx?raw";
import blocksSource from "../components/employees/EmployeeDetailBlocks.tsx?raw";
import laborTabSource from "../components/employees/EmployeeLaborDataTab.tsx?raw";

describe("EmployeeDetailPage — Datos Laborales agrupado (Etapa UI-3)", () => {
  // A6 (ORG_LOCATION_REORGANIZATION.md §3.3): bloques Puesto y alcance,
  // Ubicaciones, Empresa empleadora/categorías y estructura anterior de consulta.
  it("Datos Laborales se agrupa en los bloques A6 y ya no edita sector/UN/establecimiento", () => {
    expect(pageSource).toContain("<EmployeeLaborDataTab");
    expect(laborTabSource).toContain("PUESTO Y ALCANCE ORGANIZACIONAL");
    expect(laborTabSource).toContain("UBICACIONES DE TRABAJO");
    expect(laborTabSource).toContain("EMPRESA EMPLEADORA Y CATEGORÍAS");
    expect(laborTabSource).toContain('field="sector" label="Sector anterior" value={employee.sector} canEdit={false}');
    expect(pageSource).not.toContain("EMPRESA / ESTRUCTURA");
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
