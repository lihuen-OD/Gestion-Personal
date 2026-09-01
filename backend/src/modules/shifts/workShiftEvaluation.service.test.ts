import { describe, expect, it } from "vitest";
import { argentinaCalendarDate } from "../../shared/datetime/argentinaTime";
import {
  DEFAULT_ABSOLUTE_OPEN_SHIFT_LIMIT_MINUTES,
  evaluateEntryPunctuality,
  evaluateExitPunctuality,
  evaluateNewEntryWithOpenShift,
  evaluateOpenShiftRisk,
  evaluateRestPeriod,
  evaluateWorkedDuration,
  hasNoShiftAssignments,
  isEarlyArrivalReviewRequired,
  isShiftAssignmentActiveOnDate,
  isShiftAssignmentApplicableForInstant,
  isShiftAssignmentApplicableOnWeekday,
  matchShiftForEmployee,
  type ShiftTemplateRef,
} from "./workShiftEvaluation.service";

function template(overrides: Partial<ShiftTemplateRef> & { id: string; code: string; startTime: string; endTime: string }): ShiftTemplateRef {
  return {
    crossesMidnight: false,
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 20,
    exitToleranceAfterMinutes: 20,
    minimumMinutesForCompliance: null,
    maximumInformativeMinutes: null,
    missingOutAlertAfterMinutes: null,
    absoluteOpenShiftLimitMinutes: DEFAULT_ABSOLUTE_OPEN_SHIFT_LIMIT_MINUTES,
    ...overrides,
  };
}

function at(hours: number, minutes: number, day = 10) {
  return new Date(2026, 6, day, hours, minutes, 0, 0);
}

const morningShift = template({
  id: "morning",
  code: "TURNO-MANIANA",
  startTime: "06:30",
  endTime: "15:00",
  entryToleranceBeforeMinutes: 10,
  entryToleranceAfterMinutes: 15,
  exitToleranceBeforeMinutes: 20,
  exitToleranceAfterMinutes: 20,
  minimumMinutesForCompliance: 465,
  maximumInformativeMinutes: 540,
});

const nightShift = template({
  id: "sereno",
  code: "TURNO-SERENO",
  startTime: "23:00",
  endTime: "04:00",
  crossesMidnight: true,
  entryToleranceBeforeMinutes: 15,
  entryToleranceAfterMinutes: 15,
  exitToleranceBeforeMinutes: 15,
  exitToleranceAfterMinutes: 15,
});

describe("matchShiftForEmployee", () => {
  it("Caso A: entra dentro de margen contra su turno habilitado", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 35),
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO" }],
      activeTemplates: [morningShift],
    });
    expect(match.case).toBe("ENABLED");
    expect(match.template?.id).toBe("morning");
    expect(match.differenceMinutes).toBe(5);
  });

  it("Caso A: llega tarde igual matchea el único turno habilitado propio (aunque exceda el margen)", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 50),
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO" }],
      activeTemplates: [morningShift],
    });
    expect(match.case).toBe("ENABLED");
    expect(match.differenceMinutes).toBe(20);
  });

  it("Caso B: fichada coincide con un turno del empleado que está deshabilitado, no con el habilitado", () => {
    const enabledEvening = template({ id: "sereno1", code: "SERENO-1", startTime: "17:00", endTime: "23:00" });
    const disabledNight = template({ id: "sereno2", code: "SERENO-2", startTime: "23:00", endTime: "04:00", crossesMidnight: true });
    const match = matchShiftForEmployee({
      actualAt: at(23, 0),
      employeeAssignments: [
        { shiftTemplateId: "sereno1", status: "HABILITADO" },
        { shiftTemplateId: "sereno2", status: "DESHABILITADO" },
      ],
      activeTemplates: [enabledEvening, disabledNight],
    });
    expect(match.case).toBe("DISABLED_FOR_EMPLOYEE");
    expect(match.template?.id).toBe("sereno2");
  });

  // Etapa 13E.1 (docs/decisions/SHIFT_CONFIGURATION_ALERT_POLICY_13E.md):
  // antes de esta etapa, una fichada que coincidía por horario con un turno
  // activo NO asociado al empleado (dentro de la tolerancia general de ese
  // turno) resolvía GENERAL_UNASSIGNED -- se decidió que eso nunca es
  // evidencia real para este empleado. Ahora, sin ninguna asignación propia
  // aplicable, el resultado es NO_MATCH sin excepción, sin importar que
  // exista un turno de otra persona compatible por hora.
  it("Caso C (redefinido 13E.1): sin turno propio, un turno activo de otra persona que coincide por horario ya NO se usa -- NO_MATCH", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 32),
      employeeAssignments: [],
      activeTemplates: [morningShift],
    });
    expect(match.case).toBe("NO_MATCH");
    expect(match.template).toBeNull();
  });

  it("Caso D: no coincide con ningún turno (ni propio ni general dentro de tolerancia)", () => {
    const match = matchShiftForEmployee({
      actualAt: at(11, 0),
      employeeAssignments: [],
      activeTemplates: [morningShift],
    });
    expect(match.case).toBe("NO_MATCH");
    expect(match.template).toBeNull();
  });

  it("Caso E: empleado sin ningún turno asociado (hasNoShiftAssignments)", () => {
    expect(hasNoShiftAssignments([])).toBe(true);
    expect(hasNoShiftAssignments([{ shiftTemplateId: "morning", status: "HABILITADO" }])).toBe(false);
  });

  it("elige el turno más cercano cuando el empleado tiene varios habilitados", () => {
    const afternoonShift = template({ id: "afternoon", code: "TURNO-TARDE", startTime: "14:00", endTime: "22:00" });
    const match = matchShiftForEmployee({
      actualAt: at(14, 5),
      employeeAssignments: [
        { shiftTemplateId: "morning", status: "HABILITADO" },
        { shiftTemplateId: "afternoon", status: "HABILITADO" },
      ],
      activeTemplates: [morningShift, afternoonShift],
    });
    expect(match.case).toBe("ENABLED");
    expect(match.template?.id).toBe("afternoon");
  });

  it("habilitar/deshabilitar un turno cambia la evaluación futura para el mismo horario", () => {
    const inputFor = (status: "HABILITADO" | "DESHABILITADO") =>
      matchShiftForEmployee({ actualAt: at(6, 35), employeeAssignments: [{ shiftTemplateId: "morning", status }], activeTemplates: [morningShift] });
    expect(inputFor("HABILITADO").case).toBe("ENABLED");
    expect(inputFor("DESHABILITADO").case).toBe("DISABLED_FOR_EMPLOYEE");
  });

  // Etapa 13A: estos dos tests reemplazan el comportamiento de la Etapa 8J
  // ("un turno propio no se fuerza si la fichada es de un horario totalmente
  // ajeno, cae a Caso C/D") — la regla funcional aprobada en 13A es la
  // opuesta: si el empleado tiene un turno propio aplicable ese día, ese
  // turno SIEMPRE es la referencia, nunca se busca un turno general/ajeno
  // "para hacer match" (ver docs/decisions/SHIFT_ENTRY_CLASSIFICATION_13A.md).
  it("Etapa 13A: el turno propio siempre gana, aunque un turno general no asignado coincida mejor con la hora", () => {
    const eveningGeneral = template({ id: "evening-general", code: "EVENING-GENERAL", startTime: "20:00", endTime: "23:00" });
    const match = matchShiftForEmployee({
      actualAt: at(20, 3),
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO" }],
      activeTemplates: [morningShift, eveningGeneral],
    });
    expect(match.case).toBe("ENABLED");
    expect(match.template?.id).toBe("morning");
    expect(match.differenceMinutes).toBe(-627);
  });

  it("Etapa 13A: el turno propio sigue matcheando aunque no exista ningún turno general y la fichada esté muy lejos de su horario", () => {
    const match = matchShiftForEmployee({
      actualAt: at(20, 3),
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO" }],
      activeTemplates: [morningShift],
    });
    expect(match.case).toBe("ENABLED");
    expect(match.template?.id).toBe("morning");
    expect(match.differenceMinutes).toBe(-627);
  });

  it("turno sereno cruza medianoche y matchea correctamente cerca del inicio", () => {
    const match = matchShiftForEmployee({
      actualAt: at(23, 5),
      employeeAssignments: [{ shiftTemplateId: "sereno", status: "HABILITADO" }],
      activeTemplates: [nightShift],
    });
    expect(match.case).toBe("ENABLED");
    expect(match.template?.id).toBe("sereno");
  });
});

// Etapa 13A: casos del pedido funcional (docs/decisions/SHIFT_ENTRY_CLASSIFICATION_13A.md).
// Regla: si el empleado tiene un turno propio aplicable ese día, ese turno
// SIEMPRE es la referencia — nunca se compara contra un turno general/ajeno
// "para ver cuál coincide mejor con la hora".
describe("matchShiftForEmployee — Etapa 13A (ingreso anticipado usa el turno asignado)", () => {
  const shift0830 = template({ id: "shift-0830", code: "T-0830", startTime: "08:30", endTime: "16:30" });
  const alien0800 = template({ id: "alien-0800", code: "T-0800", startTime: "08:00", endTime: "16:00" });

  it("Caso 4/E del pedido: turno asignado, entrada antes del horario, sin ningún otro turno en el sistema -> usa el turno propio (antes daba NO_MATCH)", () => {
    const match = matchShiftForEmployee({
      actualAt: at(8, 0),
      employeeAssignments: [{ shiftTemplateId: "shift-0830", status: "HABILITADO" }],
      activeTemplates: [shift0830],
    });
    expect(match.case).toBe("ENABLED");
    expect(match.template?.id).toBe("shift-0830");
    expect(match.differenceMinutes).toBe(-30);
  });

  it("Caso 5/F del pedido: turno asignado 08:30, entrada 08:00, existe un turno general de 08:00 no asignado -> usa el turno propio, nunca el ajeno (antes daba GENERAL_UNASSIGNED sobre el ajeno)", () => {
    const match = matchShiftForEmployee({
      actualAt: at(8, 0),
      employeeAssignments: [{ shiftTemplateId: "shift-0830", status: "HABILITADO" }],
      activeTemplates: [shift0830, alien0800],
    });
    expect(match.case).toBe("ENABLED");
    expect(match.template?.id).toBe("shift-0830");
    expect(match.differenceMinutes).toBe(-30);
  });

  it("Caso H del pedido: entrada muy anticipada (turno 08:30, entrada 04:00) sigue usando el turno propio, nunca un turno ajeno ni NO_MATCH", () => {
    const match = matchShiftForEmployee({
      actualAt: at(4, 0),
      employeeAssignments: [{ shiftTemplateId: "shift-0830", status: "HABILITADO" }],
      activeTemplates: [shift0830, alien0800],
    });
    expect(match.case).toBe("ENABLED");
    expect(match.template?.id).toBe("shift-0830");
    expect(match.differenceMinutes).toBe(-270);
  });

  it("Caso G del pedido: varios turnos propios asignados el mismo día -> gana el más cercano, incluso adelantado (mismo criterio ya usado para llegadas tarde)", () => {
    const afternoonShift = template({ id: "afternoon", code: "TURNO-TARDE", startTime: "14:00", endTime: "22:00" });
    const match = matchShiftForEmployee({
      actualAt: at(13, 0),
      employeeAssignments: [
        { shiftTemplateId: "morning", status: "HABILITADO" },
        { shiftTemplateId: "afternoon", status: "HABILITADO" },
      ],
      activeTemplates: [morningShift, afternoonShift],
    });
    expect(match.case).toBe("ENABLED");
    expect(match.template?.id).toBe("afternoon");
    expect(match.differenceMinutes).toBe(-60);
  });

  // Etapa 13E.1 (docs/decisions/SHIFT_CONFIGURATION_ALERT_POLICY_13E.md):
  // los dos "Caso I" de 13A quedaban documentados como GENERAL_UNASSIGNED a
  // propósito (8J, no tocado por 13A) -- esa rama en sí misma se eliminó
  // acá. Redefinidos para reflejar la regla nueva: sin ninguna asignación
  // propia aplicable ese día, jamás se compara contra un ShiftTemplate
  // ajeno, sin importar que exista uno con esa hora en el sistema.
  it("Caso I del pedido (redefinido 13E.1): sin ninguna asignación, un turno general en el sistema coincide con la hora -> ya NO se usa, NO_MATCH", () => {
    const match = matchShiftForEmployee({
      actualAt: at(8, 25), // dentro de la tolerancia general (10 min) del turno 08:30 -- irrelevante ahora, no se compara
      employeeAssignments: [],
      activeTemplates: [shift0830],
    });
    expect(match.case).toBe("NO_MATCH");
    expect(match.template).toBeNull();
  });

  it("Caso I del pedido (redefinido 13E.1): asignación existente pero no aplicable hoy (weekday no coincide) -> tampoco se compara contra el turno ajeno, NO_MATCH", () => {
    const match = matchShiftForEmployee({
      actualAt: at(8, 25, 7), // martes 2026-07-07, dentro de la tolerancia general del turno 08:30 -- irrelevante ahora
      employeeAssignments: [{ shiftTemplateId: "shift-0830", status: "HABILITADO", weekdays: [1] }], // solo lunes
      activeTemplates: [shift0830],
    });
    expect(match.case).toBe("NO_MATCH");
    expect(match.template).toBeNull();
  });
});

describe("evaluateEntryPunctuality", () => {
  it("no evalúa llegada tarde si el turno coincidente no está habilitado (Caso B/C/D)", () => {
    const match = matchShiftForEmployee({ actualAt: at(6, 32), employeeAssignments: [], activeTemplates: [morningShift] });
    const result = evaluateEntryPunctuality(match);
    expect(result.evaluated).toBe(false);
    expect(result.lateArrival).toBe(false);
    expect(result.earlyArrival).toBe(false);
  });

  it("marca llegada tarde cuando excede el margen de entrada después, en Caso A", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 50),
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO" }],
      activeTemplates: [morningShift],
    });
    const result = evaluateEntryPunctuality(match);
    expect(result.evaluated).toBe(true);
    expect(result.lateArrival).toBe(true);
    expect(result.earlyArrival).toBe(false);
    expect(result.differenceMinutes).toBe(20);
  });

  it("no marca llegada tarde dentro del margen, en Caso A", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 40),
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO" }],
      activeTemplates: [morningShift],
    });
    expect(evaluateEntryPunctuality(match).lateArrival).toBe(false);
  });

  // Etapa 13A
  it("Caso 3/C del pedido: dentro de tolerancia no marca ni llegada tarde ni ingreso anticipado", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 25), // 5 min antes, dentro de entryToleranceBeforeMinutes=10
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO" }],
      activeTemplates: [morningShift],
    });
    const result = evaluateEntryPunctuality(match);
    expect(result.evaluated).toBe(true);
    expect(result.lateArrival).toBe(false);
    expect(result.earlyArrival).toBe(false);
  });

  it("Caso 5/E del pedido: marca ingreso anticipado cuando la entrada precede la tolerancia de inicio, en Caso A", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 10), // 20 min antes, entryToleranceBeforeMinutes=10
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO" }],
      activeTemplates: [morningShift],
    });
    const result = evaluateEntryPunctuality(match);
    expect(result.evaluated).toBe(true);
    expect(result.lateArrival).toBe(false);
    expect(result.earlyArrival).toBe(true);
    expect(result.differenceMinutes).toBe(-20);
  });

  it("no marca ingreso anticipado si el turno coincidente no está habilitado (mismo criterio que llegada tarde)", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 10),
      employeeAssignments: [{ shiftTemplateId: "morning", status: "DESHABILITADO" }],
      activeTemplates: [morningShift],
    });
    const result = evaluateEntryPunctuality(match);
    expect(result.evaluated).toBe(false);
    expect(result.earlyArrival).toBe(false);
  });
});

describe("isEarlyArrivalReviewRequired — Etapa 13A, Caso H (umbral de ingreso muy anticipado)", () => {
  it("por debajo del umbral (240 min) no requiere revisión", () => {
    expect(isEarlyArrivalReviewRequired(-239)).toBe(false);
    expect(isEarlyArrivalReviewRequired(239)).toBe(false);
  });

  it("en el umbral exacto (240 min) ya requiere revisión", () => {
    expect(isEarlyArrivalReviewRequired(-240)).toBe(true);
  });

  it("por encima del umbral requiere revisión, sin importar el signo", () => {
    expect(isEarlyArrivalReviewRequired(-270)).toBe(true);
    expect(isEarlyArrivalReviewRequired(270)).toBe(true);
  });
});

describe("evaluateExitPunctuality", () => {
  it("Empleado sin turno habilitado no genera salida anticipada", () => {
    const match = matchShiftForEmployee({ actualAt: at(6, 32), employeeAssignments: [], activeTemplates: [morningShift] });
    const result = evaluateExitPunctuality({ match, startAt: at(6, 32), actualExitAt: at(13, 0) });
    expect(result.evaluated).toBe(false);
    expect(result.earlyLeave).toBe(false);
  });

  it("Caso A: marca salida anticipada fuera de margen", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 32),
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO" }],
      activeTemplates: [morningShift],
    });
    const result = evaluateExitPunctuality({ match, startAt: at(6, 32), actualExitAt: at(13, 0) });
    expect(result.evaluated).toBe(true);
    expect(result.earlyLeave).toBe(true);
    expect(result.lateLeave).toBe(false);
  });

  it("Caso A: dentro de margen de salida no marca nada", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 32),
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO" }],
      activeTemplates: [morningShift],
    });
    const result = evaluateExitPunctuality({ match, startAt: at(6, 32), actualExitAt: at(15, 10) });
    expect(result.earlyLeave).toBe(false);
    expect(result.lateLeave).toBe(false);
  });

  it("respeta el cruce de medianoche del turno sereno para calcular la salida esperada", () => {
    const match = matchShiftForEmployee({
      actualAt: at(23, 5),
      employeeAssignments: [{ shiftTemplateId: "sereno", status: "HABILITADO" }],
      activeTemplates: [nightShift],
    });
    const result = evaluateExitPunctuality({ match, startAt: at(23, 5), actualExitAt: at(4, 5, 11) });
    expect(result.scheduledExitAt?.getDate()).toBe(11);
    expect(result.lateLeave).toBe(false);
    expect(result.earlyLeave).toBe(false);
  });
});

describe("evaluateWorkedDuration", () => {
  it("Caso A: trabaja menos que el mínimo configurado", () => {
    const result = evaluateWorkedDuration({ totalMinutes: 300, template: morningShift });
    expect(result.insufficientHours).toBe(true);
  });

  it("Caso A: trabaja más que el máximo informativo configurado", () => {
    const result = evaluateWorkedDuration({ totalMinutes: 600, template: morningShift });
    expect(result.extendedShift).toBe(true);
  });

  it("Caso A: dentro de rango normal no marca nada", () => {
    const result = evaluateWorkedDuration({ totalMinutes: 480, template: morningShift });
    expect(result.insufficientHours).toBe(false);
    expect(result.extendedShift).toBe(false);
  });

  it("Empleado sin turnos no genera jornada insuficiente (sin mínimo general aplicable)", () => {
    const result = evaluateWorkedDuration({ totalMinutes: 60, template: null });
    expect(result.insufficientHours).toBe(false);
  });

  it("Empleado sin turnos igual genera jornada extendida con el umbral por defecto", () => {
    const result = evaluateWorkedDuration({ totalMinutes: 700, template: null });
    expect(result.extendedShift).toBe(true);
  });
});

describe("evaluateWorkedDuration — Etapa 10D (prioridad de umbral Régimen → Turno → Default)", () => {
  it("sin régimen (undefined) + turno mantiene el comportamiento actual (usa el umbral del turno)", () => {
    const result = evaluateWorkedDuration({ totalMinutes: 600, template: morningShift });
    expect(result.extendedShift).toBe(true); // morningShift.maximumInformativeMinutes = 540
    expect(result.maximumThresholdUsed).toBe(540);
  });

  it("régimen sin valor (null) + turno mantiene el comportamiento actual (usa el umbral del turno, no el default)", () => {
    const result = evaluateWorkedDuration({ totalMinutes: 600, template: morningShift, regimeMaximumMinutes: null });
    expect(result.extendedShift).toBe(true);
    expect(result.maximumThresholdUsed).toBe(540);
  });

  it("régimen con umbral mayor evita la alerta prematura que el turno solo hubiera generado", () => {
    const result = evaluateWorkedDuration({ totalMinutes: 600, template: morningShift, regimeMaximumMinutes: 900 });
    expect(result.extendedShift).toBe(false);
    expect(result.maximumThresholdUsed).toBe(900);
  });

  it("régimen con umbral menor genera alerta antes de lo que el turno solo hubiera generado", () => {
    const result = evaluateWorkedDuration({ totalMinutes: 400, template: morningShift, regimeMaximumMinutes: 300 });
    expect(result.extendedShift).toBe(true); // morningShift solo (540) no hubiera marcado extendedShift a los 400 min
    expect(result.maximumThresholdUsed).toBe(300);
  });

  it("empleado sin turno + régimen con valor usa el umbral del régimen, no el default de 600", () => {
    const result = evaluateWorkedDuration({ totalMinutes: 700, template: null, regimeMaximumMinutes: 900 });
    expect(result.extendedShift).toBe(false);
    expect(result.maximumThresholdUsed).toBe(900);
  });

  it("empleado sin turno ni régimen usa el default seguro (600), sin cambios", () => {
    const result = evaluateWorkedDuration({ totalMinutes: 700, template: null, regimeMaximumMinutes: null });
    expect(result.extendedShift).toBe(true);
    expect(result.maximumThresholdUsed).toBe(600);
  });

  it("el umbral de régimen nunca afecta insufficientHours/minimumMinutesForCompliance (fuera de alcance de esta etapa)", () => {
    const result = evaluateWorkedDuration({ totalMinutes: 300, template: morningShift, regimeMaximumMinutes: 900 });
    expect(result.insufficientHours).toBe(true); // morningShift.minimumMinutesForCompliance = 465, sin cambios
    expect(result.minimumThresholdUsed).toBe(465);
  });
});

describe("evaluateOpenShiftRisk", () => {
  it("jornada abierta normal, todavía dentro de rango", () => {
    const result = evaluateOpenShiftRisk({ startAt: at(7, 0), now: at(15, 0), template: morningShift });
    expect(result.level).toBe("NORMAL");
  });

  it("jornada abierta supera la salida esperada + tolerancia + alerta de olvido -> MISSING_OUT", () => {
    const shift = template({ id: "reg", code: "REG", startTime: "07:00", endTime: "15:30", exitToleranceAfterMinutes: 20, missingOutAlertAfterMinutes: 60 });
    const result = evaluateOpenShiftRisk({ startAt: at(7, 0), now: at(16, 50), template: shift });
    expect(result.level).toBe("MISSING_OUT");
    expect(result.missingOutThresholdMinutes).toBe(590);
  });

  it("jornada abierta sin turno supera el máximo operativo por defecto -> EXPIRED", () => {
    const result = evaluateOpenShiftRisk({ startAt: at(0, 0, 10), now: at(21, 0, 10), template: null });
    expect(result.level).toBe("EXPIRED");
    expect(result.absoluteLimitMinutes).toBe(DEFAULT_ABSOLUTE_OPEN_SHIFT_LIMIT_MINUTES);
  });

  it("sin missingOutAlertAfterMinutes configurado, no hay alerta anticipada de olvido", () => {
    const shiftSinAlerta = template({ id: "sin-alerta", code: "SIN-ALERTA", startTime: "07:00", endTime: "15:30" });
    const result = evaluateOpenShiftRisk({ startAt: at(7, 0), now: at(16, 50), template: shiftSinAlerta });
    expect(result.level).toBe("NORMAL");
  });

  it("expone la salida esperada del turno, contemplando cruce de medianoche", () => {
    const result = evaluateOpenShiftRisk({ startAt: at(23, 5), now: at(1, 0, 11), template: nightShift });
    expect(result.expectedExitAt?.getDate()).toBe(11);
    expect(result.expectedExitAt?.getHours()).toBe(4);
  });

  it("sin turno, no hay salida esperada", () => {
    const result = evaluateOpenShiftRisk({ startAt: at(7, 0), now: at(10, 0), template: null });
    expect(result.expectedExitAt).toBeNull();
  });
});

describe("evaluateOpenShiftRisk — Etapa 10E (default de olvido de salida sin turno, hallazgo: Asistencia lo detectaba, Alertas de Turnos nunca)", () => {
  it("sin turno, supera el default (600 min) sin llegar al límite absoluto -> MISSING_OUT (antes de este fix quedaba NORMAL para siempre)", () => {
    const result = evaluateOpenShiftRisk({ startAt: at(0, 0, 10), now: at(10, 30, 10), template: null }); // 10h30 = 630 min
    expect(result.level).toBe("MISSING_OUT");
    expect(result.missingOutThresholdMinutes).toBe(600);
  });

  it("sin turno, todavía dentro del default (600 min) -> NORMAL", () => {
    const result = evaluateOpenShiftRisk({ startAt: at(0, 0, 10), now: at(9, 0, 10), template: null }); // 9h = 540 min
    expect(result.level).toBe("NORMAL");
  });

  it("sin turno + suppressMissingOutDefault=true (régimen alertOnOutOfShift=false) mantiene NORMAL más allá del default, hasta el límite absoluto", () => {
    const result = evaluateOpenShiftRisk({ startAt: at(0, 0, 10), now: at(10, 30, 10), template: null, suppressMissingOutDefault: true }); // 630 min
    expect(result.level).toBe("NORMAL");
    expect(result.missingOutThresholdMinutes).toBeNull();
  });

  it("turno sin missingOutAlertAfterMinutes configurado también usa el default (600) en vez de quedar sin aviso para siempre", () => {
    const shiftSinAlerta = template({ id: "sin-alerta-2", code: "SIN-ALERTA-2", startTime: "07:00", endTime: "15:30" });
    const result = evaluateOpenShiftRisk({ startAt: at(7, 0), now: at(17, 30), template: shiftSinAlerta }); // 10h30 abierto
    expect(result.level).toBe("MISSING_OUT");
    expect(result.missingOutThresholdMinutes).toBe(600);
  });

  it("turno sin missingOutAlertAfterMinutes + suppressMissingOutDefault=true (régimen flexible) mantiene NORMAL", () => {
    const shiftSinAlerta = template({ id: "sin-alerta-3", code: "SIN-ALERTA-3", startTime: "07:00", endTime: "15:30" });
    const result = evaluateOpenShiftRisk({ startAt: at(7, 0), now: at(17, 30), template: shiftSinAlerta, suppressMissingOutDefault: true });
    expect(result.level).toBe("NORMAL");
  });

  it("un turno con missingOutAlertAfterMinutes explícito NUNCA se suprime por régimen — sólo el default sin turno se suprime", () => {
    const shift = template({ id: "reg-explicito", code: "REG-EXPLICITO", startTime: "07:00", endTime: "15:30", exitToleranceAfterMinutes: 20, missingOutAlertAfterMinutes: 60 });
    const result = evaluateOpenShiftRisk({ startAt: at(7, 0), now: at(16, 50), template: shift, suppressMissingOutDefault: true });
    // Mismo caso que el test "jornada abierta supera la salida esperada..." de arriba —
    // el umbral explícito del turno (590 min) sigue aplicando igual, suppressMissingOutDefault
    // sólo apaga el FALLBACK cuando no hay ningún umbral configurado, nunca uno real.
    expect(result.level).toBe("MISSING_OUT");
    expect(result.missingOutThresholdMinutes).toBe(590);
  });

  it("turno nocturno (sereno, cruza medianoche) sin missingOutAlertAfterMinutes también usa el default (600) — el fallback no depende de crossesMidnight", () => {
    // nightShift entra 23:00 y no tiene missingOutAlertAfterMinutes configurado (ver template() defaults).
    // Abierta desde las 23:00 hasta las 09:30 del día siguiente = 630 min.
    const result = evaluateOpenShiftRisk({ startAt: at(23, 0, 10), now: at(9, 30, 11), template: nightShift });
    expect(result.level).toBe("MISSING_OUT");
    expect(result.missingOutThresholdMinutes).toBe(600);
    // La salida esperada (04:00 del día siguiente) se sigue calculando igual, sin cambios.
    expect(result.expectedExitAt?.getDate()).toBe(11);
    expect(result.expectedExitAt?.getHours()).toBe(4);
  });
});

describe("evaluateNewEntryWithOpenShift", () => {
  it("bloquea nuevo ingreso si la jornada previa es del mismo día y está normal", () => {
    const decision = evaluateNewEntryWithOpenShift({ previousOpenShiftStartAt: at(7, 0), now: at(12, 0), previousShiftRisk: "NORMAL" });
    expect(decision).toBe("BLOCK_SAME_DAY_OPEN");
  });

  it("permite ingreso observado si la jornada previa quedó en riesgo (aunque sea el mismo día)", () => {
    const decision = evaluateNewEntryWithOpenShift({ previousOpenShiftStartAt: at(7, 0), now: at(23, 0), previousShiftRisk: "MISSING_OUT" });
    expect(decision).toBe("ALLOW_OBSERVED");
  });

  it("permite ingreso observado si la jornada previa es de un día distinto", () => {
    const decision = evaluateNewEntryWithOpenShift({ previousOpenShiftStartAt: at(7, 0, 9), now: at(7, 0, 10), previousShiftRisk: "NORMAL" });
    expect(decision).toBe("ALLOW_OBSERVED");
  });
});

describe("evaluateRestPeriod", () => {
  it("no evalúa si no hay jornada previa", () => {
    const result = evaluateRestPeriod({ previousShiftEndAt: null, currentShiftStartAt: at(7, 0), minimumRestMinutes: 480 });
    expect(result.evaluated).toBe(false);
  });

  it("marca descanso insuficiente si el intervalo es menor al mínimo", () => {
    const result = evaluateRestPeriod({ previousShiftEndAt: at(23, 0, 9), currentShiftStartAt: at(4, 0, 10), minimumRestMinutes: 480 });
    expect(result.evaluated).toBe(true);
    expect(result.insufficientRest).toBe(true);
    expect(result.restMinutes).toBe(300);
  });

  it("no marca descanso insuficiente si el intervalo alcanza el mínimo", () => {
    const result = evaluateRestPeriod({ previousShiftEndAt: at(20, 0, 9), currentShiftStartAt: at(7, 0, 10), minimumRestMinutes: 480 });
    expect(result.insufficientRest).toBe(false);
  });
});

// Etapa 8J: el motor de matching ahora respeta status/effectiveFrom/
// effectiveTo/weekdays de ShiftAssignment. 2026-07-06 es lunes, 2026-07-11
// sábado, 2026-07-12 domingo, 2026-07-13 lunes (confirmado con Intl bajo
// TZ=America/Argentina/Cordoba, que es el TZ fijado por vitest.config.ts).

describe("isShiftAssignmentActiveOnDate — vigencia (Etapa 8J)", () => {
  const referenceDate = argentinaCalendarDate("2026-07-10");

  it("effectiveFrom pasado y effectiveTo null aplica", () => {
    expect(isShiftAssignmentActiveOnDate({ effectiveFrom: argentinaCalendarDate("2026-01-01"), effectiveTo: null }, referenceDate)).toBe(true);
  });

  it("effectiveFrom futuro no aplica", () => {
    expect(isShiftAssignmentActiveOnDate({ effectiveFrom: argentinaCalendarDate("2026-08-01"), effectiveTo: null }, referenceDate)).toBe(false);
  });

  it("effectiveTo anterior a la fecha operativa no aplica", () => {
    expect(
      isShiftAssignmentActiveOnDate({ effectiveFrom: argentinaCalendarDate("2026-01-01"), effectiveTo: argentinaCalendarDate("2026-07-09") }, referenceDate),
    ).toBe(false);
  });

  it("effectiveTo igual a la fecha operativa aplica", () => {
    expect(
      isShiftAssignmentActiveOnDate({ effectiveFrom: argentinaCalendarDate("2026-01-01"), effectiveTo: argentinaCalendarDate("2026-07-10") }, referenceDate),
    ).toBe(true);
  });

  it("effectiveFrom igual a la fecha operativa aplica", () => {
    expect(isShiftAssignmentActiveOnDate({ effectiveFrom: referenceDate, effectiveTo: null }, referenceDate)).toBe(true);
  });

  it("sin effectiveFrom/effectiveTo (ausentes), aplica siempre — compatibilidad con fixtures previos a la Etapa 8I/8J", () => {
    expect(isShiftAssignmentActiveOnDate({}, referenceDate)).toBe(true);
  });
});

describe("isShiftAssignmentApplicableOnWeekday — weekdays (Etapa 8J)", () => {
  const monday = argentinaCalendarDate("2026-07-06");
  const saturday = argentinaCalendarDate("2026-07-11");
  const sunday = argentinaCalendarDate("2026-07-12");

  it("weekdays vacío aplica todos los días", () => {
    expect(isShiftAssignmentApplicableOnWeekday({ weekdays: [] }, monday)).toBe(true);
    expect(isShiftAssignmentApplicableOnWeekday({ weekdays: [] }, saturday)).toBe(true);
  });

  it("weekdays ausente (compatibilidad) aplica todos los días", () => {
    expect(isShiftAssignmentApplicableOnWeekday({}, saturday)).toBe(true);
  });

  it("[1,2,3,4,5] aplica lunes a viernes", () => {
    expect(isShiftAssignmentApplicableOnWeekday({ weekdays: [1, 2, 3, 4, 5] }, monday)).toBe(true);
  });

  it("[1,2,3,4,5] no aplica sábado", () => {
    expect(isShiftAssignmentApplicableOnWeekday({ weekdays: [1, 2, 3, 4, 5] }, saturday)).toBe(false);
  });

  it("[0] aplica domingo", () => {
    expect(isShiftAssignmentApplicableOnWeekday({ weekdays: [0] }, sunday)).toBe(true);
  });

  it("[6] aplica sábado", () => {
    expect(isShiftAssignmentApplicableOnWeekday({ weekdays: [6] }, saturday)).toBe(true);
  });
});

describe("isShiftAssignmentApplicableForInstant — status (Etapa 8J)", () => {
  const mondayMorning = at(9, 30, 6); // lunes 2026-07-06, 09:30
  const vigencyAbierta = { effectiveFrom: argentinaCalendarDate("2026-01-01"), effectiveTo: null, weekdays: [1] };

  it("HABILITADO aplica si fecha/día coinciden", () => {
    expect(isShiftAssignmentApplicableForInstant({ shiftTemplateId: "t", status: "HABILITADO", ...vigencyAbierta }, mondayMorning)).toBe(true);
  });

  it("DESHABILITADO no aplica aunque fecha/día coincidan", () => {
    expect(isShiftAssignmentApplicableForInstant({ shiftTemplateId: "t", status: "DESHABILITADO", ...vigencyAbierta }, mondayMorning)).toBe(false);
  });
});

describe("matchShiftForEmployee — vigencia/weekdays reales (Etapa 8J, sección D)", () => {
  const mondayToFriday = { effectiveFrom: argentinaCalendarDate("2026-01-01"), effectiveTo: null, weekdays: [1, 2, 3, 4, 5] };

  it("empleado con turno lunes-viernes no matchea sábado (no queda ENABLED)", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 35, 11), // sábado 06:35
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO", ...mondayToFriday }],
      activeTemplates: [morningShift],
    });
    expect(match.case).not.toBe("ENABLED");
  });

  it("empleado con turno lunes-viernes sí matchea lunes", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 35, 6), // lunes 06:35
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO", ...mondayToFriday }],
      activeTemplates: [morningShift],
    });
    expect(match.case).toBe("ENABLED");
    expect(match.template?.id).toBe("morning");
  });

  it("empleado con asignación futura (effectiveFrom por venir) no matchea hoy", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 35, 6), // lunes 2026-07-06
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO", effectiveFrom: argentinaCalendarDate("2026-08-01"), effectiveTo: null, weekdays: [] }],
      activeTemplates: [morningShift],
    });
    expect(match.case).not.toBe("ENABLED");
  });

  it("empleado con asignación vencida (effectiveTo pasado) no matchea hoy", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 35, 6), // lunes 2026-07-06
      employeeAssignments: [
        { shiftTemplateId: "morning", status: "HABILITADO", effectiveFrom: argentinaCalendarDate("2026-01-01"), effectiveTo: argentinaCalendarDate("2026-06-30"), weekdays: [] },
      ],
      activeTemplates: [morningShift],
    });
    expect(match.case).not.toBe("ENABLED");
  });

  it("empleado con weekdays vacío conserva comportamiento anterior (matchea cualquier día)", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 35, 11), // sábado
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO", effectiveFrom: argentinaCalendarDate("2026-01-01"), effectiveTo: null, weekdays: [] }],
      activeTemplates: [morningShift],
    });
    expect(match.case).toBe("ENABLED");
  });
});

describe("matchShiftForEmployee — turno nocturno con weekdays (Etapa 8J, sección E)", () => {
  const mondayOnly = { effectiveFrom: argentinaCalendarDate("2026-01-01"), effectiveTo: null, weekdays: [1] };

  it("turno 23:00 asignado (lunes en weekdays) aplica para la entrada del lunes 23:00", () => {
    const match = matchShiftForEmployee({
      actualAt: at(23, 0, 6), // lunes 2026-07-06 23:00
      employeeAssignments: [{ shiftTemplateId: "sereno", status: "HABILITADO", ...mondayOnly }],
      activeTemplates: [nightShift],
    });
    expect(match.case).toBe("ENABLED");
    expect(match.template?.id).toBe("sereno");
  });

  it("la salida del martes (fin del turno, cruzando medianoche) no invalida la asignación del lunes: evaluateExitPunctuality usa startAt real, nunca re-evalúa vigencia contra la fecha de salida", () => {
    const entryMatch = matchShiftForEmployee({
      actualAt: at(23, 0, 6), // entra lunes 23:00
      employeeAssignments: [{ shiftTemplateId: "sereno", status: "HABILITADO", ...mondayOnly }],
      activeTemplates: [nightShift],
    });
    expect(entryMatch.case).toBe("ENABLED");

    // nightShift termina 04:00 (crossesMidnight) -> la salida esperada cae el martes 04:00.
    const exit = evaluateExitPunctuality({ match: entryMatch, startAt: at(23, 0, 6), actualExitAt: at(4, 0, 7) }); // sale martes 04:00, en horario
    expect(exit.evaluated).toBe(true);
    expect(exit.earlyLeave).toBe(false);
    expect(exit.lateLeave).toBe(false);
  });

  it("si la entrada es sábado 23:00 y weekdays no incluye sábado, no aplica (no queda ENABLED)", () => {
    const match = matchShiftForEmployee({
      actualAt: at(23, 0, 11), // sábado 2026-07-11 23:00
      employeeAssignments: [{ shiftTemplateId: "sereno", status: "HABILITADO", ...mondayOnly }],
      activeTemplates: [nightShift],
    });
    expect(match.case).not.toBe("ENABLED");
  });
});

describe("matchShiftForEmployee — compatibilidad hacia atrás (Etapa 8J, sección G)", () => {
  it("asignación sin effectiveFrom/effectiveTo/weekdays (forma previa a la Etapa 8I) se comporta exactamente igual que antes", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 35),
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO" }],
      activeTemplates: [morningShift],
    });
    expect(match.case).toBe("ENABLED");
    expect(match.differenceMinutes).toBe(5);
  });
});
