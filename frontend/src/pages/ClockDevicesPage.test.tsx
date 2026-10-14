import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/api/clockDeviceApiService", () => ({
  clockDeviceApiService: { list: vi.fn(), resolvePairing: vi.fn(), activate: vi.fn(), update: vi.fn(), revoke: vi.fn(), deletePending: vi.fn() },
}));
vi.mock("../services/api/orgStructureApiService", () => ({ orgStructureApiService: { getCatalog: vi.fn() } }));
vi.mock("../services/appDialog", () => ({ confirmAction: vi.fn().mockResolvedValue(true) }));

import { ApiError } from "../services/api/apiClient";
import { clockDeviceApiService, type ClockDevice } from "../services/api/clockDeviceApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { CLOCK_DEVICES_REFRESH_ERROR, CLOCK_DEVICES_REFRESH_MS, ClockDevicesPage } from "./ClockDevicesPage";

const pending: ClockDevice = { id: "device-1", name: null, status: "PENDING", connectivity: null, establishmentId: null, establishment: null, activatedAt: null, revokedAt: null, lastSeenAt: "2026-10-06T12:00:00Z", lastIp: null, lastUserAgent: null, lastAppVersion: "0.1.0", createdAt: "2026-10-06T11:00:00Z", updatedAt: "2026-10-06T11:00:00Z" };
const zone = { id: "zone-1", name: "Norte" };
const active = (overrides: Partial<ClockDevice> = {}): ClockDevice => ({
  ...pending, id: "device-2", name: "Pañol principal", status: "ACTIVE", connectivity: "ONLINE", activatedAt: "2026-10-07T13:00:00Z",
  establishmentId: "est-1", establishment: { id: "est-1", name: "Recepción", zone }, lastSeenAt: "2026-10-14T14:58:00Z", lastIp: "10.0.0.5", lastUserAgent: "Mozilla/5.0 (iPad)", lastAppVersion: "1.4.0",
  ...overrides,
});
const listOf = (data: ClockDevice[]) => ({ data, meta: { total: data.length, page: 1, pageSize: 25, hasMore: false } });
const rowOf = (name: string) => screen.getByText(name).closest("tr")!;
// El Modal compartido no expone role="dialog": se ubica por su título.
const editModal = () => (screen.queryByRole("heading", { name: "Editar dispositivo" })?.closest(".modal") ?? null) as HTMLElement | null;
const findEditModal = async () => (await screen.findByRole("heading", { name: "Editar dispositivo" })).closest(".modal") as HTMLElement;

describe("ClockDevicesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clockDeviceApiService.list).mockResolvedValue(listOf([pending]));
    vi.mocked(clockDeviceApiService.resolvePairing).mockResolvedValue(pending);
    vi.mocked(clockDeviceApiService.activate).mockResolvedValue({ ...pending, name: "iPad Recepción", status: "ACTIVE" });
    vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue({ sectors: [], companies: [], businessUnits: [], establishments: [
      { id: "est-1", code: "REC", name: "Recepción", status: "ACTIVO", zoneId: "zone-1", province: "", department: "", locality: "", address: "" },
      { id: "est-2", code: "PAN", name: "Pañol", status: "ACTIVO", zoneId: "zone-1", province: "", department: "", locality: "", address: "" },
      { id: "est-3", code: "OLD", name: "Depósito cerrado", status: "INACTIVO", zoneId: "zone-1", province: "", department: "", locality: "", address: "" },
    ], areas: [], zones: [{ id: "zone-1", code: "N", name: "Norte", status: "ACTIVO" }], costCenters: [] });
  });

  it("aprueba en dos pasos: código, metadata, nombre/establecimiento y activación", async () => {
    const user = userEvent.setup();
    render(<ClockDevicesPage />);
    await screen.findByText("Solicitud pendiente");
    await user.click(screen.getAllByRole("button", { name: "Aprobar dispositivo" }).at(-1)!);
    await user.type(screen.getByLabelText("Código de vinculación"), "ABCD-2345");
    await user.click(screen.getByRole("button", { name: "Verificar código" }));
    await screen.findByText("Solicitud encontrada");
    expect(clockDeviceApiService.resolvePairing).toHaveBeenCalledWith("ABCD-2345");
    await user.type(screen.getByLabelText("Nombre del dispositivo *"), "iPad Recepción");
    await user.selectOptions(screen.getByLabelText("Establecimiento (opcional)"), "est-1");
    await user.click(screen.getAllByRole("button", { name: "Aprobar dispositivo" }).at(-1)!);
    await waitFor(() => expect(clockDeviceApiService.activate).toHaveBeenCalledWith("device-1", { pairingCode: "ABCD-2345", name: "iPad Recepción", establishmentId: "est-1" }));
  });

  it("la tabla traduce estados y no expone el identificador técnico", async () => {
    render(<ClockDevicesPage />);
    expect(await screen.findByText("Pendiente")).toBeVisible();
    expect(screen.queryByText("PENDING")).not.toBeInTheDocument();
    expect(screen.queryByText("device-1")).not.toBeInTheDocument();
  });

  // F9 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §28)
  it("F9: distingue estado administrativo y conectividad; REVOKED nunca aparece 'en línea'", async () => {
    vi.mocked(clockDeviceApiService.list).mockResolvedValue(listOf([
      active(),
      active({ id: "d3", name: "Portería", connectivity: "OFFLINE", lastSeenAt: "2026-10-14T09:05:00Z" }),
      active({ id: "d4", name: "Taller", connectivity: "NEVER_SEEN", lastSeenAt: null, establishmentId: null, establishment: null }),
      active({ id: "d5", name: "Oficina vieja", status: "REVOKED", connectivity: null, revokedAt: "2026-10-10T15:00:00Z", lastSeenAt: "2026-10-14T14:59:00Z" }),
      pending,
    ]));
    render(<ClockDevicesPage />);
    await screen.findByText("Pañol principal");

    expect(within(rowOf("Pañol principal")).getByText("En línea")).toBeInTheDocument();
    expect(within(rowOf("Pañol principal")).getByText("Activo")).toBeInTheDocument();
    expect(within(rowOf("Pañol principal")).getByText("Norte · Recepción")).toBeInTheDocument();
    expect(within(rowOf("Pañol principal")).getByText("14/10/2026 · 11:58")).toBeInTheDocument();
    expect(within(rowOf("Pañol principal")).getByText("Aprobado el 07/10/2026")).toBeInTheDocument();
    expect(within(rowOf("Portería")).getByText("Sin conexión")).toBeInTheDocument();
    expect(within(rowOf("Taller")).getByText("Sin conexión registrada")).toBeInTheDocument();
    expect(within(rowOf("Taller")).getByText("Sin registro")).toBeInTheDocument();
    expect(within(rowOf("Taller")).getByText("Sin establecimiento")).toBeInTheDocument();
    expect(within(rowOf("Oficina vieja")).getByText("Revocado")).toBeInTheDocument();
    expect(within(rowOf("Oficina vieja")).queryByText(/En línea|Sin conexión/)).not.toBeInTheDocument();
    expect(within(rowOf("Oficina vieja")).queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("En línea")).toHaveLength(1);
    // Nada técnico en pantalla: ni enums, ni ISO, ni IP, ni user-agent.
    expect(document.body.textContent).not.toMatch(/ONLINE|OFFLINE|NEVER_SEEN|2026-10-14T|10\.0\.0\.5|Mozilla/);
  });

  it("F9: edita nombre y establecimiento con validación inline y confirma con un aviso breve", async () => {
    const user = userEvent.setup();
    vi.mocked(clockDeviceApiService.list).mockResolvedValue(listOf([active()]));
    vi.mocked(clockDeviceApiService.update).mockResolvedValue(active({ name: "Pañol central" }));
    render(<ClockDevicesPage />);
    await user.click(await screen.findByRole("button", { name: "Editar Pañol principal" }));
    const dialog = await findEditModal();
    expect(within(dialog).getByText("Indica dónde está instalado el equipo. No limita qué personas pueden fichar en él.")).toBeInTheDocument();
    const establishmentSelect = within(dialog).getByLabelText("Establecimiento");
    await waitFor(() => expect(within(establishmentSelect).getAllByRole("option").map((option) => option.textContent)).toEqual(["Sin establecimiento", "Norte · Recepción", "Norte · Pañol"]));

    await user.clear(within(dialog).getByLabelText("Nombre del dispositivo *"));
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(await within(dialog).findByText("Ingresá un nombre de al menos 2 caracteres.")).toBeInTheDocument();
    expect(clockDeviceApiService.update).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("Nombre del dispositivo *"), "  Pañol central ");
    await user.selectOptions(establishmentSelect, "est-2");
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(clockDeviceApiService.update).toHaveBeenCalledWith("device-2", { name: "Pañol central", establishmentId: "est-2" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Dispositivo actualizado");
    expect(editModal()).toBeNull();
  });

  it("F9: sin cambios no llama al backend; un error del backend queda en el modal", async () => {
    const user = userEvent.setup();
    vi.mocked(clockDeviceApiService.list).mockResolvedValue(listOf([active()]));
    vi.mocked(clockDeviceApiService.update).mockRejectedValue(new ApiError("El establecimiento elegido no existe o no está activo.", "CLOCK_DEVICE_ESTABLISHMENT_INVALID", 400));
    render(<ClockDevicesPage />);
    await user.click(await screen.findByRole("button", { name: "Editar Pañol principal" }));
    await user.click(await screen.findByRole("button", { name: "Guardar cambios" }));
    expect(clockDeviceApiService.update).not.toHaveBeenCalled();
    expect(editModal()).toBeNull();

    await user.click(screen.getByRole("button", { name: "Editar Pañol principal" }));
    await user.selectOptions(await screen.findByLabelText("Establecimiento"), "");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(clockDeviceApiService.update).toHaveBeenCalledWith("device-2", { establishmentId: null });
    expect(editModal()).not.toBeNull();
  });
});

describe("ClockDevicesPage — refresco silencioso de la conectividad (F9)", () => {
  const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  let hidden = false;

  beforeEach(() => {
    vi.clearAllMocks();
    hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refresca cada 30 s sin skeleton; si falla conserva la lista y avisa; el siguiente refresco limpia el aviso", async () => {
    vi.mocked(clockDeviceApiService.list)
      .mockResolvedValueOnce(listOf([active()]))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(listOf([active({ connectivity: "OFFLINE" })]));
    render(<ClockDevicesPage />);
    await flush(250);
    expect(screen.getByText("En línea")).toBeInTheDocument();

    await flush(CLOCK_DEVICES_REFRESH_MS);
    expect(clockDeviceApiService.list).toHaveBeenCalledTimes(2);
    expect(screen.getByText(CLOCK_DEVICES_REFRESH_ERROR)).toBeInTheDocument();
    expect(screen.getByText("Pañol principal")).toBeInTheDocument();
    expect(screen.getByText("En línea")).toBeInTheDocument(); // no la convierte a "sin conexión" por un fallo propio

    await flush(CLOCK_DEVICES_REFRESH_MS);
    expect(screen.queryByText(CLOCK_DEVICES_REFRESH_ERROR)).not.toBeInTheDocument();
    expect(screen.getByText("Sin conexión")).toBeInTheDocument();
  });

  it("no refresca con la pestaña oculta y no cierra ni resetea un modal abierto", async () => {
    vi.mocked(clockDeviceApiService.list).mockResolvedValue(listOf([active()]));
    vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue({ sectors: [], companies: [], businessUnits: [], establishments: [], areas: [], zones: [], costCenters: [] });
    render(<ClockDevicesPage />);
    await flush(250);

    hidden = true;
    await flush(3 * CLOCK_DEVICES_REFRESH_MS);
    expect(clockDeviceApiService.list).toHaveBeenCalledTimes(1);

    hidden = false;
    fireEvent.click(screen.getByRole("button", { name: "Editar Pañol principal" }));
    await flush();
    fireEvent.change(screen.getByLabelText("Nombre del dispositivo *"), { target: { value: "Nombre a medio escribir" } });
    await flush(CLOCK_DEVICES_REFRESH_MS);
    expect(clockDeviceApiService.list).toHaveBeenCalledTimes(2);
    expect(editModal()).not.toBeNull();
    expect(screen.getByLabelText("Nombre del dispositivo *")).toHaveValue("Nombre a medio escribir");
  });
});
