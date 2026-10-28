# GitHub issue engineering

## Source and schedule

The backlog is the actual [GitHub Issues for Lance-Dsilva/Bidbundle](https://github.com/Lance-Dsilva/Bidbundle/issues).
Do not independently scan the repository to invent work, create speculative issues,
or replace an empty/inaccessible backlog with random refactoring. Code inspection is
limited to understanding and solving the selected issue and its relevant dependencies.

The current schedule continues this chat **every eight hours**. Begin continuity
checks and issue intake immediately at each wakeup. This replaces the original daily
19:00/19:05 America/Chicago schedule; do not wait for those historical times.
Scheduling is active only when the automation service confirms a saved active
schedule; these instructions alone do not create a scheduler. The manager records
the actual automation identity and status separately. Do not create overlapping
independent workers for the two times.

## Ownership and continuity

The manager delegates GitHub intake and operations to `github_operations_engineer`.
The manager chooses the issue, establishes acceptance criteria, assigns engineers and
judges completion. GitHub Operations reports Git/remote facts; it does not certify
implementation correctness.

Before selecting anything, read `docs/engineering/ISSUE_STATE.md`, current chat
handoffs, active agents and worktrees. Inspect Git status and reconcile the recorded
issue, branch, PR and head revision with GitHub. Resume an unfinished issue first,
including one awaiting CI, requested changes, conflict resolution, review or merge.
A new priority issue does not silently displace actionable unfinished work. The
user's later instruction explicitly allows parking externally blocked work or a
verified PR awaiting human review/merge, then continuing other independent issues.
Record the parked issue's PR/head, evidence, blocker and next owner in its GitHub
handoff and the local checkpoint. Recheck it when external conditions change.

Keep one issue actively being implemented at a time; parked issues remain tracked
and open. Check for an already-running cycle before starting
another; if found, reuse its manager/task rather than launching competing writers.
Record the cycle owner and update time before delegation. Stale state requires
checking agent activity and remote evidence, not blindly clearing ownership. If two
owners or contradictory state cannot be resolved, report the blocker and make no
competing writes. The active manager task is the coordination point. A cloud task
uses its own saved state and GitHub handoff, not a particular Mac chat or checkout.

Persist resumable operational state in `ISSUE_STATE.md`: repository, issue number and
URL, cycle owner, update time, branch, worktree path, PR URL, verified head revision,
stage, acceptance criteria, evidence summary, blockers and next owner/action. Update
at selection, branch creation, significant verification, PR publication and handoff.
This is operational state, not permanent engineering policy. Exclude credentials and
sensitive logs. Keep detailed temporary evidence in the normal task record and retain
a sanitized summary sufficient to resume if scratch files disappear. Do not stage
unrelated operational-state edits into an issue's implementation commit.

For a fresh cloud task, recover from the active PR's description, branches and
current GitHub status. Keep the PR resume summary current when one exists. Before
publication, continue the same saved cloud task; unpublished state does not transfer
automatically to another workspace. Follow `CLOUD.md` for environment capabilities
and access checks, and stop on ambiguous ownership instead of duplicating work.

If state is missing, recover from chat history, existing issue branches and linked
open PRs before selecting. If recovery is ambiguous, report it rather than starting
a duplicate. If an issue was externally closed without a resolving merged PR,
reconcile the reason and remaining work with the manager; closure alone is not proof
that the implementation is correct.

## Retrieve and select

1. Confirm repository identity from Git remotes and GitHub. Read currently open
   issues with pagination, including titles, full descriptions, labels, assignees,
   relevant comments and available priority/severity/project ordering.
2. Check dependencies, linked issues and PRs, existing local/remote branches,
   assignees, recent activity, draft PRs and explicit claims of active work. Do not
   compete with another owner's implementation or duplicate a resolving PR. Missing
   metadata access is unknown, not evidence of no ownership or dependencies.
3. Respect explicit repository priority labels and project ordering. Where those
   do not resolve order, prefer critical/high priority, explicit urgency, production
   bugs, blockers, regressions, user-facing bugs, medium priority, then lower-priority
   maintenance. Assess clarity, reproduction, unresolved dependencies and feasibility
   from available context. Use a stable tie-break such as oldest creation time when
   otherwise equivalent; record the rationale instead of inventing new priority labels.
4. The manager selects one eligible issue and records the rationale. If no issue is
   open, record `NO_OPEN_ISSUES` and stop. If open issues are all blocked, owned or
   not actionable, record `NO_ELIGIBLE_ISSUE` with evidence and stop. If GitHub cannot
   be read, record `BLOCKED_GITHUB_ACCESS`; do not report an empty backlog.

## Understand before implementation

For the selected issue, read the full description and all relevant comments. Follow
linked issues/PRs as needed and recheck existing branches/PRs immediately before
creating anything. Inspect relevant source, establish expected behavior, attempt a
reproduction where practical, and distinguish established root cause from hypothesis.
Record reproduction limitations explicitly.

The manager creates an internal task plan containing observable acceptance criteria,
dependencies, scope, root-cause hypothesis, specialist assignments, file ownership,
required checks and handoffs. Use `TASK_TEMPLATE.md` and the standard engineering
workflow. A material requirement ambiguity is surfaced to the user; it must not be
silently resolved by weakening behavior.

## Implement, verify and publish

GITHUB ISSUES → SELECT ONE OPEN ISSUE → UNDERSTAND → ASSIGN TEAM → IMPLEMENT →
TEST → REVIEW → FIX FAILURES → VERIFY → CREATE/UPDATE PR → COMPLETE ISSUE → NEXT ISSUE.

The existing independent test/UI/code review gates and bounded failure loop remain
mandatory. GitHub Operations creates or reuses `codex/issue-<number>-<slug>` after
checking status, the actual default/base branch, existing branches and ownership.
Use an isolated worktree when needed to preserve other work, and never reset or
overwrite user changes to prepare an issue branch.

Once the manager approves the reviewed implementation and evidence, GitHub Operations
stages only approved issue files, inspects the staged diff, commits, pushes the issue
branch, and creates or updates the linked PR. This requested workflow authorizes
those operations without a separate human coordination prompt at each step; inherited
tool permission controls still apply. The PR describes the concrete behavior change,
links the issue, and records tests and limitations honestly. Use `Fixes #<number>`
only when the delivered scope resolves that issue. Reuse an existing PR where
appropriate; attach created or actively updated PRs to the current chat.

GitHub Operations reads CI/Actions results, PR review comments, requested changes and
merge conflicts for the current head. Return failures using the standard structured
report. The manager routes logic defects to implementation, UI defects to UI,
test defects to testing, and Git/CI diagnostics to the appropriate owner. Fixes
repeat independent verification and final diff review before publication. Never
alter tests or suppress CI just to obtain green checks. A later commit requires
fresh relevant CI and review evidence.

## Completion and next issue

A created PR is **PR_OPEN**, not a completed issue. While CI or review is pending,
preserve its checkpoint and inspect new actionable feedback at the next cycle. Per
the user's backlog instruction, park an unchanged external blocker or a verified PR
awaiting human review/merge and continue another independent eligible issue. Do not auto-merge, bypass
protections or close issues without separate applicable authority. When merger
authority is absent, leave the verified PR ready for review/merge and record
`AWAITING_MERGE`; the user need not coordinate specialists, but merge authority is
not inferred from permission to create PRs.

Confirm the resolving PR was merged, inspect final required checks and issue closure,
and reconcile any post-review changes before marking the issue complete. If the
issue remains open after merge, report that fact; do not claim completion or close it
without applicable authority. Verified completion releases the active slot; a
documented parked handoff also releases it for other work without resolving the
parked issue. The manager can retrieve the backlog again and select the next issue,
subject to the same one-at-a-time rules and available execution time. Persist a
handoff rather than abandoning partially finished work when a cycle must end.

Notify the user of meaningful progress, completion, failures or required decisions.
An unchanged empty backlog or unchanged waiting state does not need a repeated
notification. Never claim tests, PR publication, CI, merge, issue closure or scheduling
succeeded without evidence from the corresponding system.
