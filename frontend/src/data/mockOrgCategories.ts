import type { OrgCategory } from "../types/organizationChart.types";

const cat = (id: string, label: string, order: number, group: OrgCategory["group"], backgroundColor: string, nodeColor: string): OrgCategory =>
  ({ id, label, order, group, backgroundColor, nodeColor });

export const mockOrgCategories: OrgCategory[] = [
  cat("DIRECTORIO", "Directorio", 1, "DIRECCION", "#fde8ec", "#b94a61"),
  cat("DIRECTOR", "Director", 2, "DIRECCION", "#fde8ec", "#b94a61"),
  cat("GERENTE_GENERAL", "Gerente General", 3, "DIRECCION", "#fde8ec", "#b94a61"),
  cat("ESPECIAL_A", "Especial A", 4, "ESPECIAL", "#e7f5e9", "#2d7d46"),
  cat("ESPECIAL_B", "Especial B", 5, "ESPECIAL", "#e7f5e9", "#2d7d46"),
  cat("ESPECIAL_C", "Especial C", 6, "ESPECIAL", "#e7f5e9", "#2d7d46"),
  cat("ESPECIAL_D", "Especial D", 7, "ESPECIAL", "#e7f5e9", "#2d7d46"),
  cat("ESPECIAL_E", "Especial E", 8, "ESPECIAL", "#e7f5e9", "#2d7d46"),
  cat("ESPECIAL_F", "Especial F", 9, "ESPECIAL", "#e7f5e9", "#2d7d46"),
  cat("ESPECIAL_G", "Especial G", 10, "ESPECIAL", "#e7f5e9", "#2d7d46"),
  cat("ESPECIAL_H", "Especial H", 11, "ESPECIAL", "#e7f5e9", "#2d7d46"),
  cat("ESPECIAL_I", "Especial I", 12, "ESPECIAL", "#e7f5e9", "#2d7d46"),
  cat("ADMINISTRATIVO_A", "Administrativo A", 13, "ADMINISTRATIVO", "#fff2d8", "#b98420"),
  cat("ENCARGADO_A", "Encargado A", 14, "ENCARGADO", "#f4e4d2", "#8a5d32"),
  cat("ADMINISTRATIVO_B", "Administrativo B", 15, "ADMINISTRATIVO", "#fff2d8", "#b98420"),
  cat("ENCARGADO_B", "Encargado B", 16, "ENCARGADO", "#f4e4d2", "#8a5d32"),
  cat("ADMINISTRATIVO_C", "Administrativo C", 17, "ADMINISTRATIVO", "#fff2d8", "#b98420"),
  cat("ENCARGADO_C", "Encargado C", 18, "ENCARGADO", "#f4e4d2", "#8a5d32"),
  cat("ADMINISTRATIVO_D", "Administrativo D", 19, "ADMINISTRATIVO", "#fff2d8", "#b98420"),
  cat("OPERARIO_A", "Operario A", 20, "OPERARIO", "#e8f1ea", "#1f6f4a"),
  cat("OPERARIO_B", "Operario B", 21, "OPERARIO", "#e8f1ea", "#1f6f4a"),
  cat("OPERARIO_C", "Operario C", 22, "OPERARIO", "#e8f1ea", "#1f6f4a"),
  cat("OPERARIO_D", "Operario D", 23, "OPERARIO", "#e8f1ea", "#1f6f4a"),
  cat("SIN_CATEGORIA", "Sin categoría", 24, "SIN_CATEGORIA", "#eef2f4", "#687888"),
];
