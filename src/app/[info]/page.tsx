import Link from "next/link";
import { notFound } from "next/navigation";

type InfoPage = {
  title: string;
  eyebrow: string;
  intro: string;
  sections: Array<{ heading: string; body: string }>;
};

const pages: Record<string, InfoPage> = {
  help: {
    title: "How can we help?",
    eyebrow: "Help center",
    intro: "Find the quickest path to posting a request, comparing bids, or managing your account.",
    sections: [
      { heading: "Getting started", body: "Create an account, choose your role, confirm your service area, and BidBundle will take you to the right dashboard." },
      { heading: "Requests and bids", body: "Homeowners can post a service request and review competing offers. Providers can browse nearby opportunities and submit bids." },
      { heading: "Contact support", body: "For account or service questions, email support@bidbundle.com or call +1 (512) 555-0148 during business hours." },
    ],
  },
  safety: {
    title: "Built for trusted local work",
    eyebrow: "Safety and trust",
    intro: "Clear profiles, visible reviews, and transparent bids help neighborhoods make informed decisions.",
    sections: [
      { heading: "Provider information", body: "Provider profiles can show licensing, insurance, service history, ratings, and coverage areas before a homeowner accepts a bid." },
      { heading: "Transparent decisions", body: "Compare the scope, price, provider details, and neighborhood participation before choosing an offer." },
      { heading: "Report a concern", body: "Contact support@bidbundle.com if a listing, message, or service experience appears unsafe or misleading." },
    ],
  },
  faq: {
    title: "Frequently asked questions",
    eyebrow: "Answers",
    intro: "The essentials about neighborhood bundles and competitive service bids.",
    sections: [
      { heading: "What is a bundle?", body: "A bundle groups similar nearby service requests so providers can offer a more efficient neighborhood price." },
      { heading: "Do I have to accept a bid?", body: "No. You can compare available offers and decide whether any of them meet your needs." },
      { heading: "Can providers join?", body: "Yes. Choose the service-provider role during registration to create a business profile and see nearby opportunities." },
    ],
  },
  privacy: {
    title: "Privacy policy",
    eyebrow: "Your information",
    intro: "This preview explains the principles BidBundle uses when handling account and service information.",
    sections: [
      { heading: "Information you provide", body: "Account, location, request, bid, and message information is used to operate the service and connect relevant participants." },
      { heading: "How information is used", body: "Information supports authentication, service matching, communication, safety, analytics, and product improvement." },
      { heading: "Your choices", body: "You may request access, correction, or deletion of your account information by contacting support@bidbundle.com." },
    ],
  },
  terms: {
    title: "Terms of service",
    eyebrow: "Using BidBundle",
    intro: "These preview terms summarize the expected use of the platform.",
    sections: [
      { heading: "Marketplace role", body: "BidBundle helps homeowners, communities, and independent providers discover and coordinate service opportunities." },
      { heading: "User responsibilities", body: "Users are responsible for accurate information, lawful conduct, account security, and reviewing an offer before accepting it." },
      { heading: "Service agreements", body: "The provider and customer remain responsible for the final scope, scheduling, payment, and performance of service work." },
    ],
  },
  accessibility: {
    title: "Accessibility",
    eyebrow: "Designed for everyone",
    intro: "BidBundle aims to provide a clear and usable experience across devices and assistive technologies.",
    sections: [
      { heading: "Our approach", body: "We use semantic structure, keyboard-accessible controls, readable contrast, descriptive labels, and responsive layouts." },
      { heading: "Need assistance?", body: "If something prevents you from using the service, email support@bidbundle.com and describe the page and issue." },
      { heading: "Continuous improvement", body: "Accessibility is reviewed as the product evolves, including during interface and content updates." },
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(pages).map((info) => ({ info }));
}

export default async function InformationPage({ params }: { params: Promise<{ info: string }> }) {
  const { info } = await params;
  const page = pages[info];
  if (!page) notFound();

  return (
    <main className="min-h-screen bg-[#f8f5ef] px-5 py-10 text-[#17243a] sm:px-8 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <Link className="inline-flex items-center gap-2 text-sm font-semibold text-[#236e6b] hover:underline" href="/">
          ← Back to BidBundle
        </Link>
        <article className="mt-8 rounded-[28px] border border-[#ded8ce] bg-white p-7 shadow-[0_20px_60px_rgba(23,36,58,0.08)] sm:p-12">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#d06f3f]">{page.eyebrow}</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{page.title}</h1>
          <p className="mt-5 text-lg leading-8 text-[#526071]">{page.intro}</p>
          <div className="mt-10 space-y-8">
            {page.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="text-xl font-bold">{section.heading}</h2>
                <p className="mt-2 leading-7 text-[#526071]">{section.body}</p>
              </section>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap gap-3 border-t border-[#e8e3da] pt-8">
            <Link className="rounded-full bg-[#173b58] px-5 py-3 text-sm font-semibold text-white" href="/get-started">
              Get started
            </Link>
            <a className="rounded-full border border-[#b9c1c9] px-5 py-3 text-sm font-semibold" href="mailto:support@bidbundle.com">
              Contact support
            </a>
          </div>
        </article>
      </div>
    </main>
  );
}
