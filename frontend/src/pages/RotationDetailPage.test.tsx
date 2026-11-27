/**
 * R4.8A: detalle de una rotación (datos, configuración, diagnóstico, edición
 * y eliminación).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { RotationDetailPage } from "./RotationDetailPage";
import { shiftGroupApiService } from "../services/api/shiftGroupApiService";
import { shiftRotationApiService } from "../services/api/shiftRotationApiService";
import { ApiError } from "../services/api/apiClient";
import { confirmAction } from "../services/appDialog";
import { OFICINA_GROUP, PLANTA_GROUP, rotationFixture } from "../test/shiftRotationFixtures";
import { previewBlock, previewCell, previewResponse, previewRow } from "../test/shiftRotationPreviewFixtures";

vi.mock("../services/appDialog", () => ({ confirmAction: vi.fn().mockResolvedValue(true) }));
const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("../services/api/shiftGroupApiService", () => ({ shiftGroupApiService: { list: vi.fn() } }));
vi.mock("../services/api/shiftRotationApiService", () => ({ shiftRotationApiService: { detail: vi.fn(), update: vi.fn(), remove: vi.fn(), version: vi.fn(), preview: vi.fn() } }));

function authAs(role: string, groupIds: string[] = []) {
  mockUseAuth.mockReturnValue({ user: { id: "u1", name: "Usuario", email: "u@test.com", password: "", role, status: "Activo", shiftGroupAccess: { all: false, groupIds } }, refreshShiftGroupAccess: vi.fn() });
}

function ListProbe() {
  const location = useLocation();
  const state = location.state as { notice?: string } | null;
  return <p>Listado {location.search} {state?.notice}</p>;
}

const renderPage = (state?: unknown, search = "") =>
  render(
    <MemoryRouter initialEntries={[{ pathname: "/configuracion/turnos/rotaciones/rot-1", search, state }]}>
      <Routes>
        <Route path="/configuracion/turnos/rotaciones/:id" element={<RotationDetailPage />} />
        <Route path="/configuracion/turnos" element={<ListProbe />} />
      </Routes>
    </MemoryRouter>,
  );

const WITH_ISSUES = rotationFixture({
  status: "ACTIVO",
  hasRuled: true,
  health: "ERROR",
  observation: "Piloto de Planta.",
  crews: [{ id: "crew-a", code: "A", name: "Equipo A", sortOrder: 0, status: "ACTIVO", openMemberCount: 1, everHadMembers: true }],
  versions: [{ id: "v1", effectiveFrom: "2026-11-02", effectiveTo: null, cycleLengthWeeks: 2, anchorWeekStart: "2026-11-02", locked: true, inEffectToday: true, dayCount: 14, updatedAt: "2026-11-02T00:00:00Z" }],
  issues: [
    { code: "SIN_TURNO_OVERLAP", severity: "ERROR", employeeId: "e1", message: "Pérez, Ana · Legajo 19 tiene régimen SIN_TURNO desde el 01/12/2026, incompatible con una rotación." },
    { code: "EMPLOYEE_INACTIVE", severity: "WARNING", employeeId: "e2", message: "Gómez, Luis · Legajo 21 está inactivo y conserva una membresía vigente o futura." },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  authAs("Nivel 1 - RRHH");
  vi.mocked(shiftGroupApiService.list).mockResolvedValue([PLANTA_GROUP, OFICINA_GROUP]);
  vi.mocked(shiftRotationApiService.detail).mockResolvedValue(rotationFixture());
});

describe("detalle de rotación", () => {
  it("muestra datos, configuración y aviso de rotación inactiva", async () => {
    renderPage({ created: true });
    expect(await screen.findByRole("heading", { level: 1, name: "Planta 4x4" })).toBeInTheDocument();
    expect(screen.getByText("Rotación creada.")).toHaveClass("toast");
    expect(screen.getByText(/todavía no genera horarios ni obligaciones/)).toBeInTheDocument();
    expect(screen.getByText("2 de 2")).toBeInTheDocument();
    expect(screen.getByText("Sin grilla configurada")).toBeInTheDocument();
    expect(screen.getByText("La configuración no tiene observaciones.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Volver a rotaciones/ })).toHaveAttribute("href", "/configuracion/turnos?vista=rotaciones");
  });

  it("presenta el diagnóstico con títulos para RRHH, errores primero y sin códigos internos", async () => {
    vi.mocked(shiftRotationApiService.detail).mockResolvedValue(WITH_ISSUES);
    renderPage();
    const diagnostics = (await screen.findByRole("heading", { name: "Diagnóstico" })).closest("section")!;
    const items = within(diagnostics).getAllByRole("listitem").filter((item) => item.classList.contains("rotation-issue"));
    expect(items[0]).toHaveTextContent("Error: Régimen sin turno superpuesto");
    expect(items[0]).toHaveTextContent("régimen «Sin turno obligatorio» desde el 01/12/2026");
    expect(items[1]).toHaveTextContent("Advertencia: Persona inactiva con asignación");
    expect(within(diagnostics).getByText("Hay errores en la configuración que se deben corregir.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SIN_TURNO|EMPLOYEE_INACTIVE|crew-a|e1/);
    expect(screen.getByText("2 semanas (A y B)")).toBeInTheDocument();
  });

  it("una rotación que ya rigió no ofrece eliminar y bloquea código y grupo al editar", async () => {
    vi.mocked(shiftRotationApiService.detail).mockResolvedValue(WITH_ISSUES);
    vi.mocked(shiftRotationApiService.update).mockResolvedValue({ ...WITH_ISSUES, name: "Planta piloto" });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Planta 4x4" });
    expect(screen.queryByRole("button", { name: /Eliminar rotación/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Editar datos/ }));
    const dialog = screen.getByRole("dialog", { name: "Editar rotación" });
    expect(within(dialog).getByLabelText("Código *")).toBeDisabled();
    expect(within(dialog).getByText("No se puede cambiar: la rotación ya rigió.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Grupo (lugar) *")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    const name = within(dialog).getByLabelText("Nombre *");
    await user.clear(name);
    await user.type(name, "Planta piloto");
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(shiftRotationApiService.update).toHaveBeenCalledWith("rot-1", { name: "Planta piloto" });
    expect(await screen.findByRole("heading", { level: 1, name: "Planta piloto" })).toBeInTheDocument();
    expect(screen.getByText("Cambios guardados.")).toHaveClass("toast");
  });

  it("eliminar pide confirmación y vuelve al listado con aviso", async () => {
    vi.mocked(shiftRotationApiService.remove).mockResolvedValue({});
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Eliminar rotación" }));
    expect(confirmAction).toHaveBeenCalled();
    expect(shiftRotationApiService.remove).toHaveBeenCalledWith("rot-1");
    expect(await screen.findByText(/Listado \?vista=rotaciones Rotación eliminada\./)).toBeInTheDocument();
  });

  it("un rechazo al eliminar se muestra en la página, sin códigos", async () => {
    vi.mocked(shiftRotationApiService.remove).mockRejectedValue(new ApiError("La rotación PLANTA-4X4 - Planta 4x4 tiene membresías. Cancelalas antes de eliminarla.", "ROTATION_HAS_MEMBERS", 409));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Eliminar rotación" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("tiene membresías. Cancelalas antes de eliminarla.");
  });

  it("404: informa que no existe, sin reintento inútil", async () => {
    vi.mocked(shiftRotationApiService.detail).mockRejectedValue(new ApiError("No existe", "ROTATION_NOT_FOUND", 404));
    renderPage();
    expect(await screen.findByText("No encontramos la rotación. Puede haber sido eliminada.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reintentar/ })).not.toBeInTheDocument();
  });

  it("la pestaña «Equipos y grilla» se abre desde la URL y las pestañas son accesibles", async () => {
    const user = userEvent.setup();
    renderPage(undefined, "?vista=equipos");
    expect(await screen.findByRole("tab", { name: "Equipos y grilla" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Equipos" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Grilla del ciclo" })).toBeInTheDocument();
    expect(screen.getByText(/todavía no tiene grilla/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Resumen" }));
    expect(screen.getByRole("heading", { name: "Diagnóstico" })).toBeInTheDocument();
  });

  it.each(["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"])("%s consulta la vista previa en sólo lectura", async (role) => {
    authAs(role);
    vi.mocked(shiftRotationApiService.preview).mockResolvedValue(previewResponse([previewRow("e1", "Gómez", "José", "19", [previewCell("2026-11-23", { blocks: [previewBlock("2026-11-23", "P-0715", "07:00", "15:00")] })])], { from: "2026-11-23", days: 1 }));
    renderPage(undefined, "?vista=vista-previa");
    expect(await screen.findByRole("tab", { name: "Vista previa" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("grid")).toBeInTheDocument();
    expect(screen.getByText("Esta es una simulación. La rotación está inactiva y no genera obligaciones reales.")).toBeInTheDocument();
  });

  it("Nivel 3 ve el detalle sin acciones", async () => {
    authAs("Nivel 3 - Administrativo de Carga Horaria");
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Planta 4x4" });
    expect(screen.queryByRole("button", { name: /Editar datos/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Eliminar rotación/ })).not.toBeInTheDocument();
  });

  describe("R8: alcance por grupo", () => {
    it("Nivel 2 con el grupo de la rotación la administra", async () => {
      authAs("Nivel 2 - Supervisión / Gestión", [PLANTA_GROUP.id]);
      renderPage();
      await screen.findByRole("heading", { level: 1, name: "Planta 4x4" });
      expect(screen.getByRole("button", { name: /Editar datos/ })).toBeInTheDocument();
    });

    it("Nivel 3 con otro grupo no ve acciones (el backend igual la rechaza)", async () => {
      authAs("Nivel 3 - Administrativo de Carga Horaria", ["g-otro"]);
      renderPage();
      await screen.findByRole("heading", { level: 1, name: "Planta 4x4" });
      expect(screen.queryByRole("button", { name: /Editar datos/ })).not.toBeInTheDocument();
    });

    it("avisa cuántas personas quedan fuera del alcance de legajos y qué operaciones las afectan", async () => {
      authAs("Nivel 2 - Supervisión / Gestión", [PLANTA_GROUP.id]);
      vi.mocked(shiftRotationApiService.detail).mockResolvedValue(rotationFixture({ hiddenMemberCount: 2 }));
      renderPage();
      const note = await screen.findByText("2 personas de esta rotación están fuera de tu alcance de legajos.");
      expect(note.closest("[role='note']")).toHaveTextContent("Activar, desactivar, finalizar o cambiar la grilla");
      // El backend lo rechazaría (403): no se ofrece.
      expect(screen.getByRole("button", { name: /Activar/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Editar datos/ })).toBeEnabled();
    });

    it("vista previa: un bloque de otro grupo se muestra con su horario y «Otro grupo», sin código", async () => {
      authAs("Nivel 2 - Supervisión / Gestión", [PLANTA_GROUP.id]);
      const hidden = { ...previewBlock("2026-11-23", "T-0816", "08:00", "16:00", 0, "FIXED_ASSIGNMENT"), template: { id: null, code: null, startTime: "08:00", endTime: "16:00", crossesMidnight: false }, templateHidden: true as const };
      vi.mocked(shiftRotationApiService.preview).mockResolvedValue(previewResponse([previewRow("e1", "Gómez", "José", "19", [previewCell("2026-11-23", { kind: "FIXED_ASSIGNMENT", blocks: [hidden] })])], { from: "2026-11-23", days: 1 }));
      renderPage(undefined, "?vista=vista-previa");
      const grid = await screen.findByRole("grid");
      expect(within(grid).getByText(/Otro grupo/)).toBeInTheDocument();
      expect(within(grid).getByText(/08:00–16:00/)).toBeInTheDocument();
      expect(grid.textContent).not.toContain("null");
    });
  });
});
