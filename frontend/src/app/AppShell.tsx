import { Bell, ChevronRight, Menu, RefreshCcw, Search, Settings, ShieldCheck, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { demoMode } from "../config/runtimeMode";
import { flattenNavigation, navigationForRole, type NavGroupItem, type NavLinkItem } from "./navigation";

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

function NavLink({ item, pathname, onNavigate, nested = false }: { item: NavLinkItem; pathname: string; onNavigate: () => void; nested?: boolean }) {
  const { Icon } = item;
  return (
    <Link className={`${isActivePath(pathname, item.href) ? "active" : ""} ${nested ? "nav-subitem" : ""}`} to={item.href} onClick={onNavigate}>
      <Icon size={18} />
      {item.label}
    </Link>
  );
}

function NavGroup({ item, pathname, onNavigate }: { item: NavGroupItem; pathname: string; onNavigate: () => void }) {
  const { Icon } = item;
  const active = item.items.some((child) => isActivePath(pathname, child.href));
  return (
    <div className={`nav-group ${active ? "active" : ""}`}>
      <div className="nav-group-title">
        <Icon size={18} />
        <span>{item.label}</span>
      </div>
      <div className="nav-group-items">
        {item.items.map((child) => (
          <NavLink key={child.href} item={child} pathname={pathname} onNavigate={onNavigate} nested />
        ))}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const navItems = navigationForRole(user!.role);
  const flatNavItems = flattenNavigation(navItems);
  const currentNav = flatNavItems.find((item) => isActivePath(location.pathname, item.href));
  const topbarTitle = currentNav?.label || "Dashboard";
  const reset = async () => {
    if (!confirm("¿Restablecer todos los datos de la demo?")) return;
    const { resetDemoData } = await import("../services/storage");
    resetDemoData();
    navigate("/");
    window.location.reload();
  };

  return <div className="app-shell">
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-brand"><div className="brand-mark small"><ShieldCheck size={15} /></div><div><b>Gestión Personal</b><small>Los O'Dwyer</small></div><button className="icon-button sidebar-close" onClick={() => setOpen(false)}><X /></button></div>
      <nav>
        {navItems.map((item) =>
          item.type === "group" ? (
            <NavGroup key={item.label} item={item} pathname={location.pathname} onNavigate={() => setOpen(false)} />
          ) : (
            <NavLink key={item.href} item={item} pathname={location.pathname} onNavigate={() => setOpen(false)} />
          ),
        )}
      </nav>
      <div className="sidebar-bottom"><button className="sidebar-user-card" onClick={logout} title="Cerrar sesión"><span className="sidebar-avatar">{user!.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}</span><span className="sidebar-user-text"><b>{user!.name}</b><small>{user!.role}</small></span><ChevronRight size={14} /></button>{demoMode ? <button className="sidebar-reset-action" onClick={reset} title="Resetear datos demo"><RefreshCcw size={14} /><span>Resetear datos demo</span></button> : null}</div>
    </aside>
    <section className="workspace">
      <header className="topbar"><button className="icon-button menu-toggle" onClick={() => setOpen(true)}><Menu /></button><div className="topbar-title"><span>{topbarTitle}</span><small>Personal y Control Horario</small></div><label className="topbar-search"><Search size={15} /><input placeholder="Buscar legajos, novedades, documentos..." aria-label="Buscar en el sistema" /></label><div className="topbar-actions"><button className="icon-button notification-button"><Bell size={18} /></button><button className="icon-button"><Settings size={18} /></button><div className="user-chip"><span>{user!.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}</span><div><b>{user!.name}</b><small>{user!.role}</small></div></div></div></header>
      <div className="page-wrap">{children}</div>
    </section>
  </div>;
}
