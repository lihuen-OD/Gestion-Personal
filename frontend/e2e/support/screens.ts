/**
 * Etapa 14B.3 — pantallas mínimas del recorrido (Parte 3 del pedido), en el
 * mismo orden pedido. Rutas confirmadas contra `frontend/src/App.tsx` antes de
 * escribir esto (todas existen hoy, ninguna tuvo que inventarse).
 *
 * "Detalle de un legajo existente" no tiene una ruta fija (depende de qué
 * legajos existan) — se resuelve en tiempo de ejecución dentro del spec
 * (primer link real de la tabla de Legajos), no acá.
 */
export type JourneyScreen = {
  name: string;
  route: string;
};

export const LOGIN_ROUTE = "/";

export const JOURNEY_SCREENS: JourneyScreen[] = [
  { name: "Dashboard", route: "/" },
  { name: "Legajos / Empleados", route: "/legajos" },
  // "Detalle de un legajo existente" se inserta acá en tiempo de ejecución.
  { name: "Conceptos Horarios", route: "/configuracion/conceptos-horarios" },
  { name: "Tipos de Novedades", route: "/configuracion/tipos-novedades" },
  { name: "Categorías Documentales", route: "/configuracion/categorias-documentales" },
  { name: "Horas Especiales", route: "/configuracion/turnos-horas-especiales" },
  { name: "Turnos", route: "/configuracion/turnos" },
  { name: "Regímenes Laborales", route: "/configuracion/regimenes-laborales" },
  { name: "Alertas", route: "/asistencia/alertas" },
  { name: "Auditoría", route: "/auditoria" },
  { name: "Carga Horaria", route: "/horas" },
  { name: "Documentos", route: "/documentacion" },
];
