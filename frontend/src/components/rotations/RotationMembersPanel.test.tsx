/**
 * R4.8C: personas de la rotación (lista, historial, alta múltiple, turnos
 * fijos con cierre explícito, baja, cambio de equipo, cancelación, errores y
 * permisos).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RotationMembersPanel } from "./RotationMembersPanel";
import { shiftRotationApiService, type ShiftRotationMember } from "../../services/api/shiftRotationApiService";
import { ApiError } from "../../services/api/apiClient";
import { confirmAction } from "../../services/appDialog";
import { rotationFixture } from "../../test/shiftRotationFixtures";
import type { Employee } from "../../types";

vi.mock("../../services/appDialog", () => ({ confirmAction: vi.fn().mockResolvedValue(true) }));
vi.mock("../../services/api/shiftRotationApiService", () => ({ shiftRotationApiService: { members: vi.fn(), addMembers: vi.fn(), closeMember: vi.fn(), moveMember: vi.fn(), cancelMember: vi.fn() } }));
vi.mock("../../utils/argentinaDateKey", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../utils/argentinaDateKey")>()), argentinaDateKey: () => "2026-11-24" }));
// El selector remoto real busca en la API; acá un doble agrega personas de a una o muchas.
vi.mock("../employees/EmployeeRemoteSelector", () => ({
  EmployeeRemoteSelector: ({ selected, onChange }: { selected: Employee[]; onChange: (next: Employee[]) => void }) => (
    <div>
      <p>Seleccionadas: {selected.length}</p>
      <button type="button" onClick={() => onChange([...selected, { id: `e${selected.length + 1}`, legajo: String(100 + selected.length) } as unknown as Employee])}>Elegir una persona</button>
      <button type="button" onClick={() => onChange(Array.from({ length: 51 }, (_, index) => ({ id: `x${index}` }) as unknown as Employee))}>Elegir 51 personas</button>
    </div>
  ),
}));

const ROTATION = rotationFixture({
  status: "ACTIVO",
  crews: [
    { id: "crew-a", code: "A", name: "Equipo A", sortOrder: 10, status: "ACTIVO", openMemberCount: 2, everHadMembers: true },
    { id: "crew-b", code: "B", name: "Equipo B", sortOrder: 20, status: "ACTIVO", openMemberCount: 1, everHadMembers: true },
  ],
});
const member = (overrides: Partial<ShiftRotationMember>): ShiftRotationMember => ({
  id: "m1", crewId: "crew-a", crew: "A - Equipo A", employeeId: "e1", legajo: "19", employee: "Pérez, Ana · Legajo 19", employeeStatus: "ACTIVO", effectiveFrom: "2026-11-02", effectiveTo: null, ...overrides,
});
const CURRENT = [
  member({}),
  member({ id: "m2", employeeId: "e2", legajo: "21", employee: "Gómez, Luis · Legajo 21", employeeStatus: "INACTIVO", crewId: "crew-b", crew: "B - Equipo B" }),
  member({ id: "m3", employeeId: "e3", legajo: "30", employee: "Fernández González, María de los Ángeles · Legajo 30", effectiveFrom: "2026-12-01" }),
];
const HISTORY = [...CURRENT, member({ id: "m0", effectiveFrom: "2026-10-01", effectiveTo: "2026-11-01", crewId: "crew-b", crew: "B - Equipo B" })];

const row = (name: RegExp) => screen.getAllByRole("row").find((tr) => name.test(tr.textContent ?? ""))!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(confirmAction).mockResolvedValue(true);
  vi.mocked(shiftRotationApiService.members).mockImplementation(async (_id, history) => (history ? HISTORY : CURRENT));
});

describe("lista de personas", () => {
  it("muestra legajo, persona, equipo, período y estado, ordenado por persona", async () => {
    render(<RotationMembersPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    const rows = (await screen.findAllByRole("row")).slice(1);
    expect(rows.map((tr) => within(tr).getAllByRole("cell")[0]!.textContent)).toEqual(["30", "21", "19"]);
    expect(within(rows[0]!).getByText("Futura")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Persona inactiva")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Vigente")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Sin fecha de fin")).toBeInTheDocument();
    expect(shiftRotationApiService.members).toHaveBeenCalledWith("rot-1", false);
  });

  it("el historial incluye períodos terminados y se pide al backend", async () => {
    const user = userEvent.setup();
    render(<RotationMembersPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    await screen.findAllByRole("row");
    await user.click(screen.getByRole("tab", { name: "Historial completo" }));
    expect(await screen.findByText("Finalizada")).toBeInTheDocument();
    expect(shiftRotationApiService.members).toHaveBeenLastCalledWith("rot-1", true);
    // El período terminado no tiene acciones.
    expect(within(row(/Finalizada/)).queryByRole("button")).not.toBeInTheDocument();
  });

  it("acciones según lo que admite el backend: vigente se da de baja o cambia de equipo; futura se cancela", async () => {
    render(<RotationMembersPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    await screen.findAllByRole("row");
    const current = row(/Pérez, Ana/);
    expect(within(current).getByRole("button", { name: /Dar de baja/ })).toBeInTheDocument();
    expect(within(current).getByRole("button", { name: /Cambiar de equipo/ })).toBeInTheDocument();
    expect(within(current).queryByRole("button", { name: /Cancelar el alta/ })).not.toBeInTheDocument();
    const future = row(/Fernández González/);
    expect(within(future).getByRole("button", { name: /Cancelar el alta/ })).toBeInTheDocument();
    expect(within(future).queryByRole("button", { name: /Dar de baja/ })).not.toBeInTheDocument();
  });

  it("historial inmutable: un período terminado no tiene acciones aunque la rotación esté inactiva", async () => {
    vi.mocked(shiftRotationApiService.members).mockResolvedValue([member({ id: "old", effectiveFrom: "2026-10-01", effectiveTo: "2026-11-01" })]);
    render(<RotationMembersPanel rotation={{ ...ROTATION, status: "INACTIVO" }} canEdit onChanged={vi.fn()} />);
    expect(await screen.findByText("Finalizada")).toBeInTheDocument();
    expect(within(row(/Finalizada/)).queryByRole("button")).not.toBeInTheDocument();
  });

  it("Supervisión y Carga Horaria consultan sin acciones", async () => {
    render(<RotationMembersPanel rotation={ROTATION} canEdit={false} onChanged={vi.fn()} />);
    await screen.findAllByRole("row");
    expect(screen.queryByRole("button", { name: /Incorporar|Dar de baja|Cambiar de equipo|Cancelar el alta/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
  });

  it("vacío y error de carga", async () => {
    vi.mocked(shiftRotationApiService.members).mockResolvedValueOnce([]);
    const { unmount } = render(<RotationMembersPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    expect(await screen.findByText(/No hay personas vigentes ni con inicio futuro/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Incorporar personas/ })).toHaveLength(1);
    unmount();
    vi.mocked(shiftRotationApiService.members).mockRejectedValueOnce(new Error("network"));
    render(<RotationMembersPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    expect(await screen.findByText("No pudimos cargar las personas de la rotación.")).toBeInTheDocument();
  });
});

describe("incorporar personas", () => {
  it("valida, limita a 50 y envía equipo, fechas y personas", async () => {
    const onChanged = vi.fn();
    vi.mocked(shiftRotationApiService.addMembers).mockResolvedValue({ members: [member({}), member({ id: "x" })], closedFixedAssignments: 0 });
    const user = userEvent.setup();
    render(<RotationMembersPanel rotation={ROTATION} canEdit onChanged={onChanged} />);
    await user.click(await screen.findByRole("button", { name: /Incorporar personas/ }));
    const dialog = screen.getByRole("dialog", { name: "Incorporar personas" });
    expect(within(dialog).getByLabelText("Desde *")).toHaveValue("2026-11-25");
    await user.click(within(dialog).getByRole("button", { name: "Incorporar personas" }));
    expect(within(dialog).getByText("Elegí el equipo.")).toBeInTheDocument();
    expect(within(dialog).getByText("Elegí al menos una persona.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Elegir 51 personas" }));
    expect(within(dialog).getByText("Elegiste 51 personas: el máximo es 50 por vez.")).toHaveClass("is-over");
    await user.click(within(dialog).getByRole("button", { name: "Incorporar personas" }));
    expect(within(dialog).getByText("Podés incorporar hasta 50 personas por vez.")).toBeInTheDocument();
    expect(shiftRotationApiService.addMembers).not.toHaveBeenCalled();
  });

  it("fecha anterior a mañana y fin antes del inicio se avisan en el campo", async () => {
    const user = userEvent.setup();
    render(<RotationMembersPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /Incorporar personas/ }));
    const dialog = screen.getByRole("dialog");
    const from = within(dialog).getByLabelText("Desde *");
    await user.clear(from);
    await user.type(from, "2026-11-24");
    const to = within(dialog).getByLabelText("Hasta");
    await user.type(to, "2026-11-20");
    await user.click(within(dialog).getByRole("button", { name: "Incorporar personas" }));
    expect(within(dialog).getByText("Elegí el 25/11/2026 o una fecha posterior.")).toBeInTheDocument();
    expect(within(dialog).getByText("La fecha de fin no puede ser anterior a la de inicio.")).toBeInTheDocument();
  });

  it("turnos fijos superpuestos: explica el impacto y repite el alta sólo con la confirmación explícita, sin perder la selección", async () => {
    vi.mocked(shiftRotationApiService.addMembers)
      .mockRejectedValueOnce(new ApiError("x", "ROTATION_FIXED_ASSIGNMENT_OVERLAP", 409, { error: { code: "ROTATION_FIXED_ASSIGNMENT_OVERLAP", message: "… closeFixedAssignments.", details: { assignments: [{ employee: "Pérez, Ana · Legajo 19", template: "P-01", effectiveFrom: "2026-10-01", effectiveTo: null }] } } }))
      .mockResolvedValueOnce({ members: [member({})], closedFixedAssignments: 1 });
    const user = userEvent.setup();
    render(<RotationMembersPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /Incorporar personas/ }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Equipo *"), "crew-a");
    await user.click(within(dialog).getByRole("button", { name: "Elegir una persona" }));
    await user.click(within(dialog).getByRole("button", { name: "Incorporar personas" }));
    expect(vi.mocked(shiftRotationApiService.addMembers).mock.calls[0]).toEqual(["rot-1", "crew-a", { employeeIds: ["e1"], effectiveFrom: "2026-11-25", effectiveTo: null, closeFixedAssignments: false }]);
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Pérez, Ana · Legajo 19: turno fijo P-01 desde el 01/10/2026");
    expect(alert).toHaveTextContent("los que ya rigen terminan el 24/11/2026");
    expect(alert).not.toHaveTextContent("closeFixedAssignments");
    expect(within(dialog).getByText("Seleccionadas: 1")).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText("Cerrar estos turnos fijos al incorporar a las personas"));
    await user.click(within(dialog).getByRole("button", { name: "Cerrar turnos fijos e incorporar" }));
    expect(vi.mocked(shiftRotationApiService.addMembers).mock.calls[1]![2]).toMatchObject({ employeeIds: ["e1"], closeFixedAssignments: true });
    expect(await screen.findByText("1 persona incorporada · 1 turno fijo cerrado.")).toBeInTheDocument();
  });

  it("cambiar la selección después del aviso exige volver a confirmar", async () => {
    vi.mocked(shiftRotationApiService.addMembers).mockRejectedValueOnce(new ApiError("x", "ROTATION_FIXED_ASSIGNMENT_OVERLAP", 409, { error: { code: "ROTATION_FIXED_ASSIGNMENT_OVERLAP", details: { assignments: [{ employee: "Pérez, Ana · Legajo 19", template: "P-01", effectiveFrom: "2026-10-01", effectiveTo: null }] } } }));
    const user = userEvent.setup();
    render(<RotationMembersPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /Incorporar personas/ }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Equipo *"), "crew-a");
    await user.click(within(dialog).getByRole("button", { name: "Elegir una persona" }));
    await user.click(within(dialog).getByRole("button", { name: "Incorporar personas" }));
    await user.click(await within(dialog).findByLabelText("Cerrar estos turnos fijos al incorporar a las personas"));
    await user.click(within(dialog).getByRole("button", { name: "Elegir una persona" }));
    expect(within(dialog).queryByLabelText("Cerrar estos turnos fijos al incorporar a las personas")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Incorporar personas" })).toBeInTheDocument();
  });

  it("superposición con otra rotación, régimen sin turno o persona inactiva: mensaje en el modal y formulario conservado", async () => {
    vi.mocked(shiftRotationApiService.addMembers).mockRejectedValue(new ApiError("No pudimos completar la operación. Intentá nuevamente.", "ROTATION_SIN_TURNO_OVERLAP", 409, { error: { code: "ROTATION_SIN_TURNO_OVERLAP", message: "Tienen régimen SIN_TURNO en esas fechas, incompatible con una rotación: Pérez, Ana · Legajo 19." } }));
    const user = userEvent.setup();
    render(<RotationMembersPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /Incorporar personas/ }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Equipo *"), "crew-b");
    await user.click(within(dialog).getByRole("button", { name: "Elegir una persona" }));
    await user.click(within(dialog).getByRole("button", { name: "Incorporar personas" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Tienen régimen «Sin turno obligatorio» en esas fechas");
    expect(within(dialog).getByLabelText("Equipo *")).toHaveValue("crew-b");
    expect(within(dialog).getByText("Seleccionadas: 1")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SIN_TURNO|ROTATION_/);
  });
});

describe("baja, cambio de equipo y cancelación", () => {
  it("baja: propone hoy, informa quién queda sin turno y avisa al detalle", async () => {
    const onChanged = vi.fn();
    vi.mocked(shiftRotationApiService.closeMember).mockResolvedValue({ member: member({ effectiveTo: "2026-11-24" }), withoutFixedShiftAfter: [{ employeeId: "e1", employee: "Pérez, Ana · Legajo 19", from: "2026-11-25" }] });
    const user = userEvent.setup();
    render(<RotationMembersPanel rotation={ROTATION} canEdit onChanged={onChanged} />);
    await screen.findAllByRole("row");
    await user.click(within(row(/Pérez, Ana/)).getByRole("button", { name: /Dar de baja/ }));
    const dialog = screen.getByRole("dialog", { name: "Dar de baja de la rotación" });
    expect(within(dialog).getByLabelText("Último día *")).toHaveValue("2026-11-24");
    await user.click(within(dialog).getByRole("button", { name: "Dar de baja" }));
    expect(shiftRotationApiService.closeMember).toHaveBeenCalledWith("rot-1", "m1", "2026-11-24");
    expect(await screen.findByText(/no tienen turno fijo ni otra rotación/)).toBeInTheDocument();
    expect(screen.getByText("Pérez, Ana · Legajo 19: desde el 25/11/2026")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("baja rechazada: el mensaje queda en el modal con la fecha elegida", async () => {
    vi.mocked(shiftRotationApiService.closeMember).mockRejectedValue(new ApiError("x", "ROTATION_TRANSITION_OVERLAP", 409, { error: { code: "ROTATION_TRANSITION_OVERLAP", message: "El último turno de la rotación se superpone con el turno que rige al día siguiente.", details: { overlaps: [{ employee: "Pérez, Ana · Legajo 19", outgoing: "P-1907 19:00–07:00 del 2026-11-26", incoming: "F-01 06:00–14:00 del 2026-11-27" }] } } }));
    const user = userEvent.setup();
    render(<RotationMembersPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    await screen.findAllByRole("row");
    await user.click(within(row(/Pérez, Ana/)).getByRole("button", { name: /Dar de baja/ }));
    const dialog = screen.getByRole("dialog");
    const date = within(dialog).getByLabelText("Último día *");
    await user.clear(date);
    await user.type(date, "2026-11-26");
    await user.click(within(dialog).getByRole("button", { name: "Dar de baja" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("se superpone con el turno que rige al día siguiente");
    expect(alert).toHaveTextContent("P-1907 19:00–07:00 del 26/11/2026 se superpone con F-01 06:00–14:00 del 27/11/2026");
    expect(date).toHaveValue("2026-11-26");
  });

  it("cambio de equipo: elige otro equipo activo desde mañana", async () => {
    vi.mocked(shiftRotationApiService.moveMember).mockResolvedValue({ closed: member({}), opened: member({}) });
    const user = userEvent.setup();
    render(<RotationMembersPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    await screen.findAllByRole("row");
    await user.click(within(row(/Pérez, Ana/)).getByRole("button", { name: /Cambiar de equipo/ }));
    const dialog = screen.getByRole("dialog", { name: "Cambiar de equipo" });
    expect(within(dialog).getAllByRole("option").map((option) => option.textContent)).toEqual(["Elegí un equipo", "Equipo B (equipo B)"]);
    expect(within(dialog).getByLabelText("Equipo nuevo *")).toHaveValue("crew-b");
    expect(within(dialog).getByLabelText("Desde *")).toHaveValue("2026-11-25");
    await user.click(within(dialog).getByRole("button", { name: "Cambiar de equipo" }));
    expect(shiftRotationApiService.moveMember).toHaveBeenCalledWith("rot-1", "m1", "crew-b", "2026-11-25");
    expect(await screen.findByText("Pérez, Ana · Legajo 19 pasa a Equipo B desde el 25/11/2026.")).toBeInTheDocument();
  });

  it("cancelar un alta futura pide confirmación", async () => {
    vi.mocked(shiftRotationApiService.cancelMember).mockResolvedValue({});
    const user = userEvent.setup();
    render(<RotationMembersPanel rotation={ROTATION} canEdit onChanged={vi.fn()} />);
    await screen.findAllByRole("row");
    await user.click(within(row(/Fernández González/)).getByRole("button", { name: /Cancelar el alta/ }));
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("Todavía no rigió"), expect.objectContaining({ tone: "danger" }));
    expect(shiftRotationApiService.cancelMember).toHaveBeenCalledWith("rot-1", "m3");
    expect(await screen.findByText("Alta cancelada.")).toBeInTheDocument();
  });
});
