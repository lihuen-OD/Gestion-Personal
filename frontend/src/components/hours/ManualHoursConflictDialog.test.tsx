import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "../../services/api/apiClient";
import { manualHoursConflictApiService, type ManualHoursConflict } from "../../services/api/manualHoursConflictApiService";
import { ManualHoursConflictDialog } from "./ManualHoursConflictDialog";

vi.mock("../../services/api/manualHoursConflictApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api/manualHoursConflictApiService")>();
  return { ...actual, manualHoursConflictApiService: { list: vi.fn(), resolve: vi.fn() } };
});

// docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md: manual 8 h vs. fichada 6 h 42 min.
const pending: ManualHoursConflict = {
  id: "alert-1",
  employee: { id: "employee-1", legajo: "11", firstName: "Sereno", lastName: "Once" },
  operationalDate: "2026-10-30",
  status: "PENDIENTE",
  decision: null,
  resolvedAt: null,
  resolvedByName: null,
  shift: { id: "shift-1", startAt: "2026-10-30T10:26:00.000Z", endAt: "2026-10-30T17:08:00.000Z", totalMinutes: 402 },
  days: [{ date: "2026-10-30", manualMinutes: 480, manualStatus: "EN_REVISION", clockMinutes: 402, countedMinutes: 480 }],
  manualMinutes: 480,
  clockMinutes: 402,
  differenceMinutes: -78,
};

function renderDialog(conflict = pending, onResolved = vi.fn()) {
  render(<ManualHoursConflictDialog conflict={conflict} close={vi.fn()} onResolved={onResolved} />);
  return { onResolved };
}

beforeEach(() => {
  vi.mocked(manualHoursConflictApiService.resolve).mockReset();
});

describe("ManualHoursConflictDialog", () => {
  it("pendiente: horas cargadas, fichadas, ingreso, salida y diferencia, sin ids ni enums", () => {
    renderDialog();

    expect(screen.getByRole("heading", { name: "Revisión pendiente" })).toBeInTheDocument();
    expect(screen.getByText("Once, Sereno · Legajo 11 · 30/10/2026")).toBeInTheDocument();
    expect(screen.getByText("Se registró una fichada en una jornada que ya tenía horas cargadas manualmente.")).toBeInTheDocument();
    const metrics = document.querySelector(".manual-hours-review-metrics") as HTMLElement;
    expect(metrics).toHaveTextContent("Horas cargadas8 h");
    expect(metrics).toHaveTextContent("Horas fichadas6 h 42 min");
    expect(metrics).toHaveTextContent("Ingreso07:26");
    expect(metrics).toHaveTextContent("Salida14:08");
    expect(metrics).toHaveTextContent("Diferencia−1 h 18 min");
    expect(screen.getByText("Estado de la carga manual: En revisión.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/alert-1|shift-1|employee-1|EN_REVISION|KEEP_MANUAL|USE_CLOCK/);
    expect(screen.getByRole("button", { name: "Mantener carga manual" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Usar horas fichadas" })).toBeEnabled();
  });

  it("mantener la carga manual: una sola llamada aunque se haga doble click, y pasa a resuelta", async () => {
    vi.mocked(manualHoursConflictApiService.resolve).mockResolvedValue({ ...pending, status: "RESUELTA", decision: "KEEP_MANUAL", resolvedByName: "Carga Horaria", resolvedAt: "2026-10-31T12:00:00.000Z" });
    const { onResolved } = renderDialog();

    const keep = screen.getByRole("button", { name: "Mantener carga manual" });
    fireEvent.click(keep);
    fireEvent.click(keep);

    expect(await screen.findByRole("heading", { name: "Revisión resuelta" })).toBeInTheDocument();
    expect(manualHoursConflictApiService.resolve).toHaveBeenCalledTimes(1);
    expect(manualHoursConflictApiService.resolve).toHaveBeenCalledWith("alert-1", "KEEP_MANUAL", undefined);
    expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ decision: "KEEP_MANUAL" }));
    expect(screen.getByRole("status")).toHaveTextContent("Se mantuvo la carga manual. Decidió Carga Horaria el 31/10/2026 · 09:00.");
    expect(screen.queryByRole("button", { name: "Usar horas fichadas" })).toBeNull();
  });

  it("un error del backend se muestra legible dentro del modal y la revisión sigue pendiente", async () => {
    vi.mocked(manualHoursConflictApiService.resolve).mockRejectedValue(new ApiError("Esta revisión ya fue resuelta. Actualizá la pantalla para ver la decisión tomada.", "MANUAL_HOURS_CONFLICT_ALREADY_RESOLVED", 409));
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Usar horas fichadas" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Esta revisión ya fue resuelta. Actualizá la pantalla para ver la decisión tomada.");
    expect(screen.getByRole("heading", { name: "Revisión pendiente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usar horas fichadas" })).toBeEnabled();
  });

  it("período cerrado (RRHH): pide el motivo y lo envía al reintentar", async () => {
    vi.mocked(manualHoursConflictApiService.resolve)
      .mockRejectedValueOnce(new ApiError("El período ya fue enviado o aprobado: indicá el motivo de la corrección.", "MANUAL_HOURS_CORRECTION_REASON_REQUIRED", 400))
      .mockResolvedValueOnce({ ...pending, status: "RESUELTA", decision: "USE_CLOCK" });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Usar horas fichadas" }));
    const reason = await screen.findByLabelText("Motivo de la corrección *");
    fireEvent.click(screen.getByRole("button", { name: "Usar horas fichadas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Indicá el motivo de la corrección.");
    expect(manualHoursConflictApiService.resolve).toHaveBeenCalledTimes(1);

    fireEvent.change(reason, { target: { value: "Se verificó con el encargado" } });
    fireEvent.click(screen.getByRole("button", { name: "Usar horas fichadas" }));

    await waitFor(() => expect(manualHoursConflictApiService.resolve).toHaveBeenLastCalledWith("alert-1", "USE_CLOCK", "Se verificó con el encargado"));
    expect(await screen.findByRole("heading", { name: "Revisión resuelta" })).toBeInTheDocument();
  });

  it("jornada nocturna: una sola revisión con el detalle por fecha", () => {
    renderDialog({
      ...pending,
      operationalDate: "2026-10-20",
      shift: { id: "shift-2", startAt: "2026-10-21T02:00:00.000Z", endAt: "2026-10-21T10:00:00.000Z", totalMinutes: 480 },
      days: [
        { date: "2026-10-20", manualMinutes: 480, manualStatus: "APROBADO", clockMinutes: 60, countedMinutes: 480 },
        { date: "2026-10-21", manualMinutes: null, manualStatus: null, clockMinutes: 420, countedMinutes: 0 },
      ],
      manualMinutes: 480,
      clockMinutes: 480,
      differenceMinutes: 0,
    });

    const rows = Array.from(document.querySelectorAll(".manual-hours-review-days tbody tr")).map((row) => row.textContent);
    expect(rows).toEqual(["20/10/20268 h1 h", "21/10/2026Sin carga manual7 h"]);
    expect(document.querySelector(".manual-hours-review-metrics")).toHaveTextContent("DiferenciaSin diferencia");
  });
});
