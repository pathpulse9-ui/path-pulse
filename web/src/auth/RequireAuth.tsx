import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { Login } from './Login';

/** Gate that renders children only when an ops session exists. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (!session) return <Login />;
  return <>{children}</>;
}
