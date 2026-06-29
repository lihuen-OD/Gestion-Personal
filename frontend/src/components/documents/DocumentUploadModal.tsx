import { useEffect, useState } from "react";
import { documentCategoryApiService } from "../../services/api/documentCategoryApiService";
import { documentApiService } from "../../services/api/documentApiService";
import { employeeApiService } from "../../services/api/employeeApiService";
import { documentCategoryMockService } from "../../services/documentCategoryMockService";
import { documentMockService } from "../../services/documentMockService";
import { employeeMockService } from "../../services/employeeMockService";
import type { Employee, User } from "../../types";
import { defaultDocumentExpiration, documentStatusByExpiration, isoToday } from "../../utils/documentStatus";
import { displayLegajo, fullName } from "../../utils/employee";
import { Field, Select } from "../ui/FormControls";
import { Modal } from "../ui/Modal";
import type { DocumentCategory } from "../../types/documentCategory.types";

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
  saved: (employee?: Employee) => void;
}) {
  const [categories, setCategories] = useState<DocumentCategory[]>(() => documentCategoryMockService.getActive());
  const [employeeId, setEmployeeId] = useState(fixedEmployee?.id || employees[0]?.id || "");
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const selectedCategory = categories.find((item) => item.id === categoryId);
  const [file, setFile] = useState<File | null>(null);
  const [expiresAt, setExpiresAt] = useState(defaultDocumentExpiration(selectedCategory));
  const [status, setStatus] = useState(documentStatusByExpiration(defaultDocumentExpiration(selectedCategory)));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    documentCategoryApiService
      .getAll({ status: "ACTIVO" })
      .then((items) => {
        if (!mounted) return;
        const active = items.filter((item) => item.status === "ACTIVO");
        setCategories(active);
        if (!active.some((item) => item.id === categoryId)) {
          setCategoryId(active[0]?.id || "");
        }
      })
      .catch(() => {
        if (!mounted) return;
        const fallback = documentCategoryMockService.getActive();
        setCategories(fallback);
        if (!fallback.some((item) => item.id === categoryId)) {
          setCategoryId(fallback[0]?.id || "");
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const next = defaultDocumentExpiration(selectedCategory);
    setExpiresAt(next);
    setStatus(documentStatusByExpiration(next));
    setError("");
  }, [categoryId, selectedCategory]);

  const saveFallback = (employee: Employee) => {
    documentMockService.create(
      {
        id: crypto.randomUUID(),
        employeeId: employee.id,
        category: selectedCategory!.name,
        categoryId: selectedCategory!.id,
        fileName: file!.name,
        uploadedAt: isoToday(),
        expiresAt: expiresAt || undefined,
        status,
        notes: notes || undefined,
      },
      user,
    );
    if (fixedEmployee) {
      const updated = {
        ...fixedEmployee,
        historyEvents: [
          {
            id: crypto.randomUUID(),
            date: new Date().toLocaleDateString("es-AR"),
            type: "Documento cargado",
            description: `${selectedCategory!.name}: ${file!.name}`,
            user: user.name,
          },
          ...(fixedEmployee.historyEvents || []),
        ],
      };
      saved(employeeMockService.update(updated, user));
      return;
    }
    saved(employee);
  };

  const save = async () => {
    const employee = employees.find((item) => item.id === employeeId) || fixedEmployee;
    if (!employee) return setError("Seleccioná un legajo para asociar el documento.");
    if (!selectedCategory) return setError("Seleccioná una categoría documental.");
    if (!file) return setError("Adjuntá un archivo para guardar el documento.");

    try {
      const fileBase64 = await fileToBase64(file);
      await documentApiService.create({
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
        saved(await employeeApiService.getById(employee.id));
        return;
      }
      saved(employee);
    } catch (apiError) {
      saveFallback(employee);
    }
  };

  return (
    <Modal title="Agregar documento" close={close}>
      <div className="form-stack">
        {categories.length ? (
          <>
            <div className="form-grid">
              {!fixedEmployee ? (
                <label>
                  Legajo asociado
                  <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {displayLegajo(employee)} · {fullName(employee)}
                      </option>
                    ))}
                  </select>
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
              <button className="button primary" onClick={save}>
                Guardar documento
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
