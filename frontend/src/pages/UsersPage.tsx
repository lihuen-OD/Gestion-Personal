import { useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, Power } from "lucide-react";
import type { Role, User } from "../types";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { userApiService } from "../services/api/userApiService";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { TableShell } from "../components/ui/TableShell";
import { OverflowCell } from "../components/ui/OverflowCell";
import { Modal } from "../components/ui/Modal";
import { Field, Select } from "../components/ui/FormControls";
import { statusClass } from "../utils/status";
import { roleOptions } from "../utils/roles";

type UserDraft = Omit<User, "id">;

function uniqueOptions(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function userRoleOptions(current = "") {
  return uniqueOptions([current, ...roleOptions]);
}

function emptyUserDraft(): UserDraft {
  return {
    name: "",
    email: "",
    password: "",
    role: "Nivel 3 - Administrativo de Carga Horaria",
    status: "Activo",
    company: "",
    sector: "",
  };
}

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [companyOptions, setCompanyOptions] = useState<string[]>([]);
  const [sectorOptions, setSectorOptions] = useState<string[]>([]);
  const [usesBackend, setUsesBackend] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserDraft>(() => emptyUserDraft());
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    Promise.all([userApiService.getAll(), orgStructureApiService.getCatalog()])
      .then(([apiUsers, catalog]) => {
        if (!mounted) return;
        setUsers(apiUsers);
        setCompanyOptions(catalog.companies.map((item) => item.name));
        setSectorOptions(catalog.sectors.map((item) => item.name));
        setUsesBackend(true);
      })
      .catch(() => {
        if (!mounted) return;
        setUsesBackend(false);
      });
    return () => {
      mounted = false;
    };
  }, [refresh]);

  const reset = () => {
    setEditingUserId(null);
    setDraft(emptyUserDraft());
    setError("");
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const openCreate = () => {
    reset();
    setOpen(true);
  };

  const openEdit = (user: User, focusPassword = false) => {
    setEditingUserId(user.id);
    setDraft({ ...user, password: "" });
    setError(focusPassword ? "Completa la nueva contrasena y guarda los cambios." : "");
    setOpen(true);
  };

  const reload = () => {
    setRefresh((value) => value + 1);
  };

  const save = async () => {
    const email = draft.email.trim().toLowerCase();
    const password = draft.password.trim();

    if (!draft.name.trim()) return setError("Ingresa el nombre y apellido del usuario.");
    if (!email.includes("@")) return setError("Ingresa un email valido.");
    if (users.some((user) => user.email.toLowerCase() === email && user.id !== editingUserId)) {
      return setError("Ya existe un usuario con ese email.");
    }
    if (!editingUserId && password.length < 8) return setError("La contrasena debe tener al menos 8 caracteres.");
    if (editingUserId && password && password.length < 8) return setError("La nueva contrasena debe tener al menos 8 caracteres.");

    const payload: UserDraft = {
      ...draft,
      name: draft.name.trim(),
      email,
      password,
      company: draft.company || undefined,
      sector: draft.sector || undefined,
    };

    try {
      if (editingUserId) {
        await userApiService.update({ ...payload, id: editingUserId });
        if (password) await userApiService.resetPassword(editingUserId, password);
      } else {
        await userApiService.create(payload);
      }
      reload();
      close();
    } catch {
      setError("No se pudo guardar el usuario. Revisa email, contrasena y alcance.");
    }
  };

  const toggleStatus = async (user: User) => {
    const next: User = { ...user, password: "", status: user.status === "Activo" ? "Inactivo" : "Activo" };
    try {
      await userApiService.update(next);
      reload();
    } catch {
      setError("No se pudo cambiar el estado del usuario.");
    }
  };

  return <>
    <PageHeader
      eyebrow="SEGURIDAD Y ACCESOS"
      title="Usuarios y roles"
      description="Administra usuarios reales de acceso, roles y alcance organizacional."
      action={<button className="button primary" onClick={openCreate}><Plus size={16} /> Crear usuario</button>}
    />

    <Section title="Usuarios habilitados" subtitle={`${users.length} perfiles configurados`}>
      <TableShell minWidth={1020}>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Empresa / Area</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td><b>{user.name}</b></td>
                <td>{user.email}</td>
                <td><OverflowCell value={user.role} /></td>
                <td><span className={statusClass(user.status)}>{user.status}</span></td>
                <td><OverflowCell value={`${user.company || "Acceso global"} ${user.sector ? `- ${user.sector}` : ""}`.trim()} /></td>
                <td>
                  <div className="table-actions">
                    <button className="icon-button" title="Editar usuario" onClick={() => openEdit(user)}><Pencil size={15} /></button>
                    <button className="icon-button" title="Resetear contrasena" onClick={() => openEdit(user, true)}><KeyRound size={15} /></button>
                    <button className="icon-button" title={user.status === "Activo" ? "Inactivar usuario" : "Activar usuario"} onClick={() => toggleStatus(user)}><Power size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </Section>

    {open && (
      <Modal title={editingUserId ? "Editar usuario" : "Crear usuario"} close={close}>
        <div className="form-stack">
          <div className="info-note compact">
            <b>{editingUserId ? "Edicion de usuario" : "Alta de usuario"}</b>
            <p>
              {editingUserId
                ? "Podes actualizar datos, rol, alcance y estado. Si completas contrasena, se resetea el acceso."
                : "Este usuario podra ingresar con el email y contrasena definidos. El rol determina permisos y visibilidad."}
            </p>
          </div>

          <Field label="Nombre y apellido *" value={draft.name} set={(name) => setDraft({ ...draft, name })} />
          <Field label="Email de acceso *" type="email" value={draft.email} set={(email) => setDraft({ ...draft, email })} />
          <Field label={editingUserId ? "Nueva contrasena (opcional)" : "Contrasena inicial *"} type="password" value={draft.password} set={(password) => setDraft({ ...draft, password })} />
          <Select label="Rol *" value={draft.role} set={(role) => setDraft({ ...draft, role: role as Role })} options={userRoleOptions(draft.role)} />
          <Select label="Estado" value={draft.status} set={(status) => setDraft({ ...draft, status: status as User["status"] })} options={["Activo", "Inactivo"]} />
          <Select label="Empresa / alcance" value={draft.company || ""} set={(company) => setDraft({ ...draft, company })} options={companyOptions} />
          <Select label="Sector / area" value={draft.sector || ""} set={(sector) => setDraft({ ...draft, sector })} options={sectorOptions} />

          {error && <p className="error">{error}</p>}

          <div className="form-actions">
            <button className="button subtle" onClick={close}>Cancelar</button>
            <button className="button primary" onClick={save}>{editingUserId ? "Guardar cambios" : "Guardar usuario"}</button>
          </div>
        </div>
      </Modal>
    )}
  </>;
}
