# GitHub issue cycle state

This is resumable operational state, not permanent policy. The manager updates it
at each meaningful transition; reconcile it with GitHub and current chat before use.
Do not include secrets or stage unrelated state changes into issue implementation commits.

- Repository: Lance-Dsilva/Bidbundle
- Backlog: https://github.com/Lance-Dsilva/Bidbundle/issues
- Default branch: main (verified 2026-10-25)
- Stage: NOT_STARTED
- Issue number / URL: none selected during setup
- Selection rationale: pending live backlog retrieval at the scheduled cycle
- Cycle owner / active session: none
- Last updated: 2026-10-25 (setup)
- Branch: none
- Worktree: none assigned to an issue
- PR URL: none
- Verified head: none
- Acceptance criteria: pending selected issue
- Reproduction / root cause: not investigated; setup does not select random work
- Team assignments / file ownership: pending issue plan
- Verification evidence: no issue implementation yet
- CI / review / merge state: not applicable
- Blockers: none established; check access and prerequisites on each run
- Next owner / action: Engineering Manager delegates GitHub intake at the daily cycle,
  first checking chat, worktrees, issue branches and PRs for unfinished work.

Treat this file as a per-task checkpoint. Cloud tasks have separate workspaces;
their copies do not synchronize automatically. Resume the existing cloud task when
work has not yet been published. Once a PR exists, keep a sanitized resume summary
in its description (issue, branch/head, stage, acceptance criteria, evidence, blockers,
next action) so a new task can recover from GitHub alone. Local worktree paths and
chat IDs are optional convenience metadata, never required cloud dependencies.
Reconcile this file against remote PR/branch state before use. If unpublished work
cannot be recovered, report the ambiguity and do not start a competing issue.
