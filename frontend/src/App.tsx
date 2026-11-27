import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./app/AppShell";
import { useAuth } from "./context/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { roleLevel } from "./utils/roles";
import { LoadingState } from "./components/ui/LoadingState";
import { RoleRoute } from "./app/RoleRoute";
import { HOURLY_MANAGEMENT_ENTRY_PATH } from "./app/navigation";

const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const EmployeesPage = lazy(() => import("./pages/EmployeesPage").then((module) => ({ default: module.EmployeesPage })));
const EmployeeCreatePage = lazy(() => import("./pages/EmployeeCreatePage").then((module) => ({ default: module.EmployeeCreatePage })));
const EmployeeDetailPage = lazy(() => import("./pages/EmployeeDetailPage").then((module) => ({ default: module.EmployeeDetailPage })));
const PuestosPage = lazy(() => import("./pages/PuestosPage").then((module) => ({ default: module.PuestosPage })));
const PuestoCreatePage = lazy(() => import("./pages/PuestoCreatePage").then((module) => ({ default: module.PuestoCreatePage })));
const PuestoDetailPage = lazy(() => import("./pages/PuestoDetailPage").then((module) => ({ default: module.PuestoDetailPage })));
const OrgStructurePage = lazy(() => import("./pages/OrgStructurePage").then((module) => ({ default: module.OrgStructurePage })));
const HourConceptsPage = lazy(() => import("./pages/HourConceptsPage").then((module) => ({ default: module.HourConceptsPage })));
const WorkRegimesPage = lazy(() => import("./pages/WorkRegimesPage").then((module) => ({ default: module.WorkRegimesPage })));
const FinnegansExportPage = lazy(() => import("./pages/FinnegansExportPage").then((module) => ({ default: module.FinnegansExportPage })));
const DocumentCategoriesPage = lazy(() => import("./pages/DocumentCategoriesPage").then((module) => ({ default: module.DocumentCategoriesPage })));
const AuditParametersPage = lazy(() => import("./pages/AuditParametersPage").then((module) => ({ default: module.AuditParametersPage })));
const NoveltyTypesPage = lazy(() => import("./pages/NoveltyTypesPage").then((module) => ({ default: module.NoveltyTypesPage })));
const NoveltyTypeCreatePage = lazy(() => import("./pages/NoveltyTypeCreatePage").then((module) => ({ default: module.NoveltyTypeCreatePage })));
const NoveltyTypeDetailPage = lazy(() => import("./pages/NoveltyTypeDetailPage").then((module) => ({ default: module.NoveltyTypeDetailPage })));
const HoursPage = lazy(() => import("./pages/HoursPage").then((module) => ({ default: module.HoursPage })));
const EmployeeHoursPage = lazy(() => import("./pages/EmployeeHoursPage").then((module) => ({ default: module.EmployeeHoursPage })));
const AttendancePage = lazy(() => import("./pages/AttendancePage").then((module) => ({ default: module.AttendancePage })));
const ShiftAlertsPage = lazy(() => import("./pages/ShiftAlertsPage").then((module) => ({ default: module.ShiftAlertsPage })));
const NoveltiesPage = lazy(() => import("./pages/NoveltiesPage").then((module) => ({ default: module.NoveltiesPage })));
const DocumentsPage = lazy(() => import("./pages/DocumentsPage").then((module) => ({ default: module.DocumentsPage })));
const OrganigramasPage = lazy(() => import("./pages/OrganigramasPage").then((module) => ({ default: module.OrganigramasPage })));
const UsersPage = lazy(() => import("./pages/UsersPage").then((module) => ({ default: module.UsersPage })));
const AuditPage = lazy(() => import("./pages/AuditPage").then((module) => ({ default: module.AuditPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage").then((module) => ({ default: module.ReportsPage })));
const MonthlyClosuresPage = lazy(() => import("./pages/MonthlyClosuresPage").then((module) => ({ default: module.MonthlyClosuresPage })));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage").then((module) => ({ default: module.NotificationsPage })));
const WorkScheduleSettingsPage = lazy(() => import("./pages/WorkScheduleSettingsPage").then((module) => ({ default: module.WorkScheduleSettingsPage })));
const ShiftsPage = lazy(() => import("./pages/ShiftsPage").then((module) => ({ default: module.ShiftsPage })));
const ShiftCreatePage = lazy(() => import("./pages/ShiftCreatePage").then((module) => ({ default: module.ShiftCreatePage })));
const ShiftDetailPage = lazy(() => import("./pages/ShiftDetailPage").then((module) => ({ default: module.ShiftDetailPage })));
const RotationDetailPage = lazy(() => import("./pages/RotationDetailPage").then((module) => ({ default: module.RotationDetailPage })));
const ClockDevicesPage = lazy(() => import("./pages/ClockDevicesPage").then((module) => ({ default: module.ClockDevicesPage })));

function PageLoader() {
  return <LoadingState text="Cargando módulo..." />;
}

export function App() {
  const { user } = useAuth();

  if (!user) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* F11 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §30): el admin
              ya no tiene /fichador; las fichadas se hacen sólo desde la app
              fichador/ con un ClockDevice individual. */}
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </Suspense>
    );
  }

  const level = roleLevel(user.role);

  return (
    <AppShell>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* "/" es el Dashboard sólo para Nivel 1; Nivel 2 y Nivel 3 van al
              primer módulo real de Gestión horaria. "/gestion-horaria" (la
              vieja pantalla "Inicio") ya no existe: queda como redirección
              para URLs guardadas. */}
          <Route path="/" element={level === 1 ? <DashboardPage /> : <Navigate to={HOURLY_MANAGEMENT_ENTRY_PATH} replace />} />
          <Route path="/gestion-horaria" element={<Navigate to={HOURLY_MANAGEMENT_ENTRY_PATH} replace />} />
          <Route path="/legajos" element={<RoleRoute allowedLevels={[1, 2]}><EmployeesPage /></RoleRoute>} />
          <Route path="/legajos/nuevo" element={<RoleRoute allowedLevels={[1]}><EmployeeCreatePage /></RoleRoute>} />
          <Route path="/legajos/:id" element={<RoleRoute allowedLevels={[1, 2]}><EmployeeDetailPage /></RoleRoute>} />
          <Route path="/puestos" element={<RoleRoute allowedLevels={[1]}><PuestosPage /></RoleRoute>} />
          <Route path="/puestos/nuevo" element={<RoleRoute allowedLevels={[1]}><PuestoCreatePage /></RoleRoute>} />
          <Route path="/puestos/:id" element={<RoleRoute allowedLevels={[1]}><PuestoDetailPage /></RoleRoute>} />
          <Route path="/configuracion/empresas-estructura" element={<OrgStructurePage />} />
          <Route path="/configuracion/conceptos-horarios" element={<HourConceptsPage />} />
          <Route path="/configuracion/regimenes-laborales" element={<WorkRegimesPage />} />
          <Route path="/configuracion/liquidacion" element={<FinnegansExportPage />} />
          <Route path="/configuracion/categorias-documentales" element={<DocumentCategoriesPage />} />
          <Route path="/configuracion/parametros-auditoria" element={<AuditParametersPage />} />
          <Route path="/configuracion/tipos-novedades" element={<NoveltyTypesPage />} />
          <Route path="/configuracion/tipos-novedades/nuevo" element={<NoveltyTypeCreatePage />} />
          <Route path="/configuracion/tipos-novedades/:id" element={<NoveltyTypeDetailPage />} />
          <Route path="/configuracion/turnos-horas-especiales" element={<WorkScheduleSettingsPage />} />
          <Route path="/configuracion/turnos" element={<ShiftsPage />} />
          <Route path="/configuracion/turnos/nuevo" element={<ShiftCreatePage />} />
          <Route path="/configuracion/turnos/rotaciones/:id" element={<RotationDetailPage />} />
          <Route path="/configuracion/turnos/:id" element={<ShiftDetailPage />} />
          {/* Las convocatorias a feriado se gestionan desde Gestión horaria ("Gestionar feriados"). */}
          <Route path="/configuracion/turnos-asignaciones-feriados" element={<Navigate to="/horas?gestionar=feriados" replace />} />
          <Route path="/configuracion/dispositivos-fichada" element={<RoleRoute allowedLevels={[1]}><ClockDevicesPage /></RoleRoute>} />
          <Route path="/horas" element={<HoursPage />} />
          <Route path="/horas/:id" element={<EmployeeHoursPage />} />
          <Route path="/asistencia" element={<AttendancePage />} />
          <Route path="/asistencia/alertas" element={<ShiftAlertsPage />} />
          <Route path="/novedades" element={<NoveltiesPage />} />
          <Route path="/documentacion" element={<RoleRoute allowedLevels={[1, 2]}><DocumentsPage /></RoleRoute>} />
          <Route path="/organigramas" element={<RoleRoute allowedLevels={[1]}><OrganigramasPage /></RoleRoute>} />
          <Route path="/usuarios" element={<UsersPage />} />
          <Route path="/auditoria" element={<AuditPage />} />
          <Route path="/configuracion" element={<SettingsPage />} />
          <Route path="/reportes" element={<RoleRoute allowedLevels={[1]}><ReportsPage /></RoleRoute>} />
          <Route path="/pendientes" element={<RoleRoute allowedLevels={[1, 2]}><HoursPage pendingOnly /></RoleRoute>} />
          <Route path="/cierres" element={<MonthlyClosuresPage />} />
          <Route path="/notificaciones" element={<NotificationsPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
