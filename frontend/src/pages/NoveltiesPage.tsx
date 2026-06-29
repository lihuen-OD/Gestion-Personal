import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { employeeApiService } from "../services/api/employeeApiService";
import { noveltyApiService } from "../services/api/noveltyApiService";
import type { Employee, Novelty } from "../types";
import { NoveltyModal } from "../components/novelties/NoveltyModal";
import { NoveltyTable } from "../components/novelties/NoveltyTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";

export function NoveltiesPage() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [novelties, setNovelties] = useState<Novelty[]>([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoadError("");
    Promise.all([employeeApiService.getAll(), noveltyApiService.getAll()])
      .then(([apiEmployees, apiNovelties]) => {
        if (!mounted) return;
        setEmployees(apiEmployees);
        const ids = new Set(apiEmployees.map((employee) => employee.id));
        setNovelties(apiNovelties.filter((item) => ids.has(item.employeeId)));
      })
      .catch(() => {
        if (mounted) {
          setEmployees([]);
          setNovelties([]);
          setLoadError("No se pudieron cargar novedades desde backend. Verifica que la API este levantada y que existan datos en la base.");
        }
      });
    return () => {
      mounted = false;
    };
  }, [refresh, user]);

  return (
    <>
      <PageHeader
        eyebrow="AUSENTISMO Y NOVEDADES"
        title="Novedades"
        description="Registro centralizado de ausencias, licencias y novedades horarias."
        action={
          <button className="button primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> Nueva novedad
          </button>
        }
      />

      {loadError ? <div className="form-error">{loadError}</div> : null}

      <Section
        title="Novedades registradas"
        subtitle={`${novelties.length} registros visibles según tu perfil`}
      >
        <NoveltyTable
          rows={novelties}
          employees={employees}
          currentUser={user!}
          onChanged={() => setRefresh((value) => value + 1)}
        />
      </Section>

      {open ? (
        <NoveltyModal
          employees={employees}
          close={() => setOpen(false)}
          saved={() => {
            setRefresh((value) => value + 1);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
