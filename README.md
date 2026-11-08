# Bundleen

Bundleen is a resident savings program for HOA communities. Verified local service providers compete for a community's business, residents opt in to each request, and the association earns a share of every completed job, at no cost to the HOA.

Live site: https://bundleen.com

## How it works

1. **HOA signs on.** Bundleen onboards the whole community and imports the resident roster.
2. **Providers compete.** Three or more licensed, insured local providers bid on each request.
3. **HOA picks a bid.** The community manager selects the best bid.
4. **Residents join.** Residents get an invite from their HOA, save a card and pay nothing up front.
5. **Visits and payment.** Residents are charged only after each completed visit. Providers receive 90%; the HOA earns 5% for its reserve fund.

First service: weekly pool cleaning.

## Who uses it

| Role | What they do |
| --- | --- |
| HOA manager | Opens requests, compares bids, awards providers, shares invites with residents |
| Resident | Joins requests, pays after service, rates visits |
| Provider | Sets service areas, bids on community requests, completes visits, gets paid |
| Bundleen admin | Onboards communities, verifies providers, handles support |

## Tech stack

Next.js 15, React 18, Prisma with PostgreSQL, Clerk authentication, Upstash (Redis, QStash), Vercel and Vercel Blob, Resend email, Tailwind CSS, Vitest.

## Getting started

    npm install
    npm run dev

Open http://localhost:3000.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Apply database migrations and build |
| `npm test` | Run unit tests |
| `npm run test:integration` | Run integration tests |
| `npm run typecheck` | TypeScript check |

## Roadmap

Open work is tracked in [GitHub Issues](https://github.com/Lance-Dsilva/Bidbundle/issues), starting with Stripe payments (#43), the HOA revenue share (#44) and homepage updates (#45–#47).
