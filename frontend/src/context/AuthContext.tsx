import { createContext, useContext, useState, type ReactNode } from "react";
import type { Role, User } from "../types";
import { authMockService } from "../services/authMockService";

interface AuthValue { user?: User; login: (email: string, password: string) => boolean; loginAs: (role: Role) => void; logout: () => void; }
const AuthContext = createContext<AuthValue | undefined>(undefined);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | undefined>(() => JSON.parse(sessionStorage.getItem("losod_user") || "null") || undefined);
  const save = (value?: User) => { setUser(value); value ? sessionStorage.setItem("losod_user", JSON.stringify(value)) : sessionStorage.removeItem("losod_user"); };
  return <AuthContext.Provider value={{ user, login: (email, password) => { const found = authMockService.login(email, password); save(found); return !!found; }, loginAs: (role) => save(authMockService.loginAsRole(role)), logout: () => save() }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext)!;
