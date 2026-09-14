import type { Prisma, RoleName } from "@prisma/client";
import { roles } from "./roles";

/**
 * Etapa 15D.4 (docs/decisions/DOCUMENT_CATEGORY_AUTHORIZATION_15D4.md):
 * autorización documental server-side por `DocumentCategory`.
 *
 * `DocumentCategory.viewRoles`/`uploadRoles`/`approvalRoles` se persisten
 * como las ETIQUETAS en español del rol (p. ej. `"Nivel 1 - RRHH"`), no como
 * el enum `RoleName` (`"NIVEL_1_RRHH"`) que trae `req.user.role` — mismo
 * patrón ya usado en `modules/novelties/novelties.service.ts` (`roleLabels`)
 * para `NoveltyType.approvalRoles`/`allowedLoadRoles`. La tabla se duplica
 * acá (no se importa desde `novelties.service.ts`) para no tocar ese módulo,
 * fuera de alcance de esta etapa.
 */
const roleLabels: Record<RoleName, string> = {
  NIVEL_1_RRHH: "Nivel 1 - RRHH",
  NIVEL_2_SUPERVISION: "Nivel 2 - Supervisión / Gestión",
  NIVEL_3_CARGA_HORARIA: "Nivel 3 - Administrativo de Carga Horaria",
};

export type DocumentCategoryAction = "view" | "upload" | "approval";

/**
 * Forma mínima necesaria de una `DocumentCategory` para poder autorizar —
 * los tres campos son `Json` en el schema (arrays de etiquetas de rol),
 * nunca tipados a nivel DB.
 */
export interface DocumentCategoryRolesLike {
  viewRoles?: unknown;
  uploadRoles?: unknown;
  approvalRoles?: unknown;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function rolesFor(category: DocumentCategoryRolesLike, action: DocumentCategoryAction): string[] {
  if (action === "view") return asStringArray(category.viewRoles);
  if (action === "upload") return asStringArray(category.uploadRoles);
  return asStringArray(category.approvalRoles);
}

/**
 * RRHH es superadmin documental: ve/lista/descarga/sube/aprueba cualquier
 * categoría siempre, sin excepción — nunca queda bloqueado por
 * viewRoles/uploadRoles/approvalRoles.
 *
 * Para cualquier otro rol, hace falta que la categoría liste explícitamente
 * su etiqueta en el array correspondiente a la acción. Semántica explícita
 * para los casos límite (Etapa 15D.4, sin permisos amplios por default):
 * - Categoría ausente (`null`/`undefined`): deniega para todo lo que no sea
 *   RRHH. En la práctica `EmployeeDocument.categoryId` es una FK obligatoria
 *   (nunca `null` en un documento ya persistido) — esta rama es una
 *   salvaguarda defensiva, no un caso alcanzable hoy.
 * - Array vacío/`null`/no-array: `asStringArray` lo normaliza a `[]`, y
 *   `[].includes(...)` es siempre `false` — mismo resultado que "sólo RRHH",
 *   sin necesitar un caso especial.
 * - Rol desconocido (no está en `roleLabels`): nunca matchea ninguna
 *   etiqueta persistida, deniega por defecto sin necesitar un caso especial.
 */
export function canAccessDocumentCategory(input: {
  userRole: RoleName;
  category: DocumentCategoryRolesLike | null | undefined;
  action: DocumentCategoryAction;
}): boolean {
  if (input.userRole === roles.rrhh) return true;
  if (!input.category) return false;
  const allowed = rolesFor(input.category, input.action);
  const label = roleLabels[input.userRole];
  return allowed.includes(label) || allowed.includes(input.userRole);
}

/**
 * Fragmento de `where` de Prisma para restringir documentos visibles por
 * categoría a nivel de QUERY — necesario para que la paginación de listados
 * sea correcta (filtrar en memoria después de paginar rompería `meta.total`/
 * `hasMore`) y para que "descarga por ID directo" nunca revele metadata de
 * un documento fuera de alcance: si `category.viewRoles` no incluye el rol,
 * la query no lo encuentra y el caller ve el mismo 404 que "no existe" —
 * nunca distingue "existe pero no tenés permiso" de "no existe".
 *
 * RRHH: sin filtro (ve todo). Rol desconocido: sentinela de "no matchea
 * nada", mismo patrón que `employeeAccessWhere` usa para roles no
 * reconocidos (`{ id: "__NO_ACCESS__" }`).
 */
export function documentCategoryViewWhere(userRole: RoleName): Prisma.EmployeeDocumentWhereInput {
  if (userRole === roles.rrhh) return {};
  const label = roleLabels[userRole];
  if (!label) return { id: "__NO_DOCUMENT_CATEGORY_ACCESS__" };
  return { category: { viewRoles: { array_contains: label } } };
}
