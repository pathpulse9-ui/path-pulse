import GoogleLogin from '../../components/GoogleLogin';
import WalletConnect from '../../components/WalletConnect';

export default function WalletPage() {
  return (
    <div className="space-y-6">
      <h1
        className="text-black text-3xl md:text-4xl font-medium leading-tight"
        style={{ letterSpacing: '-0.03em' }}
      >
        Your Wallet
      </h1>
      <div className="max-w-2xl space-y-4">
        <GoogleLogin />
        <WalletConnect />
      </div>
    </div>
  );
}
