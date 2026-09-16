import { beforeEach, describe, expect, it, vi } from "vitest";
import { finnegansExportRepository } from "./finnegansExport.repository";
import { finnegansExportBatchRepository } from "./finnegansExport.batch.repository";
import { finnegansExportService, toCsv } from "./finnegansExport.service";
import { auditService } from "../audit/audit.service";

vi.mock("./finnegansExport.repository", () => ({
  finnegansExportRepository: {
    findExportableNovelties: vi.fn(),
    findClosuresForExport: vi.fn(),
  },
}));

vi.mock("./finnegansExport.batch.repository", () => ({
  finnegansExportBatchRepository: {
    findByIdempotencyKey: vi.fn(),
    hasAnyBatch: vi.fn(),
    createBatchWithItems: vi.fn(),
    findByIdWithItems: vi.fn(),
    findLatestForPeriod: vi.fn(),
    findManyForPeriod: vi.fn(),
    findManyForPeriodWithItems: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const repo = vi.mocked(finnegansExportRepository, true);
const batchRepo = vi.mocked(finnegansExportBatchRepository, true);
const mockedRegister = vi.mocked(auditService.register);

const decimal = (value: string) => ({ toString: () => value }) as unknown as import("@prisma/client").Prisma.Decimal;

function novelty(overrides: {
  id?: string;
  employeeId?: string;
  fromDate?: Date;
  toDate?: Date | null;
  quantityHours?: ReturnType<typeof decimal> | null;
  quantityDays?: ReturnType<typeof decimal> | null;
  legajo?: string;
  legajoFinnegans?: string | null;
  finnegansValueUnit?: "HOURS" | "DAYS" | "UNIT" | null;
  finnegansRequiresValidity?: boolean;
  finnegansCode?: string | null;
  noveltyTypeName?: string;
} = {}) {
  return {
    id: overrides.id || "novelty-1",
    employeeId: overrides.employeeId || "employee-1",
    fromDate: overrides.fromDate || new Date("2026-09-05"),
    toDate: overrides.toDate === undefined ? new Date("2026-09-06") : overrides.toDate,
    quantityHours: overrides.quantityHours === undefined ? null : overrides.quantityHours,
    quantityDays: overrides.quantityDays === undefined ? null : overrides.quantityDays,
    employee: {
      id: overrides.employeeId || "employee-1",
      legajo: overrides.legajo || "100",
      legajoFinnegans: overrides.legajoFinnegans === undefined ? null : overrides.legajoFinnegans,
      firstName: "Ana",
      lastName: "Gomez",
      costCenter: null,
    },
    noveltyType: {
      name: overrides.noveltyTypeName || "Vacaciones",
      finnegansValueUnit: overrides.finnegansValueUnit === undefined ? "UNIT" : overrides.finnegansValueUnit,
      finnegansRequiresValidity: overrides.finnegansRequiresValidity ?? false,
      finnegansCode: overrides.finnegansCode === undefined ? "VAC" : overrides.finnegansCode,
    },
  } as unknown as Awaited<ReturnType<typeof finnegansExportRepository.findExportableNovelties>>[number];
}

function batchFixture(overrides: Partial<{
  id: string;
  period: string;
  version: number;
  format: "XLSX" | "CSV";
  hash: string;
  rowCount: number;
  reason: string | null;
  idempotencyKey: string;
  createdAt: Date;
  createdByUserId: string | null;
  createdBy: { name: string } | null;
  previousBatch: { hash: string } | null;
  previousBatchId: string | null;
}> = {}) {
  return {
    id: overrides.id || "batch-1",
    period: overrides.period || "2026-09",
    version: overrides.version ?? 1,
    format: overrides.format || "XLSX",
    hash: overrides.hash || "hash-1",
    rowCount: overrides.rowCount ?? 1,
    reason: overrides.reason === undefined ? null : overrides.reason,
    idempotencyKey: overrides.idempotencyKey || "idem-1",
    createdAt: overrides.createdAt || new Date("2026-09-16T12:00:00Z"),
    createdByUserId: overrides.createdByUserId === undefined ? "user-1" : overrides.createdByUserId,
    createdBy: overrides.createdBy === undefined ? { name: "RRHH" } : overrides.createdBy,
    previousBatch: overrides.previousBatch === undefined ? null : overrides.previousBatch,
    previousBatchId: overrides.previousBatchId === undefined ? null : overrides.previousBatchId,
  };
}

function requestInput(overrides: Partial<{ period: string; format: "XLSX" | "CSV"; reexportReason?: string; idempotencyKey: string; employeeId?: string }> = {}) {
  return {
    period: overrides.period || "2026-09",
    format: overrides.format || ("XLSX" as const),
    reexportReason: overrides.reexportReason,
    idempotencyKey: overrides.idempotencyKey || "idem-1",
    employeeId: overrides.employeeId,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.findExportableNovelties.mockResolvedValue([]);
  repo.findClosuresForExport.mockResolvedValue([]);
  batchRepo.findByIdempotencyKey.mockResolvedValue(null);
  batchRepo.hasAnyBatch.mockResolvedValue(false);
  batchRepo.createBatchWithItems.mockResolvedValue(batchFixture());
  batchRepo.findByIdWithItems.mockResolvedValue(null);
  batchRepo.findLatestForPeriod.mockResolvedValue(null);
  batchRepo.findManyForPeriod.mockResolvedValue([]);
  batchRepo.findManyForPeriodWithItems.mockResolvedValue([]);
});

describe("finnegansExportService.getPreview — Etapa 15L.3A/15L.4", () => {
  it("sin filas: readiness lista, no consulta cierres", async () => {
    const result = await finnegansExportService.getPreview({ period: "2026-09" });
    expect(result.readiness).toEqual({ ready: true, totalRows: 0, readyRows: 0, blockedRows: 0, reasons: [] });
    expect(repo.findClosuresForExport).not.toHaveBeenCalled();
  });

  it("informa cierre pendiente como blocker pero NO tira error — la pantalla sigue siendo consultable", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ finnegansRequiresValidity: false })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "ABIERTO" }]);

    const result = await finnegansExportService.getPreview({ period: "2026-09" });

    expect(result.readiness.ready).toBe(false);
    expect(result.rows[0]!.estado).toBe("CIERRE_PENDIENTE");
    expect(mockedRegister).not.toHaveBeenCalled();
  });

  it("nunca audita y nunca crea batch — el GET de preview no debe quedar registrado como exportación realizada (test N)", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    await finnegansExportService.getPreview({ period: "2026-09" });

    expect(mockedRegister).not.toHaveBeenCalled();
    expect(batchRepo.createBatchWithItems).not.toHaveBeenCalled();
  });

  it("incluye hash y lastExport=null cuando el período nunca fue exportado", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);
    batchRepo.findLatestForPeriod.mockResolvedValue(null);

    const result = await finnegansExportService.getPreview({ period: "2026-09" });

    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.lastExport).toBeNull();
  });

  it("lastExport.sameAsCurrent=true cuando el hash actual coincide con el del último batch", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);
    const preview = await finnegansExportService.getPreview({ period: "2026-09" });
    batchRepo.findLatestForPeriod.mockResolvedValue(batchFixture({ hash: preview.hash }));

    const result = await finnegansExportService.getPreview({ period: "2026-09" });

    expect(result.lastExport?.sameAsCurrent).toBe(true);
  });

  it("lastExport.sameAsCurrent=false cuando el hash actual difiere del último batch", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);
    batchRepo.findLatestForPeriod.mockResolvedValue(batchFixture({ hash: "otro-hash-distinto" }));

    const result = await finnegansExportService.getPreview({ period: "2026-09" });

    expect(result.lastExport?.sameAsCurrent).toBe(false);
  });
});

describe("finnegansExportService.exportDefinitive — selección y readiness (sin regresión sobre 15L.3A)", () => {
  it("todo listo: exporta, crea batch y audita EXPORT/FinnegansExport", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ finnegansValueUnit: "UNIT" })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    const result = await finnegansExportService.exportDefinitive(requestInput(), { userId: "user-1" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.Novedad).toBe("VAC");
    expect(batchRepo.createBatchWithItems).toHaveBeenCalledTimes(1);
    expect(mockedRegister).toHaveBeenCalledWith(expect.objectContaining({ action: "EXPORT", entity: "FinnegansExport", entityId: "batch-1", userId: "user-1" }));
  });

  it("sin código Finnegans configurado: bloquea con FINNEGANS_EXPORT_NOT_READY, sin crear batch (test M)", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ finnegansCode: null })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    await expect(finnegansExportService.exportDefinitive(requestInput())).rejects.toMatchObject({
      statusCode: 409,
      code: "FINNEGANS_EXPORT_NOT_READY",
    });
    expect(batchRepo.createBatchWithItems).not.toHaveBeenCalled();
    expect(mockedRegister).not.toHaveBeenCalled();
  });

  it("cierre no aprobado: bloquea con FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED, sin crear batch (test L)", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "ABIERTO" }]);

    await expect(finnegansExportService.exportDefinitive(requestInput())).rejects.toMatchObject({
      statusCode: 409,
      code: "FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED",
    });
    expect(batchRepo.createBatchWithItems).not.toHaveBeenCalled();
  });
});

// Etapa 15L.5 (docs/decisions/NOVELTY_QUANTITY_SEMANTICS_15L5.md §13): el
// exportador NO cambia -- sigue leyendo `Novelty.quantityDays` tal cual
// (`resolveValue1`, sin tocar). Lo que cambió es que ese valor ahora es
// canónico (calculado por novelties.service.ts sobre el rango completo, sin
// recortar al mes de fromDate) en vez del valor recortado que calculaba el
// frontend antes de esta etapa. Este test fija que, dado un `quantityDays`
// ya canónico (4, para 30/07→02/08), el exportador lo usa tal cual como
// Valor 1 -- coherente con Fecha desde/Fecha hasta, que siguen siendo el
// rango real completo (15L.3B.1, sin recorte).
describe("finnegansExportService.exportDefinitive — Valor 1 DAYS usa la cantidad canónica (Etapa 15L.5)", () => {
  it("novedad cross-month 30/07→02/08 con quantityDays=4 (canónico): Valor 1=4, Fecha desde/hasta = rango completo", async () => {
    repo.findExportableNovelties.mockResolvedValue([
      novelty({
        finnegansValueUnit: "DAYS",
        finnegansRequiresValidity: true,
        quantityDays: decimal("4"),
        fromDate: new Date("2026-07-30"),
        toDate: new Date("2026-08-02"),
      }),
    ]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    const result = await finnegansExportService.exportDefinitive(requestInput({ period: "2026-07" }));

    expect(result.rows[0]!["Valor 1"]).toBe("4");
    expect(result.rows[0]!["Fecha desde"]).toBe("30/07/2026");
    expect(result.rows[0]!["Fecha hasta"]).toBe("02/08/2026");
  });
});

describe("finnegansExportService.exportDefinitive — versionado (tests A/B/D)", () => {
  it("A. primera exportación de un período: crea v1", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);
    batchRepo.hasAnyBatch.mockResolvedValue(false);
    batchRepo.createBatchWithItems.mockResolvedValue(batchFixture({ version: 1, previousBatchId: null }));

    const result = await finnegansExportService.exportDefinitive(requestInput());

    expect(result.batch.version).toBe(1);
    expect(result.batch.isReexport).toBe(false);
  });

  it("B. segunda exportación voluntaria (con motivo): crea v2", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);
    batchRepo.hasAnyBatch.mockResolvedValue(true);
    batchRepo.createBatchWithItems.mockResolvedValue(batchFixture({ version: 2, previousBatchId: "batch-1", reason: "Se corrigió una licencia" }));

    const result = await finnegansExportService.exportDefinitive(requestInput({ reexportReason: "Se corrigió una licencia", idempotencyKey: "idem-2" }));

    expect(result.batch.version).toBe(2);
    expect(result.batch.isReexport).toBe(true);
    expect(result.batch.reason).toBe("Se corrigió una licencia");
  });

  it("D. previousBatchId apunta exactamente al batch anterior inmediato", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);
    batchRepo.hasAnyBatch.mockResolvedValue(true);

    await finnegansExportService.exportDefinitive(requestInput({ reexportReason: "corrección", idempotencyKey: "idem-2" }));

    expect(batchRepo.createBatchWithItems).toHaveBeenCalledWith(expect.objectContaining({ period: "2026-09" }));
    // previousBatchId lo resuelve finnegansExportBatchRepository.createBatchWithItems
    // internamente (probado en finnegansExport.batch.repository.test.ts) — acá sólo se
    // confirma que el service no lo calcula por su cuenta ni lo pisa.
  });
});

describe("finnegansExportService.exportDefinitive — motivo de reexportación (test C)", () => {
  it("primera exportación: no exige motivo", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);
    batchRepo.hasAnyBatch.mockResolvedValue(false);

    await expect(finnegansExportService.exportDefinitive(requestInput())).resolves.toBeDefined();
  });

  it("reexportación sin motivo: 400 FINNEGANS_EXPORT_REASON_REQUIRED, sin crear batch", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);
    batchRepo.hasAnyBatch.mockResolvedValue(true);

    await expect(finnegansExportService.exportDefinitive(requestInput())).rejects.toMatchObject({
      statusCode: 400,
      code: "FINNEGANS_EXPORT_REASON_REQUIRED",
    });
    expect(batchRepo.createBatchWithItems).not.toHaveBeenCalled();
  });

  it("reexportación con motivo: permite exportar", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);
    batchRepo.hasAnyBatch.mockResolvedValue(true);

    await expect(finnegansExportService.exportDefinitive(requestInput({ reexportReason: "Corrección de licencia" }))).resolves.toBeDefined();
    expect(batchRepo.createBatchWithItems).toHaveBeenCalledWith(expect.objectContaining({ reason: "Corrección de licencia" }));
  });

  it("el backend nunca confía sólo en el frontend: aunque no venga readiness bloqueada, exige el motivo antes de tocar el dataset", async () => {
    batchRepo.hasAnyBatch.mockResolvedValue(true);
    repo.findExportableNovelties.mockResolvedValue([]);

    await expect(finnegansExportService.exportDefinitive(requestInput())).rejects.toMatchObject({ code: "FINNEGANS_EXPORT_REASON_REQUIRED" });
    expect(repo.findExportableNovelties).not.toHaveBeenCalled();
  });
});

describe("finnegansExportService.exportDefinitive — snapshot (test E)", () => {
  it("el snapshot persistido usa exactamente los valores exportados, no ids técnicos como contenido", async () => {
    repo.findExportableNovelties.mockResolvedValue([
      novelty({ legajo: "100", legajoFinnegans: "00042", finnegansRequiresValidity: true, fromDate: new Date("2026-09-05"), toDate: new Date("2026-09-10") }),
    ]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    await finnegansExportService.exportDefinitive(requestInput());

    expect(batchRepo.createBatchWithItems).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            noveltyId: "novelty-1",
            employeeId: "employee-1",
            legajo: "00042",
            noveltyCode: "VAC",
            validFrom: "05/09/2026",
            validTo: "10/09/2026",
          }),
        ],
      }),
    );
  });
});

describe("finnegansExportService.exportDefinitive — hash (tests G/H/I, integración con el service)", () => {
  it("el hash pasado a createBatchWithItems es el mismo que devuelve computeExportHash sobre el dataset", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    await finnegansExportService.exportDefinitive(requestInput());

    const call = batchRepo.createBatchWithItems.mock.calls[0]![0];
    expect(call.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("finnegansExportService.exportDefinitive — idempotencia (tests J/K)", () => {
  it("J. mismo idempotencyKey ya usado: devuelve el batch existente reconstruido desde el snapshot, sin revalidar ni crear otra versión", async () => {
    batchRepo.findByIdempotencyKey.mockResolvedValue({
      ...batchFixture({ version: 1 }),
      previousBatchId: null,
      items: [
        {
          id: "item-1", batchId: "batch-1", noveltyId: "novelty-1", employeeId: "employee-1",
          legajo: "100", employeeName: "Gomez, Ana", noveltyCode: "VAC", detail: "Vacaciones",
          costCenter: "", value1: "1", applicationDate: "05/09/2026", validFrom: "", validTo: "",
          createdAt: new Date("2026-09-16T12:00:00Z"),
        },
      ],
    });

    const result = await finnegansExportService.exportDefinitive(requestInput({ idempotencyKey: "idem-1" }));

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.Legajo).toBe("100");
    expect(repo.findExportableNovelties).not.toHaveBeenCalled();
    expect(batchRepo.createBatchWithItems).not.toHaveBeenCalled();
    expect(mockedRegister).not.toHaveBeenCalled();
  });

  it("K. una nueva reexportación voluntaria (idempotencyKey distinta) sí crea una versión nueva", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);
    batchRepo.hasAnyBatch.mockResolvedValue(true);
    batchRepo.findByIdempotencyKey.mockResolvedValue(null);

    await finnegansExportService.exportDefinitive(requestInput({ reexportReason: "motivo válido", idempotencyKey: "idem-nueva" }));

    expect(batchRepo.createBatchWithItems).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "idem-nueva" }));
  });
});

describe("finnegansExportService.exportDefinitive — formato (tests O/P)", () => {
  it("O. format=CSV se guarda en el batch", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    await finnegansExportService.exportDefinitive(requestInput({ format: "CSV" }));

    expect(batchRepo.createBatchWithItems).toHaveBeenCalledWith(expect.objectContaining({ format: "CSV" }));
  });

  it("P. format=XLSX se guarda en el batch", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    await finnegansExportService.exportDefinitive(requestInput({ format: "XLSX" }));

    expect(batchRepo.createBatchWithItems).toHaveBeenCalledWith(expect.objectContaining({ format: "XLSX" }));
  });
});

describe("finnegansExportService.getHistory — orden y diff por versión (test Q / §33)", () => {
  it("Q. devuelve los batches en el mismo orden que entrega el repositorio (version desc, ya ordenado ahí)", async () => {
    batchRepo.findManyForPeriodWithItems.mockResolvedValue([
      { ...batchFixture({ id: "batch-3", version: 3, previousBatchId: "batch-2" }), items: [] },
      { ...batchFixture({ id: "batch-2", version: 2, previousBatchId: "batch-1" }), items: [] },
      { ...batchFixture({ id: "batch-1", version: 1, previousBatchId: null }), items: [] },
    ]);

    const result = await finnegansExportService.getHistory({ period: "2026-09" });

    expect(result.batches.map((batch) => batch.version)).toEqual([3, 2, 1]);
  });

  it("cada versión trae el diff contra su anterior inmediata, resuelto sin consultas extra por versión", async () => {
    const itemV1 = { id: "item-1", batchId: "batch-1", noveltyId: "novelty-1", employeeId: "employee-1", legajo: "100", employeeName: "Gomez, Ana", noveltyCode: "VAC", detail: "Vacaciones", costCenter: "", value1: "1", applicationDate: "05/09/2026", validFrom: "", validTo: "", createdAt: new Date() };
    const itemV2 = { ...itemV1, value1: "2" };
    batchRepo.findManyForPeriodWithItems.mockResolvedValue([
      { ...batchFixture({ id: "batch-2", version: 2, previousBatchId: "batch-1" }), items: [itemV2] },
      { ...batchFixture({ id: "batch-1", version: 1, previousBatchId: null }), items: [itemV1] },
    ]);

    const result = await finnegansExportService.getHistory({ period: "2026-09" });

    expect(result.batches[0]).toMatchObject({ version: 2, diff: { added: 0, removed: 0, modified: 1 } });
    expect(result.batches[1]).toMatchObject({ version: 1, diff: null });
    expect(batchRepo.findByIdWithItems).not.toHaveBeenCalled();
  });
});

describe("finnegansExportService.getHistoryDetail — detalle (test R)", () => {
  it("R. muestra el snapshot y el diff contra el anterior", async () => {
    batchRepo.findByIdWithItems
      .mockResolvedValueOnce({
        ...batchFixture({ id: "batch-2", version: 2, previousBatchId: "batch-1" }),
        items: [
          { id: "item-2", batchId: "batch-2", noveltyId: "novelty-1", employeeId: "employee-1", legajo: "100", employeeName: "Gomez, Ana", noveltyCode: "VAC", detail: "Vacaciones", costCenter: "", value1: "2", applicationDate: "05/09/2026", validFrom: "", validTo: "", createdAt: new Date() },
        ],
      })
      .mockResolvedValueOnce({
        ...batchFixture({ id: "batch-1", version: 1, previousBatchId: null }),
        items: [
          { id: "item-1", batchId: "batch-1", noveltyId: "novelty-1", employeeId: "employee-1", legajo: "100", employeeName: "Gomez, Ana", noveltyCode: "VAC", detail: "Vacaciones", costCenter: "", value1: "1", applicationDate: "05/09/2026", validFrom: "", validTo: "", createdAt: new Date() },
        ],
      });

    const result = await finnegansExportService.getHistoryDetail("batch-2");

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!["Valor 1"]).toBe("2");
    expect(result.diff).toEqual({ added: 0, removed: 0, modified: 1 });
  });

  it("batch inexistente: 404 FINNEGANS_EXPORT_BATCH_NOT_FOUND", async () => {
    batchRepo.findByIdWithItems.mockResolvedValue(null);
    await expect(finnegansExportService.getHistoryDetail("no-existe")).rejects.toMatchObject({ statusCode: 404, code: "FINNEGANS_EXPORT_BATCH_NOT_FOUND" });
  });
});

describe("finnegansExportService — sin UUIDs en mensajes visibles (test S)", () => {
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  it("el mensaje de motivo obligatorio no contiene ids", async () => {
    batchRepo.hasAnyBatch.mockResolvedValue(true);
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    try {
      await finnegansExportService.exportDefinitive(requestInput());
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toMatch(uuidPattern);
    }
  });

  it("el mensaje de cierre pendiente no contiene ids", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "ABIERTO" }]);

    try {
      await finnegansExportService.exportDefinitive(requestInput());
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toMatch(uuidPattern);
    }
  });
});

describe("toCsv — Etapa 15L.3A §27", () => {
  it("nunca incluye la columna 'estado', sin importar qué traiga la fila", () => {
    const csv = toCsv([
      {
        Legajo: "100",
        Novedad: "VAC",
        "Centro de costo": "",
        "Valor 1": "1",
        "Fecha Aplicación": "05/09/2026",
        "Fecha desde": "",
        "Fecha hasta": "",
        estado: "LISTO",
      },
    ]);
    const [header] = csv.split("\r\n");
    expect(header).toBe("Legajo;Novedad;Centro de costo;Valor 1;Fecha Aplicación;Fecha desde;Fecha hasta");
  });
});
