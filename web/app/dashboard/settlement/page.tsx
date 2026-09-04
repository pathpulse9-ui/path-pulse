'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import type { SettlementBatch, GroupPayoutBatch } from '@pathpulse/contract';
import { FRIENDBOT_URL } from '../../lib/stellar';
import { listSettlementBatches, createSettlementBatch, createGroupPayout } from '../../lib/api';
import { parseRecipientsFile, type ParsedRecipient } from '../../lib/parseRecipients';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const explorerTx = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const explorerAcct = (a: string) => `https://stellar.expert/explorer/testnet/account/${a}`;

async function makeFundedDriver(withUsdcTrustline = false): Promise<string> {
  const kp = Keypair.random();
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(kp.publicKey())}`);
  if (!res.ok) throw new Error(`Friendbot HTTP ${res.status}`);
  if (withUsdcTrustline) {
    const server = new Horizon.Server('https://horizon-testnet.stellar.org');
    const acct = await server.loadAccount(kp.publicKey());
    const tx = new TransactionBuilder(acct, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.changeTrust({ asset: new Asset('USDC', USDC_ISSUER) }))
      .setTimeout(60)
      .build();
    tx.sign(kp);
    await server.submitTransaction(tx);
  }
  return kp.publicKey();
}

function tierClasses(tier: number) {
  if (tier === 3) return 'bg-green-100 text-green-700 border-green-300';
  if (tier === 2) return 'bg-blue-100 text-blue-700 border-blue-300';
  return 'bg-black/5 text-black/60 border-black/10';
}

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

export default function SettlementPage() {
  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [selected, setSelected] = useState<SettlementBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [recipients, setRecipients] = useState<ParsedRecipient[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [payingGroup, setPayingGroup] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupResult, setGroupResult] = useState<GroupPayoutBatch | null>(null);
  const [memo, setMemo] = useState('');
  const [payoutAsset, setPayoutAsset] = useState<'XLM' | 'USDC'>('XLM');
  const [settlementAsset, setSettlementAsset] = useState<'XLM' | 'USDC'>('XLM');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listSettlementBatches(50);
      setBatches(page.items);
      setSelected((cur) => cur ?? page.items[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reach Backend Core');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Reviewer demo: generate + Friendbot-fund 3 driver accounts (tiers 1/2/3),
  // then run a 100 XLM settlement through the backend engine.
  const runSample = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      setStatus('Funding 3 sample driver accounts on testnet…');
      const tiers = [1, 2, 3] as const;
      const run = Date.now().toString(36);
      const drivers = [];
      for (let i = 0; i < tiers.length; i++) {
        const address = await makeFundedDriver(settlementAsset === 'USDC');
        drivers.push({ userId: `sample-driver-${run}-${i + 1}`, address, tier: tiers[i] });
      }
      setStatus('Executing 50/30/20 settlement…');
      const batch = await createSettlementBatch({
        grossAmount: settlementAsset === 'USDC' ? '1' : '100',
        drivers,
        asset: settlementAsset === 'USDC' ? { code: 'USDC', issuer: USDC_ISSUER } : undefined,
      });
      setSelected(batch);
      await load();
      setStatus(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sample settlement failed');
      setStatus(null);
    } finally {
      setRunning(false);
    }
  }, [load, settlementAsset]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setGroupError(null);
    setGroupResult(null);
    try {
      const parsed = await parseRecipientsFile(file);
      setRecipients(parsed);
    } catch (err) {
      setRecipients([]);
      setParseError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const updateRecipient = useCallback((index: number, patch: Partial<ParsedRecipient>) => {
    setRecipients((rows) =>
      rows.map((r, i) => {
        if (i !== index) return r;
        const next = { ...r, ...patch };
        if (patch.amount !== undefined) {
          next.amountValid = /^\d+(\.\d{1,7})?$/.test(next.amount.trim()) && Number(next.amount) > 0;
        }
        return next;
      }),
    );
    setGroupResult(null);
  }, []);

  const validRecipients = useMemo(
    () => recipients.filter((r) => r.addressValid && r.amountValid),
    [recipients],
  );
  const invalidCount = recipients.length - validRecipients.length;
  const totalAmount = validRecipients.reduce((sum, r) => sum + Number(r.amount), 0);

  const payGroup = useCallback(async () => {
    if (validRecipients.length === 0) return;
    setPayingGroup(true);
    setGroupError(null);
    try {
      const batch = await createGroupPayout({
        memo: memo.trim() || undefined,
        asset: payoutAsset === 'USDC' ? { code: 'USDC', issuer: USDC_ISSUER } : undefined,
        recipients: validRecipients.map((r) => ({
          name: r.name,
          address: r.address,
          amount: r.amount,
          remark: r.remark.trim() || undefined,
        })),
      });
      setGroupResult(batch);
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : 'Group payout failed');
    } finally {
      setPayingGroup(false);
    }
  }, [validRecipients, memo, payoutAsset]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-black text-lg font-medium tracking-[-0.02em]">
              Group payout
            </h2>
            <p className="text-sm text-black/60 mt-1">
              Upload a CSV or Excel file of name, Stellar address, and amount — pays each
              address exactly, no split or tier logic.
            </p>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full border border-black/10 px-4 py-1.5 text-sm hover:bg-black/5 transition-colors duration-200"
          >
            Upload CSV / Excel
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>

        {parseError && <p className="text-sm text-red-600">{parseError}</p>}

        {recipients.length > 0 && (
          <>
            <div className="flex items-center gap-4 flex-wrap text-sm text-black/60">
              <span>{recipients.length} rows</span>
              <span className="text-green-700">{validRecipients.length} verified</span>
              {invalidCount > 0 && <span className="text-red-600">{invalidCount} invalid</span>}
              <span>Total {totalAmount.toFixed(2)} {payoutAsset}</span>
            </div>

            <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
              {recipients.map((r, i) => {
                const valid = r.addressValid && r.amountValid;
                return (
                  <div
                    key={`${r.address}-${i}`}
                    className={`rounded-xl border p-4 flex items-center gap-4 ${
                      valid ? 'border-black/10' : 'border-red-300 bg-red-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-black font-medium truncate">{r.name || 'Unnamed'}</div>
                      <div className="text-xs text-black/40 font-mono truncate">{r.address}</div>
                      <input
                        value={r.remark}
                        onChange={(e) => updateRecipient(i, { remark: e.target.value })}
                        placeholder="Add a remark"
                        maxLength={120}
                        className="mt-2 w-full max-w-sm rounded-full border border-black/10 bg-white px-3 h-8 text-xs outline-none focus:border-black/30 transition-colors duration-200"
                      />
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <input
                        value={r.amount}
                        onChange={(e) => updateRecipient(i, { amount: e.target.value })}
                        inputMode="decimal"
                        aria-label={`Amount for ${r.name || 'recipient'}`}
                        className={`w-28 text-right rounded-full border bg-white px-3 h-9 text-sm outline-none transition-colors duration-200 ${
                          r.amountValid
                            ? 'border-black/10 focus:border-black/30'
                            : 'border-red-300 focus:border-red-400'
                        }`}
                      />
                      <span className="text-sm text-black/50">{payoutAsset}</span>
                    </div>
                    <span
                      className={`text-xs rounded-full border px-2 py-0.5 shrink-0 ${
                        valid
                          ? 'bg-green-100 text-green-700 border-green-300'
                          : 'bg-red-100 text-red-700 border-red-300'
                      }`}
                    >
                      {valid
                        ? 'Verified'
                        : !r.addressValid
                          ? 'Invalid address'
                          : 'Invalid amount'}
                    </span>
                  </div>
                );
              })}
            </div>

            <label className="flex flex-col gap-2 max-w-sm">
              <span className="text-xs text-black/50">
                Batch memo · written on-chain, max 28 characters
              </span>
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                maxLength={28}
                placeholder="e.g. Aug payout run"
                className="rounded-full border border-black/10 bg-white px-4 h-10 text-sm outline-none focus:border-black/30 transition-colors duration-200"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-black/50">Payout asset</span>
              <select
                value={payoutAsset}
                onChange={(e) => setPayoutAsset(e.target.value as 'XLM' | 'USDC')}
                className="rounded-full border border-black/10 bg-white px-4 h-10 text-sm outline-none focus:border-black/30 transition-colors duration-200"
              >
                <option value="XLM">XLM (native)</option>
                <option value="USDC">USDC (stablecoin)</option>
              </select>
              {payoutAsset === 'USDC' && (
                <span className="text-xs text-black/40 font-mono">
                  issuer {USDC_ISSUER.slice(0, 8)}…{USDC_ISSUER.slice(-4)} · recipients need a USDC trustline
                </span>
              )}
            </label>

            <button
              onClick={payGroup}
              disabled={validRecipients.length === 0 || payingGroup}
              className="bg-black text-white text-sm font-medium px-6 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-50"
            >
              {payingGroup
                ? 'Paying…'
                : `Pay ${validRecipients.length} recipient${validRecipients.length === 1 ? '' : 's'} (${totalAmount.toFixed(2)} ${payoutAsset})`}
            </button>

            {groupError && <p className="text-sm text-red-600">{groupError}</p>}

            {groupResult && (
              <div className="rounded-xl border border-green-300 bg-green-50 p-4 text-sm space-y-1">
                <div>
                  Disbursed {groupResult.receipts.length} recipients ·{' '}
                  {groupResult.totalAmount} {groupResult.asset.code}
                  {groupResult.asset.issuer && (
                    <span className="text-black/40 font-mono text-xs">
                      {' '}
                      ({groupResult.asset.issuer.slice(0, 8)}…{groupResult.asset.issuer.slice(-4)})
                    </span>
                  )}
                </div>
                {groupResult.disbursementId && (
                  <div className="font-mono text-xs text-black/60">
                    SDP disbursement {groupResult.disbursementId}
                  </div>
                )}
                {groupResult.horizonUrl ? (
                  <a
                    href={groupResult.horizonUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-black transition-colors duration-200"
                  >
                    view on stellar.expert
                  </a>
                ) : (
                  <div className="text-xs text-black/50">
                    Payment hashes appear on the Payouts tab once SDP submits them.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="rounded-2xl bg-white p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-black text-lg font-medium tracking-[-0.02em]">
            Settlement batches
          </h2>
          <div className="flex gap-3">
            <button
              onClick={load}
              disabled={loading}
              className="rounded-full border border-black/10 px-4 py-1.5 text-sm hover:bg-black/5 transition-colors duration-200 disabled:opacity-50"
            >
              Refresh
            </button>
            <select
              value={settlementAsset}
              onChange={(e) => setSettlementAsset(e.target.value as 'XLM' | 'USDC')}
              disabled={running}
              className="rounded-full border border-black/10 bg-white px-4 h-9 text-sm outline-none focus:border-black/30 transition-colors duration-200 disabled:opacity-50"
            >
              <option value="XLM">XLM</option>
              <option value="USDC">USDC</option>
            </select>
            <button
              onClick={runSample}
              disabled={running}
              className="bg-black text-white text-sm font-medium px-6 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-50"
            >
              {running
                ? 'Running…'
                : `Run sample settlement (${settlementAsset === 'USDC' ? '1 USDC' : '100 XLM'})`}
            </button>
          </div>
        </div>

        {status && <p className="text-sm text-black/50">{status}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {!error && batches.length === 0 && !loading && !running && (
          <div className="rounded-xl border border-dashed border-black/15 p-8 text-center">
            <p className="font-medium text-black">No settlement batches yet</p>
            <p className="text-sm text-black/50 mt-1">
              Run a sample settlement to execute a 50/30/20 split on testnet.
            </p>
          </div>
        )}

        {batches.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-black/50 border-b border-black/10">
                <th className="py-2 font-medium">Batch</th>
                <th className="py-2 font-medium">Created</th>
                <th className="py-2 font-medium">Gross</th>
                <th className="py-2 font-medium">Drivers</th>
                <th className="py-2 font-medium">Tx</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr
                  key={b.id}
                  onClick={() => setSelected(b)}
                  className={`border-b border-black/5 cursor-pointer hover:bg-black/5 transition-colors duration-200 ${
                    selected?.id === b.id ? 'bg-black/5' : ''
                  }`}
                >
                  <td className="py-2 font-mono text-xs">{b.id.replace('stl_', '').slice(0, 14)}…</td>
                  <td className="py-2 text-black/50">{new Date(b.createdAt).toLocaleTimeString()}</td>
                  <td className="py-2">{b.grossAmount} {b.asset.code}</td>
                  <td className="py-2">{b.driverPayouts.length}</td>
                  <td className="py-2 font-mono text-xs">
                    <a
                      href={explorerTx(b.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-black transition-colors duration-200"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {short(b.txHash)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="space-y-4">
          <h2 className="text-black text-lg font-medium tracking-[-0.02em]">
            Drill-down · <span className="font-mono text-sm text-black/50">{selected.id}</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl bg-white p-6">
              <div className="text-xs text-black/50">Authorities · 50%</div>
              <div className="text-xl font-medium mt-1 text-black">{selected.split.authorities} {selected.asset.code}</div>
              <div className="text-xs text-black/40 mt-1 font-mono">{short(selected.authoritiesAddress)}</div>
            </div>
            <div className="rounded-2xl bg-white p-6">
              <div className="text-xs text-black/50">Driver Rewards · 30%</div>
              <div className="text-xl font-medium mt-1 text-green-600">{selected.split.driverRewards} {selected.asset.code}</div>
              <div className="text-xs text-black/40 mt-1">{selected.driverPayouts.length} drivers</div>
            </div>
            <div className="rounded-2xl bg-white p-6">
              <div className="text-xs text-black/50">Treasury · 20%</div>
              <div className="text-xl font-medium mt-1 text-black">{selected.split.treasury} {selected.asset.code}</div>
              <div className="text-xs text-black/40 mt-1 font-mono">{short(selected.treasuryAddress)}</div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6">
            <h3 className="text-black text-lg font-medium tracking-[-0.02em] mb-1">
              Source → Split → Driver
            </h3>
            <p className="text-sm text-black/50 mb-4">
              Funded from <span className="font-mono">{short(selected.sourceAddress)}</span> · settled
              on-chain in one multi-op transaction ·{' '}
              <a
                href={explorerTx(selected.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-black transition-colors duration-200"
              >
                view on stellar.expert
              </a>
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-black/50 border-b border-black/10">
                  <th className="py-2 font-medium">Driver</th>
                  <th className="py-2 font-medium">SCOUT tier</th>
                  <th className="py-2 font-medium">Multiplier</th>
                  <th className="py-2 font-medium">Payout</th>
                </tr>
              </thead>
              <tbody>
                {selected.driverPayouts.map((d) => (
                  <tr key={d.address} className="border-b border-black/5">
                    <td className="py-2 font-mono text-xs">
                      <a
                        href={explorerAcct(d.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-black transition-colors duration-200"
                      >
                        {short(d.address)}
                      </a>
                    </td>
                    <td className="py-2">
                      <span className={`text-xs rounded-full border px-2 py-0.5 ${tierClasses(d.tier)}`}>
                        SCOUT{d.tier}
                      </span>
                    </td>
                    <td className="py-2">{d.multiplier.toFixed(1)}×</td>
                    <td className="py-2">{d.amount} {selected.asset.code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
