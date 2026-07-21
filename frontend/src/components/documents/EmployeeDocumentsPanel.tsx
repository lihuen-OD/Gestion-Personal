import { useEffect, useState } from "react";
import { Download, Plus } from "lucide-react";
import { documentApiService } from "../../services/api/documentApiService";
import type { DocumentMock, Employee, User } from "../../types";
import { statusClass } from "../../utils/status";
import { EmptyState } from "../ui/EmptyState";
import { OverflowCell } from "../ui/OverflowCell";
import { TableShell } from "../ui/TableShell";
import { DocumentUploadModal } from "./DocumentUploadModal";

export function EmployeeDocumentsPanel({
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
  const [docs, setDocs] = useState<DocumentMock[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    documentApiService
      .getByEmployee(employee.id)
      .then((items) => {
        if (mounted) setDocs(items);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [employee.id, refresh]);

  const saved = (updated?: Employee) => {
    if (updated) onSaved(updated);
    setRefresh((value) => value + 1);
    setOpen(false);
  };

  const download = async (doc: DocumentMock) => {
    setError("");
    try {
      await documentApiService.download(doc);
    } catch (downloadError) {
      setError("No pudimos abrir el archivo. Verificá que siga disponible e intentá nuevamente.");
    }
  };

  return (
    <>
      <div className="form-actions">
        <button className="button primary" onClick={() => setOpen(true)}>
          <Plus size={15} /> Agregar documento
        </button>
      </div>

      {docs.length ? (
        <TableShell minWidth={1040}>
          <table>
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Archivo</th>
                <th>Fecha carga</th>
                <th>Vencimiento</th>
                <th>Estado</th>
                <th>Observacion</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <OverflowCell value={doc.category} />
                  </td>
                  <td>
                    <OverflowCell value={doc.fileName} />
                  </td>
                  <td>{doc.uploadedAt}</td>
                  <td>{doc.expiresAt || "-"}</td>
                  <td>
                    <span className={statusClass(doc.status)}>{doc.status}</span>
                  </td>
                  <td>
                    <OverflowCell value={doc.notes || "-"} />
                  </td>
                  <td>
                    <button
                      className="table-link table-icon-action"
                      type="button"
                      title="Abrir archivo"
                      aria-label="Abrir archivo"
                      onClick={() => download(doc)}
                    >
                      <Download size={14} />
                      <span>Abrir</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      ) : (
        <EmptyState text="Todavia no hay documentos cargados." />
      )}
      {error ? <p className="error">{error}</p> : null}

      {open ? (
        <DocumentUploadModal
          employees={[employee]}
          fixedEmployee={employee}
          user={user}
          close={() => setOpen(false)}
          saved={saved}
        />
      ) : null}
    </>
  );
}
