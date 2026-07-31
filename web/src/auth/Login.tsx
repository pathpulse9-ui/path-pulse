import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthContext';
import { Button, Card, Field, Badge } from '../ui/components';

export function Login() {
  const { login } = useAuth();
  const [operator, setOperator] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(operator, passcode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pp-login">
      <div className="pp-login__box">
        <div className="pp-login__brand">
          PathPulse <Badge tone="brand">Ops Console</Badge>
        </div>
        <Card>
          <form onSubmit={onSubmit}>
            <Field
              label="Operator"
              placeholder="your name"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              autoFocus
            />
            <div style={{ height: 12 }} />
            <Field
              label="Passcode"
              type="password"
              placeholder="ops passcode"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
            />
            {error && <p className="pp-login__error">{error}</p>}
            <div style={{ height: 16 }} />
            <Button type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>
        <p className="pp-muted pp-login__note">
          Phase 1 scaffold — dev passcode gate. Backend session auth lands in Phase 2.
        </p>
      </div>
    </div>
  );
}
