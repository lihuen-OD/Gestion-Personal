import { useEffect, useState } from "react";
import { CheckCheck, Plus } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { noveltyApiService } from "../services/api/noveltyApiService";
import type { Employee, Novelty } from "../types";
import { NoveltyModal } from "../components/novelties/NoveltyModal";
import { NoveltyTable } from "../components/novelties/NoveltyTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { Pagination } from "../components/ui/Pagination";
import { FilterPanel } from "../components/ui/FilterPanel";
import { LoadingState } from "../components/ui/LoadingState";
import { useDebouncedValue } from "../utils/useDebouncedValue";
import { roleLevel } from "../utils/roles";
import { currentMonthPeriod, formatPeriodLabel } from "../utils/period";

const pageSize = 25;

// Etapa 15M.15: mismo criterio de pluralización ya usado localmente en
// ShiftAlertsPage.tsx (countLabel) — no existe un helper compartido para
// esto, y una sola función de 3 líneas por pantalla no justifica crear uno.
function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function NoveltiesPage() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  // Etapa 15M.15: filtro principal por período, mismo patrón que
  // FinnegansExportPage.tsx (input type="month" + currentMonthPeriod()).
  const [period, setPeriod] = useState(currentMonthPeriod);
  const employees: Employee[] = [];
  const [novelties, setNovelties] = useState<Novelty[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageSize, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [bulkApproving, setBulkApproving] = useState(false);
  const pendingVisible = novelties.filter((item) => item.status === "Pendiente");
  const periodLabel = formatPeriodLabel(period);

  useEffect(() => {
    let mounted = true;
    // Etapa 9B: sólo mostrar el skeleton de carga completo cuando todavía no
    // hay datos en pantalla — un refetch por filtro/página/mutación con la
    // tabla ya poblada no debe blanquearla, se reemplaza recién cuando llega
    // la respuesta nueva (mismo patrón ya usado en EmployeesPage).
    if (!novelties.length) setLoading(true);
    setLoadError("");
    noveltyApiService
      .list({ page, take: pageSize, search: debouncedSearch, period })
      .then((result) => {
        if (!mounted) return;
        setNovelties(result.items);
        setMeta(result.meta);
      })
      .catch(() => {
        if (mounted) {
          setNovelties([]);
          setMeta({ total: 0, page, pageSize, hasMore: false });
          setLoadError("No pudimos cargar las novedades. Intentá nuevamente.");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [debouncedSearch, page, period, refresh, user]);

  const openCreate = () => {
    setLoadError("");
    setOpen(true);
  };

  return (
    <>
      <PageHeader
        eyebrow="AUSENTISMO Y NOVEDADES"
        title="Novedades"
        description="Registro centralizado de ausencias, licencias y novedades horarias."
        action={
          <Button variant="primary" icon={Plus} onClick={openCreate}>
            Nueva novedad
          </Button>
        }
      />

      {loadError ? <div className="form-error">{loadError}</div> : null}

      <Section
        title="Novedades registradas"
        subtitle={`${countLabel(meta.total, "novedad", "novedades")} en ${periodLabel} según tu perfil`}
      >
        {roleLevel(user!.role) === 1 && pendingVisible.length ? <div className="bulk-toolbar"><span>{pendingVisible.length} novedades pendientes en esta vista</span><Button variant="primary" icon={CheckCheck} loading={bulkApproving} onClick={async () => { setBulkApproving(true); setLoadError(""); try { const updated = await noveltyApiService.approveMany(pendingVisible.map((item) => item.id)); const byId = new Map(updated.map((item) => [item.id, item])); setNovelties((current) => current.map((item) => byId.get(item.id) || item)); } catch { setLoadError("No se pudieron aprobar las novedades en lote."); } finally { setBulkApproving(false); } }}>Aprobar pendientes visibles</Button></div> : null}
        <FilterPanel
          search={{
            placeholder: "Buscar por legajo, DNI, empleado o tipo de novedad",
            value: search,
            onChange: (value) => {
              setSearch(value);
              setPage(1);
            },
          }}
        >
          <label>
            Período
            <input
              type="month"
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value);
                setPage(1);
              }}
            />
          </label>
        </FilterPanel>
        {loading ? (
          <LoadingState variant="table" rows={5} columns={9} />
        ) : (
          <NoveltyTable
            rows={novelties}
            employees={employees}
            currentUser={user!}
            emptyText={`No hay novedades registradas para ${periodLabel}.`}
            onChanged={(updated) => setNovelties((current) => current.map((item) => item.id === updated.id ? updated : item))}
            onDeleted={(id) => {
              setNovelties((current) => current.filter((item) => item.id !== id));
              setMeta((current) => ({ ...current, total: Math.max(0, current.total - 1) }));
            }}
          />
        )}
        {novelties.length > 0 && (
          <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} hasMore={meta.hasMore} onPageChange={setPage} itemLabel="novedades" />
        )}
      </Section>

      {open ? (
        <NoveltyModal
          employees={employees}
          close={() => setOpen(false)}
          saved={() => {
            // Etapa 15M.15: antes había un atajo optimista que insertaba la
            // novedad creada directo en la lista visible cuando no había
            // búsqueda activa y se estaba en la página 1. Con el período
            // como filtro principal eso ya no alcanza -- el modal permite
            // elegir cualquier fecha, así que una novedad creada puede caer
            // fuera del período que se está mirando. Siempre se refresca
            // desde el servidor para que el listado sólo muestre lo que de
            // verdad corresponde al período seleccionado.
            setPage(1);
            setRefresh((value) => value + 1);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
