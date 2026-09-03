import { describe, expect, it } from "vitest";
import { sanitizeRequestPath } from "./sanitizePath";

describe("sanitizeRequestPath (perf journey)", () => {
  it("descarta el query string completo", () => {
    expect(sanitizeRequestPath("http://localhost:4002/api/employees?search=Juan+Perez&page=2")).toBe("/api/employees");
  });

  it("normaliza un segmento UUID a :id", () => {
    expect(sanitizeRequestPath("http://localhost:4002/api/employees/3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe(
      "/api/employees/:id",
    );
  });

  it("normaliza varios UUID en el mismo path", () => {
    expect(
      sanitizeRequestPath(
        "http://localhost:4002/api/employees/3fa85f64-5717-4562-b3fc-2c963f66afa6/documents/11111111-2222-3333-4444-555555555555",
      ),
    ).toBe("/api/employees/:id/documents/:id");
  });

  it("no toca paths sin UUID ni query string", () => {
    expect(sanitizeRequestPath("http://localhost:4002/api/workforce/notifications-unread-count")).toBe(
      "/api/workforce/notifications-unread-count",
    );
  });

  it("nunca deja un valor de búsqueda que iba en el query string", () => {
    const sanitized = sanitizeRequestPath("http://localhost:4002/api/employees?search=12345678&dni=99999999");
    expect(sanitized).not.toContain("12345678");
    expect(sanitized).not.toContain("99999999");
  });

  it("una URL inválida no revienta, cae al fallback por string", () => {
    expect(sanitizeRequestPath("/api/employees?search=x")).toBe("/api/employees");
  });

  // Etapa 14B.3.1 — mismo helper, reusado también para el campo `route`
  // (ruta del frontend) que se escribe en el reporte, no sólo para paths de
  // la API. Estos casos usan rutas relativas reales del frontend (el `href`
  // que devuelve React Router), no URLs absolutas.
  describe("rutas del frontend (Etapa 14B.3.1)", () => {
    it("una ruta frontend con UUID real se normaliza a :id", () => {
      expect(sanitizeRequestPath("/legajos/123e4567-e89b-12d3-a456-426614174000")).toBe("/legajos/:id");
    });

    it("una ruta frontend sin UUID queda exactamente igual", () => {
      expect(sanitizeRequestPath("/configuracion/conceptos-horarios")).toBe("/configuracion/conceptos-horarios");
      expect(sanitizeRequestPath("/asistencia/alertas")).toBe("/asistencia/alertas");
      expect(sanitizeRequestPath("/")).toBe("/");
    });

    it("una cadena que no es una ruta real (ej. la acción de Logout) pasa sin romperse y sin cambios", () => {
      expect(sanitizeRequestPath("(acción de sidebar, no una pantalla)")).toBe("(acción de sidebar, no una pantalla)");
    });
  });
});
