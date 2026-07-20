import { useEffect, useState } from "react";
import { CheckCheck, Plus, Search } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { noveltyApiService } from "../services/api/noveltyApiService";
import type { Employee, Novelty } from "../types";
import { NoveltyModal } from "../components/novelties/NoveltyModal";
import { NoveltyTable } from "../components/novelties/NoveltyTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { Pagination } from "../components/ui/Pagination";
import { useDebouncedValue } from "../utils/useDebouncedValue";
import { roleLevel } from "../utils/roles";

const pageSize = 25;

export function NoveltiesPage() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const employees: Employee[] = [];
  const [novelties, setNovelties] = useState<Novelty[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageSize, hasMore: false });
  const [loadError, setLoadError] = useState("");
  const [bulkApproving, setBulkApproving] = useState(false);
  const pendingVisible = novelties.filter((item) => item.status === "Pendiente");

  useEffect(() => {
    let mounted = true;
    setLoadError("");
    noveltyApiService
      .list({ page, take: pageSize, search: debouncedSearch })
      .then((result) => {
        if (!mounted) return;
        setNovelties(result.items);
        setMeta(result.meta);
      })
      .catch(() => {
        if (mounted) {
          setNovelties([]);
          setMeta({ total: 0, page, pageSize, hasMore: false });
          setLoadError("No se pudieron cargar novedades desde backend. Verifica que la API este levantada y que existan datos en la base.");
        }
      });
    return () => {
      mounted = false;
    };
  }, [debouncedSearch, page, refresh, user]);

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
        subtitle={`${meta.total} registros visibles según tu perfil`}
      >
        {roleLevel(user!.role) === 1 && pendingVisible.length ? <div className="bulk-toolbar"><span>{pendingVisible.length} novedades pendientes en esta vista</span><Button variant="primary" icon={CheckCheck} loading={bulkApproving} onClick={async () => { setBulkApproving(true); setLoadError(""); try { const updated = await noveltyApiService.approveMany(pendingVisible.map((item) => item.id)); const byId = new Map(updated.map((item) => [item.id, item])); setNovelties((current) => current.map((item) => byId.get(item.id) || item)); } catch { setLoadError("No se pudieron aprobar las novedades en lote."); } finally { setBulkApproving(false); } }}>Aprobar pendientes visibles</Button></div> : null}
        <div className="filters">
          <label className="search-field">
            <Search size={17} />
            <input
              placeholder="Buscar por legajo, DNI, empleado o tipo de novedad"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        <NoveltyTable
          rows={novelties}
          employees={employees}
          currentUser={user!}
          onChanged={(updated) => setNovelties((current) => current.map((item) => item.id === updated.id ? updated : item))}
        />
        {novelties.length > 0 && (
          <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} hasMore={meta.hasMore} onPageChange={setPage} itemLabel="novedades" />
        )}
      </Section>

      {open ? (
        <NoveltyModal
          employees={employees}
          close={() => setOpen(false)}
          saved={(created) => {
            if (page === 1 && !debouncedSearch) {
              setNovelties((current) => [...created, ...current].slice(0, pageSize));
              setMeta((current) => ({ ...current, total: current.total + created.length, hasMore: current.total + created.length > current.pageSize }));
            } else {
              setPage(1);
              setRefresh((value) => value + 1);
            }
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
