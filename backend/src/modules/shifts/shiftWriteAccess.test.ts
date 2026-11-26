import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../shared/errors/AppError";
import {
  assertEmployeesWritable,
  assertShiftGroupWritable,
  employeesOutsideScope,
  globalShiftActor,
  redactShiftWriteError,
  withShiftActorErrors,
  type ShiftActor,
} from "./shiftWriteAccess";
import { withErrorScope } from "./shiftErrorScope";

const db = vi.hoisted(() => ({ employee: { count: vi.fn(), findMany: vi.fn() } }));
vi.mock("../../shared/prisma/client", () => ({ prisma: db }));

const rrhh = globalShiftActor({ id: "u-rrhh", role: "NIVEL_1_RRHH" } as never);
const stefi: ShiftActor = { user: { id: "u-stefi", role: "NIVEL_2_SUPERVISION" } as never, scope: { all: false, groupIds: new Set(["g-planta"]) } };

beforeEach(() => {
  db.employee.count.mockReset();
  db.employee.findMany.mockReset();
});

describe("grupo indicado en el body", () => {
  it("Nivel 1 puede cualquiera, incluso sin grupo", () => {
    expect(() => assertShiftGroupWritable(rrhh, "g-taller")).not.toThrow();
    expect(() => assertShiftGroupWritable(rrhh, null)).not.toThrow();
  });

  it("alcance parcial: sólo sus grupos; sin grupo o ajeno → 403 SHIFT_GROUP_FORBIDDEN", () => {
    expect(() => assertShiftGroupWritable(stefi, "g-planta")).not.toThrow();
    for (const groupId of ["g-taller", null, undefined]) {
      expect(() => assertShiftGroupWritable(stefi, groupId)).toThrow(expect.objectContaining({ statusCode: 403, code: "SHIFT_GROUP_FORBIDDEN" }));
    }
  });
});

describe("legajos afectados (todo o nada)", () => {
  it("Nivel 1 no consulta", async () => {
    await expect(employeesOutsideScope(rrhh, ["e1", "e2"])).resolves.toBe(0);
    expect(db.employee.count).not.toHaveBeenCalled();
  });

  it("uno fuera del alcance alcanza para rechazar (sin decir cuál)", async () => {
    db.employee.count.mockResolvedValue(1);
    await expect(assertEmployeesWritable(stefi, ["e1", "e2", "e1"])).rejects.toMatchObject({ statusCode: 403, code: "EMPLOYEE_SCOPE_FORBIDDEN" });
    expect(db.employee.count.mock.calls[0]![0].where.AND[0]).toEqual({ id: { in: ["e1", "e2"] } });
  });

  it("todos en el alcance: pasa", async () => {
    db.employee.count.mockResolvedValue(2);
    await expect(assertEmployeesWritable(stefi, ["e1", "e2"])).resolves.toBeUndefined();
  });
});

describe("redactShiftWriteError (R-6)", () => {
  const overlap = new AppError("El turno fijo de Pérez se superpone con la rotación ROT-TALLER - Taller, equipo A - Equipo A.", 409, "SHIFT_ASSIGNMENT_OVERLAPS_ROTATION");

  it("Nivel 1 recibe el error original", async () => {
    await expect(redactShiftWriteError(overlap, rrhh)).resolves.toBe(overlap);
  });

  it("superposición con otra rotación: mismo código y estado, sin nombres ajenos", async () => {
    const redacted = (await redactShiftWriteError(overlap, stefi)) as AppError;
    expect([redacted.statusCode, redacted.code]).toEqual([409, "SHIFT_ASSIGNMENT_OVERLAPS_ROTATION"]);
    expect(redacted.message).not.toContain("ROT-TALLER");
    expect(redacted.details).toBeUndefined();
  });

  it("transición: conserva el mensaje propio y quita los rótulos del otro turno", async () => {
    const error = new AppError("El último turno se superpone con el siguiente.", 409, "ROTATION_TRANSITION_OVERLAP", { overlaps: [{ outgoing: "rotación PLANTA-01", incoming: "turno fijo TALLER-01" }] });
    const redacted = (await redactShiftWriteError(error, stefi)) as AppError;
    expect(redacted.message).toBe(error.message);
    expect(redacted.details).toBeUndefined();
  });

  it("activación retroactiva: sin nombres de membresías", async () => {
    const error = new AppError("No se puede activar: Pérez, Ana (01/01/2027).", 409, "ROTATION_ACTIVATION_RETROACTIVE", { members: [{ employee: "Pérez, Ana" }] });
    const redacted = (await redactShiftWriteError(error, stefi)) as AppError;
    expect(redacted.message).not.toContain("Pérez");
    expect(redacted.details).toBeUndefined();
  });

  it("avisos de configuración: persona oculta genérica; fijo superpuesto sin código", async () => {
    db.employee.findMany.mockResolvedValue([{ id: "e-visible" }]);
    const error = new AppError("No se puede dar el alta", 409, "ROTATION_CONFIGURATION_CONFLICT", {
      issues: [
        { code: "EMPLOYEE_INACTIVE", severity: "WARNING", employeeId: "e-hidden", message: "Oculto, Ana · Legajo 9 está inactivo." },
        { code: "FIXED_ASSIGNMENT_OVERLAP", severity: "ERROR", employeeId: "e-visible", message: "Gómez tiene el turno fijo TALLER-01 superpuesto." },
      ],
    });
    const redacted = (await redactShiftWriteError(error, stefi)) as AppError;
    const issues = (redacted.details as { issues: Array<{ message: string; employeeId?: string }> }).issues;
    expect(issues[0]).toEqual({ code: "EMPLOYEE_INACTIVE", severity: "WARNING", message: "Una persona fuera de tu alcance está inactiva y conserva una membresía vigente o futura." });
    expect(issues[1]!.message).not.toContain("TALLER-01");
    expect(issues[1]!.employeeId).toBe("e-visible");
  });

  it("conflictos de asistencia: oculta el nombre de quien está fuera del alcance y no expone ids", async () => {
    db.employee.findMany.mockResolvedValue([{ id: "e-visible" }]);
    const error = new AppError("Hay decisiones revisadas", 409, "ROTATION_ATTENDANCE_HISTORY_CONFLICT", {
      total: 2,
      conflicts: [
        { employeeId: "e-visible", employee: "Gómez, Luis", operationalDate: "2027-01-08" },
        { employeeId: "e-hidden", employee: "Oculto, Ana", operationalDate: "2027-01-09" },
      ],
    });
    const redacted = (await redactShiftWriteError(error, stefi)) as AppError;
    expect((redacted.details as { conflicts: unknown[] }).conflicts).toEqual([
      { employee: "Gómez, Luis", operationalDate: "2027-01-08" },
      { employee: "Persona fuera de tu alcance", operationalDate: "2027-01-09" },
    ]);
  });

  it("otros errores pasan sin cambios", async () => {
    const error = new AppError("Ya existe un equipo con ese código en la rotación.", 409, "ROTATION_CREW_DUPLICATE");
    await expect(redactShiftWriteError(error, stefi)).resolves.toBe(error);
    const plain = new Error("boom");
    await expect(redactShiftWriteError(plain, stefi)).resolves.toBe(plain);
  });

  it("withShiftActorErrors relanza la versión ocultada", async () => {
    await expect(withShiftActorErrors(stefi, async () => { throw overlap; })).rejects.toMatchObject({ code: "SHIFT_ASSIGNMENT_OVERLAPS_ROTATION", message: expect.not.stringContaining("ROT-TALLER") });
    await expect(withShiftActorErrors(rrhh, async () => { throw overlap; })).rejects.toBe(overlap);
  });
});

describe("R8.7 — mensaje completo sólo si todo lo mencionado está en el alcance", () => {
  const ownOverlap = () => withErrorScope(new AppError("El turno fijo de Gómez se superpone con la rotación ROT-PLANTA - Planta.", 409, "SHIFT_ASSIGNMENT_OVERLAPS_ROTATION"), { shiftGroupIds: ["g-planta"], employeeIds: ["e-visible"] });

  it("grupo y legajo propios: se conserva el mensaje original", async () => {
    db.employee.count.mockResolvedValue(1);
    const error = ownOverlap();
    await expect(redactShiftWriteError(error, stefi)).resolves.toBe(error);
  });

  it("legajo fuera del alcance: genérico", async () => {
    db.employee.count.mockResolvedValue(0);
    const redacted = (await redactShiftWriteError(ownOverlap(), stefi)) as AppError;
    expect(redacted.message).not.toContain("ROT-PLANTA");
  });

  it("grupo ajeno o sin grupo: genérico sin consultar legajos", async () => {
    for (const groupId of ["g-taller", null]) {
      const error = withErrorScope(new AppError("Ya tienen una membresía: Gómez (rotación ROT-TALLER).", 409, "ROTATION_MEMBERSHIP_OVERLAP"), { shiftGroupIds: [groupId], employeeIds: ["e-visible"] });
      expect(((await redactShiftWriteError(error, stefi)) as AppError).message).not.toContain("ROT-TALLER");
    }
    expect(db.employee.count).not.toHaveBeenCalled();
  });

  it("activación retroactiva con personas propias: mensaje y detalle completos", async () => {
    db.employee.count.mockResolvedValue(2);
    const error = withErrorScope(new AppError("No se puede activar: Pérez, Ana (01/01/2027).", 409, "ROTATION_ACTIVATION_RETROACTIVE", { members: [{ employee: "Pérez, Ana" }] }), { shiftGroupIds: ["g-planta"], employeeIds: ["e1", "e2"] });
    await expect(redactShiftWriteError(error, stefi)).resolves.toBe(error);
  });

  it("avisos con datos internos registrados: el turno fijo de su grupo conserva el código; el ajeno no", async () => {
    db.employee.findMany.mockResolvedValue([{ id: "e-visible" }]);
    const raw = [
      { code: "FIXED_ASSIGNMENT_OVERLAP" as const, severity: "ERROR" as const, employeeId: "e-visible", relatedShiftGroupId: "g-planta", message: "Gómez tiene el turno fijo PLANTA-01 superpuesto." },
      { code: "FIXED_ASSIGNMENT_OVERLAP" as const, severity: "ERROR" as const, employeeId: "e-visible", relatedShiftGroupId: "g-taller", message: "Gómez tiene el turno fijo TALLER-01 superpuesto." },
    ];
    const error = withErrorScope(new AppError("No se puede dar el alta", 409, "ROTATION_CONFIGURATION_CONFLICT", { issues: raw.map(({ relatedShiftGroupId: _g, ...issue }) => issue) }), { issues: raw });
    const issues = ((await redactShiftWriteError(error, stefi)) as AppError).details as { issues: Array<{ message: string }> };
    expect(issues.issues[0]!.message).toContain("PLANTA-01");
    expect(issues.issues[1]!.message).not.toContain("TALLER-01");
    expect(JSON.stringify(issues)).not.toContain("relatedShiftGroupId");
  });
});
