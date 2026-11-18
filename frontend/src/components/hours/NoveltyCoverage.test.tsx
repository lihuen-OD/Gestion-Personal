import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { noveltyApiService, type NoveltyCoverageDayDetail } from "../../services/api/noveltyApiService";
import { ApiError } from "../../services/api/apiClient";
import type { NoveltyCoverageItem } from "../../types/workedTimeAccounting.types";
import { NoveltyCoverageChipList, NoveltyCoverageCompactList, NoveltyCoverageResolutionModal } from "./NoveltyCoverage";

vi.mock("../../services/api/noveltyApiService", () => ({
  noveltyApiService: { getCoverage: vi.fn(), resolveCoverageDay: vi.fn() },
}));

const item = (overrides: Partial<NoveltyCoverageItem> = {}): NoveltyCoverageItem => ({
  noveltyId: "novelty-1",
  noveltyTypeId: "type-1",
  code: "VAC",
  label: "Vacaciones",
  uiColor: "teal",
  minutes: 480,
  settlementMinutes: 960,
  state: "REVIEW_REQUIRED",
  countsTowardTotal: true,
  reviewRequired: true,
  reviewReasons: ["SCHEDULE_UNRESOLVED"],
  ...overrides,
});

const day = (overrides: Partial<NoveltyCoverageDayDetail> = {}): NoveltyCoverageDayDetail => ({
  date: "2026-11-16",
  outcome: "SCHEDULE_UNRESOLVED",
  scheduleReviewReason: "SCHEDULE_MISSING",
  reviewStatus: "PENDING",
  label: "Jornada sin resolver",
  expectedMinutes: null,
  baseMinutes: 0,
  resolution: null,
  resolvedBaseMinutes: null,
  effectiveBaseMinutes: 0,
  multiplier: 2,
  computedMinutes: 0,
  countsTowardTotal: true,
  ...overrides,
});

type CoverageTypeFixture = { coverageMode: "NONE" | "FIXED_MINUTES" | "MANUAL_MINUTES" | "EXPECTED_SCHEDULE"; coverageFixedMinutes: number | null };
const BY_SCHEDULE: CoverageTypeFixture = { coverageMode: "EXPECTED_SCHEDULE", coverageFixedMinutes: null };
const FIXED_8H: CoverageTypeFixture = { coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480 };

function coverageResponse(coverageDay: NoveltyCoverageDayDetail, type: CoverageTypeFixture = BY_SCHEDULE, canAdjust = true) {
  return {
    canAdjust,
    novelty: { id: "novelty-1", status: "APROBADO" as const, fromDate: "2026-11-16", noveltyType: { code: "VAC", name: "Vacaciones", ...type } },
    days: [coverageDay],
    totals: { days: 1, coveredDays: 0, pendingReviewDays: 1, baseMinutes: 0, computedMinutes: 0 },
  };
}

function renderModal(targetItem = item(), callbacks: { close?: () => void; onResolved?: () => void } = {}, computableMinutes?: number) {
  return render(<MemoryRouter><NoveltyCoverageResolutionModal target={{ item: targetItem, date: "2026-11-16", employeeId: "employee-1", period: "2026-11", workedMinutes: 240, computableMinutes }} close={callbacks.close ?? vi.fn()} onResolved={callbacks.onResolved ?? vi.fn()} /></MemoryRouter>);
}

const counted = (overrides: Partial<NoveltyCoverageItem> = {}) => item({ state: "COUNTED", reviewRequired: false, reviewReasons: [], ...overrides });

describe("NoveltyCoverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(noveltyApiService.resolveCoverageDay).mockResolvedValue(day({ reviewStatus: "RESOLVED" }));
  });

  it("diferencia COUNTED, PENDING_APPROVAL, INFORMATIVE y REVIEW_REQUIRED con texto además del color", () => {
    render(<NoveltyCoverageChipList items={[
      item({ noveltyId: "1", state: "COUNTED", reviewRequired: false, reviewReasons: [] }),
      item({ noveltyId: "2", state: "PENDING_APPROVAL", reviewRequired: false, reviewReasons: [] }),
      item({ noveltyId: "3", state: "INFORMATIVE", reviewRequired: false, reviewReasons: [], countsTowardTotal: false }),
      item({ noveltyId: "4", state: "REVIEW_REQUIRED" }),
    ]} />);
    expect(screen.getByLabelText(/Suma al total computable/)).toBeInTheDocument();
    expect(screen.getByLabelText(/No suma hasta su aprobación/)).toHaveClass("is-pending-approval");
    expect(screen.getByLabelText(/Visible, no suma/)).toHaveClass("is-informative");
    expect(screen.getByLabelText(/No suma hasta resolver la revisión/)).toHaveClass("is-review-required");
  });

  it("resume una celda densa con nombre, duración, estado y +N sin botones anidados", () => {
    const { container } = render(<NoveltyCoverageCompactList items={[
      item({ noveltyId: "1", state: "COUNTED", reviewRequired: false, reviewReasons: [] }),
      item({ noveltyId: "2", label: "Enfermedad", state: "PENDING_APPROVAL", reviewRequired: false, reviewReasons: [] }),
      item({ noveltyId: "3", label: "Llegada tarde", state: "INFORMATIVE", reviewRequired: false, reviewReasons: [] }),
    ]} />);
    expect(screen.getByText("Vacaciones")).toBeInTheDocument();
    expect(screen.getByText("Computa")).toBeInTheDocument();
    expect(screen.getByText("+2")).toHaveAttribute("title", "2 novedad(es) más");
    expect(container.querySelector("button")).not.toBeInTheDocument();
  });

  it("jornada sin resolver permite confirmar cero o indicar HH:mm, previsualiza el multiplicador y exige nota", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day()));
    const user = userEvent.setup();
    renderModal();
    expect(await screen.findByText("Confirmar 0 h de cobertura")).toBeInTheDocument();
    await user.click(screen.getByText("Indicar horas del día"));
    // Jornada desconocida: sin tope propio.
    expect(screen.getByText("La jornada de ese día no se pudo determinar.")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("08:00"), { target: { value: "04:00" } });
    expect(screen.getByText(/4 h × 2 = 8 h para liquidación/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar resolución" }));
    expect(screen.getByRole("alert")).toHaveTextContent("nota de al menos 5 caracteres");
    await user.type(screen.getByLabelText("Nota obligatoria"), "Turno confirmado por supervisión");
    await user.click(screen.getByRole("button", { name: "Guardar resolución" }));
    await waitFor(() => expect(noveltyApiService.resolveCoverageDay).toHaveBeenCalledWith("novelty-1", "2026-11-16", expect.objectContaining({ resolution: "SET_BASE_MINUTES", baseMinutes: 240, note: "Turno confirmado por supervisión" })));
  });

  // §17 a §19: cualquier día calculado se abre; el ajuste va de 0 al máximo del tipo.
  it("DETAIL: un día que computa (8 h fijas) muestra el detalle y admite un ajuste parcial hasta 8 h, con nota", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day({ outcome: "COVERED", label: "Cubre", reviewStatus: "NOT_REQUIRED", scheduleReviewReason: null, expectedMinutes: 510, baseMinutes: 480, effectiveBaseMinutes: 480, multiplier: 1, computedMinutes: 480 }), FIXED_8H));
    const user = userEvent.setup();
    renderModal(counted(), {}, 480);
    expect(await screen.findByRole("dialog", { name: /Detalle de Vacaciones/ })).toBeInTheDocument();
    expect(screen.getByText("8 h fijas por día")).toBeInTheDocument();
    expect(screen.getByText("Computable del día")).toBeInTheDocument();
    expect(screen.getByText(/Cubre · Suma al total computable/)).toBeInTheDocument();
    expect(screen.getByText("Ajuste excepcional del día")).toBeInTheDocument();
    expect(screen.queryByText(/Por qué requiere revisión/)).not.toBeInTheDocument();
    expect(screen.getByText("Confirmar 0 h de cobertura")).toBeInTheDocument();
    expect(screen.queryByText("Restaurar cálculo automático")).not.toBeInTheDocument();
    await user.click(screen.getByText("Indicar horas del día"));
    expect(screen.getAllByText(/Máximo permitido: 8 h \(valor de la novedad\)/).length).toBeGreaterThan(0);
    // Arranca en la cobertura actual y no deja pasar el máximo.
    const input = screen.getByDisplayValue("08:00");
    expect(input).toHaveAttribute("max", "08:00");
    fireEvent.change(input, { target: { value: "09:00" } });
    await user.type(screen.getByLabelText("Nota obligatoria"), "Se presentó a trabajar a la tarde");
    await user.click(screen.getByRole("button", { name: "Guardar resolución" }));
    expect(screen.getByRole("alert")).toHaveTextContent("no puede superar 8 h");
    expect(noveltyApiService.resolveCoverageDay).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "06:00" } });
    await user.click(screen.getByRole("button", { name: "Guardar resolución" }));
    await waitFor(() => expect(noveltyApiService.resolveCoverageDay).toHaveBeenCalledWith("novelty-1", "2026-11-16", expect.objectContaining({ resolution: "SET_BASE_MINUTES", baseMinutes: 360, note: "Se presentó a trabajar a la tarde" })));
  });

  it("DETAIL: confirmar 0 h sigue disponible en un día que computa", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day({ outcome: "COVERED", reviewStatus: "NOT_REQUIRED", scheduleReviewReason: null, expectedMinutes: 480, baseMinutes: 480, effectiveBaseMinutes: 480 }), FIXED_8H));
    const user = userEvent.setup();
    renderModal(counted());
    await user.click(await screen.findByText("Confirmar 0 h de cobertura"));
    await user.type(screen.getByLabelText("Nota obligatoria"), "No correspondía");
    await user.click(screen.getByRole("button", { name: "Guardar resolución" }));
    await waitFor(() => expect(noveltyApiService.resolveCoverageDay).toHaveBeenCalledWith("novelty-1", "2026-11-16", expect.objectContaining({ resolution: "CONFIRMED_ZERO", baseMinutes: null })));
  });

  it("cantidad fija con la jornada sin resolver: el ajuste tiene el tope del tipo", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day(), FIXED_8H));
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByText("Indicar horas del día"));
    expect(screen.getByDisplayValue("08:00")).toHaveAttribute("max", "08:00");
    await user.type(screen.getByLabelText("Nota obligatoria"), "Tenía que trabajar");
    await user.click(screen.getByRole("button", { name: "Guardar resolución" }));
    await waitFor(() => expect(noveltyApiService.resolveCoverageDay).toHaveBeenCalledWith("novelty-1", "2026-11-16", expect.objectContaining({ resolution: "SET_BASE_MINUTES", baseMinutes: 480 })));
  });

  it("cantidad manual: el máximo es la cantidad cargada", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue({ ...coverageResponse(day({ outcome: "COVERED", reviewStatus: "NOT_REQUIRED", scheduleReviewReason: null, baseMinutes: 90, effectiveBaseMinutes: 90 }), { coverageMode: "MANUAL_MINUTES", coverageFixedMinutes: null }), novelty: { id: "novelty-1", status: "APROBADO" as const, fromDate: "2026-11-16", quantityMinutes: 90, noveltyType: { code: "LLT", name: "Llegada tarde", coverageMode: "MANUAL_MINUTES" as const, coverageFixedMinutes: null } } });
    const user = userEvent.setup();
    renderModal(counted({ minutes: 90 }));
    await user.click(await screen.findByText("Indicar horas del día"));
    expect(screen.getAllByText(/Máximo permitido: 1 h 30 min \(cantidad cargada\)/).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("01:30")).toHaveAttribute("max", "01:30");
  });

  it("un día con resolución manual permite restaurar el cálculo automático", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day({ outcome: "COVERED", reviewStatus: "RESOLVED", resolution: "SET_BASE_MINUTES", resolvedBaseMinutes: 360, baseMinutes: 480, effectiveBaseMinutes: 360 }), FIXED_8H));
    const user = userEvent.setup();
    renderModal(counted({ minutes: 360 }));
    await user.click(await screen.findByText("Restaurar cálculo automático"));
    await user.type(screen.getByLabelText("Nota obligatoria"), "Se cargó por error");
    await user.click(screen.getByRole("button", { name: "Guardar resolución" }));
    await waitFor(() => expect(noveltyApiService.resolveCoverageDay).toHaveBeenCalledWith("novelty-1", "2026-11-16", expect.objectContaining({ resolution: "RESTORE_AUTOMATIC", baseMinutes: null })));
  });

  it("§18: un día automático en 0 (feriado que no cuenta) permite indicar horas hasta el valor configurado; la nota es obligatoria", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day({ outcome: "HOLIDAY_EXCLUDED", label: "Feriado: no cuenta", reviewStatus: "NOT_REQUIRED", scheduleReviewReason: null, expectedMinutes: 0, baseMinutes: 0, effectiveBaseMinutes: 0, multiplier: 1 }), FIXED_8H));
    const user = userEvent.setup();
    renderModal(counted({ minutes: 0 }));
    expect(await screen.findByText("Ajuste excepcional del día")).toBeInTheDocument();
    expect(screen.getByText(/Feriado: no cuenta/)).toBeInTheDocument();
    // Ya está en 0: no se ofrece confirmar 0 ni restaurar (no hay ajuste manual).
    expect(screen.queryByText("Confirmar 0 h de cobertura")).not.toBeInTheDocument();
    expect(screen.queryByText("Restaurar cálculo automático")).not.toBeInTheDocument();
    // Arranca en el máximo del día.
    expect(screen.getByDisplayValue("08:00")).toHaveAttribute("max", "08:00");
    await user.click(screen.getByRole("button", { name: "Guardar resolución" }));
    expect(screen.getByRole("alert")).toHaveTextContent("nota de al menos 5 caracteres");
    expect(noveltyApiService.resolveCoverageDay).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Nota obligatoria"), "Vacaciones acordadas con el feriado");
    await user.click(screen.getByRole("button", { name: "Guardar resolución" }));
    await waitFor(() => expect(noveltyApiService.resolveCoverageDay).toHaveBeenCalledWith("novelty-1", "2026-11-16", expect.objectContaining({ resolution: "SET_BASE_MINUTES", baseMinutes: 480 })));
  });

  it("§18: un ajuste manual muestra su valor y ofrece confirmar 0 h o restaurar el cálculo automático", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day({ outcome: "HOLIDAY_EXCLUDED", label: "Feriado: no cuenta", reviewStatus: "RESOLVED", resolution: "SET_BASE_MINUTES", resolvedBaseMinutes: 300, scheduleReviewReason: null, expectedMinutes: 0, baseMinutes: 0, effectiveBaseMinutes: 300, multiplier: 1, computedMinutes: 300 }), FIXED_8H));
    const user = userEvent.setup();
    renderModal(counted({ minutes: 300 }));
    expect(await screen.findByText("Confirmar 0 h de cobertura")).toBeInTheDocument();
    expect(screen.getByText("Restaurar cálculo automático")).toBeInTheDocument();
    await user.click(screen.getByText("Indicar horas del día"));
    expect(screen.getByDisplayValue("05:00")).toBeInTheDocument();
  });

  it("§18: quien no puede cargar el tipo ve el detalle sin la sección de ajuste", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day({ outcome: "COVERED", reviewStatus: "NOT_REQUIRED", scheduleReviewReason: null, expectedMinutes: 480, baseMinutes: 480, effectiveBaseMinutes: 480 }), FIXED_8H, false));
    renderModal(counted());
    expect(await screen.findByText("8 h fijas por día")).toBeInTheDocument();
    expect(screen.queryByText("Ajuste excepcional del día")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar resolución" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cerrar" }).length).toBeGreaterThan(0);
  });

  it("un chip que computa se abre para ver el detalle", async () => {
    const onReview = vi.fn();
    render(<NoveltyCoverageChipList items={[counted()]} onReview={onReview} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Ver detalle/ }));
    expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ state: "COUNTED" }));
  });

  it("trabajo incompatible sólo permite confirmar cero; no ofrece horas arbitrarias", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day({ outcome: "COVERED", expectedMinutes: 480, baseMinutes: 480, effectiveBaseMinutes: 480 })));
    renderModal(item({ reviewReasons: ["REAL_WORK_ON_INCOMPATIBLE"] }));
    expect(await screen.findByText("Confirmar 0 h de cobertura")).toBeInTheDocument();
    expect(screen.queryByText("Indicar horas del día")).not.toBeInTheDocument();
    expect(screen.getByText(/no puede coexistir con el trabajo registrado/i)).toBeInTheDocument();
  });

  it("P5: coberturas que superan la jornada sólo permiten confirmar cero en una de ellas", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day({ outcome: "COVERED", expectedMinutes: 420, baseMinutes: 420, effectiveBaseMinutes: 420 })));
    renderModal(item({ reviewReasons: ["COVERAGE_TOTAL_EXCEEDS_EXPECTED"] }));
    expect(await screen.findByText("Confirmar 0 h de cobertura")).toBeInTheDocument();
    expect(screen.queryByText("Indicar horas del día")).not.toBeInTheDocument();
    expect(screen.getByText(/superan la jornada esperada/i)).toBeInTheDocument();
  });

  it("NONE/incompatible sin cobertura no ofrece ni horas ni cero y deriva a correcciones", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day({ outcome: "NO_COVERAGE", countsTowardTotal: false }), { coverageMode: "NONE", coverageFixedMinutes: null }));
    renderModal(item({ minutes: 0, countsTowardTotal: false, reviewReasons: ["REAL_WORK_ON_INCOMPATIBLE"] }));
    expect(await screen.findByText(/no admite horas ni confirmación en cero/i)).toBeInTheDocument();
    expect(screen.queryByText("Confirmar 0 h de cobertura")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Corregir horas del legajo" })).toHaveAttribute("href", "/horas/employee-1?period=2026-11");
    expect(screen.getByRole("link", { name: "Gestionar la novedad" })).toHaveAttribute("href", "/novedades");
  });

  it("muestra autor, fecha y nota de una resolución manual previa", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day({ outcome: "COVERED", reviewStatus: "RESOLVED", resolution: "SET_BASE_MINUTES", resolvedBaseMinutes: 120, resolvedBy: "Ana RRHH", resolvedAt: "2026-11-13T15:00:00.000Z", resolutionNote: "Confirmado con el encargado" })));
    renderModal(item({ reviewReasons: ["RESOLUTION_OUTDATED"] }));
    expect(await screen.findByText("Última resolución: 2 h base")).toBeInTheDocument();
    expect(screen.getByText(/Ana RRHH · 13\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByText("Nota: Confirmado con el encargado")).toBeInTheDocument();
  });

  it("si el backend informa que el estado quedó viejo, muestra un mensaje legible y refresca los datos", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day()));
    vi.mocked(noveltyApiService.resolveCoverageDay).mockRejectedValue(new ApiError("Ese día ya no requiere una resolución manual. Actualizá la pantalla.", "NOVELTY_COVERAGE_DAY_NOT_IN_REVIEW", 409));
    const onResolved = vi.fn();
    const user = userEvent.setup();
    renderModal(item(), { onResolved });
    await screen.findByText("Confirmar 0 h de cobertura");
    await user.type(screen.getByLabelText("Nota obligatoria"), "Revisión concurrente");
    await user.click(screen.getByRole("button", { name: "Guardar resolución" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ya no requiere una resolución manual");
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it("expone diálogo accesible, enfoca la primera resolución, atrapa Tab y cierra con Escape", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day()));
    const close = vi.fn();
    const user = userEvent.setup();
    renderModal(item(), { close });
    const firstResolution = await screen.findByRole("radio", { name: /Confirmar 0 h/ });
    await waitFor(() => expect(firstResolution).toHaveFocus());
    expect(screen.getByRole("dialog", { name: /Revisar Vacaciones/ })).toHaveAttribute("aria-modal", "true");
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Guardar resolución" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
