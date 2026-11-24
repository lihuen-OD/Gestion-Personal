/**
 * R4.8B1: equipos (alta, edición, estado, permisos) y grilla en sólo lectura
 * (versiones, nocturnos, doble bloque, descansos, sin configurar, problemas).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RotationCrewsPanel } from "./RotationCrewsPanel";
import { RotationGridPanel } from "./RotationGridPanel";
import { shiftRotationApiService, type ShiftRotationVersion } from "../../services/api/shiftRotationApiService";
import { ApiError } from "../../services/api/apiClient";
import { confirmAction } from "../../services/appDialog";
import { rotationFixture } from "../../test/shiftRotationFixtures";

vi.mock("../../services/appDialog", () => ({ confirmAction: vi.fn().mockResolvedValue(true) }));
vi.mock("../../services/api/shiftRotationApiService", () => ({ shiftRotationApiService: { createCrew: vi.fn(), updateCrew: vi.fn(), version: vi.fn() } }));
vi.mock("../../utils/argentinaDateKey", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../utils/argentinaDateKey")>()), argentinaDateKey: () => "2026-11-24" }));

const DAY = { code: "P-0719", name: "Planta día", startTime: "07:00", endTime: "19:00" };
const NIGHT = { code: "P-1907", name: "Planta noche", startTime: "19:00", endTime: "07:00" };

const ROTATION = rotationFixture({
  crews: [
    { id: "crew-a", code: "A", name: "Equipo A", sortOrder: 10, status: "ACTIVO", openMemberCount: 3, everHadMembers: true },
    { id: "crew-b", code: "B", name: "Equipo B", sortOrder: 20, status: "ACTIVO", openMemberCount: 0, everHadMembers: false },
    { id: "crew-c", code: "C", name: "Equipo C", sortOrder: 30, status: "INACTIVO", openMemberCount: 0, everHadMembers: false },
  ],
  versions: [
    { id: "v-old", effectiveFrom: "2026-10-05", effectiveTo: "2026-11-01", cycleLengthWeeks: 1, anchorWeekStart: "2026-10-05", locked: true, inEffectToday: false, dayCount: 14, updatedAt: "" },
    { id: "v-now", effectiveFrom: "2026-11-02", effectiveTo: null, cycleLengthWeeks: 2, anchorWeekStart: "2026-11-02", locked: true, inEffectToday: true, dayCount: 27, updatedAt: "" },
  ],
});

function version(id: string, overrides: Partial<ShiftRotationVersion> = {}): ShiftRotationVersion {
  const days = [];
  for (let week = 0; week < 2; week += 1) for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    const kind = weekday === 0 || weekday === 6 ? "REST" : "SHIFT";
    const blocks = kind === "REST" ? [] : weekday === 5 && week === 0 ? [NIGHT, DAY] : [week === 0 ? DAY : NIGHT];
    days.push({ id: `a${week}${weekday}`, crewId: "crew-a", crew: "A - Equipo A", cycleWeekIndex: week, weekLabel: "", weekday, weekdayName: null, kind: kind as "SHIFT" | "REST", blocks: blocks.map((template, blockIndex) => ({ blockIndex, shiftTemplateId: template.code, template })) });
    if (!(week === 1 && weekday === 3)) days.push({ id: `b${week}${weekday}`, crewId: "crew-b", crew: "B - Equipo B", cycleWeekIndex: week, weekLabel: "", weekday, weekdayName: null, kind: "REST" as const, blocks: [] });
  }
  return {
    id, rotationId: "rot-1", effectiveFrom: "2026-11-02", effectiveTo: null, cycleLengthWeeks: 2, anchorWeekStart: "2026-11-02", locked: true, updatedAt: "",
    days,
    issues: [{ code: "DAY_MISSING", severity: "WARNING", crewId: "crew-b", cycleWeekIndex: 1, weekday: 3, message: "Falta configurar el semana B, miércoles del equipo B." }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(shiftRotationApiService.version).mockImplementation(async (_rotationId, versionId) => version(versionId));
});

describe("equipos", () => {
  it("RRHH ve los equipos ordenados y sólo puede inactivar uno que nunca tuvo personas", () => {
    render(<RotationCrewsPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[1]!.textContent)).toEqual(["A", "B", "C"]);
    expect(within(rows[0]!).queryByRole("button", { name: /Inactivar/ })).not.toBeInTheDocument();
    expect(within(rows[1]!).getByRole("button", { name: "Inactivar Equipo B" })).toBeInTheDocument();
    expect(within(rows[2]!).getByRole("button", { name: "Activar Equipo C" })).toBeInTheDocument();
  });

  it("alta: valida, normaliza y avisa al detalle", async () => {
    const onChanged = vi.fn();
    vi.mocked(shiftRotationApiService.createCrew).mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    render(<RotationCrewsPanel rotation={ROTATION} canEdit onChanged={onChanged} />);
    await user.click(screen.getByRole("button", { name: /Agregar equipo/ }));
    const dialog = screen.getByRole("dialog", { name: "Agregar equipo" });
    expect(within(dialog).getByLabelText("Orden *")).toHaveValue(40);
    await user.click(within(dialog).getByRole("button", { name: "Agregar equipo" }));
    expect(within(dialog).getByText("Ingresá un código.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Código *"), " noche ");
    await user.type(within(dialog).getByLabelText("Nombre *"), "Equipo   Noche");
    await user.click(within(dialog).getByRole("button", { name: "Agregar equipo" }));
    expect(shiftRotationApiService.createCrew).toHaveBeenCalledWith("rot-1", { code: "NOCHE", name: "Equipo Noche", sortOrder: 40 });
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByText("Equipo agregado.")).toBeInTheDocument();
  });

  it("edición: el código queda fijo y se envía sólo lo cambiado", async () => {
    vi.mocked(shiftRotationApiService.updateCrew).mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    render(<RotationCrewsPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Editar Equipo B" }));
    const dialog = screen.getByRole("dialog", { name: "Editar equipo" });
    expect(within(dialog).getByLabelText("Código *")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    const order = within(dialog).getByLabelText("Orden *");
    await user.clear(order);
    await user.type(order, "5");
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(shiftRotationApiService.updateCrew).toHaveBeenCalledWith("rot-1", "crew-b", { sortOrder: 5 });
  });

  it("un rechazo del backend se muestra en la sección, sin códigos", async () => {
    vi.mocked(shiftRotationApiService.updateCrew).mockRejectedValue(new ApiError("El equipo B - Equipo B tuvo membresías: inactivarlo cambiaría también los días pasados.", "ROTATION_CREW_HAS_MEMBERS", 409));
    const user = userEvent.setup();
    render(<RotationCrewsPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Inactivar Equipo B" }));
    expect(confirmAction).toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("tuvo membresías");
  });

  it("Supervisión y Carga Horaria consultan sin acciones", () => {
    render(<RotationCrewsPanel rotation={ROTATION} canEdit={false} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
  });

  it("sin equipos: estado vacío con un único CTA", () => {
    render(<RotationCrewsPanel rotation={rotationFixture({ crews: [] })} canEdit onChanged={vi.fn()} />);
    expect(screen.getByText(/todavía no tiene equipos/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Agregar equipo/ })).toHaveLength(1);
  });
});

describe("grilla en sólo lectura", () => {
  it("abre la versión vigente y muestra turnos, +1, doble bloque, descansos y días sin configurar con texto", async () => {
    render(<RotationGridPanel rotation={ROTATION} reloadToken={0} />);
    const grid = await screen.findByRole("table", { name: /Grilla de la versión desde el 02\/11\/2026/ });
    expect(shiftRotationApiService.version).toHaveBeenCalledWith("rot-1", "v-now");
    expect(screen.getByText("Vigente")).toBeInTheDocument();
    expect(screen.getByText("2 semanas (A y B)")).toBeInTheDocument();
    expect(screen.getByText(/La del lunes 02\/11\/2026; se repite cada 2 semanas/)).toBeInTheDocument();
    expect(screen.getByText(/ya rigió y no se puede modificar/)).toBeInTheDocument();
    expect(within(grid.querySelector("thead")!).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Semana", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]);
    expect(within(grid).getByText("Bloque 1 de 2: Planta noche (P-1907), de 19:00 a 07:00 del día siguiente")).toBeInTheDocument();
    expect(within(grid).getByText("Bloque 2 de 2: Planta día (P-0719), de 07:00 a 19:00")).toBeInTheDocument();
    expect(within(grid).getAllByText("Descanso").length).toBeGreaterThan(0);
    expect(within(grid).getAllByText("Sin configurar")).toHaveLength(1);
    expect(within(grid).getAllByTitle("Termina al día siguiente").length).toBeGreaterThan(0);
    // Equipo inactivo sin días: no se muestra en la grilla.
    expect(within(grid).queryByText("Equipo C")).not.toBeInTheDocument();
    expect(screen.getByText("Equipo B (equipo B): 1 día sin configurar.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/DAY_MISSING|crew-b|v-now/);
  });

  it("cambia a una versión anterior y la identifica como tal", async () => {
    vi.mocked(shiftRotationApiService.version).mockImplementation(async (_r, id) => version(id, id === "v-old" ? { cycleLengthWeeks: 1, effectiveFrom: "2026-10-05", effectiveTo: "2026-11-01", anchorWeekStart: "2026-10-05" } : {}));
    const user = userEvent.setup();
    render(<RotationGridPanel rotation={ROTATION} reloadToken={0} />);
    await screen.findByRole("table");
    await user.selectOptions(screen.getByLabelText("Versión"), "v-old");
    expect(await screen.findByText("Anterior")).toBeInTheDocument();
    expect(screen.getByText("1 semana")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Anterior · del 05/10/2026 al 01/11/2026" })).toBeInTheDocument();
  });

  it("marca la celda con un problema de configuración y lo lista", async () => {
    vi.mocked(shiftRotationApiService.version).mockResolvedValue(version("v-now", {
      issues: [{ code: "BLOCKS_OVERLAP", severity: "ERROR", crewId: "crew-a", cycleWeekIndex: 0, weekday: 5, message: "en el viernes de la semana A los bloques se superponen." }],
    }));
    render(<RotationGridPanel rotation={ROTATION} reloadToken={0} />);
    const grid = await screen.findByRole("table");
    expect(within(grid).getByText("Problema: En el viernes de la semana A los bloques se superponen.")).toBeInTheDocument();
    expect(screen.getByText("Problemas de esta versión")).toBeInTheDocument();
  });

  it("sin versiones: estado vacío sin pedir nada al backend", () => {
    render(<RotationGridPanel rotation={rotationFixture({ versions: [] })} reloadToken={0} />);
    expect(screen.getByText(/todavía no tiene grilla/)).toBeInTheDocument();
    expect(shiftRotationApiService.version).not.toHaveBeenCalled();
  });

  it("error de carga localizado con reintento", async () => {
    vi.mocked(shiftRotationApiService.version).mockRejectedValueOnce(new Error("network"));
    const user = userEvent.setup();
    render(<RotationGridPanel rotation={ROTATION} reloadToken={0} />);
    await user.click(await screen.findByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});
