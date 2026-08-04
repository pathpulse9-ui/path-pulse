'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { StellarWalletsKit, initKit, server, HORIZON_URL, FRIENDBOT_URL } from '../lib/stellar';
import { getWalletChallenge, verifyWalletChallenge } from '../lib/api';
import { useSession } from '../lib/session';

interface LogLine {
  time: string;
  msg: string;
  cls: '' | 'ok' | 'err';
}

interface AccountState {
  status: 'idle' | 'loading' | 'loaded' | 'not-found' | 'error';
  balance?: string;
  sequence?: string;
  error?: string;
}

interface KitConnection {
  walletId: string;
  walletName: string;
  address: string;
}

export default function WalletConnect() {
  const { user, loading: sessionLoading, refresh: refreshSession, logout } = useSession();

  const [kitConnection, setKitConnection] = useState<KitConnection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [account, setAccount] = useState<AccountState>({ status: 'idle' });
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [destination, setDestination] = useState('');
  const [fundLoading, setFundLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [txResult, setTxResult] = useState<
    { status: 'ok'; hash: string } | { status: 'err'; message: string } | null
  >(null);

  const logRef = useRef<HTMLPreElement>(null);

  const log = useCallback((msg: string, cls: '' | 'ok' | 'err' = '') => {
    setLogLines((prev) => [
      ...prev,
      { time: new Date().toISOString().slice(11, 19), msg, cls },
    ]);
  }, []);

  useEffect(() => {
    initKit();
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logLines]);

  const refreshAccount = useCallback(
    async (address: string) => {
      setAccount({ status: 'loading' });
      try {
        const acc = await server.loadAccount(address);
        const native = acc.balances.find((b) => b.asset_type === 'native');
        setAccount({
          status: 'loaded',
          balance: native ? native.balance : '0',
          sequence: acc.sequence,
        });
        log(`Account loaded from Horizon (${native?.balance ?? '0'} XLM)`);
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'NotFoundError') {
          setAccount({ status: 'not-found' });
          log('Account not found on testnet; needs Friendbot funding', 'err');
        } else {
          setAccount({ status: 'error', error: String(e) });
          log(`Horizon error: ${String(e)}`, 'err');
        }
      }
    },
    [log],
  );

  const displayAddress = kitConnection?.address ?? user?.address;

  useEffect(() => {
    if (user?.address) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      refreshAccount(user.address);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.address]);

  const connectAndAuthenticate = useCallback(async () => {
    setConnecting(true);
    try {
      const { address } = await StellarWalletsKit.authModal();
      const selected = StellarWalletsKit.selectedModule;
      setKitConnection({ walletId: selected.productId, walletName: selected.productName, address });
      log(`Wallet connected: ${selected.productName} → ${address}`, 'ok');

      log('Requesting SEP-10 challenge…');
      const { transaction, networkPassphrase } = await getWalletChallenge(address);
      log('Requesting authentication signature…');
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(transaction, {
        address,
        networkPassphrase,
      });
      log('Verifying with backend…');
      await verifyWalletChallenge(signedTxXdr);
      log('Signed in', 'ok');
      await refreshSession();
      await refreshAccount(address);
    } catch (e) {
      log(`Connect failed: ${String(e)}`, 'err');
    } finally {
      setConnecting(false);
    }
  }, [log, refreshSession, refreshAccount]);

  const reconnectForSigning = useCallback(async () => {
    try {
      const { address } = await StellarWalletsKit.authModal();
      const selected = StellarWalletsKit.selectedModule;
      setKitConnection({ walletId: selected.productId, walletName: selected.productName, address });
      log(`Reconnected: ${selected.productName} → ${address}`, 'ok');
      await refreshAccount(address);
    } catch (e) {
      log(`Reconnect failed: ${String(e)}`, 'err');
    }
  }, [log, refreshAccount]);

  const disconnectAndSignOut = useCallback(async () => {
    try {
      await StellarWalletsKit.disconnect();
    } catch {}
    setKitConnection(null);
    setAccount({ status: 'idle' });
    setTxResult(null);
    await logout();
    log('Signed out');
  }, [logout, log]);

  const fundWithFriendbot = useCallback(async () => {
    if (!displayAddress) return;
    setFundLoading(true);
    log('Requesting Friendbot funding…');
    try {
      const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(displayAddress)}`);
      if (!res.ok) throw new Error(`Friendbot HTTP ${res.status}`);
      log('Friendbot funded the account', 'ok');
      await refreshAccount(displayAddress);
    } catch (e) {
      log(`Friendbot failed: ${String(e)}`, 'err');
    } finally {
      setFundLoading(false);
    }
  }, [displayAddress, log, refreshAccount]);

  const signAndSubmitPayment = useCallback(async () => {
    if (!kitConnection) return;
    setSendLoading(true);
    setTxResult(null);
    const dest = destination.trim() || kitConnection.address;
    try {
      log(`Building 1 XLM payment → ${dest}`);
      const source = await server.loadAccount(kitConnection.address);
      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.payment({ destination: dest, asset: Asset.native(), amount: '1' }))
        .setTimeout(180)
        .build();

      log(`Requesting signature from ${kitConnection.walletName}…`);
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(tx.toXDR(), {
        address: kitConnection.address,
        networkPassphrase: Networks.TESTNET,
      });
      log('Transaction signed by external wallet', 'ok');

      const signed = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
      const res = await server.submitTransaction(signed);
      setTxResult({ status: 'ok', hash: res.hash });
      log(`Submitted to Horizon: ${res.hash}`, 'ok');
      await refreshAccount(kitConnection.address);
    } catch (e) {
      setTxResult({ status: 'err', message: String(e) });
      log(`Payment failed: ${String(e)}`, 'err');
    } finally {
      setSendLoading(false);
    }
  }, [kitConnection, destination, log, refreshAccount]);

  if (sessionLoading) {
    return (
      <div className="rounded-2xl bg-white p-6">
        <p className="text-sm text-black/50">Loading…</p>
      </div>
    );
  }

  const signedIn = user?.method === 'wallet';

  return (
    <div className="rounded-2xl bg-white p-6 space-y-4">
      <h2 className="text-black text-lg font-medium" style={{ letterSpacing: '-0.02em' }}>
        Connect Wallet <span className="text-black/40 font-normal">(Non-Custodial)</span>
      </h2>

      {!signedIn && (
        <>
          <p className="text-sm text-black/60">No wallet connected.</p>
          <button
            onClick={connectAndAuthenticate}
            disabled={connecting}
            className="bg-black text-white text-sm font-medium px-6 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-50"
          >
            {connecting ? 'Connecting…' : 'Connect Wallet'}
          </button>
        </>
      )}

      {signedIn && user?.address && (
        <div className="space-y-4">
          <p className="text-sm text-black/60">
            Signed in as <code className="text-xs break-all text-black/50">{user.address}</code>
            {kitConnection && <> via <strong className="text-black">{kitConnection.walletName}</strong></>}
          </p>

          {account.status === 'loading' && <p className="text-sm text-black/50">Loading…</p>}
          {account.status === 'loaded' && (
            <p className="text-sm text-black/70">
              Balance: <strong className="text-black">{account.balance} XLM</strong> · sequence{' '}
              {account.sequence} ·{' '}
              <a
                href={`${HORIZON_URL}/accounts/${user.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-black transition-colors duration-200"
              >
                view on Horizon
              </a>
            </p>
          )}
          {account.status === 'not-found' && (
            <p className="text-sm text-amber-600">
              Account not found on testnet — fund it via Friendbot below.
            </p>
          )}
          {account.status === 'error' && (
            <p className="text-sm text-red-600">Horizon error: {account.error}</p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => refreshAccount(user.address!)}
              className="rounded-full border border-black/10 px-4 py-1.5 text-sm hover:bg-black/5 transition-colors duration-200"
            >
              Refresh
            </button>
            <button
              onClick={fundWithFriendbot}
              disabled={fundLoading}
              className="rounded-full border border-black/10 px-4 py-1.5 text-sm hover:bg-black/5 transition-colors duration-200 disabled:opacity-50"
            >
              {fundLoading ? 'Funding…' : 'Fund with Friendbot'}
            </button>
            <button
              onClick={disconnectAndSignOut}
              className="rounded-full border border-black/10 px-4 py-1.5 text-sm hover:bg-black/5 transition-colors duration-200"
            >
              Sign out
            </button>
          </div>

          <div className="space-y-3 border-t border-black/10 pt-4">
            {!kitConnection ? (
              <button
                onClick={reconnectForSigning}
                className="rounded-full border border-black/10 px-4 py-1.5 text-sm hover:bg-black/5 transition-colors duration-200"
              >
                Reconnect wallet to send a payment
              </button>
            ) : (
              <>
                <input
                  type="text"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="Destination address (defaults to self)"
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm focus:outline-none focus:border-black/30"
                />
                <button
                  onClick={signAndSubmitPayment}
                  disabled={sendLoading}
                  className="bg-black text-white text-sm font-medium px-6 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-50"
                >
                  {sendLoading ? 'Sending…' : 'Send 1 XLM'}
                </button>
              </>
            )}
            {txResult?.status === 'ok' && (
              <p className="text-sm text-green-700">
                ✓ Submitted. Hash: <code className="text-xs">{txResult.hash}</code> ·{' '}
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${txResult.hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-black transition-colors duration-200"
                >
                  stellar.expert
                </a>
              </p>
            )}
            {txResult?.status === 'err' && (
              <p className="text-sm text-red-600">✗ {txResult.message}</p>
            )}
          </div>
        </div>
      )}

      <div>
        <pre
          ref={logRef}
          className="h-40 overflow-y-auto rounded-xl bg-[#0A0A0A] text-gray-200 text-xs p-3 whitespace-pre-wrap"
        >
          {logLines.map((line, i) => (
            <span
              key={i}
              className={
                line.cls === 'ok' ? 'text-green-400' : line.cls === 'err' ? 'text-red-400' : ''
              }
            >
              {`[${line.time}] ${line.msg}\n`}
            </span>
          ))}
        </pre>
      </div>
    </div>
  );
}
