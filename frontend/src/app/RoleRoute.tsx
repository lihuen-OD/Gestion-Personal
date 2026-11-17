import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { roleLevel } from "../utils/roles";
import { homePathForLevel } from "./navigation";

export function canAccessRoleRoute(role: NonNullable<ReturnType<typeof useAuth>["user"]>["role"], allowedLevels: number[]) {
  return allowedLevels.includes(roleLevel(role));
}

export function RoleRoute({ allowedLevels, children }: { allowedLevels: number[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/" replace />;
  if (!canAccessRoleRoute(user.role, allowedLevels)) return <Navigate to={homePathForLevel(roleLevel(user.role))} replace />;
  return children;
}
