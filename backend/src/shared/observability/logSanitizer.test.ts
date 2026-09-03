import { describe, expect, it } from "vitest";
import { sanitizeRequestPath } from "./logSanitizer";

describe("sanitizeRequestPath", () => {
  it("descarta el query string completo", () => {
    expect(sanitizeRequestPath("/api/employees?search=Juan+Perez&page=2")).toBe("/api/employees");
  });

  it("normaliza un segmento UUID a :id", () => {
    expect(sanitizeRequestPath("/api/employees/3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe("/api/employees/:id");
  });

  it("normaliza varios UUID en el mismo path", () => {
    expect(
      sanitizeRequestPath("/api/employees/3fa85f64-5717-4562-b3fc-2c963f66afa6/documents/11111111-2222-3333-4444-555555555555"),
    ).toBe("/api/employees/:id/documents/:id");
  });

  it("normaliza UUID mayúsculas igual que minúsculas", () => {
    expect(sanitizeRequestPath("/api/employees/3FA85F64-5717-4562-B3FC-2C963F66AFA6")).toBe("/api/employees/:id");
  });

  it("no toca paths sin UUID ni query string", () => {
    expect(sanitizeRequestPath("/api/workforce/notifications-unread-count")).toBe("/api/workforce/notifications-unread-count");
  });

  it("nunca deja pasar un valor de búsqueda que iba en el query string", () => {
    const sanitized = sanitizeRequestPath("/api/employees?search=12345678&dni=99999999");
    expect(sanitized).not.toContain("12345678");
    expect(sanitized).not.toContain("99999999");
    expect(sanitized).not.toContain("dni");
  });

  it("path vacío devuelve /", () => {
    expect(sanitizeRequestPath("")).toBe("/");
  });
});
