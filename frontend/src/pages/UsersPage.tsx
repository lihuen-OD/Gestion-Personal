import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { KeyRound, Pencil, Plus, Power } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { roleLevel } from "../utils/roles";
import type { Employee, Role, User, UserShiftGroup, UserSupervisionPerson } from "../types";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { userApiService } from "../services/api/userApiService";
import { employeeApiService } from "../services/api/employeeApiService";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { DataTable } from "../components/ui/DataTable";
import { OverflowCell } from "../components/ui/OverflowCell";
import { Modal } from "../components/ui/Modal";
import { Field, Select } from "../components/ui/FormControls";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { SortableHeader } from "../components/ui/SortableHeader";
import { statusTone } from "../utils/status";
import { roleOptions } from "../utils/roles";
import { displayLegajo } from "../utils/employee";
import { useAsyncAction } from "../utils/useAsyncAction";
import { useSort, type SortAccessors } from "../utils/sort";
import { confirmAction } from "../services/appDialog";
import { ApiError, getUserErrorMessage } from "../services/api/apiClient";
import { uniqueOptions } from "../components/employees/options/sharedOptions";
import { SupervisedUsersSelector } from "../components/users/SupervisedUsersSelector";
import { InheritedShiftGroupsPanel, ShiftGroupsSelector, shiftGroupOptions } from "../components/users/ShiftGroupAccessFields";
import { shiftGroupApiService, type ShiftGroup } from "../services/api/shiftGroupApiService";

const SUPERVISION_ROLE: Role = "Nivel 2 - Supervisión / Gestión";
const CARGA_ROLE: Role = "Nivel 3 - Administrativo de Carga Horaria";
const RRHH_ROLE: Role = "Nivel 1 - RRHH";

type UserDraft = Omit<User, "id">;

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
    employeeId: "",
    employeeName: "",
    supervisedUserIds: [],
  };
}

function peopleList(people: Array<{ name: string }>) {
  return people.map((person) => person.name).join(", ");
}

function groupList(groups: UserShiftGroup[]) {
  return groups.map((group) => group.name).join(", ");
}

type ShiftGroupLoss = { person: string; groups: UserShiftGroup[] };

/**
 * R8: responsables de carga que dejarían de heredar grupos al guardar. Sólo
 * cuenta los grupos que heredan únicamente a través de este Nivel 2 (si otro
 * supervisor activo también se los da, los conservan). Usa la herencia que
 * devolvió el backend; es un aviso, no autorización.
 */
function inheritedLosses(users: User[], supervisorId: string, affected: Array<{ personId: string; groups: UserShiftGroup[] }>): ShiftGroupLoss[] {
  const byId = new Map(users.map((user) => [user.id, user]));
  return affected.flatMap(({ personId, groups }) => {
    const person = byId.get(personId);
    if (!person) return [];
    const lost = groups.filter((group) => {
      const entry = person.inheritedShiftGroups?.find((item) => item.group.id === group.id);
      return !entry || entry.viaSupervisors.every((via) => via.id === supervisorId);
    });
    return lost.length ? [{ person: person.name, groups: lost }] : [];
  });
}

// La empresa es un dato administrativo existente; no concede permisos.
const sortAccessors: SortAccessors<User, "name" | "email" | "role" | "status" | "scope" | "employee"> = {
  name: (user) => user.name,
  email: (user) => user.email,
  role: (user) => user.role,
  status: (user) => user.status,
  scope: (user) => user.company || "",
  employee: (user) => user.employeeName,
};

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [companyOptions, setCompanyOptions] = useState<string[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<Employee[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [listStatus, setListStatus] = useState<"loading" | "success" | "error">("loading");
  const [open, setOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserDraft>(() => emptyUserDraft());
  const [error, setError] = useState("");
  // Etapa 9E: catálogo de empresas y los hasta 1000 empleados sólo
  // los usa el modal de crear/editar (selects de alcance y empleado
  // vinculado) — antes se pedían en el mount de la pantalla, bloqueando la
  // tabla hasta que resolvieran, aunque la tabla nunca los muestra. Se
  // difieren a cuando el modal se abre por primera vez; ambos servicios ya
  // están cacheados (services/cache), así que abrir el modal de nuevo dentro
  // del TTL no vuelve a pegarle a la red.
  const [catalogStatus, setCatalogStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // R8: catálogo de grupos de turnos, sólo para el modal (cacheado en services/cache).
  const [shiftGroupCatalog, setShiftGroupCatalog] = useState<ShiftGroup[]>([]);
  const [shiftGroupsStatus, setShiftGroupsStatus] = useState<"loading" | "error" | "ready">("loading");

  useEffect(() => {
    let mounted = true;
    setListStatus("loading");
    userApiService.getAll()
      .then((apiUsers) => {
        if (!mounted) return;
        setUsers(apiUsers);
        setListStatus("success");
      })
      .catch(() => {
        if (!mounted) return;
        setListStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [refresh]);

  const loadShiftGroups = () => {
    setShiftGroupsStatus("loading");
    shiftGroupApiService.list()
      .then((groups) => {
        setShiftGroupCatalog(groups);
        setShiftGroupsStatus("ready");
      })
      .catch(() => setShiftGroupsStatus("error"));
  };

  const ensureCatalogLoaded = () => {
    loadShiftGroups();
    setCatalogStatus("loading");
    Promise.all([orgStructureApiService.getCatalog(), employeeApiService.getAllOptions()])
      .then(([catalog, apiEmployeeOptions]) => {
        setCompanyOptions(catalog.companies.map((item) => item.name));
        setEmployeeOptions(apiEmployeeOptions);
        setCatalogStatus("ready");
      })
      .catch(() => setCatalogStatus("error"));
  };

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
    ensureCatalogLoaded();
  };

  const openEdit = (user: User, focusPassword = false) => {
    setEditingUserId(user.id);
    // `shiftGroupIds` queda sin definir hasta que se toque el selector: así
    // editar otro dato nunca reenvía (ni pisa) los grupos del usuario.
    setDraft({ ...user, password: "", supervisedUserIds: user.supervisedUserIds ?? [], shiftGroupIds: undefined });
    setError(focusPassword ? "Completa la nueva contrasena y guarda los cambios." : "");
    setOpen(true);
    ensureCatalogLoaded();
  };

  const reload = () => {
    setRefresh((value) => value + 1);
  };

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    const email = draft.email.trim().toLowerCase();
    const password = draft.password.trim();

    if (!draft.name.trim()) return setError("Ingresa el nombre y apellido del usuario.");
    if (!email.includes("@")) return setError("Ingresa un email valido.");
    if (users.some((user) => user.email.toLowerCase() === email && user.id !== editingUserId)) {
      return setError("Ya existe un usuario con ese email.");
    }
    if (!editingUserId && password.length < 8) return setError("La contrasena debe tener al menos 8 caracteres.");
    if (editingUserId && password && password.length < 8) return setError("La nueva contrasena debe tener al menos 8 caracteres.");

    if (accessLosses.length) {
      const confirmed = await confirmAction(
        `Al guardar se pierden accesos a turnos:\n${accessLosses.map((line) => `• ${line}`).join("\n")}\n\n¿Querés continuar?`,
        { title: "Confirmar pérdida de accesos", confirmLabel: "Guardar igual", tone: "danger" },
      );
      if (!confirmed) return;
    }

    const payload: UserDraft = {
      ...draft,
      name: draft.name.trim(),
      email,
      password,
      company: draft.company || undefined,
      sector: undefined,
    };

    // La contraseña nunca viaja en el PATCH: en edición sólo se resetea, en
    // un pedido aparte, si se completó.
    try {
      if (editingUserId) await userApiService.update({ ...payload, id: editingUserId });
      else await userApiService.create(payload);
    } catch (saveError) {
      setError(saveError instanceof ApiError && saveError.code === "SHIFT_GROUP_INACTIVE"
        ? "Uno de los grupos de turnos elegidos está inactivo y no se puede asignar. Quitalo de la selección."
        : getUserErrorMessage(saveError, "No se pudo guardar el usuario. Intentá nuevamente."));
      return;
    }
    if (editingUserId && password) {
      try {
        await userApiService.resetPassword(editingUserId, password);
      } catch (passwordError) {
        reload();
        setDraft((current) => ({ ...current, password: "" }));
        setError(`Los datos del usuario se guardaron, pero no se pudo cambiar la contraseña: ${getUserErrorMessage(passwordError, "intentá nuevamente.")}`);
        return;
      }
    }
    reload();
    close();
  });

  const toggleStatus = async (user: User) => {
    const activating = user.status !== "Activo";
    const confirmed = await confirmAction(
      activating
        ? `¿Querés habilitar nuevamente el acceso de ${user.name}?`
        : `¿Querés inactivar el acceso de ${user.name}? No podrá ingresar hasta que vuelvas a activarlo.${user.role === SUPERVISION_ROLE && user.shiftGroups?.length ? ` Sus grupos de turnos (${groupList(user.shiftGroups)}) se conservan pero quedan suspendidos: los responsables de carga que supervisa dejan de heredarlos hasta reactivarlo.` : ""}`,
      {
        title: activating ? "Activar usuario" : "Inactivar usuario",
        confirmLabel: activating ? "Activar" : "Inactivar",
        tone: activating ? "primary" : "danger",
      },
    );
    if (!confirmed) return;
    const next: User = { ...user, password: "", status: user.status === "Activo" ? "Inactivo" : "Activo" };
    try {
      await userApiService.update(next);
      reload();
    } catch (statusError) {
      setError(getUserErrorMessage(statusError, "No pudimos cambiar el estado del usuario. Intentá nuevamente."));
    }
  };

  const { sorted, sort, toggleSort } = useSort(users, sortAccessors);

  const editingUser = editingUserId ? users.find((user) => user.id === editingUserId) : undefined;
  // Responsables de carga elegibles: Nivel 3 activos, más los ya
  // seleccionados aunque estén inactivos (para poder verlos y quitarlos).
  const supervisionOptions = useMemo<UserSupervisionPerson[]>(() => users
    .filter((user) => user.id !== editingUserId && user.role === CARGA_ROLE && (user.status === "Activo" || draft.supervisedUserIds?.includes(user.id)))
    .map((user) => ({ id: user.id, name: user.name, email: user.email, status: user.status }))
    .sort((a, b) => a.name.localeCompare(b.name, "es")), [users, editingUserId, draft.supervisedUserIds]);
  // Empleado vinculado: un legajo sólo puede tener una cuenta. El del usuario
  // que se edita sigue disponible.
  const linkedEmployeeOwner = useMemo(() => new Map(users
    .filter((user) => user.employeeId && user.id !== editingUserId)
    .map((user) => [user.employeeId!, user.name])), [users, editingUserId]);
  // R8: grupos de turnos.
  const storedGroups = editingUser?.role === SUPERVISION_ROLE ? editingUser.shiftGroups ?? [] : [];
  const selectedGroupIds = draft.shiftGroupIds ?? storedGroups.map((group) => group.id);
  const groupOptions = shiftGroupOptions(shiftGroupCatalog, new Set([...selectedGroupIds, ...storedGroups.map((group) => group.id)]), storedGroups);
  const groupsById = new Map<string, UserShiftGroup>([
    ...storedGroups.map((group) => [group.id, group] as const),
    ...shiftGroupCatalog.map((group) => [group.id, { id: group.id, code: group.code, name: group.name, status: group.status === "ACTIVO" ? "Activo" : "Inactivo" } as UserShiftGroup] as const),
  ]);
  const staysSupervisor = draft.role === SUPERVISION_ROLE && editingUser?.role === SUPERVISION_ROLE;
  const losesShiftGroups = editingUser?.role === SUPERVISION_ROLE && draft.role !== SUPERVISION_ROLE && storedGroups.length > 0;
  const removedGroups = staysSupervisor ? storedGroups.filter((group) => !selectedGroupIds.includes(group.id)) : [];
  const keptGroups = staysSupervisor ? selectedGroupIds.map((id) => groupsById.get(id)).filter((group): group is UserShiftGroup => Boolean(group) && storedGroups.some((stored) => stored.id === group!.id)) : [];
  const removedSupervised = staysSupervisor ? (editingUser!.supervisedUsers ?? []).filter((person) => !(draft.supervisedUserIds ?? []).includes(person.id)) : [];
  const suspendsShiftGroups = staysSupervisor && editingUser!.status === "Activo" && draft.status === "Inactivo" && storedGroups.length > 0;
  const inheritedLoss = editingUser && editingUser.role === SUPERVISION_ROLE
    ? inheritedLosses(users, editingUser.id, [
        // Quien deja de ser supervisado pierde lo que sólo heredaba de este Nivel 2…
        ...removedSupervised.map((person) => ({ personId: person.id, groups: keptGroups })),
        // …y los supervisados pierden los grupos que se quitan (o todos, si deja de ser Nivel 2 o se inactiva).
        ...(editingUser.supervisedUsers ?? []).map((person) => ({
          personId: person.id,
          groups: losesShiftGroups || suspendsShiftGroups ? storedGroups : removedGroups,
        })),
      ])
    : [];
  const accessLosses = [
    ...(losesShiftGroups ? [`${editingUser!.name} pierde sus grupos de turnos (${groupList(storedGroups)}) al dejar de ser Nivel 2.`] : []),
    ...(removedGroups.length ? [`${editingUser!.name} deja de administrar ${groupList(removedGroups)}.`] : []),
    ...(suspendsShiftGroups ? [`Mientras esté inactivo, sus grupos de turnos (${groupList(storedGroups)}) quedan suspendidos.`] : []),
    ...inheritedLoss.map((loss) => `${loss.person} deja de heredar ${groupList(loss.groups)}.`),
  ];

  const losesSupervised = editingUser?.role === SUPERVISION_ROLE && draft.role !== SUPERVISION_ROLE && (editingUser.supervisedUsers?.length ?? 0) > 0;
  const losesSupervisors = editingUser?.role === CARGA_ROLE && draft.role !== CARGA_ROLE && (editingUser.supervisorUsers?.length ?? 0) > 0;

  if (roleLevel(currentUser!.role) !== 1) return <Navigate to="/" />;

  return <>
    <PageHeader
      eyebrow="SEGURIDAD Y ACCESOS"
      title="Usuarios y roles"
      description="Administra usuarios reales de acceso, roles y su empresa administrativa. Los permisos se resuelven por responsable de carga."
      action={<Button variant="primary" icon={Plus} onClick={openCreate}>Crear usuario</Button>}
    />

    <Section title="Usuarios habilitados" subtitle={`${users.length} perfiles configurados`}>
      <DataTable
        status={listStatus === "loading" ? "loading" : listStatus === "error" ? "error" : users.length === 0 ? "empty" : "ready"}
        minWidth={1020}
        emptyText="Todavía no hay usuarios configurados."
        errorMessage="No se pudieron cargar los usuarios."
        onRetry={() => setRefresh((value) => value + 1)}
      >
        <table>
          <thead>
            <tr>
              <SortableHeader label="Nombre" sortKey="name" sort={sort} onSort={toggleSort} />
              <SortableHeader label="Email" sortKey="email" sort={sort} onSort={toggleSort} />
              <SortableHeader label="Rol" sortKey="role" sort={sort} onSort={toggleSort} />
              <SortableHeader label="Estado" sortKey="status" sort={sort} onSort={toggleSort} />
              <SortableHeader label="Empresa administrativa" sortKey="scope" sort={sort} onSort={toggleSort} />
              <SortableHeader label="Empleado vinculado" sortKey="employee" sort={sort} onSort={toggleSort} />
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((user) => (
              <tr key={user.id}>
                <td><b>{user.name}</b></td>
                <td>{user.email}</td>
                <td><OverflowCell value={user.role} /></td>
                <td><Badge tone={statusTone(user.status)}>{user.status}</Badge></td>
                <td><OverflowCell value={user.company || "Sin empresa"} /></td>
                <td><OverflowCell value={user.employeeName || "-"} /></td>
                <td>
                  <div className="table-actions">
                    <button className="table-icon-action" title="Editar usuario" onClick={() => openEdit(user)}><Pencil size={15} /></button>
                    <button className="table-icon-action" title="Resetear contrasena" onClick={() => openEdit(user, true)}><KeyRound size={15} /></button>
                    <button className="table-icon-action" title={user.status === "Activo" ? "Inactivar usuario" : "Activar usuario"} onClick={() => toggleStatus(user)}><Power size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
    </Section>

    {open && (
      <Modal title={editingUserId ? "Editar usuario" : "Crear usuario"} close={close}>
        <div className="form-stack user-form">
          <div className="info-note compact">
            <b>{editingUserId ? "Edicion de usuario" : "Alta de usuario"}</b>
            <p>
              {editingUserId
                ? "Podes actualizar datos, rol, empresa administrativa y estado. Si completas contrasena, se resetea el acceso."
                : "Este usuario podra ingresar con el email y contrasena definidos. El rol determina permisos y visibilidad."}
            </p>
          </div>

          <Field label="Nombre y apellido *" value={draft.name} set={(name) => setDraft({ ...draft, name })} />
          <Field label="Email de acceso *" type="email" value={draft.email} set={(email) => setDraft({ ...draft, email })} />
          <Field label={editingUserId ? "Nueva contrasena (opcional)" : "Contrasena inicial *"} type="password" value={draft.password} set={(password) => setDraft({ ...draft, password })} />
          <Select label="Rol *" value={draft.role} set={(role) => setDraft({ ...draft, role: role as Role })} options={userRoleOptions(draft.role)} />
          <Select label="Estado" value={draft.status} set={(status) => setDraft({ ...draft, status: status as User["status"] })} options={["Activo", "Inactivo"]} />
          <Select label="Empresa administrativa" value={draft.company || ""} set={(company) => setDraft({ ...draft, company })} options={companyOptions} disabled={catalogStatus === "loading"} />
          {catalogStatus === "loading" ? <p className="muted small user-form-wide">Cargando opciones de empresa y empleados...</p> : null}
          {catalogStatus === "error" ? <p className="muted small user-form-wide">No pudimos cargar empresa/empleados. Podés guardar igual sin esos datos, o cerrar y volver a intentar.</p> : null}
          {draft.role === SUPERVISION_ROLE ? (
            <SupervisedUsersSelector
              options={supervisionOptions}
              selectedIds={draft.supervisedUserIds ?? []}
              onChange={(supervisedUserIds) => setDraft({ ...draft, supervisedUserIds })}
              disabled={isSaving}
            />
          ) : null}
          {draft.role === SUPERVISION_ROLE ? (
            <ShiftGroupsSelector
              options={groupOptions}
              selectedIds={selectedGroupIds}
              onChange={(shiftGroupIds) => setDraft({ ...draft, shiftGroupIds })}
              disabled={isSaving}
              status={shiftGroupsStatus}
              onRetry={loadShiftGroups}
            />
          ) : null}
          {draft.role === CARGA_ROLE ? (
            <InheritedShiftGroupsPanel
              inherited={editingUser?.role === CARGA_ROLE ? editingUser.inheritedShiftGroups ?? [] : []}
              supervisors={editingUser?.role === CARGA_ROLE ? editingUser.supervisorUsers ?? [] : []}
              stored={editingUser?.role === CARGA_ROLE}
            />
          ) : null}
          {draft.role === RRHH_ROLE ? (
            <p className="muted small user-form-wide">Nivel 1 - RRHH administra todos los grupos de turnos: no necesita asignaciones.</p>
          ) : null}
          {accessLosses.length ? (
            <div className="info-note compact user-access-loss" role="note">
              <b>Al guardar, se pierden accesos a turnos</b>
              <ul>{accessLosses.map((line) => <li key={line}>{line}</li>)}</ul>
            </div>
          ) : null}
          {losesSupervised ? (
            <div className="info-note compact" role="note">
              <b>Al guardar, dejará de supervisar responsables de carga</b>
              <p>Con el rol {draft.role} se quitan sus responsables supervisados ({peopleList(editingUser!.supervisedUsers!)}), que dejan de heredar los legajos asignados a este usuario.</p>
            </div>
          ) : null}
          {losesSupervisors ? (
            <div className="info-note compact" role="note">
              <b>Al guardar, dejará de ser responsable de carga supervisado</b>
              <p>Dejará de heredar los legajos asignados a {peopleList(editingUser!.supervisorUsers!)}.</p>
            </div>
          ) : null}
          <label className="user-form-wide">
            Empleado vinculado
            <select
              value={draft.employeeId || ""}
              disabled={catalogStatus === "loading"}
              onChange={(event) => {
                const employee = employeeOptions.find((item) => item.id === event.target.value);
                setDraft({
                  ...draft,
                  employeeId: event.target.value,
                  employeeName: employee ? `${employee.firstName} ${employee.lastName}` : "",
                });
              }}
            >
              <option value="">Sin empleado vinculado</option>
              {employeeOptions.map((employee) => {
                const owner = linkedEmployeeOwner.get(employee.id);
                return (
                  <option key={employee.id} value={employee.id} disabled={Boolean(owner)}>
                    {employee.lastName}, {employee.firstName} - Legajo {displayLegajo(employee)}{owner ? ` (ya vinculado a ${owner})` : ""}
                  </option>
                );
              })}
            </select>
            <small className="field-hint">Identifica a qué persona corresponde la cuenta. No define a qué legajos accede.</small>
          </label>

          {error && <p className="error">{error}</p>}

          <div className="form-actions">
            <Button variant="subtle" onClick={close}>Cancelar</Button>
            <Button variant="primary" onClick={save} disabled={isSaving}>{isSaving ? "Guardando..." : editingUserId ? "Guardar cambios" : "Guardar usuario"}</Button>
          </div>
        </div>
      </Modal>
    )}
  </>;
}
