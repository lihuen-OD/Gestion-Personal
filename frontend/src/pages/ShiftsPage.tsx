import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { ShiftTable, type ShiftAssignmentCounts } from "../components/shifts/ShiftTable";
import { useAuth } from "../context/AuthContext";
import { workforceApiService, type ShiftTemplate } from "../services/api/workforceApiService";
import { shiftAssignmentApiService } from "../services/api/shiftAssignmentApiService";
import { confirmAction } from "../services/appDialog";
import { roleLevel } from "../utils/roles";

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function ShiftsPage() {
  const { user } = useAuth();
  const canEdit = roleLevel(user!.role) === 1;
  const [templates, setTemplates] = useState<ShiftTemplate[] | null>(null);
  const [counts, setCounts] = useState<Record<string, ShiftAssignmentCounts>>({});
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let alive = true;
    setLoadStatus("loading");
    Promise.all([workforceApiService.shiftTemplates(), shiftAssignmentApiService.getAll()])
      .then(([shiftTemplates, assignments]) => {
        if (!alive) return;
        const nextCounts: Record<string, ShiftAssignmentCounts> = {};
        for (const assignment of assignments) {
          const bucket = nextCounts[assignment.shiftTemplateId] || { enabled: 0, disabled: 0 };
          if (assignment.status === "HABILITADO") bucket.enabled += 1;
          else bucket.disabled += 1;
          nextCounts[assignment.shiftTemplateId] = bucket;
        }
        setTemplates(shiftTemplates);
        setCounts(nextCounts);
        setLoadStatus("success");
      })
      .catch(() => {
        if (alive) setLoadStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [refresh]);

  const items = useMemo(() => {
    const all = templates || [];
    const term = normalize(search);
    return all.filter((item) => {
      if (status && item.status !== status) return false;
      if (!term) return true;
      const text = normalize(`${item.code} ${item.name} ${item.categoryName || ""}`);
      return text.includes(term);
    });
  }, [templates, search, status]);

  const toggle = async (item: ShiftTemplate) => {
    const activating = item.status !== "ACTIVO";
    if (!(await confirmAction(`¿Querés ${activating ? "activar" : "inactivar"} el turno "${item.name}"?`, { title: `${activating ? "Activar" : "Inactivar"} turno`, confirmLabel: activating ? "Activar" : "Inactivar", tone: activating ? "primary" : "danger" }))) return;
    await workforceApiService.updateShiftTemplate(item.id, { status: activating ? "ACTIVO" : "INACTIVO" });
    setRefresh((value) => value + 1);
  };

  return (
    <>
      <PageHeader
        eyebrow="CONFIGURACIÓN"
        title="Turnos"
        description="Horarios de referencia por turno, tolerancias, reglas de control y empleados asociados."
        action={canEdit ? <Link to="/configuracion/turnos/nuevo" className="button primary"><Plus size={17} /> Crear turno</Link> : undefined}
      />
      <Section title="Listado de turnos" subtitle={loadStatus === "loading" ? "Cargando turnos..." : `${items.length} turno(s) según filtros aplicados.`}>
        <div className="position-filters catalog-filters">
          <div className="position-filter-title"><Search size={16} /><b>Filtros</b></div>
          <label>Buscar<input value={search} placeholder="Código, nombre o categoría" onChange={(e) => setSearch(e.target.value)} /></label>
          <label>Estado<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option><option value="ACTIVO">Activo</option><option value="INACTIVO">Inactivo</option></select></label>
        </div>
        {loadStatus === "loading" ? <LoadingState text="Cargando turnos..." /> : loadStatus === "error" ? <ErrorState message="No pudimos cargar los turnos." onRetry={() => setRefresh((value) => value + 1)} /> : <ShiftTable items={items} counts={counts} canEdit={canEdit} onToggleStatus={toggle} />}
      </Section>
    </>
  );
}
