import { describe, expect, it } from "vitest";
// Etapa 8M: esta pantalla (/configuracion/conceptos-horarios) mezclaba
// "hora especial" (que en este proyecto es una pantalla DISTINTA — Reglas
// Especiales / WorkScheduleSettingsPage, domingo x2, feriado x2, etc.) con
// Conceptos Horarios (Guardia, Sereno, Nocturna...). Sin jsdom/RTL en este
// proyecto no se puede renderizar el componente, así que este test lee el
// código fuente real (vía el sufijo ?raw de Vite, sin depender de node:fs)
// y confirma la nomenclatura directamente sobre el texto que termina en pantalla.
import source from "./HourConceptsPage.tsx?raw";

describe("HourConceptsPage — nomenclatura correcta (Etapa 8M)", () => {
  it('no usa "hora especial" para referirse a un concepto horario', () => {
    expect(source.toLowerCase()).not.toContain("hora especial");
  });

  it('no usa "horas especiales" en ningún texto de esta pantalla', () => {
    expect(source.toLowerCase()).not.toContain("horas especiales");
  });

  it('dice "Conceptos horarios" (plural, título de página y listado)', () => {
    expect(source).toContain("Conceptos horarios");
  });

  it('dice "Crear concepto horario"', () => {
    expect(source).toContain("Crear concepto horario");
  });

  it('dice "Editar concepto horario"', () => {
    expect(source).toContain("Editar concepto horario");
  });

  it('mantiene "Reglas horarias" y "Empleados habilitados" (no se tocan)', () => {
    expect(source).toContain("Empleados habilitados");
  });

  it("el bloque informativo ya no mezcla nombres de conceptos reales en la descripción (antes: 'Sereno, guardia, manejo de colectivo...')", () => {
    expect(source).not.toContain("Sereno, guardia, manejo de colectivo");
  });

  // Etapa 8N: decisión de producto — todo concepto horario cuenta como
  // trabajado, countsAsWorked deja de ser configurable/visible en esta
  // pantalla (sigue existiendo solo en backend).
  it('no muestra "Cuenta como trabajado" ni el badge "Computa"/"No computa"', () => {
    expect(source).not.toContain("Cuenta como trabajado");
    expect(source).not.toContain("No computa");
    expect(source).not.toContain(">Computa<");
  });

  it("no referencia countsAsWorked en absoluto (se sacó de la UI)", () => {
    expect(source).not.toContain("countsAsWorked");
  });

  describe("Etapa 6E — modelo aditivo", () => {
    it("distingue la base protegida de los conceptos adicionales", () => {
      expect(source).toContain("Base del sistema");
      expect(source).toContain("Protegido");
      expect(source).toContain("Adicional");
    });

    it("ofrece los tres modos de carga", () => {
      expect(source).toContain("Manual y automático");
      expect(source).toContain("Automático");
      expect(source).toContain("Manual");
    });

    it("explica que Normal es el total y los adicionales son desgloses", () => {
      expect(source).toContain("Horas normales representa el total trabajado");
      expect(source).toContain("conceptos adicionales son desgloses");
    });
  });

  describe("Etapa 8O/8P — acciones de fila (habilitar/deshabilitar/eliminar)", () => {
    it('el KPI ya no queda huérfano: agrega "Total configurados" junto a "Activas"', () => {
      expect(source).toContain("Total configurados");
    });

    it("ofrece Habilitar/Deshabilitar y Eliminar por fila, además de Editar", () => {
      expect(source).toContain("Deshabilitar");
      expect(source).toContain("Habilitar");
      expect(source).toContain("Eliminar");
    });

    it("el mensaje de confirmación de eliminar advierte que no se puede deshacer", () => {
      expect(source).toMatch(/eliminar el concepto horario.*no se puede deshacer/i);
    });

    it("el mensaje de confirmación de deshabilitar aclara que no borra el historial", () => {
      expect(source).toMatch(/no se borra su historial/i);
    });

    it("la segunda confirmación (con uso histórico) usa el texto exacto de la regla de negocio", () => {
      expect(source).toContain(
        "Este concepto tiene uso histórico. Si lo eliminás, dejará de estar disponible para nuevas cargas/asignaciones, pero el sistema conserva la trazabilidad de lo ya cargado.",
      );
    });

    it('el label del botón de confirmación forzada dice "Eliminar de todas formas"', () => {
      expect(source).toContain("Eliminar de todas formas");
    });

    it("distingue HOUR_CONCEPT_IN_USE del resto de los errores antes de pedir la segunda confirmación", () => {
      expect(source).toContain("HOUR_CONCEPT_IN_USE");
    });
  });

  // Etapa 8Q — auditoría UI/UX: pantalla piloto. Simplificación de textos
  // largos, sin "Ver eliminados" (se sacó del listado principal), sin card
  // dentro de card (Reglas horarias/Empleados habilitados ya no viven
  // envueltos en un <div className="panel"> extra), AssociatedEmployeesPanel
  // ahora en variant="embedded" con el selector de empleados en un modal.
  describe("Etapa 8Q — auditoría UI/UX (pantalla piloto)", () => {
    it('ya no ofrece el checkbox "Ver eliminados" (se sacó del listado principal)', () => {
      expect(source).not.toContain("Ver eliminados");
    });

    it("ya no referencia deletedAt (se sacó el filtro de eliminados de esta pantalla)", () => {
      expect(source).not.toContain("deletedAt");
    });

    it('los botones del editor son cortos y consistentes: "Guardar" / "Cancelar", ya no "Guardar concepto horario"', () => {
      expect(source).not.toContain("Guardar concepto horario");
      expect(source).toContain(">Cancelar<");
    });

    it("Reglas horarias y Empleados habilitados ya no quedan envueltos en un <div className=\"panel\"> extra (sin card dentro de card)", () => {
      const editorStart = source.indexOf("detail-section-stack");
      const restOfEditor = source.slice(editorStart);
      expect(restOfEditor).not.toContain('<div className="panel">');
    });

    it("Empleados habilitados usa AssociatedEmployeesPanel en variant=\"embedded\"", () => {
      expect(source).toMatch(/variant="embedded"/);
    });

    it("el texto de reglas horarias/datos del concepto ya no repite párrafos largos duplicados con el PageHeader", () => {
      expect(source).not.toContain("No son novedades ni reglas especiales de pago.");
    });
  });
});
