import { useEffect, useState } from "react";
import { Download, Plus } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { DocumentUploadModal } from "../components/documents/DocumentUploadModal";
import { EmptyState } from "../components/ui/EmptyState";
import { OverflowCell } from "../components/ui/OverflowCell";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { TableShell } from "../components/ui/TableShell";
import { documentApiService } from "../services/api/documentApiService";
import { employeeApiService } from "../services/api/employeeApiService";
import type { DocumentMock, Employee } from "../types";
import { displayLegajo, fullName } from "../utils/employee";
import { statusClass } from "../utils/status";

export function DocumentsPage() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [docs, setDocs] = useState<DocumentMock[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    Promise.all([employeeApiService.getAll(), documentApiService.getAll()])
      .then(([apiEmployees, apiDocs]) => {
        if (!mounted) return;
        setEmployees(apiEmployees);
        setDocs(apiDocs);
      })
      .catch(() => {
        if (!mounted) return;
      });
    return () => {
      mounted = false;
    };
  }, [refresh]);

  const download = async (doc: DocumentMock) => {
    setError("");
    try {
      await documentApiService.download(doc);
    } catch (downloadError) {
      setError("No se pudo abrir el archivo. Verifica que exista en el backend o que Cloudinary este configurado.");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="GESTION DOCUMENTAL"
        title="Documentacion"
        description="Seguimiento de documentacion laboral, certificados y vencimientos."
        action={
          <button className="button primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> Agregar documento
          </button>
        }
      />

      {error ? <div className="form-error">{error}</div> : null}

      <Section title="Documentos del personal" subtitle={`${docs.length} documentos registrados`}>
        {docs.length ? (
          <TableShell minWidth={1200}>
            <table>
              <thead>
                <tr>
                  <th>Legajo</th>
                  <th>Empleado</th>
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
                {docs.map((doc) => {
                  const employee = employees.find((item) => item.id === doc.employeeId);
                  return (
                    <tr key={doc.id}>
                      <td>{displayLegajo(employee)}</td>
                      <td>
                        <OverflowCell value={employee ? fullName(employee) : "-"} />
                      </td>
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
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        ) : (
          <EmptyState text="Todavia no hay documentos cargados." />
        )}
      </Section>

      {open ? (
        <DocumentUploadModal
          employees={employees}
          user={user!}
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
