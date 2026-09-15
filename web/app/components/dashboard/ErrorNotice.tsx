'use client';

import { AlertCircle, ShieldAlert, LogIn } from 'lucide-react';
import { ApiError } from '../../lib/api';

/**
 * One presentation for every failure a dashboard action can produce, so a
 * permission problem reads as a permission problem rather than a red line of
 * JSON. Auth failures get a route out (sign in / Ops access); everything else
 * shows the service's own sentence, which for Carret is the actual reason —
 * "Minimum amount is 10.00" rather than "Validation failed".
 */
export function ErrorNotice({ error, className = '' }: { error: unknown; className?: string }) {
  if (!error) return null;

  const api = error instanceof ApiError ? error : null;
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong.';

  const kind = api?.needsAuth ? 'auth' : api?.needsOperator ? 'operator' : 'error';

  const tone =
    kind === 'error'
      ? 'bg-red-50 border-red-100 text-red-900'
      : 'bg-amber-50 border-amber-100 text-amber-900';

  const Icon = kind === 'auth' ? LogIn : kind === 'operator' ? ShieldAlert : AlertCircle;
  const iconTone = kind === 'error' ? 'text-red-500' : 'text-amber-600';

  const title =
    kind === 'auth' ? 'Sign in required' : kind === 'operator' ? 'Operator access required' : 'Could not complete';

  return (
    <div
      role="alert"
      className={`rounded-2xl border p-4 flex gap-3 items-start ${tone} ${className}`}
    >
      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconTone}`} aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm opacity-80 break-words">{message}</p>
        {kind === 'operator' && (
          <p className="text-xs opacity-70">
            Settlement, payouts and SCOUT issuance move protocol funds. Use{' '}
            <span className="font-medium">Ops access</span> in the top bar, then try again.
          </p>
        )}
      </div>
    </div>
  );
}
