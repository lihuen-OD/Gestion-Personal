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

  it("Caso C: coincide con un turno activo general no asociado al empleado", () => {
    const match = matchShiftForEmployee({
      actualAt: at(6, 32),
      employeeAssignments: [],
      activeTemplates: [morningShift],
    });
    expect(match.case).toBe("GENERAL_UNASSIGNED");
    expect(match.template?.id).toBe("morning");
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

  it("empleado con turno habilitado no fuerza ese turno si la fichada es de un horario totalmente ajeno (cae a Caso C)", () => {
    const eveningGeneral = template({ id: "evening-general", code: "EVENING-GENERAL", startTime: "20:00", endTime: "23:00" });
    const match = matchShiftForEmployee({
      actualAt: at(20, 3),
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO" }],
      activeTemplates: [morningShift, eveningGeneral],
    });
    expect(match.case).toBe("GENERAL_UNASSIGNED");
    expect(match.template?.id).toBe("evening-general");
  });

  it("empleado con turno habilitado no fuerza ese turno si la fichada es de un horario totalmente ajeno y no hay ningún turno general (Caso D)", () => {
    const match = matchShiftForEmployee({
      actualAt: at(20, 3),
      employeeAssignments: [{ shiftTemplateId: "morning", status: "HABILITADO" }],
      activeTemplates: [morningShift],
    });
    expect(match.case).toBe("NO_MATCH");
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

describe("evaluateEntryPunctuality", () => {
  it("no evalúa llegada tarde si el turno coincidente no está habilitado (Caso B/C/D)", () => {
    const match = matchShiftForEmployee({ actualAt: at(6, 32), employeeAssignments: [], activeTemplates: [morningShift] });
    const result = evaluateEntryPunctuality(match);
    expect(result.evaluated).toBe(false);
    expect(result.lateArrival).toBe(false);
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
