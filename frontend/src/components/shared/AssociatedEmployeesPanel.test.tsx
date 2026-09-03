import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssociatedEmployeesPanel } from "./AssociatedEmployeesPanel";
import { orgStructureApiService } from "../../services/api/orgStructureApiService";
import type { AssociatedEmployeeFilters, AssociatedEmployeesResult } from "../../types/associatedEmployee.types";

vi.mock("../../services/appDialog", () => ({
  confirmAction: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../services/api/orgStructureApiService", () => ({
  orgStructureApiService: {
    getCatalog: vi.fn().mockResolvedValue({ sectors: [], costCenters: [], companies: [] }),
  },
}));

type TestItem = { employeeId: string; employee: { id: string; legajo: string; cuil: string; firstName: string; lastName: string; status: "ACTIVO" | "INACTIVO"; sector: { id: string; name: string } | null; costCenter: { id: string; name: string } | null; companies: Array<{ id: string; name: string }> } };

function buildItem(overrides: Partial<TestItem> = {}): TestItem {
  return {
    employeeId: "emp-1",
    employee: {
      id: "emp-1",
      legajo: "LEG-001",
      cuil: "20-12345678-9",
      firstName: "Juan",
      lastName: "Pérez",
      status: "ACTIVO",
      sector: { id: "sec-1", name: "Administración" },
      costCenter: null,
      companies: [{ id: "comp-1", name: "Constructora" }],
    },
    ...overrides,
  };
}

function buildResult(items: TestItem[] = [], total = items.length): AssociatedEmployeesResult<TestItem> {
  return {
    items,
    meta: { total, page: 1, pageSize: 20, hasMore: total > 20 },
  };
}

function renderPanel(fetcher: (filters: AssociatedEmployeeFilters) => Promise<AssociatedEmployeesResult<TestItem>>, props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <AssociatedEmployeesPanel
        title="Empleados test"
        emptyText="No hay empleados"
        fetcher={fetcher}
        {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AssociatedEmployeesPanel — Etapa 14B.1 (refresh silencioso)", () => {
  it("el empty state sigue funcionando cuando no hay datos", async () => {
    const fetcher = vi.fn().mockResolvedValue(buildResult([]));
    renderPanel(fetcher);

    await waitFor(() => expect(screen.getByText("No hay empleados")).toBeInTheDocument());
  });

  it("el error state sigue funcionando cuando falla la primera carga", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Network error"));
    renderPanel(fetcher);

    await waitFor(() => expect(screen.getByText("No pudimos cargar los empleados asociados.")).toBeInTheDocument());
  });

  it("mantiene los datos visibles durante refresh silencioso (refreshKey cambia con fetcher pendiente)", async () => {
    const item = buildItem();
    let resolveFirst!: (value: AssociatedEmployeesResult<TestItem>) => void;
    const fetcher = vi.fn()
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue(buildResult([item]));

    const { rerender } = render(
      <MemoryRouter>
        <AssociatedEmployeesPanel
          title="Empleados test"
          emptyText="No hay empleados"
          fetcher={fetcher}
          refreshKey={1}
        />
      </MemoryRouter>,
    );

    resolveFirst(buildResult([item]));
    await screen.findByText("Pérez, Juan");
    expect(screen.getByText("Pérez, Juan")).toBeInTheDocument();
    expect(screen.queryByText("Cargando datos de empleados")).not.toBeInTheDocument();

    const pendingResult = new Promise<AssociatedEmployeesResult<TestItem>>(() => {});
    fetcher.mockReturnValueOnce(pendingResult);

    rerender(
      <MemoryRouter>
        <AssociatedEmployeesPanel
          title="Empleados test"
          emptyText="No hay empleados"
          fetcher={fetcher}
          refreshKey={2}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Pérez, Juan")).toBeInTheDocument();
    expect(screen.queryByText("Cargando datos de empleados")).not.toBeInTheDocument();
  });

  it("mantiene los datos visibles cuando el refresh falla (hadItemsRef protege)", async () => {
    const item = buildItem();
    let resolveFirst!: (value: AssociatedEmployeesResult<TestItem>) => void;
    const fetcher = vi.fn()
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue(buildResult([item]));

    const { rerender } = render(
      <MemoryRouter>
        <AssociatedEmployeesPanel
          title="Empleados test"
          emptyText="No hay empleados"
          fetcher={fetcher}
          refreshKey={1}
        />
      </MemoryRouter>,
    );

    resolveFirst(buildResult([item]));
    await screen.findByText("Pérez, Juan");
    expect(screen.getByText("Pérez, Juan")).toBeInTheDocument();

    fetcher.mockRejectedValueOnce(new Error("Refresh failed"));

    rerender(
      <MemoryRouter>
        <AssociatedEmployeesPanel
          title="Empleados test"
          emptyText="No hay empleados"
          fetcher={fetcher}
          refreshKey={2}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {});
    expect(screen.getByText("Pérez, Juan")).toBeInTheDocument();
    expect(screen.queryByText("No pudimos cargar los empleados asociados.")).not.toBeInTheDocument();
  });
});
