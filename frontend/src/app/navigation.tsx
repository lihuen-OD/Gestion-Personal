import { BriefcaseBusiness, CalendarDays, ClipboardList, Clock3, FileBarChart, FolderOpen, LayoutDashboard, Network, Settings, ShieldCheck, UserCog, Users } from "lucide-react";
import type { Role } from "../types";
import { roleLevel } from "../utils/roles";

export const navByLevel = {
  1: [["Dashboard", "/", LayoutDashboard], ["Legajos", "/legajos", Users], ["Carga de Horas", "/horas", Clock3], ["Mis Pendientes", "/pendientes", CalendarDays], ["Novedades", "/novedades", ClipboardList], ["Gestión Documental", "/documentacion", FolderOpen], ["Organigramas", "/organigramas", Network], ["Usuarios y Roles", "/usuarios", UserCog], ["Configuración", "/configuracion", Settings], ["Auditoría", "/auditoria", ShieldCheck]],
  2: [["Dashboard", "/", LayoutDashboard], ["Carga de Horas", "/horas", Clock3], ["Mis Pendientes", "/pendientes", CalendarDays], ["Novedades", "/novedades", ClipboardList], ["Legajos de mi área", "/legajos", Users], ["Organigramas", "/organigramas", Network], ["Reportes de Gestión", "/reportes", FileBarChart]],
  3: [["Carga de Horas", "/horas", Clock3], ["Novedades Horarias", "/novedades", ClipboardList], ["Mis Pendientes", "/pendientes", CalendarDays]],
} as const;

export function navigationForRole(role: Role) {
  const level = roleLevel(role);
  if (level === 1) return [...navByLevel[level].slice(0, 2), ["Puestos", "/puestos", BriefcaseBusiness] as const, ...navByLevel[level].slice(2)];
  if (level === 2) return [...navByLevel[level].slice(0, 4), ["Puestos", "/puestos", BriefcaseBusiness] as const, ...navByLevel[level].slice(4)];
  return navByLevel[level];
}
