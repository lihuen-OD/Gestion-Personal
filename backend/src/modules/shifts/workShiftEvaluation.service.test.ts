import { describe, expect, it } from "vitest";
import {
  DEFAULT_ABSOLUTE_OPEN_SHIFT_LIMIT_MINUTES,
  evaluateEntryPunctuality,
  evaluateExitPunctuality,
  evaluateNewEntryWithOpenShift,
  evaluateOpenShiftRisk,
  evaluateRestPeriod,
  evaluateWorkedDuration,
  hasNoShiftAssignments,
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
