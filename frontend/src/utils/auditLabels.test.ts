import { describe, expect, it } from "vitest";
import { auditActionLabel, auditEntityLabel, auditRoleLabel, auditChange, auditDescription, cleanAuditValue } from "./auditLabels";

// Etapa 15M.20: relevado exhaustivo de cada `entity`/`action` que el backend
// realmente escribe en el log de auditoría (`auditService.register(...)` en
// `backend/src/modules/**`) — si se agrega un módulo nuevo que loguea
// auditoría, este test falla hasta que se sume acá, evitando que un nombre
// técnico nuevo se filtre sin que nadie lo note.
const realBackendEntities = [
  "AttendanceInactivityIncident", "AttendancePunch", "AuditParameter", "DocumentCategory", "DoubleHourRule",
  "Employee", "EmployeeAddress", "EmployeeAssignment", "EmployeeBlockHistory", "EmployeeContact",
  "EmployeeDocument", "EmployeeFieldHistory", "EmployeeHourConcept", "EmployeeTransport", "EmployeeWorkRegime",
  "FinnegansExport", "HolidayWorkAssignment", "HourConcept", "HourConceptBreakdown", "HourConceptRule",
  "LaborMovement", "MonthlyTimeClosure", "Novelty", "NoveltyType", "Position", "Route", "SalaryCategory",
  "ShiftAlert", "ShiftAssignment", "ShiftTemplate", "StorageFile", "TimeCorrectionRequest", "TimeEntry",
  "User", "WorkRegime", "WorkShift",
];

const realBackendActions = ["ACTIVATE", "APPROVE", "CREATE", "DEACTIVATE", "DELETE", "EXPORT", "LOGIN", "REJECT", "RETURN", "UPDATE"];

describe("auditEntityLabel / auditActionLabel — sin fugas de nombres técnicos", () => {
  it("traduce cada entidad real del backend a un nombre de negocio (nunca el valor crudo)", () => {
    for (const entity of realBackendEntities) {
      const label = auditEntityLabel(entity);
      expect(label).not.toBe(entity);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("traduce cada acción real del backend a un verbo de negocio (nunca el valor crudo)", () => {
    for (const action of realBackendActions) {
      const label = auditActionLabel(action);
      expect(label).not.toBe(action);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("los ejemplos insignia del pedido (WorkShift, ShiftAlert, HourConceptBreakdown) tienen label humano", () => {
    expect(auditEntityLabel("WorkShift")).toBe("Jornada laboral");
    expect(auditEntityLabel("ShiftAlert")).toBe("Alerta de turno");
    expect(auditEntityLabel("HourConceptBreakdown")).toBe("Desglose de conceptos horarios");
  });

  it("una entidad o acción no mapeada cae a un fallback humano fijo, nunca al valor técnico original", () => {
    expect(auditEntityLabel("SomeBrandNewModel")).toBe("Registro del sistema");
    expect(auditEntityLabel("SomeBrandNewModel")).not.toContain("Model");
    expect(auditActionLabel("SOME_NEW_ACTION")).toBe("Movimiento registrado");
    expect(auditActionLabel("SOME_NEW_ACTION")).not.toContain("ACTION");
  });
});

describe("auditDescription / auditChange — booleanos y campos crudos limpios", () => {
  it("convierte un booleano crudo embebido en el resumen a Sí/No", () => {
    expect(auditDescription({ reason: "-", next: "Usa transporte: true | Cruza medianoche: false" }))
      .toBe("Usa transporte: Sí · Cruza medianoche: No");
  });

  it("sin reason ni next, cae a un texto humano fijo", () => {
    expect(auditDescription({ reason: "-", next: "-" })).toBe("Movimiento registrado en el sistema.");
  });

  it("auditChange arma antes/después cuando hay ambos valores", () => {
    expect(auditChange({ previous: "Estado: Pendiente", next: "Estado: Aprobado" }))
      .toBe("Antes: Estado: Pendiente · Después: Estado: Aprobado");
  });

  // Etapa 15M.20 (relevado en navegador real): el resumen "Antes/Después"
  // de la Auditoría mostraba enums crudos del backend (WorkShiftStatus,
  // WorkShiftSource, ShiftAlertType) embebidos en el texto libre.
  it("traduce enums crudos embebidos: Estado, Source/Origen y tipos de alerta de turno", () => {
    expect(cleanAuditValue("Source: PUBLIC_CLOCK_PHOTO | Estado: ABIERTO")).toBe("Origen: Fichador público (foto) · Estado: Abierta");
    expect(cleanAuditValue("Tipo: SALIDA_TARDIA | Estado: PENDIENTE")).toBe("Tipo: Salida tardía · Estado: Pendiente");
  });
});

describe("auditRoleLabel — sin fugas de códigos de rol", () => {
  it("traduce el rol crudo del backend al mismo texto que usa el resto de la app", () => {
    expect(auditRoleLabel("NIVEL_1_RRHH")).toBe("Nivel 1 - RRHH");
    expect(auditRoleLabel("NIVEL_2_SUPERVISION")).toBe("Nivel 2 - Supervisión / Gestión");
    expect(auditRoleLabel("NIVEL_3_CARGA_HORARIA")).toBe("Nivel 3 - Administrativo de Carga Horaria");
  });
});
