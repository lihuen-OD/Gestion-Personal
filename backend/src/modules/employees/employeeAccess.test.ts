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

  type AssignmentFilter = { assignments: { some: { type: string; AND: Array<Record<string, unknown>> } } };
  const responsibleClause = (where: unknown) =>
    (where as AssignmentFilter).assignments.some.AND.find((clause) => "userId" in clause || "OR" in clause && (clause.OR as Array<Record<string, unknown>>).some((option) => "userId" in option));

  it("Nivel 3 ve solo sus asignaciones directas: TIME_RESPONSIBLE + userId propio, sin herencia", () => {
    const where = employeeAccessWhere(user(roles.cargaHoraria, "carga-7")) as AssignmentFilter;
    expect(where.assignments.some.type).toBe("TIME_RESPONSIBLE");
    expect(responsibleClause(where)).toEqual({ userId: "carga-7" });
    expect(JSON.stringify(where)).not.toContain("supervisionsAsSupervised");
  });

  it("Nivel 2 ve la unión: sus TIME_RESPONSIBLE directos o los de los Nivel 3 que supervisa (por relación, sin copiar asignaciones)", () => {
    const where = employeeAccessWhere(user(roles.supervision, "sup-42")) as AssignmentFilter;
    expect(where.assignments.some.type).toBe("TIME_RESPONSIBLE");
    expect(responsibleClause(where)).toEqual({
      OR: [
        { userId: "sup-42" },
        { user: { role: roles.cargaHoraria, status: "ACTIVO", supervisionsAsSupervised: { some: { supervisorUserId: "sup-42" } } } },
      ],
    });
  });

  it("la herencia exige supervisado Nivel 3 ACTIVO; la rama directa del Nivel 2 y el alcance del Nivel 3 no dependen de eso", () => {
    const supervision = responsibleClause(employeeAccessWhere(user(roles.supervision, "sup-1"))) as { OR: Array<Record<string, unknown>> };
    expect(supervision.OR[0]).toEqual({ userId: "sup-1" });
    expect(supervision.OR[1]).toMatchObject({ user: { role: roles.cargaHoraria, status: "ACTIVO" } });
    expect(responsibleClause(employeeAccessWhere(user(roles.cargaHoraria, "carga-1")))).toEqual({ userId: "carga-1" });
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
    // status + effectiveFrom + effectiveTo + responsable.
    expect(where.assignments.some.AND).toHaveLength(4);
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
