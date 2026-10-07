import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmployeeWorkLocationsPanel } from "./EmployeeWorkLocationsPanel";
import { employeeWorkLocationApiService } from "../../../services/api/employeeWorkLocationApiService";
import { orgStructureApiService } from "../../../services/api/orgStructureApiService";
import { ApiError } from "../../../services/api/apiClient";
import type { EmployeeWorkLocation } from "../../../types/employeeWorkLocation.types";

vi.mock("../../../services/api/employeeWorkLocationApiService", () => ({
  employeeWorkLocationApiService: { list: vi.fn(), create: vi.fn(), change: vi.fn(), end: vi.fn(), correct: vi.fn() },
}));
vi.mock("../../../services/api/orgStructureApiService", () => ({ orgStructureApiService: { getCatalog: vi.fn() } }));
vi.mock("../../../services/api/employeeHistoryApiService", () => ({ employeeHistoryApiService: { getBlockHistory: vi.fn().mockResolvedValue([]) } }));

const node = (id: string, name: string) => ({ id, code: id.toUpperCase(), name, status: "ACTIVO" as const });
const catalog = {
  companies: [], businessUnits: [], sectors: [], areas: [], costCenters: [],
  zones: [node("north", "Zona Norte"), node("south", "Zona Sur")],
  establishments: [{ ...node("e1", "Campo La Esperanza"), zoneId: "north" }, { ...node("e2", "Campo El Ombú"), zoneId: "north" }, { ...node("e4", "Planta Sur"), zoneId: "south" }],
};
const rows: EmployeeWorkLocation[] = [
  { id: "loc-1", zone: node("north", "Zona Norte"), establishments: [node("e1", "Campo La Esperanza"), node("e2", "Campo El Ombú")], effectiveFrom: "2026-01-01", effectiveTo: null, state: "CURRENT", reason: "Asignación inicial", notes: null, createdAt: "", createdByName: "RRHH" },
  { id: "loc-2", zone: node("south", "Zona Sur"), establishments: [node("e4", "Planta Sur")], effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31", state: "ENDED", reason: "Temporada", notes: null, createdAt: "", createdByName: "RRHH" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(employeeWorkLocationApiService.list).mockResolvedValue(rows);
  vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue(catalog as never);
});

describe("EmployeeWorkLocationsPanel", () => {
  it("muestra varias zonas con sus establecimientos, vigencia y estado", async () => {
    render(<EmployeeWorkLocationsPanel employeeId="emp-1" canEdit={false} />);

    expect(await screen.findByText("1 zona vigente · 2 registros en total")).toBeInTheDocument();
    const [current, ended] = screen.getAllByRole("article");
    expect(within(current!).getByText("Zona Norte")).toBeInTheDocument();
    expect(within(current!).getByText("Vigente")).toBeInTheDocument();
    expect(within(current!).getByText("Desde 01/01/2026 · sin fecha de fin")).toBeInTheDocument();
    expect(within(current!).getByText("Campo El Ombú")).toBeInTheDocument();
    expect(within(ended!).getByText("Finalizada")).toBeInTheDocument();
    expect(within(ended!).getByText("01/01/2025 → 31/12/2025")).toBeInTheDocument();
  });

  it("sin permiso de edición no ofrece acciones de escritura", async () => {
    render(<EmployeeWorkLocationsPanel employeeId="emp-1" canEdit={false} />);

    await screen.findByText("Zona Norte");
    expect(screen.queryByRole("button", { name: "Agregar ubicación" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Corregir" })).not.toBeInTheDocument();
  });

  it("acciones por estado: la finalizada sólo se corrige", async () => {
    render(<EmployeeWorkLocationsPanel employeeId="emp-1" canEdit />);

    const [current, ended] = await screen.findAllByRole("article");
    expect(within(current!).getByRole("button", { name: "Cambiar desde…" })).toBeInTheDocument();
    expect(within(current!).getByRole("button", { name: "Finalizar" })).toBeInTheDocument();
    expect(within(ended!).queryByRole("button", { name: "Cambiar desde…" })).not.toBeInTheDocument();
    expect(within(ended!).queryByRole("button", { name: "Finalizar" })).not.toBeInTheDocument();
    expect(within(ended!).getByRole("button", { name: "Corregir" })).toBeInTheDocument();
  });

  it("alta: exige establecimientos explícitos, envía la selección y muestra el error del backend", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeWorkLocationApiService.create)
      .mockRejectedValueOnce(new ApiError("Se superpone con la ubicación en “Zona Sur”.", "WORK_LOCATION_OVERLAP", 409))
      .mockResolvedValueOnce(rows);
    render(<EmployeeWorkLocationsPanel employeeId="emp-1" canEdit />);

    await user.click(await screen.findByRole("button", { name: "Agregar ubicación" }));
    await user.selectOptions(screen.getByLabelText("Zona *"), "south");
    await user.type(screen.getByLabelText("Motivo *"), "Cosecha");
    await user.click(screen.getByRole("button", { name: "Guardar ubicación" }));
    expect(screen.getByRole("alert")).toHaveTextContent("zona completa");
    expect(employeeWorkLocationApiService.create).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox", { name: /Planta Sur/ }));
    expect(screen.queryByRole("checkbox", { name: /Campo La Esperanza/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar ubicación" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Se superpone con la ubicación en “Zona Sur”.");
    expect(employeeWorkLocationApiService.create).toHaveBeenCalledWith("emp-1", expect.objectContaining({ zoneId: "south", establishmentIds: ["e4"], effectiveTo: null, reason: "Cosecha" }));

    await user.click(screen.getByRole("button", { name: "Guardar ubicación" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Guardar ubicación" })).not.toBeInTheDocument());
  });
});
