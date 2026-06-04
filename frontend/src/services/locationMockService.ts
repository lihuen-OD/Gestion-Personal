import { mockDepartments, mockLocalities, mockProvinces } from "../data/mockLocations";

export const locationMockService = {
  getProvinces: () => mockProvinces,
  getDepartmentsByProvince: (provinceId: string) => mockDepartments.filter((department) => department.provinceId === provinceId),
  getLocalitiesByDepartment: (departmentId: string) => mockLocalities.filter((locality) => locality.departmentId === departmentId),
  getProvinceByName: (name: string) => mockProvinces.find((province) => province.name === name),
  getDepartmentByName: (name: string) => mockDepartments.find((department) => department.name === name),
  searchProvinces: (query: string) => mockProvinces.filter((province) => province.name.toLowerCase().includes(query.toLowerCase())),
  searchDepartments: (provinceId: string, query: string) => mockDepartments.filter((department) => department.provinceId === provinceId && department.name.toLowerCase().includes(query.toLowerCase())),
  searchLocalities: (departmentId: string, query: string) => mockLocalities.filter((locality) => locality.departmentId === departmentId && locality.name.toLowerCase().includes(query.toLowerCase())),
  getLocalityCenter: (localityId: string) => mockLocalities.find((locality) => locality.id === localityId),
  getLocalityByName: (departmentId: string, name: string) => mockLocalities.find((locality) => locality.departmentId === departmentId && locality.name === name),
};
