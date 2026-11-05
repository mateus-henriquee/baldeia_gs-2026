import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type User } from "./api";

interface AuthCtx { user: User | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void> }
const Ctx = createContext<AuthCtx>({ user: null, loading: true, refresh: async () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setUser((await api<{ usuario: User | null }>("/auth/me")).usuario); } catch { setUser(null); }
    setLoading(false);
  }, []);
  const logout = useCallback(async () => { await api("/auth/logout", { method: "POST", body: {} }).catch(() => {}); setUser(null); }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <Ctx.Provider value={{ user, loading, refresh, logout }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
