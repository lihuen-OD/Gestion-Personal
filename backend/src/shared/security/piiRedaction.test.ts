import { describe, expect, it } from "vitest";
import { roles } from "./roles";
import { redactPiiForRole } from "./piiRedaction";

function user(role: string) {
  return { id: "user-1", role } as Express.AuthUser;
}

const response = {
  employee: {
    id: "employee-1",
    legajo: "100",
    firstName: "Ana",
    lastName: "Gomez",
    status: "ACTIVO",
    dni: "30000000",
    cuil: "20300000001",
    birthDate: new Date("1990-01-01"),
    phone: "1111",
    email: "ana@example.com",
    address: { street: "Privada" },
    emergencyContact: "Familiar",
    documents: [{ fileName: "dni.pdf" }],
    sector: { id: "sector-1", name: "Administración" },
  },
};

describe("redactPiiForRole", () => {
  it("elimina PII y conserva datos operativos para Nivel 3", () => {
    const result = redactPiiForRole(response, user(roles.cargaHoraria));

    expect(result.employee).toMatchObject({
      id: "employee-1",
      legajo: "100",
      firstName: "Ana",
      lastName: "Gomez",
      status: "ACTIVO",
      sector: { name: "Administración" },
    });
    for (const field of ["dni", "cuil", "birthDate", "phone", "email", "address", "emergencyContact", "documents"]) {
      expect(result.employee).not.toHaveProperty(field);
    }
  });

  it("no muta la respuesta original al redactar para Nivel 3", () => {
    const result = redactPiiForRole(response, user(roles.cargaHoraria));

    expect(result).not.toBe(response);
    expect(result.employee).not.toBe(response.employee);
    expect(result.employee.sector).not.toBe(response.employee.sector);
    expect(response.employee).toMatchObject({
      dni: "30000000",
      cuil: "20300000001",
      phone: "1111",
      email: "ana@example.com",
      documents: [{ fileName: "dni.pdf" }],
      sector: { id: "sector-1", name: "Administración" },
    });
  });

  it("mantiene la respuesta completa para RRHH y Supervisión", () => {
    expect(redactPiiForRole(response, user(roles.rrhh))).toBe(response);
    expect(redactPiiForRole(response, user(roles.supervision))).toBe(response);
  });
});
