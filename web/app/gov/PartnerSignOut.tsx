'use client';

import { useEffect, useState } from 'react';
import { getSessionUser, logout } from '../lib/api';

export function PartnerSignOut() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    getSessionUser()
      .then(({ user }) => setAuthed(user?.method === 'partner'))
      .catch(() => setAuthed(false));
  }, []);

  if (!authed) return null;

  return (
    <button
      onClick={async () => {
        await logout();
        window.location.reload();
      }}
      className="rounded-full border border-black/15 bg-white px-3 py-1 text-[11px] font-medium text-black hover:bg-black/5"
    >
      Sign out
    </button>
  );
}
