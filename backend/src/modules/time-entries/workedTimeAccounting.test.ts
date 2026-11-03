import { describe, expect, it } from "vitest";
import {
  accountDay,
  accountEmployeePeriod,
  accountEmployeePeriods,
  applyDayOffExclusions,
  dayOffKey,
  isAutomaticTimeEntrySource,
  toAccountingBaseEntry,
  toAccountingBreakdown,
  withinBaseCoverageMinutes,
  type AccountingBaseEntry,
  type AccountingBreakdown,
} from "./workedTimeAccounting";

const H = 60;
const EMPLOYEE = "emp-1";

function base(hours: number, multiplier = 1, day = 1): AccountingBaseEntry {
  return { employeeId: EMPLOYEE, day, minutes: hours * H, multiplier };
}

function sereno(hours: number, multiplier = 1, day = 1, interval?: [string, string]): AccountingBreakdown {
  return {
    employeeId: EMPLOYEE,
    day,
    hourConceptId: "sereno",
    treatment: "WITHIN_BASE",
    minutes: hours * H,
    multiplier,
    startAt: interval ? new Date(interval[0]) : null,
    endAt: interval ? new Date(interval[1]) : null,
  };
}

function colectivo(hours: number, multiplier = 1, day = 1): AccountingBreakdown {
  return { employeeId: EMPLOYEE, day, hourConceptId: "colectivo", treatment: "ADDITIVE_TO_WORKED_TOTAL", minutes: hours * H, multiplier };
}

function concept(day: ReturnType<typeof accountDay>, id: string) {
  return day.concepts.find((item) => item.hourConceptId === id);
}

describe("workedTimeAccounting — fórmulas oficiales", () => {
  it("Caso 1: base 8 sin conceptos x1 → normal 8, real 8, liquidable 8", () => {
    const day = accountDay(1, [base(8)], []);
    expect(day.normalResidualMinutes).toBe(8 * H);
    expect(day.totalWorkedMinutes).toBe(8 * H);
    expect(day.settlement.totalMinutes).toBe(8 * H);
  });

  it("Caso 2: base 8 + Sereno 3 (dentro) x1 → normal 5, Sereno 3, real 8, liquidable 8", () => {
    const day = accountDay(1, [base(8)], [sereno(3)]);
    expect(day.normalResidualMinutes).toBe(5 * H);
    expect(concept(day, "sereno")?.realMinutes).toBe(3 * H);
    expect(day.totalWorkedMinutes).toBe(8 * H);
    expect(day.settlement.totalMinutes).toBe(8 * H);
  });

  it("Caso 3: base 8 + Colectivo 1 (adicional) x1 → normal 8, real 9, liquidable 9", () => {
    const day = accountDay(1, [base(8)], [colectivo(1)]);
    expect(day.normalResidualMinutes).toBe(8 * H);
    expect(concept(day, "colectivo")?.realMinutes).toBe(1 * H);
    expect(day.totalWorkedMinutes).toBe(9 * H);
    expect(day.settlement.totalMinutes).toBe(9 * H);
  });

  it("Caso 4 (principal): base 8 + Sereno 3 + Colectivo 1 x1 → 5 + 3 + 1 = 9", () => {
    const day = accountDay(1, [base(8)], [sereno(3), colectivo(1)]);
    expect(day.baseMinutes).toBe(8 * H);
    expect(day.normalResidualMinutes).toBe(5 * H);
    expect(concept(day, "sereno")?.realMinutes).toBe(3 * H);
    expect(concept(day, "colectivo")?.realMinutes).toBe(1 * H);
    expect(day.totalWorkedMinutes).toBe(9 * H);
    expect(day.settlement.totalMinutes).toBe(9 * H);
  });

  it("Caso 5 (domingo x2): base 8 + Sereno 3 + Colectivo 1 → liquidable 10 + 6 + 2 = 18, real 9 (nunca 22 ni 24)", () => {
    const day = accountDay(1, [base(8, 2)], [sereno(3, 2), colectivo(1, 2)]);
    expect(day.totalWorkedMinutes).toBe(9 * H);
    expect(day.settlement.normalMinutes).toBe(10 * H);
    expect(concept(day, "sereno")?.settlementMinutes).toBe(6 * H);
    expect(concept(day, "colectivo")?.settlementMinutes).toBe(2 * H);
    expect(day.settlement.withinBaseMinutes).toBe(6 * H);
    expect(day.settlement.additiveMinutes).toBe(2 * H);
    expect(day.settlement.totalMinutes).toBe(18 * H);
    expect(day.settlement.totalMinutes).toBe(day.totalWorkedMinutes * 2);
    expect(day.multiplier).toBe(2);
  });

  it("Caso 6: base 8 + Sereno 3 x2 → normal 10, Sereno 6, real 8, equivalencia 16", () => {
    const day = accountDay(1, [base(8, 2)], [sereno(3, 2)]);
    expect(day.settlement.normalMinutes).toBe(10 * H);
    expect(concept(day, "sereno")?.settlementMinutes).toBe(6 * H);
    expect(day.totalWorkedMinutes).toBe(8 * H);
    expect(day.settlement.totalMinutes).toBe(16 * H);
  });

  it("Caso 7: base 0 + Colectivo 2 en domingo x2 → real 2, equivalencia 4 (sin depender de un TimeEntry base)", () => {
    const day = accountDay(1, [], [colectivo(2, 2)]);
    expect(day.baseMinutes).toBe(0);
    expect(day.totalWorkedMinutes).toBe(2 * H);
    expect(day.settlement.totalMinutes).toBe(4 * H);
    expect(day.multiplier).toBe(2);
  });

  it("Caso 8: base 0 + Sereno 2 (dentro) → queda inválido (excedente), nunca se convierte en 2 h adicionales", () => {
    const day = accountDay(1, [], [sereno(2)]);
    expect(day.totalWorkedMinutes).toBe(0);
    expect(day.additiveMinutes).toBe(0);
    expect(day.normalResidualMinutes).toBe(0);
    expect(day.withinBaseExcessMinutes).toBe(2 * H);
    expect(day.withinBaseCoveredMinutes).toBe(0);
  });

  it("un concepto adicional nunca se resta de la base: base 8 + Sereno 3 + Colectivo 4 → normal 5 (no 1)", () => {
    const day = accountDay(1, [base(8)], [sereno(3), colectivo(4)]);
    expect(day.normalResidualMinutes).toBe(5 * H);
    expect(day.totalWorkedMinutes).toBe(12 * H);
  });

  it("solapamiento WITHIN_BASE: Sereno 23:00–02:00 + otro concepto dentro de la jornada 01:00–03:00 sobre base 8 → cobertura 4 (unión), normal 4, no 3", () => {
    // Fechas UTC equivalentes a la noche Argentina (UTC-3) — misma fecha
    // calendario para todos los tramos en este caso de prueba.
    const serenoInterval = sereno(3, 1, 1, ["2026-08-04T02:00:00.000Z", "2026-08-04T05:00:00.000Z"]);
    const nocturna: AccountingBreakdown = {
      employeeId: EMPLOYEE,
      day: 1,
      hourConceptId: "nocturna",
      treatment: "WITHIN_BASE",
      minutes: 2 * H,
      multiplier: 1,
      startAt: new Date("2026-08-04T04:00:00.000Z"),
      endAt: new Date("2026-08-04T06:00:00.000Z"),
    };
    const day = accountDay(1, [base(8)], [serenoInterval, nocturna]);
    expect(day.withinBaseMinutes).toBe(5 * H);
    expect(day.withinBaseCoveredMinutes).toBe(4 * H);
    expect(day.withinBaseOverlapMinutes).toBe(1 * H);
    expect(day.normalResidualMinutes).toBe(4 * H);
    // Cada concepto conserva su desglose individual.
    expect(concept(day, "sereno")?.realMinutes).toBe(3 * H);
    expect(concept(day, "nocturna")?.realMinutes).toBe(2 * H);
    // El total real nunca suma conceptos dentro de la jornada.
    expect(day.totalWorkedMinutes).toBe(8 * H);
  });

  it("desgloses manuales sin intervalo se toman como distribución declarada (sin posición)", () => {
    expect(withinBaseCoverageMinutes([sereno(2), { ...sereno(1), hourConceptId: "otro" }])).toBe(3 * H);
  });

  it("cruce de medianoche sábado 22:00 → domingo 03:00: sábado x1, domingo x2, nunca x2 a toda la jornada", () => {
    // TimeEntry/desgloses ya vienen partidos por fecha Argentina (fichador y
    // generador automático): sábado día 1 = 2 h, domingo día 2 = 3 h.
    const period = accountEmployeePeriod(
      [base(2, 1, 1), base(3, 2, 2)],
      [sereno(1, 1, 1), sereno(3, 2, 2)],
    );
    expect(period.days["1"]?.settlement.totalMinutes).toBe(2 * H);
    expect(period.days["1"]?.multiplier).toBe(1);
    expect(period.days["2"]?.settlement.totalMinutes).toBe(6 * H);
    expect(period.days["2"]?.multiplier).toBe(2);
    expect(period.totalWorkedMinutes).toBe(5 * H);
    expect(period.settlement.totalMinutes).toBe(8 * H);
    expect(period.hasSpecialMultiplier).toBe(true);
  });

  it("agrega el período por empleado sin mezclar empleados", () => {
    const result = accountEmployeePeriods(
      [base(8, 2), { ...base(4), employeeId: "emp-2" }],
      [sereno(3, 2), colectivo(1, 2)],
    );
    expect(result.get(EMPLOYEE)?.totalWorkedMinutes).toBe(9 * H);
    expect(result.get(EMPLOYEE)?.settlement.totalMinutes).toBe(18 * H);
    expect(result.get("emp-2")?.totalWorkedMinutes).toBe(4 * H);
    expect(result.get("emp-2")?.settlement.totalMinutes).toBe(4 * H);
  });

  it("período combinado: concepto agregado por id con real y liquidable", () => {
    const period = accountEmployeePeriod([base(8, 2, 1), base(8, 1, 2)], [sereno(3, 2, 1), sereno(3, 1, 2), colectivo(1, 2, 1)]);
    expect(period.concepts.find((item) => item.hourConceptId === "sereno")).toMatchObject({ realMinutes: 6 * H, settlementMinutes: 9 * H });
    expect(period.normalResidualMinutes).toBe(10 * H);
    expect(period.totalWorkedMinutes).toBe(17 * H);
    expect(period.settlement.totalMinutes).toBe(18 * H + 8 * H);
  });

  // §17: la grilla, el export y el cierre se leen por concepto. Cada fila
  // (Horas normales y cada concepto) tiene real y para liquidación por día y
  // por período; la equivalencia total queda sólo como control.
  it("período mixto por concepto: Prueba 6 + 1×2 → real 7 / liquidación 8; Colectivo 6 + 2×2 → real 8 / liquidación 10", () => {
    const prueba = (hours: number, multiplier: number, day: number): AccountingBreakdown => ({ ...sereno(hours, multiplier, day), hourConceptId: "prueba" });
    const period = accountEmployeePeriod(
      [base(8, 1, 1), base(8, 1, 2), base(8, 1, 3), base(2 + 26 / 60, 2, 5)],
      [prueba(2, 1, 1), prueba(2, 1, 2), prueba(2, 1, 3), prueba(1, 2, 5), colectivo(2, 1, 1), colectivo(2, 1, 2), colectivo(2, 1, 3), colectivo(2, 2, 5)],
    );

    expect(period.concepts.find((item) => item.hourConceptId === "prueba")).toMatchObject({ realMinutes: 7 * H, settlementMinutes: 8 * H });
    expect(period.concepts.find((item) => item.hourConceptId === "colectivo")).toMatchObject({ realMinutes: 8 * H, settlementMinutes: 10 * H });
    // Horas normales: 6+6+6 reales x1 + 1 h 26 min x2.
    expect(period.normalResidualMinutes).toBe(18 * H + 86);
    expect(period.settlement.normalMinutes).toBe(18 * H + 172);
    // El día especial expone cada componente por separado.
    expect(period.days["5"]!.settlement).toMatchObject({ normalMinutes: 172, withinBaseMinutes: 2 * H, additiveMinutes: 4 * H });
    expect(concept(period.days["5"]!, "prueba")).toMatchObject({ realMinutes: H, settlementMinutes: 2 * H });
    expect(concept(period.days["5"]!, "colectivo")).toMatchObject({ realMinutes: 2 * H, settlementMinutes: 4 * H });
    // Total trabajado nunca se multiplica: base + adicionales reales.
    expect(period.totalWorkedMinutes).toBe(24 * H + 146 + 8 * H);
  });

  it("multiplicador x1.5 por concepto: base 8 + Sereno 3 + Colectivo 2 → normal 7.5, Sereno 4.5, Colectivo 3; real 10", () => {
    const day = accountDay(1, [base(8, 1.5)], [sereno(3, 1.5), colectivo(2, 1.5)]);
    expect(day.settlement).toEqual({ normalMinutes: 7.5 * H, withinBaseMinutes: 4.5 * H, additiveMinutes: 3 * H, totalMinutes: 15 * H });
    expect(concept(day, "sereno")).toMatchObject({ realMinutes: 3 * H, settlementMinutes: 4.5 * H });
    expect(concept(day, "colectivo")).toMatchObject({ realMinutes: 2 * H, settlementMinutes: 3 * H });
    expect(day.totalWorkedMinutes).toBe(10 * H);
  });

  it("sin Hora Especial, real y para liquidación coinciden en cada concepto", () => {
    const day = accountDay(1, [base(8)], [sereno(3), colectivo(1)]);
    for (const item of day.concepts) expect(item.settlementMinutes).toBe(item.realMinutes);
    expect(day.settlement.normalMinutes).toBe(day.normalResidualMinutes);
  });

  it("adaptadores Prisma: horas decimales a minutos, multiplicador Decimal, tratamiento obligatorio", () => {
    expect(toAccountingBaseEntry({ employeeId: EMPLOYEE, day: 3, hours: "7.5", appliedMultiplier: "2.00" })).toEqual({ employeeId: EMPLOYEE, day: 3, minutes: 450, multiplier: 2, automatic: false });
    expect(() => toAccountingBreakdown({ employeeId: EMPLOYEE, day: 1, hourConceptId: "x", minutes: 60, hourConcept: { workTreatment: null } })).toThrow();
  });
});


// docs/decisions/EMPLOYEE_DAY_OFF.md §7: en un franco no computan las horas
// automáticas de jornadas de esa fecha operativa; lo cargado o corregido por
// una persona sí. El índice simula lo que arma loadDayOffAccounting.
describe("workedTimeAccounting — francos", () => {
  const DATE = "2026-11-05";
  const DAY = 5;
  const autoBase = (hours: number, overrides: Partial<AccountingBaseEntry> = {}): AccountingBaseEntry => ({ ...base(hours, 1, DAY), dateKey: DATE, automatic: true, ...overrides });
  const index = (excluded: Record<string, number>, shifts: string[] = ["shift-franco"]) => ({
    excludedBaseMinutes: new Map(Object.entries(excluded).map(([date, minutes]) => [dayOffKey(EMPLOYEE, date), minutes])),
    excludedWorkShiftIds: new Set(shifts),
    dayOffDates: new Set([dayOffKey(EMPLOYEE, DATE)]),
  });

  it("señal: sólo los canales del fichador son automáticos; null (carga manual) y ADMIN (registrado/corregido por una persona) no", () => {
    for (const source of ["KIOSK", "PUBLIC_CLOCK_PHOTO", "PORTAL_DNI", "BIOTIME", "FACIAL"] as const) expect(isAutomaticTimeEntrySource(source)).toBe(true);
    expect(isAutomaticTimeEntrySource("ADMIN")).toBe(false);
    expect(isAutomaticTimeEntrySource(null)).toBe(false);
    expect(toAccountingBaseEntry({ employeeId: EMPLOYEE, day: DAY, hours: 8, date: new Date(`${DATE}T00:00:00.000Z`), source: "KIOSK" })).toMatchObject({ dateKey: DATE, automatic: true });
  });

  it("franco sin actividad → 0 h (no hay filas que contar)", () => {
    const period = accountEmployeePeriod([], [], index({}, []));
    expect(period.totalWorkedMinutes).toBe(0);
  });

  it("franco con fichada de 8 h (automática) → 0 h computadas, 8 h registradas sin computar", () => {
    const period = accountEmployeePeriod([autoBase(8)], [], index({ [DATE]: 8 * H }));

    expect(period.totalWorkedMinutes).toBe(0);
    expect(period.baseMinutes).toBe(0);
    expect(period.days[String(DAY)]).toMatchObject({ baseMinutes: 0, totalWorkedMinutes: 0, dayOffUncountedMinutes: 8 * H });
    expect(period.dayOffUncountedMinutes).toBe(8 * H);
  });

  it("franco con fichada corregida a mano por un responsable (source ADMIN) → computan las horas reconocidas", () => {
    const period = accountEmployeePeriod([autoBase(8, { automatic: false })], [], index({ [DATE]: 8 * H }));

    expect(period.totalWorkedMinutes).toBe(8 * H);
    expect(period.dayOffUncountedMinutes).toBe(0);
  });

  it("franco + carga manual de 6 h sin fichada → 6 h computadas", () => {
    const period = accountEmployeePeriod([autoBase(6, { automatic: false })], [], index({}, []));
    expect(period.totalWorkedMinutes).toBe(6 * H);
  });

  it("franco cancelado (índice sin franco) → las mismas 8 h automáticas vuelven a computar", () => {
    const period = accountEmployeePeriod([autoBase(8)], []);
    expect(period.totalWorkedMinutes).toBe(8 * H);
  });

  it("fila automática que mezcla una jornada en franco (2 h) y otra que no (3 h): sólo se descuenta la del franco", () => {
    const period = accountEmployeePeriod([autoBase(5)], [], index({ [DATE]: 2 * H }));
    expect(period.totalWorkedMinutes).toBe(3 * H);
    expect(period.dayOffUncountedMinutes).toBe(2 * H);
  });

  it("el descuento nunca deja minutos negativos (tope: los minutos de la fila)", () => {
    const period = accountEmployeePeriod([autoBase(1)], [], index({ [DATE]: 8 * H }));
    expect(period.totalWorkedMinutes).toBe(0);
    expect(period.dayOffUncountedMinutes).toBe(H);
  });

  it("desgloses: AUTOMATIC de la jornada en franco no computa; MANUAL sí; AUTOMATIC sin jornada se atribuye por la fecha del franco", () => {
    const automaticSereno = { ...sereno(2, 1, DAY), dateKey: DATE, automatic: true, workShiftId: "shift-franco" };
    const otherShiftSereno = { ...sereno(1, 1, DAY), dateKey: DATE, automatic: true, workShiftId: "shift-otra" };
    const legacyColectivo = { ...colectivo(1, 1, DAY), dateKey: DATE, automatic: true, workShiftId: null };
    const manualColectivo = { ...colectivo(2, 1, DAY), dateKey: DATE, automatic: false };

    const result = applyDayOffExclusions([], [automaticSereno, otherShiftSereno, legacyColectivo, manualColectivo], index({}));

    expect(result.excludedBreakdowns).toEqual([automaticSereno, legacyColectivo]);
    expect(result.breakdowns).toEqual([otherShiftSereno, manualColectivo]);
  });

  it("sin francos devuelve exactamente las mismas filas (ningún costo ni cambio para el resto de los días)", () => {
    const entries = [autoBase(8)];
    const result = applyDayOffExclusions(entries, []);
    expect(result.baseEntries).toBe(entries);
    expect(result.uncountedBase).toEqual([]);
  });

  it("varios empleados: el franco de uno nunca descuenta horas del otro", () => {
    const other = { ...autoBase(8), employeeId: "emp-2" };
    const result = accountEmployeePeriods([autoBase(8), other], [], index({ [DATE]: 8 * H }));
    expect(result.get(EMPLOYEE)!.totalWorkedMinutes).toBe(0);
    expect(result.get("emp-2")!.totalWorkedMinutes).toBe(8 * H);
  });
});
