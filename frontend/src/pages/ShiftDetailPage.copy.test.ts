import { describe, expect, it } from "vitest";
// Etapa UI-2: ShiftDetailPage duplicaba a mano el markup de <section
// className="panel"><div className="panel-head">...<div className="panel-body">
// en vez de usar el componente Section real (que ya soporta variant desde
// las Etapas 8Q/8R). Sin jsdom/RTL, se lee el código fuente (?raw) para
// confirmar que el duplicado se eliminó.
import pageSource from "./ShiftDetailPage.tsx?raw";
import panelSource from "../components/shifts/ShiftEmployeesPanel.tsx?raw";

describe("ShiftDetailPage — usa Section real, sin markup duplicado (Etapa UI-2)", () => {
  it('no hand-rollea <section className="panel"> (eso es responsabilidad de Section)', () => {
    expect(pageSource).not.toContain('<section className="panel">');
  });

  it("usa el componente Section para el bloque de tabs", () => {
    expect(pageSource).toMatch(/<Section\s/);
  });
});

describe("ShiftEmployeesPanel — selector de empleados en modal, no incrustado (Etapa UI-2)", () => {
  it("el formulario de asignar (selector + vigencia) vive dentro de un Modal", () => {
    const modalStart = panelSource.indexOf('<Modal title="Asignar empleados a este turno"');
    expect(modalStart).toBeGreaterThan(-1);
    const modalBlock = panelSource.slice(modalStart);
    expect(modalBlock).toContain("<EmployeeRemoteSelector");
    expect(modalBlock).toContain("<ShiftAssignmentVigencyFields");
  });

  it('el trigger "Asignar empleados" ya no arma un bloque inline con el selector', () => {
    expect(panelSource).not.toContain('<span>Asignar empleados a este turno</span>');
  });

  it("las tablas vacías usan EmptyState compacto, no un <div className=\"empty\"> a mano", () => {
    expect(panelSource).not.toContain('<div className="empty">');
    expect(panelSource).toContain('size="compact"');
  });
});
