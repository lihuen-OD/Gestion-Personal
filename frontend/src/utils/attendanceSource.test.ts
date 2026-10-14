import { describe, expect, it } from "vitest";
import { attendanceSourceLabel } from "./attendanceSource";

describe("attendanceSourceLabel — columna Origen de Asistencia", () => {
  it("F9: kiosco con dispositivo → 'Kiosco · <nombre>'", () => {
    expect(attendanceSourceLabel("KIOSK", "Pañol principal")).toBe("Kiosco · Pañol principal");
    expect(attendanceSourceLabel("KIOSK", "  Pañol principal ")).toBe("Kiosco · Pañol principal");
  });

  it.each([undefined, null, "", "   "])("F9: kiosco histórico sin dispositivo (%s) → 'Kiosco', nunca 'undefined'", (deviceName) => {
    expect(attendanceSourceLabel("KIOSK", deviceName)).toBe("Kiosco");
  });

  it.each([
    ["PUBLIC_CLOCK_PHOTO", "Fichador con foto"],
    ["ADMIN", "Admin"],
    ["PORTAL_DNI", "Fichador"],
    ["BIOTIME", "BioTime"],
    ["FACIAL", "Facial"],
  ])("%s conserva su texto aunque la fichada tenga dispositivo", (source, label) => {
    expect(attendanceSourceLabel(source, "Pañol principal")).toBe(label);
    expect(attendanceSourceLabel(source)).toBe(label);
  });

  it("un origen desconocido nunca muestra el enum ni el dispositivo", () => {
    expect(attendanceSourceLabel("NUEVO_CANAL", "Pañol")).toBe("Origen no identificado");
  });
});
