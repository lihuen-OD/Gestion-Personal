import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { Navigate } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { LoadingState } from "../components/ui/LoadingState";
import { EmptyState } from "../components/ui/EmptyState";
import { TableShell } from "../components/ui/TableShell";
import { workforceApiService, type DoubleHourRule } from "../services/api/workforceApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { positionApiService } from "../services/api/positionApiService";
import type { OrgStructureCatalog } from "../types/orgStructure.types";
import type { Position } from "../types/position.types";
import type { Employee } from "../types";
import { confirmAction } from "../services/appDialog";
import { EmployeeRemoteSelector } from "../components/employees/EmployeeRemoteSelector";
import { SpecialHourRulesCalendarMonth } from "../components/workforce/SpecialHourRulesCalendarMonth";
import { useAuth } from "../context/AuthContext";
import { roleLevel } from "../utils/roles";
import { DOUBLE_HOUR_MULTIPLIER_MAX, DOUBLE_HOUR_MULTIPLIER_MIN, doubleHourMultiplierError } from "../utils/doubleHourRule";

const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const RECURRENCE_LABELS: Record<RuleFormState["recurrenceType"], string> = {
  SEMANAL: "Días de semana",
  FECHA: "Fechas específicas",
  RANGO: "Rango de fechas",
};

type RuleFormState = {
  name: string;
  recurrenceType: "FECHA" | "RANGO" | "SEMANAL";
  fromDate: string;
  toDate: string;
  weekdays: number[];
  multiplier: number;
  priority: number;
  companyId: string;
  sectorId: string;
  costCenterId: string;
  positionId: string;
  dates: Array<{ date: string; isActive: boolean }>;
  reason: string;
};

const emptyRuleForm: RuleFormState = {
  name: "",
  recurrenceType: "SEMANAL",
  fromDate: "",
  toDate: "",
  weekdays: [],
  multiplier: 2,
  priority: 0,
  companyId: "",
  sectorId: "",
  costCenterId: "",
  positionId: "",
  dates: [],
  reason: "",
};

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

// Resumen legible del alcance de una regla ya guardada, para la tabla —
// "General" sólo cuando ninguna dimensión (empresa/sector/centro de
// costo/puesto/empleados específicos) está configurada.
function scopeLabel(item: DoubleHourRule) {
  const parts = [item.company?.name, item.sector?.name, item.costCenter?.name, item.position?.name].filter(Boolean);
  if (item.employees.length) parts.push(`${item.employees.length} persona(s)`);
  return parts.length ? parts.join(" · ") : "General (todos los que trabajen)";
}

export function WorkScheduleSettingsPage() {
  const { user } = useAuth();
  const [rules, setRules] = useState<DoubleHourRule[]>([]);
  const [catalog, setCatalog] = useState<OrgStructureCatalog | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedRuleEmployees, setSelectedRuleEmployees] = useState<Employee[]>([]);
  const [limitToEmployees, setLimitToEmployees] = useState(false);
  // Separados a propósito: cada uno se muestra pegado a la sección que
  // corresponde (formulario / listado / carga general de la pantalla) en
  // vez de un único mensaje de error suelto arriba de toda la página.
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [tableError, setTableError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [editingRuleId, setEditingRuleId] = useState<string>();
  const [rule, setRule] = useState<RuleFormState>(emptyRuleForm);
  const [newDateInput, setNewDateInput] = useState("");
  // El calendario visual (SpecialHourRulesCalendarMonth) tiene su propio fetch,
  // desacoplado de `rules` — nada lo avisaba cuando una regla se creaba/editaba/
  // activaba/borraba, así que quedaba con datos del último mes cargado. Este
  // contador es la única señal que recibe: cada mutación exitosa lo incrementa,
  // el calendario lo mira en su propio efecto y refetchea el mes visible.
  const [calendarRefreshToken, setCalendarRefreshToken] = useState(0);
  const notifyRulesMutated = () => setCalendarRefreshToken((token) => token + 1);

  const load = async () => {
    // Etapa 9B: sólo mostrar el loading grande de la tabla de reglas cuando
    // todavía no hay reglas en pantalla — crear/editar/activar/eliminar una
    // regla vuelve a llamar load() y no debe blanquear la tabla ya poblada
    // (mismo patrón de EmployeesPage; el calendario ya tenía su propio
    // refresh silencioso desde la Etapa 8B, no se toca acá).
    if (!rules.length) setIsLoading(true);
    try {
      const [items, orgCatalog, positionList] = await Promise.all([
        workforceApiService.doubleHourRules(),
        orgStructureApiService.getCatalog(),
        positionApiService.getAll({ status: "ACTIVO" }),
      ]);
      setRules(items);
      setCatalog(orgCatalog);
      setPositions(positionList);
      setLoadError("");
    } catch {
      setLoadError("No se pudo cargar la información de esta pantalla. Recargá la página o intentá nuevamente en unos minutos.");
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const resetRule = () => {
    setEditingRuleId(undefined);
    setRule(emptyRuleForm);
    setSelectedRuleEmployees([]);
    setLimitToEmployees(false);
    setNewDateInput("");
  };

  const addDate = () => {
    if (!newDateInput || rule.dates.some((entry) => entry.date === newDateInput)) {
      setNewDateInput("");
      return;
    }
    setRule((current) => ({ ...current, dates: [...current.dates, { date: newDateInput, isActive: true }].sort((a, b) => a.date.localeCompare(b.date)) }));
    setNewDateInput("");
  };
  const toggleDateActive = (date: string) => {
    setRule((current) => ({ ...current, dates: current.dates.map((entry) => (entry.date === date ? { ...entry, isActive: !entry.isActive } : entry)) }));
  };
  const removeDate = (date: string) => {
    setRule((current) => ({ ...current, dates: current.dates.filter((entry) => entry.date !== date) }));
  };

  const applyWholeCurrentYear = () => {
    const year = new Date().getFullYear();
    setRule((current) => ({ ...current, fromDate: `${year}-01-01`, toDate: `${year}-12-31` }));
  };
  const applyFromToday = () => {
    setRule((current) => ({ ...current, fromDate: todayDateInput(), toDate: "" }));
  };

  const submitRule = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    setNotice("");
    const multiplierError = doubleHourMultiplierError(rule.multiplier);
    if (multiplierError) {
      setFormError(multiplierError);
      return;
    }
    if (limitToEmployees && !selectedRuleEmployees.length) {
      setFormError("Seleccioná al menos un empleado o desactivá la opción de empleados específicos.");
      return;
    }
    if (rule.recurrenceType === "FECHA" && !rule.dates.length) {
      setFormError("Agregá al menos una fecha para guardar esta regla.");
      return;
    }
    if (rule.recurrenceType !== "FECHA" && !rule.fromDate) {
      setFormError("Indicá la fecha desde la que aplica la regla.");
      return;
    }

    setWorking(true);
    try {
      const payload = {
        name: rule.name,
        recurrenceType: rule.recurrenceType,
        // Para "Fechas específicas" estos dos valores son sólo un respaldo:
        // el sistema recalcula la vigencia real a partir de las fechas
        // cargadas abajo.
        fromDate: rule.recurrenceType === "FECHA" ? rule.dates[0]!.date : rule.fromDate,
        toDate: rule.recurrenceType === "FECHA" ? null : rule.toDate || null,
        weekdays: rule.weekdays,
        multiplier: rule.multiplier,
        priority: rule.priority,
        companyId: rule.companyId || null,
        sectorId: rule.sectorId || null,
        costCenterId: rule.costCenterId || null,
        positionId: rule.positionId || null,
        dates: rule.recurrenceType === "FECHA" ? rule.dates : undefined,
        employeeIds: limitToEmployees ? selectedRuleEmployees.map((employee) => employee.id) : [],
        reason: rule.reason,
      };
      if (editingRuleId) await workforceApiService.updateDoubleHourRule(editingRuleId, payload);
      else await workforceApiService.createDoubleHourRule(payload);
      setNotice(editingRuleId ? "Regla actualizada correctamente." : "Regla creada correctamente.");
      resetRule();
      await load();
      notifyRulesMutated();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "No se pudo guardar la regla. Revisá los datos e intentá nuevamente.");
    } finally {
      setWorking(false);
    }
  };

  const editRule = (item: DoubleHourRule) => {
    setEditingRuleId(item.id);
    setRule({
      name: item.name,
      recurrenceType: item.recurrenceType,
      fromDate: item.fromDate.slice(0, 10),
      toDate: item.toDate?.slice(0, 10) || "",
      weekdays: item.weekdays,
      multiplier: Number(item.multiplier),
      priority: item.priority,
      companyId: item.companyId || "",
      sectorId: item.sectorId || "",
      costCenterId: item.costCenterId || "",
      positionId: item.positionId || "",
      dates: item.dates.map((entry) => ({ date: entry.date.slice(0, 10), isActive: entry.isActive })),
      reason: item.reason,
    });
    setSelectedRuleEmployees(item.employees.map(({ employee }) => employee as Employee));
    setLimitToEmployees(item.employees.length > 0);
    setFormError("");
    document.getElementById("double-hour-rule-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toggleRule = async (item: DoubleHourRule) => {
    const activating = item.status !== "ACTIVO";
    if (!(await confirmAction(`¿Querés ${activating ? "activar" : "inactivar"} la regla "${item.name}"?`, { title: `${activating ? "Activar" : "Inactivar"} regla`, confirmLabel: activating ? "Activar" : "Inactivar", tone: activating ? "primary" : "danger" }))) return;
    setWorking(true);
    setTableError("");
    setNotice("");
    try {
      await workforceApiService.updateDoubleHourRule(item.id, { status: activating ? "ACTIVO" : "INACTIVO" });
      setNotice(`Regla ${activating ? "activada" : "inactivada"} correctamente.`);
      await load();
      notifyRulesMutated();
    } catch (reason) {
      setTableError(reason instanceof Error ? reason.message : "No se pudo cambiar el estado de la regla. Intentá nuevamente.");
    } finally {
      setWorking(false);
    }
  };

  const removeRule = async (item: DoubleHourRule) => {
    if (!(await confirmAction(`Si la regla "${item.name}" ya comenzó, quedará inactiva para conservar la trazabilidad. Si todavía es futura, se eliminará.`, { title: "Eliminar regla", confirmLabel: "Continuar", tone: "danger" }))) return;
    setWorking(true);
    setTableError("");
    setNotice("");
    try {
      const result = await workforceApiService.removeDoubleHourRule(item.id);
      setNotice(result.mode === "DELETED" ? "Regla eliminada correctamente." : "La regla ya había comenzado y quedó inactiva para preservar los cálculos históricos.");
      if (editingRuleId === item.id) resetRule();
      await load();
      notifyRulesMutated();
    } catch (reason) {
      setTableError(reason instanceof Error ? reason.message : "No se pudo eliminar la regla. Intentá nuevamente.");
    } finally {
      setWorking(false);
    }
  };

  if (roleLevel(user!.role) !== 1) return <Navigate to="/" />;

  return (
    <>
      <PageHeader eyebrow="CONFIGURACIÓN" title="Horas especiales" description="Configurá reglas como domingos, feriados o casos especiales para calcular el valor liquidable de las horas registradas." />
      {loadError ? (
        <div className="rule-form-alert-error" role="alert">
          <AlertTriangle size={16} />
          <span>{loadError}</span>
        </div>
      ) : null}
      {notice ? <div className="info-note">{notice}</div> : null}

      <Section className="schedule-settings-section" title={editingRuleId ? "Editar regla" : "Nueva regla"} subtitle="Definí cuándo aplica, a quién alcanza y cómo se calcula.">
        <form id="double-hour-rule-form" className="special-rule-form" onSubmit={submitRule}>
          <div className="rule-form-section">
            <div className="rule-form-section-head">
              <h4>Datos principales</h4>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Nombre de la regla</span>
                <input required value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} placeholder="Ej: Domingo, Feriado" />
              </label>
              <label className="field">
                <span>Multiplicador</span>
                <input required type="number" min={DOUBLE_HOUR_MULTIPLIER_MIN} max={DOUBLE_HOUR_MULTIPLIER_MAX} step="0.01" value={rule.multiplier} onChange={(e) => setRule({ ...rule, multiplier: e.target.valueAsNumber })} />
              </label>
              <label className="field">
                <span>Prioridad</span>
                <input required type="number" min={0} max={1000} step="1" value={rule.priority} onChange={(e) => setRule({ ...rule, priority: e.target.valueAsNumber })} />
                <small>Si dos reglas se superponen en la misma fecha, se aplica la de mayor prioridad.</small>
              </label>
              <label className="field field-wide">
                <span>Motivo o descripción</span>
                <input required value={rule.reason} onChange={(e) => setRule({ ...rule, reason: e.target.value })} placeholder="Ej: Los domingos trabajados valen doble" />
              </label>
            </div>
          </div>

          <div className="rule-form-section">
            <div className="rule-form-section-head">
              <h4>Calendario</h4>
              <p>Definí cuándo se aplica esta regla.</p>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Tipo de calendario</span>
                <select value={rule.recurrenceType} onChange={(e) => setRule({ ...rule, recurrenceType: e.target.value as RuleFormState["recurrenceType"] })}>
                  <option value="SEMANAL">Días de semana (ej: todos los domingos)</option>
                  <option value="FECHA">Fechas específicas o feriados</option>
                  <option value="RANGO">Rango de fechas</option>
                </select>
              </label>
              {rule.recurrenceType !== "FECHA" ? (
                <>
                  <label className="field">
                    <span>Desde</span>
                    <input required type="date" value={rule.fromDate} onChange={(e) => setRule({ ...rule, fromDate: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Hasta</span>
                    <input type="date" value={rule.toDate} onChange={(e) => setRule({ ...rule, toDate: e.target.value })} />
                  </label>
                </>
              ) : null}
            </div>

            {rule.recurrenceType === "SEMANAL" ? (
              <div className="rule-preset-actions">
                <Button type="button" variant="subtle" onClick={applyWholeCurrentYear}>Todo el año actual</Button>
                <Button type="button" variant="subtle" onClick={applyFromToday}>Desde hoy en adelante</Button>
              </div>
            ) : null}

            {rule.recurrenceType === "SEMANAL" ? (
              <div className="weekday-picker">
                {WEEKDAY_LABELS.map((day, index) => (
                  <label key={day}>
                    <input
                      type="checkbox"
                      checked={rule.weekdays.includes(index)}
                      onChange={(e) => setRule({ ...rule, weekdays: e.target.checked ? [...rule.weekdays, index] : rule.weekdays.filter((value) => value !== index) })}
                    />
                    {day}
                  </label>
                ))}
              </div>
            ) : null}

            {rule.recurrenceType === "FECHA" ? (
              <div className="special-dates-editor">
                <span className="special-dates-editor-label">Fechas alcanzadas (feriados, fechas puntuales)</span>
                <div className="special-dates-editor-add">
                  <input type="date" aria-label="Nueva fecha" value={newDateInput} onChange={(e) => setNewDateInput(e.target.value)} />
                  <Button type="button" variant="subtle" icon={Plus} onClick={addDate}>Agregar fecha</Button>
                </div>
                {rule.dates.length ? (
                  <ul className="special-dates-editor-list">
                    {rule.dates.map((entry) => (
                      <li key={entry.date} className={entry.isActive ? "" : "is-inactive"}>
                        <span>{new Date(`${entry.date}T00:00:00Z`).toLocaleDateString("es-AR", { timeZone: "UTC" })}</span>
                        <button type="button" className="table-icon-action" onClick={() => toggleDateActive(entry.date)}>
                          <Power size={14} />
                          {entry.isActive ? "Desactivar" : "Activar"}
                        </button>
                        <button type="button" className="table-icon-action danger-link" onClick={() => removeDate(entry.date)}>
                          <Trash2 size={14} />
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <small>Todavía no agregaste ninguna fecha.</small>
                )}
              </div>
            ) : null}
          </div>

          <div className="rule-form-section">
            <div className="rule-form-section-head">
              <h4>Alcance</h4>
              <p>A quién alcanza esta regla.</p>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Empresa</span>
                <select value={rule.companyId} onChange={(e) => setRule({ ...rule, companyId: e.target.value })}>
                  <option value="">Todas</option>
                  {catalog?.companies.filter((company) => company.status === "ACTIVO").map((company) => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Sector</span>
                <select value={rule.sectorId} onChange={(e) => setRule({ ...rule, sectorId: e.target.value })}>
                  <option value="">Todos</option>
                  {catalog?.sectors.filter((sector) => sector.status === "ACTIVO").map((sector) => (
                    <option key={sector.id} value={sector.id}>{sector.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Centro de costo</span>
                <select value={rule.costCenterId} onChange={(e) => setRule({ ...rule, costCenterId: e.target.value })}>
                  <option value="">Todos</option>
                  {catalog?.costCenters.filter((costCenter) => costCenter.status === "ACTIVO").map((costCenter) => (
                    <option key={costCenter.id} value={costCenter.id}>{costCenter.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Puesto</span>
                <select value={rule.positionId} onChange={(e) => setRule({ ...rule, positionId: e.target.value })}>
                  <option value="">Todos</option>
                  {positions.filter((position) => position.status === "ACTIVO").map((position) => (
                    <option key={position.id} value={position.id}>{position.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="rule-scope-employees-toggle">
              <input type="checkbox" checked={limitToEmployees} onChange={(e) => setLimitToEmployees(e.target.checked)} />
              Limitar a empleados específicos
            </label>
            {limitToEmployees ? (
              <div className="rule-people-field">
                <span>Personas alcanzadas</span>
                <EmployeeRemoteSelector selected={selectedRuleEmployees} multiple showStatusFilter wide={false} onChange={setSelectedRuleEmployees} />
              </div>
            ) : null}
            <small className="rule-scope-help">Si no seleccionás empleados, la regla aplica a todos los empleados dentro del alcance configurado que efectivamente registren horas en esas fechas.</small>
          </div>

          {formError ? (
            <div className="rule-form-alert-error" role="alert">
              <AlertTriangle size={16} />
              <span>{formError}</span>
            </div>
          ) : null}

          <div className="rule-form-actions">
            <Button variant="primary" icon={editingRuleId ? Pencil : Plus} disabled={working}>{editingRuleId ? "Guardar cambios" : "Crear regla"}</Button>
            {editingRuleId ? <Button type="button" variant="subtle" icon={X} onClick={resetRule}>Cancelar edición</Button> : null}
          </div>
        </form>
      </Section>

      <Section className="schedule-settings-section" title="Reglas configuradas" subtitle="Reglas creadas hasta el momento y su estado actual.">
        {tableError ? (
          <div className="rule-form-alert-error" role="alert">
            <AlertTriangle size={16} />
            <span>{tableError}</span>
          </div>
        ) : null}
        {isLoading ? (
          <LoadingState text="Cargando reglas de horas especiales..." />
        ) : (
          <>
            <TableShell minWidth={1320}>
              <table>
                <thead>
                  <tr>
                    <th>Regla</th>
                    <th>Calendario</th>
                    <th>Período</th>
                    <th>Multiplicador</th>
                    <th>Prioridad</th>
                    <th>Alcance</th>
                    <th>Motivo</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((item) => (
                    <tr key={item.id}>
                      <td><b>{item.name}</b></td>
                      <td>{RECURRENCE_LABELS[item.recurrenceType]}</td>
                      <td>{new Date(item.fromDate).toLocaleDateString("es-AR")}{item.toDate ? ` – ${new Date(item.toDate).toLocaleDateString("es-AR")}` : ""}</td>
                      <td>x{Number(item.multiplier)}</td>
                      <td>{item.priority}</td>
                      <td>{scopeLabel(item)}</td>
                      <td>{item.reason}</td>
                      <td><Badge tone={item.status === "ACTIVO" ? "success" : "neutral"}>{item.status === "ACTIVO" ? "Activa" : "Inactiva"}</Badge></td>
                      <td>
                        <div className="table-actions">
                          <button type="button" className="table-icon-action" disabled={working} title="Editar regla" aria-label={`Editar ${item.name}`} onClick={() => editRule(item)}>
                            <Pencil /><span>Editar</span>
                          </button>
                          <button type="button" className="table-icon-action" disabled={working} title={item.status === "ACTIVO" ? "Inactivar regla" : "Activar regla"} aria-label={`${item.status === "ACTIVO" ? "Inactivar" : "Activar"} ${item.name}`} onClick={() => void toggleRule(item)}>
                            <Power /><span>{item.status === "ACTIVO" ? "Inactivar" : "Activar"}</span>
                          </button>
                          <button type="button" className="table-icon-action danger-link" disabled={working} title="Eliminar regla" aria-label={`Eliminar ${item.name}`} onClick={() => void removeRule(item)}>
                            <Trash2 /><span>Eliminar</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
            {!rules.length ? <EmptyState text="Todavía no hay reglas de horas especiales." /> : null}
          </>
        )}
      </Section>

      <Section className="schedule-settings-section" title="Calendario de reglas" subtitle="Visualizá qué reglas aplican cada día y detectá superposiciones.">
        <SpecialHourRulesCalendarMonth refreshToken={calendarRefreshToken} />
      </Section>
    </>
  );
}
