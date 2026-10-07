import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/api/clockDeviceApiService", () => ({
  clockDeviceApiService: { list: vi.fn(), resolvePairing: vi.fn(), activate: vi.fn(), revoke: vi.fn(), deletePending: vi.fn() },
}));
vi.mock("../services/api/orgStructureApiService", () => ({ orgStructureApiService: { getCatalog: vi.fn() } }));
vi.mock("../services/appDialog", () => ({ confirmAction: vi.fn().mockResolvedValue(true) }));

import { clockDeviceApiService } from "../services/api/clockDeviceApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { ClockDevicesPage } from "./ClockDevicesPage";

const pending = { id: "device-1", name: null, status: "PENDING" as const, sectorId: null, sector: null, activatedAt: null, revokedAt: null, lastSeenAt: "2026-10-06T12:00:00Z", lastIp: null, lastUserAgent: null, lastAppVersion: "0.1.0", createdAt: "2026-10-06T11:00:00Z", updatedAt: "2026-10-06T11:00:00Z" };

describe("ClockDevicesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clockDeviceApiService.list).mockResolvedValue({ data: [pending], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    vi.mocked(clockDeviceApiService.resolvePairing).mockResolvedValue(pending);
    vi.mocked(clockDeviceApiService.activate).mockResolvedValue({ ...pending, name: "iPad Recepción", status: "ACTIVE" });
    vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue({ sectors: [{ id: "sector-1", code: "REC", name: "Recepción", status: "ACTIVO", areaId: "area-1" }], companies: [], businessUnits: [], establishments: [], areas: [], zones: [], costCenters: [] });
  });

  it("aprueba en dos pasos: código, metadata, nombre/sector y activación", async () => {
    const user = userEvent.setup();
    render(<ClockDevicesPage />);
    await screen.findByText("Solicitud pendiente");
    await user.click(screen.getAllByRole("button", { name: "Aprobar dispositivo" }).at(-1)!);
    await user.type(screen.getByLabelText("Código de vinculación"), "ABCD-2345");
    await user.click(screen.getByRole("button", { name: "Verificar código" }));
    await screen.findByText("Solicitud encontrada");
    expect(clockDeviceApiService.resolvePairing).toHaveBeenCalledWith("ABCD-2345");
    await user.type(screen.getByLabelText("Nombre del dispositivo *"), "iPad Recepción");
    await user.selectOptions(screen.getByLabelText("Sector (opcional)"), "sector-1");
    await user.click(screen.getAllByRole("button", { name: "Aprobar dispositivo" }).at(-1)!);
    await waitFor(() => expect(clockDeviceApiService.activate).toHaveBeenCalledWith("device-1", { pairingCode: "ABCD-2345", name: "iPad Recepción", sectorId: "sector-1" }));
  });

  it("la tabla traduce estados y no expone el identificador técnico", async () => {
    render(<ClockDevicesPage />);
    expect(await screen.findByText("Pendiente")).toBeVisible();
    expect(screen.queryByText("PENDING")).not.toBeInTheDocument();
    expect(screen.queryByText("device-1")).not.toBeInTheDocument();
  });
});
