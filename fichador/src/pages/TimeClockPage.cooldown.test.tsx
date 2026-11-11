import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TimeClockPage } from "./TimeClockPage";
import { timeClockApiService, type ClockEmployee } from "../services/api/timeClockApiService";
import { ApiError } from "../services/api/apiClient";

/**
 * Etapa 6B-5 (AUDITORIA_6A F6-10): la espera entre fichadas es por legajo y
 * la decide el backend. Al cambiar de persona el aviso no se traslada a otra;
 * al volver a la misma, el backend la vuelve a aplicar con su tiempo real. No
 * se guarda ningún dato del empleado sólo para conservar el aviso.
 */
vi.mock("../services/api/timeClockApiService", () => ({
  timeClockApiService: { searchEmployees: vi.fn(), status: vi.fn(), photoPunch: vi.fn(), attemptStatus: vi.fn() },
}));
vi.mock("../components/time-clock/FaceCaptureModal", () => ({
  FaceCaptureModal: ({ onConfirm }: { onConfirm: (capture: unknown) => void }) => (
    <div data-testid="face-capture-modal">
      <button onClick={() => onConfirm({ photo: "data:image/jpeg;base64,AAAA", thumbnail: "data:image/jpeg;base64,AAAA", faceValidationStatus: "VALID", faceDetectionScore: 0.9, device: { userAgent: "t", platform: "t", language: "es-AR" } })}>Confirmar captura</button>
    </div>
  ),
}));

const ANA: ClockEmployee = { id: "employee-1", legajo: "100", dniSuffix: "456", firstName: "Ana", lastName: "Gomez", name: "Gomez, Ana" };
const BETO: ClockEmployee = { id: "employee-2", legajo: "200", dniSuffix: "789", firstName: "Beto", lastName: "Paz", name: "Paz, Beto" };
const COOLDOWN_TEXT = "Ya registraste una fichada hace unos segundos.";

async function select(employee: ClockEmployee) {
  fireEvent.change(screen.getByLabelText("Buscar por nombre o apellido"), { target: { value: employee.lastName } });
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(employee.name) }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Marcar ingreso" })).toBeEnabled());
}
async function punch() {
  fireEvent.click(screen.getByRole("button", { name: "Marcar ingreso" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirmar captura" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  vi.mocked(timeClockApiService.searchEmployees).mockImplementation(async (query: string) => [ANA, BETO].filter((employee) => employee.name.includes(query)));
  vi.mocked(timeClockApiService.status).mockImplementation(async (employeeId: string) => ({ employee: employeeId === BETO.id ? BETO : ANA, openShift: null }));
  vi.mocked(timeClockApiService.photoPunch).mockRejectedValue(new ApiError(COOLDOWN_TEXT, "CLOCK_PUNCH_COOLDOWN", 409, 60));
});

describe("F6-10 — la espera entre fichadas pertenece al legajo", () => {
  it("al cambiar a otra persona el aviso no se traslada; al volver a la misma, el backend la aplica de nuevo", async () => {
    render(<TimeClockPage />);
    await select(ANA);
    await punch();
    expect(await screen.findByText(COOLDOWN_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar ingreso" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Cambiar empleado" }));
    await select(BETO);
    expect(screen.queryByText(COOLDOWN_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ana|Legajo 100/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cambiar empleado" }));
    await select(ANA);
    await punch();
    expect(await screen.findByText(COOLDOWN_TEXT)).toBeInTheDocument();
    const sent = vi.mocked(timeClockApiService.photoPunch).mock.calls.map(([input]) => input);
    expect(sent.map((input) => input.employeeId)).toEqual([ANA.id, ANA.id]);
    expect(new Set(sent.map((input) => input.requestId)).size).toBe(2); // cada intención, su requestId
    expect(screen.queryByRole("heading", { name: /registrada/ })).not.toBeInTheDocument();
  });
});
