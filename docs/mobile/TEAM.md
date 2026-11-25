# Bundleen mobile team

Scope: native Flutter iOS and Android presentation over existing HTTPS backend. These instructions apply only to mobile work, not the web team's queue. No global AGENTS instructions are reinstated.

## Ownership
| Role | Responsibility | Initial owner |
| --- | --- | --- |
| Mobile Engineering Manager | Scope, gates, dependencies, evidence, checkpoint | Primary chat |
| Flutter Lead / Architect | Structure, tooling, repositories, platform boundaries | flutter_architect specialist |
| Application Engineer | Native screens and complete asynchronous states | Manager implemented first read-only lib/ slice |
| Backend / API Integration | Source contracts, minimal compatible adaptations | backend specialist |
| Authentication / Security | SDK selection, secure storage, session and isolation proof | auth_security specialist |
| Senior Mobile UX | Native flows, brand, accessibility, screenshot findings | independent_review specialist |
| Mobile Test Engineer | Independent unit/widget/contract/device evidence | Flutter architect reassigned for independent lib/ tests |
| Code Reviewer | Independent correctness and maintainability review | independent_review specialist |
| GitHub / Release Operations | Scoped commits/PRs/CI/artifacts, no correctness authority | Manager until release specialist assigned |

Agents are active only while assigned work runs. Recreate specialists from these responsibilities and STATE.md; no continuous background execution is implied. At most three specialists plus manager run simultaneously. One writer per file area; investigators own API_CONTRACT/PARITY, AUTH, and ARCHITECTURE/TOOLCHAIN respectively. Manager owns TEAM/PLAN/STATE/UX. Reviewers must not approve their own implementation.

## Working boundaries
Use the attached managed worktree and codex/mobile-foundation branch, starting at main fb4a245721ffdd69dd0255c0ef021e6b6fbb08ed. Preserve primary checkout and web work. Do not copy .env.local or service credentials into mobile. No production submissions, migrations, deployment, merge, store upload, account changes or recurring automation. Public configuration is not authorization. Server database grants and lifecycle decisions remain authoritative.

Use safe local test/typecheck commands; npm run build deploys migrations and is prohibited for routine verification. A fake demonstrates test behavior only, never live integration. Record unrun platform checks as unrun.

## Engineering coordination contract

Human authorization verified on 2026-11-01 by reading the original user message in the **Engineering team** chat, `01a174fd-bf0c-7973-a93a-1319bfe66547`, host `local`. The human made that Engineering Manager the mobile team's first point of contact. This supersedes the original prohibition on messaging that chat and authorizes reciprocal project coordination until revoked.

Route questions, blockers, dependency/API/environment needs, review requests, material failures, phase outputs and gate evidence there using `send_message_to_thread`. Contact that manager before asking the human directly. The manager investigates existing context/integrations, resolves routine engineering matters and consolidates necessary human escalations. Existing direct staging questions are superseded by this route; do not duplicate them. This grants no authority over human-reserved publication, production deployment, billing/security changes or credentials.

Mobile retains ownership of specialists, isolated worktree, branch and PRs. Coordinate a named shared-backend writer before editing shared files; requests must include exact API contracts and acceptance tests. Never reset or switch another team's checkout. Send meaningful changes or decision requests only; a reply does not require another wake-up. When blocked with nothing changed, checkpoint and wait. Continue independent authorized work without bypassing live-auth gates.

Every phase report includes commit/PR, tests/build/device evidence, review findings/fixes, unrun gates and recommended next task. Parent Engineering reviews and coordinates advancement; mobile remains implementation manager.
