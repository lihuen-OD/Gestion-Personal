import { describe, expect, it } from "vitest";
import type { AttendanceInactivityIncident, AttendanceShift } from "../services/api/attendanceApiService";
import type { SystemNotification } from "../services/api/workforceApiService";
import {
  buildNoveltyPrefillFromAttendanceShiftProblem,
  buildNoveltyPrefillFromInactivityIncident,
  buildNoveltyPrefillFromNotification,
} from "./noveltyFromAlert";

describe("buildNoveltyPrefillFromInactivityIncident", () => {
  function buildIncident(overrides: Partial<AttendanceInactivityIncident> = {}): AttendanceInactivityIncident {
    return {
      id: "incident-1",
      employeeId: "employee-2",
      operationalDate: "2026-08-20",
      status: "PENDIENTE",
      observation: "El legajo no registró fichadas, jornadas ni horas cargadas el 20/08/2026.",
      detectedAt: "2026-08-21T09:00:00.000Z",
      employee: { id: "employee-2", legajo: "200", dni: "1", firstName: "Beto", lastName: "Diaz", status: "ACTIVO" },
      ...overrides,
    };
  }

  it("Etapa 15G.2: ausencia/no asistencia no sugiere tipo (no hay NoveltyType de 'Ausencia' garantizado) y arrastra el detalle ya calculado por el backend", () => {
    const context = buildNoveltyPrefillFromInactivityIncident(buildIncident());

    expect(context.employee).toEqual({ id: "employee-2", legajo: "200", firstName: "Beto", lastName: "Diaz" });
    expect(context.fromDate).toBe("2026-08-20");
    expect(context.suggestedNoveltyTypeCode).toBeUndefined();
    expect(context.quantityHours).toBeUndefined();
    expect(context.observation).toContain("Origen: alerta del fichador");
    expect(context.observation).toContain("no registró fichadas");
    expect(context.observation).toContain("Las horas reales se mantienen según fichador/carga horaria.");
  });

  it("ajuste UX (previo al commit de 15G.2): la observación no expone el id técnico del incidente", () => {
    const context = buildNoveltyPrefillFromInactivityIncident(buildIncident());

    expect(context.observation).not.toContain("incident-1");
    expect(context.observation.toLowerCase()).not.toMatch(/\bid\b|uuid|entityid|entitytype|código/);
  });

  it("la fecha del incidente (@db.Date) se lee tal cual, sin conversión de timezone que la corra un día", () => {
    // Un slice/timezone naive aplicado a una fecha calendario ya normalizada
    // a medianoche UTC puede correrla un día para atrás (ver calendarDateKey).
    const context = buildNoveltyPrefillFromInactivityIncident(buildIncident({ operationalDate: "2026-08-01" }));

    expect(context.fromDate).toBe("2026-08-01");
  });
});

describe("buildNoveltyPrefillFromAttendanceShiftProblem", () => {
  function buildShift(overrides: Partial<AttendanceShift> = {}): AttendanceShift {
    return {
      id: "shift-9",
      employeeId: "employee-3",
      source: "PORTAL_DNI",
      status: "FALTA_SALIDA",
      startAt: "2026-08-20T10:00:00.000Z",
      workedMinutes: 0,
      workedHours: 0,
      crossesMidnight: false,
      employee: { id: "employee-3", legajo: "300", dni: "3", firstName: "Cora", lastName: "Ruiz", status: "ACTIVO" },
      timeSegments: [],
      timeEntries: [],
      ...overrides,
    };
  }

  it("Etapa 15G.2: falta de fichada (FALTA_SALIDA) no sugiere tipo y referencia el problema detectado en la observación, sin id técnico", () => {
    const context = buildNoveltyPrefillFromAttendanceShiftProblem(buildShift(), "Falta registrar la salida");

    expect(context.employee).toEqual({ id: "employee-3", legajo: "300", firstName: "Cora", lastName: "Ruiz" });
    expect(context.suggestedNoveltyTypeCode).toBeUndefined();
    expect(context.observation).toContain("Origen: alerta del fichador");
    expect(context.observation).toContain("Falta registrar la salida");
    expect(context.observation).toContain("Las horas reales se mantienen según fichador/carga horaria.");
  });

  it("incluye la observación de la jornada cuando existe", () => {
    const context = buildNoveltyPrefillFromAttendanceShiftProblem(buildShift({ observation: "Salida marcada manualmente por RRHH" }), "Jornada observada");

    expect(context.observation).toContain("Salida marcada manualmente por RRHH");
  });

  it("ajuste UX (previo al commit de 15G.2): la observación no expone el id técnico de la jornada", () => {
    const context = buildNoveltyPrefillFromAttendanceShiftProblem(buildShift(), "Falta registrar la salida");

    expect(context.observation).not.toContain("shift-9");
    expect(context.observation.toLowerCase()).not.toMatch(/\bid\b|uuid|entityid|entitytype|código/);
  });
});

// Ajuste de alcance (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md,
// "Notificaciones como flujo principal"): cubre llegada tarde/salida
// temprana (ALERTA_FICHADA), falta de fichada/olvido de salida
// (FALTA_SALIDA) y "no asistió" (SIN_ACTIVIDAD_REGISTRADA) por igual —
// el builder no distingue por `type`, sólo necesita `employee` resuelto.
describe("buildNoveltyPrefillFromNotification", () => {
  function buildNotification(overrides: Partial<SystemNotification> = {}): SystemNotification & { employee: NonNullable<SystemNotification["employee"]> } {
    return {
      id: "notif-1",
      type: "ALERTA_FICHADA",
      priority: "ALTA",
      title: "Llegada tarde",
      message: "Ana Gomez llegó 1h 30m tarde.",
      status: "NO_LEIDA",
      createdAt: "2026-08-20T12:00:00.000Z",
      employee: { id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" },
      ...overrides,
    };
  }

  it("precarga empleado (subconjunto mínimo, ya resuelto por el backend), fecha aproximada (createdAt) y observación humana con el mensaje, sin id técnico", () => {
    const context = buildNoveltyPrefillFromNotification(buildNotification());

    expect(context.employee).toEqual({ id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" });
    expect(context.fromDate).toBe("2026-08-20");
    expect(context.observation).toContain("Origen: alerta del fichador");
    expect(context.observation).toContain("Ana Gomez llegó 1h 30m tarde.");
    expect(context.observation).toContain("Las horas reales se mantienen según fichador/carga horaria.");
  });

  it("ajuste UX (previo al commit de 15G.2): la observación no expone notification.id, UUID ni entityType técnico", () => {
    const context = buildNoveltyPrefillFromNotification(buildNotification({ id: "204bd1dc-ea7c-4b7b-a029-264faf5796ac" }));

    expect(context.observation).not.toContain("204bd1dc-ea7c-4b7b-a029-264faf5796ac");
    expect(context.observation).not.toContain("notif-1");
    expect(context.observation.toLowerCase()).not.toMatch(/\bid\b|uuid|entityid|entitytype|código|shiftalert|workshift|attendanceinactivityincident/);
  });

  it("no sugiere tipo ni cantidad de horas — el type de la notificación es genérico, sin distinguir la anomalía exacta", () => {
    const context = buildNoveltyPrefillFromNotification(buildNotification({ type: "SIN_ACTIVIDAD_REGISTRADA", title: "Sin actividad registrada", message: "No se registró actividad." }));

    expect(context.suggestedNoveltyTypeCode).toBeUndefined();
    expect(context.quantityHours).toBeUndefined();
  });
});
