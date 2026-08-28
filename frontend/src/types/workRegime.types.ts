export type WorkRegimeKind = "TURNO_OBLIGATORIO" | "TURNO_FLEXIBLE" | "SIN_TURNO";
export type OpenShiftOverflowAction = "ROLLOVER" | "ALERT_ONLY";
export type WorkRegimeStatus = "ACTIVO" | "INACTIVO";

export type WorkRegime = {
  id: string;
  code: string;
  name: string;
  kind: WorkRegimeKind;
  alertOnOutOfShift: boolean;
  openShiftOverflowAction: OpenShiftOverflowAction;
  // Etapa 10D: minutos — null = el régimen no ajusta el umbral de jornada
  // extendida, se usa el del turno o el default del sistema. La UI edita
  // este valor en horas (ver workRegimeApiService.ts para la conversión).
  extendedShiftAlertMinutes: number | null;
  description: string | null;
  status: WorkRegimeStatus;
  createdAt: string;
  updatedAt: string;
};

export type WorkRegimeFilters = {
  search: string;
  kind: string;
  status: string;
};

export type EmployeeWorkRegimeAssignment = {
  id: string;
  employeeId: string;
  workRegimeId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  assignedByUserId: string | null;
  createdAt: string;
  workRegime: WorkRegime;
};
