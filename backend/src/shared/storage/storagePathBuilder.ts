function safeSegment(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function assertSegments(segments: string[]) {
  const safe = segments.map(safeSegment).filter(Boolean);
  if (safe.length !== segments.length || safe.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Invalid storage path segment");
  }
  return safe;
}

function dateParts(date: Date) {
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
    day: String(date.getUTCDate()).padStart(2, "0"),
  };
}

function employeeDocumentCategory(documentType?: string | null) {
  const value = (documentType || "otros").toLowerCase();
  if (value.includes("dni") || value.includes("cuil")) return "documentos-personales";
  if (value.includes("contrato") || value.includes("alta")) return "contratos";
  if (value.includes("certificado") || value.includes("medic")) return "certificados";
  if (value.includes("licencia")) return "licencias";
  if (value.includes("conduc") || value.includes("transporte") || value.includes("carnet")) return "transporte";
  if (value.includes("domicilio")) return "domicilio";
  if (value.includes("estudio")) return "estudios";
  return "otros";
}

export const storagePathBuilder = {
  attendancePunch(date: Date) {
    const parts = dateParts(date);
    return assertSegments(["storage-sistema", "fichadas", parts.year, parts.month, parts.day]);
  },

  employeeDocument(legajo: string, documentType?: string | null) {
    return assertSegments(["storage-sistema", "legajos", legajo, employeeDocumentCategory(documentType)]);
  },

  novelty(date: Date) {
    const parts = dateParts(date);
    return assertSegments(["storage-sistema", "novedades", parts.year, parts.month]);
  },

  temporary() {
    return assertSegments(["storage-sistema", "temporales"]);
  },
};
