import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './ui/Layout';
import { Dashboard } from './pages/Dashboard';
import { Settlement } from './pages/Settlement';
import {
  Payouts,
  OffRamp,
  GovGateway,
} from './pages/Placeholders';

// Wallet Interop pulls in the full Stellar SDK + Wallets Kit — lazy-load it so
// it stays out of the main bundle and the dashboard loads fast.
const WalletInterop = lazy(() =>
  import('./pages/WalletInterop').then((m) => ({ default: m.WalletInterop })),
);

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <RequireAuth>
          <Layout>
            <Suspense fallback={<p className="pp-muted">Loading…</p>}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/wallets" element={<WalletInterop />} />
                <Route path="/payouts" element={<Payouts />} />
                <Route path="/offramp" element={<OffRamp />} />
                <Route path="/settlement" element={<Settlement />} />
                <Route path="/gov" element={<GovGateway />} />
              </Routes>
            </Suspense>
          </Layout>
        </RequireAuth>
      </BrowserRouter>
    </AuthProvider>
  );
}
