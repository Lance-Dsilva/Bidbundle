/**
 * Bundleen's help/product-documentation corpus.
 *
 * Plain data, not server-only: both the AI assistant's `search_bundleen_help`
 * tool (`lib/server/ai/help-content.ts`) and the public `/help/[slug]` page
 * read from this same list, so a documentation link the assistant returns
 * always resolves to a real page.
 */
export type HelpArticle = {
  slug: string;
  title: string;
  body: string;
};

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "how-bidding-works",
    title: "How bidding works",
    body: `An HOA manager opens a service request for a category of work — lawn care, pest control, snow removal, and similar recurring or one-off jobs. Verified providers in the area submit bids with a price, a scope of work, and a proposed start date. Once bidding closes, the manager (or, for optional group requests, the residents) reviews the bids and awards one. Awarding a bid creates a service agreement with the terms locked in, so a later profile or price change by the provider cannot rewrite what was agreed. Bids can be revised while bidding is open and withdrawn by the provider before an award is made.`,
  },
  {
    slug: "compulsory-vs-optional-requests",
    title: "Compulsory recurring vs. optional group requests",
    body: `Bundleen supports two kinds of HOA service requests. A compulsory recurring request covers work the whole community shares, like common-area landscaping — every active resident is automatically part of it. An optional group request is opt-in: residents choose to join or decline, and the request only proceeds to bidding once it has enough participating homes. Group buying works because providers can quote a better per-home price once they know how many homes are committed, which is why participation is locked before bidding closes.`,
  },
  {
    slug: "hoa-onboarding",
    title: "Getting an HOA set up on Bundleen",
    body: `A Bundleen admin creates the HOA community and its home/unit inventory, then invites an HOA manager by email. Once the manager accepts, they can invite residents unit by unit; each invitation is bound to a specific home so a resident's account always maps to the right address. The community moves from draft to live once its manager is active and residents are being invited. Manager and admin roles are never self-granted — every manager and admin account exists because someone with a higher level of access explicitly created it.`,
  },
  {
    slug: "provider-verification",
    title: "Provider license and insurance verification",
    body: `Providers can enter their license number and insurance policy details on their profile, but that information is only shown as "verified" once a Bundleen admin has reviewed and confirmed it — entering the numbers alone does not verify them. If a provider edits a verified license or insurance claim, the verification is cleared automatically and must be re-confirmed by an admin. A provider's account also has a status — pending, active, or suspended — which controls whether they can submit new bids; suspension does not remove their existing bids or completed jobs.`,
  },
  {
    slug: "schedules-and-visits",
    title: "Service schedules, occurrences, and visits",
    body: `Once an agreement is awarded, Bundleen creates one or more occurrences — a single date for one-off work, or a recurring cycle (e.g. every two weeks) for ongoing work. Each occurrence includes a visit per participating home. The provider publishes the day's stop order and time window for a visit; residents see the scheduled date and window for their own home. A visit's status moves from scheduled through in progress to completed, and a provider can leave a short completion note. Reviews can be left after a visit or an agreement is complete.`,
  },
  {
    slug: "roles-and-access",
    title: "Account roles and what each one can see",
    body: `Every Bundleen account has one global role — homeowner, provider, or admin — but day-to-day permissions are more specific than that. HOA manager access is a separate, per-community assignment on top of the homeowner role: a person is only ever a manager of a particular HOA, never a manager everywhere. Homeowners see their own communities, requests, bids, and schedule. Providers see their own bids, agreements, and visits. Bundleen admins are the only role with cross-community operational visibility, and even an admin account needs an active, database-backed access grant — the role alone is not enough.`,
  },
];
