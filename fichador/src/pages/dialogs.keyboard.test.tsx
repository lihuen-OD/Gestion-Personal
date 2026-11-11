import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FaceCaptureModal } from "../components/time-clock/FaceCaptureModal";
import { Modal } from "../components/ui/Modal";
import { TimeClockPage } from "./TimeClockPage";
import { MaintenanceAccessDialog } from "../features/maintenance/MaintenanceAccessDialog";
import { MaintenancePanel } from "../features/maintenance/MaintenancePanel";
import { ClockDeviceGate } from "../features/device/ClockDeviceGate";
import { clockDeviceStorage } from "../features/device/clockDeviceStorage";
import { clockDeviceApiService } from "../services/api/clockDeviceApiService";
import { clockDeviceSession } from "../services/api/clockDeviceSession";
import { timeClockApiService } from "../services/api/timeClockApiService";

/**
 * Etapa 6B-2 (AUDITORIA_6A F6-04 / P4): teclado en los diálogos reales del
 * fichador. Nada sale a la red: las APIs están simuladas y la cámara no existe
 * en jsdom (el diálogo de captura se abre igual, con la cámara no disponible).
 */
vi.mock("@mediapipe/tasks-vision", () => ({ FilesetResolver: { forVisionTasks: vi.fn() }, FaceDetector: { createFromOptions: vi.fn() } }));
vi.mock("../features/device/clockDeviceStorage", () => ({ clockDeviceStorage: { get: vi.fn(), set: vi.fn(), clear: vi.fn() } }));
vi.mock("../services/api/clockDeviceApiService", () => ({ clockDeviceApiService: { register: vi.fn(), status: vi.fn(), refreshPairing: vi.fn() } }));

const IDENTITY = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secret: "s".repeat(43) };
const ANA = { id: "employee-1", legajo: "100", dniSuffix: "456", firstName: "Ana", lastName: "Gomez", name: "Gomez, Ana" };
const DEVICE = { name: "Recepción", status: "ACTIVE" as const, activatedAt: null, lastSeenAt: null, lastAppVersion: "0.1.0", connectivity: "ONLINE" as const, establishment: null };
const originalMediaDevices = navigator.mediaDevices;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const inDialog = (name: string) => screen.getByRole("dialog", { name }).contains(document.activeElement);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
});

afterEach(() => {
  Object.defineProperty(navigator, "mediaDevices", { value: originalMediaDevices, configurable: true });
  Reflect.deleteProperty(navigator, "onLine");
  clockDeviceSession.end();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Captura facial", () => {
  it("1/5. foco inicial en Cancelar (opción segura) y Escape cancela mientras no se envió nada", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<FaceCaptureModal punchType="IN" onCancel={onCancel} onConfirm={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("6. con la fichada enviándose, Escape no la interrumpe y el foco sigue en el diálogo", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<FaceCaptureModal punchType="IN" onCancel={onCancel} onConfirm={vi.fn()} submitting submissionStage="verifying" />);
    await waitFor(() => expect(inDialog("Confirmar fichada con foto")).toBe(true));
    await user.keyboard("{Escape}");
    await user.tab();
    expect(onCancel).not.toHaveBeenCalled();
    expect(inDialog("Confirmar fichada con foto")).toBe(true);
  });

  it("12. con la cámara abierta el fichador de fondo queda inerte: no se puede cambiar de empleado; al cancelar el foco vuelve a la acción", async () => {
    const user = userEvent.setup();
    clockDeviceSession.start(IDENTITY);
    vi.spyOn(timeClockApiService, "searchEmployees").mockResolvedValue([ANA]);
    vi.spyOn(timeClockApiService, "status").mockResolvedValue({ employee: ANA, openShift: null });
    render(<TimeClockPage />);
    await user.type(screen.getByLabelText("Buscar por nombre o apellido"), "Gomez");
    await user.click(await screen.findByRole("button", { name: /Gomez, Ana/ }));
    const action = await screen.findByRole("button", { name: "Marcar ingreso" });
    await waitFor(() => expect(action).toBeEnabled());
    action.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Confirmar fichada con foto" });
    await waitFor(() => expect(inDialog("Confirmar fichada con foto")).toBe(true));

    const change = screen.getByRole("button", { name: "Cambiar empleado" });
    expect(change.closest("[inert]")).not.toBeNull();
    for (let index = 0; index < 6; index += 1) {
      await user.tab();
      expect(inDialog("Confirmar fichada con foto")).toBe(true);
    }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Marcar ingreso" })).toHaveFocus();
    expect(change.closest("[inert]")).toBeNull();
  });
});

describe("Acceso de mantenimiento", () => {
  it("11/5. foco inicial en el campo del código y Escape cancela sin enviar nada", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onCancel = vi.fn();
    render(<MaintenanceAccessDialog onCancel={onCancel} onGranted={vi.fn()} />);
    expect(screen.getByLabelText("Código")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("6. mientras se verifica el código, Escape no abandona la verificación", async () => {
    const user = userEvent.setup();
    clockDeviceSession.start(IDENTITY);
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const onCancel = vi.fn();
    render(<MaintenanceAccessDialog onCancel={onCancel} onGranted={vi.fn()} />);
    await user.type(screen.getByLabelText("Código"), "482731{Enter}");
    await screen.findByRole("button", { name: "Verificando…" });
    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
    expect(inDialog("Acceso de mantenimiento")).toBe(true);
  });

  it("código rechazado: el foco vuelve al campo y Tab no sale del diálogo", async () => {
    const user = userEvent.setup();
    clockDeviceSession.start(IDENTITY);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, { error: { code: "RATE_LIMITED" } })));
    render(<><input aria-label="Buscador de fondo" /><MaintenanceAccessDialog onCancel={vi.fn()} onGranted={vi.fn()} /></>);
    await user.type(screen.getByLabelText("Código"), "482731{Enter}");
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByLabelText("Código")).toHaveFocus());
    for (let index = 0; index < 5; index += 1) {
      await user.tab({ shift: index % 2 === 1 });
      expect(inDialog("Acceso de mantenimiento")).toBe(true);
    }
    expect(screen.getByLabelText("Buscador de fondo").closest("[inert]")).not.toBeNull();
  });
});

describe("Confirmaciones sensibles", () => {
  it("10. RECONFIGURAR: el foco nunca arranca en la acción destructiva; Enter y Escape no reconfiguran", async () => {
    const user = userEvent.setup();
    clockDeviceSession.start(IDENTITY);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const onReconfigure = vi.fn(async () => true);
    render(<MaintenancePanel access={{ token: "t".repeat(43), deadline: Date.now() + 600_000, device: DEVICE, verifiedAt: Date.now() }} onExit={vi.fn()} onReconfigure={onReconfigure} reloadApp={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Reconfigurar dispositivo" }));
    const word = screen.getByLabelText("Escribí RECONFIGURAR para confirmar");
    expect(word).toHaveFocus();
    await user.type(word, "RECONFIGURAR{Enter}");
    await user.keyboard("{Escape}");
    expect(onReconfigure).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Confirmar reconfiguración" })).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Reconfigurar dispositivo" })).toHaveFocus();
    expect(onReconfigure).not.toHaveBeenCalled();
  });
});

describe("Device Gate", () => {
  it("13. RRHH revoca con un diálogo abierto: el Gate bloquea, el fondo no queda inerte y no se enfoca nada desmontado", async () => {
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    vi.mocked(clockDeviceApiService.status).mockResolvedValue({ id: IDENTITY.id, name: "Recepción", status: "ACTIVE" });
    const opener = { current: null as HTMLButtonElement | null };
    render(
      <ClockDeviceGate>
        <button ref={(node) => { opener.current = node; }}>Activador</button>
        <Modal title="Diálogo abierto" close={vi.fn()}><button>Interno</button></Modal>
      </ClockDeviceGate>,
    );
    await screen.findByRole("dialog", { name: "Diálogo abierto" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { error: { code: "CLOCK_DEVICE_REVOKED", message: "x" } })));
    await act(async () => { await timeClockApiService.searchEmployees("ana").catch(() => undefined); });

    expect(screen.getByRole("heading", { name: "Dispositivo deshabilitado" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector("[inert]")).toBeNull();
    expect(opener.current?.isConnected ?? false).toBe(false);
    expect(document.activeElement === opener.current).toBe(false);
    const action = screen.getByRole("button", { name: "Configurar como nuevo dispositivo" });
    act(() => { action.focus(); });
    expect(action).toHaveFocus();
  });

  it("el Gate sigue confirmando con Cancelar como foco inicial y Escape no borra nada", async () => {
    const user = userEvent.setup();
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    vi.mocked(clockDeviceApiService.status).mockResolvedValue({ id: IDENTITY.id, name: "Recepción", status: "REVOKED" });
    render(<ClockDeviceGate><h1>Fichador de personal</h1></ClockDeviceGate>);
    await user.click(await screen.findByRole("button", { name: "Configurar como nuevo dispositivo" }));
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(clockDeviceStorage.clear).not.toHaveBeenCalled();
  });
});
