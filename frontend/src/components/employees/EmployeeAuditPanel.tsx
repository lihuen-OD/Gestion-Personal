import { useCallback, useEffect, useState } from "react";
import { auditApiService } from "../../services/api/auditApiService";
import type { ListMeta } from "../../services/api/listQuery";
import type { AuditEntry } from "../../types";
import { auditActionLabel, auditChange, auditDescription } from "../../utils/auditLabels";
import { useSortState } from "../../utils/sort";
import { DataTable } from "../ui/DataTable";
import { OverflowCell } from "../ui/OverflowCell";
import { Pagination } from "../ui/Pagination";
import { SortableHeader } from "../ui/SortableHeader";

const pageSize = 25;

// Pestaña "Auditoría" del legajo: paginada server-side sobre GET /audit
// (entityId). Antes compartía una única carga de 200 eventos con el resto del
// detalle y cortaba en silencio los más antiguos.
export function EmployeeAuditPanel({ employeeId }: { employeeId: string }) {
  const [page, setPage] = useState(1);
  const resetPage = useCallback(() => setPage(1), []);
  const { sort, toggleSort } = useSortState<"createdAt">(resetPage);
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [meta, setMeta] = useState<ListMeta>({ total: 0, page: 1, pageSize, hasMore: false });
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let mounted = true;
    if (!rows.length) setStatus("loading");
    auditApiService
      .list({ entityId: employeeId, page, take: pageSize, sort })
      .then((result) => {
        if (!mounted) return;
        setRows(result.items);
        setMeta(result.meta);
        setStatus("success");
      })
      .catch(() => {
        if (mounted) setStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [employeeId, page, retry, sort]);

  return (
    <>
      <DataTable
        status={status === "loading" ? "loading" : status === "error" ? "error" : rows.length ? "ready" : "empty"}
        minWidth={960}
        loadingColumns={5}
        errorMessage="No pudimos cargar la auditoría del legajo."
        onRetry={() => setRetry((value) => value + 1)}
        emptyText="Todavía no hay eventos de auditoría para este legajo."
      >
        <table>
          <thead>
            <tr>
              <SortableHeader label="Fecha" sortKey="createdAt" sort={sort} onSort={toggleSort} />
              <th>Usuario</th>
              <th>Acción</th>
              <th>Detalle</th>
              <th>Cambio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((audit) => (
              <tr key={audit.id}>
                <td>
                  {audit.date} · {audit.time}
                </td>
                <td>{audit.user}</td>
                <td>{auditActionLabel(audit.action)}</td>
                <td>
                  <OverflowCell value={auditDescription(audit)} />
                </td>
                <td>
                  <OverflowCell value={auditChange(audit)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
      {status === "success" && meta.total > 0 ? (
        <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} hasMore={meta.hasMore} onPageChange={setPage} itemLabel="eventos" />
      ) : null}
    </>
  );
}
