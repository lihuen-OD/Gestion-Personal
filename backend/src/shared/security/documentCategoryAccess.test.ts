import { describe, expect, it } from "vitest";
import { canAccessDocumentCategory, documentCategoryViewWhere } from "./documentCategoryAccess";

const RRHH = "NIVEL_1_RRHH" as const;
const SUPERVISION = "NIVEL_2_SUPERVISION" as const;
const CARGA = "NIVEL_3_CARGA_HORARIA" as const;

const soloRrhh = { viewRoles: ["Nivel 1 - RRHH"], uploadRoles: ["Nivel 1 - RRHH"], approvalRoles: ["Nivel 1 - RRHH"] };
const supervisionYRrhh = {
  viewRoles: ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión"],
  uploadRoles: ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión"],
  approvalRoles: ["Nivel 1 - RRHH"],
};
const todosLosRoles = {
  viewRoles: ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"],
  uploadRoles: ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"],
  approvalRoles: [],
};

/**
 * Etapa 15D.4 (docs/decisions/DOCUMENT_CATEGORY_AUTHORIZATION_15D4.md): el
 * helper es puro y no toca DB/storage — se prueba en aislamiento total.
 */
describe("canAccessDocumentCategory", () => {
  it("RRHH es superadmin documental: puede ver/subir/aprobar aunque la categoría no lo incluya", () => {
    expect(canAccessDocumentCategory({ userRole: RRHH, category: supervisionYRrhh, action: "view" })).toBe(true);
    expect(canAccessDocumentCategory({ userRole: RRHH, category: { viewRoles: [] }, action: "view" })).toBe(true);
    expect(canAccessDocumentCategory({ userRole: RRHH, category: null, action: "upload" })).toBe(true);
  });

  it("Supervisión ve/sube sólo si la categoría incluye su etiqueta de rol", () => {
    expect(canAccessDocumentCategory({ userRole: SUPERVISION, category: supervisionYRrhh, action: "view" })).toBe(true);
    expect(canAccessDocumentCategory({ userRole: SUPERVISION, category: supervisionYRrhh, action: "upload" })).toBe(true);
  });

  it("Supervisión no ve/sube si la categoría no incluye su etiqueta de rol", () => {
    expect(canAccessDocumentCategory({ userRole: SUPERVISION, category: soloRrhh, action: "view" })).toBe(false);
    expect(canAccessDocumentCategory({ userRole: SUPERVISION, category: soloRrhh, action: "upload" })).toBe(false);
  });

  it("Nivel 3 se comporta igual que Supervisión: ve/sube sólo si la categoría lo incluye explícitamente", () => {
    expect(canAccessDocumentCategory({ userRole: CARGA, category: todosLosRoles, action: "view" })).toBe(true);
    expect(canAccessDocumentCategory({ userRole: CARGA, category: todosLosRoles, action: "upload" })).toBe(true);
    expect(canAccessDocumentCategory({ userRole: CARGA, category: soloRrhh, action: "view" })).toBe(false);
    expect(canAccessDocumentCategory({ userRole: CARGA, category: soloRrhh, action: "upload" })).toBe(false);
  });

  it("viewRoles/uploadRoles vacío o null: sólo RRHH, cualquier otro rol queda afuera", () => {
    expect(canAccessDocumentCategory({ userRole: SUPERVISION, category: { viewRoles: [] }, action: "view" })).toBe(false);
    expect(canAccessDocumentCategory({ userRole: SUPERVISION, category: { viewRoles: null }, action: "view" })).toBe(false);
    expect(canAccessDocumentCategory({ userRole: CARGA, category: { uploadRoles: undefined }, action: "upload" })).toBe(false);
  });

  it("categoría ausente (null/undefined): deniega para cualquier rol que no sea RRHH", () => {
    expect(canAccessDocumentCategory({ userRole: SUPERVISION, category: null, action: "view" })).toBe(false);
    expect(canAccessDocumentCategory({ userRole: CARGA, category: undefined, action: "upload" })).toBe(false);
  });

  it("un rol desconocido nunca matchea ninguna etiqueta persistida — deny by default", () => {
    expect(
      canAccessDocumentCategory({
        userRole: "ROL_INEXISTENTE" as never,
        category: todosLosRoles,
        action: "view",
      }),
    ).toBe(false);
  });

  it("approvalRoles se evalúa con la misma semántica que view/upload (sin flujo real conectado todavía)", () => {
    expect(canAccessDocumentCategory({ userRole: RRHH, category: soloRrhh, action: "approval" })).toBe(true);
    expect(canAccessDocumentCategory({ userRole: SUPERVISION, category: soloRrhh, action: "approval" })).toBe(false);
    expect(canAccessDocumentCategory({ userRole: SUPERVISION, category: todosLosRoles, action: "approval" })).toBe(false); // approvalRoles: []
  });

  it("tolera JSON corrupto/con tipos inesperados (no explota, deniega)", () => {
    expect(
      canAccessDocumentCategory({ userRole: SUPERVISION, category: { viewRoles: "no-es-un-array" }, action: "view" }),
    ).toBe(false);
    expect(
      canAccessDocumentCategory({ userRole: SUPERVISION, category: { viewRoles: [1, 2, { role: "x" }] }, action: "view" }),
    ).toBe(false);
  });
});

describe("documentCategoryViewWhere", () => {
  it("RRHH: where vacío — ve todo, sin restricción de categoría", () => {
    expect(documentCategoryViewWhere(RRHH)).toEqual({});
  });

  it("Supervisión: filtra por su etiqueta de rol en category.viewRoles", () => {
    expect(documentCategoryViewWhere(SUPERVISION)).toEqual({
      category: { viewRoles: { array_contains: "Nivel 2 - Supervisión / Gestión" } },
    });
  });

  it("Nivel 3: filtra por su etiqueta de rol en category.viewRoles — ya no bloqueo total", () => {
    expect(documentCategoryViewWhere(CARGA)).toEqual({
      category: { viewRoles: { array_contains: "Nivel 3 - Administrativo de Carga Horaria" } },
    });
  });

  it("rol desconocido: sentinela que nunca matchea nada (deny by default), mismo patrón que employeeAccessWhere", () => {
    expect(documentCategoryViewWhere("ROL_INEXISTENTE" as never)).toEqual({ id: "__NO_DOCUMENT_CATEGORY_ACCESS__" });
  });
});
