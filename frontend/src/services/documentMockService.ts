import type { DocumentMock } from "../types";
import { auditMockService } from "./auditMockService";
import { readStore, writeStore } from "./storage";

export const documentMockService = {
  getAll: () => readStore<DocumentMock>("documents"),
  getByEmployee: (employeeId: string) => readStore<DocumentMock>("documents").filter((d) => d.employeeId === employeeId),
  create: (document: DocumentMock, user?: { name: string; role: string }) => {
    writeStore("documents", [document, ...readStore<DocumentMock>("documents")]);
    if (user) auditMockService.create({ user: user.name, role: user.role, action: "Cargar documento", entity: `Documento ${document.fileName}`, field: document.category, previous: "-", next: document.status, reason: "Carga documental mock" });
    return document;
  },
};
