import { ArrowRight } from 'lucide-react';

export function InfoSection() {
  return (
    <section className="bg-[#F5F5F5] px-6 py-24">
      <div className="max-w-[88rem] mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-16 items-start">
          <div>
            <h2
              className="text-black text-4xl md:text-5xl font-medium leading-tight mb-8"
              style={{ letterSpacing: '-0.03em' }}
            >
              Meet PathPulse.
            </h2>
            <a
              href="/settlement"
              className="inline-flex items-center gap-3 bg-black text-white text-base font-medium pl-8 pr-2 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200"
            >
              Discover it
              <span className="bg-white rounded-full p-2">
                <ArrowRight className="w-5 h-5 text-black" />
              </span>
            </a>
          </div>
          <p className="text-black/70 text-2xl md:text-3xl leading-relaxed">
            PathPulse is Stellar settlement infrastructure: a deterministic revenue split,
            enforced on-chain, with full treasury-to-recipient traceability for the
            institutions and governments that depend on it.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div
            className="lg:col-span-2 rounded-2xl p-7 min-h-80 flex flex-col justify-between"
            style={{
              backgroundImage:
                "url('https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260423_164207_f243351d-ed59-48ec-83a0-a5e996bdbe3c.png&w=1280&q=85')",
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            <h3
              className="text-black text-2xl font-medium leading-snug"
              style={{ letterSpacing: '-0.02em' }}
            >
              Splits enforced on-chain
            </h3>
            <p className="text-black/70 text-base max-w-xs">
              Every batch computes a deterministic 50/30/20 split — Authorities, Driver Pool,
              Treasury — settled as one verifiable Stellar transaction.
            </p>
          </div>

          <div className="rounded-2xl p-7 min-h-80 flex flex-col justify-between" style={{ backgroundColor: '#2B2644' }}>
            <h3 className="text-white text-2xl font-medium leading-snug">
              Traceable,
              <br />
              treasury to recipient.
            </h3>
            <p className="text-white/60 text-base">
              Every settlement batch is auditable end-to-end — treasury deposit to individual
              payout — for partner and government review.
            </p>
          </div>

          <div className="rounded-2xl p-7 min-h-80 flex flex-col justify-between" style={{ backgroundColor: '#2B2644' }}>
            <h3 className="text-white text-2xl font-medium leading-snug">
              Human-gated
              <br />
              at every key step
            </h3>
            <p className="text-white/60 text-base">
              Multisig treasury, automated settlement — but mainnet actions are never
              auto-signed. Every key step keeps a human in the loop.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
