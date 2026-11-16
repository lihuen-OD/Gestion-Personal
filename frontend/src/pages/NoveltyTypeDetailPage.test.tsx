import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { NoveltyTypeDetailPage } from "./NoveltyTypeDetailPage";
import { mapNoveltyTypeFromApi, mapNoveltyTypeToApi, type ApiNoveltyType } from "../services/api/noveltyTypeApiService";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import type { NoveltyType } from "../types/noveltyType.types";
import { defaultNoveltyTypeCoverage } from "../utils/noveltyTypeCoverage";

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
    coverage: defaultNoveltyTypeCoverage(),
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
      requiresObservation: false,
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
  it("muestra el formulario por secciones con resumen, sin pestañas ni Historial", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(buildNoveltyType());
    renderPage();

    await screen.findByRole("heading", { name: "Vacaciones" });
    for (const title of ["1. Datos generales", "2. Tiempo que cubre", "3. Impacto en el cálculo", "4. Carga y control", "5. Integración y otras opciones"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: "Resumen" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByText("Historial")).not.toBeInTheDocument();
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
  it("muestra el código/nombre Finnegans configurados en la sección de integración", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(
      buildNoveltyType({ rules: { ...buildNoveltyType().rules, exportsToFinnegans: true, finnegansValueUnit: "DAYS" }, finnegansCode: "VAC2", finnegansName: "Vacaciones principal" }),
    );
    renderPage();

    await screen.findByRole("heading", { name: "Vacaciones" });

    expect(screen.getByDisplayValue("VAC2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Vacaciones principal")).toBeInTheDocument();
  });

  it("editar y guardar persiste los campos nuevos (timeEntryBehavior/notes)", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(buildNoveltyType());
    vi.mocked(noveltyTypeApiService.update).mockResolvedValue(buildNoveltyType({ notes: "Actualizado" }));
    renderPage();

    await screen.findByRole("heading", { name: "Vacaciones" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Bloquea nuevas cargas/ }), "Bloquea nueva carga horaria cuando la novedad está aprobada");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(noveltyTypeApiService.update).toHaveBeenCalledWith(
      "nt-1",
      expect.objectContaining({ rules: expect.objectContaining({ timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" }) }),
    ));
  });
});

// Etapa 7 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §14).
describe("NoveltyTypeDetailPage — Etapa 7 (cobertura)", () => {
  const vacations = () => buildNoveltyType({
    rules: { ...buildNoveltyType().rules, requiresApproval: true },
    coverage: { ...buildNoveltyType().coverage, mode: "EXPECTED_SCHEDULE", dayRule: "WORK_OBLIGATION", appliesSpecialHours: true, countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" },
  });

  it("carga la configuración guardada y la resume sin depender del nombre", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(vacations());
    renderPage();

    await screen.findByRole("heading", { name: "Vacaciones" });
    expect(screen.getByRole("radio", { name: /Según la jornada que debía cumplir/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /No puede coexistir/ })).toBeChecked();
    expect(screen.getByText("Cubre las horas que la persona debía trabajar cada día.")).toBeInTheDocument();
    expect(screen.getByText("Requiere aprobación antes de sumar horas.")).toBeInTheDocument();
    expect(screen.queryByText(/puede recalcular novedades/)).not.toBeInTheDocument();
  });

  it("avisa que cambiar lo que cubre recalcula los períodos abiertos y guarda la nueva configuración", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(vacations());
    vi.mocked(noveltyTypeApiService.update).mockImplementation(async (_id, item) => item);
    renderPage();
    await screen.findByRole("heading", { name: "Vacaciones" });

    await userEvent.click(screen.getByRole("radio", { name: /No, sólo es informativa/ }));

    expect(screen.getByText("Este cambio puede recalcular novedades ya cargadas en períodos abiertos.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(noveltyTypeApiService.update).toHaveBeenCalledWith("nt-1", expect.objectContaining({
      coverage: expect.objectContaining({ mode: "EXPECTED_SCHEDULE", countsTowardTotal: false }),
    })));
    await waitFor(() => expect(screen.queryByText(/puede recalcular novedades/)).not.toBeInTheDocument());
  });
});

// Round-trip: abrir y guardar sin cambios no altera ninguna configuración,
// aunque el formulario normalice campos condicionales.
describe("NoveltyTypeDetailPage — Etapa 7 (round-trip y cambios inocuos)", () => {
  const apiRow: ApiNoveltyType = {
    id: "nt-1", code: "NOV-002", name: "Maternidad", uiColor: "pink", kind: "LICENCIA", status: "ACTIVO",
    description: "Licencia por maternidad", notes: "Nota interna",
    exportsToFinnegans: true, requiresApproval: true, requiresDocumentation: true, allowsHours: false,
    timeEntryBehavior: "BLOQUEA_NUEVA_CARGA", allowsDateRange: true, finnegansValueUnit: "DAYS", finnegansRequiresValidity: true,
    finnegansCode: "MAT", finnegansName: "Maternidad", allowedLoadRoles: ["Nivel 1 - RRHH"], approvalRoles: ["Nivel 1 - RRHH"],
    coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageDayRule: "SELECTED_WEEKDAYS", coverageWeekdays: [1, 2, 3, 4, 5],
    coverageOnDayOff: "COVER", coverageOnHoliday: "ONLY_IF_CONVOKED", coverageAppliesSpecialHours: false, coverageCountsTowardTotal: true,
    realWorkCompatibility: "INCOMPATIBLE", requiresObservation: true, createdAt: "", updatedAt: "",
  };

  it("GET → abrir → guardar sin cambios envía un payload equivalente al tipo guardado", async () => {
    const loaded = mapNoveltyTypeFromApi(apiRow);
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(loaded);
    vi.mocked(noveltyTypeApiService.update).mockImplementation(async (_id, item) => item);
    renderPage();
    await screen.findByRole("heading", { name: "Maternidad" });

    expect(screen.queryByText(/puede recalcular novedades/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(noveltyTypeApiService.update).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(noveltyTypeApiService.update).mock.calls[0][1];
    expect(sent).toEqual(loaded);
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...persisted } = apiRow;
    expect(mapNoveltyTypeToApi(sent)).toEqual(persisted);
  });

  it("descripción y color no avisan recálculo; observación obligatoria se edita y se envía", async () => {
    vi.mocked(noveltyTypeApiService.getById).mockResolvedValue(mapNoveltyTypeFromApi({ ...apiRow, requiresObservation: false }));
    vi.mocked(noveltyTypeApiService.update).mockImplementation(async (_id, item) => item);
    renderPage();
    await screen.findByRole("heading", { name: "Maternidad" });

    await userEvent.type(screen.getByLabelText("Descripción funcional *"), " actualizada");
    await userEvent.click(screen.getByRole("button", { name: "Esmeralda" }));
    const observation = screen.getByRole("checkbox", { name: /La observación es obligatoria/ });
    expect(observation).not.toBeChecked();
    await userEvent.click(observation);

    expect(screen.queryByText(/puede recalcular novedades/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(noveltyTypeApiService.update).toHaveBeenCalledWith("nt-1", expect.objectContaining({
      uiColor: "emerald",
      rules: expect.objectContaining({ requiresObservation: true }),
    })));
  });
});
