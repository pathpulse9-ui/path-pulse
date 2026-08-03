'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { SessionUser } from '@pathpulse/contract';
import { getSessionUser, logout as apiLogout } from './api';

interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await getSessionUser();
      setUser(user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = useCallback(async () => {
    await apiLogout().catch(() => undefined);
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
