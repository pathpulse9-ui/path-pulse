import GoogleLogin from './components/GoogleLogin';
import WalletConnect from './components/WalletConnect';

export default function Home() {
  return (
    <div className="flex-1 p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">PathPulse Wallet</h1>
        <GoogleLogin />
        <WalletConnect />
      </div>
    </div>
  );
}
