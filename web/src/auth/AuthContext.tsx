import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * Ops-console auth.
 *
 * ⚠️ Phase 1 SCAFFOLD ONLY. This gate exists so every later-phase surface can sit
 * behind `<RequireAuth>` from day one. It currently validates against a dev
 * passcode client-side — it is NOT real authentication. In Phase 2 the `login`
 * function is swapped to `POST /v1/ops/login` on the Backend Core (session cookie
 * / JWT), with zero changes to consumers of this context.
 */

const SESSION_KEY = 'pathpulse.ops.session';
const DEV_PASSCODE = import.meta.env.VITE_OPS_DEV_PASSCODE ?? 'pathpulse-dev';

export interface OpsSession {
  operator: string;
  since: string;
}

interface AuthValue {
  session: OpsSession | null;
  login: (operator: string, passcode: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<OpsSession | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      try {
        setSession(JSON.parse(raw));
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    }
  }, []);

  async function login(operator: string, passcode: string) {
    // TODO(phase2): replace with `await api.opsLogin(operator, passcode)`.
    if (!operator.trim()) throw new Error('Operator name required');
    if (passcode !== DEV_PASSCODE) throw new Error('Invalid passcode');
    const next: OpsSession = { operator: operator.trim(), since: new Date().toISOString() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setSession(next);
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }

  return <AuthContext.Provider value={{ session, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
