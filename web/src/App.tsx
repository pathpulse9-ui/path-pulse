import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './ui/Layout';
import { Dashboard } from './pages/Dashboard';
import {
  WalletInterop,
  Payouts,
  OffRamp,
  Settlement,
  GovGateway,
} from './pages/Placeholders';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <RequireAuth>
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/wallets" element={<WalletInterop />} />
              <Route path="/payouts" element={<Payouts />} />
              <Route path="/offramp" element={<OffRamp />} />
              <Route path="/settlement" element={<Settlement />} />
              <Route path="/gov" element={<GovGateway />} />
            </Routes>
          </Layout>
        </RequireAuth>
      </BrowserRouter>
    </AuthProvider>
  );
}
