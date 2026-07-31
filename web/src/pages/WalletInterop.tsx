import { useEffect, useRef, useState, useCallback } from 'react';
import { Card, Button, Field, Badge } from '../ui/components';
import {
  type WalletSession,
  type AccountState,
  openWalletModal,
  restoreWallet,
  disconnectWallet,
  loadSession,
  loadAccount,
  fundWithFriendbot,
  signAndSubmitPayment,
} from '../wallet/kit';

type LogLevel = 'info' | 'ok' | 'err';
interface LogLine {
  ts: string;
  msg: string;
  level: LogLevel;
}

export function WalletInterop() {
  const [session, setSession] = useState<WalletSession | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [accountNote, setAccountNote] = useState<string>('—');
  const [dest, setDest] = useState('');
  const [txResult, setTxResult] = useState<{ ok: boolean; node: React.ReactNode } | null>(null);
  const [busy, setBusy] = useState<{ fund?: boolean; send?: boolean; refresh?: boolean }>({});
  const [log, setLog] = useState<LogLine[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string, level: LogLevel = 'info') => {
    const ts = new Date().toISOString().slice(11, 19);
    setLog((l) => [...l, { ts, msg, level }]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [log]);

  const refreshAccount = useCallback(
    async (address: string) => {
      setBusy((b) => ({ ...b, refresh: true }));
      setAccountNote('Loading…');
      const res = await loadAccount(address);
      if (res.status === 'funded') {
        setAccount(res.account);
        setAccountNote('');
        addLog(`Account loaded from Horizon (${res.account.balanceXlm} XLM)`);
      } else if (res.status === 'not_found') {
        setAccount(null);
        setAccountNote('Account not found on testnet — fund it via Friendbot below.');
        addLog('Account not found on testnet; needs Friendbot funding', 'err');
      } else {
        setAccount(null);
        setAccountNote(`Horizon error: ${res.message}`);
        addLog(`Horizon error: ${res.message}`, 'err');
      }
      setBusy((b) => ({ ...b, refresh: false }));
    },
    [addLog],
  );

  // restore a persisted wallet session on mount (guarded: StrictMode double-mounts effects in dev)
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    const restored = loadSession();
    if (restored) {
      restoreWallet(restored);
      setSession(restored);
      addLog(`Session restored: ${restored.walletName} → ${restored.address}`);
      void refreshAccount(restored.address);
    } else {
      addLog('Ready. Connect a wallet to begin.');
    }
  }, [addLog, refreshAccount]);

  function connect() {
    void openWalletModal(
      (s) => {
        setSession(s);
        addLog(`Wallet connected: ${s.walletName} → ${s.address}`, 'ok');
        void refreshAccount(s.address);
      },
      (e) => addLog(`Connection failed: ${e}`, 'err'),
    );
  }

  async function disconnect() {
    await disconnectWallet();
    setSession(null);
    setAccount(null);
    setAccountNote('—');
    setTxResult(null);
    addLog('Session cleared');
  }

  async function fund() {
    if (!session) return;
    setBusy((b) => ({ ...b, fund: true }));
    addLog('Requesting Friendbot funding…');
    try {
      await fundWithFriendbot(session.address);
      addLog('Friendbot funded the account', 'ok');
      await refreshAccount(session.address);
    } catch (e) {
      addLog(`Friendbot failed: ${String(e)}`, 'err');
    } finally {
      setBusy((b) => ({ ...b, fund: false }));
    }
  }

  async function send() {
    if (!session) return;
    setBusy((b) => ({ ...b, send: true }));
    setTxResult(null);
    const destination = dest.trim() || session.address;
    try {
      addLog(`Building 1 XLM payment → ${destination}`);
      addLog(`Requesting signature from ${session.walletName}…`);
      const res = await signAndSubmitPayment(session, destination);
      addLog('Transaction signed by external wallet', 'ok');
      addLog(`Submitted to Horizon: ${res.hash}`, 'ok');
      setTxResult({
        ok: true,
        node: (
          <>
            ✓ Submitted. Hash <code>{res.hash.slice(0, 10)}…</code>{' '}
            <a href={res.explorerUrl} target="_blank" rel="noreferrer">
              view on stellar.expert
            </a>
          </>
        ),
      });
      await refreshAccount(session.address);
    } catch (e) {
      addLog(`Payment failed: ${String(e)}`, 'err');
      setTxResult({ ok: false, node: <>✗ {String(e)}</> });
    } finally {
      setBusy((b) => ({ ...b, send: false }));
    }
  }

  return (
    <div>
      <h1 className="pp-page__title">
        Wallet Interoperability <Badge tone="brand">Testnet</Badge>
      </h1>
      <p className="pp-page__sub">
        PAT-9 · D2 — connect an external Stellar wallet (Freighter, Lobstr, xBull, Albedo…) via
        Stellar Wallets Kit, then sign &amp; submit a testnet transaction. Reviewer-facing.
      </p>

      <div style={{ display: 'grid', gap: 'var(--sp-4)', maxWidth: 720 }}>
        <Card
          title="1 · Wallet session"
          actions={
            session ? (
              <Button variant="secondary" onClick={disconnect}>Disconnect</Button>
            ) : (
              <Button onClick={connect}>Connect wallet</Button>
            )
          }
        >
          {session ? (
            <div>
              Connected via <strong>{session.walletName}</strong>
              <div className="mono pp-muted" style={{ marginTop: 6, wordBreak: 'break-all' }}>
                {session.address}
              </div>
            </div>
          ) : (
            <p className="pp-muted">No wallet connected.</p>
          )}
        </Card>

        {session && (
          <Card
            title="2 · Account (Horizon testnet)"
            actions={
              <>
                <Button variant="secondary" disabled={busy.refresh} onClick={() => refreshAccount(session.address)}>
                  Refresh
                </Button>
                <Button variant="secondary" disabled={busy.fund} onClick={fund}>
                  {busy.fund ? 'Funding…' : 'Fund via Friendbot'}
                </Button>
              </>
            }
          >
            {account ? (
              <div>
                Balance <strong>{account.balanceXlm} XLM</strong>
                <div className="pp-muted" style={{ marginTop: 6 }}>
                  sequence {account.sequence} ·{' '}
                  <a
                    href={`https://stellar.expert/explorer/testnet/account/${account.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    view on stellar.expert
                  </a>
                </div>
              </div>
            ) : (
              <p className="pp-muted">{accountNote}</p>
            )}
          </Card>
        )}

        {session && (
          <Card title="3 · Test transaction">
            <p className="pp-muted" style={{ marginTop: 0 }}>
              Builds a 1 XLM payment on testnet, requests a signature from the connected wallet, and
              submits to Horizon.
            </p>
            <Field
              label="Destination (leave empty to pay yourself)"
              placeholder="G… (defaults to self-payment)"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
            />
            <div style={{ marginTop: 14 }}>
              <Button disabled={busy.send} onClick={send}>
                {busy.send ? 'Signing…' : 'Sign & submit 1 XLM payment'}
              </Button>
            </div>
            {txResult && (
              <p style={{ marginTop: 12, color: txResult.ok ? 'var(--success)' : 'var(--danger)', wordBreak: 'break-all' }}>
                {txResult.node}
              </p>
            )}
          </Card>
        )}

        <Card title="Event log">
          <pre className="pp-log" aria-live="polite">
            {log.map((l, i) => (
              <div
                key={i}
                style={{ color: l.level === 'ok' ? 'var(--success)' : l.level === 'err' ? 'var(--danger)' : undefined }}
              >
                [{l.ts}] {l.msg}
              </div>
            ))}
            <div ref={logEndRef} />
          </pre>
        </Card>
      </div>
    </div>
  );
}
