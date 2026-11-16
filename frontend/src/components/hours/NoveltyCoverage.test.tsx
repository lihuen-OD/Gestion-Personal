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

function coverageResponse(coverageDay: NoveltyCoverageDayDetail) {
  return {
    novelty: { id: "novelty-1", status: "APROBADO" as const, fromDate: "2026-11-16", noveltyType: { code: "VAC", name: "Vacaciones" } },
    days: [coverageDay],
    totals: { days: 1, coveredDays: 0, pendingReviewDays: 1, baseMinutes: 0, computedMinutes: 0 },
  };
}

function renderModal(targetItem = item(), callbacks: { close?: () => void; onResolved?: () => void } = {}) {
  return render(<MemoryRouter><NoveltyCoverageResolutionModal target={{ item: targetItem, date: "2026-11-16", employeeId: "employee-1", period: "2026-11", workedMinutes: 240 }} close={callbacks.close ?? vi.fn()} onResolved={callbacks.onResolved ?? vi.fn()} /></MemoryRouter>);
}

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
    await user.click(screen.getByText("Indicar horas base"));
    fireEvent.change(screen.getByDisplayValue("08:00"), { target: { value: "04:00" } });
    expect(screen.getByText(/4 h × 2 = 8 h para liquidación/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar resolución" }));
    expect(screen.getByRole("alert")).toHaveTextContent("nota de al menos 5 caracteres");
    await user.type(screen.getByLabelText("Nota obligatoria"), "Turno confirmado por supervisión");
    await user.click(screen.getByRole("button", { name: "Guardar resolución" }));
    await waitFor(() => expect(noveltyApiService.resolveCoverageDay).toHaveBeenCalledWith("novelty-1", "2026-11-16", expect.objectContaining({ resolution: "SET_BASE_MINUTES", baseMinutes: 240, note: "Turno confirmado por supervisión" })));
  });

  it("trabajo incompatible sólo permite confirmar cero; no ofrece horas arbitrarias", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day({ outcome: "COVERED", expectedMinutes: 480 })));
    renderModal(item({ reviewReasons: ["REAL_WORK_ON_INCOMPATIBLE"] }));
    expect(await screen.findByText("Confirmar 0 h de cobertura")).toBeInTheDocument();
    expect(screen.queryByText("Indicar horas base")).not.toBeInTheDocument();
    expect(screen.getByText(/no puede coexistir con el trabajo registrado/i)).toBeInTheDocument();
  });

  it("NONE/incompatible sin cobertura no ofrece ni horas ni cero y deriva a correcciones", async () => {
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue(coverageResponse(day({ outcome: "NO_COVERAGE", countsTowardTotal: false })));
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
