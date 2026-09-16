import { beforeEach, describe, expect, it, vi } from "vitest";
import { finnegansExportRepository } from "./finnegansExport.repository";
import { finnegansExportService, toCsv } from "./finnegansExport.service";
import { auditService } from "../audit/audit.service";

vi.mock("./finnegansExport.repository", () => ({
  finnegansExportRepository: {
    findExportableNovelties: vi.fn(),
    findClosuresForExport: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const repo = vi.mocked(finnegansExportRepository, true);
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
  finnegansLinks?: { code: string; priority: number }[];
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
      finnegansLinks: overrides.finnegansLinks === undefined ? [{ code: "VAC", priority: 1 }] : overrides.finnegansLinks,
    },
  } as unknown as Awaited<ReturnType<typeof finnegansExportRepository.findExportableNovelties>>[number];
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.findExportableNovelties.mockResolvedValue([]);
  repo.findClosuresForExport.mockResolvedValue([]);
});

describe("finnegansExportService.getPreview — Etapa 15L.3A", () => {
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

  it("nunca audita — el GET de preview no debe quedar registrado como exportación realizada", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    await finnegansExportService.getPreview({ period: "2026-09" });

    expect(mockedRegister).not.toHaveBeenCalled();
  });
});

describe("finnegansExportService.getDefinitive — selección y readiness (Etapa 15L.3A §34–36)", () => {
  it("todo listo: exporta y audita EXPORT/FinnegansExport", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ finnegansValueUnit: "UNIT" })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    const result = await finnegansExportService.getDefinitive({ period: "2026-09" }, { userId: "user-1" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.Novedad).toBe("VAC");
    expect(mockedRegister).toHaveBeenCalledWith(expect.objectContaining({ action: "EXPORT", entity: "FinnegansExport", userId: "user-1" }));
  });

  it("sin vínculo Finnegans activo: blocker MISSING_LINK, bloquea con FINNEGANS_EXPORT_NOT_READY", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ finnegansLinks: [] })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    await expect(finnegansExportService.getDefinitive({ period: "2026-09" })).rejects.toMatchObject({
      statusCode: 409,
      code: "FINNEGANS_EXPORT_NOT_READY",
    });
    expect(mockedRegister).not.toHaveBeenCalled();
  });

  it("un vínculo secundario nunca genera una segunda fila (una fila por Novelty, siempre)", async () => {
    repo.findExportableNovelties.mockResolvedValue([
      novelty({ finnegansLinks: [{ code: "SEC", priority: 2 }, { code: "VAC", priority: 1 }] }),
    ]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    const result = await finnegansExportService.getDefinitive({ period: "2026-09" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.Novedad).toBe("VAC");
  });

  it.each([
    ["HOURS", { finnegansValueUnit: "HOURS" as const, quantityHours: decimal("5") }, "5"],
    ["DAYS", { finnegansValueUnit: "DAYS" as const, quantityDays: decimal("2") }, "2"],
    ["UNIT", { finnegansValueUnit: "UNIT" as const }, "1"],
  ])("Valor 1 — %s con cantidad correcta: exporta ese valor", async (_label, overrides, expected) => {
    repo.findExportableNovelties.mockResolvedValue([novelty(overrides)]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    const result = await finnegansExportService.getDefinitive({ period: "2026-09" });

    expect(result.rows[0]!["Valor 1"]).toBe(expected);
  });

  it("HOURS sin quantityHours: bloquea (no inventa 0 ni usa quantityDays)", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ finnegansValueUnit: "HOURS", quantityDays: decimal("3") })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    await expect(finnegansExportService.getDefinitive({ period: "2026-09" })).rejects.toMatchObject({ code: "FINNEGANS_EXPORT_NOT_READY" });
  });

  it("DAYS sin quantityDays: bloquea (no inventa 0 ni usa quantityHours)", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ finnegansValueUnit: "DAYS", quantityHours: decimal("7") })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    await expect(finnegansExportService.getDefinitive({ period: "2026-09" })).rejects.toMatchObject({ code: "FINNEGANS_EXPORT_NOT_READY" });
  });

  it("finnegansValueUnit=null: el tipo no está completamente configurado, bloquea", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ finnegansValueUnit: null })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    await expect(finnegansExportService.getDefinitive({ period: "2026-09" })).rejects.toMatchObject({ code: "FINNEGANS_EXPORT_NOT_READY" });
  });

  it("requiresValidity=false: Fecha desde/hasta vacías", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ finnegansRequiresValidity: false })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    const result = await finnegansExportService.getDefinitive({ period: "2026-09" });

    expect(result.rows[0]!["Fecha desde"]).toBe("");
    expect(result.rows[0]!["Fecha hasta"]).toBe("");
  });

  it("requiresValidity=true con toDate: exporta ambas fechas", async () => {
    repo.findExportableNovelties.mockResolvedValue([
      novelty({ finnegansRequiresValidity: true, fromDate: new Date("2026-09-05"), toDate: new Date("2026-09-10") }),
    ]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    const result = await finnegansExportService.getDefinitive({ period: "2026-09" });

    expect(result.rows[0]!["Fecha desde"]).toBe("05/09/2026");
    expect(result.rows[0]!["Fecha hasta"]).toBe("10/09/2026");
  });

  it("requiresValidity=true sin toDate: bloquea en vez de inventar la fecha", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ finnegansRequiresValidity: true, toDate: null })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    await expect(finnegansExportService.getDefinitive({ period: "2026-09" })).rejects.toMatchObject({ code: "FINNEGANS_EXPORT_NOT_READY" });
  });

  it("Legajo: usa legajoFinnegans si existe, como string, preservando ceros a la izquierda", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ legajo: "100", legajoFinnegans: "00042" })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    const result = await finnegansExportService.getDefinitive({ period: "2026-09" });

    expect(result.rows[0]!.Legajo).toBe("00042");
    expect(typeof result.rows[0]!.Legajo).toBe("string");
  });

  it("Legajo: si no hay legajoFinnegans, usa legajo", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ legajo: "100", legajoFinnegans: null })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    const result = await finnegansExportService.getDefinitive({ period: "2026-09" });

    expect(result.rows[0]!.Legajo).toBe("100");
  });

  it("Centro de costo siempre vacío (sin evidencia de una regla distinta, Etapa 15L.3A §14)", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    const result = await finnegansExportService.getDefinitive({ period: "2026-09" });

    expect(result.rows[0]!["Centro de costo"]).toBe("");
  });

  it("Fecha Aplicación = fromDate, sin cambios", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ fromDate: new Date("2026-09-15") })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    const result = await finnegansExportService.getDefinitive({ period: "2026-09" });

    expect(result.rows[0]!["Fecha Aplicación"]).toBe("15/09/2026");
  });
});

describe("finnegansExportService.getDefinitive — gate de cierre mensual (Etapa 15L.3A §37)", () => {
  it("1 empleado exportable + cierre APROBADO: exporta", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    const result = await finnegansExportService.getDefinitive({ period: "2026-09" });
    expect(result.rows).toHaveLength(1);
  });

  it("sin cierre para el empleado: bloquea con FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([]);

    await expect(finnegansExportService.getDefinitive({ period: "2026-09" })).rejects.toMatchObject({
      statusCode: 409,
      code: "FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED",
    });
  });

  it.each(["ABIERTO", "ENVIADO", "DEVUELTO", "CORRECCION_PENDIENTE"] as const)("cierre en estado %s: bloquea", async (status) => {
    repo.findExportableNovelties.mockResolvedValue([novelty()]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status }]);

    await expect(finnegansExportService.getDefinitive({ period: "2026-09" })).rejects.toMatchObject({
      code: "FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED",
    });
  });

  it("2 empleados, uno APROBADO y otro pendiente: bloquea TODO (nunca exportación parcial)", async () => {
    repo.findExportableNovelties.mockResolvedValue([
      novelty({ id: "novelty-1", employeeId: "employee-1" }),
      novelty({ id: "novelty-2", employeeId: "employee-2" }),
    ]);
    repo.findClosuresForExport.mockResolvedValue([
      { employeeId: "employee-1", status: "APROBADO" },
      { employeeId: "employee-2", status: "ENVIADO" },
    ]);

    await expect(finnegansExportService.getDefinitive({ period: "2026-09" })).rejects.toMatchObject({
      code: "FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED",
    });
    expect(mockedRegister).not.toHaveBeenCalled();
  });

  it("empleado con cierre pendiente pero SIN novedad exportable no bloquea (nunca se le consulta cierre)", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ employeeId: "employee-1" })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "APROBADO" }]);

    await finnegansExportService.getDefinitive({ period: "2026-09" });

    expect(repo.findClosuresForExport).toHaveBeenCalledWith(["employee-1"], "2026-09");
  });

  it("sin ninguna fila exportable: definitivo no consulta cierres y no bloquea", async () => {
    repo.findExportableNovelties.mockResolvedValue([]);

    const result = await finnegansExportService.getDefinitive({ period: "2026-09" });

    expect(result.rows).toEqual([]);
    expect(repo.findClosuresForExport).not.toHaveBeenCalled();
  });

  it("cuando hay blocker de datos Y de cierre a la vez, prioriza FINNEGANS_EXPORT_NOT_READY", async () => {
    repo.findExportableNovelties.mockResolvedValue([novelty({ finnegansValueUnit: null })]);
    repo.findClosuresForExport.mockResolvedValue([{ employeeId: "employee-1", status: "ABIERTO" }]);

    await expect(finnegansExportService.getDefinitive({ period: "2026-09" })).rejects.toMatchObject({
      code: "FINNEGANS_EXPORT_NOT_READY",
    });
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
