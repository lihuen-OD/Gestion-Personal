import { describe, expect, it } from "vitest";
import { emptyNoveltyType } from "../components/novelty-types/NoveltyTypeFields";
import type { NoveltyType, NoveltyTypeCoverage } from "../types/noveltyType.types";
import type { NoveltyCoveragePreview, NoveltyCoveragePreviewDay } from "../services/api/noveltyApiService";
import {
  adaptNoveltyLoadValues,
  buildNoveltyCreateInput,
  buildNoveltyPreviewInput,
  initialNoveltyLoadValues,
  noveltyLoadIssues,
  noveltyLoadLayout,
  previewDateLabel,
  previewDayView,
  summarizeNoveltyPreview,
  type NoveltyLoadValues,
} from "./noveltyLoad";

function type(coverage: Partial<NoveltyTypeCoverage> = {}, rules: Partial<NoveltyType["rules"]> = {}): NoveltyType {
  const base = emptyNoveltyType();
  return { ...base, id: "type", name: "Tipo", rules: { ...base.rules, ...rules }, coverage: { ...base.coverage, ...coverage } };
}

const values = (overrides: Partial<NoveltyLoadValues> = {}): NoveltyLoadValues => ({ fromDate: "2026-11-16", toDate: "", duration: "", legacyHours: "", observation: "", file: null, ...overrides });
const fixed = type({ mode: "FIXED_MINUTES", fixedMinutes: 240, onDayOff: "NO_COVERAGE", onHoliday: "NO_COVERAGE", countsTowardTotal: true }, { allowsDateRange: false });
const manual = type({ mode: "MANUAL_MINUTES" }, { allowsDateRange: false, allowsHours: true });
const expected = type({ mode: "EXPECTED_SCHEDULE", dayRule: "WORK_OBLIGATION", countsTowardTotal: true });

describe("noveltyLoadLayout — el Tipo decide qué se pide", () => {
  it("cantidad indicada al cargar usa sólo la duración, nunca el campo heredado", () => {
    expect(noveltyLoadLayout(manual)).toMatchObject({ quantity: "MANUAL", legacyHours: false, dateMode: "single" });
  });
  it("otro modo con allowsHours muestra la cantidad heredada como informativa", () => {
    expect(noveltyLoadLayout(type({}, { allowsHours: true }))).toMatchObject({ quantity: "NONE", legacyHours: true });
  });
  it("cantidad fija y jornada no piden cantidad", () => {
    expect(noveltyLoadLayout(fixed)).toMatchObject({ quantity: "FIXED", fixedMinutes: 240, legacyHours: false });
    expect(noveltyLoadLayout(expected)).toMatchObject({ quantity: "EXPECTED", dateMode: "range" });
  });
});

describe("payload de alta", () => {
  it("FIXED: sin cantidad y sin fecha hasta", () => {
    expect(buildNoveltyCreateInput(fixed, values({ toDate: "2026-11-20" }), ["e1"])).toMatchObject({ toDate: null, quantityHours: null, quantityDays: null });
  });
  it("MANUAL: la duración HH:mm viaja como horas (el backend deriva quantityMinutes)", () => {
    expect(buildNoveltyCreateInput(manual, values({ duration: "01:30" }), ["e1"])).toMatchObject({ quantityHours: 1.5, toDate: null });
  });
  it("NONE: sin cantidad; con registro heredado, la cantidad informativa", () => {
    expect(buildNoveltyCreateInput(type(), values({ legacyHours: "3" }), ["e1"]).quantityHours).toBeNull();
    expect(buildNoveltyCreateInput(type({}, { allowsHours: true }), values({ legacyHours: "2,5" }), ["e1"]).quantityHours).toBe(2.5);
    expect(buildNoveltyCreateInput(type({}, { allowsHours: true }), values(), ["e1"]).quantityHours).toBeNull();
  });
  it("rango: Hasta vacío es un solo día (null); con valor, se envía", () => {
    expect(buildNoveltyCreateInput(expected, values(), ["e1"]).toDate).toBeNull();
    expect(buildNoveltyCreateInput(expected, values({ toDate: "2026-11-22" }), ["e1"]).toDate).toBe("2026-11-22");
  });
  it("la observación se envía recortada o null; el motivo de corrección sólo si existe", () => {
    expect(buildNoveltyCreateInput(fixed, values({ observation: "  hola " }), ["e1"])).toMatchObject({ observation: "hola" });
    expect(buildNoveltyCreateInput(fixed, values(), ["e1"])).not.toHaveProperty("correctionReason");
    expect(buildNoveltyCreateInput(fixed, values(), ["e1"], { correctionReason: " motivo " })).toMatchObject({ correctionReason: "motivo" });
  });
});

describe("datos faltantes", () => {
  const fields = (t: NoveltyType | undefined, v: NoveltyLoadValues, count = 1) => noveltyLoadIssues(t, v, count).map((issue) => issue.field);
  it("persona, duración manual, hasta anterior, observación y documentación obligatorias", () => {
    expect(fields(fixed, values(), 0)).toEqual(["employees"]);
    expect(fields(manual, values({ duration: "25:00" }))).toEqual(["duration"]);
    expect(fields(expected, values({ toDate: "2026-11-01" }))).toEqual(["toDate"]);
    expect(fields(type({}, { requiresObservation: true, requiresDocumentation: true }), values())).toEqual(["observation", "file"]);
    expect(fields(type({}, { requiresDocumentation: true }), values({ file: new File(["x"], "a.exe", { type: "application/x-msdownload" }) }))).toEqual(["file"]);
  });
  it("vigencia exigida por el tipo: Hasta obligatoria", () => {
    expect(fields(type({}, { finnegansRequiresValidity: true }), values())).toEqual(["toDate"]);
  });
});

describe("vista previa: pedido y adaptación", () => {
  it("sólo se pide con datos suficientes", () => {
    expect(buildNoveltyPreviewInput(manual, values(), ["e1"])).toBeNull();
    expect(buildNoveltyPreviewInput(manual, values({ duration: "01:00" }), ["e1"])).toEqual({ employeeIds: ["e1"], noveltyTypeId: "type", fromDate: "2026-11-16", toDate: null, quantityHours: 1 });
    expect(buildNoveltyPreviewInput(expected, values({ toDate: "2026-11-01" }), ["e1"])).toBeNull();
    expect(buildNoveltyPreviewInput(fixed, values(), [])).toBeNull();
    expect(buildNoveltyPreviewInput(fixed, values(), Array.from({ length: 51 }, (_, index) => `e${index}`))).toBeNull();
  });
  it("cambiar de tipo limpia lo que el nuevo no usa", () => {
    const filled = values({ toDate: "2026-11-20", duration: "01:00", legacyHours: "2", file: new File(["x"], "a.pdf", { type: "application/pdf" }) });
    expect(adaptNoveltyLoadValues(filled, fixed)).toMatchObject({ toDate: "", duration: "", legacyHours: "", file: null });
    expect(adaptNoveltyLoadValues(filled, expected)).toMatchObject({ toDate: "2026-11-20", duration: "" });
  });
  it("una cantidad sugerida va al único campo de horas del tipo", () => {
    expect(initialNoveltyLoadValues(manual, { fromDate: "2026-11-16", quantityHours: 1.5 }).duration).toBe("01:30");
    expect(initialNoveltyLoadValues(type({}, { allowsHours: true }), { fromDate: "2026-11-16", quantityHours: 2 }).legacyHours).toBe("2");
    expect(initialNoveltyLoadValues(fixed, { fromDate: "2026-11-16", quantityHours: 2 })).toMatchObject({ duration: "", legacyHours: "" });
  });
});

describe("vista previa: traducción y resumen (sin recalcular reglas)", () => {
  const day = (overrides: Partial<NoveltyCoveragePreviewDay> = {}): NoveltyCoveragePreviewDay => ({
    date: "2026-11-22", outcome: "COVERED", scheduleReviewReason: null, reviewStatus: "NOT_REQUIRED", label: "Cubre", expectedMinutes: 480, baseMinutes: 480,
    resolution: null, resolvedBaseMinutes: null, effectiveBaseMinutes: 480, multiplier: 2, computedMinutes: 960, countsTowardTotal: true,
    workedMinutes: 0, stateWhenApproved: "COUNTED", reviewReasons: [], ...overrides,
  });

  it("fechas en castellano", () => {
    expect(previewDateLabel("2026-11-22")).toBe("Domingo 22/11");
    expect(previewDateLabel("2026-11-16")).toBe("Lunes 16/11");
  });

  it("estados en lenguaje de negocio, nunca enums", () => {
    expect(previewDayView(day({ outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "SHIFT_ASSIGNMENTS_OVERLAP", baseMinutes: 0, effectiveBaseMinutes: 0, stateWhenApproved: "REVIEW_REQUIRED", reviewReasons: ["SCHEDULE_UNRESOLVED"] })))
      .toMatchObject({ title: "Requiere revisión", detail: "La persona tiene turnos superpuestos ese día.", provisional: true, tone: "review" });
    expect(previewDayView(day({ outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "EMPLOYMENT_HISTORY_UNRESOLVED", baseMinutes: 0, effectiveBaseMinutes: 0, stateWhenApproved: "REVIEW_REQUIRED" })).detail)
      .toBe("Falta registrar la fecha de alta del legajo.");
    expect(previewDayView(day({ outcome: "OUTSIDE_EMPLOYMENT", baseMinutes: 0, effectiveBaseMinutes: 0 })).title).toBe("Fuera de la relación laboral");
    const conflict = previewDayView(day({ stateWhenApproved: "REVIEW_REQUIRED", reviewReasons: ["REAL_WORK_ON_INCOMPATIBLE"], workedMinutes: 300 }));
    expect(conflict.title).toBe("Cubre · Requiere revisión");
    expect(conflict.messages[0]).toMatch(/no puede coexistir con horas trabajadas/);
  });

  it("liquidación sólo cuando suma; informativa sin liquidación", () => {
    expect(previewDayView(day())).toMatchObject({ baseMinutes: 480, multiplier: 2, settlementMinutes: 960 });
    expect(previewDayView(day({ countsTowardTotal: false, stateWhenApproved: "INFORMATIVE", multiplier: 1, computedMinutes: 60, baseMinutes: 60, effectiveBaseMinutes: 60 }))).toMatchObject({ informative: true, settlementMinutes: null });
  });

  it("el resumen suma sólo lo que el backend calculó, por estado", () => {
    const preview: NoveltyCoveragePreview = {
      noveltyType: { id: "t", code: "V", name: "V" },
      initialStatus: "PENDIENTE",
      employees: [{ employee: { id: "e", legajo: "1", firstName: "A", lastName: "B" }, totals: { days: 3, coveredDays: 2, pendingReviewDays: 0, baseMinutes: 0, computedMinutes: 0 }, days: [
        day({ date: "2026-11-16", multiplier: 1, computedMinutes: 480 }),
        day(),
        day({ date: "2026-11-23", outcome: "SCHEDULE_UNRESOLVED", baseMinutes: 0, effectiveBaseMinutes: 0, computedMinutes: 0, stateWhenApproved: "REVIEW_REQUIRED", reviewReasons: ["SCHEDULE_UNRESOLVED"] }),
      ] }],
    };
    expect(summarizeNoveltyPreview(preview)).toEqual({ days: 3, coveredMinutes: 960, computableMinutes: 960, settlementMinutes: 1440, informativeMinutes: 0, reviewDays: 1, conflictDays: 0 });
  });
});

describe("límite de personas por alta (ADR §15.1)", () => {
  const employees = (t: NoveltyType, v: NoveltyLoadValues, count: number) => noveltyLoadIssues(t, v, count).filter((issue) => issue.field === "employees").map((issue) => issue.message);
  const pdf = new File(["x"], "c.pdf", { type: "application/pdf" });
  const conCertificado = type({}, { requiresDocumentation: true });

  it("con documento: hasta 25 personas; 26 explica el motivo", () => {
    expect(employees(conCertificado, values({ file: pdf }), 25)).toEqual([]);
    expect(employees(conCertificado, values({ file: pdf }), 26)).toEqual(["Con documentación podés cargar la novedad para hasta 25 personas por vez. Dividí la carga en grupos más pequeños."]);
    // Aunque todavía no se haya elegido el archivo, un tipo que lo exige ya aplica el límite.
    expect(employees(conCertificado, values(), 26)).toHaveLength(1);
  });

  it("sin documento: se conserva el máximo de 250", () => {
    expect(employees(fixed, values(), 250)).toEqual([]);
    expect(employees(fixed, values(), 251)).toEqual(["Podés cargar la novedad para hasta 250 personas por vez."]);
  });
});
