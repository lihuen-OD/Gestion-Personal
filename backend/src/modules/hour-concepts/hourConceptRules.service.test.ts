import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { hourConceptRulesService, ruleTimeWindowsOverlap } from "./hourConceptRules.service";
import { hourConceptRulesRepository } from "./hourConceptRules.repository";
import { auditService } from "../audit/audit.service";
import { classifyShiftInterval } from "./hourConceptClassification";
import { scheduledInstantForShiftTime } from "../../shared/datetime/argentinaTime";

vi.mock("./hourConceptRules.repository", () => ({
  hourConceptRulesRepository: {
    findMany: vi.fn(),
    findById: vi.fn(),
    findByConceptId: vi.fn(),
    findActiveExcept: vi.fn(),
    hourConceptExists: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(undefined) },
}));

const repo = hourConceptRulesRepository as unknown as {
  findMany: Mock;
  findById: Mock;
  findByConceptId: Mock;
  findActiveExcept: Mock;
  hourConceptExists: Mock;
  create: Mock;
  update: Mock;
};
const mockedAudit = auditService.register as unknown as Mock;

function prismaKnownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("mock prisma error", { code, clientVersion: "0.0.0" });
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.findActiveExcept.mockResolvedValue([]); // sin otras reglas activas por defecto: nunca ambiguo
});

const normalRule = { id: "rule-normal", hourConceptId: "concept-normal", startTime: "07:00", endTime: "21:00", crossesMidnight: false, priority: 1, status: "ACTIVO" };

describe("ruleTimeWindowsOverlap — solapamiento de definiciones recurrentes (Etapa 7)", () => {
  it("07:00–21:00 y 21:00–04:00 NO se solapan (son consecutivas)", () => {
    expect(ruleTimeWindowsOverlap({ startTime: "07:00", endTime: "21:00", crossesMidnight: false }, { startTime: "21:00", endTime: "04:00", crossesMidnight: true })).toBe(false);
  });

  it("21:00–04:00 y 23:00–07:00 sí se solapan (ambas cruzan medianoche y comparten 23:00-04:00)", () => {
    expect(ruleTimeWindowsOverlap({ startTime: "21:00", endTime: "04:00", crossesMidnight: true }, { startTime: "23:00", endTime: "07:00", crossesMidnight: true })).toBe(true);
  });

  it("dos reglas idénticas se solapan", () => {
    expect(ruleTimeWindowsOverlap({ startTime: "07:00", endTime: "15:00", crossesMidnight: false }, { startTime: "07:00", endTime: "15:00", crossesMidnight: false })).toBe(true);
  });

  it("08:00–09:00 dentro de 07:00–21:00 se solapa", () => {
    expect(ruleTimeWindowsOverlap({ startTime: "08:00", endTime: "09:00", crossesMidnight: false }, { startTime: "07:00", endTime: "21:00", crossesMidnight: false })).toBe(true);
  });

  it("04:00–07:00 y 07:00–21:00 NO se solapan (consecutivas, sin cruce de medianoche)", () => {
    expect(ruleTimeWindowsOverlap({ startTime: "04:00", endTime: "07:00", crossesMidnight: false }, { startTime: "07:00", endTime: "21:00", crossesMidnight: false })).toBe(false);
  });
});

describe("A. CRUD básico", () => {
  it("crea una regla válida", async () => {
    repo.hourConceptExists.mockResolvedValue({ id: "concept-normal" });
    repo.create.mockResolvedValue(normalRule);

    const item = await hourConceptRulesService.create({ hourConceptId: "concept-normal", startTime: "07:00", endTime: "21:00", crossesMidnight: false, priority: 1, status: "ACTIVO" }, { userId: "user-1" });

    expect(item).toEqual(normalRule);
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "HourConceptRule" }));
  });

  it("obtiene una regla por id", async () => {
    repo.findById.mockResolvedValue(normalRule);
    const item = await hourConceptRulesService.getById("rule-normal");
    expect(item).toEqual(normalRule);
  });

  it("lista reglas (filtros por hourConceptId/status los aplica el repository, acá se verifica el passthrough)", async () => {
    repo.findMany.mockResolvedValue([[normalRule], 1]);
    const result = await hourConceptRulesService.list({ hourConceptId: "concept-normal", page: 1, take: 100 } as never);
    expect(result.items).toEqual([normalRule]);
    expect(repo.findMany).toHaveBeenCalledWith(expect.objectContaining({ hourConceptId: "concept-normal" }));
  });

  it("edita una regla (priority) sin tocar status -> audita UPDATE", async () => {
    repo.findById.mockResolvedValue(normalRule);
    repo.update.mockResolvedValue({ ...normalRule, priority: 5 });

    await hourConceptRulesService.update("rule-normal", { priority: 5 }, { userId: "user-1" });

    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "HourConceptRule" }));
  });

  it("inactiva una regla (status ACTIVO -> INACTIVO) audita DEACTIVATE", async () => {
    repo.findById.mockResolvedValue(normalRule);
    repo.update.mockResolvedValue({ ...normalRule, status: "INACTIVO" });

    await hourConceptRulesService.updateStatus("rule-normal", "INACTIVO", { userId: "user-1" });

    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DEACTIVATE", entity: "HourConceptRule" }));
  });
});

describe("B. Validación de existencia (hourConceptId)", () => {
  it("rechaza hourConceptId inexistente al crear", async () => {
    repo.hourConceptExists.mockResolvedValue(null);

    await expect(
      hourConceptRulesService.create({ hourConceptId: "concept-inexistente", startTime: "07:00", endTime: "21:00", crossesMidnight: false, priority: 1, status: "ACTIVO" }),
    ).rejects.toMatchObject({ statusCode: 404, code: "HOUR_CONCEPT_NOT_FOUND" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("propaga 404 HOUR_CONCEPT_RULE_NOT_FOUND si la regla no existe (P2025)", async () => {
    repo.findById.mockRejectedValue(prismaKnownError("P2025"));
    await expect(hourConceptRulesService.getById("rule-inexistente")).rejects.toMatchObject({ statusCode: 404, code: "HOUR_CONCEPT_RULE_NOT_FOUND" });
  });
});

describe("D. Solapamientos ambiguos", () => {
  it("rechaza dos reglas activas solapadas con la misma priority", async () => {
    repo.hourConceptExists.mockResolvedValue({ id: "concept-especial" });
    repo.findActiveExcept.mockResolvedValue([normalRule]); // priority 1, 07:00-21:00

    await expect(
      hourConceptRulesService.create({ hourConceptId: "concept-especial", startTime: "08:00", endTime: "09:00", crossesMidnight: false, priority: 1, status: "ACTIVO" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "HOUR_CONCEPT_RULE_AMBIGUOUS_OVERLAP" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("permite dos reglas activas solapadas con distinta priority", async () => {
    repo.hourConceptExists.mockResolvedValue({ id: "concept-especial" });
    repo.findActiveExcept.mockResolvedValue([normalRule]); // priority 1
    repo.create.mockResolvedValue({ id: "rule-especial", hourConceptId: "concept-especial", startTime: "08:00", endTime: "09:00", crossesMidnight: false, priority: 5, status: "ACTIVO" });

    const item = await hourConceptRulesService.create({ hourConceptId: "concept-especial", startTime: "08:00", endTime: "09:00", crossesMidnight: false, priority: 5, status: "ACTIVO" });
    expect(item.priority).toBe(5);
  });

  it("permite reglas consecutivas sin solapamiento (07:00-21:00 y 21:00-04:00)", async () => {
    repo.hourConceptExists.mockResolvedValue({ id: "concept-guardia" });
    repo.findActiveExcept.mockResolvedValue([normalRule]); // 07:00-21:00, priority 1
    repo.create.mockResolvedValue({ id: "rule-guardia", hourConceptId: "concept-guardia", startTime: "21:00", endTime: "04:00", crossesMidnight: true, priority: 1, status: "ACTIVO" });

    const item = await hourConceptRulesService.create({ hourConceptId: "concept-guardia", startTime: "21:00", endTime: "04:00", crossesMidnight: true, priority: 1, status: "ACTIVO" });
    expect(item.id).toBe("rule-guardia");
  });

  it("ignora reglas INACTIVO para el conflicto (findActiveExcept ya las excluye a nivel de query)", async () => {
    repo.hourConceptExists.mockResolvedValue({ id: "concept-especial" });
    repo.findActiveExcept.mockResolvedValue([]); // el repository solo devuelve activas — una regla inactiva nunca llega acá
    repo.create.mockResolvedValue({ id: "rule-especial", hourConceptId: "concept-especial", startTime: "08:00", endTime: "09:00", crossesMidnight: false, priority: 1, status: "ACTIVO" });

    await expect(
      hourConceptRulesService.create({ hourConceptId: "concept-especial", startTime: "08:00", endTime: "09:00", crossesMidnight: false, priority: 1, status: "ACTIVO" }),
    ).resolves.toMatchObject({ id: "rule-especial" });
  });

  it("una regla creada como INACTIVO nunca dispara el chequeo de ambigüedad (no participa en clasificación)", async () => {
    repo.hourConceptExists.mockResolvedValue({ id: "concept-especial" });
    repo.create.mockResolvedValue({ id: "rule-especial", hourConceptId: "concept-especial", startTime: "08:00", endTime: "09:00", crossesMidnight: false, priority: 1, status: "INACTIVO" });

    await hourConceptRulesService.create({ hourConceptId: "concept-especial", startTime: "08:00", endTime: "09:00", crossesMidnight: false, priority: 1, status: "INACTIVO" });

    expect(repo.findActiveExcept).not.toHaveBeenCalled();
  });

  it("al editar, re-chequea contra las otras reglas excluyéndose a sí misma", async () => {
    repo.findById.mockResolvedValue(normalRule);
    repo.update.mockResolvedValue({ ...normalRule, priority: 2 });

    await hourConceptRulesService.update("rule-normal", { priority: 2 });

    expect(repo.findActiveExcept).toHaveBeenCalledWith("rule-normal");
  });

  it("rechaza el update si el resultado final tendría startTime == endTime (mezclando el valor anterior con el nuevo)", async () => {
    repo.findById.mockResolvedValue(normalRule); // endTime: 21:00
    await expect(hourConceptRulesService.update("rule-normal", { startTime: "21:00" })).rejects.toMatchObject({
      statusCode: 400,
      code: "HOUR_CONCEPT_RULE_INVALID_RANGE",
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("activar una regla antes inactiva re-chequea ambigüedad (activar puede volverla conflictiva)", async () => {
    repo.findById.mockResolvedValue({ ...normalRule, status: "INACTIVO" });
    repo.findActiveExcept.mockResolvedValue([{ ...normalRule, id: "otra-regla" }]); // misma priority/horario que la que antes estaba inactiva

    await expect(hourConceptRulesService.updateStatus("rule-normal", "ACTIVO")).rejects.toMatchObject({
      statusCode: 409,
      code: "HOUR_CONCEPT_RULE_AMBIGUOUS_OVERLAP",
    });
  });
});

describe("F. Integración con classifyShiftInterval — la forma que produce el CRUD es compatible con la clasificación real", () => {
  it("dos reglas creadas (Normal priority 1, Especial priority 5) producen exactamente el resultado esperado en classifyShiftInterval: gana la de mayor priority", () => {
    const day = new Date("2026-08-18T12:00:00.000Z");
    const created = [
      { id: "rule-normal", hourConceptId: "concept-normal", hourConceptName: "Hora normal", startTime: "07:00", endTime: "21:00", crossesMidnight: false, priority: 1 },
      { id: "rule-especial", hourConceptId: "concept-especial", hourConceptName: "Especial", startTime: "08:00", endTime: "09:00", crossesMidnight: false, priority: 5 },
    ];

    const result = classifyShiftInterval({
      startAt: scheduledInstantForShiftTime(day, "08:00"),
      endAt: scheduledInstantForShiftTime(day, "10:00"),
      activeRules: created,
      enabledHourConceptIds: new Set(["concept-normal", "concept-especial"]),
      fallbackHourConcept: { id: "concept-normal", name: "Hora normal" },
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ hourConceptId: "concept-especial", minutes: 60 });
    expect(result[1]).toMatchObject({ hourConceptId: "concept-normal", minutes: 60 });
  });

  it("una regla que el CRUD deja INACTIVO simplemente no se pasa en activeRules (hourConceptsRepository.findActiveRules ya filtra status ACTIVO) y no clasifica nada", () => {
    const day = new Date("2026-08-18T12:00:00.000Z");
    // Simula que la regla creada como INACTIVO nunca llega a activeRules —
    // exactamente lo que hace hourConceptsRepository.findActiveRules() al
    // filtrar status: "ACTIVO" en su where (no se duplica esa lógica acá).
    const result = classifyShiftInterval({
      startAt: scheduledInstantForShiftTime(day, "08:00"),
      endAt: scheduledInstantForShiftTime(day, "09:00"),
      activeRules: [],
      enabledHourConceptIds: new Set(["concept-especial"]),
      fallbackHourConcept: { id: "concept-normal", name: "Hora normal" },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ conceptStatus: "SIN_CONCEPTO_COMPATIBLE" });
  });
});
