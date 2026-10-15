// Ruta de negocio de una ubicación (Provincia › Zona › Establecimiento y sus
// unidades), compartida por Datos Laborales, listados, organigrama y
// fichadores. Una zona anterior a la provincia muestra sólo su nombre: la
// provincia nunca se infiere.

/** "Entre Ríos › Arroyo Barú", o sólo la zona si todavía no tiene provincia. */
export function zonePathLabel(zoneName: string, provinceName?: string | null) {
  return provinceName ? `${provinceName} › ${zoneName}` : zoneName;
}

/** "La Suiza (Lote Norte, Lote Sur)" con unidades específicas; "Oficina Central" si es completo. */
export function establishmentUnitsLabel(name: string, coverage: "ESTABLISHMENT" | "UNITS" | undefined, unitNames: string[]) {
  return coverage === "UNITS" && unitNames.length ? `${name} (${unitNames.join(", ")})` : name;
}

/** "Entre Ríos › Arroyo Barú: La Suiza (Lote Norte), Oficina Central". */
export function workLocationLabel(location: { zoneName: string; provinceName?: string; establishments: string[] }) {
  return `${zonePathLabel(location.zoneName, location.provinceName)}: ${location.establishments.join(", ")}`;
}
