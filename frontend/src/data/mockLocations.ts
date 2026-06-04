export interface ProvinceMock { id: string; name: string; }
export interface DepartmentMock { id: string; provinceId: string; name: string; }
export interface LocalityMock { id: string; departmentId: string; provinceId: string; name: string; center: { lat: number; lng: number }; zoom: number; }

export const mockProvinces: ProvinceMock[] = [
  { id: "er", name: "Entre Ríos" },
  { id: "ba", name: "Buenos Aires" },
  { id: "sf", name: "Santa Fe" },
  { id: "cba", name: "Córdoba" },
];

export const mockDepartments: DepartmentMock[] = [
  { id: "er_colon", provinceId: "er", name: "Colón" },
  { id: "er_concordia", provinceId: "er", name: "Concordia" },
  { id: "er_uruguay", provinceId: "er", name: "Uruguay" },
  { id: "er_parana", provinceId: "er", name: "Paraná" },
  { id: "er_federacion", provinceId: "er", name: "Federación" },
  { id: "ba_lujan", provinceId: "ba", name: "Luján" },
  { id: "ba_mercedes", provinceId: "ba", name: "Mercedes" },
  { id: "sf_rosario", provinceId: "sf", name: "Rosario" },
  { id: "sf_la_capital", provinceId: "sf", name: "La Capital" },
  { id: "cba_capital", provinceId: "cba", name: "Capital" },
  { id: "cba_rio_cuarto", provinceId: "cba", name: "Río Cuarto" },
];

export const mockLocalities: LocalityMock[] = [
  { id: "ar_eru_colon_arroyo_baru", departmentId: "er_colon", provinceId: "er", name: "Arroyo Barú", center: { lat: -31.868, lng: -58.451 }, zoom: 14 },
  { id: "ar_eru_colon_colon", departmentId: "er_colon", provinceId: "er", name: "Colón", center: { lat: -32.224, lng: -58.142 }, zoom: 13 },
  { id: "ar_eru_colon_san_jose", departmentId: "er_colon", provinceId: "er", name: "San José", center: { lat: -32.213, lng: -58.218 }, zoom: 13 },
  { id: "ar_eru_colon_villa_elisa", departmentId: "er_colon", provinceId: "er", name: "Villa Elisa", center: { lat: -32.163, lng: -58.401 }, zoom: 13 },
  { id: "ar_eru_concordia_concordia", departmentId: "er_concordia", provinceId: "er", name: "Concordia", center: { lat: -31.392, lng: -58.021 }, zoom: 12 },
  { id: "ar_eru_concordia_la_criolla", departmentId: "er_concordia", provinceId: "er", name: "La Criolla", center: { lat: -31.269, lng: -58.107 }, zoom: 13 },
  { id: "ar_eru_concordia_los_charruas", departmentId: "er_concordia", provinceId: "er", name: "Los Charrúas", center: { lat: -31.175, lng: -58.187 }, zoom: 13 },
  { id: "ar_eru_uruguay_concepcion", departmentId: "er_uruguay", provinceId: "er", name: "Concepción del Uruguay", center: { lat: -32.484, lng: -58.232 }, zoom: 12 },
  { id: "ar_eru_uruguay_basavilbaso", departmentId: "er_uruguay", provinceId: "er", name: "Basavilbaso", center: { lat: -32.371, lng: -58.878 }, zoom: 13 },
  { id: "ar_eru_uruguay_caseros", departmentId: "er_uruguay", provinceId: "er", name: "Caseros", center: { lat: -32.463, lng: -58.478 }, zoom: 13 },
  { id: "ar_eru_parana_parana", departmentId: "er_parana", provinceId: "er", name: "Paraná", center: { lat: -31.741, lng: -60.511 }, zoom: 12 },
  { id: "ar_eru_parana_crespo", departmentId: "er_parana", provinceId: "er", name: "Crespo", center: { lat: -32.028, lng: -60.307 }, zoom: 13 },
  { id: "ar_eru_parana_oro_verde", departmentId: "er_parana", provinceId: "er", name: "Oro Verde", center: { lat: -31.825, lng: -60.519 }, zoom: 13 },
  { id: "ar_ba_lujan_lujan", departmentId: "ba_lujan", provinceId: "ba", name: "Luján", center: { lat: -34.563, lng: -59.121 }, zoom: 13 },
  { id: "ar_ba_lujan_open_door", departmentId: "ba_lujan", provinceId: "ba", name: "Open Door", center: { lat: -34.493, lng: -59.077 }, zoom: 13 },
  { id: "ar_ba_lujan_jauregui", departmentId: "ba_lujan", provinceId: "ba", name: "Jáuregui", center: { lat: -34.598, lng: -59.177 }, zoom: 13 },
  { id: "ar_ba_lujan_torres", departmentId: "ba_lujan", provinceId: "ba", name: "Torres", center: { lat: -34.432, lng: -59.128 }, zoom: 13 },
  { id: "ar_ba_mercedes_mercedes", departmentId: "ba_mercedes", provinceId: "ba", name: "Mercedes", center: { lat: -34.651, lng: -59.431 }, zoom: 13 },
  { id: "ar_sf_rosario_rosario", departmentId: "sf_rosario", provinceId: "sf", name: "Rosario", center: { lat: -32.958, lng: -60.693 }, zoom: 12 },
  { id: "ar_sf_capital_santa_fe", departmentId: "sf_la_capital", provinceId: "sf", name: "Santa Fe", center: { lat: -31.633, lng: -60.7 }, zoom: 12 },
  { id: "ar_cba_capital_cordoba", departmentId: "cba_capital", provinceId: "cba", name: "Córdoba", center: { lat: -31.421, lng: -64.188 }, zoom: 12 },
  { id: "ar_cba_rio_cuarto", departmentId: "cba_rio_cuarto", provinceId: "cba", name: "Río Cuarto", center: { lat: -33.124, lng: -64.349 }, zoom: 12 },
];
