import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { NoveltyTypeDetailPage } from "./NoveltyTypeDetailPage";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import type { NoveltyType } from "../types/noveltyType.types";

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));
function authAsRrhh() {
  mockUseAuth.mockReturnValue({
    user: { id: "user-1", name: "RRHH", email: "rrhh@test.com", password: "", role: "Nivel 1 - RRHH", status: "Activo" },
    login: vi.fn(),
    loginAs: vi.fn(),
    logout: vi.fn(),
  });
}

vi.mock("../services/appDialog", () => ({
  confirmAction: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/api/noveltyTypeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/noveltyTypeApiService")>();
  return {
    ...actual,
    noveltyTypeApiService: { ...actual.noveltyTypeApiService, getById: vi.fn(), update: vi.fn() },
  };
});

function buildNoveltyType(overrides: Partial<NoveltyType> = {}): NoveltyType {
  return {
    id: "nt-1",
    code: "NOV-001",
    name: "Vacaciones",
    description: "Licencia anual",
    kind: "VACACIONES",
    uiColor: "blue",
    status: "ACTIVO",
    finnegansCode: null,
    finnegansName: null,
    allowedLoadRoles: [],
    approvalRoles: [],
    rules: {
      exportsToFinnegans: false,
      requiresApproval: true,
      requiresDocumentation: false,
      allowsHours: false,
      timeEntryBehavior: "NO_BLOQUEA",
      allowsDateRange: true,
      finnegansValueUnit: null,
      finnegansRequiresValidity: false,
    },
    notes: "",
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    updatedBy: "",
    ...overrides,
  };
}

function renderPage(id = "nt-1") {
  return render(
    <MemoryRouter initialEntries={[`/configuracion/tipos-novedades/${id}`]}>
      <Routes>
        <Route path="/configuracion/tipos-novedades/:id" element={<NoveltyTypeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
});

// Etapa 15L.2B (docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md).
// Etapa 15M.20: se espera el <h1> (heading) por nombre en vez de un texto
// suelto "Vacaciones" -- desde 15M.20 la categoría "VACACIONES" se humaniza
// a "Vacaciones" en el <select> de Categoría, que con este fixture coincide
// textualmente con item.name; findByText("Vacaciones") pasaría a matchear
// ambos nodos.
describe("NoveltyTypeDetailPage — Etapa 15L.2B", () => {
  it("muestra sólo 3 pestañas (General/Reglas/Finnegans), sin Historial", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(buildNoveltyType());
    renderPage();

    await screen.findByRole("heading", { name: "Vacaciones" });
    expect(screen.getAllByText("General").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reglas").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Finnegans").length).toBeGreaterThan(0);
    expect(screen.queryByText("Historial")).not.toBeInTheDocument();
    expect(screen.queryByText("Todavía no hay historial registrado para este tipo de novedad.")).not.toBeInTheDocument();
  });

  it("sin exportsToFinnegans no muestra el badge Finnegans", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(buildNoveltyType({ rules: { ...buildNoveltyType().rules, exportsToFinnegans: false } }));
    renderPage();

    await screen.findByRole("heading", { name: "Vacaciones" });
    expect(screen.queryByText("Finnegans", { selector: "span.badge" })).not.toBeInTheDocument();
  });

  it("con exportsToFinnegans muestra el badge Finnegans en el header", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(
      buildNoveltyType({ rules: { ...buildNoveltyType().rules, exportsToFinnegans: true, finnegansValueUnit: "DAYS" }, finnegansCode: "VAC", finnegansName: "Vacaciones" }),
    );
    renderPage();

    await screen.findByRole("heading", { name: "Vacaciones" });
    expect(screen.getByText("Finnegans", { selector: "span.badge" })).toBeInTheDocument();
  });

  // Etapa 15L.6 (docs/decisions/NOVELTY_TYPE_LEGACY_REMOVAL_15L6.md):
  // FinnegansNoveltyLink (1:N) se retiró a favor de finnegansCode/
  // finnegansName (1:1 físico) -- ya no existe un escenario de "más de un
  // vínculo" para probar.
  it("muestra el código/nombre Finnegans configurados en el tab Finnegans", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(
      buildNoveltyType({ rules: { ...buildNoveltyType().rules, exportsToFinnegans: true, finnegansValueUnit: "DAYS" }, finnegansCode: "VAC2", finnegansName: "Vacaciones principal" }),
    );
    renderPage();

    await screen.findByRole("heading", { name: "Vacaciones" });
    await userEvent.click(screen.getByText("Finnegans", { selector: "button" }));

    expect(screen.getByDisplayValue("VAC2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Vacaciones principal")).toBeInTheDocument();
  });

  it("editar y guardar persiste los campos nuevos (timeEntryBehavior/notes)", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(buildNoveltyType());
    vi.mocked(noveltyTypeApiService.update).mockResolvedValue(buildNoveltyType({ notes: "Actualizado" }));
    renderPage();

    await screen.findByRole("heading", { name: "Vacaciones" });
    await userEvent.click(screen.getByText("Reglas", { selector: "button" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Comportamiento/ }), "Bloquea nueva carga horaria cuando la novedad está aprobada");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(noveltyTypeApiService.update).toHaveBeenCalledWith(
      "nt-1",
      expect.objectContaining({ rules: expect.objectContaining({ timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" }) }),
    ));
  });
});
