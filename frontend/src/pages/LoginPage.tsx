import { Activity, ChevronRight, Clock3, ShieldCheck, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";
import { demoLoginProfiles, type DemoLoginProfile } from "../config/runtimeMode";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(false);
    const ok = await login(email, password);
    setError(!ok);
    setLoading(false);
  };

  const quickLogin = async (profile: DemoLoginProfile) => {
    setLoading(true);
    setError(false);
    const ok = await login(profile.email, profile.password);
    setError(!ok);
    setLoading(false);
  };

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="brand-mark">
          <Users size={28} />
        </div>
        <p className="eyebrow">LOS O'DWYER · GESTIÓN INTERNA</p>
        <h1>
          Personas y horas,
          <br />
          <span>en un solo lugar.</span>
        </h1>
        <p>Gestión integral de legajos, responsabilidades, novedades y control horario.</p>
        <div className="login-feature">
          <ShieldCheck /> Accesos diferenciados por rol
        </div>
        <div className="login-feature">
          <Clock3 /> Carga horaria centrada en las personas
        </div>
        <div className="login-feature">
          <Activity /> Auditoría y trazabilidad completa
        </div>
      </section>

      <section className="login-card">
        <div>
          <p className="eyebrow">BIENVENIDO</p>
          <h2>Ingresar al sistema</h2>
          <p className="muted">Usá tus credenciales para acceder a la plataforma.</p>
        </div>

        <form onSubmit={submit} className="form-stack">
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Contraseña
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <span className="error">No pudimos iniciar sesión. Revisá el email y la contraseña e intentá nuevamente.</span>}
          <Button variant="primary" type="submit" disabled={loading}>
            {loading ? "Ingresando..." : "Ingresar"} <ChevronRight size={17} />
          </Button>
        </form>

        {demoLoginProfiles.length > 0 ? (
          <>
            <div className="login-divider">
              <span>Accesos rápidos para demo</span>
            </div>
            <div className="quick-login">
              {demoLoginProfiles.map((profile, index) => (
                <button key={profile.role} type="button" onClick={() => quickLogin(profile)} disabled={loading}>
                  <span className={`role-dot level-${index + 1}`}>{index + 1}</span>
                  <span>
                    <b>{profile.role}</b>
                    <small>{index === 0 ? "Acceso completo" : index === 1 ? "Control de su área" : "Carga de empleados asignados"}</small>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
