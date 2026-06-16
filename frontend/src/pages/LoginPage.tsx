import { Activity, ChevronRight, Clock3, ShieldCheck, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../types";

export function LoginPage() {
  const { login, loginAs } = useAuth();
  const [email, setEmail] = useState("rrhh@demo.com");
  const [password, setPassword] = useState("demo");
  const [error, setError] = useState(false);
  const submit = (event: FormEvent) => { event.preventDefault(); setError(!login(email, password)); };
  const roles: Role[] = ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"];
  return <main className="login-page">
    <section className="login-brand">
      <div className="brand-mark"><Users size={28} /></div>
      <p className="eyebrow">LOS O'DWYER · GESTIÓN INTERNA</p>
      <h1>Personas y horas,<br /><span>en un solo lugar.</span></h1>
      <p>Prototipo funcional para validar legajos, responsabilidades, novedades y control horario antes de conectar el backend.</p>
      <div className="login-feature"><ShieldCheck /> Accesos diferenciados por rol</div>
      <div className="login-feature"><Clock3 /> Carga horaria centrada en las personas</div>
      <div className="login-feature"><Activity /> Auditoría y trazabilidad completa</div>
    </section>
    <section className="login-card">
      <div>
        <p className="eyebrow">BIENVENIDO</p><h2>Ingresar al sistema</h2>
        <p className="muted">Usá tus credenciales o elegí un perfil rápido para recorrer la demo.</p>
      </div>
      <form onSubmit={submit} className="form-stack">
        <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <span className="error">Credenciales inválidas.</span>}
        <button className="button primary" type="submit">Ingresar <ChevronRight size={17} /></button>
      </form>
      <div className="login-divider"><span>Accesos rápidos para demo</span></div>
      <div className="quick-login">
        {roles.map((role, index) => <button key={role} onClick={() => loginAs(role)}><span className={`role-dot level-${index + 1}`}>{index + 1}</span><span><b>{role}</b><small>{index === 0 ? "Acceso completo" : index === 1 ? "Control de su área" : "Carga de empleados asignados"}</small></span></button>)}
      </div>
    </section>
  </main>;
}
