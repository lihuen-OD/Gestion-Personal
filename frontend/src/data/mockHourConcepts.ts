import type { HourConcept } from "../types/hourConcept.types";

const now = "2026-06-01T09:00:00.000Z";

function hourConcept(data: Partial<HourConcept> & Pick<HourConcept, "id" | "code" | "name" | "kind">): HourConcept {
  return {
    status: "ACTIVO",
    createdAt: now,
    updatedAt: now,
    ...data,
  };
}

export const mockHourConcepts: HourConcept[] = [
  hourConcept({ id: "hc-normal", code: "HOR-001", name: "Hora normal", kind: "NORMAL" }),
  hourConcept({ id: "hc-extra-50", code: "HOR-002", name: "Hora extra 50%", kind: "EXTRA" }),
  hourConcept({ id: "hc-extra-100", code: "HOR-003", name: "Hora extra 100%", kind: "EXTRA" }),
  hourConcept({ id: "hc-feriado", code: "HOR-004", name: "Feriado trabajado", kind: "FERIADO" }),
  hourConcept({ id: "hc-nocturna", code: "HOR-005", name: "Hora nocturna", kind: "NOCTURNA" }),
  hourConcept({ id: "hc-sereno", code: "HOR-006", name: "Sereno", kind: "SERENO" }),
  hourConcept({ id: "hc-guardia", code: "HOR-007", name: "Guardia", kind: "GUARDIA" }),
  hourConcept({ id: "hc-colectivo", code: "HOR-008", name: "Manejo de colectivo", kind: "TRANSPORTE" }),
];
