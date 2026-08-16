import Image from 'next/image';

export function LogoIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/logo-mark.png"
      alt="PathPulse"
      width={110}
      height={128}
      priority
      className={`object-contain ${className ?? ''}`}
    />
  );
}
