import SignInPanel from '../components/auth/SignInPanel';

const ECOSYSTEM = [
  { name: 'Freighter', style: { fontFamily: 'Georgia, serif', fontWeight: 700, letterSpacing: '-0.02em' } },
  { name: 'LOBSTR', style: { fontFamily: 'Arial, sans-serif', fontWeight: 900, letterSpacing: '0.08em' } },
  { name: 'xBull', style: { fontFamily: '"Trebuchet MS", sans-serif', fontWeight: 600, fontStyle: 'italic' } },
  { name: 'ALBEDO', style: { fontFamily: '"Courier New", monospace', fontWeight: 700, letterSpacing: '0.12em' } },
  { name: 'Horizon', style: { fontFamily: 'Palatino, "Book Antiqua", serif', fontWeight: 400 } },
  { name: 'Stellar', style: { fontFamily: 'Impact, "Arial Narrow", sans-serif', fontWeight: 400, letterSpacing: '0.04em' } },
];

export default function SignInPage() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 min-h-screen">
      <SignInPanel />

      <div className="hidden lg:flex flex-col bg-[#0A0A0A]">
        <div className="relative flex-1 overflow-hidden">
          <video
            autoPlay
            muted
            loop
            playsInline
            className="object-cover absolute inset-0 w-full h-full"
            src="/signin-keys.mp4"
          />
        </div>
        <div className="px-12 py-14">
          <p className="text-white/50 text-xs tracking-widest text-center mb-10">
            SETTLES ACROSS THE STELLAR ECOSYSTEM
          </p>
          <div className="grid grid-cols-3 gap-y-10 gap-x-6 place-items-center">
            {ECOSYSTEM.map((item) => (
              <span key={item.name} className="text-white/80 text-lg whitespace-nowrap" style={item.style}>
                {item.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
