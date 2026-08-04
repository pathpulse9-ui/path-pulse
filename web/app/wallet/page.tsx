import { ConsoleHeader } from '../components/ConsoleHeader';
import GoogleLogin from '../components/GoogleLogin';
import WalletConnect from '../components/WalletConnect';

export default function WalletPage() {
  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <ConsoleHeader active="wallet" />

      <div className="px-6 pb-24">
        <div className="max-w-2xl mx-auto">
          <h1
            className="text-black text-4xl md:text-5xl font-medium leading-tight mb-8"
            style={{ letterSpacing: '-0.03em' }}
          >
            Your Wallet
          </h1>
          <div className="space-y-4">
            <GoogleLogin />
            <WalletConnect />
          </div>
        </div>
      </div>
    </div>
  );
}
