import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { auditService } from "../audit/audit.service";
import { usersRepository } from "./users.repository";
import { usersService } from "./users.service";
import type { CreateUserInput, UpdateUserInput } from "./users.schemas";

vi.mock("./users.repository", () => ({
  usersRepository: {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findCompany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    findManyForExport: vi.fn(),
    count: vi.fn(),
    remove: vi.fn(),
    updatePassword: vi.fn(),
    setPassword: vi.fn(),
    findEmployeeLink: vi.fn(),
    findUsersByIds: vi.fn(),
    transaction: vi.fn(),
    addSupervisions: vi.fn(),
    removeSupervisions: vi.fn(),
    removeAllAsSupervised: vi.fn(),
  },
}));
vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null), registerWithin: vi.fn().mockResolvedValue(null) },
  clearAuditDerivedCaches: vi.fn(),
}));
vi.mock("../auth/auth.service", () => ({ invalidateCurrentUserCache: vi.fn() }));

type RepoMethod = "findById" | "findByEmail" | "findCompany" | "create" | "update" | "findEmployeeLink" | "findUsersByIds" | "transaction" | "addSupervisions" | "removeSupervisions" | "removeAllAsSupervised" | "updatePassword";
const repo = usersRepository as unknown as Record<RepoMethod, Mock>;
const TX = { tx: true };

const createInput: CreateUserInput = {
  name: "Ana Gómez",
  email: "ana@example.com",
  password: "secreto123",
  role: "NIVEL_1_RRHH",
  status: "ACTIVO",
  companyId: "c-arch",
} as CreateUserInput;

beforeEach(() => {
  vi.clearAllMocks();
  repo.findByEmail.mockResolvedValue(null);
  repo.findCompany.mockResolvedValue(null);
  repo.findEmployeeLink.mockResolvedValue(null);
  repo.findUsersByIds.mockResolvedValue([]);
  repo.transaction.mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) => operation(TX));
});

describe("A8 §12.4 — User.companyId no puede apuntar a un registro archivado", () => {
  it("rechaza el alta con empresa archivada, sin crear ni auditar", async () => {
    repo.findCompany.mockResolvedValue({ id: "c-arch", name: "Odwyer Vieja", archivedAt: new Date("2026-10-01T00:00:00.000Z") });

    await expect(usersService.create(createInput)).rejects.toMatchObject({
      statusCode: 400,
      code: "USER_COMPANY_ARCHIVED",
      message: expect.stringContaining("Odwyer Vieja"),
    });
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.findCompany).toHaveBeenCalledWith("c-arch");
  });

  it("permite el alta con empresa no archivada", async () => {
    repo.findCompany.mockResolvedValue({ id: "c-ok", name: "Odwyer", archivedAt: null });
    repo.create.mockResolvedValue({ id: "u-1", email: "ana@example.com", supervisedUsers: [], supervisorUsers: [] });

    await expect(usersService.create({ ...createInput, companyId: "c-ok" })).resolves.toMatchObject({ id: "u-1" });
    expect(repo.create).toHaveBeenCalled();
  });

  it("permite el alta sin empresa", async () => {
    repo.create.mockResolvedValue({ id: "u-2", email: "ana@example.com", supervisedUsers: [], supervisorUsers: [] });

    await expect(usersService.create({ ...createInput, companyId: null })).resolves.toMatchObject({ id: "u-2" });
    expect(repo.findCompany).not.toHaveBeenCalled();
  });

  it("rechaza en la edición cambiar a una empresa archivada, sin escribir", async () => {
    repo.findById.mockResolvedValue({ id: "u-1", email: "old@example.com", name: "Ana", role: "NIVEL_1_RRHH", status: "ACTIVO", supervisedUsers: [], supervisorUsers: [] });
    repo.findCompany.mockResolvedValue({ id: "c-arch", name: "Odwyer Vieja", archivedAt: new Date() });

    await expect(usersService.update("u-1", { companyId: "c-arch" } as UpdateUserInput)).rejects.toMatchObject({
      statusCode: 400,
      code: "USER_COMPANY_ARCHIVED",
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("una edición que no toca la empresa no consulta el chequeo de archivado", async () => {
    repo.findById.mockResolvedValue({ id: "u-1", email: "old@example.com", name: "Ana", role: "NIVEL_1_RRHH", status: "ACTIVO", supervisedUsers: [], supervisorUsers: [] });
    repo.update.mockResolvedValue({ id: "u-1", name: "Ana Renombrada", supervisedUsers: [], supervisorUsers: [] });

    await usersService.update("u-1", { name: "Ana Renombrada" } as UpdateUserInput);

    expect(repo.findCompany).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalled();
  });
});

const N1 = "NIVEL_1_RRHH";
const N2 = "NIVEL_2_SUPERVISION";
const N3 = "NIVEL_3_CARGA_HORARIA";
const person = (id: string, role: string, name = id.toUpperCase()) => ({ id, name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`, role, status: "ACTIVO" });
const cargaPlanta = person("n3-planta", N3, "CARGA PLANTA");
const cargaPanol = person("n3-panol", N3, "CARGA PAÑOL");
const otroN2 = person("n2-otro", N2, "OTRO ENCARGADO");
const stored = (overrides: Record<string, unknown> = {}) => ({ id: "n2-jefe", name: "ENCARGADO PLANTA", email: "jefe@example.com", role: N2, status: "ACTIVO", employeeId: null, supervisedUsers: [], supervisorUsers: [], ...overrides });
const registeredAudits = () => (auditService.registerWithin as Mock).mock.calls.map((call) => call[1]);
const supervisionAudits = () => registeredAudits().filter((entry) => entry.entity === "UserSupervisionAssignment");

describe("Usuarios — empleado vinculado (User.employeeId único)", () => {
  it("alta con un empleado ya vinculado a otro usuario: 409 de negocio, sin escribir", async () => {
    repo.findEmployeeLink.mockResolvedValue({ id: "emp-1", userAccount: { id: "otro-user" } });

    await expect(usersService.create({ ...createInput, employeeId: "emp-1" })).rejects.toMatchObject({
      statusCode: 409,
      code: "EMPLOYEE_ALREADY_LINKED_TO_USER",
      message: "Este empleado ya está vinculado a otro usuario.",
    });
    expect(repo.transaction).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("edición con un empleado vinculado a otro usuario: 409 de negocio, sin escribir", async () => {
    repo.findById.mockResolvedValue(stored({ id: "u-1", role: N1 }));
    repo.findEmployeeLink.mockResolvedValue({ id: "emp-1", userAccount: { id: "otro-user" } });

    await expect(usersService.update("u-1", { employeeId: "emp-1" } as UpdateUserInput)).rejects.toMatchObject({ statusCode: 409, code: "EMPLOYEE_ALREADY_LINKED_TO_USER" });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("editar manteniendo el mismo empleado vinculado es válido", async () => {
    repo.findById.mockResolvedValue(stored({ id: "u-1", role: N1, employeeId: "emp-1" }));
    repo.findEmployeeLink.mockResolvedValue({ id: "emp-1", userAccount: { id: "u-1" } });
    repo.update.mockResolvedValue(stored({ id: "u-1", role: N1, employeeId: "emp-1" }));

    await expect(usersService.update("u-1", { name: "Ana", employeeId: "emp-1" } as UpdateUserInput)).resolves.toMatchObject({ employeeId: "emp-1" });
    expect(repo.update).toHaveBeenCalled();
  });

  it("employeeId null es válido y no consulta el vínculo", async () => {
    repo.findById.mockResolvedValue(stored({ id: "u-1", role: N1, employeeId: "emp-1" }));
    repo.update.mockResolvedValue(stored({ id: "u-1", role: N1 }));

    await usersService.update("u-1", { employeeId: null } as UpdateUserInput);
    expect(repo.findEmployeeLink).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith("u-1", expect.objectContaining({ employeeId: null }), TX);
  });

  it("un empleado inexistente responde un error de negocio, no un 500", async () => {
    await expect(usersService.create({ ...createInput, employeeId: "emp-x" })).rejects.toMatchObject({ statusCode: 400, code: "USER_EMPLOYEE_NOT_FOUND" });
  });

  it("carrera: el P2002 de User.employeeId se mapea al mismo 409 de negocio", async () => {
    repo.findEmployeeLink.mockResolvedValue({ id: "emp-1", userAccount: null });
    repo.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test", meta: { target: ["employeeId"] } }));

    await expect(usersService.create({ ...createInput, employeeId: "emp-1" })).rejects.toMatchObject({ statusCode: 409, code: "EMPLOYEE_ALREADY_LINKED_TO_USER" });
  });

  it("carrera: el P2002 del email se mapea a EMAIL_ALREADY_EXISTS en español", async () => {
    repo.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test", meta: { target: ["email"] } }));

    await expect(usersService.create(createInput)).rejects.toMatchObject({ statusCode: 409, code: "EMAIL_ALREADY_EXISTS", message: "Ya existe un usuario con ese email." });
  });
});

describe("Usuarios — alta y edición válidas", () => {
  it("alta válida: crea y audita dentro de la misma transacción, sin contraseña en la auditoría", async () => {
    repo.create.mockResolvedValue(stored({ id: "u-9", role: N1 }));

    await expect(usersService.create(createInput)).resolves.toMatchObject({ id: "u-9" });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: expect.any(String) }), TX);
    const audit = registeredAudits().find((entry) => entry.entity === "User");
    expect(audit).toMatchObject({ action: "CREATE" });
    expect(JSON.stringify(audit)).not.toContain("secreto123");
    expect(JSON.stringify(audit)).not.toContain("passwordHash");
  });

  it("edición sin contraseña: el PATCH no la recibe ni la toca", async () => {
    repo.findById.mockResolvedValue(stored({ id: "u-1", role: N1 }));
    repo.update.mockResolvedValue(stored({ id: "u-1", role: N1, name: "Nuevo" }));

    await usersService.update("u-1", { name: "Nuevo" } as UpdateUserInput);
    expect(repo.update.mock.calls[0]![1]).not.toHaveProperty("password");
    expect(repo.updatePassword).not.toHaveBeenCalled();
  });
});

describe("Usuarios — supervisión Nivel 2 → Nivel 3", () => {
  it("un Nivel 2 se crea con varios Nivel 3 supervisados y se audita quién se agregó", async () => {
    repo.findUsersByIds.mockResolvedValue([cargaPlanta, cargaPanol]);
    repo.create.mockResolvedValue(stored());
    repo.findById.mockResolvedValue(stored({ supervisedUsers: [cargaPanol, cargaPlanta] }));

    const user = await usersService.create({ ...createInput, role: N2, supervisedUserIds: [cargaPlanta.id, cargaPanol.id] } as CreateUserInput);

    expect(repo.addSupervisions).toHaveBeenCalledWith(TX, "n2-jefe", [cargaPlanta.id, cargaPanol.id]);
    expect(user.supervisedUsers).toHaveLength(2);
    const [audit] = supervisionAudits();
    expect(audit.description).toContain("ENCARGADO PLANTA");
    expect(audit.description).toContain("se agregaron CARGA PLANTA");
    expect(audit.description).toContain("CARGA PAÑOL");
    expect(audit.description).not.toMatch(/n3-planta|n2-jefe/);
  });

  it("Nivel 1 no necesita supervisión: un alta sin la lista no la consulta ni escribe", async () => {
    repo.create.mockResolvedValue(stored({ role: N1 }));

    await usersService.create(createInput);
    expect(repo.findUsersByIds).not.toHaveBeenCalled();
    expect(repo.addSupervisions).not.toHaveBeenCalled();
  });

  it("un Nivel 3 nunca puede configurarse como supervisor", async () => {
    await expect(usersService.create({ ...createInput, role: N3, supervisedUserIds: [cargaPlanta.id] } as CreateUserInput))
      .rejects.toMatchObject({ statusCode: 400, code: "USER_SUPERVISION_REQUIRES_SUPERVISOR_ROLE" });
    expect(repo.create).not.toHaveBeenCalled();

    repo.findById.mockResolvedValue(stored({ id: "n3-x", role: N3 }));
    await expect(usersService.update("n3-x", { supervisedUserIds: [cargaPlanta.id] } as UpdateUserInput))
      .rejects.toMatchObject({ code: "USER_SUPERVISION_REQUIRES_SUPERVISOR_ROLE" });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("un Nivel 2 no puede supervisar a otro Nivel 2 (ni a un RRHH)", async () => {
    repo.findById.mockResolvedValue(stored());
    repo.findUsersByIds.mockResolvedValue([cargaPlanta, otroN2]);

    await expect(usersService.update("n2-jefe", { supervisedUserIds: [cargaPlanta.id, otroN2.id] } as UpdateUserInput))
      .rejects.toMatchObject({ statusCode: 400, code: "USER_SUPERVISION_INVALID_TARGET", message: expect.stringContaining("OTRO ENCARGADO") });
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.addSupervisions).not.toHaveBeenCalled();
  });

  it("no puede supervisarse a sí mismo ni a un usuario inexistente", async () => {
    repo.findById.mockResolvedValue(stored());
    await expect(usersService.update("n2-jefe", { supervisedUserIds: ["n2-jefe"] } as UpdateUserInput)).rejects.toMatchObject({ code: "USER_SUPERVISION_INVALID_TARGET" });

    repo.findUsersByIds.mockResolvedValue([]);
    await expect(usersService.update("n2-jefe", { supervisedUserIds: ["missing"] } as UpdateUserInput)).rejects.toMatchObject({ code: "USER_SUPERVISION_INVALID_TARGET" });
  });

  it("editar reemplaza la lista completa: agrega y quita sólo la diferencia, y lo audita", async () => {
    repo.findById.mockResolvedValue(stored({ supervisedUsers: [cargaPlanta] }));
    repo.findUsersByIds.mockResolvedValue([cargaPanol]);
    repo.update.mockResolvedValue(stored({ supervisedUsers: [cargaPlanta] }));

    await usersService.update("n2-jefe", { supervisedUserIds: [cargaPanol.id] } as UpdateUserInput);

    expect(repo.removeSupervisions).toHaveBeenCalledWith(TX, "n2-jefe", [cargaPlanta.id]);
    expect(repo.addSupervisions).toHaveBeenCalledWith(TX, "n2-jefe", [cargaPanol.id]);
    const [audit] = supervisionAudits();
    expect(audit.description).toContain("se agregaron CARGA PAÑOL");
    expect(audit.description).toContain("se quitaron CARGA PLANTA");
  });

  it("omitir la lista conserva las relaciones; enviar la misma lista no escribe ni audita supervisión", async () => {
    repo.findById.mockResolvedValue(stored({ supervisedUsers: [cargaPlanta] }));
    repo.update.mockResolvedValue(stored({ supervisedUsers: [cargaPlanta] }));

    await usersService.update("n2-jefe", { name: "ENCARGADO PLANTA" } as UpdateUserInput);
    repo.findUsersByIds.mockResolvedValue([cargaPlanta]);
    await usersService.update("n2-jefe", { supervisedUserIds: [cargaPlanta.id] } as UpdateUserInput);

    expect(repo.addSupervisions).not.toHaveBeenCalled();
    expect(repo.removeSupervisions).not.toHaveBeenCalled();
    expect(supervisionAudits()).toHaveLength(0);
  });

  it("un Nivel 2 que pasa a otro rol deja de supervisar a todos, en la misma transacción y auditado", async () => {
    repo.findById.mockResolvedValue(stored({ supervisedUsers: [cargaPlanta, cargaPanol] }));
    repo.update.mockResolvedValue(stored({ role: N1 }));

    await usersService.update("n2-jefe", { role: N1 } as UpdateUserInput);

    expect(repo.removeSupervisions).toHaveBeenCalledWith(TX, "n2-jefe", [cargaPlanta.id, cargaPanol.id]);
    const [audit] = supervisionAudits();
    expect(audit.description).toContain("se quitaron CARGA PLANTA");
    expect(audit.description).toContain("dejó de ser Nivel 2");
  });

  it("un Nivel 3 supervisado que pasa a otro rol deja de estar supervisado (auditado por cada Nivel 2)", async () => {
    const jefe = person("n2-jefe", N2, "ENCARGADO PLANTA");
    repo.findById.mockResolvedValue(stored({ ...cargaPlanta, supervisorUsers: [jefe] }));
    repo.update.mockResolvedValue(stored({ ...cargaPlanta, role: N2 }));

    await usersService.update(cargaPlanta.id, { role: N2 } as UpdateUserInput);

    expect(repo.removeAllAsSupervised).toHaveBeenCalledWith(TX, cargaPlanta.id);
    const [audit] = supervisionAudits();
    expect(audit).toMatchObject({ entityId: "n2-jefe" });
    expect(audit.description).toContain("se quitó CARGA PLANTA");
  });

  it("si falla la escritura de relaciones, el error se propaga (la transacción revierte el usuario)", async () => {
    repo.findById.mockResolvedValue(stored());
    repo.findUsersByIds.mockResolvedValue([cargaPlanta]);
    repo.update.mockResolvedValue(stored());
    repo.addSupervisions.mockRejectedValue(new Error("db down"));

    await expect(usersService.update("n2-jefe", { supervisedUserIds: [cargaPlanta.id] } as UpdateUserInput)).rejects.toThrow("db down");
    expect(repo.transaction).toHaveBeenCalledTimes(1);
  });
});
