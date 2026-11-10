import type { Metadata } from "next";

import { AudienceLanding } from "@/components/marketing/AudienceLanding";

export const metadata: Metadata = {
  title: "Bundleen for HOAs — Resident savings, stronger communities",
  description:
    "Bring optional home services to your HOA at no cost to the association. Help residents compare competing local provider bids and coordinate shared work.",
};

export default function HomePage() {
  return (
    <AudienceLanding
      audience="hoa"
      eyebrow="For HOA boards and community managers"
      title={<>Better prices. <em>Stronger communities.</em></>}
      description="Bring optional home services to your residents at no cost to your HOA. Compare local provider bids and coordinate shared work in one place."
      action={{ href: "/community-onboarding", label: "Bring Bundleen to your community" }}
      pricingExample
      benefitsTitle={<>More for residents.<br />{" "}One community approach.</>}
      benefits={[
        { icon: "leaf", title: "Resident savings", body: "Bring nearby homes into one request so providers can price the grouped work." },
        { icon: "clean", title: "Competing local bids", body: "Compare proposals and review provider credentials before selecting the right fit." },
        { icon: "calendar", title: "Clear coordination", body: "Keep resident participation, scheduling and visits connected to the community request." },
      ]}
      story={{
        title: <>More homes.<br />{" "}<em>One shared request.</em></>,
        paragraphs: [
          "Your HOA brings the community together. Bundleen helps turn common service needs into requests that local providers can bid on.",
          "Residents join optional work through their HOA. Your authorized manager compares bids and selects the provider for participating homes.",
        ],
        plannedTerms: "Reserve-fund revenue sharing is planned for the pilot, subject to your community’s proposal. Your association’s terms will be confirmed before any paid pilot begins.",
      }}
      steps={[
        { title: "Introduce your community.", body: "Tell us about your HOA and its service needs through community onboarding." },
        { title: "Invite your residents.", body: "Once your community is set up, share HOA invitations so residents can join the right community." },
        { title: "Compare provider bids.", body: "Open requests, gather resident interest and review competing proposals and credentials." },
        { title: "Coordinate the work.", body: "Your authorized manager selects a provider, then participating homes follow the schedule and visits." },
      ]}
      questions={[
        { question: "Who is Bundleen for?", answer: "HOA boards and community managers bring Bundleen to the community. Residents then arrive through invitations from their HOA and choose which optional requests to join." },
        { question: "Does the association pay to get started?", answer: "Bringing Bundleen to your HOA has no cost to the association. Optional service pricing comes from provider bids, with any paid pilot terms shared before residents commit." },
        { question: "Who selects the provider?", answer: "Your community’s authorized manager compares the bids and reviews provider credentials before selecting a provider. Your HOA’s own approval requirements still apply." },
        { question: "What sets the residents’ price?", answer: "Competing provider bids set the price for the group’s service needs. The number of participating homes helps shape those bids. Residents see the final price before they are charged." },
      ]}
      start={{ title: <>Bring your<br />{" "}<em>community together.</em></>, body: "Start a conversation about your HOA’s residents and the services they need." }}
    />
  );
}
