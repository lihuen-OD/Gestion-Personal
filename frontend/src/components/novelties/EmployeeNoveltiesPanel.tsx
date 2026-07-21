import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { noveltyApiService } from "../../services/api/noveltyApiService";
import type { Employee, Novelty, User } from "../../types";
import { NoveltyModal } from "./NoveltyModal";
import { NoveltyTable } from "./NoveltyTable";
import { ErrorState } from "../ui/ErrorState";
import { LoadingState } from "../ui/LoadingState";

export function EmployeeNoveltiesPanel({
  employee,
  user,
  onSaved,
}: {
  employee: Employee;
  user: User;
  onSaved: (employee: Employee) => void;
}) {
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [rows, setRows] = useState<Novelty[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    let mounted = true;
    setLoadStatus("loading");
    noveltyApiService
      .getAll({ employeeId: employee.id })
      .then((items) => {
        if (mounted) {
          setRows(items);
          setLoadStatus("success");
        }
      })
      .catch(() => {
        if (mounted) setLoadStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [employee.id, refresh]);

  const saved = () => {
    const updated = {
      ...employee,
      historyEvents: [
        {
          id: crypto.randomUUID(),
          date: new Date().toLocaleDateString("es-AR"),
          type: "Novedad registrada",
          description: "Se registró una novedad de ausentismo / horario.",
          user: user.name,
        },
        ...(employee.historyEvents || []),
      ],
    };

    onSaved(updated);
    setRefresh((value) => value + 1);
    setOpen(false);
  };

  return (
    <>
      <div className="form-actions">
        <button className="button primary" onClick={() => setOpen(true)}>
          <Plus size={15} /> Nueva novedad
        </button>
      </div>

      {loadStatus === "loading" ? (
        <LoadingState text="Cargando novedades..." />
      ) : loadStatus === "error" ? (
        <ErrorState message="No pudimos cargar las novedades." onRetry={() => setRefresh((value) => value + 1)} />
      ) : (
        <NoveltyTable rows={rows} employees={[employee]} currentUser={user} onChanged={() => setRefresh((value) => value + 1)} onDeleted={() => setRefresh((value) => value + 1)} />
      )}

      {open ? (
        <NoveltyModal
          employees={[employee]}
          close={() => setOpen(false)}
          saved={saved}
        />
      ) : null}
    </>
  );
}
