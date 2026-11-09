import type { Metadata } from "next";

import { AudienceLanding } from "@/components/marketing/AudienceLanding";

export const metadata: Metadata = {
  title: "Bundleen for providers — Bid on grouped local work",
  description:
    "Apply as a local service provider. Share your service area and credentials, bid on grouped community requests and plan denser local routes.",
};

export default function ProvidersPage() {
  return (
    <AudienceLanding
      audience="providers"
      eyebrow="For local service providers"
      title={<>Nearby homes.<br />{" "}<em>Better routes.</em></>}
      description="Put your business forward for grouped community work. Review the scope, submit your bid and plan visits to nearby homes."
      action={{ href: "/get-started?role=provider", label: "Apply as a provider" }}
      entryGuidance={<p>Share your service area and credentials. Requests and eligibility depend on your location and the community’s requirements.</p>}
      benefitsTitle={<>Local work.<br />{" "}A clear scope to price.</>}
      benefits={[
        { icon: "leaf", title: "Denser local routes", body: "Group visits to nearby homes instead of planning each one across town." },
        { icon: "clean", title: "Requests you can price", body: "Review the shared service need and put forward a bid that reflects the scope." },
        { icon: "calendar", title: "Connected scheduling", body: "When selected, follow the agreement, schedule and visits for participating homes." },
      ]}
      story={{
        title: <>One request.<br />{" "}<em>More nearby homes.</em></>,
        paragraphs: [
          "Show communities the services you offer and where you work. Bundleen reviews license and insurance details where applicable; each community’s requirements still apply.",
          "Compete on a clearly described group request. The community’s authorized manager compares the bids and selects a provider.",
        ],
        plannedTerms: "Pilot terms are planned with no lead fees and a 10% platform fee only on paid work. Final payment and cancellation terms will be shared before you accept paid pilot jobs.",
      }}
      steps={[
        { title: "Create your profile.", body: "Apply as a provider and tell communities about your business and services." },
        { title: "Add coverage and credentials.", body: "Share where you work and supply your license and insurance details for review where applicable." },
        { title: "Bid on grouped work.", body: "Review eligible requests in your service area and submit a bid for the shared scope." },
        { title: "Plan and complete visits.", body: "When selected, follow the service agreement and coordinate the scheduled visits." },
      ]}
      questions={[
        { question: "What work can I bid on?", answer: "Requests depend on your service categories, coverage area and the community’s eligibility requirements. Review the full scope before submitting a bid." },
        { question: "What credentials do I need?", answer: "Add your business, license and insurance details where applicable. Bundleen and the community review the requirements for the requested work; creating a profile alone does not establish verification." },
        { question: "Who selects the winning bid?", answer: "The community’s authorized manager compares bids and selects a provider. Submitting a bid is not an award or a promise of work." },
        { question: "Can I choose my service area?", answer: "Yes. Add the areas your business covers so you can review relevant community requests and plan nearby visits." },
      ]}
      start={{ title: <>Bring your business<br />{" "}<em>closer to home.</em></>, body: "Build your provider profile and put your services forward for grouped local work." }}
    />
  );
}
