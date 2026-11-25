# Bidbundle AI issue workflow — setup guide

## What your colleague is doing (from issues #1–#79)

- **Tool:** OpenAI **Codex**. Every AI branch is `codex/issue-<n>-<slug>`. Comments and
  PRs post under Lance's own GitHub account through his `gh` login.
- **Roles:** the owner (rafayelmirijanyan1997) files issues labelled `P0/P1/P2` + area.
  Codex acts as an "Engineering Manager": it picks the highest-priority unowned issue and
  runs one *writer* agent plus separate *test* and *review* agents
  ("one production writer, independent test/review owners").
- **Loop per issue:**
  1. **Intake comment** on the issue: ownership check, plan, acceptance criteria.
  2. Branch from current `main`. Tests first, then the fix.
  3. Verify: focused tests, full suite (compared against 4 known baseline failures),
     typecheck, `next build`, real disposable Postgres for DB work, independent review.
  4. **Draft PR** with `Closes #n`, head SHA and a numbers-only Validation section.
  5. **Handoff comment** on the issue. The owner approves, then Lance merges.
- **Prompts:** the long `task*.md` files in the repo root are his written task briefs
  (goal, confirmed root cause, required implementation, constraints).
  `docs/engineering/ISSUE_<n>.md` are checkpoint notes the agent keeps per issue.
- **Stacking:** dependent work goes in stacked PRs (e.g. #77/#78 → #73, #79 → #78), and
  releases are combined (#39, `codex/release-65-66`).
- **Gaps:** no CLAUDE.md/AGENTS.md is committed (his agent instructions live on his
  machine), and there is no GitHub Actions CI. Vercel Preview is the only automatic
  check. This kit adds both pieces.

## What's left to work on

Open issues **#43 #44 #48 #49 #50 #56 #57 #59 #60** already have Lance's draft PRs
(#71–#79). **#53 (SMS via Twilio, P2)** and **#55 (neighbour referral credit, P2)** have
none. Agree with Lance before you pick one up, and ask the owner to file new bugs for you.

## One-time setup (about 30 minutes)

1. **Get write access.** Ask Lance to add you as a collaborator
   (repo → Settings → Collaborators). Accept the email invite.
2. **Make commits count as yours.** Contributions only show on your profile if the
   commit email is linked to your GitHub account:
   ```sh
   git config --global user.name  "Your Name"
   git config --global user.email "<id>+<username>@users.noreply.github.com"  # from github.com/settings/emails
   ```
3. **Tools:** Node 22, Git, GitHub CLI (`gh auth login`), Claude Code
   (`npm i -g @anthropic-ai/claude-code`, then `claude` and sign in).
4. **Clone and get a baseline:**
   ```sh
   git clone https://github.com/Lance-Dsilva/Bidbundle.git && cd Bidbundle
   npm ci
   npm run typecheck && npm test
   ```
   You should see 4 failures, all in `neighborhood-enrollment-reconciliation.test.ts`.
   If you see more, tell Lance before you change anything.
   Ask Lance for a **development** `.env.local`. Never use production keys.
5. **Install this kit** (copy these files into the repo root):
   ```
   CLAUDE.md
   scripts/preflight.sh
   .claude/settings.json
   .claude/agents/{issue-analyst,test-verifier,code-reviewer}.md
   .claude/skills/{fix-issue,open-pr}/SKILL.md
   ```
   Open the kit as your **first PR** (`chore: add Claude Code workflow and preflight gate`).
   It's a safe change and gives the team a shared pre-push check.

## Daily flow

```
claude
> /fix-issue 55
```
1. `issue-analyst` reads the issue, its comments and the code. It checks no PR owns the
   issue, then gives you root cause, acceptance criteria and a suggested fix.
2. You agree the plan. Claude creates `yourname/issue-55-…` from fresh `main` and drafts
   the intake comment for you to approve.
3. You write the failing test, then the fix. Claude suggests code and explains it, and
   only edits when you say so.
4. `test-verifier` runs the preflight and proves your tests fail without the fix.
5. `code-reviewer` checks auth, money, privacy, migrations and overlap with Lance's PRs.
6. `open-pr` rebases on `main`, re-runs the preflight, pushes, opens a **draft** PR and
   drafts the handoff comment.

## The "nothing blows up" rules

- **Merging to `main` deploys to bundleen.com and runs migrations on the live DB.**
  Never push to `main` and never merge yourself. `.claude/settings.json` blocks both.
- `bash scripts/preflight.sh` must pass before every push. It checks:
  up to date with `main` · no secrets · no edited or destructive migrations ·
  overlap with open PRs · typecheck · no *new* test failures · `next build`.
- Any new migration is called out in the PR for owner approval.
- Never run integration tests, seeds or `prisma migrate` against a shared database.
- Click through the Vercel Preview on desktop and mobile before marking the PR ready.
