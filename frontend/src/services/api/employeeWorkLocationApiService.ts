import { apiRequest } from "./apiClient";
import type { EmployeeWorkLocation, WorkLocationAssignmentInput, WorkLocationCorrectionInput } from "../../types/employeeWorkLocation.types";

type ListResponse = { data: EmployeeWorkLocation[] };

const base = (employeeId: string) => `/employees/${employeeId}/work-locations`;

// Sin caché propia: la lista se lee al abrir Datos Laborales y cada escritura
// devuelve la lista vigente ya actualizada.
export const employeeWorkLocationApiService = {
  async list(employeeId: string) {
    return (await apiRequest<ListResponse>(base(employeeId))).data;
  },
  async create(employeeId: string, input: WorkLocationAssignmentInput) {
    return (await apiRequest<ListResponse>(base(employeeId), { method: "POST", body: input })).data;
  },
  async change(employeeId: string, locationId: string, input: WorkLocationAssignmentInput) {
    return (await apiRequest<ListResponse>(`${base(employeeId)}/${locationId}/change`, { method: "POST", body: input })).data;
  },
  async end(employeeId: string, locationId: string, input: { effectiveTo: string; reason: string }) {
    return (await apiRequest<ListResponse>(`${base(employeeId)}/${locationId}/end`, { method: "POST", body: input })).data;
  },
  async correct(employeeId: string, locationId: string, input: WorkLocationCorrectionInput) {
    return (await apiRequest<ListResponse>(`${base(employeeId)}/${locationId}`, { method: "PATCH", body: input })).data;
  },
};
