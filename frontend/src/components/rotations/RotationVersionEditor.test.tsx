/**
 * R4.8B2: editor de versiones (alta con copia o vacía, edición de días y
 * bloques, nocturnos, grilla incompleta, 422, concurrencia, conservación del
 * borrador) y acciones de versión en la grilla (permisos, bloqueadas, borrado).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RotationVersionEditor } from "./RotationVersionEditor";
import { RotationGridPanel } from "./RotationGridPanel";
import { shiftRotationApiService, type ShiftRotationDay, type ShiftRotationVersion } from "../../services/api/shiftRotationApiService";
import { workforceApiService, type ShiftTemplate } from "../../services/api/workforceApiService";
import { ApiError } from "../../services/api/apiClient";
import { confirmAction } from "../../services/appDialog";
import { rotationFixture } from "../../test/shiftRotationFixtures";

vi.mock("../../services/appDialog", () => ({ confirmAction: vi.fn().mockResolvedValue(true) }));
vi.mock("../../services/api/shiftRotationApiService", () => ({ shiftRotationApiService: { version: vi.fn(), createVersion: vi.fn(), updateVersion: vi.fn(), removeVersion: vi.fn() } }));
vi.mock("../../services/api/workforceApiService", () => ({ workforceApiService: { shiftTemplates: vi.fn() } }));
vi.mock("../../utils/argentinaDateKey", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../utils/argentinaDateKey")>()), argentinaDateKey: () => "2026-11-24" }));

const template = (id: string, code: string, startTime: string, endTime: string, shiftGroupId: string, status = "ACTIVO") =>
  ({ id, code, name: code === "P-1907" ? "Planta noche" : code === "P-0719" ? "Planta día" : code, startTime, endTime, shiftGroupId, status }) as ShiftTemplate;
const TEMPLATES = [
  template("t-day", "P-0719", "07:00", "19:00", "g-pl"),
  template("t-night", "P-1907", "19:00", "07:00", "g-pl"),
  template("t-office", "O-0816", "08:00", "16:00", "g-of"),
  template("t-old", "P-OLD", "06:00", "14:00", "g-pl", "INACTIVO"),
];
const DAY = { code: "P-0719", name: "Planta día", startTime: "07:00", endTime: "19:00" };

const CREWS = [
  { id: "crew-a", code: "A", name: "Equipo A", sortOrder: 10, status: "ACTIVO" as const, openMemberCount: 0, everHadMembers: false },
  { id: "crew-b", code: "B", name: "Equipo B", sortOrder: 20, status: "ACTIVO" as const, openMemberCount: 0, everHadMembers: false },
];
const SUMMARY = { id: "v1", effectiveFrom: "2026-11-30", effectiveTo: null, cycleLengthWeeks: 1, anchorWeekStart: "2026-11-30", locked: false, inEffectToday: false, dayCount: 14, updatedAt: "2026-11-24T10:00:00.000Z" };
const ROTATION = rotationFixture({ crews: CREWS, versions: [SUMMARY] });

function fullVersion(overrides: Partial<ShiftRotationVersion> = {}): ShiftRotationVersion {
  const days: ShiftRotationDay[] = [];
  for (const crew of CREWS) for (let weekday = 0; weekday < 7; weekday += 1) {
    const rest = crew.id === "crew-a" ? weekday === 0 || weekday === 6 : weekday >= 1 && weekday <= 5;
    days.push({ id: `${crew.id}${weekday}`, crewId: crew.id, crew: null, cycleWeekIndex: 0, weekLabel: "A", weekday, weekdayName: null, kind: rest ? "REST" : "SHIFT", blocks: rest ? [] : [{ blockIndex: 0, shiftTemplateId: "t-day", template: DAY }] });
  }
  return { id: "v1", rotationId: "rot-1", effectiveFrom: "2026-11-30", effectiveTo: null, cycleLengthWeeks: 1, anchorWeekStart: "2026-11-30", locked: false, updatedAt: "2026-11-24T10:00:00.000Z", days, issues: [], ...overrides };
}

const cellButton = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(confirmAction).mockResolvedValue(true);
  vi.mocked(workforceApiService.shiftTemplates).mockResolvedValue(TEMPLATES);
  vi.mocked(shiftRotationApiService.version).mockResolvedValue(fullVersion());
});

describe("alta de versión", () => {
  it("parte de una copia de la última versión, propone la primera fecha válida y conserva la semana A", async () => {
    const onSaved = vi.fn();
    vi.mocked(shiftRotationApiService.createVersion).mockResolvedValue(fullVersion({ id: "v2", effectiveFrom: "2026-12-01" }));
    const user = userEvent.setup();
    render(<RotationVersionEditor rotation={ROTATION} mode={{ kind: "create" }} onCancel={vi.fn()} onSaved={onSaved} />);
    expect(await screen.findByText("Todos los días están configurados.")).toBeInTheDocument();
    expect(shiftRotationApiService.version).toHaveBeenCalledWith("rot-1", "v1");
    expect(screen.getByLabelText("Vigente desde *")).toHaveValue("2026-12-01");
    expect(screen.getByLabelText("Lunes de la semana A *")).toHaveValue("2026-11-30");
    await user.click(screen.getByRole("button", { name: "Guardar versión" }));
    const payload = vi.mocked(shiftRotationApiService.createVersion).mock.calls[0]![1];
    expect(payload).toMatchObject({ effectiveFrom: "2026-12-01", cycleLengthWeeks: 1, anchorWeekStart: "2026-11-30" });
    expect(payload.days).toHaveLength(14);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "v2" }), true);
  });

  it("grilla vacía: no se puede guardar hasta configurar todos los días; edita turnos, nocturnos, dobles bloques y descansos", async () => {
    const user = userEvent.setup();
    render(<RotationVersionEditor rotation={ROTATION} mode={{ kind: "create" }} onCancel={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText("Todos los días están configurados.");
    await user.selectOptions(screen.getByLabelText("Partir de"), "empty");
    expect(await screen.findByText(/Faltan 14 días por configurar/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar versión" })).toBeDisabled();

    await user.click(cellButton(/^Equipo A, semana A, lunes: Sin configurar/));
    const dialog = screen.getByRole("dialog", { name: "Editar día" });
    expect(within(dialog).getByText("Equipo A · Semana A · lunes")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: /Trabaja/ }));
    const first = within(dialog).getByLabelText("Bloque 1");
    // Sólo turnos activos del grupo de la rotación.
    expect(within(first).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Elegí un turno",
      "P-0719 · Planta día · 07:00–19:00",
      "P-1907 · Planta noche · 19:00–07:00 (+1, termina al día siguiente)",
    ]);
    await user.click(within(dialog).getByRole("button", { name: "Aplicar" }));
    expect(within(dialog).getByText("Elegí el turno del bloque 1.")).toBeInTheDocument();
    await user.selectOptions(first, "t-night");
    await user.click(within(dialog).getByRole("button", { name: /Agregar bloque/ }));
    await user.selectOptions(within(dialog).getByLabelText("Bloque 2"), "t-day");
    await user.click(within(dialog).getByRole("button", { name: "Aplicar" }));
    expect(cellButton(/^Equipo A, semana A, lunes: Bloque 1 de 2: Planta noche \(P-1907\), de 19:00 a 07:00 del día siguiente; Bloque 2 de 2: Planta día/)).toBeInTheDocument();
    expect(screen.getByText(/Faltan 13 días por configurar/)).toBeInTheDocument();

    await user.click(cellButton(/^Equipo A, semana A, martes/));
    await user.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /Descanso/ }));
    expect(within(screen.getByRole("dialog")).queryByLabelText("Bloque 1")).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Aplicar" }));
    expect(cellButton(/^Equipo A, semana A, martes: Descanso/)).toBeInTheDocument();
  });

  it("acortar el ciclo con días cargados pide confirmación", async () => {
    vi.mocked(shiftRotationApiService.version).mockResolvedValue(fullVersion({ cycleLengthWeeks: 2, days: [...fullVersion().days, ...fullVersion().days.map((day) => ({ ...day, id: `${day.id}b`, cycleWeekIndex: 1 }))] }));
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    const user = userEvent.setup();
    render(<RotationVersionEditor rotation={ROTATION} mode={{ kind: "create" }} onCancel={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText("Todos los días están configurados.");
    await user.selectOptions(screen.getByLabelText("Semanas del ciclo *"), "1");
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("Al pasar a un ciclo de 1 semana se descartan 14 días configurados de la semana B"), expect.anything());
    expect(screen.getByLabelText("Semanas del ciclo *")).toHaveValue("2");
  });

  it("un lunes mal elegido se avisa en el campo y bloquea el guardado", async () => {
    const user = userEvent.setup();
    render(<RotationVersionEditor rotation={ROTATION} mode={{ kind: "create" }} onCancel={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText("Todos los días están configurados.");
    const anchor = screen.getByLabelText("Lunes de la semana A *");
    await user.clear(anchor);
    await user.type(anchor, "2026-12-02");
    expect(screen.getByText("Elegí un lunes: cada semana del ciclo empieza un lunes.")).toBeInTheDocument();
    expect(anchor).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Guardar versión" })).toBeDisabled();
  });

  it("un 422 del backend se muestra arriba, marca las celdas y conserva el borrador", async () => {
    vi.mocked(shiftRotationApiService.createVersion).mockRejectedValue(new ApiError("La grilla tiene errores o está incompleta: cada equipo activo necesita los 7 días de cada semana del ciclo, sin superposiciones.", "ROTATION_GRID_INVALID", 422, {
      error: { code: "ROTATION_GRID_INVALID", details: { issues: [{ code: "TEMPLATE_INACTIVE", severity: "ERROR", crewId: "crew-a", cycleWeekIndex: 0, weekday: 1, message: "El turno P-0719 del semana A, lunes está inactivo." }] } },
    }));
    const user = userEvent.setup();
    render(<RotationVersionEditor rotation={ROTATION} mode={{ kind: "create" }} onCancel={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText("Todos los días están configurados.");
    await user.click(screen.getByRole("button", { name: "Guardar versión" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("La grilla tiene errores o está incompleta");
    expect(alert).toHaveTextContent("El turno P-0719 de la semana A, lunes está inactivo.");
    expect(alert).toHaveTextContent("Tus cambios siguen en pantalla");
    expect(cellButton(/^Equipo A, semana A, lunes: Planta día.*Problema: El turno P-0719/)).toBeInTheDocument();
    expect(screen.getByLabelText("Vigente desde *")).toHaveValue("2026-12-01");
    expect(document.body.textContent).not.toMatch(/ROTATION_|TEMPLATE_INACTIVE|crew-a/);
  });

  it("un turno de otro grupo rechazado por el backend se informa con su mensaje", async () => {
    vi.mocked(shiftRotationApiService.createVersion).mockRejectedValue(new ApiError("La grilla usa turnos de otro grupo: O-0816. Una rotación sólo usa turnos activos de su grupo (PLANTA).", "ROTATION_TEMPLATE_OTHER_GROUP", 422, { error: { code: "ROTATION_TEMPLATE_OTHER_GROUP", details: { templates: ["O-0816"] } } }));
    const user = userEvent.setup();
    render(<RotationVersionEditor rotation={ROTATION} mode={{ kind: "create" }} onCancel={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText("Todos los días están configurados.");
    await user.click(screen.getByRole("button", { name: "Guardar versión" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La grilla usa turnos de otro grupo: O-0816.");
  });

  it("cancelar con cambios pide confirmación", async () => {
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<RotationVersionEditor rotation={ROTATION} mode={{ kind: "create" }} onCancel={onCancel} onSaved={vi.fn()} />);
    await screen.findByText("Todos los días están configurados.");
    await user.click(cellButton(/^Equipo A, semana A, lunes/));
    await user.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /Descanso/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Aplicar" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("todavía no se guardaron"), expect.anything());
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("edición de una versión futura y concurrencia", () => {
  it("envía expectedUpdatedAt; ante un conflicto deja revisar la versión guardada y conservar el borrador", async () => {
    const version = fullVersion();
    vi.mocked(shiftRotationApiService.updateVersion)
      .mockRejectedValueOnce(new ApiError("Otra persona modificó esta versión mientras la editabas. Recargala y volvé a aplicar tus cambios.", "ROTATION_VERSION_STALE", 409, { error: { code: "ROTATION_VERSION_STALE" } }))
      .mockResolvedValueOnce(fullVersion({ updatedAt: "2026-11-24T12:00:00.000Z" }));
    vi.mocked(shiftRotationApiService.version).mockResolvedValue(fullVersion({ updatedAt: "2026-11-24T11:00:00.000Z" }));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<RotationVersionEditor rotation={ROTATION} mode={{ kind: "edit", version }} onCancel={vi.fn()} onSaved={onSaved} />);
    expect(screen.getByRole("button", { name: "Guardar versión" })).toBeDisabled();
    await user.click(await screen.findByRole("button", { name: /^Equipo B, semana A, lunes/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /Trabaja/ }));
    await user.selectOptions(within(screen.getByRole("dialog")).getByLabelText("Bloque 1"), "t-night");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Aplicar" }));
    await user.click(screen.getByRole("button", { name: "Guardar versión" }));
    expect(vi.mocked(shiftRotationApiService.updateVersion).mock.calls[0]![2]).toMatchObject({ expectedUpdatedAt: "2026-11-24T10:00:00.000Z" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Otra persona modificó esta versión");

    await user.click(screen.getByRole("button", { name: "Ver la versión guardada" }));
    const dialog = await screen.findByRole("dialog", { name: "Versión modificada por otra persona" });
    expect(within(dialog).getByRole("table")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Conservar mis cambios" }));
    expect(screen.getByText(/van a reemplazar la versión que guardó la otra persona/)).toBeInTheDocument();
    // El borrador sigue con el cambio del usuario.
    expect(cellButton(/^Equipo B, semana A, lunes: Planta noche/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar versión" }));
    expect(vi.mocked(shiftRotationApiService.updateVersion).mock.calls[1]![2]).toMatchObject({ expectedUpdatedAt: "2026-11-24T11:00:00.000Z" });
    expect(onSaved).toHaveBeenCalledWith(expect.anything(), false);
  });

  it("descartar el borrador a favor de la versión guardada pide confirmación", async () => {
    vi.mocked(shiftRotationApiService.updateVersion).mockRejectedValue(new ApiError("Otra persona modificó esta versión.", "ROTATION_VERSION_STALE", 409, { error: { code: "ROTATION_VERSION_STALE" } }));
    const user = userEvent.setup();
    render(<RotationVersionEditor rotation={ROTATION} mode={{ kind: "edit", version: fullVersion() }} onCancel={vi.fn()} onSaved={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /^Equipo B, semana A, lunes/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /Trabaja/ }));
    await user.selectOptions(within(screen.getByRole("dialog")).getByLabelText("Bloque 1"), "t-night");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Aplicar" }));
    await user.click(screen.getByRole("button", { name: "Guardar versión" }));
    await user.click(await screen.findByRole("button", { name: "Ver la versión guardada" }));
    await user.click(await screen.findByRole("button", { name: "Descartar mis cambios y usar esta" }));
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("Se descartan todos los cambios"), expect.anything());
    expect(cellButton(/^Equipo B, semana A, lunes: Descanso/)).toBeInTheDocument();
  });
});

describe("acciones de versión en la grilla", () => {
  const LOCKED = { ...SUMMARY, id: "v0", effectiveFrom: "2026-11-02", effectiveTo: "2026-11-29", locked: true, inEffectToday: true };

  it("RRHH: la versión que ya rigió es de sólo lectura; la futura se edita o elimina", async () => {
    vi.mocked(shiftRotationApiService.version).mockImplementation(async (_r, id) => fullVersion({ id, locked: id === "v0" }));
    const user = userEvent.setup();
    render(<RotationGridPanel rotation={rotationFixture({ crews: CREWS, versions: [LOCKED, SUMMARY], status: "ACTIVO" })} reloadToken={0} canEdit onVersionsChanged={vi.fn()} />);
    expect(await screen.findByText(/ya rigió y no se puede modificar/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar esta versión/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nueva versión/ })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Versión"), "v1");
    expect(await screen.findByRole("button", { name: /Editar esta versión/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Eliminar versión/ })).toBeInTheDocument();
  });

  it("eliminar explica qué versión vuelve a regir y pide confirmación", async () => {
    const onVersionsChanged = vi.fn();
    vi.mocked(shiftRotationApiService.version).mockImplementation(async (_r, id) => fullVersion({ id, locked: id === "v0" }));
    vi.mocked(shiftRotationApiService.removeVersion).mockResolvedValue({});
    const user = userEvent.setup();
    render(<RotationGridPanel rotation={rotationFixture({ crews: CREWS, versions: [LOCKED, SUMMARY], status: "ACTIVO" })} reloadToken={0} canEdit onVersionsChanged={onVersionsChanged} />);
    await screen.findByText(/ya rigió/);
    await user.selectOptions(screen.getByLabelText("Versión"), "v1");
    await user.click(await screen.findByRole("button", { name: /Eliminar versión/ }));
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("La versión anterior (desde el 02/11/2026) vuelve a regir sin fecha de fin."), expect.objectContaining({ tone: "danger" }));
    expect(shiftRotationApiService.removeVersion).toHaveBeenCalledWith("rot-1", "v1");
    expect(onVersionsChanged).toHaveBeenCalled();
  });

  it("Supervisión y Carga Horaria no ven acciones de versión", async () => {
    render(<RotationGridPanel rotation={rotationFixture({ crews: CREWS, versions: [SUMMARY] })} reloadToken={0} canEdit={false} />);
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: /Nueva versión|Editar esta versión|Eliminar versión/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar día/ })).not.toBeInTheDocument();
  });

  it("sin versiones, RRHH crea la primera desde el estado vacío", async () => {
    const user = userEvent.setup();
    render(<RotationGridPanel rotation={rotationFixture({ crews: CREWS, versions: [] })} reloadToken={0} canEdit />);
    await user.click(screen.getByRole("button", { name: /Nueva versión/ }));
    expect(await screen.findByRole("heading", { name: "Nueva versión de la grilla" })).toBeInTheDocument();
    expect(screen.getByLabelText("Partir de")).toHaveValue("empty");
    expect(await screen.findByText(/Faltan 14 días por configurar/)).toBeInTheDocument();
  });
});
