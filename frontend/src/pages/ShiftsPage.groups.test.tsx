/**
 * R3.2 (SHIFT_ROTATION_AUDIT_PLAN.md §23): pantalla de Turnos agrupada por
 * grupo (lugar). Incluye el estado real de development: 0 grupos y 15 turnos
 * sin grupo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ShiftsPage } from "./ShiftsPage";
import { workforceApiService, type ShiftTemplate } from "../services/api/workforceApiService";
import { shiftAssignmentApiService } from "../services/api/shiftAssignmentApiService";
import { shiftGroupApiService, type ShiftGroup } from "../services/api/shiftGroupApiService";

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
vi.mock("../services/api/shiftGroupApiService", () => ({ shiftGroupApiService: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } }));

const ROLES = { rrhh: "Nivel 1 - RRHH", supervision: "Nivel 2 - Supervisión / Gestión", carga: "Nivel 3 - Administrativo de Carga Horaria" };
function authAs(role: string) {
  mockUseAuth.mockReturnValue({ user: { id: "u1", name: "Usuario", email: "u@test.com", password: "", role, status: "Activo" }, login: vi.fn(), loginAs: vi.fn(), logout: vi.fn() });
}

function group(id: string, name: string, sortOrder: number, status: "ACTIVO" | "INACTIVO" = "ACTIVO", templateCount = 0): ShiftGroup {
  return { id, code: name.toUpperCase(), name, sortOrder, status, templateCount, createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z" };
}
function template(code: string, name: string, owner: ShiftGroup | null = null, categoryName: string | null = null): ShiftTemplate {
  return {
    id: code,
    code,
    name,
    categoryName,
    shiftGroupId: owner?.id ?? null,
    shiftGroup: owner ? { id: owner.id, code: owner.code, name: owner.name, status: owner.status, sortOrder: owner.sortOrder } : null,
    startTime: "07:00",
    endTime: "15:00",
    crossesMidnight: false,
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 10,
    exitToleranceAfterMinutes: 10,
    absoluteOpenShiftLimitMinutes: 1200,
    status: "ACTIVO",
  };
}

const DEVELOPMENT: Array<[string, string, string]> = [
  ["01 Obra", "Obra", "Obra"], ["02Prueba", "02 Prueba", "Prueba"], ["Granja-01", "Granja 01", "Granja"], ["Granja-02", "Granja 02", "Granja 02"], ["Granja-03", "Granja 03", "Granja"],
  ["MA-01", "Medio Ambiente", "Medio Ambiente"], ["Oficina-01", "Oficina 01", "Administrativo"], ["Oficina-02", "Oficina 02", "Administrativo"], ["Planta-01", "Planta 01", "Planta"], ["Planta-02", "Planta 02", "Planta"],
  ["Prueba", "Prueba", "Prueba"], ["Sereno-01", "Sereno 01", "Sereno"], ["Sereno-02", "Sereno 02", "Sereno"], ["Taller-01", "Taller 01", "Taller"], ["Taller-02", "Taller 02", "Taller"],
];

// Títulos de sección en el orden real del documento.
const sectionTitles = () => [...document.querySelectorAll(".shift-group-toggle")].map((button) => button.textContent);
const renderPage = () => render(<MemoryRouter><ShiftsPage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  authAs(ROLES.rrhh);
  vi.mocked(shiftAssignmentApiService.getSummary).mockResolvedValue([]);
});

describe("estado actual de development: 0 grupos, 15 turnos", () => {
  beforeEach(() => {
    vi.mocked(workforceApiService.shiftTemplates).mockResolvedValue(DEVELOPMENT.map(([code, name, category]) => template(code, name, null, category)));
    vi.mocked(shiftGroupApiService.list).mockResolvedValue([]);
  });

  it("muestra los 15 turnos en «Sin grupo», con la categoría como dato secundario y sin errores", async () => {
    renderPage();
    const section = await screen.findByRole("region", { name: "Sin grupo" });
    expect(within(section).getByText("15 turnos")).toBeInTheDocument();
    expect(within(section).getByText("Turnos todavía no clasificados en un lugar. Siguen funcionando igual.")).toBeInTheDocument();
    const rows = within(section).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(15);
    expect(within(rows[6]!).getByText("Oficina 01")).toBeInTheDocument();
    expect(within(rows[6]!).getByText("Administrativo")).toHaveClass("shift-category-cell");
    expect(sectionTitles()).toEqual(["Sin grupo"]);
    expect(screen.getByText("Aún no hay grupos configurados. Los turnos se muestran en «Sin grupo».")).toBeInTheDocument();
    expect(screen.queryByText(/No pudimos/)).not.toBeInTheDocument();
  });

  it("RRHH ve «Administrar grupos» y el CTA de crear grupo", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Administrar grupos" }));
    expect(screen.getByRole("heading", { name: "Grupos de turnos" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Crear grupo/ }).length).toBeGreaterThan(0);
  });

  it.each([ROLES.supervision, ROLES.carga])("%s ve la agrupación y la información, sin acciones de administración", async (role) => {
    authAs(role);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("region", { name: "Sin grupo" });
    expect(screen.getByText("Aún no hay grupos configurados. Los turnos se muestran en «Sin grupo».")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Administrar grupos" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Grupos" }));
    expect(screen.getByText("Aún no hay grupos configurados. Los turnos se muestran en «Sin grupo».")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Crear grupo/ })).not.toBeInTheDocument();
  });
});

describe("con grupos", () => {
  const OFICINA = group("g-of", "Oficina", 10, "ACTIVO", 2);
  const PLANTA = group("g-pl", "Planta", 20, "ACTIVO", 1);
  const GRANJA = group("g-gr", "Granja", 20, "ACTIVO", 0);
  const TALLER = group("g-ta", "Taller", 5, "INACTIVO", 1);

  beforeEach(() => {
    vi.mocked(workforceApiService.shiftTemplates).mockResolvedValue([
      template("Planta-01", "Planta 01", PLANTA),
      template("Sereno-01", "Sereno 01", null, "Sereno"),
      template("Oficina-01", "Oficina 01", OFICINA, "Administrativo"),
      template("Oficina-02", "Oficina 02", OFICINA, "Administrativo"),
      template("Taller-01", "Taller 01", TALLER),
    ]);
    vi.mocked(shiftGroupApiService.list).mockResolvedValue([PLANTA, TALLER, GRANJA, OFICINA]);
  });

  it("ordena por sortOrder y nombre, después «Sin grupo» y al final los inactivos (colapsados)", async () => {
    renderPage();
    await screen.findByRole("region", { name: "Oficina" });
    expect(sectionTitles()).toEqual(["Oficina", "Granja", "Planta", "Sin grupo", "Taller"]);
    expect(within(screen.getByRole("region", { name: "Oficina" })).getByText("2 turnos")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Granja" })).getByText("Este grupo todavía no tiene turnos asociados.")).toBeInTheDocument();
    const taller = screen.getByRole("region", { name: "Taller" });
    expect(within(taller).getByText("Grupo inactivo")).toBeInTheDocument();
    expect(within(taller).getByRole("button", { name: "Taller" })).toHaveAttribute("aria-expanded", "false");
    expect(within(taller).queryByText("Taller 01")).not.toBeInTheDocument();
  });

  it("las secciones se pliegan y despliegan", async () => {
    const user = userEvent.setup();
    renderPage();
    const toggle = within(await screen.findByRole("region", { name: "Oficina" })).getByRole("button", { name: "Oficina" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Oficina 01")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText("Oficina 01")).toBeInTheDocument();
  });

  it("filtro por grupo y por «Sin grupo»; con filtros no se muestran grupos vacíos", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("region", { name: "Oficina" });
    await user.selectOptions(screen.getByLabelText("Grupo"), "__none__");
    expect(sectionTitles()).toEqual(["Sin grupo"]);
    await user.selectOptions(screen.getByLabelText("Grupo"), "g-pl");
    expect(sectionTitles()).toEqual(["Planta"]);
    expect(within(screen.getByLabelText("Grupo")).getByRole("option", { name: "Taller (inactivo)" })).toBeInTheDocument();
  });

  it("la búsqueda también encuentra por nombre de grupo", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("region", { name: "Oficina" });
    await user.type(screen.getByPlaceholderText("Código, nombre o categoría"), "planta");
    expect(sectionTitles()).toEqual(["Planta"]);
  });

  it("si falla la carga de grupos, los turnos se siguen viendo agrupados y se avisa (sin ocultar el error)", async () => {
    vi.mocked(shiftGroupApiService.list).mockRejectedValue(new Error("network"));
    renderPage();
    await screen.findByText("No pudimos cargar la lista de grupos.");
    expect(sectionTitles()).toEqual(["Oficina", "Planta", "Sin grupo", "Taller"]);
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
