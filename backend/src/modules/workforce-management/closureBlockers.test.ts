import { describe, expect, it, vi } from "vitest";
import { findOperationalClosureBlockers, groupClosureBlockers, noveltyReviewBlockers, OPEN_SHIFT_LOOKBACK_MS, periodInstantBounds } from "./closureBlockers";

const ana = { id: "emp-1", legajo: "29", firstName: "Ana", lastName: "Prueba" };
const beto = { id: "emp-2", legajo: "30", firstName: "Beto", lastName: "Alvarez" };

type Shift = { id: string; status: string; startAt: Date; endAt: Date | null; maxAllowedMinutes: number; employee: typeof ana };

function fakeDb(shifts: Shift[], alerts: Array<{ id: string; actualAt: Date; employee: typeof ana }> = []) {
  return {
    workShift: { findMany: vi.fn().mockResolvedValue(shifts) },
    shiftAlert: { findMany: vi.fn().mockResolvedValue(alerts) },
  };
}

// Argentina es UTC-3: 31/10 22:00 ART = 01/11 01:00 UTC.
const art = (dateTime: string) => new Date(`${dateTime}:00.000-03:00`);

describe("periodInstantBounds", () => {
  it("usa la medianoche argentina de inicio y de fin (exclusivo)", () => {
    expect(periodInstantBounds("2026-10")).toEqual({ startAt: art("2026-10-01T00:00"), endAt: art("2026-11-01T00:00") });
  });
});

describe("findOperationalClosureBlockers — jornadas que atraviesan el cambio de mes", () => {
  it("consulta sólo bloqueantes reales y busca jornadas sin fin con margen hacia atrás", async () => {
    const db = fakeDb([]);
    await findOperationalClosureBlockers(db as never, ["emp-1"], "2026-11");
    const where = db.workShift.findMany.mock.calls[0]![0].where;
    const start = art("2026-11-01T00:00");
    expect(where.startAt).toEqual({ lt: art("2026-12-01T00:00") });
    expect(where.AND[0]).toEqual({ OR: [{ endAt: null, startAt: { gte: new Date(start.getTime() - OPEN_SHIFT_LOOKBACK_MS) } }, { endAt: { gt: start } }] });
    expect(where.AND[1]).toEqual({ OR: [{ status: "ABIERTO" }, { status: { in: ["FALTA_SALIDA", "FALTA_INGRESO", "INVALIDO"] }, reviewStatus: "PENDIENTE" }] });
    expect(db.shiftAlert.findMany.mock.calls[0]![0].where).toMatchObject({ type: "ACTIVIDAD_SOBRE_CARGA_MANUAL", status: "PENDIENTE" });
  });

  it("jornada nocturna abierta del 31/10 22:00: bloquea octubre (empezó ahí) y noviembre (puede sumar horas del 01/11)", async () => {
    const night: Shift = { id: "night", status: "ABIERTO", startAt: art("2026-10-31T22:00"), endAt: null, maxAllowedMinutes: 720, employee: ana };

    const october = await findOperationalClosureBlockers(fakeDb([night]) as never, ["emp-1"], "2026-10");
    const november = await findOperationalClosureBlockers(fakeDb([night]) as never, ["emp-1"], "2026-11");

    expect(october).toEqual([expect.objectContaining({ type: "OPEN_SHIFT", date: "2026-10-31", resolution: expect.objectContaining({ path: "/asistencia?date=2026-10-31" }) })]);
    expect(october[0]!.reason).not.toContain("Empezó el");
    expect(november).toEqual([expect.objectContaining({ type: "OPEN_SHIFT", date: "2026-10-31" })]);
    expect(november[0]!.reason).toContain("Empezó el 31/10/2026 y puede sumar horas a este período.");
  });

  it("jornada sin salida que no alcanza el período (máximo antes de la medianoche) no bloquea el mes siguiente", async () => {
    const day: Shift = { id: "day", status: "FALTA_SALIDA", startAt: art("2026-10-31T08:00"), endAt: null, maxAllowedMinutes: 600, employee: ana };
    await expect(findOperationalClosureBlockers(fakeDb([day]) as never, ["emp-1"], "2026-11")).resolves.toEqual([]);
  });

  it("jornada nocturna con fin (31/10 22:00 → 01/11 06:00) inválida sin revisar bloquea ambos meses: su `endAt` se superpone con noviembre", async () => {
    const invalid: Shift = { id: "invalid", status: "INVALIDO", startAt: art("2026-10-31T22:00"), endAt: art("2026-11-01T06:00"), maxAllowedMinutes: 720, employee: ana };
    const november = await findOperationalClosureBlockers(fakeDb([invalid]) as never, ["emp-1"], "2026-11");
    expect(november).toEqual([expect.objectContaining({ type: "INCOMPLETE_SHIFT", title: "Jornada inválida", date: "2026-10-31", resolution: expect.objectContaining({ path: "/asistencia?observationDate=2026-10-31" }) })]);
  });

  it("fichada sobre horas manuales sin decidir lleva a Carga de horas del mes de la incidencia", async () => {
    const result = await findOperationalClosureBlockers(fakeDb([], [{ id: "a1", actualAt: art("2026-10-12T09:00"), employee: ana }]) as never, ["emp-1"], "2026-10");
    expect(result).toEqual([expect.objectContaining({ id: "conflict:a1", type: "MANUAL_CLOCK_CONFLICT", date: "2026-10-12", resolution: { module: "HOURS", label: "Ir a Carga de horas", path: "/horas?period=2026-10" } })]);
  });

  it("sin legajos no consulta nada", async () => {
    const db = fakeDb([]);
    await expect(findOperationalClosureBlockers(db as never, [], "2026-10")).resolves.toEqual([]);
    expect(db.workShift.findMany).not.toHaveBeenCalled();
  });
});

describe("noveltyReviewBlockers y groupClosureBlockers", () => {
  it("cada día en revisión es un bloqueante que abre el legajo horario del período", () => {
    expect(noveltyReviewBlockers(beto, "2026-10", ["2026-10-08", "2026-10-09"]).map((item) => [item.type, item.date, item.resolution.path])).toEqual([
      ["NOVELTY_REVIEW", "2026-10-08", "/horas/emp-2?period=2026-10"],
      ["NOVELTY_REVIEW", "2026-10-09", "/horas/emp-2?period=2026-10"],
    ]);
  });

  it("agrupa por legajo (apellido, nombre) con las incidencias ordenadas por fecha", () => {
    const [first, second] = noveltyReviewBlockers(beto, "2026-10", ["2026-10-09", "2026-10-02"]);
    const groups = groupClosureBlockers([...noveltyReviewBlockers(ana, "2026-10", ["2026-10-05"]), first!, second!]);
    expect(groups.map((group) => group.employee.legajo)).toEqual(["30", "29"]);
    expect(groups[0]!.blockers.map((item) => item.date)).toEqual(["2026-10-02", "2026-10-09"]);
  });
});
