import { describe, expect, it } from "vitest";
import { storagePathBuilder } from "./storagePathBuilder";
import { safeDriveFolderName } from "./storageValidation";

// Alta mínima: legajo, nombre y apellido. Ningún input de estas funciones
// admite puesto, empresa, establecimiento, sector ni dispositivo.
const JUAN = { legajo: "0001", firstName: "Juan", lastName: "Perez" };
const JOSE = { legajo: "0007", firstName: "José", lastName: "Peña" };
const REQUEST_ID = "b72d61e4-0c1a-4a8e-9a55-3c7f0e2d9b10";

describe("safeDriveFolderName", () => {
  it.each([
    ["0007 - José Peña", "0007 - José Peña"],
    ["  0001  -   Juan   Perez  ", "0001 - Juan Perez"],
    ["O'Brien", "O'Brien"],
    ["a/b\\c:d*e?f\"g<h>i|j", "a-b-c-d-e-f-g-h-i-j"],
    ["con\u0000control\u001f", "concontrol"],
    ["..", ""],
    [".oculta", "oculta"],
    // Idempotente sobre los segmentos ASCII que ya se usaban.
    ["documentos-personales", "documentos-personales"],
    ["attendance-archive", "attendance-archive"],
  ])("%j → %j", (input, expected) => {
    expect(safeDriveFolderName(input)).toBe(expected);
  });

  it("normaliza a NFC (la misma Ñ escrita descompuesta da el mismo nombre de carpeta)", () => {
    expect(safeDriveFolderName("Peña")).toBe("Peña");
  });
});

describe("storagePathBuilder.documentDriveFolder", () => {
  it.each([
    [{ name: "DNI", kind: "PERSONAL" }, "Documentos personales"],
    [{ name: "Constancia de CUIL", kind: "LABORAL" }, "Contratos"],
    [{ name: "Contrato laboral", kind: "LEGAL" }, "Contratos"],
    [{ name: "Alta temprana AFIP", kind: "LEGAL" }, "Contratos"],
    [{ name: "Apto medico", kind: "MEDICA" }, "Certificados"],
    [{ name: "Certificado de enfermedad", kind: "NOVEDAD" }, "Licencias"],
    [{ name: "Licencia de conducir", kind: "TRANSPORTE" }, "Transporte"],
    [{ name: "Capacitacion obligatoria", kind: "CAPACITACION" }, "Estudios"],
    [{ name: "Recibo de sueldo", kind: "LIQUIDACION" }, "Liquidaciones"],
    [{ name: "Varios", kind: "OTRO" }, "Otros"],
    [{ name: "Constancia de domicilio", kind: "PERSONAL" }, "Domicilio"],
    [{ name: "Cambio de Domicilio", kind: "OTRO" }, "Domicilio"],
    [{ name: "Sin kind", kind: null }, "Otros"],
    [{ name: "Kind desconocido", kind: "INEXISTENTE" }, "Otros"],
  ])("%j → %s", (category, expected) => {
    expect(storagePathBuilder.documentDriveFolder(category)).toBe(expected);
  });

  it("licencia de conducir va a Transporte aunque su kind sea otro (no a Licencias)", () => {
    expect(storagePathBuilder.documentDriveFolder({ name: "Licencia de conducir", kind: "NOVEDAD" })).toBe("Transporte");
    expect(storagePathBuilder.documentDriveFolder({ name: "Carnet profesional", kind: "PERSONAL" })).toBe("Transporte");
    expect(storagePathBuilder.documentDriveFolder({ name: "Licencia por maternidad", kind: "NOVEDAD" })).toBe("Licencias");
  });
});

describe("storagePathBuilder.employeeDocument", () => {
  const base = {
    employeeId: "employee-1",
    employee: JUAN,
    category: { name: "DNI", kind: "PERSONAL" },
    // 13/11/2026 10:00 hora argentina.
    uploadedAt: new Date("2026-11-13T13:00:00.000Z"),
    extension: "pdf",
    uniqueSuffix: "a1b2c3",
  };

  it("Legajos/<legajo - Nombre Apellido>/<categoría> con identidad por employeeId y nombre humano portable", () => {
    expect(storagePathBuilder.employeeDocument(base)).toEqual({
      folderSegments: ["legajos", "employee-1", "documentos-personales"],
      driveFolders: [
        { name: "Legajos" },
        { name: "0001 - Juan Perez", appProperties: { employeeId: "employee-1" } },
        { name: "Documentos personales" },
      ],
      fileName: "2026-11-13_DNI_Juan-Perez_a1b2c3.pdf",
    });
  });

  it("carpeta con acentos y Ñ; archivo en ASCII", () => {
    const location = storagePathBuilder.employeeDocument({ ...base, employee: JOSE });

    expect(location.driveFolders[1]!.name).toBe("0007 - José Peña");
    expect(location.fileName).toBe("2026-11-13_DNI_Jose-Pena_a1b2c3.pdf");
  });

  it("sanea caracteres especiales y espacios en tipo y nombre del archivo", () => {
    const location = storagePathBuilder.employeeDocument({
      ...base,
      employee: { legajo: "12", firstName: "  María  José ", lastName: "O'Brien / Núñez" },
      category: { name: "Apto médico (anual)", kind: "MEDICA" },
      extension: "PDF",
    });

    expect(location.fileName).toBe("2026-11-13_Apto-medico-anual_Maria-Jose-O-Brien-Nunez_a1b2c3.pdf");
    expect(location.fileName).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(location.driveFolders[1]!.name).toBe("12 - María José O'Brien - Núñez");
  });

  it("usa la fecha argentina del alta (23:30 no pasa al día siguiente por UTC)", () => {
    const location = storagePathBuilder.employeeDocument({ ...base, uploadedAt: new Date("2026-11-14T02:30:00.000Z") });

    expect(location.fileName.startsWith("2026-11-13_")).toBe(true);
  });

  it("sufijos distintos dan nombres distintos para el mismo tipo y día", () => {
    const first = storagePathBuilder.employeeDocument({ ...base, uniqueSuffix: "aaaaaa" }).fileName;
    const second = storagePathBuilder.employeeDocument({ ...base, uniqueSuffix: "bbbbbb" }).fileName;

    expect(first).not.toBe(second);
  });

  it("nunca genera storage-sistema", () => {
    expect(JSON.stringify(storagePathBuilder.employeeDocument(base))).not.toContain("storage-sistema");
  });
});

describe("storagePathBuilder.attendanceArchive", () => {
  it("Fichadas/<año>/<MM - Mes>/<legajo - Nombre Apellido> y AAAA-MM-DD_HH-mm_TIPO_id6.ext en hora argentina", () => {
    expect(storagePathBuilder.attendanceArchive({
      employee: JUAN,
      punchType: "INGRESO",
      timestamp: new Date("2026-11-13T11:02:00.000Z"),
      requestId: REQUEST_ID,
      extension: "jpg",
    })).toEqual({
      driveFolders: [{ name: "Fichadas" }, { name: "2026" }, { name: "11 - Noviembre" }, { name: "0001 - Juan Perez" }],
      fileName: "2026-11-13_08-02_INGRESO_b72d61.jpg",
    });
  });

  it.each([
    // 30/11 23:30 AR = 01/12 02:30 UTC → noviembre.
    ["2026-12-01T02:30:00.000Z", "2026", "11 - Noviembre", "2026-11-30_23-30"],
    // 31/12 23:30 AR = 01/01 02:30 UTC → diciembre de 2026, no 2027.
    ["2027-01-01T02:30:00.000Z", "2026", "12 - Diciembre", "2026-12-31_23-30"],
    // 01/01 00:05 AR = 03:05 UTC.
    ["2027-01-01T03:05:00.000Z", "2027", "01 - Enero", "2027-01-01_00-05"],
  ])("instante %s → %s/%s, %s", (instant, year, month, prefix) => {
    const location = storagePathBuilder.attendanceArchive({ employee: JUAN, punchType: "SALIDA", timestamp: new Date(instant), requestId: REQUEST_ID, extension: "webp" });

    expect(location.driveFolders.slice(1, 3)).toEqual([{ name: year }, { name: month }]);
    expect(location.fileName).toBe(`${prefix}_SALIDA_b72d61.webp`);
  });

  it("no usa identidad por appProperties en Fichadas (fotografía histórica por mes)", () => {
    const location = storagePathBuilder.attendanceArchive({ employee: JOSE, punchType: "INGRESO", timestamp: new Date("2026-11-13T11:02:00.000Z"), requestId: REQUEST_ID, extension: "jpg" });

    expect(location.driveFolders[3]).toEqual({ name: "0007 - José Peña" });
  });
});

describe("storagePathBuilder.archivePunchType", () => {
  it.each([
    ["INGRESO", "INGRESO"],
    ["IN", "INGRESO"],
    ["SALIDA", "SALIDA"],
    ["OUT", "SALIDA"],
    ["ENTRADA", null],
    [undefined, null],
  ])("%j → %j", (value, expected) => {
    expect(storagePathBuilder.archivePunchType(value)).toBe(expected);
  });
});
