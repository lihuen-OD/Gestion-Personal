import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimeClockPage } from "./TimeClockPage";
import { timeClockApiService } from "../services/api/timeClockApiService";

vi.mock("../services/api/timeClockApiService", () => ({
  timeClockApiService: {
    searchEmployees: vi.fn(),
    status: vi.fn(),
    clockIn: vi.fn(),
    clockOut: vi.fn(),
    photoPunch: vi.fn(),
    attemptStatus: vi.fn(),
  },
}));

vi.mock("../components/time-clock/FaceCaptureModal", () => ({
  FaceCaptureModal: ({ punchType, onConfirm, onCancel }: { punchType: "IN" | "OUT"; onConfirm: (capture: unknown) => void; onCancel: () => void }) => (
    <div data-testid="face-capture-modal">
      <span>captura para {punchType}</span>
      <button
        onClick={() =>
          onConfirm({
            photo: "data:image/jpeg;base64,AAAA",
            thumbnail: "data:image/jpeg;base64,AAAA",
            faceValidationStatus: "VALID",
            faceDetectionScore: 0.94,
            device: { userAgent: "test-agent", platform: "test", language: "es-AR" },
          })
        }
      >
        Confirmar captura
      </button>
      <button onClick={onCancel}>Cancelar captura</button>
    </div>
  ),
}));

const employeeMatch = { id: "employee-1", legajo: "100", dni: "30000000", firstName: "Ana", lastName: "Gomez", name: "Ana Gomez" };

// Fechas relativas al reloj real de la corrida, no hardcodeadas: un turno
// abierto hace 8 horas nunca "expira" (supera las 20h de
// MAX_CLOCK_SHIFT_MINUTES en TimeClockPage.tsx) sin importar cuándo se
// ejecute el test — a diferencia de un ISO fijo, que sí termina superando ese
// umbral con el correr de los días reales.
function nowIso() {
  return new Date().toISOString();
}
function isoHoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function mockNoOpenShift() {
  vi.mocked(timeClockApiService.status).mockResolvedValue({
    employee: employeeMatch,
    openShift: null,
    hourConcepts: [],
  });
}

function mockOpenShift() {
  vi.mocked(timeClockApiService.status).mockResolvedValue({
    employee: employeeMatch,
    openShift: { id: "shift-1", startAt: isoHoursAgo(8), hourConcept: null },
    hourConcepts: [],
  });
}

async function selectEmployee() {
  const user = userEvent.setup();
  render(<TimeClockPage />);
  await user.type(screen.getByLabelText("Buscar por nombre o apellido"), "Gomez");
  const resultButton = await screen.findByText("Gomez, Ana");
  await user.click(resultButton);
  await waitFor(() => expect(timeClockApiService.status).toHaveBeenCalledWith("employee-1"));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(timeClockApiService.searchEmployees).mockResolvedValue([employeeMatch]);
});

describe("TimeClockPage — fichador sin selector de concepto horario (Etapa 6K)", () => {
  it("no muestra ningún selector (radio) de concepto horario", async () => {
    mockNoOpenShift();
    await selectEmployee();

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText(/qué tipo de jornada/i)).not.toBeInTheDocument();
  });

  it("no muestra Normal, Sereno, Colectivo ni Guardia como opciones en pantalla", async () => {
    mockNoOpenShift();
    const { container } = render(<TimeClockPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Buscar por nombre o apellido"), "Gomez");
    await user.click(await screen.findByText("Gomez, Ana"));
    await waitFor(() => expect(timeClockApiService.status).toHaveBeenCalled());

    expect(container.textContent).not.toMatch(/Sereno/);
    expect(container.textContent).not.toMatch(/Colectivo/);
    expect(container.textContent).not.toMatch(/Guardia/);
    expect(container.textContent).not.toMatch(/Hora normal/);
  });

  it("no expone 'priority' ni 'countsAsWorked' en el fichador", async () => {
    mockNoOpenShift();
    const { container } = render(<TimeClockPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Buscar por nombre o apellido"), "Gomez");
    await user.click(await screen.findByText("Gomez, Ana"));
    await waitFor(() => expect(timeClockApiService.status).toHaveBeenCalled());

    expect(container.textContent).not.toMatch(/priority/i);
    expect(container.textContent).not.toMatch(/countsAsWorked/i);
  });

  it("permite marcar ingreso y el payload de fichada no incluye hourConceptId/conceptId/hourType", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue({
      employee: employeeMatch,
      workShift: { id: "shift-1", startAt: nowIso() },
    });
    const user = await selectEmployee();

    const clockInButton = screen.getByRole("button", { name: /Marcar ingreso/i });
    expect(clockInButton).toBeEnabled();
    await user.click(clockInButton);

    await screen.findByTestId("face-capture-modal");
    await user.click(screen.getByRole("button", { name: /Confirmar captura/i }));

    await waitFor(() => expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(timeClockApiService.photoPunch).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("hourConceptId");
    expect(payload).not.toHaveProperty("conceptId");
    expect(payload).not.toHaveProperty("hourType");
    expect(payload).toMatchObject({ punchType: "IN", employeeId: "employee-1" });

    expect(await screen.findByText(/Ingreso registrado/i)).toBeInTheDocument();
  });

  it("permite marcar salida y el payload de fichada tampoco incluye conceptos", async () => {
    mockOpenShift();
    const shiftStartAt = isoHoursAgo(8);
    const shiftEndAt = nowIso();
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue({
      employee: employeeMatch,
      workShift: { id: "shift-1", startAt: shiftStartAt, endAt: shiftEndAt, totalMinutes: 480, totalHours: 8 },
      segments: [{ date: shiftStartAt.slice(0, 10), startAt: shiftStartAt, endAt: shiftEndAt, minutes: 480, hours: 8, label: "8 h trabajadas" }],
    });
    const user = await selectEmployee();

    const clockOutButton = screen.getByRole("button", { name: /Marcar salida/i });
    expect(clockOutButton).toBeEnabled();
    await user.click(clockOutButton);

    await screen.findByTestId("face-capture-modal");
    await user.click(screen.getByRole("button", { name: /Confirmar captura/i }));

    await waitFor(() => expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(timeClockApiService.photoPunch).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("hourConceptId");
    expect(payload).not.toHaveProperty("conceptId");
    expect(payload).not.toHaveProperty("hourType");
    expect(payload).toMatchObject({ punchType: "OUT" });

    expect(await screen.findByText(/Salida registrada/i)).toBeInTheDocument();
  });

  it("muestra un error claro si falla la consulta de estado, sin romper la pantalla", async () => {
    vi.mocked(timeClockApiService.status).mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    render(<TimeClockPage />);
    await user.type(screen.getByLabelText("Buscar por nombre o apellido"), "Gomez");
    await user.click(await screen.findByText("Gomez, Ana"));

    expect(await screen.findByText("No pudimos consultar el estado del legajo seleccionado.")).toBeInTheDocument();
  });
});
