import type { Position } from "../types/position.types";

const now = "2025-10-15T10:00:00.000Z";

export const mockPositions: Position[] = [
  {
    id: "pos-aux-contable",
    code: "ADM-CON-001",
    name: "Auxiliar Contable - Registracion y Archivo",
    areaDepartment: "Administracion Contable",
    sector: "Contable",
    reportsTo: "Responsable del area administrativa contable",
    supervises: "No aplica",
    location: "Oficina Central Arroyo Baru",
    lastUpdatedAt: "2025-10-01",
    status: "ACTIVO",
    companyName: "Los O'Dwyer S.A.",
    businessUnitName: "Administracion Central",
    businessUnitNames: ["Administracion Central", "Administración", "Direccion Corporativa"],
    establishmentName: "Casa Central",
    establishmentNames: ["Casa Central", "Oficina Central Arroyo Baru"],
    sectorNames: ["Contable", "Administración", "Finanzas", "Compras"],
    suggestedCostCenterName: "Administracion",
    suggestedReceiptCategoryName: "Administrativo",
    suggestedInternalCategoryName: "Administrativo",
    salaryRangeCategories: ["Administrativo", "Administrativo A", "Administrativo B", "Administrativo C"],
    mission: "Garantizar la registracion precisa, ordenada y completa de los comprobantes contables en el sistema de gestion, asegurando la correcta imputacion contable, la verificacion de la informacion asociada y el adecuado archivo fisico y digital de la documentacion. Su labor constituye un pilar esencial para la calidad y trazabilidad de la informacion contable.",
    responsibilities: [
      "Recibir y verificar los comprobantes de compras, gastos, servicios y movimientos internos, controlando requisitos legales e impositivos.",
      "Registrar en el sistema contable todos los comprobantes, asegurando la exactitud de datos.",
      "Imputar correctamente las cuentas contables y centros de costos segun el circuito administrativo definido.",
      "Escanear y archivar digitalmente los comprobantes.",
      "Mantener el archivo fisico de comprobantes ordenado y accesible.",
      "Coordinar con Compras y responsables de Unidades de Negocio ante inconsistencias.",
      "Asegurar la carga en tiempo y forma dentro del cronograma mensual de cierres."
    ].map((description, index) => ({ id: `resp-aux-${index + 1}`, description, order: index + 1 })),
    internalRelations: ["Compras", "Tesoreria", "Pagos", "Recursos Humanos", "Gerentes", "Responsables de Unidades de Negocio"].map((name, index) => ({ id: `rel-int-aux-${index + 1}`, name })),
    externalRelations: ["Proveedores", "Intermediarios", "Estudio contable externo"].map((name, index) => ({ id: `rel-ext-aux-${index + 1}`, name })),
    competencies: ["Atencion al detalle y precision", "Orden y prolijidad administrativa", "Cumplimiento de plazos", "Responsabilidad y compromiso", "Trabajo en equipo", "Disposicion al aprendizaje"].map((name, index) => ({ id: `comp-aux-${index + 1}`, name, active: true })),
    workConditions: { modality: "PRESENCIAL", workload: "Tiempo completo", workplace: "Oficina Central Arroyo Baru", relationType: "Planta permanente" },
    performanceIndicators: [
      { id: "ind-aux-1", name: "% de comprobantes cargados correctamente en tiempo y forma.", target: "95% mensual", active: true },
      { id: "ind-aux-2", name: "Errores detectados en cierres contables.", target: "Menos de 3 observaciones por cierre", active: true },
      { id: "ind-aux-3", name: "Cumplimiento de plazos de rendicion de gastos.", target: "100% dentro del calendario", active: true }
    ],
    evaluationCriteria: [
      { id: "crit-aux-1", name: "Presentismo", description: "Evalua la asistencia y puntualidad del colaborador. Se considera el cumplimiento del horario laboral y la presencia continua durante la jornada.", rule: "Si registra mas de 8 horas de ausencias en el periodo evaluado, pierde el beneficio de presentismo.", weight: 25, active: true },
      { id: "crit-aux-2", name: "Predisposicion", description: "Mide la actitud positiva y colaborativa frente a las tareas diarias, cambios y necesidades del area.", weight: 20, active: true },
      { id: "crit-aux-3", name: "Asumir directivas", description: "Evalua la capacidad para recibir, interpretar y ejecutar instrucciones correctamente.", weight: 20, active: true },
      { id: "crit-aux-4", name: "Companerismo", description: "Considera el grado de integracion, respeto y colaboracion con el equipo.", weight: 15, active: true },
      { id: "crit-aux-5", name: "Iniciativa", description: "Mide la capacidad para anticiparse a problemas, proponer mejoras y actuar ante situaciones rutinarias.", weight: 20, active: true }
    ],
    history: [{ id: "hist-pos-aux-1", positionId: "pos-aux-contable", action: "Alta de puesto", description: "Se creo el puesto base de Auxiliar Contable.", createdAt: now, createdByUserId: "system", createdByUserName: "Sistema" }],
    createdAt: now,
    updatedAt: now,
    createdBy: "Sistema",
    updatedBy: "Sistema"
  },
  {
    id: "pos-director-general",
    code: "DIR-001",
    name: "Director General",
    areaDepartment: "Direccion",
    sector: "Direccion General",
    reportsTo: "Directorio",
    supervises: "Gerencia General y Direcciones de area",
    location: "Casa Central",
    lastUpdatedAt: "2026-03-15",
    status: "ACTIVO",
    companyName: "Los O'Dwyer S.A.",
    businessUnitName: "Direccion Corporativa",
    businessUnitNames: ["Direccion Corporativa", "Dirección Corporativa"],
    establishmentName: "Casa Central",
    establishmentNames: ["Casa Central", "Establecimientos"],
    sectorNames: ["Direccion General", "Dirección General", "Operaciones"],
    suggestedCostCenterName: "Direccion General",
    suggestedReceiptCategoryName: "Direccion",
    suggestedInternalCategoryName: "Director",
    salaryRangeCategories: ["Directorio", "Director", "Gerente General", "Direccion"],
    mission: "Conducir la estrategia integral de las empresas del grupo, asegurando continuidad operativa, rentabilidad, desarrollo de equipos y cumplimiento de objetivos corporativos.",
    responsibilities: [
      { id: "resp-dir-1", description: "Definir prioridades estrategicas y lineamientos de gestion para las unidades de negocio.", order: 1 },
      { id: "resp-dir-2", description: "Supervisar resultados, inversiones, riesgos y continuidad operativa.", order: 2 },
      { id: "resp-dir-3", description: "Coordinar la gestion de gerencias y responsables clave.", order: 3 }
    ],
    internalRelations: [{ id: "rel-dir-1", name: "Directorio" }, { id: "rel-dir-2", name: "Gerencias" }, { id: "rel-dir-3", name: "RRHH" }],
    externalRelations: [{ id: "rel-dir-ext-1", name: "Asesores externos" }, { id: "rel-dir-ext-2", name: "Entidades financieras" }],
    competencies: [{ id: "comp-dir-1", name: "Vision estrategica", active: true }, { id: "comp-dir-2", name: "Liderazgo ejecutivo", active: true }],
    workConditions: { modality: "HIBRIDA", workload: "Dedicacion full time", workplace: "Casa Central y establecimientos", relationType: "Direccion" },
    performanceIndicators: [{ id: "ind-dir-1", name: "Cumplimiento de objetivos anuales del grupo", active: true }],
    evaluationCriteria: [{ id: "crit-dir-1", name: "Gestion de resultados", description: "Evalua cumplimiento de objetivos economicos, productivos y humanos.", weight: 100, active: true }],
    history: [{ id: "hist-pos-dir-1", positionId: "pos-director-general", action: "Alta de puesto", description: "Se creo el puesto de Director General.", createdAt: now, createdByUserId: "system", createdByUserName: "Sistema" }],
    createdAt: now,
    updatedAt: now,
    createdBy: "Sistema",
    updatedBy: "Sistema"
  }
];
