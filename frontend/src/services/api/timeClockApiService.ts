import { apiRequest } from "./apiClient";

type ClockEmployee = {
  id: string;
  legajo: string;
  dni: string;
  firstName: string;
  lastName: string;
  name: string;
};

type ClockStatusResponse = {
  data: {
    employee: ClockEmployee;
    openShift: {
      id: string;
      startAt: string;
    } | null;
  };
};

type ClockInResponse = {
  data: {
    employee: ClockEmployee;
    workShift: {
      id: string;
      startAt: string;
    };
  };
};

type ClockOutResponse = {
  data: {
    employee: ClockEmployee;
    workShift: {
      id: string;
      startAt: string;
      endAt: string;
      totalMinutes: number;
      totalHours: number;
    };
    segments: Array<{
      date: string;
      startAt: string;
      endAt: string;
      minutes: number;
      hours: number;
      label: string;
    }>;
  };
};

type ClockSearchResponse = { data: ClockEmployee[] };

function body(employeeId: string) {
  return { employeeId };
}

export const timeClockApiService = {
  async searchEmployees(search: string) {
    const params = new URLSearchParams({ search: search.trim() });
    const response = await apiRequest<ClockSearchResponse>(`/time-entries/clock/employees?${params.toString()}`, {
      auth: false,
      apiCache: false,
    });
    return response.data;
  },

  async status(employeeId: string) {
    const response = await apiRequest<ClockStatusResponse>("/time-entries/clock/status", {
      method: "POST",
      auth: false,
      body: body(employeeId),
    });
    return response.data;
  },

  async clockIn(employeeId: string) {
    const response = await apiRequest<ClockInResponse>("/time-entries/clock/in", {
      method: "POST",
      auth: false,
      body: body(employeeId),
    });
    return response.data;
  },

  async clockOut(employeeId: string) {
    const response = await apiRequest<ClockOutResponse>("/time-entries/clock/out", {
      method: "POST",
      auth: false,
      body: body(employeeId),
    });
    return response.data;
  },
};
