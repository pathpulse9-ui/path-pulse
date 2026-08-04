import { ArrowRight } from 'lucide-react';

export function UseCasesSection() {
  return (
    <section className="bg-[#F5F5F5] px-6 py-24">
      <div className="max-w-[88rem] mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        <div className="md:pr-12 md:pt-2">
          <p className="text-black/60 text-sm mb-2">PathPulse in Practice</p>
          <h2 className="text-5xl md:text-6xl font-medium leading-none mb-6" style={{ letterSpacing: '-0.04em' }}>
            Use modes
          </h2>
          <p className="text-black/60 text-base leading-relaxed max-w-sm">
            PathPulse powers settlement for platforms, governments, and treasuries that need
            safe, auditable, on-chain reward and payout infrastructure.
          </p>
        </div>

        <div className="relative rounded-3xl overflow-hidden min-h-[720px]">
          <video
            autoPlay
            muted
            loop
            playsInline
            className="object-cover absolute inset-0 w-full h-full"
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260423_183428_ab5e672a-f608-4dcb-b319-f3e040f02e2d.mp4"
          />
          <div className="relative z-10 p-10 md:p-12">
            <h3 className="text-4xl md:text-5xl font-medium leading-tight mb-5" style={{ letterSpacing: '-0.03em' }}>
              Settlement
            </h3>
            <p className="text-black/70 text-base max-w-md mb-8">
              Run deterministic 50/30/20 payout batches across your contributor pool, weighted
              by on-chain reputation tier, settled in a single Stellar transaction your team
              and regulators can verify on Horizon.
            </p>
            <a href="/settlement" className="group inline-flex items-center gap-3">
              <span className="w-9 h-9 rounded-full bg-white/80 backdrop-blur flex items-center justify-center group-hover:bg-white transition-colors">
                <ArrowRight className="w-4 h-4 text-black" />
              </span>
              Know more
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
