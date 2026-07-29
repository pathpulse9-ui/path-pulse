'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { verifyMagicLink } from '../../lib/api';
import { useSession } from '../../lib/session';

type Status = 'verifying' | 'success' | 'error';

function VerifyInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useSession();
  const [status, setStatus] = useState<Status>('verifying');
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get('token');
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('error');
      setError('Missing token.');
      return;
    }
    verifyMagicLink(token)
      .then(async () => {
        await refresh();
        setStatus('success');
        router.push('/');
      })
      .catch((err) => {
        setStatus('error');
        setError(String(err));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-md mx-auto p-8 space-y-3">
      {status === 'verifying' && <p className="text-sm text-gray-500">Signing you in…</p>}
      {status === 'success' && <p className="text-sm text-green-700">Signed in — redirecting…</p>}
      {status === 'error' && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}
