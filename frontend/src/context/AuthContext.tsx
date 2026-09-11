import { createContext, useContext, useState, type ReactNode } from "react";
import type { User } from "../types";
import { authApiService } from "../services/api/authApiService";
import { refreshTokenStorage, tokenStorage } from "../services/api/apiClient";
import { clearAllAppCaches } from "../services/cache";

interface AuthValue {
  user?: User;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthValue | undefined>(undefined);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | undefined>(() => {
    const savedUser = JSON.parse(sessionStorage.getItem("losod_user") || "null") || undefined;
    if (tokenStorage.get()) return savedUser;
    sessionStorage.removeItem("losod_user");
    return undefined;
  });
  const save = (value?: User) => {
    setUser(value);
    value ? sessionStorage.setItem("losod_user", JSON.stringify(value)) : sessionStorage.removeItem("losod_user");
  };

  const login = async (email: string, password: string) => {
    try {
      const result = await authApiService.login(email, password);
      if (user?.id && user.id !== result.user.id) {
        await clearAllAppCaches("account switch");
      }
      tokenStorage.set(result.accessToken);
      refreshTokenStorage.set(result.refreshToken);
      save(result.user);
      return true;
    } catch {
      tokenStorage.clear();
      refreshTokenStorage.clear();
      void clearAllAppCaches("login failure");
      save();
      return false;
    }
  };

  const logout = async () => {
    try {
      await authApiService.logout();
    } catch {
      // El cierre local no depende de que el backend esté disponible.
    } finally {
      void clearAllAppCaches("logout");
      tokenStorage.clear();
      refreshTokenStorage.clear();
      save();
    }
  };

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext)!;
