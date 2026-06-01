import { DemoBanner } from "@/components/DemoBanner";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { FeatureSection } from "@/components/FeatureSection";
import { HowItWorks } from "@/components/HowItWorks";
import { CardShowcase } from "@/components/CardShowcase";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <main>
      <DemoBanner />
      <Navbar />
      <Hero />
      <FeatureSection />
      <HowItWorks />
      <CardShowcase />
      <Footer />
    </main>
  );
}
