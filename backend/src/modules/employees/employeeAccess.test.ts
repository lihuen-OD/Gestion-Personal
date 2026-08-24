import { describe, expect, it } from "vitest";
import { roles } from "../../shared/security/roles";
import { employeeAccessWhere } from "./employeeAccess";

// Auditoria 2026-08-24 (critico): employeeAccessWhere es el unico filtro de
// alcance por rol usado por employees/time-entries/novelties/positions y no
// tenia ningun test — es el punto que decide entre "el supervisor ve solo su
// equipo" y "el supervisor ve a todos" o "no ve a nadie". No se cambia el
// modelo de EmployeeAssignment.status a enum en esta etapa (queda propuesto
// como etapa posterior); estos tests fijan el comportamiento actual, doble
// casing incluido, para que una regresion futura no pase desapercibida.

function user(role: string, id = "user-1") {
  return { id, role } as unknown as Express.AuthUser;
}

describe("employeeAccessWhere", () => {
  it("RRHH ve lo que corresponde: sin ninguna restriccion (where vacio)", () => {
    expect(employeeAccessWhere(user(roles.rrhh))).toEqual({});
  });

  it("Supervision ve solo empleados asignados: filtra por TIME_RESPONSIBLE + userId propio", () => {
    const where = employeeAccessWhere(user(roles.supervision, "sup-42"));
    expect(where).toMatchObject({
      assignments: {
        some: {
          type: "TIME_RESPONSIBLE",
          userId: "sup-42",
        },
      },
    });
  });

  it("Carga horaria ve solo empleados asignados: mismo filtro que Supervision, con su propio userId", () => {
    const where = employeeAccessWhere(user(roles.cargaHoraria, "carga-7")) as {
      assignments: { some: { type: string; userId: string } };
    };
    expect(where.assignments.some.type).toBe("TIME_RESPONSIBLE");
    expect(where.assignments.some.userId).toBe("carga-7");
  });

  it("status ACTIVO/Activo estan cubiertos: el filtro acepta ambas variantes ademas de status nulo", () => {
    const where = employeeAccessWhere(user(roles.supervision)) as {
      assignments: { some: { AND: Array<{ OR?: Array<{ status?: string | null }> }> } };
    };
    const statusClause = where.assignments.some.AND.find((clause) => clause.OR?.some((option) => "status" in option));
    expect(statusClause?.OR).toEqual([{ status: null }, { status: "ACTIVO" }, { status: "Activo" }]);
  });

  it("status invalido no abre acceso accidental: el filtro no acepta ninguna otra variante (ej. minuscula o INACTIVO)", () => {
    const where = employeeAccessWhere(user(roles.supervision)) as {
      assignments: { some: { AND: Array<{ OR?: Array<{ status?: string | null }> }> } };
    };
    const statusClause = where.assignments.some.AND.find((clause) => clause.OR?.some((option) => "status" in option));
    const acceptedValues = statusClause!.OR!.map((option) => option.status);
    expect(acceptedValues).not.toContain("activo");
    expect(acceptedValues).not.toContain("INACTIVO");
    expect(acceptedValues).not.toContain("Inactivo");
    expect(acceptedValues).toHaveLength(3);
  });

  it("tambien respeta la vigencia (effectiveFrom/effectiveTo) al mismo tiempo que el status", () => {
    const where = employeeAccessWhere(user(roles.cargaHoraria)) as {
      assignments: { some: { AND: unknown[] } };
    };
    expect(where.assignments.some.AND).toHaveLength(3);
  });

  it("evalúa la vigencia con el día calendario Argentina cerca del cambio de día UTC", () => {
    const reference = new Date("2026-08-15T01:30:00.000Z"); // 14/08 22:30 en Argentina
    const where = employeeAccessWhere(user(roles.supervision), reference) as {
      assignments: { some: { AND: Array<{ OR?: Array<{ effectiveFrom?: { lte: Date }; effectiveTo?: { gte: Date } | null }> }> } };
    };
    const effectiveFrom = where.assignments.some.AND.find((clause) => clause.OR?.some((option) => "effectiveFrom" in option));
    const effectiveTo = where.assignments.some.AND.find((clause) => clause.OR?.some((option) => "effectiveTo" in option));

    expect(effectiveFrom?.OR?.find((option) => option.effectiveFrom)?.effectiveFrom?.lte.toISOString()).toBe("2026-08-14T00:00:00.000Z");
    expect(effectiveTo?.OR?.find((option) => option.effectiveTo)?.effectiveTo?.gte.toISOString()).toBe("2026-08-14T00:00:00.000Z");
  });

  it("roles desconocidos deniegan por defecto (deny-by-default): where imposible de cumplir, no un where vacio", () => {
    const where = employeeAccessWhere(user("ROL_INEXISTENTE"));
    expect(where).toEqual({ id: "__NO_ACCESS__" });
    expect(where).not.toEqual({});
  });
});
