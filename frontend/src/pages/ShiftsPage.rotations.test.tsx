/**
 * R4.8A: pestaña "Rotaciones" de Turnos (listado, filtros, alta y permisos).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ShiftsPage } from "./ShiftsPage";
import { workforceApiService } from "../services/api/workforceApiService";
import { shiftAssignmentApiService } from "../services/api/shiftAssignmentApiService";
import { shiftGroupApiService } from "../services/api/shiftGroupApiService";
import { shiftRotationApiService } from "../services/api/shiftRotationApiService";
import { ApiError } from "../services/api/apiClient";
import { OFICINA_GROUP, PLANTA_GROUP, rotationFixture } from "../test/shiftRotationFixtures";

vi.mock("../services/appDialog", () => ({ confirmAction: vi.fn().mockResolvedValue(true) }));
const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("../services/api/workforceApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/workforceApiService")>();
  return { ...actual, workforceApiService: { ...actual.workforceApiService, shiftTemplates: vi.fn(), updateShiftTemplate: vi.fn() } };
});
vi.mock("../services/api/shiftAssignmentApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/shiftAssignmentApiService")>();
  return { ...actual, shiftAssignmentApiService: { ...actual.shiftAssignmentApiService, getSummary: vi.fn() } };
});
vi.mock("../services/api/shiftGroupApiService", () => ({ shiftGroupApiService: { list: vi.fn() } }));
vi.mock("../services/api/shiftRotationApiService", () => ({ shiftRotationApiService: { list: vi.fn(), create: vi.fn() } }));

function authAs(role: string, groupIds: string[] = []) {
  mockUseAuth.mockReturnValue({ user: { id: "u1", name: "Usuario", email: "u@test.com", password: "", role, status: "Activo", shiftGroupAccess: { all: false, groupIds } }, refreshShiftGroupAccess: vi.fn() });
}

function DetailProbe() {
  const location = useLocation();
  const state = location.state as { created?: boolean } | null;
  return <p>Detalle {location.pathname} {state?.created ? "creada" : ""}</p>;
}

const renderPage = (path = "/configuracion/turnos?vista=rotaciones") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/configuracion/turnos" element={<ShiftsPage />} />
        <Route path="/configuracion/turnos/rotaciones/:id" element={<DetailProbe />} />
      </Routes>
    </MemoryRouter>,
  );

const ACTIVE = rotationFixture({
  id: "rot-1", code: "PLANTA-4X4", name: "Planta 4x4", status: "ACTIVO", health: "WARNING",
  versions: [{ id: "v1", effectiveFrom: "2026-11-01", effectiveTo: null, cycleLengthWeeks: 2, anchorWeekStart: "2026-11-02", locked: true, inEffectToday: true, dayCount: 28, updatedAt: "2026-11-01T00:00:00Z" }],
  members: [{ id: "m1", crewId: "crew-a", crew: "A - Equipo A", employeeId: "e1", legajo: "19", employee: "Pérez, Ana · Legajo 19", employeeStatus: "ACTIVO", effectiveFrom: "2026-11-01", effectiveTo: null }],
});
const DRAFT = rotationFixture({ id: "rot-2", code: "OFI-AB", name: "Oficina A/B", health: "ERROR", shiftGroup: { id: OFICINA_GROUP.id, code: "OFICINA", name: "Oficina", status: "ACTIVO" } });

beforeEach(() => {
  vi.clearAllMocks();
  authAs("Nivel 1 - RRHH");
  vi.mocked(workforceApiService.shiftTemplates).mockResolvedValue([]);
  vi.mocked(shiftAssignmentApiService.getSummary).mockResolvedValue([]);
  vi.mocked(shiftGroupApiService.list).mockResolvedValue([PLANTA_GROUP, OFICINA_GROUP]);
  vi.mocked(shiftRotationApiService.list).mockResolvedValue([ACTIVE, DRAFT]);
});

describe("pestaña Rotaciones", () => {
  it("se abre desde la URL y no carga rotaciones en las otras pestañas", async () => {
    renderPage("/configuracion/turnos");
    expect(await screen.findByRole("tab", { name: "Turnos por grupo" })).toHaveAttribute("aria-selected", "true");
    expect(shiftRotationApiService.list).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Rotaciones" }));
    expect(await screen.findByRole("heading", { name: "Rotaciones de turnos" })).toBeInTheDocument();
    expect(shiftRotationApiService.list).toHaveBeenCalledTimes(1);
  });

  it("lista por orden de grupo con estado, diagnóstico, personas y versión, sin códigos internos", async () => {
    renderPage();
    const rows = await screen.findAllByRole("row");
    const body = rows.slice(1);
    expect(body).toHaveLength(2);
    // Oficina (orden 10) antes que Planta (orden 20).
    expect(within(body[0]!).getByText("OFI-AB")).toBeInTheDocument();
    expect(within(body[0]!).getByText("Inactiva")).toBeInTheDocument();
    expect(within(body[0]!).getByText("Requiere correcciones")).toBeInTheDocument();
    expect(within(body[1]!).getByText("Activa")).toBeInTheDocument();
    expect(within(body[1]!).getByText("Con advertencias")).toBeInTheDocument();
    expect(within(body[1]!).getByText("Desde el 01/11/2026")).toBeInTheDocument();
    expect(within(body[1]!).getByRole("link", { name: "Ver detalle de Planta 4x4" })).toHaveAttribute("href", "/configuracion/turnos/rotaciones/rot-1");
    expect(document.body.textContent).not.toMatch(/\b(ACTIVO|INACTIVO|WARNING|ERROR)\b/);
  });

  it("filtra por estado, grupo y búsqueda", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("OFI-AB");
    await user.selectOptions(screen.getByLabelText("Estado"), "ACTIVE");
    expect(screen.queryByText("OFI-AB")).not.toBeInTheDocument();
    expect(screen.getByText("PLANTA-4X4")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Estado"), "");
    await user.selectOptions(screen.getByLabelText("Grupo"), OFICINA_GROUP.id);
    expect(screen.queryByText("PLANTA-4X4")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Grupo"), "");
    await user.type(screen.getByPlaceholderText("Código, nombre o grupo"), "zzz");
    expect(screen.getByText("Ninguna rotación coincide con los filtros aplicados.")).toBeInTheDocument();
  });

  it("sin rotaciones: RRHH ve un único CTA de alta", async () => {
    vi.mocked(shiftRotationApiService.list).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Todavía no hay rotaciones configuradas/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Crear rotación/ })).toHaveLength(1);
  });

  it("error de carga localizado con reintento", async () => {
    vi.mocked(shiftRotationApiService.list).mockRejectedValueOnce(new Error("network"));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByText("PLANTA-4X4")).toBeInTheDocument();
  });

  it("alta: valida en línea, envía normalizado y abre el detalle", async () => {
    vi.mocked(shiftRotationApiService.create).mockResolvedValue(rotationFixture({ id: "rot-new" }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Crear rotación/ }));
    const dialog = screen.getByRole("dialog", { name: "Crear rotación" });
    await user.click(within(dialog).getByRole("button", { name: "Crear rotación" }));
    expect(within(dialog).getByText("Ingresá un código.")).toBeInTheDocument();
    expect(within(dialog).getByText("Elegí el grupo de la rotación.")).toBeInTheDocument();
    expect(shiftRotationApiService.create).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText("Código *"), "  planta  b ");
    await user.type(within(dialog).getByLabelText("Nombre *"), "Planta   B");
    await user.selectOptions(within(dialog).getByLabelText("Grupo (lugar) *"), PLANTA_GROUP.id);
    await user.click(within(dialog).getByRole("button", { name: "Crear rotación" }));
    expect(shiftRotationApiService.create).toHaveBeenCalledWith({ code: "PLANTA B", name: "Planta B", shiftGroupId: PLANTA_GROUP.id, observation: null });
    expect(await screen.findByText(/Detalle \/configuracion\/turnos\/rotaciones\/rot-new creada/)).toBeInTheDocument();
  });

  it("alta: un conflicto del backend se muestra dentro del modal", async () => {
    vi.mocked(shiftRotationApiService.create).mockRejectedValue(new ApiError("Ya existe una rotación con ese código.", "ROTATION_DUPLICATE", 409));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Crear rotación/ }));
    const dialog = screen.getByRole("dialog", { name: "Crear rotación" });
    await user.type(within(dialog).getByLabelText("Código *"), "PLANTA-4X4");
    await user.type(within(dialog).getByLabelText("Nombre *"), "Planta");
    await user.selectOptions(within(dialog).getByLabelText("Grupo (lugar) *"), PLANTA_GROUP.id);
    await user.click(within(dialog).getByRole("button", { name: "Crear rotación" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Ya existe una rotación con ese código.");
  });

  it.each(["Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"])("R8: %s sin grupos no ve rotaciones ni puede crear", async (role) => {
    authAs(role);
    renderPage();
    expect(await screen.findByText(/Todavía no tenés grupos de turnos para administrar/)).toBeInTheDocument();
    expect(screen.queryByText("PLANTA-4X4")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Crear rotación/ })).not.toBeInTheDocument();
  });

  it.each(["Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"])("R8: %s con su grupo ve sus rotaciones y puede crear", async (role) => {
    authAs(role, [PLANTA_GROUP.id]);
    renderPage();
    expect(await screen.findByText("PLANTA-4X4")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Crear rotación/ }).length).toBeGreaterThan(0);
  });
});
