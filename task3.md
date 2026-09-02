# Task: Simplify and Clarify the Bundleen Homepage

## Objective

Analyze and redesign **only the public homepage** so a non-technical visitor understands Bundleen within a few seconds, without reading long paragraphs or interpreting unrelated icons, miniature dashboards, decorative cards, and repeated claims.

The result should feel simple, trustworthy, polished, and high value. It must communicate the product more clearly with less content—not merely shrink fonts, tighten spacing, or rearrange the same material.

Preserve Bundleen's existing green/navy/amber brand palette, logo, working routes, and core visual identity. This is an information hierarchy and communication redesign, not a rebrand or backend project.

Primary files:

- `src/app/page.tsx`
- `src/app/landing.css`
- `src/components/marketing/LandingInteractions.tsx`
- Relevant assets under `public/modern/`

Do not modify authenticated dashboards, onboarding, APIs, database code, or account permissions.

---

## Required analysis before implementation

Before changing code, inspect the rendered homepage at desktop, tablet, and mobile widths and document briefly:

1. What a first-time visitor is likely to think Bundleen does after five seconds.
2. Which audience appears primary: HOA/community manager, resident, or provider.
3. Which messages are repeated in multiple sections.
4. Which claims are unsupported, overly specific, confusing, or require too much explanation.
5. Which visuals genuinely explain the product and which exist only as decoration.
6. Which sections can be removed, merged, or converted into concise text.
7. Whether the main CTA is obvious without scrolling.
8. Whether the mobile page feels like a focused story or a long stack of cards.

Use this analysis to drive the implementation. Do not preserve an element merely because CSS already exists for it.

---

## Confirmed problems in the current homepage

The existing page contains too many simultaneous messages and visual patterns:

- The hero includes an eyebrow, large headline, long explanation, two main buttons, a separate provider link, three trust items, and a detailed dashboard mockup.
- The dashboard mockup contains a sidebar, alert, metrics, bundle row, avatars, status pills, and a floating savings badge. Most of this is too small for a visitor to interpret quickly.
- `How Bundleen works` uses four icon cards with long descriptions, followed by four proof metrics and another example callout.
- The services section presents ten nearly identical icon cards, which increases page length without adding much understanding.
- The audiences section has three large cards, multiple bullets, three different embedded preview illustrations, and three separate CTAs.
- The same ideas—AI assistance, provider verification, manager control, savings, recurring services, and grouped homes—are repeated throughout the page.
- Decorative icons are often treated as content even when they do not make the product easier to understand.
- Several claims are very specific and may not yet be supported by production evidence, including `20–35%`, `~3 weeks`, `4.0★+`, `guaranteed volume`, `zero marketing`, fixed contract sizes, and exact savings examples.

The redesigned page should not make visitors decode a software dashboard to understand a straightforward idea.

---

## Core message the homepage must communicate

A visitor should quickly understand this sequence:

> A community combines the same home-service needs into one request. Local providers compete for the grouped work. The manager chooses the best offer, and residents receive transparent service and pricing.

Express this in plain language. Avoid terms such as workflow, pipeline, AI analysis, standardized pricing, pre-qualified leads, governance, auto-enrolled, or per-square-foot bidding unless they are essential and immediately explained.

### Audience priority

- The primary homepage audience is an HOA or community manager evaluating Bundleen for their community.
- Residents need reassurance and transparency, but they generally join through their community rather than becoming the primary acquisition CTA.
- Service providers are a secondary acquisition path and should have a clear but visually secondary link.
- Do not present all three audiences as equally important at every stage of the page.

---

## Required homepage structure

Claude may refine the exact structure after analysis, but the final page should remain close to this concise hierarchy.

### 1. Simple header

- Logo and Bundleen name.
- No more than three useful navigation links.
- `Log in` and one clear primary `Get started` action.
- Keep the mobile menu accessible and uncluttered.
- Remove navigation items for sections that no longer exist.

### 2. Hero: understand the product immediately

- One short headline describing the outcome, ideally no more than 8–12 words.
- One plain-language supporting statement, ideally no more than 25–35 words.
- One primary CTA for community/HOA managers.
- One secondary text link for service providers.
- Resident guidance may be a small, clear sentence rather than another equal-weight CTA.
- Do not place multiple badges, trust rows, status pills, or competing actions around the hero.

Use at most **one meaningful hero visual**. It should explain the group-buying concept without requiring the visitor to read tiny interface text. Good options include:

- Several homes joining one service request, followed by competing provider offers.
- One clean, legible product view that demonstrates community requests and bid comparison.

Do not retain the current miniature dashboard merely as decoration. If it remains, simplify it radically and ensure its meaning is understandable at normal viewing size and on mobile.

### 3. Three-step explanation

Explain the entire product in three concise steps, for example:

1. Residents share what service they need.
2. Bundleen groups the homes and providers submit offers.
3. The manager selects an offer and everyone can track the service.

Each step should use a short title and one sentence. Numbers or a simple connecting line are sufficient; unrelated icons and separate heavy cards are not required.

Do not add an additional proof band and example callout immediately after explaining the same process.

### 4. High-value benefits

Use one concise section containing only the strongest benefits:

- Better leverage from grouped work.
- Transparent provider offers and manager control.
- Less coordination for the community.

Describe benefits in user outcomes, not software features. Use a maximum of three items. A simple list or lightweight columns are preferred over decorative cards.

### 5. Who it helps

Summarize the value for managers, residents, and providers without three oversized sales panels.

- Manager: organizes community services and selects providers.
- Resident: sees pricing, schedules, and service progress.
- Provider: finds grouped jobs with less travel between homes.

Keep this compact. Avoid embedded phone mockups, bid tables, route illustrations, long bullet lists, and a CTA in every subsection.

### 6. Service examples

Do not use ten individual service cards. Show a short sentence or compact list of representative recurring services such as lawn care, cleaning, pool care, landscaping, and seasonal maintenance.

Make clear these are examples, not an exhaustive catalog. Icons are optional and should only remain if they improve scanning.

### 7. Final CTA and footer

- One concise final message and one primary manager CTA.
- A secondary provider link may remain.
- Keep the footer useful and restrained: product/help/legal/contact links only.
- Do not repeat the entire homepage message again in the footer.

---

## Copy rules

- Use plain language understandable without knowledge of HOA software, procurement, AI, or marketplace terminology.
- Lead with what Bundleen does and why it matters—not with technology.
- Prefer specific verbs: `combine`, `compare`, `choose`, `schedule`, and `track`.
- Avoid exaggerated language such as `without lifting a finger`, `do almost nothing`, `guaranteed volume`, and `zero marketing`.
- Do not publish precise performance, savings, rating, timing, contract, or volume claims unless they are supported by approved production evidence.
- If evidence is not available, use truthful qualitative language such as `better group pricing` or `less coordination`.
- Avoid describing AI as the product. AI may support the workflow, but the customer value is coordinated community purchasing and transparency.
- Remove duplicated statements. Each important idea should be explained once in its strongest location.
- Keep section introductions to one short sentence.
- Keep ordinary paragraphs below roughly 40 words and avoid dense multi-line bullet lists.
- Target a substantial reduction in visible copy and page length. Do not replace removed copy with equally verbose new text.

---

## Visual and interaction rules

- Every visual must answer a user question or make the group-service concept easier to understand.
- Remove decorative icons, pills, badges, mini cards, fake metrics, and UI fragments that do not add meaning.
- Prefer whitespace, strong typography, and clear grouping over borders around every piece of content.
- Use fewer card containers. Not every section or item needs a white rounded rectangle and shadow.
- Keep one consistent button hierarchy: primary, secondary, and text link.
- Maintain readable type sizes and balanced spacing at all breakpoints.
- Do not hide essential explanations behind animation, hover, or interaction.
- Keep animations subtle, respect `prefers-reduced-motion`, and remove animation code that no longer serves an existing element.
- Use semantic headings, accessible landmarks, visible keyboard focus, meaningful image alternative text, and adequate contrast.
- Optimize or remove unused homepage assets and CSS after the redesign. Avoid shipping hidden decorative content.

---

## Routing and product constraints

- Preserve the working manager CTA route: `/get-started?intent=community-manager` unless current routing code establishes a newer canonical route.
- Preserve the provider acquisition route: `/get-started?role=provider` unless a newer canonical route exists.
- Preserve login behavior and all legal/help/contact destinations that still exist.
- A resident should not be sent through an inappropriate open-signup flow if HOA residents are invitation-based.
- Do not expose internal admin, HOA-management, or provider data in a public visual.
- Do not introduce fake testimonials, customer logos, reviews, savings numbers, provider ratings, or live platform statistics.

---

## Validation and testing

Add or update tests for:

1. Primary and secondary CTA destinations.
2. Header and mobile navigation links.
3. Semantic heading order and accessible button/link names.
4. Mobile menu operation and keyboard behavior.
5. Reduced-motion behavior for retained interactions.
6. Absence of removed unsupported claims and obsolete decorative section copy.
7. No horizontal overflow at representative widths.

Run:

```bash
npm run typecheck
npm test
npx next build
```

Manually inspect at approximately:

- 390px mobile
- 768px tablet
- 1440px desktop

Compare before and after screenshots and verify:

- The product is understandable above the fold.
- The primary CTA is unmistakable.
- No text is clipped or too small.
- The page no longer feels like a long sequence of unrelated cards.
- Mobile visitors do not have to scroll through repetitive content to understand the offering.

---

## Acceptance criteria

- A non-technical visitor can explain Bundleen's basic idea after viewing the hero and three-step section.
- The page clearly prioritizes HOA/community managers while still providing appropriate resident context and a provider path.
- The homepage tells one coherent story: combine community demand, compare provider offers, choose transparently, and coordinate service.
- Visible copy, decorative cards, and unrelated icons are materially reduced.
- No unverified numerical or guarantee-style marketing claims remain.
- The hero contains one dominant CTA and no competing cluster of badges, links, and trust items.
- There are no more than three concise process steps and three primary benefits.
- Service examples are presented compactly rather than as ten separate cards.
- The mobile page is concise, legible, accessible, and free of horizontal overflow.
- Existing authentication, onboarding, provider, help, legal, and contact routes continue to work.
- Typecheck, automated tests, and the production build pass.

## Delivery notes

- Preserve unrelated working-tree changes.
- In the completion summary, include the initial homepage analysis, what was removed or merged, the final section order, and the reasoning behind the retained visual.
- Do not change the product's underlying workflows to make the marketing copy easier.
- Do not commit, push, or deploy unless separately requested.
