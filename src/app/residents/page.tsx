import type { Metadata } from "next";

import { AudienceLanding } from "@/components/marketing/AudienceLanding";

export const metadata: Metadata = {
  title: "Bundleen for residents — Join your community’s service requests",
  description:
    "Use your HOA’s invitation to join optional home-service requests with your neighbors. See the community’s plan, provider bids and service schedule.",
};

const entryGuidance = <><p>Already joined through your HOA? Open your community.</p><p>New here? Open the invitation link in your HOA’s email to join the right community.</p></>;

export default function ResidentsPage() {
  return (
    <AudienceLanding
      audience="residents"
      eyebrow="For residents invited by their HOA"
      title={<>Your neighbors.<br />{" "}<em>Your next service.</em></>}
      description="Join optional service requests through your HOA. See your community’s plan, compare the price and keep up with visits to your home."
      action={{ href: "/app/homeowner/community", label: "Open my community" }}
      entryGuidance={entryGuidance}
      pricingExample
      benefitsTitle={<>Shared requests.<br />{" "}A simpler way to join.</>}
      benefits={[
        { icon: "leaf", title: "Join with neighbors", body: "Choose the optional services you need from requests opened by your HOA." },
        { icon: "clean", title: "A clear shared price", body: "Compare provider bids and see the agreed price on your community’s request." },
        { icon: "calendar", title: "Keep track of visits", body: "Follow the selected provider’s service schedule and the visits linked to your home." },
      ]}
      story={{
        title: <>Your home.<br />{" "}<em>Your choice to join.</em></>,
        paragraphs: [
          "Your HOA opens optional service requests for the community. You decide which ones suit your home and join alongside your neighbors.",
          "More work in one place lets local providers plan nearby visits together and compete for the group’s business.",
        ],
        plannedTerms: "For the paid pilot, card-on-file payments after completed visits and a redo-or-refund policy are planned. Full payment and guarantee terms will be published before paid service begins.",
      }}
      steps={[
        { title: "Follow your HOA invitation.", body: "Open the invitation in your HOA’s email and sign in or create your account to join the right community." },
        { title: "Choose an optional request.", body: "Review the service, participation window and details for the work you want." },
        { title: "Review the shared plan.", body: "Providers bid on the grouped request. Your community’s authorized manager selects the provider." },
        { title: "Follow your visits.", body: "See the agreed service schedule and keep up with the visits linked to your home." },
      ]}
      questions={[
        { question: "How do I find my community?", answer: "Use the invitation link in the email from your HOA. If you have already joined, Open my community takes you to your signed-in community workspace. Ask your HOA manager for an invitation if you do not have one." },
        { question: "Do I have to join every request?", answer: "No. You choose which optional service requests to join. Read each request’s scope and participation details before committing." },
        { question: "Who chooses the provider?", answer: "Your community’s authorized manager compares provider bids and selects a provider for the participating homes." },
        { question: "What sets the price?", answer: "Competing provider bids and the number of participating homes shape the group’s price. You see the final price before you are charged." },
      ]}
      start={{ title: <>Your community.<br />{" "}<em>Your next step.</em></>, body: "Open your community workspace to see the optional service requests available to members." }}
    />
  );
}
