import type { AuditEntry, DocumentMock, Employee, Novelty, TimeEntry, User } from "../types";

const companies = ["Los O'Dwyer S.A.", "Brasita de Fuego", "Cría OD", "Particulares", "Tropa"];

const common = {
  nationality: "Argentina", phone: "02323 440000", province: "Buenos Aires", department: "Luján", zip: "6700", civilStatus: "Soltero/a",
  agreement: "UATRE", healthInsurance: "OSPRERA", transport: true, transportRoute: "Luján - La Sucho",
  transportNotes: "",
  directManagerFrom: "2023-03-01", directManagerStatus: "Activo", directManagerNotes: "", timeResponsibleRole: "Nivel 3 - Administrativo de Carga Horaria",
  timeResponsibleFrom: "2026-01-01", timeResponsibleStatus: "Activo", timeResponsibleNotes: "", mapLocation: "",
  addressNumber: "S/N", locationMap: { lat: null, lng: null, source: "MOCK" as const, label: "" },
  novelties: [], documents: [], audit: [], routeHistory: [],
};

const employee = (id: string, legajo: string, firstName: string, lastName: string, company: string, costCenter: string, sector: string, manager: string, responsible: string, enabledHours: string[], status: Employee["status"] = "Activo", overrides: Partial<Employee> = {}): Employee => ({
  ...common, id, legajo, legajoInterno: legajo, legajoFinnegans: `FIN-${legajo}`, firstName, lastName, company, costCenter, sector, directManager: manager, timeResponsible: responsible, enabledHours, status,
  dni: `32${legajo}8`, cuil: `20-32${legajo}8-3`, birthDate: "1990-04-12", gender: "Masculino", mobile: `11 15-${legajo}-2200`,
  email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@demo.com`, address: "Ruta 5 km 72", addressStreet: "Ruta 5 km 72", city: "Luján",
  domicilio: { calle: "Ruta 5 km 72", numero: "S/N", provinciaId: "ba", provinciaNombre: "Buenos Aires", departamentoId: "ba_lujan", departamentoNombre: "Luján", localidadId: "ar_ba_lujan_lujan", localidadNombre: "Luján", codigoPostal: "6700", ubicacionMapa: { lat: null, lng: null, source: "MOCK", label: "" } },
  emergencyContact: "Contacto familiar", emergencyRelation: "Familiar", emergencyPhone: "11 5555-1212",
  businessUnit: company === "Los O'Dwyer S.A." ? "Producción Porcina" : "Operaciones", establishment: company === "Los O'Dwyer S.A." ? "La Sucho" : "Central",
  position: sector === "Gestación" ? "Operario de Producción" : "Operario", receiptCategory: "Peón General", internalCategory: "Operario A",
  startDate: "2021-03-15",
  historyEvents: [{ id: `history-${id}`, date: "2021-03-15", type: "Alta", description: "Se creó el legajo del colaborador.", user: "Ana RRHH" }],
  ...overrides,
});

export const mockEmployees: Employee[] = [
  employee("e1", "1001", "Juan", "Pérez", "Los O'Dwyer S.A.", "Maternidad", "Gestación", "Pedro Gómez", "María Gómez", ["Hora normal", "Sereno"], "Activo", { birthDate: "1988-06-12", startDate: "2016-03-15", city: "Luján", transportRoute: "Luján - La Sucho" }),
  employee("e2", "1002", "Carlos", "Gómez", "Los O'Dwyer S.A.", "Maternidad", "Gestación", "Pedro Gómez", "María Gómez", ["Hora normal"], "Activo", { birthDate: "1994-09-03", startDate: "2020-08-03", department: "Mercedes", city: "Mercedes", transportRoute: "Mercedes - La Sucho" }),
  employee("e3", "1003", "Martín", "Ruiz", "Brasita de Fuego", "Producción", "Planta", "Laura Díaz", "Laura Díaz", ["Hora normal", "Guardia"], "Activo", { birthDate: "1985-11-22", startDate: "2012-05-21", city: "Luján", transport: false, transportRoute: "" }),
  employee("e4", "1004", "Pedro", "López", "Cría OD", "Recría", "Campo", "Laura Díaz", "Laura Díaz", ["Hora normal", "Manejo de colectivo"], "Activo", { birthDate: "1997-06-28", startDate: "2023-01-09", city: "Jáuregui", transportRoute: "Jáuregui - Campo Norte" }),
  employee("e5", "1005", "Andrés", "Díaz", "Tropa", "Logística", "Transporte", "Diego Torres", "Diego Torres", ["Hora normal", "Sereno", "Guardia"], "Activo", { birthDate: "1991-02-14", startDate: "2018-10-10", department: "Mercedes", city: "Mercedes", transportRoute: "Mercedes - Base Logística" }),
  employee("e6", "1006", "Mariana", "Suárez", "Los O'Dwyer S.A.", "Administración", "RRHH", "Ana Molina", "María Gómez", ["Hora normal"], "Activo", { birthDate: "1989-06-05", startDate: "2015-06-01", city: "Luján", transport: false, transportRoute: "" }),
  employee("e7", "1007", "Lucía", "Fernández", "Los O'Dwyer S.A.", "Engorde", "Nutrición", "Pedro Gómez", "María Gómez", ["Hora normal", "Feriado"], "Activo", { birthDate: "1999-08-19", startDate: "2024-02-12", city: "Torres", transportRoute: "Torres - La Sucho" }),
  employee("e8", "1008", "Diego", "Molina", "Particulares", "Servicios", "Mantenimiento", "Ana Molina", "Laura Díaz", ["Hora normal", "Hora extra"], "Activo", { birthDate: "1982-12-08", startDate: "2010-07-19", city: "Luján", transport: false, transportRoute: "" }),
  employee("e9", "1009", "Natalia", "Castro", "Brasita de Fuego", "Producción", "Cocina", "Laura Díaz", "Laura Díaz", ["Hora normal", "Nocturna"], "Activo", { birthDate: "1995-06-18", startDate: "2022-04-04", city: "Open Door", transportRoute: "Open Door - Planta" }),
  employee("e10", "1010", "Ricardo", "Torres", "Cría OD", "Recría", "Sanidad", "Diego Torres", "Diego Torres", ["Hora normal"], "Inactivo", { birthDate: "1978-01-30", startDate: "2011-09-05", endDate: "2026-03-31", exitReason: "Renuncia", department: "Mercedes", city: "Mercedes", transport: false, transportRoute: "" }),
  employee("e11", "1011", "Elena", "Paz", "Los O'Dwyer S.A.", "Maternidad", "Parideras", "Pedro Gómez", "María Gómez", ["Hora normal", "Sereno"], "Activo", { birthDate: "2000-07-07", startDate: "2025-01-13", city: "Jáuregui", transportRoute: "Jáuregui - La Sucho" }),
  employee("e12", "1012", "Gonzalo", "Sosa", "Tropa", "Logística", "Distribución", "Diego Torres", "", ["Hora normal", "Hora extra"], "Activo", { birthDate: "1993-10-25", startDate: "2019-11-11", city: "Luján", transportRoute: "Luján - Base Logística" }),
  employee("e13", "1013", "Ana", "Molina", "Los O'Dwyer S.A.", "Dirección", "Dirección General", "", "María Gómez", ["Hora normal"], "Activo", { companies, birthDate: "1976-03-18", startDate: "2008-01-15", position: "Directora de Personas y Operaciones", receiptCategory: "Dirección", internalCategory: "Directorio", businessUnit: "Dirección Corporativa", establishment: "Casa Central", transport: false, transportRoute: "" }),
  employee("e14", "1014", "Fabián", "O'Dwyer", "Los O'Dwyer S.A.", "Dirección", "Dirección General", "Ana Molina", "María Gómez", ["Hora normal"], "Activo", { companies, birthDate: "1972-11-10", startDate: "2006-04-01", position: "Director General", receiptCategory: "Dirección", internalCategory: "Director", businessUnit: "Dirección Corporativa", establishment: "Casa Central", transport: false, transportRoute: "" }),
  employee("e15", "1015", "Sofía", "Herrera", "Los O'Dwyer S.A.", "Dirección", "Operaciones", "Fabián O'Dwyer", "María Gómez", ["Hora normal"], "Activo", { companies: ["Los O'Dwyer S.A.", "Brasita de Fuego", "Cría OD", "Tropa"], birthDate: "1981-05-26", startDate: "2013-02-11", position: "Gerente General de Operaciones", receiptCategory: "Gerencia", internalCategory: "Gerente General", businessUnit: "Dirección Corporativa", establishment: "Casa Central", transport: false, transportRoute: "" }),
  employee("e16", "1016", "Pedro", "Gómez", "Los O'Dwyer S.A.", "Maternidad", "Gestación", "Sofía Herrera", "María Gómez", ["Hora normal"], "Activo", { birthDate: "1980-02-19", startDate: "2011-08-16", position: "Encargado de Gestación", receiptCategory: "Encargado", internalCategory: "Encargado A", businessUnit: "Producción Porcina", establishment: "La Sucho" }),
  employee("e17", "1017", "Laura", "Díaz", "Brasita de Fuego", "Producción", "Planta", "Sofía Herrera", "Laura Díaz", ["Hora normal", "Guardia"], "Activo", { birthDate: "1983-08-21", startDate: "2014-06-02", position: "Encargada de Planta", receiptCategory: "Encargado", internalCategory: "Encargado B", businessUnit: "Alimentos", establishment: "Planta Central", city: "Open Door" }),
  employee("e18", "1018", "Diego", "Torres", "Tropa", "Logística", "Transporte", "Sofía Herrera", "Diego Torres", ["Hora normal", "Sereno"], "Activo", { birthDate: "1979-12-14", startDate: "2010-09-20", position: "Encargado de Logística", receiptCategory: "Encargado", internalCategory: "Encargado C", businessUnit: "Logística", establishment: "Base Logística", department: "Mercedes", city: "Mercedes" }),
  employee("e19", "1019", "María", "Gómez", "Los O'Dwyer S.A.", "Administración", "RRHH", "Ana Molina", "María Gómez", ["Hora normal"], "Activo", { birthDate: "1987-01-09", startDate: "2017-03-06", position: "Administrativa de Carga Horaria", receiptCategory: "Administrativo", internalCategory: "Administrativo A", businessUnit: "Administración", establishment: "Casa Central", transport: false, transportRoute: "" }),
  employee("e20", "1020", "Julián", "Ríos", "Los O'Dwyer S.A.", "Administración", "Compras", "Ana Molina", "María Gómez", ["Hora normal"], "Activo", { birthDate: "1990-10-29", startDate: "2018-05-14", position: "Analista de Compras", receiptCategory: "Administrativo", internalCategory: "Administrativo B", businessUnit: "Administración", establishment: "Casa Central", transport: false, transportRoute: "" }),
  employee("e21", "1021", "Clara", "Benítez", "Los O'Dwyer S.A.", "Administración", "Finanzas", "Ana Molina", "María Gómez", ["Hora normal"], "Activo", { birthDate: "1992-04-04", startDate: "2019-07-22", position: "Analista de Administración", receiptCategory: "Administrativo", internalCategory: "Administrativo C", businessUnit: "Administración", establishment: "Casa Central", transport: false, transportRoute: "" }),
  employee("e22", "1022", "Ramiro", "Vega", "Los O'Dwyer S.A.", "Administración", "Sistemas", "Ana Molina", "María Gómez", ["Hora normal", "Guardia"], "Activo", { birthDate: "1988-09-17", startDate: "2016-11-01", position: "Soporte de Sistemas", receiptCategory: "Administrativo", internalCategory: "Administrativo D", businessUnit: "Administración", establishment: "Casa Central", transport: false, transportRoute: "" }),
  employee("e23", "1023", "Valentina", "Quiroga", "Los O'Dwyer S.A.", "Calidad", "Bioseguridad", "Sofía Herrera", "María Gómez", ["Hora normal"], "Activo", { birthDate: "1986-07-12", startDate: "2015-04-13", position: "Especialista en Bioseguridad", receiptCategory: "Especialista", internalCategory: "Especial A", businessUnit: "Producción Porcina", establishment: "La Sucho" }),
  employee("e24", "1024", "Nicolás", "Paredes", "Los O'Dwyer S.A.", "Calidad", "Calidad", "Sofía Herrera", "María Gómez", ["Hora normal"], "Activo", { birthDate: "1984-02-03", startDate: "2014-09-08", position: "Especialista en Calidad", receiptCategory: "Especialista", internalCategory: "Especial B", businessUnit: "Producción Porcina", establishment: "La Sucho" }),
  employee("e25", "1025", "Paula", "Silva", "Cría OD", "Recría", "Sanidad", "Diego Torres", "Diego Torres", ["Hora normal", "Guardia"], "Activo", { birthDate: "1991-06-30", startDate: "2020-02-17", position: "Técnica Sanitaria", receiptCategory: "Especialista", internalCategory: "Especial C", businessUnit: "Producción Animal", establishment: "Campo Norte", department: "Mercedes", city: "Mercedes" }),
  employee("e26", "1026", "Esteban", "Aguirre", "Los O'Dwyer S.A.", "Engorde", "Nutrición", "Pedro Gómez", "María Gómez", ["Hora normal"], "Activo", { birthDate: "1989-05-15", startDate: "2018-08-21", position: "Especialista en Nutrición", receiptCategory: "Especialista", internalCategory: "Especial D", businessUnit: "Producción Porcina", establishment: "La Sucho", city: "Torres" }),
  employee("e27", "1027", "Camila", "Núñez", "Brasita de Fuego", "Producción", "Cocina", "Laura Díaz", "Laura Díaz", ["Hora normal", "Nocturna"], "Activo", { birthDate: "1993-03-23", startDate: "2021-01-18", position: "Especialista de Procesos", receiptCategory: "Especialista", internalCategory: "Especial E", businessUnit: "Alimentos", establishment: "Planta Central", city: "Open Door" }),
  employee("e28", "1028", "Tomás", "Medina", "Tropa", "Logística", "Distribución", "Diego Torres", "Diego Torres", ["Hora normal", "Hora extra"], "Activo", { birthDate: "1996-12-01", startDate: "2022-03-07", position: "Planificador de Distribución", receiptCategory: "Especialista", internalCategory: "Especial F", businessUnit: "Logística", establishment: "Base Logística", department: "Mercedes", city: "Mercedes" }),
  employee("e29", "1029", "Florencia", "Ibarra", "Los O'Dwyer S.A.", "Calidad", "Laboratorio", "Sofía Herrera", "María Gómez", ["Hora normal"], "Activo", { birthDate: "1990-08-08", startDate: "2017-10-02", position: "Analista de Laboratorio", receiptCategory: "Especialista", internalCategory: "Especial G", businessUnit: "Producción Porcina", establishment: "La Sucho" }),
  employee("e30", "1030", "Lucas", "Peralta", "Cría OD", "Recría", "Campo", "Diego Torres", "Diego Torres", ["Hora normal"], "Activo", { birthDate: "1987-04-20", startDate: "2016-06-13", position: "Coordinador de Campo", receiptCategory: "Especialista", internalCategory: "Especial H", businessUnit: "Producción Animal", establishment: "Campo Norte", city: "Jáuregui" }),
  employee("e31", "1031", "Micaela", "Cáceres", "Los O'Dwyer S.A.", "Maternidad", "Parideras", "Pedro Gómez", "María Gómez", ["Hora normal", "Sereno"], "Activo", { birthDate: "1998-01-27", startDate: "2024-05-06", position: "Referente de Parideras", receiptCategory: "Especialista", internalCategory: "Especial I", businessUnit: "Producción Porcina", establishment: "La Sucho", city: "Jáuregui" }),
  employee("e32", "1032", "Bruno", "Luna", "Los O'Dwyer S.A.", "Maternidad", "Gestación", "Pedro Gómez", "María Gómez", ["Hora normal"], "Activo", { birthDate: "1997-07-16", startDate: "2023-04-10", position: "Operario de Gestación", receiptCategory: "Peón General", internalCategory: "Operario B" }),
  employee("e33", "1033", "Agustina", "Farias", "Los O'Dwyer S.A.", "Maternidad", "Parideras", "Pedro Gómez", "María Gómez", ["Hora normal", "Sereno"], "Activo", { birthDate: "1999-11-03", startDate: "2024-01-15", position: "Operaria de Parideras", receiptCategory: "Peón General", internalCategory: "Operario C", city: "Jáuregui" }),
  employee("e34", "1034", "Hernán", "Romero", "Los O'Dwyer S.A.", "Engorde", "Nutrición", "Pedro Gómez", "María Gómez", ["Hora normal", "Feriado"], "Activo", { birthDate: "1995-02-18", startDate: "2021-09-13", position: "Operario de Nutrición", receiptCategory: "Peón General", internalCategory: "Operario D", city: "Torres" }),
  employee("e35", "1035", "Rocío", "Mansilla", "Brasita de Fuego", "Producción", "Cocina", "Laura Díaz", "Laura Díaz", ["Hora normal", "Nocturna"], "Activo", { birthDate: "1994-06-11", startDate: "2020-12-01", position: "Operaria de Cocina", receiptCategory: "Peón General", internalCategory: "Operario B", businessUnit: "Alimentos", establishment: "Planta Central", city: "Open Door" }),
  employee("e36", "1036", "Sebastián", "Morales", "Brasita de Fuego", "Producción", "Planta", "Laura Díaz", "Laura Díaz", ["Hora normal", "Guardia"], "Activo", { birthDate: "1992-09-25", startDate: "2019-03-18", position: "Operario de Planta", receiptCategory: "Peón General", internalCategory: "Operario C", businessUnit: "Alimentos", establishment: "Planta Central", transport: false, transportRoute: "" }),
  employee("e37", "1037", "Daniela", "Ortega", "Cría OD", "Recría", "Campo", "Diego Torres", "Diego Torres", ["Hora normal", "Manejo de colectivo"], "Activo", { birthDate: "1996-05-07", startDate: "2022-10-03", position: "Operaria de Campo", receiptCategory: "Peón General", internalCategory: "Operario B", businessUnit: "Producción Animal", establishment: "Campo Norte", city: "Jáuregui" }),
  employee("e38", "1038", "Iván", "Salas", "Tropa", "Logística", "Transporte", "Diego Torres", "Diego Torres", ["Hora normal", "Hora extra"], "Activo", { birthDate: "1990-12-29", startDate: "2018-02-05", position: "Chofer Interno", receiptCategory: "Peón Especializado", internalCategory: "Operario C", businessUnit: "Logística", establishment: "Base Logística", department: "Mercedes", city: "Mercedes" }),
  employee("e39", "1039", "Carolina", "Arias", "Tropa", "Logística", "Distribución", "Diego Torres", "Diego Torres", ["Hora normal"], "Activo", { birthDate: "1993-08-13", startDate: "2020-06-29", position: "Auxiliar de Depósito", receiptCategory: "Peón General", internalCategory: "Operario D", businessUnit: "Logística", establishment: "Base Logística", department: "Mercedes", city: "Mercedes" }),
  employee("e40", "1040", "Leandro", "Castillo", "Particulares", "Servicios", "Mantenimiento", "Ana Molina", "Laura Díaz", ["Hora normal", "Hora extra"], "Activo", { birthDate: "1985-10-02", startDate: "2012-12-03", position: "Oficial de Mantenimiento", receiptCategory: "Peón Especializado", internalCategory: "Operario A", businessUnit: "Servicios", establishment: "Central", transport: false, transportRoute: "" }),
];

export const mockUsers: User[] = [
  { id: "u1", name: "Ana RRHH", email: "rrhh@demo.com", password: "demo", role: "Nivel 1 - RRHH", status: "Activo" },
  { id: "u2", name: "Pedro Gómez", email: "supervision@demo.com", password: "demo", role: "Nivel 2 - Supervisión / Gestión", status: "Activo", company: "Los O'Dwyer S.A.", sector: "Gestación" },
  { id: "u3", name: "María Gómez", email: "carga@demo.com", password: "demo", role: "Nivel 3 - Administrativo de Carga Horaria", status: "Activo", company: "Los O'Dwyer S.A." },
  { id: "u4", name: "Laura Díaz", email: "laura@demo.com", password: "demo", role: "Nivel 3 - Administrativo de Carga Horaria", status: "Activo" },
  { id: "u5", name: "Diego Torres", email: "diego@demo.com", password: "demo", role: "Nivel 3 - Administrativo de Carga Horaria", status: "Activo" },
];

export const mockTimeEntries: TimeEntry[] = [
  { id: "t1", employeeId: "e1", period: "2026-06", day: 1, type: "Hora normal", hours: 8, status: "Borrador" },
  { id: "t2", employeeId: "e1", period: "2026-06", day: 2, type: "Sereno", hours: 8, status: "Borrador" },
  { id: "t3", employeeId: "e2", period: "2026-06", day: 1, type: "Hora normal", hours: 8, status: "Aprobado" },
  { id: "t4", employeeId: "e7", period: "2026-06", day: 1, type: "Hora normal", hours: 8, status: "En revisión" },
  { id: "t5", employeeId: "e3", period: "2026-06", day: 1, type: "Hora normal", hours: 8, status: "Aprobado" },
  { id: "t6", employeeId: "e4", period: "2026-06", day: 1, type: "Hora normal", hours: 8, status: "Borrador" },
  { id: "t7", employeeId: "e5", period: "2026-06", day: 1, type: "Hora normal", hours: 8, status: "En revisión" },
  { id: "t8", employeeId: "e6", period: "2026-06", day: 1, type: "Hora normal", hours: 8, status: "Aprobado" },
  { id: "t9", employeeId: "e9", period: "2026-06", day: 1, type: "Nocturna", hours: 8, status: "Borrador" },
  { id: "t10", employeeId: "e11", period: "2026-06", day: 1, type: "Hora normal", hours: 8, status: "Pendiente" },
];

export const mockNovelties: Novelty[] = [
  { id: "n1", employeeId: "e2", type: "Vacaciones", from: "2026-06-08", to: "2026-06-12", quantity: "5 días", affectsSettlement: true, status: "Aprobado", createdBy: "Ana RRHH" },
  { id: "n2", employeeId: "e7", type: "Certificado médico", from: "2026-06-01", to: "2026-06-02", quantity: "2 días", affectsSettlement: true, status: "Pendiente", createdBy: "María Gómez" },
  { id: "n3", employeeId: "e5", type: "Llegada tarde", from: "2026-05-29", to: "2026-05-29", quantity: "45 min", affectsSettlement: false, status: "Registrado", createdBy: "Diego Torres" },
  { id: "n4", employeeId: "e9", type: "Enfermedad", from: "2026-06-01", to: "2026-06-01", quantity: "1 día", affectsSettlement: true, status: "Aprobado", createdBy: "Laura Díaz" },
  { id: "n5", employeeId: "e4", type: "ART", from: "2026-05-20", to: "2026-05-23", quantity: "4 días", affectsSettlement: true, status: "Aprobado", createdBy: "Ana RRHH" },
];

export const mockAudit: AuditEntry[] = [
  { id: "a1", date: "02/06/2026", time: "09:42", user: "Ana RRHH", role: "Nivel 1 - RRHH", action: "Actualizó legajo", entity: "Legajo 1001", previous: "Sector: Maternidad", next: "Sector: Gestación", reason: "Reorganización interna" },
  { id: "a2", date: "02/06/2026", time: "08:15", user: "María Gómez", role: "Nivel 3 - Administrativo de Carga Horaria", action: "Guardó borrador", entity: "Carga horaria 1001", previous: "-", next: "16 horas", reason: "Carga periódica" },
];

export const mockDocuments: DocumentMock[] = [
  { id: "d1", employeeId: "e1", category: "DNI", fileName: "dni_juan_perez.pdf", uploadedAt: "15/03/2021", expiresAt: "12/04/2031", status: "Vigente" },
  { id: "d2", employeeId: "e7", category: "Certificados", fileName: "certificado_medico.pdf", uploadedAt: "01/06/2026", expiresAt: "02/06/2026", status: "Por vencer" },
  { id: "d3", employeeId: "e4", category: "Licencias", fileName: "licencia_conducir.pdf", uploadedAt: "14/07/2024", expiresAt: "01/06/2026", status: "Vencido" },
  { id: "d4", employeeId: "e5", category: "Licencias", fileName: "licencia_profesional.pdf", uploadedAt: "10/06/2025", expiresAt: "15/06/2026", status: "Por vencer" },
  { id: "d5", employeeId: "e9", category: "Contrato", fileName: "contrato_natalia_castro.pdf", uploadedAt: "04/04/2022", status: "Vigente" },
];
