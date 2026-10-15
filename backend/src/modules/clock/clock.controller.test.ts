import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { clockController } from "./clock.controller";
import { timeEntriesService } from "../time-entries/timeEntries.service";
import { clearTimeEntriesReadCaches } from "../time-entries/timeEntries.cache";
import { clearEmployeeReadCaches, clearEmployeeTimeGridCache } from "../employees/employees.controller";

vi.mock("../time-entries/timeEntries.service", () => ({
  timeEntriesService: { clockPhotoPunchIdempotent: vi.fn(), clockPunchAttemptStatus: vi.fn() },
}));
vi.mock("../time-entries/timeEntries.cache", () => ({ clearTimeEntriesReadCaches: vi.fn() }));
vi.mock("../employees/employees.controller", () => ({ clearEmployeeReadCaches: vi.fn(), clearEmployeeTimeGridCache: vi.fn() }));

const service = timeEntriesService as unknown as { clockPhotoPunchIdempotent: Mock; clockPunchAttemptStatus: Mock };
const kioskDevice = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", status: "ACTIVE", name: "Recepción" } as const;

function kioskReq(overrides: Partial<Request> = {}): Request {
  return { body: {}, params: {}, query: {}, ip: "127.0.0.1", get: () => "kiosk-agent", clockDevice: kioskDevice, ...overrides } as unknown as Request;
}

function fakeRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  service.clockPhotoPunchIdempotent.mockResolvedValue({ workShift: { id: "shift-1" } });
  service.clockPunchAttemptStatus.mockResolvedValue({ status: "COMPLETED" });
});

describe("clockController.photoPunch — origen decidido por la ruta y la autenticación (F6/F7)", () => {
  it("pasa al servicio el dispositivo autenticado y el source KIOSK (único canal desde F11)", async () => {
    await clockController.photoPunch(kioskReq(), fakeRes());
    expect(service.clockPhotoPunchIdempotent).toHaveBeenCalledWith(
      expect.anything(),
      { device: { id: kioskDevice.id, name: kioskDevice.name }, source: "KIOSK" },
      expect.objectContaining({ userId: null, ipAddress: "127.0.0.1", userAgent: "kiosk-agent" }),
    );
  });

  it("un deviceId o source del body no cambian el origen", async () => {
    await clockController.photoPunch(kioskReq({ body: { deviceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", source: "ADMIN" } }), fakeRes());
    const [, origin] = service.clockPhotoPunchIdempotent.mock.calls[0]!;
    expect(origin).toEqual({ device: { id: kioskDevice.id, name: kioskDevice.name }, source: "KIOSK" });
  });

  it("sin req.clockDevice (ruta mal montada) falla cerrado con 401 y no llama al servicio", async () => {
    await expect(clockController.photoPunch(kioskReq({ clockDevice: undefined }), fakeRes())).rejects.toMatchObject({ statusCode: 401, code: "CLOCK_DEVICE_INVALID_CREDENTIAL" });
    expect(service.clockPhotoPunchIdempotent).not.toHaveBeenCalled();
  });

  // Etapa 15M.2: una salida genera TimeEntry → se invalida la grilla
  // por-legajo además de time-entries, sin ampliar a todo employees (14C.2).
  it("limpia time-entries y sólo la grilla horaria del empleado, y responde 201", async () => {
    const res = fakeRes();
    await clockController.photoPunch(kioskReq(), res);
    expect(clearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
    expect(clearEmployeeTimeGridCache).toHaveBeenCalledTimes(1);
    expect(clearEmployeeReadCaches).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe("clockController.attemptStatus", () => {
  it("consulta en nombre del dispositivo autenticado", async () => {
    await clockController.attemptStatus(kioskReq({ params: { requestId: "req-1" }, query: { employeeId: "emp-1" } }), fakeRes());
    expect(service.clockPunchAttemptStatus).toHaveBeenCalledWith("req-1", "emp-1", kioskDevice.id);
  });

  it("exige employeeId", async () => {
    await expect(clockController.attemptStatus(kioskReq({ params: { requestId: "req-1" } }), fakeRes())).rejects.toMatchObject({ statusCode: 400, code: "CLOCK_ATTEMPT_EMPLOYEE_REQUIRED" });
  });
});
