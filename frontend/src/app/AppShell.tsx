import { Bell, ChevronRight, Menu, RefreshCcw, Search, Settings, ShieldCheck, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { resetDemoData } from "../services/storage";
import { navigationForRole } from "./navigation";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const navItems = navigationForRole(user!.role);
  const currentNav = navItems.find(([, href]) => location.pathname === href || (href !== "/" && location.pathname.startsWith(href)));
  const topbarTitle = currentNav?.[0] || "Dashboard";
  const reset = () => { if (confirm("¿Restablecer todos los datos de la demo?")) { resetDemoData(); navigate("/"); window.location.reload(); } };

  return <div className="app-shell">
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-brand"><div className="brand-mark small"><ShieldCheck size={15} /></div><div><b>Gestión Personal</b><small>Los O'Dwyer</small></div><button className="icon-button sidebar-close" onClick={() => setOpen(false)}><X /></button></div>
      <nav>{navItems.map(([label, href, Icon]) => <Link className={location.pathname === href || (href !== "/" && location.pathname.startsWith(href)) ? "active" : ""} key={href} to={href} onClick={() => setOpen(false)}><Icon size={18} />{label}</Link>)}</nav>
      <div className="sidebar-bottom"><button className="sidebar-user-card" onClick={logout} title="Cerrar sesión"><span className="sidebar-avatar">{user!.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}</span><span className="sidebar-user-text"><b>{user!.name}</b><small>{user!.role}</small></span><ChevronRight size={14} /></button><button className="sidebar-reset-action" onClick={reset} title="Resetear datos demo"><RefreshCcw size={14} /><span>Resetear datos demo</span></button></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><button className="icon-button menu-toggle" onClick={() => setOpen(true)}><Menu /></button><div className="topbar-title"><span>{topbarTitle}</span><small>Personal y Control Horario</small></div><label className="topbar-search"><Search size={15} /><input placeholder="Buscar legajos, novedades, documentos..." aria-label="Buscar en el sistema" /></label><div className="topbar-actions"><button className="icon-button notification-button"><Bell size={18} /></button><button className="icon-button"><Settings size={18} /></button><div className="user-chip"><span>{user!.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}</span><div><b>{user!.name}</b><small>{user!.role}</small></div></div></div></header>
      <div className="page-wrap">{children}</div>
    </section>
  </div>;
}
