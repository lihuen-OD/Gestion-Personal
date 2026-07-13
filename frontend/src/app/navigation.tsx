import {
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  Clock3,
  FileBarChart,
  FolderOpen,
  Home,
  LayoutDashboard,
  Network,
  Settings,
  ShieldCheck,
  TimerReset,
  UserCog,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "../types";
import { roleLevel } from "../utils/roles";

export type NavLinkItem = {
  type: "link";
  label: string;
  href: string;
  Icon: LucideIcon;
};

export type NavGroupItem = {
  type: "group";
  label: string;
  Icon: LucideIcon;
  items: NavLinkItem[];
};

export type NavItem = NavLinkItem | NavGroupItem;

const link = (label: string, href: string, Icon: LucideIcon): NavLinkItem => ({
  type: "link",
  label,
  href,
  Icon,
});

const group = (label: string, Icon: LucideIcon, items: NavLinkItem[]): NavGroupItem => ({
  type: "group",
  label,
  Icon,
  items,
});

const hourlyManagement = (level: number) =>
  group("Gestión horaria", Clock3, [
    link("Inicio", "/gestion-horaria", Home),
    link("Asistencia", "/asistencia", TimerReset),
    link("Carga de horas", "/horas", Clock3),
    // Bandeja de aprobación: quien no puede aprobar/rechazar/devolver (Nivel 3) no la ve en el menú.
    ...(level === 3 ? [] : [link("Bandeja de revisión", "/pendientes", CalendarDays)]),
    link(level === 3 ? "Novedades horarias" : "Novedades", "/novedades", ClipboardList),
    link("Fichador", "/fichador", Clock3),
    ...(level === 1 ? [link("Exportación", "/configuracion/liquidacion", FileBarChart)] : []),
  ]);

export const navByLevel: Record<number, NavItem[]> = {
  1: [
    link("Dashboard", "/", LayoutDashboard),
    link("Legajos", "/legajos", Users),
    link("Puestos", "/puestos", BriefcaseBusiness),
    hourlyManagement(1),
    link("Gestión Documental", "/documentacion", FolderOpen),
    link("Organigramas", "/organigramas", Network),
    link("Usuarios y Roles", "/usuarios", UserCog),
    link("Configuración", "/configuracion", Settings),
    link("Auditoría", "/auditoria", ShieldCheck),
  ],
  2: [
    link("Dashboard", "/", LayoutDashboard),
    hourlyManagement(2),
    link("Legajos de mi área", "/legajos", Users),
    link("Puestos", "/puestos", BriefcaseBusiness),
    link("Organigramas", "/organigramas", Network),
    link("Reportes de Gestión", "/reportes", FileBarChart),
  ],
  3: [hourlyManagement(3)],
};

export function flattenNavigation(items: NavItem[]): NavLinkItem[] {
  return items.flatMap((item) => (item.type === "group" ? item.items : [item]));
}

export function navigationForRole(role: Role) {
  return navByLevel[roleLevel(role)];
}
