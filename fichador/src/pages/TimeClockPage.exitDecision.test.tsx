import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ExitDecisionDialog } from "../features/clock/ExitDecisionDialog";
import userEvent from "@testing-library/user-event";
import { TimeClockPage } from "./TimeClockPage";
import { timeClockApiService } from "../services/api/timeClockApiService";
import { ApiError } from "../services/api/apiClient";
import { EXIT_DECISION_IDLE_MS } from "../features/clock/ExitDecisionDialog";

/**
 * R4.4 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.6): SALIDA dudosa en el
 * fichador. El backend no registró nada y devuelve una guía; la persona elige
 * ENTRADA al turno siguiente (recomendado) o confirma la SALIDA. Cada elección
 * es una fichada nueva (otro requestId) con la misma foto.
 */
vi.mock("../services/api/timeClockApiService", () => ({
  timeClockApiService: { searchEmployees: vi.fn(), status: vi.fn(), photoPunch: vi.fn(), attemptStatus: vi.fn() },
}));

vi.mock("../components/time-clock/FaceCaptureModal", () => ({
  FaceCaptureModal: ({ onConfirm }: { onConfirm: (capture: unknown) => void }) => (
    <div data-testid="face-capture-modal">
      <button onClick={() => onConfirm({ photo: "data:image/jpeg;base64,FOTO", thumbnail: "data:image/jpeg;base64,MINI", faceValidationStatus: "VALID", faceDetectionScore: 0.94, device: { userAgent: "test" } })}>
        Confirmar captura
      </button>
    </div>
  ),
}));

const ANA = { id: "employee-1", dni: "30123456", firstName: "Ana", lastName: "Gomez", name: "Gomez, Ana" };
const OPEN_SINCE = new Date(Date.now() - 12 * 60 * 60_000);
const GUIDANCE = {
  kind: "EXIT_CONFIRMATION_REQUIRED" as const,
  openShiftId: "shift-0700",
  openShiftStartAt: "2026-11-06T10:00:00.000Z",
  previousBlock: { startAt: "2026-11-06T10:00:00.000Z", endAt: "2026-11-06T14:00:00.000Z" },
  nextBlock: { key: "employee-1|2026-11-06T22:00:00.000Z", startAt: "2026-11-06T22:00:00.000Z" },
  exitAt: "2026-11-06T22:02:00.000Z",
  exitDurationMinutes: 722,
};
const confirmationRequired = () => new ApiError("Tu turno anterior terminó a las 11:00…", "CLOCK_EXIT_CONFIRMATION_REQUIRED", 409, undefined, GUIDANCE);

async function startExit() {
  const user = userEvent.setup();
  render(<TimeClockPage />);
  await user.type(screen.getByLabelText("Buscar por nombre, apellido o DNI"), "Gomez");
  await user.click(await screen.findByRole("button", { name: /Gomez, Ana/ }));
  await user.click(await screen.findByRole("button", { name: /Marcar salida/i }));
  await user.click(await screen.findByRole("button", { name: /Confirmar captura/i }));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  vi.mocked(timeClockApiService.searchEmployees).mockResolvedValue([ANA]);
  vi.mocked(timeClockApiService.status).mockResolvedValue({ employee: ANA, openShift: { id: "shift-0700", startAt: OPEN_SINCE.toISOString() } });
});

describe("TimeClockPage — salida dudosa (R4.4)", () => {
  it("muestra la pregunta en lenguaje claro, sin códigos ni ids, con ENTRADA recomendada y enfocada", async () => {
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValueOnce(confirmationRequired());
    await startExit();
    const dialog = await screen.findByRole("dialog", { name: "¿Estás ingresando a tu turno de las 19:00?" });
    expect(dialog).toHaveTextContent("Tu turno anterior terminó a las 11:00 y ahora tenés otro turno programado a las 19:00.");
    expect(dialog).toHaveTextContent("Tu jornada quedará de 07:00 a 19:02 (12 h 02 min).");
    expect(dialog).not.toHaveTextContent(/CLOCK_|shift-0700|employee-1/);
    expect(screen.getByRole("button", { name: /Registrar ENTRADA/ })).toHaveFocus();
    expect(screen.queryByText(/Salida registrada/)).not.toBeInTheDocument();
  });

  it("«Registrar ENTRADA»: envía un INGRESO nuevo (otro requestId) con la misma foto y muestra el resultado", async () => {
    vi.mocked(timeClockApiService.photoPunch)
      .mockRejectedValueOnce(confirmationRequired())
      .mockResolvedValueOnce({ employee: ANA, previousOpenShift: { id: "shift-0700", startAt: OPEN_SINCE.toISOString(), status: "FALTA_SALIDA" }, workShift: { id: "shift-1900", startAt: new Date().toISOString() } });
    const user = await startExit();
    await user.click(await screen.findByRole("button", { name: /Registrar ENTRADA/ }));
    expect(await screen.findByText(/Entrada registrada/i)).toBeInTheDocument();
    expect(screen.getByText(/quedó marcado como olvido de salida/)).toBeInTheDocument();
    const [first, second] = vi.mocked(timeClockApiService.photoPunch).mock.calls.map(([input]) => input);
    expect(second).toMatchObject({ punchType: "IN", photo: first!.photo, thumbnail: first!.thumbnail });
    expect(second!.requestId).not.toBe(first!.requestId);
    expect(second).not.toHaveProperty("exitConfirmation");
  });

  it("«Confirmar SALIDA anterior»: reenvía la SALIDA ligada a esa jornada y ese turno siguiente", async () => {
    vi.mocked(timeClockApiService.photoPunch)
      .mockRejectedValueOnce(confirmationRequired())
      .mockResolvedValueOnce({ employee: ANA, workShift: { id: "shift-0700", startAt: OPEN_SINCE.toISOString(), endAt: new Date().toISOString(), totalMinutes: 722, totalHours: 12.03 }, segments: [] });
    const user = await startExit();
    await user.click(await screen.findByRole("button", { name: /Confirmar SALIDA anterior/ }));
    expect(await screen.findByText(/Salida registrada/i)).toBeInTheDocument();
    const second = vi.mocked(timeClockApiService.photoPunch).mock.calls[1]![0];
    expect(second).toMatchObject({ punchType: "OUT", exitConfirmation: { openShiftId: "shift-0700", nextBlockKey: GUIDANCE.nextBlock.key } });
  });

  it("límite superado: explica que no se registró, ofrece sólo ENTRADA (nunca confirmar la salida) y cerrar", async () => {
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValueOnce(new ApiError("No pudimos registrar la salida…", "CLOCK_SHIFT_LIMIT_EXCEEDED", 409, undefined, { ...GUIDANCE, kind: "SHIFT_LIMIT_EXCEEDED" }));
    const user = await startExit();
    const dialog = await screen.findByRole("dialog", { name: "No pudimos registrar la salida" });
    expect(dialog).toHaveTextContent("superó el máximo permitido");
    expect(screen.queryByRole("button", { name: /Confirmar SALIDA/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Volver" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1);
  });

  it("una salida normal no muestra ninguna pregunta (sin pasos extra)", async () => {
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValueOnce({ employee: ANA, workShift: { id: "shift-0700", startAt: OPEN_SINCE.toISOString(), endAt: new Date().toISOString(), totalMinutes: 240, totalHours: 4 }, segments: [] });
    await startExit();
    expect(await screen.findByText(/Salida registrada/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ExitDecisionDialog — kiosco compartido", () => {
  it("sin respuesta se cierra solo a los EXIT_DECISION_IDLE_MS; mientras envía, no", () => {
    vi.useFakeTimers();
    try {
      const onCancel = vi.fn();
      const { rerender } = render(<ExitDecisionDialog guidance={GUIDANCE} busy={null} onChoose={vi.fn()} onCancel={onCancel} />);
      act(() => {
        vi.advanceTimersByTime(EXIT_DECISION_IDLE_MS - 1);
      });
      expect(onCancel).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(2);
      });
      expect(onCancel).toHaveBeenCalledTimes(1);
      onCancel.mockClear();
      rerender(<ExitDecisionDialog guidance={GUIDANCE} busy="entry" onChoose={vi.fn()} onCancel={onCancel} />);
      act(() => {
        vi.advanceTimersByTime(EXIT_DECISION_IDLE_MS * 2);
      });
      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /Registrando/ })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
