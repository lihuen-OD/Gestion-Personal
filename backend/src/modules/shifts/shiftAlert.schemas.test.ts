import { describe, expect, it } from "vitest";
import { listShiftAlertsQuerySchema, shiftAlertTypeSchema } from "./shiftAlert.schemas";

// Etapa 10B (hallazgo 10A §11.4): CONCEPTO_NO_HABILITADO y
// SEGMENTO_SIN_CLASIFICAR ya existían en el enum de Prisma y se generaban en
// producción (workShiftEvaluationRunner.ts notifyClassificationAlerts), pero
// faltaban en este schema Zod — el filtro ?type=... de GET /shifts/alerts
// los rechazaba con 400.
describe("shiftAlertTypeSchema — Etapa 10B (enum drift corregido)", () => {
  it("acepta los 13 tipos reales del enum de Prisma, incluidos los 2 que faltaban", () => {
    const allTypes = [
      "INGRESO_TARDE",
      "SALIDA_ANTICIPADA",
      "SALIDA_TARDIA",
      "TURNO_NO_IDENTIFICADO",
      "SHIFT_NOT_ENABLED_FOR_EMPLOYEE",
      "POSSIBLE_SHIFT_CONFIGURATION_MISSING",
      "JORNADA_INSUFICIENTE",
      "JORNADA_EXTENDIDA",
      "DESCANSO_INSUFICIENTE",
      "POSIBLE_OLVIDO_SALIDA",
      "CONCEPTO_NO_HABILITADO",
      "SEGMENTO_SIN_CLASIFICAR",
      "INGRESO_ANTICIPADO",
    ];
    for (const type of allTypes) {
      expect(shiftAlertTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("Etapa 13A: acepta INGRESO_ANTICIPADO al filtrar el listado por type", () => {
    const result = listShiftAlertsQuerySchema.safeParse({ type: "INGRESO_ANTICIPADO" });
    expect(result.success).toBe(true);
  });

  it("CONCEPTO_NO_HABILITADO ya no es rechazado al filtrar el listado por type (antes devolvía 400)", () => {
    const result = listShiftAlertsQuerySchema.safeParse({ type: "CONCEPTO_NO_HABILITADO" });
    expect(result.success).toBe(true);
  });

  it("SEGMENTO_SIN_CLASIFICAR ya no es rechazado al filtrar el listado por type (antes devolvía 400)", () => {
    const result = listShiftAlertsQuerySchema.safeParse({ type: "SEGMENTO_SIN_CLASIFICAR" });
    expect(result.success).toBe(true);
  });

  it("sigue rechazando un tipo que no existe en el enum real", () => {
    expect(shiftAlertTypeSchema.safeParse("TIPO_INVENTADO").success).toBe(false);
  });
});
