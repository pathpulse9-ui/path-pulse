import { BrandMarquee } from './BrandMarquee';

const PARTNER_ITEMS = [
  { name: 'Meridian Capital', style: { fontFamily: '"Times New Roman", serif', fontWeight: 400, letterSpacing: '0.02em', fontSize: '14px' } },
  { name: 'NORTHLIGHT', style: { fontFamily: '"Arial Black", sans-serif', fontWeight: 900, letterSpacing: '0.08em', fontSize: '16px' } },
  { name: 'ANCHOR', style: { fontFamily: 'Impact, sans-serif', fontWeight: 700, letterSpacing: '0.05em', fontSize: '18px' } },
  { name: 'Vale Digital', style: { fontFamily: 'Georgia, serif', fontWeight: 600, letterSpacing: '-0.02em', fontSize: '17px' } },
  { name: 'Cordant Labs', style: { fontFamily: 'Helvetica, sans-serif', fontWeight: 700, letterSpacing: '-0.01em', fontSize: '15px' } },
  { name: 'BRIGHTLINE', style: { fontFamily: 'Verdana, sans-serif', fontWeight: 700, letterSpacing: '0.06em', fontSize: '14px', textTransform: 'uppercase' as const } },
  { name: 'FATHOM', style: { fontFamily: '"Courier New", monospace', fontWeight: 700, letterSpacing: '0.18em', fontSize: '14px' } },
  { name: 'Solace Partners', style: { fontFamily: 'Palatino, serif', fontWeight: 500, letterSpacing: '0.03em', fontSize: '15px' } },
];

export function BackedBySection() {
  return (
    <section className="bg-[#F5F5F5] px-6">
      <div className="max-w-[88rem] mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 items-center">
        <div className="text-black/70 text-base leading-relaxed">
          Built for institutions,
          <br />
          auditable by design.
        </div>
        <div className="md:col-span-3">
          <BrandMarquee
            items={PARTNER_ITEMS}
            animationName="backers-marquee"
            trackClassName="backers-track"
            durationSeconds={30}
            itemClassName="mx-10 shrink-0 text-black/50 whitespace-nowrap"
            containerClassName="w-full overflow-hidden"
          />
        </div>
      </div>
    </section>
  );
}
