'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OpsApproval } from '@pathpulse/contract';
import { approveRequest, listPendingApprovals } from '../../lib/api';
import { useIdempotencyKey } from '../../lib/idempotency';
import { ErrorNotice } from './ErrorNotice';

const LABEL: Record<OpsApproval['action'], string> = {
  settlement: 'Settlement',
  converted_settlement: 'Converted settlement',
  group_payout: 'Group payout',
};

export function PendingApprovals({ refreshKey, onApproved }: { refreshKey: number; onApproved: () => void }) {
  const [items, setItems] = useState<OpsApproval[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const runApprove = useIdempotencyKey();

  const load = useCallback(async () => {
    try {
      setItems((await listPendingApprovals()).items);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshKey]);

  const approve = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await runApprove({ id }, (key) => approveRequest(id, key));
      onApproved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
      await load();
    }
  };

  if (!items.length && error == null) return null;

  return (
    <div className="rounded-2xl bg-white p-6 space-y-4">
      <h2 className="text-black text-lg font-medium tracking-[-0.02em]">Awaiting a second operator</h2>
      <p className="text-xs text-black/50">
        Fund moves above the approval threshold run only after a different operator approves them.
      </p>
      {error != null && <ErrorNotice error={error} />}
      <ul className="divide-y divide-black/5">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium">
                {LABEL[a.action]} · {a.amount}
              </div>
              <div className="font-mono text-xs text-black/50">
                {a.id} · requested by {a.requestedBy} · expires {new Date(a.expiresAt).toLocaleTimeString()}
              </div>
            </div>
            <button
              onClick={() => approve(a.id)}
              disabled={busy !== null}
              className="rounded-full bg-black px-4 py-1.5 text-xs font-medium text-white hover:bg-black/85 disabled:opacity-40"
            >
              {busy === a.id ? 'Approving…' : 'Approve and run'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
