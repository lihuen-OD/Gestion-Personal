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
    origin: "INTERNA",
    uiColor: "blue",
    status: "ACTIVO",
    finnegansLinks: [],
    allowedLoadRoles: [],
    approvalRoles: [],
    rules: {
      exportsToFinnegans: false,
      requiresApproval: true,
      requiresDocumentation: false,
      allowsHours: false,
      allowsDateTo: true,
      hasValidity: false,
      blocksTimeEntry: false,
      setsWorkedHoursToZero: false,
      timeImpact: "NO_AFECTA_HORAS",
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
    history: [],
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
describe("NoveltyTypeDetailPage — Etapa 15L.2B", () => {
  it("muestra sólo 3 pestañas (General/Reglas/Finnegans), sin Historial", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(buildNoveltyType());
    renderPage();

    await screen.findByText("Vacaciones");
    expect(screen.getAllByText("General").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reglas").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Finnegans").length).toBeGreaterThan(0);
    expect(screen.queryByText("Historial")).not.toBeInTheDocument();
    expect(screen.queryByText("Todavía no hay historial registrado para este tipo de novedad.")).not.toBeInTheDocument();
  });

  it("sin exportsToFinnegans no muestra el badge Finnegans", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(buildNoveltyType({ rules: { ...buildNoveltyType().rules, exportsToFinnegans: false } }));
    renderPage();

    await screen.findByText("Vacaciones");
    expect(screen.queryByText("Finnegans", { selector: "span.badge" })).not.toBeInTheDocument();
  });

  it("con exportsToFinnegans muestra el badge Finnegans en el header", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(
      buildNoveltyType({ rules: { ...buildNoveltyType().rules, exportsToFinnegans: true, finnegansValueUnit: "DAYS" }, finnegansLinks: [{ id: "l1", code: "VAC", name: "Vacaciones", exportConcept: "Vacaciones", priority: 1, status: "ACTIVO", hasValidity: false }] }),
    );
    renderPage();

    await screen.findByText("Vacaciones");
    expect(screen.getByText("Finnegans", { selector: "span.badge" })).toBeInTheDocument();
  });

  it("con más de un vínculo Finnegans muestra el aviso de configuraciones adicionales, sin exponer UUIDs", async () => {
    const links = [
      { id: "l1", code: "VAC1", name: "Vacaciones legacy 1", exportConcept: "", priority: 2, status: "ACTIVO" as const, hasValidity: false },
      { id: "l2", code: "VAC2", name: "Vacaciones principal", exportConcept: "", priority: 1, status: "ACTIVO" as const, hasValidity: false },
    ];
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(
      buildNoveltyType({ rules: { ...buildNoveltyType().rules, exportsToFinnegans: true, finnegansValueUnit: "DAYS" }, finnegansLinks: links }),
    );
    renderPage();

    await screen.findByText("Vacaciones");
    await userEvent.click(screen.getByText("Finnegans", { selector: "button" }));

    expect(await screen.findByText(/configuraciones Finnegans adicionales/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("VAC2")).toBeInTheDocument();
    expect(screen.queryByText("l1")).not.toBeInTheDocument();
    expect(screen.queryByText("l2")).not.toBeInTheDocument();
  });

  it("editar y guardar persiste los campos nuevos (timeEntryBehavior/notes)", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(buildNoveltyType());
    vi.mocked(noveltyTypeApiService.update).mockResolvedValue(buildNoveltyType({ notes: "Actualizado" }));
    renderPage();

    await screen.findByText("Vacaciones");
    await userEvent.click(screen.getByText("Reglas", { selector: "button" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Comportamiento/ }), "Bloquea nueva carga horaria cuando la novedad está aprobada");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(noveltyTypeApiService.update).toHaveBeenCalledWith(
      "nt-1",
      expect.objectContaining({ rules: expect.objectContaining({ timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" }) }),
    ));
  });
});
