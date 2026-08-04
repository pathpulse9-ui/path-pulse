interface MarqueeItem {
  name: string;
  style: React.CSSProperties;
}

interface BrandMarqueeProps {
  items: MarqueeItem[];
  animationName: string;
  trackClassName: string;
  durationSeconds: number;
  itemClassName: string;
  containerClassName: string;
}

export function BrandMarquee({
  items,
  animationName,
  trackClassName,
  durationSeconds,
  itemClassName,
  containerClassName,
}: BrandMarqueeProps) {
  return (
    <div className={containerClassName}>
      <style>{`
        @keyframes ${animationName} {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .${trackClassName} {
          display: flex;
          width: max-content;
          animation: ${animationName} ${durationSeconds}s linear infinite;
        }
      `}</style>
      <div className={trackClassName}>
        {[...items, ...items].map((item, i) => (
          <span key={`${item.name}-${i}`} className={itemClassName} style={item.style}>
            {item.name}
          </span>
        ))}
      </div>
    </div>
  );
}
