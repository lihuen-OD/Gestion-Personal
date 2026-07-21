import { useEffect, useState } from "react";
import { documentCategoryApiService } from "../../services/api/documentCategoryApiService";
import { documentApiService } from "../../services/api/documentApiService";
import { employeeApiService } from "../../services/api/employeeApiService";
import type { DocumentMock, Employee, User } from "../../types";
import { defaultDocumentExpiration, documentStatusByExpiration } from "../../utils/documentStatus";
import { displayLegajo, fullName } from "../../utils/employee";
import { useAsyncAction } from "../../utils/useAsyncAction";
import { Field, Select } from "../ui/FormControls";
import { Modal } from "../ui/Modal";
import type { DocumentCategory } from "../../types/documentCategory.types";
import { EmployeeRemoteSelector } from "../employees/EmployeeRemoteSelector";
import { ErrorState } from "../ui/ErrorState";
import { LoadingState } from "../ui/LoadingState";

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function DocumentUploadModal({
  employees,
  fixedEmployee,
  user,
  close,
  saved,
}: {
  employees: Employee[];
  fixedEmployee?: Employee;
  user: User;
  close: () => void;
  saved: (employee?: Employee, documents?: DocumentMock[]) => void;
}) {
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<Employee[]>(fixedEmployee ? [fixedEmployee] : employees.slice(0, 1));
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const selectedCategory = categories.find((item) => item.id === categoryId);
  const [file, setFile] = useState<File | null>(null);
  const [expiresAt, setExpiresAt] = useState(defaultDocumentExpiration(selectedCategory));
  const [status, setStatus] = useState(documentStatusByExpiration(defaultDocumentExpiration(selectedCategory)));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "success" | "error">("loading");
  const [catalogRetry, setCatalogRetry] = useState(0);

  useEffect(() => {
    let mounted = true;
    setCatalogStatus("loading");
    documentCategoryApiService
      .getAll({ status: "ACTIVO" })
      .then((items) => {
        if (!mounted) return;
        const active = items.filter((item) => item.status === "ACTIVO");
        setCategories(active);
        if (!active.some((item) => item.id === categoryId)) {
          setCategoryId(active[0]?.id || "");
        }
        setCatalogStatus("success");
      })
      .catch(() => {
        if (mounted) setCatalogStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [catalogRetry]);

  useEffect(() => {
    const next = defaultDocumentExpiration(selectedCategory);
    setExpiresAt(next);
    setStatus(documentStatusByExpiration(next));
    setError("");
  }, [categoryId, selectedCategory]);

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    const employee = fixedEmployee || selectedEmployees[0];
    if (!employee) return setError("Seleccioná un legajo para asociar el documento.");
    if (!selectedCategory) return setError("Seleccioná una categoría documental.");
    if (!file) return setError("Adjuntá un archivo para guardar el documento.");

    try {
      const fileBase64 = await fileToBase64(file);
      const documents = await documentApiService.create({
        employeeId: employee.id,
        categoryId: selectedCategory.id,
        fileName: file.name,
        fileMimeType: file.type || "application/octet-stream",
        fileSizeBytes: file.size || 1,
        fileBase64,
        status,
        expiresAt: expiresAt || undefined,
        notes: notes || undefined,
      });
      if (fixedEmployee) {
        saved(await employeeApiService.getById(employee.id), documents);
        return;
      }
      saved(employee, documents);
    } catch {
      setError("No se pudo guardar el documento. Intentá nuevamente.");
    }
  });

  return (
    <Modal title="Agregar documento" close={close}>
      <div className="form-stack">
        {catalogStatus === "loading" ? (
          <LoadingState text="Cargando categorías documentales..." />
        ) : catalogStatus === "error" ? (
          <ErrorState message="No pudimos cargar las categorías documentales." onRetry={() => setCatalogRetry((value) => value + 1)} />
        ) : categories.length ? (
          <>
            <div className="form-grid">
              {!fixedEmployee ? (
                <label>
                  Legajo asociado
                  <EmployeeRemoteSelector selected={selectedEmployees} onChange={setSelectedEmployees} />
                </label>
              ) : null}
              <label>
                Categoría documental
                <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.code} · {category.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectedCategory ? (
              <div className="info-note compact">
                <b>{selectedCategory.name}</b>
                <p>{selectedCategory.description}</p>
                <small>
                  Ámbitos: {selectedCategory.scopes.join(", ")} · Vence:{" "}
                  {selectedCategory.rules.expires ? "Sí" : "No"} · Aprobación:{" "}
                  {selectedCategory.rules.requiresApproval ? "Sí" : "No"}
                </small>
              </div>
            ) : null}

            <div className="document-upload-card">
              <b>Archivo documental</b>
              <p>Seleccioná el archivo que queda asociado al legajo y a la categoría documental elegida.</p>
              <label>
                Adjuntar documento
                <input
                  type="file"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] || null);
                    setError("");
                  }}
                />
              </label>
              {file ? <small>Archivo seleccionado: {file.name}</small> : null}
            </div>

            <div className="form-grid">
              <Field
                label="Fecha vencimiento"
                type="date"
                value={expiresAt}
                set={(value) => {
                  setExpiresAt(value);
                  setStatus(documentStatusByExpiration(value));
                }}
              />
              <Select label="Estado" value={status} set={setStatus} options={["Vigente", "Por vencer", "Vencido"]} />
            </div>

            <label>
              Observación documental
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Detalle opcional del archivo o circuito documental"
              />
            </label>

            {error ? <p className="error">{error}</p> : null}

            <div className="form-actions">
              <button className="button subtle" onClick={close}>
                Cancelar
              </button>
              <button className="button primary" onClick={save} disabled={isSaving}>
                {isSaving ? "Guardando..." : "Guardar documento"}
              </button>
            </div>
          </>
        ) : (
          <div className="empty">
            No hay categorías documentales activas. Cargalas desde Configuración &gt; Categorías documentales.
          </div>
        )}
      </div>
    </Modal>
  );
}
