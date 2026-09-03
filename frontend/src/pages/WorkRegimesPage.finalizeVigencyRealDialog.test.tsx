import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WorkRegimesPage } from "./WorkRegimesPage";
import { AppDialogHost } from "../components/ui/AppDialogHost";
import { workRegimeApiService } from "../services/api/workRegimeApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import type { WorkRegime } from "../types/workRegime.types";
import type { WorkRegimeEmployeeAssociation } from "../types/associatedEmployee.types";

// Etapa 13J.3 — bug real reportado: "Finalizar vigencia" parecía no
// funcionar, y el modal de confirmación aparecía detrás del modal
// principal. Diagnóstico: <AppDialogHost/> (services/appDialog.ts +
// AppDialogHost.tsx) no usaba portal — su <Modal> caía en el lugar del
// árbol donde está montado (main.tsx, ANTES que <App/>), y con el mismo
// z-index que cualquier otro .modal-backdrop, el modal ABIERTO más tarde
// (el de "Empleados con régimen", ya en pantalla) le ganaba el empate de
// DOM y lo tapaba — el usuario no podía ver ni tocar "Finalizar vigencia"
// en la confirmación, así que la acción nunca llegaba a llamar la API.
//
// Este archivo, a propósito, NO mockea "../services/appDialog" (el resto de
// los tests de WorkRegimesPage sí lo hacen, para no depender del diálogo
// real) — así WorkRegimesPage/AssociatedEmployeesPanel importan el
// confirmAction/AppDialogHost REALES desde el arranque, igual que en la app
// real, y este test prueba el flujo completo tal como lo vive un usuario.
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "RRHH", email: "rrhh@test.com", password: "", role: "Nivel 1 - RRHH", status: "Activo" },
    login: vi.fn(),
    loginAs: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("../services/api/workRegimeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/workRegimeApiService")>();
  return {
    ...actual,
    workRegimeApiService: {
      ...actual.workRegimeApiService,
      getAll: vi.fn(),
      getWorkRegimeEmployees: vi.fn(),
      closeAssignment: vi.fn(),
    },
  };
});

vi.mock("../services/api/orgStructureApiService", () => ({
  orgStructureApiService: {
    getCatalog: vi.fn().mockResolvedValue({ sectors: [], costCenters: [], companies: [], businessUnits: [], establishments: [], areas: [] }),
  },
}));

function buildRegime(overrides: Partial<WorkRegime> = {}): WorkRegime {
  return {
    id: "regime-1",
    code: "01",
    name: "Agricultura",
    kind: "TURNO_FLEXIBLE",
    alertOnOutOfShift: false,
    openShiftOverflowAction: "ALERT_ONLY",
    extendedShiftAlertMinutes: null,
    description: null,
    status: "ACTIVO",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildAssociation(overrides: Partial<WorkRegimeEmployeeAssociation> = {}): WorkRegimeEmployeeAssociation {
  return {
    id: "assignment-current",
    employeeId: "employee-1",
    effectiveFrom: "2026-09-01T00:00:00.000Z",
    effectiveTo: null,
    vigencyStatus: "current",
    employee: {
      id: "employee-1",
      legajo: "27",
      cuil: "20-12345678-9",
      firstName: "27 Agricultura",
      lastName: "27 Agricultura",
      status: "ACTIVO",
      sector: null,
      costCenter: null,
      companies: [],
    },
    ...overrides,
  };
}

const emptyMeta = { total: 0, page: 1, pageSize: 20, hasMore: false };

// WorkRegimesPage activa enableMobileCards en este panel (Etapa 13J.3): la
// tabla (desktop/tablet) y la lista de cards (mobile) están las DOS en el
// DOM a la vez, CSS decide cuál se ve (jsdom no evalúa media queries) — así
// que un texto/botón que aparece en ambas vistas matchea dos veces. Este
// helper escopea la query a la tabla.
function withinTable() {
  return within(document.querySelector(".associated-employees-table-wrap") as HTMLElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(workRegimeApiService.getAll).mockResolvedValue({ items: [buildRegime()], meta: { total: 1, page: 1, pageSize: 200, hasMore: false } });
  vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue({ sectors: [], costCenters: [], companies: [], businessUnits: [], establishments: [], areas: [] });
});

describe("WorkRegimesPage + AppDialogHost reales — Finalizar vigencia end-to-end (Etapa 13J.3)", () => {
  it("la confirmación real se ve arriba del modal principal (no tapada) y confirmar llama a closeAssignment", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees)
      .mockResolvedValueOnce({ items: [buildAssociation()], meta: { ...emptyMeta, total: 1 } })
      .mockResolvedValueOnce({ items: [], meta: emptyMeta });
    vi.mocked(workRegimeApiService.closeAssignment).mockResolvedValue({} as never);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppDialogHost />
        <WorkRegimesPage />
      </MemoryRouter>,
    );

    await screen.findByText("Agricultura");
    await user.click(screen.getByRole("button", { name: "Ver empleados asociados" }));
    const mainModalHeading = await screen.findByRole("heading", { name: "Empleados con régimen 01 - Agricultura" });
    await screen.findAllByText("Vigente");

    await user.click(withinTable().getByRole("button", { name: "Finalizar vigencia" }));

    // La confirmación real aparece...
    const confirmHeading = await screen.findByRole("heading", { name: "Finalizar asignación de régimen" });
    expect(screen.getByText("Esta acción cierra la vigencia del régimen a partir de hoy, pero conserva el historial.", { exact: false })).toBeInTheDocument();
    // ...y NO queda anidada dentro del modal "Empleados con régimen" que ya
    // estaba abierto — es justo lo que hacía que se viera "tapada"/inútil.
    expect(mainModalHeading.closest(".modal")?.contains(confirmHeading)).toBe(false);
    // Está en un .modal-backdrop propio, hijo directo de <body> (portal).
    expect(confirmHeading.closest(".modal-backdrop")?.parentElement).toBe(document.body);

    const confirmDialog = within(confirmHeading.closest(".modal") as HTMLElement);
    await user.click(confirmDialog.getByRole("button", { name: "Finalizar vigencia" }));

    await vi.waitFor(() => expect(workRegimeApiService.closeAssignment).toHaveBeenCalledWith("employee-1", "assignment-current", expect.any(String)));
    // La confirmación se cierra sola tras confirmar.
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Finalizar asignación de régimen" })).not.toBeInTheDocument());
    // Y la lista se refresca (mismo endpoint que ve el Legajo).
    await vi.waitFor(() => expect(workRegimeApiService.getWorkRegimeEmployees).toHaveBeenCalledTimes(2));
  });

  it("cancelar la confirmación real no llama a closeAssignment", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [buildAssociation()], meta: { ...emptyMeta, total: 1 } });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppDialogHost />
        <WorkRegimesPage />
      </MemoryRouter>,
    );

    await screen.findByText("Agricultura");
    await user.click(screen.getByRole("button", { name: "Ver empleados asociados" }));
    await screen.findAllByText("Vigente");

    await user.click(withinTable().getByRole("button", { name: "Finalizar vigencia" }));
    await screen.findByRole("heading", { name: "Finalizar asignación de régimen" });
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("heading", { name: "Finalizar asignación de régimen" })).not.toBeInTheDocument();
    expect(workRegimeApiService.closeAssignment).not.toHaveBeenCalled();
  });
});
