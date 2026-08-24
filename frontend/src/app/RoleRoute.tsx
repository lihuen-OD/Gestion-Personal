import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { roleLevel } from "../utils/roles";

export function canAccessRoleRoute(role: NonNullable<ReturnType<typeof useAuth>["user"]>["role"], allowedLevels: number[]) {
  return allowedLevels.includes(roleLevel(role));
}

export function RoleRoute({ allowedLevels, children }: { allowedLevels: number[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !canAccessRoleRoute(user.role, allowedLevels)) return <Navigate to="/gestion-horaria" replace />;
  return children;
}
