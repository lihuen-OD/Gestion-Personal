import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./app/AppShell";
import { useAuth } from "./context/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { roleLevel } from "./utils/roles";

const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const EmployeesPage = lazy(() => import("./pages/EmployeesPage").then((module) => ({ default: module.EmployeesPage })));
const EmployeeCreatePage = lazy(() => import("./pages/EmployeeCreatePage").then((module) => ({ default: module.EmployeeCreatePage })));
const EmployeeDetailPage = lazy(() => import("./pages/EmployeeDetailPage").then((module) => ({ default: module.EmployeeDetailPage })));
const PuestosPage = lazy(() => import("./pages/PuestosPage").then((module) => ({ default: module.PuestosPage })));
const PuestoCreatePage = lazy(() => import("./pages/PuestoCreatePage").then((module) => ({ default: module.PuestoCreatePage })));
const PuestoDetailPage = lazy(() => import("./pages/PuestoDetailPage").then((module) => ({ default: module.PuestoDetailPage })));
const OrgStructurePage = lazy(() => import("./pages/OrgStructurePage").then((module) => ({ default: module.OrgStructurePage })));
const HourConceptsPage = lazy(() => import("./pages/HourConceptsPage").then((module) => ({ default: module.HourConceptsPage })));
const FinnegansExportPage = lazy(() => import("./pages/FinnegansExportPage").then((module) => ({ default: module.FinnegansExportPage })));
const DocumentCategoriesPage = lazy(() => import("./pages/DocumentCategoriesPage").then((module) => ({ default: module.DocumentCategoriesPage })));
const AuditParametersPage = lazy(() => import("./pages/AuditParametersPage").then((module) => ({ default: module.AuditParametersPage })));
const NoveltyTypesPage = lazy(() => import("./pages/NoveltyTypesPage").then((module) => ({ default: module.NoveltyTypesPage })));
const NoveltyTypeCreatePage = lazy(() => import("./pages/NoveltyTypeCreatePage").then((module) => ({ default: module.NoveltyTypeCreatePage })));
const NoveltyTypeDetailPage = lazy(() => import("./pages/NoveltyTypeDetailPage").then((module) => ({ default: module.NoveltyTypeDetailPage })));
const HoursPage = lazy(() => import("./pages/HoursPage").then((module) => ({ default: module.HoursPage })));
const EmployeeHoursPage = lazy(() => import("./pages/EmployeeHoursPage").then((module) => ({ default: module.EmployeeHoursPage })));
const AttendancePage = lazy(() => import("./pages/AttendancePage").then((module) => ({ default: module.AttendancePage })));
const NoveltiesPage = lazy(() => import("./pages/NoveltiesPage").then((module) => ({ default: module.NoveltiesPage })));
const DocumentsPage = lazy(() => import("./pages/DocumentsPage").then((module) => ({ default: module.DocumentsPage })));
const OrganigramasPage = lazy(() => import("./pages/OrganigramasPage").then((module) => ({ default: module.OrganigramasPage })));
const UsersPage = lazy(() => import("./pages/UsersPage").then((module) => ({ default: module.UsersPage })));
const AuditPage = lazy(() => import("./pages/AuditPage").then((module) => ({ default: module.AuditPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage").then((module) => ({ default: module.ReportsPage })));
const TimeClockPage = lazy(() => import("./pages/TimeClockPage").then((module) => ({ default: module.TimeClockPage })));

function PageLoader() {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      Cargando...
    </div>
  );
}

export function App() {
  const { user } = useAuth();

  if (!user) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/fichador" element={<TimeClockPage />} />
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
          <Route path="/fichador" element={<TimeClockPage />} />
          <Route path="/" element={level === 3 ? <Navigate to="/horas" /> : <DashboardPage />} />
          <Route path="/legajos" element={<EmployeesPage />} />
          <Route path="/legajos/nuevo" element={<EmployeeCreatePage />} />
          <Route path="/legajos/:id" element={<EmployeeDetailPage />} />
          <Route path="/puestos" element={<PuestosPage />} />
          <Route path="/puestos/nuevo" element={<PuestoCreatePage />} />
          <Route path="/puestos/:id" element={<PuestoDetailPage />} />
          <Route path="/configuracion/empresas-estructura" element={<OrgStructurePage />} />
          <Route path="/configuracion/conceptos-horarios" element={<HourConceptsPage />} />
          <Route path="/configuracion/liquidacion" element={<FinnegansExportPage />} />
          <Route path="/configuracion/categorias-documentales" element={<DocumentCategoriesPage />} />
          <Route path="/configuracion/parametros-auditoria" element={<AuditParametersPage />} />
          <Route path="/configuracion/tipos-novedades" element={<NoveltyTypesPage />} />
          <Route path="/configuracion/tipos-novedades/nuevo" element={<NoveltyTypeCreatePage />} />
          <Route path="/configuracion/tipos-novedades/:id" element={<NoveltyTypeDetailPage />} />
          <Route path="/horas" element={<HoursPage />} />
          <Route path="/horas/:id" element={<EmployeeHoursPage />} />
          <Route path="/asistencia" element={<AttendancePage />} />
          <Route path="/novedades" element={<NoveltiesPage />} />
          <Route path="/documentacion" element={<DocumentsPage />} />
          <Route path="/organigramas" element={<OrganigramasPage />} />
          <Route path="/usuarios" element={<UsersPage />} />
          <Route path="/auditoria" element={<AuditPage />} />
          <Route path="/configuracion" element={<SettingsPage />} />
          <Route path="/reportes" element={<ReportsPage />} />
          <Route path="/pendientes" element={<HoursPage pendingOnly />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
