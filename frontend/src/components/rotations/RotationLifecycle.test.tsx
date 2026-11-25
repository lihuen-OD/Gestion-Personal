/**
 * R4.8E: activar, desactivar y finalizar (vista previa, token, concurrencia,
 * superposiciones, descansos informativos, doble envío y permisos).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RotationDetailPage } from "../../pages/RotationDetailPage";
import { RotationFinalizeModal } from "./RotationFinalizeModal";
import { shiftRotationApiService, type FinalizePreview, type ShiftRotation } from "../../services/api/shiftRotationApiService";
import { shiftGroupApiService } from "../../services/api/shiftGroupApiService";
import { ApiError } from "../../services/api/apiClient";
import { confirmAction } from "../../services/appDialog";
import { rotationFixture } from "../../test/shiftRotationFixtures";
import { activationBlocked, finalizeResultText, lifecycleActions } from "../../utils/shiftRotationLifecycle";

vi.mock("../../services/appDialog", () => ({ confirmAction: vi.fn().mockResolvedValue(true) }));
const mockUseAuth = vi.fn();
vi.mock("../../context/AuthContext", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("../../services/api/shiftGroupApiService", () => ({ shiftGroupApiService: { list: vi.fn() } }));
vi.mock("../../services/api/shiftRotationApiService", () => ({ shiftRotationApiService: { detail: vi.fn(), activate: vi.fn(), deactivate: vi.fn(), finalizePreview: vi.fn(), finalize: vi.fn() } }));

function authAs(role: string) {
  mockUseAuth.mockReturnValue({ user: { id: "u1", name: "Usuario", email: "u@test.com", password: "", role, status: "Activo" } });
}
const renderPage = (rotation: ShiftRotation) => {
  vi.mocked(shiftRotationApiService.detail).mockResolvedValue(rotation);
  return render(
    <MemoryRouter initialEntries={["/configuracion/turnos/rotaciones/rot-1"]}>
      <Routes><Route path="/configuracion/turnos/rotaciones/:id" element={<RotationDetailPage />} /></Routes>
    </MemoryRouter>,
  );
};

const MEMBER = { id: "m1", crewId: "crew-a", crew: "A - Equipo A", employeeId: "e1", legajo: "19", employee: "Pérez, Ana · Legajo 19", employeeStatus: "ACTIVO", effectiveFrom: "2026-12-01", effectiveTo: null };
const INACTIVE = rotationFixture({ members: [MEMBER] });
const ACTIVE_NOT_RULED = rotationFixture({ status: "ACTIVO", members: [MEMBER] });
const ACTIVE_RULED = rotationFixture({ status: "ACTIVO", hasRuled: true, members: [MEMBER] });
const FINALIZED = rotationFixture({ status: "ACTIVO", hasRuled: true, finalized: true });

function preview(overrides: Partial<FinalizePreview> = {}): FinalizePreview {
  return {
    lastDay: "2026-11-24",
    closeVersions: [{ id: "v1", effectiveFrom: "2026-11-02", effectiveTo: null }],
    deleteVersions: [{ id: "v2", effectiveFrom: "2026-12-07", effectiveTo: null, dayCount: 14 }],
    closeMembers: [{ id: "m1", employeeId: "e1", employee: "Pérez, Ana · Legajo 19", crew: "A - Equipo A", effectiveFrom: "2026-11-02", effectiveTo: null }],
    cancelMembers: [{ id: "m2", employeeId: "e2", employee: "Ruiz, Eva · Legajo 20", crew: "B - Equipo B", effectiveFrom: "2026-12-14", effectiveTo: null }],
    withoutFixedShiftAfter: [{ employeeId: "e1", employee: "Pérez, Ana · Legajo 19", from: "2026-11-25" }],
    transitionOverlaps: [],
    restsAtTransition: [{ employeeId: "e1", employee: "Pérez, Ana · Legajo 19", restMinutes: 240 }],
    requiresConfirmation: true,
    confirmationToken: "a".repeat(64),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(confirmAction).mockResolvedValue(true);
  vi.mocked(shiftGroupApiService.list).mockResolvedValue([]);
  authAs("Nivel 1 - RRHH");
});

describe("acciones disponibles (sólo campos del backend)", () => {
  it("inactiva: activar; activa sin regir: desactivar y finalizar; activa que rigió: finalizar; finalizada: ninguna", () => {
    expect(lifecycleActions(INACTIVE)).toEqual({ activate: true, deactivate: false, finalize: false });
    expect(lifecycleActions(ACTIVE_NOT_RULED)).toEqual({ activate: false, deactivate: true, finalize: true });
    expect(lifecycleActions(ACTIVE_RULED)).toEqual({ activate: false, deactivate: false, finalize: true });
    expect(lifecycleActions(FINALIZED)).toEqual({ activate: false, deactivate: false, finalize: false });
    expect(activationBlocked({ health: "ERROR" })).toBe(true);
    expect(activationBlocked({ health: "WARNING" })).toBe(false);
    expect(finalizeResultText(preview())).toBe("Rotación finalizada con último día 24/11/2026: 1 pertenencia cerrada, 1 alta futura cancelada, 1 versión futura cancelada.");
  });

  it.each(["Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"])("%s no ve acciones de ciclo de vida", async (role) => {
    authAs(role);
    renderPage(ACTIVE_NOT_RULED);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /Activar|Desactivar|Finalizar/ })).not.toBeInTheDocument();
  });

  it("una rotación finalizada o que ya rigió no ofrece desactivar", async () => {
    renderPage(ACTIVE_RULED);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /Desactivar/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Finalizar/ })).toBeInTheDocument();
  });
});

describe("activar y desactivar", () => {
  it("con errores en el diagnóstico el botón queda deshabilitado y se explica", async () => {
    renderPage(rotationFixture({ health: "ERROR", issues: [{ code: "GRID_INCOMPLETE", severity: "ERROR", message: "x" }] }));
    expect(await screen.findByRole("button", { name: /Activar/ })).toBeDisabled();
    expect(screen.getByText(/Todavía no se puede activar/)).toBeInTheDocument();
  });

  it("confirma, activa una sola vez y actualiza el estado", async () => {
    let resolve: (value: ShiftRotation) => void = () => {};
    vi.mocked(shiftRotationApiService.activate).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const user = userEvent.setup();
    renderPage(INACTIVE);
    await user.click(await screen.findByRole("button", { name: /Activar/ }));
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("empieza a regir para 1 persona"), expect.objectContaining({ title: "Activar rotación" }));
    expect(screen.getByRole("button", { name: /Activar/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Activar/ }));
    expect(shiftRotationApiService.activate).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ...INACTIVE, status: "ACTIVO" }));
    expect(screen.getByText("Rotación activada.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Desactivar/ })).toBeInTheDocument();
  });

  it("un rechazo por altas retroactivas muestra a las personas, sin códigos", async () => {
    vi.mocked(shiftRotationApiService.activate).mockRejectedValue(new ApiError("x", "ROTATION_ACTIVATION_RETROACTIVE", 409, { error: { code: "ROTATION_ACTIVATION_RETROACTIVE", message: "No se puede activar: la rotación ya tendría efecto sobre fechas pasadas o de hoy. Estas membresías empiezan antes del 25/11/2026: Pérez, Ana · Legajo 19 (24/11/2026). Cancelalas y volvé a darlas de alta desde el 25/11/2026 o después.", details: { members: [{ id: "m1", employee: "Pérez, Ana · Legajo 19", effectiveFrom: "2026-11-24" }] } } }));
    const user = userEvent.setup();
    renderPage(INACTIVE);
    await user.click(await screen.findByRole("button", { name: /Activar/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se puede activar: la rotación ya tendría efecto sobre fechas pasadas");
    expect(alert).toHaveTextContent("Pérez, Ana · Legajo 19: desde el 24/11/2026");
    expect(document.body.textContent).not.toMatch(/ROTATION_/);
  });

  it("un rechazo por configuración incompleta lista los problemas con su título", async () => {
    vi.mocked(shiftRotationApiService.activate).mockRejectedValue(new ApiError("x", "ROTATION_NOT_READY", 409, { error: { code: "ROTATION_NOT_READY", message: "No se puede activar: la configuración tiene problemas que impedirían resolver los turnos. Corregilos y volvé a intentar.", details: { issues: [{ code: "SIN_TURNO_OVERLAP", severity: "ERROR", message: "Pérez, Ana · Legajo 19 tiene régimen SIN_TURNO desde el 01/12/2026, incompatible con una rotación." }] } } }));
    const user = userEvent.setup();
    renderPage(INACTIVE);
    await user.click(await screen.findByRole("button", { name: /Activar/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Régimen sin turno superpuesto: Pérez, Ana · Legajo 19 tiene régimen «Sin turno obligatorio»");
  });

  it("desactivar pide confirmación", async () => {
    vi.mocked(shiftRotationApiService.deactivate).mockResolvedValue(INACTIVE);
    const user = userEvent.setup();
    renderPage(ACTIVE_NOT_RULED);
    await user.click(await screen.findByRole("button", { name: /Desactivar/ }));
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("todavía no rigió"), expect.objectContaining({ tone: "danger" }));
    expect(await screen.findByText("Rotación desactivada.")).toBeInTheDocument();
  });
});

describe("finalizar", () => {
  const renderModal = (onFinalized = vi.fn()) => render(<RotationFinalizeModal rotation={ACTIVE_RULED} todayKey="2026-11-24" close={vi.fn()} onFinalized={onFinalized} />);

  it("muestra el impacto real y exige confirmación explícita antes de enviar el token", async () => {
    vi.mocked(shiftRotationApiService.finalizePreview).mockResolvedValue(preview());
    vi.mocked(shiftRotationApiService.finalize).mockResolvedValue({ rotation: ACTIVE_RULED, applied: preview() });
    const onFinalized = vi.fn();
    const user = userEvent.setup();
    renderModal(onFinalized);
    const finalize = screen.getByRole("button", { name: "Finalizar rotación" });
    expect(finalize).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Ver impacto" }));
    expect(shiftRotationApiService.finalizePreview).toHaveBeenCalledWith("rot-1", "2026-11-24");
    expect(screen.getByRole("region", { name: "Pertenencias que terminan ese día" })).toHaveTextContent("Pérez, Ana · Legajo 19 · A - Equipo A · desde el 02/11/2026 → hasta el 24/11/2026");
    expect(screen.getByRole("region", { name: "Altas futuras que se cancelan" })).toHaveTextContent("Ruiz, Eva · Legajo 20 · B - Equipo B · desde el 14/12/2026 (nunca rigió)");
    expect(screen.getByRole("region", { name: "Versiones de la grilla" })).toHaveTextContent("Versión futura desde el 07/12/2026 → se cancela (nunca rigió)");
    expect(screen.getByRole("region", { name: "Personas que quedan sin turno asignado" })).toHaveTextContent("sin turno fijo ni otra rotación desde el 25/11/2026");
    const rests = screen.getByRole("region", { name: "Descansos informados" });
    expect(rests).toHaveTextContent("4 h");
    expect(rests).toHaveTextContent("no se marca como problema");
    expect(finalize).toBeDisabled();
    await user.click(screen.getByLabelText(/Revisé el impacto y quiero finalizar/));
    await user.click(finalize);
    expect(shiftRotationApiService.finalize).toHaveBeenCalledWith("rot-1", "2026-11-24", "a".repeat(64));
    expect(onFinalized).toHaveBeenCalled();
  });

  it("cambiar la fecha invalida la vista previa y la confirmación; no se aceptan días pasados", async () => {
    vi.mocked(shiftRotationApiService.finalizePreview).mockResolvedValue(preview());
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "Ver impacto" }));
    await user.click(screen.getByLabelText(/Revisé el impacto/));
    const date = screen.getByLabelText("Último día de vigencia *");
    await user.clear(date);
    await user.type(date, "2026-11-20");
    expect(screen.queryByLabelText(/Revisé el impacto/)).not.toBeInTheDocument();
    expect(screen.getByText(/la finalización nunca rige sobre días pasados/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver impacto" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Finalizar rotación" })).toBeDisabled();
  });

  it("si la rotación cambió (STALE) muestra la vista previa nueva y exige confirmar otra vez con el token nuevo", async () => {
    const fresh = preview({ cancelMembers: [], confirmationToken: "b".repeat(64) });
    vi.mocked(shiftRotationApiService.finalizePreview).mockResolvedValue(preview());
    vi.mocked(shiftRotationApiService.finalize)
      .mockRejectedValueOnce(new ApiError("x", "ROTATION_FINALIZE_STALE", 409, { error: { code: "ROTATION_FINALIZE_STALE", message: "La rotación cambió desde la vista previa.", details: { preview: fresh } } }))
      .mockResolvedValueOnce({ rotation: ACTIVE_RULED, applied: fresh });
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "Ver impacto" }));
    await user.click(screen.getByLabelText(/Revisé el impacto/));
    await user.click(screen.getByRole("button", { name: "Finalizar rotación" }));
    expect(await screen.findByText(/el impacto es distinto/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Altas futuras que se cancelan" })).toHaveTextContent("Ninguna.");
    expect(screen.getByLabelText(/Revisé el impacto/)).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Finalizar rotación" })).toBeDisabled();
    await user.click(screen.getByLabelText(/Revisé el impacto/));
    await user.click(screen.getByRole("button", { name: "Finalizar rotación" }));
    expect(vi.mocked(shiftRotationApiService.finalize).mock.calls[1]).toEqual(["rot-1", "2026-11-24", "b".repeat(64)]);
  });

  it("con superposiciones no se puede confirmar y se explica", async () => {
    vi.mocked(shiftRotationApiService.finalizePreview).mockResolvedValue(preview({ transitionOverlaps: [{ employeeId: "e1", employee: "Pérez, Ana · Legajo 19", outgoing: "P-1907 19:00–07:00 del 2026-11-24", incoming: "F-01 06:00–14:00 del 2026-11-25" }] }));
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "Ver impacto" }));
    expect(screen.getByRole("region", { name: "Superposiciones con el turno siguiente" })).toHaveTextContent("P-1907 19:00–07:00 del 24/11/2026 se superpone con F-01 06:00–14:00 del 25/11/2026");
    expect(screen.getByText(/No se puede finalizar con este último día/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Revisé el impacto/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finalizar rotación" })).toBeDisabled();
  });

  it("un rechazo conserva la fecha y la vista previa, sin mensajes técnicos", async () => {
    vi.mocked(shiftRotationApiService.finalizePreview).mockResolvedValue(preview());
    vi.mocked(shiftRotationApiService.finalize).mockRejectedValue(new ApiError("x", "ROTATION_NOT_ACTIVE", 409, { error: { code: "ROTATION_NOT_ACTIVE", message: "Sólo se finaliza una rotación ACTIVA. Una rotación inactiva nunca rigió: se puede eliminar o reconfigurar." } }));
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "Ver impacto" }));
    await user.click(screen.getByLabelText(/Revisé el impacto/));
    await user.click(screen.getByRole("button", { name: "Finalizar rotación" }));
    expect(await screen.findByText("Sólo se finaliza una rotación activa. Una rotación inactiva nunca rigió: se puede eliminar o reconfigurar.")).toBeInTheDocument();
    expect(screen.getByLabelText("Último día de vigencia *")).toHaveValue("2026-11-24");
    expect(screen.getByRole("region", { name: "Pertenencias que terminan ese día" })).toBeInTheDocument();
  });
});

describe("resultado en el detalle", () => {
  it("después de finalizar informa el resultado y quién queda sin turno", async () => {
    vi.mocked(shiftRotationApiService.finalizePreview).mockResolvedValue(preview());
    vi.mocked(shiftRotationApiService.finalize).mockResolvedValue({ rotation: ACTIVE_RULED, applied: preview() });
    const user = userEvent.setup();
    renderPage(ACTIVE_RULED);
    await user.click(await screen.findByRole("button", { name: /Finalizar/ }));
    const dialog = screen.getByRole("dialog", { name: "Finalizar rotación" });
    await user.click(within(dialog).getByRole("button", { name: "Ver impacto" }));
    await user.click(within(dialog).getByLabelText(/Revisé el impacto/));
    await user.click(within(dialog).getByRole("button", { name: "Finalizar rotación" }));
    expect(await screen.findByText(/Rotación finalizada con último día 24\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByText("Pérez, Ana · Legajo 19: desde el 25/11/2026")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
