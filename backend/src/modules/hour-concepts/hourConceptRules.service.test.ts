import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { hourConceptRulesService } from "./hourConceptRules.service";
import { hourConceptRulesRepository } from "./hourConceptRules.repository";
import { auditService } from "../audit/audit.service";

vi.mock("./hourConceptRules.repository", () => ({
  hourConceptRulesRepository: {
    findMany: vi.fn(), findById: vi.fn(), findByConceptId: vi.fn(),
    findHourConceptConfiguration: vi.fn(), create: vi.fn(), update: vi.fn(),
  },
}));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn().mockResolvedValue(undefined) } }));

const repo = hourConceptRulesRepository as unknown as Record<"findMany" | "findById" | "findByConceptId" | "findHourConceptConfiguration" | "create" | "update", Mock>;
const mockedAudit = auditService.register as unknown as Mock;
const automaticConcept = { id: "automatic-1", status: "ACTIVO", deletedAt: null, loadMode: "AUTOMATIC", systemRole: null };
const bothConcept = { ...automaticConcept, id: "both-1", loadMode: "BOTH" };
const storedRule = { id: "rule-1", hourConceptId: "automatic-1", hourConcept: { id: "automatic-1", code: "HOR-001", name: "Sereno" }, startTime: "21:00", endTime: "04:00", crossesMidnight: true, priority: 0, status: "ACTIVO" };
const createInput = { hourConceptId: "automatic-1", startTime: "21:00", endTime: "04:00", crossesMidnight: true, status: "ACTIVO" as const };

beforeEach(() => vi.clearAllMocks());

describe("elegibilidad del concepto para reglas 6E", () => {
  it("rechaza Normal", async () => {
    repo.findHourConceptConfiguration.mockResolvedValue({ ...automaticConcept, systemRole: "NORMAL_BASE", loadMode: null });
    await expect(hourConceptRulesService.create(createInput)).rejects.toMatchObject({ code: "HOUR_CONCEPT_RULE_BASE_NOT_ALLOWED" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rechaza un concepto MANUAL", async () => {
    repo.findHourConceptConfiguration.mockResolvedValue({ ...automaticConcept, loadMode: "MANUAL" });
    await expect(hourConceptRulesService.create(createInput)).rejects.toMatchObject({ code: "HOUR_CONCEPT_RULE_MANUAL_NOT_ALLOWED" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it.each([automaticConcept, bothConcept])("permite crear para loadMode $loadMode", async (concept) => {
    repo.findHourConceptConfiguration.mockResolvedValue(concept);
    repo.create.mockResolvedValue(storedRule);
    await expect(hourConceptRulesService.create({ ...createInput, hourConceptId: concept.id })).resolves.toMatchObject({ id: "rule-1" });
  });

  it("rechaza concepto inactivo o eliminado", async () => {
    repo.findHourConceptConfiguration.mockResolvedValue({ ...automaticConcept, status: "INACTIVO" });
    await expect(hourConceptRulesService.create(createInput)).rejects.toMatchObject({ code: "HOUR_CONCEPT_RULE_INACTIVE_CONCEPT" });
  });
});

describe("contrato público sin prioridad", () => {
  it("crea, audita y omite priority de la respuesta", async () => {
    repo.findHourConceptConfiguration.mockResolvedValue(automaticConcept);
    repo.create.mockResolvedValue(storedRule);
    const result = await hourConceptRulesService.create(createInput, { userId: "user-1" });
    expect(result).not.toHaveProperty("priority");
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ description: expect.not.stringContaining("priority") }));
  });

  it("lista y obtiene reglas sin priority", async () => {
    repo.findMany.mockResolvedValue([[storedRule], 1]);
    repo.findById.mockResolvedValue(storedRule);
    expect((await hourConceptRulesService.list({ page: 1, take: 100 } as never)).items[0]).not.toHaveProperty("priority");
    expect(await hourConceptRulesService.getById("rule-1")).not.toHaveProperty("priority");
  });

  it("permite solapamientos: los conceptos adicionales no compiten", async () => {
    repo.findHourConceptConfiguration.mockResolvedValue(automaticConcept);
    repo.create.mockResolvedValue(storedRule);
    await expect(hourConceptRulesService.create(createInput)).resolves.toMatchObject({ id: "rule-1" });
  });
});

describe("update", () => {
  it("valida el concepto y conserva la validación de rango", async () => {
    repo.findById.mockResolvedValue(storedRule);
    repo.findHourConceptConfiguration.mockResolvedValue(automaticConcept);
    await expect(hourConceptRulesService.update("rule-1", { startTime: "04:00" })).rejects.toMatchObject({ code: "HOUR_CONCEPT_RULE_INVALID_RANGE" });
  });

  it("mapea P2025 a 404", async () => {
    repo.findById.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("missing", { code: "P2025", clientVersion: "0" }));
    await expect(hourConceptRulesService.getById("missing")).rejects.toMatchObject({ code: "HOUR_CONCEPT_RULE_NOT_FOUND" });
  });
});
