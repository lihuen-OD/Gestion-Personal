export type HourConceptRuleStatus = "ACTIVO" | "INACTIVO";

export type HourConceptRule = {
  id: string;
  hourConceptId: string;
  hourConcept: { id: string; code: string; name: string };
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  priority: number;
  status: HourConceptRuleStatus;
  createdAt: string;
  updatedAt: string;
};

export type HourConceptRuleFilters = {
  hourConceptId: string;
  status: string;
  crossesMidnight: string;
};

export type CreateHourConceptRulePayload = {
  hourConceptId: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  priority: number;
  status: HourConceptRuleStatus;
};

export type UpdateHourConceptRulePayload = Partial<CreateHourConceptRulePayload>;
