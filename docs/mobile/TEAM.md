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
