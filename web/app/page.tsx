import { Navbar } from './components/landing/Navbar';
import { HeroSection } from './components/landing/HeroSection';
import { InfoSection } from './components/landing/InfoSection';
import { BackedBySection } from './components/landing/BackedBySection';
import { UseCasesSection } from './components/landing/UseCasesSection';

export default function Home() {
  return (
    <div className="flex flex-col bg-[#F5F5F5]">
      <div className="h-screen flex flex-col overflow-hidden">
        <Navbar />
        <HeroSection />
      </div>
      <InfoSection />
      <BackedBySection />
      <UseCasesSection />
    </div>
  );
}
